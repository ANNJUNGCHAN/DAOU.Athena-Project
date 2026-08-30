'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const createProviderFirstPaint = require('./provider-first-paint');

const APP_DIR = __dirname;

function readProductionFile(name) {
  return fs.readFileSync(path.join(APP_DIR, name), 'utf8');
}

function callObjects(source, method) {
  const marker = `window.AthenaProviderFirstPaint.${method}(`;
  const objects = [];
  let offset = 0;
  while ((offset = source.indexOf(marker, offset)) !== -1) {
    const start = source.indexOf('{', offset + marker.length);
    assert.notEqual(start, -1, `${method} must receive an object literal`);
    let depth = 0;
    let end = -1;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    assert.notEqual(end, -1, `${method} object literal must close`);
    objects.push(source.slice(start, end));
    offset = end;
  }
  return objects;
}

function objectKeys(objectSource) {
  return objectSource.slice(1, -1).split(',')
    .map((entry) => entry.trim().split(':', 1)[0].trim())
    .filter(Boolean)
    .sort();
}

function harness(options = {}) {
  const frames = [];
  const sent = [];
  let now = 10;
  let wallNow = 1_000;
  const root = {
    performance: { now: () => now },
    requestAnimationFrame(callback) { frames.push(callback); },
    getComputedStyle(node) {
      return node.style || { display: 'block', visibility: 'visible', opacity: '1' };
    },
    athena: { send(channel, payload) { sent.push({ channel, payload }); } },
  };
  const api = createProviderFirstPaint(root, { ...options, now: () => wallNow });
  const node = {
    isConnected: true,
    hidden: false,
    textContent: 'visible',
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
  };
  return {
    api, frames, node, sent,
    setNow(value) { now = value; },
    setWallNow(value) { wallNow = value; },
    flushFrame() { if (frames.length) frames.shift()(); },
    flushFrames() { while (frames.length) frames.shift()(); },
  };
}

function claim(h, overrides = {}) {
  return h.api.claimFirstVisible({
    clientSubmitId: 'c', turnId: 't', sequence: 2, origin: 'shell', owner: 'chat',
    node: h.node, rendererReceivedAt: 3, ...overrides,
  });
}

test('first valid shell owner wins one atomic ACK and the acked tombstone rejects duplicates', () => {
  const h = harness();
  assert.equal(h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' }), true);
  assert.equal(claim(h), true);
  assert.equal(claim(h, { sequence: 3, owner: 'canvas' }), false);
  assert.equal(h.sent.length, 0);
  h.setNow(8);
  h.flushFrames();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].channel, 'athena:provider-paint-ack');
  assert.deepEqual(h.sent[0].payload, {
    clientSubmitId: 'c', turnId: 't', sequence: 2,
    rendererSubmittedAt: 1, rendererReceivedAt: 3, rendererPaintedAt: 8,
  });
  assert.equal(claim(h, { sequence: 4, owner: 'canvas' }), false);
  h.flushFrames();
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.api.snapshot(), {
    pendingSubmits: 0, turns: 1, claimed: 0, acked: 1, invalid: 0,
    ackCount: 1, duplicateFailures: 2, invalidFailures: 0, timedOutSubmits: 0,
  });
});

test('wrong origin or owner creates a terminal invalid turn that no valid owner can re-claim', () => {
  for (const invalid of [
    { origin: 'orb', owner: 'orb' },
    { origin: 'shell', owner: 'orb' },
    { origin: 'unknown', owner: 'chat' },
  ]) {
    const h = harness();
    h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' });
    assert.equal(claim(h, invalid), false);
    assert.equal(claim(h), false);
    h.flushFrames();
    assert.equal(h.sent.length, 0);
    assert.equal(h.api.snapshot().invalid, 1);
    assert.equal(h.api.snapshot().duplicateFailures, 1);
  }
});

test('missing pending submit and invalid correlation become terminal invalid', () => {
  for (const overrides of [
    { clientSubmitId: 'missing' },
    { rendererReceivedAt: 0 },
    { rendererReceivedAt: Number.NaN },
    { sequence: 0 },
  ]) {
    const h = harness();
    h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' });
    assert.equal(claim(h, overrides), false);
    assert.equal(claim(h, { clientSubmitId: overrides.clientSubmitId || 'c' }), false);
    assert.equal(h.api.snapshot().invalid, 1);
    assert.equal(h.api.snapshot().duplicateFailures, 1);
  }
});

test('hidden, empty, disconnected, and zero-size nodes fail closed at claim', () => {
  const candidates = [
    { isConnected: false },
    { textContent: '' },
    { hidden: true },
    { getBoundingClientRect: () => ({ width: 0, height: 10 }) },
    { getBoundingClientRect: () => ({ width: 10, height: 0 }) },
    { style: { display: 'none', visibility: 'visible', opacity: '1' } },
  ];
  for (const change of candidates) {
    const h = harness();
    h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' });
    const node = { ...h.node, ...change };
    assert.equal(claim(h, { node }), false);
    assert.equal(claim(h), false);
    assert.equal(h.api.snapshot().invalid, 1);
    assert.equal(h.api.snapshot().duplicateFailures, 1);
  }
});

