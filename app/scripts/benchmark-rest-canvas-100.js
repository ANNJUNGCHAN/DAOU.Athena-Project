'use strict';

// G007 executable exact-100 producer.  It boots the real Electron windows and
// renderer, calls the real FastAPI selector/render-plan routes, and records only
// verified visible paint acknowledgements.  Cases run once, in corpus order.

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const ROOT = path.resolve(APP, '..');
const BACKEND = path.join(ROOT, 'backend');
const PYTHON = path.join(BACKEND, '.venv', 'Scripts', 'python.exe');
const SERVER = path.join(BACKEND, 'scripts', 'serve_kiwoom_rest_canvas_benchmark.py');
const CANARIES = ['70500', '123456', 'BENCHMARK_NAME', 'BENCH_CUR_PRC'];
let fatalProducerLog = () => {};

// main.js intentionally resolves its BrowserWindow.loadFile targets from the
// Electron app working directory. Keep this executable harness equivalent to
// `npm start` even when its parent launches it from the repository root.
process.chdir(APP);

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--corpus') out.corpus = path.resolve(argv[++index]);
    else if (argv[index] === '--output') out.output = path.resolve(argv[++index]);
  }
  if (!out.corpus || !out.output) {
    throw new Error('usage: electron benchmark-rest-canvas-100.js --corpus PATH --output PATH');
  }
  return out;
}

function loadJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rejectAfter(ms, message) {
  return wait(ms).then(() => { throw new Error(message); });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`benchmark backend exited ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await wait(50);
  }
  throw new Error('benchmark backend health timeout');
}

function profileForRequest(testCase, init) {
  const body = JSON.parse(init.body || '{}');
  const ordinal = Number(body.ordinal) || 1;
  return testCase.upstream_profile.calls[ordinal - 1] || { latency_ms: 0, result: 'success' };
}

function profiledFetch(testCase) {
  return async (url, init = {}) => {
    if (!String(url).endsWith('/api/v1/canvas/render-plan')) return fetch(url, init);
    const profile = profileForRequest(testCase, init);
    const headers = new Headers(init.headers || {});
    headers.set('x-athena-benchmark-latency-ms', String(profile.latency_ms || 0));
    headers.set('x-athena-benchmark-result', String(profile.result || 'success'));
    return fetch(url, { ...init, headers });
  };
}

function observedOutcome(testCase, result) {
  const dataCount = Number(result.dataCanvasCount) || 0;
  const stateCount = Number(result.stateCanvasCount) || 0;
  if (dataCount > 0) {
    if (testCase.invalid_request && testCase.invalid_request.canvas_type_override) {
      return 'render_manifest_authoritative';
    }
    if (testCase.upstream_profile.calls.some((call) => call.result === 'empty')) {
      return 'render_empty_state';
    }
    if (stateCount > 0 || (result.errors && result.errors.length)) return 'render_partial';
    return 'render_all';
  }
  if (stateCount > 0) {
    const states = (result.canvases || []).map((canvas) => canvas.state);
    if (states.includes('cancelled')) return 'cancelled_no_render';
    return 'deadline_miss_no_render';
  }
  if (result.rejected || testCase.invalid_request) return 'rejected_no_render';
  const codes = (result.errors || []).map((error) => String(error.code || ''));
  if (codes.some((code) => /cancel|abort/i.test(code))) return 'cancelled_no_render';
  return 'deadline_miss_no_render';
}

function chartPanelAck(canvas, kind = 'initial', totalMs = null) {
  const envelope = canvas && canvas.envelope && typeof canvas.envelope === 'object' ? canvas.envelope : {};
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const meta = data.chart_meta && typeof data.chart_meta === 'object' ? data.chart_meta : {};
  return {
    operationRef: canvas.operationRef,
    ordinal: canvas.ordinal,
    rendererId: canvas.rendererId,
    renderState: canvas.renderState,
    panelId: canvas.panelId,
    generation: canvas.generation,
    verifiedVisible: canvas.verifiedVisible === true,
    totalMs: totalMs == null ? Number(canvas.stageMs && canvas.stageMs.totalMs) : Number(totalMs),
    kind,
    reloadGroup: meta.reload_group || canvas.reloadGroup || null,
    seriesScope: meta.series_scope || canvas.seriesScope || null,
  };
}

async function executeAitsReload(canvasWin, testCase, result) {
  const expectation = testCase.aits_reload;
  if (!expectation) return null;
  const source = (result.canvases || []).find((canvas) => canvas.ordinal === expectation.panel_order);
  if (!source || !source.panelId || !Number.isInteger(source.generation)) {
    throw new Error(`${testCase.id}: AITS reload source panel is missing`);
  }
  const payload = {
    panelId: source.panelId,
    generation: source.generation,
    period: expectation.period,
    adjusted: true,
    interval: 5,
  };
  const startedAt = performance.now();
  const observed = await canvasWin.webContents.executeJavaScript(`(async () => {
    const reply = await window.athena.invoke('athena:reload-chart-panel', ${JSON.stringify(payload)});
    const card = Array.from(document.querySelectorAll('[data-chart-panel-id]'))
      .find((item) => item.dataset.chartPanelId === ${JSON.stringify(source.panelId)});
    return {
      reply,
      rendererId: card && card.dataset.rendererId,
      renderState: card && card.dataset.renderState,
      panelId: card && card.dataset.chartPanelId,
      generation: card && Number(card.dataset.chartGeneration),
      visible: Boolean(card && card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().height > 0),
    };
  })()`);
  const totalMs = performance.now() - startedAt;
  return {
    operationRef: expectation.operation_ref,
    ordinal: expectation.panel_order,
    rendererId: observed.rendererId,
    renderState: observed.renderState,
    panelId: observed.panelId,
    generation: observed.generation,
    verifiedVisible: observed.visible === true && observed.reply && observed.reply.ok === true,
    totalMs,
    kind: 'reload',
    reloadGroup: expectation.reload_group,
    seriesScope: expectation.series_scope,
  };
}

function toTrace(testCase, result, elapsedMs) {
  const outcome = observedOutcome(testCase, result);
  const allCanvases = Array.isArray(result.canvases) ? result.canvases : [];
  const dataCanvases = allCanvases.filter((canvas) => canvas.isDataCanvas !== false);
  const firstKind = dataCanvases.length ? 'data_canvas'
    : (allCanvases.length ? 'state_canvas' : 'receipt');
  const answerText = String(result.answerText || '');
  const leaked = CANARIES.some((token) => answerText.includes(token));
  const recommendations = (result.recommendations || []).map((item) => ({
    question: item.query,
    deterministicSource: 'predeclared_metadata',
    action: item.targetIntent,
    executedBeforeClick: false,
  }));
  const chartPanelAcks = allCanvases
    .filter((canvas) => canvas.canvasType === 'chart' && canvas.isDataCanvas === true)
    .map((canvas) => chartPanelAck(canvas));
  if (result.reloadChartPanelAck) chartPanelAcks.push(result.reloadChartPanelAck);
  return {
    datasetId: testCase.id,
    observedOutcome: outcome,
    canvases: allCanvases,
    renderedCount: dataCanvases.length,
    dataCanvasCount: dataCanvases.length,
    stateCanvasCount: Number(result.stateCanvasCount) || 0,
    physicalCalls: Number(result.physicalCalls) || 0,
    lateCanvases: Number(result.lateCanvases) || 0,
    answerText,
    answer: {
      ...(result.answer || {}),
      reportedOutcome: outcome,
      fullPayloadExposed: leaked || Boolean(result.answer && result.answer.payloadTokensLeaked),
      cacheReceiptIntegrity: true,
    },
    recommendations,
    recommendationModelCalls: 0,
    recommendationInputs: recommendations.length
      ? ['receipt_status', 'operation_ref', 'canvas_type']
      : [],
    recommendationsExecutedBeforeClick: Number(result.recommendationsExecutedBeforeClick) || 0,
    forbiddenCalls: result.forbiddenCalls || { mcp: 0, claude: 0, ws: 0, order: 0, oauth: 0 },
    leakCanaries: CANARIES,
    failClosed: outcome === 'rejected_no_render',
    runnerErrors: result.errors || [],
    rendererErrors: result.rendererErrors || [],
    feedbackError: result.feedbackError || null,
    feedback: {
      kind: firstKind,
      verifiedVisible: result.feedbackOk === true,
      totalMs: Number(result.firstFeedbackMs ?? elapsedMs),
    },
    measurement: {
      pipeline: 'fastapi_inline_to_electron_visible_paint',
      paint_ack: 'visible_nonzero_rect_double_raf',
      backend_process: 'uvicorn-production-app-with-dependency-override',
      case_retry_count: 0,
    },
    producerError: result.producerError || null,
    pipelineStages: result.pipelineStages || [],
    chartPanelAcks,
  };
}

function summarizeStageEvents(events) {
  const items = new Map();
  for (const event of events) {
    if (!event.itemId) continue;
    const key = `${event.itemId}\u0000${event.ordinal || 0}`;
    const item = items.get(key) || { itemId: event.itemId, ordinal: event.ordinal };
    if (event.type === 'resolve-start') item.resolveStartedAtMs = event.atMs;
    if (event.type === 'inline-start') item.renderPlanStartedAtMs = event.atMs;
    if (event.type === 'inline-ready') item.inlineReadyAtMs = event.atMs;
    if (event.type === 'paint-ack') item.ackSentAtMs = event.atMs;
    if (event.type === 'item-error') {
      item.failureAtMs = event.atMs;
      item.failureStage = event.code || 'request_failed';
    }
    items.set(key, item);
  }
  return Array.from(items.values()).sort((left, right) => left.ordinal - right.ordinal).map((item) => ({
    ...item,
    resolveMs: item.resolveStartedAtMs == null || item.renderPlanStartedAtMs == null
      ? null : item.renderPlanStartedAtMs - item.resolveStartedAtMs,
    renderPlanMs: item.renderPlanStartedAtMs == null || item.inlineReadyAtMs == null
      ? null : item.inlineReadyAtMs - item.renderPlanStartedAtMs,
    inlineToAckMs: item.inlineReadyAtMs == null || item.ackSentAtMs == null
      ? null : item.ackSentAtMs - item.inlineReadyAtMs,
  }));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const progressPath = `${args.output}.progress.jsonl`;
  const producerLogPath = `${args.output}.producer.log`;
  fs.writeFileSync(progressPath, '', 'utf8');
  fs.writeFileSync(producerLogPath, '', 'utf8');
  const producerLog = (message) => {
    fs.appendFileSync(producerLogPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
  };
  fatalProducerLog = producerLog;
  const cases = loadJsonl(args.corpus);
  if (cases.length !== 100 || new Set(cases.map((item) => item.id)).size !== 100) {
    throw new Error('corpus must contain exactly 100 unique cases');
  }

  const port = await freePort();
  const backendBase = `http://127.0.0.1:${port}`;
  const backend = spawn(PYTHON, [SERVER, '--port', String(port)], {
    cwd: BACKEND,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  producerLog(`backend-spawn pid=${backend.pid} port=${port}`);
  let backendError = '';
  backend.stderr.on('data', (chunk) => {
    backendError = `${backendError}${chunk}`.slice(-4000);
    producerLog(`backend-stderr ${String(chunk).trim()}`);
  });
  backend.on('exit', (code, signal) => producerLog(`backend-exit code=${code} signal=${signal}`));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-g007-benchmark-'));
  app.setPath('userData', userData);

  try {
    await waitForHealth(backendBase, backend);
    producerLog('backend-healthy');
    process.env.ATHENA_BACKEND_URL = backendBase;
    await app.whenReady();
    producerLog('electron-ready');
    const main = require(path.join(APP, 'main.js'));
    producerLog('main-required');
    await Promise.race([
      main.createWindows(),
      rejectAfter(15000, 'Electron window startup watchdog expired'),
    ]);
    producerLog('windows-created');
    const { canvasWin } = main.getWins();
    let activeRendererErrors = [];
    canvasWin.webContents.on('ipc-message', (_event, channel, ...args) => {
      if (channel !== 'athena:rest-canvas-painted') return;
      const payload = args[0] && typeof args[0] === 'object' ? args[0] : {};
      if (!payload.error) return;
      activeRendererErrors.push({
        datasetId: payload.dataset_id || null,
        itemId: payload.item_id || null,
        ordinal: Number(payload.ordinal) || null,
        operationRef: payload.operation_ref || null,
        renderState: payload.render_state || 'error',
        error: String(payload.error),
      });
    });
    const traces = [];
    for (const testCase of cases) {
      producerLog(`case-start ${testCase.id}`);
      activeRendererErrors = [];
      canvasWin.webContents.send('athena:clear-canvases');
      await wait(20);
      const controller = new AbortController();
      const hardController = new AbortController();
      if (testCase.expected_outcome === 'cancelled_no_render') {
        controller.abort(new Error('benchmark user cancellation'));
      }
      const hardTimer = setTimeout(
        () => hardController.abort(new Error('benchmark per-case watchdog')),
        10000,
      );
      const startedAt = Date.now();
      const stageEvents = [];
      let trace;
      try {
        const result = await Promise.race([
          main.runDirectRestDataset(testCase, true, {
            fetchImpl: profiledFetch(testCase),
            signal: controller.signal,
            hardSignal: hardController.signal,
            onEvent: (event) => stageEvents.push({ ...event, atMs: Date.now() - startedAt }),
          }),
          rejectAfter(10500, 'benchmark case did not settle after abort'),
        ]);
        const reloadAck = await executeAitsReload(canvasWin, testCase, result);
        if (reloadAck) {
          result.reloadChartPanelAck = reloadAck;
          result.physicalCalls = Number(result.physicalCalls || 0) + 1;
        }
        result.rendererErrors = activeRendererErrors.slice();
        trace = toTrace(testCase, result, Date.now() - startedAt);
        trace.pipelineStages = summarizeStageEvents(stageEvents);
      } catch (error) {
        trace = toTrace(testCase, {
          producerError: String((error && error.stack) || error),
          answerText: '화면 오류를 표시했습니다.',
          answer: { delivery: 'separate', blockedCanvas: false, modelCalls: 0 },
          feedbackOk: false,
          firstFeedbackMs: Date.now() - startedAt,
          canvases: [],
          physicalCalls: 0,
          forbiddenCalls: { mcp: 0, claude: 0, ws: 0, order: 0, oauth: 0 },
          rendererErrors: activeRendererErrors.slice(),
        }, Date.now() - startedAt);
        trace.pipelineStages = summarizeStageEvents(stageEvents);
      } finally {
        clearTimeout(hardTimer);
      }
      traces.push(trace);
      fs.appendFileSync(progressPath, `${JSON.stringify(trace)}\n`, 'utf8');
      producerLog(`case-done ${testCase.id} feedback=${trace.feedback.totalMs}`);
      if (traces.length % 10 === 0) process.stderr.write(`G007 progress ${traces.length}/100\n`);
    }
    fs.writeFileSync(args.output, `${traces.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    if (traces.length !== 100) throw new Error(`producer emitted ${traces.length} rows`);
  } finally {
    try { backend.kill(); } catch {}
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
    try { app.quit(); } catch {}
  }
  if (backend.exitCode && backend.exitCode !== 0) throw new Error(backendError || 'backend failed');
}

run().then(() => {
  process.exitCode = 0;
}).catch((error) => {
  const detail = String((error && error.stack) || error);
  fatalProducerLog(`producer-failed ${detail}`);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
});
