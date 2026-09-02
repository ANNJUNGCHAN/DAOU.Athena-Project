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

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-bt-chat-'));
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
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
  const presets = await until(shellWin, "document.querySelectorAll('#backtestCanvas .backtest-preset-item').length", 20000);
  const head = await js(shellWin, "(() => { const h = document.getElementById('chatModeHead'); return h && !h.hidden ? h.textContent.replace(/\\s+/g, ' ') : null; })()");
  record('01-백테스트 모드 진입 + 채팅 헤더', presets === 10 && !!head && head.includes('전략에게 묻기'), { presets, head });

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
  const tileMdd = r3 && r3.values.find((v) => v.label === 'MDD');
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
    if (c.view === 'diagnosis' || (c.lastResult && c.lastResult.status === 'failed')) {
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
  const fixed = !!(c8 && c8.code && !c8.code.source.includes('periodd') && /p\[(['"])period\]/.test(c8.code.source));
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
