// 플러그인 권한 화면의 실제 렌더러/IPC 왕복만 재는 좁은 Electron 프로브.
// 외부 MCP 서버를 띄우지 않고 main IPC 채널을 고정 응답으로 교체해
// 목록 -> 권한 클릭 -> probe -> 목록 재조회 -> 권한 초안까지 한 흐름을 검증한다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';
process.env.ATHENA_BACKEND_URL = 'http://127.0.0.1:0';

const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { captureRoot } = require('./lib/probe-captures');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-plugin-permissions-'));
const CAPTURES = captureRoot(__dirname);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);
process.env.ATHENA_MCP_REGISTRY_PATH = path.join(PROFILE, '.athena', 'mcp_servers.json');
process.env.CODEX_HOME = path.join(PROFILE, '.codex-home');
fs.mkdirSync(path.dirname(process.env.ATHENA_MCP_REGISTRY_PATH), { recursive: true });
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });

const server = {
  alias: 'korea-stock',
  command: 'npx',
  argsPreview: '-y @drfirst/korea-stock-mcp',
  approved: true,
  toolCount: 4,
  health: 'ok',
  warnings: [],
};
const tools = [
  ['search_stock_code', '종목명으로 종목 코드를 찾습니다'],
  ['get_stock_price_by_code', '종목 코드로 현재가를 조회합니다'],
  ['get_market_cap_stocks', '시가총액 상위 종목을 가져옵니다'],
  ['get_dividend_yield_stocks', '배당수익률 상위 종목을 가져옵니다'],
  ['get_themes_with_leaders', '테마와 주도주를 가져옵니다'],
  ['get_etfs_by_market_cap', '시총 기준 ETF 목록을 가져옵니다'],
].map(([name, description], index) => ({ name, description, allowed: index < 4 }));

async function waitUntil(check, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await check();
    if (result) return result;
    await wait(50);
  }
  return null;
}

