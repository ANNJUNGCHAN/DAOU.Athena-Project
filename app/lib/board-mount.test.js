'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  collapsePlan, mountPlan, pairedGroups, nodeIndex, applyPlan, setHidden, isValueSlot,
  hoistLayout, applyResponsiveHooks, RESPONSIVE_REGIONS, HOISTED_PROPERTIES, primaryMountPoint,
  collapsePrimaryMockup, restorePrimaryMockup,
  createLatestBoardLoad, nextHydrationSlots,
  slotValueEntries, realtimeSlotIndex, updateRealtimeValue, pairedClosure, realtimePlan, applyRealtimeSlots,
  stateLinksFromMarks, stateControlActivationOwner, wireStateControlActivation,
  findStateControlNode, STATE_CONTROL_SCOPES,
} = require('./board-mount');
const { formatSlot } = require('./board-format');
const registry = require('./board-template-registry');
const {
  assertReadability, collectPairedSemanticFindings,
} = require('./board-glyph-geometry');

// jsdom 없이 검증한다 — ranking-axis.test.js와 같은 관행(DOM 스텁 주입).
// board-mount의 DOM 쓰기 층이 실제로 건드리는 표면만 흉내낸다:
// querySelectorAll / dataset / textContent / style / hidden / addEventListener.
const SELECTORS = {
  '*': () => true,
  '[data-node]': (node) => node.dataset.node !== undefined,
  '[data-paired-source]': (node) => node.dataset.pairedSource !== undefined,
};
function attrSelector(selector) {
  const klass = /^\.([\w-]+)$/.exec(selector);
  if (klass) return (node) => String(node.className).split(/\s+/).includes(klass[1]);
  const match = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector);
  if (!match) return SELECTORS[selector] || (() => false);
  const key = match[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  return (node) => node.dataset[key] === match[2];
}

