'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCardModel, nodeSummary, shortDate, COUNTED_UNTIL } = require('./watch-check-card');

const NODES = [
  { fn: 'load_bars', title_ko: '일봉 불러오기', called: true },
  { fn: 'avg_volume', title_ko: '3일 거래량 평균', called: true },
  { fn: 'volume_ratio', title_ko: '배수 비교', called: true },
  { fn: 'fire', title_ko: '알림', called: true },
];

const OK_CHECK = {
  ok: true,
  count: 4,
  lookback_days: 30,
  fires: [
    { dt: '2026-08-05', close: 71000 },
    { dt: '2026-08-12', close: 72500 },
    { dt: '2026-08-19', close: 73100 },
    { dt: '2026-08-26', close: 74200 },
  ],
  last_fire: '2026-08-26',
  nodes: NODES,
  counted_until: '어제까지로 세었음 · 오늘은 진행 중',
};

const DRAFT = { id: 'r1', note: '거래량 급증 감시', mode: 'code-watch', symbol: '005930' };

test('checkCardModel(통과): 보드 10 문구 — 배지·제목·노드 줄·오늘 고지', () => {
  const m = checkCardModel(OK_CHECK, DRAFT);
  assert.deepEqual(m.tags, ['새 알람', '검사 통과']);
  assert.equal(m.title, '거래량 급증 감시 — 지난 30일 4번 · 마지막 8/26');
  assert.equal(m.subtitle, '노드 4개 · 일봉 불러오기 → 3일 거래량 평균 → 배수 비교 → 알림');
  assert.equal(m.countedUntil, '어제까지로 세었음 · 오늘은 진행 중'); // A-10
  assert.equal(m.failed, false);
  assert.equal(m.reason, '');
});

test('checkCardModel(통과): 칩 2개 — 승인·고치기 모두 누를 수 있다', () => {
  const m = checkCardModel(OK_CHECK, DRAFT);
  assert.deepEqual(m.chips, [
    { label: '이 알람 승인', action: 'confirm', enabled: true },
    { label: '고칠 게 있어', action: 'revise', enabled: true },
  ]);
});

test('검사 결과: 센 마지막 날을 끝으로 30칸과 실제 울린 날짜·종가만 전달한다', () => {
  const check = { ...OK_CHECK, counted_through: '2026-09-02' };
  const before = JSON.stringify(check);
  const model = checkCardModel(check, DRAFT);
  assert.ok(Array.isArray(model.fireDots), '센 날짜를 점 띠 모델로 전달한다');
  assert.equal(model.fireDots.length, 30);
  assert.equal(model.fireDots[0].date, '2026-08-04');
  assert.equal(model.fireDots.at(-1).date, '2026-09-02');
  assert.deepEqual(model.fireDots.filter((dot) => dot.state === 'fired').map((dot) => dot.date),
    ['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']);
  assert.deepEqual(model.fireRows, ['8/5 · 종가 71,000', '8/12 · 종가 72,500', '8/19 · 종가 73,100', '8/26 · 종가 74,200']);
  assert.equal(JSON.stringify(check), before, '응답 원본을 바꾸지 않는다');
});

test('검사 결과: 성공한 0회는 조용한 칸만, 실패는 결과 띠·목록 모두 없음', () => {
  const empty = checkCardModel({ ...OK_CHECK, count: 0, fires: [], last_fire: null, counted_through: '2026-09-02' }, DRAFT);
  assert.ok(Array.isArray(empty.fireDots), '성공한 0회도 검사 구간을 전달한다');
  assert.equal(empty.fireDots.length, 30);
  assert.ok(empty.fireDots.every((dot) => dot.state === 'quiet'));
  assert.deepEqual(empty.fireRows, []);
  const failed = checkCardModel({ ...OK_CHECK, ok: false, counted_through: '2026-09-02' }, DRAFT);
  assert.deepEqual(failed.fireDots, []);
  assert.deepEqual(failed.fireRows, []);
});

