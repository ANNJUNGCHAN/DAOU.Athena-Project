'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { MODES, SETTINGS_NAV } = require('../../app/lib/live-full-catalog.js');
const {
  EFFECTIVE_VISIBILITY_JS,
  buildPanelStateScript,
  sanitizeBootSnapshot,
  summarizeAccounts,
  summarizeMcpRegistry,
  summarizeModelPrefs,
  timeoutCode,
  validateAuditEnvironment,
  withRestoration,
} = require('./live-ui-helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const KST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'market-session-audit', KST_DATE);
const startedAt = new Date().toISOString();
const artifactPath = path.join(ARTIFACT_DIR, `live-ui-${startedAt.replace(/[:.]/g, '-')}-${process.pid}.json`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SETTINGS_READS = Object.freeze({
  screen: ['athena:settings:prefs:get'],
  accounts: ['athena:account-list'],
  model: ['athena:model-get', 'athena:cli-list'],
  history: ['athena:brain-profile-summary', 'athena:brain-conversations-count'],
});

let report = {
  schema_version: 2,
  audit_id: 'ATHENA-LIVE-UI-METADATA-V2',
  started_at: startedAt,
  finished_at: null,
  pid: process.pid,
  user_data_source: 'ATHENA_AUDIT_USERDATA',
  live_boot: true,
  runner_explicit_actions: {
    mode_nav_clicks: 0,
    settings_open_calls: 0,
    settings_nav_clicks: 0,
    settings_escape_events: 0,
    oauth_mutations: 0,
    preference_writes: 0,
    order_calls: 0,
    graph_mutations: 0,
    screenshots: 0,
  },
  normal_boot_effects: {
    control: 'OUTSIDE_RUNNER_CONTROL',
    mutation_status: 'UNKNOWN_NOT_INSTRUMENTED',
    source: 'app/main.js:startLiveBoot',
    known_categories: ['mcp_environment_migration', 'history_flush', 'graph_projection', 'scheduled_refresh_observers'],
    observation: 'BOOT_TASK_STATES_ONLY',
  },
  source_proof: {
    modes: 'app/lib/live-full-catalog.js:MODES',
    mode_click_side_effect: 'app/lib/sidebar.js:onSelect->startNewConversation->athena:conversations-new',
    settings_navigation: 'app/lib/live-full-catalog.js:SETTINGS_NAV',
    readiness: 'app/main.js:bootReadinessHandlers.get',
    accounts: 'app/main.js:settingsHandlers.accountList/authTokenStatus',
    model_preferences: 'app/main.js:settingsHandlers.modelGet',
    mcp_registry: 'app/lib/main/mcp-cli.js:list (pure read; wrapper migration bypassed)',
  },
  windows: null,
  handoff: null,
  readiness: null,
  readonly_inspection: null,
  current_mode_surface: null,
  modes: [],
  settings: [],
  restoration: { attempted: false, mode_unchanged: null, settings_restored: null, selected_setting_restored: null },
  result: {
    mode_control_inventory_ok: false,
    current_mode_surface_ok: false,
    mode_navigation_status: 'BLOCKED_NAV_CREATES_HISTORY',
    settings_navigation_ok: false,
    boot_readiness_status: 'NOT_RUN',
    ui_navigation_ok: false,
    overall_status: 'NOT_RUN',
  },
  coverage: {
    exact_mode_ids: MODES.map((item) => item.view),
    exact_settings_ids: SETTINGS_NAV.map((item) => item.key),
    live_routes_90: 'BLOCKED_NOT_IN_THIS_RUNNER',
    live_cards_96: 'BLOCKED_NOT_IN_THIS_RUNNER',
    live_mini_10: 'BLOCKED_NOT_IN_THIS_RUNNER',
  },
  error_code: null,
  failure: null,
};
let auditStage = 'initialization';

function persist() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const temp = `${artifactPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, artifactPath);
}

async function bounded(label, promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutCode(label))), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntil(label, check, timeoutMs, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await bounded(label, check(), Math.min(5000, Math.max(1, deadline - Date.now())));
    if (value) return value;
    await wait(intervalMs);
  }
  throw new Error(timeoutCode(label));
}

function errorCode(error) {
  const message = String(error && error.message || 'AUDIT_FAILED');
  return /^[A-Z][A-Z0-9_]+$/.test(message) ? message : 'AUDIT_FAILED';
}

function surfaceScript() {
  const canvasEntries = MODES.map((mode) => `${JSON.stringify(mode.view)}: effective(${JSON.stringify(mode.canvasId)})`).join(',');
  return `(() => {
    ${EFFECTIVE_VISIBILITY_JS}
    const activeMode = document.querySelector('.sidebar-mode-item.is-active');
    const selectedSetting = document.querySelector('#settingsNav .settings-nav-item[aria-selected="true"]');
    return {
      app_visible: effective('app'), onboarding_visible: effective('onboard'), settings_visible: effective('settings'),
      active_mode: activeMode && activeMode.dataset.view || null,
      selected_setting: selectedSetting && selectedSetting.dataset.key || null,
      primary_canvases: { ${canvasEntries} },
    };
  })()`;
}

async function readSurface(shellWin) {
  return bounded('surface probe', shellWin.webContents.executeJavaScript(surfaceScript()), 5000);
}

async function inspectModeControls(shellWin) {
  return bounded('mode controls', shellWin.webContents.executeJavaScript(`(() => {
    ${EFFECTIVE_VISIBILITY_JS}
    const ids = ${JSON.stringify(MODES.map((mode) => mode.navId))};
    return ids.map((id) => {
      const node = document.getElementById(id);
      if (!node || !node.isConnected) return { id, exists: false, enabled: false, effective: false };
      return { id, exists: true, enabled: node.disabled !== true, effective: effective(node) };
    });
  })()`), 5000);
}

async function clickSetting(shellWin, key) {
  return bounded('settings click', shellWin.webContents.executeJavaScript(`(() => {
    const node = document.querySelector(${JSON.stringify(`.settings-nav-item[data-key="${key}"]`)});
    if (!node || !node.isConnected || node.disabled) return false;
    node.click();
    return true;
  })()`), 5000);
}

async function openSettings(shellWin) {
  return bounded('settings open', shellWin.webContents.executeJavaScript(`(() => {
    if (!window.AthenaShell || typeof window.AthenaShell.openSettings !== 'function') return false;
    window.AthenaShell.openSettings();
    return true;
  })()`), 5000);
}

async function closeSettings(shellWin) {
  report.runner_explicit_actions.settings_escape_events += 1;
  await bounded('settings close', shellWin.webContents.executeJavaScript(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
  })()`), 5000);
}

