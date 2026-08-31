// agent-canvas.js 단위 테스트 — Electron/브라우저 없이 최소 DOM 스텁으로 검증한다
// (history-badge.test.js가 세운 관례 — jsdom 등 신규 의존성을 들이지 않는다).
// 이 파일 전용 스텁이다(graph-mode/fake-dom.js를 이 디렉터리 밖에서 재사용하지
// 않는다 — 그 파일은 render.test.js/controller.test.js 전용이라는 자기 머리말이
// 있다). querySelectorAll에 기대지 않고 만든 요소 개수/텍스트를 직접 센다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAgentCanvas } = require('./agent-canvas');

function fakeNode(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    type: '',
    placeholder: '',
    value: '',
    hidden: false,
    children: [],
    attrs: {},
    style: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); },
    // Promise.all을 돌려준다 — 동기 핸들러(기존 테스트 대부분)는 그냥 무시해도
    // 되고, async 핸들러(6.5단계 일시중지/재개 클릭)는 호출부가 await해서
    // 왕복이 끝난 뒤 단언할 수 있다.
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      return Promise.all(handlers.map((h) => h(event)));
    },
  };
  return node;
}

function installFakeDocument() {
  global.document = {
    createElement: (tag) => fakeNode(tag),
    createElementNS: (_ns, tag) => fakeNode(tag),
  };
}

function uninstallFakeDocument() {
  delete global.document;
}

test.beforeEach(() => installFakeDocument());
test.afterEach(() => uninstallFakeDocument());

function routine(overrides) {
  return { id: 'r1', symbol: '005930', note: '005930 감시', status: 'active', mode: 'periodic', ...overrides };
}

// 클래스명으로 자식을 찾는다 — 이 스텁은 querySelectorAll이 없으므로 children을
// 직접 순회한다(react-testing-library류 셀렉터를 흉내내지 않는다, ponytail 원칙).
function findByClass(node, cls) {
  const found = [];
  const walk = (n) => {
    if (String(n.className || '').split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

test('mount(): 헤더(타이틀·부제·탭 3종·검색·CTA)와 통계 카드 4장이 렌더된다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();

  assert.equal(findByClass(container, 'agent-title')[0].textContent, '에이전트');
  assert.equal(findByClass(container, 'agent-tab').length, 3);
  assert.deepEqual(findByClass(container, 'agent-tab').map((n) => n.textContent), ['모두', '활성', '일시중지']);
  assert.equal(findByClass(container, 'agent-search-input')[0].placeholder, '작업 검색');
  assert.equal(findByClass(container, 'agent-cta')[0].textContent, '＋ 새 작업 · 채팅에서');
  assert.equal(findByClass(container, 'agent-stat-card').length, 4);
});

test('통계 카드: "진행 중"만 fixture, 나머지 3장은 live로 표시된다(3단계 라이브 승격)', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  const cards = findByClass(container, 'agent-stat-card');
  const bySource = (src) => cards.filter((c) => c.getAttribute('data-source') === src);
  assert.equal(bySource('fixture').length, 1, '"진행 중" 하나만 fixture로 남는다');
  assert.equal(bySource('live').length, 3, '다음 실행·오늘 발화·성향 제안은 live다');
  const inProgress = cards.find((c) => findByClass(c, 'agent-stat-label')[0].textContent === '진행 중');
  assert.equal(inProgress.getAttribute('data-source'), 'fixture');
});

test('통계 카드: 데이터가 없을 때 "다음 실행"·"오늘 발화"는 지어낸 값 없이 정직한 빈 상태를 보여준다(P3)', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  const cards = findByClass(container, 'agent-stat-card');
  const valueOf = (label) => findByClass(
    cards.find((c) => findByClass(c, 'agent-stat-label')[0].textContent === label),
    'agent-stat-value',
  )[0].textContent;
  assert.equal(valueOf('다음 실행'), '없음', 'fetchFiredToday 없이도 다음 실행은 라우틴 목록만으로 계산된다');
  assert.equal(valueOf('오늘 발화'), '—', 'fetchFiredToday가 없으면 지어낸 숫자를 보여주지 않는다');
});

test('통계 카드: 예약(scheduled) 라우틴이 있으면 "다음 실행"이 그 next_fire_at으로 채워진다', async () => {
  const container = fakeNode('div');
  const routines = [routine({
    id: 's1', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑',
    next_fire_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines, fetchFiredToday: async () => 3,
  });
  canvas.mount();
  await canvas.refresh();
  const cards = findByClass(container, 'agent-stat-card');
  const nextRun = cards.find((c) => findByClass(c, 'agent-stat-label')[0].textContent === '다음 실행');
  assert.ok(findByClass(nextRun, 'agent-stat-value')[0].textContent.includes('평일 아침 브리핑'));
  const firedToday = cards.find((c) => findByClass(c, 'agent-stat-label')[0].textContent === '오늘 발화');
  assert.equal(findByClass(firedToday, 'agent-stat-value')[0].textContent, '3건');
});

test('성향 제안 카드만 is-accent가 붙는다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  const accented = findByClass(container, 'agent-stat-card').filter((c) => c.className.includes('is-accent'));
  assert.equal(accented.length, 1);
  assert.equal(findByClass(accented[0], 'agent-stat-label')[0].textContent, '성향 제안');
});

test('refresh(): 라우틴을 받아오면 부제(루틴 N · 감시 M)가 채워진다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active' }),
    routine({ id: 'b', status: 'paused' }),
    routine({ id: 'c', status: 'draft' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-subtitle')[0].textContent, '루틴 3 · 감시 1 진행 중');
});

// ── 5단계: 좌측 "예약·감시" 리스트 — 감시(watch)=라이브 + 예약(schedule)=fixture ──

test('"모두" 탭: watch 2건 + draft 1건(8단계, ◌ 점선 핑크) + 예약(schedule) 1건이 모두 live로 보인다(3단계)', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active' }),
    routine({ id: 'b', status: 'paused' }),
    routine({ id: 'c', status: 'draft' }),
    routine({ id: 'd', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 4, 'watch 2건 + draft 1건 + schedule 1건');
  const liveRows = rows.filter((r) => r.getAttribute('data-source') === 'live');
  assert.equal(liveRows.length, 4, '넷 다 실데이터다 — 예약도 3단계부터 fixture가 아니다');
  const draftRow = rows.find((r) => r.className.includes('is-draft'));
  assert.ok(draftRow, 'draft 행은 is-draft 클래스를 갖는다');
});

test('예약(schedule) 행에는 live 출처가 코드로 표시된다(3단계 — 더 이상 fixture가 아니다, P3)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 's1', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].getAttribute('data-source'), 'live');
});

test('라이브 라우틴이 하나도 없으면 "조건에 맞는 작업이 없습니다"가 뜬다(예약 fixture 폴백 없음, 3단계)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 0);
  const watchListNode = findByClass(container, 'agent-watch-list')[0];
  assert.equal(findByClass(watchListNode, 'agent-list-empty')[0].textContent, '조건에 맞는 작업이 없습니다');
});

test('탭 "활성": 감시 active 1건 + 예약(schedule) active 1건이 남는다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active' }),
    routine({ id: 'b', status: 'paused' }),
    routine({ id: 'c', status: 'draft' }),
    routine({ id: 'd', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' }),
    routine({ id: 'e', status: 'paused', mode: 'scheduled', note: '반도체 ETF 리밸런스 점검' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.setActiveTab('active');
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 2);
  const titles = rows.map((r) => findByClass(r, 'agent-row-title')[0].textContent);
  assert.ok(titles.includes('005930 감시'), '라이브 감시 행');
  assert.ok(titles.includes('평일 아침 브리핑'), '예약 행 중 active 상태인 것');

  const activeTabBtn = findByClass(container, 'agent-tab').find((b) => b.textContent === '활성');
  assert.ok(activeTabBtn.className.includes('is-active'));
  const allTabBtn = findByClass(container, 'agent-tab').find((b) => b.textContent === '모두');
  assert.equal(allTabBtn.className.includes('is-active'), false, '다른 탭은 꺼진다');
});

test('탭 "일시중지": 감시 paused 1건 + 예약(schedule) paused 1건이 남는다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active' }),
    routine({ id: 'b', status: 'paused' }),
    routine({ id: 'e', status: 'paused', mode: 'scheduled', note: '반도체 ETF 리밸런스 점검' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.setActiveTab('paused');
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 2);
  const titles = rows.map((r) => findByClass(r, 'agent-row-title')[0].textContent);
  assert.ok(titles.includes('005930 감시'));
  assert.ok(titles.includes('반도체 ETF 리밸런스 점검'));
});

