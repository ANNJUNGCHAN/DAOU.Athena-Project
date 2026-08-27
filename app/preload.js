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
  // 키우미 메뉴(2026-08-27, Paper 보드 45) — 파일/폴더 선택 대화상자. 경로만 온다.
  'athena:pick-files',
  // 이력 사이드바(리프 1.2.2) — 실데이터 목록·선택 상태.
  'athena:conversations-list',
  'athena:conversations-set-active',
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
  // 그래프 모드 요약 뷰(보드 07) — 성향 신호 상위 N. 읽기 전용이다.
  'athena:brain-profile-summary',
  // 캔버스 빈 상태(보드 05) "확인이 필요한 것 N건" 힌트 — 되물을 것들. 읽기 전용이다.
  'athena:brain-suggested-questions',
  // 그래프 모드 요약 뷰 "숨은 연관"(스텝7) — 군집 경계를 넘는 연결. 읽기 전용이다.
  'athena:brain-surprising-connections',
  // 엔티티 타임라인(WP-C 배선, WP-G 소비) — 선택 패널 §10-4 "최근 변화"가
  // 부른다(controller.js fetchEntityTimeline). 읽기 전용이다.
  'athena:brain-entity-timeline',
  // exposeToModel 실반영(WP-I I4) — 토글 값을 main prefs에 영속하고 backend
  // 게이트(POST /settings/expose-to-model)에 즉시 민다. 쓰기지만 대상은 로컬
  // 게이트 상태 하나뿐이다.
  'athena:settings:expose-to-model:set',
  // 오브 대화 모드(2026-08-26 board-33) — 셸의 커맨드바가 부르는 runLiveQuery와
  // 완전히 같은 파이프라인을 오브에서 부르는 다리. orb.js가 셸 숨김일 때만 쓴다
  // (게이트는 athena:shell-visibility, scripts/gates/check-orb.mjs가 잰다).
  'athena:orb-chat-submit',
]);

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
  // 카드 소멸 시 실시간 구독 참조를 서버까지 해제한다(panelId가 없는 카드종 —
  // 표/시세 등. AITS 차트는 위 athena:chart-panel-destroyed가 겸한다).
  'athena:realtime-release',
  // 호가잔량(0D) — 0B와 달리 카드가 뜰 때 명시적으로 acquire하고, 닫힐 때
  // release한다(task #25, canvas.js wireOrderbookRealtime).
  'athena:orderbook-realtime-acquire',
  'athena:orderbook-realtime-release',
  // 알림 오브 창(2026-08-24 리프 1.3.1) — 오브가 보낼 수 있는 것은 이 둘뿐이다.
  //   athena:orb-toggle     접힘/펼침 요청. 창 크기 변경은 main이 한다(기하는
  //                         lib/main/orb-window.js).
  //   athena:orb-open-shell "더보기"·"대화창으로 가기" — 셸을 앞으로 가져온다
  //                         (event가 있으면 대표 카드도 캔버스에 쌓는다).
  // 2026-08-26 board-33 — "단일 입력 원칙"이 "셸이 보이는 동안은 오브에 입력이
  // 없다"로 바뀌었다(board-33/34, tree-34-deep.raw "상태는 둘뿐이다"). 오브는
  // 이제 athena:orb-chat-submit(INVOKE_CHANNELS)으로 질의를 낼 수 있지만, 그건
  // 셸의 커맨드바와 같은 runLiveQuery를 부르는 것뿐이다. athena:routine-confirm/
  // cancel은 여전히 이 다리에 있어도 오브가 부르지 않는다(감시 승인·취소는
  // 여전히 오브의 액션이 아니다, scripts/gates/check-orb.mjs). athena:order-execute는
  // 2026-08-27 CP2 사용자 승인으로 미니 주문 티켓(board-33⑤, orb.js
  // renderOrbTicket)의 실행 버튼 하나에 한해 오브도 부른다 — 새 채널을
  // 열지 않았다(같은 다리, 같은 IPC).
  'athena:orb-toggle',
  'athena:orb-open-shell',
  // 2026-08-26 board-32 — 포인터 드래그(오브가 매 이동을 main에 실어 보낸다)와
  // 셸→오브 실신호(입력 포커스·질의 진행·턴 완료). 셸 렌더러(chat.js)가
  // orb-signal을 보내고, 오브 렌더러(orb.js)가 drag-move를 보낸다 — 같은
  // preload가 두 창에 다 실리므로 한 Set에 같이 둔다.
  'athena:orb-drag-move',
  'athena:orb-signal',
]);

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
  // 답변 텍스트 조각(2026-08-26 S2) — main이 claude -p의 text_delta를 그대로
  // 릴레이한다. chat.js가 진행 중인 채팅 버블에 이어붙인다.
  'athena:live-text-delta',
  // 추론 조각(2026-08-26) — thinking_delta 릴레이. 미리보기 전용 — chat.js가
  // 답변 첫 조각이나 턴 종료에서 지우고 절대 이력에 저장하지 않는다.
  'athena:live-thinking-delta',
  'athena:auth-token-changed',
  'athena:cli-changed',
  // 루틴 알림(능동 에이전트 P2) — main의 RoutineFeed가 백엔드 WS에서 받은
  // 발화·만료·복원실패 이벤트를 능동 턴으로 전달한다.
  'athena:routine-event',
  // 차트 실시간 체결(키움 REAL 0B) — main이 파싱만 해서 넘긴다. 진행봉으로
  // 접는 일은 마지막 봉을 들고 있는 렌더러가 한다(lib/chart-tick-fold.js).
  'athena:chart-ticks',
  // 호가잔량 실시간(키움 REAL 0D, task #25) — main이 파싱만, 래더 갱신은
  // card-kind-호가.js의 applyLiveTick이 한다.
  'athena:orderbook-ticks',
  // 하위 에이전트 생애주기(task #32) — Agent(Task) system 이벤트를 그대로
  // 릴레이한다. chat.js의 결과물·출처·하위 에이전트 3단 도크가 소비한다.
  'athena:live-subagent-step',
  // 채팅 저장 실패 신호(2026-08-19, plan-chat-graph-pipeline.md §2(g)) —
  // history-sink의 POST가 실패하면 main이 {messageId, role}만 보낸다(본문 없음).
  'athena:history-save-failed',
  // 오브 접힘/펼침 확정 통보(2026-08-24 리프 1.3.1) — main이 창 크기를 실제로
  // 바꾼 뒤에 보낸다. 렌더러가 먼저 펼치면 창보다 큰 패널이 한 프레임 잘린다.
  'athena:orb-state',
  // 오브 커서 추적(2026-08-25) — main이 폴링한 커서-오브중심 상대좌표
  // {dx, dy, dist}를 밀어준다. 커서가 사라지거나 폴링이 멈추면 null.
  'athena:orb-cursor',
  // 셸→오브 실신호 릴레이(2026-08-26 board-32) — main이 athena:orb-signal
  // 그대로 되쏜다. {signal: 'listen'|'think'|'done', active}.
  'athena:orb-signal',
  // ---------- 오브 대화 모드(2026-08-26 board-33/34) ----------
  // 셸 표시 여부 — 오브의 대화 모드 게이트 그 자체다. {hidden: boolean}.
  'athena:shell-visibility',
  // 툴 호출 진행 단계 — {id, label, done, elapsedMs}. 라벨은 한국어 고정 문구뿐,
  // 원문 TR/툴 id는 절대 안 실린다(sendLiveToolStep 주석 참고).
  'athena:live-tool-step',
  // 질의 왕복이 도는 동안 셸·오브 입력을 함께 잠그는 신호 — {busy: boolean}.
  'athena:live-query-state',
  // 오브에서 오간 턴을 셸의 대화 이력에도 늦게 채워 넣는다(셸이 숨어 있는 동안
  // chat.js가 그릴 수 없었으므로) — {query, result}. 셸에서만 구독한다.
  'athena:orb-turn-committed',
  // 캔버스 엔벌로프 오브 릴레이(board-33③④ 선행) — origin:'orb' 질의의
  // render_canvas 결과만 main이 여기로도 relay한다(classifyCanvasBlock의
  // status/envelope 그대로). 오브의 표/차트 축약 카드 렌더러가 구독한다.
  'athena:orb-canvas-result',
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
