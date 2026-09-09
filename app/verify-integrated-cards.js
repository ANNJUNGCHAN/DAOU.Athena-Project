'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  CardLeaseManager,
  createSemanticBindingSourceProvider,
  publicPolicies,
  resolveLeaseBindings,
} = require('./lib/main/integrated-card-realtime');
const { stateLinksFromMarks } = require('./lib/board-mount');
const {
  DEFAULT_READABILITY_BOARD_IDS,
  assertReadability,
  assertReadabilityMatrix,
} = require('./lib/board-glyph-geometry');
const {
  BOARD_WINDOW_PRESETS,
  activateBoardTab,
  assertSurfaceGeometry,
  boardInstanceId,
  boardStepProbe,
  inspectBoardChrome,
  loadRealBoardContract,
  sendBoardEnvelope,
  settleBoardLayout,
} = require('./lib/board-probe');
const {
  KNOWN_STALE_BOARD_CAPTURE_NAMES,
  assertBoardCaptureArtifacts,
  ensureCaptureOutputDirectory,
  expectedBoardCaptureNames,
  pruneUnexpectedBoardCaptures,
  resolveBoardSelection,
} = require('./lib/integrated-card-capture-hygiene');
const { captureRoot } = require('./lib/probe-captures');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const BACKEND = path.join(ROOT, 'backend');
const CAPTURE_DIR = path.join(captureRoot(APP), 'integrated-cards');
const BOARD_SELECTION_OVERRIDE = process.env.ATHENA_VERIFY_BOARD_IDS;
const CANONICAL_CAPTURE_RUN = BOARD_SELECTION_OVERRIDE === undefined;
const CAPTURE_OUTPUT_DIR = ensureCaptureOutputDirectory(CAPTURE_DIR, CANONICAL_CAPTURE_RUN);

// 백엔드 의존성(fastapi·pydantic 등)은 backend/.venv에만 있다. PATH의 맨 python으로
// 부르면 ModuleNotFoundError로 죽는다 — mcp-config.js의 PYTHON_EXE와 같은 경로를 쓴다.
const VENV_PYTHON = path.join(BACKEND, '.venv', 'Scripts', 'python.exe');
const FIXTURE_PYTHON = process.env.ATHENA_FIXTURE_PYTHON
  || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python');

