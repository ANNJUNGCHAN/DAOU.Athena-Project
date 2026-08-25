
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

// 케이스 로더 · audit 스냅샷/델타 · 날짜 스탬프는 run-cases.js·run-cases-appmode.js와
// 공용이다 — app/lib/main/eval-harness.js 참조.
const { loadCases, auditSnapshot, auditDelta, stampDir } = require('./lib/main/eval-harness');

// verify.js:104의 부팅 판정과 같은 기준 — #boot가 사라지고 #app 또는 #onboard가 보이면 완료.
async function waitForChatBooted(shellWin, timeoutMs = 15000) {
  const probe = `(() => {
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden; };
    return { boot: vis('boot'), app: vis('app'), onboard: vis('onboard'), settings: vis('settings') };
  })()`;
  const t0 = Date.now();
  let panels = null;
  while (Date.now() - t0 < timeoutMs) {
    panels = await shellWin.webContents.executeJavaScript(probe);
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

// capturePage가 영영 안 돌아오는 행이 실측됐다(2026-08-19 LIV-047 — GPU 캐시
// 실패 상태에서 canvas 캡처 중 프로세스 사망, 배치 전체 정지). 캡처 실패가
// 배치를 죽이면 안 된다 — 타임아웃과 예외를 값으로 돌린다.
async function shot(win, file, timeoutMs = 15000) {
  try {
    const img = await Promise.race([
      win.webContents.capturePage(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('capture timeout')), timeoutMs)),
    ]);
    fs.writeFileSync(file, img.toPNG());
    return img.getSize();
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

// 배치를 나눠 여러 번 호출해도 run-index.json이 누적되게 병합한다 — 이전에는
// 마지막 호출이 덮어써서 앞 배치 기록이 사라졌다(100건 배치 실행에서 발견).
function mergeRunIndex(runDir, boot, newCases) {
  const p = path.join(runDir, 'run-index.json');
  let prev = { runs: [], cases: [] };
  if (fs.existsSync(p)) {
    try {
      const old = JSON.parse(fs.readFileSync(p, 'utf8'));
      prev.cases = old.cases || [];
      prev.runs = old.runs || (old.ran_at ? [{ ran_at: old.ran_at, boot: old.boot }] : []);
    } catch { /* 손상된 인덱스는 새로 시작 */ }
  }
  prev.runs.push({ ran_at: new Date().toISOString(), boot, case_ids: newCases.map((c) => c.id) });
  prev.cases = prev.cases.filter((c) => !newCases.some((n) => n.id === c.id)).concat(newCases);
  fs.writeFileSync(p, JSON.stringify(prev, null, 1), 'utf8');
}

// 가벼운 캔버스 카드 수 프로브 — 대기 루프에서 매 회 돌므로 CANVAS_PROBE 전체를
// 돌리지 않는다. 첫 카드 도달 시각(first_card_ms) 계측용.
const CANVAS_COUNT_PROBE = "document.querySelectorAll('#grid > .card').length";

app.whenReady().then(async () => {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!ids.length) {
    process.stdout.write('USAGE: electron run-cases-ui.js <CASE-ID> [CASE-ID...]\n');
    app.exit(2);
    return;
  }

  const cases = loadCases(DATASET);
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();

  const boot = await waitForChatBooted(shellWin);
  // ATHENA_RUN_SUFFIX: 수정 검증 런을 기준선 런과 분리한다(예: '-fixcheck').
  // 없으면 기존 이름 그대로 — 기준선 디렉토리를 덮어쓰는 사고를 막는 장치다.
  const runDir = path.join(REPO, 'datasets', 'eval-runs',
    `${stampDir(new Date())}-intraday-ui${process.env.ATHENA_RUN_SUFFIX || ''}`);
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
    // 창이 죽었으면 이 인보케이션은 회복 불능이다 — 부분 기록을 남기고 즉시
    // 나가서 다음 배치 인보케이션(새 앱 인스턴스)이 이어가게 한다.
    if (shellWin.isDestroyed() || shellWin.webContents.isDestroyed()
      || shellWin.isDestroyed() || shellWin.webContents.isDestroyed()) {
      process.stdout.write(`WINDOW-DEAD before ${id} — 배치 중단\n`);
      mergeRunIndex(runDir, boot, index);
      app.exit(5);
      return;
    }
    const userText = c.attachment ? `${c.question}\n\n${c.attachment}` : c.question;
    const caseDir = path.join(runDir, id);
    const evDir = path.join(caseDir, 'evidence');
    fs.mkdirSync(evDir, { recursive: true });
    const startedAt = new Date();
    try {

    const auditBefore = auditSnapshot(AUDIT_DIR);
    const pre = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
    // Esc 접기가 grid를 비우므로 보통 0이지만, 접기 실패로 잔류 카드가 있으면
    // 이 값 이후의 카드만 이 케이스 것으로 귀속한다.
    const preCanvasCount = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);

    // 커맨드바에 실제로 타이핑하고 Enter — verify.js:278과 같은 경로.
    await shellWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      input.value = ${JSON.stringify(userText)};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();`);

    // 상태 전이를 관찰하며 완료를 기다린다. 완료 판정은 두 조건의 AND —
    // 답변 turn이 늘었고, 3상태가 idle로 돌아왔다. 전이·첫 카드에 타임스탬프를
    // 남긴다(지연 분석용 — 어디서 시간이 갔는지는 이 계측 없이는 알 수 없다).
    const seenStates = [];
    let post = null;
    let firstCardMs = null;
    const t0 = Date.now();
    while (Date.now() - t0 < QUERY_TIMEOUT_MS) {
      post = await shellWin.webContents.executeJavaScript(CHAT_PROBE);
      if (!seenStates.length || seenStates[seenStates.length - 1].state !== post.state) {
        seenStates.push({ state: post.state, at_ms: Date.now() - t0 });
      }
      if (firstCardMs === null) {
        const n = await shellWin.webContents.executeJavaScript(CANVAS_COUNT_PROBE);
        if (n > preCanvasCount) firstCardMs = Date.now() - t0;
      }
      if (post.answerCount > pre.answerCount && post.state === 'idle') break;
      await wait(500);
    }
    const elapsed = (Date.now() - startedAt.getTime()) / 1000;
    const completed = !!post && post.answerCount > pre.answerCount;

    // 카드가 그려질 시간을 조금 더 준다(마지막 카드 IPC가 답변 직후 도착할 수 있다).
    await wait(1500);
    const canvasState = await shellWin.webContents.executeJavaScript(CANVAS_PROBE);
    const delta = auditDelta(AUDIT_DIR, auditBefore);

    const chatSize = await shot(shellWin, path.join(evDir, 'chat.png'));
    const canvasSize = await shot(shellWin, path.join(evDir, 'canvas.png'));

    fs.writeFileSync(path.join(evDir, 'chat-answer.txt'), String((post && post.lastAnswer) || ''), 'utf8');
    fs.writeFileSync(path.join(evDir, 'ui-state.json'), JSON.stringify({
      chat: post, canvas: canvasState, stateTransitions: seenStates,
      screenshots: { chat: chatSize, canvas: canvasSize },
    }, null, 1), 'utf8');
    fs.writeFileSync(path.join(evDir, 'audit-delta.jsonl'),
      delta.map((r) => JSON.stringify(r)).join('\n') + (delta.length ? '\n' : ''), 'utf8');

    // 잔류 카드 보호 — preCanvasCount 이후의 카드만 이 케이스 것으로 귀속한다.
    const cardTypes = canvasState.cards.slice(preCanvasCount).map((x) => x.classes.join('.'));
    fs.writeFileSync(path.join(caseDir, 'raw-result.json'), JSON.stringify({
      case_id: id, tier: c.tier, persona: c.persona,
      question: c.question, attachment: c.attachment || null, sent_text: userText,
      ran_at: startedAt.toISOString(), duration_s: Number(elapsed.toFixed(1)),
      first_card_ms: firstCardMs,
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
      canvas_cards_pre: preCanvasCount,
      audit_calls: delta.map((r) => `${r.alias}__${r.tool}=${r.success}`),
      judge: c.judge,
    }, null, 1), 'utf8');

    const chipsAdded = post && pre ? post.chipCount - pre.chipCount : null;
    index.push({ id, completed, duration_s: Number(elapsed.toFixed(1)),
      first_card_ms: firstCardMs, cards: cardTypes, chips_added: chipsAdded });
    process.stdout.write(`DONE ${id} completed=${completed} ${elapsed.toFixed(1)}s firstCard=${firstCardMs === null ? '-' : (firstCardMs / 1000).toFixed(1) + 's'} cards=[${cardTypes.join(', ')}] chips+${chipsAdded} states=${seenStates.map((s) => s.state).join('>')}\n`);

    // 다음 케이스를 위한 상태 리셋 — Esc로 캔버스를 접는다(idle에서의 Esc 분기).
    await shellWin.webContents.executeJavaScript(
      "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await wait(2000);
    } catch (e) {
      // 케이스 하나의 실패(캡처 행·렌더러 사망 등)가 배치 전체를 죽이면 안 된다.
      const msg = String((e && e.stack) || e);
      try {
        fs.writeFileSync(path.join(caseDir, 'raw-result.json'), JSON.stringify({
          case_id: id, tier: c.tier, persona: c.persona, question: c.question,
          ran_at: startedAt.toISOString(),
          completed: false, harness_error: msg, judge: c.judge,
        }, null, 1), 'utf8');
      } catch { /* 디스크 실패까지 겹친 경우 — 콘솔 기록만 남는다 */ }
      index.push({ id, completed: false, harness_error: msg.slice(0, 200) });
      process.stdout.write(`ERROR ${id} ${msg.slice(0, 160)}\n`);
    }
  }

  mergeRunIndex(runDir, boot, index);

  // 평가-로드맵 §2 — 실행 환경 기록. 배치 첫 호출에서만 쓴다.
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    let commit = null;
    try {
      commit = require('child_process')
        .execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
    } catch { /* git 없이도 실행은 성립한다 */ }
    let modelPrefs = null;
    try {
      modelPrefs = JSON.parse(fs.readFileSync(
        path.join(app.getPath('userData'), 'athena-model.json'), 'utf8'));
    } catch { /* 기본 모델 */ }
    fs.writeFileSync(manifestPath, JSON.stringify({
      commit, model_prefs: modelPrefs,
      dataset: path.basename(DATASET),
      started_at: new Date().toISOString(),
      harness: 'run-cases-ui.js',
    }, null, 1), 'utf8');
  }
  process.stdout.write(`WROTE ${runDir}\n`);
  app.exit(0);
});
