'use strict';

const {
  buildRegisterBody,
  createRealtimeRegistrar,
} = require('./chart-realtime');

const MAX_VISIBLE_TARGETS = 50;
const BROADCAST_OPERATIONS = new Set(['0s', '1h']);

const OPERATION_POLICIES = Object.freeze([
  policy('00', 'CC-01', 'account', ['overview', 'executions', 'all'], 'account', [
    rule('CC-02', ['draft', 'review', 'confirm', 'all'], 'account'),
  ]),
  policy('04', 'CC-01', 'account', ['overview', 'holdings', 'cash', 'pnl', 'margin', 'all'], 'account', [
    rule('CC-02', ['draft', 'review', 'confirm', 'all'], 'account'),
  ]),
  policy('0A', 'CC-03', 'quote', ['quote', 'expected'], 'symbol'),
  policy('0B', 'CC-03', 'quote', ['quote', 'chart', 'profile', 'etf', 'elw'], 'symbol', [
    rule('CC-05', ['program', 'investor', 'broker'], 'symbol'),
    rule('CC-06', ['ranking', 'watchlist'], 'visibleTargets'),
  ]),
  policy('0C', 'CC-04', 'orderbook', ['regular', 'composite'], 'symbol'),
  policy('0D', 'CC-04', 'orderbook', ['regular', 'composite'], 'symbol'),
  policy('0E', 'CC-04', 'orderbook', ['after-hours'], 'symbol'),
  policy('0F', 'CC-05', 'broker', ['broker'], 'symbol'),
  policy('0G', 'CC-03', 'etf', ['etf'], 'symbol'),
  policy('0H', 'CC-03', 'quote', ['expected'], 'symbol', [
    rule('CC-06', ['ranking'], 'visibleTargets'),
  ]),
  policy('0I', 'CC-03', 'gold', ['gold'], 'market'),
  policy('0J', 'CC-06', 'sector', ['sector'], 'sector'),
  policy('0U', 'CC-06', 'sector', ['sector'], 'sector'),
  policy('0g', 'CC-03', 'stock-info', ['profile'], 'symbol', [
    rule('CC-06', ['watchlist'], 'visibleTargets'),
  ]),
  policy('0m', 'CC-03', 'elw', ['elw'], 'symbol'),
  policy('0s', 'CC-06', 'market-status', ['market-status', 'session'], 'market'),
  policy('0u', 'CC-03', 'elw', ['elw'], 'symbol'),
  policy('0w', 'CC-05', 'program-trading', ['program'], 'symbol'),
  policy('1h', 'CC-06', 'market-status', ['market-status', 'vi'], 'market'),
  commandPolicy('ka10171', 'condition-list'),
  commandPolicy('ka10172', 'condition-search'),
  Object.freeze({
    operationId: 'ka10173',
    primaryCardId: 'CC-06',
    capabilityId: 'condition-search',
    behavior: 'lease',
    rules: Object.freeze([rule('CC-06', ['condition-search'], 'condition')]),
    releaseOperationId: 'ka10174',
  }),
  Object.freeze({
    operationId: 'ka10174',
    primaryCardId: 'CC-06',
    capabilityId: 'condition-search',
    behavior: 'release-command',
    rules: Object.freeze([]),
  }),
]);
const WEBSOCKET_OPERATION_IDS = new Set(OPERATION_POLICIES.map((entry) => entry.operationId));

function rule(cardId, modes, targetSource) {
  return Object.freeze({ cardId, modes: Object.freeze([...modes]), targetSource });
}

function policy(operationId, primaryCardId, capabilityId, modes, targetSource, sharedRules = []) {
  return Object.freeze({
    operationId,
    primaryCardId,
    capabilityId,
    behavior: 'lease',
    rules: Object.freeze([rule(primaryCardId, modes, targetSource), ...sharedRules]),
  });
}

