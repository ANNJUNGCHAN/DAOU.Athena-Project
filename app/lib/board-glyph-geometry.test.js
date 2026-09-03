'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_READABILITY_BOARD_IDS,
  collectAtomicWrapFindings,
  collectTextOverlapFindings,
  collectPairedSemanticFindings,
  assertReadability,
  visualLineCount,
  overlapArea,
  waitForStableLayout,
} = require('./board-glyph-geometry');

const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const candidate = (node, owner, layoutOwner, fragments, extra = {}) => ({
  node,
  name: node,
  owner,
  layout_owner: layoutOwner,
  layout_item: layoutOwner,
  fragments,
  ...extra,
});

test('glyph geometry uses a strict greater-than-one-pixel overlap tolerance', () => {
  assert.equal(overlapArea(rect(0, 0, 10, 10), rect(8, 0, 18, 10), 1), 20);
  assert.equal(overlapArea(rect(0, 0, 10, 10), rect(9, 9, 19, 19), 1), 0);
  assert.equal(overlapArea(rect(0, 0, 10, 10), rect(9, 9, 19, 19), 1.01), 0);
});

test('atomic visual lines dedupe fragments and ignore hidden or zero-area fragments', () => {
  const fragments = [
    rect(0, 0, 30, 12),
    rect(0, 0, 30, 12),
    rect(0, 14, 30, 26),
    { ...rect(0, 28, 30, 28) },
    { ...rect(0, 42, 30, 54), hidden: true },
  ];
  assert.equal(visualLineCount(fragments), 2);
  const findings = collectAtomicWrapFindings([
    candidate('price', 'price', 'row', fragments, { text: '151,000', owner_name: '현재가' }),
    candidate('hidden', 'hidden', 'row', [rect(0, 0, 10, 10)], { hidden: true }),
  ]);
  assert.equal(findings.total, 1);
  assert.deepEqual(findings.items.map((item) => item.node), ['price']);
  assert.deepEqual(findings.items[0], {
    node: 'price', name: 'price', owner: 'price', owner_name: '현재가', text: '151,000',
    layout_owner: 'row', line_count: 2,
    fragments: [rect(0, 0, 30, 12), rect(0, 14, 30, 26)],
  });
});

test('text-overlap excludes duplicate, hidden, same-owner, ancestor, and different-layout candidates', () => {
  const shared = rect(0, 0, 20, 20);
  const findings = collectTextOverlapFindings([
    candidate('first', 'first', 'row', [shared], { layout_item: 'first-item' }),
    candidate('duplicate-fragment', 'first', 'row', [shared], { layout_item: 'first-item' }),
    candidate('hidden', 'hidden', 'row', [shared], { hidden: true }),
    candidate('ancestor', 'ancestor', 'row', [rect(100, 0, 120, 20)]),
    candidate('child', 'child', 'row', [rect(100, 0, 120, 20)], { ancestors: ['ancestor'] }),
    candidate('other-layout', 'other-layout', 'other-row', [rect(0, 0, 20, 20)]),
    candidate('second', 'second', 'row', [rect(5, 5, 25, 25)], { layout_item: 'second-item' }),
  ]);
  assert.equal(findings.total, 1);
  assert.deepEqual(findings.items.map((item) => [item.first_node, item.second_node]), [
    ['first', 'second'],
  ]);
});

test('text overlap compares distinct rendered items under one responsive owner', () => {
  const overlapping = [rect(0, 0, 20, 20)];
  const findings = collectTextOverlapFindings([
    candidate('left', 'left', 'responsive-row', overlapping, { layout_item: 'first-item' }),
    candidate('right', 'right', 'responsive-row', overlapping, { layout_item: 'second-item' }),
    candidate('inside-a', 'inside-a', 'responsive-row', [rect(100, 0, 120, 20)], { layout_item: 'shared-item' }),
    candidate('inside-b', 'inside-b', 'responsive-row', [rect(105, 5, 125, 25)], { layout_item: 'shared-item' }),
  ]);
  assert.equal(findings.total, 1);
  assert.deepEqual(findings.items.map((item) => [item.first_node, item.second_node]), [
    ['left', 'right'],
  ]);
  assert.deepEqual(
    Object.keys(findings.items[0]).filter((key) => /(?:name|text)$/.test(key)).sort(),
    ['first_name', 'first_text', 'second_name', 'second_text'],
  );
});

