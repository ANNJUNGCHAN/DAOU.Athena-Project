// 검증 케이스 실행 하네스 (UI 경유) — **실제 두 창을 띄우고 커맨드바에 타이핑한다.**
//
// `run-cases.js`와의 차이: 그건 `runClaudeQuery`를 헤드리스로 불러 백엔드 왕복만 봤다.
// 이 스크립트는 `main.js`의 `createWindows()`로 진짜 대화 창·캔버스 창을 띄우고,
// `#input`에 질문을 넣어 Enter를 디스패치한 뒤, **대화 창에 답변이 렌더되고 캔버스 창에
// 카드가 그려지는 것을 DOM과 스크린샷으로 확인**한다. verify.js가 쓰는 것과 같은 방식이다.
//
// 왜 필요한가: 카드가 어떤 렌더러로 그려졌는지는 게이트웨이 봉투(envelope)가 아니라
// `canvas.js addLiveCard()`의 분기 결과다. 봉투가 table이어도 렌더 결과를 봐야 `.card.mcp-table`
// 인지 `.card.free`인지 확정된다. 헤드리스 실행은 이 구분을 할 수 없다.
//
// verify.js와 다른 점 두 가지 (의도적):
//   - `ATHENA_CANVAS_SOURCE`를 설정하지 않는다 → 실배선(live) 경로. verify.js는 fixture 고정.
//   - userData를 실제 프로필(athena-shell)로 쓴다 → 등록된 MCP·비밀값이 살아 있어야 한다.
//     verify.js는 `.verify-profile`을 쓴다.
//
// ⚠ **쿼터를 쓴다.** 케이스 1건당 `claude -p` 왕복 1회.
//
// 실행: cd app && npx electron run-cases-ui.js LIV-048 LIV-057
// 산출: datasets/eval-runs/<날짜>-intraday-ui/<case-id>/
//   evidence/chat-answer.txt · chat.png · canvas.png · ui-state.json · audit-delta.jsonl

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'athena-shell'));

const REPO = path.join(__dirname, '..');
const DATASET = path.join(REPO, 'datasets', '앱-검증-200.jsonl');
const AUDIT_DIR = path.join(app.getPath('home'), '.athena', 'audit');
const QUERY_TIMEOUT_MS = 260000; // 앱 자체 왕복 상한이 180s. 렌더까지 여유를 둔다.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCases() {
  const out = new Map();
  for (const line of fs.readFileSync(DATASET, 'utf8').split('\n')) {
    const t = line.trim();
    if (t) { const c = JSON.parse(t); out.set(c.id, c); }
  }
  return out;
}

