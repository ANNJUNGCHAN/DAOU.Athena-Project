'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  StartupReadiness, StartupFailureNotifier, buildStartupFailureNotification,
  showStartupOsNotification, runStartupOrchestration, waitForInitialReadiness,
  classifyBrainStartupStatus,
} = require('./startup-readiness');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function tracker(overrides = {}) {
  return new StartupReadiness({
    runId: 'run-1',
    tasks: [
      { id: 'a', label: 'A', kind: 'gate' },
      { id: 'b', label: 'B', kind: 'gate' },
      { id: 'loop', label: 'Loop', kind: 'continuous' },
    ],
    ...overrides,
  });
}

function skipQuotedSource(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
    } else if (source[index] === quote) {
      return index;
    }
  }
  return -1;
}

function skipTemplateSource(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
    } else if (source[index] === '`') {
      return index;
    } else if (source[index] === '$' && source[index + 1] === '{') {
      const expressionEnd = findClosingSourceBrace(source, index + 1);
      if (expressionEnd < 0) return -1;
      index = expressionEnd;
    }
  }
  return -1;
}

function findClosingSourceBrace(source, openingBrace) {
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '\'' || char === '"') {
      index = skipQuotedSource(source, index, char);
      if (index < 0) return -1;
    } else if (char === '`') {
      index = skipTemplateSource(source, index);
      if (index < 0) return -1;
    } else if (char === '/' && next === '/') {
      const lineEnd = source.indexOf('\n', index + 2);
      if (lineEnd < 0) return -1;
      index = lineEnd;
    } else if (char === '/' && next === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd < 0) return -1;
      index = commentEnd + 1;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractFunctionSource(source, signature) {
  const start = source.indexOf(signature);
  const openingBrace = start < 0 ? -1 : source.indexOf('{', start + signature.length);
  const closingBrace = openingBrace < 0 ? -1 : findClosingSourceBrace(source, openingBrace);
  assert.ok(start >= 0 && openingBrace > start && closingBrace > openingBrace);
  return source.slice(start, closingBrace + 1);
}

test('snapshot preserves task order and increments revision on transitions', async () => {
  const seen = [];
  const readiness = tracker({ onChange: (snapshot) => seen.push(snapshot) });
  readiness.setRunner('a', async () => ({ detail: 'A done' }));
  await readiness.start('a');
  assert.deepEqual(readiness.snapshot().tasks.map((task) => task.id), ['a', 'b', 'loop']);
  assert.deepEqual(seen.map((snapshot) => snapshot.revision), [1, 2]);
  assert.equal(readiness.snapshot().tasks[0].state, 'succeeded');
});

test('running gate keeps phase running until its promise succeeds', async () => {
  const pending = deferred();
  const readiness = tracker();
  readiness.disable('b');
  readiness.setRunner('a', () => pending.promise);
  const run = readiness.start('a');
  assert.equal(readiness.snapshot().phase, 'running');
  assert.equal(readiness.snapshot().tasks[0].state, 'running');
  pending.resolve({ detail: 'loaded' });
  await run;
  assert.equal(readiness.snapshot().phase, 'ready');
});

test('an early failure stays running until every later gate is attempted, then becomes degraded', async () => {
  const calls = [];
  const readiness = tracker();
  readiness.setRunner('a', async () => {
    calls.push('a');
    throw new Error('offline');
  });
  readiness.setRunner('b', async () => { calls.push('b'); return { detail: 'done' }; });
  await readiness.start('a');
  assert.equal(readiness.snapshot().phase, 'running');
  assert.equal(readiness.snapshot().tasks[0].detail, 'offline');
  await readiness.start('b');
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(readiness.snapshot().phase, 'degraded');
});

test('stale attempt result cannot overwrite a newer internal attempt', async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const readiness = tracker();
  readiness.disable('b');
  readiness.setRunner('a', () => (++calls === 1 ? first.promise : second.promise));
  const firstRun = readiness.start('a');
  readiness.update('a', { state: 'failed', detail: 'attempt deadline exceeded' });
  const retryRun = readiness.start('a');
  second.resolve({ detail: 'new result' });
  await retryRun;
  first.reject(new Error('stale failure'));
  await firstRun;
  const task = readiness.snapshot().tasks[0];
  assert.equal(task.state, 'succeeded');
  assert.equal(task.detail, 'new result');
  assert.equal(task.attempt, 2);
});