function el(dataset = {}, children = [], className = '') {
  const node = {
    dataset: { ...dataset },
    className,
    style: {},
    hidden: false,
    textContent: '',
    children,
    listeners: [],
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    click() { this.listeners.filter((l) => l.type === 'click').forEach((l) => l.fn({})); },
    querySelectorAll(selector) {
      const test_ = attrSelector(selector);
      const found = [];
      const walk = (current) => {
        for (const child of current.children) {
          if (test_(child)) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    },
  };
  return node;
}

function pairedReadabilityProbe(source, mirror, pairContainer) {
  const labels = pairContainer ? pairContainer.children.filter((element) => (
    element.dataset.pairedLabel !== undefined && element.textContent.trim()
  )) : [];
  const finding = collectPairedSemanticFindings([{
    source: mirror.dataset.pairedSource,
    source_found: Boolean(source),
    source_count: source ? 1 : 0,
    mirror_has_identity: Boolean(
      mirror.dataset.node || mirror.dataset.slotId || mirror.dataset.leaf,
    ),
    label_found: labels.length > 0,
    label_count: labels.length,
    source_text: source && source.textContent,
    mirror_text: mirror.textContent,
    source_tone: source && source.style.color,
    mirror_tone: mirror.style.color,
    source_missing: Boolean(source && source.dataset.missing),
    mirror_missing: Boolean(mirror.dataset.missing),
  }]);
  return {
    atomic_wrap_nodes: [], atomic_wrap_total: 0,
    text_overlap_nodes: [], text_overlap_total: 0,
    paired_semantics_violations: finding.items,
    paired_semantics_total: finding.total,
    column_lane_nodes: [], column_lane_total: 0,
  };
}

function fixtureContract() {
  return {
    slots: [
      { slot_id: 'header.price', node: 'header.price', format: { kind: 'number' } },
      { slot_id: 'header.change', node: 'header.change', paired_with: 'header.price', format: { kind: 'number', sign: true, tone: 'signed' } },
      { slot_id: 'header.rate', node: 'header.rate', paired_with: 'header.price', format: { kind: 'percent', sign: true, precision: 2, tone: 'signed' } },
      { slot_id: 'rail.a.label', node: 'rail.a.label', format: { kind: 'text' }, collapse_group: { group_id: 'zero', item: 'a', rollup_slot: 'rail.rollup', label: '신용융자' } },
      { slot_id: 'rail.a.value', node: 'rail.a.value', format: { kind: 'number' }, collapse_group: { group_id: 'zero', item: 'a', rollup_slot: 'rail.rollup' } },
      { slot_id: 'rail.b.label', node: 'rail.b.label', format: { kind: 'text' }, collapse_group: { group_id: 'zero', item: 'b', rollup_slot: 'rail.rollup', label: '현금미수' } },
      { slot_id: 'rail.b.value', node: 'rail.b.value', format: { kind: 'number' }, collapse_group: { group_id: 'zero', item: 'b', rollup_slot: 'rail.rollup' } },
      { slot_id: 'rail.c.label', node: 'rail.c.label', format: { kind: 'text' }, collapse_group: { group_id: 'zero', item: 'c', rollup_slot: 'rail.rollup', label: '대출' } },
      { slot_id: 'rail.c.value', node: 'rail.c.value', format: { kind: 'number' }, collapse_group: { group_id: 'zero', item: 'c', rollup_slot: 'rail.rollup' } },
      { slot_id: 'rail.rollup', node: 'rail.rollup', format: { kind: 'rollup' }, expanded_board: 'X1' },
    ],
  };
}

function fixtureValues(overrides = {}) {
  return {
    'header.price': 150850,
    'header.change': 1850,
    'header.rate': 1.24,
    'rail.a.label': '신용융자',
    'rail.a.value': 0,
    'rail.b.label': '현금미수',
    'rail.b.value': 0,
    'rail.c.label': '대출',
    'rail.c.value': 0,
    ...overrides,
  };
}

function stateControlStub({ tag = 'div', role = null, tabindex = null } = {}) {
  const attributes = new Map();
  if (role !== null) attributes.set('role', role);
  if (tabindex !== null) attributes.set('tabindex', tabindex);
  return {
    tagName: tag.toUpperCase(),
    listeners: [],
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
    dispatch(type, event = {}) {
      for (const listener of this.listeners.filter((entry) => entry.type === type)) listener.fn(event);
    },
  };
}

test('responsive plain state control activates exactly once for click, Enter, and Space', () => {
  assert.equal(typeof wireStateControlActivation, 'function');
  const node = stateControlStub();
  const activations = [];
  assert.equal(wireStateControlActivation(node, () => activations.push('activate'), { keyboard: true }), true);

  assert.equal(node.getAttribute('role'), 'button');
  assert.equal(node.getAttribute('tabindex'), '0');
  node.dispatch('click');
  node.dispatch('keydown', { key: 'Enter', preventDefault() { activations.push('prevent-enter'); } });
  node.dispatch('keydown', { key: ' ', preventDefault() { activations.push('prevent-space'); } });
  node.dispatch('keydown', { key: 'Enter', repeat: true, preventDefault() { activations.push('repeat'); } });
  node.dispatch('keydown', { key: 'ArrowRight', preventDefault() { activations.push('arrow'); } });

  assert.deepEqual(activations,
    ['activate', 'prevent-enter', 'activate', 'prevent-space', 'activate']);
  assert.equal(wireStateControlActivation(node, () => activations.push('duplicate'), { keyboard: true }), false);
  node.dispatch('click');
  assert.equal(activations.at(-1), 'activate', 'rewiring must not install a second activation path');
});

test('a state control inside an identity-free columnheader wrapper keeps sole button semantics', () => {
  const columnheader = stateControlStub({ role: 'columnheader' });
  columnheader.dataset = {};
  // 지금 이 모양을 저작한 보드는 없다 — 순위표 열 머리에 물려 있던 표식 하나를
  // Paper가 가리키는 칩으로 옮겼다. 그래도 셀 안에 표식이 놓이는 날 의미론은 살아 있어야 한다.
  const control = stateControlStub();
  columnheader.children = [control];

  const activations = [];
  assert.equal(wireStateControlActivation(
    control, () => activations.push('activate'), { keyboard: true },
  ), true);
  assert.equal(columnheader.getAttribute('role'), 'columnheader');
  assert.deepEqual(columnheader.dataset, {}, 'semantic cell wrapper must stay identity-free');
  assert.equal(control.getAttribute('role'), 'button');
  assert.equal(control.getAttribute('tabindex'), '0');
  control.dispatch('click');
  control.dispatch('keydown', {
    key: 'Enter', preventDefault() { activations.push('prevent-enter'); },
  });
  control.dispatch('keydown', {
    key: ' ', preventDefault() { activations.push('prevent-space'); },
  });
  assert.deepEqual(activations, [
    'activate', 'prevent-enter', 'activate', 'prevent-space', 'activate',
  ]);
  assert.equal(wireStateControlActivation(
    control, () => activations.push('duplicate'), { keyboard: true },
  ), false);
  control.dispatch('click');
  assert.equal(activations.at(-1), 'activate');
});

test('real-board fixture state marks flatten into wired 3GLA and 2WI2 links', () => {
  const fixtures = [
    ['2SKU-1', '3GLA-0', 'D+2 정산 후 계좌', '3MTJ-0'],
    ['13K0-2', '2WI2-0', '시간외 등락률', '2YNQ-0'],
  ];
  for (const [boardId, nodeId, controlText, targetBoard] of fixtures) {
    const slots = JSON.parse(fs.readFileSync(path.join(
      __dirname, '..', '..', 'backend', 'ref', 'card-surface-templates', boardId, 'slots.json',
    ), 'utf8'));
    const links = stateLinksFromMarks(slots.state_controls);
    assert.ok(links.length > 0, `${boardId} fixture must retain state-board links`);
    assert.deepEqual(
      links.find((link) => link.control === controlText),
      { control: controlText, board_id: targetBoard },
    );
    const mark = slots.state_controls.marks.find((item) => item.node_id === nodeId);
    assert.equal(mark.control, controlText);

    const node = stateControlStub();
    const activations = [];
    assert.equal(wireStateControlActivation(
      node, () => activations.push(targetBoard), { keyboard: true },
    ), true);
    node.setAttribute('data-state-board', targetBoard);
    assert.equal(node.getAttribute('role'), 'button');
    assert.equal(node.getAttribute('tabindex'), '0');
    assert.equal(node.getAttribute('data-state-board'), targetBoard);
    node.dispatch('click');
    node.dispatch('keydown', { key: 'Enter', preventDefault() {} });
    node.dispatch('keydown', { key: ' ', preventDefault() {} });
    assert.deepEqual(activations, [targetBoard, targetBoard, targetBoard]);
    assert.equal(wireStateControlActivation(
      node, () => activations.push('duplicate'), { keyboard: true },
    ), false);
    node.dispatch('click');
    assert.deepEqual(activations, [targetBoard, targetBoard, targetBoard, targetBoard]);
  }
});

// ---------- 상태 링크 재계산(D-1) ----------
// 봉투는 마운트한 그 보드의 직계 자식만 나른다. 상태 보드로 갈아탄 뒤에도 탭 레일이
// 살아 있으려면 부모 레일의 링크를 색인에서 다시 읽어야 한다.

test('상태 보드로 갈아타도 부모 레일 링크가 그대로 남는다', () => {
  const parent = registry.stateLinksFor('137X-2');
  const child = registry.stateLinksFor('2R3M-1');
  assert.ok(parent.length > 0, '137X-2 색인에 상태 링크가 없다');
  for (const link of parent) {
    assert.ok(
      child.some((item) => item.control === link.control && item.board_id === link.board_id),
      `2R3M-1이 부모 레일의 ${link.control} 링크를 잃었다`,
    );
  }
  // 갈아탄 보드 제 자식도 함께 갖는다 — 링크가 줄지 않는다.
  assert.ok(child.some((item) => item.control === '분봉 시세' && item.board_id === '3FR6-0'));
  assert.ok(child.length > parent.length);
  assert.equal(new Set(child.map((item) => `${item.board_id} ${item.control}`)).size, child.length);
});

test('레일 주인을 부모로 둔 보드는 레일 주인으로 되돌아갈 링크를 갖는다', () => {
  // 2QFO-2는 제 레일을 이고 있는 탭 주인이라 제 표식(투자자별 → 2QFO-2)이 레일에 있다.
  const owner = registry.stateLinksFor('2QFO-2');
  assert.deepEqual(
    owner.find((item) => item.board_id === '2QFO-2'),
    { control: '투자자별', board_id: '2QFO-2' },
  );
  const child = registry.stateLinksFor('2ROJ-1');
  assert.deepEqual(
    child.find((item) => item.board_id === '2QFO-2'),
    { control: '투자자별', board_id: '2QFO-2' },
  );
  for (const link of owner) {
    assert.ok(
      child.some((item) => item.control === link.control && item.board_id === link.board_id),
      `2ROJ-1이 레일 주인의 ${link.control} 링크를 잃었다`,
    );
  }
});

test('레일에 제 표식이 없는 부모로 되돌아가는 링크는 지어내지 않는다', () => {
  // 13BC-2 레일에는 13BC-2 자신을 여는 표식이 없다(저작 공백). 없는 화면을 만들지 않는다.
  const child = registry.stateLinksFor('2TRW-1');
  assert.ok(child.length > 0, '2TRW-1이 부모 레일 링크조차 못 받았다');
  assert.equal(child.some((item) => item.board_id === '13BC-2'), false);
  // 색인이 모르는 보드는 빈 목록 — 호출부가 봉투가 실어온 목록을 그대로 쓴다.
  assert.deepEqual(registry.stateLinksFor('fixture-quote'), []);
  assert.deepEqual(registry.stateLinksFor(''), []);
});

test('native button and tab state controls keep their existing semantics', () => {
  for (const fixture of [
    { tag: 'button', role: null, tabindex: null },
    { tag: 'div', role: 'tab', tabindex: '-1' },
  ]) {
    const node = stateControlStub(fixture);
    let activations = 0;
    assert.equal(wireStateControlActivation(node, () => { activations += 1; }, { keyboard: true }), true);
    assert.equal(node.getAttribute('role'), fixture.role);
    assert.equal(node.getAttribute('tabindex'), fixture.tabindex);
    node.dispatch('keydown', { key: 'Enter', preventDefault() { throw new Error('native semantics were replaced'); } });
    node.dispatch('keydown', { key: ' ', preventDefault() { throw new Error('native semantics were replaced'); } });
    assert.equal(activations, 0, 'native keyboard handling must not be duplicated');
    node.dispatch('click');
    assert.equal(activations, 1);
  }
});

test('a marked descendant routes state activation to its native button or tab owner', () => {
  assert.equal(typeof stateControlActivationOwner, 'function');
  for (const owner of [
    stateControlStub({ tag: 'button' }),
    stateControlStub({ tag: 'div', role: 'tab', tabindex: '-1' }),
  ]) {
    const markedLeaf = stateControlStub();
    markedLeaf.closest = (selector) => {
      assert.equal(selector, 'button, [role="button"], [role="tab"]');
      return owner;
    };
    assert.equal(stateControlActivationOwner(markedLeaf), owner);
  }
  const plainLeaf = stateControlStub();
  plainLeaf.closest = () => null;
  assert.equal(stateControlActivationOwner(plainLeaf), plainLeaf);
});

test('a marked descendant never creates nested button semantics inside a role=button owner', () => {
  const owner = stateControlStub({ tag: 'div', role: 'button', tabindex: '-1' });
  const markedLeaf = stateControlStub();
  markedLeaf.closest = (selector) => (
    selector === 'button, [role="button"], [role="tab"]' ? owner : null
  );

  const activationOwner = stateControlActivationOwner(markedLeaf);
  assert.equal(activationOwner, owner);
  let activations = 0;
  assert.equal(wireStateControlActivation(activationOwner, () => { activations += 1; }, { keyboard: true }), true);
  assert.equal(owner.getAttribute('role'), 'button');
  assert.equal(owner.getAttribute('tabindex'), '-1');
  assert.equal(markedLeaf.getAttribute('role'), null);
  assert.equal(markedLeaf.getAttribute('tabindex'), null);
  assert.equal(wireStateControlActivation(activationOwner, () => { activations += 10; }, { keyboard: true }), false);
  owner.dispatch('click');
  assert.equal(activations, 1);
});

test('plain controls outside responsive groups keep pointer-only legacy behavior', () => {
  const node = stateControlStub();
  let activations = 0;
  assert.equal(wireStateControlActivation(node, () => { activations += 1; }, { keyboard: false }), true);
  assert.equal(node.getAttribute('role'), null);
  assert.equal(node.getAttribute('tabindex'), null);
  node.dispatch('keydown', { key: 'Enter' });
  node.dispatch('click');
  assert.equal(activations, 1);
});

function fixtureRoot() {
  const row = (item, labelNode, valueNode) => el(
    { collapseMember: 'zero', collapseItem: item },
    [el({ node: labelNode }), el({ node: valueNode })],
  );
  return el({}, [
    el({}, [el({ node: 'header.price' }), el({ node: 'header.change' }), el({ node: 'header.rate' })]),
    el({}, [
      row('a', 'rail.a.label', 'rail.a.value'),
      row('b', 'rail.b.label', 'rail.b.value'),
      row('c', 'rail.c.label', 'rail.c.value'),
      el({ collapseRollup: 'zero', expandBoard: 'X1' }, [el({ node: 'rail.rollup' })]),
    ]),
  ]);
}

test('H1 영값 묶음 — 0 항목 3개면 접고 롤업 한 줄을 만든다', () => {
  const [group] = collapsePlan(fixtureContract(), fixtureValues());
  assert.equal(group.collapsed, true);
  assert.deepEqual(group.hiddenItems, ['a', 'b', 'c']);
  assert.equal(group.rollupText, '신용융자·현금미수·대출 — 0원 3항목 ▸');
  assert.equal(group.rollupSlot, 'rail.rollup');
});

test('H1 — 값이 생긴 항목은 그 항목만 행으로 올라오고, 남은 0이 2개면 접지 않는다', () => {
  const [twoZero] = collapsePlan(fixtureContract(), fixtureValues({ 'rail.a.value': 4200000 }));
  assert.equal(twoZero.collapsed, false);
  assert.deepEqual(twoZero.hiddenItems, []);
  assert.equal(twoZero.rollupText, null);
});

test('H1 — 결측도 영값 모수에 든다(0으로 위장하지 않되 같은 묶음으로 접는다)', () => {
  const [group] = collapsePlan(fixtureContract(), fixtureValues({ 'rail.b.value': { missing: 'pending' } }));
  assert.equal(group.collapsed, true);
  assert.equal(group.hiddenItems.length, 3);
});

test('isValueSlot은 숫자 계열만 영값 모수로 센다', () => {
  assert.equal(isValueSlot({ format: { kind: 'number' } }), true);
  assert.equal(isValueSlot({ format: { kind: 'korean' } }), true);
  assert.equal(isValueSlot({ format: { kind: 'percent' } }), true);
  assert.equal(isValueSlot({ format: { kind: 'text' } }), false);
  assert.equal(isValueSlot({ static: true, format: { kind: 'number' } }), true);
  assert.equal(isValueSlot({}), false);
});

test('static source metadata preserves numeric collapse eligibility but never marks a value atomic', () => {
  const contract = {
    slots: [
      {
        slot_id: 'static-number', node: 'static-number', kind: 'value', static: true,
        format: { kind: 'number' },
        collapse_group: { group_id: 'zero', item: 'static-number', label: '정적 숫자' },
      },
      {
        slot_id: 'live-number', node: 'live-number', kind: 'value',
        format: { kind: 'number' },
        collapse_group: { group_id: 'zero', item: 'live-number', label: '실시간 숫자' },
      },
      {
        slot_id: 'other-number', node: 'other-number', kind: 'value',
        format: { kind: 'number' },
        collapse_group: { group_id: 'zero', item: 'other-number', label: '다른 숫자' },
      },
      { slot_id: 'static-kind', node: 'static-kind', kind: 'static', format: { kind: 'number' } },
      { slot_id: 'label-kind', node: 'label-kind', kind: 'label', format: { kind: 'number' } },
    ],
  };
  const values = { 'static-number': 0, 'live-number': 0, 'other-number': 0 };

  const [group] = collapsePlan(contract, values);
  assert.equal(group.collapsed, true);
  assert.deepEqual(group.hiddenItems, ['static-number', 'live-number', 'other-number']);

  const assignments = new Map(mountPlan(contract, values).assignments
    .map((assignment) => [assignment.slotId, assignment]));
  assert.equal(assignments.get('static-number').valueAtomic, false);
  assert.equal(assignments.get('live-number').valueAtomic, true);
  assert.equal(assignments.get('other-number').valueAtomic, true);
  assert.equal(assignments.get('static-kind').valueAtomic, false);
  assert.equal(assignments.get('label-kind').valueAtomic, false);
});

test('value-atomic marker intent is exposed only for formatted numeric assignments', () => {
  const plan = mountPlan(fixtureContract(), fixtureValues());
  const byId = new Map(plan.assignments.map((assignment) => [assignment.slotId, assignment]));

  assert.equal(byId.get('header.price').valueAtomic, true);
  assert.equal(byId.get('header.change').valueAtomic, true);
  assert.equal(byId.get('header.rate').valueAtomic, true);
  assert.equal(byId.get('rail.a.label').valueAtomic, false);
  assert.equal(byId.get('rail.rollup').valueAtomic, false);

  const [missingValue] = mountPlan({
    slots: [{ slot_id: 'missing', node: 'missing', kind: 'value', format: { kind: 'korean' } }],
  }, {}).assignments;
  assert.equal(missingValue.valueAtomic, true);

  const nonValues = mountPlan({
    slots: [
      { slot_id: 'label', node: 'label', kind: 'label', paper_text: '라벨', format: { kind: 'number' } },
      { slot_id: 'static', node: 'static', kind: 'static', format: { kind: 'percent' } },
      { slot_id: 'static-value', node: 'static-value', kind: 'value', static: true, format: { kind: 'number' } },
    ],
  }, { static: 12 }).assignments;
  assert.deepEqual(nonValues.map((assignment) => assignment.valueAtomic), [false, false, false]);
});

test('mountPlan은 슬롯마다 텍스트·색 근거를 하나씩 만들고 롤업 텍스트로 갈아끼운다', () => {
  const plan = mountPlan(fixtureContract(), fixtureValues());
  const byId = new Map(plan.assignments.map((a) => [a.slotId, a]));
  assert.equal(plan.assignments.length, 10);
  assert.equal(byId.get('header.price').text, '150,850');
  assert.deepEqual([byId.get('header.change').text, byId.get('header.change').tone], ['+1,850', 'up']);
  assert.equal(byId.get('header.rate').text, '+1.24%');
  assert.equal(byId.get('rail.rollup').text, '신용융자·현금미수·대출 — 0원 3항목 ▸');
  assert.equal(byId.get('rail.rollup').expandedBoard, 'X1');
  assert.deepEqual(plan.missing, []);
});

test('병기 슬롯은 주값과 한 묶음으로 잡힌다(D4)', () => {
  const paired = pairedGroups(mountPlan(fixtureContract(), fixtureValues()));
  assert.deepEqual(paired.get('header.price'), ['header.change', 'header.rate']);
});

test('applyPlan은 텍스트 노드만 갱신하고 접힌 행의 인라인 display를 되돌릴 수 있게 둔다', () => {
  const root = fixtureRoot();
  const rows = root.querySelectorAll('[data-collapse-member="zero"]');
  rows.forEach((row) => { row.style.display = 'flex'; });

  const collapsedPlan = mountPlan(fixtureContract(), fixtureValues());
  const report = applyPlan(root, collapsedPlan);
  assert.deepEqual(report.unbound, []);
  assert.deepEqual(report.unmapped, []);

  const index = nodeIndex(root);
  assert.equal(index.get('header.price').textContent, '150,850');
  assert.equal(index.get('header.change').style.color, 'var(--color-up)');
  assert.equal(index.get('header.price').style.color, undefined);
  assert.equal(index.get('rail.rollup').textContent, '신용융자·현금미수·대출 — 0원 3항목 ▸');
  assert.deepEqual(rows.map((row) => row.style.display), ['none', 'none', 'none']);
  assert.deepEqual(rows.map((row) => row.hidden), [true, true, true]);

  // 값이 생기면 같은 행이 원래 인라인 display로 돌아온다 — 원문을 지우지 않는다.
  applyPlan(root, mountPlan(fixtureContract(), fixtureValues({ 'rail.a.value': 4200000 })));
  assert.deepEqual(rows.map((row) => row.style.display), ['flex', 'flex', 'flex']);
  assert.equal(index.get('rail.a.value').textContent, '4,200,000');
  const [rollup] = root.querySelectorAll('[data-collapse-rollup="zero"]');
  assert.equal(rollup.hidden, true);
});

test('paired display mirrors follow full and partial source text, tone, and missing state', () => {
  const source = el({ node: 'value' });
  source.style.color = 'var(--paper-tone)';
  const mirrorA = el({ pairedSource: 'value' });
  const mirrorB = el({ pairedSource: 'value' });
  const untouched = el({ pairedSource: 'other-value' });
  mirrorA.textContent = 'stale paper value';
  mirrorB.textContent = 'another stale value';
  mirrorA.style.color = 'var(--color-down)';
  mirrorA.dataset.missing = 'true';
  untouched.textContent = 'paper-only';
  untouched.style.color = 'var(--paper-other)';
  const label = el({ pairedLabel: '' });
  label.textContent = '값';
  const pairContainer = el({}, [label, mirrorA]);
  const root = el({}, [source, mirrorA, mirrorB, untouched]);
  const contract = {
    slots: [{
      slot_id: 'value', node: 'value', kind: 'value',
      format: { kind: 'number', sign: true, tone: 'signed' },
    }],
  };
  const values = { value: 1850 };

  applyPlan(root, mountPlan(contract, values));
  assert.equal(source.textContent, '+1,850');
  for (const mirror of [mirrorA, mirrorB]) {
    assert.equal(mirror.textContent, '+1,850');
    assert.equal(mirror.style.color, 'var(--color-up)');
    assert.equal(mirror.dataset.missing, undefined);
    assert.equal(mirror.dataset.node, undefined);
    assert.equal(mirror.dataset.slotId, undefined);
    assert.equal(mirror.dataset.leaf, undefined);
    assert.equal(mirror.dataset.bsValueAtomic, undefined);
  }

  values.value = 0;
  applyRealtimeSlots(root, contract, values, ['value']);
  assert.equal(source.style.color, 'var(--paper-tone)', 'neutral restores the Paper tone');
  assert.deepEqual([mirrorA.style.color, mirrorB.style.color],
    ['var(--paper-tone)', 'var(--paper-tone)']);

  values.value = { missing: 'pending' };
  applyRealtimeSlots(root, contract, values, ['value']);
  assert.equal(source.dataset.missing, 'true');
  assert.equal(mirrorA.textContent, source.textContent);
  assert.equal(mirrorA.style.color, source.style.color);
  assert.deepEqual([mirrorA.dataset.missing, mirrorB.dataset.missing], ['true', 'true']);

  values.value = -2400;
  applyRealtimeSlots(root, contract, values, ['value']);
  assert.equal(source.textContent, '-2,400');
  assert.equal(source.style.color, 'var(--color-down)');
  assert.deepEqual([mirrorA.textContent, mirrorB.textContent], ['-2,400', '-2,400']);
  assert.deepEqual([mirrorA.style.color, mirrorB.style.color],
    ['var(--color-down)', 'var(--color-down)']);
  assert.deepEqual([mirrorA.dataset.missing, mirrorB.dataset.missing], [undefined, undefined]);
  assert.equal(untouched.textContent, 'paper-only');
  assert.equal(untouched.style.color, 'var(--paper-other)');

  assert.deepEqual(assertReadability(
    'paired-fixture', { name: 'partial realtime restored' },
    pairedReadabilityProbe(source, mirrorA, pairContainer), { enforce: true },
  ), { enforced: true, failures: [] });
  mirrorA.textContent = 'stale after partial realtime';
  assert.throws(() => assertReadability(
    'paired-fixture', { name: 'partial realtime desync' },
    pairedReadabilityProbe(source, mirrorA, pairContainer), { enforce: true },
  ), /readability paired_semantics_violations/);
  applyRealtimeSlots(root, contract, values, ['value']);
  assert.deepEqual(assertReadability(
    'paired-fixture', { name: 'partial realtime resynchronized' },
    pairedReadabilityProbe(source, mirrorA, pairContainer), { enforce: true },
  ), { enforced: true, failures: [] });
});

test('a generated paired value fails hard when naked and passes when labeled', () => {
  const source = el({ node: 'value' });
  source.textContent = '+9,079,400';
  const mirror = el({ pairedSource: 'value' });
  mirror.textContent = source.textContent;
  const generatedPair = el({}, [mirror]);

  assert.throws(() => assertReadability(
    'paired-fixture', { name: 'generated naked pair' },
    pairedReadabilityProbe(source, mirror, generatedPair),
    { enforce: true },
  ), /readability paired_semantics_violations/);
  const label = el({ pairedLabel: '' });
  label.textContent = 'Paper header';
  generatedPair.children.unshift(label);
  assert.deepEqual(assertReadability(
    'paired-fixture', { name: 'generated labeled pair' },
    pairedReadabilityProbe(source, mirror, generatedPair),
    { enforce: true },
  ), { enforced: true, failures: [] });
});

test('value-atomic marker is written only to the Paper leaf and removed idempotently', () => {
  const leaf = el({ node: 'shared', leaf: '' });
  const container = el({ node: 'shared' }, [leaf]);
  const root = el({}, [container]);
  const numericContract = {
    slots: [{ slot_id: 'value', node: 'shared', kind: 'value', format: { kind: 'number' } }],
  };

  applyPlan(root, mountPlan(numericContract, { value: 42 }));
  assert.equal(leaf.dataset.bsValueAtomic, 'true');
  assert.equal(container.dataset.bsValueAtomic, undefined);

  const labelContract = {
    slots: [{ slot_id: 'label', node: 'shared', kind: 'label', paper_text: '라벨', format: null }],
  };
  const labelPlan = mountPlan(labelContract, {});
  applyPlan(root, labelPlan);
  applyPlan(root, labelPlan);
  assert.equal(leaf.dataset.bsValueAtomic, undefined);
  assert.equal(container.dataset.bsValueAtomic, undefined);
});

test('펼침 ▸는 상태 보드 id를 훅으로 넘긴다(템플릿 교체는 호출부 몫)', () => {
  const root = fixtureRoot();
  const seen = [];
  applyPlan(root, mountPlan(fixtureContract(), fixtureValues()), {
    onExpand: (boardId, meta) => seen.push([boardId, meta.groupId]),
  });
  const [rollup] = root.querySelectorAll('[data-collapse-rollup="zero"]');
  rollup.click();
  assert.deepEqual(seen, [['X1', 'zero']]);
  // 재마운트해도 핸들러가 겹쳐 붙지 않는다.
  applyPlan(root, mountPlan(fixtureContract(), fixtureValues()), { onExpand: () => seen.push('dup') });
  rollup.click();
  assert.deepEqual(seen, [['X1', 'zero'], ['X1', 'zero']]);
});

test('계약에 있는데 보드에 없는 슬롯과 보드에 있는데 계약에 없는 노드를 둘 다 보고한다', () => {
  const ghost = el({ node: '유령노드' });
  ghost.textContent = '계약에 없는 글자';
  const root = el({}, [el({ node: 'header.price' }), ghost]);
  const contract = { slots: [
    { slot_id: 'header.price', node: 'header.price', format: { kind: 'number' } },
    { slot_id: '없는슬롯', node: '없는노드', format: { kind: 'text' } },
  ] };
  const report = applyPlan(root, mountPlan(contract, { 'header.price': 1, '없는슬롯': 'x' }));
  assert.deepEqual(report.unbound, ['없는슬롯']);
  assert.deepEqual(report.unmapped, ['유령노드']);
});

test('컨테이너 앵커에는 텍스트를 쓰지 않는다 — 자식(병기 span)을 날리지 않기 위해', () => {
  // 추출기는 Paper 노드 id를 모든 노드에 남긴다. 그중 컨테이너에 textContent를
  // 쓰면 그 안의 병기 줄까지 사라진다.
  const leaf = el({ node: '잎' });
  const container = el({ node: '컨테이너' }, [leaf]);
  const root = el({}, [container]);
  const contract = { slots: [
    { slot_id: 'c', node: '컨테이너', format: { kind: 'text' } },
    { slot_id: 'l', node: '잎', format: { kind: 'text' } },
  ] };
  const report = applyPlan(root, mountPlan(contract, { c: '덮어쓰기', l: '값' }));
  assert.deepEqual(report.containers, ['c']);
  assert.deepEqual(container.children, [leaf], '자식이 살아 있어야 한다');
  assert.equal(leaf.textContent, '값');
});

test('같은 data-node가 둘이면 잎을 앵커로 고른다 — 바깥 원문 노드에 쓰지 않는다', () => {
  // 추출기는 값 자리를 `<span data-node data-leaf>`로 감싸면서 바깥 원문 노드의
  // data-node를 그대로 둔다. 문서 순서로 먼저 잡히는 것은 바깥(컨테이너)이라,
  // 잎을 우선하지 않으면 그 슬롯은 containers[]로 빠져 값이 영영 안 나온다.
  const leaf = el({ node: '중복', leaf: '' });
  const outer = el({ node: '중복' }, [leaf]);
  const root = el({}, [outer]);
  assert.equal(nodeIndex(root).get('중복'), leaf);

  const contract = { slots: [{ slot_id: 'v', node: '중복', format: { unit: 'krw_ko' } }] };
  const report = applyPlan(root, mountPlan(contract, { v: 150850 }));
  assert.deepEqual(report.containers, []);
  assert.equal(leaf.textContent, '15만 850');
  assert.deepEqual(outer.children, [leaf], '바깥 원문 노드의 자식이 살아 있어야 한다');
});

test('잎 안의 <br>은 자식으로 세지 않는다 — 두 줄 라벨도 마운트된다', () => {
  // 추출 원문 실측(1JPU-0/1JT0-0, 1JZW-0/3PQA-0): 잎이
  // `<span data-node data-leaf>매도 잔량<br />직전대비</span>`이고 부모가
  // white-space: pre-wrap이다. paper_text가 같은 자리를 "\n"으로 실으므로 글자를
  // 써도 화면은 그대로 두 줄이다. <br>을 자식으로 세면 그 슬롯이 통째로 빠진다.
  const br = el();
  br.tag = 'br';
  const leaf = el({ node: '두줄', leaf: '' }, [br]);
  const paired = el({ node: '병기' });
  const outer = el({ node: '두줄' }, [leaf, paired]);
  const root = el({}, [outer]);
  const contract = { slots: [
    { slot_id: 'l', node: '두줄', kind: 'label', paper_text: '매도 잔량\n직전대비' },
  ] };
  const report = applyPlan(root, mountPlan(contract, {}));
  assert.deepEqual(report.containers, []);
  assert.equal(leaf.textContent, '매도 잔량\n직전대비');
  assert.deepEqual(outer.children, [leaf, paired], '바깥 컨테이너의 병기 줄이 살아 있어야 한다');
});

test('병기 사본이 먼저 나와도 원본 머리글에 쓴다 — 두 줄이 한 노드로 남는다', () => {
  // 추출 원문 실측(1JPU-0/1JT3-0, 1JZW-0/3PQ7-0): 병기 사본 `<span class="bs-paired"
  // data-node>`가 표 머리 원본보다 문서 순서상 먼저 나오고, 원본은 병기 사본이 안
  // 붙어 있어 <span data-leaf> 래퍼 없이 <br>을 직계로 인다. 사본을 앵커로 고르면
  // 원본은 board.html 원문 그대로 남아 DOM이 "직전대비"·"매수 잔량" 두 조각이 된다.
  const copy = el({ node: '머리', pairedCol: '5' }, [], 'bs-paired');
  const br = el();
  br.tag = 'br';
  const head = el({ node: '머리' }, [br]);
  const root = el({}, [copy, head]);
  assert.equal(nodeIndex(root).get('머리'), head);

  const contract = { slots: [
    { slot_id: 'h', node: '머리', kind: 'label', paper_text: '직전대비\n매수 잔량' },
  ] };
  const report = applyPlan(root, mountPlan(contract, {}));
  assert.deepEqual(report.containers, []);
  assert.equal(head.textContent, '직전대비\n매수 잔량');
  assert.equal(copy.textContent, '직전대비\n매수 잔량',
    '사본은 앵커가 아니라 원본을 따른다');
});

test('구형 병기 사본도 원본을 따라 갱신된다 — 좁은 폭에 목업 숫자가 남지 않게', () => {
  // 추출기는 paired-table이 아닌 표의 접힌 열 사본을 `data-paired-source` 없이
  // `<span class="bs-paired" data-paired-col data-node>`로 만든다. S/XS에서는
  // 원본 열이 display:none이고 화면에 서는 쪽은 이 사본이라, 값이 원본에만 실리면
  // 좁은 창은 추출 당시 Paper 목업 숫자를 계속 보여준다.
  const copy = el({ node: '현재가', pairedCol: '3' }, [], 'bs-paired');
  copy.textContent = '150,850';
  const leaf = el({ node: '현재가', leaf: '' });
  const root = el({}, [copy, leaf]);
  const contract = { slots: [{
    slot_id: 'v',
    node: '현재가',
    kind: 'value',
    format: { kind: 'number', sign: false, precision: 0, tone: 'neutral' },
  }] };
  const values = { v: 47957 };

  applyPlan(root, mountPlan(contract, values));
  assert.equal(leaf.textContent, '47,957');
  assert.equal(copy.textContent, '47,957');
  assert.equal(copy.dataset.slotId, undefined, '사본에는 마운트 정체성을 남기지 않는다');
  assert.equal(copy.dataset.bsValueAtomic, undefined);

  values.v = 48100;
  applyRealtimeSlots(root, contract, values, ['v']);
  assert.equal(copy.textContent, '48,100', '실시간 프레임도 사본을 함께 칠한다');
});

test('isValueSlot은 추출기 unit 어휘도 숫자 계열로 센다(H1 모수)', () => {
  assert.equal(isValueSlot({ format: { unit: 'krw_ko' } }), true);
  assert.equal(isValueSlot({ format: { unit: 'shares' } }), true);
  assert.equal(isValueSlot({ format: { unit: 'count' } }), true);
  assert.equal(isValueSlot({ format: { unit: 'percent' } }), true);
  assert.equal(isValueSlot({ format: { unit: 'text' } }), false);
  assert.equal(isValueSlot({ format: { unit: 'date' } }), false);
  assert.equal(isValueSlot({ format: { unit: 'time' } }), false);
});

test('추출기 출처 필드는 마운트를 바꾸지 않는다 — 값 표의 열쇠는 slot_id 하나다', () => {
  // 추출기·저작이 슬롯에 다는 출처 필드(alt_mappings·f_pattern·indexed·row_index)는
  // "이 값이 어느 op의 어느 필드에서 왔나"를 적을 뿐이다. 값은 봉투의 slot_values가
  // slot_id로 나르므로(백엔드 card_surface_contract), 프론트 계획은 그대로여야 한다.
  const base = { slots: [
    { slot_id: 'r1.qty', node: 'r1.qty', format: { unit: 'shares' } },
    { slot_id: 'r2.qty', node: 'r2.qty', format: { unit: 'shares' } },
  ] };
  const annotated = { slots: base.slots.map((slot, at) => ({
    ...slot,
    alt_mappings: [{ mapping_id: 'base:ka10075', f: 'rmnd_qty' }],
    f_pattern: 'ovt_sigpric_sel_bid_{n}',
    indexed: true,
    row_index: at,
  })) };
  const values = { 'r1.qty': 250, 'r2.qty': 110 };
  assert.deepEqual(mountPlan(annotated, values), mountPlan(base, values));
  assert.deepEqual(
    mountPlan(annotated, values).assignments.map((a) => [a.slotId, a.node, a.text]),
    [['r1.qty', 'r1.qty', '250주'], ['r2.qty', 'r2.qty', '110주']],
  );
});

test('라벨 슬롯은 값이 안 실려도 Paper 원문을 지키고, 값 슬롯만 결측어로 간다', () => {
  const contract = { slots: [
    { slot_id: 'lab', node_id: 'n1', kind: 'label', paper_text: '주문가능금액', format: null },
    { slot_id: 'val', node_id: 'n2', kind: 'value', paper_text: '4,182만', format: { kind: 'korean' } },
  ] };
  const plan = mountPlan(contract, {});
  assert.deepEqual(plan.assignments.map((a) => [a.node, a.text]), [['n1', '주문가능금액'], ['n2', '미제공']]);
  assert.deepEqual(plan.missing, ['val']);
});

test('결측 슬롯은 결측어를 쓰고 data-missing으로 표시된다', () => {
  const root = el({}, [el({ node: 'header.price' })]);
  const contract = { slots: [{ slot_id: 'header.price', node: 'header.price', format: { kind: 'korean' } }] };
  const plan = mountPlan(contract, { 'header.price': { missing: 'not_applicable' } });
  applyPlan(root, plan);
  assert.deepEqual(plan.missing, ['header.price']);
  assert.equal(root.children[0].textContent, '해당 없음');
  assert.equal(root.children[0].dataset.missing, 'true');
});

test('setHidden은 원래 인라인 display를 한 번만 기억한다', () => {
  const node = el();
  node.style.display = 'grid';
  setHidden(node, true);
  setHidden(node, true);
  setHidden(node, false);
  assert.equal(node.style.display, 'grid');
});

// ---------- 반응형 훅: 인라인 레이아웃 속성 hoist ----------

function styleStub(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getPropertyValue: (name) => map.get(name) || '',
    setProperty: (name, value) => { map.set(name, value); },
    removeProperty: (name) => { map.delete(name); },
  };
}

function regionStub(className, inline) {
  const node = el({});
  node.className = className;
  node.style = styleStub(inline);
  return node;
}

test('hoistLayout은 레이아웃 속성만 커스텀 속성으로 옮기고 나머지 인라인은 손대지 않는다', () => {
  const rail = regionStub('bs-rail', {
    width: '460px',
    'flex-shrink': '0',
    'flex-basis': '460px',
    display: 'flex',
    'background-color': '#f7f8fa',
    'padding-inline': '14px',
  });
  assert.equal(hoistLayout(rail), true);
  assert.equal(rail.style.getPropertyValue('width'), '');
  assert.equal(rail.style.getPropertyValue('flex-basis'), '');
  assert.equal(rail.style.getPropertyValue('flex-shrink'), '');
  assert.equal(rail.style.getPropertyValue('--bs-width'), '460px');
  assert.equal(rail.style.getPropertyValue('--bs-flex-basis'), '460px');
  assert.equal(rail.style.getPropertyValue('--bs-flex-shrink'), '0');
  // Paper 레이아웃 모델과 시각 원문은 그대로다.
  assert.equal(rail.style.getPropertyValue('display'), 'flex');
  assert.equal(rail.style.getPropertyValue('background-color'), '#f7f8fa');
  assert.equal(rail.style.getPropertyValue('padding-inline'), '14px');
  // 두 번 돌려도 값이 겹쳐 쓰이지 않는다.
  assert.equal(hoistLayout(rail), false);
  assert.equal(rail.style.getPropertyValue('--bs-width'), '460px');
});

test('L 구간 최소 폭 표시는 값이 있는 탄력 KPI 칸에만 붙는다', () => {
  const elasticValue = regionStub('bs-kpi-cell', {
    'flex-basis': '0%',
    'flex-grow': '1',
  });
  elasticValue.textContent = '현금 비중 28.0%';
  const elasticSpacer = regionStub('bs-kpi-cell', {
    'flex-basis': '0%',
    'flex-grow': '1',
  });
  elasticSpacer.textContent = '';
  const fixedValue = regionStub('bs-kpi-cell', { width: '245px' });
  fixedValue.textContent = '평가손익 +1.24%';

  assert.equal(hoistLayout(elasticValue), true);
  assert.equal(hoistLayout(elasticSpacer), true);
  assert.equal(hoistLayout(fixedValue), true);
  assert.equal(elasticValue.dataset.bsKpiElastic, 'true');
  assert.equal(elasticSpacer.dataset.bsKpiElastic, undefined,
    '빈 spacer에 최소 폭을 주면 8칸 시세 스트립이 L 구간에서 넘친다');
  assert.equal(fixedValue.dataset.bsKpiElastic, undefined,
    '모든 KPI 칸에 최소 폭을 주면 6~8칸 보드가 L 구간에서 넘친다');
});

test('한쪽 inset과 고정 폭을 가진 absolute 상자는 좁은 단계용 양쪽 inset을 기억한다', () => {
  const actions = regionStub('', {
    position: 'absolute',
    left: '24px',
    bottom: '18px',
    width: '490px',
  });
  actions.dataset.name = 'Chart Context Actions';
  const tooltip = regionStub('', {
    position: 'absolute',
    left: '748px',
    top: '120px',
    width: '148px',
  });
  tooltip.dataset.name = 'Chart Tooltip Label';
  assert.equal(hoistLayout(actions), true);
  assert.equal(hoistLayout(tooltip), true);
  for (const [what, box, left] of [['하단 액션', actions, '24px'], ['툴팁', tooltip, '748px']]) {
    assert.equal(box.dataset.bsInsetX, 'true', `${what}: 이름이 아니라 모양으로 표시한다`);
    assert.equal(box.style.getPropertyValue('--bs-inset-x'), left);
    assert.equal(box.style.getPropertyValue('left'), '',
      `${what}: 인라인 left가 남으면 좁은 단계 규칙이 못 이긴다(!important 없이)`);
  }
  assert.equal(actions.style.getPropertyValue('bottom'), '18px', '세로 inset은 안 건드린다');
  assert.equal(tooltip.style.getPropertyValue('top'), '120px');
});

test('양쪽 inset이 이미 있거나 폭이 없는 absolute 상자는 표시하지 않는다', () => {
  const bothSides = regionStub('', {
    position: 'absolute', left: '24px', right: '24px', width: '490px',
  });
  const noWidth = regionStub('', { position: 'absolute', left: '24px' });
  const inFlow = regionStub('', { left: '24px', width: '490px' });
  for (const box of [bothSides, noWidth, inFlow]) {
    hoistLayout(box);
    assert.equal(box.dataset.bsInsetX, undefined);
    assert.equal(box.style.getPropertyValue('left'), '24px', 'Paper 원문 left를 그대로 둔다');
  }
});

test('primary가 세로로 쌓아 놓은 양끝 가로 줄만 XS 접기 표시를 받는다', () => {
  const ancestor = (className, inline) => ({
    classList: { contains: (name) => name === className },
    style: styleStub(inline || {}),
  });
  const under = (chain, inline) => {
    const row = regionStub('', inline);
    let child = row;
    for (const parent of chain) {
      child.parentElement = parent;
      child = parent;
    }
    return row;
  };
  const primary = () => ancestor('bs-primary');
  const columnWrap = () => ancestor('', { display: 'flex', 'flex-direction': 'column' });
  const rowWrap = () => ancestor('', { display: 'flex' });
  const splitRow = { display: 'flex', 'justify-content': 'space-between' };
  const toolbar = under([primary()], { ...splitRow, height: '46px' });
  // 실측 30O1-0: Quote Detail Mount > Frame(세로) > Mode Row.
  const wrapped = under([columnWrap(), primary()], splitRow);
  const inRowCell = under([rowWrap(), columnWrap(), primary()], splitRow);
  const column = under([primary()], { ...splitRow, 'flex-direction': 'column' });
  const stacked = under([primary()], { display: 'flex' });
  const tableRow = under([ancestor('bs-table')], splitRow);
  // primary가 스스로 표인 보드(실측 2SYW-1 Order Ledger)의 직속 요약 줄.
  const summaryRow = under([{
    classList: { contains: (name) => name === 'bs-primary' || name === 'bs-table' },
    style: styleStub({ display: 'flex', 'flex-direction': 'column' }),
  }], splitRow);
  const deepTableRow = under([columnWrap(), ancestor('bs-table'), primary()], splitRow);
  const orphan = under([columnWrap()], splitRow);
  const rows = [toolbar, wrapped, inRowCell, column, stacked, tableRow, summaryRow, deepTableRow, orphan];
  for (const row of rows) hoistLayout(row);
  assert.equal(toolbar.dataset.bsSplitRow, 'true');
  assert.equal(wrapped.dataset.bsSplitRow, 'true', '세로 래퍼 한 겹은 같은 줄이다');
  assert.equal(inRowCell.dataset.bsSplitRow, undefined, '가로로 나뉜 칸 안은 대상이 아니다');
  assert.equal(column.dataset.bsSplitRow, undefined,
    '세로 줄을 접으면 넘친 것이 오른쪽 새 열로 가서 오히려 가로 넘침이 된다');
  assert.equal(stacked.dataset.bsSplitRow, undefined);
  assert.equal(tableRow.dataset.bsSplitRow, undefined, '표는 열 폭이 계약이라 안 접는다');
  assert.equal(summaryRow.dataset.bsSplitRow, 'true', 'primary 직속 요약 줄은 표 행이 아니다');
  assert.equal(deepTableRow.dataset.bsSplitRow, undefined, '표 안쪽 줄도 열 폭이 계약이다');
  assert.equal(orphan.dataset.bsSplitRow, undefined, 'primary 밖 줄은 대상이 아니다');
});

test('스트립·헤더가 세로로 쌓은 양끝 줄도 접기 표시를 받는다', () => {
  const ancestor = (className, inline) => ({
    classList: { contains: (name) => name === className },
    style: styleStub(inline || {}),
  });
  const under = (chain, inline) => {
    const row = regionStub('', inline);
    let child = row;
    for (const parent of chain) {
      child.parentElement = parent;
      child = parent;
    }
    return row;
  };
  const columnRegion = (name) => ancestor(name, { display: 'flex', 'flex-direction': 'column' });
  const rowRegion = (name) => ancestor(name, { display: 'flex' });
  const columnWrap = () => ancestor('', { display: 'flex', 'flex-direction': 'column' });
  const splitRow = { display: 'flex', 'justify-content': 'space-between' };

  // 실측 2XTO-0: `.bs-strip`(세로) > `2XWZ-0`·`2XWH-0`(space-between 가로 줄).
  const stripRow = under([columnRegion('bs-strip')], splitRow);
  const stripNested = under([columnWrap(), columnRegion('bs-strip')], splitRow);
  const headerRow = under([columnRegion('bs-header')], splitRow);
  const railRow = under([columnRegion('bs-rail')], splitRow);
  const footerRow = under([columnRegion('bs-footer')], splitRow);
  // 영역이 스스로 가로로 나눈 칸은 줄이 아니다 — 접으면 칸이 아랫줄로 떨어진다.
  const stripCell = under([rowRegion('bs-strip')], splitRow);
  // KPI는 자기 흐름 규칙(3칸/2칸/1칸)이 있어 경계로 인정하지 않는다.
  const kpiRow = under([columnRegion('bs-kpi')], splitRow);
  // 표는 어느 영역 아래에 있어도 열 폭이 계약이다.
  const stripTableRow = under([ancestor('bs-table'), columnRegion('bs-strip')], splitRow);

  const rows = [stripRow, stripNested, headerRow, railRow, footerRow,
    stripCell, kpiRow, stripTableRow];
  for (const row of rows) hoistLayout(row);

  assert.equal(stripRow.dataset.bsSplitRow, 'true');
  assert.equal(stripNested.dataset.bsSplitRow, 'true', '세로 래퍼 한 겹은 같은 줄이다');
  assert.equal(headerRow.dataset.bsSplitRow, 'true');
  assert.equal(railRow.dataset.bsSplitRow, 'true');
  assert.equal(footerRow.dataset.bsSplitRow, 'true');
  assert.equal(stripCell.dataset.bsSplitRow, undefined,
    '가로로 나눈 영역의 칸은 줄이 아니다');
  assert.equal(kpiRow.dataset.bsSplitRow, undefined,
    'KPI 줄은 자기 흐름 규칙이 폭을 맡는다');
  assert.equal(stripTableRow.dataset.bsSplitRow, undefined, '표는 열 폭이 계약이다');
});

test('세로로 쌓는 부모 아래 상자만 세로 축 flex-shrink 표시를 받는다', () => {
  const parentStub = (inline) => ({
    classList: { contains: () => false },
    style: styleStub(inline),
  });
  const under = (inline) => {
    const box = regionStub('', { height: '36px', 'flex-shrink': '0' });
    box.parentElement = parentStub(inline);
    return box;
  };
  // 실측 1WOB-1 목록 본문(display:flex · flex-direction:column · 높이 520px) 안의 행.
  const inColumn = under({ display: 'flex', 'flex-direction': 'column' });
  const inRow = under({ display: 'flex' });
  const inBlock = under({});
  const orphan = regionStub('', { height: '36px' });
  for (const box of [inColumn, inRow, inBlock, orphan]) hoistLayout(box);
  assert.equal(inColumn.dataset.bsColItem, 'true');
  assert.equal(inRow.dataset.bsColItem, undefined, '가로 줄의 flex-shrink는 폭 몫이라 놓아준다');
  assert.equal(inBlock.dataset.bsColItem, undefined);
  assert.equal(orphan.dataset.bsColItem, undefined, '부모가 없으면 표시하지 않는다');
});

test('가로 칸에 붙은 병기 줄만 접기 숙주로 표시한다', () => {
  const pairIn = (host) => {
    const pair = regionStub('bs-paired', {});
    pair.parentElement = host;
    host.children = [pair];
    return host;
  };
  const rowCell = pairIn(regionStub('', { display: 'flex', 'align-items': 'center' }));
  const columnCell = pairIn(regionStub('', { display: 'flex', 'flex-direction': 'column' }));
  const blockCell = pairIn(regionStub('', {}));
  const surface = regionStub('board-surface', {});
  surface.children = [rowCell, columnCell, blockCell];
  surface.querySelectorAll = (selector) => (selector === '.bs-paired'
    ? surface.children.flatMap((cell) => cell.children)
    : []);

  applyResponsiveHooks(surface);
  assert.equal(rowCell.dataset.bsPairedHost, 'true',
    '가로 칸에서는 병기 사본이 옆으로 늘어서서 칸을 밀어낸다');
  assert.equal(columnCell.dataset.bsPairedHost, undefined, '세로 칸은 이미 아랫줄이다');
  assert.equal(blockCell.dataset.bsPairedHost, undefined);
});

test('applyResponsiveHooks는 보드 루트·반응형 영역·영역 밖 고정 상자를 모두 훑는다', () => {
  const rail = regionStub('bs-rail', { width: '460px' });
  const primary = regionStub('bs-primary', { width: '912px', 'flex-grow': '1' });
  const footer = regionStub('bs-footer', { width: '1440px' });
  const label = regionStub('', { color: '#14171d' });
  const surface = regionStub('board-surface', { width: '1440px' });
  surface.children = [rail, primary, footer, label];
  surface.querySelectorAll = (selector) => (selector === '*' ? surface.children : surface.children
    .filter((child) => String(child.className).split(/\s+/).includes(selector.slice(1))));

  // 루트 1 + 영역 2(bs-rail·bs-primary) + 영역 밖 고정 상자 1(bs-footer).
  // 인라인 레이아웃 선언이 없는 노드(label)는 훑어도 표시가 남지 않는다.
  assert.equal(applyResponsiveHooks(surface), 4);
  assert.equal(surface.style.getPropertyValue('--bs-width'), '1440px');
  assert.equal(rail.style.getPropertyValue('--bs-width'), '460px');
  assert.equal(primary.style.getPropertyValue('--bs-flex-grow'), '1');
  // 영역 밖 고정 폭도 걷어낸다 — 헤더·푸터·표 열·KPI 칸이 여기 속한다.
  assert.equal(footer.style.getPropertyValue('width'), '');
  assert.equal(footer.style.getPropertyValue('--bs-width'), '1440px');
  assert.equal(footer.dataset.bsHoisted, 'true');
  assert.equal(label.dataset.bsHoisted, undefined);
  assert.equal(label.style.getPropertyValue('color'), '#14171d');
  assert.deepEqual(RESPONSIVE_REGIONS, [
    'bs-workspace', 'bs-primary', 'bs-rail', 'bs-kpi', 'bs-kpi-cell', 'bs-table', 'bs-strip',
  ]);
  // 높이도 함께 걷어낸다 — 폭이 줄면 글자가 줄바꿈으로 내려가는데 Paper 원문은
  // 영역마다 고정 높이를 싣는다(실측 2SKU-1 헤더 106px · KPI 줄 116px).
  assert.deepEqual(HOISTED_PROPERTIES.map(([property]) => property),
    ['width', 'height', 'flex-basis', 'flex-grow', 'flex-shrink']);
});


// ---------- 실시간 슬롯 이음매 ----------
//
// 봉투가 싣는 두 표만 쓴다. `surface_contract.slot_values`(slot_id ↔ observation_id)와
// `realtime_bindings`(binding_id ↔ observation_id). 백엔드
// card_surface_contract.observation_id_for가 두 쪽의 단일 출처다.
const OBS_PRICE = 'obs_1111111111111111aaaa';
const OBS_RATE = 'obs_2222222222222222bbbb';
const OBS_ORPHAN = 'obs_3333333333333333cccc';
const RTB_PRICE = 'rtb_4444444444444444dddd';
const RTB_RATE = 'rtb_5555555555555555eeee';
const RTB_UNKNOWN = 'rtb_6666666666666666ffff';

function fixtureSurfaceContract() {
  return {
    board_id: 'fixture-quote',
    slot_values: [
      { slot_id: 'header.price', occurrence_id: 'base:0B|$.cur_prc|1', observation_id: OBS_PRICE, value: 150850 },
      { slot_id: 'header.rate', occurrence_id: 'base:0B|$.flu_rt|1', observation_id: OBS_RATE, value: 1.24 },
      { slot_id: 'rail.a.value', occurrence_id: 'base:04|$.crd|1', observation_id: OBS_ORPHAN, value: 0 },
    ],
  };
}

function fixtureRealtimeBindings() {
  return [
    { binding_id: RTB_PRICE, observation_id: OBS_PRICE },
    { binding_id: RTB_RATE, observation_id: OBS_RATE },
    // 보드가 안 태운 관찰 — 이음매에 들어오면 안 된다.
    { binding_id: RTB_UNKNOWN, observation_id: 'obs_9999999999999999dead' },
  ];
}

test('realtimeSlotIndex는 같은 관찰을 가리키는 binding만 슬롯에 잇는다', () => {
  const index = realtimeSlotIndex(fixtureSurfaceContract(), fixtureRealtimeBindings());
  assert.deepEqual([...index.keys()].sort(), [RTB_PRICE, RTB_RATE].sort());
  assert.deepEqual(index.get(RTB_PRICE), ['header.price']);
  assert.deepEqual(index.get(RTB_RATE), ['header.rate']);
  assert.equal(index.has(RTB_UNKNOWN), false);
});

test('realtimeSlotIndex는 한 관찰에 걸린 슬롯을 전부 모은다(같은 값 재표시)', () => {
  const contract = fixtureSurfaceContract();
  contract.slot_values.push({
    slot_id: 'kpi.1.value', occurrence_id: 'base:0B|$.cur_prc|1', observation_id: OBS_PRICE, value: 150850,
  });
  const index = realtimeSlotIndex(contract, fixtureRealtimeBindings());
  assert.deepEqual(index.get(RTB_PRICE), ['header.price', 'kpi.1.value']);
});

test('realtimeSlotIndex는 composite 각 part 관찰을 같은 슬롯에 잇는다', () => {
  const contract = { slot_values: [{
    slot_id: 'header.summary',
    value: { composite: { separator: ' · ', parts: [
      { mapping_id: 'base:0B', f: 'cur_prc', observation_id: OBS_PRICE, value: 150850, format: { kind: 'number' } },
      { mapping_id: 'base:0B', f: 'flu_rt', observation_id: OBS_RATE, value: 1.24, format: { kind: 'percent' } },
    ] } },
  }] };
  const index = realtimeSlotIndex(contract, fixtureRealtimeBindings());
  assert.deepEqual(index.get(RTB_PRICE), ['header.summary']);
  assert.deepEqual(index.get(RTB_RATE), ['header.summary']);
  assert.equal(index.observationByBinding.get(RTB_PRICE), OBS_PRICE);
  assert.equal(index.observationByBinding.get(RTB_RATE), OBS_RATE);
});

test('updateRealtimeValue는 composite에서 해당 관찰 part만 바꾸고 나머지를 보존한다', () => {
  const current = { composite: { separator: ' · ', parts: [
    { mapping_id: 'base:0B', f: 'cur_prc', observation_id: OBS_PRICE, value: 150850, format: { kind: 'number' } },
    { mapping_id: 'base:0B', f: 'flu_rt', observation_id: OBS_RATE, value: 1.24, format: { kind: 'percent' } },
  ] } };
  const changed = updateRealtimeValue(current, OBS_PRICE, 152700);
  assert.equal(changed.updated, true);
  assert.equal(changed.value.composite.parts[0].value, 152700);
  assert.equal(changed.value.composite.parts[1].value, 1.24);
  assert.equal(current.composite.parts[0].value, 150850);
  assert.deepEqual(updateRealtimeValue(current, OBS_ORPHAN, 9), { value: current, updated: false });
  assert.deepEqual(updateRealtimeValue(150850, OBS_PRICE, 152700), { value: 152700, updated: true });
});

test('composite 실시간 갱신은 전체를 다시 포맷하고 잘못된 part 값은 원문 대신 미제공으로 닫는다', () => {
  const current = { composite: { separator: ' · ', parts: [
    { mapping_id: 'base:0B', f: 'cur_prc', observation_id: OBS_PRICE, value: 150850, format: { kind: 'number' } },
    { mapping_id: 'base:0B', f: 'flu_rt', observation_id: OBS_RATE, value: 1.24, format: { kind: 'percent' } },
  ] } };
  const changed = updateRealtimeValue(current, OBS_RATE, -1.21).value;
  assert.equal(formatSlot({}, changed).text, '150,850 · -1.21%');

  const invalid = updateRealtimeValue(changed, OBS_RATE, [-1.21, -1.22]).value;
  assert.deepEqual(formatSlot({}, invalid), { text: '미제공', tone: null, missing: true });
});

test('realtimeSlotIndex는 모양이 어긋난 식별자를 버린다(추측으로 잇지 않는다)', () => {
  const contract = {
    slot_values: [
      { slot_id: 'header.price', observation_id: 'cur_prc' },
      { slot_id: 'header.rate', observation_id: OBS_RATE },
      { slot_id: '', observation_id: OBS_PRICE },
    ],
  };
  const index = realtimeSlotIndex(contract, [
    { binding_id: '9201', observation_id: OBS_RATE },
    { binding_id: RTB_RATE, observation_id: OBS_RATE },
    { binding_id: RTB_PRICE, observation_id: 'cur_prc' },
  ]);
  assert.deepEqual([...index.keys()], [RTB_RATE]);
  assert.deepEqual(index.get(RTB_RATE), ['header.rate']);
});

test('realtimeSlotIndex는 맵 형태 slot_values(관찰 식별자 없음)에서 빈 표를 낸다', () => {
  assert.deepEqual(slotValueEntries({ slot_values: { 'header.price': 150850 } }), []);
  const index = realtimeSlotIndex({ slot_values: { 'header.price': 150850 } }, fixtureRealtimeBindings());
  assert.equal(index.size, 0);
});

test('pairedClosure는 주값 하나에서 병기 짝을 양방향으로 끌어온다(D4)', () => {
  const contract = fixtureContract();
  assert.deepEqual([...pairedClosure(contract, ['header.price'])].sort(),
    ['header.change', 'header.price', 'header.rate']);
  // 병기 쪽이 먼저 와도 주값이 같은 프레임에 들어온다.
  assert.deepEqual([...pairedClosure(contract, ['header.rate'])].sort(),
    ['header.change', 'header.price', 'header.rate']);
  assert.deepEqual([...pairedClosure(contract, ['rail.a.value'])], ['rail.a.value']);
});

test('realtimePlan은 건드린 슬롯만 칠하되 접힘은 보드 전체로 다시 센다', () => {
  const contract = fixtureContract();
  const values = fixtureValues({ 'header.price': 151000 });
  const plan = realtimePlan(contract, values, ['header.price']);
  assert.deepEqual(plan.assignments.map((a) => a.slotId).sort(),
    ['header.change', 'header.price', 'header.rate']);
  // 접힘 계획은 부분이 아니다 — 안 건드린 레일 묶음도 그대로 판정된다.
  assert.equal(plan.collapse.length, 1);
  assert.equal(plan.collapse[0].collapsed, true);
});

test('실시간 프레임은 잎 텍스트를 포맷터로 갈아끼우고 병기 짝을 같은 프레임에 칠한다', () => {
  const root = fixtureRoot();
  const contract = fixtureContract();
  const values = fixtureValues();
  applyPlan(root, mountPlan(contract, values));
  const index = nodeIndex(root);
  assert.equal(index.get('header.price').textContent, '150,850');

  // 프레임 하나가 주값과 병기 둘을 함께 나른다.
  values['header.price'] = 152700;
  values['header.change'] = -1850;
  values['header.rate'] = -1.21;
  const report = applyRealtimeSlots(root, contract, values, ['header.price', 'header.change', 'header.rate']);

  assert.equal(index.get('header.price').textContent, '152,700');
  assert.equal(index.get('header.change').textContent, '-1,850');
  assert.equal(index.get('header.change').style.color, 'var(--color-down)');
  assert.equal(index.get('header.rate').textContent, '-1.21%');
  assert.deepEqual(report.unbound, []);
  // 부분 갱신은 잉여 스캔을 하지 않는다(계획에 없는 잎을 잉여로 세면 거짓 경보다).
  assert.deepEqual(report.unmapped, []);
  assert.deepEqual(report.touched.sort(), ['header.change', 'header.price', 'header.rate']);
});

test('value-atomic marker survives partial realtime writes without leaking to labels', () => {
  const root = fixtureRoot();
  const contract = fixtureContract();
  const values = fixtureValues();
  applyPlan(root, mountPlan(contract, values));
  const index = nodeIndex(root);

  assert.equal(index.get('header.price').dataset.bsValueAtomic, 'true');
  assert.equal(index.get('rail.a.label').dataset.bsValueAtomic, undefined);
  assert.equal(index.get('rail.rollup').dataset.bsValueAtomic, undefined);

  values['header.price'] = 152700;
  applyRealtimeSlots(root, contract, values, ['header.price']);
  assert.equal(index.get('header.price').dataset.bsValueAtomic, 'true');
  assert.equal(index.get('rail.a.label').dataset.bsValueAtomic, undefined);
  assert.equal(index.get('rail.rollup').dataset.bsValueAtomic, undefined);
});

test('실시간 프레임은 건드리지 않은 잎을 그대로 둔다(부분 갱신)', () => {
  const root = fixtureRoot();
  const contract = fixtureContract();
  const values = fixtureValues();
  applyPlan(root, mountPlan(contract, values));
  const index = nodeIndex(root);
  const rollupBefore = index.get('rail.rollup').textContent;

  values['header.price'] = 152700;
  applyRealtimeSlots(root, contract, values, ['header.price']);
  assert.equal(index.get('rail.rollup').textContent, rollupBefore);
  assert.equal(index.get('rail.a.value').textContent, '0');
});

test('실시간으로 값이 생기면 H1 묶음이 같은 프레임에서 펼쳐진다', () => {
  const root = fixtureRoot();
  const contract = fixtureContract();
  const values = fixtureValues();
  const rows = root.querySelectorAll('[data-collapse-member="zero"]');
  rows.forEach((row) => { row.style.display = 'flex'; });
  applyPlan(root, mountPlan(contract, values));
  assert.deepEqual(rows.map((row) => row.hidden), [true, true, true]);

  values['rail.a.value'] = 4200000;
  applyRealtimeSlots(root, contract, values, ['rail.a.value']);
  assert.deepEqual(rows.map((row) => row.hidden), [false, false, false]);
  assert.equal(nodeIndex(root).get('rail.a.value').textContent, '4,200,000');
});

test('건드릴 슬롯이 없으면 실시간 프레임은 DOM을 건드리지 않는다', () => {
  const root = fixtureRoot();
  const contract = fixtureContract();
  applyPlan(root, mountPlan(contract, fixtureValues()));
  const before = nodeIndex(root).get('header.price').textContent;
  const report = applyRealtimeSlots(root, contract, fixtureValues({ 'header.price': 9 }), []);
  assert.deepEqual(report.touched, []);
  assert.equal(report.plan, null);
  assert.equal(nodeIndex(root).get('header.price').textContent, before);
});

test('마운트 표면에서 원시 식별자를 실은 data-name만 걷어내고 나머지 레이어 이름은 둔다', () => {
  // Paper 커버리지 앵커(raw · <mapping_id> · <json path>)가 추출 HTML에 남아 제품 DOM으로
  // 흘러들었다(2026-09-04 gold-market 실측). 슬롯 주소(data-node)와 런타임이 읽는
  // 'Chart Context Actions', 진단용 일반 레이어 이름은 그대로여야 한다.
  const { scrubRawIdentityNames, RAW_IDENTITY_NAME } = require('./board-mount');
  const anchor = el({ name: 'raw · base:ka50081 · $.gds_day_chart_qry[].acc_trde_prica', node: 'chart.volume' });
  const detail = el({ name: 'detail:ka10004:buy_bid_prices' });
  const path = el({ name: 'request · $.stk_cd' });
  const actions = el({ name: 'Chart Context Actions' });
  const plain = el({ name: 'Rectangle' });
  const header = el({ name: 'Instrument Header', node: 'header.price' });
  const surface = el({ name: 'Instrument Card Surface' }, [anchor, detail, path, actions, plain, header]);

  assert.equal(scrubRawIdentityNames(surface), 3);
  assert.equal(anchor.dataset.name, undefined);
  assert.equal(anchor.dataset.node, 'chart.volume', '슬롯 주소는 건드리지 않는다');
  assert.equal(detail.dataset.name, undefined);
  assert.equal(path.dataset.name, undefined);
  assert.equal(actions.dataset.name, 'Chart Context Actions');
  assert.equal(plain.dataset.name, 'Rectangle');
  assert.equal(header.dataset.name, 'Instrument Header');
  assert.equal(surface.dataset.name, 'Instrument Card Surface');
  // 두 번 돌려도 더 지울 것이 없다.
  assert.equal(scrubRawIdentityNames(surface), 0);
  // 패턴은 검증기의 원시 식별자 게이트와 같은 축 — 식별자 모양만 잡고 한국어·일반 명사는 통과.
  assert.equal(RAW_IDENTITY_NAME.test('행'), false);
  assert.equal(RAW_IDENTITY_NAME.test('Quote and Valuation Strip'), false);
  assert.equal(RAW_IDENTITY_NAME.test('base:kt00001'), true);
  assert.equal(RAW_IDENTITY_NAME.test('ka10081'), true);
});

// ---------- primary: 전문 렌더러가 앉을 자리 ----------

test('primaryMountPoint는 mount_slot을 먼저 보고, 없으면 .bs-primary로 떨어진다', () => {
  const mount = el({ node: '14P9-2' });
  const fallback = el({ node: '14PA-2' }, [], 'bs-primary bs-table');
  const surface = el({}, [mount, fallback]);

  const contract = { primary: { renderer: 'athena-chart', mount_slot: '14P9-2' } };
  assert.equal(primaryMountPoint(surface, contract), mount);
  // 계약이 가리키는 노드가 보드에 없으면 표면의 primary 자리로 떨어진다.
  assert.equal(primaryMountPoint(surface, { primary: { mount_slot: '없는노드' } }), fallback);
  // mount_slot 없이 renderer만 저작된 보드도 마찬가지다(32S7-0 저작 정본).
  assert.equal(primaryMountPoint(surface, { primary: { renderer: 'athena-chart', mount_slot: null } }), fallback);
  assert.equal(primaryMountPoint(surface, null), fallback);
});

test('primary 목업은 지우지 않고 접었다가 그대로 편다', () => {
  const toolbar = el({ node: '14PC-2' });
  toolbar.style.display = 'flex';
  const preview = el({ node: '14PK-2' });
  // 마운트 계획이 이미 접어 둔 자식은 손대지 않는다 — 되돌릴 때 같이 펴면 안 된다.
  const folded = el({ node: '14PZ-2' });
  setHidden(folded, true);
  const mount = el({ node: '14P9-2' }, [toolbar, preview, folded], 'bs-primary');

  const collapsed = collapsePrimaryMockup(mount);
  assert.deepEqual(collapsed, [toolbar, preview]);
  // 삭제가 아니라 숨김이다(D1: Paper 원문 보존).
  assert.equal(mount.children.length, 3);
  assert.equal(toolbar.hidden, true);
  assert.equal(preview.hidden, true);

  assert.equal(restorePrimaryMockup(collapsed), 2);
  assert.equal(toolbar.hidden, false);
  // 인라인 display 원문을 되찾는다.
  assert.equal(toolbar.style.display, 'flex');
  assert.equal(preview.hidden, false);
  // 원래 접혀 있던 자식은 접힌 채다.
  assert.equal(folded.hidden, true);
});

test('접을 자리가 없으면 아무 일도 하지 않는다', () => {
  assert.deepEqual(collapsePrimaryMockup(null), []);
  assert.deepEqual(collapsePrimaryMockup(el({ node: '14P9-2' })), []);
  assert.equal(restorePrimaryMockup(null), 0);
});

test('primaryMountPoint는 자리가 없으면 지어내지 않는다', () => {
  const surface = el({}, [el({ node: '14PA-2' })]);
  assert.equal(primaryMountPoint(surface, { primary: { renderer: 'athena-chart', mount_slot: '14P9-2' } }), null);
  assert.equal(primaryMountPoint(null, { primary: { renderer: 'athena-chart' } }), null);
});

test('늦게 끝난 보드 로드는 새 상태 보드나 닫힌 카드를 되살리지 않는다', async () => {
  const lifecycle = createLatestBoardLoad();
  const events = [];
  let finishOld;
  const old = lifecycle.run(
    () => new Promise((resolve) => { finishOld = resolve; }),
    { onReady: () => events.push('old-ready') },
  );
  const current = lifecycle.run(
    async () => 'current-board',
    { onReady: (value) => events.push(value) },
  );
  assert.deepEqual(await current, { status: 'ready', value: 'current-board' });
  finishOld('old-board');
  assert.deepEqual(await old, { status: 'stale' });
  assert.deepEqual(events, ['current-board']);

  let finishClosed;
  const closed = lifecycle.run(
    () => new Promise((resolve) => { finishClosed = resolve; }),
    { onReady: () => events.push('closed-ready') },
  );
  lifecycle.dispose();
  finishClosed('closed-board');
  assert.deepEqual(await closed, { status: 'stale' });
  assert.deepEqual(events, ['current-board']);
});

test('보드 로드 실패는 현재 요청에서만 오류와 같은 요청 재시도를 제공한다', async () => {
  const lifecycle = createLatestBoardLoad();
  let attempts = 0;
  let retry;
  const warnings = ['old failure'];
  const handlers = {
    onLoading: () => { warnings.length = 0; },
    onError: (_error, next) => { warnings.push('current failure'); retry = next; },
  };
  const first = await lifecycle.run(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('network');
    return 'next board';
  }, handlers);
  assert.equal(first.status, 'error');
  assert.deepEqual(warnings, ['current failure']);
  assert.equal(typeof retry, 'function');
  const second = await retry();
  assert.deepEqual(second, { status: 'ready', value: 'next board' });
  assert.equal(attempts, 2);
  assert.deepEqual(warnings, []);
});

