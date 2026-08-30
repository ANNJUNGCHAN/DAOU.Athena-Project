'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProviderSessionSupervisor } = require('./provider-session-supervisor');
const { ProviderRuntimeError } = require('./provider-session-contract');

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.fn();
        await flush();
      }
      now = target;
      await flush();
    },
    timerCount: () => timers.size,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function desired(overrides = {}) {
  return {
    provider: 'claude', accountId: 'acct', conversationId: 'conversation-1',
    cwd: 'C:\\repo', model: null, effort: null,
    systemPrompt: 'prompt', systemPromptHash: 'a'.repeat(64), configGeneration: 1,
    securityGeneration: 1, mcpSnapshot: { revision: 1 }, toolPolicy: { allowed: ['Read'] },
    ...overrides,
  };
}

function request(index, overrides = {}) {
  return {
    clientSubmitId: `123e4567-e89b-42d3-a456-${String(index).padStart(12, '0')}`,
    conversationId: 'conversation-1', origin: 'shell', userText: `message-${index}`,
    ...overrides,
  };
}

function completedPayload(provider = 'claude', suffix = '1') {
  if (provider === 'claude') return {
    providerBinding: { provider, sessionId: `session-${suffix}` },
    continuationCheckpoint: {
      provider, sessionId: `session-${suffix}`, assistantMessageId: `assistant-${suffix}`,
      assistantMessageHash: 'b'.repeat(64),
    },
    usage: {}, finalText: `done-${suffix}`,
  };
  return {
    providerBinding: { provider, threadId: `thread-${suffix}` },
    continuationCheckpoint: { provider, turnId: `provider-turn-${suffix}` },
    usage: {}, finalText: `done-${suffix}`,
  };
}

function isTerminal(type) {
  return ['turn_completed', 'turn_failed', 'turn_interrupted'].includes(type);
}

