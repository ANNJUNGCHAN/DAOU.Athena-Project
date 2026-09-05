'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BOARD_WINDOW_PRESETS,
  CARD_KIND,
  assertSurfaceGeometry,
  boardInstanceId,
  boardStepProbe,
  loadRealBoardContract,
} = require('./board-probe');

// electron 창이 없어도 재는 부분만 본다 — 창 4종·kind 표·인스턴스 id 규칙,
// 기하 판정, 프로브 원문 생성, 원장 템플릿에서 계약을 읽는 것.

const preset = (name) => BOARD_WINDOW_PRESETS.find((item) => item.name === name);
const probe = (over = {}) => ({
  overflow_x: 0,
  overflow_nodes: [],
  vertical_overflow_nodes: [],
  vertical_overlap_nodes: [],
  scroll_tables: [],
  ...over,
});
const scrollTable = (over = {}) => ({
  node: 'flow-table',
  scroll_width: 720,
  client_width: 400,
  scroll_state_controls: [],
  violations: [],
  ...over,
});

test('창 4종은 원본에서 최소까지 폭이 줄어드는 얼어붙은 목록이다', () => {
  assert.equal(Object.isFrozen(BOARD_WINDOW_PRESETS), true);
  assert.deepEqual(BOARD_WINDOW_PRESETS.map((item) => item.name), ['원본', '2분할', '4분할', '최소']);
  const widths = BOARD_WINDOW_PRESETS.map((item) => item.width);
  assert.deepEqual(widths, [...widths].sort((a, b) => b - a));
  assert.equal(new Set(widths).size, widths.length);
});

test('CARD_KIND는 카드 6종을 하나도 빠짐없이 잇는다', () => {
  assert.deepEqual(Object.keys(CARD_KIND), ['CC-01', 'CC-02', 'CC-03', 'CC-04', 'CC-05', 'CC-06']);
  assert.equal(CARD_KIND['CC-05'], 'flow');
  assert.equal(Object.isFrozen(CARD_KIND), true);
});

test('boardInstanceId는 대문자 보드 id를 소문자 키로 만든다', () => {
  assert.equal(boardInstanceId('13BC-2'), 'board-13bc-2');
  assert.equal(boardInstanceId('fixture-quote'), 'board-fixture-quote');
});

test('가로 넘침은 1px까지 봐주고 그 위는 실패한다', () => {
  assert.doesNotThrow(() => assertSurfaceGeometry('13BC-2', preset('원본'), probe({ overflow_x: 1 })));
  assert.throws(
    () => assertSurfaceGeometry('13BC-2', preset('원본'), probe({
      overflow_x: 14,
      overflow_nodes: [{ node: '3F2A-1', over: 14 }],
    })),
    /13BC-2 원본: surface overflow 14px/,
  );
});

test('세로 넘침·형제 겹침은 실패이되 XL 프로브에서는 재지 않는다', () => {
  const overflowing = probe({ vertical_overflow_nodes: [{ node: '3F2A-1', over: 9 }] });
  const overlapping = probe({ vertical_overlap_nodes: [{ parent: 'p', overlap: 4 }] });
  assert.throws(
    () => assertSurfaceGeometry('2SKU-1', preset('최소'), overflowing),
    /vertical content overflow/,
  );
  assert.throws(
    () => assertSurfaceGeometry('2SKU-1', preset('최소'), overlapping),
    /vertical sibling overlap/,
  );
  const xl = { name: 'XL 프로브', width: 2560, height: 1440 };
  assert.doesNotThrow(() => assertSurfaceGeometry('2SKU-1', xl, overflowing));
  assert.doesNotThrow(() => assertSurfaceGeometry('2SKU-1', xl, overlapping));
});

