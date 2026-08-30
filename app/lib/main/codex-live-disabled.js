'use strict';

const CODEX_LIVE_DISABLED_BY_CONTRACT = 'CODEX_LIVE_DISABLED_BY_CONTRACT';
const CODEX_LIVE_DISABLED_BY_KILL_SWITCH = 'CODEX_LIVE_DISABLED_BY_KILL_SWITCH';

function resolveCodexDisabledSelection({ activeAccount, contractDecision, persistentEnabled } = {}) {
  if (!activeAccount || activeAccount.providerId !== 'codex') return null;
  const code = persistentEnabled === false
    ? CODEX_LIVE_DISABLED_BY_KILL_SWITCH
    : contractDecision === 'CLAUDE_ONLY'
      ? CODEX_LIVE_DISABLED_BY_CONTRACT
      : null;
  if (!code) return null;
  return Object.freeze({ ok: false, type: 'action-needed', provider: 'codex', code });
}

module.exports = Object.freeze({
  CODEX_LIVE_DISABLED_BY_CONTRACT,
  CODEX_LIVE_DISABLED_BY_KILL_SWITCH,
  resolveCodexDisabledSelection,
});

