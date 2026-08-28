'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createChartFollowupTracker } = require('./chart-followup');

function dataset(code = '005930', question = '삼성전자 차트 보여줘') {
  return {
    datasetId: 'chart-dataset',
    question,
    items: [{ operationRef: 'base:ka10081', args: { stk_cd: code } }],
  };
}

function result(candles, overrides = {}) {
  return {
    ok: true,
    canvases: [{
      operationRef: 'base:ka10081',
      isDataCanvas: true,
      envelope: {
        data: {
          symbol: '005930',
          name: '삼성전자',
          chart: { target: 'stock', trId: 'ka10081', candles },
          ...overrides,
        },
      },
    }],
  };
}

test('answers a falling-chart follow-up from the latest two candles without exposing identifiers', () => {
  const tracker = createChartFollowupTracker();
  assert.equal(tracker.observe(result([
    { time: '2026-08-27', close: 71000 },
    { time: '2026-08-28', close: 70000 },
  ]), dataset()), true);

  const answer = tracker.answer('오늘은 떨어진거지?');
  assert.equal(answer.direction, 'down');
  assert.match(answer.answerText, /삼성전자.*1,000원\(1\.41%\).*내렸어요/);
  assert.doesNotMatch(answer.answerText, /005930|ka10081|base:/);
});

test('retains the user-facing stock name from the direct chart question when the envelope only has a symbol', () => {
  const tracker = createChartFollowupTracker();
  assert.equal(tracker.observe(result([
    { time: '2026-08-27', close: 71000 },
    { time: '2026-08-28', close: 70000 },
  ], { name: undefined }), dataset()), true);

  assert.match(tracker.answer('오늘은 떨어진거지?').answerText, /^삼성전자는/);
});

test('answers rising and flat follow-ups deterministically', () => {
  const rising = createChartFollowupTracker();
  rising.observe(result([
    { time: '2026-08-27', close: '70,000' },
    { time: '2026-08-28', close: '71,000' },
  ]), dataset());
  assert.deepEqual(rising.answer('오늘 올랐어?'), {
    matched: true,
    direction: 'up',
    answerText: '삼성전자는 최근 봉 기준 전 거래일보다 1,000원(1.43%) 올랐어요.',
  });

  const flat = createChartFollowupTracker();
  flat.observe(result([
    { time: '2026-08-27', close: 70000 },
    { time: '2026-08-28', close: 70000 },
  ]), dataset());
  assert.deepEqual(flat.answer('지금 보합인 거야?'), {
    matched: true,
    direction: 'flat',
    answerText: '삼성전자는 최근 봉 기준 종가가 전 거래일과 같은 70,000원이에요.',
  });
});

test('requires a successful matching stock day chart with two valid ascending candles', () => {
  const invalidCases = [
    result([{ time: '2026-08-28', close: 70000 }]),
    result([{ time: '2026-08-28', close: 70000 }, { time: '2026-08-27', close: 71000 }]),
    result([{ time: 'not-a-date', close: 71000 }, { time: '2026-08-28', close: 70000 }]),
    result([{ time: '2026-08-27', close: 71000 }, { time: '2026-08-28', close: 'unknown' }]),
    result([{ time: '2026-08-27', close: 71000 }, { time: '2026-08-28', close: 70000 }], { symbol: '000660' }),
  ];
  invalidCases.push({ ...result([{ time: '2026-08-27', close: 71000 }, { time: '2026-08-28', close: 70000 }]), ok: false });

  for (const invalid of invalidCases) {
    const tracker = createChartFollowupTracker();
    assert.equal(tracker.observe(invalid, dataset()), false);
    assert.equal(tracker.answer('오늘은 떨어진거지?'), null);
  }
});

test('abstains from unrelated, other-symbol, cause, news, and order questions', () => {
  const tracker = createChartFollowupTracker();
  tracker.observe(result([
    { time: '2026-08-27', close: 71000 },
    { time: '2026-08-28', close: 70000 },
  ]), dataset());

  for (const query of [
    '내일도 떨어질까?',
    'SK하이닉스는 오늘 떨어졌어?',
    '000660 오늘 올랐어?',
    '오늘 왜 떨어졌어?',
    '오늘 하락 뉴스 알려줘',
    '삼성전자 10주 매수해줘',
    '오늘 거래량은 어때?',
  ]) assert.equal(tracker.answer(query), null, query);
});

test('clear removes the captured chart context', () => {
  const tracker = createChartFollowupTracker();
  tracker.observe(result([
    { time: '2026-08-27', close: 71000 },
    { time: '2026-08-28', close: 70000 },
  ]), dataset());
  tracker.clear();
  assert.equal(tracker.answer('지금 하락한 거야?'), null);
});

test('a newer chart request clears the previous stock context even when the newer chart fails', () => {
  const tracker = createChartFollowupTracker();
  tracker.observe(result([
    { time: '2026-08-27', close: 71000 },
    { time: '2026-08-28', close: 70000 },
  ]), dataset());

  tracker.observe({ ok: false, canvases: [] }, dataset('000660', 'SK하이닉스 차트 보여줘'));
  assert.equal(tracker.answer('오늘은 떨어진거지?'), null);
});

test('a chart query routed outside the direct lane invalidates the old direct chart context', () => {
  const tracker = createChartFollowupTracker();
  tracker.observe(result([
    { time: '2026-08-27', close: 71000 },
    { time: '2026-08-28', close: 70000 },
  ]), dataset());

  assert.equal(tracker.invalidateForQuery('SK하이닉스 주봉 차트 보여줘'), true);
  assert.equal(tracker.answer('오늘은 떨어진거지?'), null);
});

test('any intervening non-follow-up turn expires the chart context', () => {
  const tracker = createChartFollowupTracker();
  tracker.observe(result([
    { time: '2026-08-27', close: 71000 },
    { time: '2026-08-28', close: 70000 },
  ]), dataset());

  assert.equal(tracker.invalidateForQuery('SK하이닉스 전망 알려줘'), true);
  assert.equal(tracker.answer('오늘은 떨어진거지?'), null);
});
