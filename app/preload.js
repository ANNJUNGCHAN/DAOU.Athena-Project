// contextBridge 다리 — 2026-08-18 렌더러 격리 전환(클로드 데스크탑 방식).
// contextIsolation:true + nodeIntegration:false 아래서 두 창(chatWin/canvasWin)이
// 공유하는 유일한 preload다. 여기 나열된 채널만 통과한다 — 범용 패스스루
// (channel을 그대로 받아 ipcRenderer.invoke(channel, ...)에 넘기는 식) 금지.
// 실측된 IPC 전수 목록은 main.js의 ipcMain.handle/on 등록부와 1:1로 맞춰뒀다.
// athena:load-fixture는 이 전환에서 새로 생긴 채널이다 — lib/mockdata.js가
// 렌더러에서 fs로 spike/captures를 직접 읽던 것을 막고 main으로 옮겼다
// (CLAUDE.md §6 "렌더러 Node API 직접 접근 0건" 원칙).
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const INVOKE_CHANNELS = new Set([
  'athena__render_canvas',
  'athena:onboarding-state',
  'athena:onboarding-advance',
  'athena:settings:prefs:get',
  'athena:settings:prefs:set',
  'athena:cli-list',
  'athena:cli-login',
  'athena:cli-set-active',
  'athena:account-list',
  'athena:account-register',
  'athena:account-set-active',
  'athena:account-remove',
  'athena:order-api-set',
  'athena:auth-token-status',
  'athena:auth-token-refresh',
  'athena:auth-token-revoke',
  'athena:mcp-list',
  'athena:mcp-stage-snippet',
  'athena:mcp-register',
  'athena:mcp-approve',
  'athena:mcp-probe',
  'athena:mcp-allow-tool',
  'athena:mcp-remove',
  'athena:load-fixture',
]);

const SEND_CHANNELS = new Set([
  'athena:window-drag',
  'athena:minimize-windows',
  'athena:close-windows',
  'athena:zoom',
  'athena:set-chat-height',
  'athena:collapse-canvas',
  'athena:highlight-canvas',
  'athena:abort-live-query',
  'primed',
  'animation-done',
]);

const ON_CHANNELS = new Set([
  'athena:init',
  'athena:glass-separation',
  'prime-clip',
  'run-animation',
  'athena:add-canvas',
  'athena:clear-canvases',
  'athena:add-canvas-live',
  'athena:highlight-canvas',
  'athena:prefs-changed',
  'athena:zoom-changed',
  'athena:live-canvas-added',
  'athena:auth-token-changed',
  'athena:cli-changed',
]);

contextBridge.exposeInMainWorld('athena', {
  invoke(channel, payload) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`athena bridge: 허용되지 않은 invoke 채널 — ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  send(channel, payload) {
    if (!SEND_CHANNELS.has(channel)) {
      throw new Error(`athena bridge: 허용되지 않은 send 채널 — ${channel}`);
    }
    ipcRenderer.send(channel, payload);
  },
  // event 객체(IpcRendererEvent)는 WebContents 참조를 물고 있어 contextBridge의
  // 구조적 클론 경계를 못 넘는다 — payload만 넘기고 event는 preload 안에서 버린다.
  // 반환값은 구독 해제 함수다(removeListener를 별도로 노출하지 않는다).
  on(channel, callback) {
    if (!ON_CHANNELS.has(channel)) {
      throw new Error(`athena bridge: 허용되지 않은 on 채널 — ${channel}`);
    }
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  getZoomFactor() {
    return webFrame.getZoomFactor();
  },
});