app.setPath('userData', path.join(CAPTURE_OUTPUT_DIR, '.electron-user-data'));
app.disableHardwareAcceleration();
// 계측 창이 다른 창에 덮여도 판정이 흔들리지 않게 한다 — Chromium은 네이티브 창
// 가림을 감지하면 그 창을 hidden으로 표시하고 rAF를 멈춘다. 그러면 카드는 정상인데
// paint ack이 확인할 프레임을 못 받아 검사만 빨개진다(2026-09-07 실측: 다른 창이
// 셸을 덮은 사이 detail:kt00013:cash_resources에서 wall-clock timeout, 같은 검사를
// 단독으로 다시 돌리면 통과). 제품 쪽은 숨은 시간을 예산에서 빼는 방향으로 고쳤고
// (lib/rest-canvas-paint.js), 검사는 애초에 가림 판정을 받지 않게 한다 —
// 창 쌓임 순서는 카드 렌더 계약이 아니다. backgroundThrottling은 건드리지 않는다
// (2026-09-04 실측에서 역효과였다).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function loadBundle() {
  const script = path.join(BACKEND, 'tests', 'support', 'canvas_fixture_factory.py');
  const result = spawnSync(FIXTURE_PYTHON, [script, '--json'], {
    cwd: BACKEND,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`fixture factory failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function loadProductionSemanticContracts() {
  const script = [
    'import json',
    'from athena_api.api.canvas_push import _bind_semantic_values, _integrated_card_contract, _internal_realtime_binding_contract',
    'from athena_api.generated.registry import WEBSOCKET_TR_IDS',
    "card = _integrated_card_contract('base:ka10081')",
    "_bind_semantic_values(card, 'base:ka10081', {'stk_cd': '005930', 'stk_dt_pole_chart_qry': [{'dt': '20260831', 'cur_prc': '150850', 'open_pric': '149000', 'trde_qty': '1234'}]})",
    "print(json.dumps({'card': card, 'realtime': {operation: _internal_realtime_binding_contract(operation) for operation in sorted(WEBSOCKET_TR_IDS)}}))",
  ].join('\n');
  const result = spawnSync(FIXTURE_PYTHON, ['-c', script], {
    cwd: BACKEND,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: BACKEND },
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`semantic contract factory failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function productionSemanticBindingProvider(contracts) {
  return createSemanticBindingSourceProvider({
    backendBase: 'http://127.0.0.1:8010',
    token: 'fixture-in-memory-only',
    fetchImpl: async (url) => {
      const operationId = decodeURIComponent(String(url).split('/').pop());
      const contract = contracts.realtime[operationId];
      if (!contract) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => contract };
    },
  });
}

function exactSemanticTick(config, contracts) {
  for (const binding of resolveLeaseBindings(config)) {
    const contract = contracts.realtime[binding.operationId];
    const entries = contract && Object.entries(contract.source_bindings || {});
    if (!entries || !entries.length) continue;
    const targetSourceField = binding.operationId === '00' || binding.operationId === '04'
      ? '9201' : binding.operationId === 'ka10173' ? '841' : '';
    const [sourceField, descriptor] = entries.find(([field]) => field !== targetSourceField)
      || entries[0];
    return {
      binding,
      sourceField,
      bindingId: descriptor.binding_id,
      value: '150850',
      mismatchedSourceField: entries.find(([, candidate]) => (
        candidate.binding_id !== descriptor.binding_id
      ))?.[0] || '__not_authorized__',
    };
  }
  throw new Error(`${config.cardId}: no authoritative semantic realtime source`);
}

function frameForExactSemanticTick(exact, sourceField, value) {
  const values = { [sourceField]: value };
  if (exact.binding.operationId === '00' || exact.binding.operationId === '04') {
    values['9201'] = exact.binding.target;
  }
  if (exact.binding.operationId === 'ka10173') {
    values['841'] = exact.binding.target;
    return { trnm: 'REAL', seq: exact.binding.target, values };
  }
  return {
    trnm: 'REAL',
    data: [{ type: exact.binding.operationId, item: exact.binding.target, values }],
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// 실시간 임차는 **계좌 귀속**을 요구한다(`resolveLeaseBindings`의 별칭 검사 — 커밋
// 1acaba57 「실시간 계좌 귀속을 고정」). 이 프로브는 그 뒤로 별칭을 안 넘겨 첫 틱에서
// TypeError로 죽어 있었다. 픽스처 계좌 하나를 준다 — 별칭은 임차 키에만 들어가고
// 이 프로브의 단언(REG/REMOVE 순서·재연결)은 그 값을 보지 않는다.
const FIXTURE_BACKEND_ACCOUNT_ALIAS = 'fixture-account';

function withFixtureAccount(payload) {
  return { ...(payload || {}), backendAccountAlias: FIXTURE_BACKEND_ACCOUNT_ALIAS };
}

function realtimeConfig(cardId, leaseId, target) {
  const base = { leaseId, cardId, backendAccountAlias: FIXTURE_BACKEND_ACCOUNT_ALIAS };
  if (cardId === 'CC-01') return { ...base, mode: 'overview', accountId: target };
  if (cardId === 'CC-03') return { ...base, mode: 'quote', symbol: target };
  if (cardId === 'CC-04') return { ...base, mode: 'regular', symbol: target };
  if (cardId === 'CC-05') return { ...base, mode: 'program', symbol: target };
  if (cardId === 'CC-06') return { ...base, mode: 'condition-search', conditionId: target };
  return null;
}

async function productionRealtimeTrace(card, contracts) {
  const initial = realtimeConfig(card.card_id, `fixture-${card.card_id}`, '005930');
  if (!initial) return { calls: [], states: [], tick_count: 0 };
  const exact = exactSemanticTick(initial, contracts);
  initial.semanticBindingIds = [exact.bindingId];
  const calls = [];
  const states = [];
  const transport = {
    acquire: async (binding) => { calls.push(['REG', binding.operationId, binding.target]); return true; },
    release: async (binding) => { calls.push(['REMOVE', binding.operationId, binding.target]); return true; },
    reconnect: async (bindings) => {
      calls.push(['RECONNECT', ...bindings.map((item) => `${item.operationId}:${item.target}`)]);
      return bindings.map((binding) => ({ binding, ok: true, error: null }));
    },
    command: async () => ({ ok: true }),
  };
  const manager = new CardLeaseManager({
    transport,
    semanticBindingSourceProvider: productionSemanticBindingProvider(contracts),
    onState: (state) => states.push(state),
  });
  const mounted = await manager.mount(initial);
  if (!mounted.ok || !mounted.bindings.length) throw new Error(`${card.card_id}: production realtime mount failed`);
  const ticks = manager.routeFrame(frameForExactSemanticTick(
    exact, exact.sourceField,
    (exact.binding.operationId === '00' || exact.binding.operationId === '04')
      && exact.sourceField === '9201' ? exact.binding.target : exact.value,
  ));
  const mismatchedTicks = manager.routeFrame(frameForExactSemanticTick(
    exact, exact.mismatchedSourceField, '151000',
  ));
  if (mismatchedTicks.length !== 0) {
    throw new Error(`${card.card_id}: unauthorized semantic source produced a tick`);
  }
  const next = realtimeConfig(card.card_id, initial.leaseId, '000660');
  next.semanticBindingIds = [exact.bindingId];
  const updated = await manager.update(next);
  if (!updated.ok) throw new Error(`${card.card_id}: production realtime target update failed`);
  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.handleFeedStatus({ state: 'open' });
  await manager.unmount(initial.leaseId);
  return {
    calls,
    states,
    tick_count: ticks.length,
    mismatched_tick_count: mismatchedTicks.length,
    semantic_binding_id: exact.bindingId,
    source_operation_id: exact.binding.operationId,
    source_field: exact.sourceField,
  };
}

function registerSafeShellIpc(records, realtimeManager) {
  const source = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
  const block = source.split('const INVOKE_CHANNELS = new Set([')[1].split(']);')[0];
  const channels = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  for (const channel of channels) {
    ipcMain.handle(channel, async (_event, payload) => {
      let result = null;
      if (channel === 'athena:integrated-card-realtime-policy') result = publicPolicies();
      // 제품은 **활성 계좌**에서 별칭을 주입한다(main.js `mountIntegratedCardRealtime`의
      // `withActiveRealtimeAccount`). 렌더러 payload에는 별칭이 없으므로, 검사기도 같은
      // 자리에서 픽스처 계좌를 주입해야 임차가 선다 — 안 주면 `resolveLeaseBindings`가
      // 별칭 검사에서 던지고 임차가 영원히 active가 되지 않는다(커밋 1acaba57).
      if (channel === 'athena:integrated-card-realtime-mount') {
        result = await realtimeManager.mount(withFixtureAccount(payload));
      }
      if (channel === 'athena:integrated-card-realtime-update') {
        result = await realtimeManager.update(withFixtureAccount(payload));
      }
      if (channel === 'athena:integrated-card-realtime-unmount') {
        result = await realtimeManager.unmount(payload && payload.leaseId);
      }
      if (channel.endsWith('-list') || channel.endsWith('conversations-list')) result = [];
      if (channel === 'athena:boot-readiness:get') {
        result = {
          runId: 'integrated-cards-fixture',
          revision: 1,
          phase: 'ready',
          tasks: [{
            id: 'fixture-readiness', label: 'fixture 화면 준비', kind: 'gate',
            state: 'succeeded', attempt: 1, retryable: false, detail: '완료',
          }],
        };
      }
      if (channel === 'athena:onboarding-state') result = { needed: false, step: 3 };
      if (channel.includes('prefs:get')) result = {};
      records.push({ channel, payload, result });
      return result;
    });
  }
}

async function exerciseShellRealtime(win, manager, contracts) {
  const mounted = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="CC-03"]');
    return {
      leaseId: root.__athenaIntegratedRealtime?.leaseId || '',
      mode: root.__athenaIntegratedMetadata?.mode || '',
    };
  })()`);
  let state = manager.status(mounted.leaseId);
  const activeDeadline = Date.now() + 3000;
  while ((!state || state.status !== 'active') && Date.now() < activeDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = manager.status(mounted.leaseId);
  }
  if (!state || state.status !== 'active' || !state.bindings.length) {
    throw new Error(`actual shell realtime lease is not active: ${JSON.stringify(state)}`);
  }
  const binding = state.bindings.find((item) => item.operationId === '0B');
  if (!binding) throw new Error('actual shell quote lease is missing 0B');
  const source = contracts.realtime['0B'].source_bindings['10'];
  const observation = contracts.card.semantic_observations.find((item) => (
    item.realtime_binding_id === source.binding_id && item.label_ko === '현재가'
  ));
  if (!observation) throw new Error('production current-price observation is missing');
  const before = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="CC-03"]');
    const target = root.querySelector('[data-semantic-observation-id="${observation.observation_id}"]');
    return { found: Boolean(target), text: target?.textContent || '' };
  })()`);
  if (!before.found) throw new Error(`actual shell semantic observation is missing: ${JSON.stringify(before)}`);
  const ticks = manager.routeFrame({
    trnm: 'REAL',
    data: [{
      type: binding.operationId,
      item: binding.target,
      values: { 10: '151000' },
    }],
  }, state.connectionGeneration);
  if (!ticks.length) throw new Error('actual shell realtime manager produced no tick');
  win.webContents.send('athena:integrated-card-realtime-ticks', ticks);
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const accepted = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="CC-03"]');
    const target = root.querySelector('[data-semantic-observation-id="${observation.observation_id}"]');
    return {
      found: Boolean(target),
      text: target?.textContent || '',
    };
  })()`);
  if (!accepted.found || !accepted.text.includes('151,000원')) {
    throw new Error(`generation-matching realtime tick was not rendered: ${JSON.stringify(accepted)}`);
  }
  const mismatchedTicks = manager.routeFrame({
    trnm: 'REAL',
    data: [{ type: binding.operationId, item: binding.target, values: { 11: '999' } }],
  }, state.connectionGeneration);
  if (mismatchedTicks.length !== 0) {
    throw new Error('actual shell mismatched semantic binding produced a tick');
  }
  const staleTick = {
    ...ticks[0],
    generation: Math.max(0, ticks[0].generation - 1),
    semantic_updates: [{ binding_id: source.binding_id, value: '152000' }],
  };
  win.webContents.send('athena:integrated-card-realtime-ticks', [staleTick]);
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const afterStale = await win.webContents.executeJavaScript(`(() =>
    document.querySelector('#grid .integrated-card[data-card-id="CC-03"] [data-semantic-observation-id="${observation.observation_id}"]')?.textContent || ''
  )()`);
  if (!afterStale.includes('151,000원') || afterStale.includes('152,000원')) {
    throw new Error(`stale realtime tick changed the renderer: ${afterStale}`);
  }
  return {
    lease: state,
    before,
    accepted,
    source_operation_id: '0B',
    source_field: '10',
    semantic_binding_id: source.binding_id,
    mismatched_tick_count: mismatchedTicks.length,
    stale_tick_ignored: true,
  };
}

function shellMode(cardId) {
  return {
    'CC-01': 'overview', 'CC-02': 'order', 'CC-03': 'quote',
    'CC-04': 'regular', 'CC-05': 'program', 'CC-06': 'condition-search',
  }[cardId];
}

function shellArgs(cardId) {
  if (cardId === 'CC-01') return { account_no: 'fixture-account' };
  if (cardId === 'CC-06') return { condition_id: '7', seq: '7' };
  return { stk_cd: '005930' };
}

async function sendRestEnvelope(win, card, fixture, cardOrdinal, presentation = null) {
  await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
    if (root) root.scrollIntoView({ block: 'start' });
  })()`);
  await win.webContents.executeJavaScript(`(() => {
    const prior = window.__athenaFixtureVisibilityKeeper;
    if (prior) {
      prior.active = false;
      cancelAnimationFrame(prior.frame);
    }
    const keeper = { active: true, frame: 0, remaining: 24 };
    const keepVisible = () => {
      if (!keeper.active) return;
      const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
      if (root) root.scrollIntoView({ block: 'center', inline: 'nearest' });
      keeper.remaining -= 1;
      if (keeper.remaining <= 0) {
        keeper.active = false;
        return;
      }
      keeper.frame = requestAnimationFrame(keepVisible);
    };
    window.__athenaFixtureVisibilityKeeper = keeper;
    keepVisible();
  })()`);
  const correlation = {
    dataset_id: 'all-kiwoom-integrated-cards',
    item_id: fixture.canvas_type === 'chart'
      ? `${card.card_id}-chart-panel`
      : fixture.operation_ref,
    ordinal: cardOrdinal,
  };
  try {
    const receipt = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
      reject(new Error(`${fixture.operation_ref}: shell paint receipt timeout`));
    }, 5000);
    async function onPainted(_event, receipt) {
      if (!receipt || receipt.dataset_id !== correlation.dataset_id) return;
      clearTimeout(timer);
      ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
      if (receipt.render_state === 'error') {
        const state = await win.webContents.executeJavaScript(`(() => {
          const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
          const rect = root && root.getBoundingClientRect();
          const grid = document.getElementById('grid');
          const mosaic = document.getElementById('mosaic');
          const region = document.getElementById('canvasRegion');
          const compact = (node) => {
            const box = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              hidden: node.hidden,
              display: style.display,
              visibility: style.visibility,
              position: style.position,
              width: box.width,
              height: box.height,
            };
          };
          return {
            visibility: document.visibilityState,
            shellHidden: document.getElementById('shell').hidden,
            // 통합 카드는 캔버스 탭 덱(#grid > .canvas-tab-deck) 안에 산다 —
            // 직계 자식만 세면 진단이 항상 0으로 나온다.
            gridChildren: document.querySelectorAll('#grid .card').length,
            rootConnected: Boolean(root && root.isConnected),
            rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            rootStyle: root && compact(root),
            grid: compact(grid),
            mosaic: compact(mosaic),
            region: compact(region),
            canvasMode: region.dataset.mode,
            renderState: root && root.dataset.renderState,
            errorText: root && Array.from(root.querySelectorAll('[role="alert"], .error-note'))
              .map((node) => node.textContent.trim()).filter(Boolean).slice(-3),
          };
        })()`);
        reject(new Error(`${fixture.operation_ref}: ${receipt.error}; ${JSON.stringify(state)}`));
      }
      else resolve(receipt);
    }
    ipcMain.on('athena:rest-canvas-painted', onPainted);
    win.webContents.send('athena:add-rest-canvas', {
      operationRef: fixture.operation_ref,
      operationArgs: shellArgs(card.card_id),
      canvasType: fixture.canvas_type,
      envelope: {
        card_id: card.card_id,
        card_kind: card.card_kind,
        capability: fixture.capability_id,
        mode: (presentation && presentation.mode) || shellMode(card.card_id),
        section: (presentation && presentation.section) || fixture.operation_ref,
        operation_ref: fixture.operation_ref,
        canvas_type: fixture.canvas_type,
        screen_id: fixture.screen_id,
        renderer_id: fixture.renderer_id,
        card_title: '통합 카드 검수 fixture',
        fell_back: false,
        correlation,
        data: fixture.primary_data,
        source_data: { operation_ref: fixture.operation_ref, data: fixture.raw_data },
        field_contract: fixture.field_contract,
        coverage_receipt: { field_occurrence_count: fixture.field_contract.length, missing: 0 },
      },
    });
    });
    const visibility = await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const keeper = window.__athenaFixtureVisibilityKeeper;
      if (keeper) {
        keeper.active = false;
        cancelAnimationFrame(keeper.frame);
      }
      const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
      if (root) root.scrollIntoView({ block: 'center', inline: 'nearest' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const rect = root && root.getBoundingClientRect();
        const viewport = document.getElementById('grid').getBoundingClientRect();
        resolve({
          width: rect ? rect.width : 0,
          height: rect ? rect.height : 0,
          x: rect ? rect.x : 0,
          y: rect ? rect.y : 0,
          viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
          intersects: Boolean(rect && rect.width > 0 && rect.height > 0
            && rect.right > viewport.left && rect.left < viewport.right
            && rect.bottom > viewport.top && rect.top < viewport.bottom),
        });
      }));
    })`);
    if (!(visibility.width > 0) || !(visibility.height > 0) || !visibility.intersects) {
      throw new Error(`${fixture.operation_ref}: post-paint root is not visible: ${JSON.stringify(visibility)}`);
    }
    return { ...receipt, fixture_visibility: visibility };
  } finally {
    await win.webContents.executeJavaScript(`(() => {
      const keeper = window.__athenaFixtureVisibilityKeeper;
      if (keeper) {
        keeper.active = false;
        cancelAnimationFrame(keeper.frame);
      }
      window.__athenaFixtureVisibilityKeeper = null;
    })()`).catch(() => {});
  }
}

async function installProductionSemanticSnapshot(win, manager, contracts) {
  const mounted = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="CC-03"]');
    const workspace = window.AthenaLib.SemanticWorkspace.upsert(
      root, ${JSON.stringify(contracts.card)},
    );
    return {
      leaseId: root.__athenaIntegratedRealtime?.leaseId || '',
      workspace: Boolean(workspace),
      taskCanvas: root.dataset.taskCanvas,
    };
  })()`);
  if (!mounted.workspace || mounted.taskCanvas !== 'true' || !mounted.leaseId) {
    throw new Error(`production semantic snapshot was not installed: ${JSON.stringify(mounted)}`);
  }
  const config = realtimeConfig('CC-03', mounted.leaseId, '005930');
  config.semanticBindingIds = contracts.card.realtime_bindings.map((item) => item.binding_id);
  // 임차는 렌더러가 만들었고 이 관리자는 그 id를 처음 본다 — `update`는 이미 선 임차만
  // 갈아 준다(`_mountOrUpdate(config, requireExisting: true)`). 먼저 세워야 한다.
  const seeded = await manager.mount(config);
  if (!seeded.ok) {
    throw new Error(`production semantic realtime lease mount failed: ${JSON.stringify(seeded)}`);
  }
  const state = await manager.update(config);
  if (!state.ok || state.status !== 'active') {
    throw new Error(`production semantic realtime binding update failed: ${JSON.stringify(state)}`);
  }
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  return { lease_id: mounted.leaseId, binding_count: config.semanticBindingIds.length };
}