function createSupervisor(adapterFactory, options = {}) {
  const clock = options.clock || fakeClock();
  let uuidCounter = 0;
  const supervisor = new ProviderSessionSupervisor({
    adapterFactory,
    uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`,
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    queueTask: (fn) => fn(),
    turnTimeoutMs: 100,
    interruptGraceMs: 10,
    retryBaseMs: 5,
    retryCapMs: 20,
    retryWindowMs: 100,
    retryMaxAttempts: 3,
    circuitOpenMs: 50,
    healthyResetMs: 200,
    jitter: () => 1,
    ...options,
  });
  return { supervisor, clock };
}

test('start stores desired state first, starts asynchronously, and publishes only after adapter readiness', async () => {
  const gate = makeDeferred();
  const calls = [];
  const adapter = {
    async start(state, context) { calls.push(['start', state.provider, context.runtimeGeneration]); },
    async ready() { calls.push(['ready']); await gate.promise; },
    async sendTurn() {}, async interrupt() {}, async stop() {},
  };
  const { supervisor } = createSupervisor(() => adapter);
  const startPromise = supervisor.start(desired());
  assert.equal(supervisor.snapshot().provider, 'claude');
  await startPromise;
  assert.equal(supervisor.snapshot().state, 'starting');
  gate.resolve();
  assert.deepEqual(await supervisor.ready(), { provider: 'claude', runtimeGeneration: 1 });
  assert.deepEqual(calls, [['start', 'claude', 1], ['ready']]);
});

test('send before start fails immediately instead of creating a quiet queue or fallback', async () => {
  const { supervisor } = createSupervisor(() => { throw new Error('must not construct'); });
  const result = await supervisor.sendTurn(request(1));
  assert.equal(result.code, 'PROVIDER_NOT_STARTED');
  assert.equal(supervisor.snapshot().pendingTurnCount, 0);
});

test('supervisor stamps canonical events and waits for terminal dispatch drain before resolving', async () => {
  const terminalDrain = makeDeferred();
  const events = [];
  const adapter = {
    async start() {}, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      const delta = { text: 'hello' };
      context.emit('turn_started', { providerTurnId: null });
      context.emit('text_delta', delta);
      delta.text = 'mutated-after-emit';
      context.emit('turn_completed', completedPayload('claude', '1'));
      return { timings: { providerMs: 1 } };
    },
  };
  const { supervisor } = createSupervisor(() => adapter, {
    onEvent(event) {
      events.push(event);
      return event.type === 'turn_completed' ? terminalDrain.promise : undefined;
    },
  });
  await supervisor.start(desired());
  await supervisor.ready();
  let settled = false;
  const resultPromise = supervisor.sendTurn(request(1)).then((value) => { settled = true; return value; });
  await flush();
  assert.equal(settled, false, 'terminal delivery drain is a barrier');
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(events.every((event) => event.runtimeGeneration === 1), true);
  assert.equal(events.every((event) => event.turnId === events[0].turnId), true);
  assert.equal(events[1].payload.text, 'hello');
  assert.equal(Object.isFrozen(events[1].payload), true);
  terminalDrain.resolve();
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.finalText, 'done-1');
  assert.deepEqual(result.timings, { providerMs: 1 });
});

test('only one active turn runs; newest pending replacement supersedes the older pending request', async () => {
  const active = new Map();
  const writes = [];
  const adapter = {
    async start() {}, async ready() {}, async stop() {},
    async sendTurn(turn, context) {
      writes.push(turn.userText);
      const gate = makeDeferred();
      active.set(turn.turnId, { gate, context });
      return gate.promise;
    },
    async interrupt(turnId) {
      const current = active.get(turnId);
      current.context.emit('turn_interrupted', { providerBinding: null, reason: 'replaced' });
      current.gate.resolve({});
    },
  };
  const { supervisor } = createSupervisor(() => adapter);
  await supervisor.start(desired());
  await supervisor.ready();
  const first = supervisor.sendTurn(request(1));
  await flush();
  const second = supervisor.sendTurn(request(2));
  const third = supervisor.sendTurn(request(3));
  assert.equal((await second).code, 'SUPERSEDED_BEFORE_START');
  assert.equal((await first).interrupted, true);
  await flush();
  assert.deepEqual(writes, ['message-1', 'message-3']);
  const thirdActive = [...active.values()][1];
  thirdActive.context.emit('turn_completed', completedPayload('claude', '3'));
  thirdActive.gate.resolve({});
  assert.equal((await third).finalText, 'done-3');
  assert.equal(supervisor.snapshot().metrics.supersededBeforeStart, 1);
});

test('duplicate terminal and late events are dropped; adapter cannot inject correlation fields', async () => {
  let capturedContext;
  const events = [];
  const adapter = {
    async start() {}, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      capturedContext = context;
      context.emit('turn_completed', completedPayload());
      assert.equal(context.emit('turn_failed', {
        code: 'LATE', retryable: false, safeMessage: 'late',
      }), false);
      return {};
    },
  };
  const { supervisor } = createSupervisor(() => adapter, { onEvent: (event) => events.push(event) });
  await supervisor.start(desired());
  await supervisor.ready();
  const result = await supervisor.sendTurn(request(1));
  assert.equal(result.ok, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].runtimeGeneration, 1);
  assert.equal(events[0].payload.runtimeGeneration, undefined);
  assert.throws(() => capturedContext.emit('text_delta', { text: 'late' }), /no longer current/);
  assert.equal(supervisor.snapshot().metrics.duplicateTerminalDropped, 1);
  assert.equal(supervisor.snapshot().metrics.staleEventDropped, 1);
});

test('rotation blocks dispatch, drains active turn, stops old adapter, then publishes a fresh generation', async () => {
  const order = [];
  const firstGate = makeDeferred();
  let firstContext;
  const adapters = [
    {
      async start() { order.push('old:start'); }, async ready() { order.push('old:ready'); },
      async sendTurn(turn, context) { firstContext = context; return firstGate.promise; },
      async interrupt() {
        order.push('old:interrupt');
        firstContext.emit('turn_interrupted', { providerBinding: null, reason: 'rotate' });
        firstGate.resolve({});
      },
      async stop() { order.push('old:stop'); },
    },
    {
      async start(state, context) { order.push(`new:start:${state.model}:${context.runtimeGeneration}`); },
      async ready() { order.push('new:ready'); }, async interrupt() {},
      async stop() { order.push('new:stop'); },
      async sendTurn(turn, context) {
        order.push(`new:turn:${turn.userText}`);
        context.emit('turn_completed', completedPayload('claude', 'new'));
        return {};
      },
    },
  ];
  const invalidations = [];
  const { supervisor } = createSupervisor(() => adapters.shift(), {
    invalidateSecurity: async (detail) => { order.push('security:invalidate'); invalidations.push(detail); },
  });
  await supervisor.start(desired());
  await supervisor.ready();
  const oldTurn = supervisor.sendTurn(request(1));
  await flush();
  const rotation = supervisor.rotate(desired({ model: 'new-model', configGeneration: 2, securityGeneration: 2 }), 'policy');
  const queued = supervisor.sendTurn(request(2));
  assert.equal((await oldTurn).interrupted, true);
  assert.deepEqual(await rotation, { provider: 'claude', runtimeGeneration: 2 });
  assert.equal((await queued).ok, true);
  assert.deepEqual(order, [
    'old:start', 'old:ready', 'security:invalidate', 'old:interrupt', 'old:stop',
    'new:start:new-model:2', 'new:ready', 'new:turn:message-2',
  ]);
  assert.equal(invalidations.length, 1);
  assert.equal(supervisor.snapshot().runtimeGeneration, 2);
});

test('commit failure does not advance stored binding or checkpoint authority', async () => {
  const commitGate = makeDeferred();
  const events = [];
  const handshakes = [];
  const adapter = {
    async start() {}, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_completed', completedPayload());
      return {};
    },
    async commitTurn(turnId) { handshakes.push(['commit', turnId]); },
    async rollbackTurn(turnId) { handshakes.push(['rollback', turnId]); },
  };
  const { supervisor } = createSupervisor(() => adapter, {
    onEvent: async (event) => { events.push(event); },
    commitSuccess: async () => {
      await commitGate.promise;
      throw new Error('history unavailable');
    },
  });
  await supervisor.start(desired());
  await supervisor.ready();
  let settled = false;
  const pending = supervisor.sendTurn(request(1)).then((result) => { settled = true; return result; });
  await flush();
  assert.equal(settled, false);
  assert.deepEqual(handshakes.map(([kind]) => kind), ['commit'],
    'cursor commit is prepared before durable history is attempted');
  assert.equal(events.some((event) => event.type === 'turn_completed'), false,
    'success terminal stays private until the durable commit resolves');
  commitGate.resolve();
  const result = await pending;
  assert.equal(result.code, 'PROVIDER_COMMIT_FAILED');
  assert.deepEqual(events.filter((event) => isTerminal(event.type)).map((event) => event.type), ['turn_failed']);
  assert.equal(events[0].payload.code, 'PROVIDER_COMMIT_FAILED');
  assert.deepEqual(handshakes.map(([kind]) => kind), ['commit', 'rollback']);
  assert.equal(supervisor.snapshot().bindingCount, 0);
  assert.equal(supervisor.snapshot().checkpointCount, 0);
});

test('cursor commit failure cannot leave a durable history success residue', async () => {
  const events = [];
  const handshakes = [];
  let historyCommits = 0;
  const adapter = {
    async start() {}, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_completed', completedPayload());
      return {};
    },
    async commitTurn(turnId) {
      handshakes.push(['commit', turnId]);
      throw new Error('cursor commit failed');
    },
    async rollbackTurn(turnId) { handshakes.push(['rollback', turnId]); },
  };
  const { supervisor } = createSupervisor(() => adapter, {
    commitSuccess: async () => { historyCommits += 1; },
    onEvent: async (event) => { events.push(event); },
  });
  await supervisor.start(desired());
  await supervisor.ready();

  const result = await supervisor.sendTurn(request(1));

  assert.equal(result.code, 'PROVIDER_COMMIT_FAILED');
  assert.equal(historyCommits, 0, 'history is unreachable until cursor preparation succeeds');
  assert.deepEqual(handshakes.map(([kind]) => kind), ['commit', 'rollback']);
  assert.deepEqual(events.filter((event) => isTerminal(event.type)).map((event) => event.type), ['turn_failed']);
  assert.equal(events[0].payload.code, 'PROVIDER_COMMIT_FAILED');
  assert.equal(supervisor.snapshot().bindingCount, 0);
  assert.equal(supervisor.snapshot().checkpointCount, 0);
});

test('history failure uses the cursor commit transaction compensation exactly once', async () => {
  const order = [];
  const adapter = {
    async start() {}, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_completed', completedPayload());
      return {};
    },
    async commitTurn() {
      order.push('cursor:commit');
      return {
        async rollback() { order.push('cursor:compensate'); },
      };
    },
    async rollbackTurn() { assert.fail('transaction compensation owns rollback'); },
  };
  const { supervisor } = createSupervisor(() => adapter, {
    commitSuccess: async () => {
      order.push('history:commit');
      throw new Error('history unavailable');
    },
  });
  await supervisor.start(desired());
  await supervisor.ready();

  const result = await supervisor.sendTurn(request(1));

  assert.equal(result.code, 'PROVIDER_COMMIT_FAILED');
  assert.deepEqual(order, ['cursor:commit', 'history:commit', 'cursor:compensate']);
  assert.equal(supervisor.snapshot().bindingCount, 0);
  assert.equal(supervisor.snapshot().checkpointCount, 0);
});

test('durable commit and adapter cursor acknowledgement both precede completed delivery', async () => {
  const order = [];
  const adapter = {
    async start() {}, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_completed', completedPayload());
      return {};
    },
    async commitTurn() { order.push('cursor:commit'); },
    async rollbackTurn() { assert.fail('rollback must not run'); },
  };
  const { supervisor } = createSupervisor(() => adapter, {
    commitSuccess: async () => { order.push('history:commit'); },
    onEvent: async (event) => { if (event.type === 'turn_completed') order.push('renderer:completed'); },
  });
  await supervisor.start(desired());
  await supervisor.ready();
  assert.equal((await supervisor.sendTurn(request(1))).ok, true);
  assert.deepEqual(order, ['cursor:commit', 'history:commit', 'renderer:completed']);
});

test('completed delivery rejection cannot relabel an already durable success as retryable failure', async () => {
  const handshakes = [];
  const adapter = {
    async start() {}, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_completed', completedPayload());
      return {};
    },
    async commitTurn() { handshakes.push('commit'); },
    async rollbackTurn() { handshakes.push('rollback'); },
  };
  const { supervisor } = createSupervisor(() => adapter, {
    commitSuccess: async () => { handshakes.push('history'); },
    onEvent: async (event) => {
      if (event.type === 'turn_completed') throw new Error('renderer unavailable');
    },
  });
  await supervisor.start(desired());
  await supervisor.ready();

  const result = await supervisor.sendTurn(request(1));

  assert.equal(result.ok, true, 'the awaited return remains the recovery delivery channel');
  assert.deepEqual(handshakes, ['commit', 'history']);
  assert.equal(supervisor.snapshot().bindingCount, 1);
  assert.equal(supervisor.snapshot().checkpointCount, 1);
});

test('model and security rotations receive the last committed conversation checkpoint only', async () => {
  const contexts = [];
  const first = {
    async start(state, context) { contexts.push(context); }, async ready() {},
    async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_completed', completedPayload('claude', 'committed'));
      return {};
    },
  };
  const afterModel = {
    async start(state, context) { contexts.push(context); }, async ready() {},
    async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_failed', {
        code: 'PROVIDER_CRASHED', retryable: true, safeMessage: 'failed after model rotation',
      });
      return {};
    },
  };
  const afterSecurity = {
    async start(state, context) { contexts.push(context); }, async ready() {},
    async sendTurn(turn, context) {
      context.emit('turn_interrupted', { providerBinding: null, reason: 'user_interrupt' });
      return {};
    },
    async interrupt() {}, async stop() {},
  };
  const afterInterrupted = {
    async start(state, context) { contexts.push(context); }, async ready() {},
    async sendTurn() {}, async interrupt() {}, async stop() {},
  };
  const adapters = [first, afterModel, afterSecurity, afterInterrupted];
  const { supervisor } = createSupervisor(() => adapters.shift());
  await supervisor.start(desired());
  await supervisor.ready();
  assert.equal(contexts[0].initialProviderBinding, null);
  assert.equal(contexts[0].initialContinuationCheckpoint, null);

  const success = await supervisor.sendTurn(request(1));
  assert.equal(success.ok, true);
  await supervisor.rotate(desired({ model: 'new-model', configGeneration: 2 }), 'model');
  assert.deepEqual(contexts[1].initialProviderBinding, success.providerBinding);
  assert.deepEqual(contexts[1].initialContinuationCheckpoint, success.continuationCheckpoint);
  assert.equal(Object.isFrozen(contexts[1].initialProviderBinding), true);
  assert.equal(Object.isFrozen(contexts[1].initialContinuationCheckpoint), true);

  const failed = await supervisor.sendTurn(request(2));
  assert.equal(failed.ok, false);
  await supervisor.rotate(desired({
    model: 'new-model', configGeneration: 3, securityGeneration: 2,
  }), 'security');
  assert.deepEqual(contexts[2].initialProviderBinding, success.providerBinding);
  assert.deepEqual(contexts[2].initialContinuationCheckpoint, success.continuationCheckpoint,
    'failed turn never replaces committed checkpoint authority');
  const interrupted = await supervisor.sendTurn(request(3));
  assert.equal(interrupted.interrupted, true);
  await supervisor.rotate(desired({
    model: 'third-model', configGeneration: 4, securityGeneration: 2,
  }), 'model-after-interrupt');
  assert.deepEqual(contexts[3].initialProviderBinding, success.providerBinding);
  assert.deepEqual(contexts[3].initialContinuationCheckpoint, success.continuationCheckpoint,
    'interrupted turn never replaces committed checkpoint authority');
});

test('a fresh conversation generation receives null resume authority and cannot inherit another conversation', async () => {
  const contexts = [];
  const first = {
    async start(state, context) { contexts.push(context); }, async ready() {},
    async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      context.emit('turn_completed', completedPayload('claude', 'conversation-one'));
      return {};
    },
  };
  const second = {
    async start(state, context) { contexts.push(context); }, async ready() {},
    async sendTurn() {}, async interrupt() {}, async stop() {},
  };
  const adapters = [first, second];
  const { supervisor } = createSupervisor(() => adapters.shift());
  await supervisor.start(desired({ conversationId: 'conversation-1' }));
  await supervisor.ready();
  await supervisor.sendTurn(request(1, { conversationId: 'conversation-1' }));
  await supervisor.rotate(desired({
    conversationId: 'conversation-2', configGeneration: 2,
  }), 'new-conversation');
  assert.equal(contexts[1].initialProviderBinding, null);
  assert.equal(contexts[1].initialContinuationCheckpoint, null);
  assert.equal(supervisor.snapshot().bindingCount, 1, 'conversation-1 authority remains internally isolated');
});

test('interrupt grace timeout fences and stops the hung generation before starting the replacement', async () => {
  const order = [];
  const hung = {
    async start() { order.push('hung:start'); }, async ready() {},
    async sendTurn() { return new Promise(() => {}); },
    async interrupt() { order.push('hung:interrupt'); },
    async stop() { order.push('hung:stop'); },
  };
  const replacement = {
    async start() { order.push('replacement:start'); }, async ready() {},
    async sendTurn() {}, async interrupt() {}, async stop() {},
  };
  const adapters = [hung, replacement];
  const { supervisor, clock } = createSupervisor(() => adapters.shift());
  await supervisor.start(desired());
  await supervisor.ready();
  const turn = supervisor.sendTurn(request(1));
  await flush();
  const activeTurnId = supervisor._activeTurn.turnId;
  const interrupted = supervisor.interrupt(activeTurnId, 'escape');
  await flush();
  await clock.advance(10);
  const result = await interrupted;
  assert.equal(result.code, 'PROVIDER_INTERRUPT_TIMEOUT');
  assert.equal((await turn).turnId, result.turnId);
  await supervisor.ready();
  assert.deepEqual(order, ['hung:start', 'hung:interrupt', 'hung:stop', 'replacement:start']);
  assert.equal(supervisor.snapshot().runtimeGeneration, 2);
});

test('turn timeout aborts the turn signal before interrupt and rotates the hung runtime', async () => {
  const observations = [];
  let activeSignal;
  const hung = {
    async start() {}, async ready() {},
    async sendTurn(turn) { activeSignal = turn.signal; return new Promise(() => {}); },
    async interrupt() { observations.push(activeSignal.aborted); },
    async stop() { observations.push('stopped'); },
  };
  const fresh = {
    async start() { observations.push('fresh'); }, async ready() {},
    async sendTurn() {}, async interrupt() {}, async stop() {},
  };
  const adapters = [hung, fresh];
  const { supervisor, clock } = createSupervisor(() => adapters.shift());
  await supervisor.start(desired());
  await supervisor.ready();
  const resultPromise = supervisor.sendTurn(request(1));
  await flush();
  await clock.advance(100);
  await clock.advance(10);
  const result = await resultPromise;
  assert.equal(result.code, 'PROVIDER_TIMEOUT');
  assert.deepEqual(observations, [true, 'stopped', 'fresh']);
});

test('rotation owns timeout recovery and starts exactly one fresh generation after a hung interrupt', async () => {
  const order = [];
  const hung = {
    async start() { order.push('old:start'); }, async ready() {},
    async sendTurn() { return new Promise(() => {}); },
    async interrupt() { order.push('old:interrupt'); },
    async stop() { order.push('old:stop'); },
  };
  const fresh = {
    async start(state, context) { order.push(`fresh:start:${context.runtimeGeneration}`); }, async ready() {},
    async sendTurn() {}, async interrupt() {}, async stop() {},
  };
  const adapters = [hung, fresh];
  const { supervisor, clock } = createSupervisor(() => adapters.shift());
  await supervisor.start(desired());
  await supervisor.ready();
  const active = supervisor.sendTurn(request(1));
  await flush();
  const rotating = supervisor.rotate(desired({ configGeneration: 2 }), 'config');
  await flush();
  await clock.advance(10);
  assert.equal((await active).code, 'PROVIDER_INTERRUPT_TIMEOUT');
  assert.deepEqual(await rotating, { provider: 'claude', runtimeGeneration: 2 });
  assert.deepEqual(order, ['old:start', 'old:interrupt', 'old:stop', 'fresh:start:2']);
  assert.equal(adapters.length, 0, 'no second recovery adapter was constructed');
});

test('retry uses latest desired state, opens a bounded circuit, and never falls back to another provider', async () => {
  const seenProviders = [];
  let attempts = 0;
  const { supervisor, clock } = createSupervisor((provider) => {
    seenProviders.push(provider);
    return {
      async start() {
        attempts += 1;
        if (attempts < 4) {
          throw new ProviderRuntimeError('PROVIDER_CRASHED', 'Provider failed to start.', { retryable: true });
        }
      },
      async ready() {}, async sendTurn() {}, async interrupt() {}, async stop() {},
    };
  }, { retryMaxAttempts: 3, circuitOpenMs: 50 });
  await supervisor.start(desired({ provider: 'codex' }));
  await flush();
  await clock.advance(5);
  await clock.advance(10);
  assert.equal(supervisor.snapshot().retry.circuitOpenUntil, 65);
  const blocked = await supervisor.sendTurn(request(1));
  assert.equal(blocked.code, 'PROVIDER_CIRCUIT_OPEN');
  await clock.advance(50);
  assert.deepEqual(await supervisor.ready(), { provider: 'codex', runtimeGeneration: 4 });
  assert.deepEqual(seenProviders, ['codex', 'codex', 'codex', 'codex']);
  assert.equal(supervisor.snapshot().metrics.circuitOpened, 1);
});

test('stop cancels backoff and rejects queued work without leaving timers or runtime context in snapshot', async () => {
  const { supervisor, clock } = createSupervisor(() => ({
    async start() {
      throw new ProviderRuntimeError('PROVIDER_CRASHED', 'start failed', { retryable: true });
    },
    async ready() {}, async sendTurn() {}, async interrupt() {}, async stop() {},
  }));
  await supervisor.start(desired());
  await flush();
  const queued = supervisor.sendTurn(request(1));
  assert.equal(clock.timerCount(), 1);
  await supervisor.stop('shutdown');
  assert.equal((await queued).code, 'PROVIDER_STOPPED');
  assert.equal(clock.timerCount(), 0);
  const snapshot = supervisor.snapshot();
  assert.equal(snapshot.state, 'stopped');
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes('systemPrompt'), false);
  assert.equal(serialized.includes('processOwnerId'), false);
  assert.equal(serialized.includes('spawnContext'), false);
});

test('stop waits for an in-flight start and its adapter cleanup', async () => {
  const readyGate = makeDeferred();
  const order = [];
  const adapter = {
    async start() { order.push('start'); },
    async ready() { order.push('ready:wait'); await readyGate.promise; },
    async sendTurn() {}, async interrupt() {},
    async stop(reason) { order.push(`stop:${reason}`); },
  };
  const { supervisor } = createSupervisor(() => adapter);
  await supervisor.start(desired());
  await flush();
  let stopped = false;
  const stopping = supervisor.stop('shutdown').then(() => { stopped = true; });
  await flush();
  assert.equal(stopped, false);
  readyGate.resolve();
  await stopping;
  assert.equal(stopped, true);
  assert.deepEqual(order, ['start', 'ready:wait', 'stop:stale_start']);
  assert.equal(supervisor.snapshot().state, 'stopped');
});

test('generation and turn contexts are non-serializable authority objects', async () => {
  let generationContext;
  let turnContext;
  const adapter = {
    async start(state, context) { generationContext = context; }, async ready() {},
    async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      turnContext = context;
      context.emit('turn_completed', completedPayload());
      return {};
    },
  };
  const { supervisor } = createSupervisor(() => adapter, {
    generationContextFactory: () => ({ spawnContext: { buildEnv() { return { SECRET: 'hidden' }; } } }),
  });
  await supervisor.start(desired());
  await supervisor.ready();
  await supervisor.sendTurn(request(1));
  assert.equal(JSON.stringify(generationContext), undefined);
  assert.equal(JSON.stringify(turnContext), undefined);
  assert.equal(JSON.stringify(supervisor.snapshot()).includes('hidden'), false);
});

test('1,000 sequential same-conversation turns stay FIFO on one warmed adapter', async () => {
  let active = 0;
  let maxActive = 0;
  let starts = 0;
  const writes = [];
  const adapter = {
    async start() { starts += 1; }, async ready() {}, async interrupt() {}, async stop() {},
    async sendTurn(turn, context) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      writes.push(turn.userText);
      context.emit('turn_completed', completedPayload('claude', String(writes.length)));
      active -= 1;
      return {};
    },
  };
  const { supervisor } = createSupervisor(() => adapter);
  await supervisor.start(desired());
  await supervisor.ready();
  for (let index = 1; index <= 1_000; index += 1) {
    const suffix = index.toString(16).padStart(12, '0');
    const result = await supervisor.sendTurn(request(index, {
      clientSubmitId: `123e4567-e89b-42d3-a456-${suffix}`,
    }));
    assert.equal(result.ok, true);
  }
  assert.equal(starts, 1);
  assert.equal(maxActive, 1);
  assert.equal(writes.length, 1_000);
  assert.equal(writes[0], 'message-1');
  assert.equal(writes[999], 'message-1000');
});
