'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  applyRealtimeTick, dedupeFields, disposeRealtime, formatValue, isSafePrimary, isTaskCanvasEnvelope,
  normalizeField, normalizePresentation, upsert, userVisibleField,
} = require('./semantic-workspace');
const {
  CardLeaseManager, createSemanticBindingSourceProvider,
} = require('./main/integrated-card-realtime');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.classList = {
      add: (name) => {
        if (!String(this.className).split(/\s+/).includes(name)) {
          this.className = `${this.className} ${name}`.trim();
        }
      },
      remove: (name) => {
        this.className = String(this.className).split(/\s+/).filter((item) => item && item !== name).join(' ');
      },
      contains: (name) => String(this.className).split(/\s+/).includes(name),
    };
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  prepend(child) { this.children.unshift(child); child.parentNode = this; return child; }
  replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    for (const child of this.children) {
      if (className && String(child.className).split(/\s+/).includes(className)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  querySelectorAll(selector) {
    const results = [];
    const dataMatch = selector.match(/^\[data-([a-z-]+)\]$/);
    const dataKey = dataMatch && dataMatch[1].replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
    for (const child of this.children) {
      if (dataKey && Object.prototype.hasOwnProperty.call(child.dataset, dataKey)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

function installFakeScheduler(root, { reducedMotion = false } = {}) {
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  const cancelledFrames = [];
  const cancelledTimers = [];
  root.__athenaSemanticWorkspaceScheduler = {
    reducedMotion,
    requestFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelFrame(id) { cancelledFrames.push(id); frames.delete(id); },
    setTimer(callback, delay) { const id = nextId++; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { cancelledTimers.push(id); timers.delete(id); },
  };
  return {
    frames,
    timers,
    cancelledFrames,
    cancelledTimers,
    flushFrames() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    flushTimers(delay) {
      const selected = [...timers].filter(([, timer]) => timer.delay === delay);
      selected.forEach(([id]) => timers.delete(id));
      selected.forEach(([, timer]) => timer.callback());
    },
  };
}

function visibleText(node) {
  return [node.textContent, ...node.children.map(visibleText)].filter(Boolean).join(' ');
}

function findTags(node, tagName) {
  return [
    ...(node.tagName === tagName.toUpperCase() ? [node] : []),
    ...node.children.flatMap((child) => findTags(child, tagName)),
  ];
}

function findClasses(node, className) {
  return [
    ...(String(node.className).split(/\s+/).includes(className) ? [node] : []),
    ...node.children.flatMap((child) => findClasses(child, className)),
  ];
}

function taskEnvelope(overrides = {}) {
  return {
    canvas_type: 'task-canvas',
    task_canvas: { title_ko: '삼성전자 판단' },
    presentation_contract: {
      recipe_id: 'instrument-overview',
      status: 'partial',
      as_of: '2026-08-30 12:00',
      sections: [{
        section_id: 'answer', title_ko: '핵심 지표', status: 'partial',
        fields: [
          { concept_id: 'quote.last_price', label_ko: '현재가', value: '150,000', unit: '원', entity_id: '005930', as_of: '12:00' },
          { concept_id: 'quote.last_price', label_ko: '현재가', value: '149,900', unit: '원', entity_id: '005930', as_of: '12:00' },
          { concept_id: 'wire.fid', label_ko: 'FID 1279', value: 'raw:1', field_class: 'unresolved' },
          { concept_id: 'transport.next', label_ko: '연속조회 키', value: 'next', field_class: 'transport' },
        ],
      }],
    },
    ...overrides,
  };
}

let productionContractCache;

function productionCurrentPriceContracts() {
  if (productionContractCache) return productionContractCache;
  const backendDir = path.resolve(__dirname, '..', '..', 'backend');
  const script = [
    'import json',
    'from athena_api.api.canvas_push import _bind_semantic_values, _integrated_card_contract, _internal_realtime_binding_contract',
    'from athena_api.generated.registry import WEBSOCKET_TR_IDS',
    "card = _integrated_card_contract('base:ka10081')",
    "_bind_semantic_values(card, 'base:ka10081', {'stk_cd': '005930', 'stk_dt_pole_chart_qry': [{'dt': '20260831', 'cur_prc': '150850', 'open_pric': '000123', 'trde_qty': '1234'}]})",
    "rate_card = _integrated_card_contract('detail:ka10001:current_trading')",
    "_bind_semantic_values(rate_card, 'detail:ka10001:current_trading', {'flu_rt': '2.35'})",
    "print(json.dumps({'card': card, 'rate_card': rate_card, 'realtime': {operation: _internal_realtime_binding_contract(operation) for operation in sorted(WEBSOCKET_TR_IDS)}}))",
  ].join('\n');
  const result = spawnSync(process.env.ATHENA_FIXTURE_PYTHON || 'python', ['-c', script], {
    cwd: backendDir,
    encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: backendDir },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  productionContractCache = JSON.parse(result.stdout);
  return productionContractCache;
}

test('task-canvas requires a named presentation contract', () => {
  assert.equal(isTaskCanvasEnvelope(taskEnvelope()), true);
  assert.equal(isTaskCanvasEnvelope({ canvas_type: 'task-canvas', data: { raw: true } }), false);
});

test('fundamentals taxonomy never falls through as a bare product title or section label', () => {
  const presentation = normalizePresentation({
    canvas_type: 'task-canvas',
    presentation_contract: {
      title: 'fundamentals',
      sections: [{
        section_id: 'fundamentals', title: 'fundamentals', status: 'available',
        visibility_policy: 'always', required: true,
        fields: [{ concept_id: 'profile.name', label_ko: '기업명', value: '삼성전자' }],
      }],
    },
  });
  assert.equal(presentation.title, '기업 기본 정보와 가치');
  assert.equal(presentation.sections[0].title, '기업 기본 정보와 가치');
  assert.doesNotMatch(`${presentation.title} ${presentation.sections[0].title}`, /\bfundamentals\b/i);
});

test('task-canvas keeps only specialized CardKinds, AITS chart, and guarded workflow primaries', () => {
  for (const canvas_type of ['table', 'facts', 'compound', 'stream', 'reader', 'event']) {
    assert.equal(isSafePrimary({ ...taskEnvelope(), canvas_type }, { dataset: {} }), false);
  }
  assert.equal(isSafePrimary({ ...taskEnvelope(), canvas_type: 'facts' }, {
    dataset: { semanticPrimary: 'specialized' },
  }), true);
  assert.equal(isSafePrimary({ ...taskEnvelope(), canvas_type: 'chart' }, {
    dataset: { chartAuthority: 'AITS' },
  }), true);
  for (const canvas_type of ['action', 'status']) {
    assert.equal(isSafePrimary({ ...taskEnvelope(), canvas_type }, { dataset: {} }), true);
  }
});

test('non-task legacy generic renderers remain allowed', () => {
  for (const canvas_type of ['table', 'facts', 'compound', 'stream', 'reader', 'event']) {
    assert.equal(isSafePrimary({ canvas_type }, { dataset: {} }), true);
  }
});

test('additive view recipe and flat public presentation entries become named sections', () => {
  const presentation = normalizePresentation({
    canvas_type: 'facts',
    view_instance_id: 'turn-7:instrument-chart:005930',
    view_recipe: {
      recipe_id: 'instrument-chart', title_ko: '종목 차트',
      section_ids: ['identity-and-quote', 'price-history'],
    },
    presentation_contract: [{
      concept_id: 'quote.last-price', label_ko: '현재가', section_id: 'identity-and-quote',
      component_id: 'quote-strip', visual_role: 'quote-metric', value: '150,000', unit_or_format: '원',
    }],
  });
  assert.equal(presentation.title, '종목 차트');
  assert.deepEqual(presentation.sections.map((section) => section.title), ['종목과 현재 시세']);
  assert.equal(presentation.sections[0].fields[0].unit, '원');
});

test('metadata-only optional sections are omitted instead of fake missing-value metrics', () => {
  const presentation = normalizePresentation({
    canvas_type: 'facts',
    view_recipe: { recipe_id: 'instrument-chart', title_ko: '종목 차트' },
    presentation_contract: {
      recipe_id: 'instrument-chart', title_ko: '종목 차트',
      sections: [{
        section_id: 'identity-and-quote', title_ko: 'identity and quote',
        fields: [{ concept_id: 'quote.last-price', label_ko: '현재가', unit_or_format: '원' }],
      }],
    },
  });
  assert.deepEqual(presentation.sections, []);
});

test('unresolved, transport, internal, opaque, and raw-looking labels never become visible fields', () => {
  for (const fieldClass of ['unresolved', 'transport', 'internal', 'official_opaque', 'diagnostic']) {
    assert.equal(userVisibleField({ label_ko: '사용자 라벨', field_class: fieldClass }), false);
  }
  assert.equal(userVisibleField({ label_ko: 'FID 1279', field_class: 'semantic' }), false);
  assert.equal(userVisibleField({ label_ko: '현재가', field_class: 'semantic' }), true);
  assert.equal(normalizeField({ concept_id: 'x', label_ko: 'JSON path', value: '$.x' }), null);
});

test('same concept, entity, time, and unit is displayed once', () => {
  const presentation = normalizePresentation(taskEnvelope());
  assert.equal(presentation.sections[0].fields.length, 1);
  assert.equal(presentation.sections[0].fields[0].value, '150,000');
  assert.equal(dedupeFields([
    { concept: 'price', entity: 'A', timeKey: 'now', unit: '원' },
    { concept: 'price', entity: 'A', timeKey: 'now', unit: '원' },
    { concept: 'price', entity: 'B', timeKey: 'now', unit: '원' },
  ]).length, 2);
});

test('semantic values keep units and distinguish missing values from zero', () => {
  assert.equal(formatValue(0, '원'), '0 원');
  assert.equal(formatValue(null, '원'), '미제공');
  assert.equal(formatValue(-3.2, '%'), '-3.2 %');
});

test('backend display metadata formats only explicitly typed product values and realtime values', () => {
  const root = new FakeElement();
  root.appendChild(new FakeElement('div')).className = 'card-body';
  const scheduler = installFakeScheduler(root);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const bindingId = 'rtb_aaaaaaaaaaaaaaaaaaaa';
  const fields = [
    ['obs_aaaaaaaaaaaaaaaaaaaa', 'price', '현재가', '150850', 'grouped-number', '원', 'absolute', bindingId],
    ['obs_bbbbbbbbbbbbbbbbbbbb', 'quantity', '거래량', '1234', 'grouped-number', '주', 'absolute'],
    ['obs_cccccccccccccccccccc', 'rate', '등락률', '2.35', 'decimal-number', '%', 'always'],
    ['obs_dddddddddddddddddddd', 'date', '기준일', '20260831', 'date-yyyymmdd', '', 'none'],
    ['obs_eeeeeeeeeeeeeeeeeeee', 'code', '종목코드', '005930', 'stock-code', '', 'none'],
  ];
  try {
    upsert(root, {
      canvas_type: 'task-canvas',
      task_canvas: { title_ko: '표시 형식 계약' },
      presentation_contract: {
        recipe_id: 'instrument-overview',
        title_ko: '표시 형식 계약',
        sections: [{
          section_id: 'identity-and-quote',
          title_ko: '종목과 현재 시세',
          fields: fields.map(([observationId, concept, label, , formatterId, displayUnit, signPolicy, realtimeBindingId]) => ({
            observation_id: observationId,
            concept_id: concept,
            label_ko: label,
            display_metadata: {
              formatter_id: formatterId,
              display_unit: displayUnit,
              sign_policy: signPolicy,
            },
            ...(realtimeBindingId ? { realtime_binding_id: realtimeBindingId } : {}),
          })).concat([{
            observation_id: 'obs_ffffffffffffffffffff',
            concept_id: 'untyped-price-looking-value',
            label_ko: '원시 숫자',
          }]),
        }],
      },
      semantic_observations: fields.map(([observationId, concept, label, value, formatterId, displayUnit, signPolicy]) => ({
        observation_id: observationId,
        section_id: 'identity-and-quote',
        concept_id: concept,
        label_ko: label,
        value,
        display_metadata: {
          formatter_id: formatterId,
          display_unit: displayUnit,
          sign_policy: signPolicy,
        },
      })).concat([{
        observation_id: 'obs_ffffffffffffffffffff',
        section_id: 'identity-and-quote',
        concept_id: 'untyped-price-looking-value',
        label_ko: '원시 숫자',
        value: '150850',
      }]),
      realtime_bindings: [{ binding_id: bindingId, observation_id: fields[0][0] }],
    });
    const text = visibleText(root.querySelector('.semantic-workspace'));
    assert.match(text, /150,850원/);
    assert.match(text, /1,234주/);
    assert.match(text, /\+2\.35%/);
    assert.match(text, /2026-08-31/);
    assert.match(text, /005930/);
    assert.match(text, /원시 숫자 150850/);
    assert.doesNotMatch(text, /원시 숫자 150,850원/);

    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: bindingId, value: '151000' }],
    }), 1);
    scheduler.flushFrames();
    const priceNode = root.__athenaSemanticWorkspaceState.observationIndex.get(fields[0][0])[0];
    assert.equal(priceNode.querySelector('.semantic-workspace-value').textContent, '151,000원');
  } finally {
    delete global.document;
  }
});

test('renderer shows named section, partial status, label, unit, and as-of without raw fields', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, taskEnvelope());
    const text = visibleText(workspace);
    assert.match(text, /삼성전자 판단/);
    assert.match(text, /핵심 지표/);
    assert.match(text, /일부 정보를 불러오지 못했습니다/);
    assert.match(text, /현재가/);
    assert.match(text, /150,000 원/);
    assert.match(text, /12:00 기준/);
    assert.doesNotMatch(text, /FID|1279|raw:1|연속조회 키|next/);
    assert.equal(root.dataset.taskCanvas, 'true');
  } finally {
    delete global.document;
  }
});

