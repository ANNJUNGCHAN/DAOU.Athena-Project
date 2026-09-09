'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const controls = require('./ranking-board-controls');

test('종목 찾기 모든 상태에서 정렬·세션·필터 링크가 다시 연결된다', () => {
  for (const boardId of ['13K0-2', '2YNQ-0', '2X5N-0', '2XKO-0', '4A9H-1']) {
    const links = controls.linksFor(boardId, [{ control: '당일 거래량', board_id: '2X5N-0' }]);
    assert.ok(links.some((link) => link.control === '거래대금' && link.board_id === '13K0-2'));
    assert.ok(links.some((link) => link.control === '정규장' && link.board_id === '13K0-2'));
    assert.ok(links.some((link) => link.control === '시간외 단일가' && link.board_id === '2YNQ-0'));
    assert.ok(links.some((link) => link.control === 'KOSPI' && link.board_id === '4A9H-1'));
    assert.ok(links.some((link) => link.control === '등락 전체' && link.board_id === '4AGN-1'));
    assert.ok(links.some((link) => link.control === '시가총액 전체' && link.board_id === '4ANS-1'));
    assert.ok(links.some((link) => link.control === '유동성 정상' && link.board_id === '4AUX-1'));
  }
});

test('시장과 유동성 선택은 실제 순위 조회 인자로 바뀐다', () => {
  let criteria = controls.initialCriteria({ mrkt_tp: '001', mang_stk_incls: '0' });
  criteria = controls.criteriaAfter(criteria, controls.selectionFor('4A9H-1', 'KOSDAQ'));
  criteria = controls.criteriaAfter(criteria, controls.selectionFor('4AUX-1', '전체 포함'));
  assert.deepEqual(controls.targetFor({}, criteria, '13K0-2'), {
    mrkt_tp: '101', mang_stk_incls: '1',
  });
  assert.deepEqual(controls.targetFor({}, criteria, '2X5N-0'), {
    mrkt_tp: '101', mang_stk_incls: '0', mrkt_open_tp: '1',
  });
});

test('거래대금 보드의 유동성 포함값은 초기화 후에도 뒤집히지 않는다', () => {
  for (const mang_stk_incls of ['0', '1']) {
    const criteria = controls.initialCriteria({ mang_stk_incls });
    assert.equal(
      controls.targetFor({}, criteria, controls.ROOT_BOARD).mang_stk_incls,
      mang_stk_incls,
    );
  }
  for (const mang_stk_incls of ['0', '1']) {
    const criteria = controls.initialCriteria({ mang_stk_incls }, '2X5N-0');
    assert.equal(
      controls.targetFor({}, criteria, '2X5N-0').mang_stk_incls,
      mang_stk_incls,
      'ka10032 계열의 반대 의미도 보드별로 보존한다',
    );
  }
});

test('복제된 행 이름과 선택 문구가 달라도 leaf가 속한 전체 행을 클릭 대상으로 쓴다', () => {
  const row = { dataset: { name: '줄 · KOSPI' } };
  const leaf = {
    childElementCount: 0,
    textContent: '상승만',
    closest(selector) { return selector === '[data-name^="줄 ·"]' ? row : null; },
  };
  const surface = { querySelectorAll() { return [leaf]; } };
  assert.equal(controls.selectionOwner(surface, '상승만'), row);
});

test('상승과 하락 선택은 등락률 순위 보드의 정렬 기준을 바꾼다', () => {
  const base = controls.initialCriteria({});
  const up = controls.criteriaAfter(base, controls.selectionFor('4AGN-1', '상승만'));
  const down = controls.criteriaAfter(base, controls.selectionFor('4AGN-1', '하락만'));
  assert.equal(controls.targetFor({}, up, '2XKO-0').sort_tp, '1');
  assert.equal(controls.targetFor({}, down, '2XKO-0').sort_tp, '3');
  assert.match(controls.selectionFor('4ANS-1', '대형주').unavailable, /지원하지 않습니다/,
    '시가총액을 받지 않는 TR은 가짜 필터 대신 명시적인 미지원 응답을 낸다');
});

test('시간외에서 정규장 전환은 직전 정규장 정렬로 돌아간다', () => {
  assert.deepEqual(
    controls.transitionFor('정규장', '13K0-2', '2YNQ-0', '2X5N-0'),
    { boardId: '2X5N-0', criteria: { session: 'regular' } },
  );
  assert.deepEqual(
    controls.transitionFor('시간외 단일가', '2YNQ-0', '13K0-2', ''),
    { boardId: '2YNQ-0', criteria: { session: 'afterHours' } },
  );
  assert.deepEqual(
    controls.transitionFor('정규장', '13K0-2', '2YNQ-0', '2YNQ-0'),
    { boardId: '13K0-2', criteria: { session: 'regular' } },
    '처음부터 시간외 계약으로 열린 경우에도 정규장으로 돌아간다',
  );
});