test('예약(schedule) 행은 watch(periodic)와 아이콘 색이 구분된다(사실11⑥, statusRowIcon 3분기)', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active', mode: 'realtime-ws', note: '실시간 감시' }),
    routine({ id: 'd', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const rows = findByClass(container, 'agent-row');
  const dotFor = (title) => findByClass(rows.find(
    (r) => findByClass(r, 'agent-row-title')[0].textContent === title,
  ), 'agent-row-dot')[0];
  assert.equal(dotFor('실시간 감시').style.color, 'var(--color-info)');
  assert.equal(dotFor('평일 아침 브리핑').style.color, 'var(--color-ok)');
});

test('검색어를 입력하면 감시·예약 모두에서 제목/부제 부분일치로 좁혀진다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', note: '삼성전자 88,000 감시', symbol: '005930' }),
    routine({ id: 'b', note: 'SK하이닉스 공시 키워드', symbol: '000660' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const input = findByClass(container, 'agent-search-input')[0];
  input.value = '하이닉스';
  input.dispatchEvent({ type: 'input' });
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 1);
  assert.equal(findByClass(rows[0], 'agent-row-title')[0].textContent, 'SK하이닉스 공시 키워드');
});

test('검색 결과가 0건이면 "조건에 맞는 작업이 없습니다"가 뜬다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  const input = findByClass(container, 'agent-search-input')[0];
  input.value = '존재하지않는검색어';
  input.dispatchEvent({ type: 'input' });
  // 알람 컬럼도 같은 .agent-list-empty 스타일을 쓴다(9단계) — 예약·감시 리스트
  // 범위로 좁혀서 잰다.
  const watchListNode = findByClass(container, 'agent-watch-list')[0];
  const empty = findByClass(watchListNode, 'agent-list-empty');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].textContent, '조건에 맞는 작업이 없습니다');
  assert.equal(findByClass(container, 'agent-row').length, 0);
});

// ── 5단계: 우측 상세 패널 ──

test('기본으로 첫 행이 선택돼 상세 패널에 채워진다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active', note: '삼성전자 88,000 감시' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-detail-title')[0].textContent, '삼성전자 88,000 감시');
  assert.equal(findByClass(container, 'agent-status-badge')[0].textContent, '활성');
});

test('행을 클릭하면 상세 패널이 그 항목으로 바뀐다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active', note: '라이브 감시 행' }),
    routine({ id: 'd', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const scheduleRow = findByClass(container, 'agent-row').find(
    (r) => findByClass(r, 'agent-row-title')[0].textContent === '평일 아침 브리핑',
  );
  scheduleRow.dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'agent-detail-title')[0].textContent, '평일 아침 브리핑');
});

test('감시(watch) 상세는 백엔드 실제 필드(소스·쿨다운)만 보여준다 — 지어내지 않는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({
    id: 'a', status: 'active', note: '삼성전자 88,000 감시',
    source_label: '현재가', cooldown_s: 300, expires_at: '2026-09-01T00:00:00Z',
  })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const fieldLabels = findByClass(container, 'agent-detail-field-label').map((n) => n.textContent);
  assert.ok(fieldLabels.includes('소스'));
  assert.ok(fieldLabels.includes('쿨다운'));
  // 6단계부터 '실행 위치'·'브리핑 모델'은 schedule 전용 **실데이터** 행이다 —
  // watch에는 여전히 안 붙는다(브리핑 개념이 없는 종류에 지어내지 않는다).
  assert.equal(fieldLabels.includes('실행 위치'), false, 'watch에는 브리핑 필드가 없다');
  assert.equal(fieldLabels.includes('브리핑 모델'), false, 'watch에는 브리핑 필드가 없다');
});

test('예약(schedule) 상세는 백엔드 실제 필드(소스·쿨다운·다음 실행)를 보여주고 data-source가 live다(3단계)', async () => {
  const container = fakeNode('div');
  const routines = [routine({
    id: 's1', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑',
    source_label: '벽시계 예약', cooldown_s: 0, next_fire_at: '2026-08-28T07:30:00+09:00',
  })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const fieldsWrap = findByClass(container, 'agent-detail-fields')[0];
  assert.equal(fieldsWrap.getAttribute('data-source'), 'live');
  const fieldLabels = findByClass(fieldsWrap, 'agent-detail-field-label').map((n) => n.textContent);
  assert.ok(fieldLabels.includes('소스'));
  assert.ok(fieldLabels.includes('쿨다운'));
  assert.ok(fieldLabels.includes('다음 실행'));
  // [6단계 의도적 반전] 이전 단언은 "'실행 위치'는 지어낸 fixture 필드라 없다"
  // 였다 — 이제 실데이터 행이 됐으므로 '브리핑 모델'은 항상 붙고(값 없으면
  // '앱 기본'), '실행 위치'는 **브리핑 실행 이력이 없을 때만** 안 붙는다.
  assert.ok(fieldLabels.includes('브리핑 모델'));
  assert.equal(fieldLabels.includes('실행 위치'), false, '실행 이력 없는 라우틴은 이 행을 렌더하지 않는다');
});

test('예약(schedule) 상세 — "브리핑 모델" 설정값과 "실행 위치"(최근 브리핑 보고 destination)가 실데이터로 렌더된다(6단계)', async () => {
  const container = fakeNode('div');
  const routines = [routine({
    id: 's2', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑',
    briefing_model: 'claude-sonnet-5', briefing_effort: 'low',
  })];
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => routines,
    fetchRuns: async () => [
      { ts: '2026-08-26T07:30:00+09:00', verdict: 'fired', briefing_destination: 'chat' },
      { ts: '2026-08-27T07:30:00+09:00', verdict: 'fired', briefing_destination: 'canvas' },
    ],
  });
  canvas.mount();
  await canvas.refresh();
  await new Promise((r) => setTimeout(r, 0)); // '실행 위치' 비동기 1회 조회 완료 대기
  const fieldsWrap = findByClass(container, 'agent-detail-fields')[0];
  const fields = new Map(findByClass(fieldsWrap, 'agent-detail-field').map((f) => [
    findByClass(f, 'agent-detail-field-label')[0].textContent,
    findByClass(f, 'agent-detail-field-value')[0].textContent,
  ]));
  assert.equal(fields.get('브리핑 모델'), 'claude-sonnet-5 · low');
  assert.equal(fields.get('실행 위치'), '캔버스'); // 최신(8/27) 보고의 destination 우선
});

test('"실행 위치"는 refresh()마다 재조회된다 — 같은 항목을 계속 봐도 낡은 값이 남지 않는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 's3', status: 'active', mode: 'scheduled', note: '아침 브리핑' })];
  let runsNow = []; // 처음엔 브리핑 이력 없음
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => routines,
    fetchRuns: async () => runsNow,
  });
  canvas.mount();
  await canvas.refresh();
  await new Promise((r) => setTimeout(r, 0));
  let labels = findByClass(container, 'agent-detail-field-label').map((n) => n.textContent);
  assert.equal(labels.includes('실행 위치'), false, '이력 없음 — 행 미렌더');

  runsNow = [{ ts: '2026-08-27T07:30:00+09:00', verdict: 'fired', briefing_destination: 'chat' }];
  await canvas.refresh(); // 캐시 무효화 → 다음 renderDetail이 1회 재조회
  await new Promise((r) => setTimeout(r, 0));
  labels = findByClass(container, 'agent-detail-field-label').map((n) => n.textContent);
  assert.equal(labels.includes('실행 위치'), true, '새 브리핑 보고가 refresh로 반영된다');
});

// ── 6.5단계: 상세 패널 일시중지·재개 버튼 → pause/resume API 배선 ──

test('감시(watch) active 항목은 "❚❚ 일시중지" 버튼이 활성화돼 있고 클릭 시 pauseRoutine을 부른다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  let pausedId = null;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    pauseRoutine: async (id) => { pausedId = id; routines[0].status = 'paused'; },
  });
  canvas.mount();
  await canvas.refresh();
  const pauseBtn = findByClass(container, 'agent-pause-btn')[0];
  assert.equal(pauseBtn.textContent, '❚❚ 일시중지');
  assert.equal(pauseBtn.disabled, false);
  await pauseBtn.dispatchEvent({ type: 'click' });
  assert.equal(pausedId, 'a');
});

test('감시(watch) paused 항목은 "▶ 재개" 버튼이 활성화돼 있고 클릭 시 resumeRoutine을 부른다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'paused' })];
  let resumedId = null;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    resumeRoutine: async (id) => { resumedId = id; routines[0].status = 'active'; },
  });
  canvas.mount();
  await canvas.refresh();
  const pauseBtn = findByClass(container, 'agent-pause-btn')[0];
  assert.equal(pauseBtn.textContent, '▶ 재개');
  assert.equal(pauseBtn.disabled, false);
  await pauseBtn.dispatchEvent({ type: 'click' });
  assert.equal(resumedId, 'a');
});

