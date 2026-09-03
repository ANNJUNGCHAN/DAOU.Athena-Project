'use strict';

const MUTATION_KINDS = new Set([
  'register',
  'approve',
  'revoke',
  'allow',
  'disallow',
  'remove',
  'secret-update',
  // 플러그인 승인 카드 한 장이 담은 동작들을 한 묶음으로 돌린다 — 기존 7종 중
  // 어느 것도 재사용하지 않는다(감사·로그가 묶음을 단일 동작으로 오독한다).
  'plugin-batch',
]);

function safeMessage(error) {
  const value = String((error && error.message) || error || 'runtime update failed')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return value.slice(0, 240) || 'runtime update failed';
}

function createSerialExecutor() {
  let tail = Promise.resolve();
  return function serial(task) {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
}

function assertRuntime(runtime) {
  const methods = [
    'blockNewTurns',
    'interruptAndDrain',
    'fenceAndStop',
    'startGeneration',
    'publishGeneration',
    'unblockTurns',
  ];
  for (const name of methods) {
    if (!runtime || typeof runtime[name] !== 'function') {
      throw new TypeError(`runtime.${name} must be a function`);
    }
  }
}

function normalizeFence(result) {
  if (result === true) return { ok: true };
  if (!result || result.ok !== true) return { ok: false, evidence: result || null };
  return result;
}

function snapshotEpochRevision(snapshot) {
  return snapshot?.gatewayEpochRevision
    ?? snapshot?.mcpSnapshot?.gatewayEpochRevision
    ?? snapshot?.desiredState?.mcpSnapshot?.gatewayEpochRevision;
}

function assertMigrationComplete(result) {
  if (!result || !Array.isArray(result.migrated) || !Array.isArray(result.skipped)) {
    throw new Error('MCP plaintext migration did not return authoritative completion evidence');
  }
  if (result.skipped.length > 0) {
    throw new Error(`MCP plaintext migration skipped ${result.skipped.length} value(s)`);
  }
  return result;
}

function createMcpRuntimeCoordinator({
  mode = 'persistent',
  runtime,
  coldRuntime = null,
  epochStore,
  migratePlaintextEnv,
  readSnapshot,
  enabledProviders = () => ['claude'],
  initialSecurityGeneration = 0,
} = {}) {
  if (!['persistent', 'cold'].includes(mode)) throw new TypeError('mode must be persistent or cold');
  if (mode === 'persistent') {
    assertRuntime(runtime);
    if (!epochStore || typeof epochStore.invalidate !== 'function'
      || typeof epochStore.publishGeneration !== 'function') {
      throw new TypeError('epochStore must own invalidate and publishGeneration');
    }
  }
  if (typeof migratePlaintextEnv !== 'function') throw new TypeError('migratePlaintextEnv required');
  if (typeof readSnapshot !== 'function') throw new TypeError('readSnapshot required');
  if (typeof enabledProviders !== 'function') throw new TypeError('enabledProviders must be a function');
  if (!Number.isSafeInteger(initialSecurityGeneration) || initialSecurityGeneration < 0) {
    throw new TypeError('initialSecurityGeneration must be a non-negative integer');
  }

  const serial = createSerialExecutor();
  let reservedGeneration = initialSecurityGeneration;
  let publishedGeneration = initialSecurityGeneration;

  async function runColdMutation({ apply }) {
    let persisted = false;
    try {
      if (coldRuntime && typeof coldRuntime.interruptAndTerminate === 'function') {
        const stopped = await coldRuntime.interruptAndTerminate('mcp-security-mutation');
        if (stopped && stopped.ok === false) {
          return {
            ok: false,
            persisted: false,
            fenced: false,
            runtimeApplied: false,
            securityGeneration: publishedGeneration,
            error: safeMessage(stopped.error || 'legacy child termination failed'),
          };
        }
      }
      await apply();
      persisted = true;
      assertMigrationComplete(await migratePlaintextEnv());
      await readSnapshot();
      return {
        ok: true,
        persisted: true,
        fenced: true,
        runtimeApplied: true,
        securityGeneration: publishedGeneration,
        error: null,
      };
    } catch (error) {
      return {
        ok: false,
        persisted,
        fenced: true,
        runtimeApplied: false,
        securityGeneration: publishedGeneration,
        error: safeMessage(error),
      };
    }
  }

  async function runPersistentMutation({ kind, apply }) {
    const securityGeneration = ++reservedGeneration;
    let persisted = false;
    let fenced = false;
    let capabilityContext = null;

    async function failClosedIssuedCapability() {
      if (!capabilityContext) return;
      try { capabilityContext.dispose(); } catch { /* token disposal is best effort */ }
      capabilityContext = null;
      try { epochStore.invalidate(securityGeneration); } catch { /* retain original failure */ }
      try {
        await runtime.fenceAndStop({
          kind,
          securityGeneration,
          providers: Object.freeze([...enabledProviders()]),
          reason: 'capability-publication-failed',
        });
      } catch { /* admission remains blocked */ }
    }

    try {
      await runtime.blockNewTurns({ kind, securityGeneration });
      epochStore.invalidate(securityGeneration);
      fenced = true;
      await runtime.interruptAndDrain({ kind, securityGeneration });
      const fence = normalizeFence(await runtime.fenceAndStop({
        kind,
        securityGeneration,
        providers: Object.freeze([...enabledProviders()]),
      }));
      if (!fence.ok) {
        return {
          ok: false,
          persisted: false,
          fenced: true,
          runtimeApplied: false,
          securityGeneration,
          error: '기존 도구 런타임을 안전하게 종료하지 못했습니다.',
        };
      }

      await apply();
      persisted = true;
      assertMigrationComplete(await migratePlaintextEnv());
      capabilityContext = epochStore.publishGeneration(securityGeneration);
      const snapshot = await readSnapshot({ securityGeneration, capabilityContext });
      if (!capabilityContext.stamp
        || snapshotEpochRevision(snapshot) !== capabilityContext.stamp.epochRevision) {
        throw new Error('runtime snapshot does not match the issued gateway capability epoch');
      }
      const started = await runtime.startGeneration({
        kind,
        securityGeneration,
        snapshot,
        capabilityContext,
        providers: Object.freeze([...enabledProviders()]),
      });
      if (!started || started.ok !== true) {
        await failClosedIssuedCapability();
        return {
          ok: false,
          persisted: true,
          fenced: true,
          runtimeApplied: false,
          securityGeneration,
          error: safeMessage(started && started.error),
        };
      }

      await runtime.publishGeneration({
        kind,
        securityGeneration,
        snapshot,
        capabilityContext,
        started,
      });
      publishedGeneration = securityGeneration;
      await runtime.unblockTurns({ kind, securityGeneration });
      return {
        ok: true,
        persisted: true,
        fenced: true,
        runtimeApplied: true,
        securityGeneration,
        error: null,
      };
    } catch (error) {
      await failClosedIssuedCapability();
      return {
        ok: false,
        persisted,
        fenced,
        runtimeApplied: false,
        securityGeneration,
        error: safeMessage(error),
      };
    }
  }

  function mutate({ kind, apply } = {}) {
    if (!MUTATION_KINDS.has(kind)) return Promise.reject(new TypeError(`unknown mutation kind: ${kind}`));
    if (typeof apply !== 'function') return Promise.reject(new TypeError('mutation apply function required'));
    return serial(() => (mode === 'cold'
      ? runColdMutation({ kind, apply })
      : runPersistentMutation({ kind, apply })));
  }

  return Object.freeze({
    mutate,
    snapshot() {
      return Object.freeze({ mode, reservedGeneration, publishedGeneration });
    },
  });
}

module.exports = {
  MUTATION_KINDS,
  createMcpRuntimeCoordinator,
  createSerialExecutor,
  assertMigrationComplete,
  safeMessage,
};
