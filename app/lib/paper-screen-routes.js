'use strict';

// Paper 화면계 보드를 실앱 도달 절차 + 대조 계약으로 잇는다(설계서 §4.1~§4.3).
//
// 매니페스트 role==="screen" 보드는 전부 여기 있어야 한다. 없는 보드는 미구현 실패다 —
// 「도달 절차가 없는 보드는 실패한다」가 게이트 2의 핵심이라, 표가 곧 남은 작업 목록이 된다.
// 화면이 아닌 보드(reference·retired·contract)는 표를 비운다 — 없는 셀렉터·문구를
// 적어 초록을 만들지 않는다. 키우미 08(2I7Z-2)은 얼굴 1종 계약과 어긋나 retired,
// 백테스트 10(2GZM-2)은 보드 19 정본이라 reference다.
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
  //                      그 카드 안의 [프로젝트 수정]과 행 dblclick이 수정 패널을 연다.
  //                      행을 한 번 누르면 프로젝트만 갈아 끼우고 카드는 안 뜬다.
  hover: Object.freeze(['selector']),
  // mode      view — 사이드바 모드 네비(live-full-catalog.js MODES의 navId)를 누른다
  mode: Object.freeze(['view']),
  // command-bar text — 입력창에 문장을 넣고 Enter (verify.js openSettingsViaCommandBar)
  'command-bar': Object.freeze(['text']),
  // type      selector,text — 그 입력창에 문장을 넣고 `input` 이벤트를 쏜다.
  //                           `command-bar`가 셸의 채팅 입력 하나에 Enter까지 박아 둔
  //                           것과 달리 창 안의 아무 입력창이나 채운다. 입력한 글자
  //                           자체가 화면인 자리가 있어서다: 사이드바 검색 결과 패널은
  //                           질의가 비면 통째로 hidden이고(sidebar.js renderSearchPanel),
  //                           그 입력창을 채우는 문이 앱 어디에도 클릭으로는 없다.
  //                           Enter를 안 누르는 것도 일부러다 — Enter는 고른 줄을 열어
  //                           패널을 닫는다. 되돌릴 것은 없다(라우트마다 창을 다시 읽는다).
  type: Object.freeze(['selector', 'text']),
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
  // wait-for selector,count,timeout,visibility — DOM 개수가 count가 될 때까지 제한 시간
  //                                              안에서 폴링한다. visibility는 visible|any,
  //                                              시간 초과는 도달 실패다.
  'wait-for': Object.freeze(['selector', 'count', 'timeout', 'visibility']),
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

// 미니 카드 열 종(보드 2LFW-2)을 세우는 봉투다. 값은 Paper가 그 보드에 그린 예시를
// 그대로 옮긴 픽스처이고, 상한을 넘기는 자리(표 5행 · 사실 9행 · 스트림 3건)는 실제로
// 접히도록 일부러 넘겨 둔다 — 접힘 고지가 나오는 것까지가 카드다. 문구에는 한 글자도
// 쓰지 않는다(전부 봉투가 정하는 값이다).
const MINI_CARD_ENVELOPES = Object.freeze([
  // 01 표
  {
    card_title: '재무상태표',
    caption: 'DART 2025',
    canvas_type: 'table',
    fell_back: false,
    data: {
      columns: [
        { key: 'acct', label: '계정' },
        { key: 'cur', label: '당기' },
        { key: 'prev', label: '전기' },
        { key: 'chg', label: '증감' },
        { key: 'chgpct', label: '증감률' },
      ],
      rows: [
        { acct: '자산총계', cur: '566,942,110', prev: '514,531,948', chg: '52,410,162', chgpct: '10.2%' },
        { acct: '유동자산', cur: '247,684,612', prev: '227,062,266', chg: '20,622,346', chgpct: '9.1%' },
        { acct: '현금및현금성자산', cur: '57,856,378', prev: '53,705,579', chg: '4,150,799', chgpct: '7.7%' },
        { acct: '부채총계', cur: '92,000,000', prev: '88,000,000', chg: '4,000,000', chgpct: '4.5%' },
        { acct: '자본총계', cur: '474,942,110', prev: '426,531,948', chg: '48,410,162', chgpct: '11.4%' },
      ],
    },
  },
  // 02 차트
  {
    card_title: '삼성전자 005930',
    canvas_type: 'chart',
    fell_back: false,
    data: {
      symbol: '005930',
      chart: {
        period: 'day',
        target: 'stock',
        candles: [
          { time: '2026-05-26', open: 68000, high: 69500, low: 67800, close: 68900, volume: 1000 },
          { time: '2026-06-25', open: 74000, high: 80000, low: 73800, close: 79500, volume: 1300 },
          { time: '2026-07-12', open: 83000, high: 85500, low: 82500, close: 87200, volume: 1500 },
          { time: '2026-07-19', open: 87200, high: 88500, low: 86800, close: 88100, volume: 1600 },
        ],
      },
    },
  },
  // 03 사실
  {
    card_title: '종목정보',
    caption: '삼성전자 005930',
    canvas_type: 'facts',
    fell_back: false,
    data: {
      fields: [
        { key: 'cur_prc', label: '종가', value: 88100 },
        { key: 'pred_pre', label: '전일비', value: '+900 (+1.03%)' },
        { key: 'acc_trde_qty', label: '거래량', value: 11689068 },
        { key: 'mac', label: '시가총액', value: '525.8조' },
        { key: 'dt', label: '기준시각', value: '2026-07-19 15:30' },
        { key: 'per', label: 'PER', value: '11.2' },
        { key: 'pbr', label: 'PBR', value: '1.4' },
        { key: 'eps', label: 'EPS', value: '7,860' },
        { key: 'bps', label: 'BPS', value: '62,900' },
      ],
    },
  },
  // 04 복합
  {
    card_title: '계좌',
    caption: '모의-주력',
    canvas_type: 'compound',
    fell_back: false,
    data: {
      header: [
        { key: 'tot_evlt_amt', label: '총평가', value: '18,420,500' },
        { key: 'evlt_pl', label: '평가손익', value: '+612,300' },
        { key: 'prft_rt', label: '수익률', value: '+3.44%' },
        { key: 'dpst', label: '예수금', value: '2,100,000' },
        { key: 'ord_psbl', label: '주문가능', value: '2,100,000' },
      ],
      table: {
        columns: [
          { key: 'stk_nm', label: '종목' },
          { key: 'evlt_amt', label: '평가금액' },
        ],
        rows: [
          { stk_nm: '삼성전자', evlt_amt: '10,572,000' },
          { stk_nm: 'SK하이닉스', evlt_amt: '7,848,500' },
          { stk_nm: 'NAVER', evlt_amt: '1,204,000' },
          { stk_nm: '카카오', evlt_amt: '842,000' },
        ],
      },
    },
  },
  // 05 미니 주문 티켓 — card_title이 정확히 「주문 티켓」일 때만 이 카드다(orb.js).
  {
    card_title: '주문 티켓',
    caption: '모의-주력',
    canvas_type: 'facts',
    fell_back: false,
    data: {
      fields: [
        { key: 'symbol', label: '종목', value: '005930' },
        { key: 'symbol_name', label: null, value: '삼성전자' },
        { key: 'side', label: '구분', value: 'buy' },
        { key: 'qty', label: '수량', value: 10 },
        { key: 'estimated_amount', label: '예상 체결금액', value: 881000 },
      ],
    },
  },
  // 06 주문 확인
  {
    card_title: '주문 확인',
    caption: '모의-주력',
    canvas_type: 'action',
    fell_back: false,
    data: { state: 'done', receipt: { ord_no: '0000117', dmst_stex_tp: 'KRX' } },
  },
  // 07 실시간 이벤트
  {
    card_title: '실시간 이벤트',
    caption: '체결 · 005930',
    canvas_type: 'event',
    fell_back: false,
    data: {
      state: 'connected',
      records: [
        { time: '15:29:58', price: '88,100', qty: '1,200' },
        { time: '15:29:57', price: '88,000', qty: '340' },
        { time: '15:29:55', price: '88,000', qty: '90' },
      ],
    },
  },
  // 08 인증 상태
  {
    card_title: '연결 상태',
    caption: 'Kiwoom OAuth',
    canvas_type: 'status',
    fell_back: false,
    data: { configured: true, ready: true, expires_at: '2026-07-20 06:00' },
  },
  // 09 본문
  {
    caption: 'DART · 07-18',
    canvas_type: 'reader',
    fell_back: false,
    data: {
      title: '주요사항보고서',
      body_markdown: '회사는 이사회 결의로 자기주식 취득 신탁계약 체결을 결정했습니다. 계약금액은 3,000억원이며 계약기간은 체결일로부터 6개월입니다.\n\n두 번째 문단은 오브에 오지 않는다.',
    },
  },
  // 10 스트림
  {
    caption: '스트림 · 뉴스',
    canvas_type: 'stream',
    fell_back: false,
    data: {
      records: [
        { title: '삼성전자, 자기주식 3,000억 취득 신탁 결정', ts: '2026-07-19T15:12:00', ts_precision: 'second', source: 'DART' },
        { title: '반도체 수출 3개월 연속 증가', ts: '2026-07-19T14:40:00', ts_precision: 'second', source: '연합인포맥스' },
        { title: '세 번째는 접힌다', ts: '2026-07-19T14:00:00', ts_precision: 'second', source: 'DART' },
      ],
    },
  },
]);


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