test('production 0B FID 10 binding updates the production snapshot observation', async () => {
  const { card, realtime: realtimeByOperation } = productionCurrentPriceContracts();
  const realtime = realtimeByOperation['0B'];
  const snapshotBindingId = realtime.source_bindings['10'].binding_id;
  const snapshotObservation = card.semantic_observations.find((item) => (
    item.realtime_binding_id === snapshotBindingId && item.label_ko === '현재가'
  ));
  assert.ok(snapshotObservation);
  assert.equal(card.realtime_bindings.some((item) => (
    item.binding_id === snapshotBindingId
    && item.observation_id === snapshotObservation.observation_id
  )), true);
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    upsert(root, {
      canvas_type: 'task-canvas', task_canvas: { title_ko: '삼성전자 차트' }, ...card,
    });
    const transport = {
      acquire: async () => true,
      release: async () => true,
      reconnect: async (bindings) => bindings.map((binding) => ({ binding, ok: true })),
      command: async () => ({ ok: true }),
    };
    const provider = createSemanticBindingSourceProvider({
      backendBase: 'http://127.0.0.1:8010',
      token: 'pure-test-token',
      fetchImpl: async (url) => {
        const operation = decodeURIComponent(url.split('/').pop());
        return { ok: true, json: async () => realtimeByOperation[operation] };
      },
    });
    const manager = new CardLeaseManager({
      transport,
      semanticBindingSourceProvider: provider,
    });
    const mounted = await manager.mount({
      leaseId: 'quote', cardId: 'CC-03', mode: 'quote', symbol: '005930',
      semanticBindingIds: [snapshotBindingId],
    });
    assert.equal(mounted.ok, true, JSON.stringify(mounted));
    const [event] = manager.routeFrame({
      trnm: 'REAL', data: [{ type: '0B', item: '005930', values: { 10: '71100', 9001: 'A005930' } }],
    });
    assert.deepEqual(Object.keys(event).sort(), [
      'cardId', 'connectionGeneration', 'generation', 'leaseId', 'mode', 'semantic_updates',
    ]);
    assert.deepEqual(event.semantic_updates, [
      { binding_id: snapshotBindingId, value: '71100' },
    ]);
    assert.equal(applyRealtimeTick(root, event), 1);
    const target = root.querySelectorAll('[data-semantic-observation-id]').find(
      (element) => element.dataset.semanticObservationId === snapshotObservation.observation_id,
    );
    assert.ok(target);
    assert.equal(target.textContent, '71,100원');
    assert.equal(applyRealtimeTick(root, { row: { values: { 10: '151,000' } } }), 0);
    const live = root.querySelector('.semantic-workspace-live');
    assert.equal(live.attributes['aria-live'], 'polite');
    assert.match(live.textContent, /1개 항목/);

    const mismatchedBindingId = `${snapshotBindingId.slice(0, -1)}${snapshotBindingId.endsWith('0') ? '1' : '0'}`;
    const mismatchedRoot = new FakeElement();
    mismatchedRoot.appendChild(new FakeElement('div')).className = 'card-body';
    upsert(mismatchedRoot, {
      canvas_type: 'task-canvas', task_canvas: { title_ko: '삼성전자 차트' }, ...card,
    });
    const mismatchedProvider = createSemanticBindingSourceProvider({
      backendBase: 'http://127.0.0.1:8010',
      token: 'pure-test-token',
      fetchImpl: async (url) => {
        const operation = decodeURIComponent(url.split('/').pop());
        const contract = realtimeByOperation[operation];
        return {
          ok: true,
          json: async () => operation === '0B' ? {
            ...contract,
            source_bindings: {
              ...contract.source_bindings,
              10: { ...contract.source_bindings['10'], binding_id: mismatchedBindingId },
            },
          } : contract,
        };
      },
    });
    const mismatchedManager = new CardLeaseManager({
      transport,
      semanticBindingSourceProvider: mismatchedProvider,
    });
    await mismatchedManager.mount({
      leaseId: 'quote-mismatch', cardId: 'CC-03', mode: 'quote', symbol: '005930',
      semanticBindingIds: [snapshotBindingId],
    });
    const mismatchedEvents = mismatchedManager.routeFrame({
      trnm: 'REAL', data: [{ type: '0B', item: '005930', values: { 10: '71200' } }],
    });
    assert.deepEqual(mismatchedEvents, []);
    assert.equal(applyRealtimeTick(mismatchedRoot, { semantic_updates: [] }), 0);
  } finally {
    delete global.document;
  }
});