test('성공한 empty hydrate는 권위 있는 빈 pending을 보존해 재방문 때 다시 조회하지 않는다', () => {
  const firstPending = ['s005', 's019'];
  const settled = nextHydrationSlots(firstPending, {}, { hydration_slot_ids: [] });
  assert.deepEqual(settled, []);
  assert.deepEqual(nextHydrationSlots(settled, {}, null), []);
  assert.deepEqual(
    nextHydrationSlots(firstPending, { s005: 267750 }, { hydration_slot_ids: ['s019'] }),
    ['s019'],
  );
});

// ---------- 레일 칩 찾기 (표식 · 같은 문구 · 별칭 문구) ----------

function railLeaf(text, stateControl = null) {
  const leaf = {
    tagName: 'DIV',
    childElementCount: 0,
    dataset: stateControl ? { stateControl } : {},
    textContent: text,
    closest: () => null,
    querySelectorAll: () => [],
  };
  return leaf;
}

// 스트립 하나에 칩을 늘어놓은 표면. 스코프 밖 잎(표 셀 등)은 outside로 넣는다 —
// 문구가 같아도 레일이 아니면 칩이 아니다.
function railSurface(chipTexts, { stamped = [], outside = [] } = {}) {
  const chips = chipTexts.map((text) => railLeaf(text));
  const strip = {
    childElementCount: chips.length,
    querySelectorAll: () => chips,
  };
  return {
    querySelectorAll(selector) {
      if (selector === '[data-state-control]') return stamped;
      if (selector === STATE_CONTROL_SCOPES) return [strip];
      return [...chips, ...outside];
    },
    chips,
  };
}

