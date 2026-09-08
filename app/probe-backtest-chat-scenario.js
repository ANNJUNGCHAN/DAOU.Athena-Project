// 백테스트 채팅 제어 시나리오 프로브 — **실백엔드 + 실 Claude 채팅**으로 사람이 하는
// 시나리오를 그대로 돌린다(2026-09-02 사용자 지시 "너가 앱 키고 시나리오 만들어서 직접
// 진행해봐"). probe-backtest-e2e.js가 채팅 액션을 IPC로 흉내 냈다면, 이 프로브는 채팅
// 입력창에 진짜 문장을 넣고 모델이 athena_backtest 툴을 부르는 것까지 본다.
//
// 준비(프로브가 하지 않는다):
//   1) 백엔드가 127.0.0.1:8010에 떠 있고 백테스트가 켜져 있다(앱이 띄운 것이면 된다)
//   2) 005930 일봉 캔들이 캐시에 있다(없으면 첫 실행이 승인 카드로 빠진다)
//   3) claude CLI 로그인 상태 — 채팅 턴마다 실제 모델을 부른다
// 실행: cd app && npx electron probe-backtest-chat-scenario.js

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-bt-chat-'));
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { startedAt: new Date().toISOString(), steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-bt-chat] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data).slice(0, 900)}`);
}

function js(win, source) {
  return win.webContents.executeJavaScript(source);
}

async function until(win, source, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  let last = null;
  while (Date.now() < deadline) {
    last = await js(win, source);
    if (last) return last;
    await wait(400);
  }
  return last;
}

async function backendReady() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch('http://127.0.0.1:8010/ready');
      if (r.status === 200) return true;
    } catch { /* 아직 */ }
    await wait(1500);
  }
  return false;
}

// 채팅 한 턴 — chat.js의 dispatchUserQuery로 넣고, state가 idle로 돌아올 때까지 기다린다.
// 돌려주는 것: 마지막 답변 문장, 마지막 채팅 카드 문구, 카드 버튼 라벨들.
async function chat(win, text, timeoutMs) {
  const idle = await until(win, "typeof state !== 'undefined' && state === 'idle' && !remoteQueryBusy", 30000);
  if (!idle) return { error: 'chat busy before send' };
  const before = await js(win, "document.querySelectorAll('#history .turn').length");
  await js(win, `dispatchUserQuery(${JSON.stringify(text)}); true`);
  await until(win, "typeof state !== 'undefined' && state !== 'idle'", 8000);
  const done = await until(win, "typeof state !== 'undefined' && state === 'idle'", timeoutMs || 150000);
  if (!done) return { error: 'turn timeout', text };
  await wait(600);
  return js(win, `(() => {
    const turns = Array.from(document.querySelectorAll('#history .turn'));
    const fresh = turns.slice(${before});
    const answers = fresh.map((t) => t.querySelector('.turn-a')).filter(Boolean);
    const answer = answers.length ? answers[answers.length - 1].textContent : '';
    const cards = fresh.map((t) => t.querySelector('.backtest-change')).filter(Boolean);
    const card = cards.length ? cards[cards.length - 1] : null;
    return {
      turns: fresh.length,
      answer: answer.slice(0, 600),
      card: card ? card.textContent.replace(/\\s+/g, ' ').slice(0, 500) : null,
      cards: cards.length,
      buttons: card ? Array.from(card.querySelectorAll('button')).map((b) => b.textContent) : [],
    };
  })()`);
}

function ctx(win) {
  return js(win, 'window.AthenaBacktestCanvas.getContext()');
}

// 마지막 채팅 카드의 버튼을 누른다.
function clickCardButton(win, label) {
  return js(win, `(() => {
    const cards = document.querySelectorAll('#history .backtest-change');
    const card = cards[cards.length - 1];
    if (!card) return { clicked: false, reason: 'no card' };
    const btn = Array.from(card.querySelectorAll('button')).find((b) => b.textContent === ${JSON.stringify(label)});
    if (!btn) return { clicked: false, reason: 'no button', buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent) };
    btn.click();
    return { clicked: true };
  })()`);
}

const READ_TILES = `(() => {
  const root = document.getElementById('backtestCanvas');
  const tiles = root.querySelectorAll('.backtest-metric-tile');
  if (tiles.length !== 6) return null;
  const values = Array.from(tiles).map((t) => {
    const l = t.querySelector('.backtest-metric-label');
    const v = t.querySelector('.backtest-metric-value');
    return { label: l ? l.textContent : '', value: v ? v.textContent : null };
  });
  if (!values.every((v) => v.value && v.value !== '—')) return null;
  const badge = root.querySelector('.backtest-result-runpath');
  return { values, runPath: badge ? badge.textContent : null, stdout: root.querySelectorAll('.backtest-stdout-text').length };
})()`;

async function waitResult(win, timeoutMs) {
  return until(win, READ_TILES, timeoutMs || 90000);
}

// 답변 문장이 타일의 숫자를 실제로 담았는지 — 숫자 부분만 비교한다(단위·부호 표기 차이 흡수).
function mentions(answer, tileValue) {
  const m = String(tileValue || '').match(/-?\d+(\.\d+)?/);
  if (!m) return false;
  const num = m[0].replace('-', '');
  const rounded = String(Math.round(Number(num) * 10) / 10);
  return answer.includes(num) || answer.includes(rounded) || answer.includes(String(Math.round(Number(num))));
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  await wait(1800);

  record('00-백엔드 준비(8010 ready)', await backendReady(), {});

  await js(shellWin, "document.getElementById('modeNavBacktest').click(); true");
  // 보드 19: 첫 화면은 폼 탭의 기법 목록이다. 하위탭 클릭은 이미 그 자리라 멱등이다.
  await js(shellWin, "(() => { const t = document.querySelectorAll('#backtestCanvas .backtest-subtab'); if (t[1]) t[1].click(); return true; })()");
  const presets = await until(shellWin, "document.querySelectorAll('#backtestCanvas .backtest-preset-item').length", 20000);
  const head = await js(shellWin, "(() => { const h = document.getElementById('chatModeHead'); return h && !h.hidden ? h.textContent.replace(/\\s+/g, ' ') : null; })()");
  record('01-백테스트 모드 진입 + 채팅 헤더', presets === 10 && !!head && head.includes('기법에게 묻기'), { presets, head });

  // ---------- (2) 채팅이 폼을 채운다 ----------
  const t2 = await chat(shellWin, '52주 신고가 돌파 전략으로 삼성전자 1년치 백테스트를 알아서 설정해줘');
  const c2 = await ctx(shellWin);
  const ok2 = !t2.error && c2 && c2.spec && c2.spec.presetId === 'week52_high'
    && Array.isArray(c2.spec.symbols) && c2.spec.symbols.length === 1 && c2.spec.symbols[0] === '005930'
    && /^\d{8}$/.test(c2.spec.fromDt) && /^\d{8}$/.test(c2.spec.toDt)
    && !!t2.card && t2.card.includes('설정 반영');
  record('02-채팅 설정 → 폼 즉시 반영(52주·005930·기간)', ok2, {
    answer: t2.answer, card: t2.card, spec: c2 && c2.spec && {
      presetId: c2.spec.presetId, symbols: c2.spec.symbols, fromDt: c2.spec.fromDt, toDt: c2.spec.toDt,
    }, pending: c2 && c2.pending,
  });

  // ---------- (3) 카드의 [실행] → 결과 ----------
  let click3 = await clickCardButton(shellWin, '실행');
  if (!click3.clicked) {
    const t3b = await chat(shellWin, '실행해줘');
    click3 = Object.assign({ retriedVia: t3b.card }, await clickCardButton(shellWin, '실행'));
  }
  const r3 = await waitResult(shellWin, 90000);
  const c3 = await ctx(shellWin);
  record('03-[실행] → 결과 탭(타일 6장)', click3.clicked && !!r3, { click: click3, tiles: r3, lastResult: c3 && c3.lastResult && { status: c3.lastResult.status, metrics: c3.lastResult.metrics } });

  // ---------- (4) 결과 설명이 화면 숫자를 쓴다 ----------
  const t4 = await chat(shellWin, '결과 설명해줘');
  const tileTotal = r3 && r3.values.find((v) => v.label.includes('총수익률'));
  const tileMdd = r3 && r3.values.find((v) => v.label === '최대 낙폭');
  const usesTotal = !!tileTotal && mentions(t4.answer || '', tileTotal.value);
  const usesMdd = !!tileMdd && mentions(t4.answer || '', tileMdd.value);
  record('04-"결과 설명해줘" — 답이 타일 숫자를 쓴다', !t4.error && usesTotal && usesMdd, {
    answer: t4.answer, tiles: r3 && r3.values, usesTotal, usesMdd,
  });

  // ---------- (5) 채팅이 코드를 편집기에 넣는다 ----------
  const t5 = await chat(shellWin, '이 전략을 파이썬 코드로 짜줘');
  const c5 = await ctx(shellWin);
  const ok5 = !t5.error && c5 && c5.code && c5.code.source.includes('def signals') && c5.runPath === 'code'
    && c5.designTab === 'code' && !!t5.card && t5.card.includes('코드 반영');
  record('05-채팅 코드 → 편집기 즉시 반영 · 실행경로 code', ok5, { answer: t5.answer, card: t5.card, lines: c5 && c5.code && c5.code.lines, runPath: c5 && c5.runPath, designTab: c5 && c5.designTab });

  // ---------- (6) 코드 경로 실행 ----------
  let click6 = await clickCardButton(shellWin, '실행');
  if (!click6.clicked) {
    const t6b = await chat(shellWin, '코드로 실행해줘');
    click6 = Object.assign({ retriedVia: t6b.card }, await clickCardButton(shellWin, '실행'));
  }
  const r6 = await until(shellWin, `(() => { const r = ${READ_TILES}; return r && r.runPath === '코드 경로' ? r : null; })()`, 120000);
  const c6 = await ctx(shellWin);
  record('06-코드 경로 실행 → "코드 경로" 배지 + 코드 출력', click6.clicked && !!r6 && r6.stdout === 1, { click: click6, tiles: r6, runPath: c6 && c6.lastResult && c6.lastResult.metrics && c6.lastResult.metrics.run_path });

  // ---------- (7) 일부러 오류 → 진단 ----------
  const t7 = await chat(shellWin, "코드에서 p['period']를 p['periodd']로 바꿔서 실행해봐");
  let click7 = await clickCardButton(shellWin, '실행');
  if (!click7.clicked) {
    const t7b = await chat(shellWin, '실행해줘');
    click7 = Object.assign({ retriedVia: t7b.card }, await clickCardButton(shellWin, '실행'));
  }
  const d7 = await until(shellWin, `(() => {
    const c = window.AthenaBacktestCanvas.getContext();
    // 실패 직후 진단 조회가 비동기라 view가 'running'→'diagnosis'로 넘어가는 데 한 박자 걸린다 —
    // 진단 화면(또는 진단이 없어 error 화면)이 실제로 뜬 뒤에만 판정한다.
    if (c.view === 'diagnosis' || c.view === 'error') {
      const title = document.querySelector('#backtestCanvas .backtest-diag-title');
      return { view: c.view, error: c.lastResult && c.lastResult.error, diagTitle: title ? title.textContent : null };
    }
    return null;
  })()`, 120000);
  record('07-오류 코드 실행 → 실패 + 진단 카드', !t7.error && click7.clicked && !!d7 && d7.view === 'diagnosis', { answer: t7.answer, click: click7, diag: d7 });

  // ---------- (8) 고쳐줘 ----------
  const t8 = await chat(shellWin, '고쳐줘');
  const c8 = await ctx(shellWin);
  // 모델은 p['period']든 p["period"]든 쓸 수 있다 — 따옴표 종류는 판정에 넣지 않는다.
  // 모델은 p["period"]·p['period']·params["period"] 등 여러 모양으로 쓴다 — 오타가 사라졌는지만 본다.
  const fixed = !!(c8 && c8.code && !c8.code.source.includes('periodd'));
  let click8 = await clickCardButton(shellWin, '실행');
  if (!click8.clicked) {
    const t8b = await chat(shellWin, '실행해줘');
    click8 = Object.assign({ retriedVia: t8b.card }, await clickCardButton(shellWin, '실행'));
  }
  const r8 = await waitResult(shellWin, 120000);
  record('08-"고쳐줘" → 편집기 수정 → 재실행 성공', !t8.error && fixed && click8.clicked && !!r8, { answer: t8.answer, card: t8.card, fixed, click: click8, tiles: r8 && r8.values.slice(0, 2) });

  // ---------- (9) 최적화 ----------
  const t9 = await chat(shellWin, 'period를 그리드로 최적화 준비해줘');
  const c9 = await ctx(shellWin);
  const click9 = await clickCardButton(shellWin, '탐색 시작');
  const o9 = await until(shellWin, `(() => { const c = window.AthenaBacktestCanvas.getContext(); return c.optimize && c.optimize.result ? c.optimize.result : null; })()`, 180000);
  record('09-최적화 준비 → 채팅 [탐색 시작] → 결과', !t9.error && c9 && c9.tab === 'optimize' && click9.clicked && !!o9, { answer: t9.answer, card: t9.card, tab: c9 && c9.tab, click: click9, best: o9 && o9.best, warnings: o9 && o9.warnings });

  // ---------- (10) 이력 ----------
  const t10 = await chat(shellWin, '이력 보여줘');
  const c10 = await ctx(shellWin);
  record('10-"이력 보여줘" → 이력 탭', !t10.error && c10 && c10.tab === 'history', { answer: t10.answer, tab: c10 && c10.tab, runs: c10 && c10.runs && c10.runs.length });

  // ---------- (11) 배포 ----------
  const t11 = await chat(shellWin, '배포 화면 열어줘');
  const c11 = await ctx(shellWin);
  record('11-"배포 화면 열어줘" → 배포 탭 + 사람이 한다는 안내', !t11.error && c11 && c11.tab === 'deploy', { answer: t11.answer, tab: c11 && c11.tab });

  // ---------- (12~15) 연결 오류 → 질문 하나 → 답 → 패치 카드 → (사람) 적용 ----------
  // 여기부터가 시각 설계 왕복(보드 11→12→13→14)이다. 앞 단계들이 실행경로를 code로
  // 굳혀 놨으므로 프리셋을 다시 골라 스펙 경로로 되돌린 뒤 시작한다 — 사람이 하는
  // 되돌리기와 같은 클릭이다(selectPreset이 코드와 실행경로를 함께 비운다).
  //
  // **모델 의존 표시.** 12는 사람 클릭만으로 성립하는 사실이라 모델과 무관하다.
  // 13~15는 모델이 athena_backtest action=visual_question을 부르는지에 달려 있다 —
  // 그 단계들의 data에 modelDependent를 박아 흔들림을 리포트에서 바로 가른다.
  await js(shellWin, "(() => { const t = document.querySelectorAll('#backtestCanvas .backtest-tab'); if (t[0]) t[0].click(); return true; })()");
  await wait(200);
  await js(shellWin, "(() => { const t = document.querySelectorAll('#backtestCanvas .backtest-subtab'); if (t[1]) t[1].click(); return true; })()");
  await wait(200);
  await js(shellWin, "(() => { const p = document.querySelectorAll('#backtestCanvas .backtest-preset-item'); if (p[0]) p[0].click(); return true; })()");
  await wait(600);
  await js(shellWin, "(() => { const t = document.querySelectorAll('#backtestCanvas .backtest-subtab'); if (t[0]) t[0].click(); return true; })()");
  await until(shellWin, "document.querySelectorAll('#backtestCanvas .backtest-vis-node').length ? true : null", 30000);
  await js(shellWin, "(() => { const b = document.querySelector('#backtestCanvas .backtest-visual-validate'); if (b) b.click(); return true; })()");
  await until(shellWin, "window.AthenaBacktestCanvas.getContext().map.validation_state === 'synced' ? true : null", 30000);

  // 연결을 끊는 것은 사람의 손이다 — 검사기의 '오른쪽 입력'을 [연결 없음]으로 되돌린다.
  const cut12 = await js(shellWin, `(() => {
    const root = document.getElementById('backtestCanvas');
    const card = root.querySelector('.backtest-vis-node[data-node-id="cond-exit-1"]');
    if (!card) return { ok: false, reason: 'cond-exit-1 칸이 없다' };
    card.click();
    const sel = root.querySelector('.backtest-vis-inspector select.backtest-vis-select[data-node-id="cond-exit-1"][data-port="right"]');
    if (!sel) return { ok: false, reason: '검사기에 오른쪽 입력 칸이 없다' };
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  const broken12 = await until(shellWin, `(() => {
    const c = window.AthenaBacktestCanvas.getContext();
    if (c.map.validation_state !== 'invalid') return null;
    const run = document.querySelector('#backtestCanvas .backtest-run-button');
    return {
      state: c.map.validation_state,
      codes: c.map.diagnostics.map((d) => d.code),
      runText: run ? run.textContent.trim() : null,
      runDisabled: run ? !!run.disabled : null,
    };
  })()`, 30000);
  record('12-청산 조건의 오른쪽 입력을 끊으면 지도가 오류 상태가 된다(사람 클릭)',
    !!cut12.ok && !!broken12 && broken12.codes.includes('BTG-PORT-002')
      && broken12.runText === '오류 검토' && broken12.runDisabled === true,
    { cut: cut12, broken: broken12 });

  // ---------- (13) 모델이 묻는다 — 고치지 않고 ----------
  const t13 = await chat(shellWin, '오류를 고쳐줘');
  const q13 = await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    if (!cards.length) return null;
    const card = cards[cards.length - 1];
    const pill = card.querySelector('.routine-draft-pill.is-filled');
    if (!pill || pill.textContent !== '한 가지만 확인할게요') return null;
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      title: pill.textContent,
      choices: Array.from(card.querySelectorAll('.backtest-visual-choice')).length,
      recommended: Array.from(card.querySelectorAll('.backtest-visual-choice'))
        .filter((b) => Array.from(b.querySelectorAll('.routine-draft-pill')).some((p) => p.textContent === '권장')).length,
      pendingQuestion: c.map.pendingQuestion,
    };
  })()`, 30000);
  const c13 = await ctx(shellWin);
  const steps13 = await js(shellWin, "Array.from(document.querySelectorAll('#history .progress-tool-step')).map((e) => e.textContent.replace(/\\s+/g, ' '))");
  record('13-"오류를 고쳐줘" → 모델이 질문 카드 하나만 띄운다(모델 의존)',
    !t13.error && !!q13 && q13.choices >= 2 && q13.recommended === 1
      && !!q13.pendingQuestion && q13.pendingQuestion.code === 'BTG-PORT-002'
      && c13.map.validation_state === 'invalid',
    {
      modelDependent: true,
      answer: t13.answer, card: t13.card, question: q13, toolSteps: steps13,
      // 카드가 없으면 그 사실 자체가 진단이다 — 모델이 안 불렀는가, 불렀는데 안 넘어왔는가.
      // 두 갈래를 answer로 가른다: "오류가 없습니다"라고 답했으면 모델이 오류를 **못 본**
      // 것이고(라이브 프리픽스가 map.validation_state·map.diagnostics를 map.graph 아래에서
      // 찾는다 — lib/main/live-prompt.js), 부르고도 카드가 없으면 전달이 끊긴 것이다.
      // 세 갈래를 answer·toolSteps로 가른다: ① 모델이 오류를 못 봤다(프리픽스가 map 밑의
      // diagnostics를 못 읽는다) ② 툴을 불렀는데 실패했다("처리 중 실패") — visual_question은
      // 모델이 **그래프 전체**를 실어 보내야 하는데 프리픽스는 노드 id·라벨만 준다(엣지·
      // params·scenario가 없어 모델이 지금 그래프를 그대로 재현할 수 없다) ③ 불렸고 성공했는데
      // 카드가 안 왔다. 2026-09-03 실측으로 ②가 이 단계가 흔들리는 이유다(같은 프롬프트로
      // 한 번은 통과, 한 번은 "가져오지 못했습니다").
      note: q13 ? null : '질문 카드가 없다 — answer와 toolSteps를 함께 본다(못 봤나 / 툴이 실패했나 / 전달이 끊겼나)',
    });

  // ---------- (14) 사람이 권장 선택지를 고르고 [수정안 만들기] ----------
  const pick14 = await js(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    const card = cards[cards.length - 1];
    if (!card) return { ok: false, reason: 'no card' };
    const pick = Array.from(card.querySelectorAll('.backtest-visual-choice'))
      .filter((b) => Array.from(b.querySelectorAll('.routine-draft-pill')).some((p) => p.textContent === '권장'))[0];
    if (!pick) return { ok: false, reason: 'no recommended choice' };
    pick.click();
    return { ok: true };
  })()`);
  const click14 = pick14.ok ? await clickCardButton(shellWin, '수정안 만들기') : { clicked: false };
  const p14 = await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    if (!cards.length) return null;
    const card = cards[cards.length - 1];
    const pill = card.querySelector('.routine-draft-pill.is-filled');
    if (!pill || pill.textContent !== '그래프 + 코드 패치') return null;
    const c = window.AthenaBacktestCanvas.getContext();
    return {
      title: pill.textContent,
      diffRows: card.querySelectorAll('.backtest-diff-row').length,
      buttons: Array.from(card.querySelectorAll('button')).map((b) => b.textContent.trim()),
      pendingPatch: c.map.pendingPatch,
      state: c.map.validation_state,
    };
  })()`, 30000);
  record('14-권장 선택지 → [수정안 만들기] → 비활성 수정안 카드(모델 의존: 13의 카드가 있어야 눌린다)',
    !!pick14.ok && !!click14.clicked && !!p14 && p14.diffRows > 0
      && !!p14.pendingPatch && !!p14.pendingPatch.patch_id
      && p14.state === 'invalid',
    { modelDependent: true, pick: pick14, click: click14, patch: p14 });

  // ---------- (15) 사람이 [적용] — 저장까지, 실행·활성화는 없다 ----------
  // 이 시나리오의 머리 버전은 앞 턴들에서 **모델이 쓴 파이썬**이다(05~08). 그래서 첫
  // [적용]은 서버의 낙관적 동시성 검사에 정직하게 걸린다("base 코드가 그 사이 바뀌었다",
  // 409) — 실패가 아니라 [다시 검토]라는 다음 행동이고(US-010), 그 길을 사람이 눌러
  // 끝까지 간다. 그 길이 없으면 여기서 막다른 길이 된다.
  const click15 = p14 ? await clickCardButton(shellWin, '적용하고 시각 설계로 돌아가기') : { clicked: false };
  const conflict15 = click15.clicked ? await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    const card = cards[cards.length - 1];
    if (!card) return null;
    const pill = card.querySelector('.routine-draft-pill.is-filled');
    return (pill && pill.textContent === '다시 검토') ? { seen: true } : null;
  })()`, 20000) : null;
  if (conflict15) {
    await clickCardButton(shellWin, '다시 검토');
    // 다시 검토는 최신 base를 읽고 막고 있는 오류를 **다시 하나** 묻는다 — 사람이 다시
    // 고르고 다시 만든 뒤에야 [적용]이 선다.
    await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-visual');
      const card = cards[cards.length - 1];
      const pill = card && card.querySelector('.routine-draft-pill.is-filled');
      return (pill && pill.textContent === '한 가지만 확인할게요') ? true : null;
    })()`, 30000);
    await js(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-visual');
      const card = cards[cards.length - 1];
      if (!card) return false;
      const pick = Array.from(card.querySelectorAll('.backtest-visual-choice'))
        .filter((b) => Array.from(b.querySelectorAll('.routine-draft-pill')).some((p) => p.textContent === '권장'))[0];
      if (!pick) return false;
      pick.click();
      return true;
    })()`);
    await clickCardButton(shellWin, '수정안 만들기');
    await until(shellWin, `(() => {
      const cards = document.querySelectorAll('#history .backtest-visual');
      const card = cards[cards.length - 1];
      const pill = card && card.querySelector('.routine-draft-pill.is-filled');
      return (pill && pill.textContent === '그래프 + 코드 패치') ? true : null;
    })()`, 30000);
    await clickCardButton(shellWin, '적용하고 시각 설계로 돌아가기');
  }
  const s15 = click15.clicked ? await until(shellWin, `(() => {
    const cards = document.querySelectorAll('#history .backtest-visual');
    if (!cards.length) return null;
    const card = cards[cards.length - 1];
    const pills = Array.from(card.querySelectorAll('.routine-draft-pill')).map((p) => p.textContent.trim());
    if (pills[0] !== '동기화 완료') return null;
    const c = window.AthenaBacktestCanvas.getContext();
    return { pills, state: c.map.validation_state, designTab: c.designTab, pendingPatch: c.map.pendingPatch };
  })()`, 30000) : null;
  const c15 = await ctx(shellWin);
  record('15-[적용하고 시각 설계로 돌아가기] → 동기화 완료 카드(모델 의존)',
    !!click15.clicked && !!s15 && s15.state === 'synced' && s15.designTab === 'flow'
      && s15.pendingPatch === null,
    {
      modelDependent: true, click: click15, synced: s15,
      // 첫 [적용]이 409로 걸렸는가 — 걸렸다면 [다시 검토] 길을 실제로 걸어서 온 것이다.
      conflictThenRetry: !!conflict15,
      lastChange: c15 && c15.lastChange,
    });

  const okAll = report.steps.every((s) => s.ok);
  report.finishedAt = new Date().toISOString();
  const out = path.join(__dirname, '..', 'artifacts', 'backtest-tour', 'chat-scenario.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`[probe-bt-chat] ${okAll ? 'ALL OK' : 'FAIL'} (${report.steps.filter((s) => s.ok).length}/${report.steps.length}) → ${out}`);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 다음 실행은 새 디렉터리다 */ }
  app.exit(okAll ? 0 : 1);
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[probe-bt-chat] 프로브 자체 오류:', err);
  app.exit(1);
}));
