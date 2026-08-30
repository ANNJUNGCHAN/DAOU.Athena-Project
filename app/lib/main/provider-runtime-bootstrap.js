'use strict';

const ATHENA_GATEWAY_BUILTIN_TOOLS = Object.freeze([
  'athena__render_canvas',
  'athena__save_canvas',
  'athena_search',
  'athena_describe',
  'athena_resolve',
  'athena_call',
  'athena_routine',
  'athena_brain',
  'athena_nudge_guard',
]);
const MAX_GATEWAY_QUALIFIED_TOOL_NAME_LENGTH = 64;

function createProviderAdmissionError(reason) {
  const error = new Error(`provider runtime is temporarily unavailable: ${reason || 'security mutation'}`);
  error.code = 'PROVIDER_RUNTIME_ACTION_NEEDED';
  error.actionNeeded = true;
  return error;
}

function createProviderLifecycleError() {
  const error = new Error('provider runtime has stopped');
  error.code = 'PROVIDER_RUNTIME_STOPPED';
  error.actionNeeded = true;
  return error;
}

function createProviderConversationMismatchError() {
  const error = new Error('provider request conversation does not match the published runtime conversation');
  error.code = 'PROVIDER_CONVERSATION_MISMATCH';
  error.actionNeeded = true;
  return error;
}