test('text overlap unions every terminal fragment owned by the same rendered item', () => {
  const findings = collectTextOverlapFindings([
    candidate('compound', 'compound-owner', 'row', [rect(0, 0, 10, 10)], {
      layout_item: 'compound-item', text: 'first',
    }),
    candidate('compound', 'compound-owner', 'row', [rect(40, 0, 55, 10)], {
      layout_item: 'compound-item', text: 'second',
    }),
    candidate('sibling', 'sibling-owner', 'row', [rect(45, 0, 65, 10)], {
      layout_item: 'sibling-item', text: 'sibling',
    }),
  ]);

  assert.equal(findings.total, 1);
  assert.deepEqual(
    findings.items.map((item) => [item.first_node, item.second_node]),
    [['compound', 'sibling']],
  );
  assert.equal(findings.items[0].first_text, 'first second');
});

test('findings sort deterministically and preserve total-before-cap semantics', () => {
  const result = collectAtomicWrapFindings([
    candidate('z', 'z', 'row', [rect(0, 20, 10, 30), rect(0, 40, 10, 50)]),
    candidate('a', 'a', 'row', [rect(0, 0, 10, 10), rect(0, 12, 10, 22)]),
  ], { cap: 1 });
  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((item) => item.node), ['a']);
});

test('paired semantics keep total violations before the report cap', () => {
  const result = collectPairedSemanticFindings([
    { source: 'value-a', source_found: false, mirror_has_identity: true, label_found: false },
    { source: 'value-b', source_found: true, mirror_has_identity: false, label_found: true,
      source_text: '10', mirror_text: '11' },
  ], { cap: 1 });
  assert.equal(result.total, 4);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source, 'value-a');
});

test('paired semantics reject duplicate sources or labels and stale tone or missing state', () => {
  const result = collectPairedSemanticFindings([
    {
      source: 'duplicate-source', source_found: true, source_count: 2,
      mirror_has_identity: false, label_found: true, label_count: 1,
      source_text: '10', mirror_text: '10', source_tone: 'up', mirror_tone: 'up',
      source_missing: false, mirror_missing: false,
    },
    {
      source: 'duplicate-label', source_found: true, source_count: 1,
      mirror_has_identity: false, label_found: true, label_count: 2,
      source_text: '20', mirror_text: '20', source_tone: 'down', mirror_tone: 'up',
      source_missing: true, mirror_missing: false,
    },
  ]);

  assert.deepEqual(result.items, [
    { source: 'duplicate-label', violation: 'duplicate_label' },
    { source: 'duplicate-label', violation: 'stale_missing' },
    { source: 'duplicate-label', violation: 'stale_tone' },
    { source: 'duplicate-source', violation: 'duplicate_source' },
  ]);
  assert.equal(result.total, 4);
});

test('paired semantics reports visible legacy mirrors but ignores hidden ones', () => {
  const legacy = {
    source: '', source_found: false, mirror_has_identity: true, label_found: false,
  };
  const result = collectPairedSemanticFindings([
    { ...legacy, hidden: true },
    { ...legacy, hidden: false },
  ]);

  assert.equal(result.total, 3);
  assert.deepEqual(result.items.map((item) => item.violation), [
    'mirror_has_mount_identity', 'missing_label', 'missing_source',
  ]);
});

test('paired semantic report carries malformed scroll-table role findings', () => {
  const result = collectPairedSemanticFindings([{
    kind: 'scroll_table', source: 'settlement-table', hidden: false,
    violations: [
      'scroll_bad_column_role', 'scroll_control_not_focusable',
      'scroll_control_role_conflict', 'scroll_missing_row',
    ],
  }]);

  assert.deepEqual(result.items, [
    { source: 'settlement-table', violation: 'scroll_bad_column_role' },
    { source: 'settlement-table', violation: 'scroll_control_not_focusable' },
    { source: 'settlement-table', violation: 'scroll_control_role_conflict' },
    { source: 'settlement-table', violation: 'scroll_missing_row' },
  ]);
  assert.equal(result.total, 4);
});

