'use strict';

const VALID_KINDS = new Set(['gate', 'continuous']);
const VALID_STATES = new Set([
  'pending', 'running', 'retrying', 'succeeded', 'failed', 'disabled',
]);

function messageOf(error) {
  return String((error && error.message) || error || '알 수 없는 오류');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class StartupReadiness {
  constructor({ tasks, runId, onChange = () => {}, onReady = () => {} }) {
    if (!Array.isArray(tasks) || tasks.length === 0) throw new TypeError('tasks are required');
    this._tasks = tasks.map((task) => {
      if (!task || !task.id || !task.label || !VALID_KINDS.has(task.kind)) {
        throw new TypeError('each task requires id, label, and valid kind');
      }
      return {
        id: task.id,
        label: task.label,
        kind: task.kind,
        state: 'pending',
        attempt: 0,
        retryable: task.retryable !== false,
        detail: task.detail || '',
      };
    });
    if (new Set(this._tasks.map((task) => task.id)).size !== this._tasks.length) {
      throw new TypeError('task ids must be unique');
    }
    this._runId = runId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this._revision = 0;
    this._phase = 'running';
    this._onChange = onChange;
    this._onReady = onReady;
    this._runners = new Map();
    this._activeAttempts = new Map();
    this._terminalEmitted = false;
  }

  snapshot() {
    return clone({
      runId: this._runId,
      revision: this._revision,
      phase: this._phase,
      tasks: this._tasks,
    });
  }

  setRunner(id, runner) {
    if (typeof runner !== 'function') throw new TypeError('runner must be a function');
    this._task(id);
    this._runners.set(id, runner);
    return this;
  }

  disable(id, detail = '이 실행 모드에서는 사용하지 않음') {
    const task = this._task(id);
    this._activeAttempts.delete(id);
    task.state = 'disabled';
    task.retryable = false;
    task.detail = detail;
    this._publish();
  }

  update(id, patch = {}) {
    const task = this._task(id);
    if (patch.state !== undefined) {
      if (!VALID_STATES.has(patch.state)) throw new TypeError(`invalid task state: ${patch.state}`);
      task.state = patch.state;
    }
    if (patch.retryable !== undefined) task.retryable = !!patch.retryable;
    if (patch.detail !== undefined) task.detail = String(patch.detail || '');
    this._publish();
  }

  start(id) {
    return this._run(id, false);
  }

  async _run(id, retry = false) {
    const task = this._task(id);
    const runner = this._runners.get(id);
    if (!runner) throw new Error(`runner not registered: ${id}`);
    const attempt = task.attempt + 1;
    const attemptToken = Symbol(`${id}:${attempt}`);
    this._activeAttempts.set(id, attemptToken);
    task.attempt = attempt;
    task.state = retry ? 'retrying' : 'running';
    task.detail = retry ? '다시 시도하는 중' : '시작하는 중';
    this._publish();

    const context = {
      attempt,
      update: (patch) => {
        if (this._activeAttempts.get(id) !== attemptToken) return false;
        this.update(id, patch);
        return true;
      },
    };
    try {
      const result = await runner(context);
      if (this._activeAttempts.get(id) !== attemptToken) return this.snapshot();
      this._activeAttempts.delete(id);
      if (result && result.disabled) {
        task.state = 'disabled';
        task.retryable = false;
      } else {
        task.state = 'succeeded';
      }
      task.detail = result && result.detail ? String(result.detail) : '완료';
    } catch (error) {
      if (this._activeAttempts.get(id) !== attemptToken) return this.snapshot();
      this._activeAttempts.delete(id);
      task.state = 'failed';
      task.detail = messageOf(error);
    }
    this._publish();
    return this.snapshot();
  }

  _task(id) {
    const task = this._tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error(`unknown startup task: ${id}`);
    return task;
  }

  _publish() {
    const gates = this._tasks.filter((task) => task.kind === 'gate');
    const terminal = gates.every((task) => ['succeeded', 'failed', 'disabled'].includes(task.state));
    if (!terminal) this._phase = 'running';
    else if (gates.some((task) => task.state === 'failed')) this._phase = 'degraded';
    else this._phase = 'ready';
    this._revision += 1;
    const snapshot = this.snapshot();
    this._onChange(snapshot);
    if ((this._phase === 'ready' || this._phase === 'degraded') && !this._terminalEmitted) {
      this._terminalEmitted = true;
      this._onReady(snapshot);
    }
  }
}

function buildStartupFailureNotification(snapshot) {
  if (!snapshot || snapshot.phase !== 'degraded' || !Array.isArray(snapshot.tasks)) return null;
  const labels = snapshot.tasks
    .filter((task) => task && task.kind === 'gate' && task.state === 'failed')
    .map((task) => String(task.label || '').trim())
    .filter(Boolean);
  if (!labels.length) return null;
  return {
    title: '일부 시작 작업을 완료하지 못했어요',
    body: `완료하지 못한 시작 작업: ${labels.join(', ')}. 앱은 계속 사용할 수 있습니다.`,
    labels,
  };
}

class StartupFailureNotifier {
  constructor() {
    this._runs = new Map();
  }

  async notify(snapshot, sinks = {}) {
    const payload = buildStartupFailureNotification(snapshot);
    const runId = snapshot && snapshot.runId;
    if (!payload || typeof runId !== 'string' || !runId) {
      return { notified: false, delivered: [] };
    }
    let state = this._runs.get(runId);
    if (!state) {
      state = { delivered: new Set(), inFlight: new Map() };
      this._runs.set(runId, state);
    }
    const before = state.delivered.size;
    const attempts = [];
    for (const name of ['shell', 'orb', 'os']) {
      if (state.delivered.has(name) || typeof sinks[name] !== 'function') continue;
      let attempt = state.inFlight.get(name);
      if (!attempt) {
        attempt = Promise.resolve()
          .then(() => sinks[name]({ ...payload, labels: [...payload.labels] }))
          .then((shown) => {
            if (shown === true) state.delivered.add(name);
          })
          .catch(() => {
            // 알림 표면 하나의 실패가 앱 진입이나 다른 표면 알림을 막아서는 안 된다.
          })
          .finally(() => state.inFlight.delete(name));
        state.inFlight.set(name, attempt);
      }
      attempts.push(attempt);
    }
    await Promise.all(attempts);
    return {
      notified: state.delivered.size > before,
      delivered: ['shell', 'orb', 'os'].filter((name) => state.delivered.has(name)),
    };
  }
}

function showStartupOsNotification(NotificationCtor, payload, { timeoutMs = 2000 } = {}) {
  if (typeof NotificationCtor !== 'function'
    || (typeof NotificationCtor.isSupported === 'function' && !NotificationCtor.isSupported())) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let notification;
    let timer;
    let settled = false;
    const settle = (shown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(shown);
    };
    try {
      notification = new NotificationCtor({ title: payload.title, body: payload.body });
      notification.once('show', () => settle(true));
      notification.once('failed', () => settle(false));
      timer = setTimeout(() => settle(false), timeoutMs);
      notification.show();
    } catch {
      settle(false);
    }
  });
}

