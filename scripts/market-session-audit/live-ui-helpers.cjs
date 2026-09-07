'use strict';

const path = require('path');

const TERMINAL_BOOT_PHASES = new Set(['ready', 'degraded']);
const VALID_TOKEN_STATES = new Set(['needed', 'refreshing', 'ready', 'expired']);
const SETTINGS_PANEL_KEYS = new Set(['screen', 'accounts', 'model', 'history']);

const EFFECTIVE_VISIBILITY_JS = `
  const effective = (nodeOrId) => {
    const node = typeof nodeOrId === 'string' ? document.getElementById(nodeOrId) : nodeOrId;
    if (!node || !node.isConnected) return false;
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden === true) return false;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) return false;
    }
    const rect = node.getBoundingClientRect();
    const intersectsViewport = rect.right > 0 && rect.bottom > 0
      && rect.left < window.innerWidth && rect.top < window.innerHeight;
    return node.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 && intersectsViewport;
  };
`;

function readJson(fsImpl, file) {
  try {
    return JSON.parse(fsImpl.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function validateAuditEnvironment(env, fsImpl) {
  const userData = String(env.ATHENA_AUDIT_USERDATA || '').trim();
  if (!userData) throw new Error('AUDIT_USERDATA_REQUIRED');
  if (!path.isAbsolute(userData)) throw new Error('AUDIT_USERDATA_NOT_ABSOLUTE');
  if (!fsImpl.existsSync(userData) || !fsImpl.statSync(userData).isDirectory()) {
    throw new Error('AUDIT_USERDATA_NOT_DIRECTORY');
  }
  if (fsImpl.existsSync(path.join(userData, '.athena-verify-profile.json'))) {
    throw new Error('VERIFY_PROFILE_FORBIDDEN');
  }
  const onboarding = readJson(fsImpl, path.join(userData, 'athena-onboarding.json'));
  const accounts = readJson(fsImpl, path.join(userData, 'athena-accounts.json'));
  const onboardingValid = onboarding && typeof onboarding.accountDone === 'boolean'
    && typeof onboarding.cliDone === 'boolean';
  const accountsValid = accounts && Array.isArray(accounts.accounts)
    && (accounts.activeId === null || typeof accounts.activeId === 'string');
  if (!onboardingValid || !accountsValid) throw new Error('ATHENA_PROFILE_MARKERS_INVALID');
  if (String(env.ATHENA_NO_AUTOSTART || '').trim()) throw new Error('AUTOSTART_BYPASS_FORBIDDEN');
  const canvasSource = String(env.ATHENA_CANVAS_SOURCE || '').trim();
  if (canvasSource && canvasSource !== 'live') throw new Error('CANVAS_SOURCE_NOT_LIVE');
  if (env.ATHENA_ENABLE_ORDER_API !== 'false') throw new Error('ORDER_API_MUST_BE_DISABLED');
  if (env.ATHENA_ROUTINES_ENABLED !== 'false') throw new Error('ROUTINES_MUST_BE_DISABLED');
  return path.resolve(userData);
}

function timeoutCode(label) {
  return `${String(label || 'operation').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TIMEOUT`;
}

function sanitizeBootSnapshot(snapshot) {
  const phase = snapshot && typeof snapshot.phase === 'string' ? snapshot.phase : 'unknown';
  const tasks = Array.isArray(snapshot && snapshot.tasks) ? snapshot.tasks : [];
  return {
    phase,
    terminal: TERMINAL_BOOT_PHASES.has(phase),
    revision: Number.isSafeInteger(snapshot && snapshot.revision) ? snapshot.revision : null,
    tasks: tasks.map((task) => ({
      id: typeof task.id === 'string' ? task.id : 'unknown',
      kind: task.kind === 'gate' || task.kind === 'continuous' ? task.kind : 'unknown',
      state: typeof task.state === 'string' ? task.state : 'unknown',
      attempt: Number.isSafeInteger(task.attempt) ? task.attempt : 0,
      retryable: task.retryable === true,
      error_code: task.state === 'failed' ? 'BOOT_TASK_FAILED' : null,
    })),
  };
}

function summarizeAccounts(list, tokenStates) {
  const accounts = Array.isArray(list && list.accounts) ? list.accounts : [];
  const activeCount = accounts.filter((account) => account && account.active === true).length;
  const tokenStateCounts = { needed: 0, refreshing: 0, ready: 0, expired: 0, unknown: 0 };
  for (const account of accounts) {
    const id = account && typeof account.id === 'string' ? account.id : null;
    const rawState = id && tokenStates.get(id);
    const state = VALID_TOKEN_STATES.has(rawState) ? rawState : 'unknown';
    tokenStateCounts[state] += 1;
  }
  return {
    count: accounts.length,
    active_count: activeCount,
    active_present: activeCount > 0,
    token_state_counts: tokenStateCounts,
  };
}

async function withRestoration(work, restore) {
  let value;
  let workError = null;
  try {
    value = await work();
  } catch (error) {
    workError = error;
  }
  let restoreError = null;
  try {
    await restore();
  } catch (error) {
    restoreError = error;
  }
  if (workError) throw workError;
  if (restoreError) throw restoreError;
  return value;
}

function buildPanelStateScript(key) {
  if (!SETTINGS_PANEL_KEYS.has(key)) throw new Error('SETTINGS_PANEL_KEY_INVALID');
  return `(() => {
    ${EFFECTIVE_VISIBILITY_JS}
    const panelKey = ${JSON.stringify(key)};
    const card = document.querySelector('#settingsGrid > .card.' + panelKey);
    if (!card || !card.isConnected) return { rendered: false, effective: false, settled: false, aggregate_rows: 0 };
    const settledSelectors = {
      screen: '.uk-settings-title', accounts: '.uk-settings-title', model: '.uk-settings-title', history: '.uk-history-section',
    };
    const rows = panelKey === 'history'
      ? card.querySelectorAll('.uk-history-row').length
      : card.querySelectorAll('.uk-toggle-row, .uk-model-section, .uk-account-row').length;
    return {
      rendered: true,
      effective: effective(card),
      settled: !!card.querySelector(settledSelectors[panelKey]),
      aggregate_rows: rows,
    };
  })()`;
}

function summarizeModelPrefs(modelState) {
  const state = modelState && typeof modelState === 'object' ? modelState : {};
  return {
    providers: ['claude', 'grok', 'codex'].map((provider) => {
      const value = state[provider] && typeof state[provider] === 'object' ? state[provider] : {};
      return {
        id: provider,
        model_configured: typeof value.model === 'string' && value.model.trim().length > 0,
        effort_configured: typeof value.effort === 'string' && value.effort.trim().length > 0,
      };
    }),
  };
}

function summarizeMcpRegistry(list) {
  const servers = Array.isArray(list && list.servers) ? list.servers : [];
  const byHealth = { ok: 0, warning: 0, unknown: 0 };
  let approved = 0;
  let approvedTools = 0;
  for (const server of servers) {
    if (server && server.approved === true) {
      approved += 1;
      approvedTools += Number.isSafeInteger(server.toolCount) ? server.toolCount : 0;
    }
    const health = server && ['ok', 'warning'].includes(server.health) ? server.health : 'unknown';
    byHealth[health] += 1;
  }
  return {
    count: servers.length,
    approved_count: approved,
    approved_tool_count: approvedTools,
    health_counts: byHealth,
    revision: Number.isSafeInteger(list && list.revision) ? list.revision : null,
  };
}

module.exports = {
  EFFECTIVE_VISIBILITY_JS,
  buildPanelStateScript,
  sanitizeBootSnapshot,
  summarizeAccounts,
  summarizeMcpRegistry,
  summarizeModelPrefs,
  timeoutCode,
  validateAuditEnvironment,
  withRestoration,
};
