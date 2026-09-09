'use strict';

// 카드 표면 전수 — **실제 백엔드 API로 값을 받아** 보드를 세우고 둘을 잰다.
//
//   (1) 결측어  — 화면에 실제로 찍힌 `미제공`/`집계 전`/`해당 없음` 수
//   (2) 글자 잘림 — 글리프가 조상 클립 상자 밖으로 나가 아래(또는 위)가 잘린 자리
//
// 값은 지어내지 않는다. 보드마다 `POST /api/v1/internal/canvas/board-hydrate`를
// 부르고(그 경로가 실제 Kiwoom 조회를 한다) 돌아온 surface_contract를 그대로 봉투에
// 실어 마운트한다. 즉 이 프로브가 재는 화면은 제품이 실제로 그리는 화면이다.
//
// 실행: electron probe-card-api-sweep.js   (백엔드가 8010에 떠 있어야 한다)
// 샤딩: ATHENA_VERIFY_BOARD_IDS=2SKU-1,137X-2
// 성공 표지: card api sweep passed

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { publicPolicies } = require('./lib/main/integrated-card-realtime');
const {
  BOARD_WINDOW_PRESETS,
  activateBoardTab,
  boardInstanceId,
  assertSurfaceGeometry,
  boardStepProbe,
  sendBoardEnvelope,
  settleBoardLayout,
} = require('./lib/board-probe');
const { TEXT_CLIP_PROBE, MISSING_TEXT_PROBE } = require('./lib/board-text-clip');
const { hydrateBoard } = require('./lib/main/board-hydrate');
const { kindOfBoard, resolveKindCode } = require('./lib/board-sweep-targets');
const { readLocalBearerToken } = require('./lib/main/backend-launcher');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const TEMPLATE_ROOT = path.join(ROOT, 'backend', 'ref', 'card-surface-templates');
const CARD_INDEX = path.join(TEMPLATE_ROOT, 'index.json');
// 샤드를 나눠 돌릴 때 프로필·리포트가 겹치면 서로의 프로필을 지우고 리포트를
// 덮어쓴다(실측: 두 샤드 동시 실행에서 한쪽 결과가 통째로 사라졌다). 샤드 이름을
// 주면 둘 다 갈라 쓴다 — `ATHENA_SWEEP_SHARD=b`.
const SHARD = (process.env.ATHENA_SWEEP_SHARD || '').trim();
const SHARD_SUFFIX = SHARD ? `-${SHARD}` : '';
const REPORT_PATH = path.join(
  APP, 'captures', 'card-api-sweep', `CARD-API-SWEEP${SHARD_SUFFIX}.json`,
);
const BACKEND_BASE = process.env.ATHENA_BACKEND_BASE || 'http://127.0.0.1:8010';
const TARGET = JSON.parse(process.env.ATHENA_SWEEP_TARGET || '{"stk_cd":"005930"}');
// 눈으로 볼 보드 — `ATHENA_SWEEP_CAPTURE=4AUX-1,133H-2` 또는 `*`.
const CAPTURE = new Set(
  (process.env.ATHENA_SWEEP_CAPTURE || '').split(',').map((value) => value.trim()).filter(Boolean),
);
const CARD_KIND = Object.freeze({
  'CC-01': 'account', 'CC-02': 'order', 'CC-03': 'instrument',
  'CC-04': 'orderbook', 'CC-05': 'flow', 'CC-06': 'explorer',
});

const PROFILE = path.join(APP, `.probe-card-api-sweep-profile${SHARD_SUFFIX}`);
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();

const BEARER_TOKEN = readLocalBearerToken(path.join(ROOT, 'backend'));
const CARD_BOARDS = JSON.parse(fs.readFileSync(CARD_INDEX, 'utf8')).boards;
const OPERATION_REFS_OF = new Map(
  CARD_BOARDS.map((board) => [board.board_id, board.operation_refs || []]),
);
const BOARD_NAME_OF = new Map(CARD_BOARDS.map((board) => [board.board_id, board.name]));
const CARD_ID_OF = new Map(CARD_BOARDS.map((board) => [board.board_id, board.card_id]));