test('예약(schedule) 항목은 일시중지 버튼이 항상 비활성이다(F1 최소선 스코프 밖 — 3단계)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 's1', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const pauseBtn = findByClass(container, 'agent-pause-btn')[0];
  assert.equal(pauseBtn.disabled, true);
});

test('pauseRoutine 호출 후 상세 패널이 refresh()로 실제 상태를 다시 받아 재개 버튼으로 바뀐다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    pauseRoutine: async () => { routines[0].status = 'paused'; },
  });
  canvas.mount();
  await canvas.refresh();
  const pauseBtn = findByClass(container, 'agent-pause-btn')[0];
  await pauseBtn.dispatchEvent({ type: 'click' });
  const afterBtn = findByClass(container, 'agent-pause-btn')[0];
  assert.equal(afterBtn.textContent, '▶ 재개');
  const badge = findByClass(container, 'agent-status-badge')[0];
  assert.equal(badge.textContent, '일시중지');
});

test('최근 실행 로그는 fixture로 표시된다(ledger 라이브 연결은 10단계 몫)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const logsWrap = findByClass(container, 'agent-detail-logs')[0];
  assert.equal(logsWrap.getAttribute('data-source'), 'fixture');
  assert.equal(findByClass(logsWrap, 'agent-detail-log').length, 3);
});

// ── F-fix1(본편 이월 갭, Paper 39번 실측 AAG-0): "채팅에서 열기 ↗" ──

test('watch 상세: "루틴 발화 — 묻지 않은 턴입니다" + "채팅에서 열기 ↗" 버튼이 뜬다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const caption = findByClass(container, 'agent-detail-open-chat-caption')[0];
  assert.equal(caption.textContent, '루틴 발화 — 묻지 않은 턴입니다');
  const btn = findByClass(container, 'agent-detail-open-chat-btn')[0];
  assert.equal(btn.textContent, '채팅에서 열기 ↗');
});

test('schedule 상세에도 "채팅에서 열기 ↗"가 뜬다(watch 전용이 아니다 — 예약도 능동 턴을 만든다)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 's1', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-detail-open-chat-btn').length, 1);
});

test('draft 상세에는 "채팅에서 열기 ↗"가 없다(draft는 발화한 적이 없다, 최근 실행 섹션과 같은 가드)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'draft' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-detail-open-chat-btn').length, 0);
});

test('"채팅에서 열기 ↗" 클릭은 onOpenInChat을 그 항목의 id로 부른다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'routine-xyz', status: 'active' })];
  let calledWith = null;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    onOpenInChat: (id) => { calledWith = id; },
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-detail-open-chat-btn')[0].dispatchEvent({ type: 'click' });
  assert.equal(calledWith, 'routine-xyz');
});

test('사용자가 고른 행이 필터로 사라지면 상세 패널이 남은 첫 항목으로 넘어간다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active', note: '라이브 활성' }),
    routine({ id: 'b', status: 'paused', note: '라이브 일시중지' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.selectRow('a'); // 사용자가 직접 고른다 — 이후로는 자동 추적을 멈춘다
  assert.equal(findByClass(container, 'agent-detail-title')[0].textContent, '라이브 활성');
  canvas.setActiveTab('paused'); // 'a'는 필터에서 빠진다 — 선택은 남은 첫 항목으로 옮겨가야 한다
  const title = findByClass(container, 'agent-detail-title')[0];
  assert.notEqual(title.textContent, '라이브 활성');
});

test('사용자가 선택하기 전까지는 새로고침 때마다 항상 "지금 첫 항목"을 따라간다', async () => {
  const container = fakeNode('div');
  let routines = [];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  // mount() 시점엔 라이브 데이터가 아직 없다 — 3단계부터는 예약도 fixture
  // 폴백이 없어 정직하게 빈 상태다(P3).
  assert.equal(findByClass(container, 'agent-detail-empty')[0].textContent, '선택된 항목이 없습니다');
  // 라이브 라우틴이 뒤늦게 도착한다 — 아직 아무도 안 골랐으니 선택이 그쪽으로 옮겨가야 한다
  // (실측 버그: 이전엔 mount() 때 고정된 fixture 선택이 refresh() 후에도 안 바뀌었다).
  routines = [routine({ id: 'a', status: 'active', note: '뒤늦게 도착한 라이브 행' })];
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-detail-title')[0].textContent, '뒤늦게 도착한 라이브 행');
});

test('CTA 클릭은 onNewTaskClick을 부른다(43번 원칙 — 시트를 열지 않는다)', () => {
  const container = fakeNode('div');
  let called = 0;
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [], onNewTaskClick: () => { called += 1; } });
  canvas.mount();
  findByClass(container, 'agent-cta')[0].dispatchEvent({ type: 'click' });
  assert.equal(called, 1);
});

test('fetchRoutines가 실패하면 정직하게 빈 목록이다(3단계부터 예약 fixture 폴백이 없다, P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => { throw new Error('backend down'); } });
  canvas.mount();
  await assert.doesNotReject(() => canvas.refresh());
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 0, '라이브 백엔드가 죽으면 지어낸 데이터로 채우지 않는다');
});

test('stale-응답 가드: 먼저 보낸 요청이 나중에 도착해도 최신 데이터를 덮지 않는다', async () => {
  const container = fakeNode('div');
  let call = 0;
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => {
      call += 1;
      if (call === 1) {
        // 첫 호출(느림) — 두 번째 호출이 이미 끝난 뒤에 돌아온다.
        await new Promise((r) => setTimeout(r, 30));
        return [routine({ id: 'stale', note: '낡은 응답' })];
      }
      return [routine({ id: 'fresh', note: '최신 응답' })];
    },
  });
  canvas.mount();
  const first = canvas.refresh(); // 낡은 요청 — 아직 안 끝남
  await canvas.refresh(); // 최신 요청 — 먼저 끝남
  await first; // 낡은 응답이 뒤늦게 도착
  const titles = findByClass(container, 'agent-row-title').map((n) => n.textContent);
  assert.ok(titles.includes('최신 응답'));
  assert.equal(titles.includes('낡은 응답'), false, '낡은 응답이 최신 데이터를 덮으면 안 된다');
});

test('container가 없으면 mount/refresh가 조용히 아무 것도 안 한다', async () => {
  const canvas = createAgentCanvas({});
  assert.doesNotThrow(() => canvas.mount());
  await assert.doesNotReject(() => canvas.refresh());
});

// ── 7단계: 제안 — 그래프 성향 기반(GET /api/v1/brain/profile-summary) ──

function profileEntry(overrides) {
  return {
    entity_id: 'e1', entity_kind: 'stock', entity_name: '삼성전자', relation_kind: '단기 회전',
    confidence: 'EXTRACTED', tier: 'deterministic', rationale: '매매일마다 정리가 필요해 보여요',
    observed_at: '2026-08-26T00:00:00Z', reinforcement: 21, ...overrides,
  };
}

test('fetchProfileSummary가 없으면 제안 섹션이 숨는다(빈 라벨을 노출하지 않는다, P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  const section = findByClass(container, 'agent-suggest-section')[0];
  assert.equal(section.hidden, true);
  assert.equal(findByClass(container, 'agent-suggest-row').length, 0);
});

test('제안 섹션: 신호가 있으면 보이고 제목·근거문이 실제 필드로만 채워진다(지어내지 않는다)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry()],
  });
  canvas.mount();
  await canvas.refresh();
  const section = findByClass(container, 'agent-suggest-section')[0];
  assert.equal(section.hidden, false);
  assert.equal(findByClass(container, 'agent-suggest-title')[0].textContent, '삼성전자');
  assert.equal(
    findByClass(container, 'agent-suggest-rationale')[0].textContent,
    '단기 회전 성향 21회 보강 — 매매일마다 정리가 필요해 보여요',
  );
});

test('rationale이 없으면(nullable) 근거문에서 그 부분만 빠진다 — 지어내지 않는다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry({ rationale: null })],
  });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-suggest-rationale')[0].textContent, '단기 회전 성향 21회 보강');
});

test('"추가" 클릭 시 onAddSuggestion이 실제 필드로 조합한 문장을 받는다(시트를 열지 않는다, 43 원칙)', async () => {
  const container = fakeNode('div');
  let seeded = null;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry()],
    onAddSuggestion: (text) => { seeded = text; },
  });
  canvas.mount();
  await canvas.refresh();
  const addBtn = findByClass(container, 'agent-suggest-add')[0];
  assert.equal(addBtn.textContent, '추가');
  addBtn.dispatchEvent({ type: 'click' });
  assert.equal(seeded, '"삼성전자"에 대한 단기 회전 성향이 21회 보강됐어요 — 관련 루틴을 만들어줄까요?');
});