test('readability assertion is report-only until explicitly enforced', () => {
  const probe = {
    atomic_wrap_nodes: [{ node: 'price' }],
    atomic_wrap_total: 1,
    text_overlap_nodes: [],
    text_overlap_total: 0,
    paired_semantics_violations: [],
    paired_semantics_total: 0,
  };
  assert.deepEqual(assertReadability('2R3M-1', { name: 'L' }, probe, { enforce: false }), {
    enforced: false,
    failures: ['atomic_wrap_nodes'],
  });
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, probe, { enforce: true }),
    /readability atomic_wrap_nodes/);
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, {}, { enforce: true }),
    /readability readability_schema/);
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, {
    atomic_wrap_nodes: [], atomic_wrap_total: 1,
    text_overlap_nodes: [], text_overlap_total: 0,
    paired_semantics_violations: [], paired_semantics_total: 0,
  }, { enforce: true }), /readability .*atomic_wrap_nodes/);
});

test('the frozen diagnostic board set keeps the exact six-board order', () => {
  assert.deepEqual(DEFAULT_READABILITY_BOARD_IDS, [
    '2SKU-1', '2R3M-1', '13BC-2', '2QFO-2', '13K0-2', '135M-2',
  ]);
  assert.equal(Object.isFrozen(DEFAULT_READABILITY_BOARD_IDS), true);
});

test('stable layout falls back to timer ticks when animation frames never fire', async () => {
  const result = await waitForStableLayout({
    readSignature: () => '0:0:640:540:640:540',
    requestFrame: () => null,
    cancelFrame: () => {},
    deadlineMs: 100,
    timerMs: 1,
    requiredStableSamples: 2,
  });
  assert.equal(result.tick_source, 'timer');
  assert.equal(result.timed_out, false);
  assert.equal(result.signature, '0:0:640:540:640:540');
});

test('stable layout rejects instead of reporting stable when its full geometry signature keeps changing', async () => {
  let sample = 0;
  await assert.rejects(waitForStableLayout({
    readSignature: () => `0:0:${640 + sample++}:540:640:540`,
    requestFrame: (callback) => setTimeout(callback, 0),
    cancelFrame: clearTimeout,
    deadlineMs: 100,
    timerMs: 10,
    maxSamples: 4,
    requiredStableSamples: 2,
  }), /layout did not stabilize/);
});

test('stable layout rejects an overdue stable frame even before the queued deadline callback runs', async () => {
  let clock = 0;
  const frames = [];
  const timers = [];
  const pending = waitForStableLayout({
    readSignature: () => '0:0:640:540:640:540',
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: () => {},
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
    now: () => clock,
    deadlineMs: 1000,
    timerMs: 50,
    requiredStableSamples: 1,
  });

  assert.equal(frames.length, 1);
  assert.equal(timers.some((timer) => timer.delay === 1000), true);
  clock = 4001;
  frames.shift()();

  await assert.rejects(pending, /layout did not stabilize within 1000ms/);
});

test('stable layout rejects fonts that resolve after the absolute deadline before their timeout callback runs', async () => {
  let clock = 0;
  let resolveFonts;
  const timers = [];
  const fontsReady = new Promise((resolve) => {
    resolveFonts = resolve;
  });
  const pending = waitForStableLayout({
    fontsReady,
    readSignature: () => '0:0:640:540:640:540',
    requestFrame: () => null,
    cancelFrame: () => {},
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimer: () => {},
    now: () => clock,
    deadlineMs: 1000,
  });

  assert.equal(timers.some((timer) => timer.delay === 1000), true);
  clock = 4001;
  resolveFonts();

  await assert.rejects(pending, /fonts did not settle within 1000ms/);
});