test('disabled fixture-style gates satisfy readiness and ready emits exactly once', async () => {
  let readyCount = 0;
  const readiness = tracker({ onReady: () => { readyCount += 1; } });
  readiness.disable('a', 'fixture mode');
  readiness.disable('b', 'fixture mode');
  assert.equal(readiness.snapshot().phase, 'ready');
  readiness.update('loop', { state: 'running', detail: 'background loop' });
  readiness.update('loop', { state: 'succeeded', detail: 'started' });
  assert.equal(readyCount, 1);
});

test('degraded terminal emits the terminal callback exactly once', async () => {
  let terminalCount = 0;
  const readiness = tracker({ onReady: () => { terminalCount += 1; } });
  readiness.disable('b');
  readiness.setRunner('a', async () => { throw new Error('offline'); });
  await readiness.start('a');
  assert.equal(readiness.snapshot().phase, 'degraded');
  readiness.update('loop', { state: 'running' });
  assert.equal(terminalCount, 1);
});

test('startup failure notification records only sinks that confirmed display and retries failed sinks', async () => {
  const snapshot = {
    runId: 'run-public', revision: 8, phase: 'degraded',
    tasks: [
      { id: 'backend-secret-id', label: 'ATHENA 서비스 연결', kind: 'gate', state: 'failed', detail: 'C:\\secret\\token=abc' },
      { id: 'later', label: '알람 실시간 연결', kind: 'gate', state: 'succeeded', detail: 'ok' },
    ],
  };
  const payload = buildStartupFailureNotification(snapshot);
  assert.deepEqual(payload.labels, ['ATHENA 서비스 연결']);
  assert.doesNotMatch(JSON.stringify(payload), /backend-secret-id|secret|token|revision|run-public/i);

  const calls = [];
  const notifier = new StartupFailureNotifier();
  let orbReady = false;
  let osShown = false;
  const sinks = {
    shell: (value) => { calls.push(['shell', value]); return true; },
    orb: (value) => { calls.push(['orb', value]); return orbReady; },
    os: async (value) => { calls.push(['os', value]); return osShown; },
  };
  assert.deepEqual((await notifier.notify(snapshot, sinks)).delivered, ['shell']);
  orbReady = true;
  osShown = true;
  assert.deepEqual(
    (await notifier.notify({ ...snapshot, revision: 9 }, sinks)).delivered,
    ['shell', 'orb', 'os'],
  );
  assert.equal(calls.filter(([name]) => name === 'shell').length, 1);
  assert.equal(calls.filter(([name]) => name === 'orb').length, 2);
  assert.equal(calls.filter(([name]) => name === 'os').length, 2);
  assert.equal((await notifier.notify({ ...snapshot, revision: 10 }, sinks)).notified, false);
});

test('startup failure notification treats throws and rejected async displays as retryable', async () => {
  const snapshot = {
    runId: 'run-retryable', phase: 'degraded',
    tasks: [{ id: 'private', label: '서비스 연결', kind: 'gate', state: 'failed' }],
  };
  const notifier = new StartupFailureNotifier();
  let attempt = 0;
  const first = await notifier.notify(snapshot, {
    shell: () => { throw new Error('renderer not ready'); },
    orb: async () => Promise.reject(new Error('display failed')),
    os: () => false,
  });
  assert.deepEqual(first.delivered, []);
  const second = await notifier.notify(snapshot, {
    shell: () => { attempt += 1; return true; },
    orb: () => true,
    os: () => true,
  });
  assert.deepEqual(second.delivered, ['shell', 'orb', 'os']);
  assert.equal(attempt, 1);
});

test('OS startup notification completes only on shown and remains retryable on failed or unsupported', async () => {
  class FakeNotification extends EventEmitter {
    static supported = true;
    static outcome = 'show';
    static isSupported() { return this.supported; }
    show() { queueMicrotask(() => this.emit(FakeNotification.outcome)); }
  }
  const payload = { title: '시작 알림', body: '일부 작업을 완료하지 못했어요.' };
  FakeNotification.outcome = 'show';
  assert.equal(await showStartupOsNotification(FakeNotification, payload), true);
  FakeNotification.outcome = 'failed';
  assert.equal(await showStartupOsNotification(FakeNotification, payload), false);
  FakeNotification.supported = false;
  assert.equal(await showStartupOsNotification(FakeNotification, payload), false);
});

