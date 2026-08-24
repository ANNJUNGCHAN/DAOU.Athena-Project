// contextBridge 다리 — 2026-08-18 렌더러 격리 전환(클로드 데스크탑 방식).
// contextIsolation:true + nodeIntegration:false 아래서 셸 창이 쓰는 유일한
// preload다(2026-08-24 리프 1.2.1 전에는 두 창이 공유했다. 오브 창(1.3.1)이
// 붙으면 다시 공유한다). 여기 나열된 채널만 통과한다 — 범용 패스스루
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
  'athena:model-get',
  'athena:model-set',
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
  'athena:reload-chart-panel',
  // 루틴(능동 에이전트 P2) — confirm/cancel은 사람 클릭 전용 경로다.
  'athena:routines-list',
  'athena:routine-confirm',
  'athena:routine-cancel',
  'athena:order-execute',
  // 채팅→그래프 파이프라인 단계 5(.omc/plans/plan-chat-graph-pipeline.md §2(e)/(f))
  // — 대화 모드 HISTORY_COMMAND 조회, 설정 모드 "성향・이력" 상태·전체 삭제.
  'athena:brain-status',
  'athena:brain-history-query',
  'athena:brain-reset',
]);

// 2026-08-24 리프 1.2.1에서 사라진 send 채널 4건 — 창 모델과 함께 죽었다.
//   athena:set-chat-height  대화 창 높이 자동 성장(창이 아니라 영역이 됐다)
//   athena:collapse-canvas  캔버스 창 수축(닫을 창이 없다)
//   primed / animation-done 확장 애니메이션 왕복 ack(애니메이션이 없다)
const SEND_CHANNELS = new Set([
  'athena:minimize-windows',
  'athena:close-windows',
  'athena:zoom',
  // 창 최대화 토글(2026-08-24 리프 1.2.1) — 옛 athena:set-chat-height의 자리.
  // 대화 창 높이 토글이 OS 창 최대화로 바뀌면서 상태 소유자가 렌더러에서 OS로
  // 넘어갔고, 그래서 렌더러는 요청만 보내고 판정은 main이 한다.
  'athena:toggle-maximize',
  'athena:highlight-canvas',
  'athena:abort-live-query',
  'athena:place-windows',
  'athena:rest-canvas-painted',
  'athena:rest-receipt-painted',
  'athena:chart-panel-destroyed',
]);

// 2026-08-24 리프 1.2.1에서 사라진 on 채널 4건:
//   prime-clip / run-animation  확장 애니메이션 구동(애니메이션이 없다)
//   athena:window-key           Win+↑/↓의 렌더러 위임(main이 OS 최대화로 직접 처리)
//   athena:manual-resize        OS 리사이즈 수용 통보(채팅 높이 상태가 사라졌다)
const ON_CHANNELS = new Set([
  'athena:init',
  'athena:glass-separation',
  'athena:add-canvas',
  'athena:clear-canvases',
  'athena:add-canvas-live',
  'athena:add-rest-canvas',
  'athena:add-rest-receipt',
  'athena:highlight-canvas',
  'athena:prefs-changed',
  'athena:model-changed',
  'athena:zoom-changed',
  'athena:live-canvas-added',
  'athena:auth-token-changed',
  'athena:cli-changed',
  // 루틴 알림(능동 에이전트 P2) — main의 RoutineFeed가 백엔드 WS에서 받은
  // 발화·만료·복원실패 이벤트를 능동 턴으로 전달한다.
  'athena:routine-event',
  // 채팅 저장 실패 신호(2026-08-19, plan-chat-graph-pipeline.md §2(g)) —
  // history-sink의 POST가 실패하면 main이 {messageId, role}만 보낸다(본문 없음).
  'athena:history-save-failed',
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
