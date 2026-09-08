'use strict';

// 카드 템플릿 96장 런타임 마운트 게이트 — `verify:paper-cards-mount` (설계서 §3.3~§3.5).
//
// 정적 게이트(`verify:paper-cards-static`)가 「Paper 원장과 저장소 템플릿이 같은
// 카드를 말하는가」를 재고, 이 프로브는 그 다음 구간을 잰다: **그 템플릿이 실앱
// 셸에서 실제로 서는가.** 보드마다 네 폭에서 셋만 본다.
//
//   (a) 마운트 성공        — 봉투 영수증 · 탭 활성화 · `.board-surface` 실재
//   (d) 4단 폭 overflow 0  — assertSurfaceGeometry (가로 1px 초과는 하드 실패)
//   (C) 텍스트 다중집합    — DOM 텍스트 == slots.json `text_multiset`
//   (c') 상태 링크         — `data-state-board`가 DOM에 실제로 찍혔는가
//
// 안 재는 것: 글리프 가독성(assertReadability)·PNG·breakpoint 5단 계약·실시간
// 이음매. 전부 6장 정본 게이트(`verify:integrated-cards`)와 `fixture-quote`의
// 몫이다 — 96장에 걸면 판정이 「구현됐나」에서 「예쁜가」로 미끄러지고 실행이
// 10분대로 부푼다(설계서 §3.3).
//
// 루프는 뒤집혀 있다(설계서 §3.4). 창 리사이즈는 비동기라 `settleBoardLayout`이
// 4샘플 안정을 기다리는데, 보드마다 4번 리사이즈하면 96장에 384회다. 그래서
// **카드 청크마다 폭을 바깥 루프로** 돌려 리사이즈를 카드당 4회로 줄인다.
// 청크로 끊는 이유는 따로 있다 — 96장을 한꺼번에 세우면 DOM이 3만 노드가 된다.
//
// 실패 보드는 고치지 않는다. `app/captures/paper-gates/PAPER-CARDS.json`의
// `boards[]`에 `layer: "mount"` 실패로 남기는 것이 이 게이트의 산출물이다 — 정적 층과
// 같은 배열, 같은 항목이다(설계서 §3.7 형상, §6.4가 그 목록을 작업 명세로 바꾼다).
//
// 샤딩·파일럿: `ATHENA_VERIFY_BOARD_IDS=2SKU-1,137X-2,...`
// 성공 표지: paper cards mount verification passed

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { publicPolicies } = require('./lib/main/integrated-card-realtime');
const {
  BOARD_WINDOW_PRESETS,
  activateBoardTab,
  assertSurfaceGeometry,
  boardStepProbe,
  inspectBoardChrome,
  loadRealBoardContract,
  sendBoardEnvelope,
  settleBoardLayout,
} = require('./lib/board-probe');
const { resolveBoardSelection } = require('./lib/integrated-card-capture-hygiene');
const {
  boardMountRecord,
  formatMountCliReport,
  groupBoardsByCard,
  mountFailures,
  uniqueStateControls,
} = require('./lib/paper-cards-mount-report');
const { mergeMountLayer } = require('./lib/paper-cards-report');
const boardRegistry = require('./lib/board-template-registry');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const TEMPLATE_ROOT = path.join(ROOT, 'backend', 'ref', 'card-surface-templates');
const CARD_INDEX = path.join(TEMPLATE_ROOT, 'index.json');
const REPORT_PATH = path.join(APP, 'captures', 'paper-gates', 'PAPER-CARDS.json');

// 검증 전용 프로필 — 이 머신의 개인 상태(계좌·온보딩·비밀값)에 기대지 않는다.
const PROFILE = path.join(APP, '.probe-paper-cards-mount-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();

const CARD_BOARDS = JSON.parse(fs.readFileSync(CARD_INDEX, 'utf8')).boards;
const CARD_ID_OF = new Map(CARD_BOARDS.map((board) => [board.board_id, board.card_id]));
const BOARD_NAME_OF = new Map(CARD_BOARDS.map((board) => [board.board_id, board.name]));

// 셸이 부팅하고 보드가 서는 데 필요한 IPC만 답한다. 백엔드는 띄우지 않는다 —
// 이 게이트는 봉투가 나르는 Paper 원문만 보고, 실시간 등록은 재지 않는다
// (실시간 이음매는 fixture-quote가 계속 맡는다, 설계서 §3.3).
function registerShellIpc() {
  const source = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
  const block = source.split('const INVOKE_CHANNELS = new Set([')[1]?.split(']);')[0];
  // 상수명이나 형식이 바뀌면 채널 0개짜리 셸로 조용히 넘어가지 않게 여기서 멈춘다.
  if (!block) throw new Error('preload.js에서 INVOKE_CHANNELS 블록을 못 찾았다');
  for (const channel of [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])) {
    ipcMain.handle(channel, async () => {
      if (channel === 'athena:integrated-card-realtime-policy') return publicPolicies();
      // 등록 자체를 재지 않으므로 성공 상태만 돌려준다. 실패를 돌려주면 카드에
      // 실시간 오류 배너가 붙어 보드 밖 DOM이 흔들린다.
      if (channel.startsWith('athena:integrated-card-realtime-')) {
        return { ok: true, status: 'active', bindings: [], generation: 1, connectionGeneration: 1 };
      }
      if (channel === 'athena:boot-readiness:get') {
        return {
          runId: 'paper-cards-mount', revision: 1, phase: 'ready',
          tasks: [{
            id: 'probe-readiness', label: '보드 마운트 검수 준비', kind: 'gate',
            state: 'succeeded', attempt: 1, retryable: false, detail: '완료',
          }],
        };
      }
      if (channel === 'athena:onboarding-state') return { needed: false, step: 3 };
      if (channel.endsWith('-list') || channel.endsWith('conversations-list')) return [];
      if (channel.includes('prefs:get')) return {};
      return null;
    });
  }
}