test('semantic_updates selects a repeated observation by opaque binding and row index', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    upsert(root, taskEnvelope({
      presentation_contract: {
        recipe_id: 'ranking', title_ko: '순위', sections: [{
          section_id: 'ranking-table', title_ko: '순위 결과',
          columns: [{
            key: 'col_price', label_ko: '현재가', unit_or_format: '원',
            realtime_binding_id: 'rtb_cccccccccccccccccccc',
          }],
          rows: [{ col_price: '70,000' }, { col_price: '71,000' }],
        }],
      },
      semantic_observations: [
        { observation_id: 'obs_dddddddddddddddddddd', array_index: 0, section_id: 'ranking-table', label_ko: '현재가', value: '70,000' },
        { observation_id: 'obs_eeeeeeeeeeeeeeeeeeee', array_index: 1, section_id: 'ranking-table', label_ko: '현재가', value: '71,000' },
      ],
      realtime_bindings: [
        { binding_id: 'rtb_cccccccccccccccccccc', observation_id: 'obs_dddddddddddddddddddd', array_index: 0 },
        { binding_id: 'rtb_cccccccccccccccccccc', observation_id: 'obs_eeeeeeeeeeeeeeeeeeee', array_index: 1 },
      ],
    }));
    assert.equal(applyRealtimeTick(root, { semantic_updates: [{
      binding_id: 'rtb_cccccccccccccccccccc', array_index: 1, value: '71,500',
    }] }), 1);
    const cells = findTags(root, 'td').filter((cell) => cell.dataset.semanticObservationId);
    assert.deepEqual(cells.map((cell) => cell.textContent), ['70,000 원', '71,500 원']);
    assert.equal(root.__athenaSemanticWorkspaceState.sections.get('ranking-table').rows[1].col_price, '71,500');
  } finally {
    delete global.document;
  }
});

test('realtime updates require a binding in the current workspace and exact optional observation identity', () => {
  const firstRoot = new FakeElement();
  const firstBody = new FakeElement();
  firstBody.className = 'card-body';
  firstRoot.appendChild(firstBody);
  const secondRoot = new FakeElement();
  const secondBody = new FakeElement();
  secondBody.className = 'card-body';
  secondRoot.appendChild(secondBody);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const bindingId = 'rtb_aaaaaaaaaaaaaaaaaaaa';
  const observationId = 'obs_bbbbbbbbbbbbbbbbbbbb';
  try {
    upsert(firstRoot, taskEnvelope({
      view_instance_id: 'workspace-a',
      presentation_contract: {
        recipe_id: 'quote', title_ko: '현재 시세', sections: [{
          section_id: 'quote-context', title_ko: '현재 시세', fields: [{
            observation_id: observationId, concept_id: 'quote.last-price',
            label_ko: '현재가', value: '150,000', unit: '원',
          }],
        }],
      },
      realtime_bindings: [{ binding_id: bindingId, observation_id: observationId }],
    }));
    upsert(secondRoot, taskEnvelope({
      view_instance_id: 'workspace-b',
      presentation_contract: {
        recipe_id: 'quote', title_ko: '현재 시세', sections: [{
          section_id: 'quote-context', title_ko: '현재 시세', fields: [{
            observation_id: 'obs_cccccccccccccccccccc', concept_id: 'quote.last-price',
            label_ko: '현재가', value: '80,000', unit: '원',
          }],
        }],
      },
      realtime_bindings: [],
    }));

    assert.equal(applyRealtimeTick(firstRoot, { semantic_updates: [{
      observation_id: observationId, value: '150,100',
    }] }), 0, 'observationId-only injection must fail closed');
    assert.equal(applyRealtimeTick(firstRoot, { semantic_updates: [{
      binding_id: bindingId, observation_id: 'malformed', value: '150,150',
    }] }), 0, 'a supplied malformed observationId must not degrade to binding-only');
    assert.equal(applyRealtimeTick(firstRoot, { semantic_updates: [{
      binding_id: bindingId, array_index: '0', value: '150,175',
    }] }), 0, 'a supplied non-integer array index must not degrade to binding-only');
    assert.equal(applyRealtimeTick(firstRoot, { semantic_values: {
      [bindingId]: { observationId: 'malformed', value: '150,180' },
    } }), 0, 'wrapped malformed observation identity must also fail closed');
    assert.equal(applyRealtimeTick(firstRoot, { semantic_updates: [{
      binding_id: bindingId, observation_id: 'obs_dddddddddddddddddddd', value: '150,200',
    }] }), 0, 'an observationId accompanying a binding must match its table entry');
    assert.equal(applyRealtimeTick(firstRoot, { semantic_values: {
      [bindingId]: { observationId: 'obs_dddddddddddddddddddd', value: '150,250' },
    } }), 0, 'wrapped semantic values must also match the binding observation');
    assert.equal(applyRealtimeTick(secondRoot, { semantic_updates: [{
      binding_id: bindingId, observation_id: observationId, value: '150,300',
    }] }), 0, 'a binding from another workspace cannot be reused');
    assert.equal(applyRealtimeTick(firstRoot, { semantic_updates: [{
      binding_id: bindingId, observation_id: observationId, value: '150,400',
    }] }), 1);
    assert.equal(firstRoot.querySelector('.semantic-workspace-value').textContent, '150,400 원');
    assert.equal(secondRoot.querySelector('.semantic-workspace-value').textContent, '80,000 원');
  } finally {
    delete global.document;
  }
});