test('fetchProfileSummary가 실패하면 제안 섹션이 숨는다(지어낸 제안을 보여주지 않는다, P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => { throw new Error('backend down'); },
  });
  canvas.mount();
  await assert.doesNotReject(() => canvas.refresh());
  const section = findByClass(container, 'agent-suggest-section')[0];
  assert.equal(section.hidden, true);
});

test('제안 stale-응답 가드: 먼저 보낸 요청이 나중에 도착해도 최신 데이터를 덮지 않는다', async () => {
  const container = fakeNode('div');
  let call = 0;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => {
      call += 1;
      if (call === 1) {
        await new Promise((r) => setTimeout(r, 30));
        return [profileEntry({ entity_name: '낡은 신호' })];
      }
      return [profileEntry({ entity_name: '최신 신호' })];
    },
  });
  canvas.mount();
  const first = canvas.refresh();
  await canvas.refresh();
  await first;
  const titles = findByClass(container, 'agent-suggest-title').map((n) => n.textContent);
  assert.ok(titles.includes('최신 신호'));
  assert.equal(titles.includes('낡은 신호'), false);
});

test('라우틴 refresh가 실패해도 제안 refresh는 독립적으로 성공한다(서로 무관한 왕복)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => { throw new Error('routines down'); },
    fetchProfileSummary: async () => [profileEntry()],
  });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-suggest-title')[0].textContent, '삼성전자');
});

// ── 8단계: 초안(draft) 행 — ◌ 점선 핑크, 상세 패널은 읽기 전용 ──

test('draft 행은 ◌ 아이콘·"초안 — 채팅에서 만드는 중" 부제·"지금" trailing을 갖는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'draft', note: '장 마감 후 손익 요약' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const row = findByClass(container, 'agent-row').find((r) => r.className.includes('is-draft'));
  assert.ok(row);
  assert.equal(findByClass(row, 'agent-row-dot')[0].textContent, '◌');
  assert.equal(findByClass(row, 'agent-row-title')[0].textContent, '장 마감 후 손익 요약');
  assert.equal(findByClass(row, 'agent-row-sub')[0].textContent, '초안 — 채팅에서 만드는 중');
  assert.equal(findByClass(row, 'agent-row-trailing')[0].textContent, '지금');
});

test('draft 상세: 상태 배지가 "초안"이고, 일시중지 버튼도 "최근 실행" 섹션도 없다(읽기 전용, 동선 규칙③)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'draft', note: '장 마감 후 손익 요약' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-status-badge')[0].textContent, '초안');
  assert.equal(findByClass(container, 'agent-detail-title')[0].textContent, '장 마감 후 손익 요약');
  assert.equal(findByClass(container, 'agent-pause-btn').length, 0, 'draft에는 일시중지 버튼이 없다');
  assert.equal(findByClass(container, 'agent-detail-logs').length, 0, 'draft는 실행 이력이 없다 — 섹션 자체를 생략한다');
});

test('탭 "일시중지"·"활성"에는 draft가 나타나지 않는다(draft는 두 상태 어느 쪽도 아니다)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'draft' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.setActiveTab('paused');
  assert.equal(findByClass(container, 'agent-row').filter((r) => r.className.includes('is-draft')).length, 0);
  canvas.setActiveTab('active');
  assert.equal(findByClass(container, 'agent-row').filter((r) => r.className.includes('is-draft')).length, 0);
});

// ── 9단계: 뷰 탭 3종(작업/알람/라이브) + 알람 센터·라이브 관제 ──

function alert1(overrides) {
  return { id: 'al1', title: '삼성전자 88,000 감시', sub: '005930 · 관측 88100', firedAt: Date.parse('2026-08-27T09:15:00Z'), read: false, ...overrides };
}

test('mount(): 뷰 탭 4종(작업/알람/라이브/제안)이 있고 "작업"이 기본 활성이다(11단계에서 제안 추가)', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  const tabs = findByClass(container, 'agent-view-tab');
  assert.deepEqual(tabs.map((n) => n.textContent), ['작업', '알람', '라이브', '제안']);
  assert.ok(tabs[0].className.includes('is-active'));
});

test('mount(): "작업" 뷰에서는 통계·리스트가 보이고 알람·라이브 컬럼은 숨는다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  assert.equal(findByClass(container, 'agent-stats')[0].hidden, false);
  assert.equal(findByClass(container, 'agent-alarm-live')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-mark-all-read')[0].hidden, true);
});

test('setActiveView("alerts"): 통계·리스트·검색·CTA가 숨고 알람·라이브 컬럼과 "모두 읽음으로"가 보인다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [], fetchAlerts: () => [] });
  canvas.mount();
  canvas.setActiveView('alerts');
  assert.equal(findByClass(container, 'agent-stats')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-tasks-head')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-alarm-live')[0].hidden, false);
  assert.equal(findByClass(container, 'agent-mark-all-read')[0].hidden, false);
  const tabs = findByClass(container, 'agent-view-tab');
  assert.ok(tabs.find((n) => n.textContent.startsWith('알람')).className.includes('is-active'));
});

test('알람 행: 실제 fetchAlerts() 필드(title·sub·firedAt)만 쓴다 — 미확인은 is-unread', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchAlerts: () => [alert1(), alert1({ id: 'al2', title: '읽은 알람', read: true })],
  });
  canvas.mount();
  canvas.setActiveView('alerts');
  const rows = findByClass(container, 'agent-alarm-row');
  assert.equal(rows.length, 2);
  assert.ok(rows[0].className.includes('is-unread'));
  assert.equal(rows[1].className.includes('is-unread'), false, '읽은 알람은 is-unread가 없다');
  assert.equal(findByClass(rows[0], 'agent-alarm-title')[0].textContent, '삼성전자 88,000 감시');
  assert.equal(findByClass(rows[0], 'agent-alarm-sub')[0].textContent, '005930 · 관측 88100');
  assert.equal(findByClass(rows[0], 'agent-alarm-icon')[0].textContent, '◆');
});

test('알람 탭 라벨: 미확인 개수가 있으면 "알람 N", 없으면 "알람"', () => {
  const container = fakeNode('div');
  let alerts = [alert1(), alert1({ id: 'al2', read: false })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [], fetchAlerts: () => alerts });
  canvas.mount();
  const alertsTab = () => findByClass(container, 'agent-view-tab').find((n) => n.textContent.startsWith('알람'));
  assert.equal(alertsTab().textContent, '알람 2');
  alerts = [];
  canvas.refresh();
  assert.equal(alertsTab().textContent, '알람');
});

test('알람이 하나도 없으면 "받은 알람이 없습니다"가 뜬다(fixture로 채우지 않는다, P3)', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [], fetchAlerts: () => [] });
  canvas.mount();
  canvas.setActiveView('alerts');
  const alarmCol = findByClass(container, 'agent-alarm-col')[0];
  const empty = findByClass(alarmCol, 'agent-list-empty');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].textContent, '받은 알람이 없습니다');
});

test('"모두 읽음으로" 클릭 시 markAllAlertsRead가 불리고 알람 컬럼이 다시 그려진다', () => {
  const container = fakeNode('div');
  let markCalled = 0;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchAlerts: () => [alert1()],
    markAllAlertsRead: () => { markCalled += 1; },
  });
  canvas.mount();
  canvas.setActiveView('alerts');
  findByClass(container, 'agent-mark-all-read')[0].dispatchEvent({ type: 'click' });
  assert.equal(markCalled, 1);
});

test('라이브 컬럼: 진행바 2건 + "다음 24시간" 타임라인 4건이 fixture로 뜬다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  const liveCol = findByClass(container, 'agent-live-col')[0];
  assert.equal(liveCol.getAttribute('data-source'), 'fixture');
  assert.equal(findByClass(liveCol, 'agent-live-progress-row').length, 2);
  assert.equal(findByClass(liveCol, 'agent-live-timeline-row').length, 4);
});

test('"WS 연결됨" — getWsConnected()가 실데이터다, false면 정직하게 "연결 안 됨"', () => {
  const container = fakeNode('div');
  let connected = false;
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [], getWsConnected: () => connected });
  canvas.mount();
  assert.equal(findByClass(container, 'agent-live-ws-label')[0].textContent, 'WS 연결 안 됨');
  connected = true;
  canvas.updateWsStatus();
  assert.equal(findByClass(container, 'agent-live-ws-label')[0].textContent, 'WS 연결됨');
});

