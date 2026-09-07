'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { waitForVisibleCount } = require('./paper-screen-wait.js');

const fakeWindow = (counts, sources = []) => ({
  webContents: {
    executeJavaScript: async (source) => {
      sources.push(source);
      return counts.shift();
    },
  },
});

test('waitForVisibleCount resolves only after the requested visible count appears', async () => {
  const sleeps = [];
  const sources = [];
  await waitForVisibleCount(fakeWindow([0, 1, 3], sources), '.orb-ring-dot', 3, {
    timeoutMs: 200,
    pollMs: 100,
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.deepEqual(sleeps, [100, 100]);
  assert.match(sources[0], /checkVisibility/);
  assert.match(sources[0], /\.orb-ring-dot/);
});

test('waitForVisibleCount throws when the bounded timeout expires', async () => {
  await assert.rejects(
    waitForVisibleCount(fakeWindow([0, 0, 0]), '.progress-line', 1, {
      timeoutMs: 200,
      pollMs: 100,
      sleep: async () => {},
    }),
    /DOM 조건 시간 초과 \(200ms\).*\.progress-line.*기대 1.*실제 0/,
  );
});