test('realtime DOM work is indexed, frame-coalesced, announced once, and transient', () => {
  const root = new FakeElement();
  root.appendChild(new FakeElement('div')).className = 'card-body';
  const scheduler = installFakeScheduler(root);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const bindingId = 'rtb_11111111111111111111';
  const observationId = 'obs_22222222222222222222';
  const envelope = taskEnvelope({
    view_instance_id: 'batched-realtime',
    presentation_contract: {
      recipe_id: 'quote', title_ko: '현재 시세', sections: [{
        section_id: 'quote-context', title_ko: '현재 시세', fields: [{
          observation_id: observationId, concept_id: 'quote.last-price',
          label_ko: '현재가', value: '150000',
          display_metadata: { formatter_id: 'grouped-number', display_unit: '원', sign_policy: 'absolute' },
        }],
      }],
    },
    realtime_bindings: [{ binding_id: bindingId, observation_id: observationId }],
  });
  try {
    upsert(root, envelope);
    const target = root.__athenaSemanticWorkspaceState.observationIndex.get(observationId)[0];
    const valueNode = target.querySelector('.semantic-workspace-value');
    let tickQueries = 0;
    const originalQuerySelectorAll = root.querySelectorAll.bind(root);
    root.querySelectorAll = (selector) => { tickQueries += 1; return originalQuerySelectorAll(selector); };

    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: bindingId, value: '150100' }],
    }), 1);
    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: bindingId, value: '150200' }],
    }), 1);
    assert.equal(tickQueries, 0, 'ticks must use the observation index instead of scanning the DOM');
    assert.equal(scheduler.frames.size, 1, 'multiple ticks share one animation frame');
    assert.equal(valueNode.textContent, '150,000원');
    assert.equal(root.__athenaSemanticWorkspaceState.sections.get('quote-context').fields[0].value, '150200');

    scheduler.flushFrames();
    assert.equal(valueNode.textContent, '150,200원', 'latest pending value wins');
    assert.equal(target.classList.contains('is-realtime-updated'), true);
    const live = root.querySelector('.semantic-workspace-live');
    assert.equal(live.textContent, '');
    scheduler.flushTimers(200);
    assert.equal(live.textContent, '1개 항목이 실시간으로 갱신되었습니다.');
    scheduler.flushTimers(900);
    assert.equal(target.classList.contains('is-realtime-updated'), false);

    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: bindingId, value: '150300' }],
    }), 1);
    scheduler.flushFrames();
    assert.equal(target.classList.contains('is-realtime-updated'), true);
    disposeRealtime(root);
    assert.equal(target.classList.contains('is-realtime-updated'), false);
    assert.equal(scheduler.timers.size, 0);
  } finally {
    delete global.document;
  }
});

test('new view upsert disposes the previous view callbacks before replacing state', () => {
  const root = new FakeElement();
  root.appendChild(new FakeElement('div')).className = 'card-body';
  const scheduler = installFakeScheduler(root);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const oldBindingId = 'rtb_55555555555555555555';
  const oldObservationId = 'obs_66666666666666666666';
  const envelope = (viewInstanceId, observationId, value, bindings) => taskEnvelope({
    view_instance_id: viewInstanceId,
    presentation_contract: {
      recipe_id: 'quote', title_ko: `${viewInstanceId} 현재 시세`, sections: [{
        section_id: 'quote-context', title_ko: '현재 시세', fields: [{
          observation_id: observationId, concept_id: 'quote.last-price',
          label_ko: '현재가', value, unit: '원',
        }],
      }],
    },
    realtime_bindings: bindings,
  });
  try {
    upsert(root, envelope('view-a', oldObservationId, '70000', [
      { binding_id: oldBindingId, observation_id: oldObservationId },
    ]));
    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: oldBindingId, value: '70100' }],
    }), 1);
    const staleFrame = [...scheduler.frames.values()][0];
    const staleAnnouncement = [...scheduler.timers.values()].find((timer) => timer.delay === 200).callback;
    const frameHandle = [...scheduler.frames.keys()][0];
    const ariaHandle = [...scheduler.timers].find(([, timer]) => timer.delay === 200)[0];

    const newObservationId = 'obs_77777777777777777777';
    upsert(root, envelope('view-b', newObservationId, '80000', []));
    assert.ok(scheduler.cancelledFrames.includes(frameHandle));
    assert.ok(scheduler.cancelledTimers.includes(ariaHandle));
    assert.equal(scheduler.frames.size, 0);
    assert.equal(scheduler.timers.size, 0);
    assert.equal(root.__athenaSemanticWorkspaceState.viewInstanceId, 'view-b');

    staleFrame();
    staleAnnouncement();
    const newTarget = root.__athenaSemanticWorkspaceState.observationIndex.get(newObservationId)[0];
    assert.equal(newTarget.querySelector('.semantic-workspace-value').textContent, '80000 원');
    assert.equal(root.querySelector('.semantic-workspace-live').textContent, '');
  } finally {
    delete global.document;
  }
});

test('realtime dispose and upsert cancel stale work while reduced motion skips highlight', () => {
  const root = new FakeElement();
  root.appendChild(new FakeElement('div')).className = 'card-body';
  const scheduler = installFakeScheduler(root, { reducedMotion: true });
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const bindingId = 'rtb_33333333333333333333';
  const observationId = 'obs_44444444444444444444';
  const envelope = taskEnvelope({
    view_instance_id: 'disposed-realtime',
    presentation_contract: {
      recipe_id: 'quote', title_ko: '현재 시세', sections: [{
        section_id: 'quote-context', title_ko: '현재 시세', fields: [{
          observation_id: observationId, concept_id: 'quote.last-price',
          label_ko: '현재가', value: '80000', unit: '원',
        }],
      }],
    },
    realtime_bindings: [{ binding_id: bindingId, observation_id: observationId }],
  });
  try {
    upsert(root, envelope);
    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: bindingId, value: '80100' }],
    }), 1);
    const pendingFrame = [...scheduler.frames.keys()][0];
    const pendingAnnouncement = [...scheduler.timers.keys()][0];
    upsert(root, envelope);
    assert.deepEqual(scheduler.cancelledFrames, [pendingFrame]);
    assert.ok(scheduler.cancelledTimers.includes(pendingAnnouncement));
    assert.equal(scheduler.frames.size, 0);
    assert.equal(root.__athenaSemanticWorkspaceState.pendingDomUpdates.size, 0);
    assert.equal(root.__athenaSemanticWorkspaceState.observationIndex.size, 1);

    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: bindingId, value: '80200' }],
    }), 1);
    scheduler.flushFrames();
    const target = root.__athenaSemanticWorkspaceState.observationIndex.get(observationId)[0];
    assert.equal(target.querySelector('.semantic-workspace-value').textContent, '80200 원');
    assert.equal(target.classList.contains('is-realtime-updated'), false);
    disposeRealtime(root);
    assert.equal(root.__athenaSemanticWorkspaceState.observationIndex.size, 0);
  } finally {
    delete global.document;
  }
});

