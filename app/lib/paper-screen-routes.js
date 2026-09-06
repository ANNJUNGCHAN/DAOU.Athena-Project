'use strict';

// Paper 화면계 보드를 실앱 도달 절차 + 대조 계약으로 잇는다(설계서 §4.1~§4.3).
//
// 매니페스트 role==="screen" 103장이 결국 전부 여기 있어야 한다. 없는 보드는 미구현 실패다 —
// 「도달 절차가 없는 보드는 실패한다」가 게이트 2의 핵심이라, 표가 곧 남은 작업 목록이 된다.
// 지금은 58장(부팅 5 + 온보딩 3 + 인증 3 + 에이전트 4 + 알림 파생 방·코드 알람 3 + 화면 4
// + 계좌 등록 3상태·주문 5 + 셸·그래프 2 + 그래프 5 + 대화·계정 2 + 모드·빈 화면 2
// + 창·대화 턴·탭 3 + 사이드바 4 + 플러그인 9 + 키우미 4)이고,
// 래칫(§4.5)이 잠근 뒤 저작이 이어진다.
//
// ── reach 어휘는 닫혀 있다
// 임의 JS를 표에 심으면 표가 곧 프로브가 되어 유지가 안 된다. STEP_KINDS만 허용하고,
// 탈출구인 `eval`은 `why`를 강제한다(§4.1). 프로브(probe-paper-screens.js)는 이 어휘만 실행한다.
//
// ── 판정은 「가시 텍스트」다 — 러너보다 이 표가 먼저 정한다
// phrases도 structure도 `root` 아래에서 **hidden 조상이 없는** 것만 보고 잰다
// (innerText 의미론 — hidden 서브트리와 display:none을 뺀다). textContent로 재면
// 이 표는 재려던 것을 못 잰다: agent-canvas는 뷰 넷을 마운트 때 전부 만들어 두고
// hidden만 토글하므로(agent-canvas.js:560 alarmLiveBody, :744 historyBody,
// :1151 proactiveBody, 토글은 :2020 setActiveView뿐) ARM-0·BV0-0·B57-0의 문구가
// 늘 동시에 DOM에 있어 서로를 구분하지 못하고, B57-0의 드릴인 절차는 판정에 아무
// 영향을 못 준다 — 도달 절차가 있으나 마나인 공허 통과가 §4.2가 경계하는 그것이다.
// 따름 하나: 텍스트로 안 그려지는 것은 문구가 못 된다. <input>의 placeholder가
// 그렇다(settings-cards.js:1101) — 원장에 있어도 라우트에는 못 쓴다.
//
// ── reach 는 그 가시 상태를 실제로 만들어야 한다
// 문구가 앱 소스에 리터럴로 있는 것은 필요조건일 뿐이다. 조건부 렌더는 fixture로
// 결정론을 만들고(계좌 표 머리는 accounts.length>0일 때만 — settings-cards.js:430 대 :528),
// 다른 뷰에 사는 문구는 그 뷰를 여는 클릭을 적는다.
//
// ── phrases 는 fixture가 바꾸지 못하는 것만 담는다
// 제목·부제·버튼·탭·섹션 제목·안내문·빈 상태 문구만 넣고 숫자·시각·종목명·금액은 넣지 않는다.
// 후보는 `app/lib/paper-screen-phrases.generated.js`(scripts/paper-phrases.mjs 산출)에서 고른다.
// 포함 판정이라 앱이 「＋ 새 작업 · 채팅에서」로 늘려 그려도 Paper의 「＋ 새 작업」은 그 안에 있다.
// 보드당 3~7개: 3개 미만이면 공허 통과하고 7개를 넘으면 문구 한 줄 고칠 때마다 게이트가 깨진다.
//
// ── structure 는 세 종류뿐이다
// count(개수) · order(차례) · absent(없어야 함). 더 늘리면 Paper 픽셀 복제 게이트가 된다.
// Paper와 앱이 실제로 어긋나는 자리에는 **아무 것도 적지 않았다** — 예를 들어 Paper 보드
// 14·18의 설정 사이드바는 「MCP 서버」를 넣어 5줄이지만 앱 NAV_ITEMS는 4줄이다
// (settings-cards.js:135-142, chat.js:1633 주석이 그 Paper 43쪽을 가리킨다).
// 거기에 4를 적으면 게이트가 Paper가 아니라 앱을 정본으로 삼는 거짓말이 된다.
//
// 셀렉터와 DOM id는 scripts/gates/check-paper-routes.mjs가 shell.html/orb.html과 정적 대조한다.

const STEP_KINDS = Object.freeze({
  // click     selector — 첫 일치 요소를 누른다
  click: Object.freeze(['selector']),
  // hover     selector — 첫 일치 요소에 포인터를 올린다(mouseenter·mouseover).
  //                      클릭으로는 못 만드는 상태가 있어서다: 사이드바 프로젝트 설명
  //                      카드는 행 위에 머무는 동안에만 뜨고(sidebar.js showDescription),
  //                      그 카드 안의 [프로젝트 수정]이 수정 패널을 여는 유일한 문이다.
  //                      행을 누르면 프로젝트만 갈아 끼우고 카드는 안 뜬다.
  hover: Object.freeze(['selector']),
  // mode      view — 사이드바 모드 네비(live-full-catalog.js MODES의 navId)를 누른다
  mode: Object.freeze(['view']),
  // command-bar text — 입력창에 문장을 넣고 Enter (verify.js openSettingsViaCommandBar)
  'command-bar': Object.freeze(['text']),
  // ipc-fixture channel,data — 핸들러를 갈아끼운다(probe-agent-paper-parity.js:126-140과
  //                            같은 규약). data는 핸들러가 그대로 돌려줄 값이다 — 봉투는
  //                            채널마다 다르다: athena:routines-list는 {ok,data}
  //                            (main.js:1243 routineHttp), athena:account-list는
  //                            {accounts}(main.js:4888 accounts.list()).
  //                            격리는 러너 몫이다: 라우트마다 원 핸들러를 스냅샷하고
  //                            끝나면 되돌려야 한다. 표에 되돌리는 어휘를 두지 않는 것은
  //                            빠뜨릴 수 있는 저작 부담을 늘리지 않기 위해서다 — 대신
  //                            갈아끼운 채널이 다음 라우트로 새면 안 된다(athena:account-list는
  //                            settings-cards.js:139 사이드바 배지·auth-screen.js:240·
  //                            onboarding.js:318도 읽는다).
  'ipc-fixture': Object.freeze(['channel', 'data']),
  // ipc-hang channel — 그 채널의 핸들러를 **영영 안 끝나는** 것으로 갈아끼운다.
  //                    왕복이 도는 **동안에만** 있는 화면이 있어서다: 계좌 등록의
  //                    「확인 중」은 athena:account-register가 답하기 전까지고
  //                    (settings-cards.js accountSheetState의 verifying), 답이
  //                    오는 순간 실패나 확인 완료로 넘어간다. ipc-fixture로 값을
  //                    돌려주면 그 상태는 IPC 한 왕복만큼만 살아 판정이 시계에
  //                    좌우된다 — 시간축을 세운다는 뜻에서 boot-hold와 같은 어휘다.
  //                    격리는 ipc-fixture와 같다(러너가 원 핸들러로 되돌린다).
  'ipc-hang': Object.freeze(['channel']),
  // envelope  data — 캔버스 봉투 주입 (verify.js:3745-3754 liveEnvelope)
  envelope: Object.freeze(['data']),
  // send      channel,data — main→렌더러 이벤트를 그대로 쏜다(webContents.send).
  //                          `envelope`이 add-canvas-live 하나에 봉투 모양까지 박아 둔
  //                          것과 달리 채널과 값을 그대로 넘긴다. 클릭으로는 못 가는
  //                          상태가 있어서다: 능동 턴은 백엔드 WS가 밀어 준
  //                          athena:routine-event 하나로만 그려지고(chat.js:3041),
  //                          앱 어디에도 그것을 다시 여는 버튼이 없다. 채널이 실재하는지는
  //                          check-paper-routes.mjs 규칙 2가 잰다 — 되돌릴 것은 없다
  //                          (라우트마다 창을 다시 읽는다).
  send: Object.freeze(['channel', 'data']),
  // wait      ms
  wait: Object.freeze(['ms']),
  // settle    (인자 없음) — rAF 2회 (verify.js responsiveSettle)
  settle: Object.freeze([]),
  // boot-hold chars — 부팅 창을 `?bootHoldChars=N`으로 다시 읽어 N글자에서 세운다
  //                    (chat.js의 같은 이름 블록, 셸 창의 shellHandoff=1과 같은 문법).
  //                    부팅은 화면이 아니라 시간축이라 도달한 뒤에 되돌아갈 클릭이 없다 —
  //                    이 한 마디가 없으면 부팅 다섯 단계가 전부 마지막 프레임으로 수렴한다.
  'boot-hold': Object.freeze(['chars']),
  // resize    width,height — 셸 창을 그 바깥 크기로 세운다(verify.js setResponsiveWidth와
  //                          같은 자극). 창 폭이 곧 화면인 보드가 있어서다: 보드 28은 같은
  //                          셸을 네 가지 Windows 배치로 그리고 그 넷을 가르는 것은 폭뿐이라
  //                          (shell.css의 1279·699 경계), 클릭으로는 어느 것도 못 만든다.
  //                          격리는 러너 몫이다 — 창 크기는 재읽기로 안 돌아오므로 프로브가
  //                          라우트 전 bounds를 적어 두고 끝나면 되돌린다.
  resize: Object.freeze(['width', 'height']),
  // eval      js,why — 탈출구. why가 없으면 라우트표 린트가 거절한다
  eval: Object.freeze(['js', 'why']),
});

const STRUCTURE_KINDS = Object.freeze(['count', 'order', 'absent']);

// 에이전트 목록 fixture — 드릴인(보드 03)이 열리는 것은 감시 갈래뿐이라 realtime-ws를 쓴다
// (probe-agent-paper-parity.js:50 "드릴인이 열리는 것은 감시(watch)뿐"). 값은 전부 데이터라
// phrases에는 한 글자도 넣지 않는다.
const WATCH_ROUTINE = Object.freeze({
  ok: true,
  data: {
    routines: [{
      id: 'fx1',
      symbol: '005930',
      note: '삼성전자 88,000 감시',
      status: 'active',
      mode: 'realtime-ws',
      source_label: '키움 시세',
      cooldown_s: 300,
      created_at: '2026-08-20T01:00:00.000Z',
    }],
    disclosure_ready: true,
    last_error: null,
    fired_today: 2,
  },
});

// 실행 이력 fixture — 이 채널도 routineHttp를 그대로 돌려주는 {ok,data} 봉투다
// (main.js:1273, 선례 probe-agent-paper-parity.js:188·verify.js:5276). 안쪽만 주면
// canvas.js:3484 fetchRuns·:3491 fetchAvgDuration·:3498 fetchEngagement 셋 다
// res.ok에서 걸려 폴백을 탄다. 값은 전부 데이터라 phrases에는 한 글자도 넣지 않는다.
const ROUTINE_RUNS = Object.freeze({
  ok: true,
  data: { runs: [], avg_duration_ms: 6540, opened_rate: 0.71, replied_count: 9 },
});

// 계좌 목록 fixture — 보드 14의 활성·비활성 두 줄 그대로. 이게 없으면 계좌 표 머리
// (별칭·연결 상태·마지막 검증)가 아예 안 그려져 판정이 검사 머신의 저장 상태에 좌우된다.
// 값은 전부 데이터라 phrases에는 한 글자도 넣지 않는다.
const PAPER_ACCOUNTS = Object.freeze({
  accounts: [
    { id: 'fx-a1', alias: '모의-주력', active: true, connected: true, appKeyChars: 36, orderApi: true },
    { id: 'fx-a2', alias: '모의-테스트', active: false, connected: false, appKeyChars: 36, orderApi: false },
  ],
});

// 계좌 등록 시트의 두 결말(보드 16·17). verifyOnly 왕복이 돌려주는 봉투 모양 그대로다
// (lib/main/accounts.js register — 실패는 {ok:false,error}, 검증 성공은 {ok:true,verified}).
// 검사에서 원 핸들러를 부르면 키움 모의투자 서버로 실제 발급 왕복을 나간다 — 판정이
// 이 컴퓨터의 회선에 좌우된다. 세 상태의 나머지 하나(보드 15 「확인 중」)는 값이 아니라
// **답하지 않는 것**이라 ipc-hang이 만든다.
const ACCOUNT_VERIFY_FAILED = Object.freeze({ ok: false, error: 'auth' });
const ACCOUNT_VERIFY_OK = Object.freeze({ ok: true, verified: true });

// 주문 게이트가 닫힌 계좌 — 보드 22가 그린 「지금은 실행할 수 없음」은 활성 계좌의
// 주문 API가 OFF일 때만 뜬다(order-ticket.js gateBlocker). PAPER_ACCOUNTS의 첫 줄은
// 게이트가 열려 있어 그 상태를 못 만든다. 별칭은 값이라 phrases에 안 넣는다.
const ORDER_GATE_OFF_ACCOUNTS = Object.freeze({
  accounts: [
    { id: 'fx-a1', alias: '모의-주력', active: true, connected: true, appKeyChars: 36, orderApi: false },
  ],
});

// 인증 화면 fixture — 토큰 상태는 이 계좌의 만료 시각과 이 컴퓨터의 시계에
// 좌우되므로(main/accounts.js tokenStatus) 상태를 봉투로 못 박는다. 남은 초는
// Paper가 적은 05:42:18 그대로다 — 화면에 찍히는 숫자는 값이라 phrases에 안 넣는다.
const AUTH_TOKEN_READY = Object.freeze({ state: 'ready', expiresInSec: 20538, issuedAt: null });
// 보드 20의 넷 중 「인증 필요」 칸. 토큰이 아예 없을 때의 봉투 그대로다
// (main/accounts.js tokenStatus의 계좌 없음 반환값).
const AUTH_TOKEN_NEEDED = Object.freeze({ state: 'needed', expiresInSec: 0, issuedAt: null });

// 계좌 전환 목록 fixture — 보드 21이 그린 세 줄(사용 중 하나 + 나머지 둘) 그대로.
// 별칭·개수는 전부 값이라 phrases에 한 글자도 안 넣는다.
const SWITCH_ACCOUNTS = Object.freeze({
  accounts: [
    { id: 'fx-a1', alias: '모의-주력', active: true, connected: true, appKeyChars: 36, orderApi: true },
    { id: 'fx-a2', alias: '모의-테스트', active: false, connected: false, appKeyChars: 36, orderApi: false },
    { id: 'fx-a3', alias: '모의-백테스트', active: false, connected: false, appKeyChars: 36, orderApi: false },
  ],
});

// CLI 목록 fixture — 온보딩 07·33이 그린 상태(다계정 카드 하나 + 연결된 한 줄 +
// 미연결 한 줄)를 앱이 실제로 돌려주는 봉투 모양·순서 그대로 만든다
// (cli-accounts.js:258-265 selectList, PROVIDER_ORDER는 claude·grok·codex).
// 이게 없으면 판정이 이 컴퓨터에 로그인된 CLI에 좌우된다. 값은 전부 데이터라
// phrases에는 한 글자도 넣지 않는다 — 제공자 이름도 여기서 오므로 안 쓴다.
const PAPER_CLI_PROVIDERS = Object.freeze({
  providers: [
    {
      id: 'claude',
      name: 'Claude',
      connected: true,
      accounts: [
        { id: 'fx-c1', label: 'athena-1@example.com', active: true, current: true },
        { id: 'fx-c2', label: 'athena-2@example.com', active: false, current: false },
      ],
    },
    { id: 'grok', name: 'Grok', connected: false, accounts: [] },
    {
      id: 'codex',
      name: 'Codex',
      connected: true,
      accounts: [{ id: 'fx-x1', label: 'athena-1@example.com', active: false, current: true }],
    },
  ],
});

// 로그인 요청의 두 결말. 실제 핸들러는 터미널 창을 띄우므로(main.js:4849 handleCliLogin →
// cli-accounts.js login) 검사에서 원 핸들러를 부르면 안 된다 — 봉투는 login()이
// 돌려주는 그 모양이다(cli-accounts.js:334·347).
const CLI_LOGIN_LAUNCHED = Object.freeze({ ok: true, launched: true, message: '' });
const CLI_LOGIN_NOT_INSTALLED = Object.freeze({ ok: false, launched: false, message: '' });

// 능동 턴 이벤트 — 보드 09가 그린 turn-agent(조건 패널 형식) 그대로. 앱은 이 한
// 봉투에서 배지·방식·조건 패널·각주를 전부 만든다(lib/routine-turn.js buildTurnModel).
// `mode`를 안 싣는 것은 일부러다: Paper가 머리에 적은 말이 「주기 확인」이고, 그것이
// describeMode의 기본값이다. 종목·관측값·임계는 값이라 phrases에 한 글자도 안 넣는다 —
// 각주와 고지 문장만이 이 봉투와 무관하게 늘 같은 문구다.
const ROUTINE_FIRED = Object.freeze({
  type: 'routine-fired',
  routine_id: 'fx-r1',
  symbol: '삼성전자 005930',
  note: '삼성전자 88,000',
  observed: '88,100',
  threshold: '88,000',
  fired_at: '2026-08-20T15:30:00+09:00',
});

// 활성 감시 3건 — 키우미 보드 01의 「감시 궤도 링 — 활성 감시 3건」 그대로다. 오브는
// 셸 컨트롤 스트립과 같은 채널을 읽어 활성 루틴 수만큼 위성 점을 놓는다
// (orb.js refreshSatelliteRing → renderSatelliteRing). 0건이면 궤도 자체를 안 그리므로
// 이 봉투가 없으면 이 보드의 구조 셈은 이 컴퓨터의 백엔드 상태에 좌우된다.
// 값은 전부 데이터라 phrases에는 한 글자도 넣지 않는다.
const WATCH_THREE_ACTIVE = Object.freeze({
  ok: true,
  data: {
    routines: [
      { id: 'fx-w1', symbol: '005930', note: '삼성전자 88,000', status: 'active', mode: 'polling' },
      { id: 'fx-w2', symbol: '000660', note: 'SK하이닉스 200,000', status: 'active', mode: 'polling' },
      { id: 'fx-w3', symbol: '035720', note: '카카오 40,000', status: 'active', mode: 'polling' },
    ],
    disclosure_ready: true,
    last_error: null,
    fired_today: 0,
  },
});

// 복원 실패 이벤트 — 보드 30이 그린 대화 턴 하나. 백엔드가 실제로 보내는 봉투 모양
// 그대로다(routines/runtime.py:371 — 실시간 구독 복원 실패는 note에 사람이 읽는 문장을
// 싣는다). 그 문장은 루틴 이름을 품은 값이라 phrases에 한 글자도 넣지 않는다.
const ROUTINE_RESTORE_FAILED = Object.freeze({
  type: 'routine-restore-failed',
  routine_id: 'fx-r2',
  detail: 'TimeoutError',
  note: "'검증 루틴' 실시간 구독에 실패했습니다",
});