// ---------- 보드 표면 반응형 검수 (계획 §5 P3·P5) ----------
//
// 창 크기 4종에서 같은 보드를 세우고, 단계마다 (1) 보드 DOM 텍스트 다중집합과
// (2) 슬롯 도달 다중집합이 같은지 본다. 접힘은 이동이지 삭제가 아니므로
// (계획 §2) 열이 접혀도 그 값은 병기 줄로 내려와 화면에 그대로 남아야 한다.
const BOARD_ID = 'fixture-quote';
const BOARD_TEMPLATE_DIR = path.join(
  BACKEND, 'ref', 'card-surface-templates', BOARD_ID,
);

// 사용자 검수 PNG는 BOARD_WINDOW_PRESETS 4종만 유지한다. 실제 셸에서 1920 창의 보드 컨테이너는
// 1,171px(L)라 XL을 못 밟고, 960 창은 621px(S)라 M을 건너뛴다. 두 구간은
// 별도 기하 프로브로만 재서 5단 계약을 전부 통과시키고 PNG 수는 24장을 지킨다.
const BOARD_BREAKPOINT_PROBE_PRESETS = Object.freeze([
  { name: 'XL 프로브', width: 2560, height: 1440, minContainer: 1280, maxContainer: 1440 },
  { name: 'M 프로브', width: 1600, height: 900, minContainer: 720, maxContainer: 959 },
]);

function assertBreakpointContract(boardId, preset, probe) {
  const cutoff = preset.name === 'M 프로브' ? 6 : Number.POSITIVE_INFINITY;
  const expectedFolded = probe.all_columns.filter((priority) => Number(priority) >= cutoff).sort();
  if (JSON.stringify(probe.folded_columns) !== JSON.stringify(expectedFolded)) {
    throw new Error(
      `board ${boardId} ${preset.name}: folded columns ${JSON.stringify(probe.folded_columns)} !== ${
        JSON.stringify(expectedFolded)}`,
    );
  }
  if (preset.name === 'XL 프로브') {
    if (probe.kpi_row_counts.some((rows) => rows.length > 1)) {
      throw new Error(`board ${boardId} XL 프로브: KPI wrapped — ${JSON.stringify(probe.kpi_row_counts)}`);
    }
    if (probe.primary_rect && probe.rail_rect
        && Math.abs(probe.primary_rect.top - probe.rail_rect.top) > 1) {
      throw new Error(
        `board ${boardId} XL 프로브: primary/rail are not side-by-side — ${
          JSON.stringify({ primary: probe.primary_rect, rail: probe.rail_rect })}`,
      );
    }
    return;
  }
  if (probe.kpi_max_columns > 3) {
    throw new Error(`board ${boardId} M 프로브: KPI columns ${probe.kpi_max_columns} > 3`);
  }
  if (probe.primary_rect && probe.rail_rect
      && probe.rail_rect.top < probe.primary_rect.bottom - 1) {
    throw new Error(
      `board ${boardId} M 프로브: rail did not move below primary — ${
        JSON.stringify({ primary: probe.primary_rect, rail: probe.rail_rect })}`,
    );
  }
}

// 백엔드 card_surface_contract.observation_id_for와 **같은** 재료다. 다른 규칙으로
// 만들면 실시간 프레임이 보드 슬롯을 못 찾는다.
function observationIdFor(occurrenceId, rowIndex = null) {
  const suffix = rowIndex === null ? 'scalar' : `row:${rowIndex}`;
  const digest = crypto.createHash('sha256')
    .update(`semantic-observation\0${occurrenceId}\0${suffix}`)
    .digest('hex')
    .slice(0, 20);
  return `obs_${digest}`;
}

// 봉투가 실을 표면 계약을 픽스처 원문에서 만든다. 백엔드가 만드는 것과 같은
// 모양이다(slot_id · occurrence_id · observation_id · value · format).
//
// 실시간 이음매도 여기서 함께 만든다: 보드의 현재가 슬롯이 실제 0B 시세 바인딩과
// 같은 관찰을 가리키게 붙인다. 프론트는 그 표 하나만 보고 프레임을 잎에 꽂는다.
const BOARD_REALTIME_SLOT = 'header.price';
// 보드 카드가 실시간 리스를 얻으려면 봉투가 웹소켓 op를 실어야 한다(0B = 주식시세).
const BOARD_REALTIME_OPERATION = '0B';
const BOARD_REALTIME_FIELD = '10';

function loadBoardSurfaceContract(contracts) {
  const slots = JSON.parse(fs.readFileSync(path.join(BOARD_TEMPLATE_DIR, 'slots.json'), 'utf8'));
  const canon = JSON.parse(
    fs.readFileSync(path.join(BOARD_TEMPLATE_DIR, 'values.canon.json'), 'utf8'),
  ).values;
  const operationRef = `base:${BOARD_REALTIME_OPERATION}`;
  const observationBySlot = {};
  const slotValues = slots.slots
    .filter((slot) => Object.prototype.hasOwnProperty.call(canon, slot.slot_id))
    .map((slot) => {
      const occurrenceId = `${operationRef}|$.${slot.slot_id}|1`;
      const observationId = observationIdFor(occurrenceId);
      observationBySlot[slot.slot_id] = observationId;
      return {
        slot_id: slot.slot_id,
        occurrence_id: occurrenceId,
        observation_id: observationId,
        value: canon[slot.slot_id],
        layer: slot.layer,
        format: slot.format,
      };
    });
  const source = contracts.realtime[BOARD_REALTIME_OPERATION]
    .source_bindings[BOARD_REALTIME_FIELD];
  if (!source) throw new Error('board surface: 0B current-price source binding is missing');
  return {
    contract: {
      surface_version: 'card-surface.v1',
      board_id: slots.board_id,
      card_id: slots.card_id,
      state_boards: stateLinksFromMarks(slots.state_controls),
      slot_values: slotValues,
      unbound_slots: [],
      column_priority: slots.column_priority || [],
      section_titles_ko: slots.section_titles_ko || {},
    },
    realtimeBindings: [
      { binding_id: source.binding_id, observation_id: observationBySlot[BOARD_REALTIME_SLOT] },
    ],
    bindingId: source.binding_id,
    observationBySlot,
    canon,
    operationRef,
    slotCount: slotValues.length,
  };
}

// 실앱 실시간 — 프레임 하나가 보드 잎을 갈아끼우는지 본다. 프레임이 아는 것은
// binding_id뿐이고, 그것이 어느 슬롯인지는 봉투의 두 표(slot_values.observation_id ·
// realtime_bindings)가 이미 말해 뒀다.
async function exerciseBoardRealtime(win, manager, surface) {
  const instanceId = surface.instanceId;
  const slotText = async () => win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    const read = (slotId) => {
      const node = root.querySelector('[data-slot-id="' + slotId + '"]');
      return node ? node.textContent.trim() : null;
    };
    return {
      price: read('header.price'),
      change: read('header.change'),
      changeRate: read('header.change_rate'),
      color: (() => {
        const node = root.querySelector('[data-slot-id="header.price"]');
        return node ? node.style.color : null;
      })(),
    };
  })()`);

  const leaseId = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    return (root && root.__athenaIntegratedRealtime && root.__athenaIntegratedRealtime.leaseId) || '';
  })()`);
  if (!leaseId) throw new Error('board surface: realtime lease id is missing');
  let state = manager.status(leaseId);
  const deadline = Date.now() + 3000;
  while ((!state || state.status !== 'active') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    state = manager.status(leaseId);
  }
  if (!state || state.status !== 'active') {
    throw new Error(`board surface: realtime lease is not active: ${JSON.stringify(state)}`);
  }
  const binding = state.bindings.find((item) => item.operationId === BOARD_REALTIME_OPERATION);
  if (!binding) throw new Error('board surface: lease is missing the 0B quote binding');

  const before = await slotText();
  const ticks = manager.routeFrame({
    trnm: 'REAL',
    data: [{
      type: binding.operationId,
      item: binding.target,
      values: { [BOARD_REALTIME_FIELD]: '151000' },
    }],
  }, state.connectionGeneration);
  if (!ticks.length) throw new Error('board surface: realtime manager produced no tick');
  win.webContents.send('athena:integrated-card-realtime-ticks', ticks);
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const after = await slotText();
  if (after.price !== '151,000') {
    throw new Error(`board surface: realtime frame did not repaint the slot: ${JSON.stringify({ before, after })}`);
  }
  // 병기 짝은 같은 프레임에서 다시 칠해지되 값이 안 왔으면 글자가 바뀌지 않는다 —
  // 섞인 프레임도, 지워진 병기도 없어야 한다.
  if (after.change !== before.change || after.changeRate !== before.changeRate) {
    throw new Error(`board surface: paired slots drifted: ${JSON.stringify({ before, after })}`);
  }

  // 보드가 안 태운 binding_id는 아무 잎도 못 고친다.
  const unknownTick = {
    ...ticks[0],
    semantic_updates: [{ binding_id: 'rtb_00000000000000000000', value: '999999' }],
  };
  win.webContents.send('athena:integrated-card-realtime-ticks', [unknownTick]);
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const afterUnknown = await slotText();
  if (afterUnknown.price !== '151,000') {
    throw new Error(`board surface: unknown binding changed a slot: ${JSON.stringify(afterUnknown)}`);
  }

  return {
    lease_id: leaseId,
    source_operation_id: binding.operationId,
    source_field: BOARD_REALTIME_FIELD,
    semantic_binding_id: surface.bindingId,
    observation_id: surface.observationBySlot[BOARD_REALTIME_SLOT],
    slot_id: BOARD_REALTIME_SLOT,
    before,
    after,
    unknown_binding_ignored: afterUnknown.price === after.price,
  };
}

// ---------- 실보드 6장 (카드 6종 × 1장) ----------
//
// 픽스처 보드는 실시간 이음매를 재는 자리로만 남기고, 반응형·P5 검수는 추출
// 원문 그대로인 실보드에서 한다. 값은 slots.json의 `paper_text` — 그 보드가
// Paper에서 실제로 이고 있던 글자다. 마운트 계약(어느 노드에 어떤 슬롯이
// 앉는가)은 색인이 갖고 있으므로 봉투는 board_id·card_id·값만 나른다.
const DEFAULT_REAL_BOARDS = DEFAULT_READABILITY_BOARD_IDS;
const REAL_BOARD_TEMPLATE_ROOT = path.join(BACKEND, 'ref', 'card-surface-templates');
const BOARD_SELECTION = resolveBoardSelection(BOARD_SELECTION_OVERRIDE, DEFAULT_REAL_BOARDS);
const REAL_BOARDS = Object.freeze(BOARD_SELECTION.boardIds);
const EXPECTED_CANONICAL_BOARD_CAPTURES = Object.freeze(
  expectedBoardCaptureNames(DEFAULT_REAL_BOARDS, BOARD_WINDOW_PRESETS),
);

