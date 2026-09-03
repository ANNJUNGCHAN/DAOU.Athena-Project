'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collapsePlan, mountPlan, pairedGroups, nodeIndex, applyPlan, setHidden, isValueSlot,
  hoistLayout, applyResponsiveHooks, RESPONSIVE_REGIONS, HOISTED_PROPERTIES,
  slotValueEntries, realtimeSlotIndex, pairedClosure, realtimePlan, applyRealtimeSlots,
} = require('./board-mount');

// jsdom 없이 검증한다 — ranking-axis.test.js와 같은 관행(DOM 스텁 주입).
// board-mount의 DOM 쓰기 층이 실제로 건드리는 표면만 흉내낸다:
// querySelectorAll / dataset / textContent / style / hidden / addEventListener.
const SELECTORS = {
  '[data-node]': (node) => node.dataset.node !== undefined,
};
function attrSelector(selector) {
  const match = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector);
  if (!match) return SELECTORS[selector] || (() => false);
  const key = match[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
  return (node) => node.dataset[key] === match[2];
}

function el(dataset = {}, children = []) {
  const node = {
    dataset: { ...dataset },
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
  assert.equal(isValueSlot({}), false);
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
  assert.equal(actions.dataset.bsInsetX, 'true');
  assert.equal(actions.style.getPropertyValue('--bs-inset-x'), '24px');
  assert.equal(actions.style.getPropertyValue('left'), '24px', 'Paper의 XL 위치는 보존한다');
  assert.equal(actions.style.getPropertyValue('bottom'), '18px');
  assert.equal(tooltip.dataset.bsInsetX, undefined,
    '툴팁·차트 핸들 같은 다른 absolute 요소의 위치/폭은 늘리지 않는다');
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