async function runStartupOrchestration({
  readiness,
  concurrentTaskIds = [],
  dependencyTaskChains = [],
  dependencyTaskId,
  dependentTaskIds = [],
  continuousTaskIds = [],
}) {
  if (!readiness || typeof readiness.start !== 'function') {
    throw new TypeError('readiness is required');
  }
  for (const id of continuousTaskIds) void readiness.start(id);
  const concurrent = concurrentTaskIds.map((id) => readiness.start(id));
  const chains = dependencyTaskChains.map((ids) => ids.reduce(
    (prior, id) => prior.then(() => readiness.start(id)),
    Promise.resolve(),
  ));
  if (dependencyTaskId) await readiness.start(dependencyTaskId);
  const dependent = dependentTaskIds.map((id) => readiness.start(id));
  await Promise.all([...concurrent, ...chains, ...dependent]);
  return readiness.snapshot();
}

async function waitForInitialReadiness({
  ensureReady,
  maxAttempts,
  attemptTimeoutMs,
  onRetry = () => {},
  errorMessage = '초기 준비를 완료하지 못함',
}) {
  if (typeof ensureReady !== 'function') throw new TypeError('ensureReady is required');
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await ensureReady(attemptTimeoutMs)) return { attempts: attempt };
    if (attempt < attempts) onRetry(attempt);
  }
  throw new Error(errorMessage);
}

function classifyBrainStartupStatus(body = {}) {
  const status = body.startup_ingestion_status;
  const detail = String(body.startup_ingestion_detail || '');
  if (status === null || status === undefined) {
    if (detail === 'brain_disabled') {
      return { state: 'disabled', detail: '브레인 기능이 명시적으로 비활성화됨' };
    }
    return { state: 'failed', detail: detail || '브레인 시작 수집 작업이 생성되지 않음' };
  }
  if (status === 'succeeded') {
    if (body.ready === true && body.ingestion_ready === true) {
      return { state: 'succeeded', detail: detail || '시작 수집 완료' };
    }
    return { state: 'failed', detail: detail || '시작 수집은 끝났지만 브레인 런타임이 준비되지 않음' };
  }
  if (status === 'failed') return { state: 'failed', detail: detail || '브레인 시작 수집 실패' };
  if (status === 'retry_wait') return { state: 'retrying', detail: detail || '브레인 시작 수집 재시도 대기 중' };
  if (status === 'pending' || status === 'running') {
    return { state: 'running', detail: detail || `브레인 시작 수집 ${status}` };
  }
  return { state: 'failed', detail: detail || `알 수 없는 브레인 시작 상태: ${status}` };
}

module.exports = {
  StartupReadiness,
  StartupFailureNotifier,
  buildStartupFailureNotification,
  showStartupOsNotification,
  runStartupOrchestration,
  waitForInitialReadiness,
  classifyBrainStartupStatus,
};
