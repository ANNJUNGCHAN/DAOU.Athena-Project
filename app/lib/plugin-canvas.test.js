// plugin-canvas.js 단위 테스트 — Electron/jsdom 없이 기존 agent-canvas 관례의
// 최소 DOM 스텁으로 허브·관리·콜백 왕복을 검증한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPluginCanvas } = require('./plugin-canvas');

function fakeNode(tag) {
  return {
    tag,
    className: '',
    textContent: '',
    type: '',
    placeholder: '',
    value: '',
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((item) => item !== child); return child; },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; },
    addEventListener(type, handler) { (this._listeners[type] = this._listeners[type] || []).push(handler); },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      return Promise.all(handlers.map((handler) => handler(event)));
    },
  };
}

function findByClass(node, className) {
  const found = [];
  const walk = (current) => {
    if (String(current.className || '').split(/\s+/).includes(className)) found.push(current);
    (current.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

test.beforeEach(() => {
  global.document = {
    createElement: (tag) => fakeNode(tag),
    createElementNS: (_namespace, tag) => fakeNode(tag),
  };
});

test.afterEach(() => { delete global.document; });

test('허브 기본 화면은 Paper 47의 설치 2개·추천 6개를 렌더한다', () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();

  assert.equal(findByClass(container, 'plugin-canvas-title')[0].textContent, '플러그인');
  assert.equal(findByClass(container, 'plugin-canvas-search')[0].placeholder, '플러그인 검색');
  assert.equal(findByClass(container, 'plugin-canvas-installed')[0].children.length, 2);
  assert.equal(findByClass(container, 'plugin-canvas-recommended')[0].children.length, 6);
  assert.deepEqual(
    findByClass(container, 'plugin-canvas-card-name').slice(0, 2).map((node) => node.textContent),
    ['DART 전자공시', 'Google Sheets 내보내기'],
  );
});

test('검색은 설치·추천 카드의 이름/설명을 함께 필터링한다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();
  const input = findByClass(container, 'plugin-canvas-search')[0];
  input.value = '텔레그램';
  await input.dispatchEvent({ type: 'input', target: input });

  assert.equal(findByClass(container, 'plugin-canvas-installed')[0].children.length, 1, '설치 목록은 빈 상태 한 장');
  assert.equal(findByClass(container, 'plugin-canvas-recommended')[0].children.length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-card-name')[0].textContent, '텔레그램 알림');
});

test('권한 버튼은 기존 의도 콜백을 알리고 Paper 26 상세 화면을 연다', async () => {
  const calls = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onPermission: (plugin) => calls.push(['permission', plugin.id]),
  });
  canvas.mount();
  const primary = findByClass(container, 'is-primary').find((node) => node.tag === 'button');
  await primary.dispatchEvent({ type: 'click' });
  assert.deepEqual(calls, [['permission', 'dart']]);
  assert.equal(findByClass(container, 'plugin-canvas-permissions-view').length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0, '권한 상세는 모달이 아니다');
  await findByClass(container, 'is-sheet-cancel')[0].dispatchEvent({ type: 'click' });
  await findByClass(container, 'is-secondary').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-install-sheet').length, 1);
});

test('관리 버튼은 콜백 후 Paper 48 관리 화면으로 전환한다', async () => {
  const calls = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, onManage: (view) => calls.push(view) });
  canvas.mount();
  await findByClass(container, 'is-manage').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });

  assert.deepEqual(calls, ['manage']);
  assert.equal(findByClass(container, 'plugin-canvas-title')[0].textContent, '플러그인 관리');
  assert.equal(canvas.getState().view, 'manage');
});

test('관리 화면은 플러그인·기능·마켓플레이스 집계와 토글 상태를 표시한다', () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container, initialView: 'manage' });
  canvas.mount();

  assert.deepEqual(findByClass(container, 'plugin-canvas-count').map((node) => node.textContent), [
    '플러그인 2', '기능 8', '마켓플레이스 1',
  ]);
  assert.deepEqual(findByClass(container, 'plugin-canvas-toggle').map((node) => node.getAttribute('aria-checked')), [
    'true', 'false', 'true',
  ]);
});

test('플러그인·마켓플레이스 토글은 로컬 표시를 바꾸고 각각의 콜백을 호출한다', async () => {
  const calls = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    initialView: 'manage',
    onTogglePlugin: (plugin, enabled) => calls.push(['plugin', plugin.id, enabled]),
    onToggleMarketplace: (marketplace, enabled) => calls.push(['marketplace', marketplace.id, enabled]),
  });
  canvas.mount();
  const toggles = findByClass(container, 'plugin-canvas-toggle');
  await toggles[1].dispatchEvent({ type: 'click' });
  await toggles[2].dispatchEvent({ type: 'click' });

  assert.equal(toggles[1].getAttribute('aria-checked'), 'true');
  assert.equal(toggles[2].getAttribute('aria-checked'), 'false');
  assert.deepEqual(calls, [
    ['plugin', 'google-sheets', true],
    ['marketplace', 'athena-official', false],
  ]);
});

