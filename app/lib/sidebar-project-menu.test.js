// sidebar-project-menu.js 단위 테스트 — 순수 함수라 DOM 스텁이 전혀 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { menuItemsFor, modeChoices, countConversationsByMode, modeCountLabel, removeConfirmState } = require('./sidebar-project-menu');

function project(overrides) {
  return {
    id: 'p1', label: '전략 폴더', path: 'C:/work/strategy', pinned: false, ...overrides,
  };
}

test('⋯ 는 셋뿐이다 — 편집·작업 트리·보관은 없다(37번 보드)', () => {
  const items = menuItemsFor(project());
  assert.deepEqual(items.map((i) => i.key), ['pin', 'reveal', 'remove']);
  assert.deepEqual(items.map((i) => i.label), ['최상단 고정', '탐색기에서 열기', '프로젝트 제거']);
  assert.equal(items[2].danger, true);
  assert.ok(items.every((i) => !i.disabled));
});

test('이미 고정된 프로젝트는 해제로 뒤집힌다', () => {
  assert.equal(menuItemsFor(project({ pinned: true }))[0].label, '고정 해제');
});

test('폴더가 없으면 탐색기 열기가 이유와 함께 잠긴다', () => {
  const reveal = menuItemsFor(project({ path: null }))[1];
  assert.equal(reveal.disabled, true);
  assert.equal(reveal.reason, '폴더가 연결되지 않은 프로젝트입니다');
});

test('기본 프로젝트는 제거가 이유와 함께 잠긴다', () => {
  const items = menuItemsFor(project({ id: 'default', label: '기본 프로젝트' }));
  assert.equal(items[2].disabled, true);
  assert.equal(items[2].reason, '기본 프로젝트는 지울 수 없습니다');
  assert.equal(items[1].disabled, false); // 폴더가 있으면 기본 프로젝트도 열 수 있다.
});

test('project가 비어도 셋을 그대로 낸다 — 렌더가 멈추지 않는다', () => {
  const items = menuItemsFor(null);
  assert.equal(items.length, 3);
  assert.equal(items[0].label, '최상단 고정');
  assert.equal(items[1].disabled, true);
});

test('모드 선택은 다섯이고 순서와 view 매핑이 고정이다', () => {
  const choices = modeChoices();
  assert.deepEqual(choices.map((c) => c.mode), ['chat', 'graph', 'agent', 'plugin', 'backtest']);
  assert.deepEqual(choices.map((c) => c.view), ['summary', 'graph', 'agent', 'plugin', 'backtest']);
  assert.deepEqual(choices.map((c) => c.label), ['아고라 · 대화', '메티스 · 그래프', '아이기스 · 에이전트', '에르가네 · 플러그인', '팔라스 · 백테스트']);
  assert.ok(choices.every((c) => typeof c.hint === 'string' && c.hint.length > 0));
});

test('프로젝트 안 모드별 대화 수는 현재 N개 / 없음이다', () => {
  const conversations = [
    { projectId: 'p1', mode: 'chat' },
    { projectId: 'p1', mode: 'chat' },
    { projectId: 'p1', mode: 'graph' },
    { projectId: 'p2', mode: 'agent' },
    { projectId: 'p1', mode: 'summary' },
  ];
  const counts = countConversationsByMode(conversations, 'p1');
  assert.deepEqual(counts, { chat: 3, graph: 1, agent: 0, plugin: 0, backtest: 0 });
  assert.equal(modeCountLabel(counts.chat), '현재 3개');
  assert.equal(modeCountLabel(counts.graph), '현재 1개');
  assert.equal(modeCountLabel(counts.agent), '없음');
  assert.equal(modeCountLabel(0), '없음');
  assert.equal(modeCountLabel(-1), '없음');
});

test('modeChoices는 매번 새 객체를 준다 — 호출자가 원본을 못 바꾼다', () => {
  const first = modeChoices();
  first[0].label = '망가뜨림';
  assert.equal(modeChoices()[0].label, '아고라 · 대화');
});

test('이름이 정확히 같을 때만 영구 삭제가 열린다', () => {
  assert.equal(removeConfirmState(project(), '전략 폴더').canRemove, true);
  assert.equal(removeConfirmState(project(), '  전략 폴더  ').canRemove, true); // 앞뒤 공백만 턴다.
  assert.equal(removeConfirmState(project(), '전략폴더').canRemove, false);
  assert.equal(removeConfirmState(project(), '전략 폴더 ').canRemove, true);
  assert.equal(removeConfirmState(project(), '전략 폴더2').canRemove, false);
  assert.equal(removeConfirmState(project(), '').canRemove, false);
  assert.equal(removeConfirmState(project(), null).canRemove, false);
});

test('열리지 않을 때는 무엇을 쳐야 하는지 한 줄로 말한다', () => {
  const state = removeConfirmState(project(), '아무거나');
  assert.equal(state.canRemove, false);
  assert.ok(state.hint.includes('전략 폴더'));
  assert.equal(removeConfirmState(project(), '전략 폴더').hint, '');
});

test('label이 없는 레코드는 어떤 입력으로도 열리지 않는다', () => {
  assert.equal(removeConfirmState({ id: 'p2', label: '' }, '').canRemove, false);
  assert.equal(removeConfirmState(null, '').canRemove, false);
});
