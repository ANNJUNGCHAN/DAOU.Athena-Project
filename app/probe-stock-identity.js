'use strict';

// Real shell regression, with all IPC and network traffic confined to fixtures.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('./lib/board-template-registry');

const output = path.resolve(__dirname, '../.omc/artifacts/stock-identity-runtime.json');
const requests = [];
const observations = [];
const templateRoot = path.resolve(__dirname, '../backend/ref/card-surface-templates');
const slotsFor = (id) => JSON.parse(fs.readFileSync(path.join(templateRoot, id, 'slots.json'), 'utf8'));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'athena-stock-identity-')));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const channels = [...fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8')
  .split('const INVOKE_CHANNELS = new Set([')[1].split(']);')[0].matchAll(/'([^']+)'/g)]
  .map((match) => match[1]);
for (const channel of channels) ipcMain.handle(channel, async (_event, payload) => {
  if (channel === 'athena:canvas-board-hydrate') {
    requests.push(payload);
    assert.equal(payload.target.stk_cd, '066570');
    const slot_values = {};
    // ETF responses can omit stock identity. The original card must still keep LG전자.
    if (payload.boardId !== '15N5-2') for (const slot of slotsFor(payload.boardId).slots) {
      if (!payload.slotIds.includes(slot.slot_id)) continue;
      if (slot.f === 'stk_nm') slot_values[slot.slot_id] = { value: 'LG전자', text: 'LG전자' };
      if (slot.f === 'stk_cd') slot_values[slot.slot_id] = { value: '066570', text: '066570' };
    }
    return { ok: true, slot_values, operations: [] };
  }
  if (channel === 'athena:boot-readiness:get') return {
    runId: 'stock-identity-fixture', revision: 1, phase: 'ready',
    tasks: [{ id: 'ready', label: 'fixture', kind: 'gate', state: 'succeeded', attempt: 1 }],
  };
  if (channel === 'athena:onboarding-state') return { needed: false, step: 3 };
  if (channel.endsWith('-list') || channel.endsWith('conversations-list')) return [];
  if (channel.includes('prefs:get')) return {};
  return null;
});

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') } });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  try {
    await win.loadFile(path.join(__dirname, 'shell.html'));
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const start = Date.now(); const check = () => {
        if (document.getElementById('boot').dataset.phase === 'complete') return resolve();
        if (Date.now() - start > 10000) return reject(new Error('boot timeout'));
        setTimeout(check, 20);
      }; check();
    })`);
    const contract = { surface_version: 'card-surface.v1', board_id: '137X-2', card_id: 'CC-03',
      state_boards: registry.stateLinksFor('137X-2'),
      slot_values: [{ slot_id: 's001', value: 'LG전자' }, { slot_id: 's002', value: '066570' }],
      unbound_slots: [], column_priority: [], section_titles_ko: {} };
    win.webContents.send('athena:add-rest-canvas', {
      operationRef: 'detail:ka10001:identity_and_capital', operationArgs: { stk_cd: '066570' },
      canvasType: 'facts', envelope: { card_id: 'CC-03', card_kind: 'instrument',
        capability: 'quote', mode: 'quote', section: 'board-surface', view_instance_id: 'stock-identity',
        operation_ref: 'detail:ka10001:identity_and_capital', operation_args: { stk_cd: '066570' },
        canvas_type: 'facts', card_title: 'LG전자', fell_back: false, surface_contract: contract,
        correlation: { dataset_id: 'stock-identity-fixture', item_id: 'stock-identity', ordinal: 3 },
        realtime_bindings: [], operation_refs: ['detail:ka10001:identity_and_capital'] },
    });
    const inspect = async (boardId) => {
      const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const start = Date.now(); const check = () => {
          const host = document.querySelector('.board-surface-host');
          const state = host && host.__athenaBoard;
          const header = host && host.querySelector('.bs-header, [data-name="Instrument Header"]');
          if (state && state.boardId === ${JSON.stringify(boardId)} && header) {
            const text = header.textContent;
            if (text.includes('LG전자') && text.includes('066570')) return resolve({ boardId: state.boardId,
              header: text.trim(), links: [...host.querySelectorAll('[data-state-board]')].map(n =>
                ({ boardId: n.dataset.stateBoard, label: n.textContent.trim() })) });
          }
          if (Date.now() - start > 5000) return reject(new Error('identity mismatch: ' + ${JSON.stringify(boardId)} + ' ' + (header && header.textContent) + ' GRID ' + document.getElementById('grid').innerHTML.slice(0,1500)));
          setTimeout(check, 20);
        }; check();
      })`);
      assert.doesNotMatch(result.header, /삼성전자|005930|KODEX|069500/);
      observations.push(result);
      return result;
    };
    await inspect('137X-2');
    const click = async (boardId) => {
      const clicked = await win.webContents.executeJavaScript(`(() => {
        const node = document.querySelector('[data-state-board="${boardId}"]');
        if (!node) return false; node.click(); return true;
      })()`);
      assert.ok(clicked, `Missing internal tab to ${boardId}`);
      return inspect(boardId);
    };
    for (let round = 0; round < 3; round += 1) {
      await click('2RBO-1');
      await click('2R3M-1');
    }
    await click('3FR6-0');
    // ETF has no authored state link. Invoke the same production mount function explicitly
    // to test its empty-data fallback without claiming a user-click route exists.
    await win.webContents.executeJavaScript(`mountBoardState(
      document.querySelector('.board-surface-host'), '15N5-2',
      ${JSON.stringify({ card_id: 'CC-03', operation_args: { stk_cd: '066570' }, surface_contract: contract })}
    )`);
    await inspect('15N5-2');
    assert.ok(requests.length > 0, 'No real hydration IPC was exercised');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ fixture_only: true, requests, observations }, null, 2));
    console.log(JSON.stringify({ ok: true, observations: observations.length, hydrationRequests: requests.length, output }));
  } finally { win.destroy(); }
}
main().then(() => app.exit(0)).catch((error) => { console.error(error.stack); app.exit(1); });