async function panelState(shellWin, key) {
  return bounded('settings panel', shellWin.webContents.executeJavaScript(buildPanelStateScript(key)), 5000);
}

async function collectReadonly(mainMod, shellWin, mcpCli) {
  const readinessRaw = await bounded('readiness get', mainMod.bootReadinessHandlers.get({ sender: shellWin.webContents }), 5000);
  const accountList = await bounded('account list', mainMod.settingsHandlers.accountList(), 5000);
  const accountRows = Array.isArray(accountList && accountList.accounts) ? accountList.accounts : [];
  const tokenStates = new Map();
  for (const account of accountRows) {
    if (!account || typeof account.id !== 'string') continue;
    const status = await bounded('auth token status', mainMod.settingsHandlers.authTokenStatus(null, { id: account.id }), 5000);
    tokenStates.set(account.id, status && status.state);
  }
  const models = await bounded('model preferences', mainMod.settingsHandlers.modelGet(), 5000);
  const mcp = await bounded('mcp registry', mcpCli.list(), 5000);
  return {
    readiness: sanitizeBootSnapshot(readinessRaw),
    inspection: {
      accounts: summarizeAccounts(accountList, tokenStates),
      model_preferences: summarizeModelPrefs(models),
      mcp_registry: summarizeMcpRegistry(mcp),
    },
  };
}

async function restoreSettings(shellWin, original) {
  report.restoration.attempted = true;
  if (original.settings_visible) {
    const key = SETTINGS_NAV.some((item) => item.key === original.selected_setting) ? original.selected_setting : 'screen';
    report.runner_explicit_actions.settings_nav_clicks += 1;
    await clickSetting(shellWin, key);
    await waitUntil('settings restore', async () => (await readSurface(shellWin)).selected_setting === key, 5000);
  } else {
    await closeSettings(shellWin);
    await waitUntil('settings close restore', async () => !(await readSurface(shellWin)).settings_visible, 5000);
  }
  const surface = await readSurface(shellWin);
  report.restoration.mode_unchanged = surface.active_mode === original.active_mode;
  report.restoration.settings_restored = surface.settings_visible === original.settings_visible;
  report.restoration.selected_setting_restored = !original.settings_visible
    || surface.selected_setting === (original.selected_setting || 'screen');
}

async function auditSettings(shellWin, original) {
  return withRestoration(async () => {
    if (!original.settings_visible) {
      report.runner_explicit_actions.settings_open_calls += 1;
      if (!(await openSettings(shellWin))) throw new Error('SETTINGS_OPEN_CONTROL_MISSING');
      await waitUntil('settings open', async () => (await readSurface(shellWin)).settings_visible, 5000);
    }
    for (const item of SETTINGS_NAV) {
      report.runner_explicit_actions.settings_nav_clicks += 1;
      const clicked = await clickSetting(shellWin, item.key);
      await waitUntil(`settings ${item.key}`, async () => (await readSurface(shellWin)).selected_setting === item.key, 5000);
      let panel = null;
      try {
        panel = await waitUntil(`settings data ${item.key}`, async () => {
          const state = await panelState(shellWin, item.key);
          return state.settled ? state : null;
        }, 10000);
      } catch {
        panel = await panelState(shellWin, item.key);
      }
      report.settings.push({
        id: item.key,
        clicked,
        selected: true,
        expected_reads: SETTINGS_READS[item.key],
        read_status: 'BACKEND_READ_NOT_VERIFIED',
        panel_rendered: panel.rendered,
        panel_effective: panel.effective,
        panel_structure_settled: panel.settled,
        aggregate_rows: panel.aggregate_rows,
      });
    }
  }, async () => restoreSettings(shellWin, original));
}