test('초점을 못 받는 스크롤 상태 컨트롤은 어느 단계에서도 실패다', () => {
  const withControl = probe({
    scroll_tables: [scrollTable({
      scroll_state_controls: [{ node: '3F2A-1', focusable: false }],
    })],
  });
  assert.throws(
    () => assertSurfaceGeometry('13K0-2', preset('원본'), withControl),
    /scroll_control_not_focusable/,
  );
});

test('좁은 두 단계에서는 스크롤 표가 실제로 넘쳐야 한다', () => {
  const notScrollable = probe({ scroll_tables: [scrollTable({ scroll_width: 400, client_width: 400 })] });
  assert.doesNotThrow(() => assertSurfaceGeometry('13K0-2', preset('원본'), notScrollable));
  assert.doesNotThrow(() => assertSurfaceGeometry('13K0-2', preset('2분할'), notScrollable));
  for (const name of ['4분할', '최소']) {
    assert.throws(
      () => assertSurfaceGeometry('13K0-2', preset(name), notScrollable),
      /scroll_not_scrollable/,
    );
  }
});

test('boardStepProbe는 인스턴스 키를 박은 실행 가능한 식을 만든다', () => {
  const source = boardStepProbe('board-13bc-2');
  assert.match(source, /data-integrated-instance-key="view:board-13bc-2"/);
  for (const helper of [
    'countVisualRows', 'compactAtomicTokenSpans', 'collectGlyphFindings', 'hasInlineAmbiguity',
  ]) {
    assert.match(source, new RegExp(`const ${helper} = function|const ${helper} = \\(`));
  }
  // 렌더러가 executeJavaScript로 삼키는 원문이라 문법이 깨지면 그때서야 죽는다.
  assert.doesNotThrow(() => new Function(`return ${source};`)); // eslint-disable-line no-new-func
});

test('loadRealBoardContract는 넘겨받은 템플릿 뿌리에서 paper_text만 계약에 싣는다', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const boardDir = path.join(root, '13BC-2');
  fs.mkdirSync(boardDir);
  fs.writeFileSync(path.join(boardDir, 'slots.json'), JSON.stringify({
    board_id: '13BC-2',
    card_id: 'CC-03',
    column_priority: ['1', '4'],
    section_titles_ko: { primary: '시세' },
    state_controls: { marks: [{ control: '일별', boards: ['2QFO-2'] }] },
    slots: [
      { slot_id: 'header.price', paper_text: '150,850' },
      { slot_id: 'header.change', paper_text: '' },
      { slot_id: 'header.volume' },
    ],
  }));
  fs.writeFileSync(path.join(boardDir, 'regions.json'), JSON.stringify({ responsive: [] }));
  fs.writeFileSync(path.join(boardDir, 'board.html'), '<div class="bs-surface"></div>');

  const surface = loadRealBoardContract('13BC-2', 3, root);
  assert.equal(surface.boardId, '13BC-2');
  assert.equal(surface.instanceId, 'board-13bc-2');
  assert.equal(surface.ordinal, 3);
  assert.equal(surface.operationRef, 'base:board-surface');
  assert.deepEqual(surface.realtimeBindings, []);
  assert.equal(surface.slotCount, 3);
  assert.equal(surface.boundCount, 1);
  assert.deepEqual(surface.contract.slot_values, { 'header.price': '150,850' });
  assert.equal(surface.contract.surface_version, 'card-surface.v1');
  assert.equal(surface.contract.card_id, 'CC-03');
  assert.deepEqual(surface.contract.column_priority, ['1', '4']);
  assert.deepEqual(surface.contract.section_titles_ko, { primary: '시세' });
  assert.deepEqual(surface.contract.state_boards, [{ control: '일별', board_id: '2QFO-2' }]);
});

test('loadRealBoardContract는 다른 뿌리를 넘기면 그 뿌리를 찾는다', () => {
  const missing = path.join(os.tmpdir(), 'board-probe-absent-root');
  assert.throws(() => loadRealBoardContract('13BC-2', 1, missing), /ENOENT/);
});