// 같은 감시 한 건의 상세 — 보드 06의 설정 편집 폼이 읽는 조건 원문·소스 명세다
// (목록 응답에는 없다, api/routines.py _detail_view). 폼의 필드 수·비교 목록·
// 연속 틱 유무가 전부 source_spec에서 나오므로 이 봉투가 곧 그 화면이다. 값은
// 전부 데이터라 phrases에는 한 글자도 넣지 않는다.
const WATCH_DETAIL = Object.freeze({
  ok: true,
  data: {
    id: 'fx1',
    symbol: '005930',
    status: 'active',
    mode: 'realtime-ws',
    source_label: '현재가',
    cooldown_s: 300,
    expires_at: '2026-09-10T09:00:00',
    note: '삼성전자 88,000 감시',
    briefing_model: 'opus',
    briefing_effort: 'high',
    condition: { source: 'price.current', op: '>=', value: 88000, consecutive_ticks: 1 },
    source_spec: { ops: ['<', '<=', '>', '>='], value_type: 'number', transport: 'ws', label: '현재가' },
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

// 보드 32의 「투자 성향」 구역 — 학습된 성향이 없으면 카드가 빈 상태를 그려
// 「대화에서 학습됨」 꼬리표가 안 붙는다(settings-cards.js fillHistorySections).
// 판정이 이 컴퓨터의 브레인에 좌우되지 않게 상위 신호 한 줄을 못 박는다.
// 대상 이름은 값이라 phrases에 한 글자도 넣지 않는다.
const HISTORY_PROFILE = Object.freeze({
  ok: true,
  entries: [{ entity_name: '반도체 대형주', relation_kind: 'interested_in', reinforcement: 4 }],
});

// 같은 카드의 「보관 중」 한 줄. 백엔드가 답하지 않으면 그 자리가 오류 문구로
// 바뀐다 — 건수는 값이라 phrases에 안 넣고, 이 봉투는 줄이 서게만 한다.
const HISTORY_CONVERSATION_COUNT = Object.freeze({ ok: true, conversations: 128 });

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

// 보드 34의 검색 결과 — 같은 목록에 질의에 걸리는 대화 두 줄을 더한다. 부분일치라
// 아무 목록이나 되는 것이 아니다: 결과 패널은 걸린 것이 있을 때만 그룹을 만든다
// (sidebar-search.js buildSearchResults). 대화 제목은 값이라 phrases에 안 넣는다.
const SIDEBAR_SEARCH_HISTORY = Object.freeze({
  ...SIDEBAR_HISTORY,
  conversations: [...SIDEBAR_HISTORY.conversations,
    { id: 'fx-s9', title: '삼성전자 수급 누가 사는지 알려줘', projectId: 'fx-p1', mode: 'chat' }],
});

// 보드 34의 「캔버스 카드 1건」 — 검색은 #grid에 실제로 붙어 있는 카드만 읽는다
// (sidebar.js collectCanvasCards). 카드가 없으면 그 그룹이 아예 안 생겨 Paper가
// 그린 두 그룹을 못 만든다. 카드 제목은 값이라 phrases에 한 글자도 안 넣는다.
const SEARCH_CANVAS_CARD = Object.freeze({
  canvas_type: 'reader',
  caption: '차트 · 삼성전자 일봉',
  data: { title: '차트 · 삼성전자 일봉', body_markdown: '일봉' },
});

// 보드 36의 「사람이 고른 폴더」 — 탐색기는 OS 대화상자라 프로브가 누를 수 없다.
// 고른 결과를 못 박아야 대화상자가 열린다(athena:project-pick-folder는 아무것도 등록하지
// 않는 조회 갈래다, main.js). 경로는 SIDEBAR_HISTORY의 두 프로젝트가 안 쓰는 폴더라
// 기본 상태(점유 아님)로 떨어지고, 빈 폴더라 안내가 안 뜬다. 경로·이름은 값이라
// phrases에 한 글자도 넣지 않는다.
const PICKED_FOLDER = Object.freeze({
  ok: true,
  path: 'C:\\Projects\\new-strategy',
  name: 'new-strategy',
  empty: true,
});

// 보드 37만 프로젝트를 셋 그린다(아테나 · 키움 리서치 · 개인 연구) — 같은 목록에 한 줄을 더한다.
const SIDEBAR_HISTORY_THREE = Object.freeze({
  ...SIDEBAR_HISTORY,
  projects: [...SIDEBAR_HISTORY.projects,
    { id: 'fx-p3', label: '개인 연구', path: 'C:\\Projects\\personal', pinned: false }],
});

// ── 41번 보드 · 세션 복원 fixture 다섯 ────────────────────────────────────────
// 봉인해 둔 백테스트 작업공간 한 벌을 이력 행 뒤에 못 박는다. 이 컴퓨터에 쌓인 세션에
// 좌우되면 안 되기도 하지만, 그보다 **부분 복원**이 결정론이어야 한다: 결과 데이터셋
// 하나만 못 읽는 상태(Paper의 예시 그대로)는 실제 백엔드에서는 만들 수 없다.
// 종목·기간·k·수수료·줄 수는 전부 값이라 phrases에 한 글자도 넣지 않는다.
const RESTORE_YAML = [
  'version: "1.0"',
  'metadata:',
  '  name: 변동성 돌파',
  'data:',
  '  symbols: ["005930"]',
  '  period: day',
  '  adjusted: true',
  '  from: "20230101"',
  '  to: "20251231"',
  'strategy:',
  '  id: custom',
  '  params:',
  '    k: {default: 0.62, min: 0.1, max: 1, step: 0.01, type: float}',
  '  indicators:',
  '    - {id: SMA, alias: ma_fast, params: {period: 20}}',
  '  entry:',
  '    logic: AND',
  '    conditions:',
  '      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}',
  '  exit:',
  '    logic: OR',
  '    conditions: []',
  'risk:',
  '  stop_loss:   {enabled: true,  percent: 3}',
  '  take_profit: {enabled: false, percent: 20}',
  '  position:    {sizing: all_in}',
  'costs:',
  '  fee_bps: 1.5',
  '  tax_bps: 20',
  '  slippage_bps: 5',
  '',
].join('\n');

// 세션 스냅샷 — 메시지는 currentId 경로 한 줄이고, 작업공간은 42번 보드 항목표 그대로다.
const RESTORE_SNAPSHOT = Object.freeze({
  schemaVersion: 1,
  id: 'fx-s2',
  mode: 'backtest',
  projectId: 'fx-p1',
  title: '변동성 돌파 실험',
  messages: [
    { id: 'm1', parentId: null, role: 'user', text: 'k를 0.62로 올리고 손절을 -3%로 바꿔서 다시 돌려줘', done: true },
    { id: 'm2', parentId: 'm1', role: 'assistant', text: '승률 54.0%, 최대 낙폭 -9.4%로 나아졌습니다.', done: true },
  ],
  currentId: 'm2',
  canvasCards: [],
  jobs: [],
  viewport: { chat: {}, canvas: {}, editor: {}, sidebar: {} },
  workspace: {
    kind: 'backtest',
    tab: 'design',
    designTab: 'form',
    form: { yaml: RESTORE_YAML, fields: ['symbols', 'period', 'fromDt', 'toDt', 'params', 'costs'] },
    code: {
      source: 'def signal(df, k=0.62):\n    rng = df.high.shift(1) - df.low.shift(1)\n    return (df.high >= df.open + rng * k).astype(int)\n',
      file: 'strategy.py',
      runPath: 'code',
    },
    log: { tail: '14:02:11 run start\n14:02:19 trades 126\n14:02:19 done' },
    run: { runId: 'fx-run-9' },
    scroll: { top: 0 },
  },
});

// 이력 행을 눌렀을 때 main이 돌려주는 전환 결과. 모드가 backtest라 셸이 백테스트 캔버스를 연다.
const RESTORE_SET_ACTIVE = Object.freeze({
  ...SIDEBAR_HISTORY,
  activeId: 'fx-s2',
  activeMode: 'backtest',
  requestedId: 'fx-s2',
  restorable: true,
  isCurrent: false,
  resumed: false,
});

// 기법 목록 — 없으면 캔버스가 오류 화면으로 떨어져 복원 표식이 설 자리가 사라진다.
const RESTORE_PRESETS = Object.freeze({
  ok: true,
  data: {
    presets: [{
      id: 'sma_crossover', name: 'SMA 골든크로스', category: 'trend',
      description: '단기 이평이 장기 이평을 상향 돌파하면 진입합니다',
      params: {}, indicators: [], entry: null, exit: null, risk: null,
    }],
  },
});

// 못 읽는 결과 데이터셋 — 41번 보드 Rule 3의 「일부만 복원했습니다」가 서는 유일한 조건이다.
const RESTORE_RESULT_MISSING = Object.freeze({ ok: false, error: '없는 실행입니다' });


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

// 확정성이 섞인 성향 신호 — 보드 07의 채움 세 칸이 지도에 **전부** 서는 유일한
// 봉투다. 위 GRAPH_PROFILE_SIGNALS에는 애매하다고 기록된 줄이 없어 지도가 사실과
// 모름 둘로만 칠해진다. 대상은 GRAPH_CLUSTER_MAP의 노드 id 그대로다 — 신호가 한
// 줄도 없는 나머지 넷은 지도가 정직하게 모름으로 읽는다.
const GRAPH_CERTAINTY_SIGNALS = Object.freeze({
  ok: true,
  total: 312,
  entries: [
    { entity_id: 'fx-samsung', entity_name: '삼성전자', entity_kind: 'security', relation_kind: 'owns', rationale: '체결 4건 · 평균 71,200원', tier: 'deterministic', confidence: 'EXTRACTED', reinforcement: 12 },
    { entity_id: 'fx-hanmi', entity_name: '한미반도체', entity_kind: 'security', relation_kind: 'interested_in', rationale: '어느 쪽인지 대화가 갈렸다', tier: 'conversational', confidence: 'AMBIGUOUS', reinforcement: 3 },
    { entity_id: 'fx-hynix', entity_name: 'SK하이닉스', entity_kind: 'security', relation_kind: 'interested_in', rationale: 'HBM 질문 6개 대화 반복', tier: 'conversational', confidence: 'INFERRED', reinforcement: 6 },
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

// 편집 제안 봉투 — 보드 11의 카드 목업 그대로다(op=remove · 「2차전지」 · avoids).
// main.js가 athena_graph_view action=propose_edit을 이 모양으로 렌더러에 보낸다
// (canvas.js athena:graph-chat-action의 kind==='edit_proposal'). relationId를 안
// 싣는 것도 Paper 그대로다 — 보드가 그린 propose_edit 인자에 그것이 없다.
// 종목명·사유는 전부 값이라 phrases에 한 글자도 넣지 않는다.
const GRAPH_EDIT_PROPOSAL = Object.freeze({
  kind: 'edit_proposal',
  op: 'remove',
  object: '2차전지',
  relation: 'avoids',
  reason: '3주 전 한 번 언급 후 계속 회피',
});

// entity 응답 봉투 — 보드 10이 그린 「응답의 재료」 그대로다(관계 둘 · 이력 셋,
// 첫 관계는 잘리지 않은 발췌, 둘째는 잘린 발췌). main.js가 athena_brain
// action=entity의 응답을 이 모양으로 렌더러에 보낸다(백엔드 EntityDetailResponse,
// brain.py). 이름·수치·원문은 전부 값이라 phrases에 한 글자도 넣지 않는다.
const GRAPH_ENTITY_DETAIL = Object.freeze({
  kind: 'entity',
  detail: {
    revision: 12,
    query: '한미반도체',
    resolved: true,
    entity_id: 'e:hanmi',
    kind: 'security',
    name: '한미반도체',
    degree: 7,
    aliases: [],
    relations: [
      {
        relation_id: 'r1',
        relation_kind: 'interested_in',
        direction: 'in',
        other_entity_id: 'e:me',
        other_entity_kind: 'investor_profile',
        other_entity_name: '투자자',
        confidence: 'EXTRACTED',
        tier: 'conversational',
        rationale: 'HBM 장비 질문 반복',
        observed_at: '2026-08-04T00:00:00Z',
        reinforcement: 4,
        source: {
          source_id: 's1',
          kind: 'chat_message',
          text: 'HBM 장비주가 궁금해서 한미반도체를 계속 보고 있어',
          locator: 'conv-1#3',
          occurred_at: '2026-08-04T09:00:00Z',
          truncated: false,
          full_chars: 28,
        },
      },
      {
        relation_id: 'r2',
        relation_kind: 'belongs_to',
        direction: 'out',
        other_entity_id: 'e:bigcap',
        other_entity_kind: 'theme',
        other_entity_name: '반도체 대형주',
        confidence: 'INFERRED',
        tier: 'conversational',
        rationale: null,
        observed_at: '2026-08-10T00:00:00Z',
        reinforcement: 2,
        source: {
          source_id: 's2',
          kind: 'chat_message',
          text: '반도체 대형주 중심으로 가되 장비주도 조금 섞고 싶어. 지금 비중은',
          locator: 'conv-2#1',
          occurred_at: '2026-08-10T09:00:00Z',
          truncated: true,
          full_chars: 1240,
        },
      },
    ],
    timeline: [
      {
        seq: 9, at: '2026-08-23T00:00:00Z', revision: 12, op: 'edge_added',
        subject_id: 'e:hanmi', object_id: 'e:div', relation: 'belongs_to',
        confidence_before: null, confidence_after: 'INFERRED', source: null,
      },
      {
        seq: 5, at: '2026-08-19T00:00:00Z', revision: 8, op: 'edge_changed',
        subject_id: 'e:me', object_id: 'e:hanmi', relation: 'interested_in',
        confidence_before: 'AMBIGUOUS', confidence_after: 'EXTRACTED', source: null,
      },
      {
        seq: 1, at: '2026-08-04T00:00:00Z', revision: 2, op: 'entity_added',
        subject_id: 'e:hanmi', object_id: null, relation: null,
        confidence_before: null, confidence_after: null, source: null,
      },
    ],
    candidates: [],
  },
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

const CODE_DETAIL_FIRST_CHECK = Object.freeze({
  ok: true,
  data: {
    ...paperCodeDetail('check', WATCH_NODES_FIRST).data,
    last_check: {
      ...paperCodeDetail('check', WATCH_NODES_FIRST).data.last_check,
      cooldown_s: 86400,
      last_fire: '2026-09-01',
      counted_through: '2026-09-04',
      counted_until: '어제까지로 세었음 · 오늘은 진행 중',
      fires: [
        { dt: '2026-08-12', close: 70000 }, { dt: '2026-08-19', close: 70500 },
        { dt: '2026-08-26', close: 71000 }, { dt: '2026-09-01', close: 71500 },
      ],
    },
  },
});
const CODE_DETAIL_ACTIVE = paperCodeDetail('run', WATCH_NODES_LIVE);

// 두 번째 고침을 마치고 다시 검사까지 끝난 초안(보드 11) — 백엔드가 직전 판과
// 지금 검사를 맞대 낸 봉투 모양 그대로다(routines/revisions.fix_cycle과
// _detail_view). 노드의 「3일 → 5일」과 changed는 mark_fixed_nodes가 만든 것이라
// 여기에도 이미 겹쳐져 있다 — WATCH_NODES_AFTER_FIX가 곧 그 결과다.
// 원 핸들러를 부르면 이 컴퓨터의 백엔드에 고침 이력이 있어야만 이 화면이 서므로
// 판정이 머신 상태에 좌우된다. 날짜·배수·건수는 전부 값이라 phrases에 안 넣는다.
const CODE_DETAIL_AFTER_FIX = Object.freeze({
  ok: true,
  data: {
    ...paperCodeDetail('check', WATCH_NODES_AFTER_FIX).data,
    fix_cycle: {
      fix_count: 2,
      past_count: 1,
      fixed_at: '2026-09-05T06:25:00.000Z',
      checked_at: '2026-09-05T06:31:00.000Z',
      lookback_days: 30,
      duration_ms: 9000,
      ok: true,
      skip_reason: null,
      counted_through: '2026-09-04',
      fires_before: 4,
      fires_after: 2,
      fires_before_dates: ['2026-08-12', '2026-08-19', '2026-08-26', '2026-09-01'],
      fires_after_dates: ['2026-08-12', '2026-08-26'],
      changes: [
        { label: '일수', before: '3일', after: '5일' },
        { label: '배수', before: '1.5배', after: '2.0배' },
      ],
      changed_nodes: 2,
      can_rollback: true,
    },
    fix_history: [{ fixed_at: '2026-09-04T02:10:00.000Z', fire_count: 6, lookback_days: 30 }],
  },
});

// 검사 한 번의 응답(보드 09의 자동 검사 진행 패널이 읽는 그것) — 초안 카드의
// 「검사」 칩이 부르는 athena:routine-watch-check가 돌려주는 봉투 모양 그대로다
// (chat.js runWatchCheck가 res.data를 그대로 넘긴다). 원 핸들러를 부르면 백엔드가
// 지난 30일을 실제로 돌려 판정이 이 컴퓨터의 회선과 시계에 좌우된다.
// 종목·배수·걸린 시간은 전부 값이라 phrases에 한 글자도 넣지 않는다.
const WatchCreateCard = require('./watch-create-card');
const WATCH_CREATE = Object.freeze({
  receipt: Object.freeze(WatchCreateCard.buildReceipt([
    '일봉 불러오기', '3일 거래량 평균', '배수 비교', '알림',
  ])),
  poll: WatchCreateCard.POLL_QUESTION,
  cooldown: WatchCreateCard.COOLDOWN_QUESTION,
});

const WATCH_CHECK_DONE = Object.freeze({
  ok: true,
  data: {
    ok: true,
    symbol: '005930',
    lookback_days: 30,
    count: 4,
    last_fire: '2026-08-26',
    fires: [{ dt: '2026-08-26', close: 71000 }],
    nodes: WATCH_NODES_FIRST,
    warnings: [],
    duration_ms: 12000,
    counted_until: '2026-09-04',
    reason: null,
  },
});

// 제어 제안 봉투 다섯(보드 07의 A~E) — main.js:2497이 athena_routine의 propose
// 결과에서 만드는 그 모양이다(control·routineId·current·proposed·rationale·view).
// 모델이 낸 제안은 백엔드에 아무것도 안 남아 클릭으로는 어느 것도 만들 수 없다.
// `current`는 백엔드 목록의 그 행이라(routine_tools.py가 찾아 넣는다) 값이 전부
// 데이터다 — 종목·시각·근거 문장은 phrases에 한 글자도 넣지 않는다.
const PROPOSAL_UPDATE = Object.freeze({
  control: 'update',
  routineId: 'fx-p1',
  current: { id: 'fx-p1', symbol: '005930', note: '삼성전자 88,000원 감시', cooldown_s: 300 },
  proposed: { cooldown_s: 600 },
  rationale: '오늘 발화 4회 · 하루 최대 3회',
});
const PROPOSAL_ACK_ALL = Object.freeze({ control: 'ack_all', rationale: '가장 오래된 알람 2시간 전' });
const PROPOSAL_ADOPT = Object.freeze({
  control: 'adopt',
  proposed: { title: '외국인 순매수 3일 연속' },
  rationale: '성향 신호 312 · 12분 전',
});
const PROPOSAL_VIEW = Object.freeze({ control: 'view', view: { tab: 'tasks', filter: 'paused' } });
const PROPOSAL_FIRE = Object.freeze({
  control: 'fire',
  routineId: 'fx-p2',
  current: { id: 'fx-p2', note: '평일 아침 브리핑', next_fire_at: '2026-09-06T07:30:00' },
  rationale: '마지막 발화 어제 07:30',
});

// 제어가 백엔드에 거절당한 답(보드 08의 「실패 · 재시도」 열). 취소 왕복이 실제로
// 실패해야 결과 턴이 실패로 그려지는데, 원 핸들러는 fixture 루틴을 모르는 백엔드로
// 나가 무엇을 답할지 이 컴퓨터에 좌우된다. 사유 문장은 값이라 phrases에 안 넣는다.
const ROUTINE_CANCEL_REFUSED = Object.freeze({ ok: false, error: '이미 발화된 예약' });

// 제어가 받아들여진 답(보드 08의 「성공」 열). 상세의 [일시중지]가 실제로 성공해야
// 판정 배지 「완료」가 그려지는데, 원 핸들러는 fixture 루틴을 모르는 백엔드로 나간다
// (거절 봉투와 같은 이유). 돌려주는 상태 값은 화면 문구가 아니다.
const ROUTINE_PAUSE_OK = Object.freeze({ ok: true, data: { status: 'paused' } });

// 성향 제안 한 줄 — 보드 08의 「거부」 열은 제안 카드의 [보류]를 누른 결과다.
// 이 봉투가 없으면 제안 뷰가 이 컴퓨터의 브레인에 좌우돼 카드가 아예 없을 수 있다
// (agent-canvas.js renderProactiveCards의 빈 상태). 대상 이름·보강 수는 값이다.
const PROACTIVE_SUGGESTION = Object.freeze({
  ok: true,
  entries: [{
    entity_id: 'fx-e1',
    entity_name: '외국인 순매수',
    relation_kind: 'interested_in',
    reinforcement: 3,
    rationale: '3일 연속 순매수를 물었습니다',
  }],
});

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


// ── 백테스트 페이지(8-1) fixture ────────────────────────────────────────────
// 백테스트 화면은 백엔드(127.0.0.1:8010)가 쥔 기법 목록·캐시된 일봉으로만 선다.
// 이 게이트는 ATHENA_NO_AUTOSTART로 백엔드를 안 띄우므로 첫 왕복부터 status 0이 되어
// 화면이 통째로 오류 패널이 된다(canvas.js backtestError) — 목록·실행·결과·이력·최적화를
// 봉투로 못 박지 않으면 여섯 보드가 전부 그 패널을 잰다. 기법 이름·종목·숫자·날짜는
// 전부 값이라 phrases에는 한 글자도 넣지 않는다.
const BACKTEST_PRESET_YAML = [
  'version: "1.0"',
  'metadata:',
  '  name: 20-60 골든크로스',
  'strategy:',
  '  id: sma_crossover',
  '  category: trend',
  '  params:',
  '    fast: {default: 20, min: 5, max: 60, step: 1, type: int}',
  '    slow: {default: 60, min: 20, max: 240, step: 1, type: int}',
  '  indicators:',
  '    - {id: SMA, alias: ma_fast, params: {period: "$fast"}}',
  '    - {id: SMA, alias: ma_slow, params: {period: "$slow"}}',
  '  entry:',
  '    logic: AND',
  '    conditions:',
  '      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}',
  '  exit:',
  '    logic: OR',
  '    conditions:',
  '      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}',
  'risk:',
  '  stop_loss:   {enabled: true,  percent: 8}',
  '  take_profit: {enabled: false, percent: 20}',
  '  position:    {sizing: all_in}',
].join('\n');

const BACKTEST_PRESETS = Object.freeze({
  ok: true,
  data: {
    presets: [{
      id: 'sma_crossover',
      name: '20-60 골든크로스',
      category: 'trend',
      yaml: BACKTEST_PRESET_YAML,
    }],
  },
});

// 대상·기간을 채우는 자극. 폼 칸에 글자를 넣는 어휘가 표에 없어서가 아니라, 앱에 이미
// 그 일을 하는 문이 있어서다 — 채팅이 낸 설정 초안은 main이 이 채널로 밀고 chat.js가
// 캔버스의 onChatAction으로 넘긴다(chat.js athena:backtest-chat-action 구독). 종목·구간이
// 없으면 [실행]이 폼 검증에서 막혀(backtest-spec.js validate) 보드 03·04에 도달할 수 없다.
const BACKTEST_TARGET = Object.freeze({
  kind: 'spec_draft',
  patch: {
    preset: 'sma_crossover',
    symbols: ['005930'],
    period: 'day',
    fromDt: '20180101',
    toDt: '20260801',
  },
});

// ── 보드 17 fixture — 출처가 지도가 되는 도중 한 프레임 ─────────────────────
// 이 화면은 **잡이 도는 동안에만** 있다. 진짜 잡은 바깥 페이지를 받아 오므로 게이트에서
// 도는 순간 그 왕복이 게이트를 이 컴퓨터의 인터넷에 매단다 — 그래서 3/5 단계 한 프레임을
// 봉투로 못 박는다(ipc-hang이 「확인 중」을 세우는 것과 같은 자리다: 시간축 위의 한 점을
// 잡는다). 대신 잰다고 적은 문구는 **전부 앱이 가진 것**이다 — 단계 이름·부제처럼 이
// 봉투가 주는 글자는 phrases에 한 글자도 넣지 않았다. 넣으면 게이트가 재는 것이 앱이
// 아니라 이 표가 된다.
const SOURCE_MAP_JOB_START = Object.freeze({ ok: true, data: { job_id: 'fx-sm-1' } });

// 이 봉투는 **잡이 실제로 내는 프레임**이다 — source_to_map.SourceMapJob.to_dict()를
// 3/5 단계에서 그대로 떠 왔다(칸 둘이 서고 ③이 그리는 중, ④는 뼈대). 손으로 줄인
// 모양을 적으면 게이트가 못 박는 프레임이 백엔드가 내는 프레임이 아니게 된다.
const SOURCE_MAP_AT_3 = Object.freeze({
  ok: true,
  data: {
    job_id: 'fx-sm-1',
    url: 'https://youtu.be/8kQzVw',
    status: 'running',
    title: '20일 신고가 돌파',
    source_kind: 'youtube',
    source_kind_ko: '유튜브',
    step_index: 3,
    step_total: 5,
    eta_seconds: 8,
    steps: [
      { id: 'read', state: 'done', title_ko: '출처 읽음', meta_ko: '유튜브 · 14,200자' },
      { id: 'rules', state: 'done', title_ko: '규칙 뽑음', meta_ko: '진입 1 · 청산 1 · 손절 1' },
      {
        id: 'map', state: 'running', title_ko: '지도 그리는 중',
        meta_ko: '칸 3/4 · 지금 ③ 사고·파는 순간을 찍습니다',
      },
      { id: 'code', state: 'todo', title_ko: '코드 만들기', meta_ko: '지도 뒤에서 자동' },
      { id: 'check', state: 'todo', title_ko: '자체 검사', meta_ko: '가상환경 · 짧은 구간 시험 실행' },
    ],
    target_ko: '코스피 대형주 · 일봉 · 3년',
    target_confirmed: false,
    rules: [
      { kind: 'entry', kind_ko: '진입', text: '· 진입: 종가가 20일 최고가를 넘는 날', mapped: true },
      { kind: 'exit', kind_ko: '청산', text: '· 청산: 20일 이동평균 아래로 마감', mapped: true },
      { kind: 'stop', kind_ko: '손절', text: '· 손절: 진입가 -5%', mapped: true },
    ],
    map: {
      version: 0,
      source_kind: 'spec',
      target: null,
      app_before: [{
        key: 'load', title: '봉 데이터를 모읍니다',
        detail: '캐시에 있는 봉을 날짜순으로 정리해 표 하나로 만듭니다',
      }],
      app_after: [
        {
          key: 'fill', title: '사고·파는 가격을 정합니다',
          detail: '신호가 난 다음 봉의 시가로 체결합니다 — 같은 봉 종가로 체결하면 미래를 본 것입니다',
        },
        {
          key: 'cost', title: '비용을 뗍니다',
          detail: '수수료·거래세·슬리피지를 뺀 다음 손익을 씁니다',
        },
        {
          key: 'metrics', title: '성과를 냅니다',
          detail: '지표 6장·자산곡선·체결 표를 결과 화면으로 보냅니다',
        },
      ],
      boundary_after_note: 'entry·exit 두 열만 받습니다',
      boundary_after_lines: null,
      nodes: [
        {
          id: 'params', numeral: '①', title: '조절할 값을 정합니다',
          lines: [
            { role: null, text: 'hh20_period 20 (2–240, 1씩)' },
            { role: null, text: 'ma20_period 20 (2–240, 1씩)' },
          ],
          facts: [], status: 'ok', note: null,
          first_line: null, last_line: null, editable: true,
        },
        {
          id: 'indicators', numeral: '②', title: '가격을 지표로 바꿉니다',
          lines: [
            { role: null, text: 'hh20 — DONCHIAN(20) · 고가·저가·종가' },
            { role: null, text: 'ma20 — SMA(20) · 종가' },
          ],
          facts: [], status: 'ok', note: null,
          first_line: null, last_line: null, editable: true,
        },
        {
          id: 'conditions', numeral: '③', title: '사고·파는 순간을 찍습니다',
          lines: [
            { role: 'entry', text: 'close가 hh20_upper를 위로 뚫는 날' },
            { role: 'exit', text: 'close가 ma20를 아래로 뚫는 날' },
          ],
          facts: [], status: 'ok', note: null,
          first_line: null, last_line: null, editable: true, drawing: true,
        },
        {
          id: 'guard', numeral: '④', title: '',
          lines: [], facts: [], status: 'ok', note: null,
          first_line: null, last_line: null, editable: false, skeleton: true,
        },
      ],
      free_code: [],
      unknown: [],
      error: null,
      // 폼 지도는 codegen이 뒤에서 코드를 지어 세어 보므로 이 칸이 언제나 찬다 —
      // 서랍에 [코드 열기]가 안 서는 근거는 이것이 아니라 만드는 중 화면에는 그 코드를
      // 여는 자리가 없다는 것이다(코드는 다 그린 지도와 함께 전략으로 넘어온다).
      code: { lines: 20, matches_map: true },
    },
    map_filled: 2,
    map_total: 4,
    code_lines: null,
    checks: null,
    error: null,
  },
});

// 사람이 채팅에 붙인 주소 하나. 제품에서 이 액션을 만드는 것은 모델이 부르는
// athena_backtest action=source_map이고(backtest_tools.py), main.js가 그 봉투를 이
// 채널로 옮긴다 — 게이트는 그 마지막 한 칸만 대신 쏜다.
const SOURCE_URL_ACTION = Object.freeze({
  kind: 'source_url',
  url: 'https://youtu.be/8kQzVw',
});

// 보드 04 — 캐시가 모자라 실행하지 않았다는 409. 실패가 아니라 승인 화면 전환 신호라
// canvas.js가 blocked로 정규화하고, 캔버스는 그 숫자로 승인 카드를 세운다.
const BACKTEST_RUN_BLOCKED = Object.freeze({
  ok: false,
  status: 409,
  error: 'cache miss',
  detail: { needed_pages: 4, est_seconds: 5 },
});

// 보드 03 — 실행이 곧바로 끝난 판. 폴링이 첫 tick에서 done을 보고 결과 화면으로 넘어간다.
const BACKTEST_RUN_OK = Object.freeze({ ok: true, data: { run_id: 'fx-run-41' } });
const BACKTEST_RESULT = Object.freeze({
  ok: true,
  data: {
    status: 'done',
    metrics: {
      total_return: 1.842, cagr: 0.213, sharpe: 0.87, mdd: -0.279,
      win_rate: 0.58, profit_factor: 1.94, bars: 2559, warmup_bars: 60,
      mdd_start: '2020-03', mdd_bars: 87, closed_trades: 41, winning_trades: 24,
      buy_hold_return: 1.41, run_path: 'form',
    },
    equity: [1, 1.12, 0.98, 1.31, 1.55, 1.84],
    benchmark: [70000, 74000, 68000, 82000, 95000, 99000],
    stdout: '',
    params: { fast: 20, slow: 60 },
    version: 4,
    source: '',
  },
});
const BACKTEST_TRADES = Object.freeze({
  ok: true,
  data: {
    trades: [
      { dt: '2018-04-11', side: 'buy', price: 51200, qty: 19, fee: 146, tax: 0, pnl: 0, reason: 'signal' },
      { dt: '2018-09-03', side: 'sell', price: 58900, qty: 19, fee: 168, tax: 2014, pnl: 144118, reason: 'stop_loss' },
    ],
  },
});

// 보드 05 — Paper가 그린 네 줄(#41·#38·#36·#29) 그대로. 마지막 줄만 실패다.
const BACKTEST_RUNS = Object.freeze({
  ok: true,
  data: {
    runs: [
      { run_id: 'fx-run-41', status: 'done', metrics: { total_return: 1.842, sharpe: 0.87, mdd: -0.279, win_rate: 0.58 } },
      { run_id: 'fx-run-38', status: 'done', metrics: { total_return: 0.967, sharpe: 0.51, mdd: -0.346, win_rate: 0.49 } },
      { run_id: 'fx-run-36', status: 'done', metrics: { total_return: -0.121, sharpe: -0.12, mdd: -0.412, win_rate: 0.37 } },
      { run_id: 'fx-run-29', status: 'failed', metrics: null },
    ],
  },
});

// 보드 06 — 탐색이 끝난 판. 경고 한 줄이 있어야 「과최적화 의심」이 서고, 히트맵의 두 축이
// 그대로 제목이 된다(x_axis × y_axis).
const BACKTEST_OPTIMIZE = Object.freeze({
  ok: true,
  data: {
    best: { params: { fast: 20, slow: 60 }, sharpe: 0.87 },
    neighbour_mean_sharpe: 0.42,
    warnings: [{ kind: 'peak', message: '최고점이 이웃보다 0.4 이상 튑니다 — 넓은 언덕을 고르세요' }],
    heatmap: {
      x_axis: 'fast',
      y_axis: 'slow',
      min_sharpe: -0.2,
      max_sharpe: 0.87,
      cells: [
        { x: 5, y: 20, sharpe: -0.2 }, { x: 20, y: 60, sharpe: 0.87 },
        { x: 40, y: 120, sharpe: 0.31 }, { x: 60, y: 240, sharpe: 0.12 },
      ],
    },
  },
});

// 코드 경로를 세우는 자극(보드 07·09). 배포 폼의 갈래 셋도 진단 패널도 「방금 그 실행이
// 어느 버전이었나」를 알아야 서는데, 그 id는 **코드로 돈 실행**에서만 온다
// (backtest-canvas.js startRun의 codeRun). 채팅이 코드를 얹는 문이 이미 있어
// (applyCodeAction — runPath를 code로 옮기고 편집기 버퍼를 채운다) 새 어휘가 필요 없다.
// 파이썬 원문은 값이라 phrases에 한 글자도 넣지 않는다.
const BACKTEST_CODE_DRAFT = Object.freeze({
  kind: 'code_draft',
  source: [
    'import athena_bt as bt',
    '',
    'PARAMS = {',
    '    "fast":     {"default": 20,  "min": 5,   "max": 60},',
    '    "slow":     {"default": 60,  "min": 20,  "max": 240},',
    '    "atr_mult": {"default": 2.0, "min": 0.5, "max": 5.0},',
    '}',
    '',
    'def signals(df, p):',
    '    fast = bt.sma(df.close, p["fast"])',
    '    slow = bt.sma(df.close, p["slow"])',
    '    atr  = bt.atr(df, 14)',
    '',
    '    entry = bt.cross_above(fast, slow)',
    '    stop = df.close - atr * p["atr_mult"]',
    '    exit_ = bt.cross_below(fast, slow) | (df.low <= stop)',
    '',
    '    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]',
    '',
  ].join('\n'),
});

const BACKTEST_FLOW_MAP = Object.freeze({
  ok: true,
  data: {
    version: 1,
    source_kind: 'code',
    app_before: [{ key: 'load', title: '봉 데이터를 모읍니다', detail: '' }],
    app_after: [
      { key: 'fill', title: '사고·파는 가격을 정합니다', detail: '' },
      { key: 'cost', title: '비용을 뗍니다', detail: '' },
      { key: 'metrics', title: '성과를 냅니다', detail: '' },
    ],
    nodes: [
      { id: 'params', numeral: '①', title: '조절할 값을 정합니다', lines: [], facts: [], status: 'ok' },
      { id: 'indicators', numeral: '②', title: '가격을 지표로 바꿉니다', lines: [], facts: [], status: 'ok' },
      { id: 'conditions', numeral: '③', title: '사고·파는 순간을 찍습니다', lines: [], facts: [], status: 'ok' },
      { id: 'output', numeral: '④', title: '두 열만 돌려줍니다', lines: [], facts: [], status: 'ok' },
    ],
  },
});

// 보드 07 — 버전 id를 실은 실행 응답. BACKTEST_RUN_OK와 나누는 이유는 보드 03이
// 재는 것이 결과 화면이라 버전 id가 없어도 그대로 서기 때문이다(그쪽 봉투를 늘리면
// 보드 03의 판정이 배포 쪽 사정에 끌려간다).
const BACKTEST_RUN_VERSIONED = Object.freeze({
  ok: true,
  data: { run_id: 'fx-run-41', strategy_id: 'fx-st-4', version_id: 'fx-ver-4' },
});

// 보드 07 — 가동 중인 배포 한 줄. 종목·모드 라벨·상태·한도 숫자는 전부 백엔드가 준
// 값이라(renderDeploy가 그대로 그린다) phrases에 한 글자도 넣지 않는다.
const BACKTEST_DEPLOYMENTS = Object.freeze({
  ok: true,
  data: {
    deployments: [{
      id: 'fx-dep-4',
      stk_cd: '005930',
      mode: 'approve',
      mode_label: '승인을 받고 주문합니다',
      status: 'active',
      armed: false,
      auto_armed: false,
      expired: false,
      limits: { max_order_amount: 2000000, max_orders_per_day: 2 },
    }],
  },
});

// 오늘 로그가 읽는 신호. 빈 목록이라야 판정이 검사 머신의 날짜에 안 좌우된다 —
// 값을 주면 「오늘」에 걸리는 줄이 도는 날마다 달라진다(todaySignals).
const BACKTEST_NO_SIGNALS = Object.freeze({ ok: true, data: { signals: [] } });

// 보드 09 — 코드가 터진 실행. 폴링이 첫 tick에서 failed를 보고 진단으로 넘어간다.
const BACKTEST_RESULT_FAILED = Object.freeze({
  ok: true,
  data: { status: 'failed', error: 'TypeError: 20번째 줄' },
});

// 보드 09 — 진단 봉투. 제목·사유·수정안 문장은 백엔드 diagnose가 만드는 값이라
// phrases에 한 글자도 넣지 않는다 — 이 보드에서 화면이 갖고 있는 문구는 서랍 손잡이
// 하나와 갈래 셋뿐이다.
const BACKTEST_DIAGNOSIS = Object.freeze({
  ok: true,
  data: {
    title: '20번째 줄에서 멈췄습니다',
    detail: '신호를 한 개도 만들지 못했습니다.',
    raw: 'TypeError: \'>=\' not supported between instances of \'float\' and \'NoneType\'',
    why: 'ATR(14)은 앞 14봉이 모여야 첫 값이 나옵니다.',
    line: 20,
    suggestion: {
      removed: 1,
      added: 2,
      summary: '20줄 하나만 바꿉니다',
      diff_lines: [
        { mark: '-', text: '    stop = df.close - atr * p["atr_mult"]' },
        { mark: '+', text: '    stop = (df.close - atr * p["atr_mult"]) \\' },
        { mark: '+', text: '             .where(entry).ffill()' },
      ],
      new_source: 'import athena_bt as bt\n',
    },
  },
});

// ── 시각 전략 편집기 4장(보드 11~14) fixture ────────────────────────────────
// 편집 표면은 백엔드 왕복 셋으로만 선다(registry → from-spec → validate). 하나라도
// 비면 지도 탭이 읽기 전용으로 접혀(ensureVisualGraph의 실패 갈래) 네 보드가 전부
// 같은 알림 한 줄을 재게 된다. 노드 이름·기간·포트 타입·파이썬 원문은 전부 값이라
// phrases에는 한 글자도 넣지 않는다 — 이 넷에서 화면이 갖고 있는 문구는 팔레트·
// 캔버스 머리·요약 바·검사기의 구조 라벨뿐이다.
const VIS_NUM = 'Series<Number>';
const VIS_BOOL = 'Series<Bool>';

function visCondition(kind, labelKo) {
  return {
    kind,
    label_ko: labelKo,
    group: '조건',
    inputs: [
      { port: 'left', type: VIS_NUM, required: true },
      { port: 'right', type: `${VIS_NUM}|Number`, required: true },
    ],
    outputs: [{ port: 'signal', type: VIS_BOOL }],
    params: [],
  };
}

// Paper가 그린 팔레트 네 묶음(데이터 · 지표 · 조건 · 출력) 그대로다.
const VISUAL_REGISTRY = Object.freeze({
  ok: true,
  data: {
    kinds: [
      {
        kind: 'data.ohlcv',
        label_ko: '가격 데이터',
        group: '데이터',
        inputs: [],
        outputs: [{ port: 'close', type: VIS_NUM }, { port: 'volume', type: VIS_NUM }],
        params: [],
      },
      {
        kind: 'param',
        label_ko: '파라미터',
        group: '데이터',
        inputs: [],
        outputs: [{ port: 'value', type: 'Number' }],
        params: [{ name: 'name', type: 'str' }, { name: 'default', type: 'number' }],
      },
      {
        kind: 'indicator.sma',
        label_ko: '이동평균 SMA',
        group: '지표',
        inputs: [
          { port: 'source', type: VIS_NUM, required: true },
          { port: 'period', type: 'Number', required: false },
        ],
        outputs: [{ port: 'value', type: VIS_NUM }],
        params: [
          { name: 'alias', type: 'str' },
          { name: 'period', type: 'number', default: 20, min: 5, max: 60 },
        ],
      },
      visCondition('condition.cross_above', '상향 돌파'),
      visCondition('condition.cross_below', '하향 돌파'),
      {
        kind: 'output.entry',
        label_ko: '진입 신호',
        group: '출력',
        inputs: [{ port: 'signal', type: VIS_BOOL, required: true }],
        outputs: [],
        params: [],
      },
      {
        kind: 'output.exit',
        label_ko: '청산 신호',
        group: '출력',
        inputs: [{ port: 'signal', type: VIS_BOOL, required: true }],
        outputs: [],
        params: [],
      },
    ],
  },
});

function visEdge(id, fromNode, fromPort, toNode, toPort) {
  return { id, from: { node_id: fromNode, port: fromPort }, to: { node_id: toNode, port: toPort } };
}

// 보드 11이 그린 그래프 그대로 — 7개 노드 · 8개 연결 · 진입 1 · 청산 1.
const VIS_NODES = Object.freeze([
  { id: 'n_data', kind: 'data.ohlcv', label: '가격 데이터', params: {}, ui: { x: 16, y: 218 } },
  { id: 'n_fast', kind: 'indicator.sma', label: '빠른 SMA', params: { alias: 'ma_fast', period: 20 }, ui: { x: 125, y: 100 } },
  { id: 'n_slow', kind: 'indicator.sma', label: '느린 SMA', params: { alias: 'ma_slow', period: 60 }, ui: { x: 125, y: 315 } },
  { id: 'n_above', kind: 'condition.cross_above', label: '상향 돌파', params: {}, ui: { x: 245, y: 100 } },
  { id: 'n_below', kind: 'condition.cross_below', label: '하향 돌파', params: {}, ui: { x: 245, y: 315 } },
  { id: 'n_entry', kind: 'output.entry', label: '진입', params: {}, ui: { x: 360, y: 115 } },
  { id: 'n_exit', kind: 'output.exit', label: '청산', params: {}, ui: { x: 360, y: 330 } },
]);
const VIS_EDGES = Object.freeze([
  visEdge('e1', 'n_data', 'close', 'n_fast', 'source'),
  visEdge('e2', 'n_data', 'close', 'n_slow', 'source'),
  visEdge('e3', 'n_fast', 'value', 'n_above', 'left'),
  visEdge('e4', 'n_slow', 'value', 'n_above', 'right'),
  visEdge('e5', 'n_fast', 'value', 'n_below', 'left'),
  visEdge('e6', 'n_slow', 'value', 'n_below', 'right'),
  visEdge('e7', 'n_above', 'signal', 'n_entry', 'signal'),
  visEdge('e8', 'n_below', 'signal', 'n_exit', 'signal'),
]);

function visualGraphOf(edges) {
  return {
    graph_version: '1',
    nodes: VIS_NODES.map((node) => Object.assign({}, node)),
    edges: edges.map((edge) => JSON.parse(JSON.stringify(edge))),
    scenario: { symbol: '005930', period: '1d', adjusted: true },
  };
}

const VISUAL_FROM_SPEC = Object.freeze({
  ok: true,
  data: { graph: visualGraphOf(VIS_EDGES), hashes: { graph_hash: 'fx-graph-8' } },
});
// 보드 12·13 — 하향 돌파의 오른쪽 입력(e6)이 끊긴 그래프.
const VISUAL_FROM_SPEC_BROKEN = Object.freeze({
  ok: true,
  data: {
    graph: visualGraphOf(VIS_EDGES.filter((edge) => edge.id !== 'e6')),
    hashes: { graph_hash: 'fx-graph-7' },
  },
});

// 보드 13이 여는 **미실행 미리보기**. 17행이 Paper가 가리킨 그 줄이고, preview_hash는
// 이 문자열의 sha256이다 — 한 글자라도 어긋나면 편집기가 「낡았다」며 열지 않는다
// (backtest-code-editor.js spanIsValid). 파이썬 원문은 값이라 phrases에 안 넣는다.
const VISUAL_PREVIEW_SOURCE = [
  'import athena_bt as bt',
  '',
  'PARAMS = {',
  '    "fast": {"default": 20, "min": 5, "max": 60},',
  '    "slow": {"default": 60, "min": 20, "max": 240},',
  '}',
  '',
  '',
  'def signals(df, p):',
  '    close = df.close',
  '    fast = bt.sma(close, p["fast"])',
  '    slow = bt.sma(close, p["slow"])',
  '',
  '    entry = bt.cross_above(fast, slow)',
  '',
  '    # 청산 조건',
  '    exit_ = bt.cross_below(fast, __MISSING__)',
  '',
  '    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]',
  '',
].join('\n');
const VISUAL_PREVIEW_HASH = '680a5e4f2c5dff8dc91c10d5ee270773f2c06bea377b4be4bfb3b6cc10f526b6';

const VISUAL_SPAN = Object.freeze({
  file: 'golden_cross.py',
  start: { line: 17, column: 4 },
  end: { line: 17, column: 44 },
});

const VISUAL_VALIDATE_OK = Object.freeze({
  ok: true,
  data: { valid: true, diagnostics: [], hashes: { graph_hash: 'fx-graph-8' } },
});
const VISUAL_VALIDATE_BROKEN = Object.freeze({
  ok: true,
  data: {
    valid: false,
    diagnostics: [{
      code: 'BTG-PORT-002',
      severity: 'error',
      node_id: 'n_below',
      port: 'right',
      json_path: '$.nodes[4].inputs.right',
      source_span: VISUAL_SPAN,
      message_ko: '느린 SMA 입력이 없습니다',
    }],
    preview: { source: VISUAL_PREVIEW_SOURCE },
    source_map: {
      preview_hash: VISUAL_PREVIEW_HASH,
      entries: [{ node_id: 'n_below', source_span: VISUAL_SPAN }],
    },
    hashes: { graph_hash: 'fx-graph-7' },
  },
});

// 보드 14 — 검증을 넘긴 그래프를 코드로 옮긴 산출물. spec_yaml은 폼이 그래프를
// 따라오는 값이라(adoptSpecYaml) 프리셋의 것과 같은 문법이면 된다.
const VISUAL_COMPILE = Object.freeze({
  ok: true,
  data: {
    spec_yaml: BACKTEST_PRESET_YAML,
    spec: null,
    source: VISUAL_PREVIEW_SOURCE,
    source_map: { artifact_hash: VISUAL_PREVIEW_HASH, entries: [] },
    hashes: { graph_hash: 'fx-graph-8', artifact_hash: VISUAL_PREVIEW_HASH },
  },
});

// ── 기법 목록(보드 19) fixture ──────────────────────────────────────────────
// Paper는 처음 있던 10개와 내가 만든 1개를 한 목록에 세웠다. 그 열하나가 실제로 서야
// 「처음 있던 10개와 내가 만든 1개를 구분하지 않습니다」가 화면에 그대로 뜬다 —
// 그 줄은 앱이 두 목록의 길이로 만든다(renderTechniqueList). 이름·설명·경로는 값이라
// phrases에 한 글자도 넣지 않는다.
function techniquePreset(id, name, category, description) {
  return { id, name, category, description, yaml: BACKTEST_PRESET_YAML };
}
const BACKTEST_TECHNIQUE_PRESETS = Object.freeze({
  ok: true,
  data: {
    presets: [
      techniquePreset('sma_crossover', '20-60 골든크로스', 'trend', '20일선이 60일선을 위로 뚫으면 사고, 아래로 뚫으면 팝니다.'),
      techniquePreset('bb_bounce', '볼린저 하단 반등', 'reversion', '가격이 하단 밴드를 찍고 돌아설 때 삽니다.'),
      techniquePreset('high20', '20일 신고가 돌파', 'breakout', '직전 20봉 최고가를 종가로 넘기면 삽니다.'),
      techniquePreset('rsi_reversal', 'RSI 과매도 반전', 'reversal', ''),
      techniquePreset('macd_cross', 'MACD 시그널 교차', 'momentum', 'MACD가 시그널선을 위로 지날 때 삽니다.'),
      techniquePreset('disparity', '이격도 회귀', 'reversion', '20일선에서 너무 벌어지면 되돌림을 노립니다.'),
      techniquePreset('volume_surge', '거래량 급증 추격', 'momentum', '평균 거래량의 3배가 터진 날 종가에 붙습니다.'),
      techniquePreset('gap_pullback', '갭 상승 눌림 매수', 'breakout', '갭으로 뛴 뒤 첫 눌림에서 삽니다.'),
      techniquePreset('sma_5_20', '5-20 단기 교차', 'trend', '짧은 두 이동평균의 교차만 봅니다.'),
      techniquePreset('vol_breakout', '변동성 돌파', 'volatility', '전일 변동폭의 절반을 넘으면 그날 삽니다.'),
    ],
  },
});
const BACKTEST_USER_STRATEGIES = Object.freeze({
  ok: true,
  data: {
    strategies: [{
      id: 'fx-us-1',
      name: '내 ATR 돌파 + 손절',
      path: 'techniques/my-atr-breakout/strategy.py',
      exists: true,
      params: {},
    }],
  },
});

// ── 새 기법 만들기 3장(보드 20·21·22) fixture ───────────────────────────────
// 새 기법은 「목록 화면에서 대화가 낸 설정·코드」로 시작한다(startTechniqueFromChat) —
// 앱의 [+ 새 기법 만들기]는 첫 문장을 채팅으로 던지므로 검사에서 누르면 모델 왕복이
// 붙는다. 같은 뼈대를 세우는 이 문이 클릭 없이 결정론을 준다.
//
// 폴더는 fixture다: 프로젝트 채널 여섯(만들기·목록·트리·읽기·쓰기·환경)을 전부 가짜로
// 못 박아 화면이 보드 20의 왼쪽 열(기법 폴더 트리 · 자동 검사 · 환경)을 세우게 한다.
// 이 게이트가 도는 컴퓨터의 백엔드에는 아무 폴더도 쌓이지 않는다 — 백엔드에 닿는
// 채널이 하나도 없다. 「폴더 없이 시작합니다」로 물러나는 갈래는 단위 테스트가 잰다.
const TECHNIQUE_PROJECT = Object.freeze({
  id: 'fx-tp-1',
  name: '새-기법-260907-1840',
  path: 'C:/fx/.athena/projects/새-기법-260907-1840',
  kind: 'managed',
  created_at: '2026-09-07T09:40:00Z',
  exists: true,
  py_files: 2,
});
const TECHNIQUE_PROJECT_CREATE = Object.freeze({
  ok: true, data: { project: TECHNIQUE_PROJECT, seed: 'strategy.py' },
});
const TECHNIQUE_PROJECT_LIST = Object.freeze({
  ok: true, data: { projects: [TECHNIQUE_PROJECT], notice: null },
});
const TECHNIQUE_PROJECT_TREE = Object.freeze({
  ok: true,
  data: {
    project_id: 'fx-tp-1',
    root: TECHNIQUE_PROJECT.path,
    entries: [
      { name: 'strategy.py', path: 'strategy.py', is_dir: false, py: true, size: 640 },
      {
        name: 'tests', path: 'tests', is_dir: true, py: false, size: 0,
        children: [
          { name: 'test_strategy.py', path: 'tests/test_strategy.py', is_dir: false, py: true, size: 520 },
        ],
      },
    ],
    truncated: false,
  },
});
// 처음 여는 순간의 파일 본문 — 뼈대다. 그 뒤 대화가 낸 코드는 쓰기 fixture를 지나 버퍼에
// 그대로 얹힌다(adoptExternalWrite)라 여기 무엇이 있든 화면의 코드는 대화가 낸 것이다.
const TECHNIQUE_PROJECT_FILE = Object.freeze({
  ok: true,
  data: {
    path: 'strategy.py',
    text: [
      'import athena_bt as bt',
      '',
      'PARAMS = {}',
      '',
      '',
      'def signals(df, p):',
      '    df["entry"] = False',
      '    df["exit"] = False',
      '    return df[["entry", "exit"]]',
      '',
    ].join('\n'),
  },
});
const TECHNIQUE_PROJECT_WRITE = Object.freeze({
  ok: true, data: { path: 'strategy.py', size: 640, mtime: 1 },
});
const TECHNIQUE_PROJECT_ENV = Object.freeze({
  ok: true,
  data: { project_id: 'fx-tp-1', exists: false, python: null, packages: [], base_ok: false },
});
const TECHNIQUE_PROJECT_FIXTURES = Object.freeze([
  { do: 'ipc-fixture', channel: 'athena:project-create', data: TECHNIQUE_PROJECT_CREATE },
  { do: 'ipc-fixture', channel: 'athena:project-list', data: TECHNIQUE_PROJECT_LIST },
  { do: 'ipc-fixture', channel: 'athena:project-tree', data: TECHNIQUE_PROJECT_TREE },
  { do: 'ipc-fixture', channel: 'athena:project-file-read', data: TECHNIQUE_PROJECT_FILE },
  { do: 'ipc-fixture', channel: 'athena:project-file-write', data: TECHNIQUE_PROJECT_WRITE },
  { do: 'ipc-fixture', channel: 'athena:project-env-get', data: TECHNIQUE_PROJECT_ENV },
]);

// 대상만 채우는 설정 초안 — preset을 싣지 않아야 새 기법의 뼈대가 선다(preset이 오면
// 그 기법을 고르는 길이다). 종목·기간은 값이라 phrases에 안 넣는다.
const TECHNIQUE_DRAFT_TARGET = Object.freeze({
  kind: 'spec_draft',
  patch: { symbols: ['005930'], period: 'day', fromDt: '20240101', toDt: '20260801' },
});

// 검사 결과. 항목 이름(문법·계약·룩어헤드…)은 백엔드 label_ko가 그대로 화면 문구라
// phrases에 한 글자도 넣지 않는다 — 화면이 가진 것은 제목 「터미널」과 갈래 표시뿐이다.
function techniqueCheck(id, labelKo, ok, severity) {
  return { id, label_ko: labelKo, ok, severity };
}
const TECHNIQUE_CHECKS_BLOCKED = Object.freeze({
  ok: true,
  data: {
    passed: false,
    checks: [
      techniqueCheck('syntax', '문법', true, 'block'),
      techniqueCheck('contract', '계약', true, 'block'),
      techniqueCheck('smoke', '시험 실행', false, 'block'),
      techniqueCheck('lookahead', '룩어헤드', false, 'block'),
      techniqueCheck('warmup', '워밍업', false, 'block'),
    ],
    stats: null,
    log: ['$ athena check strategy.py'],
  },
});
const TECHNIQUE_CHECKS_PASSED = Object.freeze({
  ok: true,
  data: {
    passed: true,
    checks: [
      techniqueCheck('syntax', '문법', true, 'block'),
      techniqueCheck('contract', '계약', true, 'block'),
      techniqueCheck('smoke', '시험 실행', true, 'block'),
      techniqueCheck('lookahead', '룩어헤드', true, 'block'),
      techniqueCheck('warmup', '워밍업', true, 'block'),
    ],
    stats: { warmup_bars: 20, entry: 31, exit: 29, rows: 2559 },
    log: ['$ athena check strategy.py'],
  },
});

// 보드 21이 그린 다섯 함수와 두 갈래. 첫 함수가 두 갈래에 함께 나와 둘째 카드가
// 고스트('재사용')가 된다 — 보드 21이 그 규칙을 그렸다. 이름·줄 범위·설명은 전부
// 그 파이썬을 읽은 값이다.
function techniqueNode(id, summary, first, last, params, returns, role) {
  return {
    id,
    label: `${id}()`,
    summary_ko: summary,
    first_line: first,
    last_line: last,
    params,
    returns_hint: returns,
    calls: [],
    role,
  };
}
const TECHNIQUE_NODES = Object.freeze({
  ok: true,
  data: {
    granularity: 'function',
    nodes: [
      techniqueNode('compute_atr', '변동폭(ATR)을 n봉 평균으로 구한다', 10, 13, ['df', 'n'], 'Series', 'indicator'),
      techniqueNode('breakout_level', '직전 lookback봉의 최고가 = 돌파선', 15, 17, ['df', 'lookback'], 'Series', 'indicator'),
      techniqueNode('should_enter', '돌파선을 넘고 변동폭이 살아 있으면 산다', 19, 24, ['df', 'i', 'atr'], 'bool', 'entry'),
      techniqueNode('should_exit', '산 가격에서 ATR의 1.5배만큼 내려오면 판다', 26, 34, ['df', 'i', 'entry', 'atr'], 'bool', 'exit'),
      techniqueNode('position_size', '한 번에 걸 돈을 변동폭으로 나눠 정한다', 36, 41, ['cash', 'atr'], 'int', 'sizing'),
    ],
    flows: {
      entry: ['compute_atr', 'breakout_level', 'should_enter', 'position_size'],
      exit: ['compute_atr', 'should_exit'],
    },
    unknown: [],
  },
});

// 보드 22 — 두 번째 고침. 첫 코드와 다른 원문이라야 diff가 생긴다(같은 원문이면
// 단계 카드도 diff도 안 남는다). 파이썬은 값이라 phrases에 안 넣는다.
const BACKTEST_CODE_DRAFT_2 = Object.freeze({
  kind: 'code_draft',
  source: [
    'import athena_bt as bt',
    '',
    'PARAMS = {',
    '    "fast":      {"default": 20,  "min": 5,   "max": 60},',
    '    "slow":      {"default": 60,  "min": 20,  "max": 240},',
    '    "exit_mult": {"default": 1.5, "min": 0.5, "max": 5.0},',
    '    "min_hold":  {"default": 3,   "min": 1,   "max": 20},',
    '}',
    '',
    'def signals(df, p):',
    '    fast = bt.sma(df.close, p["fast"])',
    '    slow = bt.sma(df.close, p["slow"])',
    '    atr  = bt.atr(df, 14)',
    '',
    '    entry = bt.cross_above(fast, slow)',
    '    stop = df.close - atr * p["exit_mult"]',
    '    exit_ = bt.cross_below(fast, slow) | (df.low <= stop)',
    '',
    '    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]',
    '',
  ].join('\n'),
});

// 보드 23 — 키우미가 켜진 배포 한 줄. armed·auto_armed가 켜져야 「키우미 켜짐 = 자동
// 매매」 줄이 켜진 모습으로 서고, 하루 한도가 있어야 오늘 로그가 분모를 그린다.
const BACKTEST_DEPLOYMENT_ARMED = Object.freeze({
  ok: true,
  data: {
    deployments: [{
      id: 'fx-dep-4',
      stk_cd: '005930',
      mode: 'auto',
      mode_label: '한도 안에서 자동으로 주문합니다',
      status: 'active',
      armed: true,
      auto_armed: true,
      expired: false,
      limits: { max_order_amount: 2000000, max_orders_per_day: 5 },
    }],
  },
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
    // 빼고, 나머지 셋의 머리인 needed를 잡는다. 점 색 4상태는 onboarding-flow
    // 「Paper 20 토큰 4상태 점은 재발급 중만 경고색이다」가 지고, 재발급 중 버튼
    // 잠금은 「Paper 28 재발급 중」이 진다.
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
      { what: 'count', selector: '.auth-status-left .uk-dot.is-off:not(.is-warn)', equals: 1 },
      { what: 'count', selector: '.auth-status-left .uk-dot.is-warn', equals: 0 },
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
    board: '2IJN-2', // 06 · 에이전트 — 작업 설정
    window: 'shell',
    // 03과 같은 드릴인을 열고 「설정」 탭에서 [설정 편집]까지 눌러야 폼이 선다.
    // 폼은 GET /{id} 응답의 소스 명세로 자기 모양을 정하므로(agent-canvas.js
    // settingsFormModel) athena:routine-detail도 못 박는다 — 이게 없으면 8필드가
    // 아니라 「설정을 불러오지 못했습니다」가 그려진다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: WATCH_ROUTINE },
      { do: 'ipc-fixture', channel: 'athena:routine-runs', data: ROUTINE_RUNS },
      { do: 'ipc-fixture', channel: 'athena:routine-detail', data: WATCH_DETAIL },
      { do: 'mode', view: 'agent' },
      { do: 'wait', ms: 700 },
      { do: 'click', selector: '.agent-row' },
      { do: 'wait', ms: 200 },
      { do: 'click', selector: '.agent-history-open' },
      { do: 'wait', ms: 200 },
      { do: 'click', selector: '.agent-history-tab[data-key="settings"]' },
      { do: 'click', selector: '.agent-history-settings-edit' },
      { do: 'wait', ms: 400 },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    // 요약 층(설정 — 요약 · 설정 편집)과 폼 층(상세 패널 — 설정 편집 · 필드 라벨 ·
    // 저장)이 한 화면에 같이 보인다 — Paper도 둘을 위아래로 나란히 그렸다.
    phrases: ['설정 — 요약', '설정 편집', '상세 패널 — 설정 편집', '조건 비교', '연속 틱', '만료(일)', '저장'],
    // Paper가 「현재가 · 실시간」 폼에 8필드라고 못 박은 그 수(연속 틱을 포함한다 —
    // 예약 소스에서는 7이 된다). 읽기 전용 넷은 종목·모드·소스·생성이다.
    structure: [
      { what: 'count', selector: '.agent-settings-field', equals: 8 },
      { what: 'count', selector: '.agent-settings-readonly', equals: 4 },
      { what: 'count', selector: '.agent-settings-save', equals: 1 },
    ],
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
    // 칸 제목·값·함수명·검사 숫자는 봉투가 준다. 첫 검사 상태/결과 패널도
    // 고정 문법과 실제 fixture의 날짜·발화 목록으로 검사한다.
    phrases: [
      '들어감', '나옴', '이 알람 승인',
      '승인 전까지 실행 없음 · 채팅 칩으로도, 이 버튼으로도 — 같은 게이트',
      '확인 주기', '쿨다운',
    ],
    // Paper 보드 10의 노드 행은 네 칸이고, 아직 아무 칸도 고르지 않았으며
    // (칩 없음) 첫 검사라 바뀐 칸도 없다. 승인 패널의 문은 둘이다
    // ([이 알람 승인][취소]).
    structure: [
      { what: 'count', selector: '.agent-node-card', equals: 4 },
      { what: 'absent', selector: '.agent-node-chip' },
      { what: 'absent', selector: '.agent-node-badge' },
      { what: 'count', selector: '.agent-code-approve-row button', equals: 2 },
      { what: 'count', selector: '.agent-check-band.is-passed', equals: 1 },
      { what: 'order', selector: '.agent-check-band-status', equals: ['검사 통과 · 장중 1분마다'] },
      { what: 'order', selector: '.agent-detail-col > .agent-panel-caption', equals: ['상세', '노드 · 흐름', '승인', '설정'] },
      { what: 'count', selector: '.agent-check-result', equals: 1 },
      { what: 'count', selector: '.agent-check-result .agent-fix-dot', equals: 30 },
      { what: 'count', selector: '.agent-check-result .agent-fix-dot.is-fired', equals: 4 },
      { what: 'count', selector: '.agent-check-result .agent-check-fire', equals: 4 },
      { what: 'absent', selector: '.agent-fix-recheck' },
    ],
  },
  {
    board: '44HD-1', // 11 · 에이전트 — 노드에서 '이상해요' → AI가 고치고 다시 검사
    window: 'shell',
    // 이 보드는 「고친 뒤」의 초안이다 — 보드 10과 같은 렌더러지만 상세 봉투에
    // fix_cycle이 실려 순환 띠·다시 검사 패널·한 바퀴 영수증이 함께 선다
    // (백엔드 routines/revisions.py가 직전 판과 지금 검사를 맞대 만든다).
    // 칩 둘(「이상해요」·「물어볼게요」)은 고른 칸에만 붙으므로 Paper가 고른 그 칸
    // (셋째 · 배수 비교)을 실제로 누른다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: CODE_WATCH_DRAFT },
      { do: 'ipc-fixture', channel: 'athena:routine-detail', data: CODE_DETAIL_AFTER_FIX },
      { do: 'mode', view: 'agent' },
      { do: 'wait', ms: 700 },
      { do: 'click', selector: '.agent-row' },
      { do: 'wait', ms: 400 },
      { do: 'click', selector: '.agent-node-cards .agent-node-card:nth-child(3)' },
      { do: 'wait', ms: 200 },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
    // 이 보드를 이 보드이게 하는 일곱 마디만 담는다 — 순환 띠 둘, 바뀐 칸 배지,
    // 그 칸에서 여는 두 문, 되돌리는 문, 영수증 발치의 게이트 고지. 숫자를 품은
    // 「다시 검사 · 지난 30일」·「한 바퀴 영수증 · 2번째 고침」·「평균 일수 3일 → 5일」은
    // 전부 봉투가 주는 값이라 한 글자도 안 넣는다.
    phrases: [
      '순환', '물어봄 → 고침 → 검사 → 다시 그림 · 한 바퀴 끝',
      '방금 바뀜', '이상해요', '물어볼게요',
      '되돌리기', '코드는 AI가, 판단은 사람이 · 승인 전까지 실행 없음',
    ],
    // Paper 보드 11의 계약 — 칸 넷 중 둘에 「방금 바뀜」이 붙고, 고른 칸 하나에만
    // 칩 둘이 붙는다. 영수증은 바꾼 것 둘 + 판정 하나로 세 줄이고, 점 띠는 검사가
    // 센 구간(지난 30일)만큼 서른 칸이다.
    structure: [
      { what: 'count', selector: '.agent-node-card', equals: 4 },
      { what: 'count', selector: '.agent-node-badge', equals: 2 },
      { what: 'count', selector: '.agent-node-chip', equals: 2 },
      { what: 'count', selector: '.agent-fix-receipt-row', equals: 3 },
      { what: 'count', selector: '.agent-fix-dot', equals: 30 },
    ],
  },
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
      '코드 감시', '일시중지', '취소',
      '울린 기록 · 최근', '채팅에서 열기 ↗', '전체 이력 보기 →',
    ],
    // 상태 제어 행은 [일시중지][취소] 둘이고,
    // 켜진 알람에는 초안의 「검사」가 없다. 설정 요약은 확인 주기·쿨다운·만료와
    // 데이터 출처 네 줄이다 — 값(「1일」·「2026-10-03」)은 봉투가 주므로 개수로만 잰다.
    structure: [
      { what: 'count', selector: '.agent-code-controls button', equals: 2 },
      { what: 'absent', selector: '.agent-code-check-btn' },
      { what: 'count', selector: '.agent-view-tab', equals: 4 },
      { what: 'count', selector: '.agent-detail-field', equals: 4 },
    ],
  },

  {
    board: '432Z-1', // 07 · 에이전트 대화 — 제어 제안 턴 A~E
    window: 'shell',
    // 제안 턴은 모델이 낸 봉투 하나로만 그려지고(chat.js의 athena:routine-proposed
    // 구독) 앱 어디에도 그것을 여는 버튼이 없다 — 다섯 열이 곧 다섯 봉투다.
    // B 「모두 읽음」 칩은 읽지 않은 알람이 있을 때만 선다(없으면 누를 게이트가
    // 없다) — 그래서 발화 하나를 먼저 쏴 알람 센터에 방을 만든다.
    reach: [
      { do: 'send', channel: 'athena:routine-event', data: ROUTINE_FIRED },
      { do: 'send', channel: 'athena:routine-proposed', data: PROPOSAL_UPDATE },
      { do: 'send', channel: 'athena:routine-proposed', data: PROPOSAL_ACK_ALL },
      { do: 'send', channel: 'athena:routine-proposed', data: PROPOSAL_ADOPT },
      { do: 'send', channel: 'athena:routine-proposed', data: PROPOSAL_VIEW },
      { do: 'send', channel: 'athena:routine-proposed', data: PROPOSAL_FIRE },
      { do: 'wait', ms: 400 },
      { do: 'settle' },
    ],
    root: '#history',
    // 제어 이름과 사람 칩만 담는다. 리드와 「근거: …」는 전부 봉투가 주는 값이라
    // 한 글자도 안 넣는다(종목·시각·발화 수).
    phrases: ['작업 설정', '이렇게 바꿔줘', '모두 읽음', '제안 채택', '뷰 이동', '이동함', '지금 실행'],
    // 이 보드의 계약 — 다섯 제안 중 D 뷰 이동에만 칩이 없다(437R-1: 게이트 없음 ·
    // 서버 상태 불변 · 렌더러만 이동). 나머지 넷은 사람 칩 행을 하나씩 갖는다.
    structure: [
      { what: 'count', selector: '.control-proposal', equals: 5 },
      { what: 'count', selector: '.control-proposal .routine-approval-actions', equals: 4 },
      { what: 'count', selector: '.control-proposal-status', equals: 1 },
    ],
  },
  {
    board: '4330-1', // 08 · 에이전트 대화 — 결과 턴
    window: 'shell',
    // 결과 턴은 캔버스에서 칩을 누른 뒤에만 같은 방에 붙는다(chat.js의
    // athena:routine-control-result 구독) — 부팅 직후 #history는 비어 있다.
    // 그래서 이 라우트는 네 상태 중 클릭으로 만들 수 있는 셋을 실제로 만든다:
    // 제안 카드의 [보류](거부), 받아들여진 [일시중지](성공), 백엔드가 거절한
    // [취소](실패·재시도). 「뷰 이동」만 빠진다 — 채팅이 에이전트 뷰를 옮기는 길
    // 자체가 아직 없다(routine-control-turn.js 머리말의 그 사실).
    reach: [
      { do: 'ipc-fixture', channel: 'athena:brain-profile-summary', data: PROACTIVE_SUGGESTION },
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: CODE_WATCH_ACTIVE },
      { do: 'ipc-fixture', channel: 'athena:routine-detail', data: CODE_DETAIL_ACTIVE },
      { do: 'ipc-fixture', channel: 'athena:routine-runs', data: CODE_RUNS },
      { do: 'ipc-fixture', channel: 'athena:routine-pause', data: ROUTINE_PAUSE_OK },
      { do: 'ipc-fixture', channel: 'athena:routine-cancel', data: ROUTINE_CANCEL_REFUSED },
      { do: 'mode', view: 'agent' },
      { do: 'click', selector: '.agent-view-tab[data-view="proactive"]' },
      { do: 'wait', ms: 700 },
      // 카드 머리의 둘째 칩이 [보류]다(첫째는 [루틴으로] — is-primary).
      { do: 'click', selector: '.agent-proactive-card-head .agent-proactive-chip:not(.is-primary)' },
      { do: 'wait', ms: 200 },
      { do: 'click', selector: '.agent-view-tab[data-view="tasks"]' },
      { do: 'wait', ms: 700 },
      { do: 'click', selector: '.agent-row' },
      { do: 'wait', ms: 400 },
      // 상세의 두 문 — [일시중지]는 받아들여져 「완료」로, [취소]는 거절당해 「실패」로 온다.
      { do: 'click', selector: '.agent-pause-btn' },
      { do: 'wait', ms: 500 },
      { do: 'click', selector: '.agent-code-cancel' },
      { do: 'wait', ms: 500 },
      { do: 'settle' },
    ],
    root: '#history',
    // 배지·판정·상태 리드만 담는다. 실패의 리드(「이미 발화된 예약」)와 사실행은
    // 백엔드 거절 사유와 원장 값이라 한 글자도 안 넣는다. 「보류」 하나는 안 적는다 —
    // 포함 판정이라 「보류 — 목록 유지」에 통째로 삼켜져 한 칸을 쓰고 아무것도 안 잠근다.
    phrases: ['제안 채택', '보류 — 목록 유지', '완료', '실패', '다시 시도'],
    // 이 보드의 계약 — 다음 행동(칩)은 실패에만 붙는다(성공·거부는 이미 끝난 일이다).
    // 앞 줄의 3은 Paper 수치가 아니라 위 도달 절차가 칩을 세 번 누른 결과다: Paper는
    // 사양 보드로 네 열을 나란히 그린다. 절차에 클릭이 늘면 이 줄도 같이 고쳐야 한다.
    structure: [
      { what: 'count', selector: '.control-result', equals: 3 },
      { what: 'count', selector: '.control-result .routine-approval-actions', equals: 1 },
    ],
  },
  {
    board: '43WD-1', // 09 · 에이전트 — 새 알람 · 자동 검사 진행
    window: 'shell',
    // 진행 패널은 초안 카드의 [검사]를 누른 뒤 검사 결과 카드 안에 선다
    // (chat.js appendWatchProgress). 초안 카드 자체는 부팅의 refreshRoutineDrafts가
    // 목록에서 draft를 보고 세우므로, 목록을 코드 알람 초안으로 갈아끼운다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: CODE_WATCH_DRAFT },
      { do: 'ipc-fixture', channel: 'athena:routine-detail', data: CODE_DETAIL_FIRST_CHECK },
      { do: 'ipc-fixture', channel: 'athena:routine-watch-check', data: WATCH_CHECK_DONE },
      { do: 'send', channel: 'athena:watch-create', data: WATCH_CREATE },
      // 초안 카드를 세우는 것은 목록 재조회 하나뿐이고(refreshRoutineDrafts), 그것을
      // 다시 부르는 문은 턴 종료다 — 부팅의 한 번은 fixture를 걸기 전에 이미 지나갔다.
      // 그래서 질의를 한 번 돌린다(검사 프로필은 캔버스가 fixture 출처라 왕복이 없다).
      { do: 'command-bar', text: '삼성전자 시세' },
      { do: 'wait', ms: 2500 },
      { do: 'click', selector: '.routine-approval-actions button.routine-btn:not(.routine-btn-approve)' },
      { do: 'wait', ms: 600 },
      { do: 'settle' },
    ],
    root: '#history',
    // 「AI가 감시 함수를 만드는 중」 상태 띠와 [그만두기]는 아직 없다. 영수증·질문
    // 카드는 athena:watch-create 한 통으로 선다(propose_watch_code 성공과 같은 길).
    // 자동 검사 진행 패널의 다섯 줄 본문은 숫자를 품어 문구 후보에서 빠진다(E 규칙).
    phrases: [
      '새 알람', '자동 검사', '격리 실행 · 계좌·주문 접근 없음 · 30초 제한',
      '언제 확인할까요? — 하나만 고르면 됩니다', '장중 1분마다', '장 마감 후 한 번',
      '얼마나 자주 울려도 될까요? — 쿨다운을 정합니다',
    ],
    // 보드 09의 자동 검사 패널은 다섯 줄에 발치 고지 하나다. 영수증·질문 카드는
    // 검사 칩과 별개로 선다.
    structure: [
      { what: 'count', selector: '.watch-progress-line', equals: 5 },
      { what: 'count', selector: '.watch-progress-notice', equals: 1 },
      { what: 'count', selector: '.watch-create-receipt', equals: 1 },
      { what: 'count', selector: '.watch-create-question', equals: 1 },
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
      '두 영역과 카드에 함께 적용된다',
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
      // 리드 설명문은 여기 없다 — Paper 18은 Claude·Codex 둘만 그렸는데 앱 카드는
      // Grok 섹션도 그려서 리드가 「Claude·Grok·Codex」다(settings-cards.js). 어긋나는
      // 자리에는 아무 것도 적지 않는다(머리 주석). Paper 18이 Grok을 그리면 되돌아온다.
      '+ 계정 추가',
      '사고 강도',
      '모델 접근 권한은 활성 계정의 플랜을 따른다 — 접근 불가 모델이면 질의가 오류로 표면화된다.',
      // 「모델 이름 직접 입력」은 <input>의 placeholder라 문구가 못 된다
      // (settings-cards.js:1127이 :1101 makeCommittableInput에 넘긴다). 대신
      // 계정 블록 안내문을 쓴다 — 계정 유무와 무관하게 늘 그려진다(:1077).
      '이 컴퓨터에서 감지된 Claude 계정이다. 새 계정은 여기에 추가된다.',
    ],
    structure: [],
  },
  {
    board: '2UWT-1', // 32 · 설정 — 성향·이력
    window: 'shell',
    reach: [
      // 두 구역 다 브레인 왕복 뒤에 채워진다(settings-cards.js fillHistorySections).
      // 봉투가 없으면 성향 구역이 빈 상태로, 보관 구역이 오류 문구로 떨어져
      // 판정이 이 컴퓨터에 쌓인 대화에 좌우된다.
      { do: 'ipc-fixture', channel: 'athena:brain-profile-summary', data: HISTORY_PROFILE },
      { do: 'ipc-fixture', channel: 'athena:brain-conversations-count', data: HISTORY_CONVERSATION_COUNT },
      { do: 'command-bar', text: '설정' },
      { do: 'click', selector: '.settings-nav-item[data-key="history"]' },
      { do: 'settle' },
    ],
    root: '#settings',
    // Paper가 그린 값 넉 줄(성향 이름·한 문장 요약·위험 성향·보존 기간)은 앱에 오는
    // 길이 없어 앱이 그 행을 만들지 않는다 — 그래서 라벨만 적는다. 두 문구가 봉투를
    // 하나씩 진다: 「대화에서 학습됨」은 성향 봉투가(없으면 빈 상태로 떨어진다),
    // 「보관 중」은 건수 봉투가 세운다(없으면 그 자리가 오류 문구가 된다).
    // 「주요 관심」은 값이 이름이라 안 적고, 「성향 반영」은 앱이 Paper와 다른 문장을
    // 일부러 쓴다: Paper의 「켜짐 · 답변 어조에만 사용」은 exposeToModel이 실제로
    // 넘기는 것(보유 종목·수량·대화 원문)을 축소해 말한다. 이 트랙에서 Paper를 정본으로
    // 삼지 않은 유일한 자리라 여기 적어 둔다 — 되돌리려면 사람 판단이 필요하고, 지금
    // 문장은 settings-cards.test.js 「성향 반영」 시험이 잠갔다.
    phrases: [
      '성향·이력',
      '로컬 보관 · 언제든 내보내기 가능',
      '투자 성향',
      '대화에서 학습됨',
      '대화 이력',
      '보관 중',
      '삭제는 확인 단계를 한 번 더 거치며 되돌릴 수 없습니다',
    ],
    // 보드 32의 본문은 두 구역(투자 성향 · 대화 이력)이고 발치의 문은 둘이다
    // ([이력 내보내기][전체 삭제]). 사이드바 줄 수는 안 적는다 — Paper는 「플러그인」을
    // 넣어 5줄인데 앱 NAV_ITEMS는 4줄이다(보드 13·14·18과 같은 어긋남).
    structure: [
      { what: 'count', selector: '.uk-history-section', equals: 2 },
      { what: 'count', selector: '.uk-btn-row-end button', equals: 2 },
    ],
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
    // 문구가 못 된다. 상태 행(113-0)과 그 아래 연결 권한 설명(114-0)은 각각 잰다.
    // 확정 버튼 라벨 「확인 중…」(11B-0)은 문구로 못 잰다 — 판정은 root 아래 가시
    // 텍스트 전체에 대한 includes라 바로 위 안내 줄에 통째로 들어 있다. 그 자리는
    // 아래 structure가 라벨까지 재고, 문구는 아직 안 쓴 108-0이 맡는다.
    phrases: [
      '계좌 등록',
      '모의투자 계좌의 APP KEY / SECRET KEY를 등록한다',
      '저장·표시 원칙',
      '이 컴퓨터에서만 쓰는 이름이다',
      '토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다',
      'APP KEY와 SECRET KEY로 계좌 연결 권한을 확인하고 있습니다',
    ],
    // 확인 중을 다른 두 상태와 가르는 것은 문구가 아니라 **잠김**이다: 입력 셋과
    // 확정 버튼이 모두 잠기고, 실패 상자는 아직 없다. 실패 상자는 셈이 아니라
    // 문면으로 재 둔다 — 이 보드가 깨지는 길은 등록 왕복이 답을 돌려준 것뿐이라,
    // 그때 뜬 사유가 리포트에 그대로 남아야 원인을 이름으로 가를 수 있다. 실측
    // 대조군: 위 ipc-hang을 빼고 돌리면 실패 상자가 「입력값을 확인한다」로 뜬다
    // (빈 입력에 진짜 핸들러가 답한 것이다 — 키움 왕복은 그 전에 끊긴다). 리포트에
    // 그 문면이 보이면 앱 회귀가 아니라 하네스의 가로채기가 안 걸린 것이다.
    structure: [
      { what: 'order', selector: '.uk-sheet .uk-status-text, .uk-sheet .uk-account-verifying-note', equals: [
        '토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다',
        'APP KEY와 SECRET KEY로 계좌 연결 권한을 확인하고 있습니다',
      ] },
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
    // 종목·사유·관측값·총액은 전부 값이라 안 넣는다. 수량 칩 넷은 잔고가 없어도
    // 라벨은 서고, 값은 비활성이다 — 개수만 잰다. 방향 버튼은 「판매」로만 잰다.
    // 「구매」는 같은 카드의 「구매하기」에 포함으로 걸려 방향 버튼이 사라져도
    // 통과하니, 그 자리는 「수량」이 맡는다. 「가격」 라벨은 안 적는다 — 그 행은
    // 세그먼트 둘과 「시장가 체결」이 이미 잰다.
    phrases: [
      'Esc 닫기 — 실행 전에는 아무 일도 일어나지 않습니다',
      '수량',
      '판매',
      '시장가 체결',
      '활성 계좌의 주문 API가 OFF입니다 — 설정 › 계좌에서 게이트를 여세요.',
      '구매하기',
      '실행하면 확인 게이트와 멱등키가 적용됩니다 — 같은 멱등키로는 두 번 체결되지 않습니다.',
    ],
    // 가격 세그먼트는 span, 수량 칩은 .ticket-qty-chips 안의 button — 공유
    // 클래스 .ticket-seg 를 통째로 세면 6이 되어 가격 행 계약을 덮는다.
    structure: [
      { what: 'count', selector: '.ticket-card', equals: 1 },
      { what: 'count', selector: 'span.ticket-seg', equals: 2 },
      { what: 'count', selector: '.ticket-qty-chips button.ticket-seg', equals: 4 },
      { what: 'count', selector: '.ticket-lock', equals: 1 },
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
      // 복원 실패·브리핑 같은 다른 능동 턴이 이력에 남아 있어도, 이 fixture가 만든
      // 발화 턴만 센다. Paper의 history child 수를 전역 .turn-agent 수로 읽지 않는다.
      { what: 'count', selector: '.turn-agent.agent-fired', equals: 1 },
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
    // 노드 이름은 캔버스에 그려져 글자가 아니라 여기 안 적는다(live-map.js).
    // 범례는 이제 앱도 그린다 — 여섯 줄 중 이 보드에만 있는 마지막 줄을 잡는다
    // (31H-0의 같은 자리는 「숨은 연관」까지다). 개수는 안 적는다: Paper의 범례는
    // 여섯인데 앱은 보드 07이 더한 채움 세 칸까지 아홉이다.
    phrases: [
      '요약',
      '수집·노출',
      '테마 지도',
      '노드를 끌어 옮길 수 있습니다 · 휠 또는 Ctrl+휠로 확대 · 채팅으로 물어도 같은 곳이 열립니다',
      '숨은 연관 — 군집을 넘는 연결',
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
  {
    board: '2QCN-2', // 07 · 그래프 — 정직성 상태 (이름·인코딩·빈 값)
    window: 'shell',
    // 이 보드에는 셸 창 프레임이 없다 — 원장 트리의 세 묶음(이름 폴백 사다리 ·
    // 채움 인코딩 · 못 채우는 값)이 전부 보드 옆 설명 판이고, 그 안에서 **화면이
    // 실제로 그려야 하는 것**은 지도 범례 하나다: 채움 세 칸(2QEE-2·2QEJ-2·2QEO-2)과
    // 「2~4단계가 하나라도 있으면 지도 범례에 한 번만」 붙는 캡션(2QDY-2·2QE0-2).
    // 3열 표(상황 · 화면이 하는 말 · 왜 그렇게 말하는가)는 앱 어디에도 없다 —
    // 보드 06(2QA3-2)의 설명 표와 같은 갈래다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:brain-cluster-map', data: GRAPH_CLUSTER_MAP },
      // 채움 세 칸이 지도에 전부 서려면 확정성이 섞여 있어야 한다.
      { do: 'ipc-fixture', channel: 'athena:brain-profile-summary', data: GRAPH_CERTAINTY_SIGNALS },
      { do: 'ipc-fixture', channel: 'athena:brain-surprising-connections', data: GRAPH_HIDDEN_LINKS },
      { do: 'ipc-fixture', channel: 'athena:brain-suggested-questions', data: GRAPH_NO_QUESTIONS },
      { do: 'mode', view: 'graph' },
      { do: 'click', selector: '#graphViewTab' },
      { do: 'send', channel: 'athena:brain-graph-updated', data: null },
      { do: 'settle' },
    ],
    root: '#shell',
    // 네 단계 폴백의 예시 이름(반도체 대형주 · 반도체 밸류체인 · 배당·인컴)과
    // 「종목 9 · 응집 0.74」는 전부 값이라 한 글자도 안 넣는다. 「이름 없는 군집」도
    // 안 적는다 — 4단계는 군집 안 어느 멤버에도 이름이 없을 때만 서는데, 이름
    // 있는 노드로 그린 지도에서는 3단계(대표 항목)에서 사다리가 멈춘다.
    // 브레인 미기동 문장은 원장에 큰따옴표를 달고 있어 문구로 못 쓴다.
    phrases: [
      '사실 · 체결·잔고',
      '불확실',
      '그 밖 · 모름',
      '군집 이름은 대표 항목에서 추정',
    ],
    // 채움 세 칸과, 군집마다가 아니라 지도에 **한 번만** 붙는 캡션.
    structure: [
      { what: 'count', selector: '.graph-legend-fill-item', equals: 3 },
      { what: 'count', selector: '.graph-legend-caption', equals: 1 },
    ],
  },

  // ---------- 그래프 채팅 제어 2장 (8-1) ----------
  // 보드 09·11은 「채팅이 화면을 몬다」와 「편집은 제안까지다」를 계약 도해로 그렸다.
  // 그 도해 안에 앱 화면이 하나씩 박혀 있어서(09의 탭 스트립 전/후, 11의 카드 목업)
  // 그 하나를 잰다 — 옆의 설명 표·계약 문단은 화면이 아니라 보드가 붙인 주석이라
  // 앱 어디에도 없다(보드 06 2QA3-2에서 같은 판단을 했다).
  //
  // 같은 페이지의 보드 10(3ZAA-1)은 라우트를 넣지 않았다. 그 보드가 그린 것은
  // athena_brain action=entity의 **응답**과 그 응답을 읽은 모델의 답변이라, 화면으로
  // 재려면 모델이 실제로 그렇게 답해야 한다 — 봉투로 박으면 지어낸 답을 화면에
  // 그려 놓고 초록을 만드는 것이 된다.
  {
    board: '3Z8U-1', // 09 · 그래프 — 채팅이 화면을 몬다 (navigate · select · filter)
    window: 'shell',
    // 보드가 그린 세 액션 중 앱 화면으로 남는 것은 navigate의 「전 → 후」 탭 스트립
    // 하나다. select의 결말(공통 패널이 열린 지도)은 보드 04(31H-0)가 이미 그 상태를
    // 재고, filter의 전후 칩 「최근 90일 → 최근 365일」은 앱에서 <option> 안 글자라
    // 닫힌 select에서는 그려지지 않는다(보드 06의 같은 자리 주석).
    //
    // 사람이 탭을 누르는 길(#settingsViewTab)은 보드 05가 이미 쓴다. 이 보드의 주장은
    // **채팅이 같은 함수를 부른다**는 것이라, main이 athena_graph_view의 봉투를 보내는
    // 그 채널을 그대로 쏜다(canvas.js athena:graph-chat-action → graphMode.setSurface).
    reach: [
      { do: 'mode', view: 'graph' },
      { do: 'send', channel: 'athena:graph-chat-action', data: { kind: 'navigate', surface: 'settings' } },
      // setSurface는 hidden을 동기로 바꾸지만 탭 활성 표시는 await 뒤에 따라온다
      // (canvas.js updateSurfaceTabs 주석) — 두 프레임만으로는 그 사이에 잰다.
      { do: 'wait', ms: 500 },
      { do: 'settle' },
    ],
    // 화면이 실제로 옮겨졌는가는 root가 진다 — 수집·노출 판은 그 액션이 걸려야만
    // 그려지고, 안 걸리면 root_not_visible로 떨어진다(문구를 세는 것보다 앞이다).
    root: '#graphSettingsCanvas',
    // 「navigate」·「surface = summary · map · settings」·계약 문단은 보드가 붙인
    // 주석이라 앱에 없다. 남는 것은 「후」 판이 그린 탭 스트립 셋이다.
    phrases: ['요약', '그래프', '수집·노출'],
    // Paper의 「후」 판 그대로 — 탭은 이 차례이고, 활성 표시가 하나만 켜져 있다
    // (「탭 활성 표시까지 함께 따라온다」).
    structure: [
      {
        what: 'order',
        selector: '.view-toggle-tab',
        equals: ['요약', '그래프', '수집·노출'],
      },
      { what: 'count', selector: '.view-toggle-tab.is-active', equals: 1 },
    ],
  },
  {
    board: '3ZAA-1', // 10 · 그래프 — "이 노드 설명해줘" (관계·근거·이력·대화 원문)
    window: 'shell',
    // 이 패널을 여는 길은 모델의 athena_brain action=entity 하나뿐이다(main.js
    // maybeForwardBrainEntity → canvas.js athena:graph-chat-action kind='entity').
    // 앱 어디에도 누를 자리가 없으므로 main이 보내는 봉투를 그대로 쏜다 —
    // 보드 11(3ZC2-1)이 편집 제안 카드를 여는 것과 같은 문법이다.
    reach: [
      { do: 'mode', view: 'graph' },
      { do: 'send', channel: 'athena:graph-chat-action', data: GRAPH_ENTITY_DETAIL },
      { do: 'settle' },
    ],
    // 공통 패널이 실제로 섰는가는 root가 진다 — 안 서면 root_not_visible로
    // 떨어진다(문구를 세는 것보다 앞이다).
    root: '#graphPanel',
    // 노드 이름·종류·관계명·상대 노드·발췌 원문·날짜는 전부 봉투가 주는 값이라
    // 한 글자도 안 넣는다. 남는 것은 두 절 제목뿐이라 문구가 둘이다
    // (PHRASE_FLOOR_EXCEPTIONS의 values-only — structure 넷이 대신 진다).
    //
    // 보드 제목 두 줄, 왼쪽 판 머리의 「action=entity」·「entity = 이름 또는
    // entity_id」, 발치의 「정직성 규칙」 네 줄은 보드가 붙인 주석층이라 앱에 없다.
    // 앞의 둘은 도구 인자 이름이고, 정직성 규칙은 화면이 아니라 모델의 답이 지켜야 할
    // 계약 서술인 데다 confidence·full_chars·resolved=false·503이 그대로 박혀 있다 —
    // 셋 다 사용자 화면에 낼 수 없다(보드 11에서 「도구 계약 표」를 뺀 것과 같은 판정).
    // 오른쪽 「채팅 답변」 판도 안 잰다: 툴 칩 「노드 조회」는 살아 있는 턴 안에서만
    // 생기고(chat.js가 턴마다 진행 줄을 만든다), 모델 답변 세 문단은 애초에
    // 결정론이 아니다.
    phrases: [
      '관계 — 방향 · 확정성 · 티어 · 보강',
      '변경 이력 — 최신 먼저',
    ],
    // Paper 그대로 — 관계 두 행에 원문 발췌가 각각 하나씩, 변경 이력 세 줄.
    // 노드 선택 패널의 탭 줄은 이 화면에 없어야 한다(같은 자리에 두 주제를 겹쳐
    // 두지 않는다 — controller.js renderSelection).
    structure: [
      { what: 'count', selector: '.entity-relation-row', equals: 2 },
      { what: 'count', selector: '.entity-relation-excerpt', equals: 2 },
      { what: 'count', selector: '.entity-timeline-row', equals: 3 },
      { what: 'absent', selector: '.panel-tab' },
    ],
  },
  {
    board: '3ZC2-1', // 11 · 그래프 — 편집은 제안까지 · 도구 계약
    window: 'shell',
    // 카드를 여는 길은 모델의 propose_edit 하나뿐이라(chat.js registerOpenGraphEditProposal)
    // 앱 어디에도 누를 자리가 없다 — main이 보내는 봉투를 그대로 쏜다.
    reach: [
      { do: 'mode', view: 'graph' },
      { do: 'send', channel: 'athena:graph-chat-action', data: GRAPH_EDIT_PROPOSAL },
      { do: 'settle' },
    ],
    // 보드가 그린 앱 화면은 카드 하나다. root를 카드로 잡으면 카드가 안 뜬 것과
    // 되물을 것들 카드가 대신 뜬 것을 갈라 준다(둘은 .question-card*를 함께 쓴다).
    root: '#graphEditProposalCard',
    // 카드 제목·부제는 봉투가 주는 값이라 안 넣는다. 안내문도 안 넣는다 —
    // Paper의 「누르면 그 답이 채팅으로 보내지고, 그 답이 그래프를 갱신합니다」는
    // 앱이 2026-09-03 실사용 제보를 받아 실제로 걸리는 경로 둘로 갈라 다시 쓴
    // 자리다(chat.js renderGraphEditProposalCard). 남는 것은 선택지 셋과 키 힌트 둘이다.
    phrases: ['건너뛰기', 'Esc', '아니다', '적용', 'Ctrl Enter'],
    // Paper의 버튼 행 — [건너뛰기 Esc][아니다][적용 Ctrl Enter], 키 힌트는 둘.
    structure: [
      { what: 'count', selector: '.question-card-btn', equals: 3 },
      { what: 'count', selector: '.question-card-key', equals: 2 },
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
      // Snap은 기존 대화를 보존하는 기능이지만 이 보드가 고른 상태는 빈 대화다.
      // 새 대화 IPC를 fixture로 막고 실제 새 대화 버튼으로 renderer 상태만 비운다.
      {
        do: 'ipc-fixture',
        channel: 'athena:conversations-new',
        data: { conversations: [], projects: [], currentProjectId: null, activeId: 'fx-new' },
      },
      { do: 'click', selector: '#sidebarNewChat' },
      // 2분할에서는 빈 이력 DOM을 보존하되 CSS로 숨긴다. any로 존재·빈 상태를 먼저
      // 확인하고, 아래 structure가 DOM 존재·자식 없음·비가시를 각각 잰다.
      { do: 'wait-for', selector: '#history:empty', count: 1, timeout: 2000, visibility: 'any' },
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
    // 아래로 내려가 빈 대화에서는 이력 컨테이너 DOM은 남되 숨고, 자식이 없으며 작성창만
    // 보인다. 이 셋을 DOM 존재·자식 DOM 0·가시 DOM 0으로 나눠 재고, 그래도
    // 「Snap 후에도 초안과 스크롤은 보존」할 수 있게 입력 DOM은 하나뿐이다.
    // 사이드바 행 수는 안 적는다 — 축소 목업은 넷(새 대화·그래프·에이전트·플러그인)만
    // 그렸는데 앱의 모드는 다섯이라 거기에 앱의 수를 적으면 앱이 정본이 된다.
    structure: [
      { what: 'count', selector: '.shell-region', equals: 3 },
      { what: 'count', selector: '#history', equals: 1, visibility: 'any' },
      { what: 'count', selector: '#history > *', equals: 0, visibility: 'any' },
      { what: 'count', selector: '#history', equals: 0, visibility: 'visible' },
      { what: 'count', selector: '#input', equals: 1, visibility: 'visible' },
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

  // ---------- 사이드바 5장 (1-0) ----------
  // 다섯 다 이력 사이드바 하나를 다른 상태로 그린 보드라 fixture와 다시 읽히는 방법이 같다.
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
    // 같은 자리를 「새 대화」로 확정했고 앱이 그것을 따른다. 「전체」는 최근 캡션
    // 오른쪽(GK4-0)이다 — 픽스처 대화가 6건을 넘을 때만 선다.
    phrases: ['프로젝트', '최근', '전체', '프로젝트 수정', '이 프로젝트에 속한 대화와 작업'],
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
    board: '2V27-1', // 34 · 사이드바 검색 — 결과·빈 결과
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:conversations-list', data: SIDEBAR_SEARCH_HISTORY },
      { do: 'send', channel: 'athena:session-run-state', data: { id: 'fx-reload' } },
      { do: 'wait', ms: 300 },
      // 캔버스 카드 그룹은 #grid에 카드가 실제로 붙어 있어야 생긴다.
      { do: 'envelope', data: SEARCH_CANVAS_CARD },
      { do: 'wait', ms: 300 },
      // 입력창은 hidden으로 시작하고 이 버튼이 그것을 여는 유일한 문이다.
      { do: 'click', selector: '#sidebarSearchToggle' },
      { do: 'type', selector: '#sidebarSearchInput', text: '삼성전자' },
      { do: 'settle' },
    ],
    root: '#historyRegion',
    // 대화 제목·카드 제목·건수는 전부 값이라 한 글자도 안 넣는다. 패널이 실제로
    // 열렸을 때만 그려지는 것은 발치 안내 하나고, 나머지 다섯은 사이드바 구역·모드
    // 이름이다. Paper의 「대화·카드 검색」은 <input>의 placeholder라 문구가 못 되고
    // (표 머리말의 그 따름), 빈 결과판의 「아직 이 주제로 나눈 대화가 없습니다」와
    // [새 대화로 물어보기]는 앱에 없어 적지 않는다 — 앱의 빈 결과는 한 줄뿐이다.
    phrases: [
      '↑↓ 이동 · Enter 열기 · Esc 닫기',
      '프로젝트',
      '최근',
      '그래프',
      '에이전트',
      '플러그인',
    ],
    // Paper가 그린 패널 그대로 — 그룹 둘(대화 · 캔버스 카드)에 줄 셋, 발치에 총 건수.
    structure: [
      { what: 'count', selector: '.sidebar-search-group-label', equals: 2 },
      { what: 'count', selector: '.sidebar-search-row', equals: 3 },
      { what: 'count', selector: '.sidebar-search-count', equals: 1 },
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
    // 안 적는다 — 문구 한도가 이미 7이고, 그 제스처는 행 dblclick → 보드 29 수정 패널이라
    // 이 팝오버 DOM에는 그 문장이 없다.
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
    board: '3VS6-1', // 36 · 프로젝트 추가 — 폴더 점유
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:conversations-list', data: SIDEBAR_HISTORY },
      { do: 'send', channel: 'athena:session-run-state', data: { id: 'fx-reload' } },
      { do: 'wait', ms: 300 },
      // 「＋ 폴더 추가」는 탐색기부터 연다 — 대화상자는 사람이 고른 폴더 위에서만 선다
      // (보드의 Step 1이 이미 경로를 들고 있다). 그 OS 대화상자를 fixture가 대신한다.
      { do: 'ipc-fixture', channel: 'athena:project-pick-folder', data: PICKED_FOLDER },
      { do: 'click', selector: '.sidebar-project-add' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#projectCreate',
    // 경로·이름은 값이라 안 넣는다(fixture가 바꾼다). 「프로젝트 이름」도 뺐다 —
    // 일곱 자리가 이미 찼고, 라벨보다 그 아래 안내문이 이 화면에만 있는 문장이다.
    // 세 갈래 권한 문장 중 하나만 넣는 것도 같은 이유다: 셋의 개수는 structure가 잰다.
    phrases: [
      '프로젝트 추가',
      '프로젝트는 폴더 하나를 점유합니다',
      '작업 폴더',
      '탐색기가 열립니다. 빈 폴더든 기존 폴더든 됩니다.',
      '폴더 이름에서 가져왔습니다 · 바꿀 수 있습니다',
      '이 폴더에서 아테나가 하는 일',
      '이 폴더로 만들기',
    ],
    // Paper의 모달 그대로 — 단계 셋(폴더·이름·권한)에 권한 문장 셋. 안내는 기본
    // 상태에 없다: 「이미 점유된 폴더」·「빈 폴더가 아닐 때」는 고른 폴더가 그럴 때만
    // 뜨는 두 상태고, 한 번에 하나만 보인다(project-create-dialog.js noticeFor).
    structure: [
      { what: 'count', selector: '.project-create-step', equals: 3 },
      { what: 'count', selector: '.project-create-permission', equals: 3 },
      { what: 'absent', selector: '.project-create-notice' },
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
    // 행에 붙는 목록이고, 고른 줄이 곧 새 대화창이라 확인 버튼이 없다. 창 수는 숫자라
    // 문구가 못 되고, structure가 다섯 알약을 잰다.
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
      { what: 'count', selector: '.sidebar-mode-picker-count', equals: 5 },
      {
        what: 'order',
        selector: '.sidebar-mode-picker-count',
        equals: ['현재 1개', '현재 1개', '없음', '없음', '현재 2개'],
      },
    ],
  },
  {
    board: '3WBZ-1', // 41 · 세션 복원 — 다시 누르면 그대로
    window: 'shell',
    // 이력 행을 실제로 누른다 — 복원은 그 클릭 뒤에 오는 것이 전부라(chat.js
    // registerOpenConversation), 다른 문으로 들어가면 재려던 것을 못 잰다.
    // 되돌아오는 값 넷(전환 결과 · 세션 스냅샷 · 기법 목록 · 결과 데이터셋)만 못 박는다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:conversations-list', data: SIDEBAR_HISTORY },
      { do: 'ipc-fixture', channel: 'athena:conversations-set-active', data: RESTORE_SET_ACTIVE },
      { do: 'ipc-fixture', channel: 'athena:session-load', data: RESTORE_SNAPSHOT },
      { do: 'ipc-fixture', channel: 'athena:session-replay-cards', data: { replayed: 0 } },
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: RESTORE_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: RESTORE_RESULT_MISSING },
      { do: 'send', channel: 'athena:session-run-state', data: { id: 'fx-reload' } },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '[data-conversation-id="fx-s2"]' },
      // 복원은 전환 → 스냅샷 → 결과 되읽기 세 왕복이다. 마지막 왕복이 실패로
      // 끝나야 안내가 서므로 그 왕복까지 기다린다.
      { do: 'wait', ms: 1500 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 종목·기간·k·「복원 6/6」의 숫자·줄 수는 전부 값이라 안 넣는다. 남는 것은 복원이
    // 그리는 표식·안내의 라벨과 캔버스 머리다. Paper가 오른쪽 레일에 적은 규칙 문장
    // (「무엇이 반드시 돌아오는가」류)은 명세 해설이라 앱 화면의 문구가 아니다.
    // 안내 본문은 실제로 못 읽은 항목의 이름으로 조립되는데(session-restore.js
    // restoreReport), 그 어휘가 Paper 3WO4-1의 것이라 결과 하나만 빠진 이 봉투에서는
    // 그 한 줄이 글자 그대로 선다 — 그러니 여기서 잰다.
    phrases: [
      '백테스트',
      '전략 폼',
      'restored',
      '일부만 복원했습니다',
      '결과 데이터셋 1장을 찾지 못했습니다. 폼·코드·로그는 그대로입니다.',
      '다시 시도',
      '이대로 열기',
    ],
    // 이 보드의 계약 자체 — 표식 둘(폼·코드)이 서고, 빠진 것이 있으므로 안내가 하나
    // 선다. 그리고 캔버스는 빈 화면이 아니다: 봉인해 둔 작업공간이 실제로 돌아왔다.
    structure: [
      { what: 'count', selector: '.backtest-restore-mark', equals: 2 },
      { what: 'count', selector: '.backtest-restore-notice', equals: 1 },
      { what: 'absent', selector: '.backtest-canvas-empty' },
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

  // ---------- 키우미 5장 (C-2) ----------
  // 이 페이지 아홉 중 화면으로 남은 다섯만 여기 있다. 나머지 넷은 매니페스트가
  // reference·retired 다 — 02 표정 10종 · 03 시선·시간 루프는 글자를 안 그리고,
  // 05 셸 숨김·표시는 한 화면에 두 모드가 함께 못 서고, 08 모드별 얼굴 5종은
  // 얼굴 1종 계약(2026-09-01)과 정면으로 어긋나 retired다.
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
      // fixture 응답을 실제 invoke로 다시 읽고 DOM을 교체할 때까지 제한 시간 안에서 기다린다.
      { do: 'wait-for', selector: '.orb-ring-dot', count: 3, timeout: 2000, visibility: 'visible' },
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
      '키우미 대화',
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
  {
    board: '2LFW-2', // 09 · 키우미 — 미니 카드 10종
    window: 'orb',
    // 열 종이 한 보드에 그려져 있으므로 라우트도 한 장에 열 장을 세운다 — 봉투를
    // 열 번 쏘면 카드가 열 장 붙는다(러너의 send는 되돌릴 것이 없는 자극이라
    // 반복해도 서로를 오염시키지 않는다). 카드가 붙는 자리는 대화 모드의 턴
    // 목록이라 셸을 내려 두는 것이 먼저다(보드 04와 같은 두 자극).
    //
    // 봉투는 질의 밖에서 온다 — 제품에서 이 구독은 질의가 도는 동안에만 산다
    // (orb.js submitChatQuery). 검사 모드에서만 열리는 통로 하나로 그 밖에서도
    // 같은 buildOrbCanvasCard가 그리게 했다(orb.js askCanvasProbeMode,
    // main.js athena:orb-canvas-probe, probe-paper-screens.js가 켠다).
    reach: [
      { do: 'send', channel: 'athena:shell-visibility', data: { hidden: true, displayMode: 'A' } },
      { do: 'send', channel: 'athena:orb-state', data: { expanded: true } },
      ...MINI_CARD_ENVELOPES.map((envelope) => ({
        do: 'send',
        channel: 'athena:orb-canvas-result',
        data: { status: 'success', envelope },
      })),
      { do: 'settle' },
    ],
    root: '#orbChatBody',
    // 카드 제목·부제·라벨·값은 전부 봉투가 정한다 — 픽스처를 고치면 따라 바뀌므로
    // 문구가 못 된다. 여기 여섯은 앱이 자기 리터럴로 쓰는 것들이다: 차트의 능력 고지,
    // 주문 확인의 경계 고지, 인증 상태의 고정 행과 고지, 그리고 orb.html이 마크업에
    // 직접 적은 미니 주문 티켓의 제목·확인 표기. 접힘 고지(「항목 4개를 접었습니다」
    // 따위)는 개수가 봉투에 달려 있어 안 적는다.
    phrases: [
      '지표 · 드로잉 · 매물대는 캔버스에서',
      '주문 티켓',
      '1회 확인',
      '표시 전용 · 실행과 최종 확인은 대화창에서만',
      '설정됨',
      '토큰과 자격 증명 값은 표시하지 않음',
    ],
    // 열 종이 전부 섰다 — 아홉은 일반 축약 카드(.orb-fold-card)이고, 미니 주문
    // 티켓만 orb.html이 미리 갖고 있는 #orbTicket을 채워 쓴다(실행 버튼을 가진
    // 유일한 카드라 별도 DOM이다, 보드 09 공통 규칙 「실행은 05 하나」).
    structure: [
      { what: 'count', selector: '.orb-fold-card', equals: 9 },
      { what: 'count', selector: '#orbTicket', equals: 1 },
    ],
  },
  // ---------- 백테스트 7장 (8-1) ----------
  // 일곱 보드는 한 캔버스의 일곱 상태다(#backtestCanvas). 기법을 고르기 전 첫 화면은
  // 기법 목록이라(backtest-canvas.js listFirst) 어느 보드든 먼저 기법 하나를 세워야 한다 —
  // 그 자극이 위 BACKTEST_TARGET이다. Paper의 머리·탭 이름은 안 적는다: Paper 보드 01의
  // 탭은 「폼 · 코드 · 실행」이고 보드 03은 「설계 · 결과 · 다시 실행」인데, 앱의 모드 탭은
  // 다섯(기법 · 결과 · 이력 · 최적화 · 배포)이고 설계 하위 탭도 넷이라 어느 쪽 수를 적어도
  // 거짓말이 된다(보드 19가 그 기법 목록 화면을 따로 그린다).
  {
    board: '1SW0-0', // 01 · 백테스트 — 설계 (폼)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      // 설정을 얹으면 화면은 지도 탭에 선다(applySpecAction) — 폼은 그 옆 칸이다.
      { do: 'click', selector: '#backtestCanvas .backtest-subtab:nth-child(2)' },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 종목코드·기간·지표 개수·수수료 숫자는 전부 값이라 안 넣는다. 남는 것은 카드 제목과
    // 조건 카드의 논리 배지뿐이다 — 배지는 fixture가 아니라 그 기법의 AND/OR이다.
    phrases: [
      '대상 · 기간',
      '수정주가',
      '지표',
      '진입 조건',
      '모두 만족 AND',
      '청산 조건',
      '리스크 · 비용',
    ],
    // Paper가 그린 조건 카드 둘(진입·청산) · 주기 세그먼트 셋(일·주·월) · 종목 칩 하나.
    structure: [
      { what: 'count', selector: '.backtest-condition-card', equals: 2 },
      { what: 'count', selector: '.backtest-segment-item', equals: 3 },
      { what: 'count', selector: '.backtest-symbol-chip', equals: 1 },
    ],
  },
  {
    board: '1T5K-0', // 02 · 백테스트 — 설계 (코드)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-subtab:nth-child(3)' },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 파일 이름(golden_cross.py)·버전 칩은 값이고, 코드 본문은 그 전략의 파이썬이라
    // 문구가 못 된다. 편집기 바의 런타임 줄(python 3.12 …)도 판번호를 품어 생성기가
    // 값으로 걸러낸다 — 남는 것은 [검증] 하나와 발치의 경계 상자다.
    phrases: [
      '검증',
      '이 코드가 닿을 수 있는 것',
      '건네받은 봉 데이터 · pandas · numpy · athena_bt',
      '키움 자격증명 · 계좌 · DB · 네트워크 — 넘기지 않습니다',
    ],
    // 경계 상자의 마지막 줄은 안 적는다 — Paper는 「30초 제한」, 앱은 「시간 제한」이다.
    structure: [
      { what: 'count', selector: '.backtest-code-host', equals: 1 },
      { what: 'count', selector: '.backtest-code-bounds', equals: 1 },
    ],
  },
  {
    board: '1TGA-1', // 03 · 백테스트 — 결과
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-run', data: BACKTEST_RUN_OK },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: BACKTEST_RESULT },
      { do: 'ipc-fixture', channel: 'athena:backtest-trades', data: BACKTEST_TRADES },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-run-button' },
      { do: 'wait', ms: 500 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 타일 값·낙폭 구간·체결 줄은 전부 fixture가 주는 값이다 — 라벨과 부제만 남긴다.
    phrases: [
      '총수익률',
      '최대 낙폭',
      'Profit Factor',
      '총익 ÷ 총손',
      '자산곡선',
      '매수보유',
      '수수료·세금 반영 후 손익',
    ],
    // Paper가 적은 「지표 6장」과 체결 표의 열 일곱(일자·방향·체결가·수량·비용·손익·사유).
    structure: [
      { what: 'count', selector: '.backtest-metric-tile', equals: 6 },
      { what: 'count', selector: '.backtest-trades-head .backtest-trades-cell', equals: 7 },
    ],
  },
  {
    board: '1TPF-1', // 04 · 백테스트 — 데이터 수집 승인
    window: 'shell',
    // 보드 04는 승인 카드와 수집 중 카드를 나란히 그렸다 — 한 화면은 한 쪽만 그리므로
    // 라우트는 승인 카드를 잰다(수집 중은 승인을 누른 뒤의 다음 상태다).
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-run', data: BACKTEST_RUN_BLOCKED },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-run-button' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 「부족 구간 약 520봉」·「ka10081 × 4회」·「~5초」는 계획이 준 값이라 안 넣는다.
    phrases: [
      '수집 필요',
      '캐시에 없는 구간이 있습니다',
      '수정주가 기준으로 받습니다. 이어 붙일 때 최근 20봉 종가를 대조해 권리락이 감지되면 전체를 다시 받고, 그 사실을 결과에 남깁니다.',
      '수집하고 실행',
      '보유 구간만으로 실행',
      '취소',
    ],
    // Paper의 승인 카드는 커버리지 바 하나와 갈래 셋이다.
    structure: [
      { what: 'count', selector: '.backtest-coverage-bar', equals: 1 },
      { what: 'count', selector: '.backtest-approval-actions button', equals: 3 },
    ],
  },
  {
    board: '1WSI-1', // 05 · 백테스트 — 이력·비교
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-runs', data: BACKTEST_RUNS },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: BACKTEST_RESULT },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      // 모드 탭 셋째가 이력이다(기법 · 결과 · 이력 · 최적화 · 배포).
      { do: 'click', selector: '#backtestCanvas .backtest-tab:nth-child(3)' },
      { do: 'wait', ms: 300 },
      // 비교 패널은 두 줄을 고른 뒤에만 선다 — Paper가 그린 #41 vs #38이 그 둘이다.
      { do: 'click', selector: '#backtestCanvas .backtest-history-row:nth-of-type(1)' },
      { do: 'click', selector: '#backtestCanvas .backtest-history-row:nth-of-type(2)' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 실행 번호·버전·수익률은 전부 값이다. 목록 머리(「실행 이력 — 20-60 골든크로스」)와
    // 비교 패널 제목(「#41 vs #38 — 무엇이 달랐나」)도 전략 이름과 실행 번호를 품고 있어
    // 못 쓴다 — 이 보드에서 값이 아닌 것은 두 diff 칸의 이름 둘뿐이라 3개 하한을
    // paper-screen-routes.test.js가 사유와 함께 예외 처리했고, 대가로 structure 둘을 실었다.
    phrases: ['파라미터 diff', '코드 diff'],
    // Paper의 실행 목록 네 줄과 비교 패널의 「왜 달랐나」 두 칸.
    structure: [
      { what: 'count', selector: '.backtest-history-row', equals: 4 },
      { what: 'count', selector: '.backtest-compare-diff-box', equals: 2 },
    ],
  },
  {
    board: '1WZJ-1', // 06 · 백테스트 — 최적화
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-optimize', data: BACKTEST_OPTIMIZE },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-tab:nth-child(4)' },
      { do: 'wait', ms: 200 },
      // 히트맵과 경고는 탐색이 끝난 뒤에만 있다 — 탐색을 시작하는 것은 사람 클릭이다.
      { do: 'click', selector: '#backtestCanvas .backtest-optimize-start' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 「12값」·「23값」·「조합 276개」·「예상 ~2초」는 축과 격자가 정하는 값이다.
    phrases: [
      '그리드',
      '랜덤',
      '탐색 시작',
      '추가 TR 호출 없음 — 캐시 밖 구간은 먼저 수집 승인',
      'Sharpe 히트맵 — fast × slow',
      '과최적화 의심',
    ],
    // Paper가 그린 방식 둘(그리드·랜덤)과 축 둘(fast·slow), 경고 한 줄.
    structure: [
      { what: 'count', selector: '.backtest-segment-item', equals: 2 },
      { what: 'count', selector: '.backtest-optimize-range', equals: 2 },
      { what: 'count', selector: '.backtest-optimize-warn', equals: 1 },
    ],
  },
  {
    board: '3XL4-1', // 17 · 백테스트 — 출처에서 지도로 · 만드는 중(로딩)
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-source-map-start', data: SOURCE_MAP_JOB_START },
      { do: 'ipc-fixture', channel: 'athena:backtest-source-map-status', data: SOURCE_MAP_AT_3 },
      { do: 'mode', view: 'backtest' },
      // 기법을 고르지 않은 채로 온다 — 출처에서 만드는 전략에는 아직 고를 기법이 없다.
      { do: 'send', channel: 'athena:backtest-chat-action', data: SOURCE_URL_ACTION },
      // 두 왕복(잡 시작 → 첫 폴링)이 돌아야 다섯 줄이 선다.
      { do: 'wait', ms: 600 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 전부 앱이 가진 문장이다 — 단계 이름·부제(「✓ 출처 읽음」·「지도 뒤에서 자동」)는
    // 위 봉투가 주는 글자라 한 글자도 안 넣었다. 헤더의 「새 전략 · 출처에서 만드는 중 ·
    // 지도 v0」도 안 넣는다: 앱은 그 셋을 따로 그려 한 문장으로 붙지 않는다.
    // 진행 띠의 첫 줄도 마찬가지다 — Paper의 그 줄은 단계 수·남은 시간까지 한 문장이라
    // 값을 품고 있다.
    phrases: [
      '출처가 말한 대상',
      '확인 필요',
      '지도가 끝나면 채팅이 대상·기간부터 하나씩 묻습니다',
      '멈추기',
      '이 전략은 이렇게 흐릅니다',
      '칸이 하나씩 채워집니다 · 다 그려지면 대화로 고칠 수 있습니다',
      '여기부터 내 전략 — 출처에서 뽑은 칸들',
    ],
    // Paper가 그린 단계 다섯 줄, 지금 그리는 칸 하나(③의 「그리는 중」), 멈추는 버튼
    // 하나, 그리고 아직 만들어지지 않은 코드 — 서랍에 여는 버튼이 없다는 사실이 그
    // 뜻이다. 앞 둘은 위 봉투가 정한 값을 앱이 도는 것이라(다섯 줄·drawing 표식) 앱이
    // 혼자 정하는 것은 뒤 둘이다: [멈추기]는 잡 상태와 무관하게 늘 서고(보드 18 F칸의
    // 로딩 4요소 중 넷째), [코드 열기]는 만드는 중인 동안 아예 서지 않는다.
    structure: [
      { what: 'count', selector: '.backtest-source-step', equals: 5 },
      { what: 'count', selector: '.backtest-flow-drawing', equals: 1 },
      { what: 'count', selector: '.backtest-source-stop', equals: 1 },
      { what: 'absent', selector: '.backtest-map-open-code' },
    ],
  },
  {
    board: '2FMM-2', // 07 · 백테스트 — 전략 배포 · 실전 적용
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-run', data: BACKTEST_RUN_VERSIONED },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: BACKTEST_RESULT },
      { do: 'ipc-fixture', channel: 'athena:backtest-trades', data: BACKTEST_TRADES },
      { do: 'ipc-fixture', channel: 'athena:backtest-deployments', data: BACKTEST_DEPLOYMENTS },
      { do: 'ipc-fixture', channel: 'athena:backtest-signals', data: BACKTEST_NO_SIGNALS },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      // 「새 배포」의 갈래 셋은 **저장된 버전이 있을 때만** 선다(renderDeployForm) —
      // 없으면 그 자리에 "먼저 실행하거나 저장하라"가 대신 뜬다. 그 id는 코드로 돈
      // 실행이 돌려주므로 코드를 얹고 한 번 돌린다.
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-run-button' },
      { do: 'wait', ms: 600 },
      // 모드 탭 다섯째가 배포다(기법 · 결과 · 이력 · 최적화 · 배포).
      { do: 'click', selector: '#backtestCanvas .backtest-tab:nth-child(5)' },
      { do: 'wait', ms: 400 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 종목·별칭·한도 숫자·유효기간·괴리는 전부 값이다. Paper가 적은 한도 머리
    // (「사람이 미리 정하는 한도 — 모델은 못 바꿉니다」)와 신호 표·괴리 카드의 제목은
    // 안 적는다 — 앱의 한도 머리는 「한도 — 미리 승인하는 범위」고, 배포 뒤의 표는
    // 실전에서 벌어진 일이 아니라 오늘 로그다. 어긋난 자리에는 아무 것도 적지 않는다.
    phrases: [
      '기록만 합니다',
      '주문은 내지 않습니다. 전략이 실전에서 어떻게 움직이는지만 봅니다.',
      '승인을 받고 주문합니다',
      '한도 안에서 자동으로 주문합니다',
      '1회 최대 주문',
      '하루 최대 주문 수',
      '배포 중지',
    ],
    // Paper의 「신호가 나오면」 갈래 셋과, 가동 중인 배포 한 줄.
    structure: [
      { what: 'count', selector: '.backtest-deploy-mode-item', equals: 3 },
      { what: 'count', selector: '.backtest-deploy-item', equals: 1 },
    ],
  },
  {
    board: '2FR9-2', // 08 · 백테스트 — 코드 플로우 지도
    window: 'shell',
    // 이 보드는 스스로 초기 안이라고 적었다 — 「현행 위계는 반대입니다 … 1급 표면으로
    // 올린 모습은 보드 11, 규칙은 보드 14를 봅니다」. 그래서 지도 머리와 두 경계의
    // 이름(「이 코드는 이렇게 흐릅니다」·「여기부터 내 코드 — golden_cross.py」·
    // 「여기부터 다시 앱 — 코드가 손댈 수 없는 구간」)은 안 적는다: 앱을 그 문구로
    // 되돌리면 Paper의 현행 보드 11~14와 어긋난다. 같은 보드가 「칸의 종류·사람 말
    // 설명·실제 값 표기는 그대로 쓰고」라고 못 박은 부분만 잰다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-map', data: BACKTEST_FLOW_MAP },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      // 이 칸들이 서는 곳은 **코드 경로의 지도**다. 폼 경로에서는 같은 탭이 편집 표면
      // (보드 11~14의 그래프)을 세우고 요약 지도를 빼기 때문이다(renderFlowTab의
      // visualActive 분기, 2026-09-03 사용자 확정) — 보드 08이 그린 것은 파이썬 한
      // 파일을 읽어 만든 지도이므로 코드를 얹어 그 경로로 옮긴다.
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT },
      { do: 'wait-for', selector: '.backtest-code-host', count: 1, timeout: 2000, visibility: 'visible' },
      // 하위 탭 첫째가 지도다(지도 · 폼 · 코드 · 노드·흐름). 지도를 읽는 왕복은 이
      // 클릭이 낸다 — 코드를 얹는 길에는 그 호출이 없다.
      { do: 'click', selector: '#backtestCanvas .backtest-subtab:nth-child(1)' },
      { do: 'wait-for', selector: '.backtest-flow-node.is-mine', count: 4, timeout: 2000, visibility: 'visible' },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 칸의 문장은 프런트가 갖고 있지 않다 — 백엔드 flow.py의 STAGE_LABELS·APP_STAGES가
    // 그대로 화면 문구다(backtest-explain.js 머리말 「이 파일에는 레이아웃만 있고 칸의
    // 문장은 하나도 없다」). 경계 이름 하나만 화면 상수다. ④는 안 적는다 — 보드 08의
    // ④는 「두 열만 돌려줍니다」인데 현행 칸 여섯 종류에서 그 자리는 「지키는 선」이다
    // (보드 18 A칸). 어느 쪽을 적어도 한 보드에게는 거짓말이 된다.
    phrases: [
      '앱이 준비해서 건넵니다',
      '봉 데이터를 모읍니다',
      '조절할 값을 정합니다',
      '가격을 지표로 바꿉니다',
      '사고·파는 순간을 찍습니다',
      '성과를 냅니다',
    ],
    // Paper가 그린 앱 칸 넷(봉 데이터 · 체결가 · 비용 · 성과)과 내 칸 넷(①②③④),
    // 그 사이를 가르는 경계 셋.
    structure: [
      { what: 'count', selector: '.backtest-flow-node.is-app', equals: 4 },
      { what: 'count', selector: '.backtest-flow-node.is-mine', equals: 4 },
      { what: 'count', selector: '.backtest-flow-boundary', equals: 3 },
    ],
  },
  {
    board: '2FY9-2', // 09 · 백테스트 — 오류 진단 · 자동 수정 승인
    window: 'shell',
    // 08과 같은 사정이다 — 이 보드도 스스로 「초기 안 · 보드 12가 현행」이라 적었고,
    // 진단 세 줄의 제목(「어디서 — golden_cross.py 18–21줄」·「왜 — 초심자가 가장 자주
    // 밟는 곳입니다」)은 줄 번호를 앞세운 그 초기 안의 것이다. 같은 보드가 그대로
    // 가져간다고 못 박은 것은 둘이다: 사람 말 진단과 **파이썬 역추적을 서랍에 넣는
    // 규칙**, 그리고 [적용]까지 코드를 건드리지 않는 갈래 셋.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-run', data: BACKTEST_RUN_VERSIONED },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: BACKTEST_RESULT_FAILED },
      { do: 'ipc-fixture', channel: 'athena:backtest-diagnose', data: BACKTEST_DIAGNOSIS },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      // 진단은 **코드가 터졌을 때**만 뜬다 — 편집기가 비어 있으면 같은 실패가 그냥
      // 오류 화면으로 간다(handleRunFailure의 `!codeSource`).
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-run-button' },
      { do: 'wait', ms: 800 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 제목·사유·수정안 문장·줄 번호는 전부 백엔드 진단이 만드는 값이다.
    phrases: ['파이썬 원문 보기', '적용하고 다시 실행', '버리기'],
    // Paper가 그린 갈래 셋과, 역추적을 접어 둔 서랍 하나.
    structure: [
      { what: 'count', selector: '.backtest-diag-actions button', equals: 3 },
      { what: 'count', selector: '.backtest-diag-raw-toggle', equals: 1 },
    ],
  },
  // ---------- 백테스트 시각 전략 4장 (8-1 · 보드 11~14) ----------
  // 넷은 한 편집기의 네 상태다(backtest-visual-editor.js 머리말이 그 셋을 그대로 적었다):
  // 검증 전 → 검증 통과(valid) → 연결 오류(invalid) → 코드까지 같아짐(synced). 상태를
  // 가르는 것은 클릭이 아니라 **검증 왕복의 답**이라, 넷 다 같은 자리에서 봉투만 바꿔 선다.
  // Paper의 머리·탭 이름(「20–60 골든크로스 · v5 초안」·「실행 검토」)은 안 적는다 —
  // 판 번호와 전략 이름은 값이고, 앱의 실행 버튼은 유효할 때 「실행」이다.
  {
    board: '3Y38-1', // 11 · 백테스트 — 시각 전략 설계 · 편집 가능
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      // Paper의 보드 폭은 1680이고 그 폭에서 팔레트·캔버스·검사기가 나란히 선다. 앱도
      // 같은 규칙이지만 경계가 편집기 상자의 폭이라(VISUAL_NARROW_PX) 셸 창이 좁으면
      // 팔레트와 검사기가 서랍으로 접힌다 — 창 폭이 곧 이 화면이라 보드 28과 같은
      // 어휘로 세운다(러너가 라우트 전 bounds를 적어 두고 되돌린다).
      { do: 'resize', width: 1680, height: 1080 },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-registry', data: VISUAL_REGISTRY },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-from-spec', data: VISUAL_FROM_SPEC },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-validate', data: VISUAL_VALIDATE_OK },
      // 「연결 정상」은 검증이 끝나고 **코드로 옮기는 왕복이 도는 동안**의 상태다
      // (runVisualValidate가 valid를 세운 뒤 곧바로 compile을 기다린다). 봉투로 답하면
      // 그 상태는 IPC 한 왕복만큼만 살고 보드 14의 「동기화」로 넘어간다 — 계좌 등록의
      // 「확인 중」과 같은 사정이라 같은 어휘로 시간축을 세운다.
      { do: 'ipc-hang', channel: 'athena:backtest-visual-compile' },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 400 },
      { do: 'click', selector: '#backtestCanvas .backtest-visual-validate' },
      { do: 'wait', ms: 300 },
      // 검증이 끝난 자리에서 캔버스는 스스로 다시 그리지 않는다(편집기만 갱신된다) —
      // 머리줄의 상태 문구를 재려면 캔버스를 한 번 더 그려야 한다. 모드 탭 첫째는
      // 지금 서 있는 그 탭이라 화면을 옮기지 않고 다시 그리기만 한다.
      { do: 'click', selector: '#backtestCanvas .backtest-tab:nth-child(1)' },
      { do: 'wait', ms: 200 },
      // 검사기는 노드를 고른 뒤에만 값을 그린다(고르기 전에는 「노드를 고르면…」 한 줄).
      { do: 'click', selector: '#backtestCanvas .backtest-vis-node[data-node-id="n_fast"]' },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    phrases: [
      '서버 검증 가능',
      '연결 정상',
      '진입·청산 흐름',
      '끌어서 전략에 놓기',
      '선택한 노드',
      'StrategySpec으로 변환할 수 있습니다',
      '목록으로 보기',
    ],
    // Paper가 그린 노드 일곱·연결 여덟과 팔레트 네 묶음(데이터·지표·조건·출력).
    structure: [
      { what: 'count', selector: '.backtest-vis-node', equals: 7 },
      { what: 'count', selector: '.backtest-vis-edge', equals: 8 },
      { what: 'count', selector: '.backtest-vis-palette-group', equals: 4 },
    ],
  },
  {
    board: '3YFV-1', // 12 · 백테스트 — 시각 전략 검증 · 연결 오류
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      // Paper의 보드 폭은 1680이고 그 폭에서 팔레트·캔버스·검사기가 나란히 선다. 앱도
      // 같은 규칙이지만 경계가 편집기 상자의 폭이라(VISUAL_NARROW_PX) 셸 창이 좁으면
      // 팔레트와 검사기가 서랍으로 접힌다 — 창 폭이 곧 이 화면이라 보드 28과 같은
      // 어휘로 세운다(러너가 라우트 전 bounds를 적어 두고 되돌린다).
      { do: 'resize', width: 1680, height: 1080 },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-registry', data: VISUAL_REGISTRY },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-from-spec', data: VISUAL_FROM_SPEC_BROKEN },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-validate', data: VISUAL_VALIDATE_BROKEN },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 400 },
      { do: 'click', selector: '#backtestCanvas .backtest-visual-validate' },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-tab:nth-child(1)' },
      { do: 'wait', ms: 200 },
      // 오류 검사기는 **그 오류가 난 노드**를 골랐을 때만 선다.
      { do: 'click', selector: '#backtestCanvas .backtest-vis-node[data-node-id="n_below"]' },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 오류 문장(「느린 SMA 입력이 없습니다」)·포트 이름·줄 번호는 전부 백엔드 진단이
    // 만드는 값이다. 남는 것은 검사기의 구조 라벨과 갈래 둘, 그리고 막힌 사실 한 줄이다.
    phrases: [
      '서버 검증 실패',
      '오류가 난 노드',
      '문제 위치',
      '코드에서 열기',
      '대화로 수정하기',
      '설계와 오류 검토는 가능하지만, 이 상태에서는 최종 실행을 시작할 수 없습니다.',
      '첫 오류로',
    ],
    // 연결 하나가 끊겼으니 노드는 그대로 일곱, 연결은 일곱이다. 같은 진단 코드가 네
    // 곳에 붙는다는 계약(US-006)은 노드 카드·포트·검사기 상세·요약 바다.
    structure: [
      { what: 'count', selector: '.backtest-vis-node', equals: 7 },
      { what: 'count', selector: '.backtest-vis-edge', equals: 7 },
      { what: 'count', selector: '.backtest-vis-inspector-error', equals: 1 },
    ],
  },
  {
    board: '3YQ0-1', // 13 · 백테스트 — 오류 노드에서 코드로 · 줄 연결
    window: 'shell',
    // 보드 12에서 [코드에서 열기]를 누른 다음 화면이다. 여는 것은 실행 산출물이 아니라
    // **미실행 미리보기**다(검증이 실패했으니 컴파일 산출물이 없다) — 그래서 파일 띠에
    // 「그래프 호환 모드」가 붙고, 맨 아래 줄이 코드 전용 전환을 묻는다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      // Paper의 보드 폭은 1680이고 그 폭에서 팔레트·캔버스·검사기가 나란히 선다. 앱도
      // 같은 규칙이지만 경계가 편집기 상자의 폭이라(VISUAL_NARROW_PX) 셸 창이 좁으면
      // 팔레트와 검사기가 서랍으로 접힌다 — 창 폭이 곧 이 화면이라 보드 28과 같은
      // 어휘로 세운다(러너가 라우트 전 bounds를 적어 두고 되돌린다).
      { do: 'resize', width: 1680, height: 1080 },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-registry', data: VISUAL_REGISTRY },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-from-spec', data: VISUAL_FROM_SPEC_BROKEN },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-validate', data: VISUAL_VALIDATE_BROKEN },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 400 },
      { do: 'click', selector: '#backtestCanvas .backtest-visual-validate' },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-tab:nth-child(1)' },
      { do: 'wait', ms: 200 },
      { do: 'click', selector: '#backtestCanvas .backtest-vis-node[data-node-id="n_below"]' },
      { do: 'wait', ms: 200 },
      { do: 'click', selector: '#backtestCanvas .backtest-vis-open-code' },
      { do: 'wait', ms: 400 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    phrases: [
      '연결된 노드 · 하향 돌파',
      '시각 설계에서 보기',
      '전략 파일',
      '그래프에서 생성됨',
      '그래프 호환 모드',
      '그래프로 표현할 수 없는 수정은 적용 전에 코드 전용 전환을 묻습니다',
    ],
    // Paper의 리본 한 줄 · 파일 띠 한 줄 · 맨 아래 연결 상태 한 줄.
    structure: [
      { what: 'count', selector: '.backtest-code-ribbon-back', equals: 1 },
      { what: 'count', selector: '.backtest-code-filemeta', equals: 1 },
      { what: 'count', selector: '.backtest-code-linkstatus', equals: 1 },
    ],
  },
  {
    board: '3Z0X-1', // 14 · 백테스트 — 그래프·코드 동기화 완료 · 실행 전
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      // Paper의 보드 폭은 1680이고 그 폭에서 팔레트·캔버스·검사기가 나란히 선다. 앱도
      // 같은 규칙이지만 경계가 편집기 상자의 폭이라(VISUAL_NARROW_PX) 셸 창이 좁으면
      // 팔레트와 검사기가 서랍으로 접힌다 — 창 폭이 곧 이 화면이라 보드 28과 같은
      // 어휘로 세운다(러너가 라우트 전 bounds를 적어 두고 되돌린다).
      { do: 'resize', width: 1680, height: 1080 },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-registry', data: VISUAL_REGISTRY },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-from-spec', data: VISUAL_FROM_SPEC },
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-validate', data: VISUAL_VALIDATE_OK },
      // 보드 11과 다른 것은 이 한 줄뿐이다 — 코드로 옮기는 왕복이 답하면 그래프와 코드가
      // 같은 판을 가리키고, 그 사실이 요약 바와 머리줄에 그대로 선다.
      { do: 'ipc-fixture', channel: 'athena:backtest-visual-compile', data: VISUAL_COMPILE },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 400 },
      { do: 'click', selector: '#backtestCanvas .backtest-visual-validate' },
      { do: 'wait', ms: 500 },
      // Paper가 고른 노드는 방금 고쳐진 하향 돌파다 — 필수 입력이 둘이라 「입력 연결」
      // 줄이 서는 것도 이 노드뿐이다.
      { do: 'click', selector: '#backtestCanvas .backtest-vis-node[data-node-id="n_below"]' },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    phrases: [
      '그래프 · 코드 검증 완료',
      '동기화',
      '그래프와 코드가 같은 버전입니다',
      '수정됨',
      '입력 연결',
      '연결과 값이 유효합니다',
      '목록으로 보기',
    ],
    structure: [
      { what: 'count', selector: '.backtest-vis-node', equals: 7 },
      { what: 'count', selector: '.backtest-vis-edge', equals: 8 },
    ],
  },
  // ---------- 백테스트 기법 목록 1장 (8-1 · 보드 19) ----------
  {
    board: '40EV-1', // 19 · 백테스트 — 기법 목록 · 새 기법
    window: 'shell',
    // 기법을 고르기 전 첫 화면이다 — 위 여섯 보드가 쓰던 BACKTEST_TARGET을 여기서는
    // 보내지 않는다(보내면 그 기법이 열려 목록이 아니라 설계 화면이 선다).
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_TECHNIQUE_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-user-strategies', data: BACKTEST_USER_STRATEGIES },
      { do: 'mode', view: 'backtest' },
      { do: 'wait', ms: 500 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 기법 이름·분류·설명은 전부 목록이 준 값이다. 「처음 있던 10개와 내가 만든 1개를
    // 구분하지 않습니다」는 값처럼 보이지만 아니다 — 앱이 두 목록의 **길이**로 만드는
    // 문장이라, 한 목록이 비면 그 자리에서 다른 문장이 된다.
    phrases: [
      '새 기법 만들기',
      '코드창과 대화창이 열립니다 — AI가 한 번에 하나씩 물어보며 원하는 알고리즘을 코드로 씁니다',
      '대화로 시작',
      '처음 있던 10개와 내가 만든 1개를 구분하지 않습니다',
      '분류 전체 · 상태 전체',
      '결과',
      '이력',
    ],
    // 고르기 전에는 모드 탭이 셋이다(기법 · 결과 · 이력). 목록은 열한 줄이고 맨 위에
    // [+ 새 기법 만들기] 하나가 선다.
    structure: [
      { what: 'count', selector: '.backtest-tab', equals: 3 },
      { what: 'count', selector: '.backtest-technique-card', equals: 11 },
      { what: 'count', selector: '.backtest-technique-new', equals: 1 },
    ],
  },
  // ---------- 백테스트 새 기법 3장 (8-1 · 보드 20·21·22) ----------
  // 셋은 한 초안의 세 순간이다: 코드가 아직 검사를 못 넘은 때(20) · 넘어서 노드가 열린
  // 때(21) · 두 번째 고침의 diff를 연 때(22). 폴더 하나 = 기법 하나 = 대화 하나(2026-09-07):
  // 헤더는 폴더 이름과 [그만두기], 왼쪽 열은 그 폴더의 트리·자동 검사·환경이다. 검사
  // 항목 이름(문법·계약·룩어헤드…)은 백엔드 label_ko라 문구가 못 된다. 「AI가 쓰는 중」
  // 배너는 앱에 없다 — 어그난 자리에는 아무 것도 적지 않는다.
  {
    board: '43DP-1', // 20 · 백테스트 — 새 기법 만들기 · 폴더·편집기·터미널·단계 카드
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_TECHNIQUE_PRESETS },
      ...TECHNIQUE_PROJECT_FIXTURES,
      { do: 'ipc-fixture', channel: 'athena:backtest-technique-check', data: TECHNIQUE_CHECKS_BLOCKED },
      { do: 'mode', view: 'backtest' },
      { do: 'wait', ms: 400 },
      // 목록 화면에서 온 설정·코드가 새 기법의 뼈대를 세운다(startTechniqueFromChat).
      // 대상을 먼저 채우는 것은 검사가 무엇을 볼지 알아야 하기 때문이다(techniqueCheckTarget).
      { do: 'send', channel: 'athena:backtest-chat-action', data: TECHNIQUE_DRAFT_TARGET },
      { do: 'wait', ms: 300 },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT },
      // 검사는 코드가 바뀜고 700ms 뒤에 자동으로 돌다(TECHNIQUE_CHECK_DEBOUNCE_MS).
      { do: 'wait', ms: 1400 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 「기법 폴더」·「그만두기」·「이 폴더 밖은 AI가 건드리지 않습니다.」는 보드 20의 왼쪽 열과
    // 헤더가 적은 그대로다. 폴더 이름·파일 이름은 값이라 phrases에 안 넣는다.
    phrases: [
      '코드', '노드·흐름', '직접 편집', '터미널', '그만두기', '기법 폴더',
      '이 폴더 밖은 AI가 건드리지 않습니다.',
    ],
    // 초안에는 하위 탭이 둘뿐이다 — Paper 보드 20이 그린 그 둘, 그 차례. 헤더에 모드 탭·
    // 폼/코드 갈래·다른 폴더를 고르는 줄은 없다(한 페이지 = 한 알고리즘).
    structure: [
      { what: 'order', selector: '.backtest-subtab', equals: ['코드', '노드·흐름'] },
      { what: 'count', selector: '.backtest-terminal', equals: 1 },
      { what: 'count', selector: '.backtest-technique-band', equals: 1 },
      { what: 'count', selector: '.project-ide-side', equals: 1 },
      { what: 'count', selector: '.backtest-head-home', equals: 1 },
      { what: 'count', selector: '.backtest-tab', equals: 0 },
      { what: 'count', selector: '.backtest-runpath', equals: 0 },
      { what: 'count', selector: '.project-ide-project', equals: 0 },
    ],
  },
  {
    board: '43O1-1', // 21 · 백테스트 — 노드·흐름 창
    window: 'shell',
    // 노드 창은 사람이 여는 것이 아니라 **차단 검사를 전부 넘긴 순간** 스스로 열린다
    // (loadTechniqueNodes의 auto 갈래). 그래서 이 라우트에는 탭을 누르는 손이 없다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_TECHNIQUE_PRESETS },
      ...TECHNIQUE_PROJECT_FIXTURES,
      { do: 'ipc-fixture', channel: 'athena:backtest-technique-check', data: TECHNIQUE_CHECKS_PASSED },
      { do: 'ipc-fixture', channel: 'athena:backtest-technique-nodes', data: TECHNIQUE_NODES },
      { do: 'ipc-fixture', channel: 'athena:backtest-run', data: BACKTEST_RUN_OK },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: BACKTEST_RESULT },
      { do: 'mode', view: 'backtest' },
      { do: 'wait', ms: 400 },
      { do: 'send', channel: 'athena:backtest-chat-action', data: TECHNIQUE_DRAFT_TARGET },
      { do: 'wait', ms: 300 },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT },
      { do: 'wait', ms: 1800 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 함수 이름·줄 범위·한 줄 설명은 전부 그 파이썬을 읽은 값이다. 역할 칩은 값이
    // 아니다 — 백엔드가 보내는 것은 열쇠말(indicator·exit·sizing)이고 한국어 낱말은
    // 이 화면이 가진 표다(backtest-technique-nodes.js ROLE_LABELS).
    phrases: ['노드·흐름', '코드 보기', '지표', '수량'],
    // Paper가 그린 다섯 함수. 고스트(재사용) 카드에는 손잡이가 없어 [코드 보기]도 다섯이다.
    structure: [
      { what: 'count', selector: '.backtest-tnodes-rail-item', equals: 5 },
      { what: 'count', selector: '.backtest-tnodes-act.is-code', equals: 5 },
    ],
  },
  {
    board: '452D-1', // 22 · 백테스트 — 고치기 순환 · 단계 카드를 누르면 diff가 열린다
    window: 'shell',
    // 이 보드가 그린 것은 「카드를 누르면 그 자리가 열린다」이다 — diff를 여는 손잡이는
    // 캔버스가 아니라 대화에 쌓인 단계 카드다(chat.js backtest-step-action). 그래서
    // 여는 클릭이 #history를 지난다.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_TECHNIQUE_PRESETS },
      ...TECHNIQUE_PROJECT_FIXTURES,
      { do: 'ipc-fixture', channel: 'athena:backtest-technique-check', data: TECHNIQUE_CHECKS_PASSED },
      { do: 'ipc-fixture', channel: 'athena:backtest-technique-nodes', data: TECHNIQUE_NODES },
      { do: 'ipc-fixture', channel: 'athena:backtest-run', data: BACKTEST_RUN_OK },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: BACKTEST_RESULT },
      { do: 'mode', view: 'backtest' },
      { do: 'wait', ms: 400 },
      { do: 'send', channel: 'athena:backtest-chat-action', data: TECHNIQUE_DRAFT_TARGET },
      { do: 'wait', ms: 300 },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT },
      { do: 'wait', ms: 1800 },
      // 두 번째 고침 — Paper의 「3번째 고침」이 그린 그 순환이다.
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT_2 },
      { do: 'wait', ms: 1800 },
      { do: 'click', selector: '#history .backtest-step-card.is-icon-edit .backtest-step-action' },
      { do: 'wait', ms: 300 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // [이 기법 승인]은 검사를 넘고 자동 백테스트가 끝난 뒤에만 선다 — 이 보드가 「승인
    // 전까지 목록에도 실매매에도 올라가지 않습니다」라고 적은 그 버튼이다.
    phrases: ['코드', '노드·흐름', '터미널', '이 기법 승인'],
    structure: [
      { what: 'count', selector: '.backtest-technique-diff', equals: 1 },
      { what: 'count', selector: '.backtest-terminal', equals: 1 },
      { what: 'count', selector: '.backtest-technique-approve', equals: 1 },
    ],
  },
  // ---------- 백테스트 실매매 적용 1장 (8-1 · 보드 23) ----------
  {
    board: '42FW-1', // 23 · 백테스트 — 승인 → 목록에 추가 → 실매매 적용
    window: 'shell',
    // Paper는 왼쪽에 승인된 목록(12개·「승인됨 · 목록에 추가」)을 나란히 그렸지만 앱은
    // 목록과 배포를 한 번에 그리지 않는다(모드 탭이 가른다) — 그 자리에는 아무 것도
    // 적지 않고, 이 보드가 새로 그린 것만 재다: 키우미를 켜면 주문까지 자동으로 나가는
    // 배포와 그 한도, 그리고 오늘 로그.
    reach: [
      { do: 'ipc-fixture', channel: 'athena:backtest-presets', data: BACKTEST_PRESETS },
      { do: 'ipc-fixture', channel: 'athena:backtest-run', data: BACKTEST_RUN_VERSIONED },
      { do: 'ipc-fixture', channel: 'athena:backtest-result', data: BACKTEST_RESULT },
      { do: 'ipc-fixture', channel: 'athena:backtest-trades', data: BACKTEST_TRADES },
      { do: 'ipc-fixture', channel: 'athena:backtest-deployments', data: BACKTEST_DEPLOYMENT_ARMED },
      { do: 'ipc-fixture', channel: 'athena:backtest-signals', data: BACKTEST_NO_SIGNALS },
      { do: 'mode', view: 'backtest' },
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_TARGET },
      { do: 'wait', ms: 300 },
      // 「이 전략을 실전에 겁니다」와 한도 여섯 칸은 **저장된 버전이 있을 때만** 선다
      // (renderDeployForm) — 그 id는 코드로 돌 실행이 돌려준다.
      { do: 'send', channel: 'athena:backtest-chat-action', data: BACKTEST_CODE_DRAFT },
      { do: 'wait', ms: 300 },
      { do: 'click', selector: '#backtestCanvas .backtest-run-button' },
      { do: 'wait', ms: 600 },
      { do: 'click', selector: '#backtestCanvas .backtest-tab:nth-child(5)' },
      { do: 'wait', ms: 500 },
      { do: 'settle' },
    ],
    root: '#backtestCanvas',
    // 종목·별칭·한도 숫자·상태는 전부 백엔드가 준 값이다.
    phrases: [
      '키우미 켜짐 = 자동 매매',
      '신호가 나면 위 한도 안에서 주문까지 자동으로 나갑니다. 한도를 넘거나 연속 손절 3회·낙폭 15%에 닿으면 스스로 멈춥니다.',
      '한도 — 미리 승인하는 범위',
      '오늘 로그',
      '모의서버',
      '이 전략을 실전에 겁니다',
      '백테스트는 다음 봉 시가에 원하는 수량이 전부 체결된다고 가정하고, 실전은 그렇지 않습니다. 실전과 백테스트의 차이는 배포 후 신호 목록에서 그대로 보여드립니다.',
    ],
    structure: [
      { what: 'count', selector: '.backtest-deploy-arm', equals: 1 },
      { what: 'count', selector: '.backtest-deploy-log', equals: 1 },
      { what: 'count', selector: '.backtest-deploy-item', equals: 1 },
    ],
  },
]);

module.exports = { ROUTES, STEP_KINDS, STRUCTURE_KINDS };