function createProviderTurnContextRegistry() {
  const contexts = new Map();
  return Object.freeze({
    set(clientSubmitId, context) { contexts.set(clientSubmitId, context); },
    get(clientSubmitId) { return contexts.get(clientSubmitId); },
    has(clientSubmitId) { return contexts.has(clientSubmitId); },
    deleteIfSame(clientSubmitId, context) {
      if (contexts.get(clientSubmitId) !== context) return false;
      return contexts.delete(clientSubmitId);
    },
    size() { return contexts.size; },
  });
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateMainMcpSecurityState({ registry, consent, canonicalHash } = {}) {
  if (typeof canonicalHash !== 'function') throw new TypeError('canonicalHash required');
  if (!plainObject(registry) || !Number.isSafeInteger(registry.revision) || registry.revision < 0
    || !plainObject(registry.servers) || !/^[a-f0-9]{64}$/.test(String(registry.fingerprint || ''))) {
    throw new TypeError('invalid MCP registry state');
  }
  for (const [alias, record] of Object.entries(registry.servers)) {
    if (!plainObject(record) || record.alias !== alias) throw new TypeError('invalid MCP registry record');
  }
  if (canonicalHash(registry.servers) !== registry.fingerprint) {
    throw new Error('MCP registry fingerprint mismatch');
  }
  const metadata = consent && consent.$athena;
  if (!plainObject(consent) || !plainObject(metadata)
    || !Number.isSafeInteger(metadata.revision) || metadata.revision < 0
    || !/^[a-f0-9]{64}$/.test(String(metadata.fingerprint || ''))) {
    throw new TypeError('invalid MCP consent state');
  }
  const records = {};
  for (const [alias, record] of Object.entries(consent)) {
    if (alias === '$athena') continue;
    if (!plainObject(record) || record.alias !== alias || typeof record.approved !== 'boolean'
      || !Array.isArray(record.approved_tools)
      || record.approved_tools.some((tool) => typeof tool !== 'string')) {
      throw new TypeError('invalid MCP consent record');
    }
    records[alias] = record;
  }
  if (canonicalHash(records) !== metadata.fingerprint) {
    throw new Error('MCP consent fingerprint mismatch');
  }
  return Object.freeze({ registry, consent });
}

function shouldMarkProviderCanvasVisible(result) {
  return Boolean(result) && result.status !== 'pushed';
}

function buildMainMcpRuntimeSnapshot({
  createSnapshot,
  registry = {},
  consent = {},
  claudeServers = {},
  securityGeneration = 0,
  secretRevision = 0,
  gatewayEpochRevision = 0,
  codexConfigRevision = 0,
  disallowedTools = [],
} = {}) {
  if (typeof createSnapshot !== 'function') throw new TypeError('createSnapshot required');
  const consentMetadata = consent.$athena || {};
  const allowedTools = ATHENA_GATEWAY_BUILTIN_TOOLS.map((name) => `mcp__athena__${name}`);
  const registeredAliases = new Set(Object.keys(registry.servers || {}));
  for (const [alias, record] of Object.entries(consent)) {
    if (alias === '$athena' || !registeredAliases.has(alias) || !record || record.approved !== true) continue;
    for (const tool of (Array.isArray(record.approved_tools) ? record.approved_tools : [])) {
      const gatewayToolName = `${alias}__${tool}`;
      if (gatewayToolName.length <= MAX_GATEWAY_QUALIFIED_TOOL_NAME_LENGTH) {
        allowedTools.push(`mcp__athena__${gatewayToolName}`);
      }
    }
  }
  const registryServers = Object.values(registry.servers || {});
  const snapshot = createSnapshot({
    securityGeneration,
    registry: {
      revision: registry.revision || 0,
      fingerprint: registry.fingerprint || '',
      servers: registryServers,
    },
    consent: {
      revision: consentMetadata.revision || 0,
      fingerprint: consentMetadata.fingerprint || '',
    },
    claudeServers,
    secretRevision,
    gatewayEpochRevision,
    codexConfigRevision,
    allowedTools,
    disallowedTools,
  });
  return snapshot;
}

function buildProviderToolPolicy(snapshot, gatewayAllowedTools, disallowedTools) {
  if (!snapshot || !Array.isArray(snapshot.allowedTools)) {
    throw new TypeError('snapshot.allowedTools required');
  }
  const nonMcpTools = String(gatewayAllowedTools || '').split(',')
    .map((tool) => tool.trim())
    .filter((tool) => tool && !tool.startsWith('mcp__'));
  return Object.freeze({
    allowedTools: Object.freeze([...snapshot.allowedTools, ...nonMcpTools]),
    disallowedTools,
  });
}

function resolvePersistentChatEnabled(env = process.env, defaultEnabled = false) {
  if (env.ATHENA_PERSISTENT_CHAT === '1') return true;
  if (env.ATHENA_PERSISTENT_CHAT === '0') return false;
  return defaultEnabled === true;
}

function createColdController() {
  return Object.freeze({
    mode: 'cold',
    start: async () => undefined,
    ready: async () => null,
    sendTurn: async () => { throw new Error('persistent provider runtime is disabled'); },
    interrupt: async () => null,
    rotate: async () => null,
    stop: async () => undefined,
    acknowledgePaint: () => false,
    snapshot: () => Object.freeze({ mode: 'cold', persistentConstructed: false }),
  });
}

function createProviderRuntimeController({
  persistentEnabled,
  contractDecision = 'CLAUDE_ONLY',
  requireFn = require,
  callbacks = {},
  commitSuccess = async () => {},
  metrics = null,
  capabilityEnv = () => ({}),
  stateDir = null,
  epochStore: suppliedEpochStore = null,
  retentionMs = 60_000,
  maxRetainedTurns = 256,
  now = Date.now,
  readProcessCreationTime = null,
} = {}) {
  if (!persistentEnabled) return createColdController();
  if (contractDecision === 'NO_GO') throw new Error('provider contract decision is NO_GO');

  const { ProviderSessionSupervisor } = requireFn('./provider-session-supervisor');
  const { createProviderEventRouter } = requireFn('./provider-event-router');
  const { createClaudeAgentSession } = requireFn('./claude-agent-session');
  const { terminateTree } = requireFn('./proc-utils');
  void suppliedEpochStore;
  void stateDir;
  const routers = new Map();
  const submissions = new Map();
  const capabilityContexts = new Map();
  let activeTurnId = null;
  let admissionBlocked = false;
  let admissionReason = null;
  let lifecycleTail = Promise.resolve();
  let lifecycleClosed = false;
  let stopPromise = null;
  let publishedConversationId = null;

  function assertLifecycleOpen() {
    if (lifecycleClosed) throw createProviderLifecycleError();
  }

  function serializeLifecycle(task) {
    const result = lifecycleTail.then(task, task);
    lifecycleTail = result.catch(() => {});
    return result;
  }

  function deleteSubmission(clientSubmitId) {
    routers.delete(clientSubmitId);
    submissions.delete(clientSubmitId);
  }

  function pruneRetained() {
    const cutoff = now() - Math.max(0, retentionMs);
    for (const [clientSubmitId, entry] of submissions) {
      if (entry.terminalAt !== null && entry.terminalAt <= cutoff) deleteSubmission(clientSubmitId);
    }
    if (submissions.size <= maxRetainedTurns) return;
    for (const [clientSubmitId, entry] of submissions) {
      if (submissions.size <= maxRetainedTurns) break;
      if (entry.terminalAt !== null) deleteSubmission(clientSubmitId);
    }
  }

  const supervisor = new ProviderSessionSupervisor({
    adapterFactory(provider) {
      if (provider !== 'claude') throw new Error('CODEX_LIVE_DISABLED_BY_CONTRACT');
      return createClaudeAgentSession();
    },
    generationContextFactory({ desiredState }) {
      let current = true;
      const capability = capabilityContexts.get(desiredState.configGeneration);
      if (!capability || !capability.stamp
        || capability.stamp.securityGeneration !== desiredState.securityGeneration) {
        throw new Error('matching gateway capability context is required');
      }
      return {
        spawnContext: Object.freeze({
          assertCurrent() { if (!current) throw new Error('stale provider generation'); },
          buildEnv() { return { ...capabilityEnv(), ...capability.buildCapabilityEnv() }; },
          registerChild(child, metadata = {}) {
            const expectedCreationTime = metadata.expectedCreationTime
              ?? child.expectedCreationTime
              ?? child.creationTime;
            const creationTimeReader = metadata.readCreationTime || readProcessCreationTime;
            return Object.freeze({
              async terminate() {
                current = false;
                return terminateTree(child, {
                  expectedCreationTime,
                  readCreationTime: creationTimeReader,
                });
              },
            });
          },
        }),
      };
    },
    commitSuccess,
    onEvent(event) {
      const entry = submissions.get(event.clientSubmitId);
      if (!entry) return;
      if (!entry.turnId) {
        entry.turnId = event.turnId;
        activeTurnId = event.turnId;
        callbacks.onTurnBound?.(event, Object.freeze({
          expectedRendererId: entry.expectedRendererId,
          rendererSubmittedAt: entry.rendererSubmittedAt,
        }));
        metrics?.beginTurn?.({
          clientSubmitId: event.clientSubmitId,
          turnId: event.turnId,
          provider: event.provider,
          origin: entry.request.origin,
          m0: entry.m0,
        });
      }
      if (entry.turnId !== event.turnId) return;
      metrics?.mark?.(event.turnId, 'm3', event.monotonicAtMs);
      let router = routers.get(event.clientSubmitId);
      if (!router) {
        router = createProviderEventRouter({
          ...callbacks,
          origin: entry.request.origin,
          clientSubmitId: event.clientSubmitId,
        });
        routers.set(event.clientSubmitId, router);
      }
      router.route(event);
      metrics?.mark?.(event.turnId, 'm4');
    },
  });

  return Object.freeze({
    mode: 'persistent',
    start(desired, capabilityContext) {
      return serializeLifecycle(async () => {
        assertLifecycleOpen();
        capabilityContexts.clear();
        if (capabilityContext) capabilityContexts.set(desired.configGeneration, capabilityContext);
        await supervisor.start(desired);
        assertLifecycleOpen();
        publishedConversationId = desired.conversationId || null;
      });
    },
    ready() {
      return serializeLifecycle(async () => {
        assertLifecycleOpen();
        const result = await supervisor.ready();
        assertLifecycleOpen();
        return result;
      });
    },
    async sendTurn({ request, expectedRendererId, rendererSubmittedAt }) {
      if (admissionBlocked) throw createProviderAdmissionError(admissionReason);
      if (!request || request.conversationId !== publishedConversationId) {
        throw createProviderConversationMismatchError();
      }
      pruneRetained();
      submissions.set(request.clientSubmitId, {
        request, expectedRendererId, rendererSubmittedAt, turnId: null, acked: false,
        m0: performance.now(), terminalAt: null,
      });
      try {
        const result = await supervisor.sendTurn(request);
        activeTurnId = activeTurnId === result.turnId ? null : activeTurnId;
        metrics?.completeTurn?.(result.turnId, result.ok ? 'completed' : result.interrupted ? 'interrupted' : 'failed');
        return result;
      } finally {
        const entry = submissions.get(request.clientSubmitId);
        if (entry) entry.terminalAt = now();
        pruneRetained();
      }
    },
    interrupt(reason = 'user_interrupt') {
      return activeTurnId ? supervisor.interrupt(activeTurnId, reason) : Promise.resolve(null);
    },
    blockNewTurns(reason = 'security mutation') {
      admissionBlocked = true;
      admissionReason = typeof reason === 'string' ? reason : reason && reason.kind;
    },
    unblockTurns() {
      if (lifecycleClosed) return false;
      admissionBlocked = false;
      admissionReason = null;
      return true;
    },
    rotate(desired, reason, capabilityContext) {
      return serializeLifecycle(async () => {
        assertLifecycleOpen();
        capabilityContexts.clear();
        if (capabilityContext) capabilityContexts.set(desired.configGeneration, capabilityContext);
        const result = await supervisor.rotate(desired, reason);
        assertLifecycleOpen();
        publishedConversationId = desired.conversationId || null;
        return result;
      });
    },
    stop(reason) {
      lifecycleClosed = true;
      admissionBlocked = true;
      admissionReason = reason || 'provider stopped';
      if (!stopPromise) {
        stopPromise = serializeLifecycle(async () => {
          await supervisor.stop(reason);
          routers.clear();
          submissions.clear();
          capabilityContexts.clear();
          publishedConversationId = null;
        });
      }
      return stopPromise;
    },
    acknowledgePaint(payload, senderId) {
      pruneRetained();
      const entry = submissions.get(payload && payload.clientSubmitId);
      if (!entry || entry.acked || entry.turnId !== payload.turnId || entry.expectedRendererId !== senderId) {
        metrics?.increment?.('paint_ack_rejected_total');
        return false;
      }
      const accepted = metrics?.acknowledgePaint
        ? metrics.acknowledgePaint(payload)
        : true;
      if (!accepted) return false;
      entry.acked = true;
      return true;
    },
    snapshot() {
      pruneRetained();
      return Object.freeze({
        mode: 'persistent', persistentConstructed: true,
        admissionBlocked,
        lifecycleClosed,
        publishedConversationId,
        retainedSubmissions: submissions.size, retainedRouters: routers.size,
        ...supervisor.snapshot(),
      });
    },
  });
}

module.exports = {
  ATHENA_GATEWAY_BUILTIN_TOOLS,
  MAX_GATEWAY_QUALIFIED_TOOL_NAME_LENGTH,
  buildMainMcpRuntimeSnapshot,
  buildProviderToolPolicy,
  createProviderTurnContextRegistry,
  createProviderRuntimeController,
  resolvePersistentChatEnabled,
  shouldMarkProviderCanvasVisible,
  validateMainMcpSecurityState,
};
