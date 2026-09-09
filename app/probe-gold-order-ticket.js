'use strict';

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { captureRoot } = require('./lib/probe-captures');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const OUT_DIR = captureRoot(__dirname);
const PROFILE = path.join(__dirname, '.probe-gold-order-ticket-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(win, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await win.webContents.executeJavaScript(expression);
    if (value) return value;
    await wait(100);
  }
  return null;
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
    return order && onboard && onboard.hidden ? true : null;
  })()`);
  if (!ready) throw new Error('shell renderer did not become ready');

  calls.accountList = 0;
  calls.ticketCapacity = 0;
  shellWin.webContents.send('athena:selector-order-draft', {
    status: 'guarded',
    guarded: true,
    operation_ref: 'base:kt50000',
    card_title: '금현물 매수주문',
    next_actions: ['open_order_ticket'],
    order_draft: {
      asset_kind: 'gold',
      stk_cd: 'M04020000',
      product_name: '금 99.99_1kg',
      side: 'buy',
      ord_qty: '1',
      unit: '개',
      requested_order_type: 'market',
      execution_supported: false,
      execution_blocker: '금현물 주문 API에서 시장가 매매구분 코드가 확인되지 않아 실행할 수 없습니다.',
    },
  });

  const ticketSnapshotExpression = `(() => {
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
  let snapshot = await poll(shellWin, ticketSnapshotExpression);
  await wait(750);
  snapshot = await shellWin.webContents.executeJavaScript(ticketSnapshotExpression);

  const pngPath = path.join(OUT_DIR, 'probe-gold-order-ticket.png');
  fs.writeFileSync(pngPath, (await shellWin.webContents.capturePage()).toPNG());
  const report = {
    ok: !!snapshot
      && snapshot.visible
      && snapshot.rows.some((row) => row.includes('금 99.99_1kg'))
      && snapshot.qty === '1'
      && snapshot.unit === '개'
      && snapshot.priceReadout === '시장가 요청 · 실행 불가'
      && snapshot.executionDisabled === true
      && /시장가 매매구분 코드/.test(snapshot.blocker)
      && calls.accountList === 0
      && calls.ticketCapacity === 0
      && calls.orderExecute === 0,
    snapshot,
    calls,
    screenshot: pngPath,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'probe-gold-order-ticket-report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error(error && error.stack || error);
  app.exit(1);
});