// 캔버스 탭 넷 — 보드 55가 그린 탭 스트립 그대로(시세 · 계좌 · 호가 · 수급).
// 봉투 하나가 탭 하나다: 통합 카드 판정이 열리면(card_id·card_kind) 카드가 탭
// 뷰포트로 들어가고, 탭 제목은 `카드명 · 대상`으로 만들어진다(canvas-tabs.js
// tabTitleFor). 표면 계약의 board_id는 색인이 실제로 아는 보드다
// (board-templates.index.generated.js) — 없는 보드를 적으면 카드가 안 선다.
// 카드명·종목·계좌번호는 전부 값이라 phrases에 한 글자도 넣지 않는다.
function paperCanvasTab(cardId, cardKind, boardId, title, target) {
  return Object.freeze({
    card_id: cardId,
    card_kind: cardKind,
    operation_ref: 'base:board-surface',
    canvas_type: 'facts',
    card_title: title,
    view_instance_id: `paper55-${boardId.toLowerCase()}`,
    ...target,
    surface_contract: {
      surface_version: 'card-surface.v1',
      board_id: boardId,
      card_id: cardId,
      slot_values: {},
      unbound_slots: [],
      state_boards: [],
      column_priority: [],
      section_titles_ko: {},
    },
  });
}

const SAMSUNG = Object.freeze({ stk_cd: '005930', stk_nm: '삼성전자' });
const CANVAS_TABS = Object.freeze([
  paperCanvasTab('CC-03', 'instrument', '137X-2', '시세', SAMSUNG),
  paperCanvasTab('CC-01', 'account', '133H-2', '계좌', { account_no: '81234721' }),
  paperCanvasTab('CC-04', 'orderbook', '13BC-2', '호가', SAMSUNG),
  paperCanvasTab('CC-05', 'flow', '1WOB-1', '수급', SAMSUNG),
]);

// 되물을 것들 3건 — 보드 08의 「1 / 3」이 그 수다. 백엔드 봉투 모양 그대로
// {ok, revision, questions}(main.js가 result.body를 펼쳐 준다, chat.js:1941 주석).
// 이 fixture가 없으면 카드가 이 컴퓨터의 브레인에 좌우된다: 물을 것이 0건이면
// 확인 필요 배너 자체가 안 그려지고(summary-table.js renderConfirmBanner), 배너가
// 없으면 카드를 여는 클릭이 없다. 질문 문장·근거는 전부 값이라 phrases에 안 넣는다.
const BRAIN_QUESTIONS = Object.freeze({
  ok: true,
  revision: 1,
  questions: [
    {
      relation_id: 'fx-q1',
      subject_name: 'default',
      object_name: '헬스케어',
      relation_kind: 'interested_in',
      rationale: '"잘 모르겠다" — 관심 여부 불명확',
      question: "헬스케어에 대해 'interested_in'가 맞나요? 확실하지 않은 것으로 기록해 두었습니다.",
    },
    {
      relation_id: 'fx-q2',
      subject_name: 'default',
      object_name: '2차전지',
      relation_kind: 'avoids',
      rationale: null,
      question: "2차전지에 대해 'avoids'가 맞나요? 확실하지 않은 것으로 기록해 두었습니다.",
    },
    {
      relation_id: 'fx-q3',
      subject_name: '한미반도체',
      object_name: '배당 방어 바스켓',
      relation_kind: 'relates_to',
      rationale: null,
      question: "'relates_to'가 맞나요? 확실하지 않은 것으로 기록해 두었습니다.",
    },
  ],
});

// 이력 사이드바 fixture — 보드 35가 그린 프로젝트 둘과 모드별 대화 여덟(대화 3 · 그래프 1 ·
// 에이전트 2 · 플러그인 0 · 백테스트 2) 그대로다. 이게 없으면 판정이 이 컴퓨터에 쌓인 대화에
// 좌우된다: 검사 프로필은 비어 있어 프로젝트가 「기본 프로젝트」 한 줄뿐이고 최근 구역은
// 아예 안 그려진다(sidebar.js renderList의 filtered.length 분기). 별칭·제목·경로는 전부
// 값이라 phrases에 한 글자도 넣지 않는다.
const SIDEBAR_HISTORY = Object.freeze({
  activeId: null,
  activeMode: 'chat',
  currentProjectId: 'fx-p1',
  projects: [
    { id: 'fx-p1', label: '아테나', path: 'C:\\Projects\\DAOU.Athena', pinned: false },
    { id: 'fx-p2', label: '키움 리서치', path: 'C:\\Projects\\kiwoom-research', pinned: false },
  ],
  conversations: [
    { id: 'fx-s1', title: '추세추종 v3', projectId: 'fx-p1', mode: 'backtest' },
    { id: 'fx-s2', title: '변동성 돌파 실험', projectId: 'fx-p1', mode: 'backtest' },
    { id: 'fx-s3', title: '반도체 수급 점검', projectId: 'fx-p1', mode: 'chat' },
    { id: 'fx-s4', title: '성향 지도 · 9월', projectId: 'fx-p1', mode: 'graph' },
    { id: 'fx-s5', title: '아침 브리핑 감시', projectId: 'fx-p2', mode: 'agent' },
    { id: 'fx-s6', title: '삼성전자 주요 변동 알림', projectId: 'fx-p2', mode: 'agent' },
    { id: 'fx-s7', title: '백엔드 API 개수 확인', projectId: 'fx-p2', mode: 'chat' },
    { id: 'fx-s8', title: '앱 전체 기능 검수', projectId: 'fx-p2', mode: 'chat' },
  ],
});

// 보드 37만 프로젝트를 셋 그린다(아테나 · 키움 리서치 · 개인 연구) — 같은 목록에 한 줄을 더한다.
const SIDEBAR_HISTORY_THREE = Object.freeze({
  ...SIDEBAR_HISTORY,
  projects: [...SIDEBAR_HISTORY.projects,
    { id: 'fx-p3', label: '개인 연구', path: 'C:\\Projects\\personal', pinned: false }],
});


// ── 그래프 페이지(D-2) fixture 넷 ────────────────────────────────────────────
// 그래프 화면은 이 컴퓨터에 쌓인 성향 그래프를 그대로 그린다 — 검사 프로필은
// 비어 있어 지도가 「아직 그릴 연결이 없습니다」로, 표가 빈 칸으로 떨어진다
// (controller.js renderFilteredEmpty · summary-table.js renderSummaryHero의
// total===0 분기). 그래서 보드 02~04가 그린 그래프를 봉투로 못 박는다.
//
// `observed_at`을 한 군데도 안 싣는 것은 일부러다: 헤더 기간 칩이 「최근 90일」로
// 거르므로(graph-filters.js applyGraphFilters) 고정 날짜를 박으면 그 날로부터 90일
// 뒤에 게이트가 이유 없이 빨개진다. 시각을 모르는 엣지는 안 거른다는 것이 그 함수의
// 계약이라(§0 「못 읽은 것과 없는 것은 다르다」), 빼는 편이 시계에 안 좌우된다.
// 종목명·군집 번호·연결 수는 전부 값이라 phrases에 한 글자도 넣지 않는다.
const GRAPH_CLUSTER_MAP = Object.freeze({
  ok: true,
  revision: 7,
  nodes: [
    { entity_id: 'fx-hanmi', name: '한미반도체', kind: 'security', cluster: 0, degree: 2 },
    { entity_id: 'fx-semi', name: '반도체 대형주', kind: 'theme', cluster: 0, degree: 3 },
    { entity_id: 'fx-samsung', name: '삼성전자', kind: 'security', cluster: 0, degree: 1 },
    { entity_id: 'fx-hynix', name: 'SK하이닉스', kind: 'security', cluster: 0, degree: 1 },
    { entity_id: 'fx-basket', name: '배당 방어 바스켓', kind: 'theme', cluster: 1, degree: 2 },
    { entity_id: 'fx-dividend', name: '고배당주', kind: 'theme', cluster: 1, degree: 2 },
    { entity_id: 'fx-ktng', name: 'KT&G', kind: 'security', cluster: 1, degree: 1 },
  ],
  edges: [
    ['fx-hanmi', 'fx-semi'], ['fx-samsung', 'fx-semi'], ['fx-hynix', 'fx-semi'],
    ['fx-hanmi', 'fx-basket'], ['fx-ktng', 'fx-dividend'], ['fx-dividend', 'fx-basket'],
  ],
  edge_details: [
    { source: 'fx-hanmi', target: 'fx-semi', kinds: ['belongs_to'], confidence: 'EXTRACTED', tier: 'conversational' },
    { source: 'fx-samsung', target: 'fx-semi', kinds: ['belongs_to'], confidence: 'EXTRACTED', tier: 'conversational' },
    { source: 'fx-hynix', target: 'fx-semi', kinds: ['belongs_to'], confidence: 'EXTRACTED', tier: 'conversational' },
    { source: 'fx-hanmi', target: 'fx-basket', kinds: ['relates_to'], confidence: 'INFERRED', tier: 'conversational' },
    { source: 'fx-ktng', target: 'fx-dividend', kinds: ['belongs_to'], confidence: 'EXTRACTED', tier: 'conversational' },
    { source: 'fx-dividend', target: 'fx-basket', kinds: ['belongs_to'], confidence: 'EXTRACTED', tier: 'conversational' },
  ],
});

// 성향 신호 다섯 줄 — 보드 02의 표 그대로다. 넷째·다섯째가 같은 대상(단기 회전)의
// 체결발·대화발 두 줄인 것이 요점이다: 공통 패널의 「두 출처가 다르게 말합니다」는
// 같은 entity_id의 tier가 갈릴 때만 뜬다(controller.js renderPanelContent).
const GRAPH_PROFILE_SIGNALS = Object.freeze({
  ok: true,
  total: 312,
  entries: [
    { entity_id: 'fx-samsung', entity_name: '삼성전자', entity_kind: 'security', relation_kind: 'owns', rationale: '체결 4건 · 평균 71,200원', tier: 'deterministic', confidence: 'EXTRACTED', reinforcement: 12 },
    { entity_id: 'fx-dividend', entity_name: '고배당주', entity_kind: 'theme', relation_kind: 'prefers', rationale: '현금흐름은 나와야 편하다', tier: 'conversational', confidence: 'INFERRED', reinforcement: 8 },
    { entity_id: 'fx-hynix', entity_name: 'SK하이닉스', entity_kind: 'security', relation_kind: 'interested_in', rationale: 'HBM 질문 6개 대화 반복', tier: 'conversational', confidence: 'INFERRED', reinforcement: 6 },
    { entity_id: 'fx-turnover', entity_name: '단기 회전', entity_kind: 'preference', relation_kind: 'traded', rationale: '체결 21건 · 평균 보유 3.2일 · 최장 9일', tier: 'deterministic', confidence: 'EXTRACTED', reinforcement: 21 },
    { entity_id: 'fx-turnover', entity_name: '단기 회전', entity_kind: 'preference', relation_kind: 'prefers', rationale: '5개 대화에서 장기로 간다', tier: 'conversational', confidence: 'INFERRED', reinforcement: 21 },
  ],
});

// 보드 04는 지도에서 고른 노드를 그린다 — 그 패널의 첫 행(성향 관계)은 이 목록에서
// 오고(controller.js buildRelationships ①), 나머지 두 행은 위 edge_details에서 온다.
// 표 다섯 줄을 그대로 쓰면 한미반도체에 걸린 성향 관계가 없어 그 행이 빠진다.
const GRAPH_NODE_SIGNALS = Object.freeze({
  ok: true,
  total: 312,
  entries: [
    { entity_id: 'fx-hanmi', entity_name: '한미반도체', entity_kind: 'security', relation_kind: 'interested_in', rationale: 'HBM 장비 질문 4회', tier: 'conversational', confidence: 'INFERRED', reinforcement: 4 },
  ],
});

// 숨은 연관 한 쌍 — 보드 02의 카드와 보드 04의 「왜 숨은 연관인가」가 같은 이 쌍을
// 읽는다(controller.js topSurprising). 하나뿐이라 그 쌍이 곧 1등이고, 그래서 근거
// 블록이 「이 그래프에서 가장 놀라운 연결입니다」로 말한다.
const GRAPH_HIDDEN_LINKS = Object.freeze({
  ok: true,
  connections: [{
    source_entity_id: 'fx-hanmi',
    source_name: '한미반도체',
    source_cluster: 0,
    target_entity_id: 'fx-basket',
    target_name: '배당 방어 바스켓',
    target_cluster: 1,
    kinds: ['relates_to'],
    surprise_score: 1,
  }],
});

// 되물을 것이 없는 상태 — 보드 02~04 어디에도 확인 필요 배너가 없다. 봉투를 안
// 주면 배너가 이 컴퓨터의 브레인에 좌우된다(summary-table.js renderConfirmBanner).
const GRAPH_NO_QUESTIONS = Object.freeze({ ok: true, revision: 1, questions: [] });

// 엔티티 타임라인 셋 — 보드 02·04의 「최근 변화」가 그린 세 줄 그대로다. 날짜와
// 문장은 이 봉투에서 만들어지는 값이라 phrases에 한 글자도 넣지 않는다.
const GRAPH_TIMELINE = Object.freeze({
  ok: true,
  events: [
    { at: '2026-08-23T03:00:00.000Z', op: 'edge_added', relation: 'relates_to', object_id: 'fx-basket' },
    { at: '2026-08-19T03:00:00.000Z', op: 'edge_changed', relation: 'interested_in', confidence_before: 'INFERRED', confidence_after: 'EXTRACTED' },
    { at: '2026-08-04T03:00:00.000Z', op: 'entity_added' },
  ],
});

// ── 코드 알람 fixture (A-2 보드 10·11·12) ────────────────────────────────────
// 코드 알람 상세는 목록에 없는 값을 한 번 더 조회해서 그린다(athena:routine-detail,
// canvas.js가 fetchDetail로 잇는다) — 봉투를 안 박으면 판정이 백엔드에 좌우된다.
// 감시 블록은 백엔드가 실제로 돌려주는 필드 그대로다(probe-agent-paper-parity.js의
// WATCH_BLOCK과 같은 모양). 칸 제목·값·함수명은 전부 값이라 phrases에 안 넣는다.
const WATCH_BLOCK = Object.freeze({
  project_id: 'fx-p1',
  path: 'watch/volume_spike.py',
  version_hash: 'ab12cd34ef',
  params: {},
  poll_interval_s: 60,
  lookback_days: 30,
  last_fired_at: null,
});

// 보드 10의 노드 넷 — 첫 검사라 바뀐 칸이 없다(「방금 바뀜」 0개).
const WATCH_NODES_FIRST = Object.freeze([
  {
    fn: 'load_bars', title_ko: '일봉 불러오기', title_en: 'load_bars',
    inputs: [{ name: '종목', value: '삼성전자' }, { name: '기간', value: '최근 60일' }],
    output: '봉 60개 + 오늘 봉', called: true, changed: false,
  },
  {
    fn: 'avg_volume', title_ko: '3일 거래량 평균', title_en: 'avg_volume',
    inputs: [{ name: '봉', value: '60개' }, { name: '일수', value: '3일' }],
    output: '1,240만주', called: true, changed: false,
  },
  {
    fn: 'volume_ratio', title_ko: '배수 비교', title_en: 'volume_ratio',
    inputs: [{ name: '오늘 거래량', value: '1,890만주' }, { name: '평균 · 배수', value: '1,240만주 · 1.5배' }],
    output: '1.52배 · 넘음', called: true, changed: false,
  },
  {
    fn: 'fire', title_ko: '알림', title_en: 'fire',
    inputs: [{ name: '넘음', value: true }, { name: '쿨다운', value: '1일' }],
    output: '오늘이면 울림', called: true, changed: false,
  },
]);

// 고친 뒤의 노드 넷(보드 11이 그린 상태) — 두 칸(평균 일수 · 배수 임계)이
// 바뀌어 「방금 바뀜」이 둘이고, 들어감은 고침 전후를 화살표로 같이 그린다
// (45KU-1 · 45LD-1). 보드 11에는 라우트가 없다(아래 44HD-1 자리 참고) —
// 이 값은 보드 12의 정착 상태를 여기서 파생시키려고 남겨 둔다.
const WATCH_NODES_AFTER_FIX = Object.freeze([
  WATCH_NODES_FIRST[0],
  {
    fn: 'avg_volume', title_ko: '5일 거래량 평균', title_en: 'avg_volume',
    inputs: [{ name: '봉', value: '60개' }, { name: '일수', value: '3일 → 5일' }],
    output: '1,300만주', called: true, changed: true,
  },
  {
    fn: 'volume_ratio', title_ko: '배수 비교', title_en: 'volume_ratio',
    inputs: [{ name: '오늘 거래량', value: '1,650만주' }, { name: '배수', value: '1.5배 → 2.0배' }],
    output: '1.27배 · 안 넘음', called: true, changed: true,
  },
  {
    fn: 'fire', title_ko: '알림', title_en: 'fire',
    inputs: [{ name: '넘음', value: false }, { name: '쿨다운', value: '1일' }],
    output: '오늘은 조용', called: true, changed: false,
  },
]);

// 보드 12의 노드 넷 — 켜진 뒤 오늘 한 번 돈 결과다(고친 자국은 이미 지나갔다).
const WATCH_NODES_LIVE = Object.freeze([
  WATCH_NODES_AFTER_FIX[0],
  Object.freeze({
    ...WATCH_NODES_AFTER_FIX[1],
    inputs: [{ name: '봉', value: '60개' }, { name: '일수', value: '5일' }],
    changed: false,
  }),
  Object.freeze({
    ...WATCH_NODES_AFTER_FIX[2],
    inputs: [{ name: '오늘 거래량', value: '1,650만주' }, { name: '배수', value: '2.0배' }],
    changed: false,
  }),
  Object.freeze({ ...WATCH_NODES_AFTER_FIX[3], output: '조용' }),
]);

function paperCodeRoutine(status) {
  return Object.freeze({
    ok: true,
    data: {
      routines: [{
        id: 'fx-c1',
        symbol: '005930',
        note: '거래량 급증 감시 · 삼성전자',
        status,
        mode: 'code-watch',
        source_label: '코드 감시',
        cooldown_s: 86400,
        created_at: '2026-08-30T01:00:00.000Z',
        expires_at: '2026-10-03T09:00:00',
        watch: WATCH_BLOCK,
      }],
      disclosure_ready: true,
      last_error: null,
      fired_today: 0,
    },
  });
}
const CODE_WATCH_DRAFT = paperCodeRoutine('draft');
const CODE_WATCH_ACTIVE = paperCodeRoutine('active');

// 초안은 검사 결과(last_check)를, 켜진 알람은 오늘 실행(last_run)을 그린다
// (agent-canvas.js renderCodeDetail이 status로 가른다).
function paperCodeDetail(kind, nodes) {
  const body = { id: 'fx-c1', watch: WATCH_BLOCK, last_run: null, last_check: null };
  if (kind === 'check') {
    body.last_check = {
      count: 4, lookback_days: 30, last_fire: '2026-08-26',
      fires: [{ dt: '2026-08-26', close: 71000 }],
      nodes, warnings: [], checked_at: '2026-09-05T06:31:00.000Z',
      counted_until: '2026-09-04', ok: true, reason: null,
    };
  } else {
    body.last_run = {
      checked_at: '2026-09-05T06:31:00.000Z', observed: 1.27, duration_ms: 820,
      nodes, skip_reason: null,
    };
  }
  return Object.freeze({ ok: true, data: body });
}
// 보드 12의 「울린 기록 · 최근」 세 줄 — 울린 둘과 억제된 하나다(45QT-1·45QY-1·
// 45R3-1). 울린 줄에만 「채팅에서 열기 ↗」가 붙는 규칙이 이 셋으로 갈린다.
// 줄의 차례는 Paper가 울린 것 먼저 그렸지만 앱은 시각 내림차순이라 어긋난다 —
// 라우트는 차례를 재지 않는다. 날짜·배수·주수는 전부 값이라 phrases에는 없다.
const CODE_RUNS = Object.freeze({
  ok: true,
  data: {
    runs: [
      { ts: '2026-08-26T15:02:00', verdict: 'fired', reason: '울림 — 2.1배 · 2,730만주' },
      { ts: '2026-08-12T10:41:00', verdict: 'fired', reason: '울림 — 2.3배 · 2,980만주' },
      { ts: '2026-08-27T09:00:00', verdict: 'suppressed', reason: '억제 — 쿨다운 1일 남음 · 2.0배' },
    ],
    avg_duration_ms: 820,
    opened_rate: 0.71,
    replied_count: 9,
  },
});