async function bootShell() {
  const win = new BrowserWindow({
    width: 1800,
    height: 1200,
    show: false,
    backgroundColor: '#EEF1F6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(APP, 'preload.js'),
    },
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  await win.loadFile(path.join(APP, 'shell.html'));
  win.show();
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const boot = document.getElementById('boot');
      const shell = document.getElementById('shell');
      if (boot.dataset.phase === 'complete' && boot.hidden && !shell.hidden
        && !shell.classList.contains('is-onboarding-hidden')) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error('셸 부팅이 complete에 못 닿았다'));
      requestAnimationFrame(check);
    };
    check();
  })`);
  return win;
}

// slots.json의 텍스트 다중집합. 없으면 던진다 — `{}`로 넘어가면 DOM 텍스트가 전부
// added로 잡혀 `text_multiset_dom_mismatch`로 빨개지고, 진짜 원인(「템플릿에 다중집합이
// 없다」)이 리포트에서 안 읽힌다.
function readTextMultiset(boardId) {
  const slotsPath = path.join(TEMPLATE_ROOT, boardId, 'slots.json');
  const { text_multiset: multiset } = JSON.parse(fs.readFileSync(slotsPath, 'utf8'));
  if (!multiset) throw new Error(`slots.json에 text_multiset이 없다: ${boardId}`);
  // 마운트 계약이 `static: "blank"`로 표시한 자리는 화면에서 빈 칸이다(생성기
  // `_static_mode`: 응답에 없는 수치라 Paper 목업 숫자를 그대로 둘 수 없다). 화면에
  // 없는 글자는 기대 다중집합에서도 빠져야 한다 — 판정은 계약 하나에서만 읽는다.
  const contract = boardRegistry.contractFor(boardId);
  const expected = { ...multiset };
  for (const slot of (contract && contract.slots) || []) {
    if (slot.static !== 'blank') continue;
    const text = typeof slot.paper_text === 'string' ? slot.paper_text.trim() : '';
    if (!text || !(text in expected)) continue;
    expected[text] -= 1;
    if (expected[text] <= 0) delete expected[text];
  }
  return expected;
}

// `boardStepProbe`가 안 재는 둘을 한 번에 더 잰다.
//
//   state_boards_in_dom — 상태 링크는 마운트 뒤 DOM에 `data-state-board`로 찍힌다
//     (canvas.js wireStateControls). 슬롯이 든 링크 수와 맞대면 「Paper가 이 글자를
//     다른 보드로 가는 문이라고 했는데 화면에서는 문이 아니다」를 잡는다.
//   dom_text_primary — 병기 줄(`.bs-paired`)을 뺀 텍스트 다중집합. 병기 줄은 Paper
//     노드가 아니라 접힘의 착지점이고, 같은 노드 id가 셀과 병기 줄 두 곳에 적혀 있어
//     (13BC-2 실측) 그대로 세면 표 있는 보드가 전부 「개수 2배」로 빨개진다.
async function measureSurfaceExtras(win, instanceId) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    const surface = root && root.querySelector('.board-surface');
    if (!surface) return { state_boards_in_dom: 0, dom_text_primary: [] };
    const texts = new Map();
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      if (node.parentElement && node.parentElement.closest('.bs-paired')) continue;
      texts.set(text, (texts.get(text) || 0) + 1);
    }
    return {
      state_boards_in_dom: surface.querySelectorAll('[data-state-board]').length,
      dom_text_primary: [...texts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    };
  })()`);
}

