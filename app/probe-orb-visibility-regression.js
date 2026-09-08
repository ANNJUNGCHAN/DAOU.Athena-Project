// Production orb geometry and A/B composer ownership, exercised through Electron IPC.
// The fixture is local and deterministic: it performs no provider, network, or order calls.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { captureRoot } = require('./lib/probe-captures');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-orb-visibility-'));
const out = path.join(captureRoot(__dirname), 'orb-visibility-regression');
app.setPath('userData', userData);
app.commandLine.appendSwitch('force-prefers-reduced-motion');

let win;
const resizeRequests = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (code) => win.webContents.executeJavaScript(code);

async function send(channel, payload) {
  win.webContents.send(channel, payload);
  await wait(80);
}

async function layout() {
  return run(`(() => {
    const visible = (el) => !!el && el.getClientRects().length > 0
      && getComputedStyle(el).display !== 'none';
    const root = document.getElementById('orbRoot');
    const panel = document.getElementById('orbPanel');
    const body = document.getElementById('orbBody');
    const card = document.getElementById('orbCard');
    const input = document.getElementById('orbInput');
    const panelRect = panel.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    return {
      mode: root.dataset.orbMode,
      panelVisible: visible(panel),
      cardVisible: visible(card),
      cardRows: card.children.length,
      cardScrollHeight: card.scrollHeight,
      cardClientHeight: card.clientHeight,
      cardFullyVisible: card.scrollHeight <= card.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      inputVisible: visible(input),
      inputFits: inputRect.top >= panelRect.top && inputRect.bottom <= panelRect.bottom,
      windowHeight: window.innerHeight,
    };
  })()`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  ipcMain.handle('athena:model-get', () => ({ active: { provider: 'claude' } }));
  ipcMain.handle('athena:routines-list', () => ({ ok: true, data: { routines: [] } }));
  ipcMain.handle('athena:orb-canvas-probe', () => false);
  ipcMain.on('athena:orb-toggle', (_event, payload) => {
    const height = payload.expanded ? (payload.height || 400) : 76;
    resizeRequests.push({ expanded: !!payload.expanded, height });
    win.setSize(payload.expanded ? 360 : 76, height);
    win.webContents.send('athena:orb-state', {
      expanded: !!payload.expanded,
      anchor: 'bottom-right',
    });
  });

  win = new BrowserWindow({
    width: 360,
    height: 400,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  await win.loadFile(path.join(__dirname, 'orb.html'));

  // B means the shell is visible and the orb is an alert surface. Its composer is a
  // deliberate quick-reply owner; hiding it would break the established conversation contract.
  await send('athena:shell-visibility', { hidden: false, displayMode: 'B' });
  await send('athena:routine-event', {
    type: 'routine-fired',
    fired_at: new Date().toISOString(),
    symbol: '005930',
    observed: 5.3,
    threshold: 5,
    source: '검증 데이터',
    routine_id: 'orb-visibility-fixture',
  });
  await run("document.getElementById('orbToggle').click()");
  await wait(350);
  const modeB = await layout();
  console.log(`[mode-b] ${JSON.stringify({ modeB, resizeRequests })}`);
  assert.equal(modeB.mode, 'alert');
  assert.equal(modeB.cardRows, 5);
  assert.equal(modeB.cardFullyVisible, true, 'representative card must not require internal scrolling');
  assert.equal(modeB.inputVisible, true, 'B alert mode owns a quick-reply composer');
  assert.equal(modeB.inputFits, true, 'B composer must remain inside the expanded panel');
  assert.ok(resizeRequests.some((request) => request.height > 400), 'open confirmation must request measured content height');
  fs.writeFileSync(path.join(out, 'mode-b-card-and-composer.png'), (await win.webContents.capturePage()).toPNG());

  const beforeContentSwapRequests = resizeRequests.length;
  await send('athena:app-notification', {
    title: '긴 알림',
    body: '높이 측정용 문장입니다. '.repeat(80),
  });
  await wait(150);
  const tall = await layout();
  assert.ok(tall.windowHeight > modeB.windowHeight, 'long content must grow the panel');
  assert.equal(tall.inputFits, true, 'max-height content must preserve the composer inside the panel');
  assert.ok(tall.bodyScrollHeight > tall.bodyClientHeight,
    'content beyond the height cap must scroll inside the notification body');
  await send('athena:app-notification', { title: '짧은 알림', body: '완료했습니다.' });
  await wait(150);
  const short = await layout();
  assert.equal(short.windowHeight, 400, 'short content must shrink back to the base height');
  assert.ok(resizeRequests.length - beforeContentSwapRequests <= 2,
    'each content replacement must issue at most one resize request');

  // A means the shell is hidden and the orb owns the full conversation surface.
  await send('athena:shell-visibility', { hidden: true, displayMode: 'A' });
  const modeA = await layout();
  assert.equal(modeA.mode, 'chat');
  assert.equal(modeA.cardVisible, false);
  assert.equal(modeA.inputVisible, true, 'A chat mode owns the conversation composer');
  assert.equal(modeA.inputFits, true, 'A composer must remain inside the expanded panel');
  fs.writeFileSync(path.join(out, 'mode-a-chat-composer.png'), (await win.webContents.capturePage()).toPNG());

  assert.deepEqual(errors, [], 'renderer must not log errors');
  const report = { ok: true, modeB, tall, short, modeA, resizeRequests, screenshots: [
    path.join(out, 'mode-b-card-and-composer.png'),
    path.join(out, 'mode-a-chat-composer.png'),
  ] };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: ${JSON.stringify(report)}`);
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
