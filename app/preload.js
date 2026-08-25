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
  // 과거 봉 덧붙이기 — 좌측 끝에 닿으면 렌더러가 부른다(화면 교체 아님).
  'athena:chart-history-page',
  // 수급 시계열 — 하단 지표를 켤 때만 부른다.
  'athena:chart-series',
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
  // 그래프 모드(leaf 8 / W2-3) — 군집 지도 조회. 읽기 전용이다.
  'athena:brain-cluster-map',
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
  // 알림 오브 창(2026-08-24 리프 1.3.1) — 오브가 보낼 수 있는 것은 이 둘뿐이다.
  //   athena:orb-toggle     접힘/펼침 요청. 창 크기 변경은 main이 한다(기하는
  //                         lib/main/orb-window.js).
  //   athena:orb-open-shell "더보기" — 셸을 앞으로 가져오고 대표 카드를 캔버스에 쌓는다.
  // 오브에는 실행 버튼도 입력창도 없다(확정 결정 3 · 단일 입력 원칙) — 그래서
  // athena__render_canvas·athena:order-execute·athena:routine-confirm은
  // 이 다리에 있어도 오브 렌더러가 부르지 않는다(scripts/gates/check-orb.mjs가 잰다).
  'athena:orb-toggle',
  'athena:orb-open-shell',
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
  // 차트 실시간 체결(키움 REAL 0B) — main이 파싱만 해서 넘긴다. 진행봉으로
  // 접는 일은 마지막 봉을 들고 있는 렌더러가 한다(lib/chart-tick-fold.js).
  'athena:chart-ticks',
  // 채팅 저장 실패 신호(2026-08-19, plan-chat-graph-pipeline.md §2(g)) —
  // history-sink의 POST가 실패하면 main이 {messageId, role}만 보낸다(본문 없음).
  'athena:history-save-failed',
  // 오브 접힘/펼침 확정 통보(2026-08-24 리프 1.3.1) — main이 창 크기를 실제로
  // 바꾼 뒤에 보낸다. 렌더러가 먼저 펼치면 창보다 큰 패널이 한 프레임 잘린다.
  'athena:orb-state',
  // 오브 커서 추적(2026-08-25) — main이 폴링한 커서-오브중심 상대좌표
  // {dx, dy, dist}를 밀어준다. 커서가 사라지거나 폴링이 멈추면 null.
  'athena:orb-cursor',
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
