// summary-table.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderSummaryTable,
  describeRendered,
  createSummaryTableController,
  computeConfidenceBreakdown,
  renderSummaryHero,
  renderConfirmBanner,
  dotClass,
  relativeDaysText,
} = require('./summary-table');
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

// ── dot·출처·최근 열(스텝4) ──────────────────────────────────────────────────

test('dotClass — 사실+체결기반(EXTRACTED+deterministic)만 채움 검정', () => {
  assert.equal(dotClass(entry({ confidence: 'EXTRACTED', tier: 'deterministic' })), 'summary-row-dot-fact');
});

test('dotClass — 불확실(AMBIGUOUS)은 tier와 무관하게 채움 주황', () => {
  assert.equal(dotClass(entry({ confidence: 'AMBIGUOUS', tier: 'deterministic' })), 'summary-row-dot-warn');
  assert.equal(dotClass(entry({ confidence: 'AMBIGUOUS', tier: 'conversational' })), 'summary-row-dot-warn');
});

test('dotClass — 나머지(추론, 또는 사실이지만 대화 출처)는 테두리만', () => {
  assert.equal(dotClass(entry({ confidence: 'INFERRED', tier: 'conversational' })), 'summary-row-dot-soft');
  assert.equal(dotClass(entry({ confidence: 'EXTRACTED', tier: 'conversational' })), 'summary-row-dot-soft');
});

test('renderRow — 출처 열은 tier를 한글로 번역한다(entry.source 필드가 없어도)', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry({ tier: 'deterministic' }), entry({ entity_id: 'e:b', tier: 'conversational' })]);
  const rows = container.querySelectorAll('.summary-row');
  const sourceOf = (row) => row.children.find((c) => String(c.attrs.class).includes('summary-row-source')).textContent;
  assert.equal(sourceOf(rows[0]), '체결·잔고');
  assert.equal(sourceOf(rows[1]), '대화');
});

test('relativeDaysText — 일/주 단위로 상대 시간을 낸다', () => {
  const base = Date.parse('2026-08-27T00:00:00Z');
  assert.equal(relativeDaysText('2026-08-27T00:00:00Z', base), '오늘');
  assert.equal(relativeDaysText('2026-08-25T00:00:00Z', base), '2일 전');
  assert.equal(relativeDaysText('2026-08-13T00:00:00Z', base), '2주 전');
});

test('relativeDaysText — 파싱 불가면 빈 문자열', () => {
  assert.equal(relativeDaysText('not-a-date', Date.now()), '');
});

test('renderSummaryTable — 열 머리글 행(아이콘+6열)이 붙는다', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry()]);
  const columns = container.querySelector('.summary-table-columns');
  const labels = columns.children.map((c) => c.textContent);
  assert.deepEqual(labels, ['', '대상', '관계', '근거', '출처', '보강', '최근']);
});

test('renderSummaryTable — 섹션 헤더("성향 신호"+"상위 N")가 붙고 "전체 M개"는 없다(총건수 필드가 없다)', () => {
  const container = fakeNode('div');
  renderSummaryTable(container, [entry(), entry({ entity_id: 'e:b' })]);
  const head = container.querySelector('.summary-table-head');
  assert.match(head.querySelector('.summary-table-title').textContent, /성향 신호/);
  assert.match(head.querySelector('.summary-table-subtitle').textContent, /상위 2/);
  assert.equal(head.children.length, 2, '전체 M개 보기 같은 3번째 조각이 없다');
});

// ── 히어로(스텝3) ────────────────────────────────────────────────────────────

test('computeConfidenceBreakdown — confidence 3종 카운트를 %로 반올림한다', () => {
  const entries = [
    entry({ confidence: 'EXTRACTED' }),
    entry({ confidence: 'EXTRACTED' }),
    entry({ confidence: 'INFERRED' }),
    entry({ confidence: 'AMBIGUOUS' }),
  ];
  assert.deepEqual(computeConfidenceBreakdown(entries), { fact: 50, inference: 25, ambiguous: 25, total: 4 });
});

test('computeConfidenceBreakdown — 빈 목록·인식 못 하는 confidence는 total 0', () => {
  assert.deepEqual(computeConfidenceBreakdown([]), { fact: 0, inference: 0, ambiguous: 0, total: 0 });
  assert.deepEqual(
    computeConfidenceBreakdown([entry({ confidence: 'UNKNOWN' })]),
    { fact: 0, inference: 0, ambiguous: 0, total: 0 },
  );
});

