'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { buildBackendEnv } = require('./backend-launcher');

const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
const canvasSource = fs.readFileSync(path.join(__dirname, '..', '..', 'canvas.js'), 'utf8');
const historySinkSource = fs.readFileSync(path.join(__dirname, 'history-sink.js'), 'utf8');
const brainOntologySource = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'backend', 'athena_api', 'brain', 'ontology.py'),
  'utf8',
);
const liveHarnessSource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'probe-conversation-graph-e2e.js'),
  'utf8',
);

test('main configures the durable chat outbox under the active Electron profile', () => {
  assert.ok(
    /historySink\.configureChatHistoryStore\s*\(\s*\{\s*dbPath\s*:\s*path\.join\(\s*app\.getPath\(\s*['"]userData['"]\s*\)\s*,\s*['"]athena-chat-outbox\.sqlite3['"]\s*\)\s*,?\s*\}\s*\)/.test(mainSource),
    'main must configure the chat outbox with a userData-scoped sqlite3 path',
  );
});

test('boot readiness exposes separate pending-history and graph-projection gates', () => {
  const bootTasks = mainSource.match(/const BOOT_TASKS\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(bootTasks, 'BOOT_TASKS must remain statically inspectable');
  assert.ok(/id:\s*['"]chat-history-flush['"]/.test(bootTasks[1]), 'missing chat-history-flush gate');
  assert.ok(/id:\s*['"]graph-projection['"]/.test(bootTasks[1]), 'missing graph-projection gate');
  assert.ok(
    /startupReadiness\.setRunner\(\s*['"]chat-history-flush['"]/.test(mainSource),
    'missing chat-history-flush runner',
  );
  assert.ok(
    /startupReadiness\.setRunner\(\s*['"]graph-projection['"]/.test(mainSource),
    'missing graph-projection runner',
  );
  assert.match(
    mainSource,
    /async function waitForBrainStartup\([\s\S]*?Date\.now\(\) \+ BRAIN_GRAPH_REFRESH_TIMEOUT_MS/,
    'brain startup must use the same watchdog as the real Claude graph pipeline',
  );
});

test('main schedules conversation graph refresh at exactly one-hour intervals', () => {
  assert.ok(
    /(?:GRAPH|BRAIN)[A-Z0-9_]*INTERVAL[A-Z0-9_]*\s*=\s*(?:60\s*\*\s*60\s*\*\s*1000|3_600_000)/.test(mainSource),
    'missing exact one-hour graph refresh interval',
  );
  assert.ok(
    /setInterval\s*\(\s*(?:\(\)\s*=>\s*)?(?:void\s+)?[A-Za-z_$][\w$]*graph[\w$]*\s*\(/i.test(mainSource),
    'main must schedule the graph refresh function with setInterval',
  );
  const liveBoot = mainSource.match(
    /async function startLiveBoot\([\s\S]*?\r?\n\}\r?\n\r?\nlet fixtureBootStarted/,
  );
  assert.ok(liveBoot, 'startLiveBoot must remain statically inspectable');
  assert.match(
    liveBoot[0],
    /await runStartupOrchestration\([\s\S]*?startHourlyConversationGraphRefresh\(\)[\s\S]*?startConversationGraphObserver\(\)/,
    'hourly recovery and the read-only observer must survive a failed or unknown boot owner',
  );
  assert.match(
    mainSource,
    /BRAIN_GRAPH_OBSERVER_INTERVAL_MS\s*=\s*60\s*\*\s*1000/,
    'backend-owned graph revisions must be observed within one minute',
  );
  assert.match(
    mainSource,
    /conversationGraphObserverTimer\s*=\s*setInterval\([\s\S]*?observeConversationGraph\(\)/,
    'the read-only observer must run regardless of schedule ownership',
  );
  assert.doesNotMatch(
    mainSource,
    /conversationGraphScheduleOwner === ['"]external['"]\) return/,
    'external schedule ownership must not disable read-only graph observation',
  );
});

test('Electron-spawned backend opts into the installed Claude graph extractor', () => {
  const env = buildBackendEnv({});
  assert.equal(env.ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION, 'true');
  assert.equal(env.ATHENA_BRAIN_INGEST_SCHEDULE_OWNER, 'external');
});

test('Electron outbox and FastAPI raw-chat schema share the same accepted message limit', () => {
  assert.match(historySinkSource, /MAX_CHAT_MESSAGE_CHARS\s*=\s*20_000/);
  assert.match(brainOntologySource, /MAX_RAW_CHAT_TEXT_CHARS:\s*Final\s*=\s*20_000/);
  assert.match(
    historySinkSource,
    /const textLength = typeof text === ['"]string['"] \? Array\.from\(text\)\.length : 0/,
    'Electron must count Unicode code points like Python len, not UTF-16 code units',
  );
  assert.doesNotMatch(
    historySinkSource,
    /text\.length\s*>\s*MAX_CHAT_MESSAGE_CHARS/,
    'UTF-16 code-unit validation would reject valid astral Unicode text',
  );
});

test('app lifecycle opens and closes the userData chat outbox', () => {
  assert.match(
    mainSource,
    /app\.whenReady\(\)\.then\([\s\S]*?configureConversationGraphPipeline\(\)[\s\S]*?createWindows\(\)/,
  );
  assert.match(
    mainSource,
    /app\.on\(\s*['"]will-quit['"][\s\S]*?stopHourlyConversationGraphRefresh\(\)[\s\S]*?stopConversationGraphObserver\(\)[\s\S]*?historySink\.closeChatHistoryStore\(\)/,
  );
});

test('disabling chat collection purges unsent raw messages', () => {
  const handler = mainSource.match(/function handlePrefsSet\([\s\S]*?\n\}/);
  assert.ok(handler, 'handlePrefsSet must remain statically inspectable');
  assert.match(handler[0], /previous\.collectChat\s*&&\s*requestedCollectChat\s*===\s*false/);
  assert.match(handler[0], /purgePendingChatForPreferenceChange\(['"]disable['"]\)/);
});

test('chat collection re-enable purges stale pending raw text before persisting ON', () => {
  const handler = mainSource.match(/function handlePrefsSet\([\s\S]*?\n\}/);
  assert.ok(handler, 'handlePrefsSet must remain statically inspectable');
  const source = handler[0];
  const reenableIndex = source.indexOf('previous.collectChat === false && requestedCollectChat === true');
  const purgeIndex = source.indexOf('purgePendingChatForPreferenceChange');
  const persistIndex = source.indexOf('prefs.set(patch || {})');
  assert.ok(reenableIndex >= 0, 'false -> true re-enable gate is missing');
  assert.ok(purgeIndex > reenableIndex && purgeIndex < persistIndex, 'stale raw text must be purged before prefs can become true');
  assert.match(source, /catch \(error\)[\s\S]*?collectChat:\s*false[\s\S]*?throw error/);
});

test('renderer keeps collectChat OFF and surfaces a human-readable error when main rejects', () => {
  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'settings-cards.js'), 'utf8');
  assert.match(settingsSource, /async function setCollectChatPreference/);
  assert.match(settingsSource, /writeGraphSettingsLocal\(\{ collectChat: false \}/);
  assert.match(settingsSource, /error instanceof Error[\s\S]*?throw error/);
  // 토글의 주인은 설정 4번째 카드가 아니라 그래프 모드 「수집·노출」 탭이다
  // (Paper 보드 22). 실패하면 그 자리에서 토글을 OFF로 되돌리고 사람이 읽을
  // 이유를 남긴다 — 조용히 켜진 척하면 사용자는 수집되고 있다고 믿는다.
  const collectionSource = fs.readFileSync(
    path.join(__dirname, '..', 'graph-mode', 'collection-settings.js'), 'utf8',
  );
  assert.match(collectionSource, /await deps\.setCollectChat\(next\)/);
  assert.match(
    collectionSource,
    /catch \(error\)[\s\S]*?button\.setAttribute\('aria-checked', 'false'\)[\s\S]*?showError\(card, \(error && error\.message\)/,
  );
  assert.match(collectionSource, /box\.textContent = message/);
});

test('completed graph refreshes are allowlisted and reload every graph surface', () => {
  assert.match(preloadSource, /['"]athena:brain-graph-updated['"]/);
  assert.match(
    mainSource,
    /shouldBroadcastConversationGraph\(lastBroadcastGraphKey, report\)[\s\S]*?labelFingerprint:\s*report\.graph\.labelFingerprint[\s\S]*?lastBroadcastGraphKey\s*=\s*createConversationGraphBroadcastKey\(report\)/,
    'main must dedupe successful broadcasts by graph revision plus opaque label fingerprint',
  );
  assert.doesNotMatch(mainSource, /lastBroadcastGraphRevision/);
  assert.match(
    canvasSource,
    /window\.athena\.on\(\s*['"]athena:brain-graph-updated['"][\s\S]*?refreshConversationGraphSurfaces\(\)/,
  );
  const refresh = canvasSource.match(/async function refreshConversationGraphSurfaces\(\)[\s\S]*?\n\}/);
  assert.ok(refresh, 'refreshConversationGraphSurfaces must remain statically inspectable');
  for (const required of [
    'graphMode.setAvailable(true)',
    'graphSummaryTable.load()',
    'loadThemeClusters()',
    'loadHiddenLinks()',
    'loadEmptyCanvasExtras()',
  ]) {
    assert.ok(refresh[0].includes(required), `missing graph refresh step: ${required}`);
  }
});

test('live graph proof uses the production main path and an isolated credential-free backend', () => {
  const productionRefreshIndex = liveHarnessSource.indexOf("mainMod.runConversationGraphRefreshForProbe('boot')");
  const emptyMapIndex = liveHarnessSource.indexOf('empty graph map before production refresh');
  const eventRefreshIndex = liveHarnessSource.indexOf('production graph event refreshes the already-open map');
  assert.ok(emptyMapIndex >= 0 && emptyMapIndex < productionRefreshIndex);
  assert.ok(eventRefreshIndex > productionRefreshIndex);
  assert.doesNotMatch(liveHarnessSource.slice(productionRefreshIndex), /getElementById\(['"](?:modeNavGraph|graphViewTab)['"]\)/);
  assert.doesNotMatch(liveHarnessSource, /createConversationGraphRefresher/);
  assert.doesNotMatch(liveHarnessSource, /webContents\.send\(\s*['"]athena:brain-graph-updated['"]/);
  assert.match(liveHarnessSource, /cwd:\s*tempRoot/);
  assert.match(liveHarnessSource, /PYTHONPATH:\s*BACKEND_DIR/);
  assert.doesNotMatch(liveHarnessSource, /env:\s*\{\s*\.\.\.process\.env/);
  assert.match(liveHarnessSource, /SENSITIVE_ENV_NAME\s*=\s*\/\(KIWOOM\|ACCOUNT\|TOKEN\|SECRET/);
  assert.match(liveHarnessSource, /const backendErrorPromise = new Promise/);
  assert.match(liveHarnessSource, /Promise\.race\(\[[\s\S]*?waitForBackendReady/);
  assert.match(liveHarnessSource, /win === wins\.shellWin[\s\S]*?removeAllListeners\(['"]closed['"]\)[\s\S]*?win\.destroy\(\)/);
  assert.doesNotMatch(liveHarnessSource, /\.join\(\s*['"];\s*['"]\s*\)/);
  assert.equal((liveHarnessSource.match(/\]\.join\(\s*['"] ['"]\s*\)\)\.map/g) || []).length, 2);
});

test('live graph proof PowerShell preflight executes its real process and listener snapshots', {
  skip: process.platform !== 'win32',
}, () => {
  const raw = execFileSync(process.execPath, [
    path.join(__dirname, '..', '..', 'probe-conversation-graph-e2e.js'),
    '--powershell-preflight',
  ], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  const result = JSON.parse(raw.trim());
  assert.equal(result.ok, true);
  assert.ok(result.processCount > 0);
  assert.equal(result.listenerCount, 0);
  assert.equal(result.descendantResolution, true);
});

test('every live query persists the user message before selecting any network or model path', () => {
  const wrapper = mainSource.match(
    /async function runLiveQuery\([\s\S]*?\r?\n\}\r?\n\r?\n\/\/ origin/,
  );
  assert.ok(wrapper, 'runLiveQuery wrapper must remain statically inspectable');
  const saveIndex = wrapper[0].indexOf('historySink.saveChatMessage(');
  const failureGateIndex = wrapper[0].indexOf('historyReceipt.failed');
  const innerIndex = wrapper[0].indexOf('runLiveQueryInner(');
  assert.ok(saveIndex >= 0 && saveIndex < innerIndex, 'user message must be durable before runLiveQueryInner');
  assert.ok(
    failureGateIndex > saveIndex && failureGateIndex < innerIndex,
    'a failed local SQLite write must stop before any network or model path',
  );
  assert.match(wrapper[0], /role:\s*['"]user['"]/);

  const inner = mainSource.match(
    /async function runLiveQueryInner\([\s\S]*?\r?\n\}\r?\n\r?\n\/\/ Esc 중단/,
  );
  assert.ok(inner, 'runLiveQueryInner must remain statically inspectable');
  assert.doesNotMatch(
    inner[0],
    /historySink\.saveChatMessage\([\s\S]{0,180}?role:\s*['"]user['"]/,
    'fast paths must not delay or duplicate the already-durable user message',
  );
  assert.doesNotMatch(
    inner[0],
    /return runLiveQuery\(query, expand, origin, turnConversationId\)/,
    'session recovery must not persist the same user turn a second time',
  );
});
