'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { unredactedMigrationKeys } = require('./mcp-env');

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