// ── 10단계: 실행 이력·결과 드릴인(GET /api/v1/routines/{id}/runs) ──

function run(overrides) {
  return { ts: '2026-08-26T07:30:00Z', routine_id: 'a', symbol: '005930', source: 'price.change_rate', verdict: 'fired', observed: 88100, threshold: 88000, reason: '조건 도달', ...overrides };
}

test('감시(watch) 상세에만 "전체 이력 보기 →"가 있다 — draft·예약(schedule)에는 없다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active' }),
    routine({ id: 'b', status: 'draft' }),
    routine({ id: 's1', status: 'active', mode: 'scheduled', note: '평일 아침 브리핑' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.selectRow('a');
  assert.equal(findByClass(container, 'agent-history-open').length, 1, 'watch에는 있다');
  canvas.selectRow('b');
  assert.equal(findByClass(container, 'agent-history-open').length, 0, 'draft에는 없다');
  canvas.selectRow('s1');
  assert.equal(findByClass(container, 'agent-history-open').length, 0, '예약(schedule)에는 없다 — F1 최소선 스코프 밖');
});

test('"전체 이력 보기 →" 클릭 시 브레드크럼("작업 › 이름"+배지)이 뜨고 작업 화면이 숨는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active', note: '삼성전자 88,000 감시' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    fetchRuns: async () => [],
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(findByClass(container, 'agent-breadcrumb')[0].hidden, false);
  assert.equal(findByClass(container, 'agent-breadcrumb-title')[0].textContent, '삼성전자 88,000 감시');
  assert.equal(findByClass(container, 'agent-breadcrumb-badge')[0].textContent, '활성');
  assert.equal(findByClass(container, 'agent-tasks-head')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-stats')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-view-tabs')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-history-body')[0].hidden, false);
});

test('최근 30회는 fetchRuns(id) 실데이터 — 최신 먼저, ledger 실제 verdict 3종만 아이콘화한다(AC10)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  let calledWithId = null;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    fetchRuns: async (id) => {
      calledWithId = id;
      return [
        run({ ts: '2026-08-25T07:30:00Z', verdict: 'near', reason: '근접 — 임계 미달' }),
        run({ ts: '2026-08-26T07:30:00Z', verdict: 'fired', reason: '조건 도달' }),
        run({ ts: '2026-08-24T07:30:00Z', verdict: 'suppressed', reason: '쿨다운 중' }),
      ];
    },
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calledWithId, 'a');
  const rows = findByClass(container, 'agent-history-run');
  assert.equal(rows.length, 3);
  const reasons = rows.map((r2) => findByClass(r2, 'agent-history-run-reason')[0].textContent);
  assert.deepEqual(reasons, ['조건 도달', '근접 — 임계 미달', '쿨다운 중'], '최신(8/26) 먼저 정렬된다');
  const marks = rows.map((r2) => findByClass(r2, 'agent-history-run-mark')[0].textContent);
  assert.deepEqual(marks, ['●', '◐', '○'], 'fired=●·near=◐·suppressed=○ — 3종 실 verdict만');
});

test('실행 이력이 없으면 "실행 이력이 없습니다"가 뜬다(지어내지 않는다, P3)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines, fetchRuns: async () => [] });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const empty = findByClass(findByClass(container, 'agent-history-runs-col')[0], 'agent-list-empty');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].textContent, '실행 이력이 없습니다');
});

test('30회 통계 3타일(평균·발화→열람·이어진 대화)은 전부 live다(F-stage5b-FE, R2에서 지표 정의 미확정 타일 제거)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines, fetchRuns: async () => [],
    fetchAvgDuration: async () => null, fetchEngagement: async () => null,
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const statsCol = findByClass(container, 'agent-history-stats-col')[0];
  const tiles = findByClass(statsCol, 'agent-history-stat-tile');
  assert.equal(tiles.length, 3);
  const bySource = (src) => tiles.filter((t) => t.getAttribute('data-source') === src);
  assert.equal(bySource('fixture').length, 0);
  assert.equal(bySource('live').length, 3);
});

test('"발화→열람"·"이어진 대화" 타일: fetchEngagement가 없거나 실패하면 지어낸 숫자 없이 "—"를 보여준다(P3)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines, fetchRuns: async () => [] });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const statsCol = findByClass(container, 'agent-history-stats-col')[0];
  const tileValue = (label) => {
    const t = findByClass(statsCol, 'agent-history-stat-tile').find(
      (n) => findByClass(n, 'agent-history-stat-label')[0].textContent === label,
    );
    return findByClass(t, 'agent-history-stat-value')[0].textContent;
  };
  assert.equal(tileValue('발화→열람'), '—');
  assert.equal(tileValue('이어진 대화'), '—');
});

test('"발화→열람"·"이어진 대화" 타일: opened_rate/replied_count(F-stage5b-BE)를 라이브로 표시한다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines, fetchRuns: async () => [],
    fetchEngagement: async () => ({ openedRate: 0.71, repliedCount: 9 }),
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const statsCol = findByClass(container, 'agent-history-stats-col')[0];
  const tileValue = (label) => {
    const t = findByClass(statsCol, 'agent-history-stat-tile').find(
      (n) => findByClass(n, 'agent-history-stat-label')[0].textContent === label,
    );
    return findByClass(t, 'agent-history-stat-value')[0].textContent;
  };
  assert.equal(tileValue('발화→열람'), '71%');
  assert.equal(tileValue('이어진 대화'), '9건');
});

test('"평균" 타일: fetchAvgDuration이 없거나 실패하면 지어낸 숫자 없이 "—"를 보여준다(P3)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines, fetchRuns: async () => [] });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const statsCol = findByClass(container, 'agent-history-stats-col')[0];
  const avgTile = findByClass(statsCol, 'agent-history-stat-tile').find(
    (t) => findByClass(t, 'agent-history-stat-label')[0].textContent === '평균',
  );
  assert.equal(findByClass(avgTile, 'agent-history-stat-value')[0].textContent, '—');
});

test('"평균" 타일: avg_duration_ms(4단계, ms)를 초 단위 문자열로 라이브 표시한다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines, fetchRuns: async () => [], fetchAvgDuration: async () => 7420,
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const statsCol = findByClass(container, 'agent-history-stats-col')[0];
  const avgTile = findByClass(statsCol, 'agent-history-stat-tile').find(
    (t) => findByClass(t, 'agent-history-stat-label')[0].textContent === '평균',
  );
  assert.equal(findByClass(avgTile, 'agent-history-stat-value')[0].textContent, '7.4s');
});

// [6단계 의도적 반전] 이전 테스트는 "'오늘 07:30 산출물' 카드가 fixture로 표시된다"
// 였다 — 3단계 briefings 스토어의 실데이터(GET /{id}/runs 병합 필드)로 승격되면서
// fixture 케이스가 사라졌고, 아래 3분기(있음/없음/truncated)가 그 자리를 대체한다.
test('"오늘 산출물" 카드 — 오늘 발화된 브리핑 본문이 있으면 실데이터로 렌더된다(6단계, fixture 제거)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const todayTs = new Date(new Date().setHours(7, 30, 0, 0)).toISOString();
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => routines,
    fetchRuns: async () => [{
      ts: todayTs, verdict: 'fired', reason: '예약 시각 도달(07:30)',
      briefing_title: '아침 브리핑', briefing_content: '오늘의 요약 본문',
      truncated: false, briefing_destination: 'canvas',
    }],
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const card = findByClass(container, 'agent-history-output-card')[0];
  assert.equal(card.hidden, false);
  assert.equal(card.getAttribute('data-source'), 'live'); // fixture 표기는 6단계에서 제거됐다
  assert.equal(findByClass(card, 'agent-history-output-title')[0].textContent, '아침 브리핑');
  assert.equal(findByClass(card, 'agent-history-output-tag')[0].textContent, '캔버스 카드');
  // 자유형식 본문은 title+단일 본문 블록이다 — 지어낸 items 반복 구조가 아니다(P3).
  assert.deepEqual(
    findByClass(card, 'agent-history-output-item-text').map((n) => n.textContent),
    ['오늘의 요약 본문'],
  );
  assert.equal(findByClass(card, 'agent-history-output-item-sub').length, 0); // 안 잘림 — 절단 표기 없음
  const btns = findByClass(card, 'agent-history-output-btn');
  assert.deepEqual(btns.map((n) => n.textContent), ['캔버스에서 열기', '채팅으로']);
  for (const btn of btns) assert.equal(btn.disabled, true, '재기동 후 원 위치 복원 불가 — 계속 비활성(P3)');
});

