'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  hashSchemaBundle,
  probeCodexContract,
  validateSchemaFacts,
  validateWireFixture,
} = require('./check-codex-app-server-contract');

const fixture = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'test-fixtures', 'provider-contract', 'codex-app-server-0.147.0.json',
), 'utf8'));

test('schema bundle hash binds relative names and bytes deterministically', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-schema-hash-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'v2'));
  fs.writeFileSync(path.join(root, 'a.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'v2', 'b.json'), '{"x":1}\n');
  const expected = crypto.createHash('sha256')
    .update('a.json').update('\0').update('{}\n')
    .update('v2/b.json').update('\0').update('{"x":1}\n')
    .digest('hex');
  assert.deepEqual(hashSchemaBundle(root), { fileCount: 2, sha256: expected });
});

test('stable schema facts reject experimental resume fields and MCP pluginId assumptions', () => {
  const valid = {
    methods: [...fixture.requiredMethods],
    resumeRequired: ['threadId'],
    resumeProperties: ['threadId'],
    forkProperties: ['threadId', 'lastTurnId'],
    notificationProperties: ['emittedAtMs'],
    mcpStatusProperties: ['name', 'authStatus', 'tools', 'resources', 'resourceTemplates', 'serverInfo'],
  };
  validateSchemaFacts(fixture, valid);
  assert.throws(
    () => validateSchemaFacts(fixture, { ...valid, resumeProperties: ['threadId', 'excludeTurns'] }),
    /must remain experimental/,
  );
  assert.throws(
    () => validateSchemaFacts(fixture, { ...valid, mcpStatusProperties: [...valid.mcpStatusProperties, 'pluginId'] }),
  );
});

test('wire fixture omits jsonrpc, locks stable resume, and records complete first-turn payload', () => {
  validateWireFixture(fixture);
  const invalid = structuredClone(fixture);
  invalid.requests.threadResume.jsonrpc = '2.0';
  assert.throws(() => validateWireFixture(invalid), /must omit jsonrpc/);
});

test('installed Codex is hash-bound and probed only through a private runtime home', async () => {
  const report = await probeCodexContract();
  assert.equal(report.version, '0.147.0');
  assert.equal(report.liveTurnExecuted, false);
  assert.equal(report.liveAppServerSpawned, false);
  assert.equal(report.gates.exactBinary, true);
  assert.equal(report.gates.stableSchema, true);
  assert.equal(report.gates.globalStateUnchanged, true);
});