test('renderSummaryHero — entries가 있으면 라벨과 %를 그린다', () => {
  const container = fakeNode('div');
  renderSummaryHero(container, [entry({ confidence: 'EXTRACTED' }), entry({ confidence: 'AMBIGUOUS' })]);
  assert.equal(container.children.length, 1);
  const label = container.querySelector('.summary-hero-label');
  assert.equal(label.textContent, '지금 읽히는 성향');
  const values = container.querySelectorAll('.summary-hero-stat-value').map((n) => n.textContent);
  assert.deepEqual(values, ['50%', '0%', '50%'], '사실·추론·불확실 순서로 그려진다');
});

test('renderSummaryHero — scope를 주면 "테마 군집 N개 · 성향 신호 M개" 부제가 붙는다(보드 01)', () => {
  const container = fakeNode('div');
  renderSummaryHero(container, [entry()], null, { clusterCount: 7, total: 312 });
  assert.equal(container.querySelector('.summary-hero-scope').textContent, '테마 군집 7개 · 성향 신호 312개');
});

test('renderSummaryHero — 셀 수 없는 절은 빠지고, 둘 다 없으면 부제 자체가 없다(§0 정책)', () => {
  const onlyTotal = fakeNode('div');
  renderSummaryHero(onlyTotal, [entry()], null, { total: 312 });
  assert.equal(onlyTotal.querySelector('.summary-hero-scope').textContent, '성향 신호 312개');

  const neither = fakeNode('div');
  renderSummaryHero(neither, [entry()], null, {});
  assert.equal(neither.querySelector('.summary-hero-scope'), null);
});

test('renderSummaryHero — confidence_counts가 오면 창 전체 분포를 쓴다(상위 N 표본이 아니다)', () => {
  const container = fakeNode('div');
  // entries는 전부 추론인 상위 표본이지만, 창 전체는 사실이 더 많다.
  renderSummaryHero(container, [entry({ confidence: 'INFERRED' })], { EXTRACTED: 30, INFERRED: 10, AMBIGUOUS: 10 });
  assert.deepEqual(
    container.querySelectorAll('.summary-hero-stat-value').map((n) => n.textContent),
    ['60%', '20%', '20%']);
});

test('renderSummaryHero — 항목이 없으면 아예 안 그린다(§0 정직한 빈 데이터)', () => {
  const container = fakeNode('div');
  renderSummaryHero(container, []);
  assert.equal(container.children.length, 0);
});

test('renderSummaryHero — 다시 부르면 이전 내용을 지운다', () => {
  const container = fakeNode('div');
  renderSummaryHero(container, [entry()]);
  renderSummaryHero(container, []);
  assert.equal(container.children.length, 0, '두 번째 호출이 빈 목록이면 첫 렌더 잔재도 지운다');
});

// ── 확인 필요 배너(스텝3) ────────────────────────────────────────────────────

test('renderConfirmBanner — 개수가 있으면 그리고 hidden을 푼다', () => {
  const container = fakeNode('div');
  container.hidden = true;
  const clicks = [];
  renderConfirmBanner(container, 3, () => clicks.push('cta'));
  assert.equal(container.hidden, false);
  const title = container.querySelector('.confirm-banner-title');
  assert.equal(title.textContent, '확인이 필요한 것 3건');
  const cta = container.querySelector('.confirm-banner-cta');
  cta.dispatchEvent({ type: 'click' });
  assert.deepEqual(clicks, ['cta']);
});

test('renderConfirmBanner — 0/null/undefined면 배너를 숨긴다("0건"은 모순)', () => {
  for (const hintCount of [0, null, undefined, NaN]) {
    const container = fakeNode('div');
    renderConfirmBanner(container, hintCount, null);
    assert.equal(container.hidden, true, `hintCount=${hintCount}일 때 숨어야 한다`);
    assert.equal(container.children.length, 0);
  }
});

// ── 컨트롤러: fetch·행 클릭·selectEntity 배선 ────────────────────────────────