function validateRealBoards() {
  if (!REAL_BOARDS.length) {
    throw new Error('ATHENA_VERIFY_BOARD_IDS resolved to an empty board set');
  }
  if (new Set(REAL_BOARDS).size !== REAL_BOARDS.length) {
    throw new Error(`ATHENA_VERIFY_BOARD_IDS contains duplicates: ${REAL_BOARDS.join(',')}`);
  }
  for (const boardId of REAL_BOARDS) {
    if (!fs.existsSync(path.join(REAL_BOARD_TEMPLATE_ROOT, boardId, 'slots.json'))) {
      throw new Error(`ATHENA_VERIFY_BOARD_IDS contains unknown board: ${boardId}`);
    }
  }
}

// 보드 1장을 네 단계에서 재고 찍는다. 판정은 여기서 하고 원시값은 전부 남긴다.
async function captureBoardSteps(win, surface) {
  const paint = await sendBoardEnvelope(win, surface);
  await activateBoardTab(win, surface.instanceId);

  const originalBounds = win.getContentBounds();
  const steps = [];
  const breakpointProbes = [];
  try {
    for (const preset of BOARD_WINDOW_PRESETS) {
      win.setContentSize(preset.width, preset.height);
      await settleBoardLayout(win, surface.instanceId);
      const probe = await win.webContents.executeJavaScript(boardStepProbe(surface.instanceId));
      if (probe.error) throw new Error(`board ${surface.boardId} ${preset.name}: ${probe.error}`);
      // 스트립 자체의 overflow-x:auto는 허용하지만 표면 넘침·수직 겹침은 실패다.
      assertSurfaceGeometry(surface.boardId, preset, probe);
      assertReadability(surface.boardId, preset, probe, { enforce: true });
      const image = await win.webContents.capturePage(probe.card_rect);
      const png = image.toPNG();
      const file = `board-${surface.boardId}-${preset.width}x${preset.height}.png`;
      fs.writeFileSync(path.join(CAPTURE_OUTPUT_DIR, file), png);
      steps.push({
        preset: preset.name,
        window: { width: preset.width, height: preset.height },
        container_width: probe.container_width,
        overflow_x: probe.overflow_x,
        overflow_nodes: probe.overflow_nodes,
        host_client_width: probe.host_client_width,
        all_columns: probe.all_columns,
        folded_columns: probe.folded_columns,
        paired_columns: probe.paired_columns,
        primary_rect: probe.primary_rect,
        rail_rect: probe.rail_rect,
        kpi_row_counts: probe.kpi_row_counts,
        kpi_max_columns: probe.kpi_max_columns,
        vertical_overflow_nodes: probe.vertical_overflow_nodes,
        vertical_overlap_nodes: probe.vertical_overlap_nodes,
        atomic_wrap_nodes: probe.atomic_wrap_nodes,
        atomic_wrap_total: probe.atomic_wrap_total,
        text_overlap_nodes: probe.text_overlap_nodes,
        text_overlap_total: probe.text_overlap_total,
        paired_semantics_violations: probe.paired_semantics_violations,
        paired_semantics_total: probe.paired_semantics_total,
        column_lane_nodes: probe.column_lane_nodes,
        column_lane_total: probe.column_lane_total,
        scroll_tables: probe.scroll_tables,
        slot_count: probe.slot_multiset.length,
        visible_slot_count: probe.visible_slot_count,
        reachable_slot_count: probe.reachable_slot_count,
        distinct_text_count: probe.dom_text.length,
        file,
        sha256: sha256(png),
        dimensions: image.getSize(),
        __domText: probe.dom_text,
        __slots: probe.slot_multiset,
      });
    }
    for (const preset of BOARD_BREAKPOINT_PROBE_PRESETS) {
      win.setContentSize(preset.width, preset.height);
      await settleBoardLayout(win, surface.instanceId);
      const probe = await win.webContents.executeJavaScript(boardStepProbe(surface.instanceId));
      if (probe.error) throw new Error(`board ${surface.boardId} ${preset.name}: ${probe.error}`);
      if (probe.container_width < preset.minContainer || probe.container_width > preset.maxContainer) {
        // 숨은 창은 리사이즈에 반응하지 않는다(레이아웃이 멈춘다) — 그러면 컨테이너가
        // 직전 프리셋 폭 그대로 읽혀 "반응형이 안 돈다"처럼 보인다. 실패에 창 상태를
        // 같이 실어 그 두 원인을 갈라 준다.
        const visibility = await win.webContents.executeJavaScript('document.visibilityState');
        throw new Error(
          `board ${surface.boardId} ${preset.name}: container ${probe.container_width}px outside ${
            preset.minContainer}..${preset.maxContainer}px (visibilityState=${visibility})`,
        );
      }
      assertSurfaceGeometry(surface.boardId, preset, probe);
      assertBreakpointContract(surface.boardId, preset, probe);
      assertReadability(surface.boardId, preset, probe, { enforce: true });
      breakpointProbes.push({
        preset: preset.name,
        window: { width: preset.width, height: preset.height },
        container_width: probe.container_width,
        overflow_x: probe.overflow_x,
        overflow_nodes: probe.overflow_nodes,
        all_columns: probe.all_columns,
        folded_columns: probe.folded_columns,
        paired_columns: probe.paired_columns,
        primary_rect: probe.primary_rect,
        rail_rect: probe.rail_rect,
        kpi_row_counts: probe.kpi_row_counts,
        kpi_max_columns: probe.kpi_max_columns,
        vertical_overflow_nodes: probe.vertical_overflow_nodes,
        vertical_overlap_nodes: probe.vertical_overlap_nodes,
        atomic_wrap_nodes: probe.atomic_wrap_nodes,
        atomic_wrap_total: probe.atomic_wrap_total,
        text_overlap_nodes: probe.text_overlap_nodes,
        text_overlap_total: probe.text_overlap_total,
        paired_semantics_violations: probe.paired_semantics_violations,
        paired_semantics_total: probe.paired_semantics_total,
        column_lane_nodes: probe.column_lane_nodes,
        column_lane_total: probe.column_lane_total,
        scroll_tables: probe.scroll_tables,
        slot_count: probe.slot_multiset.length,
        visible_slot_count: probe.visible_slot_count,
        reachable_slot_count: probe.reachable_slot_count,
        distinct_text_count: probe.dom_text.length,
        __domText: probe.dom_text,
        __slots: probe.slot_multiset,
      });
    }
  } finally {
    win.setContentSize(originalBounds.width, originalBounds.height);
    await settleBoardLayout(win, surface.instanceId);
  }

  // P5 — 단계 사이에서 텍스트가 사라지지 않는다. 접힘은 이동이지 삭제가 아니다.
  const base = steps[0];
  const paritySteps = [...steps, ...breakpointProbes];
  for (const step of paritySteps.slice(1)) {
    if (JSON.stringify(step.__domText) !== JSON.stringify(base.__domText)) {
      throw new Error(
        `board ${surface.boardId} ${step.preset}: DOM 텍스트 다중집합이 ${base.preset}과 다르다`,
      );
    }
    if (JSON.stringify(step.__slots) !== JSON.stringify(base.__slots)) {
      throw new Error(
        `board ${surface.boardId} ${step.preset}: 슬롯 텍스트 다중집합이 ${base.preset}과 다르다`,
      );
    }
  }
  // 도달 셈은 어느 단계에서도 같다 — 접힌 열의 값은 병기 줄로 내려온다.
  const reachableCounts = new Set(paritySteps.map((step) => step.reachable_slot_count));
  if (reachableCounts.size !== 1) {
    throw new Error(
      `board ${surface.boardId}: 단계마다 도달하는 슬롯 수가 다르다 — ${
        JSON.stringify([...reachableCounts])}`,
    );
  }
  // 접을 열이 있는 보드는 창이 좁아질수록 더 많이 접혀야 한다(비어 있는 상등은
  // 증명이 아니다). 표가 아예 없는 보드(실측 2QFO-2·135M-2 — 열 우선순위 0개)는
  // 접을 것이 없으므로 뺀다. 접을 열이 있는지는 DOM이 말한다 — 목록을 손으로
  // 적지 않는다. 접힘 상한은 우선순위 4다(XS에서 4 이상이 전부 접힌다).
  const foldable = base.all_columns.some((priority) => Number(priority) >= 4);
  const foldedCounts = steps.map((step) => step.folded_columns.length);
  if (foldable && !(foldedCounts[foldedCounts.length - 1] > foldedCounts[0])) {
    throw new Error(
      `board ${surface.boardId}: 창이 좁아져도 접힌 열이 늘지 않았다 — ${
        JSON.stringify(steps.map((step) => [step.preset, step.container_width, step.folded_columns]))}`,
    );
  }
  for (let index = 1; index < foldedCounts.length; index += 1) {
    if (foldedCounts[index] < foldedCounts[index - 1]) {
      throw new Error(
        `board ${surface.boardId}: 창이 좁아졌는데 접힌 열이 줄었다 — ${JSON.stringify(foldedCounts)}`,
      );
    }
  }
  const widths = steps.map((step) => step.container_width);
  if (!(widths[0] > widths[widths.length - 1])) {
    throw new Error(`board ${surface.boardId}: 컨테이너 폭이 창을 따라 줄지 않았다 — ${JSON.stringify(widths)}`);
  }

  return {
    board_id: surface.boardId,
    card_id: surface.contract.card_id,
    slot_count: surface.slotCount,
    bound_slot_count: surface.boundCount,
    paint_receipt: {
      render_state: paint.render_state, verified_visible: paint.verified_visible,
    },
    text_multiset_equal_across_steps: true,
    distinct_text_count: base.__domText.length,
    max_overflow_x: Math.max(...paritySteps.map((step) => step.overflow_x)),
    steps: steps.map(({ __domText, __slots, ...rest }) => rest),
    breakpoint_probes: breakpointProbes.map(({ __domText, __slots, ...rest }) => rest),
  };
}

// ---------- 보드 primary: 라이브 차트가 보드 크롬 안에 선다 ----------
//
// 차트 봉투(renderer_id aits-chart-v1)는 그 자리가 저작된 보드로 간다(137X-2 —
// primary.renderer athena-chart). 보드가 껍질을 그리고 라이브 차트가 그 안 마운트
// 지점에 앉는지, Paper 목업은 지워지지 않고 접혔는지를 실앱 DOM에서 잰다.
const BOARD_CHART_BOARD_ID = '137X-2';
// 12봉(chart-card.js HISTORY_TRIGGER_BARS) 미만이면 마운트 즉시 과거 페이지 요청이
// 돌아 하네스가 시끄러워진다 — verify.js 검증13b와 같은 이유로 15봉을 준다.
const BOARD_CHART_CANDLES = Object.freeze(Array.from({ length: 15 }, (_, index) => {
  const day = String(4 + index).padStart(2, '0');
  const close = 70000 + index * 100;
  return {
    time: `2026-08-${day}`,
    open: close - 200, high: close + 300, low: close - 400, close, volume: 8000000 + index * 1000,
  };
}));