test('explicit empty realtime bindings delete the current workspace binding table', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const bindingId = 'rtb_eeeeeeeeeeeeeeeeeeee';
  const observationId = 'obs_ffffffffffffffffffff';
  const contract = {
    recipe_id: 'quote', title_ko: '현재 시세', sections: [{
      section_id: 'quote-context', title_ko: '현재 시세', fields: [{
        observation_id: observationId, concept_id: 'quote.last-price',
        label_ko: '현재가', value: '150,000', unit: '원',
      }],
    }],
  };
  try {
    upsert(root, taskEnvelope({
      view_instance_id: 'binding-delete', presentation_contract: contract,
      realtime_bindings: [{ binding_id: bindingId, observation_id: observationId }],
    }));
    assert.equal(root.__athenaSemanticWorkspaceState.realtimeBindings.size, 1);
    upsert(root, taskEnvelope({
      view_instance_id: 'binding-delete', presentation_contract: contract,
      realtime_bindings: [],
    }));
    assert.equal(root.__athenaSemanticWorkspaceState.realtimeBindings.size, 0);
    assert.equal(applyRealtimeTick(root, { semantic_updates: [{ binding_id: bindingId, value: '151,000' }] }), 0);
  } finally {
    delete global.document;
  }
});

test('the first typed envelope requires both generations, an explicit policy, and a full binding array', () => {
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const base = {
    canvas_type: 'facts', view_instance_id: 'initial-typed-view',
    view_recipe: { recipe_id: 'instrument-overview', title_ko: '종목 요약' },
    presentation_contract: { sections: [{
      section_id: 'quote-context', title_ko: '현재 시세',
      fields: [{ concept_id: 'quote.last-price', label_ko: '현재가', value: '150,000', unit: '원' }],
    }] },
  };
  const invalid = [
    { ...base, workspace_generation: 1, update_policy: 'replace', realtime_bindings: [] },
    { ...base, view_generation: 1, update_policy: 'replace', realtime_bindings: [] },
    { ...base, workspace_generation: 1, view_generation: 1, realtime_bindings: [] },
    { ...base, workspace_generation: 1, view_generation: 1, update_policy: 'append', realtime_bindings: [] },
    { ...base, workspace_generation: 1, view_generation: 1, update_policy: 'replace' },
  ];
  try {
    for (const envelope of invalid) {
      const root = new FakeElement();
      const body = new FakeElement();
      body.className = 'card-body';
      root.appendChild(body);
      assert.equal(upsert(root, envelope), null);
      assert.equal(root.__athenaSemanticWorkspaceState, undefined);
      assert.equal(root.querySelector('.semantic-workspace'), null);
    }

    const root = new FakeElement();
    const body = new FakeElement();
    body.className = 'card-body';
    root.appendChild(body);
    const workspace = upsert(root, {
      ...base,
      taskCanvas: {
        workspaceGeneration: 1,
        viewGeneration: 1,
        updatePolicy: 'replace',
        realtimeBindings: [],
      },
    });
    assert.ok(workspace);
    assert.equal(root.__athenaSemanticWorkspaceState.workspaceGeneration, 1);
    assert.equal(root.__athenaSemanticWorkspaceState.viewGeneration, 1);
    assert.equal(root.__athenaSemanticWorkspaceState.realtimeBindings.size, 0);
  } finally {
    delete global.document;
  }
});

test('workspace and view generations discard stale or unscoped follow-ups without mutating visible state', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const envelope = (value, generations = {}) => ({
    canvas_type: 'facts', view_instance_id: 'generation-view', ...generations,
    update_policy: 'enrich',
    realtime_bindings: [],
    view_recipe: { recipe_id: 'instrument-overview', title_ko: '종목 요약' },
    presentation_contract: { sections: [{
      section_id: 'quote-context', title_ko: '현재 시세', fields: [{
        concept_id: 'quote.last-price', label_ko: '현재가', value, unit: '원',
      }],
    }] },
  });
  try {
    upsert(root, envelope('150,000', { workspace_generation: 4, view_generation: 7 }));
    upsert(root, envelope('149,000', { workspace_generation: 3, view_generation: 8 }));
    assert.match(visibleText(root.querySelector('.semantic-workspace')), /150,000 원/);
    assert.doesNotMatch(visibleText(root.querySelector('.semantic-workspace')), /149,000 원/);
    upsert(root, envelope('148,000'));
    assert.doesNotMatch(visibleText(root.querySelector('.semantic-workspace')), /148,000 원/,
      'a generated workspace must reject a legacy unscoped follow-up');
    upsert(root, envelope('151,000', { workspaceGeneration: 5, viewGeneration: 8 }));
    assert.match(visibleText(root.querySelector('.semantic-workspace')), /151,000 원/);
    assert.equal(root.__athenaSemanticWorkspaceState.workspaceGeneration, 5);
    assert.equal(root.__athenaSemanticWorkspaceState.viewGeneration, 8);

    upsert(root, {
      ...envelope('70,000', { workspace_generation: 4, view_generation: 1 }),
      view_instance_id: 'new-but-stale-workspace',
    });
    assert.equal(root.__athenaSemanticWorkspaceState.viewInstanceId, 'generation-view');
    assert.doesNotMatch(visibleText(root.querySelector('.semantic-workspace')), /70,000 원/,
      'a new view cannot roll the root workspace generation backwards');
  } finally {
    delete global.document;
  }
});

test('equal or incomplete typed generations cannot mutate visible DOM or the authoritative binding table', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const observationId = 'obs_12121212121212121212';
  const firstBindingId = 'rtb_34343434343434343434';
  const nextBindingId = 'rtb_56565656565656565656';
  const envelope = (workspaceGeneration, viewGeneration, value, realtimeBindings) => {
    const result = {
      canvas_type: 'facts', view_instance_id: 'strict-generation-view',
      workspace_generation: workspaceGeneration, view_generation: viewGeneration,
      update_policy: 'enrich',
      view_recipe: { recipe_id: 'instrument-overview', title_ko: '종목 요약' },
      presentation_contract: { sections: [{
        section_id: 'quote-context', title_ko: '현재 시세', fields: [{
          observation_id: observationId, concept_id: 'quote.last-price',
          label_ko: '현재가', value, unit: '원',
        }],
      }] },
    };
    if (realtimeBindings !== undefined) result.realtime_bindings = realtimeBindings;
    return result;
  };
  const firstBindings = [{ binding_id: firstBindingId, observation_id: observationId }];
  const nextBindings = [{ binding_id: nextBindingId, observation_id: observationId }];
  try {
    upsert(root, envelope(2, 4, '150,000', firstBindings));
    const workspace = root.querySelector('.semantic-workspace');
    const bindingTable = root.__athenaSemanticWorkspaceState.realtimeBindings;

    upsert(root, envelope(2, 4, '999,999', []));
    upsert(root, envelope(3, 4, '888,888', nextBindings));
    upsert(root, envelope(2, 5, '777,777', nextBindings));
    upsert(root, envelope(3, 5, '666,666', undefined));

    assert.equal(root.querySelector('.semantic-workspace'), workspace);
    assert.match(visibleText(workspace), /150,000 원/);
    assert.doesNotMatch(visibleText(workspace), /999,999|888,888|777,777|666,666/);
    assert.equal(root.__athenaSemanticWorkspaceState.realtimeBindings, bindingTable);
    assert.deepEqual([...bindingTable.keys()], [firstBindingId]);

    upsert(root, envelope(3, 5, '151,000', nextBindings));
    assert.match(visibleText(workspace), /151,000 원/);
    assert.deepEqual([...root.__athenaSemanticWorkspaceState.realtimeBindings.keys()], [nextBindingId]);
  } finally {
    delete global.document;
  }
});

