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

test('renderHiddenLinks — 배지는 자리 순위이고 점수 숫자가 아니다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [
    connection({ surprise_score: 1 }),
    connection({ surprise_score: 1, source_name: '두 번째' }),
  ]);
  const badges = container.querySelectorAll('.hidden-link-score').map((n) => n.textContent);
  // 예전에는 `상대 ${score*10}`이었다. backend가 min-max 정규화를 하므로 1등은 항상
  // 1.0이고 전부 동점이면 전부 1.0이라, 화면에 "상대 10.0"이 나란히 찍혔다 —
  // 라벨은 '상대'인데 순위 정보가 0이었다. 자리 순위는 그 병이 없다.
  assert.deepEqual(badges, ['1순위', '2순위']);
  assert.ok(!/10\.0|8\.5/.test(container.textContent), '절대 점수처럼 읽히는 숫자가 없다');
});

test('renderHiddenLinks — 순위는 surprise_score가 없어도 붙는다', () => {
  // 구버전 backend라도 목록의 순서 자체는 있다 — 자리 순위는 점수 필드에 기대지 않는다.
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection(), connection({ source_name: '두 번째' })]);
  const badges = container.querySelectorAll('.hidden-link-score').map((n) => n.textContent);
  assert.deepEqual(badges, ['1순위', '2순위']);
});

test('renderHiddenLinks — 관계명을 한글 사전으로 바꿔 적는다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection({ kinds: ['belongs_to', 'co_mention'] })], {
    relationLabels: { belongs_to: '소속' },
  });
  const desc = container.querySelector('.hidden-link-desc');
  // 사전에 있는 것은 한글로, 없는 것은 원문 그대로(모르는 것을 지어내지 않는다).
  assert.equal(desc.textContent, '소속 · co_mention');
});

test('renderHiddenLinks — 사전을 안 주면 원문을 그대로 둔다', () => {
  const container = fakeNode('div');
  renderHiddenLinks(container, [connection({ kinds: ['belongs_to'] })]);
  assert.equal(container.querySelector('.hidden-link-desc').textContent, 'belongs_to');
});

test('renderHiddenLinks — 잘렸으면 모수를 밝히고, 안 잘렸으면 안 밝힌다', () => {
  const many = fakeNode('div');
  renderHiddenLinks(many, [connection(), connection(), connection(), connection(), connection()]);
  // 바로 위 테마 군집이 "7개 중 3개"라고 말하는데 여기만 잘린 사실을 숨겼었다.
  assert.equal(many.querySelector('.hidden-links-count').textContent, '5개 중 3개');

  const few = fakeNode('div');
  renderHiddenLinks(few, [connection(), connection()]);
  assert.equal(few.querySelector('.hidden-links-count'), null, '자른 게 없으면 아무 말도 안 한다');
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