function auditSnapshot() {
  const snap = {};
  if (!fs.existsSync(AUDIT_DIR)) return snap;
  for (const f of fs.readdirSync(AUDIT_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    snap[f] = fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8').split('\n').filter(Boolean).length;
  }
  return snap;
}

function auditDelta(before) {
  const rows = [];
  if (!fs.existsSync(AUDIT_DIR)) return rows;
  for (const f of fs.readdirSync(AUDIT_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const l of lines.slice(before[f] || 0)) {
      try { rows.push(JSON.parse(l)); } catch { rows.push({ raw: l }); }
    }
  }
  return rows;
}

// verify.js:104의 부팅 판정과 같은 기준 — #boot가 사라지고 #app 또는 #onboard가 보이면 완료.
async function waitForChatBooted(chatWin, timeoutMs = 15000) {
  const probe = `(() => {
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
    return { boot: vis('boot'), app: vis('app'), onboard: vis('onboard'), settings: vis('settings') };
  })()`;
  const t0 = Date.now();
  let panels = null;
  while (Date.now() - t0 < timeoutMs) {
    panels = await chatWin.webContents.executeJavaScript(probe);
    if (!panels.boot && (panels.app || panels.onboard)) break;
    await wait(100);
  }
  return { booted: !!panels && !panels.boot && (panels.app || panels.onboard), panels };
}

// 대화 창 상태 프로브. 3상태는 #dot의 클래스로 드러난다(judging/calling, 없으면 idle).
const CHAT_PROBE = `(() => {
  const dot = document.getElementById('dot');
  const cls = dot ? [...dot.classList] : [];
  const answers = document.querySelectorAll('.turn-a');
  const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
  return {
    answerCount: answers.length,
    lastAnswer: answers.length ? answers[answers.length - 1].textContent : null,
    chipCount: document.querySelectorAll('.chip').length,
    chipLabels: [...document.querySelectorAll('.chip')].map((c) => c.textContent),
    dotClasses: cls,
    state: cls.includes('judging') ? 'judging' : (cls.includes('calling') ? 'calling' : 'idle'),
    panels: { app: vis('app'), onboard: vis('onboard'), settings: vis('settings') },
  };
})()`;

// 캔버스 창 프로브. **카드 타입은 렌더 결과의 클래스로만 확정된다** — `.card.mcp-table` /
// `.card.stream` / `.card.reader` / `.card.free` / `.card.notice` (canvas.js makeCard).
const CANVAS_PROBE = `(() => {
  const cards = [...document.querySelectorAll('#grid > .card')].map((c) => ({
    classes: [...c.classList].filter((x) => x !== 'card'),
    tableRows: c.querySelectorAll('table.fin-table tbody tr').length,
    tableCols: c.querySelectorAll('table.fin-table thead th').length,
    streamItems: c.querySelectorAll('ul.stream-list li.stream-item').length,
    hasAlert: !!c.querySelector('[role="alert"]'),
    freeTree: !!c.querySelector('.free-tree-list, .free-tree-dl, .free-tree-scalar'),
    text: (c.textContent || '').slice(0, 300),
  }));
  const mosaic = document.getElementById('mosaic');
  return {
    cardCount: cards.length,
    cards,
    clipPath: mosaic ? (mosaic.style.clipPath || null) : null,
  };
})()`;

async function shot(win, file) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return img.getSize();
}

