'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-prefs-test-'));
const originalLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => userDataDir } };
  return originalLoad.call(this, request, parent, isMain);
};
const prefs = require('./prefs');
Module._load = originalLoad;

const prefsPath = path.join(userDataDir, 'athena-prefs.json');

test.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

test.beforeEach(() => {
  fs.rmSync(prefsPath, { force: true });
});

test('이전 glassLevel 저장값을 읽거나 다시 저장하지 않는다', () => {
  fs.writeFileSync(prefsPath, JSON.stringify({
    autoExpandCanvas: false,
    fontSize: 'lg',
    glassLevel: 'clear',
  }));

  assert.deepEqual(prefs.get(), {
    autoExpandCanvas: false,
    autoGrowChat: true,
    fontSize: 'lg',
    collectChat: true,
    exposeToModel: true,
  });

  const next = prefs.set({ glassLevel: 'sheer', autoGrowChat: false });
  assert.equal(next.autoGrowChat, false);
  assert.equal(Object.hasOwn(next, 'glassLevel'), false);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(prefsPath, 'utf8')), 'glassLevel'), false);
});
