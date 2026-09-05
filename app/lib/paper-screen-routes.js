'use strict';

// Paper 화면계 보드를 실앱 도달 절차 + 대조 계약으로 잇는다(설계서 §4.1~§4.3).
//
// 매니페스트 role==="screen" 104장이 결국 전부 여기 있어야 한다. 없는 보드는 미구현 실패다 —
// 「도달 절차가 없는 보드는 실패한다」가 게이트 2의 핵심이라, 표가 곧 남은 작업 목록이 된다.
// 지금은 초기 8장(에이전트 4 + 화면 4)이고, 래칫(§4.5)이 이 8장을 잠근 뒤 저작이 이어진다.
//
// ── reach 어휘는 닫혀 있다
// 임의 JS를 표에 심으면 표가 곧 프로브가 되어 유지가 안 된다. STEP_KINDS만 허용하고,
// 탈출구인 `eval`은 `why`를 강제한다(§4.1). 프로브(probe-paper-screens.js)는 이 어휘만 실행한다.
//
// ── phrases 는 fixture가 바꾸지 못하는 것만 담는다
// 제목·부제·버튼·탭·섹션 제목·안내문·빈 상태 문구만 넣고 숫자·시각·종목명·금액은 넣지 않는다.
// 후보는 `app/lib/paper-screen-phrases.generated.js`(scripts/paper-phrases.mjs 산출)에서 고른다.
// 판정은 `root`의 textContent 포함 여부다 — 앱이 「＋ 새 작업 · 채팅에서」로 늘려 그려도
// Paper의 「＋ 새 작업」은 그 안에 있다. 보드당 3~7개: 3개 미만이면 공허 통과하고
// 7개를 넘으면 문구 한 줄 고칠 때마다 게이트가 깨진다.
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
  // ipc-fixture channel,data — 핸들러를 갈아끼운다. data는 `{ ok: true, data }`의 안쪽이다
  //                            (probe-agent-paper-parity.js:126-140과 같은 규약)
  'ipc-fixture': Object.freeze(['channel', 'data']),
  // envelope  data — 캔버스 봉투 주입 (verify.js:3745-3754 liveEnvelope)
  envelope: Object.freeze(['data']),
  // wait      ms
  wait: Object.freeze(['ms']),
  // settle    (인자 없음) — rAF 2회 (verify.js responsiveSettle)
  settle: Object.freeze([]),
  // eval      js,why — 탈출구. why가 없으면 라우트표 린트가 거절한다
  eval: Object.freeze(['js', 'why']),
});

const STRUCTURE_KINDS = Object.freeze(['count', 'order', 'absent']);

// 에이전트 목록 fixture — 드릴인(보드 03)이 열리는 것은 감시 갈래뿐이라 realtime-ws를 쓴다
// (probe-agent-paper-parity.js:50 "드릴인이 열리는 것은 감시(watch)뿐"). 값은 전부 데이터라
// phrases에는 한 글자도 넣지 않는다.
const WATCH_ROUTINE = Object.freeze({
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
});

const ROUTES = Object.freeze([
  // ---------- 에이전트 4장 (A-2) ----------
  {
    board: 'ARM-0', // 02 · 에이전트 — 알람 센터 · 라이브 관제
    window: 'shell',
    reach: [
      { do: 'mode', view: 'agent' },
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
    structure: [
      { what: 'count', selector: '.agent-view-tab', equals: 4 },
      { what: 'count', selector: '.agent-stat-card', equals: 4 },
    ],
  },
  {
    board: 'B57-0', // 03 · 에이전트 — 실행 이력·결과
    window: 'shell',
    reach: [
      { do: 'ipc-fixture', channel: 'athena:routines-list', data: WATCH_ROUTINE },
      { do: 'ipc-fixture', channel: 'athena:routine-runs', data: { runs: [], avg_duration_ms: 6540, opened_rate: 0.71, replied_count: 9 } },
      { do: 'mode', view: 'agent' },
      { do: 'wait', ms: 700 },
      { do: 'click', selector: '.agent-row' },
      { do: 'wait', ms: 200 },
      { do: 'click', selector: '.agent-history-open' },
      { do: 'settle' },
    ],
    root: '#agentCanvas',
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
      '모델 이름 직접 입력',
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
    // 보드가 셸 창 전체(요약 표 + 대화 머리)라 root도 셸이다.
    root: '#shell',
    phrases: ['요약', '수집·노출', '그래프에게 묻기', '답이 캔버스를 바꿉니다'],
    structure: [{ what: 'count', selector: '#graphSummaryHeader .view-toggle-tab', equals: 3 }],
  },
]);

module.exports = { ROUTES, STEP_KINDS, STRUCTURE_KINDS };
