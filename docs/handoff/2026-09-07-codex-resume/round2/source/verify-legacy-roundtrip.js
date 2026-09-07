'use strict';
// Offline: actual old backend output -> current form serializer -> canvas restore -> full turn.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../../../..');
const Canvas = require(path.join(root, 'app/lib/backtest-canvas'));
const Spec = require(path.join(root, 'app/lib/backtest-spec'));
const Prompt = require(path.join(root, 'app/lib/main/live-prompt'));
const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'legacy-source.json'), 'utf8'));
const node = () => ({
  className: '', textContent: '', hidden: false, children: [],
  get firstChild() { return this.children[0] || null; },
  appendChild(child) { this.children.push(child); return child; },
  removeChild(child) { this.children = this.children.filter((c) => c !== child); },
  setAttribute() {}, addEventListener() {},
});
let hooks;
global.document = { createElement: node, createElementNS: node };
global.window = { AthenaSessionWorkspace: { register: (_mode, handler) => { hooks = handler; }, report() {} } };
(async () => {
  const canvas = Canvas.createBacktestCanvas({
    container: node(), fetchPresets: async () => [],
    setTimeoutImpl: () => 1, clearTimeoutImpl: () => {},
  });
  canvas.mount();
  await new Promise((resolve) => setImmediate(resolve));
  const ownYaml = Spec.toYaml(Spec.createSpec(null, Canvas.specOverridesFromYaml(legacy.yaml)));
  assert.ok(!legacy.code.includes('TITLE_MARKER'), 'actual generated code never copied the external title');
  const results = [];
  for (const [producer, yaml] of [['safe_dump', legacy.yaml], ['Spec.toYaml', ownYaml]]) {
    const workspace = { form: { yaml }, code: { source: legacy.code, runPath: 'code' } };
    const saved = JSON.stringify(workspace);
    await hooks.restore(workspace);
    const context = canvas.getContext();
    const original = JSON.stringify(context);
    const turn = Prompt.buildLiveTurnPrompt({ canvasMode: 'backtest', backtestContext: context, userText: '대상부터 확인해줘' });
    const full = Prompt.buildLivePrompt({ canvasMode: 'backtest', backtestContext: context, userText: '대상부터 확인해줘' });
    assert.equal(context.spec.presetId, 'from_source');
    assert.equal(context.spec.name, legacy.name);
    assert.equal(context.code.source, legacy.code);
    assert.ok(!turn.includes('TITLE_MARKER'));
    assert.ok(!full.includes('TITLE_MARKER'));
    assert.equal(JSON.stringify(context), original);
    assert.equal(JSON.stringify(workspace), saved);
    results.push({ producer, yaml, context, turn, full, sourceTitleAbsent: true, unchanged: true });
  }
  fs.writeFileSync(path.join(__dirname, 'legacy-roundtrip.json'), JSON.stringify({
    input: 'legacy-source.json', generatedCodeTitleAbsent: true, results,
  }, null, 2), 'utf8');
  process.stdout.write(JSON.stringify({ cases: results.length, passed: results.length,
    sourceTitleAbsent: true, generatedCodeTitleAbsent: true, savedAndContextUnchanged: true }) + '\n');
})().catch((error) => { process.stderr.write(String(error.stack) + '\n'); process.exitCode = 1; });