function setupController(options) {
  const opts = options || {};
  const container = fakeNode('div');
  const heroContainer = fakeNode('div');
  const bannerContainer = fakeNode('div');
  const selected = [];
  const errors = [];
  const controller = createSummaryTableController({
    container,
    heroContainer,
    bannerContainer,
    limit: opts.limit === undefined ? 5 : opts.limit,
    fetchProfileSummary: async (params) => {
      if (opts.fail) throw new Error('backend down');
      if (opts.notOk) return { ok: false, error: 'boom' };
      opts.onFetch && opts.onFetch(params);
      const res = { ok: true, entries: opts.entries || [entry()] };
      if (opts.total !== undefined) res.total = opts.total;
      return res;
    },
    fetchSuggestedQuestions: opts.fetchSuggestedQuestions,
    onConfirmCta: opts.onConfirmCta,
    selectEntity: (entityId, panelData) => selected.push({ entityId, panelData }),
    onError: (err) => errors.push(err),
    filters: opts.filters,
    getFilters: opts.getFilters,
  });
  return { controller, container, heroContainer, bannerContainer, selected, errors };
}

test('load()가 성향 신호를 그린다', async () => {
  const { controller, container } = setupController({ entries: [entry(), entry({ entity_id: 'e:b' })] });
  await controller.load();
  assert.equal(describeRendered(container).rows, 2);
});

test('limit이 fetchProfileSummary로 그대로 전달된다(필터 미주입이면 windowDays는 안 정한다)', async () => {
  let seenParams = null;
  const { controller } = setupController({ limit: 5, onFetch: (params) => { seenParams = params; } });
  await controller.load();
  // getFilters를 안 주면 백엔드 기본 창을 그대로 쓴다 — 임의의 창을 강요하지 않는다.
  assert.deepEqual(seenParams, { limit: 5, windowDays: undefined });
});

test('필터가 주입되면 기간이 백엔드 요청에 실리고 정렬이 표에 적용된다(보드 01 필터 칩)', async () => {
  const filters = require('./graph-filters');
  const older = entry({ entity_id: 'e:old', entity_name: '오래된', observed_at: '2026-08-01T00:00:00+00:00', reinforcement: 30 });
  const newer = entry({ entity_id: 'e:new', entity_name: '최근', observed_at: '2026-08-29T00:00:00+00:00', reinforcement: 2 });
  let seenParams = null;
  const { controller, container } = setupController({
    limit: 5,
    entries: [older, newer], // 백엔드 순서(보강 내림차순)
    onFetch: (params) => { seenParams = params; },
    filters,
    getFilters: () => ({ windowDays: 180, summarySort: 'recent' }),
  });
  await controller.load();
  assert.deepEqual(seenParams, { limit: 5, windowDays: 180 });
  const names = container.querySelectorAll('.summary-row-name').map((n) => n.textContent);
  assert.deepEqual(names, ['최근', '오래된'], '최근 순이면 관측 시각 내림차순이다');
});

test('보강 순이면 백엔드가 준 순서를 그대로 둔다(같은 값을 두 번 정렬하지 않는다)', async () => {
  const filters = require('./graph-filters');
  const a = entry({ entity_id: 'e:a', entity_name: 'A', reinforcement: 30, observed_at: '2026-08-01T00:00:00+00:00' });
  const b = entry({ entity_id: 'e:b', entity_name: 'B', reinforcement: 2, observed_at: '2026-08-29T00:00:00+00:00' });
  const { controller, container } = setupController({
    entries: [a, b], filters, getFilters: () => ({ windowDays: 90, summarySort: 'reinforcement' }),
  });
  await controller.load();
  assert.deepEqual(container.querySelectorAll('.summary-row-name').map((n) => n.textContent), ['A', 'B']);
});

test('응답에 total이 있으면 "전체 N개"가 붙고, 없으면 안 붙는다(§0 정책)', async () => {
  const withTotal = setupController({ entries: [entry()], total: 312 });
  await withTotal.controller.load();
  assert.equal(withTotal.container.querySelector('.summary-table-total').textContent, '전체 312개');

  const without = setupController({ entries: [entry()] });
  await without.controller.load();
  assert.equal(without.container.querySelector('.summary-table-total'), null);
});

