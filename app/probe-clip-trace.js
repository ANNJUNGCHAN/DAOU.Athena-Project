'use strict';

// 가로 잘림 추적 — 잘린 글자에서 표면까지 조상 상자를 하나씩 훑어 「누가 안 줄어드는가」를
// 짚는다. 전수 프로브(probe-card-api-sweep)가 「어디가 잘렸다」를 세고, 이 프로브가
// 「왜」를 본다. 일회성 진단이므로 게이트가 아니다.
//
// 실행: electron probe-clip-trace.js            (기본: 2VDA-0 최소 폭)
//       ATHENA_TRACE_BOARD=2ZHC-0 ATHENA_TRACE_WIDTH=640 electron probe-clip-trace.js

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { publicPolicies } = require('./lib/main/integrated-card-realtime');
const {
  activateBoardTab, boardInstanceId, sendBoardEnvelope, settleBoardLayout,
} = require('./lib/board-probe');
const { hydrateBoard } = require('./lib/main/board-hydrate');
const { readLocalBearerToken } = require('./lib/main/backend-launcher');

const APP = __dirname;
const ROOT = path.resolve(APP, '..');
const BOARD = process.env.ATHENA_TRACE_BOARD || '2VDA-0';
const WIDTH = Number(process.env.ATHENA_TRACE_WIDTH || 480);
const HEIGHT = Number(process.env.ATHENA_TRACE_HEIGHT || 420);
const BACKEND_BASE = process.env.ATHENA_BACKEND_BASE || 'http://127.0.0.1:8010';
const TOKEN = readLocalBearerToken(path.join(ROOT, 'backend'));
const CARD_KIND = Object.freeze({
  'CC-01': 'account', 'CC-02': 'order', 'CC-03': 'instrument',
  'CC-04': 'orderbook', 'CC-05': 'flow', 'CC-06': 'explorer',
});