test('"오늘 산출물" 카드 — 오늘 발화 브리핑이 없으면(어제 것뿐이어도) 카드 자체를 렌더하지 않는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const yesterdayTs = new Date(Date.now() - 86400000).toISOString();
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => routines,
    fetchRuns: async () => [{
      ts: yesterdayTs, verdict: 'fired', reason: '예약 시각 도달(07:30)',
      briefing_title: '어제 브리핑', briefing_content: '어제 본문', truncated: false,
    }],
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(findByClass(container, 'agent-history-output-card')[0].hidden, true);
  const captions = findByClass(container, 'agent-panel-caption')
    .filter((n) => /산출물/.test(n.textContent));
  for (const c of captions) assert.equal(c.hidden, true, '캡션도 함께 숨긴다');
});

test('"오늘 산출물" 카드 — truncated면 절단 사실을 명시한다(잘렸다는 사실을 숨기지 않는다, P3)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const todayTs = new Date(new Date().setHours(7, 30, 0, 0)).toISOString();
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => routines,
    fetchRuns: async () => [{
      ts: todayTs, verdict: 'fired', reason: '예약 시각 도달(07:30)',
      briefing_title: '긴 브리핑', briefing_content: '가'.repeat(4000),
      truncated: true, briefing_destination: 'chat',
    }],
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  const card = findByClass(container, 'agent-history-output-card')[0];
  assert.equal(card.hidden, false);
  assert.equal(findByClass(card, 'agent-history-output-tag')[0].textContent, '채팅 답변');
  assert.deepEqual(
    findByClass(card, 'agent-history-output-item-sub').map((n) => n.textContent),
    ['…(이하 생략 — 저장 상한 4,000자에서 잘렸습니다)'],
  );
});

test('"작업 ›" 클릭 시 드릴인이 닫히고 "작업" 화면이 복원된다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines, fetchRuns: async () => [] });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  findByClass(container, 'agent-breadcrumb-back')[0].dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'agent-breadcrumb')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-history-body')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-tasks-head')[0].hidden, false);
  assert.equal(findByClass(container, 'agent-stats')[0].hidden, false);
});

test('"작업 ›" 클릭 후에는 "작업" 탭이 다시 활성으로 표시된다(실측 버그 수정 — 이전엔 복귀 후 아무 탭도 활성이 아니었다)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines, fetchRuns: async () => [] });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
  findByClass(container, 'agent-breadcrumb-back')[0].dispatchEvent({ type: 'click' });
  const tasksTab = findByClass(container, 'agent-view-tab').find((n) => n.textContent === '작업');
  assert.ok(tasksTab.className.includes('is-active'));
});

// ── 11단계: 프로액티브(지금 읽히는 성향 · 제안 카드 · 말걸기 가드) ──

test('setActiveView("proactive"): 작업 화면이 숨고 프로액티브 화면 + "그래프 모드에서 근거 보기 →"가 보인다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  canvas.setActiveView('proactive');
  assert.equal(findByClass(container, 'agent-tasks-head')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-stats')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-proactive-body')[0].hidden, false);
  assert.equal(findByClass(container, 'agent-graph-link')[0].hidden, false);
});

test('"그래프 모드에서 근거 보기 →" 클릭 시 onOpenGraph가 불린다(사이드바 모드 네비 재사용)', () => {
  const container = fakeNode('div');
  let called = 0;
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [], onOpenGraph: () => { called += 1; } });
  canvas.mount();
  canvas.setActiveView('proactive');
  findByClass(container, 'agent-graph-link')[0].dispatchEvent({ type: 'click' });
  assert.equal(called, 1);
});

test('"지금 읽히는 성향" 스트립은 suggestionsCache(7단계와 같은 원천)의 relation_kind를 합친다 — 지어내지 않는다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [
      profileEntry({ entity_id: 'e1', relation_kind: '단기 회전' }),
      profileEntry({ entity_id: 'e2', relation_kind: '배당 방어' }),
    ],
  });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-proactive-strip-value')[0].textContent, '단기 회전 · 배당 방어');
  // 우측 메타는 Paper 보드 04 문법("신호 312 · 12분 전")이다 — 신선도는 실제
  // observed_at에서 나오므로 벽시계에 따라 달라진다, 접두사만 고정으로 본다.
  assert.match(findByClass(container, 'agent-proactive-strip-sub')[0].textContent, /^신호 2 · /);
});

test('스트립 우측 메타: 가장 최근 observed_at으로 신선도를 낸다(분 단위)', async () => {
  const container = fakeNode('div');
  const recent = new Date(Date.now() - 12 * 60000).toISOString();
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [
      profileEntry({ entity_id: 'e1', observed_at: '2026-01-01T00:00:00Z' }),
      profileEntry({ entity_id: 'e2', observed_at: recent }), // 가장 최근 = 이 값이 이긴다
    ],
  });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-proactive-strip-sub')[0].textContent, '신호 2 · 12분 전');
});

test('스트립 우측 메타: observed_at이 없으면 신선도를 지어내지 않고 신호 수만 남긴다(P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry({ entity_id: 'e1', observed_at: null })],
  });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-proactive-strip-sub')[0].textContent, '신호 1');
});

test('신호가 없으면 스트립이 정직하게 "아직 읽히는 성향이 없습니다"를 보여준다(P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  assert.equal(findByClass(container, 'agent-proactive-strip-value')[0].textContent, '아직 읽히는 성향이 없습니다');
});

test('제안 카드: 칩 "루틴으로"/"보류"가 있고, "루틴으로"는 7단계와 같은 문장을 채팅에 심는다', async () => {
  const container = fakeNode('div');
  let seeded = null;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry()],
    onAddSuggestion: (text) => { seeded = text; },
  });
  canvas.mount();
  await canvas.refresh();
  const cards = findByClass(container, 'agent-proactive-card');
  assert.equal(cards.length, 1);
  assert.equal(findByClass(cards[0], 'agent-proactive-card-title')[0].textContent, '삼성전자');
  const chips = findByClass(cards[0], 'agent-proactive-chip').map((n) => n.textContent);
  assert.deepEqual(chips, ['루틴으로', '보류']);
  findByClass(cards[0], 'agent-proactive-chip')[0].dispatchEvent({ type: 'click' });
  assert.equal(seeded, '"삼성전자"에 대한 단기 회전 성향이 21회 보강됐어요 — 관련 루틴을 만들어줄까요?');
});

test('"보류" 클릭 시 그 카드는 이번 세션에서만 숨는다(저장 안 됨, P3) — 탭 배지도 줄어든다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry({ entity_id: 'e1' }), profileEntry({ entity_id: 'e2', entity_name: '배당주' })],
  });
  canvas.mount();
  await canvas.refresh();
  const proactiveTab = () => findByClass(container, 'agent-view-tab').find((n) => n.textContent.startsWith('제안'));
  assert.equal(proactiveTab().textContent, '제안 2');
  const firstCard = findByClass(container, 'agent-proactive-card')[0];
  findByClass(firstCard, 'agent-proactive-chip')[1].dispatchEvent({ type: 'click' }); // "보류"
  assert.equal(findByClass(container, 'agent-proactive-card').length, 1);
  assert.equal(proactiveTab().textContent, '제안 1');
});

test('모든 제안을 보류하면 "지금은 표시할 제안이 없습니다"가 뜬다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry()],
  });
  canvas.mount();
  await canvas.refresh();
  findByClass(container, 'agent-proactive-chip')[1].dispatchEvent({ type: 'click' }); // "보류"
  const empty = findByClass(findByClass(container, 'agent-proactive-cards')[0], 'agent-list-empty');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].textContent, '지금은 표시할 제안이 없습니다');
});

test('말걸기 가드: 라이브 데이터 도착 전엔 "불러오는 중"으로 정직하게 보인다(F-stage9, P3)', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  const guard = findByClass(container, 'agent-nudge-guard')[0];
  assert.equal(guard.getAttribute('data-source'), 'live');
  assert.equal(findByClass(guard, 'agent-nudge-guard-tag').length, 0);
  assert.equal(findByClass(guard, 'agent-list-empty')[0].textContent, '가드 설정을 불러오는 중입니다');
});

test('말걸기 가드: GET /api/v1/nudge-guard 라이브 값으로 태그 4개 + 안내 문구를 채운다(F-stage9, 8단계 백엔드 연결)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchNudgeGuard: async () => ({
      max_daily_nudges: 2, quiet_hours: { start: '22:00', end: '07:00' },
      show_rationale: true, learn_from_dismissals: true,
    }),
  });
  canvas.mount();
  await canvas.refresh();
  const guard = findByClass(container, 'agent-nudge-guard')[0];
  assert.equal(guard.getAttribute('data-source'), 'live');
  assert.deepEqual(
    findByClass(guard, 'agent-nudge-guard-tag').map((n) => n.textContent),
    ['하루 최대 2회', '조용 시간 22:00–07:00', '근거 표시 항상', '거절 반영 성향으로 학습'],
  );
  assert.equal(findByClass(guard, 'agent-nudge-guard-note').length, 1);
});

