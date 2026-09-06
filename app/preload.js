const { contextBridge, ipcRenderer, webFrame } = require('electron');

const INVOKE_CHANNELS = new Set([
  'athena__render_canvas',
  'athena:boot-readiness:get',
  'athena:onboarding-state',
  'athena:onboarding-advance',
  'athena:settings:prefs:get',
  'athena:settings:prefs:set',
  'athena:model-get',
  'athena:model-set',
  'athena:cli-list',
  'athena:cli-login',
  'athena:cli-set-active',
  'athena:cli-remove',
  // 키우미 메뉴(2026-08-27, Paper 보드 45) — 파일/폴더 선택 대화상자. 경로만 온다.
  'athena:pick-files',
  // 이력 사이드바(리프 1.2.2) — 실데이터 목록·선택 상태.
  'athena:conversations-list',
  'athena:conversations-set-active',
  // 과거 대화 열기(2026-09-02) — 읽기 전용 조회다, 쓰기가 아니다.
  'athena:conversation-messages',
  'athena:conversations-new',
  'athena:session-load',
  'athena:session-replay-cards',
  'athena:account-list',
  'athena:account-register',
  'athena:account-set-active',
  'athena:account-remove',
  'athena:order-api-set',
  'athena:auth-token-status',
  'athena:auth-token-refresh',
  'athena:auth-token-revoke',
  // 플러그인은 읽기 채널만 렌더러에 연다 — 변이는 athena:plugin-approve 하나로
  // 모인다(lib/plugin-proposal-boundary.test.js가 이 경계를 잰다).
  'athena:mcp-list',
  'athena:mcp-probe',
  'athena:mcp-audit',
  // 플러그인 승인 카드 — 실행은 사람이 이 둘 중 하나를 부를 때만 일어난다.
  'athena:plugin-approve',
  'athena:plugin-reject',
  // 대기 중인 제안과 현재 판번호 — 창 복원·모드 재진입 때만 부르는 조회다.
  'athena:plugin-pending',
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
  // 상세 패널 일시중지·재개(6.5단계) — confirm/cancel과 같은 사람 클릭 전용 경로다.
  'athena:routine-pause',
  'athena:routine-resume',
  // 실행 이력 드릴인(10단계) — 6단계 GET /{id}/runs.
  'athena:routine-runs',
  // 설정 편집·초안 등록(Step 6) — POST /{id}/update · POST /routines/draft.
  'athena:routine-update',
  'athena:routine-draft',
  // 상세·소스 카탈로그(Step 6) — 설정 폼 프리필과 새 작업 시트가 1회씩 부른다.
  'athena:routine-detail',
  'athena:routine-source-catalog',
  // 감시 코드 검사·착지(Step 6) — POST /routines/watch/check · POST /routines/watch/code.
  'athena:routine-watch-check',
  'athena:routine-watch-code',
  // 알림 방 읽음 처리(7단계, F3-FE) — 6단계 POST /{id}/ack.
  'athena:routine-ack',
  // 발화 열람·응답 계측(F-stage5b-FE) — POST /{id}/engagement.
  'athena:routine-engagement',
  // 말걸기 가드 설정 REST(F-stage9) — GET/POST /api/v1/nudge-guard.
  'athena:nudge-guard-get',
  'athena:nudge-guard-set',
  'athena:order-execute',
  // 6종 통합 카드 실시간 lease. 주문 mutation과 분리된 REG/REMOVE 제어 경로다.
  'athena:integrated-card-realtime-policy',
  'athena:integrated-card-realtime-mount',
  'athena:integrated-card-realtime-update',
  'athena:integrated-card-realtime-unmount',
  'athena:integrated-card-realtime-release-all',
  'athena:integrated-card-realtime-status',
  'athena:integrated-card-realtime-command',
  // 보드 슬롯 하이드레이션 — 봉투가 못 채운 슬롯만 채운다. 읽기 전용이다.
  'athena:canvas-board-hydrate',
  // 채팅→그래프 파이프라인 단계 5(.omc/plans/plan-chat-graph-pipeline.md §2(e)/(f))
  // — 대화 모드 HISTORY_COMMAND 조회, 설정 모드 "성향・이력" 상태·전체 삭제.
  'athena:brain-status',
  'athena:brain-history-query',
  'athena:history-export',
  'athena:brain-reset',
  // 그래프 모드(leaf 8 / W2-3) — 군집 지도 조회. 읽기 전용이다.
  'athena:brain-cluster-map',
  // 그래프 모드 요약 뷰(보드 07) — 성향 신호 상위 N. 읽기 전용이다.
  'athena:brain-profile-summary',
  // 설정 성향·이력 카드(보드 32) "보관 중" 건수 — 내보내기·전체 삭제와 같은 저장소를 센다.
  'athena:brain-conversations-count',
  // 캔버스 빈 상태(보드 05) "확인이 필요한 것 N건" 힌트 — 되물을 것들. 읽기 전용이다.
  'athena:brain-suggested-questions',
  // 그래프 모드 요약 뷰 "숨은 연관"(스텝7) — 군집 경계를 넘는 연결. 읽기 전용이다.
  'athena:brain-surprising-connections',
  // 사람의 직접 취소(2026-09-03) — 확정 카드의 '적용'이 부른다. **쓰기다.**
  // 모델은 이 채널에 닿지 않는다: athena_brain에는 쓰기 액션이 없고 이 백엔드
  // 입구는 x-athena-llm-exposed:false다. 부르는 것은 사람이 누른 카드뿐이다.
  'athena:brain-retract-relation',
  // 되물을 것들 카드의 '맞다'. 위와 같은 이유로 **쓰기**이고 모델은 닿지 않는다.
  'athena:brain-confirm-relation',
  // 확정 카드의 op=add|change. 위 둘과 같은 이유로 **쓰기**이고 모델은 닿지 않는다.
  'athena:brain-manual-relation',
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
  // 놓친 예약 캐치업(R1, 5단계) — 확인은 main이 ① catchup-fire(ledger 기록)
  // ② 브리핑 실행 순서를 보장한다. 건너뛰기는 백엔드 API를 부르지 않는다.
  'athena:routine-missed-confirm',
  'athena:routine-missed-skip',
  // 백테스트 모드(P4, backtest-mode-plan.md §8.2) — 프리셋 조회부터 결과 폴링까지.
  // backfill(수집)만 사람 클릭 전용 경로다 — 쿼터를 태우는 백필은 모델 툴에 없다
  // (routine-confirm/cancel과 같은 원칙).
  'athena:backtest-presets',
  'athena:backtest-plan',
  'athena:backtest-run',
  'athena:backtest-status',
  'athena:backtest-result',
  'athena:backtest-trades',
  'athena:backtest-runs',
  'athena:backtest-backfill',
  // 2026-09-01 전수 파리티 — Paper 보드 02·05·06·07·08·09가 쓰는 채널.
  // activate·deployment-create·deployment-stop도 사람 클릭 전용 경로다(모델 툴에 없다).
  'athena:backtest-validate',
  'athena:backtest-coverage',
  'athena:backtest-flow',
  // 흐름 지도(2026-09-03) — 지도는 조회 전용이고 codegen은 저장하지 않는다.
  'athena:backtest-map',
  'athena:backtest-codegen',
  // 새 기법 만들기(보드 20·21) — 코드를 노드로 자르는 길과 자동 검사 3개.
  'athena:backtest-technique-nodes',
  'athena:backtest-technique-check',
  // 시각 설계 ↔ 코드 왕복(2026-09-03) — question·patch는 수정안을 만들 뿐이고,
  // save는 비활성 초안 버전 하나를 남길 뿐이다(활성화·실행은 여전히 다른 버튼).
  'athena:backtest-visual-registry',
  'athena:backtest-visual-validate',
  'athena:backtest-visual-compile',
  'athena:backtest-visual-question',
  'athena:backtest-visual-patch',
  'athena:backtest-visual-from-spec',
  'athena:backtest-visual-save',
  'athena:backtest-diagnose',
  'athena:backtest-optimize',
  'athena:backtest-optimize-plan',
  'athena:backtest-strategies',
  'athena:backtest-strategy-create',
  'athena:backtest-versions',
  'athena:backtest-version-add',
  'athena:backtest-activate',
  'athena:backtest-version-diff',
  'athena:backtest-version-detail',
  'athena:backtest-deployments',
  'athena:backtest-deployment-create',
  'athena:backtest-deployment-stop',
  'athena:backtest-signals',
  'athena:backtest-evaluate',
  // 2026-09-02 사용자 전략 등록부 — 내 폴더의 .py 하나가 프리셋과 같은 자리에 선다.
  // 등록·해제는 사람이 누르는 버튼이고, 목록은 설계 폼이 매번 다시 읽는다.
  'athena:backtest-user-strategies',
  'athena:backtest-user-strategy-register',
  'athena:backtest-user-strategy-unregister',
  // 프로젝트 파일 IDE(2026-09-02, 코드 탭) — 내 컴퓨터의 폴더 하나를 점유한다.
  // open-dialog만 main 전용이다(네이티브 폴더 선택) — 나머지는 백엔드 라우트 프록시다.
  'athena:project-list',
  'athena:project-create',
  'athena:project-open-dialog',
  'athena:project-add',
  'athena:project-pin',
  'athena:project-update',
  'athena:project-reveal',
  'athena:project-remove',
  'athena:project-open',
  'athena:project-tree',
  'athena:project-file-read',
  'athena:project-file-write',
  'athena:project-file-create',
  'athena:project-file-rename',
  'athena:project-file-delete',
  // 프로젝트 가상환경(2026-09-02) — 폴더 안의 .venv 하나. 만드는 것은 202+job_id라
  // 진행은 기존 athena:backtest-status가 보여준다(잡 표면을 둘로 만들지 않는다).
  'athena:project-env-get',
  'athena:project-env-create',
]);

