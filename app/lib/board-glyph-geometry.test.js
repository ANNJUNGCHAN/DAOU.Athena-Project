'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_READABILITY_BOARD_IDS,
  compactAtomicTokenSpans,
  hasInlineAmbiguity,
  collectAtomicWrapFindings,
  collectTextOverlapFindings,
  collectPairedSemanticFindings,
  assertReadability,
  assertReadabilityManifest,
  assertReadabilityMatrix,
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

function copiedRegions(t, boardId) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `athena-${boardId}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(
    __dirname, '..', '..', 'backend', 'ref', 'card-surface-templates', boardId, 'regions.json',
  );
  const target = path.join(directory, 'regions.json');
  fs.copyFileSync(source, target);
  return {
    regionsPath: target,
    boardHtml: fs.readFileSync(path.join(path.dirname(source), 'board.html'), 'utf8'),
  };
}

test('glyph geometry uses a strict greater-than-one-pixel overlap tolerance', () => {
  assert.equal(overlapArea(rect(0, 0, 10, 10), rect(8, 0, 18, 10), 1), 20);
  assert.equal(overlapArea(rect(0, 0, 10, 10), rect(9, 9, 19, 19), 1), 0);
  assert.equal(overlapArea(rect(0, 0, 10, 10), rect(9, 9, 19, 19), 1.01), 0);
});

test('legacy pair ambiguity requires same-line contact rather than mere visibility', () => {
  assert.equal(hasInlineAmbiguity(
    [rect(30, 0, 50, 12)], [rect(50, 0, 70, 12)],
  ), true);
  assert.equal(hasInlineAmbiguity(
    [rect(30, 0, 50, 12)], [rect(49, 0, 70, 12)],
  ), true);
  assert.equal(hasInlineAmbiguity(
    [rect(30, 0, 50, 12)], [rect(58, 0, 78, 12)],
  ), false);
  assert.equal(hasInlineAmbiguity(
    [rect(30, 0, 50, 12)], [rect(30, 14, 50, 26)],
  ), false);
  assert.equal(hasInlineAmbiguity(
    [rect(30, 0, 30, 12)], [rect(30, 0, 50, 12)],
  ), false);
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

test('compact Korean and money-unit tokens are measured without treating space wraps as fragmentation', () => {
  assert.deepEqual(compactAtomicTokenSpans('● 실시간 갱신'), [
    { text: '실시간', start: 2, end: 5 },
    { text: '갱신', start: 6, end: 8 },
  ]);
  assert.deepEqual(compactAtomicTokenSpans('100개 결과'), [
    { text: '100개', start: 0, end: 4 },
    { text: '결과', start: 5, end: 7 },
  ]);
  assert.deepEqual(compactAtomicTokenSpans('+3,214억원'), [
    { text: '+3,214억원', start: 0, end: 8 },
  ]);
  assert.deepEqual(compactAtomicTokenSpans('시간외 단일가'), [
    { text: '시간외', start: 0, end: 3 },
    { text: '단일가', start: 4, end: 7 },
  ]);
  assert.deepEqual(compactAtomicTokenSpans('https://example.com/very-long-token'), []);
  assert.deepEqual(compactAtomicTokenSpans('한'), []);
  assert.deepEqual(compactAtomicTokenSpans(
    '이 문장은 설명용 산문이므로 자동 atomic 후보가 아니다',
  ), []);

  const splitToken = collectAtomicWrapFindings([
    candidate('money', 'money', 'surface', [rect(0, 0, 30, 12), rect(0, 14, 8, 26)], {
      text: '+3,214억원', reason: 'compact_token',
    }),
  ]);
  assert.equal(splitToken.total, 1);
  assert.equal(splitToken.items[0].text, '+3,214억원');
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

test('legacy pairs fail only for measured same-line ambiguity, never merely for existing', () => {
  const result = collectPairedSemanticFindings([
    { kind: 'legacy_pair', source: 'hidden', hidden: true, ambiguous_inline: true },
    { kind: 'legacy_pair', source: 'separate-line', hidden: false, ambiguous_inline: false },
    { kind: 'legacy_pair', source: 'labeled', hidden: false, ambiguous_inline: true, label_found: true },
    { kind: 'legacy_pair', source: 'collision', hidden: false, ambiguous_inline: true, label_found: false },
  ]);

  assert.deepEqual(result.items, [
    { source: 'collision', violation: 'legacy_unlabeled_inline' },
  ]);
  assert.equal(result.total, 1);
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

test('readability assertion reports findings when optional and fails closed when enforced', () => {
  const atomicProbe = {
    atomic_wrap_nodes: [{ node: 'price' }],
    atomic_wrap_total: 1,
    text_overlap_nodes: [],
    text_overlap_total: 0,
    paired_semantics_violations: [],
    paired_semantics_total: 0,
  };
  assert.deepEqual(assertReadability('2R3M-1', { name: 'L' }, atomicProbe, { enforce: false }), {
    enforced: false,
    failures: ['atomic_wrap_nodes'],
  });
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, atomicProbe, { enforce: true }),
    /readability atomic_wrap_nodes/);

  const zeroProbe = {
    atomic_wrap_nodes: [], atomic_wrap_total: 0,
    text_overlap_nodes: [], text_overlap_total: 0,
    paired_semantics_violations: [], paired_semantics_total: 0,
  };
  for (const [boardId, label, field, totalField, finding] of [
    ['13K0-2', 'atomic', 'atomic_wrap_nodes', 'atomic_wrap_total', { node: 'chip' }],
    ['2QFO-2', 'overlap', 'text_overlap_nodes', 'text_overlap_total', { node: 'label' }],
    ['2SKU-1', 'paired', 'paired_semantics_violations', 'paired_semantics_total', {
      source: 'price', violation: 'stale_tone',
    }],
    ['13K0-2', 'scroll semantics', 'paired_semantics_violations', 'paired_semantics_total', {
      source: 'table', violation: 'scroll_missing_row',
    }],
  ]) {
    const probe = { ...zeroProbe, [field]: [finding], [totalField]: 1 };
    assert.throws(
      () => assertReadability(boardId, { name: label }, probe, { enforce: true }),
      /readability (atomic_wrap_nodes|text_overlap_nodes|paired_semantics_violations)/,
      label,
    );
  }

  assert.deepEqual(assertReadability('2R3M-1', { name: 'zero' }, zeroProbe, { enforce: true }), {
    enforced: true, failures: [],
  });
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, {}, { enforce: true }),
    /readability readability_schema/);
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, {
    atomic_wrap_nodes: [], atomic_wrap_total: 1,
    text_overlap_nodes: [], text_overlap_total: 0,
    paired_semantics_violations: [], paired_semantics_total: 0,
  }, { enforce: true }), /readability .*atomic_wrap_nodes/);
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, {
    ...zeroProbe, atomic_wrap_total: -1,
  }, { enforce: true }), /readability readability_schema/);
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, {
    ...zeroProbe, atomic_wrap_total: 0.5,
  }, { enforce: true }), /readability readability_schema/);
  assert.throws(() => assertReadability('2R3M-1', { name: 'L' }, {
    ...zeroProbe, atomic_wrap_nodes: Array.from({ length: 19 }, (_, index) => ({ index })),
    atomic_wrap_total: 21,
  }, { enforce: true }), /readability readability_schema/);
  assert.deepEqual(assertReadability('2R3M-1', { name: 'L' }, {
    ...zeroProbe, atomic_wrap_nodes: Array.from({ length: 20 }, (_, index) => ({ index })),
    atomic_wrap_total: 21,
  }, { enforce: false }), { enforced: false, failures: ['atomic_wrap_nodes'] });
});

test('temp manifest mutations cannot omit 2QGE flow or omit or mispoint the 13K table owner', (t) => {
  const { regionsPath: flowPath, boardHtml: flowHtml } = copiedRegions(t, '2QFO-2');
  const flow = JSON.parse(fs.readFileSync(flowPath, 'utf8'));
  assert.equal(assertReadabilityManifest(flow, flowHtml), true);
  flow.responsive = flow.responsive.filter((entry) => entry.node_id !== '2QGE-2');
  fs.writeFileSync(flowPath, `${JSON.stringify(flow)}\n`);
  assert.throws(
    () => assertReadabilityManifest(JSON.parse(fs.readFileSync(flowPath, 'utf8')), flowHtml),
    /2QGE-2.*flow/,
  );

  const { regionsPath: tablePath, boardHtml: tableHtml } = copiedRegions(t, '13K0-2');
  const original = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
  assert.equal(assertReadabilityManifest(original, tableHtml), true);
  for (const mutate of [
    (manifest) => { manifest.responsive = manifest.responsive.filter(
      (entry) => entry.node_id !== '33WD-0'); },
    (manifest) => { manifest.responsive.find(
      (entry) => entry.node_id === '33WD-0').node_id = '33Z2-0'; },
  ]) {
    const manifest = structuredClone(original);
    mutate(manifest);
    fs.writeFileSync(tablePath, `${JSON.stringify(manifest)}\n`);
    assert.throws(
      () => assertReadabilityManifest(JSON.parse(fs.readFileSync(tablePath, 'utf8')), tableHtml),
      /33WD-0.*scroll-table/,
    );
  }
  fs.copyFileSync(path.join(
    __dirname, '..', '..', 'backend', 'ref', 'card-surface-templates', '13K0-2', 'regions.json',
  ), tablePath);
  assert.equal(
    assertReadabilityManifest(JSON.parse(fs.readFileSync(tablePath, 'utf8')), tableHtml), true,
  );
});

test('the frozen readability manifests and generated markup have exact responsive parity', () => {
  for (const boardId of DEFAULT_READABILITY_BOARD_IDS) {
    const directory = path.join(
      __dirname, '..', '..', 'backend', 'ref', 'card-surface-templates', boardId,
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'regions.json'), 'utf8'));
    const html = fs.readFileSync(path.join(directory, 'board.html'), 'utf8');
    assert.equal(assertReadabilityManifest(manifest, html), true, boardId);
  }
});

test('G5 production manifests declare only the measured responsive owners and atomic leaves', () => {
  const readResponsive = (boardId) => JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', 'backend', 'ref', 'card-surface-templates', boardId, 'regions.json',
  ), 'utf8')).responsive || [];
  const traitsOf = (boardId) => new Map(readResponsive(boardId).map(
    (entry) => [entry.node_id, entry.traits],
  ));

  const ranking = traitsOf('13K0-2');
  for (const node of ['2WGY-0', '2WHL-0']) assert.deepEqual(ranking.get(node), ['flow']);
  for (const node of ['2WHJ-0', '2WHK-0', '2WHY-0', '2WI0-0', '2WI2-0']) {
    assert.deepEqual(ranking.get(node), ['atomic']);
  }

  const quote = traitsOf('2R3M-1');
  assert.deepEqual(quote.get('2R8O-1'), ['flow']);
  for (const node of ['2R8S-1', '358O-0', '358Q-0']) {
    assert.deepEqual(quote.get(node), ['atomic']);
  }
  assert.deepEqual(quote.get('3CRW-0'), ['paired-table']);

  // 2QFO-2는 flow 소유자를 쓰지 않는다. `.bs-r-flow > * { flex-shrink: 0 }`이 선언된
  // 세 행만 Paper 폭으로 얼려 헤더와 레인이 갈라졌다(960 실측). paired-table이
  // 같은 금액에 nowrap을 주면서 접힌 값에는 열 라벨을 붙인다.
  const flow = traitsOf('2QFO-2');
  for (const node of ['3751-0', '376G-0', '3789-0']) assert.equal(flow.get(node), undefined);
  for (const node of ['375E-0', '376R-0', '378K-0']) assert.deepEqual(flow.get(node), ['atomic']);
  assert.deepEqual(flow.get('2QH0-2'), ['paired-table']);
});

test('a DOM-like 13K chip shrink mutation becomes a two-line atomic hard failure', () => {
  const restored = collectAtomicWrapFindings([
    candidate('14JF-2', '14JF-2', '14JD-2', [rect(0, 0, 40, 12)]),
  ]);
  const shrunk = collectAtomicWrapFindings([
    candidate('14JF-2', '14JF-2', '14JD-2', [rect(0, 0, 20, 12), rect(0, 13, 20, 25)]),
  ]);
  const probe = (finding) => ({
    atomic_wrap_nodes: finding.items, atomic_wrap_total: finding.total,
    text_overlap_nodes: [], text_overlap_total: 0,
    paired_semantics_violations: [], paired_semantics_total: 0,
  });
  assert.deepEqual(assertReadability('13K0-2', { name: 'M' }, probe(restored), {
    enforce: true,
  }), { enforced: true, failures: [] });
  assert.throws(() => assertReadability('13K0-2', { name: 'M' }, probe(shrunk), {
    enforce: true,
  }), /readability atomic_wrap_nodes/);
});

test('a complete synthetic canonical zero report passes the enforced 6/24/12 matrix', () => {
  const stepPresets = [
    { name: 'original', width: 1920, height: 1080 },
    { name: 'split-2', width: 960, height: 1080 },
    { name: 'split-4', width: 640, height: 540 },
    { name: 'minimum', width: 480, height: 420 },
  ];
  const breakpointPresets = [
    { name: 'XL probe', width: 2560, height: 1440 },
    { name: 'M probe', width: 1600, height: 900 },
  ];
  const zeroRecord = (preset) => ({
    preset: preset.name,
    window: { width: preset.width, height: preset.height },
    atomic_wrap_nodes: [], atomic_wrap_total: 0,
    text_overlap_nodes: [], text_overlap_total: 0,
    paired_semantics_violations: [], paired_semantics_total: 0,
  });
  const boards = DEFAULT_READABILITY_BOARD_IDS.map((boardId) => ({
    board_id: boardId,
    steps: stepPresets.map(zeroRecord),
    breakpoint_probes: breakpointPresets.map(zeroRecord),
  }));
  let checked = 0;
  for (const board of boards) {
    for (const probe of [...board.steps, ...board.breakpoint_probes]) {
      assert.deepEqual(
        assertReadability(board.board_id, { name: probe.preset }, probe, { enforce: true }),
        { enforced: true, failures: [] },
      );
      checked += 1;
    }
  }
  assert.equal(boards.length, 6);
  assert.equal(checked, 36);
  assert.deepEqual(assertReadabilityMatrix(boards, {
    expectedBoardIds: DEFAULT_READABILITY_BOARD_IDS,
    stepPresets,
    breakpointPresets,
  }), { boards: 6, screenshots: 24, probes: 12, measurements: 36 });

  const incomplete = structuredClone(boards);
  incomplete[0].breakpoint_probes.pop();
  assert.throws(() => assertReadabilityMatrix(incomplete, {
    expectedBoardIds: DEFAULT_READABILITY_BOARD_IDS,
    stepPresets,
    breakpointPresets,
  }), /readability matrix/);
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
