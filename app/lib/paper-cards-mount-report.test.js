'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MOUNT_FAILURE_CODES,
  boardMountRecord,
  diffTextMultiset,
  domTextMultiset,
  formatMountCliReport,
  groupBoardsByCard,
  mountFailures,
  uniqueStateControls,
} = require('./paper-cards-mount-report');

// 창 없이 재는 부분만 본다 — 청크 묶기, 다중집합 3분류, 폭 하나의 실패 판정,
// 보드 항목 형상, CLI 출력. 두 층을 한 파일에 얹는 병합은 paper-cards-report.test.js.

const probe = (over = {}) => ({
  overflow_x: 0,
  overflow_nodes: [],
  vertical_overflow_nodes: [],
  vertical_overlap_nodes: [],
  slot_multiset: ['a|1', 'b|1'],
  reachable_slot_count: 2,
  state_boards_in_dom: 0,
  dom_text: [['내 계좌', 1], ['내 계좌', 1]],
  dom_text_primary: [['내 계좌', 1]],
  ...over,
});
const step = (over = {}) => ({
  preset: '최소',
  probe: probe(),
  expectedTextMultiset: { '내 계좌': 1 },
  expectedStateBoards: 0,
  ...over,
});

test('실패 어휘는 §3.7 마운트 층 폐쇄집합에 surface_geometry 하나만 더한 얼어붙은 목록이다', () => {
  assert.equal(Object.isFrozen(MOUNT_FAILURE_CODES), true);
  assert.deepEqual([...MOUNT_FAILURE_CODES], [
    'mount_failed', 'overflow_x', 'surface_geometry',
    'state_board_missing_in_dom', 'slot_unreachable', 'text_multiset_dom_mismatch',
  ]);
});

test('보드는 카드 순서대로 청크가 되고 색인에 없는 보드는 즉시 실패한다', () => {
  const cardIdOf = (boardId) => ({ A: 'CC-01', B: 'CC-03', C: 'CC-01' })[boardId] || null;
  assert.deepEqual(groupBoardsByCard(['A', 'B', 'C'], cardIdOf), [
    { card_id: 'CC-01', board_ids: ['A', 'C'] },
    { card_id: 'CC-03', board_ids: ['B'] },
  ]);
  assert.throws(() => groupBoardsByCard(['Z'], cardIdOf), /카드 색인에 없는 보드/);
});

test('다중집합 차이는 added(DOM에만)·removed(slots에만)·count_changed로 갈린다', () => {
  const drift = diffTextMultiset(
    { 같음: 1, 슬롯에만: 2, 개수다름: 3 },
    { 같음: 1, DOM에만: 1, 개수다름: 4 },
  );
  assert.deepEqual(drift.added, [{ text: 'DOM에만', count: 1 }]);
  assert.deepEqual(drift.removed, [{ text: '슬롯에만', count: 2 }]);
  assert.deepEqual(drift.count_changed, [{ text: '개수다름', slots: 3, dom: 4 }]);
});

test('dom_text 쌍 배열은 다중집합 객체로 되돌아간다', () => {
  assert.deepEqual(domTextMultiset([['가', 2], ['나', 1]]), { 가: 2, 나: 1 });
  assert.deepEqual(domTextMultiset(undefined), {});
});

test('다 맞은 폭은 실패를 하나도 내지 않는다 — 병기 줄이 같은 글자를 겹쳐 그려도 그렇다', () => {
  // dom_text는 병기 줄까지 세어 「내 계좌」가 2개지만 판정은 dom_text_primary를 본다.
  assert.deepEqual(mountFailures(step()), []);
});

test('가로로 넘친 폭은 overflow_x로, 그 밖의 기하 위반은 surface_geometry로 갈린다', () => {
  const wide = mountFailures(step({
    probe: probe({ overflow_x: 14, overflow_nodes: [{ name: 'flow-table', over: 14 }] }),
    geometryError: 'board 2QM7-2 최소: surface overflow 14px',
  }));
  assert.deepEqual(wide.map((item) => item.code), ['overflow_x']);
  assert.equal(wide[0].overflow_x, 14);
  assert.equal(wide[0].nodes.length, 1);

  const vertical = mountFailures(step({
    probe: probe({ vertical_overlap_nodes: [{ name: 'kpi' }] }),
    geometryError: 'board 2QM7-2 최소: vertical sibling overlap',
  }));
  assert.deepEqual(vertical.map((item) => item.code), ['surface_geometry']);
  assert.match(vertical[0].error, /vertical sibling overlap/);
});

test('슬롯이 화면에 못 닿거나 상태 보드가 DOM에 안 찍히면 각각 제 코드로 남는다', () => {
  const unreachable = mountFailures(step({ probe: probe({ reachable_slot_count: 1 }) }));
  assert.deepEqual(unreachable.map((item) => item.code), ['slot_unreachable']);
  assert.deepEqual(
    { slot_count: unreachable[0].slot_count, reachable: unreachable[0].reachable_slot_count },
    { slot_count: 2, reachable: 1 },
  );

  const missing = mountFailures(step({ expectedStateBoards: 3, probe: probe({ state_boards_in_dom: 2 }) }));
  assert.deepEqual(missing.map((item) => item.code), ['state_board_missing_in_dom']);
  assert.equal(missing[0].expected, 3);
  assert.equal(missing[0].in_dom, 2);
});