test('말걸기 가드: 값이 꺼져 있으면 "끔" 문구로 정확히 반영한다(지어내지 않는다)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchNudgeGuard: async () => ({
      max_daily_nudges: 0, quiet_hours: { start: '00:00', end: '00:00' },
      show_rationale: false, learn_from_dismissals: false,
    }),
  });
  canvas.mount();
  await canvas.refresh();
  const guard = findByClass(container, 'agent-nudge-guard')[0];
  assert.deepEqual(
    findByClass(guard, 'agent-nudge-guard-tag').map((n) => n.textContent),
    ['하루 최대 0회', '조용 시간 00:00–00:00', '근거 표시 끔', '거절 학습 끔'],
  );
});

test('말걸기 가드: fetchNudgeGuard가 실패해도 지어낸 값으로 채우지 않는다(P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchNudgeGuard: async () => { throw new Error('backend down'); },
  });
  canvas.mount();
  await assert.doesNotReject(() => canvas.refresh());
  const guard = findByClass(container, 'agent-nudge-guard')[0];
  assert.equal(findByClass(guard, 'agent-nudge-guard-tag').length, 0);
  assert.equal(findByClass(guard, 'agent-list-empty')[0].textContent, '가드 설정을 불러오는 중입니다');
});

// ---------- 동선 규칙(Paper 에이전트 보드 05 하단) ----------

test('동선 규칙: 작업 뷰에 Paper 원문 3줄이 그대로 렌더된다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();

  const panel = findByClass(container, 'agent-route-rules')[0];
  assert.ok(panel, '동선 규칙 패널이 있어야 한다');
  assert.equal(findByClass(panel, 'agent-panel-caption')[0].textContent, '동선 규칙');
  assert.deepEqual(findByClass(panel, 'agent-route-rule').map((n) => n.textContent), [
    '① ＋ 새 작업 버튼은 시트를 열지 않는다 — 채팅 입력창에 시작 문장을 넣고 커서를 옮긴다.',
    '② 편집도 채팅으로 — 행을 고르고 "이거 고쳐줘". 상세 패널은 보기 전용.',
    '③ 확정(미리보기·활성화)은 채팅 카드의 칩 — 캔버스는 결과가 비치는 곳.',
  ]);
});

test('동선 규칙: 화면 자신의 계약이라 data-source 표기를 달지 않는다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();

  assert.equal(findByClass(container, 'agent-route-rules')[0].getAttribute('data-source'), null);
});

test('동선 규칙: 알람·라이브·제안 뷰로 가면 작업 뷰와 함께 숨는다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();

  const body = findByClass(container, 'agent-body')[0];
  assert.equal(body.hidden, false);
  for (const view of ['alerts', 'live', 'proactive']) {
    canvas.setActiveView(view);
    assert.equal(body.hidden, true, `${view} 뷰에서는 동선 규칙이 든 작업 본문이 숨어야 한다`);
    canvas.setActiveView('tasks');
    assert.equal(body.hidden, false);
  }
});

// ---------- 드릴인 실행 목록 — 날짜 그룹 · 접기(Paper 보드 03) ----------

// ts를 오늘 기준 상대 일수로 만든다 — 그룹 머리("오늘 — M/D 요일")가 벽시계에
// 의존하므로 고정 날짜를 쓰면 테스트가 달력에 따라 깨진다.
function daysAgoIso(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 30, 0, 0);
  return d.toISOString();
}