function commandPolicy(operationId, mode) {
  return Object.freeze({
    operationId,
    primaryCardId: 'CC-06',
    capabilityId: 'condition-search',
    behavior: 'command',
    rules: Object.freeze([rule('CC-06', [mode], 'condition')]),
  });
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeSecurityTarget(value) {
  const target = clean(value);
  return /^[AJQ]\d{6}$/.test(target) ? target.slice(1) : target;
}

function validateTarget(source, value) {
  const target = source === 'symbol' || source === 'visibleTargets'
    ? normalizeSecurityTarget(value)
    : clean(value);
  const patterns = {
    account: /^[A-Za-z0-9-]{1,32}$/,
    condition: /^\d{1,10}$/,
    market: /^[A-Za-z0-9_-]{1,16}$/,
    sector: /^[A-Za-z0-9_-]{1,16}$/,
    symbol: /^\d{6}$/,
    visibleTargets: /^\d{6}$/,
  };
  if (!patterns[source] || !patterns[source].test(target)) {
    throw new TypeError(`invalid ${source} realtime target`);
  }
  return target;
}

function targetsFor(source, config) {
  if (source === 'visibleTargets') {
    const values = Array.isArray(config.visibleTargets) ? config.visibleTargets : [];
    if (values.length > MAX_VISIBLE_TARGETS) {
      throw new RangeError(`visibleTargets exceeds ${MAX_VISIBLE_TARGETS}`);
    }
    return [...new Set(values.map((value) => validateTarget(source, value)))];
  }
  const bySource = {
    account: config.accountId || config.target,
    condition: config.conditionId || config.target,
    market: config.target || 'MARKET',
    sector: config.sectorId || config.target,
    symbol: config.symbol || config.target,
  };
  const target = clean(bySource[source]);
  return target ? [validateTarget(source, target)] : [];
}

function resolveLeaseBindings(config = {}) {
  const cardId = clean(config.cardId);
  const mode = clean(config.mode) || 'overview';
  const accountId = clean(config.accountId);
  const verifiedRefs = Array.isArray(config.verifiedOperationRefs)
    ? config.verifiedOperationRefs
    : (Array.isArray(config.operationRefs) ? config.operationRefs : []);
  const requestedOperations = new Set(
    verifiedRefs
      .map((ref) => clean(ref).replace(/^base:/, ''))
      .filter((operationId) => WEBSOCKET_OPERATION_IDS.has(operationId))
      .filter(Boolean),
  );
  const bindings = [];
  for (const operation of OPERATION_POLICIES) {
    if (operation.behavior !== 'lease') continue;
    for (const bindingRule of operation.rules) {
      if (bindingRule.cardId !== cardId) continue;
      const explicit = requestedOperations.has(operation.operationId);
      if (!explicit && !bindingRule.modes.includes(mode)) continue;
      if (requestedOperations.size > 0 && !explicit) continue;
      for (const target of targetsFor(bindingRule.targetSource, config)) {
        bindings.push(Object.freeze({
          operationId: operation.operationId,
          releaseOperationId: operation.releaseOperationId || operation.operationId,
          target,
          accountId,
        }));
      }
    }
  }
  return bindings.sort((a, b) => physicalKey(a).localeCompare(physicalKey(b)));
}

function physicalKey(binding) {
  return `${binding.operationId}\u0000${binding.accountId || ''}\u0000${binding.target}`;
}

function samePresentation(configA, configB) {
  return clean(configA.cardId) === clean(configB.cardId)
    && clean(configA.mode) === clean(configB.mode);
}

function publicPolicies() {
  return OPERATION_POLICIES.map((entry) => ({
    operationId: entry.operationId,
    primaryCardId: entry.primaryCardId,
    capabilityId: entry.capabilityId,
    behavior: entry.behavior,
    releaseOperationId: entry.releaseOperationId || null,
    rules: entry.rules.map((item) => ({ ...item, modes: [...item.modes] })),
  }));
}

async function validateWsHttpResponse(response) {
  if (!response || !response.ok) return false;
  if (typeof response.json !== 'function') return true;
  try {
    const body = await response.json();
    return Boolean(body && String(body.return_code) === '0');
  } catch {
    return false;
  }
}

function createValidatedFetch(fetchImpl = globalThis.fetch) {
  return async (...args) => {
    const response = await fetchImpl(...args);
    const ok = await validateWsHttpResponse(response);
    return { ok, status: response ? response.status : 0 };
  };
}

function normalizeFrameRows(frame) {
  if (!frame || frame.trnm !== 'REAL') return [];
  const sourceRows = Array.isArray(frame.data) ? frame.data : [];
  const rows = sourceRows.map((row) => ({ ...row }));
  if (frame.seq || frame['841'] || (frame.values && frame.values['841'])) {
    rows.push({
      type: 'ka10173',
      item: frame.seq || frame['841'] || frame.values['841'],
      values: frame.values || frame,
    });
  }
  return rows.map((row) => {
    const operationId = clean(row.type);
    const values = row.values && typeof row.values === 'object' ? row.values : {};
    let target = clean(row.item || row.name);
    if (operationId === '00' || operationId === '04') target = clean(values['9201'] || target);
    else if (operationId === 'ka10173') target = clean(row.seq || values['841'] || target);
    else if (!BROADCAST_OPERATIONS.has(operationId)) {
      target = normalizeSecurityTarget(values['9001'] || target);
    }
    return { operationId, target, row };
  }).filter((entry) => entry.operationId);
}

function createRegistrarTransport(options = {}) {
  const backendBase = options.backendBase;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const mdlog = options.mdlog || (() => {});
  const registrarProvider = options.registrarProvider || ((binding) => createRealtimeRegistrar({
    backendBase,
    fetchImpl: createValidatedFetch(fetchImpl),
    mdlog,
    trId: binding.operationId,
    account: binding.accountId || null,
  }));
  const registrars = new Map();

  function registrarFor(binding) {
    const key = `${binding.operationId}\u0000${binding.accountId || ''}`;
    let registrar = registrars.get(key);
    if (!registrar) {
      registrar = registrarProvider(binding);
      registrars.set(key, registrar);
    }
    return registrar;
  }

  async function post(operationId, body, accountId) {
    const headers = { 'Content-Type': 'application/json' };
    if (accountId) headers['X-Athena-Account'] = accountId;
    try {
      const response = await fetchImpl(`${backendBase}/api/v1/websocket/${operationId}`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      if (!response || !response.ok) {
        return { ok: false, error: `HTTP ${response ? response.status : '?'}` };
      }
      let data = null;
      if (typeof response.json === 'function') {
        try { data = await response.json(); } catch { /* ACK body is optional here. */ }
      }
      if (!data || String(data.return_code) !== '0') {
        return { ok: false, error: `Kiwoom return_code ${data ? data.return_code : '?'}` };
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  }

  async function acquire(binding) {
    if (binding.operationId === 'ka10173') {
      const result = await post('ka10173', {
        trnm: 'CNSRREQ', seq: binding.target, search_type: '1', stex_tp: 'K',
      }, binding.accountId);
      return result.ok;
    }
    return registrarFor(binding).acquire(binding.target);
  }

  async function release(binding) {
    if (binding.operationId === 'ka10173') {
      const result = await post('ka10174', {
        trnm: 'CNSRCLR', seq: binding.target,
      }, binding.accountId);
      return result.ok;
    }
    return registrarFor(binding).release(binding.target);
  }

  async function reconnect(bindings) {
    return Promise.all(bindings.map(async (binding) => {
      if (binding.operationId === 'ka10173') {
        const ok = await acquire(binding);
        return { binding, ok, error: ok ? null : 'condition re-registration failed' };
      }
      const result = await post(
        binding.operationId,
        buildRegisterBody([binding.target], binding.operationId),
        binding.accountId,
      );
      return { binding, ok: result.ok, error: result.error || null };
    }));
  }

  async function command(operationId, payload = {}, accountId = '') {
    const operation = OPERATION_POLICIES.find((entry) => entry.operationId === operationId);
    if (!operation || operation.behavior !== 'command') {
      return { ok: false, error: 'unsupported realtime command' };
    }
    const body = operationId === 'ka10171'
      ? { trnm: 'CNSRLST' }
      : {
        trnm: 'CNSRREQ',
        seq: clean(payload.seq || payload.conditionId),
        search_type: '0',
        stex_tp: clean(payload.stex_tp) || 'K',
        ...(payload.cont_yn ? { cont_yn: clean(payload.cont_yn) } : {}),
        ...(payload.next_key ? { next_key: clean(payload.next_key) } : {}),
      };
    if (operationId === 'ka10172' && !body.seq) return { ok: false, error: 'condition id is required' };
    return post(operationId, body, clean(accountId));
  }

  return { acquire, release, reconnect, command };
}

class CardLeaseManager {
  constructor(options = {}) {
    if (!options.transport) throw new TypeError('transport is required');
    this._transport = options.transport;
    this._onState = options.onState || (() => {});
    this._leases = new Map();
    this._physical = new Map();
    this._tombstones = new Map();
    this._queue = Promise.resolve();
    this._connectionGeneration = Number(options.initialConnectionGeneration) || 1;
    this._needsReconnect = false;
  }

  mount(config = {}) {
    return this._serialized(() => this._mountOrUpdate(config, false));
  }

  update(config = {}) {
    return this._serialized(() => this._mountOrUpdate(config, true));
  }

  unmount(leaseId) {
    return this._serialized(async () => {
      const id = clean(leaseId);
      const lease = this._leases.get(id);
      if (!lease) {
        const tombstone = this._tombstones.get(id);
        return tombstone
          ? { ok: false, ...tombstone }
          : { ok: true, status: 'unmounted', leaseId: id };
      }
      this._leases.delete(id);
      let removed = true;
      for (const binding of lease.bindings) {
        if (!await this._dropOwner(binding, id)) removed = false;
      }
      if (!removed) {
        const state = { ...this._snapshotLease(lease), status: 'remove-pending', error: 'REMOVE failed' };
        this._tombstones.set(id, state);
        this._emit(state);
        return { ok: false, ...state };
      }
      this._tombstones.delete(id);
      const state = { ...this._snapshotLease(lease), status: 'unmounted' };
      this._emit(state);
      return { ok: true, ...state };
    });
  }

  handleFeedStatus(status = {}, observedConnectionGeneration = null) {
    const state = clean(status.state);
    const observed = Number(observedConnectionGeneration) || null;
    if (observed && observed < this._connectionGeneration) {
      return Promise.resolve({ ok: true, status: 'stale-connection-status' });
    }
    if (state === 'disconnected' || state === 'retrying') {
      this._needsReconnect = true;
      for (const lease of this._leases.values()) {
        if (lease.bindings.length === 0) continue;
        lease.status = 'reconnecting';
        this._emit(this._snapshotLease(lease));
      }
      return Promise.resolve({ ok: true, status: 'reconnecting' });
    }
    if ((state === 'open' || state === 'connected') && this._needsReconnect) {
      return this._serialized(async () => {
        if (!this._needsReconnect) return { ok: true, status: 'active' };
        this._needsReconnect = false;
        this._connectionGeneration = observed
          || this._connectionGeneration + 1;
        const activeEntries = [...this._physical.values()].filter((entry) => entry.owners.size > 0);
        const bindings = activeEntries.map((entry) => entry.binding);
        let results = bindings.length === 0 ? [] : await this._transport.reconnect(bindings);
        let failed = results.filter((result) => !result.ok);
        if (failed.length) {
          const retry = await this._transport.reconnect(failed.map((result) => result.binding));
          const retried = new Map(retry.map((result) => [physicalKey(result.binding), result]));
          results = results.map((result) => retried.get(physicalKey(result.binding)) || result);
          failed = results.filter((result) => !result.ok);
        }
        const failedKeys = new Set(failed.map((result) => physicalKey(result.binding)));
        for (const lease of this._leases.values()) {
          if (lease.bindings.length === 0) continue;
          lease.generation += 1;
          lease.connectionGeneration = this._connectionGeneration;
          const leaseFailed = lease.bindings.some((binding) => failedKeys.has(physicalKey(binding)));
          lease.status = leaseFailed ? 'error' : 'active';
          lease.error = leaseFailed ? 'realtime re-registration failed' : null;
          this._emit(this._snapshotLease(lease));
        }
        await this._retryPendingRemovals();
        const ok = failed.length === 0;
        return { ok, status: ok ? 'active' : 'error', connectionGeneration: this._connectionGeneration };
      });
    }
    if ((state === 'open' || state === 'connected') && observed) {
      this._connectionGeneration = observed;
    }
    return Promise.resolve({ ok: true, status: state || 'unknown' });
  }

  routeFrame(frame, observedConnectionGeneration = this._connectionGeneration) {
    if (Number(observedConnectionGeneration) !== this._connectionGeneration) return [];
    const events = [];
    for (const normalized of normalizeFrameRows(frame)) {
      const { operationId, target, row } = normalized;
      const matching = [...this._physical.values()].filter((entry) => (
        entry.binding.operationId === operationId
        && (BROADCAST_OPERATIONS.has(operationId) || (!target || entry.binding.target === target))
      ));
      for (const entry of matching) {
        for (const leaseId of entry.owners) {
          const lease = this._leases.get(leaseId);
          // A target switch REG failure leaves the previous binding physically active.
          // Its state is error (so UI can show the failure), but its already-valid ticks
          // must continue until the caller retries or unmounts.
          if (!lease || !['active', 'error'].includes(lease.status)) continue;
          events.push({
            leaseId,
            cardId: lease.config.cardId,
            mode: lease.config.mode,
            generation: lease.generation,
            connectionGeneration: lease.connectionGeneration,
            operationId,
            target: entry.binding.target,
            row,
          });
        }
      }
    }
    return events;
  }

  status(leaseId) {
    const id = clean(leaseId);
    const lease = this._leases.get(id);
    return lease ? this._snapshotLease(lease) : this._tombstones.get(id) || null;
  }

  releaseAll() {
    return this._serialized(async () => {
      const ids = [...this._leases.keys()];
      const results = [];
      for (const id of ids) results.push(await this._unmountNow(id));
      await this._retryPendingRemovals();
      return { ok: this._tombstones.size === 0, results, pending: this._tombstones.size };
    });
  }

  _serialized(fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  async _mountOrUpdate(config, requireExisting) {
    const id = clean(config.leaseId);
    if (!id) return { ok: false, status: 'error', error: 'leaseId is required' };
    const old = this._leases.get(id) || null;
    if (requireExisting && !old) return { ok: false, status: 'error', error: 'lease is not mounted' };
    let bindings;
    try {
      bindings = resolveLeaseBindings(config);
    } catch (error) {
      return { ok: false, status: 'error', error: String((error && error.message) || error) };
    }
    if (bindings.length === 0) return { ok: false, status: 'error', error: 'no realtime policy matched this card/mode/target' };
    const oldKeys = new Set(old ? old.bindings.map(physicalKey) : []);
    const nextKeys = new Set(bindings.map(physicalKey));
    if (old && oldKeys.size === nextKeys.size && [...oldKeys].every((key) => nextKeys.has(key))) {
      if (samePresentation(old.config, config)) return { ok: true, ...this._snapshotLease(old) };
      old.config = { ...config, leaseId: id };
      old.generation += 1;
      old.status = 'active';
      old.error = null;
      this._emit(this._snapshotLease(old));
      return { ok: true, ...this._snapshotLease(old) };
    }

    const staged = [];
    for (const binding of bindings) {
      const key = physicalKey(binding);
      if (oldKeys.has(key) || this._physical.has(key)) continue;
      const ok = await this._transport.acquire(binding);
      if (!ok) {
        for (const acquired of staged.reverse()) await this._transport.release(acquired);
        const failed = old || {
          id,
          config: { ...config },
          bindings: [],
          generation: 0,
          connectionGeneration: this._connectionGeneration,
        };
        failed.status = 'error';
        failed.error = `REG failed: ${binding.operationId}`;
        if (!old) this._leases.set(id, failed);
        this._emit(this._snapshotLease(failed));
        return { ok: false, ...this._snapshotLease(failed) };
      }
      staged.push(binding);
    }

    const next = {
      id,
      config: { ...config, leaseId: id },
      bindings,
      generation: (old ? old.generation : 0) + 1,
      connectionGeneration: this._connectionGeneration,
      status: 'active',
      error: null,
    };
    for (const binding of bindings) {
      const key = physicalKey(binding);
      let entry = this._physical.get(key);
      if (!entry) {
        entry = { binding, owners: new Set() };
        this._physical.set(key, entry);
      }
      entry.pendingRemove = false;
      entry.owners.add(id);
    }
    this._leases.set(id, next);
    if (old) {
      for (const binding of old.bindings) {
        if (!nextKeys.has(physicalKey(binding))) await this._dropOwner(binding, id);
      }
    }
    this._emit(this._snapshotLease(next));
    return { ok: true, ...this._snapshotLease(next) };
  }

  async _dropOwner(binding, leaseId) {
    const key = physicalKey(binding);
    const entry = this._physical.get(key);
    if (!entry) return true;
    entry.owners.delete(leaseId);
    if (entry.owners.size > 0) return true;
    const ok = await this._transport.release(entry.binding);
    if (ok) {
      this._physical.delete(key);
      return true;
    }
    entry.pendingRemove = true;
    return false;
  }

  async _unmountNow(id) {
    const lease = this._leases.get(id);
    if (!lease) return { ok: true, status: 'unmounted', leaseId: id };
    this._leases.delete(id);
    let removed = true;
    for (const binding of lease.bindings) {
      if (!await this._dropOwner(binding, id)) removed = false;
    }
    const state = removed
      ? { ...this._snapshotLease(lease), status: 'unmounted' }
      : { ...this._snapshotLease(lease), status: 'remove-pending', error: 'REMOVE failed' };
    if (removed) this._tombstones.delete(id);
    else this._tombstones.set(id, state);
    this._emit(state);
    return { ok: removed, ...state };
  }

  async _retryPendingRemovals() {
    for (const [key, entry] of [...this._physical.entries()]) {
      if (!entry.pendingRemove || entry.owners.size > 0) continue;
      if (await this._transport.release(entry.binding)) this._physical.delete(key);
    }
    if (![...this._physical.values()].some((entry) => entry.pendingRemove)) {
      this._tombstones.clear();
    }
  }

  _snapshotLease(lease) {
    return {
      leaseId: lease.id,
      cardId: lease.config.cardId,
      mode: lease.config.mode,
      generation: lease.generation,
      connectionGeneration: lease.connectionGeneration,
      status: lease.status,
      error: lease.error || null,
      bindings: lease.bindings.map((binding) => ({ ...binding })),
    };
  }

  _emit(state) {
    this._onState(state);
  }
}

function createBoundedShutdownCoordinator({
  prepare = () => {},
  releaseAll,
  shutdownBackend,
  quit,
  timeoutMs = 1500,
  onCleanupResult = () => {},
  onCleanupError = () => {},
  onShutdownError = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof releaseAll !== 'function') throw new TypeError('releaseAll must be a function');
  if (typeof shutdownBackend !== 'function') throw new TypeError('shutdownBackend must be a function');
  if (typeof quit !== 'function') throw new TypeError('quit must be a function');

  let started = false;
  let complete = false;
  let activePromise = null;

  const execute = async () => {
    prepare();
    let timer = null;
    try {
      const result = await Promise.race([
        Promise.resolve(releaseAll()),
        new Promise((resolve) => {
          timer = setTimer(
            () => resolve({ ok: false, pending: -1, timeout: true }),
            timeoutMs,
          );
        }),
      ]);
      onCleanupResult(result);
    } catch (error) {
      onCleanupError(error);
    } finally {
      if (timer !== null) clearTimer(timer);
    }

    try {
      await shutdownBackend();
    } catch (error) {
      onShutdownError(error);
    } finally {
      complete = true;
      quit();
    }
  };

  return {
    begin(event) {
      if (complete) return activePromise || Promise.resolve();
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (!started) {
        started = true;
        activePromise = execute();
      }
      return activePromise;
    },
    status() {
      return { started, complete };
    },
  };
}

module.exports = {
  OPERATION_POLICIES,
  CardLeaseManager,
  createBoundedShutdownCoordinator,
  createRegistrarTransport,
  createValidatedFetch,
  normalizeFrameRows,
  physicalKey,
  publicPolicies,
  resolveLeaseBindings,
};
