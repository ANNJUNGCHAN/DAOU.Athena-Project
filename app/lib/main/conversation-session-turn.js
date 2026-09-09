'use strict';

function abortReason(reason) {
  if (reason instanceof Error) return reason;
  const error = new Error(String(reason || '사용자 중단'));
  error.code = 'ABORTED';
  return error;
}

function runConversationSessionTurn(session, options = {}) {
  if (!session || typeof session.run !== 'function' || typeof session.stop !== 'function') {
    throw new TypeError('session must provide run() and stop()');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object');
  }
  const {
    onSpawn,
    signal: externalSignal,
    stopSession = (reason) => session.stop(reason),
    ...runOptions
  } = options;
  if (onSpawn != null && typeof onSpawn !== 'function') throw new TypeError('options.onSpawn must be a function');
  if (typeof stopSession !== 'function') throw new TypeError('options.stopSession must be a function');

  const controller = new AbortController();
  let stopPromise = null;
  const kill = (reason = null) => {
    const resolvedReason = abortReason(reason || externalSignal?.reason);
    if (!controller.signal.aborted) controller.abort(resolvedReason);
    if (!stopPromise) {
      try {
        stopPromise = Promise.resolve(stopSession(resolvedReason));
      } catch (error) {
        stopPromise = Promise.reject(error);
      }
      // A UI cancellation cannot leave an unhandled rejection while the provider
      // process is being torn down. The returned turn still awaits this promise.
      stopPromise.catch(() => {});
    }
    return stopPromise;
  };

  const onExternalAbort = () => { void kill(externalSignal.reason); };
  if (externalSignal) {
    if (externalSignal.aborted) void kill(externalSignal.reason);
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const initialPid = session.snapshot?.()?.pid ?? null;
  onSpawn?.({ pid: initialPid, kill });

  const runPromise = Promise.resolve().then(() => session.run({
    ...runOptions,
    signal: controller.signal,
    onSpawn: (providerHandle = {}) => onSpawn?.({
      ...providerHandle,
      pid: providerHandle.pid ?? session.snapshot?.()?.pid ?? initialPid,
      kill,
    }),
  }));

  return runPromise.finally(async () => {
    externalSignal?.removeEventListener('abort', onExternalAbort);
    if (stopPromise) await stopPromise.catch(() => {});
  });
}

module.exports = { runConversationSessionTurn };
