'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const {
  EPOCH_ENV,
  createMcpSecurityEpochStore,
  tokenHash,
} = require('./mcp-security-epoch');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-epoch-test-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('published capability context keeps token out of serializable snapshots', () => withTempDir((dir) => {
  const values = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];
  const store = createMcpSecurityEpochStore({ stateDir: dir, randomBytes: () => values.shift() });
  const context = store.publishGeneration(7);
  const env = context.buildCapabilityEnv();
  const document = JSON.parse(fs.readFileSync(store.epochPath, 'utf8'));

  assert.equal(document.securityGeneration, 7);
  assert.equal(document.revision, 1);
  assert.equal(document.tokenHash, tokenHash(env[EPOCH_ENV.token]));
  assert.equal(JSON.stringify(context).includes(env[EPOCH_ENV.token]), false);
  assert.deepEqual(Object.keys(document).sort(), ['revision', 'securityGeneration', 'tokenHash', 'version']);
}));

test('invalidate atomically replaces the token hash and advances revision', () => withTempDir((dir) => {
  let value = 0;
  const store = createMcpSecurityEpochStore({
    stateDir: dir,
    randomBytes: () => Buffer.alloc(32, ++value),
  });
  const current = store.publishGeneration(1);
  const oldHash = tokenHash(current.buildCapabilityEnv()[EPOCH_ENV.token]);

  const invalidated = store.invalidate(2);
  const document = JSON.parse(fs.readFileSync(store.epochPath, 'utf8'));

  assert.equal(invalidated.securityGeneration, 2);
  assert.equal(invalidated.epochRevision, 2);
  assert.notEqual(document.tokenHash, oldHash);
  assert.equal(document.securityGeneration, 2);
}));

test('disposed capability context can no longer reconstruct spawn environment', () => withTempDir((dir) => {
  const store = createMcpSecurityEpochStore({ stateDir: dir });
  const context = store.publishGeneration(1);
  context.dispose();
  assert.throws(() => context.buildCapabilityEnv(), /disposed/);
}));

test('state directory must be an explicit absolute path', () => {
  assert.throws(() => createMcpSecurityEpochStore({ stateDir: 'relative' }), /absolute/);
});
