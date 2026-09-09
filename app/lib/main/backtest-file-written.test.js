'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { savedFileMessage } = require('./backtest-file-written');
const input = { project_id: 'p', root_path: 'algo', path: 'algo/config.json', source: '' };
const result = { kind: 'file_written', status: 'written', project_id: 'p', root_path: 'algo', path: input.path };
test('completed write adopts empty text without proposing a second write', () => {
  assert.deepEqual(savedFileMessage(input, result), { ...result, source: '' });
});
test('failed or mismatched acknowledgements cannot update the editor', () => {
  for (const patch of [{ status: 'error' }, { project_id: 'other' }, { path: 'other.py' }, { root_path: '.' }]) {
    assert.equal(savedFileMessage(input, { ...result, ...patch }), null);
  }
  assert.equal(savedFileMessage(input, null), null);
});