// 봉투가 보드로 가는 실제 채널은 athena:add-rest-canvas이고, 그 채널의 계약은
// paint ack 왕복이다(첫 ack는 pending, 마운트 결과가 확정 ack). 카드가 그려졌는지
// 만 보면 그 왕복이 끊겨도 초록으로 보인다 — 여기서 두 ack를 다 모아서 잰다.
function collectPaintAcks(itemId) {
  const acks = [];
  const onPainted = (_event, painted) => {
    if (painted && painted.item_id === itemId) acks.push(painted);
  };
  ipcMain.on('athena:rest-canvas-painted', onPainted);
  return {
    acks,
    stop: () => ipcMain.removeListener('athena:rest-canvas-painted', onPainted),
    // 확정 ack는 AITS 로드·마운트 뒤에 온다 — 첫 ack보다 늦다.
    waitForSettled: async () => {
      for (let tries = 0; tries < 120; tries += 1) {
        const settled = acks.find((ack) => ack.pending !== true);
        if (settled) return settled;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    },
  };
}

// 보드 차트 카드의 실측 DOM. 두 번째 봉투가 오면 root에 패널이 하나 더 붙으므로
// 보이는 패널만 읽는다 — 숨은 옛 패널을 읽으면 무엇이 살아 있는지 알 수 없다.
function readBoardChartDom(win, instanceId) {
  return win.webContents.executeJavaScript(`new Promise((resolve) => {
    const started = Date.now();
    const read = () => {
      const card = document.querySelector(
        '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
      if (!card) return { error: 'board card missing' };
      const panels = [...card.querySelectorAll('.integrated-card-panel')];
      const scope = panels.find((node) => !node.hidden) || card;
      const mount = scope.querySelector('[data-bs-primary-mounted]');
      const chartBody = mount && mount.querySelector('.chart-card-body');
      const rect = mount ? mount.getBoundingClientRect() : null;
      return {
        error: null,
        board_id: card.dataset.boardId || null,
        board_surface: card.dataset.boardSurface || null,
        board_nodes: scope.querySelectorAll('.board-surface [data-node]').length,
        render_state: card.dataset.renderState || null,
        chart_panel_id: card.dataset.chartPanelId || null,
        chart_generation: card.dataset.chartGeneration || null,
        primary_renderer: mount ? mount.dataset.bsPrimaryMounted : null,
        primary_error: (() => {
          const stamped = scope.querySelector('[data-bs-primary-error]');
          return stamped ? stamped.dataset.bsPrimaryError : null;
        })(),
        error_text: [...scope.querySelectorAll('.uk-error, [role="alert"]')]
          .map((node) => node.textContent).join(' | ') || null,
        chart_body_count: mount ? mount.querySelectorAll('.chart-card-body').length : 0,
        canvas_count: chartBody ? chartBody.querySelectorAll('canvas').length : 0,
        // 목업은 지운 것이 아니라 접은 것이다 — 자식 수는 그대로고 보이는 것만 없다.
        mockup_children: mount ? mount.children.length : 0,
        visible_mockup_children: mount
          ? [...mount.children].filter((node) => node !== chartBody && !node.hidden).length : 0,
        mount_width: rect ? Math.round(rect.width) : 0,
        mount_height: rect ? Math.round(rect.height) : 0,
        error_notes: scope.querySelectorAll('.uk-error, [role="alert"]').length,
      };
    };
    const check = () => {
      const probe = read();
      if (probe.canvas_count > 0 || probe.error_notes > 0 || Date.now() - started > 12000) {
        resolve(probe);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  })`);
}

function assertBoardChartMounted(label, dom) {
  if (dom.error) throw new Error(`board chart primary(${label}): ${dom.error}`);
  if (dom.board_id !== BOARD_CHART_BOARD_ID || dom.board_surface !== 'true') {
    throw new Error(`board chart primary(${label}): 차트 봉투가 보드로 가지 않았다 — ${JSON.stringify(dom)}`);
  }
  if (dom.primary_renderer !== 'athena-chart' || dom.canvas_count === 0 || dom.chart_body_count !== 1) {
    throw new Error(`board chart primary(${label}): 라이브 차트가 보드 자리에 서지 않았다 — ${JSON.stringify(dom)}`);
  }
  if (dom.visible_mockup_children !== 0 || dom.mockup_children < 2) {
    throw new Error(`board chart primary(${label}): Paper 목업 처리가 접기가 아니다 — ${JSON.stringify(dom)}`);
  }
  if (dom.error_notes !== 0 || dom.primary_error) {
    throw new Error(`board chart primary(${label}): 오류 문구가 남았다 — ${JSON.stringify(dom)}`);
  }
  if (dom.mount_width <= 0 || dom.mount_height <= 0 || dom.board_nodes < 100) {
    throw new Error(`board chart primary(${label}): 보드 크롬이 서지 않았다 — ${JSON.stringify(dom)}`);
  }
}

// 껍질 ack와 확정 ack가 계약대로 나갔는가. main은 이 값으로 재조회 권위를 세우고
// (chartReloadAuthority.registerPaint는 panel_id·renderer_id·generation을 요구한다)
// 데이터 카드를 집계한다 — 신원이 비면 주기 전환과 과거봉이 권위 없는 패널로 막히고,
// 마운트 결과가 아닌 낙관적 'data'가 새면 안 그려진 차트가 데이터 카드가 된다.
function assertBoardChartAcks(label, shell, settled, shellMs) {
  // 첫 피드백 3초 계약 — 보드 HTML을 먼저 붙이는 이유가 이것이다.
  if (!(shellMs < 3000)) {
    throw new Error(`board chart ack(${label}): 첫 ack가 3초를 넘겼다 — ${shellMs}ms`);
  }
  // 마운트가 아직이면 pending('loading'), 이미 끝났으면 그 결과('data')다.
  const expected = shell.pending === true ? 'loading' : 'data';
  if (shell.render_state !== expected) {
    throw new Error(`board chart ack(${label}): 껍질 ack의 상태가 마운트 결과와 어긋난다 — ${JSON.stringify(shell)}`);
  }
  // 두 단으로 갔으면 확정 ack는 껍질 ack와 다른 메시지여야 한다 — 같은 메시지가
  // 확정으로 통과하면 왕복이 끊겨도 초록으로 보인다. 어느 단으로 갔는지는
  // 마운트가 껍질 ack보다 빨랐는지에 달렸으므로 영수증(two_stage)에 그대로 남긴다.
  if (shell.pending === true && settled === shell) {
    throw new Error(`board chart ack(${label}): 확정 ack가 껍질 ack 그 자체다 — ${JSON.stringify(shell)}`);
  }
  if (!shell.panel_id || shell.renderer_id !== 'aits-chart-v1' || !Number.isInteger(shell.generation)) {
    throw new Error(`board chart ack(${label}): 껍질 ack에 패널 신원이 없다 — ${JSON.stringify(shell)}`);
  }
  if (!settled) {
    throw new Error(`board chart ack(${label}): 확정 ack가 오지 않았다`);
  }
  if (settled.render_state !== 'data' || settled.panel_id !== shell.panel_id
    || settled.renderer_id !== 'aits-chart-v1' || !Number.isInteger(settled.generation)) {
    throw new Error(`board chart ack(${label}): 확정 ack가 마운트 결과를 싣지 않았다 — ${JSON.stringify(settled)}`);
  }
}

async function exerciseBoardChartPrimary(win) {
  const surface = loadRealBoardContract(BOARD_CHART_BOARD_ID, 4, REAL_BOARD_TEMPLATE_ROOT);
  surface.instanceId = boardInstanceId(`${BOARD_CHART_BOARD_ID}-chart`);
  surface.cardTitle = '보드 차트 마운트 검수';
  surface.operationRef = 'base:ka10081';
  surface.envelopeExtra = {
    renderer_id: 'aits-chart-v1',
    data: {
      symbol: '005930',
      chart: {
        period: 'day', target: 'stock', trId: 'ka10081', candles: BOARD_CHART_CANDLES.slice(),
      },
    },
  };
  const collector = collectPaintAcks(surface.instanceId);
  let dom = null;
  let secondDom = null;
  let shell = null;
  let settled = null;
  let secondShell = null;
  let secondSettled = null;
  let shellMs = 0;
  let secondShellMs = 0;
  try {
    const startedAt = Date.now();
    shell = await sendBoardEnvelope(win, surface);
    shellMs = Date.now() - startedAt;
    await activateBoardTab(win, surface.instanceId);
    dom = await readBoardChartDom(win, surface.instanceId);
    settled = await collector.waitForSettled();
    assertBoardChartMounted('첫 봉투', dom);
    assertBoardChartAcks('첫 봉투', shell, settled, shellMs);

    // 주기 전환 — 같은 종목·같은 자리로 두 번째 차트 봉투가 온다. panelId는 같고
    // 컨테이너는 새것이라, 살아 있는 패널을 놓아주지 않으면 adapter가 던져 그 자리가
    // 목업으로 되돌아간다(2026-09-06 검토 지적).
    collector.acks.length = 0;
    const second = {
      ...surface,
      operationRef: 'base:ka10083',
      cardTitle: '보드 차트 주기 전환 검수',
      envelopeExtra: {
        renderer_id: 'aits-chart-v1',
        data: {
          symbol: '005930',
          chart: {
            period: 'month',
            target: 'stock',
            trId: 'ka10083',
            candles: BOARD_CHART_CANDLES.map((candle, index) => ({
              ...candle,
              open: candle.open + 500,
              high: candle.high + 500,
              low: candle.low + 500,
              close: candle.close + 500,
              // 월봉은 달마다 한 봉이다 — 같은 봉 수를 12달씩 끊어 채운다.
              time: `${2025 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`,
            })),
          },
        },
      },
    };
    const secondStartedAt = Date.now();
    secondShell = await sendBoardEnvelope(win, second);
    secondShellMs = Date.now() - secondStartedAt;
    await activateBoardTab(win, surface.instanceId);
    secondDom = await readBoardChartDom(win, surface.instanceId);
    secondSettled = await collector.waitForSettled();
    assertBoardChartMounted('주기 전환', secondDom);
    assertBoardChartAcks('주기 전환', secondShell, secondSettled, secondShellMs);
    if (secondSettled.panel_id !== settled.panel_id) {
      throw new Error(
        `board chart primary: 같은 자리의 두 번째 봉투가 다른 패널을 열었다 — ${
          JSON.stringify([settled.panel_id, secondSettled.panel_id])}`,
      );
    }
    if (!(secondSettled.generation > settled.generation)) {
      throw new Error(
        `board chart primary: 주기 전환이 generation을 올리지 않았다 — ${
          JSON.stringify([settled.generation, secondSettled.generation])}`,
      );
    }
  } finally {
    collector.stop();
  }
  return {
    board_id: BOARD_CHART_BOARD_ID,
    paint_receipt: { render_state: shell.render_state, verified_visible: shell.verified_visible },
    shell_ack_ms: shellMs,
    // 껍질 ack가 pending으로 나갔는가 = 마운트가 껍질 ack보다 늦었는가. 두 단
    // 왕복(pending→확정)이 실제로 돌았는지를 영수증에서 그대로 읽게 남긴다.
    two_stage: shell.pending === true,
    settled_ack: {
      render_state: settled.render_state, panel_id: settled.panel_id, generation: settled.generation,
    },
    period_switch: {
      shell_ack_ms: secondShellMs,
      two_stage: secondShell.pending === true,
      generation: secondSettled.generation,
      canvas_count: secondDom.canvas_count,
      error_notes: secondDom.error_notes,
    },
    ...dom,
  };
}

// ---------- 보드 primary: 호가 사다리가 보드 크롬 안에 선다 ----------
//
// 호가 봉투는 그 자리가 저작된 보드로 간다(13BC-2 — primary.renderer
// orderbook-ladder). 보드가 껍질을 그리고 10단 사다리가 그 안 마운트 지점에
// 앉는지, Paper 목업은 지워지지 않고 접혔는지, 0D 호가잔량 리스를 명시로 잡았다가
// 카드를 닫을 때 정확히 한 번 놓는지를 실앱 DOM에서 잰다.
const BOARD_ORDERBOOK_BOARD_ID = '13BC-2';
const BOARD_ORDERBOOK_SYMBOL = '005930';

// ka10007(주식호가요청) 모양 — 매도·매수 10단이 다 차야 사다리가 20행으로 선다.
function boardOrderbookFields() {
  const fields = [
    { key: 'stk_cd', value: BOARD_ORDERBOOK_SYMBOL },
    { key: 'stk_nm', value: '삼성전자' },
    { key: 'cur_prc', value: '150850' },
    { key: 'flu_rt', value: '1.24' },
    { key: 'tot_sel_req', value: '38160' },
    { key: 'tot_buy_req', value: '43000' },
  ];
  for (let level = 1; level <= 10; level += 1) {
    fields.push({ key: `sel_${level}bid`, value: String(150850 + level * 10) });
    fields.push({ key: `sel_${level}bid_req`, value: String(900 + level * 310) });
    fields.push({ key: `buy_${level}bid`, value: String(150840 - level * 10) });
    fields.push({ key: `buy_${level}bid_req`, value: String(1100 + level * 280) });
  }
  return fields;
}

// 0D는 카드가 실제로 열려 있을 때만 REG를 쓴다 — acquire/release가 짝이 아니면
// 리미터가 새거나 남의 카드 피드가 끊긴다. 두 채널을 다 모아서 짝을 센다.
function collectOrderbookLeaseCalls() {
  const calls = [];
  const onAcquire = (_event, payload) => calls.push({ kind: 'acquire', symbol: payload && payload.symbol });
  const onRelease = (_event, payload) => calls.push({ kind: 'release', symbol: payload && payload.symbol });
  ipcMain.on('athena:orderbook-realtime-acquire', onAcquire);
  ipcMain.on('athena:orderbook-realtime-release', onRelease);
  return {
    calls,
    stop: () => {
      ipcMain.removeListener('athena:orderbook-realtime-acquire', onAcquire);
      ipcMain.removeListener('athena:orderbook-realtime-release', onRelease);
    },
  };
}

function readBoardOrderbookDom(win, instanceId) {
  return win.webContents.executeJavaScript(`new Promise((resolve) => {
    const started = Date.now();
    const read = () => {
      const card = document.querySelector(
        '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
      if (!card) return { error: 'board card missing' };
      const panels = [...card.querySelectorAll('.integrated-card-panel')];
      const scope = panels.find((node) => !node.hidden) || card;
      const mount = scope.querySelector('[data-bs-primary-mounted]');
      const ladder = mount && mount.querySelector('.card-kit-hoga-live');
      const rect = mount ? mount.getBoundingClientRect() : null;
      return {
        error: null,
        board_id: card.dataset.boardId || null,
        board_surface: card.dataset.boardSurface || null,
        board_nodes: scope.querySelectorAll('.board-surface [data-node]').length,
        primary_renderer: mount ? mount.dataset.bsPrimaryMounted : null,
        primary_error: (() => {
          const stamped = scope.querySelector('[data-bs-primary-error]');
          return stamped ? stamped.dataset.bsPrimaryError : null;
        })(),
        ladder_count: mount ? mount.querySelectorAll('.card-kit-hoga-live').length : 0,
        ladder_rows: ladder ? ladder.querySelectorAll('.card-kit-hoga-live-row').length : 0,
        ask1_price: ladder
          ? (ladder.querySelector('[data-side="ask"][data-level="1"] [data-role="price"]') || {}).textContent
          : null,
        // 목업은 지운 것이 아니라 접은 것이다 — 자식 수는 그대로고 보이는 것만 없다.
        mockup_children: mount ? mount.children.length : 0,
        visible_mockup_children: mount
          ? [...mount.children].filter((node) => node !== ladder && !node.hidden).length : 0,
        mount_width: rect ? Math.round(rect.width) : 0,
        mount_height: rect ? Math.round(rect.height) : 0,
        error_notes: scope.querySelectorAll('.uk-error, [role="alert"]').length,
      };
    };
    const check = () => {
      const probe = read();
      if (probe.ladder_rows > 0 || probe.error_notes > 0 || Date.now() - started > 12000) {
        resolve(probe);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  })`);
}

function assertBoardOrderbookMounted(dom) {
  if (dom.error) throw new Error(`board orderbook primary: ${dom.error}`);
  if (dom.board_id !== BOARD_ORDERBOOK_BOARD_ID || dom.board_surface !== 'true') {
    throw new Error(`board orderbook primary: 호가 봉투가 보드로 가지 않았다 — ${JSON.stringify(dom)}`);
  }
  if (dom.primary_renderer !== 'orderbook-ladder' || dom.ladder_count !== 1 || dom.ladder_rows !== 20) {
    throw new Error(`board orderbook primary: 사다리가 보드 자리에 서지 않았다 — ${JSON.stringify(dom)}`);
  }
  if (dom.ask1_price !== '150,860') {
    throw new Error(`board orderbook primary: 최우선 매도호가가 봉투 값이 아니다 — ${JSON.stringify(dom)}`);
  }
  if (dom.visible_mockup_children !== 0 || dom.mockup_children < 2) {
    throw new Error(`board orderbook primary: Paper 목업 처리가 접기가 아니다 — ${JSON.stringify(dom)}`);
  }
  if (dom.error_notes !== 0 || dom.primary_error) {
    throw new Error(`board orderbook primary: 오류 문구가 남았다 — ${JSON.stringify(dom)}`);
  }
  if (dom.mount_width <= 0 || dom.mount_height <= 0 || dom.board_nodes < 100) {
    throw new Error(`board orderbook primary: 보드 크롬이 서지 않았다 — ${JSON.stringify(dom)}`);
  }
}

// 카드를 닫으면 보드가 잡은 0D 리스도 닫힌다 — 안 닫으면 REG가 남아 리미터를 먹는다.
async function closeBoardCard(win, instanceId) {
  const closed = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    const panel = root && root.closest('.canvas-tab-panel');
    if (!panel) return false;
    const close = document.querySelector(
      '.canvas-tab-strip .canvas-tab[data-tab-key="' + panel.dataset.tabKey + '"] .canvas-tab-close');
    if (!close) return false;
    close.click();
    return true;
  })()`);
  if (!closed) throw new Error('board orderbook primary: 카드를 닫을 탭을 못 찾았다');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function exerciseBoardOrderbookPrimary(win) {
  const surface = loadRealBoardContract(BOARD_ORDERBOOK_BOARD_ID, 5, REAL_BOARD_TEMPLATE_ROOT);
  surface.instanceId = boardInstanceId(`${BOARD_ORDERBOOK_BOARD_ID}-orderbook`);
  surface.cardTitle = '보드 호가 마운트 검수';
  surface.operationRef = 'detail:ka10007:bid_prices';
  surface.envelopeExtra = { card_title: '호가', data: { fields: boardOrderbookFields() } };
  const lease = collectOrderbookLeaseCalls();
  let dom = null;
  let shell = null;
  let shellMs = 0;
  try {
    const startedAt = Date.now();
    shell = await sendBoardEnvelope(win, surface);
    shellMs = Date.now() - startedAt;
    await activateBoardTab(win, surface.instanceId);
    dom = await readBoardOrderbookDom(win, surface.instanceId);
    assertBoardOrderbookMounted(dom);
    // 첫 피드백 3초 계약 — 사다리는 동기라 껍질 ack가 그대로 확정이다.
    if (!(shellMs < 3000)) {
      throw new Error(`board orderbook ack: 첫 ack가 3초를 넘겼다 — ${shellMs}ms`);
    }
    const acquires = lease.calls.filter((call) => call.kind === 'acquire');
    if (acquires.length !== 1 || acquires[0].symbol !== BOARD_ORDERBOOK_SYMBOL) {
      throw new Error(`board orderbook primary: 0D acquire가 한 번이 아니다 — ${JSON.stringify(lease.calls)}`);
    }
    await closeBoardCard(win, surface.instanceId);
    const releases = lease.calls.filter((call) => call.kind === 'release');
    if (releases.length !== 1 || releases[0].symbol !== BOARD_ORDERBOOK_SYMBOL) {
      throw new Error(`board orderbook primary: 0D release가 acquire와 짝이 아니다 — ${JSON.stringify(lease.calls)}`);
    }
  } finally {
    lease.stop();
  }
  return {
    board_id: BOARD_ORDERBOOK_BOARD_ID,
    paint_receipt: { render_state: shell.render_state, verified_visible: shell.verified_visible },
    shell_ack_ms: shellMs,
    lease_calls: lease.calls,
    ...dom,
  };
}

async function captureBoardResponsive(win, contracts, manager) {
  // 실시간 이음매는 픽스처 보드가 계속 맡는다 — 0B 시세 바인딩과 정본 값을
  // 함께 갖고 있는 유일한 보드다. 찍기는 하지 않는다(반응형은 실보드가 맡는다).
  const fixture = {
    ...loadBoardSurfaceContract(contracts),
    boardId: BOARD_ID,
    instanceId: boardInstanceId(BOARD_ID),
    ordinal: 3,
    cardTitle: '보드 실시간 이음매 검수',
  };
  const fixturePaint = await sendBoardEnvelope(win, fixture);
  await activateBoardTab(win, fixture.instanceId);
  const realtime = await exerciseBoardRealtime(win, manager, fixture);

  const boards = [];
  for (const [index, boardId] of REAL_BOARDS.entries()) {
    const surface = loadRealBoardContract(boardId, (index % 6) + 1, REAL_BOARD_TEMPLATE_ROOT);
    const captured = await captureBoardSteps(win, surface);
    captured.chrome = await inspectBoardChrome(win, surface);
    boards.push(captured);
  }

  const chartPrimary = await exerciseBoardChartPrimary(win);
  const orderbookPrimary = await exerciseBoardOrderbookPrimary(win);

  return {
    chart_primary: chartPrimary,
    orderbook_primary: orderbookPrimary,
    realtime_seam: {
      board_id: BOARD_ID,
      paint_receipt: {
        render_state: fixturePaint.render_state,
        verified_visible: fixturePaint.verified_visible,
      },
      ...realtime,
    },
    boards,
    max_overflow_x: Math.max(...boards.map((board) => board.max_overflow_x)),
  };
}

async function captureShellCard(win, card) {
  // 통합 카드는 캔버스 탭 덱 안에 산다 — 뷰포트에는 활성 탭 하나만 서고 나머지
  // 패널은 hidden이다. 찍기 전에 그 카드의 탭을 켜지 않으면 레이아웃 높이가
  // 0으로 나와 "detail rows did not become visibly laid out"으로 떨어진다.
  await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
    const panel = root && root.closest('.canvas-tab-panel');
    if (!panel) return false;
    const tab = document.querySelector(
      '.canvas-tab-strip .canvas-tab[data-tab-key="' + panel.dataset.tabKey + '"]');
    if (tab) tab.click();
    return Boolean(tab);
  })()`);
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const dom = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
    const rows = [...root.querySelectorAll('[data-field-occurrence-id]')];
    return {
      rootCount: document.querySelectorAll('#grid .integrated-card').length,
      nestedRootCount: document.querySelectorAll('#grid .integrated-card .integrated-card').length,
      cardId: root.dataset.cardId,
      operations: root.querySelectorAll('.semantic-detail-operation[data-operation-ref]').length,
      fields: rows.length,
      uniqueFields: new Set(rows.map((row) => row.dataset.fieldOccurrenceId)).size,
      coveredOperations: new Set(rows.map((row) => row.dataset.fieldOccurrenceId.split('|')[0])).size,
    };
  })()`);
  if (dom.rootCount !== 6 || dom.nestedRootCount !== 0 || dom.cardId !== card.card_id
    || dom.operations !== card.operation_count || dom.coveredOperations !== card.operation_count
    || dom.fields !== card.field_count
    || dom.uniqueFields !== card.field_count) {
    throw new Error(`${card.card_id}: actual shell Canvas DOM failed: ${JSON.stringify(dom)}`);
  }
  const screenshots = [];
  for (const detailOpen of [false, true]) {
    await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
      const detail = root.querySelector('.semantic-detail-sheet');
      detail.open = ${detailOpen};
      const scroller = root.querySelector('.card-body');
      if (${detailOpen}) {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        scroller.scrollTop = 0;
        root.scrollIntoView({ block: 'start' });
      }
    })()`);
    await win.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    if (detailOpen) {
      await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
          const detail = root.querySelector('.semantic-detail-sheet');
          const groups = detail.querySelector('.semantic-detail-groups');
          if (detail.open && groups.getBoundingClientRect().height > 0) {
            resolve();
            return;
          }
          if (Date.now() - started > 3000) {
            reject(new Error('${card.card_id}: detail rows did not become visibly laid out'));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      })`);
      await win.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
        const detail = root.querySelector('.semantic-detail-sheet');
        const scroller = root.querySelector('.card-body');
        if (!detail.open) throw new Error('${card.card_id}: detail state was reset before capture');
        scroller.scrollTop = scroller.scrollHeight;
        const rows = detail.querySelectorAll('[data-field-occurrence-id]');
        rows[rows.length - 1].scrollIntoView({ block: 'center' });
      })()`);
      await win.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(() => requestAnimationFrame(resolve), 120))',
      );
    }
    const captureState = await win.webContents.executeJavaScript(`(() => {
      const boot = document.getElementById('boot');
      const root = document.querySelector('#grid .integrated-card[data-card-id="${card.card_id}"]');
      const detail = root.querySelector('.semantic-detail-sheet');
      const groups = detail.querySelector('.semantic-detail-groups');
      const scroller = root.querySelector('.card-body');
      const bounds = root.getBoundingClientRect();
      const rows = detail.querySelectorAll('[data-field-occurrence-id]');
      const lastRowBounds = rows[rows.length - 1].getBoundingClientRect();
      return {
        bootVisible: Boolean(boot && getComputedStyle(boot).display !== 'none'),
        shellVisible: !document.getElementById('shell').hidden,
        rootVisible: getComputedStyle(root).display !== 'none',
        detailOpen: detail.open,
        detailRowsVisible: detail.open
          && detail.querySelectorAll('[data-field-occurrence-id]').length === ${card.field_count},
        detailGroupsHeight: groups.getBoundingClientRect().height,
        detailRowInRoot: detail.open
          && lastRowBounds.bottom > bounds.top && lastRowBounds.top < bounds.bottom,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        rect: {
          x: Math.max(0, Math.floor(bounds.x)),
          y: Math.max(0, Math.floor(bounds.y)),
          width: Math.max(1, Math.ceil(bounds.width)),
          height: Math.max(1, Math.ceil(bounds.height)),
        },
      };
    })()`);
    if (captureState.bootVisible || !captureState.shellVisible || !captureState.rootVisible
      || captureState.detailOpen !== detailOpen || (detailOpen && !captureState.detailRowsVisible)
      || (detailOpen && captureState.detailGroupsHeight <= 0)
      || (detailOpen && !captureState.detailRowInRoot)
      || (detailOpen && captureState.scrollHeight > captureState.clientHeight
        && captureState.scrollTop <= 0)) {
      throw new Error(`${card.card_id}: shell capture surface is obscured: ${JSON.stringify(captureState)}`);
    }
    const image = await win.webContents.capturePage(captureState.rect);
    const png = image.toPNG();
    const variant = detailOpen ? 'detail' : 'summary';
    const file = `${card.card_id}-${variant}.png`;
    fs.writeFileSync(path.join(CAPTURE_OUTPUT_DIR, file), png);
    screenshots.push({
      variant, file, sha256: sha256(png), dimensions: image.getSize(), captureState,
    });
  }
  if (screenshots[0].sha256 === screenshots[1].sha256) {
    throw new Error(`${card.card_id}: summary/detail screenshots are identical`);
  }
  return { dom, screenshots };
}