test('a stale empty lifecycle envelope cannot clear the current semantic workspace', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  const lifecycle = new FakeElement();
  lifecycle.className = 'task-realtime-lifecycle';
  root.appendChild(lifecycle);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    upsert(root, {
      canvas_type: 'facts', view_instance_id: 'lifecycle-generation',
      workspace_generation: 5, view_generation: 2,
      update_policy: 'replace',
      realtime_bindings: [],
      view_recipe: { recipe_id: 'instrument-overview', title_ko: '종목 요약' },
      presentation_contract: { sections: [{
        section_id: 'quote-context', title_ko: '현재 시세',
        fields: [{ concept_id: 'quote.last-price', label_ko: '현재가', value: '150,000', unit: '원' }],
      }] },
    });
    const workspace = root.querySelector('.semantic-workspace');
    assert.equal(root.dataset.semanticWorkspaceStatus, 'available');
    assert.equal(upsert(root, {
      canvas_type: 'facts', view_instance_id: 'lifecycle-generation',
      workspace_generation: 4, view_generation: 3,
      update_policy: 'replace',
      realtime_bindings: [],
      view_recipe: { recipe_id: 'instrument-overview', title_ko: '종목 요약' },
      presentation_contract: { sections: [] },
    }), workspace);
    assert.equal(root.querySelector('.semantic-workspace'), workspace);
    assert.equal(root.dataset.semanticWorkspaceStatus, 'available');
    assert.match(visibleText(workspace), /150,000 원/);
  } finally {
    delete global.document;
  }
});

test('replace clears prior sections, enrich preserves them, and a new view instance is isolated', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  const envelope = (viewInstanceId, sectionId, label, value, updatePolicy) => ({
    canvas_type: 'facts', view_instance_id: viewInstanceId, update_policy: updatePolicy,
    view_recipe: { recipe_id: 'instrument-overview', title_ko: '종목 요약' },
    presentation_contract: { sections: [{
      section_id: sectionId, title_ko: label,
      fields: [{ concept_id: sectionId, label_ko: label, value }],
    }] },
  });
  try {
    upsert(root, envelope('view-a', 'quote-context', '현재가', '150,000', 'replace'));
    upsert(root, envelope('view-a', 'price-history', '기간 등락률', '+3.2', 'enrich'));
    assert.match(visibleText(root.querySelector('.semantic-workspace')), /150,000/);
    assert.match(visibleText(root.querySelector('.semantic-workspace')), /\+3\.2/);

    upsert(root, envelope('view-a', 'price-history', '기간 등락률', '+4.0', 'replace'));
    assert.doesNotMatch(visibleText(root.querySelector('.semantic-workspace')), /150,000/);
    assert.match(visibleText(root.querySelector('.semantic-workspace')), /\+4\.0/);

    upsert(root, envelope('view-b', 'quote-context', '현재가', '80,000', 'enrich'));
    assert.equal(root.__athenaSemanticWorkspaceState.viewInstanceId, 'view-b');
    assert.doesNotMatch(visibleText(root.querySelector('.semantic-workspace')), /\+4\.0/);
    assert.match(visibleText(root.querySelector('.semantic-workspace')), /80,000/);

    const currentWorkspace = root.querySelector('.semantic-workspace');
    upsert(root, envelope('view-b', 'price-history', '기간 등락률', '+9.9', 'append-or-replace'));
    assert.equal(root.querySelector('.semantic-workspace'), currentWorkspace);
    assert.doesNotMatch(visibleText(currentWorkspace), /\+9\.9/,
      'an unknown update policy must fail closed instead of guessing a merge rule');
  } finally {
    delete global.document;
  }
});

test('same view instance progressively keeps prior successful sections', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    upsert(root, {
      canvas_type: 'facts', view_instance_id: 'view-one',
      view_recipe: { recipe_id: 'instrument-chart', title_ko: '종목 차트' },
      presentation_contract: { sections: [{
        section_id: 'identity-and-quote', title_ko: 'identity and quote',
        fields: [{ concept_id: 'quote.last-price', label_ko: '현재가', value: '150,000', unit: '원' }],
      }] },
    });
    const workspace = upsert(root, {
      canvas_type: 'facts', view_instance_id: 'view-one',
      view_recipe: { recipe_id: 'instrument-chart', title_ko: '종목 차트' },
      presentation_contract: { sections: [
        { section_id: 'identity-and-quote', title_ko: 'identity and quote', fields: [] },
        { section_id: 'price-history', title_ko: 'price history', fields: [
          { concept_id: 'chart.change-rate', label_ko: '기간 등락률', value: '+3.2', unit: '%' },
        ] },
      ] },
    });
    const text = visibleText(workspace);
    assert.match(text, /150,000 원/);
    assert.match(text, /\+3\.2 %/);
  } finally {
    delete global.document;
  }
});

test('public semantic columns and rows preserve every array row as a table', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  const ids = ['obs_11111111111111111111', 'obs_22222222222222222222', 'obs_33333333333333333333'];
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, {
      canvas_type: 'facts', view_instance_id: 'array-view',
      view_recipe: { recipe_id: 'market-vi', title_ko: '시장 상태와 VI' },
      presentation_contract: { sections: [{
        section_id: 'affected-instruments', title_ko: 'affected instruments',
        columns: [{ key: 'col_abc123', label_ko: '종목코드', unit: 'identifier' }],
        rows: [{ col_abc123: '005930' }, { col_abc123: '000660' }, { col_abc123: '035420' }],
        fields: [],
      }] },
      semantic_observations: ids.map((observation_id, array_index) => ({
        observation_id, array_index, section_id: 'affected-instruments',
        concept_id: 'market-status.9001', label_ko: '종목코드',
        value: ['005930', '000660', '035420'][array_index], field_class: 'semantic',
      })),
    });
    const text = visibleText(workspace);
    assert.match(text, /005930/);
    assert.match(text, /000660/);
    assert.match(text, /035420/);
    assert.doesNotMatch(text, /identifier|source-defined-number-or-text/);
    const cells = findTags(workspace, 'td');
    assert.equal(cells.length, 3);
    assert.deepEqual(cells.map((cell) => cell.dataset.semanticObservationId), ids);
  } finally {
    delete global.document;
  }
});

test('observations-only compatibility path keeps array indexes as separate semantic rows', () => {
  const presentation = normalizePresentation({
    canvas_type: 'facts', view_instance_id: 'compat-array',
    view_recipe: { recipe_id: 'market-vi', title_ko: '시장 상태와 VI' },
    presentation_contract: { sections: [{
      section_id: 'affected-instruments', title_ko: 'affected instruments', fields: [],
    }] },
    semantic_observations: [
      { observation_id: 'obs_aaaaaaaaaaaaaaaaaaaa', array_index: 0, section_id: 'affected-instruments', concept_id: 'market-status.9001', label_ko: '종목코드', value: '005930' },
      { observation_id: 'obs_bbbbbbbbbbbbbbbbbbbb', array_index: 1, section_id: 'affected-instruments', concept_id: 'market-status.9001', label_ko: '종목코드', value: '000660' },
    ],
  });
  const section = presentation.sections[0];
  assert.equal(section.fields.length, 0);
  assert.equal(section.columns.length, 1);
  assert.equal(section.rows.length, 2);
  assert.deepEqual(section.rows.map((row) => row.values['market-status.9001']), ['005930', '000660']);
});