async function run() {
  auditStage = 'environment_validation';
  const userData = validateAuditEnvironment(process.env, fs);
  app.setPath('userData', userData);
  const mcpCli = require('../../app/lib/main/mcp-cli.js');
  const mainMod = require('../../app/main.js');
  auditStage = 'shell_handoff';
  const wins = await waitUntil('shell window', () => {
    const current = mainMod.getWins();
    return current.shellWin && !current.shellWin.isDestroyed() ? current : null;
  }, 120000);
  const shellWin = wins.shellWin;
  const ready = await waitUntil('shell handoff', async () => {
    const current = mainMod.getWins();
    if (current.bootWin && !current.bootWin.isDestroyed()) return null;
    const surface = await readSurface(shellWin);
    return (surface.app_visible || surface.settings_visible) && !surface.onboarding_visible ? surface : null;
  }, 120000);
  report.handoff = { ready_at: new Date().toISOString(), state: 'OBSERVED' };
  report.windows = {
    shell: true,
    orb: Boolean(mainMod.getWins().orbWin && !mainMod.getWins().orbWin.isDestroyed()),
    count: BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length,
  };

  auditStage = 'readonly_inspection';
  const readonly = await collectReadonly(mainMod, shellWin, mcpCli);
  report.readiness = readonly.readiness;
  report.readonly_inspection = readonly.inspection;
  const readinessHasFailure = report.readiness.tasks.some((task) => task.state === 'failed');
  report.result.boot_readiness_status = report.readiness.phase === 'ready' && !readinessHasFailure ? 'PASS' : 'FAIL';

  const original = { active_mode: ready.active_mode, settings_visible: ready.settings_visible, selected_setting: ready.selected_setting };
  auditStage = 'mode_inventory';
  const controls = await inspectModeControls(shellWin);
  report.modes = MODES.map((mode) => {
    const control = controls.find((candidate) => candidate.id === mode.navId) || {};
    return {
      id: mode.view,
      control_id: mode.navId,
      canvas_id: mode.canvasId,
      control_exists: control.exists === true,
      control_enabled: control.enabled === true,
      control_effective: control.effective === true,
      navigation_status: 'BLOCKED_NAV_CREATES_HISTORY',
      known_effect: 'athena:conversations-new',
    };
  });
  report.result.mode_control_inventory_ok = report.modes.every((mode) => mode.control_exists && mode.control_enabled && mode.control_effective);

  const activeDefinition = MODES.find((mode) => mode.view === ready.active_mode);
  const visiblePrimary = Object.entries(ready.primary_canvases).filter(([, visible]) => visible).map(([id]) => id);
  report.current_mode_surface = {
    id: ready.active_mode,
    expected_canvas_id: activeDefinition ? activeDefinition.canvasId : null,
    expected_canvas_effective: Boolean(activeDefinition && ready.primary_canvases[activeDefinition.view]),
    visible_primary_mode_ids: visiblePrimary,
    nonexpected_primary_hidden: Boolean(activeDefinition && visiblePrimary.length === 1 && visiblePrimary[0] === activeDefinition.view),
  };
  report.result.current_mode_surface_ok = report.current_mode_surface.expected_canvas_effective
    && report.current_mode_surface.nonexpected_primary_hidden;

  auditStage = 'settings_navigation';
  await auditSettings(shellWin, original);
  report.result.settings_navigation_ok = report.settings.length === SETTINGS_NAV.length
    && report.settings.every((item) => item.clicked && item.selected && item.panel_rendered
      && item.panel_effective && item.panel_structure_settled);
  report.result.ui_navigation_ok = false;
  const observedChecksOk = report.result.boot_readiness_status === 'PASS'
    && report.result.mode_control_inventory_ok
    && report.result.current_mode_surface_ok
    && report.result.settings_navigation_ok
    && Object.values(report.restoration).every((value) => value === true);
  report.result.overall_status = observedChecksOk ? 'BLOCKED' : 'FAIL';
  auditStage = 'artifact_persist';
  report.finished_at = new Date().toISOString();
  persist();
  process.stdout.write(`${JSON.stringify({ artifact: artifactPath, pid: process.pid, ready_at: report.handoff.ready_at, status: report.result.overall_status })}\n`);
}

run().catch((error) => {
  report.finished_at = new Date().toISOString();
  report.error_code = errorCode(error);
  const rawClass = error && error.constructor && error.constructor.name;
  report.failure = {
    stage: auditStage,
    error_class: typeof rawClass === 'string' && /^[A-Za-z]+Error$/.test(rawClass) ? rawClass : 'Error',
  };
  report.result.overall_status = 'FAIL';
  try { persist(); } catch { /* no secondary output with paths or secrets */ }
  process.stderr.write(`${JSON.stringify({ artifact: artifactPath, pid: process.pid, error_code: report.error_code })}\n`);
  // Normal boot windows remain alive so the continuous observer can continue.
});