test('검사 결과: 날짜 구간이나 종가가 없으면 달력·배수를 추정하지 않는다', () => {
  const model = checkCardModel({ ok: true, count: 1, fires: [{ dt: '2026-08-26' }] }, DRAFT);
  assert.deepEqual(model.fireDots, []);
  assert.deepEqual(model.fireRows, ['8/26']);
  assert.equal(model.dateWindowNote, '검사 구간 날짜를 붙이지 못함 — 울린 날만 표시');
});

test('checkCardModel(실패): 사유를 싣고 승인 칩은 내지 않는다', () => {
  const m = checkCardModel({ ok: false, reason: '칸 2개의 값을 못 읽음 — 다시 만들어 볼게', nodes: NODES }, DRAFT);
  assert.deepEqual(m.tags, ['새 알람', '검사 실패']);
  assert.equal(m.title, '거래량 급증 감시 — 검사 실패');
  assert.equal(m.failed, true);
  assert.equal(m.reason, '칸 2개의 값을 못 읽음 — 다시 만들어 볼게');
  assert.deepEqual(m.chips, [{ label: '고칠 게 있어', action: 'revise', enabled: true }]);
});

test('checkCardModel(실패): reason이 비면 진단 제목으로 대체', () => {
  const m = checkCardModel({ ok: false, diagnosis: { title: '3번째 줄 괄호가 안 닫힘' } }, DRAFT);
  assert.equal(m.reason, '3번째 줄 괄호가 안 닫힘');
  const bare = checkCardModel({ ok: false }, DRAFT);
  assert.ok(bare.reason.length > 0);
});

test('checkCardModel: 0번·last_fire 없음이면 마지막 날짜 칸을 붙이지 않는다', () => {
  const m = checkCardModel({ ok: true, count: 0, lookback_days: 30, fires: [], nodes: NODES }, DRAFT);
  assert.equal(m.title, '거래량 급증 감시 — 지난 30일 0번');
  assert.equal(m.countedUntil, COUNTED_UNTIL); // 백엔드가 안 보내도 기본 고지
});

test('checkCardModel: lookback_days 없으면 30일, last_fire 없으면 fires 마지막을 쓴다', () => {
  const m = checkCardModel({ ok: true, count: 2, fires: [{ dt: '2026-07-31' }, { dt: '2026-09-01' }], nodes: [] }, DRAFT);
  assert.equal(m.title, '거래량 급증 감시 — 지난 30일 2번 · 마지막 9/1');
  assert.equal(m.subtitle, '');
});

test('shortDate: 2026-08-26 → 8/26, 파싱 실패는 원문', () => {
  assert.equal(shortDate('2026-08-26'), '8/26');
  assert.equal(shortDate('2026-12-05'), '12/5');
  assert.equal(shortDate('어제'), '어제');
  assert.equal(shortDate(null), '');
});

test('nodeSummary: 한국어 제목이 없으면 영어 함수명으로 대체', () => {
  assert.equal(nodeSummary([{ fn: 'load_bars' }, { fn: 'fire', title_en: 'fire alert' }]), 'load_bars → fire alert');
  assert.equal(nodeSummary(null), '');
});

test('A-9 문자열 린트: 서술형 종결·내부 용어 없음', () => {
  const banned = ['습니다', '입니다', '합니다', '됩니다', 'IPC', 'enum', 'draft', 'payload', 'API', 'REST'];
  const models = [
    checkCardModel(OK_CHECK, DRAFT),
    checkCardModel({ ok: false }, DRAFT),
    checkCardModel({ ok: true, count: 0, nodes: NODES }, { note: '' }),
  ];
  const strings = [];
  for (const m of models) {
    strings.push(m.title, m.subtitle, m.countedUntil, m.reason, m.dateWindowNote,
      ...m.tags, ...m.chips.map((c) => c.label), ...m.fireRows);
  }
  for (const s of strings) {
    for (const word of banned) {
      assert.ok(!String(s).includes(word), `금지 문구 "${word}" — "${s}"`);
    }
  }
});