async function inspect(win, cardId, detailOpen, expectedFields, expectedOperations) {
  await win.webContents.executeJavaScript(
    `window.renderIntegratedCardFixture(${JSON.stringify(cardId)}, ${detailOpen})`,
  );
  await win.webContents.executeJavaScript(
    `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  const dom = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('.integrated-card');
    const occurrences = [...document.querySelectorAll('[data-field-occurrence-id]')];
    const detail = root?.querySelector('.semantic-detail-sheet');
    return {
      rootCount: document.querySelectorAll('.integrated-card').length,
      nestedRootCount: document.querySelectorAll('.integrated-card .integrated-card').length,
      cardId: root?.dataset.cardId,
      fieldCount: occurrences.length,
      uniqueOccurrenceCount: new Set(occurrences.map((node) => node.dataset.fieldOccurrenceId)).size,
      // Product copy must not leak fixture/sentinel wire tokens (cc-01).
      sentinelLeakCount: occurrences.filter((node) => /^(?:fixture|sentinel)::/i.test(node.querySelector('.semantic-detail-value')?.textContent || '')).length,
      operationCount: document.querySelectorAll('.semantic-detail-operation[data-operation-ref]').length,
      detailOpen: Boolean(detail?.open),
      productionSurfaceLoaded: Boolean(window.AthenaLib?.IntegratedCardSurface),
      productionDetailSheetLoaded: Boolean(window.AthenaLib?.SemanticDetailSheet),
      fallbackSample: occurrences.slice(0, 12).map((node) => ({ id: node.dataset.fieldOccurrenceId, path: node.dataset.jsonPath })),
    };
  })()`);
  if (dom.rootCount !== 1 || dom.nestedRootCount !== 0 || dom.cardId !== cardId) {
    throw new Error(`${cardId}: root/nested-card contract failed: ${JSON.stringify(dom)}`);
  }
  if (!dom.productionSurfaceLoaded || !dom.productionDetailSheetLoaded || (
    dom.fieldCount !== expectedFields
    || dom.uniqueOccurrenceCount !== expectedFields
    || dom.sentinelLeakCount !== 0
    || dom.operationCount !== expectedOperations
  )) throw new Error(`${cardId}: production field occurrence DOM coverage failed: ${JSON.stringify(dom)}`);
  if (dom.detailOpen !== detailOpen) throw new Error(`${cardId}: detail open state failed`);

  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  const variant = detailOpen ? 'detail' : 'summary';
  const fileName = `${cardId}-${variant}.png`;
  fs.writeFileSync(path.join(CAPTURE_OUTPUT_DIR, fileName), png);
  return {
    variant,
    file: fileName,
    sha256: sha256(png),
    dimensions: image.getSize(),
    dom,
  };
}

