'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'probe-paper-mini-template.js'), 'utf8');

test('mini template probe isolates profile and disables production autostart before main.js loads', () => {
  const profile = source.indexOf("app.setPath('userData', PROFILE)");
  const fixture = source.indexOf("process.env.ATHENA_CANVAS_SOURCE = 'fixture'");
  const noAutostart = source.indexOf("process.env.ATHENA_NO_AUTOSTART = '1'");
  const historyDb = source.indexOf("process.env.ATHENA_CHAT_HISTORY_DB_PATH = path.join(PROFILE, 'athena-chat-outbox.sqlite3')");
  const mainLoad = source.indexOf("require('./main.js')");

  assert.ok(profile >= 0 && fixture > profile && noAutostart > fixture);
  assert.ok(historyDb > noAutostart && mainLoad > historyDb,
    'main.js must observe the isolated fixture and durable chat history paths');
});

test('mini template probe blocks HTTP and WebSocket before windows load', () => {
  const blocker = source.indexOf('session.defaultSession.webRequest.onBeforeRequest');
  const mainLoad = source.indexOf("require('./main.js')");
  const createWindows = source.indexOf('await mainModule.createWindows()');

  assert.ok(blocker >= 0 && blocker < mainLoad && mainLoad < createWindows);
  assert.match(source, /cancel:\s*\/\^\(\?:https\?\|wss\?\):\/i\.test\(details\.url\)/);
});

test('mini template probe starts fixture readiness before waiting for boot handoff', () => {
  const createWindows = source.indexOf('await mainModule.createWindows()');
  const startReadiness = source.indexOf('mainModule.startBootReadinessForVerify()');
  const waitForHandoff = source.indexOf('mainModule.getWins().bootWin === null');

  assert.ok(createWindows >= 0 && startReadiness > createWindows);
  assert.ok(waitForHandoff > startReadiness);
});

test('mini template probe proves the orb accepted the query before waiting for cards', () => {
  const dispatch = source.indexOf("input.dispatchEvent(new KeyboardEvent('keydown'");
  const accepted = source.indexOf('const queryAccepted = await waitFor');
  const rejected = source.indexOf("throw new Error(`오브가 견본 질의를 수락하지 않았다:");
  const renderDeadline = source.indexOf('const deadline = Date.now() + 45000');

  assert.ok(dispatch >= 0 && accepted > dispatch && rejected > accepted);
  assert.ok(renderDeadline > rejected, 'card wait must start only after the query is accepted');
});
