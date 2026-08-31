'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RestRetryRegistry } = require('./rest-retry-registry');

function dataset({ operationRef = 'base:ka10081', generation = 2 } = {}) {
  return {
    datasetId: 'retry-private',
    generation,
    question: '삼성전자 일봉',
    items: [{ itemId: 'retry-private-1', ordinal: 1, operationRef, args: { stk_cd: '005930' } }],
  };
}

function registryHarness() {
  let now = 1_000;
  let sequence = 0;
  const isQueryOnlyDataset = (value) => Array.isArray(value && value.items)
    && value.items.length > 0
    && value.items.every((item) => /^base:ka\d+$/i.test(item.operationRef));
  const registry = new RestRetryRegistry({
    clock: () => now,
    randomBytes: () => Buffer.alloc(32, ++sequence),
    ttlMs: 100,
    isQueryOnlyDataset,
  });
  return { registry, advance: (ms) => { now += ms; } };
}

function issue(harness, overrides = {}) {
  const privateDataset = overrides.dataset || dataset();
  const view = harness.registry.beginView({ dataset: privateDataset, accountId: overrides.accountId || 'acct-1' });
  const retryId = harness.registry.issue({
    retryAction: {
      type: 'retry-rest-dataset',
      verifiedQueryOnly: overrides.verifiedQueryOnly !== false,
      dataset: privateDataset,
    },
    senderId: overrides.senderId || 7,
    conversationId: overrides.conversationId || 'conv-1',
    accountId: overrides.accountId || 'acct-1',
    ...view,
  });
  return { retryId, view, privateDataset };
}

test('opaque retry is bound to sender, conversation, account and is consumed once', () => {
  const harness = registryHarness();
  const { retryId } = issue(harness);
  assert.ok(retryId);
  assert.doesNotMatch(retryId, /005930|ka10081|retry-private/);
  assert.equal(harness.registry.consume({ retryId, senderId: 8, conversationId: 'conv-1', accountId: 'acct-1' }), null);
  assert.equal(harness.registry.consume({ retryId, senderId: 7, conversationId: 'conv-2', accountId: 'acct-1' }), null);
  assert.equal(harness.registry.consume({ retryId, senderId: 7, conversationId: 'conv-1', accountId: 'acct-2' }), null);
  const consumed = harness.registry.consume({ retryId, senderId: 7, conversationId: 'conv-1', accountId: 'acct-1' });
  assert.equal(consumed.dataset.items[0].args.stk_cd, '005930');
  assert.equal(harness.registry.consume({ retryId, senderId: 7, conversationId: 'conv-1', accountId: 'acct-1' }), null);
});

test('expired and stale-view retries fail closed', () => {
  const expired = registryHarness();
  const old = issue(expired);
  expired.advance(101);
  assert.equal(expired.registry.consume({ retryId: old.retryId, senderId: 7, conversationId: 'conv-1', accountId: 'acct-1' }), null);

  const stale = registryHarness();
  const first = issue(stale);
  stale.registry.beginView({ dataset: first.privateDataset, accountId: 'acct-1' });
  assert.equal(stale.registry.consume({ retryId: first.retryId, senderId: 7, conversationId: 'conv-1', accountId: 'acct-1' }), null);
});

test('issuance and consumption revalidate query-only authority and lineage', () => {
  const harness = registryHarness();
  const unverified = issue(harness, { verifiedQueryOnly: false });
  assert.equal(unverified.retryId, null);
  assert.throws(() => harness.registry.beginView({
    dataset: dataset({ operationRef: 'base:kt10000' }),
    accountId: 'acct-1',
  }), /조회 전용/);

  const valid = issue(harness);
  valid.privateDataset.items[0].args.stk_cd = '000660';
  const consumed = harness.registry.consume({
    retryId: valid.retryId,
    senderId: 7,
    conversationId: 'conv-1',
    accountId: 'acct-1',
  });
  assert.equal(consumed.dataset.items[0].args.stk_cd, '005930');

  const tampered = issue(harness);
  const entry = harness.registry.entries.get(tampered.retryId);
  entry.dataset.items[0].operationRef = 'base:kt10000';
  assert.equal(harness.registry.consume({
    retryId: tampered.retryId,
    senderId: 7,
    conversationId: 'conv-1',
    accountId: 'acct-1',
  }), null);
});

test('invalid or oversized retry IDs are rejected before registry lookup', () => {
  const harness = registryHarness();
  let lookups = 0;
  const originalGet = harness.registry.entries.get.bind(harness.registry.entries);
  harness.registry.entries.get = (key) => {
    lookups += 1;
    return originalGet(key);
  };
  for (const retryId of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}!`, 'a'.repeat(100_000)]) {
    assert.equal(harness.registry.consume({ retryId, senderId: 7, conversationId: 'conv-1', accountId: 'acct-1' }), null);
  }
  assert.equal(lookups, 0);
});

test('capacity is bounded, expired entries are purged, and oldest live entry is evicted deterministically', () => {
  let now = 1_000;
  let sequence = 0;
  const registry = new RestRetryRegistry({
    clock: () => now,
    randomBytes: () => Buffer.alloc(32, ++sequence),
    ttlMs: 100,
    maxEntries: 2,
    isQueryOnlyDataset: (value) => Array.isArray(value && value.items)
      && value.items.every((item) => /^base:ka\d+$/i.test(item.operationRef)),
  });
  const issueFor = (code) => {
    const privateDataset = dataset();
    privateDataset.items[0].args.stk_cd = code;
    const view = registry.beginView({ dataset: privateDataset, accountId: 'acct-1' });
    return registry.issue({
      retryAction: { type: 'retry-rest-dataset', verifiedQueryOnly: true, dataset: privateDataset },
      senderId: 7,
      conversationId: 'conv-1',
      accountId: 'acct-1',
      ...view,
    });
  };
  const first = issueFor('005930');
  const second = issueFor('000660');
  const third = issueFor('035420');
  assert.equal(registry.entries.size, 2);
  assert.equal(registry.entries.has(first), false);
  assert.equal(registry.entries.has(second), true);
  assert.equal(registry.entries.has(third), true);

  now += 101;
  const fourth = issueFor('051910');
  assert.equal(registry.entries.size, 1);
  assert.equal(registry.entries.has(second), false);
  assert.equal(registry.entries.has(third), false);
  assert.equal(registry.entries.has(fourth), true);
});