const CODE_DETAIL_FIRST_CHECK = paperCodeDetail('check', WATCH_NODES_FIRST);
const CODE_DETAIL_ACTIVE = paperCodeDetail('run', WATCH_NODES_LIVE);

// ── 플러그인 페이지(B-2) fixture ────────────────────────────────────────────
// 플러그인 화면은 이 컴퓨터에 실제로 등록된 MCP 서버를 그린다 — 검사 프로필은
// userData만 새로 만들고 레지스트리는 그대로라(lib/main/mcp-cli.js가 athena 상태
// 경로를 읽는다) 판정이 이 머신에 좌우된다. 그래서 목록·도구·감사·미해결 제안을
// 전부 봉투로 못 박는다. 별칭·도구 이름·시각은 값이라 phrases에 한 글자도 안 넣는다.
//
// 판번호는 하나로 통일한다 — 봉투의 revision이 목록의 revision과 어긋나면 카드가
// 만료로 떨어진다(plugin-proposal.js isProposalStale). 만료를 **일부러** 세우는
// 보드 09만 한 장에 옛 번호를 싣는다.
const PLUGIN_REVISION = 12;

/** athena:mcp-list 한 줄 — main/mcp-cli.js list()가 돌려주는 그 일곱 칸이다. */
function paperMcpServer(alias, argsPreview, approved, toolCount, health) {
  return {
    alias, command: alias === 'korea-stock' ? 'npx' : 'uvx', argsPreview,
    approved, toolCount, health, warnings: [],
  };
}

// 보드 03·04가 그린 두 줄 — 승인된 「웹 문서 읽기」와 승인 철회된 「시간·시간대」다.
// 도구 수 1+2가 관리 머리의 「기능 3」이고, 남은 카탈로그 셋이 「추천」 세 장이다.
const PLUGIN_LIST_TWO = Object.freeze({
  servers: [
    paperMcpServer('fetch', 'mcp-server-fetch', true, 1, 'ok'),
    paperMcpServer('time', 'mcp-server-time', false, 2, 'unknown'),
  ],
  revision: PLUGIN_REVISION,
});

// 보드 01·09는 「한국 주식 시세」 한 줄만 그린다.
const PLUGIN_LIST_KOREA = Object.freeze({
  servers: [paperMcpServer('korea-stock', '-y @drfirst/korea-stock-mcp', true, 4, 'ok')],
  revision: PLUGIN_REVISION,
});

// 보드 06의 첫 칸 — 아직 아무것도 설치하지 않은 허브.
const PLUGIN_LIST_EMPTY = Object.freeze({ servers: [], revision: PLUGIN_REVISION });

// probe가 돌려주는 도구 여섯 — 보드 01이 그린 그 여섯이고 넷만 허용이다. probe
// 전에는 노출 도구를 모르므로(plugin-canvas.js featureRowsFor 주석) 이 봉투가
// 없으면 기능 목록이 통째로 비어 판정이 공허해진다.
function koreaTools(allowedIndexes) {
  const rows = [
    ['search_stock_code', '종목명으로 종목 코드를 찾습니다'],
    ['get_stock_price_by_code', '종목 코드로 현재가를 조회합니다'],
    ['get_market_cap_stocks', '시가총액 상위 종목을 가져옵니다'],
    ['get_dividend_yield_stocks', '배당수익률 상위 종목을 가져옵니다'],
    ['get_themes_with_leaders', '테마와 주도주를 가져옵니다'],
    ['get_etfs_by_market_cap', '시총 기준 ETF 목록을 가져옵니다'],
  ];
  return Object.freeze({
    ok: true,
    tools: rows.map(([name, description], index) => ({
      name, description, allowed: allowedIndexes.includes(index),
    })),
  });
}
const KOREA_TOOLS = koreaTools([0, 1, 2, 3]);
// 보드 09의 「그 사이 바뀐 기능」 — 초안을 뜬 뒤 실제 허용이 갈린 상태다. 같은
// 채널에 다른 봉투를 두 번 거는 것이 앱 밖에서 그 갈림을 만드는 유일한 자극이다.
const KOREA_TOOLS_CHANGED = koreaTools([2, 3, 4]);

// 보드 02의 감사 로그 세 줄. 시각·별칭·도구는 값이라 phrases에 안 넣는다 —
// 이 봉투가 지는 것은 열 머리(시각·별칭·도구·결과)와 줄 수뿐이다.
const PLUGIN_AUDIT = Object.freeze({
  entries: [
    { ts: '2026-09-05T09:14:00', alias: 'fetch', tool: 'fetch', success: true },
    { ts: '2026-09-05T08:52:00', alias: 'time', tool: 'get_current_time', success: true },
    { ts: '2026-09-05T08:50:00', alias: 'time', tool: 'register', success: false },
  ],
});
// 보드 04에는 감사 구역이 없다 — 앱은 관리 뷰에 그것을 같이 그리므로, 읽는 중
// 문구가 이 컴퓨터의 기록에 좌우되지 않게 빈 봉투로 못 박는다.
const PLUGIN_AUDIT_EMPTY = Object.freeze({ entries: [] });

// 제안 봉투 — 모델이 낸 것과 같은 모양이다(plugin-proposal.js buildProposal).
// 미해결 제안은 메인 프로세스 메모리에만 살고 모드 재진입이 athena:plugin-pending
// 으로 되읽는다(canvas.js pluginRestorePending) — 검사에서 승인 카드를 세우는
// 문은 그 채널 하나뿐이다.
function paperProposal(id, actions, revision) {
  return {
    proposal_id: id,
    source: 'model',
    revision: revision === undefined ? PLUGIN_REVISION : revision,
    actions,
    reason: '',
  };
}
const KOREA_FEATURES = Object.freeze([
  'search_stock_code', 'get_stock_price_by_code', 'get_market_cap_stocks',
  'get_dividend_yield_stocks', 'get_themes_with_leaders', 'get_etfs_by_market_cap',
]);
const PROPOSE_INSTALL_FETCH = paperProposal('fx-pp-install-fetch',
  [{ action: 'install', target: 'fetch', features: ['fetch'] }]);
const PROPOSE_INSTALL_KOREA = paperProposal('fx-pp-install-korea',
  [{ action: 'install', target: 'korea-stock', features: [...KOREA_FEATURES] }]);
const PROPOSE_ALLOW_KOREA = paperProposal('fx-pp-allow-korea',
  [{ action: 'allow_tools', target: 'korea-stock', features: KOREA_FEATURES.slice(0, 4) }]);
const PROPOSE_DISABLE_FETCH = paperProposal('fx-pp-disable-fetch',
  [{ action: 'set_enabled', target: 'fetch', enabled: false }]);
const PROPOSE_REMOVE_TIME = paperProposal('fx-pp-remove-time',
  [{ action: 'remove', target: 'time' }]);
const PROPOSE_SNIPPET = paperProposal('fx-pp-snippet', [{
  action: 'stage_snippet',
  target: null,
  snippet: '{"mcpServers":{"time":{"command":"uvx","args":["mcp-server-time"]}}}',
}]);
// 보드 09의 만료 칸 — 봉투가 쥔 판번호가 지금 목록과 어긋난 그 상태다.
const PROPOSE_ALLOW_KOREA_STALE = paperProposal('fx-pp-allow-stale',
  [{ action: 'allow_tools', target: 'korea-stock', features: KOREA_FEATURES.slice(0, 4) }],
  PLUGIN_REVISION - 3);

function paperPending(proposals) {
  return Object.freeze({ proposals, revision: PLUGIN_REVISION });
}

// 승인·거부의 반환 — main.js pluginResult가 채우는 일곱 칸 그대로다. 실제 승인은
// 서버를 내려받아 띄우므로(mcp-cli register→approve→probe) 검사에서 원 핸들러를
// 부르면 안 된다. runtimeEnabled는 기본 빌드의 false다 — 결과 턴이 「다음 실행부터
// 반영됩니다」로 갈리는 자리다(보드 08의 「런타임 꺼짐 · 기본」).
// 성공 턴 세 줄은 이 봉투의 results와 무관하다(plugin-proposal.js resultTurnCopy가
// 고정 문면을 쓴다) — 여기서 읽히는 값은 probes의 도구 수뿐이라 보드 06의 끄기
// 승인도 같은 봉투를 쓴다.
const PLUGIN_APPROVE_SUCCESS = Object.freeze({
  ok: true, kind: 'success', reason: null,
  results: [{ action: 'install', target: 'korea-stock', ok: true }],
  probes: [{ alias: 'korea-stock', ok: true, toolCount: 6 }],
  revision: PLUGIN_REVISION, runtimeEnabled: false,
});
const PLUGIN_REJECT_DONE = Object.freeze({
  ok: true, kind: 'rejected', reason: null, results: [], probes: [],
  revision: PLUGIN_REVISION, runtimeEnabled: false,
});


