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

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const BACKEND = path.join(ROOT, 'backend');
const CAPTURE_DIR = path.join(APP, 'captures', 'integrated-cards');

// 백엔드 의존성(fastapi·pydantic 등)은 backend/.venv에만 있다. PATH의 맨 python으로
// 부르면 ModuleNotFoundError로 죽는다 — mcp-config.js의 PYTHON_EXE와 같은 경로를 쓴다.
const VENV_PYTHON = path.join(BACKEND, '.venv', 'Scripts', 'python.exe');
const FIXTURE_PYTHON = process.env.ATHENA_FIXTURE_PYTHON
  || (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python');

fs.mkdirSync(CAPTURE_DIR, { recursive: true });
app.setPath('userData', path.join(CAPTURE_DIR, '.electron-user-data'));
app.disableHardwareAcceleration();

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

function realtimeConfig(cardId, leaseId, target) {
  const base = { leaseId, cardId };
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
      if (channel === 'athena:integrated-card-realtime-mount') {
        result = await realtimeManager.mount(payload);
      }
      if (channel === 'athena:integrated-card-realtime-update') {
        result = await realtimeManager.update(payload);
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
const BOARD_WINDOW_PRESETS = Object.freeze([
  { name: '원본', width: 1920, height: 1080 },
  { name: '2분할', width: 960, height: 1080 },
  { name: '4분할', width: 640, height: 540 },
  { name: '최소', width: 480, height: 420 },
]);

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
      state_boards: [],
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

// 카드 6종의 kind — 봉투의 card_kind가 card_id와 안 맞으면 통합 카드 판정이
// 닫히고(integratedDefinition) 보드가 아예 안 선다.
const CARD_KIND = Object.freeze({
  'CC-01': 'account', 'CC-02': 'order', 'CC-03': 'instrument',
  'CC-04': 'orderbook', 'CC-05': 'flow', 'CC-06': 'explorer',
});

// view_instance_id는 normalizeIdentity를 거쳐 소문자가 된다 — DOM에서 찾을 때
// 쓰는 키도 같은 규칙으로 만든다(대문자 보드 id를 그대로 쓰면 못 찾는다).
function boardInstanceId(boardId) {
  return `board-${String(boardId).toLowerCase()}`;
}

async function sendBoardEnvelope(win, surface) {
  const instanceId = surface.instanceId;
  const correlation = {
    dataset_id: 'all-kiwoom-integrated-cards',
    item_id: instanceId,
    // ordinal은 1..6만 유효하다(rest-canvas-paint.isValidCorrelation) — 영수증은
    // item_id로 가려내므로 카드 서수와 겹쳐도 섞이지 않는다.
    ordinal: surface.ordinal || 3,
  };
  const receipt = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
      reject(new Error(`board surface ${surface.boardId}: shell paint receipt timeout`));
    }, 15000);
    function onPainted(_event, painted) {
      if (!painted || painted.item_id !== correlation.item_id) return;
      clearTimeout(timer);
      ipcMain.removeListener('athena:rest-canvas-painted', onPainted);
      if (painted.render_state === 'error') {
        reject(new Error(`board surface ${surface.boardId}: ${painted.error}`));
        return;
      }
      resolve(painted);
    }
    ipcMain.on('athena:rest-canvas-painted', onPainted);
    win.webContents.send('athena:add-rest-canvas', {
      operationRef: surface.operationRef,
      operationArgs: { stk_cd: '005930' },
      canvasType: 'facts',
      envelope: {
        card_id: surface.contract.card_id,
        card_kind: CARD_KIND[surface.contract.card_id],
        capability: 'quote',
        mode: 'quote',
        section: 'board-surface',
        // 통합 카드 6장과 같은 탭을 뺏지 않게 자기 인스턴스로 연다.
        view_instance_id: instanceId,
        operation_ref: surface.operationRef,
        canvas_type: 'facts',
        card_title: surface.cardTitle,
        fell_back: false,
        correlation,
        surface_contract: surface.contract,
        realtime_bindings: surface.realtimeBindings || [],
        operation_refs: [surface.operationRef],
      },
    });
  });
  return receipt;
}

