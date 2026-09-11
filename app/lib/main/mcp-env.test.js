'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { SENTINEL, updateSnippet, unredactedMigrationKeys } = require('./mcp-env');

test('migration verification accepts only keys durably replaced by the safe-storage sentinel', () => {
  const registry = {
    servers: {
      dart: {
        env: {
          REDACTED: '__ATHENA_SAFESTORAGE__',
          STILL_PLAIN: 'plaintext',
        },
      },
    },
  };

  assert.deepEqual(
    unredactedMigrationKeys(registry, 'dart', ['REDACTED', 'STILL_PLAIN', 'MISSING']),
    ['STILL_PLAIN', 'MISSING'],
  );
});

test('missing or unreadable registry evidence cannot prove a migration durable', () => {
  assert.deepEqual(unredactedMigrationKeys({ servers: {} }, 'dart', ['TOKEN']), ['TOKEN']);
  assert.deepEqual(unredactedMigrationKeys(null, 'dart', ['TOKEN']), ['TOKEN']);
});

function fakeSecrets(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getValue(_namespace, key) { return values.has(key) ? values.get(key) : null; },
    setValue(_namespace, key, value) { values.set(key, value); return { ok: true }; },
    deleteValue(_namespace, key) { values.delete(key); },
  };
}

test('snippet update keeps or renames encrypted values and sends only sentinels to CLI', async () => {
  const secretStore = fakeSecrets({ TOKEN: 'old-secret' });
  const registry = { servers: { discord: { env: { TOKEN: SENTINEL } } } };
  let applied = null;
  const result = await updateSnippet('discord', JSON.stringify({
    mcpServers: { discord: { command: 'npx', args: ['new-package'], env: {
      DISCORD_TOKEN: '__ATHENA_KEEP_ENV__:TOKEN',
      MODE: 'production',
    } } },
  }), async (alias, raw) => { applied = { alias, parsed: JSON.parse(raw), raw }; return { ok: true }; }, secretStore, () => registry);

  assert.equal(result.ok, true);
  assert.equal(applied.alias, 'discord');
  assert.deepEqual(applied.parsed.mcpServers.discord.env, {
    DISCORD_TOKEN: SENTINEL,
    MODE: SENTINEL,
  });
  assert.equal(applied.raw.includes('old-secret'), false);
  assert.equal(applied.raw.includes('production'), false);
  assert.equal(secretStore.values.get('DISCORD_TOKEN'), 'old-secret');
  assert.equal(secretStore.values.get('MODE'), 'production');
  assert.equal(secretStore.values.has('TOKEN'), false);
});

test('snippet update fails closed on missing keep reference and never invokes CLI', async () => {
  let invoked = false;
  const result = await updateSnippet('discord', JSON.stringify({
    mcpServers: { discord: { command: 'npx', env: { TOKEN: '__ATHENA_KEEP_ENV__:MISSING' } } },
  }), async () => { invoked = true; return { ok: true }; }, fakeSecrets(), () => ({
    servers: { discord: { env: { MISSING: SENTINEL } } },
  }));
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});

test('snippet update rolls encrypted values back when CLI apply fails', async () => {
  const secretStore = fakeSecrets({ TOKEN: 'before' });
  const result = await updateSnippet('discord', JSON.stringify({
    mcpServers: { discord: { command: 'npx', env: { TOKEN: 'after', NEW: 'created' } } },
  }), async () => ({ ok: false, error: 'apply failed' }), secretStore, () => ({
    servers: { discord: { env: { TOKEN: SENTINEL } } },
  }));
  assert.equal(result.ok, false);
  assert.equal(secretStore.values.get('TOKEN'), 'before');
  assert.equal(secretStore.values.has('NEW'), false);
});

test('keep marker cannot read inherited object properties as secret references', async () => {
  let invoked = false;
  const result = await updateSnippet('discord', JSON.stringify({
    mcpServers: { discord: { command: 'npx', env: { TOKEN: '__ATHENA_KEEP_ENV__:toString' } } },
  }), async () => { invoked = true; return { ok: true }; }, fakeSecrets(), () => ({
    servers: { discord: { env: {} } },
  }));
  assert.equal(result.ok, false);
  assert.equal(invoked, false);
});
