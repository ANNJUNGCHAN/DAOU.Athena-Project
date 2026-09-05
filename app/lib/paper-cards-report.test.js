'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeMountLayer, mergeStaticLayer } = require('./paper-cards-report');

// PAPER-CARDS.json은 게이트 둘이 함께 쓰는 파일 하나다. 여기서 지키는 것은 둘이다 —
// 어느 쪽이 나중에 돌아도 상대 층 판정이 남는가(비파괴), 그리고 파일에 적힌 수치가
// 파일에 실제로 든 근거와 같은가(부분 실행이 전수를 참칭하지 않는가).

const staticReport = (over = {}) => ({
  gate: 'verify:paper-cards-static',
  generated_at: '2026-09-06T00:00:00.000Z',
  manifest_sha256: 'abc',
  gate_failures: [],
  static: { S2_text_multiset: { ok: false, failed_boards: ['2QM7-2'] } },
  boards: [
    {
      board_id: '2QM7-2',
      card_id: 'CC-05',
      name: '체결',
      status: 'fail',
      failures: [{ code: 'text_multiset_drift', layer: 'static' }],
    },
    { board_id: '137X-2', card_id: 'CC-03', name: '흐름', status: 'pass', failures: [] },
  ],
  ...over,
});

const runtime = (over = {}) => ({
  gate: 'verify:paper-cards-mount',
  generated_at: '2026-09-06T01:00:00.000Z',
  selection: { canonical: true, boards: 2 },
  presets: ['원본', '최소'],
  chunks: [{ card_id: 'CC-05', board_ids: ['2QM7-2'] }, { card_id: 'CC-03', board_ids: ['137X-2'] }],
  elapsed_ms: 20000,
  totals: { boards: 2, pass: 1, fail: 1 },
  boards: [
    {
      board_id: '2QM7-2',
      card_id: 'CC-05',
      status: 'pass',
      mount: { slot_count: 58, reachable_slot_count: 58, max_overflow_x: 0 },
    },
    {
      board_id: '137X-2',
      card_id: 'CC-03',
      status: 'fail',
      failures: [{ code: 'overflow_x', layer: 'mount', preset: '최소', overflow_x: 303 }],
    },
  ],
  ...over,
});

const codesOf = (report, boardId) => report.boards
  .find((board) => board.board_id === boardId).failures.map((failure) => `${failure.layer}:${failure.code}`);

test('두 층은 같은 보드 항목 하나에 layer로 섞여 담긴다 — §6.4가 읽는 배열은 boards[] 하나다', () => {
  const merged = mergeMountLayer(mergeStaticLayer(null, staticReport()), runtime());
  assert.equal(merged.boards.length, 2);
  assert.equal('runtime' in merged, false);
  assert.deepEqual(codesOf(merged, '2QM7-2'), ['static:text_multiset_drift']);
  assert.deepEqual(codesOf(merged, '137X-2'), ['mount:overflow_x']);
  // 정적으로 빨간 보드가 마운트에서 통과하면 측정값은 남되 상태는 fail 그대로다.
  const drifted = merged.boards.find((board) => board.board_id === '2QM7-2');
  assert.equal(drifted.status, 'fail');
  assert.equal(drifted.mount.slot_count, 58);
  assert.deepEqual(merged.totals, {
    boards: 2, pass: 0, fail: 2, static_fail: 1, mount_fail: 1, mount_measured: 2,
  });
});

test('정적 게이트를 다시 돌려도 마운트 판정은 안 지워진다 — 파일이 실행 순서에 안 흔들린다', () => {
  const afterMount = mergeMountLayer(mergeStaticLayer(null, staticReport()), runtime());
  const again = mergeStaticLayer(afterMount, staticReport());
  assert.deepEqual(codesOf(again, '137X-2'), ['mount:overflow_x']);
  assert.deepEqual(codesOf(again, '2QM7-2'), ['static:text_multiset_drift']);
  assert.equal(again.boards.find((board) => board.board_id === '2QM7-2').mount.slot_count, 58);
  assert.deepEqual(again.totals, afterMount.totals);
  assert.deepEqual(again.layers.mount, afterMount.layers.mount);
});

