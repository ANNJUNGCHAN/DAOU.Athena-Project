'use strict';

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { captureRoot } = require('./lib/probe-captures');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const OUT_DIR = captureRoot(__dirname);
const PROFILE = path.join(__dirname, '.probe-gold-chat-ticket-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(win, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await win.webContents.executeJavaScript(expression);
    if (value) return value;
    await wait(100);
  }
  return null;
}

const TICKET_SNAPSHOT = `(() => {
  const modal = document.getElementById('order');
  const blocker = modal && modal.querySelector('.ticket-lock-reason');
  if (!modal || modal.hidden || !blocker) return null;
  const rows = [...modal.querySelectorAll('.ticket-row')].map((row) => row.textContent.trim());
  const qty = modal.querySelector('.ticket-qty');
  const unit = modal.querySelector('.ticket-unit');
  const readout = modal.querySelector('.ticket-readout');
  const exec = modal.querySelector('.routine-approval-actions button');
  return {
    visible: !modal.hidden,
    rows,
    qty: qty && qty.value,
    unit: unit && unit.textContent,
    priceReadout: readout && readout.textContent,
    executionDisabled: exec && exec.disabled,
    blocker: blocker.textContent,
  };
})()`;

async function submitChat(win, text) {
  const sent = await win.webContents.executeJavaScript(`(() => {
    const input = document.getElementById('input');
    if (!input) return false;
    input.focus();
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.dispatchEvent(new CustomEvent('athena:chat-submit', { detail: { text: ${JSON.stringify(text)} } }));
    return true;
  })()`);
  if (!sent) throw new Error(`chat input missing for ${text}`);
}

function ticketOk(snapshot, readoutPattern, blockerPattern) {
  return !!snapshot
    && snapshot.visible
    && snapshot.rows.some((row) => row.includes('금 99.99_1kg'))
    && snapshot.qty === '1'
    && snapshot.unit === 'g'
    && readoutPattern.test(snapshot.priceReadout || '')
    && snapshot.executionDisabled === true
    && blockerPattern.test(snapshot.blocker || '');
}

async function main() {
  const mainModule = require('./main');
  const calls = { accountList: 0, ticketCapacity: 0, orderExecute: 0 };

  ipcMain.removeHandler('athena:account-list');
  ipcMain.handle('athena:account-list', async () => {
    calls.accountList += 1;
    return { accounts: [] };
  });
  ipcMain.removeHandler('athena:ticket-capacity');
  ipcMain.handle('athena:ticket-capacity', async () => {
    calls.ticketCapacity += 1;
    return { buyingPower: null, holdings: null };
  });
  ipcMain.removeHandler('athena:order-execute');
  ipcMain.handle('athena:order-execute', async () => {
    calls.orderExecute += 1;
    throw new Error('probe must never execute an order');
  });

  await mainModule.createWindows();
  const { shellWin } = mainModule.getWins();
  if (!shellWin) throw new Error('shell window was not created');
  shellWin.show();

  const ready = await poll(shellWin, `(() => {
    const order = document.getElementById('order');
    const onboard = document.getElementById('onboard');
    const input = document.getElementById('input');
    return order && onboard && onboard.hidden && input ? true : null;
  })()`);
  if (!ready) throw new Error('shell renderer did not become ready');

  calls.accountList = 0;
  calls.ticketCapacity = 0;

  const inputIdle = `(() => {
    const input = document.getElementById('input');
    return input && !input.disabled ? true : null;
  })()`;

  await submitChat(shellWin, '금99.99_1kg 1g 매수 주문 티켓을 열어줘.');
  const afterOpen = await poll(shellWin, TICKET_SNAPSHOT);
  await poll(shellWin, inputIdle);
  await submitChat(shellWin, '단가 시장가');
  const afterMarket = await poll(
    shellWin,
    `(() => {
      const snap = ${TICKET_SNAPSHOT};
      return snap && /시장가 요청/.test(snap.priceReadout || '') ? snap : null;
    })()`,
  );
  await poll(shellWin, inputIdle);
  await shellWin.webContents.executeJavaScript(`(() => {
    const modal = document.getElementById('order');
    if (modal) modal.hidden = true;
    return true;
  })()`);
  await submitChat(shellWin, '티켓이 안보여');
  const afterReopen = await poll(shellWin, TICKET_SNAPSHOT);
  await wait(400);

  const pngPath = path.join(OUT_DIR, 'probe-gold-chat-ticket.png');
  fs.writeFileSync(pngPath, (await shellWin.webContents.capturePage()).toPNG());
  const report = {
    ok: ticketOk(afterOpen, /실행 불가/, /주문 유형|시장가 매매구분|단가/)
      && ticketOk(afterMarket, /시장가 요청 · 실행 불가/, /시장가 매매구분 코드/)
      && ticketOk(afterReopen, /시장가 요청 · 실행 불가/, /시장가 매매구분 코드/)
      && calls.accountList === 0
      && calls.ticketCapacity === 0
      && calls.orderExecute === 0,
    afterOpen,
    afterMarket,
    afterReopen,
    calls,
    screenshot: pngPath,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'probe-gold-chat-ticket-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