const PROFILE = path.join(APP, '.probe-clip-trace-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();

function registerShellIpc() {
  const source = fs.readFileSync(path.join(APP, 'preload.js'), 'utf8');
  const block = source.split('const INVOKE_CHANNELS = new Set([')[1];
  const channels = block ? block.split(']);')[0] : null;
  if (!channels) throw new Error('preload.js에서 INVOKE_CHANNELS 블록을 못 찾았다');
  for (const channel of [...channels.matchAll(/'([^']+)'/g)].map((match) => match[1])) {
    ipcMain.handle(channel, async (_event, payload) => {
      if (channel === 'athena:canvas-board-hydrate') {
        const request = payload && typeof payload === 'object' ? payload : {};
        return hydrateBoard({
          backendBase: BACKEND_BASE,
          token: TOKEN,
          boardId: request.boardId,
          target: request.target || { stk_cd: '005930' },
          slotIds: request.slotIds,
        });
      }
      if (channel === 'athena:integrated-card-realtime-policy') return publicPolicies();
      if (channel.startsWith('athena:integrated-card-realtime-')) {
        return {
          ok: true, status: 'active', bindings: [], generation: 1, connectionGeneration: 1,
        };
      }
      if (channel === 'athena:boot-readiness:get') {
        return {
          runId: 'clip-trace', revision: 1, phase: 'ready',
          tasks: [{
            id: 'probe-readiness', label: '가로 잘림 추적', kind: 'gate',
            state: 'succeeded', attempt: 1, retryable: false, detail: '완료',
          }],
        };
      }
      if (channel === 'athena:onboarding-state') return { needed: false, step: 3 };
      if (channel.endsWith('-list') || channel.endsWith('conversations-list')) return [];
      if (channel.includes('prefs:get')) return {};
      return null;
    });
  }
}

// 잘린 글자마다 조상 사슬의 기하와 「줄지 않는 이유」가 될 인라인/계산 값을 적는다.
const TRACE = (instanceId) => `(() => {
  const root = document.querySelector(
    '#grid .card[data-integrated-instance-key="view:${instanceId}"]');
  const surface = root && root.querySelector('.board-surface');
  if (!surface) return { error: 'board surface not found' };
  const CLIP = new Set(['hidden', 'clip']);
  const surfaceRight = surface.getBoundingClientRect().left
    + surface.clientLeft + surface.clientWidth;
  const out = [];
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = String(node.nodeValue || '').trim();
    if (!text) continue;
    const owner = node.parentElement;
    if (!owner) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    if (!rects.length) continue;
    const right = Math.max(...rects.map((rect) => rect.right));
    if (right <= surfaceRight + 1) continue;
    const chain = [];
    for (let el = owner; el && el !== surface.parentElement; el = el.parentElement) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      chain.push({
        node: (el.dataset && el.dataset.node) || '',
        name: (el.dataset && el.dataset.name) || '',
        cls: String(el.className || '').trim(),
        width: Math.round(box.width),
        client: el.clientWidth,
        scroll: el.scrollWidth,
        inline_width: el.style.width || '',
        bs_width: el.style.getPropertyValue('--bs-width') || '',
        min_width: style.minWidth,
        max_width: style.maxWidth,
        flex: style.flex,
        shrink: style.flexShrink,
        display: style.display,
        direction: style.flexDirection,
        wrap: style.flexWrap,
        overflow_x: style.overflowX,
        hoisted: el.dataset ? el.dataset.bsHoisted !== undefined : false,
      });
      if (el === surface) break;
    }
    out.push({ text: text.slice(0, 24), over_right: Math.round(right - surfaceRight), chain });
    if (out.length >= 4) break;
  }
  return {
    surface_client: surface.clientWidth,
    surface_scroll: surface.scrollWidth,
    clipped: out,
  };
})()`;

async function main() {
  await app.whenReady();
  registerShellIpc();
  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: false, backgroundColor: '#EEF1F6',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, preload: path.join(APP, 'preload.js'),
    },
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^https?:/i.test(details.url) });
  });
  await win.loadFile(path.join(APP, 'shell.html'));
  win.show();
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const boot = document.getElementById('boot');
      const shell = document.getElementById('shell');
      if (boot.dataset.phase === 'complete' && boot.hidden && !shell.hidden
        && !shell.classList.contains('is-onboarding-hidden')) return resolve(true);
      if (Date.now() - started > 15000) return reject(new Error('셸 부팅 실패'));
      requestAnimationFrame(check);
    };
    check();
  })`);

  const reply = await hydrateBoard({
    backendBase: BACKEND_BASE, token: TOKEN, boardId: BOARD, target: { stk_cd: '005930' },
  });
  if (!reply.ok) throw new Error(`board-hydrate ${reply.status}: ${reply.error || ''}`);
  const contract = reply.surface_contract;
  const surface = {
    boardId: BOARD,
    instanceId: boardInstanceId(BOARD),
    ordinal: 1,
    cardTitle: `가로 잘림 추적 · ${BOARD}`,
    operationRef: 'base:board-surface',
    realtimeBindings: [],
    contract: { ...contract, card_kind: CARD_KIND[contract.card_id] },
  };
  // 전수 프로브와 같은 순서를 흉내낸다: 넓게 마운트한 뒤 좁힌다. 좁아진 뒤에 걸리는
  // 처방(relaxOverflowRows)이 그 경로에서도 도는지 보려는 것이다.
  const CHAIN = (process.env.ATHENA_TRACE_CHAIN || '1920x1080,960x1080,640x540,480x420')
    .split(',').map((step) => step.split('x').map(Number));
  win.setContentSize(CHAIN[0][0], CHAIN[0][1]);
  await sendBoardEnvelope(win, surface);
  for (const [width, height] of CHAIN) {
    win.setContentSize(width, height);
    await activateBoardTab(win, surface.instanceId);
    await settleBoardLayout(win, surface.instanceId);
    const step = await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector(
        '#grid .card[data-integrated-instance-key="view:${surface.instanceId}"]');
      const box = root && root.querySelector('.board-surface');
      return box ? {
        relaxed: box.dataset.bsRelaxedRows || null,
        marks: box.querySelectorAll('[data-bs-wrap-row="true"]').length,
        client: box.clientWidth, scroll: box.scrollWidth,
      } : null;
    })()`);
    console.log(`step ${width}x${height}:`, JSON.stringify(step));
  }
  const relaxed = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(
      '#grid .card[data-integrated-instance-key="view:${surface.instanceId}"]');
    const box = root && root.querySelector('.board-surface');
    return box ? {
      relaxed: box.dataset.bsRelaxedRows || null,
      marks: box.querySelectorAll('[data-bs-wrap-row="true"]').length,
      client: box.clientWidth, scroll: box.scrollWidth,
    } : null;
  })()`);
  console.log('relax:', JSON.stringify(relaxed));
  const trace = await win.webContents.executeJavaScript(TRACE(surface.instanceId));
  console.log(JSON.stringify(trace, null, 1));
  app.exit(0);
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
