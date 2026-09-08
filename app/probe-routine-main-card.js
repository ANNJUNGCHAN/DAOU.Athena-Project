'use strict';

// Full shell fixture: exercise human card consent and popup navigation without a provider.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_BACKEND_URL = 'http://127.0.0.1:0';
const { app, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { captureRoot } = require('./lib/probe-captures');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-main-card-probe-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
fs.writeFileSync(path.join(profile, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const candidate = { operation_ref: 'detail:ka10001:current_trading', args: { stk_cd: '005930' }, title: '현재가' };
const routine = {
  id: 'fixture-main-card', symbol: '005930', note: '검증용 삼성전자 가격 알람',
  status: 'draft', mode: 'realtime-ws', condition: { source: 'price.current', op: '>=', value: 100 },
  cooldown_s: 300, expires_at: '2099-01-01T00:00:00Z', created_at: new Date().toISOString(),
  main_card_candidate: candidate, main_card: null, main_card_confirmed_at: null,
};
const envelope = label => ({
  canvas_type: 'facts', title: label, screen_id: 'alarm-main-card-fixture', fell_back: false,
  data: { fields: [{ label: '검증용 항목', value: label }] }, drop_types: [],
});

app.whenReady().then(async () => {
  const conversations = require('./lib/main/conversations');
  const originalBegin = conversations.begin;
  let conversationBegins = 0;
  conversations.begin = (...args) => { conversationBegins++; return originalBegin(...args); };
  const main = require('./main');
  const confirmations = [];
  const openings = [];
  let exposeDraft = false;
  const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); };
  replace('athena:routines-list', async () => ({ ok: true, data: { routines: exposeDraft ? [routine] : [], fired_today: 1 } }));
  replace('athena:routine-detail', async () => ({ ok: true, data: routine }));
  replace('athena:routine-runs', async () => ({ ok: true, data: { runs: [] } }));
  replace('athena:routine-ack', async () => ({ ok: true, data: {} }));
  replace('athena:routine-engagement', async () => ({ ok: true, data: {} }));
  replace('athena:routine-main-card-confirm', async (_event, payload) => {
    assert.deepEqual(payload, { id: routine.id, expected_candidate: candidate });
    confirmations.push(payload);
    routine.main_card = candidate;
    routine.main_card_confirmed_at = new Date().toISOString();
    return { ok: true, data: { ...routine } };
  });
  replace('athena:routine-main-card-open', async (_event, payload) => {
    assert.equal(payload.id, routine.id);
    assert.ok(routine.main_card_confirmed_at);
    openings.push(payload);
    require('./lib/main/conversations').touch({ id: payload.conversationId, title: candidate.title });
    return { ok: true, ...payload, card: { status: 'success', envelope: envelope('선택한 알람 메인 카드') } };
  });
  await main.createWindows();
  const { shellWin } = main.getWins();
  const run = async code => {
    try { return await shellWin.webContents.executeJavaScript(code); }
    catch (error) { console.error('Renderer probe step:', code.slice(0, 240)); throw error; }
  };
  const until = async (code, label) => {
    for (let i = 0; i < 100; i++) {
      if (await run(code).catch(() => false)) return;
      await wait(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await until('!!window.AthenaNotify && !!window.AthenaRoutineMainCardCanvas', 'shell ready');
  shellWin.showInactive();
  await run(`document.getElementById('sidebarNewChat').click()`);
  await wait(300);
  const original = await run(`window.athena.invoke('athena:conversations-list').then(r => r.activeId)`);
  assert.ok(original, 'A real isolated conversation must exist');
  require('./lib/main/conversations').touch({ id: original, title: '기존 대화' });
  exposeDraft = true;
  await run('refreshRoutineDrafts()');
  await until(`!!document.querySelector('.routine-main-card-confirm')`, 'candidate question');
  await wait(300);
  fs.writeFileSync(path.join(captureRoot(__dirname), 'routine-main-card-confirm.png'), (await shellWin.webContents.capturePage()).toPNG());
  assert.equal(confirmations.length, 0, 'Draft creation must not select the card');
  await run(`document.querySelector('.routine-main-card-confirm .routine-btn-approve').click()`);
  await until(`document.querySelector('.routine-main-card-confirm').textContent.includes('설정')`, 'consent rendered');
  await wait(150);
  assert.equal(confirmations.length, 1);
  assert.equal(routine.status, 'draft', 'Card consent must not activate the alarm');
  await run(`window.AthenaRoutineMainCardCanvas.renderOnly({status:'success',envelope:${JSON.stringify(envelope('기존 대화 카드'))}})`);
  await wait(250);
  routine.status = 'active';
  // Inject the renderer event directly: boot handoff buffering is outside this UI probe.
  const fire = () => shellWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', routine_id: routine.id, symbol: routine.symbol, note: routine.note,
    mode: routine.mode, observed: 100, threshold: 100, fired_at: new Date().toISOString(),
    main_card: candidate, main_card_confirmed_at: routine.main_card_confirmed_at,
  });
  fire();
  await until(`!!document.querySelector('.routine-alert-popup:not([hidden]) .routine-alert-popup__card:not(:disabled)')`, 'popup card choice');
  const beginsBeforeCard = conversationBegins;
  await run(`document.querySelector('.routine-alert-popup__card').click()`);
  await until(`document.querySelectorAll('#grid .card').length === 1 && document.getElementById('grid').textContent.includes('선택한 알람 메인 카드')`, 'single selected card');
  assert.equal(openings.length, 1);
  assert.equal(conversationBegins - beginsBeforeCard, 1, 'Card navigation creates exactly one conversation');
  assert.notEqual(openings[0].conversationId, original, 'Card navigation must create its own conversation');
  assert.equal(await run(`document.getElementById('grid').textContent.includes('기존 대화 카드')`), false);
  const captures = captureRoot(__dirname);
  await wait(400);
  fs.writeFileSync(path.join(captures, 'routine-main-card-chat.png'), (await shellWin.webContents.capturePage()).toPNG());
  assert.equal(await run(`window.AthenaShell.openConversation({id:${JSON.stringify(original)},title:'기존 대화'})`), true);
  await until(`document.getElementById('grid').textContent.includes('기존 대화 카드')`, 'original cards preserved');
  assert.equal(await run(`document.getElementById('grid').textContent.includes('선택한 알람 메인 카드')`), false);
  assert.equal(await run(`window.AthenaShell.openConversation({id:${JSON.stringify(openings[0].conversationId)},title:'현재가'})`), true);
  await until(`document.querySelectorAll('#grid .card').length === 1 && document.getElementById('grid').textContent.includes('선택한 알람 메인 카드')`, 'card conversation replay');
  fire();
  await until(`!document.querySelector('.routine-alert-popup').hidden`, 'second popup');
  await run(`document.querySelector('.routine-alert-popup__agent').click()`);
  await until(`!document.getElementById('agentCanvas').hidden && document.getElementById('agentCanvas').textContent.includes('검증용 삼성전자 가격 알람')`, 'specific agent alarm');
  assert.equal(openings.length, 1, 'Agent navigation must not fetch a card');
  console.log(JSON.stringify({ ok: true, confirmations: confirmations.length, singleCardOpens: openings.length, originalConversation: original, cardConversation: openings[0].conversationId, captures }));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