test('verify entrypoint is exported, fixture-only, and guarded against duplicate starts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.match(source, /function startBootReadinessForVerify\(\)/);
  assert.match(source, /ATHENA_CANVAS_SOURCE !== 'fixture'/);
  assert.match(source, /if \(fixtureBootStarted\) return startupReadiness\.snapshot\(\)/);
  assert.match(source, /module\.exports = \{[\s\S]*startBootReadinessForVerify,/);
});

test('LIFE-003 main source keeps one shell-to-orb visibility policy from boot through background entry', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const visibilityStart = source.indexOf('function broadcastShellVisibility()');
  const visibilityEnd = source.indexOf('function commonWinOpts(', visibilityStart);
  const handoffStart = source.indexOf('function attemptShellHandoff()');
  const handoffEnd = source.indexOf('const startupReadiness =', handoffStart);
  const realtimeStart = source.indexOf('function ensureIntegratedCardRealtimeManager()');
  const realtimeEnd = source.indexOf('function ensureRealtimeForSymbol(', realtimeStart);

  assert.ok(visibilityStart >= 0 && visibilityEnd > visibilityStart);
  assert.ok(handoffStart >= 0 && handoffEnd > handoffStart);
  assert.ok(realtimeStart >= 0 && realtimeEnd > realtimeStart);

  const createWindows = extractFunctionSource(source, 'async function createWindows()');
  const visibilitySync = source.slice(visibilityStart, visibilityEnd);
  const handoff = source.slice(handoffStart, handoffEnd);
  const realtimeManager = source.slice(realtimeStart, realtimeEnd);

  assert.doesNotMatch(createWindows, /\borbWin\.(?:show|showInactive)\s*\(/);
  assert.doesNotMatch(createWindows, /broadcastShellVisibility\(\)/);
  assert.match(createWindows, /for \(const ev of \['show', 'hide', 'minimize', 'restore'\]\) \{\s*shellWin\.on\(ev, broadcastShellVisibility\);\s*\}/);
  assert.equal((createWindows.match(/shellWin\.on\(ev, broadcastShellVisibility\)/g) || []).length, 1);
  assert.doesNotMatch(createWindows, /shellWin\.on\(\s*['"](?:show|hide|minimize|restore)['"]/);
  assert.match(createWindows, /orbWin\.on\('close', \(event\) => \{[\s\S]*?orbWindow\.syncOrbVisibility\(shellWin, orbWin\);[\s\S]*?\n  \}\);/);
  assert.equal((createWindows.match(/orbWindow\.syncOrbVisibility\(shellWin, orbWin\)/g) || []).length, 1);
  assert.match(visibilitySync, /orbWindow\.syncOrbVisibility\(shellWin, orbWin\)/);
  assert.match(handoff, /broadcastShellVisibility\(\)/);
  assert.match(source, /ensureOrbVisible:\s*\(\)\s*=>\s*orbWindow\.syncOrbVisibility\(shellWin, orbWin\)/);
  assert.match(realtimeManager, /semanticBindingSourceProvider:\s*integratedCardRealtime\.createSemanticBindingSourceProvider\(\{\s*backendBase:\s*BACKEND_HTTP_BASE,\s*token:\s*LOCAL_BEARER_TOKEN,\s*fetchImpl:\s*fetch,\s*\}\)/);
});

test('BOOT-003 production surfaces have no retry UI or retry IPC and retain the real task label', () => {
  const appDir = path.join(__dirname, '..', '..');
  const shell = fs.readFileSync(path.join(appDir, 'shell.html'), 'utf8');
  const chat = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
  const preload = fs.readFileSync(path.join(appDir, 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
  assert.doesNotMatch(shell, /bootFailure|bootRetry|다시 시도/);
  assert.doesNotMatch(chat, /bootFailure|bootRetry|boot-readiness:retry/);
  assert.doesNotMatch(preload, /boot-readiness:retry/);
  assert.doesNotMatch(main, /boot-readiness:retry|startupReadiness\.retry/);
  assert.match(preload, /athena:app-notification/);
  assert.match(preload, /athena:boot-complete/);
  assert.match(chat, /selected\.label\.trim\(\)/);
  assert.match(chat, /\['ready', 'degraded'\]\.includes\(startupSnapshot\.phase\)/);
  assert.match(chat, /localReadiness = 'fallback'/);
  assert.match(chat, /startOnboarding\(onboarding\.resolveOnboardingStartStep\(localOnboardState\)\)/);
});

test('live orchestration attempts every dependent gate after backend failure and ignores continuous completion', async () => {
  const calls = [];
  const never = deferred();
  const readiness = new StartupReadiness({
    runId: 'orchestration-run',
    tasks: [
      { id: 'independent', label: 'Independent', kind: 'gate' },
      { id: 'backend', label: 'Backend', kind: 'gate' },
      { id: 'brain', label: 'Brain', kind: 'gate' },
      { id: 'alarm', label: 'Alarm', kind: 'gate' },
      { id: 'routine', label: 'Routine', kind: 'gate' },
      { id: 'canvas', label: 'Canvas', kind: 'gate' },
      { id: 'loops', label: 'Loops', kind: 'continuous' },
    ],
  });
  readiness.setRunner('independent', async () => { calls.push('independent'); return {}; });
  readiness.setRunner('backend', async () => { calls.push('backend'); throw new Error('offline'); });
  for (const id of ['brain', 'alarm', 'routine', 'canvas']) {
    readiness.setRunner(id, async () => { calls.push(id); return {}; });
  }
  readiness.setRunner('loops', () => { calls.push('loops'); return never.promise; });
  const snapshot = await runStartupOrchestration({
    readiness,
    concurrentTaskIds: ['independent'],
    dependencyTaskId: 'backend',
    dependentTaskIds: ['brain', 'alarm', 'routine', 'canvas'],
    continuousTaskIds: ['loops'],
  });
  assert.deepEqual(calls, ['loops', 'independent', 'backend', 'brain', 'alarm', 'routine', 'canvas']);
  assert.equal(snapshot.phase, 'degraded');
  assert.equal(snapshot.tasks.find((task) => task.id === 'loops').state, 'running');
});

test('graph boot gates run in strict sequence while feed gates connect in parallel', async () => {
  const calls = [];
  const readiness = new StartupReadiness({
    runId: 'graph-orchestration-run',
    tasks: [
      { id: 'backend', label: 'Backend', kind: 'gate' },
      { id: 'feed', label: 'Feed', kind: 'gate' },
      { id: 'brain-ready', label: 'Brain ready', kind: 'gate' },
      { id: 'outbox', label: 'Outbox', kind: 'gate' },
      { id: 'graph', label: 'Graph', kind: 'gate' },
    ],
  });
  readiness.setRunner('backend', async () => { calls.push('backend'); return {}; });
  readiness.setRunner('feed', async () => { calls.push('feed'); return {}; });
  readiness.setRunner('brain-ready', async () => { calls.push('brain-ready'); return {}; });
  readiness.setRunner('outbox', async () => { calls.push('outbox'); return {}; });
  readiness.setRunner('graph', async () => { calls.push('graph'); return {}; });

  const snapshot = await runStartupOrchestration({
    readiness,
    dependencyTaskId: 'backend',
    dependentTaskIds: ['feed'],
    sequentialDependentTaskIds: ['brain-ready', 'outbox', 'graph'],
  });

  assert.deepEqual(calls, ['backend', 'feed', 'brain-ready', 'outbox', 'graph']);
  assert.equal(snapshot.phase, 'ready');
});

test('bounded initial readiness fails after its task-specific attempt budget', async () => {
  const attempts = [];
  await assert.rejects(waitForInitialReadiness({
    ensureReady: async (timeoutMs) => { attempts.push(timeoutMs); return false; },
    maxAttempts: 3,
    attemptTimeoutMs: 25,
    errorMessage: 'index unavailable',
  }), /index unavailable/);
  assert.deepEqual(attempts, [25, 25, 25]);
});

test('brain startup classification distinguishes deliberate disable from unavailable/degraded failure', () => {
  assert.deepEqual(classifyBrainStartupStatus({
    startup_ingestion_status: null,
    startup_ingestion_detail: 'brain_disabled',
  }), { state: 'disabled', detail: '브레인 기능이 명시적으로 비활성화됨' });
  for (const detail of ['brain_unavailable', 'brain_ingestion_degraded', 'startup_ingestion_unavailable']) {
    assert.equal(classifyBrainStartupStatus({
      startup_ingestion_status: null, startup_ingestion_detail: detail,
    }).state, 'failed');
  }
});
