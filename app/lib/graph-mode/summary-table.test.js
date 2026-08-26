// summary-table.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderSummaryTable, describeRendered, createSummaryTableController } =
  require('./summary-table');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

test.beforeEach(() => {
  installFakeDocument();
});

test.afterEach(() => {
  uninstallFakeDocument();
});

function entry(overrides) {
  return {
    entity_id: 'e:samsung',
    entity_kind: 'stock',
    entity_name: '삼성전자',
    relation_kind: '보유',
    confidence: 'EXTRACTED',
    tier: 'deterministic',
    rationale: '체결 4건 · 평균 71,200원',
    observed_at: '2026-08-24T00:00:00+00:00',
    reinforcement: 12,
    ...overrides,
  };
}

// ── 순수 렌더 ────────────────────────────────────────────────────────────────

test('행마다 대상·관계·근거·보강이 그려진다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry()]);
  const summary = describeRendered(container);
  assert.equal(summary.rendered, true);
  assert.equal(summary.rows, 1);
});

test('entity_id가 없는 항목은 건너뛴다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry({ entity_id: '' }), entry()]);
  assert.equal(describeRendered(container).rows, 1, '망가진 행을 그리지 않는다');
});

test('근거(rationale)가 null이면 빈 칸이지 지어낸 문구가 아니다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry({ rationale: null })]);
  const table = container.querySelector('.summary-table');
  const row = table.querySelector('.summary-row');
  const rationaleCell = row.children.find((c) => String(c.attrs.class).includes('summary-row-rationale'));
  assert.equal(rationaleCell.textContent, '', '지어낸 값이 아니라 빈 문자열');
});

test('보강 수는 그대로 문자열로 나온다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry({ reinforcement: 21 })]);
  const table = container.querySelector('.summary-table');
  const row = table.querySelector('.summary-row');
  const reinforcementCell = row.children.find((c) => String(c.attrs.class).includes('summary-row-reinforcement'));
  assert.equal(reinforcementCell.textContent, '21');
});

test('다시 그리면 이전 내용을 지운다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry(), entry({ entity_id: 'e:b' })]);
  renderSummaryTable(container, [entry()]);
  assert.equal(container.children.length, 1, '표가 쌓이지 않는다');
  assert.equal(describeRendered(container).rows, 1);
});

test('빈 목록도 터지지 않는다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, []);
  const summary = describeRendered(container);
  assert.equal(summary.rendered, true, '표 자체는 만든다 — 빈 화면과 고장을 구분해야 한다');
  assert.equal(summary.rows, 0);
});

test('컨테이너가 없으면 조용히 넘어간다', () => {
  assert.equal(renderSummaryTable(null, [entry()]), null);
});

test('접근성 요약이 붙는다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry(), entry({ entity_id: 'e:b' })]);
  const table = container.querySelector('.summary-table');
  assert.equal(table.attrs.role, 'table');
  assert.match(table.attrs['aria-label'], /2건/);
});

// ── 컨트롤러: fetch·행 클릭·selectEntity 배선 ────────────────────────────────

function setupController(options) {
  const opts = options || {};
  const container = fakeNode('div');
  const selected = [];
  const errors = [];
  const controller = createSummaryTableController({
    container,
    limit: opts.limit === undefined ? 5 : opts.limit,
    fetchProfileSummary: async (params) => {
      if (opts.fail) throw new Error('backend down');
      if (opts.notOk) return { ok: false, error: 'boom' };
      opts.onFetch && opts.onFetch(params);
      return { ok: true, entries: opts.entries || [entry()] };
    },
    selectEntity: (entityId, panelData) => selected.push({ entityId, panelData }),
    onError: (err) => errors.push(err),
  });
  return { controller, container, selected, errors };
}

test('load()가 성향 신호를 그린다', async () => {
  const { controller, container } = setupController({ entries: [entry(), entry({ entity_id: 'e:b' })] });
  await controller.load();
  assert.equal(describeRendered(container).rows, 2);
});

test('limit이 fetchProfileSummary로 그대로 전달된다', async () => {
  let seenParams = null;
  const { controller } = setupController({ limit: 5, onFetch: (params) => { seenParams = params; } });
  await controller.load();
  assert.deepEqual(seenParams, { limit: 5 });
});

test('행을 클릭하면 selectEntity가 실재 필드로만 채운 panelData로 불린다', async () => {
  const { controller, container, selected } = setupController({ entries: [entry()] });
  await controller.load();
  const row = container.querySelector('.summary-row');
  row.dispatchEvent({ type: 'click' });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].entityId, 'e:samsung');
  assert.deepEqual(selected[0].panelData, {
    entityId: 'e:samsung',
    name: '삼성전자',
    kind: 'stock',
    relation: '보유',
    rationale: '체결 4건 · 평균 71,200원',
    reinforcement: 12,
  });
});

test('백엔드가 죽으면 빈 표를 그리고 오류를 삼키지 않는다', async () => {
  const { controller, container, errors } = setupController({ fail: true });
  await controller.load();
  assert.equal(describeRendered(container).rows, 0);
  assert.equal(errors.length, 1);
});

test('ok:false 응답도 오류로 다룬다', async () => {
  const { controller, errors } = setupController({ notOk: true });
  await controller.load();
  assert.equal(errors.length, 1);
});

test('다시 load()하면 표가 새로 그려진다(쌓이지 않는다)', async () => {
  const { controller, container } = setupController({ entries: [entry()] });
  await controller.load();
  await controller.load();
  assert.equal(container.children.length, 1);
});