test('층은 자기 실패만 갈아 끼운다 — 재실행이 같은 실패를 두 번 적지 않는다', () => {
  const once = mergeStaticLayer(null, staticReport());
  const twice = mergeStaticLayer(once, staticReport());
  assert.deepEqual(codesOf(twice, '2QM7-2'), ['static:text_multiset_drift']);

  const green = staticReport({
    boards: [
      { board_id: '2QM7-2', card_id: 'CC-05', name: '체결', status: 'pass', failures: [] },
      { board_id: '137X-2', card_id: 'CC-03', name: '흐름', status: 'pass', failures: [] },
    ],
  });
  const fixed = mergeStaticLayer(once, green);
  assert.deepEqual(codesOf(fixed, '2QM7-2'), []);
  assert.equal(fixed.boards.find((board) => board.board_id === '2QM7-2').status, 'pass');
});

test('보드 명부의 주인은 정적 층이다 — 색인에서 빠진 보드는 리포트에서도 빠진다', () => {
  const merged = mergeMountLayer(mergeStaticLayer(null, staticReport()), runtime());
  const shrunk = mergeStaticLayer(merged, staticReport({ boards: [staticReport().boards[0]] }));
  assert.deepEqual(shrunk.boards.map((board) => board.board_id), ['2QM7-2']);
  assert.equal(shrunk.totals.boards, 1);
});

test('샤드 실행은 잰 보드만 갈아 끼우고 무엇을 쟀는지 적는다 — 94장의 근거는 그대로 남는다', () => {
  const full = mergeMountLayer(mergeStaticLayer(null, staticReport()), runtime());
  const shard = mergeMountLayer(full, runtime({
    generated_at: '2026-09-06T02:00:00.000Z',
    selection: { canonical: false, boards: 1 },
    chunks: [{ card_id: 'CC-05', board_ids: ['2QM7-2'] }],
    boards: [{
      board_id: '2QM7-2',
      card_id: 'CC-05',
      status: 'fail',
      failures: [{ code: 'slot_unreachable', layer: 'mount', preset: '최소' }],
    }],
  }));
  // 안 잰 보드의 이전 판정은 남는다.
  assert.deepEqual(codesOf(shard, '137X-2'), ['mount:overflow_x']);
  // 잰 보드는 이번 실행 값으로 갈린다 — 이전 마운트 통과 측정값은 사라진다.
  assert.deepEqual(codesOf(shard, '2QM7-2'), ['static:text_multiset_drift', 'mount:slot_unreachable']);
  assert.equal('mount' in shard.boards.find((board) => board.board_id === '2QM7-2'), false);
  assert.deepEqual(shard.layers.mount, {
    gate: 'verify:paper-cards-mount',
    generated_at: '2026-09-06T02:00:00.000Z',
    canonical: false,
    measured: 1,
    board_ids: ['2QM7-2'],
    presets: ['원본', '최소'],
    chunks: 1,
    elapsed_ms: 20000,
  });
  // 수치는 전부 파일에 실제로 든 근거를 센 값이다.
  assert.deepEqual(shard.totals, {
    boards: 2, pass: 0, fail: 2, static_fail: 1, mount_fail: 2, mount_measured: 2,
  });
});

test('안 돈 층의 칸은 0이 아니라 null이다 — 「안 쟀다」와 「재서 안 빨갛다」는 다른 말이다', () => {
  const staticOnly = mergeStaticLayer(null, staticReport());
  assert.equal(staticOnly.totals.mount_fail, null);
  assert.equal(staticOnly.totals.mount_measured, 0);
  assert.equal(staticOnly.totals.static_fail, 1);
  assert.equal('mount' in staticOnly.layers, false);

  const mountOnly = mergeMountLayer(null, runtime());
  assert.equal(mountOnly.totals.static_fail, null);
  assert.equal(mountOnly.totals.mount_fail, 1);
  assert.equal(mountOnly.static, null);
  // 정적 층이 아직 안 돈 보드도 마운트 근거를 잃지 않는다.
  assert.deepEqual(mountOnly.boards.map((board) => board.board_id), ['2QM7-2', '137X-2']);
});

test('스키마가 다른 옛 파일은 껍데기로 갈아탄다 — 남의 형상을 이어받지 않는다', () => {
  const stale = { schema_version: 0, boards: [{ board_id: '옛', failures: [] }], runtime: {} };
  const merged = mergeStaticLayer(stale, staticReport());
  assert.deepEqual(merged.boards.map((board) => board.board_id), ['2QM7-2', '137X-2']);
  assert.equal('runtime' in merged, false);
  assert.equal(merged.schema_version, 1);
});