async function main() {
  const mainModule = require('./main.js');
  let listCalls = 0;
  let probeCalls = 0;
  let approveCalls = 0;
  let revision = 12;
  ipcMain.removeHandler('athena:mcp-list');
  ipcMain.handle('athena:mcp-list', async () => {
    listCalls += 1;
    return { servers: [{ ...server, toolCount: tools.filter((tool) => tool.allowed).length }], revision };
  });
  ipcMain.removeHandler('athena:mcp-probe');
  ipcMain.handle('athena:mcp-probe', async (_event, payload) => {
    probeCalls += 1;
    return payload && payload.alias === server.alias
      ? { ok: true, tools }
      : { ok: false, error: 'unexpected alias' };
  });
  ipcMain.removeHandler('athena:plugin-pending');
  ipcMain.handle('athena:plugin-pending', async () => ({ proposals: [], revision }));
  ipcMain.removeHandler('athena:plugin-approve');
  ipcMain.handle('athena:plugin-approve', async (_event, envelope) => {
    approveCalls += 1;
    const actions = envelope && Array.isArray(envelope.actions) ? envelope.actions : [];
    for (const action of actions) {
      if (action.target !== server.alias) return { ok: false, kind: 'failed', reason: 'unexpected target' };
      const nextAllowed = action.action === 'allow_tools';
      if (action.action !== 'allow_tools' && action.action !== 'revoke_tools') {
        return { ok: false, kind: 'failed', reason: 'unexpected action' };
      }
      for (const feature of action.features || []) {
        const tool = tools.find((row) => row.name === feature);
        if (!tool) return { ok: false, kind: 'failed', reason: 'unexpected feature' };
        tool.allowed = nextAllowed;
      }
    }
    revision += 1;
    return { ok: true, kind: 'success', reason: null, results: [], probes: [], revision, runtimeEnabled: false };
  });
  ipcMain.removeHandler('athena:plugin-reject');
  ipcMain.handle('athena:plugin-reject', async () => ({ ok: true, kind: 'rejected', revision }));
  ipcMain.removeHandler('athena:mcp-audit');
  ipcMain.handle('athena:mcp-audit', async () => ({ entries: [] }));

  await mainModule.createWindows();
  const { shellWin } = mainModule.getWins();

  await waitUntil(() => shellWin.webContents.executeJavaScript(
    "document.getElementById('app').hidden === false",
  ));

  await shellWin.webContents.executeJavaScript(`
    document.getElementById('modeNavPlugin').click();
    document.querySelector('.plugin-canvas-action.is-manage').click();
  `);
  await waitUntil(() => shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.plugin-canvas-card[data-plugin-id=\"korea-stock\"]').length === 1",
  ));
  await shellWin.webContents.executeJavaScript(`
    document.getElementById('modeNavPlugin').click();
    document.querySelector('.plugin-canvas-card[data-plugin-id="korea-stock"] .plugin-canvas-action').click();
  `);

  const result = await waitUntil(async () => {
    const snapshot = await shellWin.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('.plugin-canvas-permissions-view');
      if (!panel) return null;
      return {
        badges: Array.from(panel.querySelectorAll('.plugin-canvas-count')).map((node) => node.textContent),
        features: panel.querySelectorAll('.plugin-canvas-sheet-feature').length,
        allowed: panel.querySelector('.plugin-canvas-sheet-count')?.textContent || '',
        toggles: Array.from(panel.querySelectorAll('.plugin-canvas-toggle')).map((node) => node.getAttribute('aria-checked')),
        dialogCount: document.querySelectorAll('.plugin-canvas-sheet[role="dialog"]').length,
        overlayCount: document.querySelectorAll('.plugin-canvas-sheet-overlay').length,
      };
    })()`);
    return snapshot && snapshot.features === 6 ? snapshot : null;
  });

  if (result) {
    await shellWin.webContents.executeJavaScript(`
      document.querySelectorAll('.plugin-canvas-toggle')[4].click();
    `);
    result.afterToggle = await shellWin.webContents.executeJavaScript(
      "document.querySelector('.plugin-canvas-sheet-count').textContent",
    );
    await shellWin.webContents.executeJavaScript(
      "document.querySelector('.plugin-canvas-action.is-sheet-confirm').click()",
    );
    result.proposal = await waitUntil(() => shellWin.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.plugin-canvas-proposal');
      return card ? {
        state: card.getAttribute('data-proposal-state'),
        title: card.querySelector('.plugin-canvas-proposal-title')?.textContent || '',
      } : null;
    })()`));
    await shellWin.webContents.executeJavaScript(
      "document.querySelector('.plugin-canvas-proposal .is-proposal-approve').click()",
    );
    await waitUntil(() => shellWin.webContents.executeJavaScript(
      "document.querySelector('.plugin-canvas-proposal')?.getAttribute('data-proposal-state') === 'done'",
    ));
    await shellWin.webContents.executeJavaScript(`
      window.AthenaPluginCanvas.setView('hub');
      document.querySelector('.plugin-canvas-card[data-plugin-id="korea-stock"] .plugin-canvas-action').click();
    `);
    result.persisted = await waitUntil(async () => {
      const snapshot = await shellWin.webContents.executeJavaScript(`(() => ({
        allowed: document.querySelector('.plugin-canvas-sheet-count')?.textContent || '',
        toggles: Array.from(document.querySelectorAll('.plugin-canvas-permission-features .plugin-canvas-toggle'))
          .map((node) => node.getAttribute('aria-checked')),
      }))()`);
      return snapshot.allowed === '허용 5 / 6' ? snapshot : null;
    });
    shellWin.showInactive();
    await wait(150);
    const image = await shellWin.webContents.capturePage();
    fs.writeFileSync(path.join(CAPTURES, 'plugin-permissions-probe.png'), image.toPNG());
  }

  const failures = [];
  const check = (label, pass) => {
    console.log(`${pass ? '  ok' : 'FAIL'}  ${label}`);
    if (!pass) failures.push(label);
  };
  check('등록 목록을 실제 IPC로 다시 읽었다', listCalls >= 2);
  check('두 번 연 권한 화면이 선택한 서버만 각각 probe했다', probeCalls === 2);
  check('권한 화면은 설치됨/기능 6/허용 4/연결 확인됨 배지를 보인다',
    result && JSON.stringify(result.badges) === JSON.stringify(['설치됨', '기능 6', '허용 4', '연결 확인됨']));
  check('probe가 돌려준 기능 6개와 허용 4개를 그린다',
    result && result.features === 6 && result.allowed === '허용 4 / 6'
      && result.toggles.filter((value) => value === 'true').length === 4);
  check('권한은 모달이 아닌 상세 화면이다', result && result.dialogCount === 0 && result.overlayCount === 0);
  check('토글은 저장 전 초안에서만 4개에서 5개로 바뀐다', result && result.afterToggle === '허용 5 / 6');
  check('선택 저장은 허용 제안 한 건을 만들고 승인 경로로 보낸다',
    result && result.proposal && result.proposal.state === 'pending'
      && result.proposal.title === '한국 주식 시세 · 기능 허용' && approveCalls === 1);
  check('승인한 권한은 다시 probe한 화면에도 5/6으로 유지된다',
    result && result.persisted && result.persisted.allowed === '허용 5 / 6'
      && result.persisted.toggles.filter((value) => value === 'true').length === 5);

  const report = { profile: PROFILE, registry: process.env.ATHENA_MCP_REGISTRY_PATH, listCalls, probeCalls, approveCalls, result, failures, ok: failures.length === 0 };
  fs.writeFileSync(path.join(CAPTURES, 'probe-plugin-permissions.json'), JSON.stringify(report, null, 2));
  console.log('[probe:plugin-permissions]', JSON.stringify(report));
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  console.error('[probe:plugin-permissions] 실패:', error);
  app.exit(1);
});