test('wire-looking observation identity is never stamped into product DOM', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, {
      canvas_type: 'facts', view_instance_id: 'unsafe-id',
      view_recipe: { recipe_id: 'market-vi', title_ko: '시장 상태와 VI' },
      presentation_contract: { sections: [{
        section_id: 'affected-instruments', title_ko: 'affected instruments',
        columns: [{ key: 'col_safe', label_ko: '종목코드' }], rows: [{ col_safe: '005930' }], fields: [],
      }] },
      semantic_observations: [{
        observation_id: 'base:1h:$.data[].9001', array_index: 0,
        section_id: 'affected-instruments', concept_id: 'market-status.9001', label_ko: '종목코드', value: '005930',
      }],
    });
    assert.equal(findTags(workspace, 'td')[0].dataset.semanticObservationId, undefined);
  } finally {
    delete global.document;
  }
});

test('free source JSON is not inspected when the presentation contract has no sections', () => {
  const presentation = normalizePresentation(taskEnvelope({
    source_data: { operation_ref: 'base:secret', data: { '1279': 'raw:1' } },
    presentation_contract: { recipe_id: 'empty', title_ko: '분석 결과', sections: [] },
  }));
  assert.deepEqual(presentation.sections, []);
});

test('display tiers sort answer to detail and scalar detail stays in a named section disclosure', () => {
  const root = new FakeElement('div');
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, taskEnvelope({
      presentation_contract: {
        title_ko: '투자 판단',
        sections: [{
          section_id: 'move-summary', title_ko: '가격 변화 요약',
          fields: [
            { concept_id: 'd', label_ko: '세부 근거', value: 'D', display_tier: 'detail', display_order: 4 },
            { concept_id: 's', label_ko: '보조 지표', value: 'S', display_tier: 'secondary', display_order: 3 },
            { concept_id: 'a', label_ko: '한줄 답변', value: 'A', display_tier: 'answer', display_order: 1 },
            { concept_id: 'p', label_ko: '핵심 지표', value: 'P', display_tier: 'primary', display_order: 2 },
          ],
        }],
      },
    }));
    const presentation = normalizePresentation(taskEnvelope({
      presentation_contract: {
        sections: [{
          section_id: 'move-summary', title_ko: '가격 변화 요약',
          fields: [
            { concept_id: 'd', label_ko: '세부 근거', value: 'D', display_tier: 'detail', display_order: 4 },
            { concept_id: 'a', label_ko: '한줄 답변', value: 'A', display_tier: 'answer', display_order: 1 },
          ],
        }],
      },
    }));
    assert.deepEqual(presentation.sections[0].fields.map((field) => field.displayTier), ['answer', 'detail']);
    assert.match(visibleText(workspace), /한줄 답변[\s\S]*핵심 지표[\s\S]*보조 지표[\s\S]*가격 변화 요약 상세[\s\S]*세부 근거/);
    assert.equal(findTags(workspace, 'details').length, 1);
    assert.equal(findTags(workspace, 'summary')[0].textContent, '가격 변화 요약 상세');
  } finally {
    delete global.document;
  }
});

test('display slot families render as ranked compound rows without numbered raw labels', () => {
  const root = new FakeElement('div');
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, taskEnvelope({
      presentation_contract: {
        sections: [{
          section_id: 'liquidity-provider', title_ko: '유동성 공급자', status: 'available',
          fields: [
            {
              concept_id: 'lp.member.1', label_ko: 'LP 회원사1', value: '한국투자증권',
              display_group: 'LP 회원사', display_slot: 1, display_tier: 'support',
            },
            {
              concept_id: 'lp.member.2', label_ko: 'LP 회원사2', value: '미래에셋증권',
              display_group: 'LP 회원사', display_slot: 2, display_tier: 'support',
            },
          ],
        }],
      },
    }));
    const text = visibleText(workspace);
    assert.match(text, /LP 회원사[\s\S]*1순위[\s\S]*한국투자증권[\s\S]*2순위[\s\S]*미래에셋증권/);
    assert.doesNotMatch(text, /LP 회원사1|LP 회원사2/);
    assert.equal(findTags(workspace, 'h4').length, 1);
  } finally {
    delete global.document;
  }
});

test('detail:ka30012:underlying_basket groups each actual slot with distinct labeled subfields', () => {
  const root = new FakeElement('div');
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, taskEnvelope({
      operation_ref: 'detail:ka30012:underlying_basket',
      presentation_contract: { sections: [{
        section_id: 'underlying-basket', title_ko: '기초자산 구성', status: 'available',
        fields: [
          { concept_id: 'basket.asset.1', label_ko: '기초자산1', value: '삼성전자', display_group: '기초자산 구성', display_slot: 1 },
          { concept_id: 'basket.weight.1', label_ko: '구성비율1', value: '28.4', unit: '%', display_group: '기초자산 구성', display_slot: 1 },
          { concept_id: 'basket.asset.3', label_ko: '기초자산3', value: 'SK하이닉스', display_group: '기초자산 구성', display_slot: 3 },
          { concept_id: 'basket.weight.3', label_ko: '구성비율3', value: '17.2', unit: '%', display_group: '기초자산 구성', display_slot: 3 },
        ],
      }] },
    }));
    const text = visibleText(workspace);
    const rows = findClasses(workspace, 'semantic-workspace-slot-row');
    assert.equal(rows.length, 2);
    assert.match(visibleText(rows[0]), /1순위/);
    assert.match(visibleText(rows[0]), /기초자산[\s\S]*삼성전자/);
    assert.match(visibleText(rows[0]), /구성비율[\s\S]*28\.4 %/);
    assert.match(visibleText(rows[1]), /3순위/);
    assert.match(visibleText(rows[1]), /기초자산[\s\S]*SK하이닉스/);
    assert.match(visibleText(rows[1]), /구성비율[\s\S]*17\.2 %/);
    assert.doesNotMatch(text, /기초자산1|구성비율1|기초자산3|구성비율3/);
    assert.equal(findTags(workspace, 'h4').length, 1);
  } finally {
    delete global.document;
  }
});

test('detail:ka10002:sell_brokers keeps broker name code and volume together per source slot', () => {
  const root = new FakeElement('div');
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, taskEnvelope({
      operation_ref: 'detail:ka10002:sell_brokers',
      presentation_contract: { sections: [{
        section_id: 'sell-brokers', title_ko: '매도 거래원', status: 'available',
        fields: [
          { concept_id: 'broker.name.2', label_ko: '거래원명2', value: '한국투자증권', display_group: '매도 거래원', display_slot: 2 },
          { concept_id: 'broker.code.2', label_ko: '거래원코드2', value: '00003', display_group: '매도 거래원', display_slot: 2 },
          { concept_id: 'broker.volume.2', label_ko: '매도수량2', value: '128000', unit: '주', display_group: '매도 거래원', display_slot: 2 },
        ],
      }] },
    }));
    const text = visibleText(workspace);
    assert.match(text, /2순위[\s\S]*거래원명[\s\S]*한국투자증권[\s\S]*거래원코드[\s\S]*00003[\s\S]*매도수량[\s\S]*128000 주/);
    assert.equal(findTags(workspace, 'h4').length, 1);
  } finally {
    delete global.document;
  }
});

test('slotted table columns use normalized family labels with ordinal context', () => {
  const presentation = normalizePresentation(taskEnvelope({
    presentation_contract: {
      sections: [{
        section_id: 'result-table', status: 'available',
        columns: [
          { key: 'a', label_ko: '매도 거래원1', display_group: '매도 거래원', display_slot: 1 },
          { key: 'b', label_ko: '매도 거래원2', display_group: '매도 거래원', display_slot: 2 },
        ],
        rows: [{ a: '증권사 A', b: '증권사 B' }],
      }],
    },
  }));
  assert.deepEqual(presentation.sections[0].columns.map((column) => column.slotLabel), [
    '매도 거래원 1순위', '매도 거래원 2순위',
  ]);
  assert.doesNotMatch(presentation.sections[0].columns.map((column) => column.label).join(' '), /거래원1|거래원2/);
});

