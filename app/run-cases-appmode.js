// 앱모드 검증 케이스 전용 드라이버 — run-cases-ui.js가 커버 못 하는 11건
// (LIV-089 · 091~100)을 **스크립트 조작**으로 실행한다.
//
// run-cases-ui.js와의 차이: 그건 "커맨드바에 질문을 치고 답변을 기다린다"가 전부다.
// 이 케이스들은 절차가 검증 대상이다 — Esc 타이밍, 설정 진입 부작용, 온보딩 상태
// 파일 손상, MCP 등록 시트의 위험 경고. 그래서 케이스마다 전용 절차 함수를 두고,
// 판정은 하지 않는다 — auto_checks에 대응하는 **관측값(observations)만** 남기고
// 채점은 별도 패스(평가-로드맵 §1)가 한다.
//
// 실행:
//   cd app && npx electron run-cases-appmode.js LIV-089 LIV-091 ... (일반 케이스 묶음)
//   cd app && npx electron run-cases-appmode.js LIV-095            (온보딩 케이스는 단독)
//
// 온보딩 3건(095~097)은 athena-onboarding.json을 부팅 **전에** 바꿔야 하므로
// 반드시 단독 호출이다 — 드라이버가 강제한다. 원본은 백업 후 종료 시 복원한다.
// ⚠ LIV-097은 '연결 해제'를 실제로 눌러 토큰을 해제한다 — 전체 QA의 맨 마지막에 돌릴 것.
//
// ⚠ 쿼터: 091(즉시 중단)은 소모가 거의 없고 092·093·094는 왕복 1회씩 쓴다.

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

app.setPath('userData', path.join(app.getPath('appData'), 'athena-shell'));

const REPO = path.join(__dirname, '..');
const DATASET = path.join(REPO, 'datasets', '앱-검증-200.jsonl');
const ATHENA_HOME = path.join(app.getPath('home'), '.athena');
const AUDIT_DIR = path.join(ATHENA_HOME, 'audit');
const CANVASES_DIR = path.join(ATHENA_HOME, 'canvases');

const ONBOARD_CASES = new Set(['LIV-095', 'LIV-096', 'LIV-097']);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 케이스 로더 · audit 스냅샷/델타 · 날짜 스탬프는 run-cases.js·run-cases-ui.js와
// 공용이다 — app/lib/main/eval-harness.js 참조.
const { loadCases, auditSnapshot, auditDelta, stampDir } = require('./lib/main/eval-harness');

function canvasFilesSnapshot() {
  if (!fs.existsSync(CANVASES_DIR)) return [];
  return fs.readdirSync(CANVASES_DIR);
}

// 이 세션의 Claude Code CLI도 claude.exe다 — 절대 수가 아니라 PID 집합의 차이만 본다.
function claudePids() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH', { encoding: 'utf8' });
    return out.split('\n').map((l) => {
      const m = l.match(/^"claude\.exe","(\d+)"/);
      return m ? Number(m[1]) : null;
    }).filter(Boolean);
  } catch { return []; }
}

async function shot(win, file) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return img.getSize();
}

// ---------- 렌더러 프로브 (run-cases-ui.js와 동일 기준) ----------
const CHAT_PROBE = `(() => {
  const dot = document.getElementById('dot');
  const cls = dot ? [...dot.classList] : [];
  const answers = document.querySelectorAll('.turn-a');
  const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
  return {
    answerCount: answers.length,
    lastAnswer: answers.length ? answers[answers.length - 1].textContent : null,
    turnQCount: document.querySelectorAll('.turn-q').length,
    dotClasses: cls,
    state: cls.includes('judging') ? 'judging' : (cls.includes('calling') ? 'calling' : 'idle'),
    panels: { app: vis('app'), onboard: vis('onboard'), settings: vis('settings') },
  };
})()`;

const CANVAS_COUNT_PROBE = "document.querySelectorAll('#grid > .card').length";