// 보드 카드는 자기 탭에 산다 — 찍기 전에 그 탭을 켜고(다른 탭이 활성이면 패널이
// hidden이라 높이가 0으로 나온다) 보드가 실제로 설 때까지 기다린다. 원문 HTML은
// 카드 청크에 있어 첫 마운트가 비동기다.
async function activateBoardTab(win, instanceId) {
  const activated = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    const panel = root && root.closest('.canvas-tab-panel');
    if (!panel) return false;
    const tab = document.querySelector(
      '.canvas-tab-strip .canvas-tab[data-tab-key="' + panel.dataset.tabKey + '"]');
    if (tab) tab.click();
    return Boolean(tab);
  })()`);
  if (!activated) throw new Error(`board surface ${instanceId}: canvas tab was not found`);
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const root = document.querySelector(
        '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
      if (root && root.querySelector('.board-surface')) return resolve(true);
      if (Date.now() - started > 10000) return reject(new Error('board surface never mounted'));
      requestAnimationFrame(check);
    };
    check();
  })`);
}

// 창 크기를 바꾼 뒤 레이아웃이 멎을 때까지 기다린다. rAF 2번으로는 모자란다 —
// 창 리사이즈가 비동기라 아직 옛 폭에서 잰 값이 섞이고(실측: 같은 단계가
// 실행마다 377/537px로 흔들렸다), 컨테이너 쿼리는 그 폭으로 다시 돈다.
async function settleBoardLayout(win, instanceId) {
  return win.webContents.executeJavaScript(`new Promise((resolve) => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
    const surface = root && root.querySelector('.board-surface');
    let last = -1;
    let stable = 0;
    let frames = 0;
    const tick = () => {
      const now = surface ? Math.round(surface.getBoundingClientRect().width) : 0;
      stable = now === last ? stable + 1 : 0;
      last = now;
      frames += 1;
      if (stable >= 4 || frames > 180) return resolve(now);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
}

// 한 단계의 측정.
//
// 두 가지를 센다.
//   1) 보드 DOM 전체의 텍스트 다중집합 — responsive가 노드를 지우지 않았다는 증거.
//   2) 슬롯별 (텍스트, 화면 도달 여부) 다중집합 — 값이 화면에서 사라지지 않았다는
//      증거. `도달`은 그 슬롯의 잎이 보이거나, 그 열을 대신 받는 병기 줄이 보이는
//      것이다(계획 §2 "접힌 열은 삭제가 아니라 셀 병기로 내려간다").
// 병기 줄(.bs-paired) 자체는 값의 1차 표현이 아니라 접힘의 착지점이라 도달 판정에서
// 뺀다 — XL에서 숨어 있는 것이 정상이다. 영값 묶음(H1)으로 접힌 레일 행도 열이
// 없어 도달 0이지만, 그 0이 네 단계 모두 같으므로 상등 검사가 그대로 성립한다.
const boardStepProbe = (instanceId) => `(() => {
  const root = document.querySelector(
    '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
  if (!root) return { error: 'board card not found' };
  const surface = root.querySelector('.board-surface');
  if (!surface) return { error: 'board surface not mounted' };
  const shown = (node) => node.getClientRects().length > 0;

  const domText = new Map();
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (text) domText.set(text, (domText.get(text) || 0) + 1);
  }

  const pairedCols = new Set();
  for (const paired of surface.querySelectorAll('.bs-paired')) {
    if (!shown(paired)) continue;
    for (const token of String(paired.dataset.pairedCol || '').split(/\\s+/)) {
      if (token) pairedCols.add(token);
    }
  }
  const columnOf = (node) => {
    for (let el = node; el && el !== surface; el = el.parentElement) {
      if (el.dataset && el.dataset.colPriority) return el.dataset.colPriority;
    }
    return null;
  };

  const slots = [];
  let visibleSlotCount = 0;
  let reachableSlotCount = 0;
  for (const leaf of surface.querySelectorAll('[data-slot-id]')) {
    if (leaf.closest('.bs-paired')) continue;
    const column = columnOf(leaf);
    const visible = shown(leaf);
    const reachable = visible || Boolean(column && pairedCols.has(column));
    if (visible) visibleSlotCount += 1;
    if (reachable) reachableSlotCount += 1;
    slots.push([
      leaf.dataset.slotId, leaf.textContent.trim(), reachable ? '1' : '0',
    ].join('\\u0000'));
  }

  // 접힌 열은 래퍼의 계산된 display로 센다. .bs-col은 XL에서 \`display: contents\`라
  // 자기 상자가 없다 — 화면 사각형으로 재면 어느 단계에서도 "안 보임"이 나와
  // "전부 접혔다"는 빈 신호가 된다(실보드 6장에서 그렇게 나왔다). 게다가 실추출
  // 보드에서는 열 셀과 병기 span이 같은 Paper 노드 id를 나눠 써서 슬롯 텍스트가
  // 병기 쪽에 앉는다 — 열 안에 값 잎이 0개라, 잎으로도 접힘을 못 잰다.
  const allColumns = new Set();
  const foldedSet = new Set();
  for (const node of surface.querySelectorAll('[data-col-priority]')) {
    allColumns.add(node.dataset.colPriority);
    if (getComputedStyle(node).display === 'none') foldedSet.add(node.dataset.colPriority);
  }
  const foldedColumns = [...foldedSet].sort();

  return {
    dom_text: [...domText.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    slot_multiset: slots.sort(),
    all_columns: [...allColumns].sort(),
    visible_slot_count: visibleSlotCount,
    reachable_slot_count: reachableSlotCount,
    folded_columns: foldedColumns,
    paired_columns: [...pairedCols].sort(),
    container_width: Math.round(surface.getBoundingClientRect().width),
    // 보드가 자기 칸보다 넓으면 가로 스크롤이 생긴다 — 계획 §2는 세로 스크롤만
    // 허용한다. 판정하지 않고 실측만 남긴다(레인 A/C가 읽을 원시값).
    overflow_x: Math.max(0, surface.scrollWidth - Math.round(surface.getBoundingClientRect().width)),
    host_client_width: surface.parentElement ? surface.parentElement.clientWidth : null,
    // 넘침이 남으면 어느 상자가 냈는지 함께 남긴다 — 숫자만으로는 못 고친다.
    overflow_nodes: (() => {
      const nodes = [];
      for (const el of surface.querySelectorAll('*')) {
        const over = el.scrollWidth - el.clientWidth;
        if (over > 1) {
          nodes.push({
            cls: el.className || '', node: (el.dataset && el.dataset.node) || '',
            over, scroll_width: el.scrollWidth, client_width: el.clientWidth,
          });
        }
      }
      return nodes.sort((a, b) => b.over - a.over).slice(0, 6);
    })(),
    card_rect: (() => {
      const box = root.getBoundingClientRect();
      return {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width: Math.max(1, Math.ceil(box.width)),
        height: Math.max(1, Math.ceil(box.height)),
      };
    })(),
  };
})()`;

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
const REAL_BOARDS = Object.freeze([
  '2SKU-1', '2R3M-1', '13BC-2', '2QFO-2', '13K0-2', '135M-2',
]);

function loadRealBoardContract(boardId, ordinal) {
  const slots = JSON.parse(fs.readFileSync(
    path.join(BACKEND, 'ref', 'card-surface-templates', boardId, 'slots.json'), 'utf8',
  ));
  const slotValues = {};
  for (const slot of slots.slots) {
    if (typeof slot.paper_text === 'string' && slot.paper_text !== '') {
      slotValues[slot.slot_id] = slot.paper_text;
    }
  }
  return {
    boardId,
    instanceId: boardInstanceId(boardId),
    ordinal,
    cardTitle: `보드 표면 검수 · ${boardId}`,
    operationRef: 'base:board-surface',
    realtimeBindings: [],
    slotCount: slots.slots.length,
    boundCount: Object.keys(slotValues).length,
    contract: {
      surface_version: 'card-surface.v1',
      board_id: slots.board_id,
      card_id: slots.card_id,
      state_boards: [],
      slot_values: slotValues,
      unbound_slots: [],
      column_priority: slots.column_priority || [],
      section_titles_ko: slots.section_titles_ko || {},
    },
  };
}

// 보드 1장을 네 단계에서 재고 찍는다. 판정은 여기서 하고 원시값은 전부 남긴다.
async function captureBoardSteps(win, surface) {
  const paint = await sendBoardEnvelope(win, surface);
  await activateBoardTab(win, surface.instanceId);

  const originalBounds = win.getContentBounds();
  const steps = [];
  try {
    for (const preset of BOARD_WINDOW_PRESETS) {
      win.setContentSize(preset.width, preset.height);
      await settleBoardLayout(win, surface.instanceId);
      const probe = await win.webContents.executeJavaScript(boardStepProbe(surface.instanceId));
      if (probe.error) throw new Error(`board ${surface.boardId} ${preset.name}: ${probe.error}`);
      const image = await win.webContents.capturePage(probe.card_rect);
      const png = image.toPNG();
      const file = `board-${surface.boardId}-${preset.width}x${preset.height}.png`;
      fs.writeFileSync(path.join(CAPTURE_DIR, file), png);
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
  } finally {
    win.setContentSize(originalBounds.width, originalBounds.height);
    await settleBoardLayout(win, surface.instanceId);
  }

  // P5 — 단계 사이에서 텍스트가 사라지지 않는다. 접힘은 이동이지 삭제가 아니다.
  const base = steps[0];
  for (const step of steps.slice(1)) {
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
  const reachableCounts = new Set(steps.map((step) => step.reachable_slot_count));
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
    max_overflow_x: Math.max(...steps.map((step) => step.overflow_x)),
    steps: steps.map(({ __domText, __slots, ...rest }) => rest),
  };
}

// 보드 카드에는 통합 카드 크롬이 없다 — 카드 머리(제목·기준 시각·×)도, 패널 탭
// 칩도, 개발자 원시 필드 시트도 만들지 않는다(카드 = 보드 그 자체). 실앱 DOM에서
// 그 셋이 0인지 세고, 대신 탭 스트립이 제목과 닫기를 이고 있는지 확인한다.
async function inspectBoardChrome(win, surface) {
  const dom = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${surface.instanceId}"]');
    if (!root) return { error: 'board card not found' };
    const panel = root.closest('.canvas-tab-panel');
    const tab = panel && document.querySelector(
      '.canvas-tab-strip .canvas-tab[data-tab-key="' + panel.dataset.tabKey + '"]');
    return {
      board_surface_mark: root.dataset.boardSurface || '',
      card_head_count: root.querySelectorAll(':scope > .card-head').length,
      card_title_count: root.querySelectorAll('.card-title').length,
      card_fresh_count: root.querySelectorAll('.card-fresh').length,
      card_close_count: root.querySelectorAll('.uk-card-close').length,
      panel_tab_strip_count: root.querySelectorAll('.integrated-card-tabs').length,
      panel_tab_chip_count: root.querySelectorAll('.integrated-card-tab').length,
      raw_field_sheet_count: root.querySelectorAll('.semantic-detail-sheet').length,
      board_surface_count: root.querySelectorAll('.board-surface').length,
      tab_label: tab ? tab.querySelector('.canvas-tab-label').textContent.trim() : null,
      tab_close: Boolean(tab && tab.querySelector('.canvas-tab-close')),
    };
  })()`);
  if (dom.error) throw new Error(`board ${surface.boardId}: ${dom.error}`);
  const chrome = [
    'card_head_count', 'card_title_count', 'card_fresh_count', 'card_close_count',
    'panel_tab_strip_count', 'panel_tab_chip_count', 'raw_field_sheet_count',
  ].filter((key) => dom[key] !== 0);
  if (chrome.length) {
    throw new Error(`board ${surface.boardId}: 카드 크롬이 남았다 — ${JSON.stringify(
      Object.fromEntries(chrome.map((key) => [key, dom[key]])))}`);
  }
  if (dom.board_surface_mark !== 'true' || dom.board_surface_count !== 1) {
    throw new Error(`board ${surface.boardId}: 보드 표면 표시가 없다 — ${JSON.stringify(dom)}`);
  }
  if (!dom.tab_label || !dom.tab_close) {
    throw new Error(`board ${surface.boardId}: 탭 스트립이 제목·닫기를 잇지 않았다 — ${JSON.stringify(dom)}`);
  }
  return dom;
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
    const surface = loadRealBoardContract(boardId, (index % 6) + 1);
    const captured = await captureBoardSteps(win, surface);
    captured.chrome = await inspectBoardChrome(win, surface);
    boards.push(captured);
  }

  return {
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
    fs.writeFileSync(path.join(CAPTURE_DIR, file), png);
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
      sentinelCount: occurrences.filter((node) => node.querySelector('.semantic-detail-value')?.textContent.startsWith('sentinel::')).length,
      operationCount: document.querySelectorAll('.semantic-detail-operation[data-operation-ref]').length,
      detailOpen: Boolean(detail?.open),
      productionSurfaceLoaded: Boolean(window.AthenaLib?.IntegratedCardSurface),
      productionDetailSheetLoaded: Boolean(window.AthenaLib?.SemanticDetailSheet),
      fallbackSample: occurrences.filter((node) => !node.querySelector('.semantic-detail-value')?.textContent.startsWith('sentinel::')).slice(0, 12).map((node) => ({ id: node.dataset.fieldOccurrenceId, path: node.dataset.jsonPath })),
    };
  })()`);
  if (dom.rootCount !== 1 || dom.nestedRootCount !== 0 || dom.cardId !== cardId) {
    throw new Error(`${cardId}: root/nested-card contract failed: ${JSON.stringify(dom)}`);
  }
  if (!dom.productionSurfaceLoaded || !dom.productionDetailSheetLoaded || (
    dom.fieldCount !== expectedFields
    || dom.uniqueOccurrenceCount !== expectedFields
    || dom.sentinelCount !== expectedFields
    || dom.operationCount !== expectedOperations
  )) throw new Error(`${cardId}: production field occurrence DOM coverage failed: ${JSON.stringify(dom)}`);
  if (dom.detailOpen !== detailOpen) throw new Error(`${cardId}: detail open state failed`);

  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  const variant = detailOpen ? 'detail' : 'summary';
  const fileName = `${cardId}-${variant}.png`;
  fs.writeFileSync(path.join(CAPTURE_DIR, fileName), png);
  return {
    variant,
    file: fileName,
    sha256: sha256(png),
    dimensions: image.getSize(),
    dom,
  };
}

async function main() {
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
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
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
        const target = chips.find((chip) => chip.title === 'base:ka10024');
        if (target) target.click();
        shell.seedChatInput = priorSeed;
        return {
          ranking_tab_count: rankingTabs.length,
          chip_count: chips.length,
          active_titles: active.map((chip) => chip.title),
          active_disabled: active.every((chip) => chip.disabled),
          seeded,
        };
      })()`);
      if (rankingDom.ranking_tab_count !== 1) {
        throw new Error(`ranking tab count ${rankingDom.ranking_tab_count} !== 1`);
      }
      if (rankingDom.chip_count !== 18) {
        throw new Error(`CC-03 ranking axis chips ${rankingDom.chip_count} !== 18`);
      }
      if (rankingDom.active_titles.join(',') !== 'base:ka10019' || !rankingDom.active_disabled) {
        throw new Error(`ranking active axis mismatch: ${JSON.stringify(rankingDom.active_titles)}`);
      }
      if (rankingDom.seeded.length !== 1 || !/[가-힣]/.test(rankingDom.seeded[0])) {
        throw new Error(`ranking axis click did not seed chat input: ${JSON.stringify(rankingDom.seeded)}`);
      }
      report.actual_shell_ranking_mode = rankingDom;
    }
    report.actual_shell_board_responsive = await captureBoardResponsive(
      win, semanticContracts, shellRealtimeManager,
    );

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
    const reportPath = path.join(CAPTURE_DIR, 'VERIFY-INTEGRATED-CARDS.json');
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