async function main() {
  validateRealBoards();
  const prunedBoardCaptures = CANONICAL_CAPTURE_RUN
    ? pruneUnexpectedBoardCaptures({
      captureDir: CAPTURE_OUTPUT_DIR,
      canonicalCaptureDir: CAPTURE_DIR,
      expectedNames: EXPECTED_CANONICAL_BOARD_CAPTURES,
      allowedStaleNames: KNOWN_STALE_BOARD_CAPTURE_NAMES,
    })
    : [];
  const bundle = loadBundle();
  const semanticContracts = loadProductionSemanticContracts();
  if (
    bundle.operation_count !== 299
    || bundle.field_occurrence_count !== 3705
    || bundle.unique_field_path_count !== 3703
  ) throw new Error('canonical fixture totals drifted');
  if (!bundle.fixture_only || bundle.external_calls_allowed) {
    throw new Error('fixture side-effect boundary is not closed');
  }

  await app.whenReady();
  const shellIpcRecords = [];
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
  const shellRealtimeTransportCalls = [];
  const shellRealtimeStates = [];
  const shellRealtimeManager = new CardLeaseManager({
    transport: {
      acquire: async (binding) => {
        shellRealtimeTransportCalls.push({ action: 'REG', binding });
        return true;
      },
      release: async (binding) => {
        shellRealtimeTransportCalls.push({ action: 'REMOVE', binding });
        return true;
      },
      reconnect: async (bindings) => {
        shellRealtimeTransportCalls.push({ action: 'RECONNECT', bindings });
        return bindings.map((binding) => ({ binding, ok: true, error: null }));
      },
      command: async () => ({ ok: true }),
    },
    semanticBindingSourceProvider: productionSemanticBindingProvider(semanticContracts),
    onState: (state) => {
      shellRealtimeStates.push(state);
      if (!win.isDestroyed()) {
        win.webContents.send('athena:integrated-card-realtime-state', state);
      }
    },
  });
  registerSafeShellIpc(shellIpcRecords, shellRealtimeManager);
  let blockedExternalRequests = 0;
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) {
      blockedExternalRequests += 1;
      callback({ cancel: true });
      return;
    }
    callback({ cancel: false });
  });

  try {
    await win.loadFile(path.join(APP, 'integrated-cards-fixture.html'));
    await win.webContents.executeJavaScript(
      `window.loadIntegratedCardFixtures(${JSON.stringify(bundle)})`,
    );
    const report = {
      generated_at: new Date().toISOString(),
      fixture_only: true,
      external_calls_allowed: false,
      blocked_external_requests: 0,
      readability_gate: {
        enforced: true,
        canonical: CANONICAL_CAPTURE_RUN,
        board_ids: [...REAL_BOARDS],
      },
      capture_hygiene: {
        canonical: CANONICAL_CAPTURE_RUN,
        pruned_before_run: prunedBoardCaptures,
      },
      totals: {
        cards: bundle.cards.length,
        operations: bundle.operation_count,
        fields: bundle.field_occurrence_count,
        unique_paths: bundle.unique_field_path_count,
        missing: 0,
        unresolved: 0,
      },
      duplicate_paths: bundle.duplicate_paths,
      cards: [],
    };
    let renderedFields = 0;
    for (const card of bundle.cards) {
      const summary = await inspect(win, card.card_id, false, card.field_count, card.operation_count);
      const detail = await inspect(win, card.card_id, true, card.field_count, card.operation_count);
      renderedFields += detail.dom.fieldCount;
      const trace = await productionRealtimeTrace(card, semanticContracts);
      if (card.realtime_required) {
        const actions = trace.calls.map((item) => item[0]);
        if (!actions.includes('REG') || !actions.includes('REMOVE')
          || !actions.includes('RECONNECT') || trace.tick_count < 1) {
          throw new Error(`${card.card_id}: realtime lifecycle trace failed`);
        }
      } else if (trace.calls.length !== 0) {
        throw new Error(`${card.card_id}: static/order fixture attempted realtime lifecycle`);
      }
      report.cards.push({
        card_id: card.card_id,
        card_kind: card.card_kind,
        operations: card.operation_count,
        fields: card.field_count,
        missing: 0,
        opaque: card.opaque_count,
        realtime_required: card.realtime_required,
        realtime_trace: trace,
        screenshots: [summary, detail],
      });
    }
    if (renderedFields !== 3705) throw new Error(`rendered ${renderedFields}/3705 fields`);

    // Final screenshots and DOM receipts come from the real shell.html +
    // canvas.js event path. Every canonical operation envelope is dispatched
    // separately; the production surface must aggregate them into six roots.
    await win.loadFile(path.join(APP, 'shell.html'));
    await win.webContents.executeJavaScript('window.__ATHENA_DEVELOPER_DIAGNOSTICS__ = true');
    win.show();
    const bootState = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const boot = document.getElementById('boot');
        const shell = document.getElementById('shell');
        if (boot.dataset.phase === 'complete' && boot.hidden && !shell.hidden
          && !shell.classList.contains('is-onboarding-hidden')) {
          resolve({ phase: boot.dataset.phase, finishCount: Number(boot.dataset.finishCount),
            startupPhase: boot.dataset.startupPhase, localReadiness: boot.dataset.localReadiness });
          return;
        }
        if (Date.now() - started > 10000) {
          reject(new Error('fixture shell boot did not reach the production complete phase'));
          return;
        }
        requestAnimationFrame(check);
      };
      check();
    })`);
    if (bootState.finishCount !== 1 || bootState.startupPhase !== 'ready'
      || bootState.localReadiness !== 'ready') {
      throw new Error(`actual shell boot contract failed: ${JSON.stringify(bootState)}`);
    }
    // 계측 전에 창이 실제로 보이는 상태인지 한 번 못박는다. 여기서 hidden이면
    // 그 뒤 299회 paint ack이 전부 「wall-clock timeout」으로 나와 원인이 카드처럼
    // 읽힌다 — 원인을 이름 그대로 부르는 실패가 그것보다 낫다.
    const shellVisibility = await win.webContents.executeJavaScript('document.visibilityState');
    if (shellVisibility !== 'visible') {
      throw new Error(
        `계측 창이 보이지 않는다(visibilityState=${shellVisibility}) — 다른 창이 덮었거나 최소화됐다.`
        + ' 가림 판정은 CalculateNativeWinOcclusion 비활성으로 막아 두었으니, 이 실패는 창이 실제로 최소화된 경우다.',
      );
    }
    report.actual_shell_visibility = shellVisibility;
    await win.webContents.executeJavaScript(
      'window.AthenaCanvasMode.setView("summary")',
    );
    report.actual_shell_boot = bootState;
    let dispatchedOperations = 0;
    for (const [cardIndex, card] of bundle.cards.entries()) {
      for (const fixture of card.operation_fixtures) {
        await sendRestEnvelope(win, card, fixture, cardIndex + 1);
        dispatchedOperations += 1;
      }
    }
    if (dispatchedOperations !== 299) {
      throw new Error(`actual shell dispatched ${dispatchedOperations}/299 operations`);
    }
    report.actual_shell_dispatched_operations = dispatchedOperations;
    report.actual_shell_semantic_snapshot = await installProductionSemanticSnapshot(
      win, shellRealtimeManager, semanticContracts,
    );
    report.actual_shell_realtime = await exerciseShellRealtime(
      win, shellRealtimeManager, semanticContracts,
    );
    for (const card of bundle.cards) {
      const shellCapture = await captureShellCard(win, card);
      const entry = report.cards.find((item) => item.card_id === card.card_id);
      entry.production_module_preflight = entry.screenshots.map((item) => item.dom);
      entry.screenshots = shellCapture.screenshots;
      entry.actual_shell_dom = shellCapture.dom;
    }

    // 순위 모드 시나리오 — 랭킹 operation이 ranking/ranked-results 표현으로 오면
    // CC-03 root에 '순위' 탭 하나가 생기고, 패널 맨 위에 축 스트립(18칩 · 활성 1)이
    // 서며, 비활성 칩 클릭은 seedChatInput 버스로 질문을 심는다(조회를 발명하지
    // 않는다 — Paper R01-T4~T6 · R03-T6 계약).
    {
      const cc03Index = bundle.cards.findIndex((card) => card.card_id === 'CC-03');
      const cc03 = bundle.cards[cc03Index];
      const rankingFixture = cc03.operation_fixtures.find(
        (fixture) => fixture.operation_ref === 'base:ka10019',
      );
      if (!rankingFixture) throw new Error('ranking scenario fixture base:ka10019 missing');
      await sendRestEnvelope(win, cc03, rankingFixture, cc03Index + 1, {
        mode: 'ranking', section: 'ranked-results',
      });
      // 칩은 operationRef를 어떤 속성에도 싣지 않는다(title 포함) — 제품 DOM의 원시
      // 식별자 누출 게이트(verify-semantic-workspaces)와 같은 계약이다(2026-09-04).
      // 그래서 축은 한국어 라벨로 찾는다. 라벨은 렌더러와 같은 표(ranking-axis.js)에서 읽는다.
      const axisItems = Object.values(require('./lib/ranking-axis').RANKING_AXES)
        .flatMap((groups) => groups.flatMap((group) => group.items));
      const axisLabelFor = (ref) => {
        const item = axisItems.find((entry) => entry.operationRef === ref);
        if (!item) throw new Error(`ranking axis ${ref} missing from ranking-axis.js`);
        return item.label;
      };
      const activeAxisLabel = axisLabelFor('base:ka10019');
      const siblingAxisLabel = axisLabelFor('base:ka10024');
      const rankingDom = await win.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('#grid .integrated-card[data-card-id="CC-03"]');
        const tabs = Array.from(root.querySelectorAll('.integrated-card-tab'));
        const rankingTabs = tabs.filter((tab) => tab.textContent.trim() === '순위');
        const panel = Array.from(root.querySelectorAll('.integrated-card-panel'))
          .find((node) => node.classList.contains('integrated-card-panel--ranking'));
        const strip = panel && panel.querySelector(':scope > .ranking-axis-strip');
        const chips = strip ? Array.from(strip.querySelectorAll('.ranking-axis-chip')) : [];
        const active = chips.filter((chip) => chip.classList.contains('is-active'));
        const seeded = [];
        const shell = window.AthenaShell || (window.AthenaShell = {});
        const priorSeed = shell.seedChatInput;
        shell.seedChatInput = (text) => seeded.push(text || '');
        const target = chips.find((chip) => chip.textContent.trim() === ${JSON.stringify(siblingAxisLabel)});
        if (target) target.click();
        shell.seedChatInput = priorSeed;
        return {
          ranking_tab_count: rankingTabs.length,
          chip_count: chips.length,
          active_labels: active.map((chip) => chip.textContent.trim()),
          active_disabled: active.every((chip) => chip.disabled),
          leaked_titles: chips.map((chip) => chip.getAttribute('title')).filter(Boolean),
          seeded,
        };
      })()`);
      if (rankingDom.ranking_tab_count !== 1) {
        throw new Error(`ranking tab count ${rankingDom.ranking_tab_count} !== 1`);
      }
      if (rankingDom.chip_count !== 18) {
        throw new Error(`CC-03 ranking axis chips ${rankingDom.chip_count} !== 18`);
      }
      if (rankingDom.active_labels.join(',') !== activeAxisLabel || !rankingDom.active_disabled) {
        throw new Error(`ranking active axis mismatch: ${JSON.stringify(rankingDom.active_labels)} !== ${JSON.stringify(activeAxisLabel)}`);
      }
      if (rankingDom.leaked_titles.length) {
        throw new Error(`ranking axis chips leak raw refs via title: ${JSON.stringify(rankingDom.leaked_titles)}`);
      }
      if (rankingDom.seeded.length !== 1 || !/[가-힣]/.test(rankingDom.seeded[0])) {
        throw new Error(`ranking axis click did not seed chat input: ${JSON.stringify(rankingDom.seeded)}`);
      }
      report.actual_shell_ranking_mode = rankingDom;
    }
    report.actual_shell_board_responsive = await captureBoardResponsive(
      win, semanticContracts, shellRealtimeManager,
    );
    if (CANONICAL_CAPTURE_RUN) {
      const boards = report.actual_shell_board_responsive.boards;
      Object.assign(report.readability_gate, assertReadabilityMatrix(boards, {
        expectedBoardIds: DEFAULT_REAL_BOARDS,
        stepPresets: BOARD_WINDOW_PRESETS,
        breakpointPresets: BOARD_BREAKPOINT_PROBE_PRESETS,
      }));
      const reportBoardCaptureRecords = boards.flatMap(
        (board) => board.steps,
      );
      Object.assign(report.capture_hygiene, assertBoardCaptureArtifacts({
        captureDir: CAPTURE_OUTPUT_DIR,
        canonicalCaptureDir: CAPTURE_DIR,
        expectedNames: EXPECTED_CANONICAL_BOARD_CAPTURES,
        records: reportBoardCaptureRecords,
      }));
    }

    await win.webContents.executeJavaScript('window.AthenaShell.clearCanvases()');
    const mountedLeaseIds = [...new Set(shellIpcRecords
      .filter((item) => item.channel === 'athena:integrated-card-realtime-mount'
        && item.result && item.result.ok)
      .map((item) => item.result.leaseId))];
    const cleanupDeadline = Date.now() + 3000;
    while (mountedLeaseIds.some((leaseId) => shellRealtimeManager.status(leaseId))) {
      if (Date.now() > cleanupDeadline) {
        throw new Error('Canvas clear did not unmount every realtime lease');
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const cleanup = await shellRealtimeManager.releaseAll();
    if (!cleanup.ok || cleanup.pending !== 0 || cleanup.results.length !== 0) {
      throw new Error(`realtime manager retained leases after Canvas clear: ${JSON.stringify(cleanup)}`);
    }
    const transportActions = shellRealtimeTransportCalls.map((item) => item.action);
    if (!transportActions.includes('REG') || !transportActions.includes('REMOVE')) {
      throw new Error(`actual shell realtime transport lifecycle incomplete: ${transportActions}`);
    }
    if (shellIpcRecords.some((item) =>
      (item.channel === 'athena:integrated-card-realtime-mount'
        || item.channel === 'athena:integrated-card-realtime-update')
      && item.payload && item.payload.cardId === 'CC-02')) {
      throw new Error('order card attempted to mount realtime');
    }
    report.actual_shell_realtime.transport_calls = shellRealtimeTransportCalls;
    report.actual_shell_realtime.states = shellRealtimeStates;
    report.actual_shell_realtime.cleanup = cleanup;
    report.actual_shell_realtime.mounted_lease_ids = mountedLeaseIds;
    report.shell_ipc_trace = shellIpcRecords.filter((item) =>
      item.channel.startsWith('athena:integrated-card-realtime'));
    report.blocked_external_requests = blockedExternalRequests;
    const reportPath = path.join(CAPTURE_OUTPUT_DIR, 'VERIFY-INTEGRATED-CARDS.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, ...report.totals }, null, 2));
  } finally {
    win.destroy();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