function typeAndEnter(win, text) {
  return win.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })();`);
}

function pressEsc(win) {
  return win.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
}

// 점은 더 이상 설정을 열지 않는다(보드 45 — 키우미 얼굴). 커맨드바("설정")는
// 진행 중엔 입력창이 잠겨 못 쓰니, 셸 버스의 등록 훅을 직접 부른다.
function openSettingsPanel(win) {
  return win.webContents.executeJavaScript('window.AthenaShell.openSettings()');
}

function clickNavItem(win, label) {
  return win.webContents.executeJavaScript(`(() => {
    const nav = document.getElementById('settingsNav');
    const items = nav ? Array.from(nav.querySelectorAll('.settings-nav-item')) : [];
    const btn = items.find((b) => { const l = b.querySelector('.settings-nav-label'); return l && l.textContent.trim() === ${JSON.stringify(label)}; });
    if (!btn) return 'NOT FOUND: ' + ${JSON.stringify(label)};
    btn.click();
    return 'clicked';
  })();`);
}

function clickByText(win, selector, text) {
  return win.webContents.executeJavaScript(`(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const el = els.find((e) => e.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return 'NOT FOUND: ' + ${JSON.stringify(text)};
    el.click();
    return 'clicked';
  })();`);
}

// MCP 시트 상태 덤프 — 채점이 스크린샷과 함께 읽는 원자료.
const MCP_SHEET_DUMP = `(() => {
  const sheet = document.querySelector('.card.mcp .uk-sheet');
  if (!sheet) return { present: false };
  const rows = Array.from(sheet.querySelectorAll('.uk-row')).map((r) => ({
    classes: [...r.classList],
    text: (r.textContent || '').slice(0, 160),
  }));
  return {
    present: true,
    text: (sheet.textContent || '').slice(0, 2500),
    warnboxes: Array.from(sheet.querySelectorAll('.uk-warnbox .uk-warnbox-body')).map((w) => w.textContent),
    buttons: Array.from(sheet.querySelectorAll('button')).map((b) => b.textContent.trim()),
    checks: Array.from(sheet.querySelectorAll('.uk-check')).map((c) => ({
      classes: [...c.classList], text: (c.parentElement ? c.parentElement.textContent : '').slice(0, 120),
    })),
    oversizedRows: sheet.querySelectorAll('.uk-row-oversized').length,
    rows,
  };
})()`;

const ONBOARD_DUMP = `(() => {
  const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
  const body = document.getElementById('onboardBody');
  return {
    panels: { app: vis('app'), onboard: vis('onboard'), settings: vis('settings') },
    bodyText: body ? (body.textContent || '').slice(0, 1200) : null,
    kicker: (document.querySelector('#onboard .kicker, #onboardBody .kicker') || {}).textContent || null,
    dots: document.querySelectorAll('#onboard .progress-dot, #onboardBody .progress-dot').length,
    clickableAccountRow: !!Array.from(document.querySelectorAll('#onboardBody .uk-row, #onboardBody [class*=row]'))
      .find((r) => /계좌/.test(r.textContent || '') && r.classList.contains('is-clickable')),
    switchNodes: document.querySelectorAll('.switch-list, .switch-row, [class*=switch-list], [class*=switch-row]').length,
    buttons: Array.from(document.querySelectorAll('#onboardBody button')).map((b) => b.textContent.trim()),
  };
})()`;

// ---------- 온보딩 상태 파일 ----------
function onboardingPath() { return path.join(app.getPath('userData'), 'athena-onboarding.json'); }

function backupOnboarding() {
  const p = onboardingPath();
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function restoreOnboarding(backup) {
  const p = onboardingPath();
  // 백업이 없었다면(신규 머신) 완료 상태로 복원한다 — QA 머신은 계좌 등록이 끝나 있다.
  fs.writeFileSync(p, backup !== null ? backup : JSON.stringify({ cliDone: true, accountDone: true }, null, 2), 'utf8');
}

// ---------- 케이스 절차 ----------
// 각 함수는 { observations, screenshots } 를 남긴다. 판정하지 않는다.

async function caseLIV089(ctx) {
  const { shellWin, evDir, question } = ctx;
  const auditBefore = auditSnapshot(AUDIT_DIR);
  const pre = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await typeAndEnter(shellWin, question);
  await wait(3000);
  const post = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await shot(shellWin, path.join(evDir, 'chat-after-enter.png'));
  const delta = auditDelta(AUDIT_DIR, auditBefore);
  // 정리 — 설정이 열렸으면 Esc로 닫는다.
  await pressEsc(shellWin);
  await wait(500);
  return {
    observations: {
      settings_visible_after_enter: post.panels.settings,
      app_hidden_after_enter: !post.panels.app,
      state_after_enter: post.state,
      new_turn_q: post.turnQCount - pre.turnQCount,
      new_answers: post.answerCount - pre.answerCount,
      upstream_audit_calls: delta.length,
      audit_delta: delta.map((r) => `${r.alias}__${r.tool}=${r.success}`),
    },
  };
}

async function caseLIV091(ctx) {
  const { shellWin, evDir, question } = ctx;
  const m = question.match(/'([^']+)'/);
  const query = m ? m[1] : '삼성전자 재무제표와 최근 공시를 한꺼번에 정리해 줘';
  const pidsBefore = claudePids();
  const pre = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await typeAndEnter(shellWin, query);
  await wait(700); // judging 진입 대기 — 카드가 뜨기 전이어야 한다
  const during = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await pressEsc(shellWin);
  await wait(3000); // killTree 정리 시간
  const post = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  const canvasVisible = ctx.mainMod.getWins().shellWin.isVisible();
  const cardCount = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
  const pidsAfter = claudePids();
  const newPidsRemaining = pidsAfter.filter((p) => !pidsBefore.includes(p));
  await shot(shellWin, path.join(evDir, 'chat-after-esc.png'));
  return {
    observations: {
      state_when_esc: during.state,
      state_after_esc: post.state,
      dot_classes_after_esc: post.dotClasses,
      canvas_visible_after_esc: canvasVisible,
      canvas_card_count: cardCount,
      new_answers: post.answerCount - pre.answerCount,
      claude_pids_before: pidsBefore.length,
      claude_new_pids_remaining: newPidsRemaining,
    },
  };
}

async function caseLIV092(ctx) {
  const { shellWin, evDir } = ctx;
  const query = '삼성전자 최근 공시 목록 정리해 줘';
  const pre = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await typeAndEnter(shellWin, query);
  // judging 진입을 기다린다
  let during = null;
  for (let i = 0; i < 40; i++) {
    during = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
    if (during.state !== 'idle') break;
    await wait(250);
  }
  await openSettingsPanel(shellWin); // 진행 중 설정 열기
  await wait(600);
  const withSettings = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await shot(shellWin, path.join(evDir, 'chat-settings-during-query.png'));
  await pressEsc(shellWin); // 첫 Esc — 설정만 닫혀야 한다
  await wait(600);
  const afterEsc = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await shot(shellWin, path.join(evDir, 'chat-after-first-esc.png'));
  // 질의가 계속 진행돼 답변이 달리는지 본다
  let final = afterEsc;
  const t0 = Date.now();
  while (Date.now() - t0 < 260000) {
    final = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
    if (final.answerCount > pre.answerCount && final.state === 'idle') break;
    await wait(500);
  }
  await shot(shellWin, path.join(evDir, 'chat-final.png'));
  await pressEsc(shellWin); // 캔버스 정리
  await wait(1500);
  return {
    observations: {
      state_when_dot_clicked: during ? during.state : null,
      settings_opened_during_query: withSettings.panels.settings,
      settings_closed_by_first_esc: !afterEsc.panels.settings,
      app_visible_after_first_esc: afterEsc.panels.app,
      query_state_after_first_esc: afterEsc.state,
      query_completed_with_answer: final.answerCount > pre.answerCount,
      final_state: final.state,
    },
  };
}

async function caseLIV093(ctx) {
  const { shellWin, evDir } = ctx;
  const query = '삼성전자 주요 재무 지표를 표로 정리해 줘';
  const canvasesBefore = canvasFilesSnapshot();
  const pre = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await typeAndEnter(shellWin, query);
  let post = pre;
  const t0 = Date.now();
  while (Date.now() - t0 < 260000) {
    post = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
    if (post.answerCount > pre.answerCount && post.state === 'idle') break;
    await wait(500);
  }
  await wait(1500);
  const cardsBeforeEsc = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
  await shot(shellWin, path.join(evDir, 'canvas-before-esc.png'));
  await pressEsc(shellWin); // idle 상태의 Esc — 캔버스 접기
  await wait(1500);
  const canvasVisible = ctx.mainMod.getWins().shellWin.isVisible();
  const cardsAfterEsc = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
  const newCanvasFiles = canvasFilesSnapshot().filter((f) => !canvasesBefore.includes(f));
  await shot(shellWin, path.join(evDir, 'chat-after-esc.png'));
  return {
    observations: {
      query_completed: post.answerCount > pre.answerCount,
      cards_before_esc: cardsBeforeEsc,
      canvas_visible_after_esc: canvasVisible,
      cards_in_grid_after_esc: cardsAfterEsc,
      new_canvas_files_saved: newCanvasFiles,
    },
  };
}

async function caseLIV094(ctx) {
  const { shellWin, evDir } = ctx;
  const query = '삼성전자 재무 하이라이트 표와 최근 공시 목록을 각각 카드로 보여줘';
  const pre = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  const preCards = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
  await typeAndEnter(shellWin, query);
  // 첫 카드가 뜨는 순간을 기다렸다가 즉시 Esc
  let firstCardMs = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 260000) {
    const n = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
    if (n > preCards) { firstCardMs = Date.now() - t0; break; }
    const st = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
    if (st.state === 'idle' && st.answerCount > pre.answerCount) break; // 카드 없이 끝남
    await wait(300);
  }
  const cardsAtAbort = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
  await pressEsc(shellWin); // 진행 중 Esc — 중단 분기
  await wait(3000);
  const post = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  const cardsAfter = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
  const canvasVisible = ctx.mainMod.getWins().shellWin.isVisible();
  await shot(shellWin, path.join(evDir, 'chat-after-abort.png'));
  await shot(shellWin, path.join(evDir, 'canvas-after-abort.png'));
  await pressEsc(shellWin); // 정리 — 캔버스 접기
  await wait(1500);
  return {
    observations: {
      first_card_ms: firstCardMs,
      cards_at_abort: cardsAtAbort,
      state_after_abort: post.state,
      new_answers_after_abort: post.answerCount - pre.answerCount,
      cards_after_abort: cardsAfter,
      canvas_visible_after_abort: canvasVisible,
    },
  };
}

async function caseLIV098(ctx) {
  const { shellWin, evDir, question, attachment } = ctx;
  // 실 레지스트리 보호 — 등록이 일어나므로 백업 후 복원한다.
  const regPath = path.join(ATHENA_HOME, 'mcp_servers.json');
  const consentPath = path.join(ATHENA_HOME, 'consent.json');
  const regBackup = fs.existsSync(regPath) ? fs.readFileSync(regPath, 'utf8') : null;
  const consentBackup = fs.existsSync(consentPath) ? fs.readFileSync(consentPath, 'utf8') : null;

  await openSettingsPanel(shellWin);
  await wait(600);
  await clickNavItem(shellWin, '플러그인');
  await wait(1500);
  const openSheet = await clickByText(shellWin, '.card.mcp button', '+ 서버 등록');
  await wait(400);
  await shellWin.webContents.executeJavaScript(`(() => {
    const ta = document.querySelector('.card.mcp .uk-sheet textarea');
    if (!ta) return 'NOT FOUND: textarea';
    ta.value = ${JSON.stringify(attachment)};
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'pasted';
  })();`);
  const analyze = await clickByText(shellWin, '.card.mcp .uk-sheet button', '분석');
  // 분석은 Python CLI 콜드 스폰(~850ms+)이다 — 고정 대기(800ms)로 캡처하면 스테이징
  // 결과가 아직 없다(2026-08-19 1차 실행에서 staged_warnboxes=[]로 실측). 폴링한다.
  let staged = null;
  for (let i = 0; i < 30; i++) {
    await wait(500);
    staged = await shellWin.webContents.executeJavaScript(MCP_SHEET_DUMP);
    if (staged.present && ((staged.warnboxes && staged.warnboxes.length) || /quote-fetcher/.test(staged.text || ''))) break;
  }
  await shot(shellWin, path.join(evDir, 'mcp-staged-risks.png'));
  // 등록을 진행해 승인 게이트까지 간다 — 게이트에서 '거부'로 멈춘다(스폰 없음 검증).
  let gate = null, gateShot = false;
  const proceed = await clickByText(shellWin, '.card.mcp .uk-sheet button', '승인');
  if (proceed === 'clicked') {
    await wait(800);
    gate = await shellWin.webContents.executeJavaScript(MCP_SHEET_DUMP);
    await shot(shellWin, path.join(evDir, 'mcp-approve-gate.png'));
    gateShot = true;
    await clickByText(shellWin, '.card.mcp .uk-sheet button', '거부');
    await wait(600);
  }
  // 시트 닫기(경고 바가 뜨면 강제 닫기)
  await clickByText(shellWin, '.card.mcp .uk-sheet-close', '닫기');
  await wait(300);
  await clickByText(shellWin, '.card.mcp .uk-close-warn button', '그냥 닫기');
  await wait(300);
  await pressEsc(shellWin);
  await wait(500);

  const logExists = fs.existsSync(path.join(ATHENA_HOME, 'logs', 'quote-fetcher.log'));
  // servers는 배열이 아니라 dict다({alias: {...}}) — 1차 실행에서 배열로 가정해
  // 관측이 깨졌다(웨이브 E 채점이 잡음). 승인 상태는 consent.json이 정본이다.
  let registryState = null;
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const present = !!(reg.servers && reg.servers['quote-fetcher']);
    let approved = null;
    try {
      const consent = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
      approved = !!(consent['quote-fetcher'] && consent['quote-fetcher'].approved);
    } catch { /* consent 없으면 미승인 */ }
    registryState = { present, approved };
  } catch { registryState = { unreadable: true }; }

  // 복원 — quote-fetcher가 실 레지스트리에 남지 않게 한다.
  if (regBackup !== null) fs.writeFileSync(regPath, regBackup, 'utf8');
  if (consentBackup !== null) fs.writeFileSync(consentPath, consentBackup, 'utf8');

  return {
    observations: {
      open_sheet: openSheet, analyze,
      staged_warnboxes: staged && staged.warnboxes,
      staged_text_head: staged && staged.text ? staged.text.slice(0, 600) : null,
      gate_reached: gateShot,
      gate_warnboxes: gate && gate.warnboxes,
      quote_fetcher_log_spawned: logExists,
      registry_state_before_restore: registryState,
      registry_restored: regBackup !== null,
    },
  };
}

async function caseLIV099(ctx) {
  const { shellWin, evDir } = ctx;
  const auditBefore = auditSnapshot(AUDIT_DIR);
  await openSettingsPanel(shellWin);
  await wait(600);
  await clickNavItem(shellWin, '플러그인');
  await wait(1500);
  const openRow = await shellWin.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('.card.mcp .uk-row.is-clickable'));
    const r = rows.find((row) => row.textContent.includes('korea-stock-mcp'));
    if (!r) return 'NOT FOUND: korea-stock-mcp row';
    r.click();
    return 'clicked';
  })();`);
  // probe는 실제 서버 스폰이다 — 툴 행이 그려질 때까지 기다린다(최대 30초)
  let sheet = null;
  for (let i = 0; i < 60; i++) {
    sheet = await shellWin.webContents.executeJavaScript(MCP_SHEET_DUMP);
    if (sheet.present && sheet.checks.length > 0) break;
    await wait(500);
  }
  await shot(shellWin, path.join(evDir, 'probe-initial.png'));
  const initial = sheet;
  // '오늘 날짜' 툴 체크 해제
  const toggleOff = await shellWin.webContents.executeJavaScript(`(() => {
    const cbs = Array.from(document.querySelectorAll('.card.mcp .uk-sheet .uk-check'));
    const t = cbs.find((c) => /오늘|today|date/i.test((c.parentElement ? c.parentElement.textContent : '')));
    if (!t) return 'NOT FOUND: today-date tool checkbox';
    if (!t.classList.contains('is-checked')) return 'ALREADY UNCHECKED';
    t.click();
    return 'unchecked';
  })();`);
  await wait(300);
  const commit1 = await clickByText(shellWin, '.card.mcp .uk-sheet button', '선택 허용');
  await wait(800);
  await shot(shellWin, path.join(evDir, 'probe-after-toggle-off.png'));
  // 시트를 닫고 다시 연다 — 미허용 유지 확인
  await clickByText(shellWin, '.card.mcp .uk-sheet-close', '닫기');
  await wait(300);
  await clickByText(shellWin, '.card.mcp .uk-close-warn button', '그냥 닫기');
  await wait(500);
  await shellWin.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('.card.mcp .uk-row.is-clickable'));
    const r = rows.find((row) => row.textContent.includes('korea-stock-mcp'));
    if (r) r.click();
    return 'reopened';
  })();`);
  let reopened = null;
  for (let i = 0; i < 60; i++) {
    reopened = await shellWin.webContents.executeJavaScript(MCP_SHEET_DUMP);
    if (reopened.present && reopened.checks.length > 0) break;
    await wait(500);
  }
  await shot(shellWin, path.join(evDir, 'probe-reopened.png'));
  // 원상 복구 — 다시 켜고 저장
  const toggleOn = await shellWin.webContents.executeJavaScript(`(() => {
    const cbs = Array.from(document.querySelectorAll('.card.mcp .uk-sheet .uk-check'));
    const t = cbs.find((c) => /오늘|today|date/i.test((c.parentElement ? c.parentElement.textContent : '')));
    if (!t) return 'NOT FOUND';
    if (t.classList.contains('is-checked')) return 'ALREADY CHECKED';
    t.click();
    return 'rechecked';
  })();`);
  await wait(300);
  const commit2 = await clickByText(shellWin, '.card.mcp .uk-sheet button', '선택 허용');
  await wait(800);
  const final = await shellWin.webContents.executeJavaScript(MCP_SHEET_DUMP);
  await shot(shellWin, path.join(evDir, 'probe-restored.png'));
  await clickByText(shellWin, '.card.mcp .uk-sheet-close', '닫기');
  await wait(300);
  await clickByText(shellWin, '.card.mcp .uk-close-warn button', '그냥 닫기');
  await wait(300);
  await pressEsc(shellWin);
  await wait(500);
  const delta = auditDelta(AUDIT_DIR, auditBefore);
  const checkedCount = (d) => d && d.checks ? d.checks.filter((c) => c.classes.includes('is-checked')).length : null;
  return {
    observations: {
      open_row: openRow,
      initial_tool_rows: initial ? initial.checks.length : 0,
      initial_oversized_rows: initial ? initial.oversizedRows : null,
      initial_checked: checkedCount(initial),
      toggle_off: toggleOff, commit_after_off: commit1,
      reopened_checked: checkedCount(reopened),
      reopened_today_unchecked: reopened ? reopened.checks.some((c) => /오늘|today|date/i.test(c.text) && !c.classes.includes('is-checked')) : null,
      toggle_on: toggleOn, commit_after_on: commit2,
      final_checked: checkedCount(final),
      audit_delta: delta.map((r) => `${r.alias}__${r.tool}=${r.success}`),
    },
  };
}

async function caseLIV100(ctx) {
  const { shellWin, evDir } = ctx;
  await openSettingsPanel(shellWin);
  await wait(600);
  await clickNavItem(shellWin, '플러그인');
  await wait(1500);
  const listDump = await shellWin.webContents.executeJavaScript(`(() => {
    return Array.from(document.querySelectorAll('.card.mcp .uk-row')).map((r) => ({
      classes: [...r.classList], text: (r.textContent || '').slice(0, 140),
    }));
  })();`);
  // 1차 실행의 함정: /naver-search(?!-2)/가 naver-search-2 행의 argsPreview
  // ('@isnow890/naver-search-mcp')에 부분매치해 엉뚱한 행을 눌렀다. 행 텍스트는
  // 별칭으로 시작하므로 시작 일치로 잡는다.
  const openRow = await shellWin.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('.card.mcp .uk-row'));
    const r = rows.find((row) => {
      const t = (row.textContent || '').trim();
      return t.startsWith('naver-search') && !t.startsWith('naver-search-2');
    });
    if (!r) return 'NOT FOUND: naver-search row';
    r.click();
    return 'clicked (clickable=' + r.classList.contains('is-clickable') + ')';
  })();`);
  // 미승인 probe 시트는 즉시 errorNote를 그리거나 승인 게이트 안내를 띄운다 — 폴링.
  let sheet = null;
  for (let i = 0; i < 20; i++) {
    await wait(500);
    sheet = await shellWin.webContents.executeJavaScript(MCP_SHEET_DUMP);
    if (sheet.present && sheet.text && !/실행 중/.test(sheet.text.slice(0, 200))) break;
  }
  await shot(shellWin, path.join(evDir, 'probe-unapproved.png'));
  // 승인 버튼은 누르지 않는다 — 케이스의 요지다. 시트만 닫는다.
  await clickByText(shellWin, '.card.mcp .uk-sheet-close', '닫기');
  await wait(300);
  await pressEsc(shellWin);
  await wait(500);
  // 위 caseLIV098과 동일 — servers는 dict, 승인은 consent.json이 정본.
  let approvedState = null;
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(ATHENA_HOME, 'mcp_servers.json'), 'utf8'));
    const present = !!(reg.servers && reg.servers['naver-search']);
    let approved = null;
    try {
      const consent = JSON.parse(fs.readFileSync(path.join(ATHENA_HOME, 'consent.json'), 'utf8'));
      approved = !!(consent['naver-search'] && consent['naver-search'].approved);
    } catch { /* consent 없으면 미승인 */ }
    approvedState = { present, approved };
  } catch { approvedState = { unreadable: true }; }
  return {
    observations: {
      open_row: openRow,
      server_rows: listDump,
      sheet_present: sheet.present,
      sheet_text_head: sheet.text ? sheet.text.slice(0, 800) : null,
      sheet_buttons: sheet.buttons,
      retry_after_approve_button: sheet.buttons ? sheet.buttons.some((b) => /서버 시작 승인/.test(b)) : false,
      naver_search_registry_state: approvedState,
    },
  };
}

