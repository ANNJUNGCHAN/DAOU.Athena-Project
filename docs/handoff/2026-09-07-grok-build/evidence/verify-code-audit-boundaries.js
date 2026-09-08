'use strict';
// Read-only offline audit: execute current repository functions with injected DOM/transport.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const canvas = fs.readFileSync(path.join(root, 'app/canvas.js'), 'utf8');
function section(text, first, next) {
  const start = text.indexOf(first), end = text.indexOf(next, start + first.length);
  assert.ok(start >= 0 && end > start, first);
  return text.slice(start, end);
}
class Element {
  constructor(name) { this.className = name; this.dataset = {}; this.children = []; this.parentElement = null; this.isConnected = true; }
  appendChild(child) { child.remove(); child.parentElement = this; child.isConnected = true; this.children.push(child); return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; this.isConnected = false; }
  closest() { for (let n = this; n; n = n.parentElement) if (n.className === 'card') return n; return null; }
}
async function chartBoundary(fail) {
  let resolve, reject;
  const pending = new Promise((a, b) => { resolve = a; reject = b; });
  const descriptor = { panelId: 'audit-panel', rendererId: 'aits-chart-v1', generation: 1, context: {}, body: { candles: [{}], trId: 'ka10081' } };
  const scope = {
    cardTitleAndSubtitle: () => ['chart', ''], describeAitsChartPanel: () => descriptor,
    reloadExistingAitsChartPanel: async () => null, cardStkCd: () => '', stampPaperScreen() {},
    makeCard() { const card = new Element('card'), body = new Element('body'); card.appendChild(body); return { card, body }; },
    document: { createElement: n => new Element(n) },
    errorNote: text => Object.assign(new Element('error'), { textContent: text }),
    window: { AthenaLib: { CardKinds: { resolve: () => null } }, athena: { send() {} } },
    aitsChartPanels: { openPanel: () => pending }, mountedChartSessions: new Map(), cardDestroyers: new Map(),
    setTimeout, clearTimeout,
  };
  vm.createContext(scope);
  vm.runInContext(section(canvas, 'function liveChartCard', '// TR이 Paper 보드') + '\n' + section(canvas, 'async function renderLiveChart', 'function renderFreeCanvas'), scope);
  const temporary = await scope.renderLiveChart({ data: {} });
  assert.equal(temporary.dataset.renderState, 'loading');
  const chartBody = temporary.children[0].children[0];
  const finalRoot = new Element('card'), panel = new Element('panel');
  finalRoot.appendChild(panel); panel.appendChild(chartBody); temporary.remove();
  const settled = vm.runInContext("chartMountSettlements.get('audit-panel')", scope);
  if (fail) reject(new Error('injected mount failure'));
  else resolve({ generation: 4, sessionId: 'audit-session', body: descriptor.body });
  assert.equal(await settled, fail ? 'error' : 'data');
  assert.equal(finalRoot.dataset.renderState, fail ? 'error' : 'data');
  if (fail) { assert.match(panel.children[0].textContent, /injected mount failure/); assert.equal(chartBody.parentElement, null); }
  else { assert.equal(finalRoot.__athenaChartTrId, 'ka10081'); assert.equal(finalRoot.__athenaChartSessionId, 'audit-session'); assert.equal(finalRoot.dataset.chartGeneration, '4'); }
  assert.equal(temporary.dataset.renderState, 'loading');
  return { initial: 'loading', final: finalRoot.dataset.renderState, errorOnLiveRoot: fail, sessionOnLiveRoot: !fail };
}
const runnerPath = path.join(root, 'app/lib/main/rest-dataset-runner.js');
const { runRestDataset } = require(runnerPath);
const mainSource = fs.readFileSync(path.join(root, 'app/main.js'), 'utf8');
const currentDeadline = Number(mainSource.match(/const DIRECT_DATASET_SETTLE_TIMEOUT_MS = ([\d_]+);/)[1].replaceAll('_', ''));
const testSource = fs.readFileSync(path.join(root, 'app/lib/main/rest-dataset-runner.test.js'), 'utf8');
const helpers = new Function(section(testSource, 'function response(', 'function successfulFetch(') + '\nreturn { response, canonicalInline, dataset };')();
async function firstFailure(elapsed) {
  let now = 1000;
  const calls = [], opByPlan = new Map(), paintBudgets = [];
  const result = await runRestDataset({
    dataset: Object.assign(helpers.dataset(2), { firstCanvasDeadlineMs: currentDeadline }), backendBase: 'http://offline.invalid', clock: () => now,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ path: url.split('/').pop(), ordinal: body.ordinal || null });
      if (url.endsWith('/resolve')) { if (opByPlan.size) now += 200; const token = 'p' + calls.length; opByPlan.set(token, body.question); return helpers.response({ plan_token: token }); }
      if (body.ordinal === 1) { now += elapsed; return helpers.response({ detail: 'injected first-screen failure' }, 500); }
      return helpers.response(helpers.canonicalInline(body, opByPlan.get(body.plan_token)));
    },
    emitCanvas: async payload => {
      const remaining = payload.paintDeadlineAt - now;
      paintBudgets.push({ ordinal: payload.ordinal, remaining });
      // main.js clamps this budget to 1ms. Model a paint that cannot complete in
      // an already exhausted budget, rather than silently ignoring the contract.
      if (remaining <= 0) throw Object.assign(new Error('injected exhausted paint budget'), { code: 'audit_paint_budget_exhausted' });
      return { verifiedVisible: true, visiblePaintAt: now, renderState: 'data' };
    },
  });
  return { deadlineMs: currentDeadline, elapsedBeforeSecondMs: elapsed, secondResolveMs: 200, dataCanvasCount: result.dataCanvasCount, errors: result.errors.map(e => ({ ordinal: e.ordinal, code: e.code })), paintBudgets, calls };
}
(async () => {
  const chartFailure = await chartBoundary(true), chartSuccess = await chartBoundary(false);
  const fastFailure = await firstFailure(0), slowFailure = await firstFailure(currentDeadline - 100);
  assert.equal(fastFailure.dataCanvasCount, 1);
  assert.equal(slowFailure.dataCanvasCount, 0);
  assert.ok(slowFailure.errors.some(e => e.ordinal === 2 && e.code === 'audit_paint_budget_exhausted'));
  assert.equal(slowFailure.paintBudgets[0].remaining, -100);
  const report = { source_sha256: { canvas: crypto.createHash('sha256').update(canvas).digest('hex'), runner: crypto.createHash('sha256').update(fs.readFileSync(runnerPath)).digest('hex') },
    cases: { chartFailure, chartSuccess, fastFailure, slowFailure }, verdict: '4 offline boundary checks passed; CODE-063 remains reproducible; CODE-001/002/010 corrected paths execute as expected' };
  fs.writeFileSync(path.join(__dirname, 'code-audit-boundaries.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
