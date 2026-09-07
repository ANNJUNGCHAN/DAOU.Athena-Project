// Production orb HTML/preload/renderer with deterministic IPC replies; no provider or broker calls.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { captureRoot } = require('./lib/probe-captures');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'athena-orb-conversation-')));
// Capture settled layout deterministically in a hidden window.
app.commandLine.appendSwitch('force-prefers-reduced-motion');
const out = path.join(captureRoot(__dirname), 'orb-conversation');
const submitted = [];
let win;
let holdReply;
let pendingReply;
let openedShell = false;
let holdWindowState = false;
let deferredWindowState;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (code) => win.webContents.executeJavaScript(code);
const send = async (channel, payload) => {
  win.webContents.send(channel, payload);
  await wait(80);
};
async function until(code) {
  for (let i = 0; i < 60; i += 1) {
    if (await run(code)) return;
    await wait(50);
  }
  throw new Error(`Timed out: ${code}`);
}
async function state() {
  return run(`(() => {
    const visible = (id) => {
      const el = document.getElementById(id);
      return !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
    };
    const input = document.getElementById('orbInput');
    const rect = input.getBoundingClientRect();
    const panel = document.getElementById('orbPanel').getBoundingClientRect();
    return {
      mode: document.getElementById('orbRoot').dataset.orbMode,
      card: visible('orbCard'), input: visible('orbInput'), disabled: input.disabled,
      inputFits: rect.top >= panel.top && rect.bottom <= panel.bottom,
      body: document.getElementById('orbBody').textContent,
      questions: [...document.querySelectorAll('.orb-turn-q')].map(el => el.textContent),
      answers: [...document.querySelectorAll('.orb-turn-a')].map(el => el.textContent),
      visibleCards: [...document.querySelectorAll('.orb-card,.orb-kiumi-card,.orb-mini-card')]
        .filter(el => el.getClientRects().length > 0).length,
    };
  })()`);
}
async function enter(text, composing = false) {
  await run(`(() => {
    const input = document.getElementById('orbInput');
    input.focus();
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: ${composing}, bubbles: true, cancelable: true }));
  })()`);
}
async function capture(name) {
  await wait(400);
  fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  ipcMain.handle('athena:model-get', () => ({ provider: 'claude' }));
  ipcMain.handle('athena:routines-list', () => ({ routines: [] }));
  ipcMain.handle('athena:orb-canvas-probe', () => false);
  ipcMain.handle('athena:orb-chat-submit', async (_event, payload) => {
    submitted.push(payload.query);
    if (holdReply) await new Promise(resolve => { pendingReply = resolve; });
    return { ok: true, answerText: `검증용 응답 ${submitted.length}: ${payload.query}`, canvasTypes: [], canvasResultCount: 0 };
  });
  ipcMain.on('athena:orb-open-shell', () => { openedShell = true; });
  ipcMain.on('athena:orb-toggle', (_event, payload) => {
    win.setSize(360, payload.expanded ? (payload.height || 400) : 76);
    const state = { expanded: payload.expanded, anchor: 'bottom-right' };
    if (holdWindowState) deferredWindowState = state;
    else win.webContents.send('athena:orb-state', state);
  });
  win = new BrowserWindow({ width: 360, height: 400, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  const errors = [];
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  await win.loadFile(path.join(__dirname, 'orb.html'));
  assert.equal(await run("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
  await send('athena:shell-visibility', { hidden: false, displayMode: 'B' });
  await send('athena:app-notification', { title: '일부 시작 작업을 완료하지 못했어요', body: '앱은 계속 사용할 수 있습니다.' });
  await run("document.getElementById('orbToggle').click()");
  await wait(300);
  const notice = await state();
  assert.equal(notice.card, false, 'text notification must not display an empty card');
  assert.equal(notice.input, true, 'notification must offer a composer');
  assert.equal(notice.inputFits, true, 'composer must fit in the panel');
  assert.match(notice.body, /계속 사용할/);
  await capture('01-text-notice');

  await enter('안녕', true);
  assert.equal(submitted.length, 0, 'IME confirmation must not submit');
  await send('athena:live-query-state', { busy: true });
  assert.equal((await state()).disabled, true);
  await enter('잠긴 입력');
  assert.equal(submitted.length, 0, 'another active query must not be interrupted');
  await send('athena:live-query-state', { busy: false });

  holdReply = true;
  await enter('안녕');
  await until("document.querySelectorAll('.orb-turn-q').length === 1");
  assert.equal((await state()).mode, 'chat');
  await send('athena:app-notification', { title: '나중 알림', body: '대화를 덮지 않아야 합니다.' });
  assert.equal((await state()).mode, 'chat');
  assert.ok(pendingReply, 'submission must reach the real preload IPC bridge');
  pendingReply();
  holdReply = false;
  await until("document.querySelectorAll('.orb-turn-a').length === 1 && !document.getElementById('orbInput').disabled");
  await enter('이어서 이야기해줘');
  await until("document.querySelectorAll('.orb-turn-a').length === 2 && !document.getElementById('orbInput').disabled");
  const conversation = await state();
  assert.deepEqual(submitted, ['안녕', '이어서 이야기해줘']);
  assert.equal(conversation.questions.length, 2);
  assert.equal(conversation.answers.length, 2);
  assert.equal(conversation.visibleCards, 0, 'plain replies must remain text only');
  assert.equal(conversation.inputFits, true);
  await capture('02-follow-up');

  await run("document.getElementById('orbClose').click()");
  await wait(80);
  await run("document.getElementById('orbToggle').click()");
  await wait(180);
  assert.match((await state()).body, /대화를 덮지/);
  await send('athena:routine-event', { type: 'routine-fired', symbol: '검증종목', observed: 12, threshold: 10, routine_id: 'fixture', source: '검증 데이터' });
  assert.equal((await state()).card, true, 'a populated routine card remains visible');
  await send('athena:app-notification', { title: '텍스트 알림', body: '기존 카드가 없어져야 합니다.' });
  assert.equal((await state()).card, false, 'text after a card must clear and hide it');
  holdReply = true;
  pendingReply = null;
  await enter('접어도 답변을 보여줘');
  await until("document.querySelectorAll('.orb-turn-q').length === 3");
  await run("document.getElementById('orbClose').click()");
  await wait(80);
  await run("document.getElementById('orbToggle').click()");
  await wait(80);
  assert.equal((await state()).mode, 'chat', 'reopening during a reply must preserve the conversation');
  await run("document.getElementById('orbClose').click()");
  await wait(80);
  await send('athena:app-notification', { title: '대기 알림', body: '읽지 않은 답변보다 먼저 표시하지 않습니다.' });
  assert.ok(pendingReply);
  pendingReply();
  holdReply = false;
  await until("document.querySelectorAll('.orb-turn-a').length === 3 && !document.getElementById('orbInput').disabled");
  await run("document.getElementById('orbToggle').click()");
  await wait(100);
  assert.equal((await state()).mode, 'chat', 'a folded reply must be readable before queued alerts');
  await run("document.getElementById('orbClose').click()");
  await wait(80);
  await run("document.getElementById('orbToggle').click()");
  await wait(100);
  assert.match((await state()).body, /읽지 않은 답변보다/);
  holdReply = true;
  pendingReply = null;
  await enter('창이 열리기 직전에 도착하는 답변');
  await until("document.querySelectorAll('.orb-turn-q').length === 4");
  await run("document.getElementById('orbClose').click()");
  await wait(80);
  await send('athena:app-notification', { title: '경합 알림', body: '창 확인 전에 도착한 답변을 가리지 않습니다.' });
  holdWindowState = true;
  await run("document.getElementById('orbToggle').click()");
  await wait(80);
  assert.ok(deferredWindowState && deferredWindowState.expanded);
  assert.ok(pendingReply);
  pendingReply();
  holdReply = false;
  await until("document.querySelectorAll('.orb-turn-a').length === 4 && !document.getElementById('orbInput').disabled");
  holdWindowState = false;
  await send('athena:orb-state', deferredWindowState);
  assert.equal((await state()).mode, 'chat', 'reply before native open confirmation must stay unread and take priority');
  await send('athena:shell-visibility', { hidden: true, displayMode: 'A' });
  assert.equal((await state()).answers.length, 4, 'existing conversation survives mode changes');
  await run("document.getElementById('orbChatGo').click()");
  await wait(80);
  assert.equal(openedShell, true);
  assert.deepEqual(errors, [], 'renderer must not log errors');
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ok: true, provider: 'deterministic IPC fixture', notice, conversation, submitted }, null, 2));
  console.log('PASS: text-only notification, composer, IME, busy lock, follow-up, folded reply, queued notification, populated card, shell handoff');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