test('표식이 있으면 표식으로 찾는다 — 문구는 안 본다', () => {
  const marked = railLeaf('관심', '관심종목 시세 보드');
  const surface = railSurface(['업종'], { stamped: [marked] });
  assert.equal(findStateControlNode(surface, '관심종목 시세 보드'), marked);
});

test('표식이 없으면 같은 문구를 내는 레일 잎으로 찾는다', () => {
  const surface = railSurface(['업종', '테마']);
  assert.equal(findStateControlNode(surface, '업종'), surface.chips[0]);
  assert.equal(findStateControlNode(surface, '없는 조작'), null);
});

test('문구가 표식 이름과 다른 칩은 별칭으로 찾는다 — 자식 보드 레일이 그 모양이다', () => {
  const surface = railSurface(['관심', '업종']);
  const labelsFor = (control) => (control === '관심종목 시세 보드' ? ['관심'] : []);
  assert.equal(
    findStateControlNode(surface, '관심종목 시세 보드', { labelsFor, links: [] }),
    surface.chips[0],
  );
});

test('별칭이 여러 잎에 걸리거나 다른 링크와 경합하면 매달지 않는다', () => {
  const twice = railSurface(['▸', '▸']);
  const markerLabels = () => ['▸'];
  assert.equal(findStateControlNode(twice, '분봉 시세', { labelsFor: markerLabels, links: [] }), null);

  const shared = railSurface(['금현물']);
  const labelsFor = () => ['금현물'];
  const links = [{ control: '금현물 · 매수' }, { control: '금현물 잔고·거래내역' }];
  assert.equal(findStateControlNode(shared, '금현물 · 매수', { labelsFor, links }), null);
});

test('레일 밖 잎은 칩이 아니다 — 표 셀에 같은 문구가 있어도 안 매단다', () => {
  const surface = railSurface([], { outside: [railLeaf('업종')] });
  assert.equal(findStateControlNode(surface, '업종'), null);
});

test('색인의 별칭 표는 실제 보드에서 나온 것이다', () => {
  assert.deepEqual(registry.controlLabels('관심종목 시세 보드'), ['관심']);
  assert.deepEqual(registry.controlLabels('없는 표식'), []);
});
