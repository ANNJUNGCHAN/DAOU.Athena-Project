// hidden-links.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHiddenLinks } = require('./hidden-links');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

test.beforeEach(() => {
  installFakeDocument();
});

test.afterEach(() => {
  uninstallFakeDocument();
});

function connection(overrides) {
  return {
    source_entity_id: 'e:a',
    source_name: '한미반도체',
    target_entity_id: 'e:b',
    target_name: '배당 방어 바스켓',
    kinds: ['co_mention', 'shared_cluster_boundary'],
    source_cluster: 0,
    target_cluster: 1,
    ...overrides,
  };
}

test('renderHiddenLinks — 개체명 쌍과 kinds 조인 텍스트를 그린다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection()]);
  const row = container.querySelector('.hidden-link-row');
  const names = row.querySelectorAll('.hidden-link-entity').map((n) => n.textContent);
  assert.deepEqual(names, ['한미반도체', '배당 방어 바스켓']);
  const desc = row.querySelector('.hidden-link-desc');
  assert.equal(desc.textContent, 'co_mention · shared_cluster_boundary');
});

test('renderHiddenLinks — surprise_score가 없으면(구버전 backend) 점수 칸을 만들지 않는다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection()]);
  assert.equal(container.querySelector('.hidden-link-score'), null);
  assert.ok(!/8\.5/.test(container.querySelector('.hidden-link-row').textContent), '지어낸 점수가 없다');
});

test('renderHiddenLinks — surprise_score가 있으면 상대 점수 배지를 그린다(WP-B)', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection({ surprise_score: 0.734 })]);
  const score = container.querySelector('.hidden-link-score');
  assert.equal(score.textContent, '상대 0.73');
  assert.ok(!/8\.5/.test(container.querySelector('.hidden-link-row').textContent), '절대 점수는 여전히 안 지어낸다');
});

test('renderHiddenLinks — name이 없으면 entity_id로 대체한다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection({ source_name: null, target_name: null })]);
  const names = container.querySelectorAll('.hidden-link-entity').map((n) => n.textContent);
  assert.deepEqual(names, ['e:a', 'e:b']);
});

test('renderHiddenLinks — kinds가 없으면(빈 배열) 설명 칸은 빈 문자열(지어내지 않는다)', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection({ kinds: [] })]);
  const desc = container.querySelector('.hidden-link-desc');
  assert.equal(desc.textContent, '');
});

test('renderHiddenLinks — 헤더("숨은 연관"+부제)가 붙는다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection()]);
  const title = container.querySelector('.hidden-links-title');
  assert.equal(title.textContent, '숨은 연관');
  const subtitle = container.querySelector('.hidden-links-subtitle');
  assert.equal(subtitle.textContent, '본인이 말한 적 없는 연결');
});

test('renderHiddenLinks — limit을 넘는 항목은 안 그린다(기본 3개)', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection(), connection(), connection(), connection()]);
  assert.equal(container.querySelectorAll('.hidden-link-row').length, 3);
});

test('renderHiddenLinks — 항목이 없으면 아예 안 그린다(§0 정직한 빈 데이터)', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, []);
  assert.equal(container.children.length, 0);
});

test('renderHiddenLinks — 컨테이너가 없으면 조용히 넘어간다', () => {
  assert.equal(renderHiddenLinks(null, [connection()]), null);
});

test('renderHiddenLinks — 다시 그리면 이전 내용을 지운다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection(), connection()]);
  renderHiddenLinks(container, [connection()]);
  assert.equal(container.children.length, 1, '표가 쌓이지 않는다');
});
