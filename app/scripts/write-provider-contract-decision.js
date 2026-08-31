'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, '..', 'test-fixtures', 'provider-contract');
const DEFAULT_CLAUDE_REPORT = path.join(FIXTURE_DIR, 'reports', 'claude.json');
const DEFAULT_CODEX_REPORT = path.join(FIXTURE_DIR, 'reports', 'codex.json');
const DEFAULT_ROLLOUT_REPORT = path.join(FIXTURE_DIR, 'reports', 'install-and-legal.json');
const DEFAULT_DECISION = path.join(FIXTURE_DIR, 'decision.json');

const CLAUDE_REQUIRED_GATES = Object.freeze([
  'exactVersion',
  'fileHashes',
  'runtimeExports',
  'warmQueryTypes',
  'delayedTranscriptFixture',
  'generationScopedPreToolUse',
]);
const CODEX_REQUIRED_GATES = Object.freeze([
  'exactBinary',
  'stableSchema',
  'privateRuntimeHome',
  'globalStateUnchanged',
  'privateAuthReady',
  'threadScopedMcpInventory',
  'builtinCapabilityNegativeProbe',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function failedGates(provider, required) {
  if (!provider) return required.map((gate) => `${gate}:report-missing`);
  return required.filter((gate) => provider.gates?.[gate] !== true);
}

function normalizeRolloutAuthorization(report) {
  const gates = { ...(report?.gates || {}) };
  const failedGates = Object.entries(gates)
    .filter(([, passed]) => passed !== true)
    .map(([gate]) => gate);
  return {
    productionRolloutAllowed: report?.productionRolloutAllowed === true && failedGates.length === 0,
    scope: String(report?.scope || 'local-development-only'),
    gates,
    failedGates,
  };
}

function decideProviderContract(claude, codex, rolloutReport = null) {
  const claudeFailed = failedGates(claude, CLAUDE_REQUIRED_GATES);
  const codexFailed = failedGates(codex, CODEX_REQUIRED_GATES);
  const decision = claudeFailed.length > 0
    ? 'NO_GO'
    : codexFailed.length > 0 ? 'CLAUDE_ONLY' : 'GO';
  const normalizeProvider = (provider, enabled) => ({
    enabled,
    version: provider?.version || 'unavailable',
    sha256: provider?.sha256 || '0'.repeat(64),
    gates: { ...(provider?.gates || {}) },
  });
  return {
    schemaVersion: 1,
    decision,
    providers: {
      claude: normalizeProvider(claude, claudeFailed.length === 0),
      codex: normalizeProvider(codex, decision === 'GO'),
    },
    failedGates: [
      ...claudeFailed.map((gate) => `claude.${gate}`),
      ...codexFailed.map((gate) => `codex.${gate}`),
    ],
    rolloutAuthorization: normalizeRolloutAuthorization(rolloutReport),
  };
}

function validateDecision(decision) {
  assert.equal(decision.schemaVersion, 1);
  assert.ok(['GO', 'CLAUDE_ONLY', 'NO_GO'].includes(decision.decision));
  assert.deepEqual(Object.keys(decision.providers).sort(), ['claude', 'codex']);
  assert.ok(Array.isArray(decision.failedGates));
  assert.equal(new Set(decision.failedGates).size, decision.failedGates.length);
  assert.equal(typeof decision.rolloutAuthorization, 'object');
  assert.equal(typeof decision.rolloutAuthorization.productionRolloutAllowed, 'boolean');
  assert.equal(typeof decision.rolloutAuthorization.scope, 'string');
  assert.equal(typeof decision.rolloutAuthorization.gates, 'object');
  assert.ok(Object.values(decision.rolloutAuthorization.gates)
    .every((gate) => typeof gate === 'boolean'));
  assert.ok(Array.isArray(decision.rolloutAuthorization.failedGates));
  assert.equal(new Set(decision.rolloutAuthorization.failedGates).size,
    decision.rolloutAuthorization.failedGates.length);
  if (decision.rolloutAuthorization.productionRolloutAllowed) {
    assert.deepEqual(decision.rolloutAuthorization.failedGates, []);
  }
  for (const provider of Object.values(decision.providers)) {
    assert.equal(typeof provider.enabled, 'boolean');
    assert.equal(typeof provider.version, 'string');
    assert.match(provider.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof provider.gates, 'object');
    assert.ok(Object.values(provider.gates).every((gate) => typeof gate === 'boolean'));
  }
  if (decision.decision === 'GO') {
    assert.equal(decision.providers.claude.enabled, true);
    assert.equal(decision.providers.codex.enabled, true);
    assert.deepEqual(decision.failedGates, []);
  } else if (decision.decision === 'CLAUDE_ONLY') {
    assert.equal(decision.providers.claude.enabled, true);
    assert.equal(decision.providers.codex.enabled, false);
    assert.ok(decision.failedGates.some((gate) => gate.startsWith('codex.')));
  } else {
    assert.equal(decision.providers.claude.enabled, false);
    assert.ok(decision.failedGates.some((gate) => gate.startsWith('claude.')));
  }
}

function writeDecision({
  claudeReport = DEFAULT_CLAUDE_REPORT,
  codexReport = DEFAULT_CODEX_REPORT,
  rolloutReport = DEFAULT_ROLLOUT_REPORT,
  output = DEFAULT_DECISION,
} = {}) {
  const claude = fs.existsSync(claudeReport) ? readJson(claudeReport) : null;
  const codex = fs.existsSync(codexReport) ? readJson(codexReport) : null;
  const rollout = fs.existsSync(rolloutReport) ? readJson(rolloutReport) : null;
  const decision = decideProviderContract(claude, codex, rollout);
  validateDecision(decision);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  return decision;
}

function main() {
  const expectIndex = process.argv.indexOf('--expect-decision');
  const expected = expectIndex >= 0 ? process.argv[expectIndex + 1] : null;
  const decision = writeDecision();
  if (expected) assert.equal(decision.decision, expected);
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Provider contract decision failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  CLAUDE_REQUIRED_GATES,
  CODEX_REQUIRED_GATES,
  decideProviderContract,
  normalizeRolloutAuthorization,
  validateDecision,
  writeDecision,
};
