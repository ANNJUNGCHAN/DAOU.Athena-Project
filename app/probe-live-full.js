// 모드·설정·버튼·질의를 전수한다. 실주문과 키우미 다섯 얼굴은 클릭하지 않는다.
// 기본은 격리 프로필 — 실앱 %APPDATA%/athena-shell 과 락·상태를 공유하지 않는다.
// 실프로필이 필요하면 ATHENA_USERDATA_DIR 을 명시한다.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  MODES,
  SETTINGS_NAV,
  LOCKED_CLICKS,
  LIVE_QUERIES,
  SAFE_CLICK_IDS,
  queryVerdict,
  chromeMatches,
} = require('./lib/live-full-catalog');

const PROFILE = process.env.ATHENA_USERDATA_DIR || path.join(__dirname, '.probe-live-full-profile');
if (!process.env.ATHENA_USERDATA_DIR) {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
}
app.setPath('userData', PROFILE);

const fetchCalls = [];
const CAPTURES = path.join(__dirname, 'captures');
const REPORT = path.join(CAPTURES, 'LIVE-FULL-REPORT.json');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function orderCalls() {
  return fetchCalls.filter((call) => /\/api\/v1\/order\//.test(call.url));
}

async function evalJs(win, code, timeoutMs = 4000, fallback = null) {
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(code),
      wait(timeoutMs).then(() => fallback),
    ]);
  } catch (_error) {
    return fallback;
  }
}

async function waitUntil(check, timeoutMs, intervalMs = 100) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await check();
    if (last) return last;
    await wait(intervalMs);
  }
  return last;
}

async function captureOrSkip(win, name) {
  if (!win || typeof win.isDestroyed === 'function' && win.isDestroyed()) {
    return { name, skipped: true, reason: 'window gone' };
  }
  try {
    const img = await Promise.race([
      win.webContents.capturePage(),
      wait(12000).then(() => null),
    ]);
    if (!img) return { name, skipped: true, reason: 'capturePage timeout' };
    const dest = path.join(CAPTURES, name);
    fs.writeFileSync(dest, img.toPNG());
    return { name, skipped: false, path: dest };
  } catch (error) {
    return { name, skipped: true, reason: String(error && error.message || error) };
  }
}

const SURFACE_PROBE = `(() => {
  const vis = (id) => {
    const node = document.getElementById(id);
    return !!node && node.hidden !== true;
  };
  const head = document.getElementById('chatModeHead');
  const title = document.querySelector('#chatModeHead .chat-mode-head-title');
  const sub = document.querySelector('#chatModeHead .chat-mode-head-sub');
  const active = document.querySelector('.sidebar-mode-item.is-active');
  return {
    boot: vis('boot'),
    app: vis('app'),
    shell: vis('shell'),
    onboard: vis('onboard'),
    settings: vis('settings'),
    chat: vis('chatRegion'),
    mosaic: vis('mosaic'),
    graph: vis('graphCanvas'),
    graphSummary: vis('graphSummaryTable'),
    graphSettings: vis('graphSettingsCanvas'),
    agent: vis('agentCanvas'),
    plugin: vis('pluginCanvas'),
    backtest: vis('backtestCanvas'),
    activeView: active && active.dataset.view || null,
    chatHeadHidden: !head || head.hidden === true,
    chatHeadMode: head && head.dataset.mode || null,
    chatHeadTitle: title ? title.textContent : '',
    chatHeadSub: sub ? sub.textContent : '',
    emptyHistory: getComputedStyle(document.querySelector('#history') || document.body, ':before').content,
  };
})()`;

const BUTTON_PROBE = `(() => {
  const nodes = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
  return nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && node.hidden !== true;
    return {
      id: node.id || '',
      text: (node.innerText || node.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      disabled: node.disabled === true,
      visible,
    };
  });
})()`;

function exclusiveCanvas(view, surface) {
  const visible = MODES.filter((mode) => surface[mode.view === 'summary' ? 'mosaic' : mode.view.replace('summary', 'mosaic')]);
  const graphSurface = surface.graph || surface.graphSummary || surface.graphSettings;
  const map = {
    summary: surface.mosaic && !graphSurface && !surface.agent && !surface.plugin && !surface.backtest,
    graph: !surface.mosaic && graphSurface && !surface.agent && !surface.plugin && !surface.backtest,
    agent: !surface.mosaic && !graphSurface && surface.agent && !surface.plugin && !surface.backtest,
    plugin: !surface.mosaic && !graphSurface && !surface.agent && surface.plugin && !surface.backtest,
    backtest: !surface.mosaic && !graphSurface && !surface.agent && !surface.plugin && surface.backtest,
  };
  return { ok: map[view] === true && surface.chat === true, visible, chat: surface.chat };
}