const ROUTES = Object.freeze([
  // ---------- 부팅 5장 (1-0) ----------
  // 부팅 02~05는 한 애니메이션의 시간 단계라 서로를 가르는 것은 **찍힌 글자 수**뿐이다.
  // 원장 texts도 그것뿐이다: 'ATHENA'(폭 guide) · 이미 찍힌 조각 · 커서 '|'. 그래서 이
  // 넷은 문구가 아니라 structure가 판정을 진다 — .boot-name-char 개수가 0·2·4·6으로
  // 갈린다(chat.js 240 + (i+1)*160ms 슬롯 여섯 번). 02·05는 원장에 문구가 둘뿐이라
  // 3개 하한을 paper-screen-routes.test.js가 사유와 함께 예외 처리했고, 그 대가로
  // structure를 셋씩 실었다.
  {
    board: '16OD-2', // 02 · 부팅 — READY · 0–240ms
    window: 'boot',
    reach: [{ do: 'boot-hold', chars: 0 }, { do: 'settle' }],
    root: '#boot',
    // 'ATHENA'는 앱에서 색이 투명한 폭 guide다(chat.css .boot-base — 사용자 결정
    // "글자 뒤에 회색 문자가 비치지 않는다"). 가시 텍스트로는 잡히지만 눈에는
    // 안 보이므로, 이 보드에서 실제로 무게를 지는 것은 아래 structure 셋이다.
    phrases: ['ATHENA', '|'],
    structure: [
      { what: 'absent', selector: '.boot-name-char' }, // 아직 한 글자도 안 찍혔다
      { what: 'count', selector: '.boot-logo', equals: 1 }, // 키움증권 CI
      { what: 'count', selector: '.boot-cursor', equals: 1 },
    ],
  },
  {
    board: '16OJ-2', // 03 · 부팅 — TYPE A→AT · 240–560ms
    window: 'boot',
    reach: [{ do: 'boot-hold', chars: 2 }, { do: 'settle' }],
    root: '#boot',
    // Paper는 남은 글자를 'HENA'로 따로 그리고 앱은 'ATHENA' 폭 guide 한 덩이로
    // 그린다 — 같은 픽셀이라 문구로는 갈리지 않는다. 갈리는 것은 찍힌 두 글자다.
    phrases: ['AT', 'HENA', '|'],
    structure: [
      { what: 'count', selector: '.boot-name-char', equals: 2 },
      { what: 'count', selector: '.boot-logo', equals: 1 },
    ],
  },
  {
    board: '16OQ-2', // 04 · 부팅 — TYPE ATH→ATHE · 560–880ms
    window: 'boot',
    reach: [{ do: 'boot-hold', chars: 4 }, { do: 'settle' }],
    root: '#boot',
    phrases: ['ATHE', 'NA', '|'],
    structure: [
      { what: 'count', selector: '.boot-name-char', equals: 4 },
      { what: 'count', selector: '.boot-logo', equals: 1 },
    ],
  },
  {
    board: '16OX-2', // 05 · 부팅 — COMPLETE · 880–1440ms
    window: 'boot',
    reach: [{ do: 'boot-hold', chars: 6 }, { do: 'settle' }],
    root: '#boot',
    phrases: ['ATHENA', '|'],
    structure: [
      { what: 'count', selector: '.boot-name-char', equals: 6 }, // ATHENA가 다 찍혔다
      { what: 'count', selector: '.boot-logo', equals: 1 },
      { what: 'count', selector: '.boot-cursor', equals: 1 },
    ],
  },
  {
    board: '16P3-2', // 06 · 부팅 — DIRECT SHELL EXPAND · 1440–1920ms
    window: 'shell',
    // 부팅이 끝나면 완성된 조판이 셸로 펼쳐진다 — 러너가 읽은 셸 창이 곧 그 상태다.
    reach: [{ do: 'settle' }],
    root: '#shell',
    // Paper가 이 보드에 채운 카드·대화·에이전트 턴은 전부 데이터라 문구가 못 된다.
    // 사이드바 첫 행은 Paper가 「새 채팅」, 앱이 「새 대화」로 갈리는데(보드 12·29도
    // 같다) 어느 쪽이 정본인지는 사이드바 보드가 정할 일이라 여기서는 안 적는다.
    phrases: ['그래프', '에이전트', '플러그인'],
    // Paper의 프레임 이름이 그대로 계약이다 — 「Shell 창 (3영역: 이력 268 · 캔버스 · 대화 400)」.
    structure: [{ what: 'count', selector: '.shell-region', equals: 3 }],
  },

  // ---------- 온보딩 3장 (1-0) ----------
  // 온보딩은 부팅이 딱 한 번 읽는 상태다(chat.js:255 athena:onboarding-state →
  // startOnboarding). 도달한 뒤에 그 화면을 여는 클릭이 앱 어디에도 없어서, 셸을
  // 다시 읽지 않는 러너에서는 앱 자신의 진입점을 부르는 eval이 유일한 통로다 —
  // 그래서 이 셋만 탈출구를 쓴다(paper-screen-routes.test.js가 목록을 잠근다).
  {
    board: '1DX-0', // 07 · 온보딩 — CLI 연결 (AT-SY-002)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:cli-list', data: PAPER_CLI_PROVIDERS },
      { do: 'ipc-fixture', channel: 'athena:cli-login', data: CLI_LOGIN_LAUNCHED },
      {
        do: 'eval',
        js: 'startOnboarding(2)',
        why: '온보딩 진입은 부팅 한 번뿐이라 도달한 뒤에 여는 클릭이 없다 — 부팅이 부르는 그 함수를 그대로 부른다',
      },
      // 미연결 한 줄의 [연결]을 눌러 Paper가 그린 「로그인 대기 중…」을 만든다.
      // fixture가 핸들러를 갈아끼웠으므로 실제 터미널 창은 열리지 않는다.
      { do: 'click', selector: '.onb-cli-row .uk-btn-ghost' },
      { do: 'settle' },
    ],
    root: '#onboard',
    // 제공자 이름(Paper의 'Claude Code'·'Gemini CLI'·'Grok CLI')은 fixture가 주는
    // 데이터라 문구가 못 된다. 남는 것은 앱이 리터럴로 그리는 제목·안내·라벨뿐이다.
    phrases: [
      '사용할 CLI를 연결합니다',
      'Athena는 자체 API 키를 사용하지 않습니다. 로그인한 계정으로 CLI를 제어합니다.',
      '계정 추가',
      '연결을 누르면 해당 CLI의 로그인 명령이 새 터미널 창에서 실행됩니다. 로그인은 그 창에서 완료하세요. 계정은 여러 개 연결할 수 있고, 활성 계정 하나가 명령을 받습니다.',
      '로그인 대기 중…',
      '계속',
    ],
    // Paper는 다계정 카드 하나(계정 두 줄)와 대기 중인 한 줄을 그린다. 단일 행
    // 개수는 안 적는다 — Paper는 넷째 제공자(Gemini)까지 그리는데 앱의 제공자는
    // 셋뿐이라(cli-accounts.js:13) 거기에 앱의 수를 적으면 앱이 정본이 된다.
    structure: [
      { what: 'count', selector: '.onb-cli-card', equals: 1 },
      { what: 'count', selector: '.onb-cli-account-row', equals: 2 },
      { what: 'count', selector: '.onb-cli-waiting', equals: 1 },
    ],
  },
  {
    board: '1FN-0', // 08 · 온보딩 — 계좌 연결 (AT-SY-003)
    window: 'shell',
    reach: [
      {
        do: 'eval',
        js: 'startOnboarding(3)',
        why: '온보딩 진입은 부팅 한 번뿐이라 도달한 뒤에 여는 클릭이 없다 — 부팅이 부르는 그 함수를 그대로 부른다',
      },
      { do: 'settle' },
    ],
    root: '#onboard',
    // 「모의-1」은 <input>의 placeholder라 문구가 못 된다(onboarding.js:338).
    // 마스크 점과 「붙여넣음 · 36자」는 값이라 애초에 후보에서 빠져 있다.
    phrases: [
      '증권 계좌를 연결합니다',
      '키움 모의투자 계좌를 연결합니다. 앱키는 이 컴퓨터의 자격증명 저장소에만 저장되고 화면에 다시 나타나지 않습니다.',
      'APP KEY',
      'SECRET KEY',
      '저장 위치',
      '검증 후 시작',
    ],
    // Paper의 입력 세 칸(별칭·APP KEY·SECRET KEY)과 저장 위치 상자 하나.
    // 발 부분은 안 적는다 — Paper는 [검증 후 시작] 하나인데 앱은 [이전]도 둔다.
    structure: [
      { what: 'count', selector: '.onb-field', equals: 3 },
      { what: 'count', selector: '.onb-input-row', equals: 3 },
      { what: 'count', selector: '.onb-savebox', equals: 1 },
    ],
  },
  {
    board: '2V0K-1', // 33 · 온보딩 — CLI 연결 실패 (AT-SY-002)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:cli-list', data: PAPER_CLI_PROVIDERS },
      { do: 'ipc-fixture', channel: 'athena:cli-login', data: CLI_LOGIN_NOT_INSTALLED },
      {
        do: 'eval',
        js: 'startOnboarding(2)',
        why: '온보딩 진입은 부팅 한 번뿐이라 도달한 뒤에 여는 클릭이 없다 — 부팅이 부르는 그 함수를 그대로 부른다',
      },
      // 07과 같은 자극에 로그인 결과만 실패다 — 그 한 클릭이 이 보드를 만든다.
      { do: 'click', selector: '.onb-cli-row .uk-btn-ghost' },
      { do: 'settle' },
    ],
    root: '#onboard',
    // Paper가 실패 행에 그린 안내문은 「Gemini CLI 실행 파일을 찾지 못했습니다…」인데
    // 앱에는 Gemini 제공자가 없어 그 문장은 어느 상태에서도 못 만든다 — 적지 않는다.
    phrases: [
      '사용할 CLI를 연결합니다',
      'Athena는 자체 API 키를 사용하지 않습니다. 로그인한 계정으로 CLI를 제어합니다.',
      '계정 추가',
      '연결 실패 · 재시도',
      '계속',
    ],
    structure: [
      { what: 'count', selector: '.onb-cli-card', equals: 1 },
      { what: 'count', selector: '.onb-cli-waiting.is-failed', equals: 1 },
    ],
  },

  // ---------- 인증 3장 (1-0) ----------
  // 셋 다 온보딩 3/3 안의 화면이다(chat.js showAuthConfirm). 계좌 단계에서 이 화면으로
  // 넘어오는 클릭은 앱키·시크릿 검증이 끝나야 생기므로, 온보딩 셋과 같은 이유로 앱 자신의
  // 진입점을 부른다(paper-screen-routes.test.js가 목록을 잠근다).
  {
    board: '1I0-0', // 19 · 인증 — OAuth 토큰 ready
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      { do: 'ipc-fixture', channel: 'athena:auth-token-status', data: AUTH_TOKEN_READY },
      { do: 'eval', js: "startOnboarding(3); showAuthConfirm('fx-a1')", why: '온보딩 인증 화면은 부팅이 딱 한 번 읽는 온보딩 안에만 있다 — 온보딩 창을 열고(startOnboarding), 계좌 등록이 끝났을 때 chat.js가 부르는 그 함수를 그대로 부른다' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#onboard',
    // 「3 / 3」·「모의-주력 · 등록됨」·「05:42:18」·「2026-08-25 21:12:04 만료」는 값이라
    // 안 넣는다. 아래 넷은 ready 상태에서만 그려진다(auth-screen.js paint) — 「연결 해제」는
    // ready·refreshing, 「지금 재발급」·안내문은 ready뿐이라 상태가 판정을 진다.
    phrases: [
      '키움 인증이 연결되었습니다',
      'Athena는 토큰을 저장하지 않습니다. 만료 전에 자동으로 다시 받습니다.',
      '재발급까지 남은 시간',
      '남은 시간이 10분 아래로 내려가면 자동으로 다시 받습니다. 직접 누를 필요는 없습니다.',
      '연결 해제',
      '지금 재발급',
      '계속',
    ],
    // Paper의 auth-status-rows는 uk-lrow 셋(계좌·자동 재발급·확인 주기)이고, 그중 첫
    // 줄의 프레임 이름이 「uk-lrow (클릭 → 계좌 전환)」다 — 그 한 줄만 눌린다.
    structure: [
      { what: 'count', selector: '.auth-timer-card', equals: 1 },
      { what: 'count', selector: '.auth-status-rows .uk-lrow', equals: 3 },
      { what: 'count', selector: '.auth-status-rows .uk-lrow.is-clickable', equals: 1 },
    ],
  },
  {
    board: '1KK-0', // 20 · 인증 — 토큰 4상태
    window: 'shell',
    // 보드 20은 화면이 아니라 같은 카드의 상태 네 칸을 나란히 세운 목록이다. 한 화면은
    // 한 상태만 그리므로 라우트는 그중 하나만 잰다 — 보드 19가 이미 지고 있는 ready를
    // 빼고, 나머지 셋의 머리인 needed를 잡는다(refreshing·expired는 이 화면의 전이
    // 상태라 단위 테스트가 진다, onboarding-flow.test.js 「Paper 28 재발급 중」).
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      { do: 'ipc-fixture', channel: 'athena:auth-token-status', data: AUTH_TOKEN_NEEDED },
      { do: 'eval', js: "startOnboarding(3); showAuthConfirm('fx-a1')", why: '온보딩 인증 화면은 부팅이 딱 한 번 읽는 온보딩 안에만 있다 — 온보딩 창을 열고(startOnboarding), 계좌 등록이 끝났을 때 chat.js가 부르는 그 함수를 그대로 부른다' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#onboard',
    // 「--:--:--」는 자릿수를 맞춘 표기라 값 쪽이다 — 안 넣는다. 남는 넷 중 「토큰이
    // 없다」·「인증 필요」는 needed 칸에만 있고, 「발급」은 needed·expired 칸의 버튼이다.
    phrases: ['토큰이 없다', '시 분 초', '인증 필요', '발급'],
    // Paper의 needed 칸만 만료 시각 줄이 없다(나머지 셋은 「2026-08-25 21:12:04 만료」를
    // 달고 있다). 숫자 자리는 흐린 대시 한 덩이 + 「시 분 초」 한 덩이다.
    structure: [
      { what: 'absent', selector: '.auth-timer-expiry:not(:empty)' },
      { what: 'count', selector: '.auth-timer-digits.is-dim', equals: 1 },
      { what: 'count', selector: '.auth-timer-units', equals: 1 },
    ],
  },
  {
    board: '1M3-0', // 21 · 인증 — 계좌 전환
    window: 'shell',
    // 보드 21의 머리는 보드 19와 같은 3/3이다 — 온보딩 안에서 계좌 행을 눌러 연 화면이다.
    // 앱은 온보딩일 때 그 진입로를 막고 있었다(auth-screen.js) — Paper 쪽으로 고쳤다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: SWITCH_ACCOUNTS },
      { do: 'ipc-fixture', channel: 'athena:auth-token-status', data: AUTH_TOKEN_READY },
      { do: 'eval', js: "startOnboarding(3); showAuthConfirm('fx-a1')", why: '온보딩 인증 화면은 부팅이 딱 한 번 읽는 온보딩 안에만 있다 — 온보딩 창을 열고(startOnboarding), 계좌 등록이 끝났을 때 chat.js가 부르는 그 함수를 그대로 부른다' },
      { do: 'click', selector: '.auth-status-rows .uk-lrow.is-clickable' },
      // Paper의 둘째 줄이 is-selected다 — 고른 계좌가 있어야 [전환하고 다시 인증]이 산다.
      { do: 'click', selector: '.switch-row:nth-child(2)' },
      { do: 'settle' },
    ],
    root: '#onboard',
    // 별칭 셋·「등록된 계좌 3」·「키움증권」·「모의」·「사용 중」·「선택」은 줄마다 달라지는
    // 값이라 안 넣는다. 남는 것은 경고문·흐름 네 마디·발치 안내·확정 버튼이다.
    phrases: [
      '전환하면 지금 토큰을 폐기하고 새 계좌로 다시 발급받습니다. 진행 중인 실시간 구독은 모두 끊겼다가 다시 등록됩니다.',
      '지금 토큰 폐기',
      '자격증명 교체',
      '새 토큰 발급',
      '실시간 재등록',
      '한 번에 한 계좌만 사용할 수 있습니다',
      '전환하고 다시 인증',
    ],
    // Paper의 switch-list 세 줄(사용 중 하나 + 고른 하나) · switch-flow 네 마디 ·
    // 그리고 이 화면이 온보딩 3/3 안이라는 것(onb-head의 「3 / 3」).
    structure: [
      { what: 'count', selector: '.switch-row', equals: 3 },
      { what: 'count', selector: '.switch-row.is-active', equals: 1 },
      { what: 'count', selector: '.switch-row.is-selected', equals: 1 },
      { what: 'count', selector: '.switch-flow-step', equals: 4 },
      { what: 'count', selector: '.onb-kicker', equals: 1 },
    ],
  },

  // ---------- 에이전트 4장 (A-2) ----------
  {
    board: 'ARM-0', // 02 · 에이전트 — 알람 센터 · 라이브 관제
    window: 'shell',
    reach: [
      { do: 'mode', view: 'agent' },
      // 「알람」 뷰를 실제로 연다 — 알람·라이브는 한 화면이고 기본 「작업」 뷰에서는
      // 통째로 hidden이다(agent-canvas.js:560, 토글은 :2027-2032 setActiveView).
      { do: 'click', selector: '.agent-view-tab[data-view="alerts"]' },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    // 라이브 컬럼은 fixture 없이도 그려진다(agent-canvas.js:59 머리말, :697, :727).
    phrases: [
      '작업',
      '알람',
      '라이브',
      '제안',
      '모두 읽음으로',
      '다음 24시간',
      '발화는 채팅으로 도착 — 여긴 관제만',
    ],
    // 통계 카드 4장은 「작업」 뷰의 것이라 이 뷰에서는 안 보이고, 보드 02도 안 그린다.
    structure: [
      { what: 'count', selector: '.agent-view-tab', equals: 4 },
    ],
  },
  {
    board: 'B57-0', // 03 · 에이전트 — 실행 이력·결과
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: WATCH_ROUTINE },
      { do: 'ipc-fixture', channel: 'athena:routine-runs', data: ROUTINE_RUNS },
      { do: 'mode', view: 'agent' },
      { do: 'wait', ms: 700 },
      { do: 'click', selector: '.agent-row' },
      { do: 'wait', ms: 200 },
      { do: 'click', selector: '.agent-history-open' },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    // 넷 다 드릴인에서만 보인다 — openHistory가 historyTabs·historyBody의 hidden을
    // 풀고 뷰 탭·통계·알람을 전부 숨긴다(agent-canvas.js:1099-1124). 가시 판정이라
    // 위 절차 여섯 스텝이 하나라도 빠지면 이 라우트는 실패한다.
    phrases: ['이력', '설정', '최근 30회', '30회 통계'],
    // 드릴인 세그먼트 [이력][설정] — Paper 보드 03 우상단.
    structure: [{ what: 'count', selector: '.agent-history-tab', equals: 2 }],
  },
  {
    board: 'BIM-0', // 04 · 에이전트 — 프로액티브
    window: 'shell',
    reach: [
      { do: 'mode', view: 'agent' },
      { do: 'click', selector: '.agent-view-tab[data-view="proactive"]' },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    phrases: ['지금 읽히는 성향', '말걸기 가드', '그래프 모드에서 근거 보기 →'],
    structure: [{ what: 'count', selector: '.agent-view-tab', equals: 4 }],
  },
  {
    board: 'BV0-0', // 05 · 에이전트 — 작업
    window: 'shell',
    reach: [
      { do: 'mode', view: 'agent' },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    // 통계 카드 4장의 라벨은 값이 없어도 그려진다(agent-canvas.js:218-269 buildStats).
    phrases: ['＋ 새 작업', '다음 실행', '오늘 발화', '성향 제안', '진행 중'],
    structure: [{ what: 'count', selector: '.agent-stat-card', equals: 4 }],
  },

  // ---------- 알림 파생 방 · 코드 알람 4장 (A-2) ----------
  {
    board: '56X-0', // 01 · 셸 — 알림 파생 방
    window: 'shell',
    // 방은 발화가 만든다 — 사이드바 「알림에서」 구역은 athena:routine-event 하나로만
    // 생기고(sidebar.js handleRoutineEvent), 그 방을 여는 다른 문이 앱에 없다.
    reach: [
      { do: 'send', channel: 'athena:routine-event', data: ROUTINE_FIRED },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '.sidebar-item.is-notify' },
      { do: 'settle' },
    ],
    root: '#roomHeadBanner',
    // 시각과 방 제목은 발화 봉투가 주는 값이라 한 글자도 안 넣는다. 남는 셋이
    // 이 머리의 전부다 — 갈래말·예외 창 표기·관제 창으로 합류하는 문.
    phrases: ['알림에서 시작된 방', '오브에서 넘어온 예외 창 — 관제 창과 별개', '관제 창으로 →'],
    // Paper의 합류 행에는 「이 감시 건 · 관제 대화 1개」도 있지만 그것은 세어 봐야
    // 아는 수라 앱에 없다 — 지어내지 않고 문도 구조도 버튼 하나만 적는다.
    structure: [
      { what: 'count', selector: '.room-head-join-btn', equals: 1 },
      { what: 'count', selector: '.room-head-kicker', equals: 1 },
    ],
  },
  {
    board: '446V-1', // 10 · 에이전트 — 알람 노드·흐름 · 검사 결과 · 승인
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: CODE_WATCH_DRAFT },
      { do: 'ipc-fixture', channel: 'athena:routine-detail', data: CODE_DETAIL_FIRST_CHECK },
      { do: 'mode', view: 'agent' },
      { do: 'wait', ms: 700 },
      { do: 'click', selector: '.agent-row' },
      { do: 'wait', ms: 400 },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    // 칸 제목·값·함수명은 전부 봉투가 주는 값이다. 남는 것은 칸 문법의 두 라벨,
    // 승인 패널의 문과 게이트 고지, 고치는 문, 설정 두 줄이다.
    phrases: [
      '들어감', '나옴', '이 알람 승인',
      '승인 전까지 실행 없음 · 채팅 칩으로도, 이 버튼으로도 — 같은 게이트',
      '고치기 — 말로', '확인 주기', '쿨다운',
    ],
    // Paper 보드 10의 노드 행은 네 칸이고, 아직 아무 칸도 고르지 않았으며
    // (칩 없음) 첫 검사라 바뀐 칸도 없다. 승인 패널의 문은 둘이다
    // ([이 알람 승인][취소] — 「고치기 — 말로」는 위 상태 제어 행에 있다).
    structure: [
      { what: 'count', selector: '.agent-node-card', equals: 4 },
      { what: 'absent', selector: '.agent-node-chip' },
      { what: 'absent', selector: '.agent-node-badge' },
      { what: 'count', selector: '.agent-code-approve-row button', equals: 2 },
    ],
  },
  // 44HD-1(11 · 노드에서 '이상해요' → AI가 고치고 다시 검사)에는 라우트를 두지
  // 않는다. 노드 행(「방금 바뀜」 둘 · 칩 둘)은 앱에 있지만, 이 보드를 이 보드이게
  // 하는 나머지 절반이 통째로 없다 — 「순환 · 물어봄 → 고침 → 검사 → 다시 그림」
  // 띠, 「다시 검사 · 지난 30일 · 자동 · 9초」 재검사 패널, 고치기 전후를 겹쳐
  // 그리는 발화 비교, 「한 바퀴 영수증 · 2번째 고침」과 「되돌리기」·「지난 고침
  // 1건」. 앱 전체 grep에서 순환·영수증·되돌리기·지난 고침은 0건이고, 백엔드에도
  // 근거가 없다(routines/models.py에 이전 버전 보관도 롤백 전이도 없고,
  // ALLOWED_TRANSITIONS는 draft/active/paused/cancelled뿐이다). 노드 행만으로
  // 초록을 만들면 보드 10과 같은 렌더러에 클릭 하나를 얹은 것이 되어, 앱이 이
  // 보드를 위해 만들어야 할 것을 아무 것도 못 박지 못한 채 남은 작업 목록에서만
  // 사라진다 — 43WD-1의 「만드는 중」 단계를 뺀 것과 같은 이유다.
  {
    board: '44RV-1', // 12 · 에이전트 — 활성 코드 알람 · 상세·발화 이력
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: CODE_WATCH_ACTIVE },
      { do: 'ipc-fixture', channel: 'athena:routine-detail', data: CODE_DETAIL_ACTIVE },
      { do: 'ipc-fixture', channel: 'athena:routine-runs', data: CODE_RUNS },
      { do: 'mode', view: 'agent' },
      { do: 'wait', ms: 700 },
      { do: 'click', selector: '.agent-row' },
      { do: 'wait', ms: 400 },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    phrases: [
      '코드 감시', '일시중지', '취소', '고치기 — 말로',
      '울린 기록 · 최근', '채팅에서 열기 ↗', '전체 이력 보기 →',
    ],
    // Paper 보드 12의 상태 제어 행은 [일시중지][취소][고치기 — 말로] 셋이고,
    // 켜진 알람에는 초안의 「검사」가 없다. 설정 요약은 확인 주기·쿨다운·만료
    // 세 줄이다 — 값(「1일」·「2026-10-03」)은 봉투가 주므로 개수로만 잰다.
    structure: [
      { what: 'count', selector: '.agent-code-controls button', equals: 3 },
      { what: 'absent', selector: '.agent-code-check-btn' },
      { what: 'count', selector: '.agent-view-tab', equals: 4 },
      { what: 'count', selector: '.agent-detail-field', equals: 3 },
    ],
  },

  // ---------- 화면 4장 (1-0 설정 3 + D-2 그래프 1) ----------
  {
    board: 'AJ-0', // 13 · 설정 — 셸 오버레이
    window: 'shell',
    // 설정 진입은 계정 메뉴 아니면 커맨드바다. 계정 행은 계좌가 없으면 숨으므로 커맨드바를 쓴다
    // (verify.js:105-119가 같은 이유로 같은 자극을 고른다).
    reach: [
      { do: 'command-bar', text: '설정' },
      { do: 'settle' },
    ],
    root: '#settings',
    phrases: [
      '↑↓ 이동 · Enter 선택 · Tab 패널 이동 · Esc 닫기',
      '글자 크기',
      '유리 투명도',
      'UI 배율',
      '접근성 — 이 컴퓨터의 OS 설정을 따른다',
    ],
    // 보드 13의 사이드바는 화면·계좌·모델·성향・이력 4줄이다(보드 14·18과 달리 MCP가 없다).
    structure: [{ what: 'count', selector: '.settings-nav-item', equals: 4 }],
  },
  {
    board: 'F9-0', // 14 · 설정 — 계좌 (AT-ST-001)
    window: 'shell',
    reach: [
      // 계좌 표 머리는 accounts.length>0일 때만 그려진다(settings-cards.js:430 emptyState
      // 대 :528 buildAccountsTable). fixture가 없으면 판정이 이 컴퓨터에 저장된 계좌
      // 유무에 좌우된다 — 라우트는 결정론이어야 한다.
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      { do: 'command-bar', text: '설정' },
      { do: 'click', selector: '.settings-nav-item[data-key="accounts"]' },
      { do: 'settle' },
    ],
    root: '#settings',
    phrases: [
      '+ 계좌 등록',
      '앱키·시크릿은 목록에 표시되지 않는다. 저장 위치는 OS 자격증명 저장소다.',
      '비활성 계좌를 누르면 활성으로 전환된다. 활성 계좌는 항상 하나다.',
      '연결 상태',
      '마지막 검증',
    ],
    structure: [],
  },
  {
    board: 'OJ-0', // 18 · 설정 — 모델 · AI 제공업체 계정
    window: 'shell',
    reach: [
      { do: 'command-bar', text: '설정' },
      { do: 'click', selector: '.settings-nav-item[data-key="model"]' },
      { do: 'settle' },
    ],
    root: '#settings',
    phrases: [
      'AI 제공업체 계정',
      'Athena는 이 컴퓨터의 Claude·Codex CLI 로그인을 그대로 쓴다. 질의는 활성 계정으로 실행되고, 모델·사고 강도는 공급자별로 정한다.',
      '+ 계정 추가',
      '사고 강도',
      // 「모델 이름 직접 입력」은 <input>의 placeholder라 문구가 못 된다
      // (settings-cards.js:1127이 :1101 makeCommittableInput에 넘긴다). 대신
      // 계정 블록 안내문을 쓴다 — 계정 유무와 무관하게 늘 그려진다(:1077).
      '이 컴퓨터에서 감지된 Claude 계정이다. 새 계정은 여기에 추가된다.',
    ],
    structure: [],
  },
  {
    board: '3NE-0', // 01 · 셸 — 그래프 모드 · 요약 뷰
    window: 'shell',
    reach: [
      { do: 'mode', view: 'graph' },
      { do: 'settle' },
    ],
    // 보드가 셸 창 전체(요약 표 + 대화 머리)라 root도 셸이다. 요약 표는 shell.html:173에서
    // hidden으로 시작하고 그래프 모드 진입만이 그것을 푼다 — 가시 판정이라 아래 넷과
    // 뷰 토글 셋이 모드 전환을 실제로 진다(textContent였다면 정적 마크업만으로 통과했다).
    root: '#shell',
    phrases: ['요약', '수집·노출', '그래프에게 묻기', '답이 캔버스를 바꿉니다'],
    structure: [{ what: 'count', selector: '#graphSummaryHeader .view-toggle-tab', equals: 3 }],
  },

  // ---------- 계좌 등록 3상태 · 주문 2장 (1-0) ----------
  // 15·16·17은 보드 14의 계좌 카드 위에 열리는 **같은 시트의 세 단계**다
  // (settings-cards.js accountSheetState: idle → verifying → failed | verified).
  // 셋을 가르는 것은 athena:account-register가 무엇을 답하느냐뿐이라, 시트를 여는
  // 데까지는 보드 14와 같은 자극을 쓰고 그 채널 하나만 달리 건다.
  {
    board: 'XI-0', // 15 · 계좌 등록 — 인증 확인 중 (AT-ST-002)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      // 「확인 중」은 답이 오기 전까지만 있는 상태다 — 값을 돌려주면 IPC 한 왕복만큼만
      // 살아 판정이 시계에 좌우된다. 답하지 않는 핸들러가 그 한 프레임을 세운다.
      { do: 'ipc-hang', channel: 'athena:account-register' },
      { do: 'command-bar', text: '설정' },
      { do: 'click', selector: '.settings-nav-item[data-key="accounts"]' },
      { do: 'click', selector: '.card.accounts .uk-settings-actions .uk-btn-ghost' },
      { do: 'click', selector: '.card.accounts .uk-sheet .uk-btn-primary' },
      { do: 'settle' },
    ],
    root: '#settings',
    // 마스크 점·「붙여넣음 · 36자」·「모의-주력」은 값이거나 <input>의 placeholder라
    // 문구가 못 된다. Paper가 상태 행 아래에 한 줄 더 그린 「APP KEY와 SECRET KEY로
    // 계좌 연결 권한을 확인하고 있습니다」도 안 적는다 — 앱은 그 자리에 정적 안내를
    // 두지 않고 상태 행 한 문장이 혼자 말한다(settings-cards.js의 같은 자리 주석).
    // 확정 버튼 라벨 「확인 중…」(11B-0)은 문구로 못 잰다 — 판정은 root 아래 가시
    // 텍스트 전체에 대한 includes라 바로 위 안내 줄에 통째로 들어 있다. 그 자리는
    // 아래 structure가 라벨까지 재고, 문구는 아직 안 쓴 108-0이 맡는다.
    phrases: [
      '계좌 등록',
      '모의투자 계좌의 APP KEY / SECRET KEY를 등록한다',
      '저장·표시 원칙',
      '이 컴퓨터에서만 쓰는 이름이다',
      '토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다',
    ],
    // 확인 중을 다른 두 상태와 가르는 것은 문구가 아니라 **잠김**이다: 입력 셋과
    // 확정 버튼이 모두 잠기고, 실패 상자는 아직 없다. 실패 상자는 셈이 아니라
    // 문면으로 재 둔다 — 이 보드가 깨지는 길은 등록 왕복이 답을 돌려준 것뿐이라,
    // 그때 뜬 사유가 리포트에 그대로 남아야 원인을 이름으로 가를 수 있다. 실측
    // 대조군: 위 ipc-hang을 빼고 돌리면 실패 상자가 「입력값을 확인한다」로 뜬다
    // (빈 입력에 진짜 핸들러가 답한 것이다 — 키움 왕복은 그 전에 끊긴다). 리포트에
    // 그 문면이 보이면 앱 회귀가 아니라 하네스의 가로채기가 안 걸린 것이다.
    structure: [
      { what: 'count', selector: '.uk-sheet .uk-input', equals: 3 },
      { what: 'count', selector: '.uk-sheet .uk-input:disabled', equals: 3 },
      { what: 'order', selector: '.uk-sheet .uk-btn-primary:disabled', equals: ['확인 중…'] },
      { what: 'count', selector: '.uk-sheet .uk-bullet-item', equals: 4 },
      { what: 'order', selector: '.uk-sheet .uk-error', equals: [] },
    ],
  },
  {
    board: 'FLM-0', // 16 · 계좌 등록 — 인증 실패 (AT-ST-002)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      { do: 'ipc-fixture', channel: 'athena:account-register', data: ACCOUNT_VERIFY_FAILED },
      { do: 'command-bar', text: '설정' },
      { do: 'click', selector: '.settings-nav-item[data-key="accounts"]' },
      { do: 'click', selector: '.card.accounts .uk-settings-actions .uk-btn-ghost' },
      { do: 'click', selector: '.card.accounts .uk-sheet .uk-btn-primary' },
      { do: 'settle' },
    ],
    root: '#settings',
    // 「다시 검증」(FM4-0)도 XI-0의 라벨과 같은 이유로 문구가 못 된다 — 바로 위
    // 안내 줄의 「…다시 검증할 수 있습니다」에 포함으로 걸린다. 라벨은 structure가 잰다.
    phrases: [
      '모의투자 계좌의 APP KEY / SECRET KEY를 등록한다',
      '저장·표시 원칙',
      '이 컴퓨터에서만 쓰는 이름이다',
      '검증에 실패해 저장하지 않았습니다. 키를 수정한 뒤 다시 검증할 수 있습니다',
      '인증 실패 — APP KEY 또는 SECRET KEY를 확인해 주세요',
    ],
    // 실패는 시트를 닫지 않고 입력을 되돌려 준다 — 그래서 「다시 검증」이 눌린다.
    // 그 라벨이 이 보드의 어포던스라 문면까지 잰다: 「검증 후 저장」으로 되돌아가면
    // 실패 분기가 깨진 것이다. 틀린 칸의 테두리 셈은 안 적는다: Paper는 FLM-0에
    // is-error 프레임을 그리지 않았다.
    structure: [
      { what: 'count', selector: '.uk-sheet .uk-error', equals: 1 },
      { what: 'order', selector: '.uk-sheet .uk-btn-primary', equals: ['다시 검증'] },
      { what: 'absent', selector: '.uk-sheet .uk-success' },
      { what: 'absent', selector: '.uk-sheet .uk-input:disabled' },
    ],
  },
  {
    board: 'FPE-0', // 17 · 계좌 등록 — 확인 완료 (AT-ST-002)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      { do: 'ipc-fixture', channel: 'athena:account-register', data: ACCOUNT_VERIFY_OK },
      { do: 'command-bar', text: '설정' },
      { do: 'click', selector: '.settings-nav-item[data-key="accounts"]' },
      { do: 'click', selector: '.card.accounts .uk-settings-actions .uk-btn-ghost' },
      { do: 'click', selector: '.card.accounts .uk-sheet .uk-btn-primary' },
      { do: 'settle' },
    ],
    root: '#settings',
    phrases: [
      '모의투자 계좌의 APP KEY / SECRET KEY를 등록한다',
      '저장·표시 원칙',
      '확인이 완료되었습니다. 저장하면 OS 자격증명 저장소에 암호화됩니다',
      '확인 완료 — 모의투자 계좌 연결 권한을 확인했습니다',
      '계좌 저장',
    ],
    // 검증과 저장이 갈려 있다는 것이 이 보드다 — 확인 상자가 서고, 실패 상자는 없으며,
    // 아직 저장 전이라 입력은 다시 열려 있다.
    structure: [
      { what: 'count', selector: '.uk-sheet .uk-success', equals: 1 },
      { what: 'absent', selector: '.uk-sheet .uk-error' },
      { what: 'absent', selector: '.uk-sheet .uk-input:disabled' },
    ],
  },
  {
    board: '11D-0', // 24 · 주문 — 거래 기능 연결 안내
    window: 'shell',
    // 게이트 시트를 여는 문은 계좌 행의 주문 API 칩 하나다(settings-cards.js
    // buildAccountRow의 orderApiChip). 첫 줄이 Paper가 시트를 연 그 계좌다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      { do: 'command-bar', text: '설정' },
      { do: 'click', selector: '.settings-nav-item[data-key="accounts"]' },
      { do: 'click', selector: '.card.accounts .uk-col-orderapi .uk-pill' },
      { do: 'settle' },
    ],
    root: '#settings',
    // TR 코드·계열 이름·「열리는 것 · 12건 · 모의 계좌 대상」은 값이라 안 넣는다.
    // 머리의 「현재 OFF」도 안 적는다 — Paper는 같은 보드에서 그 계좌의 주문 API를
    // 표에서 ON, 시트 머리에서 OFF로 그려 둘이 서로 어긋난다.
    phrases: [
      '주문 API 활성화',
      '열리지 않는 것',
      'AI가 이 계좌의 주문 API를 호출하도록 허용',
      '주문 API 허용 (토글)',
      '로컬 인증 토큰 설정',
      '언제든 설정에서 OFF로 되돌릴 수 있다. 되돌리면 즉시 반영된다.',
    ],
    // Paper의 두 칸(열리는 것 세 줄 · 열리지 않는 것 세 줄) · 토글 하나 · 체크리스트 두 줄.
    structure: [
      { what: 'count', selector: '.uk-sheet .uk-tr-row', equals: 3 },
      { what: 'count', selector: '.uk-sheet .uk-closed-item', equals: 3 },
      { what: 'count', selector: '.uk-sheet .uk-toggle', equals: 1 },
      { what: 'count', selector: '.uk-sheet .uk-checklist-row', equals: 2 },
    ],
  },
  {
    board: '1OP-0', // 22 · 주문 — 검토·영향·확인
    window: 'shell',
    // 주문 티켓은 셸 안의 형제 오버레이(#order)이고, 그 문은 발화 턴의 [주문 티켓
    // 열기] 하나다(chat.js의 fired 분기). 그래서 보드 09와 같은 봉투를 쏘고 그
    // 버튼을 누른다 — 이 화면은 검토까지이고, 집행은 사람이 한 번 더 눌러야 한다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:account-list', data: ORDER_GATE_OFF_ACCOUNTS },
      { do: 'send', channel: 'athena:routine-event', data: ROUTINE_FIRED },
      { do: 'click', selector: '.routine-approval-actions .routine-btn' },
      // 게이트 한 줄은 계좌 목록 왕복이 끝나야 확정된다(그전엔 「계좌 확인 중…」).
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#order',
    // 종목·사유·관측값·총액은 전부 값이라 안 넣는다. 수량 비율 칩(10% · 25% · 50% ·
    // 최대)과 발치 각주는 앱에 없어 적지 않는다 — 거기에 앱의 모양을 적으면 앱이 정본이 된다.
    // 방향 버튼은 「판매」로만 잰다. 「구매」는 같은 카드의 「구매하기」에 포함으로 걸려
    // 방향 버튼이 사라져도 통과하니, 그 자리는 아직 안 쓴 「수량」이 맡는다.
    phrases: [
      'Esc 닫기 — 실행 전에는 아무 일도 일어나지 않습니다',
      '수량',
      '판매',
      '가격',
      '시장가 체결',
      '활성 계좌의 주문 API가 OFF입니다 — 설정 › 계좌에서 게이트를 여세요.',
      '구매하기',
    ],
    // 티켓 카드 하나에 가격 세그먼트 둘(지정가 · 시장가)이 Paper가 그린 그대로다.
    structure: [
      { what: 'count', selector: '.ticket-card', equals: 1 },
      { what: 'count', selector: '.ticket-seg', equals: 2 },
    ],
  },

  // ---------- 셸·그래프 2장 (1-0) ----------
  {
    board: '25Q-0', // 09 · 셸 — 질문 입력 · Task Canvas
    window: 'shell',
    // 보드 09는 대화 영역에 턴 셋(완료·진행 중·능동)을 겹쳐 그린다. 그중 도달
    // 절차로 결정론이 되는 것은 능동 턴 하나다 — 앞의 둘은 실제 질의가 끝나야
    // 생기고, 그 질의는 CLI와 백엔드가 무엇을 답하느냐에 좌우된다. 능동 턴은
    // 반대로 값이 봉투에 다 들어 있어 앱이 그것을 1:1로 옮겨 그린다.
    reach: [
      { do: 'send', channel: 'athena:routine-event', data: ROUTINE_FIRED },
      { do: 'settle' },
    ],
    root: '#app',
    // 넷 다 봉투와 무관하게 늘 같은 문구다(routine-turn.js: modeText 기본값·
    // bodyNote·각주 틀, chat.js:2984 패널 제목). 종목·관측값·임계·경과는 값이라
    // 안 적는다. 「무엇이든 물어보세요」는 <textarea>의 placeholder라 문구가 못
    // 된다(shell.html:358) — 「ESC 중단」은 Paper 44가 입력행에서 걷어낸 뒤로
    // 앱이 그리지 않으므로(shell.html:330 주석) 역시 안 적는다.
    phrases: [
      '주기 확인',
      '감시 조건',
      '값은 발화 시점 기준입니다 — 최신 확인은 다시 물어봐 주세요.',
      "루틴 '삼성전자 88,000' · 에이전트 발화 — 묻지 않은 턴입니다",
    ],
    // 능동 턴 하나에 조건 패널 하나 — Paper의 「turn-agent (능동 턴) — 조건 패널
    // 형식」 그대로다. 조건 행 수는 안 적는다: Paper는 셋을 그렸지만 봉투에는
    // 조건이 하나뿐이라(routine-turn.js conditions 주석) 거기에 1을 적으면 앱이
    // 정본이 된다.
    structure: [
      { what: 'count', selector: '.turn-agent', equals: 1 },
      { what: 'count', selector: '.agent-watch', equals: 1 },
    ],
  },
  {
    board: '3VHD-1', // 08 · 그래프 — 되물을 것들 카드 · 지난 대화 읽기 전용
    window: 'shell',
    // 카드를 여는 클릭은 확인 필요 배너의 CTA 하나뿐이고(canvas.js:3653
    // onConfirmCta), 그 배너는 요약 표가 한 번 실릴 때만 그려진다. 표를 싣는
    // 세 자리 중 클릭으로 닿는 것이 없어(부팅 프리페치·필터 select의 change·
    // 그래프 갱신 이벤트) 앱이 스스로 쓰는 갱신 이벤트를 그대로 쏜다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:brain-suggested-questions', data: BRAIN_QUESTIONS },
      { do: 'mode', view: 'graph' },
      { do: 'send', channel: 'athena:brain-graph-updated', data: null },
      { do: 'click', selector: '#graphConfirmBanner .confirm-banner-cta' },
      { do: 'settle' },
    ],
    root: '#app',
    // 제목·부제·근거는 fixture가 주는 값이라 한 글자도 안 넣는다. 남는 것은 앱이
    // 리터럴로 그리는 채팅 머리 두 줄(controller.js CHAT_HEAD_COPY)과 카드의
    // 안내문·선택지 셋이다. 「그래프에 대해 물어보세요」는 placeholder라 못 쓴다.
    //
    // Paper가 오른쪽에 함께 그린 B판(지난 대화 읽기 전용 — 「과거 대화 · …」 배너와
    // 「현재 대화로」)은 적지 않는다. 앱은 과거 대화를 배너 없이 조용히 복원하고
    // 읽기 전용으로 잠그지도 않는다(chat.js:2189 「배너는 없다」, 2026-09-05 사용자
    // 정정) — Paper와 앱이 실제로 어긋나는 자리다.
    phrases: [
      '그래프에게 묻기',
      '답이 캔버스를 바꿉니다',
      '답하면 채팅으로 보내지고, 그 답이 그래프를 갱신합니다.',
      '건너뛰기',
      '아니다',
      '맞다',
      'Ctrl Enter',
    ],
    // Paper의 버튼 행 — [건너뛰기 Esc][아니다][맞다 Ctrl Enter], 키 힌트는 둘.
    structure: [
      { what: 'count', selector: '.question-card-btn', equals: 3 },
      { what: 'count', selector: '.question-card-key', equals: 2 },
    ],
  },

  // ---------- 그래프 5장 (D-2) ----------
  // 넷 다 같은 봉투 넷(군집 지도 · 성향 신호 · 숨은 연관 · 되물을 것 없음)에서
  // 그려진다 — 그래프 화면은 브레인이 준 것을 그대로 옮겨 그리는 자리라, 봉투를
  // 안 박으면 판정이 이 컴퓨터에 쌓인 대화에 좌우된다. 갱신 이벤트를 스스로
  // 쏘는 것은 보드 08(3VHD-1)과 같은 이유다: 부팅 프리페치는 창을 다시 읽는
  // 러너보다 먼저 끝나 있고, 표를 다시 싣는 클릭이 앱에 없다.
  {
    board: '4AN-0', // 02 · 셸 — 그래프 요약 · 행 선택
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:brain-cluster-map', data: GRAPH_CLUSTER_MAP },
      { do: 'ipc-fixture', channel: 'athena:brain-profile-summary', data: GRAPH_PROFILE_SIGNALS },
      { do: 'ipc-fixture', channel: 'athena:brain-surprising-connections', data: GRAPH_HIDDEN_LINKS },
      { do: 'ipc-fixture', channel: 'athena:brain-suggested-questions', data: GRAPH_NO_QUESTIONS },
      { do: 'ipc-fixture', channel: 'athena:brain-entity-timeline', data: GRAPH_TIMELINE },
      { do: 'mode', view: 'graph' },
      { do: 'send', channel: 'athena:brain-graph-updated', data: null },
      // 보드가 그린 것은 「행이 하나 골라진」 요약이다. 그 행을 이름으로 집는다 —
      // 첫 행을 누르면 출처가 하나뿐인 대상이 골라져 티어 대조가 안 뜬다.
      { do: 'click', selector: '.summary-row[data-entity-id="fx-turnover"]' },
      { do: 'settle' },
    ],
    root: '#shell',
    // 대상·관계·근거·보강, 군집 이름, 「보강 21회로…」 같은 것은 전부 봉투가 주는
    // 값이라 한 글자도 안 넣는다. 남는 것은 앱이 리터럴로 그리는 제목·탭·버튼이다.
    // 열 머리는 안 적는다 — Paper는 넷(대상·관계·근거·보강)인데 앱은 출처·최근을
    // 더해 여섯이다(summary-table.js COLUMN_HEADS). 「체결 · 잔고」도 안 적는다:
    // 앱의 티어 라벨은 가운뎃점에 공백이 없는 「체결·잔고」다.
    phrases: [
      '지금 읽히는 성향',
      '성향 신호',
      '숨은 연관',
      '선택 해제',
      '두 출처가 다르게 말합니다',
      '채팅에서 답하기',
    ],
    // 표 다섯 줄 · 패널 탭 둘 · 티어 카드 둘(체결·잔고와 대화) — Paper가 그린 수
    // 그대로다. 관계 목록은 Paper 02에 없고 앱도 표에서 고른 선택에는 안 그린다.
    structure: [
      { what: 'count', selector: '.summary-row', equals: 5 },
      { what: 'count', selector: '.panel-tab', equals: 2 },
      { what: 'count', selector: '.panel-tier-card', equals: 2 },
      { what: 'absent', selector: '.panel-relations' },
    ],
  },
  {
    board: '4IA-0', // 03 · 그래프 — 기본 군집 지도
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:brain-cluster-map', data: GRAPH_CLUSTER_MAP },
      { do: 'ipc-fixture', channel: 'athena:brain-profile-summary', data: GRAPH_PROFILE_SIGNALS },
      { do: 'ipc-fixture', channel: 'athena:brain-surprising-connections', data: GRAPH_HIDDEN_LINKS },
      { do: 'ipc-fixture', channel: 'athena:brain-suggested-questions', data: GRAPH_NO_QUESTIONS },
      { do: 'mode', view: 'graph' },
      // 지도 표면은 요약 헤더의 [그래프] 탭이 연다(canvas.js SURFACE_TAB_IDS).
      { do: 'click', selector: '#graphViewTab' },
      { do: 'send', channel: 'athena:brain-graph-updated', data: null },
      { do: 'settle' },
    ],
    root: '#shell',
    // 노드 이름은 캔버스에 그려져 글자가 아니고(live-map.js), 범례 여섯 줄
    // (색 = 군집 · 원 크기 = 연결 수 · 사실 · 추론 · 불확실 · 숨은 연관 — 군집을
    // 넘는 연결)은 앱이 아예 안 그린다 — 둘 다 여기 안 적는다.
    phrases: [
      '요약',
      '수집·노출',
      '테마 지도',
      '노드를 끌어 옮길 수 있습니다 · 휠 또는 Ctrl+휠로 확대 · 채팅으로 물어도 같은 곳이 열립니다',
      '그래프에게 묻기',
      '답이 캔버스를 바꿉니다',
    ],
    // 지도 헤더의 탭 셋 · 안내 바 하나, 그리고 요약 표가 물러났다는 것.
    structure: [
      { what: 'count', selector: '#graphHeader .view-toggle-tab', equals: 3 },
      { what: 'count', selector: '#graphMapGuide', equals: 1 },
      { what: 'absent', selector: '#graphSummaryTable' },
    ],
  },
  {
    board: '31H-0', // 04 · 그래프 — 노드 선택 · 공통 패널
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:brain-cluster-map', data: GRAPH_CLUSTER_MAP },
      { do: 'ipc-fixture', channel: 'athena:brain-profile-summary', data: GRAPH_NODE_SIGNALS },
      { do: 'ipc-fixture', channel: 'athena:brain-surprising-connections', data: GRAPH_HIDDEN_LINKS },
      { do: 'ipc-fixture', channel: 'athena:brain-suggested-questions', data: GRAPH_NO_QUESTIONS },
      { do: 'ipc-fixture', channel: 'athena:brain-entity-timeline', data: GRAPH_TIMELINE },
      { do: 'mode', view: 'graph' },
      { do: 'click', selector: '#graphViewTab' },
      { do: 'send', channel: 'athena:brain-graph-updated', data: null },
      // 지도의 노드는 캔버스에 그려져 누를 DOM이 없다. 채팅이 노드를 골라 달라고
      // 할 때 앱이 스스로 타는 그 경로를 그대로 쓴다(canvas.js athena:graph-chat-action
      // → graphMode.selectNode) — 사람이 노드를 눌렀을 때와 같은 함수다.
      // 고르기 전에 지도가 한 번 그려져 있어야 한다: 선택은 마지막 배치에서
      // 노드를 찾아 군집·연결 수를 읽으므로(controller.js selectNode → findNode),
      // 배치가 없으면 헤더도 관계 목록도 비어 버린다.
      { do: 'wait', ms: 1500 },
      { do: 'send', channel: 'athena:graph-chat-action', data: { kind: 'select', entityId: 'fx-hanmi' } },
      { do: 'settle' },
    ],
    root: '#shell',
    // 노드 이름·종목 코드·군집 이름·근거 절은 전부 봉투가 주는 값이다. 「삭제」도
    // 안 적는다 — Paper는 세 행 전부에 붙였는데 앱은 숨은 연관 행에는 안 붙인다
    // (controller.js: 확정된 관계가 아니라 분석이 띄운 표면이라 손잡이를 뺀다).
    phrases: [
      '테마 지도',
      '선택 해제',
      '이 노드의 관계',
      '왜 숨은 연관인가',
      '이 그래프에서 가장 놀라운 연결입니다',
      '이 연결을 확인하지 않으셨습니다.',
      '채팅에서 물어보기',
    ],
    // 관계 세 줄(성향 · 구조 · 숨은)·최근 변화 세 줄·패널 탭 둘 — Paper가 그린
    // 수 그대로다. 요약 표는 물러나 있어야 한다.
    structure: [
      { what: 'count', selector: '.panel-relation-row', equals: 3 },
      { what: 'count', selector: '.panel-change-row', equals: 3 },
      { what: 'count', selector: '.panel-tab', equals: 2 },
      { what: 'absent', selector: '#graphSummaryTable' },
    ],
  },
  {
    board: '2FIA-2', // 05 · 그래프 — 수집·노출·브레인 제어
    window: 'shell',
    // 이 화면은 브레인이 준 그래프가 아니라 이 컴퓨터의 설정을 그린다
    // (settings-cards.js readGraphSettings) — 검사 프로필이 비어 있으므로 기본값
    // 그대로다. 봉투가 필요 없는 유일한 그래프 보드다.
    reach: [
      { do: 'mode', view: 'graph' },
      { do: 'click', selector: '#settingsViewTab' },
      { do: 'settle' },
    ],
    // 보드가 그린 것은 셸 전체가 아니라 그래프 패널 하나다.
    root: '#graphSettingsCanvas',
    // 배치 주기·수동 실행의 설명문 두 줄은 안 적는다 — 앱이 2026-09-03 실사용
    // 지적을 받아 「무엇을 하는 주기인가 → 지금 값 → 어디서 바꾸나」로 다시 쓴
    // 자리라 Paper의 문장과 다르다. 「브레인 준비됨」도 안 적는다: 배지 문구가
    // 백엔드 기동 여부로 갈려 이 검사에서 못 박을 수 없다.
    phrases: [
      '그래프 수집과 노출',
      '무엇을 읽고 누구에게 보일지',
      '보유잔고',
      '조회 주기',
      '브레인 상태',
      '이 화면이 바꿀 수 있는 값과 아닌 값',
      '전체 삭제',
    ],
    // 카드 둘(수집과 노출 · 브레인 상태) · 수집 소스 3열 · 헤더 탭 셋.
    structure: [
      { what: 'count', selector: '.graph-settings-card', equals: 2 },
      { what: 'count', selector: '.graph-settings-source', equals: 3 },
      { what: 'count', selector: '#graphSettingsHeader .view-toggle-tab', equals: 3 },
    ],
  },

  {
    board: '2QA3-2', // 06 · 그래프 — 헤더 필터 (기간·정렬·연결 수)
    window: 'shell',
    // Paper는 헤더 세 판(요약 기본값 · 요약에 값이 걸린 것 · 지도)을 나란히 그리고
    // 그 아래에 「무엇을 실제로 거는가」 표를 붙였다. 앱은 한 번에 한 헤더만 그리므로
    // 도달할 수 있는 것은 그중 하나다 — 기본값 판을 잡는다. 값이 걸린 판을 만들려면
    // 칩을 바꿔야 하는데, 그 선택은 localStorage에 남아(graph-mode-prefs.js) 다음
    // 라우트까지 따라간다. 되돌리는 어휘가 표에 없으므로 만들지 않는다.
    reach: [
      { do: 'mode', view: 'graph' },
      { do: 'settle' },
    ],
    root: '#graphSummaryHeader',
    // 칩에 찍힌 「최근 90일」·「보강 순」은 문구가 못 된다 — 앱의 칩은 select라 그
    // 글자가 <option> 안에 있고, 닫힌 select의 option은 그려지지 않는다(실측:
    // 이 둘만 phrase_missing이었다). placeholder와 같은 갈래다(파일 머리 주석).
    // 지도 헤더의 「연결 전체」도 안 적는다: 앱은 그 자리를 「연결 제한 없음」으로
    // 쓴다(graph-filters.js — 「전체」로는 이것이 거는 조건인지 안 읽힌다는
    // 2026-09-03 실사용 지적). 표의 「컨트롤·선택지·무엇을 실제로 거는가」는 화면이
    // 아니라 이 보드가 옆에 붙인 설명 표라 앱 어디에도 없다.
    phrases: ['요약', '그래프', '수집·노출'],
    // 그래서 판정을 지는 것은 구조다. Paper의 요약 헤더는 탭 셋이 이 차례이고
    // 오른쪽 칩이 둘(기간·정렬)이며, 셋째 칩인 연결 수는 이 보드가 「지도에만
    // 있다」고 못박은 그대로 여기 없다.
    structure: [
      {
        what: 'order',
        selector: '.view-toggle-tab',
        equals: ['요약', '그래프', '수집·노출'],
      },
      { what: 'count', selector: '.filter-chip', equals: 2 },
      { what: 'absent', selector: '#graphDegreeFilter' },
    ],
  },

  // ---------- 대화·계정 2장 (1-0) ----------
  {
    board: '1Y3-0', // 11 · 대화 — 모델 팝오버 · 루틴 승인
    window: 'shell',
    // 툴바 [모델]이 팝오버를 여는 클릭이다(chat.js toggleModelPopover — 키우미
    // 메뉴 '모델 설정'도 같은 곳으로 간다). 팝오버는 shell.html에서 hidden으로
    // 시작하므로 이 한 클릭이 없으면 root부터 안 그려진다.
    reach: [
      { do: 'click', selector: '#modelBtn' },
      { do: 'settle' },
    ],
    // 보드가 그린 두 덩이 중 도달 절차로 결정론이 되는 것은 팝오버뿐이라 root도 팝오버다.
    //
    // 오른쪽 「루틴 승인 카드 · 진행 상태」는 적지 않는다. 승인 카드의 머리·버튼이
    // Paper 보드 43에서 갈렸고 앱은 그 새 보드를 따른다 — 「작업 요약」·「초안」
    // 두 pill과 [미리보기 실행][바로 활성화][고칠 게 있어]다(chat.js:3423 주석이
    // 그 보드를 가리킨다). 여기에 보드 11의 「승인 필요」·[승인][거절]을 적으면
    // 두 Paper 보드 중 오래된 쪽을 정본으로 삼는 것이 된다. 진행 중·실패·중단 턴은
    // 실제 질의가 끝나야 생겨 CLI와 백엔드가 무엇을 답하느냐에 좌우된다.
    //
    // 왼쪽 입력행의 「답변 중…」·「ESC 중단」과 control-strip의 「CLAUDE」·
    // 「OPUS · HIGH」도 안 적는다 — 잠금 힌트는 실행 중에만 그려지고, 필 줄은
    // Paper 44·45 v5가 걷어낸 뒤로 앱이 그리지 않는다(shell.html:325 주석).
    root: '#modelPopover',
    // Paper의 머리말은 「모델」·「사고 강도」 둘인데 앱은 공급자별로 넷을 그린다
    // (Claude 모델·Claude 사고 강도·Grok 모델·Grok 사고 강도). 포함 판정이라
    // Paper의 두 낱말은 그 안에 있지만, 머리말 **개수**는 적지 않는다 — Grok은
    // 이 보드 뒤에 붙은 실기능이라 거기에 4를 적으면 앱이 정본이 된다.
    phrases: ['모델', '사고 강도', 'fable', 'opus', 'sonnet', 'haiku', 'max'],
    // Paper의 모델 행 그대로 — 다섯 칩이 이 차례다. 사고 강도 행은 안 적는다:
    // Paper는 다섯(low~max)인데 앱은 앞에 「기본」(값 위임)이 하나 더 있다.
    // 팝오버의 첫 행이 모델 행이라는 것을 :nth-child(2)가 진다(1은 머리말).
    structure: [
      {
        what: 'order',
        selector: '.mp-row:nth-child(2) .mp-chip',
        equals: ['기본', 'fable', 'opus', 'sonnet', 'haiku'],
      },
    ],
  },
  {
    board: '3JL-0', // 12 · 계정 메뉴 — 설정 진입
    window: 'shell',
    reach: [
      // 계정 행은 활성 계좌가 없으면 통째로 숨는다(sidebar.js:1309) — 보드 14와
      // 같은 이유로 같은 fixture를 쓴다.
      { do: 'ipc-fixture', channel: 'athena:account-list', data: PAPER_ACCOUNTS },
      // 사이드바는 계좌를 부팅 때 한 번 읽고 다음 폴링이 30초 뒤다(sidebar.js:1359).
      // fixture는 그 한 번 뒤에 걸리므로, 앱이 스스로 계정 발치를 다시 읽을 때 쓰는
      // 이벤트를 그대로 쏴 다시 읽힌다(sidebar.js:1364 athena:auth-token-changed).
      { do: 'send', channel: 'athena:auth-token-changed', data: null },
      { do: 'wait', ms: 500 },
      { do: 'click', selector: '#sidebarAccountRow' },
      { do: 'settle' },
    ],
    // 보드가 그린 셸 뒤판(사이드바·빈 캔버스·대화)은 보드 06이 이미 지고 있다.
    // 이 보드만의 것은 계정 행이 띄우는 팝업 메뉴라 root도 그것이다 — 메뉴는
    // hidden으로 시작하므로 위 절차가 하나라도 빠지면 root부터 안 그려진다.
    root: '#sidebarAccountMenu',
    // 계정 별칭·「주문 API 꺼짐」·「5시간 42분 남음」·「2개」는 값이라 안 넣는다
    // (주문 API 상태는 계좌마다 다르고, 보드 14는 같은 계좌를 ON으로 그린다).
    // 남는 것은 앱이 리터럴로 그리는 항목 라벨과 단축키뿐이다.
    phrases: ['토큰 사용량', '계좌 전환', '설정', 'Ctrl+,'],
    // Paper의 팝업 메뉴 — 계정 헤더 하나 + 항목 셋(사용량·계좌·설정).
    structure: [
      { what: 'count', selector: '.sidebar-menu-head', equals: 1 },
      { what: 'count', selector: '.sidebar-menu-item', equals: 3 },
    ],
  },

  // ---------- 모드·빈 화면 2장 (1-0) ----------
  {
    board: 'AMZ-0', // 25 · 모드 전환 — 대화 유지·작업공간 교체
    window: 'shell',
    // 모드 네비는 shell.html이 정적으로 그리는 다섯 줄이라 도달에 fixture가 필요 없다.
    reach: [{ do: 'settle' }],
    root: '#sidebarModeNav',
    // 이 보드에서 앱 표면으로 살아남은 것은 「모드가 다섯이고 사이드바가 그 전환의
    // 자리」 하나다. 모드 카드의 설명문은 적지 않는다 — Paper 38이 같은 다섯 줄을
    // 「결과 카드가 쌓이는 기본 창」으로 다시 쓰고 앱이 그 새 문장을 따르므로
    // (sidebar-project-menu.js MODE_CHOICES), 25의 옛 문장을 적으면 두 Paper 보드
    // 중 오래된 쪽을 정본으로 삼는 것이 된다. 「공통 규칙」의 '모드를 바꾸면 새 대화'
    // 줄도 안 적는다: 원장이 그 줄에 「(40번으로 대체됨)」을 달았고 40이 그것을
    // 「폐기」로 그렸다 — 화면에 그려지는 문장도 아니다.
    phrases: ['대화', '그래프', '에이전트', '플러그인', '백테스트'],
    // 다섯 줄과 그 차례가 이 보드의 계약이다(MODE 01~05).
    structure: [
      { what: 'count', selector: '.sidebar-mode-item', equals: 5 },
      {
        what: 'order',
        selector: '.sidebar-mode-item-label',
        equals: ['대화', '그래프', '에이전트', '플러그인', '백테스트'],
      },
    ],
  },
  {
    board: 'COS-0', // 26 · 빈 작업공간 — 대화·그래프·백테스트
    window: 'shell',
    // 카드가 하나도 없으면 빈 화면이 저절로 드러난다(canvas.js:281) — 검사 프로필은
    // 비어 있으므로 부팅 직후가 이미 그 상태다.
    reach: [{ do: 'settle' }],
    root: '#gridEmpty',
    // Paper는 세 모드의 빈 화면을 나란히 그렸지만 앱은 한 번에 하나만 그린다
    // (대화 변형은 canvas.css가 그래프 모드에서 숨기고, 그래프 변형은 요약 표가 0건일
    // 때 summary-table.js renderGrowthHero가 표 자리에 세운다). 그래서 잴 수 있는 것은
    // 기본 모드인 대화 쪽 두 줄이다 —
    // 3개 하한을 paper-screen-routes.test.js가 사유와 함께 예외 처리했고, 그 대가로
    // structure를 셋 실었다. 「엔티티 N · 테마 군집 N」류는 앱이 실수치로 그리는
    // 값이라 애초에 문구가 못 된다.
    //
    // Paper의 백테스트 빈 상태(「아직 전략이 없습니다」·[프리셋에서 시작])는 적지
    // 않는다 — 앱의 백테스트 진입은 프리셋 목록이 먼저 서는 다른 화면이고(보드 G-1/01),
    // 여기에 26의 옛 패널을 적으면 없는 화면을 있다고 하는 것이 된다.
    phrases: ['무엇이든 물어보세요', '질문하면 답변 카드가 이 자리에 쌓입니다.'],
    // 대화 변형 하나 + 삽화 하나, 그래프 변형은 안 보인다 — 「모드가 다르면 빈
    // 화면도 다르다」가 이 보드의 계약이다.
    structure: [
      { what: 'count', selector: '.canvas-empty-chat', equals: 1 },
      { what: 'count', selector: '.canvas-empty-art', equals: 1 },
      { what: 'absent', selector: '.canvas-empty-graphmode' },
    ],
  },

  // ---------- 창·대화 턴·탭 3장 (1-0) ----------
  {
    board: 'G5B-0', // 28 · Windows 반응형 창 · Snap
    window: 'shell',
    // 보드 28은 한 화면이 아니라 같은 셸을 네 폭(와이드 · 가로 2분할 · 세로 2분할 ·
    // 4분할)으로 세워 놓은 규격표다. 한 창은 한 폭만 가지므로 라우트는 그중 하나만
    // 잰다(보드 20의 토큰 4상태와 같은 선택). 고른 것은 2분할 — 와이드는 기본 폭이라
    // 보드 06이 이미 지고 있고, 4분할(699px 아래)은 사이드바 글자가 전부 접혀
    // 원장 문구를 하나밖에 못 남긴다. 1000px은 두 경계(1279·699) 사이 한가운데다.
    reach: [
      { do: 'resize', width: 1000, height: 760 },
      { do: 'settle' },
    ],
    root: '#shell',
    // 「＋ 새 대화」·「프로젝트 · 아테나」처럼 축소 목업이 줄여 쓴 표기는 원장에 그대로
    // 있지만 포함 판정이라 앱의 「새 대화」가 그 안에 있다. 「창 규격 검수」·「아테나」는
    // 대화 제목·프로젝트 이름이라 값이고, 규격 설명문(「최소 330px 지원」류)은 Paper가
    // 자기 자신에 대해 쓴 주석이라 앱이 그리는 화면 문구가 아니다.
    phrases: ['새 대화', '그래프', '에이전트', '플러그인', '무엇이든 물어보세요'],
    // Paper가 이 폭에 대해 적은 세 가지: 「한 셸」로 영역은 그대로 셋이고, 채팅은
    // 아래로 내려가 빈 대화에서는 작성창만 남으며(2분할 목업의 하단 띠), 그래도
    // 「Snap 후에도 초안과 스크롤은 보존」할 수 있게 입력 DOM은 하나뿐이다.
    // 사이드바 행 수는 안 적는다 — 축소 목업은 넷(새 대화·그래프·에이전트·플러그인)만
    // 그렸는데 앱의 모드는 다섯이라 거기에 앱의 수를 적으면 앱이 정본이 된다.
    structure: [
      { what: 'count', selector: '.shell-region', equals: 3 },
      { what: 'absent', selector: '#chatRegion .history' },
      { what: 'count', selector: '#input', equals: 1 },
    ],
  },
  {
    board: 'DH2-0', // 30 · 대화 턴 — 복원 실패
    window: 'shell',
    // 복원 실패 턴은 백엔드가 밀어 주는 athena:routine-event 하나로만 그려진다
    // (chat.js renderAgentTurn) — 보드 09와 같은 이유로 같은 어휘를 쓴다.
    reach: [
      { do: 'send', channel: 'athena:routine-event', data: ROUTINE_RESTORE_FAILED },
      { do: 'settle' },
    ],
    // 보드가 셸 창 전체(사이드바 · 빈 캔버스 · 실패 턴 하나)라 root도 셸이다.
    root: '#shell',
    // 실패 문장은 적지 않는다. Paper가 쓴 「감시 '검증 루틴'을 복원하지 못했습니다 —
    // …」는 루틴 이름을 품은 값이고, 앱은 백엔드가 note로 보내는 **문장**을 그대로
    // 옮겨 붙이므로(routines/runtime.py:296·371은 이름이 아니라 완성된 문장을 싣는다)
    // Paper의 그 한 줄은 어느 봉투에서도 글자 그대로 만들어지지 않는다. 남는 것은
    // 종류 라벨과 셸 문구다. 「새 채팅」·「전체」·「아직 답변 카드가 없습니다」·
    // 「성향 그래프 열기」는 사이드바 보드 35와 빈 화면 보드 26이 이미 다시 쓴
    // 자리라(앱은 「새 대화」, CTA는 없앴다) 여기서 되살리지 않는다.
    phrases: ['복원 실패', '그래프', '에이전트', '플러그인', '무엇이든 물어보세요'],
    // Paper의 대화 본문에는 턴이 하나뿐이고, 그 턴 머리에는 점과 종류 라벨만 있다 —
    // 발화 턴(보드 09)의 시각 배지가 여기엔 없다는 것이 이 보드가 그린 차이다.
    // 캔버스는 빈 상태 그대로다.
    structure: [
      { what: 'count', selector: '.turn-agent.agent-restore-failed', equals: 1 },
      { what: 'absent', selector: '.agent-badge' },
      { what: 'count', selector: '.canvas-empty-chat', equals: 1 },
    ],
  },

  {
    board: '3ZPB-0', // 55 · 캔버스 탭 스트립 — 카드 1개 뷰포트 · 승인 대기
    window: 'shell',
    // 탭은 카드가 도착해야 생긴다 — 봉투 넷이 Paper가 그린 탭 넷이다. 슬롯 값은
    // 비워 둔다: 보드가 그리는 시세·잔고는 백엔드가 실어 주는 값이라 여기서 지어
    // 넣으면 없는 사실을 화면에 박는 것이 된다(값이 없으면 앱이 결측어를 그린다).
    // 이 라우트가 재는 것도 값이 아니라 탭 스트립과 뷰포트 하나다.
    // 마지막 발화 턴은 보드가 오른쪽 대화에 함께 그린 그 턴이다(보드 09와 같은 봉투).
    reach: [
      { do: 'envelope', data: CANVAS_TABS[0] },
      { do: 'envelope', data: CANVAS_TABS[1] },
      { do: 'envelope', data: CANVAS_TABS[2] },
      { do: 'envelope', data: CANVAS_TABS[3] },
      { do: 'send', channel: 'athena:routine-event', data: ROUTINE_FIRED },
      // 보드 원문 HTML은 카드 청크(수 MB)라 첫 마운트가 비동기다 — 넷이 다 설 때까지.
      { do: 'wait', ms: 1500 },
      { do: 'settle' },
    ],
    root: '#shell',
    // 탭 제목(「시세 · 삼성전자」류)과 카드 안의 표 머리·수치는 전부 값이라 안 넣는다.
    // 「결과물」·「출처」·「하위 에이전트」도 안 적는다: 그 셋은 실제 질의가 도는 동안에만
    // 그려져(chat.js updateResultDock·ensureAgentCard) CLI와 백엔드가 무엇을 답하느냐에
    // 좌우된다. 「ESC 중단」·「CLAUDE」·「OPUS · HIGH」는 Paper 44·45 v5가 입력행에서
    // 걷어낸 뒤로 앱이 그리지 않는다.
    phrases: ['그래프', '에이전트', '플러그인', '주기 확인', '감시 조건',
      '값은 발화 시점 기준입니다 — 최신 확인은 다시 물어봐 주세요.'],
    // 이 보드의 계약 자체 — 탭 넷에 닫기 넷이고, 열려 있는 뷰포트는 하나이며,
    // 그 하나에 선 것은 Paper 보드 표면이다(범용 표로 떨어지면 카드가 아니다).
    structure: [
      { what: 'count', selector: '.canvas-tab', equals: 4 },
      { what: 'count', selector: '.canvas-tab-close', equals: 4 },
      { what: 'count', selector: '.canvas-tab-panel', equals: 1 },
      { what: 'count', selector: '.card.board-surface', equals: 1 },
    ],
  },

  // ---------- 사이드바 4장 (1-0) ----------
  // 넷 다 이력 사이드바 하나를 다른 상태로 그린 보드라 fixture와 다시 읽히는 방법이 같다.
  // 사이드바는 대화 목록을 부팅 때 한 번 읽고 다음 폴링이 5초 뒤다(sidebar.js:1359) —
  // 5초를 세 번 기다리는 대신, 앱이 「모르는 대화의 실행 상태」를 받으면 목록을 통째로
  // 다시 읽는다는 것을 그대로 쓴다(sidebar.js:944 handleSessionRunState).
  {
    board: 'GCF-0', // 29 · 프로젝트·최근·새 채팅
    window: 'shell',
    // 보드 29의 1단계가 「프로젝트 행 Hover」다. 행을 누르면 프로젝트만 갈아 끼우고
    // 설명 카드는 안 뜬다 — 카드는 행이나 카드 위에 머무는 동안에만 산다
    // (sidebar.js showDescription, 2026-09-05 사용자 정정). 그래서 hover가 유일한 문이다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:conversations-list', data: SIDEBAR_HISTORY },
      { do: 'send', channel: 'athena:session-run-state', data: { id: 'fx-reload' } },
      { do: 'wait', ms: 300 },
      { do: 'hover', selector: '.sidebar-project-row' },
      { do: 'settle' },
    ],
    root: '#historyRegion',
    // 프로젝트 이름·대화 수·저장소 경로는 값이라 안 넣는다. 카드가 실제로 열렸을 때만
    // 그려지는 것은 아래 넷 중 뒤의 둘이다 — 앞의 둘은 사이드바 구역 머리말이다.
    // Paper가 첫 행에 그린 「새 채팅」은 안 적는다: 사이드바를 다시 그린 보드 35가
    // 같은 자리를 「새 대화」로 확정했고 앱이 그것을 따른다. 「전체」도 마찬가지로
    // 앱에 없는 자리라 적지 않는다.
    phrases: ['프로젝트', '최근', '프로젝트 수정', '이 프로젝트에 속한 대화와 작업'],
    // 카드는 프로젝트마다 만들어 두고 hidden만 푼다 — 목록에 프로젝트가 둘인데 보이는
    // 카드가 하나라는 것이 곧 「포인터가 머문 행의 카드만 뜬다」의 증거다.
    structure: [
      { what: 'count', selector: '.sidebar-project-description', equals: 1 },
      { what: 'count', selector: '.sidebar-project-description-copy', equals: 1 },
      { what: 'count', selector: '.sidebar-project-description-action', equals: 1 },
    ],
  },
  {
    board: '3VIQ-1', // 35 · 대화 이력 — 모드 5구역 · 세션 목록
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:conversations-list', data: SIDEBAR_HISTORY },
      { do: 'send', channel: 'athena:session-run-state', data: { id: 'fx-reload' } },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#historyRegion',
    // 「8개 대화」·「3」 같은 숫자와 대화 제목은 값이라 안 넣는다. 남는 것은 구역 머리말과
    // 머리의 두 버튼이다. 「폴더 추가」는 앱이 「+ 폴더 추가」로 늘려 그리지만 포함 판정이다.
    phrases: ['새 대화', '대화 검색', '이력 · 모드', '프로젝트', '폴더 추가', '최근 · 모드 무관'],
    // 이력의 맨 앞은 다섯 모드고 그 차례가 이 보드의 계약이다. 머리 버튼 개수는 안 적는다 —
    // Paper는 둘(새 대화·대화 검색)인데 앱은 「프로젝트·최근」 접기 버튼을 하나 더 둔다.
    structure: [
      {
        what: 'order',
        selector: '.sidebar-mode-item-label',
        equals: ['대화', '그래프', '에이전트', '플러그인', '백테스트'],
      },
      { what: 'count', selector: '.sidebar-project', equals: 2 },
    ],
  },
  {
    board: '3VV8-1', // 37 · 프로젝트 ⋯ — 고정·탐색기·제거
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:conversations-list', data: SIDEBAR_HISTORY_THREE },
      { do: 'send', channel: 'athena:session-run-state', data: { id: 'fx-reload' } },
      { do: 'wait', ms: 300 },
      // 첫 프로젝트 행의 ⋯ — 메뉴는 hidden으로 시작하고 행 도구는 opacity 0이라
      // 이 한 클릭이 없으면 아래 셋이 하나도 안 보인다.
      { do: 'click', selector: '.sidebar-project-menu-trigger' },
      { do: 'settle' },
    ],
    root: '#historyRegion',
    // 세 항목의 라벨과 그 결과 한 줄. 발치의 「이름 바꾸기는 프로젝트 행을 두 번 누르세요」는
    // 안 적는다 — 앱에서 이름을 고치는 문은 설명 카드의 [프로젝트 수정] 하나뿐이라(보드 29)
    // 그 문장을 그리면 없는 제스처를 있다고 하는 것이 된다.
    phrases: [
      '프로젝트',
      '최상단 고정',
      '목록 맨 위에 붙여 둡니다',
      '탐색기에서 열기',
      '이 프로젝트 폴더를 창으로 엽니다',
      '프로젝트 제거',
      '폴더와 그 안의 파일을 지웁니다',
    ],
    // Paper의 팝오버 — 항목 셋, 각 항목에 결과 한 줄. 목록은 프로젝트 세 줄이고
    // 그중 한 줄의 메뉴만 열려 있다(나머지 둘의 메뉴는 hidden이라 안 세어진다).
    structure: [
      { what: 'count', selector: '.sidebar-project', equals: 3 },
      { what: 'count', selector: '.sidebar-project-menu-item', equals: 3 },
      { what: 'count', selector: '.sidebar-project-menu-item-hint', equals: 3 },
    ],
  },
  {
    board: '3VV9-1', // 38 · 펜 — 새 대화창 모드 선택
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:conversations-list', data: SIDEBAR_HISTORY },
      { do: 'send', channel: 'athena:session-run-state', data: { id: 'fx-reload' } },
      { do: 'wait', ms: 300 },
      // 첫 프로젝트 행의 펜. 모드 목록은 렌더 상태로만 살아서(sidebar.js
      // openModePickerId) 이 클릭이 없으면 DOM에 아예 없다 — 보드 37의 ⋯ 와 같은 문.
      { do: 'click', selector: '.sidebar-project-new-chat' },
      { do: 'settle' },
    ],
    root: '#historyRegion',
    // 다섯 줄의 설명이 이 보드가 확정한 문장이다(sidebar-project-menu.js MODE_CHOICES).
    // 모드 이름은 안 적는다 — 사이드바 모드 네비가 같은 다섯 낱말을 이미 그려 어느
    // 쪽이 보였는지 구분하지 못한다. 설명 다섯은 이 목록에만 있다.
    //
    // Paper의 시트 머리(「어느 모드로 열까요?」)·발치(「같은 모드로 여러 개를 열 수
    // 있습니다」)·[취소][백테스트 창 열기]는 적지 않는다: 앱의 펜은 모달 시트가 아니라
    // 행에 붙는 목록이고, 고른 줄이 곧 새 대화창이라 확인 버튼이 없다. 「현재 2개」류의
    // 창 수와 Gap Note의 「지금 코드에 없는 것」도 화면 문구가 아니다.
    phrases: [
      '결과 카드가 쌓이는 기본 창',
      '성향·엔티티·근거를 보는 지도',
      '감시·예약 작업을 관제',
      '설치·권한·MCP 캔버스',
      '전략 폼·코드·결과 캔버스',
    ],
    // 펜을 누른 프로젝트 한 줄에만 목록이 열리고, 그 목록은 다섯 모드가 이 차례다.
    structure: [
      { what: 'count', selector: '.sidebar-mode-picker', equals: 1 },
      {
        what: 'order',
        selector: '.sidebar-mode-picker-label',
        equals: ['대화', '그래프', '에이전트', '플러그인', '백테스트'],
      },
    ],
  },
  // ---------- 플러그인 9장 (B-2) ----------
  // 아홉 장이 공유하는 도달의 골격은 셋이다.
  //   ① 목록을 갈아끼운 뒤 **다시 읽히는 문**은 허브 머리의 [관리] 하나다
  //      (onManage가 pluginRefresh를 부른다, canvas.js). 창을 다시 읽으면 부팅의
  //      pluginRefresh가 원 핸들러로 한 번 돌아 버리므로, fixture를 건 뒤 [관리]를
  //      눌러 한 번 더 읽히고 모드 네비로 허브에 돌아온다(사이드바가 진입마다
  //      setView('hub')를 부른다, lib/sidebar.js).
  //   ② 승인 카드를 세우는 문은 athena:plugin-pending 하나다 — 미해결 봉투는 메인
  //      프로세스 메모리에만 살고 모드 재진입이 그것을 되읽는다(pluginRestorePending).
  //   ③ 기능 목록은 probe가 돌아와야 생긴다 — 허브 카드의 [권한]이 그 유일한 자극이다.
  {
    board: 'FT6-0', // 01 · 플러그인 — 기능 허용 (AT-ST-006)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:mcp-list', data: PLUGIN_LIST_KOREA },
      { do: 'ipc-fixture', channel: 'athena:mcp-probe', data: KOREA_TOOLS },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-action.is-manage' },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-card[data-plugin-id="korea-stock"] .plugin-canvas-action' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    // 도구 이름·설명은 probe 봉투에서 오는 값이라 안 적는다. 남는 것은 이 화면이
    // 봉투와 무관하게 늘 같은 말로 그리는 넷과, 플러그인 이름이 박히는 두 문장이다
    // (그 이름은 카탈로그가 별칭에서 되짚는 값이라 fixture가 못 바꾼다).
    // 「채팅: 시세 조회만 허용」은 Paper가 권한 초안 머리에 단 진입 표시인데 앱에
    // 그 자리가 없어 적지 않는다.
    phrases: [
      '기능 허용은 한국 주식 시세 플러그인에만 적용됩니다. Athena 내장 API는 이 목록에 나타나지 않습니다.',
      '권한 초안',
      '승인 카드로 확정합니다',
      '선택한 기능만 한국 주식 시세 플러그인에 노출됩니다',
      '선택 저장',
      'Kiwoom 시세·주문·계좌와 brain은 Athena 내장 API이므로 플러그인 권한 목록에 표시하지 않습니다.',
    ],
    // Paper의 머리 배지 넷(설치됨 · 기능 6 · 허용 4 · 연결 확인됨)과 도구 여섯 줄.
    // 배지의 숫자는 값이라 세지 않고 배지가 넷이라는 것만 잰다.
    structure: [
      { what: 'count', selector: '.plugin-canvas-count', equals: 4 },
      { what: 'count', selector: '.plugin-canvas-permission-features .plugin-canvas-sheet-feature', equals: 6 },
    ],
  },
  {
    board: '15J-0', // 02 · 플러그인 — 직접 등록·감사 로그 (관리 뷰)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:mcp-list', data: PLUGIN_LIST_TWO },
      { do: 'ipc-fixture', channel: 'athena:mcp-audit', data: PLUGIN_AUDIT },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-action.is-manage' },
      { do: 'click', selector: '.plugin-canvas-manage .plugin-canvas-action.is-add' },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    // 붙여넣기 칸의 예시 설정은 <textarea>의 placeholder라 문구가 못 된다
    // (plugin-canvas.js renderAddSheetBody). 「최근 3건」·「채팅에서 등록을 제안해도
    // 같은 승인 카드로 들어옵니다」는 앱에 그 자리가 없어 적지 않는다.
    phrases: [
      '플러그인 관리',
      '서버 추가',
      'Claude 설정 형식의 스니펫을 붙여넣습니다',
      '승인 카드로 확정합니다',
      '닫기',
      '등록 제안',
      '감사 로그',
    ],
    // 시트 한 장 + 감사 표의 열 머리 넷과 줄 셋. 열 머리의 차례가 Paper 02의 계약이다.
    structure: [
      { what: 'count', selector: '.plugin-canvas-add-sheet', equals: 1 },
      { what: 'order', selector: '.plugin-canvas-audit-head div', equals: ['시각', '별칭', '도구', '결과'] },
      { what: 'count', selector: '.plugin-canvas-audit-row', equals: 3 },
    ],
  },
  {
    board: 'CU0-0', // 03 · 플러그인 — 허브·설치
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:mcp-list', data: PLUGIN_LIST_TWO },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-action.is-manage' },
      { do: 'mode', view: 'plugin' },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    // 「⌕ 플러그인 검색」은 <input>의 placeholder라 문구가 못 된다. 플러그인 이름·
    // 설명은 카탈로그가 그리는 목록 값이라 안 적는다 — 남는 것은 머리·구역 제목·
    // 두 버튼·경계 설명문이다.
    phrases: [
      '플러그인',
      '+ 서버 추가',
      '관리',
      '플러그인은 설치 후 기능별로 허용합니다. Kiwoom·brain은 Athena 내장 API라 이 목록에 표시하지 않습니다.',
      '설치됨',
      '추천',
      '권한',
    ],
    // Paper 03의 두 구역 — 설치됨 두 장, 추천 세 장(카탈로그 다섯에서 설치된 둘을 뺀다).
    structure: [
      { what: 'count', selector: '.plugin-canvas-installed .plugin-canvas-card', equals: 2 },
      { what: 'count', selector: '.plugin-canvas-recommended .plugin-canvas-card', equals: 3 },
    ],
  },
  {
    board: 'CVY-0', // 04 · 플러그인 — 관리·마켓플레이스
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:mcp-list', data: PLUGIN_LIST_TWO },
      { do: 'ipc-fixture', channel: 'athena:mcp-audit', data: PLUGIN_AUDIT_EMPTY },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-action.is-manage' },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    // 「플러그인 2 · 기능 3 · 마켓플레이스 1」은 목록에서 세는 값이라 안 적는다.
    // 행 안의 차례는 Paper 04 그대로다 — 안내가 먼저 오고 그 안내가 가리키는
    // [삭제]와 스위치가 뒤에 온다(스위치는 글자가 없어 차례 대신 개수로 잰다).
    phrases: [
      '플러그인 관리',
      '플러그인만 설치·활성화합니다. 제공 기능은 상세 화면에서 허용하며 Athena 내장 API는 표시하지 않습니다.',
      '승인 후 지웁니다',
      '승인 후 반영됩니다',
      '마켓플레이스',
      '앱 내장 카탈로그 · 키가 필요 없는 5종',
      '+ 마켓플레이스 추가 — GitHub·Git URL·로컬 폴더. 등록만으로는 아무것도 실행되지 않습니다 — 설치·활성은 항목별 승인 시트를 거칩니다.',
    ],
    // 플러그인 두 줄 + 마켓플레이스 한 줄, 스위치는 그 셋에 하나씩이다.
    structure: [
      { what: 'count', selector: '.plugin-canvas-manage-plugins .plugin-canvas-manage-row', equals: 2 },
      { what: 'count', selector: '.plugin-canvas-marketplaces .plugin-canvas-manage-row', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-toggle', equals: 3 },
      {
        what: 'order',
        selector: '.plugin-canvas-manage-plugins .plugin-canvas-manage-hint, .plugin-canvas-manage-plugins .plugin-canvas-action.is-danger',
        equals: ['승인 후 지웁니다', '삭제', '승인 후 반영됩니다', '승인 후 지웁니다', '삭제', '승인 후 반영됩니다'],
      },
    ],
  },
  {
    board: '2NW8-2', // 05 · 플러그인 — 설치 승인 (캔버스 카드)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:plugin-pending', data: paperPending([PROPOSE_INSTALL_FETCH]) },
      { do: 'mode', view: 'plugin' },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    // Paper의 카드는 「플러그인 정보」·「요청 기능」·「요청」·「설치형 플러그인」을 함께
    // 그리지만 앱은 그 넷을 허브 [설치] 시트에만 둔다(카드 본문은 모델 경로와 같은
    // cardCopy 한 함수가 만든다) — 어긋나는 자리라 아무 것도 적지 않는다. 「제공:
    // athena-official · mcp-server-fetch」·「용도: 공시·리서치 …」도 같다: 앱은
    // 카탈로그의 실제 제공자·용도를 쓴다(plugin-catalog.js fetch 항목).
    // 「권한 1개 요청」은 숫자가 든 값이라 애초에 문구 후보에서 걸러진다.
    phrases: [
      '플러그인',
      '아테나 제안',
      '웹 문서 읽기 설치',
      '실행 명령: uvx mcp-server-fetch',
      '설치 위치 · 플러그인 모드 > 웹 문서 읽기',
      '거부',
      '허브의 설치 버튼도 이 카드로 들어옵니다',
    ],
    // 카드 한 장에 버튼 둘(거부·승인)이다.
    structure: [
      { what: 'count', selector: '.plugin-canvas-proposal', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-proposal-action', equals: 2 },
    ],
  },
  {
    board: '2NXS-2', // 06 · 플러그인 — 상태 모음 (6상태)
    window: 'shell',
    // 보드 06은 화면이 아니라 여섯 상태를 나란히 세운 목록이다. 한 화면은 그중
    // 함께 설 수 있는 것만 그리므로 라우트는 넷을 한 번에 잡는다(보드 20의 토큰
    // 4상태와 같은 선택): ① 아무것도 설치하지 않은 허브 · ④ 이번 세션에 레지스트리를
    // 바꿨을 때의 재시작 안내 · ⑤ 아직 안 누른 카드 · ⑥ 거부를 누른 카드.
    // ②(probe 실패 배너)와 ③(승인 뒤 철회 실패가 행 아래 붙는 줄)은 뺐다 — ②는
    // 앱이 「연결 실패 — <사유>」로 쓰고 Paper는 「연결을 확인하지 못했습니다」라
    // 문면이 어긋나고, ③은 앱에 그 자리가 아예 없다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:mcp-list', data: PLUGIN_LIST_EMPTY },
      { do: 'ipc-fixture', channel: 'athena:plugin-approve', data: PLUGIN_APPROVE_SUCCESS },
      { do: 'ipc-fixture', channel: 'athena:plugin-reject', data: PLUGIN_REJECT_DONE },
      {
        do: 'ipc-fixture',
        channel: 'athena:plugin-pending',
        data: paperPending([PROPOSE_DISABLE_FETCH, PROPOSE_INSTALL_FETCH, PROPOSE_INSTALL_KOREA]),
      },
      { do: 'mode', view: 'plugin' },
      // 승인 하나가 재시작 안내를 세운다 — 그 줄은 이번 세션에 레지스트리를 바꿨을
      // 때만 뜬다(canvas.js pluginRegistryChangedThisSession).
      { do: 'click', selector: '.plugin-canvas-proposal[data-proposal-id="fx-pp-disable-fetch"] .is-proposal-approve' },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '.plugin-canvas-proposal[data-proposal-id="fx-pp-install-korea"] .is-proposal-reject' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    phrases: [
      '설치한 플러그인이 없습니다 · 아래 추천에서 설치합니다',
      '이번에 바꾼 서버는 Athena를 다시 시작한 뒤의 대화부터 적용됩니다. 진행 중인 대화에는 아직 반영되지 않았습니다.',
      '제안 대기',
      '웹 문서 읽기 설치',
      '거부됨',
      '그대로 뒀습니다',
    ],
    // 빈 자리 문구는 설치됨 구역 하나뿐이다(추천은 카탈로그 다섯이 그대로 선다) —
    // 「검색과 일치하는 …이 없습니다」로 뭉뚱그리지 않는다는 것이 이 보드의 첫 칸이다.
    structure: [
      { what: 'count', selector: '.plugin-canvas-restart-notice', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-empty', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-proposal[data-proposal-state="pending"]', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-proposal[data-proposal-state="done"]', equals: 2 },
    ],
  },
  {
    board: '3ZJD-0', // 07 · 플러그인 대화 — 제안 턴 5동작
    window: 'shell',
    // 보드 07은 다섯 동작을 「채팅 제안 한 줄 + 캔버스 승인 카드」로 나란히 세운
    // 목록이다. 채팅 줄은 살아 있는 질의 안에서만 그려지고(chat.js의 턴 스코프
    // athena:plugin-proposed 구독) 앱 어디에도 그것을 다시 여는 문이 없다 — 보드
    // 09가 능동 턴 하나만 잰 것과 같은 이유로, 여기서는 도달 절차로 결정론이 되는
    // 승인 카드 다섯을 잰다(보드가 제목으로 말하는 「캔버스가 승인합니다」 쪽이다).
    reach: [
      {
        do: 'ipc-fixture',
        channel: 'athena:plugin-pending',
        data: paperPending([
          PROPOSE_INSTALL_KOREA, PROPOSE_ALLOW_KOREA, PROPOSE_DISABLE_FETCH,
          PROPOSE_REMOVE_TIME, PROPOSE_SNIPPET,
        ]),
      },
      { do: 'mode', view: 'plugin' },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    // 기능 허용 칸의 「허용 4 / 6」·「켤 기능 …」·「끌 기능 …」과 켜기·끄기 칸의
    // 「기능 1개가 함께 멈춥니다」, 삭제 칸의 「되돌리려면 다시 설치합니다」는 앱이
    // 그리지 않는 줄이라 적지 않는다.
    phrases: [
      '한국 주식 시세 설치',
      '실행 명령: npx -y @drfirst/korea-stock-mcp',
      '웹 문서 읽기 끄기',
      '승인 철회',
      '시간·시간대 삭제',
      '등록과 승인 기록을 함께 지웁니다',
      '등록만으로는 실행되지 않습니다',
    ],
    // 다섯 카드가 Paper의 열 차례 그대로 선다 — 설치 · 기능 허용 · 켜기끄기 ·
    // 삭제 · 스니펫 등록.
    structure: [
      { what: 'count', selector: '.plugin-canvas-proposal', equals: 5 },
      {
        what: 'order',
        selector: '.plugin-canvas-proposal-title',
        equals: [
          '한국 주식 시세 설치', '한국 주식 시세 · 기능 허용', '웹 문서 읽기 끄기',
          '시간·시간대 삭제', '직접 등록',
        ],
      },
    ],
  },
  {
    board: '3ZLW-0', // 08 · 플러그인 대화 — 결과 턴
    window: 'shell',
    // 보드 08도 결과 다섯 갈래를 나란히 세운 목록이다. 승인 반환이 곧 갈래이므로
    // 한 화면에 함께 설 수 있는 것은 승인(성공)과 거부 둘이다 — 실패·재시도는
    // 실행이 한 줄이라도 돈 봉투에만 붙고(plugin-proposal.js resultTurnCopy),
    // 「모드 밖 폐기」는 플러그인 모드가 **아닐** 때의 화면이라 이 모드에서 못 선다.
    // 재시작 갈래는 성공 턴의 끝줄로 함께 잰다(런타임 꺼짐 · 기본).
    reach: [
      { do: 'ipc-fixture', channel: 'athena:mcp-list', data: PLUGIN_LIST_KOREA },
      { do: 'ipc-fixture', channel: 'athena:plugin-approve', data: PLUGIN_APPROVE_SUCCESS },
      { do: 'ipc-fixture', channel: 'athena:plugin-reject', data: PLUGIN_REJECT_DONE },
      {
        do: 'ipc-fixture',
        channel: 'athena:plugin-pending',
        data: paperPending([PROPOSE_INSTALL_KOREA, PROPOSE_INSTALL_FETCH]),
      },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-proposal[data-proposal-id="fx-pp-install-korea"] .is-proposal-approve' },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '.plugin-canvas-proposal[data-proposal-id="fx-pp-install-fetch"] .is-proposal-reject' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    // 결과 턴은 채팅에, 굳은 카드는 캔버스에 남는다 — 둘을 함께 품는 것은 셸이다.
    root: '#shell',
    phrases: [
      '등록했습니다',
      '연결을 확인했습니다',
      '기능 6개를 찾았습니다',
      '다음 실행부터 반영됩니다',
      '그대로 뒀습니다',
      '거부됨',
      '웹 문서 읽기 설치',
    ],
    // 승인 하나 · 거부 하나 = 채팅 턴 둘, 그리고 두 카드 다 결과로 굳는다.
    structure: [
      { what: 'count', selector: '#history .plugin-turn', equals: 2 },
      { what: 'count', selector: '.plugin-canvas-proposal[data-proposal-state="done"]', equals: 2 },
    ],
  },
  {
    board: '3ZNO-0', // 09 · 플러그인 창 복원
    window: 'shell',
    // 보드 09의 세 칸 중 둘을 한 화면에 함께 세운다: 권한 초안(모드를 나갔다 와도
    // 저장 전 토글이 남고, 그 사이 실제 허용이 갈리면 무엇이 달라졌는지 먼저
    // 말한다)과 제안 대기·만료 카드다. 「미전송 입력」 칸은 <textarea>의 value라
    // 애초에 가시 텍스트가 아니어서 잴 자리가 없다.
    //
    // 갈림을 만드는 자극은 probe 봉투를 두 번 다르게 거는 것뿐이다: 첫 봉투로 초안을
    // 뜨고(모드 네비가 keepDraft를 부른다), 둘째 봉투가 도착하면 목록 갱신이 초안을
    // 다시 얹으면서 발산을 집는다(plugin-canvas.js restoreDraft).
    reach: [
      { do: 'ipc-fixture', channel: 'athena:mcp-list', data: PLUGIN_LIST_KOREA },
      { do: 'ipc-fixture', channel: 'athena:mcp-probe', data: KOREA_TOOLS },
      {
        do: 'ipc-fixture',
        channel: 'athena:plugin-pending',
        data: paperPending([PROPOSE_INSTALL_FETCH, PROPOSE_ALLOW_KOREA_STALE]),
      },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-action.is-manage' },
      { do: 'mode', view: 'plugin' },
      { do: 'click', selector: '.plugin-canvas-card[data-plugin-id="korea-stock"] .plugin-canvas-action' },
      { do: 'wait', ms: 300 },
      // 모드를 다시 눌러 나갔다 들어온다 — 그때 저장 전 토글이 초안으로 굳는다.
      { do: 'mode', view: 'plugin' },
      { do: 'ipc-fixture', channel: 'athena:mcp-probe', data: KOREA_TOOLS_CHANGED },
      { do: 'click', selector: '.plugin-canvas-card[data-plugin-id="korea-stock"] .plugin-canvas-action' },
      { do: 'wait', ms: 400 },
      { do: 'settle' },
    ],
    root: '#pluginCanvas',
    // 「그 사이 바뀐 기능: 시세 조회 · 종목 검색」은 적지 않는다 — 앱은 그 자리에
    // probe가 준 실제 도구 이름을 잇고 Paper는 사람이 읽는 이름을 썼다.
    phrases: [
      '권한 초안',
      '현재 값으로 초기화',
      '초안대로 저장',
      '제안 대기',
      '만료됨',
      '다시 제안받기',
      '앱을 완전히 껐다 켜면 대기 중인 제안은 사라집니다',
    ],
    // 발산 알림 한 줄 + 카드 둘(하나는 대기, 하나는 만료) + 경계 문구 한 줄.
    structure: [
      { what: 'count', selector: '.plugin-canvas-draft-divergence', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-proposal[data-proposal-state="pending"]', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-proposal[data-proposal-state="stale"]', equals: 1 },
      { what: 'count', selector: '.plugin-canvas-proposal-boundary', equals: 1 },
    ],
  },

  // ---------- 키우미 4장 (C-2) ----------
  // 이 페이지 아홉 중 넷만 여기 있다. 나머지 다섯은 Paper가 그린 것이 **주석 판**이라
  // 앱에 대응하는 가시 텍스트가 없거나(02 표정 10종 · 03 시선·시간 루프 — 얼굴은
  // orb.css의 [data-face] 규칙이 지고 글자를 하나도 안 그린다), 한 화면에 두 줄밖에
  // 못 세우거나(05 셸 숨김·표시 — 「대화창으로 가기」와 「셸로 가기」는 서로 다른
  // 표시 모드라 함께 못 선다), 잠긴 계약과 정면으로 어긋나거나(08 모드별 얼굴 5종 —
  // 앱은 얼굴 1종이 계약이다, shell.html #dot 주석), 도달 어휘 밖이다(09 미니 카드
  // 10종 — 카드는 질의가 도는 동안에만 붙는 athena:orb-canvas-result 구독으로만
  // 그려진다, orb.js submitChatQuery). 없는 셀렉터·문구를 적어 초록을 만드는 대신
  // 비워 둔다.
  {
    board: 'DO-0', // 01 · 키우미 — 상황별 표현·크기 매핑
    window: 'orb',
    // 이 보드가 앱에서 실제로 서는 자리는 알림 전용 패널과 접힌 원의 두 채널이다
    // (Paper 캡션: 「알림 전용(셸 표시)에서는 세 조각까지 — 문장 1 · 대표 카드 1 · 더보기」,
    // 「접힘 원에는 얼굴 말고 채널이 둘 더 있다」). 표정 10종 자체는 글자가 아니라
    // orb.css의 [data-face] 규칙이라 문구로도 구조로도 잴 자리가 없다 — 적지 않는다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: WATCH_THREE_ACTIVE },
      // 셸이 떠 있는 동안의 표시 모드(B) — 입력줄 없는 알림 전용이다. 재읽기 뒤에는
      // main이 이 이벤트를 다시 보내지 않으므로 라우트가 직접 쏜다.
      { do: 'send', channel: 'athena:shell-visibility', data: { hidden: false, displayMode: 'B' } },
      // 발화 하나가 궤도 링을 다시 세고(refreshSatelliteRing) 미확인으로 쌓인다.
      { do: 'send', channel: 'athena:routine-event', data: ROUTINE_FIRED },
      { do: 'wait', ms: 300 },
      // 펼치면 쌓인 첫 건이 패널로 그려진다 — 창 크기는 main이 정하므로 렌더러에는
      // 이 이벤트가 곧 펼침이다(orb.js athena:orb-state).
      { do: 'send', channel: 'athena:orb-state', data: { expanded: true } },
      { do: 'settle' },
    ],
    root: '#orbRoot',
    // 「더보기」는 안 적는다 — 앱의 그 버튼은 「셸로 가기」다(orb.html #orbMore,
    // 보드 04⑦이 적은 쪽과 같다). 배지 「15:30 발화」와 「2분 전」도 안 적는다:
    // 앞은 이 컴퓨터의 시간대가, 뒤는 지금 시각이 정하는 값이다.
    phrases: [
      '주기 확인',
      '종목',
      "루틴 '삼성전자 88,000' · 에이전트 발화 — 묻지 않은 턴입니다",
    ],
    structure: [
      // 궤도 위성 = 활성 감시 건수(Paper: 3건).
      { what: 'count', selector: '.orb-ring-dot', equals: 3 },
      // 세 조각 중 둘 — 대표 카드 하나와 진행 문 하나.
      { what: 'count', selector: '#orbCard', equals: 1 },
      { what: 'count', selector: '#orbMore', equals: 1 },
    ],
  },
  {
    board: '4TY-0', // 04 · 키우미 — 대화·콘텐츠 전개
    window: 'orb',
    // 여덟 칸 중 ①(펼침 · 빈 대화)이 자극 없이 서는 유일한 칸이다 — 나머지 일곱은
    // 질의가 실제로 돌아야 생기는 턴이라 도달 어휘 밖이다(카드는 질의 중에만 붙는
    // athena:orb-canvas-result 구독이 만든다). 그 한 칸이 이 보드의 전제를 다 진다:
    // 「셸이 숨겨졌을 때만 입력줄이 존재한다」.
    reach: [
      { do: 'send', channel: 'athena:shell-visibility', data: { hidden: true, displayMode: 'A' } },
      { do: 'send', channel: 'athena:orb-state', data: { expanded: true } },
      { do: 'settle' },
    ],
    root: '#orbPanel',
    phrases: [
      '메인 대화',
      '셸을 내려두셨네요. 여기서 바로 물어보셔도 됩니다.',
      '긴 표와 차트는 줄여서 보여드리고, 전체는 대화창에서 이어집니다.',
      '대화창으로 가기',
    ],
    structure: [
      { what: 'count', selector: '#orbInputStack', equals: 1 },
      { what: 'count', selector: '.orb-control-strip', equals: 1 },
      // 알림 전용 발(「셸로 가기」)은 대화 모드에서 통째로 사라진다 —
      // Paper ①이 그 자리에 그린 것은 입력줄과 스트립뿐이다.
      { what: 'absent', selector: '#orbFoot' },
    ],
  },
  {
    board: 'CLE-0', // 06 · 키우미 메뉴 — 두 진입점과 항목
    window: 'shell',
    reach: [
      { do: 'click', selector: '#dot' },
      { do: 'settle' },
    ],
    root: '#kiumiMenu',
    // 「플러그인 UI 초안」은 안 적는다 — Paper가 그 구역 머리에 적은 말은 초안 표시라
    // 제품 문구가 못 된다(3원칙 · 내부용어). 그 구역의 두 줄(DART 전자공시 ·
    // Google Sheets 내보내기)도 설치된 플러그인이 주는 값이라 문구가 아니다.
    phrases: [
      '추가',
      '파일 첨부',
      '폴더 경로를 칩으로 쌓는다',
      '계속 추구할 목표를 설정',
      '실행 전에 계획을 정리',
      '설정',
      '설치 · 기능 허용 · 마켓플레이스',
    ],
    // Paper가 그린 구역은 셋이다(추가 · 플러그인 · 설정). 항목 총수는 안 적는다 —
    // 가운데 구역은 설치된 플러그인 수만큼 늘고 줄어든다.
    structure: [{ what: 'count', selector: '.km-section', equals: 3 }],
  },
  {
    board: 'C8G-0', // 07 · 키우미 메뉴 — 셸 오버레이
    window: 'shell',
    // 06과 같은 메뉴를 셸 전체 위에 얹은 보드다 — 재는 자리가 메뉴 안이 아니라
    // 셸이라는 것이 이 보드의 전부다(「현재 대화 위에 열린다」).
    reach: [
      { do: 'click', selector: '#dot' },
      { do: 'settle' },
    ],
    root: '#shell',
    // 사이드바 첫 행은 Paper가 「새 채팅」, 앱이 「새 대화」로 갈려 안 적는다
    // (보드 06·12·29와 같은 자리다). 캔버스에 쌓인 카드·대화 턴은 전부 값이다.
    phrases: [
      '그래프',
      '에이전트',
      '플러그인',
      '추가',
      '파일 첨부',
      '설정',
      '모델 · 사고 강도',
    ],
    structure: [
      { what: 'count', selector: '.shell-region', equals: 3 },
      { what: 'count', selector: '.km-section', equals: 3 },
    ],
  },
]);

module.exports = { ROUTES, STEP_KINDS, STRUCTURE_KINDS };