// 온보딩 케이스 — 부팅 전 상태 조작이 필요해 단독 호출 전제.
async function caseLIV095(ctx) {
  const { shellWin, evDir } = ctx;
  await wait(1500); // 부팅 게이지 종료 대기
  let dump = null;
  for (let i = 0; i < 30; i++) {
    dump = await shellWin.webContents.executeJavaScript(ONBOARD_DUMP);
    if (dump.panels.onboard || dump.panels.app) break;
    await wait(300);
  }
  await shot(shellWin, path.join(evDir, 'onboard-after-corrupt.png'));
  return { observations: { dump } };
}

async function caseLIV096(ctx) {
  const { shellWin, evDir } = ctx;
  // 3/3 화면 렌더 + 토큰 상태 도달을 기다린다 — auto-continue(2.4s)보다 빨리 움직인다.
  let dump = null;
  for (let i = 0; i < 100; i++) {
    dump = await shellWin.webContents.executeJavaScript(ONBOARD_DUMP);
    if (dump.panels.onboard && /계좌/.test(dump.bodyText || '')) break;
    if (dump.panels.app) break; // 이미 자동 전환됨
    await wait(100);
  }
  await shot(shellWin, path.join(evDir, 'onboard-step3.png'));
  // 1차 실행에서 NOT FOUND — 행 컨테이너를 넓게 잡고, 못 찾으면 그 시점의
  // 후보 목록을 관측값으로 남긴다(auth-screen.js labeledRow('계좌', ...) 구조).
  const clickResult = await shellWin.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll(
      '#onboardBody .uk-row, #onboardBody [class*="row"], #onboardBody [class*="labeled"]'));
    const target = rows.find((n) => /계좌/.test(n.textContent || ''));
    if (!target) {
      return 'NOT FOUND: 계좌 행 | candidates=' + rows.slice(0, 8)
        .map((n) => [...n.classList].join('.') + ':' + (n.textContent || '').trim().slice(0, 30)).join(' || ');
    }
    target.click();
    return 'clicked (is-clickable=' + target.classList.contains('is-clickable') + ') text=' + (target.textContent || '').trim().slice(0, 60);
  })();`);
  await wait(800);
  const after = await shellWin.webContents.executeJavaScript(ONBOARD_DUMP);
  await shot(shellWin, path.join(evDir, 'onboard-after-account-click.png'));
  return { observations: { step3: dump, click_account_row: clickResult, after_click: after } };
}

async function caseLIV097(ctx) {
  const { shellWin, evDir } = ctx;
  // ready 상태의 '연결 해제' 버튼을 자동 전환(2.4s) 전에 누른다.
  let clicked = null, dump = null;
  for (let i = 0; i < 150; i++) {
    clicked = await shellWin.webContents.executeJavaScript(`(() => {
      const btns = Array.from(document.querySelectorAll('#onboardBody button'));
      const b = btns.find((x) => x.textContent.trim() === '연결 해제');
      if (!b) return null;
      b.click();
      return 'clicked';
    })();`);
    if (clicked === 'clicked') break;
    dump = await shellWin.webContents.executeJavaScript(ONBOARD_DUMP);
    if (dump.panels.app) break; // 이미 전환돼버림 — 그것도 기록
    await wait(100);
  }
  const clickAt = Date.now();
  await shot(shellWin, path.join(evDir, 'onboard-after-revoke-click.png'));
  await wait(2400); // auto_check가 지정한 시점
  const at24 = await shellWin.webContents.executeJavaScript(ONBOARD_DUMP);
  await shot(shellWin, path.join(evDir, 'onboard-at-2400ms.png'));
  await wait(2000);
  const later = await shellWin.webContents.executeJavaScript(ONBOARD_DUMP);
  return {
    observations: {
      revoke_clicked: clicked === 'clicked',
      pre_click_dump: dump,
      at_2400ms: at24,
      later,
      click_epoch_ms: clickAt,
    },
  };
}

// LIV-055 — LIV-091과 같은 중단 분기이되, ① 케이스 지정 질의 사용 ② abort 후
// 10초간 "뒤늦게 새 카드가 나타나는지"를 추가 관찰한다(must_not_include 검증).
async function caseLIV055(ctx) {
  const { shellWin, evDir } = ctx;
  const query = '기아 관련 최근 공시랑 뉴스를 각각 표랑 스트림 카드로 정리해줘';
  const pidsBefore = claudePids();
  const pre = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  const preCards = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
  await typeAndEnter(shellWin, query);
  await wait(700);
  const during = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await pressEsc(shellWin);
  await wait(1000);
  const post = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  await shot(shellWin, path.join(evDir, 'chat-after-esc.png'));
  // 늦은 카드 감시 — abort가 프로세스 트리를 정말 죽였다면 0이어야 한다.
  let lateCards = 0;
  for (let i = 0; i < 10; i++) {
    await wait(1000);
    const n = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
    if (n > preCards) lateCards = n - preCards;
  }
  const final = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
  const canvasVisible = ctx.mainMod.getWins().shellWin.isVisible();
  const pidsAfter = claudePids();
  return {
    observations: {
      state_when_esc: during.state,
      state_after_esc: post.state,
      dot_classes_after_esc: post.dotClasses,
      cards_before: preCards,
      late_cards_within_10s: lateCards,
      final_state: final.state,
      new_answers: final.answerCount - pre.answerCount,
      canvas_visible_after_esc: canvasVisible,
      claude_new_pids_remaining: pidsAfter.filter((p) => !pidsBefore.includes(p)),
    },
  };
}

const PROCEDURES = {
  'LIV-055': caseLIV055,
  'LIV-089': caseLIV089,
  'LIV-091': caseLIV091,
  'LIV-092': caseLIV092,
  'LIV-093': caseLIV093,
  'LIV-094': caseLIV094,
  'LIV-095': caseLIV095,
  'LIV-096': caseLIV096,
  'LIV-097': caseLIV097,
  'LIV-098': caseLIV098,
  'LIV-099': caseLIV099,
  'LIV-100': caseLIV100,
};

app.whenReady().then(async () => {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!ids.length) {
    process.stdout.write('USAGE: electron run-cases-appmode.js <CASE-ID> [CASE-ID...]\n');
    app.exit(2);
    return;
  }
  const onboardIds = ids.filter((id) => ONBOARD_CASES.has(id));
  if (onboardIds.length && ids.length > 1) {
    process.stdout.write('ONBOARD-SOLO 온보딩 케이스(095~097)는 단독 호출이어야 한다\n');
    app.exit(2);
    return;
  }

  const cases = loadCases(DATASET);

  // 온보딩 케이스는 부팅 전에 상태 파일을 조작한다.
  let onboardBackup = null;
  if (onboardIds.length === 1) {
    onboardBackup = backupOnboarding();
    const id = onboardIds[0];
    if (id === 'LIV-095') {
      fs.writeFileSync(onboardingPath(), '{{{corrupted-not-json', 'utf8');
    } else {
      fs.writeFileSync(onboardingPath(), JSON.stringify({ cliDone: true, accountDone: false }, null, 2), 'utf8');
    }
  }

  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  await wait(2000); // 부팅 전개

  const runDir = path.join(REPO, 'datasets', 'eval-runs', `${stampDir(new Date())}-intraday-ui`);
  fs.mkdirSync(runDir, { recursive: true });

  const index = [];
  for (const id of ids) {
    const c = cases.get(id);
    const proc = PROCEDURES[id];
    if (!c || !proc) { process.stdout.write(`SKIP ${id}\n`); continue; }
    const caseDir = path.join(runDir, id);
    const evDir = path.join(caseDir, 'evidence');
    fs.mkdirSync(evDir, { recursive: true });
    const startedAt = new Date();
    let result = null, error = null;
    try {
      result = await proc({ shellWin, mainMod, evDir, question: c.question, attachment: c.attachment || null });
    } catch (e) {
      error = String((e && e.stack) || e);
    }
    const elapsed = (Date.now() - startedAt.getTime()) / 1000;
    fs.writeFileSync(path.join(caseDir, 'raw-result.json'), JSON.stringify({
      case_id: id, tier: c.tier, persona: c.persona,
      question: c.question, attachment: c.attachment || null,
      harness: 'run-cases-appmode.js', procedure: true,
      ran_at: startedAt.toISOString(), duration_s: Number(elapsed.toFixed(1)),
      completed: !error, error,
      observations: result ? result.observations : null,
      judge: c.judge,
    }, null, 1), 'utf8');
    index.push({ id, completed: !error, duration_s: Number(elapsed.toFixed(1)) });
    process.stdout.write(`DONE ${id} completed=${!error} ${elapsed.toFixed(1)}s\n`);
  }

  // 온보딩 상태 복원 — 실행 중 advance가 실 파일을 덮었어도 원본으로 되돌린다.
  if (onboardIds.length === 1) restoreOnboarding(onboardBackup);

  // run-index 병합 (run-cases-ui.js와 같은 포맷)
  const idxPath = path.join(runDir, 'run-index.json');
  let prev = { runs: [], cases: [] };
  if (fs.existsSync(idxPath)) {
    try {
      const old = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      prev.cases = old.cases || []; prev.runs = old.runs || [];
    } catch { /* 새로 시작 */ }
  }
  prev.runs.push({ ran_at: new Date().toISOString(), harness: 'appmode', case_ids: index.map((c) => c.id) });
  prev.cases = prev.cases.filter((c) => !index.some((n) => n.id === c.id)).concat(index);
  fs.writeFileSync(idxPath, JSON.stringify(prev, null, 1), 'utf8');
  process.stdout.write(`WROTE ${runDir}\n`);
  app.exit(0);
});
