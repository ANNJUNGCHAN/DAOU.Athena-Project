// history-badge.js 단위 테스트 — Electron/브라우저 없이 최소 DOM 스텁으로 검증한다
// (sanitize.js 등 lib/*.js와 같은 UMD 모듈이라 require가 그대로 된다). 진짜 DOM
// 대신 이 파일 안에서 손으로 만든 가짜 엘리먼트를 쓴다 — jsdom 등 신규 의존성을
// 추가하지 않는다(ponytail 원칙 — 필요한 인터페이스만 흉내).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendSaveFailedBadge, createSaveFailedRouter } = require('./history-badge');

// appendSaveFailedBadge/createSaveFailedRouter는 호출 시점에만 전역 document를
// 참조한다(모듈 로드 시점엔 안 건드림) — 그래서 여기서 최소 스텁을 깔아준다.
function fakeElement(tag) {
  const el = {
    tagName: tag,
    className: '',
    textContent: '',
    children: [],
    isConnected: false,
    appendChild(child) { this.children.push(child); return child; },
    querySelector(sel) {
      // 이 테스트가 쓰는 유일한 셀렉터 — '.turn-meta'
      if (sel === '.turn-meta') return this.children.find((c) => c.className === 'turn-meta') || null;
      return null;
    },
  };
  return el;
}

test.beforeEach(() => {
  global.document = {
    createElement: (tag) => fakeElement(tag),
  };
});

test.afterEach(() => {
  delete global.document;
});

test('appendSaveFailedBadge: 문서에 안 붙은 줄(isConnected:false)에는 아무것도 안 붙인다', () => {
  const line = fakeElement('div');
  line.isConnected = false;
  const applied = appendSaveFailedBadge(line);
  assert.equal(applied, false);
  assert.equal(line.children.length, 0);
});

test('appendSaveFailedBadge: .turn-meta가 없으면 새로 만들고 배지를 그 안에 넣는다', () => {
  const line = fakeElement('div');
  line.isConnected = true;
  const applied = appendSaveFailedBadge(line);
  assert.equal(applied, true);
  assert.equal(line.children.length, 1);
  const meta = line.children[0];
  assert.equal(meta.className, 'turn-meta');
  assert.equal(meta.children.length, 1);
  const badge = meta.children[0];
  assert.equal(badge.className, 'save-failed-badge');
  assert.equal(badge.textContent, '기록 안 됨');
});

test('appendSaveFailedBadge: 이미 .turn-meta(트레이스 라인)가 있으면 그 안에 부속으로 붙인다 — 중복 meta 없음', () => {
  const line = fakeElement('div');
  line.isConnected = true;
  const meta = fakeElement('div');
  meta.className = 'turn-meta';
  const trace = fakeElement('span');
  trace.textContent = 'claude -p · 1.2s';
  meta.appendChild(trace);
  line.appendChild(meta);

  appendSaveFailedBadge(line);

  assert.equal(line.children.length, 1); // meta div가 하나뿐 — 새로 안 만들었다
  assert.equal(meta.children.length, 2); // trace + badge
  assert.equal(meta.children[0], trace);
  assert.equal(meta.children[1].className, 'save-failed-badge');
});

test('createSaveFailedRouter: role:user 실패는 startTurn에서 지정한 질문 줄에 바로 붙는다', () => {
  const router = createSaveFailedRouter();
  const qLine = fakeElement('div');
  qLine.isConnected = true;
  router.startTurn(qLine);

  router.handleFailure({ messageId: 'm1', role: 'user' });

  assert.equal(qLine.children.length, 1);
  assert.equal(qLine.children[0].className, 'turn-meta');
});

test('createSaveFailedRouter: role:assistant 실패가 setAssistantLine보다 먼저 오면 pending으로 흡수했다가 나중에 붙인다', () => {
  const router = createSaveFailedRouter();
  const qLine = fakeElement('div');
  qLine.isConnected = true;
  router.startTurn(qLine);

  // 응답 줄이 아직 안 만들어진 시점에 먼저 실패 이벤트가 온다(main이 fire-and-forget이라 가능).
  router.handleFailure({ messageId: 'm2', role: 'assistant' });
  assert.equal(router._debugState().pendingAssistantBadge, true);

  const aLine = fakeElement('div');
  aLine.isConnected = true;
  router.setAssistantLine(aLine);

  assert.equal(router._debugState().pendingAssistantBadge, false);
  assert.equal(aLine.children.length, 1);
  assert.equal(aLine.children[0].className, 'turn-meta');
});

test('createSaveFailedRouter: role:assistant 실패가 setAssistantLine 이후에 오면 바로 그 줄에 붙는다', () => {
  const router = createSaveFailedRouter();
  const qLine = fakeElement('div');
  qLine.isConnected = true;
  router.startTurn(qLine);

  const aLine = fakeElement('div');
  aLine.isConnected = true;
  router.setAssistantLine(aLine);

  router.handleFailure({ messageId: 'm3', role: 'assistant' });

  assert.equal(qLine.children.length, 0); // 사용자 줄은 안 건드렸다
  assert.equal(aLine.children.length, 1);
});

test('createSaveFailedRouter: startTurn이 새 턴을 시작하면 이전 턴의 pending/참조를 리셋한다', () => {
  const router = createSaveFailedRouter();
  const qLine1 = fakeElement('div');
  qLine1.isConnected = true;
  router.startTurn(qLine1);
  router.handleFailure({ messageId: 'm4', role: 'assistant' }); // pending true로 남김

  const qLine2 = fakeElement('div');
  qLine2.isConnected = true;
  router.startTurn(qLine2); // 새 턴 — pending 리셋되어야 한다

  assert.equal(router._debugState().pendingAssistantBadge, false);
  assert.equal(router._debugState().currentAssistantLine, null);

  const aLine2 = fakeElement('div');
  aLine2.isConnected = true;
  router.setAssistantLine(aLine2);
  assert.equal(aLine2.children.length, 0); // 이전 턴의 pending이 새 턴 줄에 안 새어나온다
});
