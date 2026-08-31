'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CODEX_LIVE_DISABLED_BY_CONTRACT,
  CODEX_LIVE_DISABLED_BY_KILL_SWITCH,
  resolveCodexDisabledSelection,
} = require('./codex-live-disabled');

test('CLAUDE_ONLY Codex selection returns action-needed without invoking spawn or Claude fallback', () => {
  let spawnCount = 0;
  let fallbackCount = 0;
  const result = resolveCodexDisabledSelection({
    activeAccount: { accountId: 'codex:athena-runtime', providerId: 'codex' },
    contractDecision: 'CLAUDE_ONLY',
    persistentEnabled: true,
    spawnCodex: () => { spawnCount += 1; },
    fallbackToClaude: () => { fallbackCount += 1; },
  });

  assert.deepEqual(result, {
    ok: false,
    type: 'action-needed',
    provider: 'codex',
    code: CODEX_LIVE_DISABLED_BY_CONTRACT,
  });
  assert.equal(spawnCount, 0);
  assert.equal(fallbackCount, 0);
});

test('cold-mode Codex selection uses the explicit kill-switch code and never calls callbacks', () => {
  let sideEffects = 0;
  const result = resolveCodexDisabledSelection({
    activeAccount: { accountId: 'codex:athena-runtime', providerId: 'codex' },
    contractDecision: 'GO',
    persistentEnabled: false,
    spawnCodex: () => { sideEffects += 1; },
    fallbackToClaude: () => { sideEffects += 1; },
  });

  assert.equal(result.code, CODEX_LIVE_DISABLED_BY_KILL_SWITCH);
  assert.equal(result.type, 'action-needed');
  assert.equal(sideEffects, 0);
});

test('non-Codex selection is outside this guard', () => {
  assert.equal(resolveCodexDisabledSelection({
    activeAccount: { accountId: 'claude:user', providerId: 'claude' },
    contractDecision: 'CLAUDE_ONLY',
    persistentEnabled: true,
  }), null);
});
