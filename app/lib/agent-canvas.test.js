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

test('refresh(): 라우틴을 받아오면 부제(루틴 N · 감시 M)와 리스트가 채워진다', async () => {
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
  assert.equal(findByClass(container, 'agent-list-row').length, 3, '모두 탭 — draft 포함 전부');
});

test('탭 "활성"을 누르면 active 상태만 남는다', async () => {
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
  const rows = findByClass(container, 'agent-list-row');
  assert.equal(rows.length, 1);
  assert.equal(findByClass(rows[0], 'agent-list-row-title')[0].textContent, '005930 감시');

  const activeTabBtn = findByClass(container, 'agent-tab').find((b) => b.textContent === '활성');
  assert.ok(activeTabBtn.className.includes('is-active'));
  const allTabBtn = findByClass(container, 'agent-tab').find((b) => b.textContent === '모두');
  assert.equal(allTabBtn.className.includes('is-active'), false, '다른 탭은 꺼진다');
});

test('탭 "일시중지"를 누르면 paused 상태만 남는다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' }), routine({ id: 'b', status: 'paused' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.setActiveTab('paused');
  assert.equal(findByClass(container, 'agent-list-row').length, 1);
});

test('검색어를 입력하면 note/symbol 부분일치로 좁혀진다', async () => {
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
  const rows = findByClass(container, 'agent-list-row');
  assert.equal(rows.length, 1);
});

test('라우틴이 하나도 없으면 빈 상태 문구가 뜬다', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [] });
  canvas.mount();
  await canvas.refresh();
  const empty = findByClass(container, 'agent-list-empty');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].textContent, '아직 등록된 작업이 없습니다');
});

test('필터 결과가 0건이면 "조건에 맞는 작업이 없습니다"로 구분한다', async () => {
  const container = fakeNode('div');
  const routines = [routine({ id: 'a', status: 'active' })];
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => routines });
  canvas.mount();
  await canvas.refresh();
  canvas.setActiveTab('paused');
  const empty = findByClass(container, 'agent-list-empty');
  assert.equal(empty.length, 1);
  assert.equal(empty[0].textContent, '조건에 맞는 작업이 없습니다');
});

test('CTA 클릭은 onNewTaskClick을 부른다(43번 원칙 — 시트를 열지 않는다)', () => {
  const container = fakeNode('div');
  let called = 0;
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => [], onNewTaskClick: () => { called += 1; } });
  canvas.mount();
  findByClass(container, 'agent-cta')[0].dispatchEvent({ type: 'click' });
  assert.equal(called, 1);
});

test('fetchRoutines가 실패하면 조용히 빈 목록으로 처리한다(없는 걸 있다고 꾸미지 않는다)', async () => {
  const container = fakeNode('div');
  const canvas = createAgentCanvas({ container, fetchRoutines: async () => { throw new Error('backend down'); } });
  canvas.mount();
  await assert.doesNotReject(() => canvas.refresh());
  assert.equal(findByClass(container, 'agent-list-empty').length, 1);
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
  const rows = findByClass(container, 'agent-list-row');
  assert.equal(rows.length, 1);
  assert.equal(findByClass(rows[0], 'agent-list-row-title')[0].textContent, '최신 응답');
});

test('container가 없으면 mount/refresh가 조용히 아무 것도 안 한다', async () => {
  const canvas = createAgentCanvas({});
  assert.doesNotThrow(() => canvas.mount());
  await assert.doesNotReject(() => canvas.refresh());
});