// 청크 하나(카드 1종)를 세우고 네 폭에서 잰다. 폭이 바깥 루프라 창 리사이즈는
// 청크당 4회고, 봉투는 첫 폭에서만 보낸다(설계서 §3.4).
async function probeChunk(win, chunk) {
  const collected = new Map(chunk.board_ids.map((boardId) => [boardId, { steps: [], failures: [] }]));
  const surfaces = [];
  for (const [index, boardId] of chunk.board_ids.entries()) {
    try {
      surfaces.push({
        ...loadRealBoardContract(boardId, (index % 6) + 1, TEMPLATE_ROOT),
        expectedTextMultiset: readTextMultiset(boardId),
      });
    } catch (error) {
      // 계약을 못 읽는 보드도 그 보드만 빨갛게 남긴다 — 여기서 던지면 청크가 아니라
      // 실행 전체가 죽어 96장 결과와 리포트가 통째로 날아간다.
      collected.get(boardId).failures.push({
        code: 'mount_failed',
        layer: 'mount',
        stage: 'contract',
        error: String(error.message || error),
      });
    }
  }

  for (const [presetIndex, preset] of BOARD_WINDOW_PRESETS.entries()) {
    win.setContentSize(preset.width, preset.height);
    for (const surface of surfaces) {
      const record = collected.get(surface.boardId);
      // 한 보드가 못 서도 나머지 95장은 계속 잰다 — 빨간 보드 목록을 만드는 것이
      // 이 게이트의 산출물이라 첫 실패에서 멈추면 아무것도 못 낳는다.
      if (record.mountBroken) continue;
      try {
        if (presetIndex === 0) {
          await sendBoardEnvelope(win, surface);
          await activateBoardTab(win, surface.instanceId);
          await inspectBoardChrome(win, surface);
        } else {
          await activateBoardTab(win, surface.instanceId);
        }
        await settleBoardLayout(win, surface.instanceId);
        const probe = await win.webContents.executeJavaScript(boardStepProbe(surface.instanceId));
        if (probe.error) throw new Error(probe.error);
        Object.assign(probe, await measureSurfaceExtras(win, surface.instanceId));
        let geometryError = null;
        try {
          assertSurfaceGeometry(surface.boardId, preset, probe);
        } catch (error) {
          geometryError = String(error.message || error);
        }
        record.failures.push(...mountFailures({
          preset: preset.name,
          probe,
          geometryError,
          expectedTextMultiset: surface.expectedTextMultiset,
          expectedStateBoards: uniqueStateControls(surface.contract.state_boards),
        }));
        record.steps.push({
          preset: preset.name,
          container_width: probe.container_width,
          overflow_x: probe.overflow_x,
          slot_count: probe.slot_multiset.length,
          reachable_slot_count: probe.reachable_slot_count,
          distinct_text_count: probe.dom_text.length,
          state_boards_in_dom: probe.state_boards_in_dom,
        });
      } catch (error) {
        record.mountBroken = true;
        record.failures.push({
          code: 'mount_failed',
          layer: 'mount',
          preset: preset.name,
          error: String(error.message || error),
        });
      }
    }
  }

  await win.webContents.executeJavaScript('window.AthenaShell.clearCanvases()');
  return chunk.board_ids.map((boardId) => {
    const record = collected.get(boardId);
    return boardMountRecord({
      board_id: boardId,
      card_id: chunk.card_id,
      steps: record.steps,
      failures: record.failures,
    });
  });
}

async function main() {
  const startedAt = Date.now();
  const selection = resolveBoardSelection(
    process.env.ATHENA_VERIFY_BOARD_IDS,
    CARD_BOARDS.map((board) => board.board_id),
  );
  const chunks = groupBoardsByCard(selection.boardIds, (boardId) => CARD_ID_OF.get(boardId) || null);

  await app.whenReady();
  registerShellIpc();
  const win = await bootShell();

  const boards = [];
  for (const chunk of chunks) {
    console.log(`[paper-cards-mount] ${chunk.card_id} · 보드 ${chunk.board_ids.length}장`);
    boards.push(...await probeChunk(win, chunk));
  }
  for (const board of boards) board.name = BOARD_NAME_OF.get(board.board_id) || null;

  const failed = boards.filter((board) => board.status === 'fail');
  const runtime = {
    gate: 'verify:paper-cards-mount',
    generated_at: new Date().toISOString(),
    selection: { canonical: selection.canonical, boards: selection.boardIds.length },
    presets: BOARD_WINDOW_PRESETS.map((preset) => preset.name),
    chunks,
    elapsed_ms: Date.now() - startedAt,
    totals: { boards: boards.length, pass: boards.length - failed.length, fail: failed.length },
    boards,
  };

  const existing = fs.existsSync(REPORT_PATH)
    ? JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
    : null;
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(mergeMountLayer(existing, runtime), null, 2)}\n`);

  const { exitCode, lines } = formatMountCliReport(
    runtime,
    path.relative(ROOT, REPORT_PATH).replace(/\\/g, '/'),
  );
  for (const line of lines) (exitCode ? console.error : console.log)(line);
  app.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