test('wide semantic tables keep eight main columns and every remaining cell in row-specific keyboard detail', () => {
  const root = new FakeElement('div');
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const columns = Array.from({ length: 10 }, (_unused, index) => ({
      key: `col_${index}`, label_ko: `항목 ${index + 1}`,
      display_tier: index < 2 ? 'primary' : index < 8 ? 'support' : 'detail',
      display_order: index + 1,
    }));
    const row = Object.fromEntries(columns.map((column, index) => [column.key, `값 ${index + 1}`]));
    const workspace = upsert(root, taskEnvelope({
      presentation_contract: {
        sections: [{ section_id: 'ranked-results', title_ko: '탐색 결과', columns, rows: [row] }],
      },
    }));
    assert.equal(findTags(workspace, 'th').length, 8);
    assert.equal(findTags(workspace, 'details').length, 1);
    assert.equal(findTags(workspace, 'summary')[0].textContent, '탐색 결과 1번째 항목 · 세부 지표');
    assert.doesNotMatch(findTags(workspace, 'summary')[0].textContent, /값 1|항목 1/);
    assert.match(visibleText(workspace), /항목 9[\s\S]*값 9[\s\S]*항목 10[\s\S]*값 10/);
  } finally {
    delete global.document;
  }
});

test('an all-state presentation collapses section placeholders into one atomic workspace state', () => {
  const presentation = normalizePresentation({
    canvas_type: 'task-canvas',
    view_recipe: {
      section_policies: [
        { section_id: 'quote-context', section_order: 3, visibility_policy: 'when-data', required: false },
        { section_id: 'depth-ladder', section_order: 1, visibility_policy: 'always', required: true },
        { section_id: 'trade-tape', section_order: 2, visibility_policy: 'when-data', required: false },
        { section_id: 'order-draft', section_order: 4, visibility_policy: 'workflow', workflow_only: true },
      ],
    },
    presentation_contract: {
      sections: [
        { section_id: 'quote-context', title_ko: '현재 시세', status: 'error' },
        { section_id: 'depth-ladder', title_ko: '매수·매도 호가', status: 'error' },
        { section_id: 'trade-tape', title_ko: '실시간 체결', status: 'loading' },
        { section_id: 'order-draft', title_ko: '주문 내용', status: 'available' },
      ],
    },
  });
  assert.deepEqual(presentation.sections, []);
  assert.equal(presentation.status, 'loading');
});

test('successful partial data omits contradictory empty required sections', () => {
  const presentation = normalizePresentation(taskEnvelope({
    presentation_contract: {
      status: 'available',
      sections: [
        {
          section_id: 'ranked-results', title_ko: '탐색 결과', status: 'available',
          fields: [{ concept_id: 'result.count', label_ko: '결과 수', value: 3 }],
        },
        {
          section_id: 'product-detail', title_ko: '상품 상세 정보', status: 'empty',
          visibility_policy: 'always', required: true,
        },
      ],
    },
  }));
  assert.deepEqual(presentation.sections.map((section) => section.id), ['ranked-results']);
  assert.equal(presentation.status, 'available');
});

test('rows dedupe only when an opaque row or observation identity proves they are the same projection', () => {
  const presentation = normalizePresentation(taskEnvelope({
    presentation_contract: {
      sections: [{
        section_id: 'result-table', status: 'available',
        columns: [{ key: 'col_a', label_ko: '종목명' }],
        rows: [
          { values: { col_a: '삼성전자' }, observationIds: { col_a: 'obs_aaaaaaaaaaaa' } },
          { values: { col_a: '삼성전자' }, observationIds: { col_a: 'obs_aaaaaaaaaaaa' } },
          { values: { col_a: '동일 값도 별도 행' } },
          { values: { col_a: '동일 값도 별도 행' } },
        ],
      }],
    },
  }));
  assert.equal(presentation.sections[0].rows.length, 3);
});

test('workflow sections render only when safe workflow fields are actually supplied', () => {
  const presentation = normalizePresentation({
    canvas_type: 'task-canvas',
    view_recipe: {
      section_policies: [{
        section_id: 'order-draft', section_order: 1, visibility_policy: 'workflow', workflow_only: true,
      }],
    },
    presentation_contract: {
      sections: [{
        section_id: 'order-draft', title_ko: '주문 내용',
        fields: [{ concept_id: 'order.quantity', label_ko: '주문 수량', value: 10, display_tier: 'answer' }],
      }],
    },
  });
  assert.equal(presentation.sections.length, 1);
  assert.equal(presentation.sections[0].fields[0].label, '주문 수량');
});

test('technical section ids are replaced with Korean product section names', () => {
  const presentation = normalizePresentation(taskEnvelope({
    presentation_contract: {
      sections: [
        { section_id: 'product-detail', fields: [{ concept_id: 'a', label_ko: '상품명', value: '삼성전자' }] },
        { section_id: 'result-table', fields: [{ concept_id: 'b', label_ko: '결과 수', value: 3 }] },
        { section_id: 'ranking-table', fields: [{ concept_id: 'c', label_ko: '순위', value: 1 }] },
      ],
    },
  }));
  assert.deepEqual(presentation.sections.map((section) => section.title), ['상품 상세 정보', '조회 결과', '순위 결과']);
});

test('error and empty sections never render synthetic fields or generic tables', () => {
  const root = new FakeElement('div');
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, taskEnvelope({
      presentation_contract: {
        sections: [
          {
            section_id: 'result-table', status: 'error', required: true, visibility_policy: 'always',
            fields: [{ concept_id: 'fake', label_ko: '임시 값', value: '표시하면 안 됨' }],
            columns: [{ key: 'col_a', label_ko: '임시 열' }], rows: [{ col_a: '임시 행' }],
          },
          {
            section_id: 'product-detail', status: 'empty', required: true, visibility_policy: 'always',
            fields: [{ concept_id: 'fake2', label_ko: '빈 값', value: '표시하면 안 됨' }],
          },
        ],
      },
    }));
    assert.equal(findTags(workspace, 'table').length, 0);
    assert.equal(findTags(workspace, 'dd').length, 0);
    assert.doesNotMatch(visibleText(workspace), /임시 값|임시 열|임시 행|빈 값|표시하면 안 됨/);
    assert.match(visibleText(workspace), /정보를 불러오지 못했습니다|표시할 데이터가 없습니다/);
  } finally {
    delete global.document;
  }
});

test('specialized orderbook primary suppresses the duplicate depth-ladder metric population', () => {
  const root = new FakeElement('div');
  const specialized = new FakeElement('section');
  specialized.className = 'card-kit-hoga-live';
  root.appendChild(specialized);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, taskEnvelope({
      presentation_contract: {
        sections: [
          {
            section_id: 'quote-context', title_ko: '현재 시세',
            fields: [{ concept_id: 'quote.price', label_ko: '현재가', value: 150000, display_tier: 'answer' }],
          },
          {
            section_id: 'depth-ladder', title_ko: '매수·매도 호가',
            fields: Array.from({ length: 167 }, (_unused, index) => ({
              concept_id: `depth.${index}`, label_ko: `호가 항목 ${index + 1}`, value: index, display_tier: 'support',
            })),
          },
        ],
      },
    }));
    assert.match(visibleText(workspace), /현재가/);
    assert.doesNotMatch(visibleText(workspace), /호가 항목/);
    assert.equal(findTags(workspace, 'dd').length, 1);
  } finally {
    delete global.document;
  }
});

test('shell loads semantic workspace before the canvas runtime', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  assert.ok(html.indexOf('lib/semantic-workspace.js') < html.indexOf('<script src="canvas.js"'));
});