test('호출자가 전달한 목록과 집계값을 그대로 사용하며 원본 객체는 변경하지 않는다', async () => {
  const installed = [{ id: 'custom', name: '사내 플러그인', description: '내부 확장', enabled: false, featureCount: 1 }];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    installed,
    recommended: [],
    marketplaces: [],
    initialView: 'manage',
    counts: { plugins: 7, features: 11, marketplaces: 3 },
  });
  canvas.mount();
  assert.deepEqual(findByClass(container, 'plugin-canvas-count').map((node) => node.textContent), [
    '플러그인 7', '기능 11', '마켓플레이스 3',
  ]);
  await findByClass(container, 'plugin-canvas-toggle')[0].dispatchEvent({ type: 'click' });
  assert.equal(installed[0].enabled, false, 'UI 세션 상태는 호출자 소유 객체를 직접 바꾸지 않는다');
});

test('추천 설치는 승인 시트를 열고 취소하면 목록과 콜백을 변경하지 않는다', async () => {
  const approvals = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onApproveInstall: (plugin, features) => approvals.push([plugin.id, features]),
  });
  canvas.mount();
  await findByClass(container, 'is-secondary').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });

  assert.equal(findByClass(container, 'plugin-canvas-install-sheet').length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-sheet-plugin-name')[0].textContent, 'PDF 리포트 분석');
  assert.equal(findByClass(container, 'plugin-canvas-sheet-feature').length, 3);
  assert.equal(canvas.getState().installed.length, 2, '승인 전에는 설치 상태가 바뀌지 않는다');
  await findByClass(container, 'is-sheet-cancel')[0].dispatchEvent({ type: 'click' });

  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0);
  assert.equal(canvas.getState().installed.length, 2);
  assert.deepEqual(approvals, []);
});

test('설치 승인 뒤에만 로컬 설치 목록이 바뀌고 허용 기능 콜백을 보낸다', async () => {
  const approvals = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onApproveInstall: (plugin, features) => approvals.push([plugin.id, features.map((feature) => feature.name)]),
  });
  canvas.mount();
  await findByClass(container, 'is-secondary').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });
  await findByClass(container, 'is-sheet-confirm')[0].dispatchEvent({ type: 'click' });

  assert.equal(canvas.getState().installed.length, 3);
  assert.equal(canvas.getState().recommended.length, 5);
  assert.deepEqual(approvals, [[
    'pdf-report',
    ['PDF 문서 읽기', '표·본문 추출', '분석 카드 생성'],
  ]]);
});

test('권한 상세 토글은 저장 전 초안이며 돌아가면 기존 허용 상태를 보존한다', async () => {
  const saves = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onSavePermissions: (plugin, features) => saves.push([plugin.id, features]),
  });
  canvas.mount();
  await findByClass(container, 'is-primary').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });
  const sheet = findByClass(container, 'plugin-canvas-permissions-view')[0];
  const toggles = findByClass(sheet, 'plugin-canvas-toggle');
  assert.deepEqual(toggles.map((toggle) => toggle.getAttribute('aria-checked')), ['true', 'true', 'true', 'false']);
  await toggles[0].dispatchEvent({ type: 'click' });
  assert.equal(canvas.getState().installed[0].features[0].allowed, true, '저장 전에는 설치 목록을 바꾸지 않는다');
  await findByClass(container, 'is-sheet-cancel')[0].dispatchEvent({ type: 'click' });
  assert.equal(canvas.getState().installed[0].features[0].allowed, true);
  assert.deepEqual(saves, []);
});

test('권한 저장은 선택한 허용 기능만 반영하고 콜백으로 돌려준다', async () => {
  const saves = [];
  const container = fakeNode('div');
  const canvas = createPluginCanvas({
    container,
    onSavePermissions: (plugin, features) => saves.push([plugin.id, features.map((feature) => feature.id)]),
  });
  canvas.mount();
  await findByClass(container, 'is-primary').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });
  const sheet = findByClass(container, 'plugin-canvas-permissions-view')[0];
  const toggles = findByClass(sheet, 'plugin-canvas-toggle');
  await toggles[0].dispatchEvent({ type: 'click' });
  await toggles[3].dispatchEvent({ type: 'click' });
  await findByClass(container, 'is-sheet-confirm')[0].dispatchEvent({ type: 'click' });

  assert.deepEqual(saves, [['dart', ['company-search', 'financial-statements', 'attachments']]]);
  assert.deepEqual(canvas.getState().installed[0].features.map((feature) => feature.allowed), [false, true, true, true]);
});

test('설치는 단일 모달이고 권한은 배경을 막지 않는 단일 상세 화면이다', async () => {
  const container = fakeNode('div');
  const canvas = createPluginCanvas({ container });
  canvas.mount();
  await findByClass(container, 'is-secondary').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 1);
  assert.equal(findByClass(container, 'plugin-canvas-panel')[0].getAttribute('inert'), '');
  assert.equal(canvas.getState().activeSheet, 'install');

  await findByClass(container, 'is-sheet-cancel')[0].dispatchEvent({ type: 'click' });
  await findByClass(container, 'is-primary').find((node) => node.tag === 'button').dispatchEvent({ type: 'click' });
  assert.equal(findByClass(container, 'plugin-canvas-sheet').length, 0);
  assert.equal(findByClass(container, 'plugin-canvas-install-sheet').length, 0);
  assert.equal(findByClass(container, 'plugin-canvas-permissions-view').length, 1);
  assert.notEqual(findByClass(container, 'plugin-canvas-panel')[0].getAttribute('inert'), '');
  assert.equal(canvas.getState().activeSheet, 'permissions');
});
