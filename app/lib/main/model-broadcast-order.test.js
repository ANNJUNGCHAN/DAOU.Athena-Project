'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBroadcastCliChanged() {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  const start = source.indexOf('async function broadcastCliChanged(');
  const end = source.indexOf('async function pollCliChangesAfterLogin(', start);
  assert.ok(start >= 0 && end > start, 'broadcastCliChanged must remain executable');

  const observed = [];
  let activeProvider = 'claude';
  const handleModelGet = () => ({ active: { provider: activeProvider } });
  const context = vm.createContext({
    cliAccounts: { list: async () => { throw new Error('supplied list should be reused'); } },
    activeAccountFromCliList: (list) => list.accounts.find((account) => account.active),
    rotatePersistentProvider: async (_reason, { activeAccount }) => {
      await Promise.resolve();
      activeProvider = activeAccount.providerId;
    },
    handleModelGet,
    shellWin: {
      isDestroyed: () => false,
      webContents: {
        send: (channel) => {
          if (channel === 'athena:cli-changed') observed.push(['shell', handleModelGet().active.provider]);
        },
      },
    },
    orbWin: {
      isDestroyed: () => false,
      webContents: {
        send: (channel, state) => {
          if (channel === 'athena:model-changed') observed.push(['orb', state.active.provider]);
        },
      },
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return { broadcast: context.broadcastCliChanged, observed };
}

test('CLI 활성 계정 전환은 새 공급자를 반영한 뒤 셸과 오브에 알린다', async () => {
  const { broadcast, observed } = loadBroadcastCliChanged();
  const list = { accounts: [{ id: 'grok-current', providerId: 'grok', active: true }] };

  await broadcast({ rotateReason: 'active_provider_changed', list });

  assert.deepEqual(observed, [['shell', 'grok'], ['orb', 'grok']]);
});
