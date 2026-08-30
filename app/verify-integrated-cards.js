'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CardLeaseManager, publicPolicies } = require('./lib/main/integrated-card-realtime');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const BACKEND = path.join(ROOT, 'backend');
const CAPTURE_DIR = path.join(APP, 'captures', 'integrated-cards');

fs.mkdirSync(CAPTURE_DIR, { recursive: true });
app.setPath('userData', path.join(CAPTURE_DIR, '.electron-user-data'));
app.disableHardwareAcceleration();

function loadBundle() {
  const script = path.join(BACKEND, 'tests', 'support', 'canvas_fixture_factory.py');
  const result = spawnSync(process.env.ATHENA_FIXTURE_PYTHON || 'python', [script, '--json'], {
    cwd: BACKEND,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`fixture factory failed:\n${result.stderr}`);
  return JSON.parse(result.stdout);
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

async function productionRealtimeTrace(card) {
  const initial = realtimeConfig(card.card_id, `fixture-${card.card_id}`, '005930');
  if (!initial) return { calls: [], states: [], tick_count: 0 };
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
  const manager = new CardLeaseManager({ transport, onState: (state) => states.push(state) });
  const mounted = await manager.mount(initial);
  if (!mounted.ok || !mounted.bindings.length) throw new Error(`${card.card_id}: production realtime mount failed`);
  const binding = mounted.bindings[0];
  const ticks = manager.routeFrame({
    trnm: 'REAL',
    data: [{ type: binding.operationId, item: binding.target, values: { fixture: 'tick' } }],
  });
  const next = realtimeConfig(card.card_id, initial.leaseId, '000660');
  const updated = await manager.update(next);
  if (!updated.ok) throw new Error(`${card.card_id}: production realtime target update failed`);
  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.handleFeedStatus({ state: 'open' });
  await manager.unmount(initial.leaseId);
  return { calls, states, tick_count: ticks.length };
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

async function exerciseShellRealtime(win, manager) {
  const mounted = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="CC-04"]');
    return { leaseId: root.dataset.realtimeLeaseId, mode: root.dataset.mode };
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
  const binding = state.bindings[0];
  const ticks = manager.routeFrame({
    trnm: 'REAL',
    data: [{
      type: binding.operationId,
      item: binding.target,
      values: { fixture_tick: 'accepted-generation' },
    }],
  }, state.connectionGeneration);
  if (!ticks.length) throw new Error('actual shell realtime manager produced no tick');
  win.webContents.send('athena:integrated-card-realtime-ticks', ticks);
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const accepted = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('#grid .integrated-card[data-card-id="CC-04"]');
    return {
      operation: root.dataset.lastRealtimeOperation,
      target: root.dataset.lastRealtimeTarget,
      text: root.querySelector('.integrated-realtime-strip')?.textContent || '',
    };
  })()`);
  if (accepted.operation !== binding.operationId
    || accepted.target !== binding.target
    || !accepted.text.includes('accepted-generation')) {
    throw new Error(`generation-matching realtime tick was not rendered: ${JSON.stringify(accepted)}`);
  }
  const staleTick = {
    ...ticks[0],
    generation: Math.max(0, ticks[0].generation - 1),
    row: { ...ticks[0].row, values: { fixture_tick: 'stale-generation' } },
  };
  win.webContents.send('athena:integrated-card-realtime-ticks', [staleTick]);
  await win.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  const afterStale = await win.webContents.executeJavaScript(`(() =>
    document.querySelector('#grid .integrated-card[data-card-id="CC-04"] .integrated-realtime-strip')?.textContent || ''
  )()`);
  if (!afterStale.includes('accepted-generation') || afterStale.includes('stale-generation')) {
    throw new Error(`stale realtime tick changed the renderer: ${afterStale}`);
  }
  return { lease: state, accepted, stale_tick_ignored: true };
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

async function sendRestEnvelope(win, card, fixture, cardOrdinal) {
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
            gridChildren: document.querySelectorAll('#grid > .card').length,
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
        mode: shellMode(card.card_id),
        section: fixture.operation_ref,
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

async function captureShellCard(win, card) {
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
      leaseId: root.dataset.realtimeLeaseId || null,
      generation: Number(root.dataset.realtimeGeneration || 0),
      connectionGeneration: Number(root.dataset.realtimeConnectionGeneration || 0),
    };
  })()`);
  if (dom.rootCount !== 6 || dom.nestedRootCount !== 0 || dom.cardId !== card.card_id
    || dom.operations !== card.operation_count || dom.coveredOperations !== card.operation_count
    || dom.fields !== card.field_count
    || dom.uniqueFields !== card.field_count) {
    throw new Error(`${card.card_id}: actual shell Canvas DOM failed: ${JSON.stringify(dom)}`);
  }
  if (dom.leaseId && dom.generation) {
    win.webContents.send('athena:integrated-card-realtime-ticks', [{
      leaseId: dom.leaseId, generation: dom.generation,
      connectionGeneration: dom.connectionGeneration, operationId: 'fixture',
      target: '005930', row: { type: 'fixture', item: '005930', values: { fixture: 'tick' } },
    }]);
    await win.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
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
      const trace = await productionRealtimeTrace(card);
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
    report.actual_shell_realtime = await exerciseShellRealtime(
      win, shellRealtimeManager,
    );
    for (const card of bundle.cards) {
      const shellCapture = await captureShellCard(win, card);
      const entry = report.cards.find((item) => item.card_id === card.card_id);
      entry.production_module_preflight = entry.screenshots.map((item) => item.dom);
      entry.screenshots = shellCapture.screenshots;
      entry.actual_shell_dom = shellCapture.dom;
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