function stampOf(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getMonth() + 1}/${d.getDate()} ${['일', '월', '화', '수', '목', '금', '토'][d.getDay()]}`;
}

async function openDrillIn(container, canvas) {
  findByClass(container, 'agent-history-open')[0].dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 0));
}

test('실행 목록: 오늘·어제·그 이전을 날짜 그룹 머리로 끊는다(Paper 보드 03)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    fetchRuns: async () => [
      run({ ts: daysAgoIso(0, 7), verdict: 'fired', reason: '오늘 실행' }),
      run({ ts: daysAgoIso(1, 7), verdict: 'fired', reason: '어제 실행' }),
      run({ ts: daysAgoIso(4, 7), verdict: 'fired', reason: '나흘 전 실행' }),
    ],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);

  assert.deepEqual(
    findByClass(container, 'agent-history-run-group').map((n) => n.textContent),
    [`오늘 — ${stampOf(0)}`, `어제 — ${stampOf(1)}`, stampOf(4)],
  );
});

test('실행 목록: 같은 날 실행 2건은 그룹 머리를 한 번만 만든다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    fetchRuns: async () => [
      run({ ts: daysAgoIso(0, 7), verdict: 'fired', reason: '아침' }),
      run({ ts: daysAgoIso(0, 15), verdict: 'near', reason: '오후' }),
    ],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);

  assert.equal(findByClass(container, 'agent-history-run-group').length, 1);
  assert.equal(findByClass(container, 'agent-history-run').length, 2);
});

test('실행 목록: 행 시각은 날짜 없이 HH:MM만 남는다(날짜는 그룹 머리 몫)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    fetchRuns: async () => [run({ ts: daysAgoIso(0, 7), verdict: 'fired', reason: '조건 도달' })],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);

  assert.match(findByClass(container, 'agent-history-run-time')[0].textContent, /^\d{2}:\d{2}$/);
});

test('실행 목록: 6건까지만 펼쳐 두고 나머지는 "지난 실행 N건 더" 뒤에 둔다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const rows = Array.from({ length: 10 }, (_, i) =>
    run({ ts: daysAgoIso(i, 7), verdict: 'fired', reason: `실행 ${i}` }));
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines, fetchRuns: async () => rows,
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);

  assert.equal(findByClass(container, 'agent-history-run').length, 6);
  const more = findByClass(container, 'agent-list-more')[0];
  assert.equal(more.textContent, '지난 실행 4건 더');

  more.dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'agent-history-run').length, 10);
  assert.equal(findByClass(container, 'agent-list-more').length, 0, '다 펼치면 푸터가 사라진다');
});

test('실행 목록: 6건 이하면 더보기 푸터를 만들지 않는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => routines,
    fetchRuns: async () => [run({ ts: daysAgoIso(0, 7), verdict: 'fired', reason: '한 건' })],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);

  assert.equal(findByClass(container, 'agent-list-more').length, 0);
});

// ---------- 알람 피드 접기(Paper 보드 02) ----------

test('알람 피드: 6건까지만 보이고 나머지는 "지난 알람 N건 더" 뒤에 둔다', () => {
  const container = fakeNode('div');
  const alerts = Array.from({ length: 9 }, (_, i) => ({
    id: `a${i}`, title: `알람 ${i}`, sub: '', firedAt: Date.now() - i * 60000, read: false,
  }));
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [], fetchAlerts: () => alerts,
  });
  canvas.mount();

  assert.equal(findByClass(container, 'agent-alarm-row').length, 6);
  const more = findByClass(container, 'agent-list-more')[0];
  assert.equal(more.textContent, '지난 알람 3건 더');

  more.dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'agent-alarm-row').length, 9);
  assert.equal(findByClass(container, 'agent-list-more').length, 0);
});

test('알람 피드: 접혀 있어도 탭 배지는 전체 미확인 수를 센다(가려진 건도 미확인이다)', () => {
  const container = fakeNode('div');
  const alerts = Array.from({ length: 9 }, (_, i) => ({
    id: `a${i}`, title: `알람 ${i}`, sub: '', firedAt: Date.now(), read: false,
  }));
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [], fetchAlerts: () => alerts,
  });
  canvas.mount();

  const alertsTab = findByClass(container, 'agent-view-tab')[1];
  assert.equal(alertsTab.textContent, '알람 9');
});

// ---------- 라이브 "다음 24시간" 타임라인(Paper 보드 02) ----------

test('타임라인: 각 행이 시각 열을 갖는다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();

  assert.deepEqual(
    findByClass(container, 'agent-live-timeline-time').map((n) => n.textContent),
    ['07:30', '08:55', '15:30', '16:00'],
  );
});

test('타임라인: 점 색이 갈래별로 갈린다(예약·프로액티브·감시)', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();

  assert.deepEqual(
    findByClass(container, 'agent-live-timeline-dot').map((n) => n.style.color),
    ['var(--color-ok)', 'var(--color-brand)', 'var(--color-info)', 'var(--color-brand)'],
  );
});

// ---------- 알람 카테고리 아이콘(Paper 보드 02 · 실데이터 mode 근거) ----------

test('알람 아이콘: 예약(scheduled) 발화는 ● 초록, 조건 감시 발화는 ◆ 핑크', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchAlerts: () => [
      { id: 's', title: '아침 브리핑', sub: '', mode: 'scheduled', firedAt: Date.now(), read: true },
      { id: 'w', title: '삼성전자 88,000 돌파', sub: '', mode: 'realtime-ws', firedAt: Date.now(), read: true },
      { id: 'p', title: '주기 확인', sub: '', mode: 'periodic', firedAt: Date.now(), read: true },
    ],
  });
  canvas.mount();

  const icons = findByClass(container, 'agent-alarm-icon');
  assert.deepEqual(icons.map((n) => n.textContent), ['●', '◆', '◆']);
  assert.deepEqual(icons.map((n) => n.style.color), [
    'var(--color-ok)', 'var(--color-brand)', 'var(--color-brand)',
  ]);
});

test('알람 아이콘: mode가 없는(하이드레이션 이전) 방은 조건 감시 쪽 ◆로 떨어진다', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchAlerts: () => [{ id: 'x', title: '루틴 x', sub: '', firedAt: Date.now(), read: true }],
  });
  canvas.mount();

  assert.equal(findByClass(container, 'agent-alarm-icon')[0].textContent, '◆');
});

// ---------- 드릴인 세그먼트 [이력][설정](Paper 보드 03) ----------

function drillInRoutine(overrides) {
  return routine({
    id: 'a', status: 'active', mode: 'periodic', note: '삼성전자 88,000 감시',
    source_label: '키움 시세', cooldown_s: 300, created_at: '2026-08-20T01:00:00Z',
    ...overrides,
  });
}

test('드릴인 세그먼트: 작업 뷰에서는 숨고, 드릴인을 열면 [이력][설정]이 나온다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [drillInRoutine()], fetchRuns: async () => [],
  });
  canvas.mount();
  await canvas.refresh();

  assert.equal(findByClass(container, 'agent-history-tabs')[0].hidden, true);
  await openDrillIn(container, canvas);
  assert.equal(findByClass(container, 'agent-history-tabs')[0].hidden, false);
  assert.deepEqual(
    findByClass(container, 'agent-history-tab').map((n) => n.textContent), ['이력', '설정'],
  );
});

test('드릴인 세그먼트: "설정"을 누르면 이력 본문이 숨고 읽기 전용 명세가 나온다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [drillInRoutine()], fetchRuns: async () => [],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);

  canvas.setHistoryTab('settings');
  assert.equal(findByClass(container, 'agent-history-body')[0].hidden, true);
  const panel = findByClass(container, 'agent-history-settings')[0];
  assert.equal(panel.hidden, false);
  assert.equal(findByClass(panel, 'agent-panel-caption')[0].textContent, '설정 — 보기 전용');

  canvas.setHistoryTab('runs');
  assert.equal(findByClass(container, 'agent-history-body')[0].hidden, false);
  assert.equal(findByClass(container, 'agent-history-settings')[0].hidden, true);
});

test('드릴인 설정: 백엔드가 실제로 준 필드만 라벨로 낸다(지어내지 않는다, P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => [drillInRoutine({ expires_at: null, symbol: '005930' })],
    fetchRuns: async () => [],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);
  canvas.setHistoryTab('settings');

  const panel = findByClass(container, 'agent-history-settings')[0];
  const labels = findByClass(panel, 'agent-detail-field-label').map((n) => n.textContent);
  assert.deepEqual(labels, ['조건', '모드', '소스', '종목', '쿨다운', '생성']);
  assert.equal(labels.includes('만료'), false, 'expires_at이 없으면 만료 행을 만들지 않는다');
  assert.equal(labels.includes('브리핑 모델'), false, '예약이 아니면 브리핑 모델 행이 없다');
});

test('드릴인 설정: 값을 바꾸는 입력이 없고 고치는 경로는 채팅 버튼 하나다(동선 규칙②)', async () => {
  const container = fakeNode('div');
  let seeded = null;
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [drillInRoutine()], fetchRuns: async () => [],
    onEditInChat: (title) => { seeded = title; },
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);
  canvas.setHistoryTab('settings');

  const panel = findByClass(container, 'agent-history-settings')[0];
  const inputs = [];
  (function walk(n) { if (n.tag === 'input' || n.tag === 'select' || n.tag === 'textarea') inputs.push(n); (n.children || []).forEach(walk); })(panel);
  assert.equal(inputs.length, 0, '보기 전용 패널에 입력 컨트롤이 있으면 안 된다');

  const editBtn = findByClass(panel, 'agent-history-settings-edit')[0];
  assert.equal(editBtn.textContent, '채팅에서 고치기 ↗');
  editBtn.dispatchEvent({ type: 'click' });
  assert.equal(seeded, '삼성전자 88,000 감시');
});

test('드릴인 설정: 브리핑 모델·다음 실행은 그 값이 실제로 있을 때만 붙는다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container,
    fetchRoutines: async () => [drillInRoutine({
      briefing_model: 'opus', briefing_effort: 'high', next_fire_at: '2026-08-27T07:30:00Z',
    })],
    fetchRuns: async () => [],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);
  canvas.setHistoryTab('settings');

  const panel = findByClass(container, 'agent-history-settings')[0];
  const pairs = findByClass(panel, 'agent-detail-field').map((row) => [
    findByClass(row, 'agent-detail-field-label')[0].textContent,
    findByClass(row, 'agent-detail-field-value')[0].textContent,
  ]);
  const byLabel = Object.fromEntries(pairs);
  assert.equal(byLabel['브리핑 모델'], 'opus · high');
  assert.ok(byLabel['다음 실행'], '다음 실행 값이 채워진다');
  assert.equal(byLabel['모드'], '주기 확인');
});

test('드릴인 세그먼트: 드릴인을 닫으면 세그먼트가 숨고 다음 진입은 "이력"으로 시작한다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [drillInRoutine()], fetchRuns: async () => [],
  });
  canvas.mount();
  await canvas.refresh();
  await openDrillIn(container, canvas);
  canvas.setHistoryTab('settings');

  findByClass(container, 'agent-breadcrumb-back')[0].dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'agent-history-tabs')[0].hidden, true);
  assert.equal(findByClass(container, 'agent-history-settings')[0].hidden, true);

  await openDrillIn(container, canvas);
  assert.equal(findByClass(container, 'agent-history-tab')[0].className, 'agent-history-tab is-active');
  assert.equal(findByClass(container, 'agent-history-body')[0].hidden, false);
});

// ---------- 제안 카드 두 줄 구조(Paper 보드 04) ----------

test('제안 카드: 설명(rationale)과 "근거:" 줄을 따로 낸다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry({
      entity_id: 'e1', entity_name: '장 마감 후 손익 요약 루틴',
      relation_kind: '단기 회전', reinforcement: 21,
      rationale: '매매일마다 마감 뒤 손익·보유 변화 정리',
    })],
  });
  canvas.mount();
  await canvas.refresh();

  const card = findByClass(container, 'agent-proactive-card')[0];
  assert.equal(findByClass(card, 'agent-proactive-card-desc')[0].textContent, '매매일마다 마감 뒤 손익·보유 변화 정리');
  assert.equal(findByClass(card, 'agent-proactive-card-rationale')[0].textContent, '근거: 단기 회전 성향 21회 보강');
});

test('제안 카드: rationale이 없으면 설명 줄 자체를 만들지 않는다(빈 줄 금지, P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry({ entity_id: 'e1', rationale: '' })],
  });
  canvas.mount();
  await canvas.refresh();

  const card = findByClass(container, 'agent-proactive-card')[0];
  assert.equal(findByClass(card, 'agent-proactive-card-desc').length, 0);
  assert.equal(findByClass(card, 'agent-proactive-card-rationale').length, 1);
});

test('제안 미니 목록(작업 뷰)은 좁은 폭이라 여전히 한 줄로 합친다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({
    container, fetchRoutines: async () => [],
    fetchProfileSummary: async () => [profileEntry({
      entity_id: 'e1', relation_kind: '단기 회전', reinforcement: 21, rationale: '매매일마다 정리가 필요해 보여요',
    })],
  });
  canvas.mount();
  await canvas.refresh();

  assert.equal(
    findByClass(container, 'agent-suggest-rationale')[0].textContent,
    '단기 회전 성향 21회 보강 — 매매일마다 정리가 필요해 보여요',
  );
});