function registerShellIpc() {
  const source = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
  const block = source.split('const INVOKE_CHANNELS = new Set([')[1];
  const channels = block ? block.split(']);')[0] : null;
  if (!channels) throw new Error('preload.js에서 INVOKE_CHANNELS 블록을 못 찾았다');
  for (const channel of [...channels.matchAll(/'([^']+)'/g)].map((match) => match[1])) {
    ipcMain.handle(channel, async (_event, payload) => {
      // 렌더러도 마운트 뒤 부족한 슬롯을 다시 채운다(canvas.js hydrateBoardSlots).
      // 제품에서는 main이 REST를 부르므로 프로브도 같은 호출을 그대로 낸다 —
      // 여기서 가짜 성공을 돌려주면 보드가 값 없이 완성된 것처럼 보인다.
      if (channel === 'athena:canvas-board-hydrate') {
        const request = payload && typeof payload === 'object' ? payload : {};
        return hydrateBoard({
          backendBase: BACKEND_BASE,
          token: BEARER_TOKEN,
          boardId: request.boardId,
          target: request.target || await targetFor(request.boardId),
          account: request.account,
          slotIds: request.slotIds,
        });
      }
      if (channel === 'athena:integrated-card-realtime-policy') return publicPolicies();
      if (channel.startsWith('athena:integrated-card-realtime-')) {
        return {
          ok: true, status: 'active', bindings: [], generation: 1, connectionGeneration: 1,
        };
      }
      if (channel === 'athena:boot-readiness:get') {
        return {
          runId: 'card-api-sweep',
          revision: 1,
          phase: 'ready',
          tasks: [{
            id: 'probe-readiness',
            label: '카드 API 전수 검사 준비',
            kind: 'gate',
            state: 'succeeded',
            attempt: 1,
            retryable: false,
            detail: '완료',
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
    width: 1920,
    height: 1080,
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
  // 마운트가 실패하면 이유는 렌더러 콘솔에만 남는다 — 프로브 로그로 끌어온다.
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log(`[renderer] ${message}`);
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

// 보드 종류별 조회 대상. ELW·ETF 화면은 그 종류의 코드로 물어야 한다 —
// 종목 코드로 물으면 응답이 빈 배열이고, 그것은 제품 결함이 아니다.
const KIND_CODES = new Map();

async function targetFor(boardId) {
  const kind = kindOfBoard(OPERATION_REFS_OF.get(boardId));
  if (kind === 'stock') return TARGET;
  if (!KIND_CODES.has(kind)) {
    KIND_CODES.set(kind, await resolveKindCode(kind, { backendBase: BACKEND_BASE }));
  }
  const code = KIND_CODES.get(kind);
  return code ? { ...TARGET, stk_cd: code } : TARGET;
}

// 실제 API 호출 — main 프로세스가 board-hydrate를 부른다(렌더러와 같은 경로).
async function hydrate(boardId, token) {
  const reply = await hydrateBoard({
    backendBase: BACKEND_BASE,
    token,
    boardId,
    target: await targetFor(boardId),
  });
  if (!reply.ok) {
    throw new Error(`board-hydrate ${reply.status}: ${reply.error || reply.httpStatus || ''}`);
  }
  return reply;
}

async function probeBoard(win, boardId, ordinal, token) {
  const record = {
    board_id: boardId,
    card_id: CARD_ID_OF.get(boardId) || null,
    name: BOARD_NAME_OF.get(boardId) || null,
    steps: [],
    failures: [],
  };
  let reply;
  try {
    reply = await hydrate(boardId, token);
  } catch (error) {
    record.failures.push({ code: 'hydrate_failed', error: String(error.message || error) });
    return record;
  }
  const contract = reply.surface_contract;
  record.api = {
    target: await targetFor(boardId),
    operations: reply.operations,
    filled: reply.filled,
    unbound: Array.isArray(contract.unbound_slots) ? contract.unbound_slots.length : null,
  };
  const surface = {
    boardId,
    instanceId: boardInstanceId(boardId),
    ordinal,
    cardTitle: `카드 API 전수 · ${boardId}`,
    operationRef: 'base:board-surface',
    realtimeBindings: [],
    contract: { ...contract, card_kind: CARD_KIND[contract.card_id] },
  };
  let mounted = false;
  for (const [presetIndex, preset] of BOARD_WINDOW_PRESETS.entries()) {
    win.setContentSize(preset.width, preset.height);
    try {
      if (presetIndex === 0) {
        await sendBoardEnvelope(win, surface);
        mounted = true;
      }
      await activateBoardTab(win, surface.instanceId);
      await settleBoardLayout(win, surface.instanceId);
      // 실데이터가 실린 뒤 글자가 서로 겹치는 자리도 잘림과 함께 잰다 —
      // 목업보다 긴 값이 들어오면 칸이 서로 침범한다(board-glyph-geometry).
      const geometry = await win.webContents.executeJavaScript(
        boardStepProbe(surface.instanceId),
      );
      const clip = await win.webContents.executeJavaScript(TEXT_CLIP_PROBE(surface.instanceId));
      const missing = await win.webContents.executeJavaScript(
        MISSING_TEXT_PROBE(surface.instanceId),
      );
      if (clip.error || missing.error) throw new Error(clip.error || missing.error);
      if (CAPTURE.has(boardId) || CAPTURE.has('*')) {
        // 두 프레임을 기다린다 — 바로 찍으면 마운트 전 프레임이 나온다.
        await win.webContents.executeJavaScript(
          'new Promise((done) => requestAnimationFrame('
          + '() => requestAnimationFrame(() => done(true))))',
        );
        const image = await win.webContents.capturePage();
        const file = path.join(
          path.dirname(REPORT_PATH), `${boardId}-${preset.name}.png`,
        );
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, image.toPNG());
      }
      record.steps.push({
        preset: preset.name,
        missing_total: missing.total,
        missing_counts: missing.counts,
        missing_nodes: missing.nodes,
        // Paper가 디자인으로 그린 결측어 라벨 — 결함이 아니라 1:1 증거다.
        authored_missing_total: missing.authored_total,
        authored_missing_nodes: missing.authored_nodes,
        clipped_total: clip.clipped_total,
        clipped_nodes: clip.clipped_nodes,
        reachable_clip_total: clip.reachable_total,
        rows_collapsed: missing.rows_collapsed,
        rows_skipped: missing.rows_skipped,
        wrap_row_marks: clip.wrap_row_marks,
        relaxed_rows: clip.relaxed_rows,
        width_watch: clip.width_watch,
        surface_client_width: clip.surface_client_width,
        surface_scroll_width: clip.surface_scroll_width,
        overlap_total: geometry && geometry.text_overlap_total,
        overlap_nodes: (geometry && geometry.text_overlap_nodes) || [],
        wrap_total: geometry && geometry.atomic_wrap_total,
      });
      // 실제 API 값으로도 **기하 계약**을 잰다 — 마운트 게이트가 Paper 원문 픽스처로
      // 재는 것과 같은 판정(표면 넘침·세로 넘침·세로 겹침·스크롤 초점)을 실데이터
      // 경로에서 한 번 더 본다. 값이 목업보다 길면 그때 처음 넘치는 자리가 있다.
      try {
        assertSurfaceGeometry(boardId, preset, geometry);
      } catch (error) {
        record.failures.push({
          code: 'surface_geometry',
          preset: preset.name,
          error: String(error.message || error),
        });
      }
      if (geometry && geometry.text_overlap_total > 0) {
        record.failures.push({
          code: 'text_overlap',
          preset: preset.name,
          count: geometry.text_overlap_total,
          nodes: (geometry.text_overlap_nodes || []).slice(0, 5),
        });
      }
      if (missing.total > 0) {
        record.failures.push({
          code: 'missing_text_visible', preset: preset.name, count: missing.total,
        });
      }
      if (clip.clipped_total > 0) {
        record.failures.push({
          code: 'text_clipped',
          preset: preset.name,
          count: clip.clipped_total,
          nodes: clip.clipped_nodes.slice(0, 5),
        });
      }
    } catch (error) {
      record.failures.push({
        code: 'mount_failed', preset: preset.name, error: String(error.message || error),
      });
      break;
    }
  }
  if (mounted) await win.webContents.executeJavaScript('window.AthenaShell.clearCanvases()');
  return record;
}

async function main() {
  const startedAt = Date.now();
  const selected = (process.env.ATHENA_VERIFY_BOARD_IDS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const boardIds = selected.length ? selected : CARD_BOARDS.map((board) => board.board_id);
  await app.whenReady();
  registerShellIpc();
  const win = await bootShell();

  const boards = [];
  for (const [index, boardId] of boardIds.entries()) {
    const record = await probeBoard(win, boardId, (index % 6) + 1, BEARER_TOKEN);
    boards.push(record);
    const worst = record.steps.reduce((acc, step) => ({
      missing: Math.max(acc.missing, step.missing_total),
      clipped: Math.max(acc.clipped, step.clipped_total),
    }), { missing: 0, clipped: 0 });
    const broke = record.failures.find((failure) => failure.code.endsWith('failed'));
    console.log(
      `[${index + 1}/${boardIds.length}] ${boardId} `
      + `api=${record.api ? record.api.filled : 'x'} `
      + `missing=${worst.missing} clipped=${worst.clipped} `
      + `overlap=${Math.max(0, ...record.steps.map((step) => step.overlap_total || 0))}`
      + (broke ? ` FAIL ${broke.error}` : ''),
    );
  }

  const worstOf = (board, key) => Math.max(0, ...board.steps.map((step) => step[key]));
  const totals = {
    boards: boards.length,
    missing_boards: boards.filter((board) => worstOf(board, 'missing_total') > 0).length,
    missing_sum: boards.reduce((acc, board) => acc + worstOf(board, 'missing_total'), 0),
    clipped_boards: boards.filter((board) => worstOf(board, 'clipped_total') > 0).length,
    clipped_sum: boards.reduce((acc, board) => acc + worstOf(board, 'clipped_total'), 0),
    overlap_boards: boards.filter((board) => worstOf(board, 'overlap_total') > 0).length,
    overlap_sum: boards.reduce((acc, board) => acc + worstOf(board, 'overlap_total'), 0),
    broken_boards: boards.filter(
      (board) => board.failures.some((failure) => failure.code.endsWith('failed')),
    ).length,
  };
  const runtime = {
    gate: 'verify:card-api-sweep',
    generated_at: new Date().toISOString(),
    backend_base: BACKEND_BASE,
    target: TARGET,
    presets: BOARD_WINDOW_PRESETS.map((preset) => preset.name),
    elapsed_ms: Date.now() - startedAt,
    totals,
    boards,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(runtime, null, 1)}\n`);
  console.log(JSON.stringify(totals));
  const failed = totals.missing_boards + totals.clipped_boards + totals.broken_boards
    + totals.overlap_boards;
  console.log(failed ? `card api sweep failed — ${REPORT_PATH}` : 'card api sweep passed');
  app.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
