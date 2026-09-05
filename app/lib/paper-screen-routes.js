'use strict';

// Paper 화면계 보드를 실앱 도달 절차 + 대조 계약으로 잇는다(설계서 §4.1~§4.3).
//
// 매니페스트 role==="screen" 104장이 결국 전부 여기 있어야 한다. 없는 보드는 미구현 실패다 —
// 「도달 절차가 없는 보드는 실패한다」가 게이트 2의 핵심이라, 표가 곧 남은 작업 목록이 된다.
// 지금은 23장(부팅 5 + 온보딩 3 + 인증 3 + 에이전트 4 + 화면 4 + 셸·그래프 2 + 대화·계정 2)이고,
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
]);

module.exports = { ROUTES, STEP_KINDS, STRUCTURE_KINDS };