test('상태 링크 기대치는 조작 문구 수이지 대상 보드 수가 아니다', () => {
  const { stateLinksFromMarks } = require('./board-mount');
  const slots = JSON.parse(require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'backend', 'ref', 'card-surface-templates', '137X-2', 'slots.json'),
    'utf8',
  ));
  const links = stateLinksFromMarks(slots.state_controls);
  assert.equal(links.length, 7);
  assert.equal(uniqueStateControls(links), 6);
  assert.equal(
    mountFailures(step({ expectedStateBoards: uniqueStateControls(links), probe: probe({ state_boards_in_dom: 6 }) })).length,
    0,
  );
});

test('실데이터 마운트는 Paper 원문 다중집합을 맞대지 않는다', () => {
  const failures = mountFailures(step({ expectedTextMultiset: null, probe: probe({ dom_text_primary: [['삼성전자', 1]] }) }));
  assert.equal(failures.some((item) => item.code === 'text_multiset_dom_mismatch'), false);
});

test('DOM 텍스트가 slots.json과 다르면 어느 글자가 왜 다른지까지 남는다', () => {
  const failures = mountFailures(step({ probe: probe({ dom_text_primary: [['체결강도', 1]] }) }));
  assert.deepEqual(failures.map((item) => item.code), ['text_multiset_dom_mismatch']);
  assert.deepEqual(failures[0].added, [{ text: '체결강도', count: 1 }]);
  assert.deepEqual(failures[0].removed, [{ text: '내 계좌', count: 1 }]);
  assert.equal(failures[0].preset, '최소');
});

test('통과한 보드는 잰 값을, 실패한 보드는 실패 목록만 남긴다', () => {
  const steps = [
    { preset: '원본', distinct_text_count: 124, slot_count: 138, reachable_slot_count: 138, overflow_x: 0, state_boards_in_dom: 6 },
    { preset: '최소', distinct_text_count: 124, slot_count: 138, reachable_slot_count: 138, overflow_x: 1, state_boards_in_dom: 6 },
  ];
  assert.deepEqual(boardMountRecord({ board_id: '137X-2', card_id: 'CC-03', steps, failures: [] }), {
    board_id: '137X-2',
    card_id: 'CC-03',
    status: 'pass',
    mount: {
      distinct_text_count: 124, slot_count: 138, reachable_slot_count: 138,
      max_overflow_x: 1, state_boards_in_dom: 6,
    },
  });
  const failed = boardMountRecord({
    board_id: '2QM7-2', card_id: 'CC-05', steps, failures: [{ code: 'overflow_x', layer: 'mount', preset: '최소' }],
  });
  assert.equal(failed.status, 'fail');
  assert.equal('mount' in failed, false);
});

const runtime = (over = {}) => ({
  gate: 'verify:paper-cards-mount',
  generated_at: '2026-09-06T00:00:00.000Z',
  selection: { canonical: true, boards: 2 },
  presets: ['원본', '최소'],
  chunks: [{ card_id: 'CC-05', board_ids: ['2QM7-2', '137X-2'] }],
  elapsed_ms: 12000,
  totals: { boards: 2, pass: 1, fail: 1 },
  boards: [
    { board_id: '2QM7-2', card_id: 'CC-05', status: 'fail', failures: [{ code: 'overflow_x', layer: 'mount', preset: '최소' }] },
    { board_id: '137X-2', card_id: 'CC-03', status: 'pass', mount: {} },
  ],
  ...over,
});

test('CLI는 빨간 보드를 코드와 함께 줄로 적고 exit 1을 돌려준다', () => {
  const { exitCode, lines } = formatMountCliReport(runtime(), 'app/captures/paper-gates/PAPER-CARDS.json');
  assert.equal(exitCode, 1);
  assert.match(lines[0], /보드 2장 · 통과 1 · 실패 1/);
  assert.ok(lines.some((line) => line.includes('FAIL 2QM7-2 (CC-05) — overflow_x')));

  const green = formatMountCliReport(
    runtime({ totals: { boards: 1, pass: 1, fail: 0 }, boards: [{ board_id: '137X-2', card_id: 'CC-03', status: 'pass', mount: {} }] }),
    'app/captures/paper-gates/PAPER-CARDS.json',
  );
  assert.equal(green.exitCode, 0);
  assert.equal(green.lines.at(-1), 'paper cards mount verification passed');
});

test('샤드 실행은 CLI 첫 줄에 그렇다고 적는다', () => {
  const { lines } = formatMountCliReport(runtime({ selection: { canonical: false, boards: 2 } }), 'x.json');
  assert.match(lines[0], /샤드 실행/);
});