function isLockedClick(button) {
  const hay = `${button.id} ${button.text}`;
  return LOCKED_CLICKS.find((lock) => lock.match.test(hay));
}

async function main() {
  if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });
  const origFetch = global.fetch.bind(globalThis);
  global.fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), method: (init && init.method) || 'GET' });
    return origFetch(url, init);
  };
  const mainMod = require('./main.js');
  if (typeof mainMod.getWins !== 'function') {
    throw new Error(
      `main.js exports missing getWins: ${Object.keys(mainMod || {}).join(',')}`
      + ' — 같은 프로필로 실앱이 이미 떠 있으면 싱글 인스턴스 락에 걸린다',
    );
  }
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    userData: app.getPath('userData'),
    windows: {},
    boot: null,
    modes: [],
    settings: null,
    buttons: [],
    clicks: [],
    queries: [],
    forbiddenOrderCalls: 0,
    captures: [],
    errors: [],
  };

  const wins = await waitUntil(() => {
    const current = mainMod.getWins();
    return current.shellWin && !current.shellWin.isDestroyed() ? current : null;
  }, 25000);
  if (!wins) {
    report.errors.push('shell window missing');
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    app.exit(1);
    return;
  }
  const { shellWin } = wins;
  shellWin.show();
  await waitUntil(() => {
    const current = mainMod.getWins();
    return current.orbWin && !current.orbWin.isDestroyed();
  }, 8000);
  const orbWin = mainMod.getWins().orbWin;
  report.windows = {
    shell: !shellWin.isDestroyed(),
    orb: !!(orbWin && !orbWin.isDestroyed()),
    extra: BrowserWindow.getAllWindows().length,
  };

  const boot = await waitUntil(async () => {
    const surface = await shellWin.webContents.executeJavaScript(SURFACE_PROBE);
    return surface && !surface.boot && (surface.app || surface.onboard) ? surface : null;
  }, 20000);
  report.boot = boot;
  if (!boot || boot.onboard) {
    report.errors.push(boot && boot.onboard ? 'onboarding still visible' : 'app never became visible');
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    app.exit(1);
    return;
  }

  const accountList = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena:account-list')`,
  ).catch(() => null);
  const activeId = accountList && (accountList.activeId
    || (Array.isArray(accountList.accounts) && accountList.accounts[0] && accountList.accounts[0].id)
    || null);
  if (activeId) {
    const refreshed = await Promise.race([
      shellWin.webContents.executeJavaScript(
        `window.athena.invoke('athena:auth-token-refresh', ${JSON.stringify({ id: activeId })})`,
      ),
      wait(12000).then(() => ({ ok: false, state: 'timeout' })),
    ]).catch((error) => ({ ok: false, error: String(error && error.message || error) }));
    report.tokenRefresh = { ok: Boolean(refreshed && refreshed.ok), state: refreshed && refreshed.state };
  } else {
    report.tokenRefresh = { ok: false, state: 'no-account' };
  }

  await wait(8000);
  report.indexReady = { ok: true, source: 'wait-8s-after-token' };
  report.captures.push(await captureOrSkip(shellWin, 'live-full-boot.png'));
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  for (const mode of MODES) {
    await evalJs(shellWin, `document.getElementById(${JSON.stringify(mode.navId)}).click()`, 3000, null);
    await wait(300);
    const surface = await evalJs(shellWin, SURFACE_PROBE, 3000, null);
    if (!surface) {
      report.modes.push({ view: mode.view, ok: false, error: 'surface probe timeout' });
      continue;
    }
    const exclusive = exclusiveCanvas(mode.view, surface);
    const chrome = chromeMatches(mode.view, surface);
    report.modes.push({
      view: mode.view,
      activeView: surface.activeView,
      exclusive,
      chrome,
      ok: exclusive.ok && chrome.ok && surface.activeView === mode.view,
    });
    report.captures.push(await captureOrSkip(shellWin, `live-full-mode-${mode.view}.png`));
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  }

  await evalJs(shellWin, 'window.AthenaShell && window.AthenaShell.openSettings && window.AthenaShell.openSettings()', 3000, null);
  await wait(400);
  const settings = await evalJs(shellWin, `(() => {
    const settingsEl = document.getElementById('settings');
    const nav = Array.from(document.querySelectorAll('#settingsNav button, #settingsNav [role="option"]')).map((node) => ({
      key: node.dataset.key || node.dataset.nav || '',
      text: (node.innerText || '').replace(/\\s+/g, ' ').trim(),
    }));
    return {
      visible: !!settingsEl && settingsEl.hidden !== true,
      nav,
    };
  })()`, 3000, { visible: false, nav: [] });
  const navLabels = settings.nav.map((item) => item.text).filter(Boolean);
  report.settings = {
    ...settings,
    expected: SETTINGS_NAV.map((item) => item.label),
    fourth: SETTINGS_NAV[3].label,
    ok: settings.visible === true && navLabels.some((text) => text.includes('성향')),
  };
  report.captures.push(await captureOrSkip(shellWin, 'live-full-settings.png'));
  await evalJs(shellWin, `document.getElementById('settings') && document.getElementById('settings').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`, 2000, null);
  await wait(200);

  const buttons = await evalJs(shellWin, BUTTON_PROBE, 4000, []);
  report.buttons = buttons;
  const visibleButtons = buttons.filter((button) => button.visible);
  for (const button of visibleButtons) {
    const locked = isLockedClick(button);
    if (locked) {
      report.clicks.push({ id: button.id, text: button.text, skipped: true, reason: locked.reason });
      continue;
    }
    if (button.id && SAFE_CLICK_IDS.includes(button.id)) {
      await evalJs(shellWin, `(() => { const n = document.getElementById(${JSON.stringify(button.id)}); if (n && !n.disabled) n.click(); })()`, 2000, null);
      await wait(150);
      report.clicks.push({ id: button.id, text: button.text, skipped: false });
    } else {
      report.clicks.push({ id: button.id, text: button.text, skipped: true, reason: 'not in SAFE_CLICK_IDS' });
    }
  }

  await evalJs(shellWin, `document.getElementById('modeNavSummary').click()`, 2000, null);
  await wait(300);

  for (const query of LIVE_QUERIES) {
    await evalJs(shellWin, `document.getElementById('sidebarNewChat').click()`, 2000, null);
    await wait(250);
    const before = await evalJs(shellWin, `document.querySelectorAll('#grid > .card, #mosaic .card, .card').length`, 3000, 0);
    const startedAt = Date.now();
    let result = null;
    try {
      result = await Promise.race([
        shellWin.webContents.executeJavaScript(
          `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'live', query: query.question, expand: true })})`,
        ),
        wait(query.timeoutMs).then(() => ({ ok: false, error: 'query timeout' })),
      ]);
    } catch (error) {
      result = { ok: false, error: String(error && error.message || error) };
    }
    await wait(400);
    let after = { count: before, titles: [], kinds: [] };
    if (query.expectCard) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        after = await evalJs(shellWin, `(() => {
      const cards = Array.from(document.querySelectorAll('.card'));
      return {
        count: cards.length,
        titles: cards.slice(-4).map((card) => card.querySelector('.card-title, .bs-title, h2, h3')?.textContent || card.dataset.kind || card.className),
        kinds: cards.slice(-4).map((card) => card.dataset.kind || card.dataset.cardKind || card.className),
      };
    })()`, 2000, after);
        if (after.count > before) break;
        await wait(300);
      }
    }
    const cardDelta = after.count - before;
    const source = String((result && result.source) || '');
    const rest = /rest|kiwoom/i.test(source);
    const usedModel = /claude|model|selector/i.test(source);
    const painted = cardDelta > 0;
    const ok = queryVerdict(query, { result, painted, rest, usedModel });
    report.queries.push({
      id: query.id,
      question: query.question,
      elapsedMs: Date.now() - startedAt,
      result: {
        ok: result && result.ok,
        source: result && result.source,
        error: result && result.error,
      },
      cardDelta,
      cards: after,
      rest: Boolean(rest),
      ok,
    });
    report.captures.push(await captureOrSkip(shellWin, `live-full-query-${query.id}.png`));
  }

  report.forbiddenOrderCalls = orderCalls().length;
  report.windows.extra = BrowserWindow.getAllWindows().length;
  const modeOk = report.modes.every((row) => row.ok);
  report.ok = !report.boot.onboard
    && report.windows.shell
    && report.windows.orb
    && modeOk
    && report.settings.ok
    && report.queries.every((row) => row.ok)
    && report.forbiddenOrderCalls === 0
    && visibleButtons.length > 0;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log('[live-full]', JSON.stringify({
    ok: report.ok,
    modes: report.modes.map((row) => ({ view: row.view, ok: row.ok })),
    settings: report.settings.ok,
    queries: report.queries.map((row) => ({ id: row.id, ok: row.ok, source: row.result.source, cards: row.cardDelta })),
    buttons: visibleButtons.length,
    orderCalls: report.forbiddenOrderCalls,
  }, null, 2));
  app.exit(report.ok ? 0 : 1);
}

app.whenReady().then(main).catch((error) => {
  fs.mkdirSync(CAPTURES, { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({ ok: false, error: String(error && error.stack || error) }, null, 2));
  console.error('[live-full] 실패', error);
  app.exit(1);
});