test('node becoming disconnected, hidden, empty, or zero-size at second rAF is terminal invalid', () => {
  const changes = [
    (node) => { node.isConnected = false; },
    (node) => { node.hidden = true; },
    (node) => { node.textContent = ''; },
    (node) => { node.getBoundingClientRect = () => ({ width: 0, height: 10 }); },
    (node) => { node.getBoundingClientRect = () => ({ width: 10, height: 0 }); },
  ];
  for (const mutate of changes) {
    const h = harness();
    h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' });
    assert.equal(claim(h), true);
    h.flushFrame();
    mutate(h.node);
    h.flushFrame();
    assert.equal(h.sent.length, 0);
    assert.equal(claim(h, { sequence: 3, owner: 'canvas' }), false);
    assert.equal(h.api.snapshot().invalid, 1);
    assert.equal(h.api.snapshot().duplicateFailures, 1);
  }
});

test('a lower late sequence invalidates the claimed turn and cancels its scheduled ACK', () => {
  const h = harness();
  h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' });
  assert.equal(claim(h, { sequence: 3 }), true);
  assert.equal(claim(h, { sequence: 2, owner: 'canvas' }), false);
  h.flushFrames();
  assert.equal(h.sent.length, 0);
  assert.equal(claim(h, { sequence: 4 }), false);
  assert.deepEqual(h.api.snapshot(), {
    pendingSubmits: 0, turns: 1, claimed: 0, acked: 0, invalid: 1,
    ackCount: 0, duplicateFailures: 1, invalidFailures: 1, timedOutSubmits: 0,
  });
});

test('pending timeout invalidates a claimed turn, blocks re-claim, and is later bounded', () => {
  const h = harness({ retentionMs: 10 });
  h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' });
  assert.equal(claim(h), true);
  h.setWallNow(1_011);
  assert.equal(h.api.snapshot().invalid, 1);
  assert.equal(h.api.snapshot().timedOutSubmits, 1);
  assert.equal(h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 4, origin: 'shell' }), true);
  assert.equal(claim(h, { sequence: 3, owner: 'canvas', rendererReceivedAt: 5 }), false);
  h.flushFrames();
  assert.equal(h.sent.length, 0);
  h.setWallNow(1_022);
  assert.equal(h.api.snapshot().turns, 0);
});

test('explicit invalidation is terminal until cleanup and retained records stay count bounded', () => {
  const h = harness({ maxRetained: 2, retentionMs: 10 });
  h.api.registerSubmit({ clientSubmitId: 'c', rendererSubmittedAt: 1, origin: 'shell' });
  assert.equal(claim(h), true);
  assert.equal(h.api.invalidateTurn('t'), true);
  assert.equal(claim(h, { sequence: 3 }), false);
  h.flushFrames();
  assert.equal(h.sent.length, 0);

  h.api.registerSubmit({ clientSubmitId: 'c2', rendererSubmittedAt: 2, origin: 'shell' });
  h.api.registerSubmit({ clientSubmitId: 'c3', rendererSubmittedAt: 3, origin: 'shell' });
  assert.ok(h.api.snapshot().pendingSubmits <= 2);
  assert.ok(h.api.snapshot().turns <= 2);
  assert.equal(h.api.cleanupTurn('t'), true);
  assert.equal(h.api.snapshot().turns, 0);
});

test('production HTML loads the first-paint singleton before every renderer consumer', () => {
  assert.equal(fs.existsSync(path.join(APP_DIR, 'provider-first-paint.js')), true);
  const shell = readProductionFile('shell.html');
  const orb = readProductionFile('orb.html');
  const providerTag = '<script src="provider-first-paint.js"></script>';
  assert.ok(shell.indexOf(providerTag) < shell.indexOf('<script src="canvas.js"></script>'));
  assert.ok(shell.indexOf(providerTag) < shell.indexOf('<script src="chat.js"></script>'));
  assert.ok(orb.indexOf(providerTag) < orb.indexOf('<script src="orb.js"></script>'));
});

test('production renderer calls use the exact register and claim object contracts', () => {
  const expectedRegister = ['clientSubmitId', 'origin', 'rendererSubmittedAt'];
  const expectedClaim = [
    'clientSubmitId', 'node', 'origin', 'owner', 'rendererReceivedAt', 'sequence', 'turnId',
  ];
  const contracts = [
    { file: 'canvas.js', registers: 0, claims: 1, origin: 'shell', owner: 'canvas' },
    { file: 'chat.js', registers: 1, claims: 1, origin: 'shell', owner: null },
    { file: 'orb.js', registers: 1, claims: 1, origin: 'orb', owner: 'orb' },
  ];
  for (const contract of contracts) {
    const source = readProductionFile(contract.file);
    const registers = callObjects(source, 'registerSubmit');
    const claims = callObjects(source, 'claimFirstVisible');
    assert.equal(registers.length, contract.registers, `${contract.file} registerSubmit count`);
    assert.equal(claims.length, contract.claims, `${contract.file} claimFirstVisible count`);
    for (const objectSource of registers) {
      assert.deepEqual(objectKeys(objectSource), expectedRegister, `${contract.file} registerSubmit keys`);
      assert.match(objectSource, new RegExp(`origin:\\s*'${contract.origin}'`));
    }
    for (const objectSource of claims) {
      assert.deepEqual(objectKeys(objectSource), expectedClaim, `${contract.file} claimFirstVisible keys`);
      assert.match(objectSource, new RegExp(`origin:\\s*'${contract.origin}'`));
      if (contract.owner) assert.match(objectSource, new RegExp(`owner:\\s*'${contract.owner}'`));
    }
  }
});