const SEND_CHANNELS = new Set([
  // 세션 저장 보고(35~43번 보드) — 렌더러 DOM은 투영이고 쓰기 주체는 main이다.
  'athena:session-cards',
  'athena:session-workspace',
  'athena:session-viewport',
  'athena:provider-paint-ack',
  'athena:minimize-windows',
  'athena:close-windows',
  'athena:zoom',
  // 창 최대화 토글(2026-08-24 리프 1.2.1) — 옛 athena:set-chat-height의 자리.
  // 대화 창 높이 토글이 OS 창 최대화로 바뀌면서 상태 소유자가 렌더러에서 OS로
  // 넘어갔고, 그래서 렌더러는 요청만 보내고 판정은 main이 한다.
  'athena:toggle-maximize',
  'athena:window-chrome-geometry',
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
  'athena:boot-complete',
  'athena:shell-handoff-ready',
  'athena:app-notification-shown',
  // 카드를 그린 뒤 보내는 단방향 신호 — 모델 경로와 GUI 경로 공통의 대기 등록
  // 지점이다. 응답을 기다리지 않으므로 카드 렌더를 막지 않는다.
  'athena:plugin-noted',
]);

const ON_CHANNELS = new Set([
  'athena:init',
  // 프레임리스 창의 최대화 표시는 렌더러 기하 추정이 아니라 BrowserWindow의
  // 권위 있는 isMaximized() 상태만 소비한다.
  'athena:window-state',
  'athena:boot-readiness',
  'athena:app-notification',
  // 8XX  \ � ��(39� ��)  �t� �X �<�.
  'athena:session-run-state',
  'athena:add-canvas',
  'athena:add-canvas-live',
  'athena:add-rest-canvas',
  'athena:add-rest-receipt',
  'athena:rest-retry-available',
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
  // Selector의 guarded order 결과 — 실행이 아니라 기존 주문 확인 티켓의
  // 프리필만 연다. 실제 집행은 athena:order-execute 사용자 클릭 경로뿐이다.
  'athena:selector-order-draft',
  // 루틴 WS 연결 상태(9단계, 알람 센터 "● WS 연결됨") — RoutineFeed의
  // onStatus 그대로. {state: 'connected'|'disconnected'|'unsupported'}.
  'athena:routine-feed-status',
  // 차트 실시간 체결(키움 REAL 0B) — main이 파싱만 해서 넘긴다. 진행봉으로
  // 접는 일은 마지막 봉을 들고 있는 렌더러가 한다(lib/chart-tick-fold.js).
  'athena:chart-ticks',
  // 호가잔량 실시간(키움 REAL 0D, task #25) — main이 파싱만, 래더 갱신은
  // card-kind-호가.js의 applyLiveTick이 한다.
  'athena:orderbook-ticks',
  // 6종 통합 카드 상태와 generation이 붙은 REAL rows. 렌더러는 자신의 최신
  // lease generation과 일치하는 이벤트만 카드 section에 병합한다.
  'athena:integrated-card-realtime-state',
  'athena:integrated-card-realtime-ticks',
  // 하위 에이전트 생애주기(task #32) — Agent(Task) system 이벤트를 그대로
  // 릴레이한다. chat.js의 결과물·출처·하위 에이전트 3단 도크가 소비한다.
  'athena:live-subagent-step',
  // 채팅 저장 실패 신호(2026-08-19, plan-chat-graph-pipeline.md §2(g)) —
  // history-sink의 POST가 실패하면 main이 {messageId, role}만 보낸다(본문 없음).
  'athena:history-save-failed',
  // 부팅/1시간 주기 대화 그래프 갱신 완료 — 현재 보이는 요약·지도를 실데이터로
  // 다시 읽는다. payload에는 본문 없이 revision/개수/trigger만 들어온다.
  'athena:brain-graph-updated',
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
  // 말걸기 가드 확인 카드(F-stage9) — athena_nudge_guard propose 결과, 비영속.
  'athena:nudge-guard-proposed',
  // 루틴 제어 제안 카드(Step 6) — athena_routine propose 결과, 비영속.
  // 확정은 사람이 카드의 칩을 눌렀을 때 렌더러가 직접 REST를 부른다.
  'athena:routine-proposed',
  // 백테스트 채팅 액션 — athena_backtest의 propose_spec·propose_code·navigate·
  // propose_optimize 결과 {kind, ...}, 비영속. 셸에서만 구독한다.
  'athena:backtest-chat-action',
  // 플러그인 제안 카드 — athena_plugin 결과, 비영속. 셸에서만 구독한다.
  'athena:plugin-proposed',
  // 질의 왕복이 도는 동안 셸·오브 입력을 함께 잠그는 신호 — {busy: boolean}.
  'athena:live-query-state',
  // 오브에서 오간 턴을 셸의 대화 이력에도 늦게 채워 넣는다(셸이 숨어 있는 동안
  // chat.js가 그릴 수 없었으므로) — {query, result}. 셸에서만 구독한다.
  'athena:orb-turn-committed',
  // 캔버스 엔벌로프 오브 릴레이(board-33③④ 선행) — origin:'orb' 질의의
  // render_canvas 결과만 main이 여기로도 relay한다(classifyCanvasBlock의
  // status/envelope 그대로). 오브의 표/차트 축약 카드 렌더러가 구독한다.
  'athena:orb-canvas-result',
  // 그래프 채팅 액션(2026-09-03) — athena_graph_view의 navigate·select·filter·fit·
  // propose_edit 결과 {kind, ...}, 비영속. 백테스트 채널과 같은 성질이라 같은 자리에
  // 둔다. propose_edit은 확정 카드를 띄우는 것이 전부다 — 그래프 쓰기가 아니다.
  'athena:graph-chat-action',
  // ---------- 예약 자동 브리핑(R1, 4단계) — 사용자 턴 채널과 분리 ----------
  // 브리핑 텍스트 조각 — {text}. 사용자 턴(athena:live-text-delta)과 별개 채널.
  'athena:briefing-text-delta',
  // 브리핑 툴 진행 단계 — {id, label, done, elapsedMs}(live-tool-step과 동형).
  'athena:briefing-tool-step',
  // 브리핑 진행 배지 전용 신호 — {busy}. 입력 잠금(setLocked)에는 절대 쓰지
  // 않는다(MAJOR 2 — 브리핑이 셸 입력을 잠그면 안 된다).
  'athena:briefing-query-state',
  // 놓친 예약(R1, 5단계) — 기동 시 main이 감지한 놓친 예약 목록. {routines: [뷰...]}.
  'athena:routine-missed',
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