function stampDir(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

app.whenReady().then(async () => {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!ids.length) {
    process.stdout.write('USAGE: electron run-cases-ui.js <CASE-ID> [CASE-ID...]\n');
    app.exit(2);
    return;
  }

  const cases = loadCases();
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { chatWin, canvasWin } = mainMod.getWins();

  const boot = await waitForChatBooted(chatWin);
  const runDir = path.join(REPO, 'datasets', 'eval-runs', `${stampDir(new Date())}-intraday-ui`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'boot.json'), JSON.stringify(boot, null, 1), 'utf8');
  if (!boot.booted) {
    process.stdout.write(`BOOT-FAIL ${JSON.stringify(boot.panels)}\n`);
    app.exit(3);
    return;
  }
  // 온보딩이 떠 있으면 커맨드바가 없다 — 계좌 미등록 머신에서 그대로 진행하면
  // 숨은 DOM에 이벤트를 쏘게 된다(README "검증이 스스로를 속인 결함").
  if (boot.panels.onboard) {
    process.stdout.write('ONBOARD-BLOCKED 온보딩이 떠 있어 커맨드바에 입력할 수 없다\n');
    app.exit(4);
    return;
  }

  const index = [];
  for (const id of ids) {
    const c = cases.get(id);
    if (!c) { process.stdout.write(`SKIP ${id}\n`); continue; }

    const userText = c.attachment ? `${c.question}\n\n${c.attachment}` : c.question;
    const caseDir = path.join(runDir, id);
    const evDir = path.join(caseDir, 'evidence');
    fs.mkdirSync(evDir, { recursive: true });

    const auditBefore = auditSnapshot();
    const pre = await chatWin.webContents.executeJavaScript(CHAT_PROBE);
    const startedAt = new Date();

    // 커맨드바에 실제로 타이핑하고 Enter — verify.js:278과 같은 경로.
    await chatWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      input.value = ${JSON.stringify(userText)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();`);

    // 상태 전이를 관찰하며 완료를 기다린다. 완료 판정은 두 조건의 AND —
    // 답변 turn이 늘었고, 3상태가 idle로 돌아왔다.
    const seenStates = [];
    let post = null;
    const t0 = Date.now();
    while (Date.now() - t0 < QUERY_TIMEOUT_MS) {
      post = await chatWin.webContents.executeJavaScript(CHAT_PROBE);
      if (!seenStates.length || seenStates[seenStates.length - 1] !== post.state) {
        seenStates.push(post.state);
      }
      if (post.answerCount > pre.answerCount && post.state === 'idle') break;
      await wait(500);
    }
    const elapsed = (Date.now() - startedAt.getTime()) / 1000;
    const completed = !!post && post.answerCount > pre.answerCount;

    // 카드가 그려질 시간을 조금 더 준다(마지막 카드 IPC가 답변 직후 도착할 수 있다).
    await wait(1500);
    const canvasState = await canvasWin.webContents.executeJavaScript(CANVAS_PROBE);
    const delta = auditDelta(auditBefore);

    const chatSize = await shot(chatWin, path.join(evDir, 'chat.png'));
    const canvasSize = await shot(canvasWin, path.join(evDir, 'canvas.png'));

    fs.writeFileSync(path.join(evDir, 'chat-answer.txt'), String((post && post.lastAnswer) || ''), 'utf8');
    fs.writeFileSync(path.join(evDir, 'ui-state.json'), JSON.stringify({
      chat: post, canvas: canvasState, stateTransitions: seenStates,
      screenshots: { chat: chatSize, canvas: canvasSize },
    }, null, 1), 'utf8');
    fs.writeFileSync(path.join(evDir, 'audit-delta.jsonl'),
      delta.map((r) => JSON.stringify(r)).join('\n') + (delta.length ? '\n' : ''), 'utf8');

    const cardTypes = canvasState.cards.map((x) => x.classes.join('.'));
    fs.writeFileSync(path.join(caseDir, 'raw-result.json'), JSON.stringify({
      case_id: id, tier: c.tier, persona: c.persona,
      question: c.question, attachment: c.attachment || null, sent_text: userText,
      ran_at: startedAt.toISOString(), duration_s: Number(elapsed.toFixed(1)),
      completed, timed_out: !completed,
      answer_chars: ((post && post.lastAnswer) || '').length,
      // 칩은 대화 이력이라 케이스가 쌓일수록 누적된다 — 이 케이스가 만든 칩만 보려면
      // 실행 전후 차이를 봐야 한다(첫 배치에서 1→2→3→4로 누적되는 걸 보고 고쳤다).
      chip_count_total: post ? post.chipCount : null,
      chip_count_added: post && pre ? post.chipCount - pre.chipCount : null,
      chip_labels_added: post && pre ? post.chipLabels.slice(pre.chipCount) : null,
      chip_labels_total: post ? post.chipLabels : null,
      state_transitions: seenStates,
      card_types_rendered: cardTypes,
      canvas_card_count: canvasState.cardCount,
      audit_calls: delta.map((r) => `${r.alias}__${r.tool}=${r.success}`),
      judge: c.judge,
    }, null, 1), 'utf8');

    const chipsAdded = post && pre ? post.chipCount - pre.chipCount : null;
    index.push({ id, completed, duration_s: Number(elapsed.toFixed(1)),
      cards: cardTypes, chips_added: chipsAdded });
    process.stdout.write(`DONE ${id} completed=${completed} ${elapsed.toFixed(1)}s cards=[${cardTypes.join(', ')}] chips+${chipsAdded} states=${seenStates.join('>')}\n`);

    // 다음 케이스를 위한 상태 리셋 — Esc로 캔버스를 접는다(idle에서의 Esc 분기).
    await chatWin.webContents.executeJavaScript(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await wait(2000);
  }

  fs.writeFileSync(path.join(runDir, 'run-index.json'),
    JSON.stringify({ ran_at: new Date().toISOString(), boot, cases: index }, null, 1), 'utf8');
  process.stdout.write(`WROTE ${runDir}\n`);
  app.exit(0);
});
