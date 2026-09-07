'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { waitForDomCount } = require('./paper-screen-wait.js');

const fakeWindow = (counts, sources = []) => ({
  webContents: {
    executeJavaScript: async (source) => {
      sources.push(source);
      return counts.shift();
    },
  },
});

test('waitForDomCount resolves only after the requested visible count appears', async () => {
  const sleeps = [];
  const sources = [];
  await waitForDomCount(fakeWindow([0, 1, 3], sources), '.orb-ring-dot', 3, {
    timeoutMs: 200,
    pollMs: 100,
    visibility: 'visible',
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.deepEqual(sleeps, [100, 100]);
  assert.match(sources[0], /checkVisibility/);
  assert.match(sources[0], /\.orb-ring-dot/);
});

test('waitForDomCount can wait for a hidden DOM state without treating it as absent', async () => {
  const sources = [];
  await waitForDomCount(fakeWindow([1], sources), '#history:empty', 1, {
    visibility: 'any',
  });
  assert.doesNotMatch(sources[0], /checkVisibility/);
});

test('waitForDomCount throws when the bounded timeout expires', async () => {
  await assert.rejects(
    waitForDomCount(fakeWindow([0, 0, 0]), '.progress-line', 1, {
      timeoutMs: 200,
      pollMs: 100,
      visibility: 'visible',
      sleep: async () => {},
    }),
    /DOM 조건 시간 초과 \(200ms\).*\.progress-line.*기대 1.*실제 0/,
  );
});
