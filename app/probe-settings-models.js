'use strict';

process.env.ATHENA_NO_AUTOSTART = '1';

if (process.env.ATHENA_USERDATA_DIR) {
  console.error('[probe-settings-models] ATHENA_USERDATA_DIR 공유 프로필에서는 fixture를 실행하지 않는다.');
  process.exit(2);
}

const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { resolveHarnessProfile } = require('./lib/main/harness-profile');
const { captureRoot } = require('./lib/probe-captures');

const profile = resolveHarnessProfile({ prefix: 'athena-probe-settings-models-' });
app.setPath('userData', profile.dir);
profile.seedOnboarding();
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(profile.dir, 'mcp-state', 'mcp_servers.json');
process.env.CODEX_HOME = path.join(profile.dir, 'codex-home');
process.env.ATHENA_BACKEND_URL = 'http://127.0.0.1:1';

const CAPTURES = captureRoot(__dirname);
const failures = [];
const calls = [];
let cliRevision = 0;
let modelState = {
  claude: { model: 'claude-sonnet-4-6', effort: 'high' },
  grok: { model: null, effort: null },
  codex: { model: 'gpt-5.6-sol', effort: 'high' },
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installFixtureHandlers() {
  const providers = () => [
    {
      id: 'claude', name: 'Claude', connected: true,
      accounts: [{ id: 'claude:fixture', label: 'fixture@example.com', active: true, current: true }],
    },
    { id: 'grok', name: 'Grok', connected: false, accounts: [] },
    {
      id: 'codex', name: 'Codex', connected: cliRevision > 0,
      accounts: cliRevision > 0
        ? [{ id: 'codex:fixture', label: 'Codex fixture', active: true, current: true }]
        : [],
    },
  ];

  const handlers = {
    'athena:model-get': async () => {
      calls.push({ channel: 'athena:model-get', at: Date.now() });
      return modelState;
    },
    'athena:model-set': async (_event, { provider, patch }) => {
      calls.push({ channel: 'athena:model-set', provider, patch, at: Date.now() });
      modelState = { ...modelState, [provider]: { ...modelState[provider], ...patch } };
      return { ok: true, model: modelState };
    },
    // 실제 CLI 상태 확인이 통합 검증의 500ms보다 오래 걸릴 수 있음을 재현한다.
    'athena:cli-list': async () => {
      calls.push({ channel: 'athena:cli-list', revision: cliRevision, at: Date.now() });
      await wait(850);
      return { providers: providers() };
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  }
}

async function readSurface(win) {
  return win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('#settingsGrid .card.model');
    const pressed = card ? Array.from(card.querySelectorAll('.uk-chip.is-pressed')).map((node) => node.textContent.trim()) : [];
    return {
      cardCount: document.querySelectorAll('#settingsGrid .card.model').length,
      accountRows: card ? card.querySelectorAll('.uk-model-accounts .uk-model-account-row').length : 0,
      chipCount: card ? card.querySelectorAll('.uk-chip-row .uk-chip').length : 0,
      pressed,
      text: card ? card.innerText : '',
    };
  })()`);
}

async function waitFor(win, predicate, label, timeoutMs = 5000) {
  const started = Date.now();
  let value;
  while (Date.now() - started < timeoutMs) {
    value = await readSurface(win);
    if (predicate(value)) return { value, elapsedMs: Date.now() - started };
    await wait(50);
  }
  failures.push(`${label}: ${JSON.stringify(value)}`);
  return { value, elapsedMs: Date.now() - started };
}

function selectModelScript() {
  return `(() => {
    const input = document.getElementById('input');
    input.value = '설정';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const button = Array.from(document.querySelectorAll('#settingsNav .settings-nav-item'))
      .find((item) => item.querySelector('.settings-nav-label')?.textContent.trim() === '모델');
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

app.whenReady().then(async () => {
  const main = require('./main.js');
  installFixtureHandlers();
  await main.createWindows();
  const { shellWin } = main.getWins();
  await wait(600);

  const selected = await shellWin.webContents.executeJavaScript(selectModelScript());
  if (!selected) failures.push('모델 설정 네비게이션을 찾지 못했다');

  await wait(500);
  const early = await readSurface(shellWin);
  if (early.cardCount !== 1 || early.accountRows !== 0 || early.chipCount !== 0) {
    failures.push(`지연 fixture의 500ms 전 상태가 예상과 다르다: ${JSON.stringify(early)}`);
  }

  const ready = await waitFor(shellWin, (surface) => (
    surface.cardCount === 1 && surface.accountRows === 1 && surface.chipCount > 0
  ), '최초 모델 카드 준비');

  const modelButtonClicked = await shellWin.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('#settingsGrid .card.model .uk-chip'))
      .find((node) => node.textContent.trim() === 'opus');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!modelButtonClicked) failures.push('opus 모델 칩을 찾지 못했다');
  await waitFor(shellWin, () => calls.some((call) => call.channel === 'athena:model-set'), '모델 변경 IPC');
  shellWin.webContents.send('athena:model-changed', { provider: 'claude' });
  const modelChanged = await waitFor(shellWin, (surface) => surface.pressed.includes('opus'), '모델 변경 방송 반영');

  cliRevision += 1;
  shellWin.webContents.send('athena:cli-changed', { provider: 'codex' });
  const providerChanged = await waitFor(shellWin, (surface) => (
    surface.accountRows === 2 && surface.text.includes('Codex fixture')
  ), '제공업체 변경 방송 반영');

  // DOM 판정 직후보다 Chromium 합성이 한 프레임 늦을 수 있으므로 캡처 전에
  // 안정화한 뒤 같은 최신 상태가 유지되는지도 다시 확인한다.
  await wait(250);
  const settled = await readSurface(shellWin);
  if (settled.accountRows !== 2 || !settled.text.includes('Codex fixture') || !settled.pressed.includes('opus')) {
    failures.push(`합성 대기 뒤 최신 상태가 유지되지 않았다: ${JSON.stringify(settled)}`);
  }

  const image = await shellWin.webContents.capturePage();
  const screenshot = path.join(CAPTURES, 'SETTINGS-MODELS-ACTUAL-ELECTRON.png');
  fs.writeFileSync(screenshot, image.toPNG());

  const report = {
    ok: failures.length === 0,
    diagnosis: 'fixed 500ms probe precedes delayed cli-list; renderer becomes ready after IPC completion',
    early,
    ready,
    modelChanged,
    providerChanged,
    settled,
    calls,
    screenshot,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  app.exit(failures.length ? 1 : 0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