test('total이 보이는 행 수와 같으면 "전체 N개"를 안 붙인다(같은 수를 두 번 말하지 않는다)', async () => {
  const { controller, container } = setupController({ entries: [entry()], total: 1 });
  await controller.load();
  assert.equal(container.querySelector('.summary-table-total'), null);
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
    source: 'table', // 선택 출처 태그 — controller.js의 selectNode()가 매기는 'node'와 짝.
    name: '삼성전자',
    kind: 'stock',
    relation: '보유',
    rationale: '체결 4건 · 평균 71,200원',
    reinforcement: 12,
    confidence: 'EXTRACTED',
    tier: 'deterministic',
    // 표 안에서 유일한 행이니 최댓값이기도 하다(보드 02 "가장 강한 신호").
    isStrongest: true,
    observedRelative: relativeDaysText('2026-08-24T00:00:00+00:00'),
    // 같은 엔티티의 행이 하나뿐이라 대조할 출처가 없다 — 패널이 "두 출처가
    // 다르게 말합니다" 제목을 안 붙일 근거가 이 배열 길이다.
    sources: [{ tier: 'deterministic', confidence: 'EXTRACTED', rationale: '체결 4건 · 평균 71,200원', relation: '보유' }],
  });
});

test('같은 엔티티에 출처가 둘이면 panelData.sources가 둘 다 싣는다(보드 02 티어 대조)', async () => {
  const conversational = entry({
    relation_kind: '선호', confidence: 'INFERRED', tier: 'conversational',
    rationale: '5개 대화에서 "장기로 간다"', reinforcement: 5,
  });
  const { controller, container, selected } = setupController({ entries: [entry(), conversational] });
  await controller.load();
  container.querySelector('.summary-row').dispatchEvent({ type: 'click' });
  const { sources, isStrongest } = selected[0].panelData;
  assert.deepEqual(sources.map((s) => s.tier), ['deterministic', 'conversational']);
  assert.equal(isStrongest, true, '보강 12가 5보다 크다');
});

test('보강이 최대가 아니면 isStrongest가 false다(없는 최상급을 붙이지 않는다)', async () => {
  const stronger = entry({ entity_id: 'e:hynix', entity_name: 'SK하이닉스', reinforcement: 21 });
  const { controller, container, selected } = setupController({ entries: [stronger, entry()] });
  await controller.load();
  // 두 번째 행(삼성전자, 보강 12)을 고른다.
  container.querySelectorAll('.summary-row')[1].dispatchEvent({ type: 'click' });
  assert.equal(selected[0].panelData.isStrongest, false);
});

test('getEntries()는 load() 전엔 빈 배열, 후엔 같은 entries를 그대로 돌려준다(스텝14, controller.js 재사용용)', async () => {
  const { controller } = setupController({ entries: [entry()] });
  assert.deepEqual(controller.getEntries(), []);
  await controller.load();
  assert.equal(controller.getEntries().length, 1);
  assert.equal(controller.getEntries()[0].entity_id, 'e:samsung');
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

// ── 컨트롤러: 히어로·확인 필요 배너 배선(스텝3) ─────────────────────────────

test('load()가 같은 entries로 히어로도 채운다', async () => {
  const { controller, heroContainer } = setupController({
    entries: [entry({ confidence: 'EXTRACTED' }), entry({ entity_id: 'e:b', confidence: 'AMBIGUOUS' })],
  });
  await controller.load();
  assert.equal(heroContainer.children.length, 1);
  assert.match(heroContainer.querySelector('.summary-hero-label').textContent, /지금 읽히는 성향/);
});

test('load()가 fetchSuggestedQuestions로 확인 필요 배너를 채운다', async () => {
  const { controller, bannerContainer } = setupController({
    fetchSuggestedQuestions: async () => ({ ok: true, questions: [{ q: 1 }, { q: 2 }] }),
  });
  await controller.load();
  assert.equal(bannerContainer.hidden, false);
  assert.equal(bannerContainer.querySelector('.confirm-banner-title').textContent, '확인이 필요한 것 2건');
});

test('fetchSuggestedQuestions가 없거나 실패해도 표 렌더 자체는 안 막힌다', async () => {
  const { controller, container, bannerContainer } = setupController({
    entries: [entry()],
    fetchSuggestedQuestions: async () => { throw new Error('questions down'); },
  });
  await controller.load();
  assert.equal(describeRendered(container).rows, 1, '배너 실패가 표 렌더를 막지 않는다');
  assert.equal(bannerContainer.hidden, true);
});

test('백엔드가 죽어도 히어로는 빈 데이터로 정리된다(잔재 없음)', async () => {
  const { controller, heroContainer } = setupController({ fail: true });
  await controller.load();
  assert.equal(heroContainer.children.length, 0);
});
