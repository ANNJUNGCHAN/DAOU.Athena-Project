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
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      handlers.forEach((h) => h(event));
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

test('통계 카드 4장 전부 source:fixture로 표시된다(지어낸 숫자가 아님을 코드에 남긴다)', () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  const cards = findByClass(container, 'agent-stat-card');
  for (const card of cards) assert.equal(card.getAttribute('data-source'), 'fixture');
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

test('"모두" 탭: draft는 감시 목록에서 빠지고(승인 전엔 실재하지 않는다), 예약 fixture 2건은 항상 보인다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active' }),
    routine({ id: 'b', status: 'paused' }),
    routine({ id: 'c', status: 'draft' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 4, 'watch 2건(a,b — draft 제외) + schedule fixture 2건');
  const liveRows = rows.filter((r) => r.getAttribute('data-source') === 'live');
  const fixtureRows = rows.filter((r) => r.getAttribute('data-source') === 'fixture');
  assert.equal(liveRows.length, 2);
  assert.equal(fixtureRows.length, 2);
});

test('예약(schedule) 행에는 fixture 출처가 코드로 표시된다(P3)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 2, '라이브 라우틴이 없어도 예약 fixture 2건은 남는다');
  for (const row of rows) assert.equal(row.getAttribute('data-source'), 'fixture');
});

test('탭 "활성": 감시 active 1건 + 예약 fixture 중 active 1건이 남는다', async () => {
  const container = fakeNode('div');
  const routines = [
    routine({ id: 'a', status: 'active' }),
    routine({ id: 'b', status: 'paused' }),
    routine({ id: 'c', status: 'draft' }),
  ];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.setActiveTab('active');
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 2);
  const titles = rows.map((r) => findByClass(r, 'agent-row-title')[0].textContent);
  assert.ok(titles.includes('005930 감시'), '라이브 감시 행');
  assert.ok(titles.includes('평일 아침 브리핑'), '예약 fixture 행 중 active 상태인 것');

  const activeTabBtn = findByClass(container, 'agent-tab').find((b) => b.textContent === '활성');
  assert.ok(activeTabBtn.className.includes('is-active'));
  const allTabBtn = findByClass(container, 'agent-tab').find((b) => b.textContent === '모두');
  assert.equal(allTabBtn.className.includes('is-active'), false, '다른 탭은 꺼진다');
});

test('탭 "일시중지": 감시 paused 1건 + 예약 fixture 중 paused 1건이 남는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' }), routine({ id: 'b', status: 'paused' })];
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
  const empty = findByClass(container, 'agent-list-empty');
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
  const routines = [routine({ id: 'a', status: 'active', note: '라이브 감시 행' })];
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
  assert.equal(fieldLabels.includes('실행 위치'), false, 'watch에는 schedule 전용 fixture 필드가 없다');
});

test('예약(schedule) 상세는 fixture 필드(실행 위치 등)를 보여주고 data-source가 fixture다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  const fieldsWrap = findByClass(container, 'agent-detail-fields')[0];
  assert.equal(fieldsWrap.getAttribute('data-source'), 'fixture');
  const fieldLabels = findByClass(fieldsWrap, 'agent-detail-field-label').map((n) => n.textContent);
  assert.ok(fieldLabels.includes('실행 위치'));
});

test('일시중지 버튼은 항상 비활성이다(6단계 엔드포인트가 있어도 이 화면 스코프는 표시만이다, P3)', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  const pauseBtn = findByClass(container, 'agent-pause-btn')[0];
  assert.equal(pauseBtn.disabled, true);
});

test('최근 실행 로그는 fixture로 표시된다(ledger 라이브 연결은 10단계 몫)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  const logsWrap = findByClass(container, 'agent-detail-logs')[0];
  assert.equal(logsWrap.getAttribute('data-source'), 'fixture');
  assert.equal(findByClass(logsWrap, 'agent-detail-log').length, 3);
});

test('사용자가 고른 행이 필터로 사라지면 상세 패널이 남은 첫 항목으로 넘어간다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active', note: '라이브 활성' })];
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
  // mount() 시점엔 라이브 데이터가 없어 fixture 예약 행이 첫 항목이다.
  assert.equal(findByClass(container, 'agent-detail-title')[0].textContent, '평일 아침 브리핑');
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

test('fetchRoutines가 실패하면 감시 행 없이(빈 목록) 예약 fixture만 남는다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => { throw new Error('backend down'); } });
  canvas.mount();
  await assert.doesNotReject(() => canvas.refresh());
  const rows = findByClass(container, 'agent-row');
  assert.equal(rows.length, 2, '라이브 백엔드가 죽어도 예약 fixture 2건은 정직하게 그대로 보인다');
  for (const row of rows) assert.equal(row.getAttribute('data-source'), 'fixture');
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
