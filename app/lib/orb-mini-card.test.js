'use strict';

// Paper 키우미 보드 09 상한·고지 계약 고정.

const test = require('node:test');
const assert = require('node:assert/strict');

const mini = require('./orb-mini-card.js');

test('보드 09 상한표는 보드에 적힌 숫자 그대로다', () => {
  assert.deepEqual(mini.LIMITS, {
    tableRows: 3,
    factsRows: 5,
    compoundScalars: 3,
    compoundRows: 2,
    logRecords: 2,
    readerChars: 140,
  });
});

test('규칙 1 — 값이 없는 필드는 행이 되지 않고 접힌 수에도 들지 않는다', () => {
  const fields = [
    { key: 'a', value: 1 },
    { key: 'b', value: null },
    { key: 'c', value: '' },
    { key: 'd', value: undefined },
    { key: 'e', value: 2 },
  ];
  const picked = mini.pickFactsRows(fields);
  assert.equal(picked.shown.length, 2);
  assert.equal(picked.hidden, 0, '없는 값을 접었다고 세면 그것도 지어낸 수다');
  assert.equal(picked.total, 2);
});

test('규칙 1 — 0과 false는 값이다', () => {
  const picked = mini.pickFactsRows([{ key: 'a', value: 0 }, { key: 'b', value: false }]);
  assert.equal(picked.shown.length, 2);
});

test('사실은 5행까지 펴고 나머지는 개수만 밝힌다', () => {
  const fields = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, value: i + 1 }));
  const picked = mini.pickFactsRows(fields);
  assert.equal(picked.shown.length, 5);
  assert.equal(picked.hidden, 4);
  assert.equal(mini.foldNote('facts', { items: picked.hidden }), '항목 4개를 접었습니다 — 전체는 캔버스에서');
});

test('규칙 2 — 아무것도 안 접혔으면 고지를 내지 않는다', () => {
  assert.equal(mini.foldNote('facts', { items: 0 }), null);
  assert.equal(mini.foldNote('table', { columns: 0, rows: 0 }), null);
  assert.equal(mini.foldNote('compound', { scalars: 0, rows: 0 }), null);
  assert.equal(mini.foldNote('log', { shown: 2, total: 2 }), null);
  assert.equal(mini.foldNote('reader', { total: 0 }), null);
});

test('복합은 스칼라와 표를 따로 접는다', () => {
  const header = Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, value: i }));
  const rows = Array.from({ length: 6 }, (_, i) => ({ a: i }));
  const { scalars, table } = mini.pickCompound(header, rows);
  assert.equal(scalars.shown.length, 3);
  assert.equal(scalars.hidden, 3);
  assert.equal(table.shown.length, 2);
  assert.equal(table.hidden, 4);
  assert.equal(
    mini.foldNote('compound', { scalars: scalars.hidden, rows: table.hidden }),
    '스칼라 3개 · 행 4개를 접었습니다 — 전체는 캔버스에서',
  );
});

test('이벤트·스트림은 2건까지이고 남은 건수를 전체와 함께 밝힌다', () => {
  const picked = mini.pickLogRecords(Array.from({ length: 18 }, (_, i) => ({ i })));
  assert.equal(picked.shown.length, 2);
  assert.equal(picked.total, 18);
  assert.equal(mini.foldNote('log', { shown: 2, total: 18 }), '최근 2건 · 18건 중 — 전체는 캔버스에서');
});

test('이벤트 한 줄은 값 있는 3쌍까지만 잇는다', () => {
  assert.equal(mini.recordLine({ a: 1, b: 2, c: 3, d: 4 }), 'a 1 · b 2 · c 3');
  assert.equal(mini.recordLine({ a: 1, b: null, c: 3 }), 'a 1 · c 3');
  assert.equal(mini.recordLine('이미 문자열'), '이미 문자열');
  assert.equal(mini.recordLine(null), '');
});

test('본문은 첫 문단만, 줄머리 기호를 벗기고 한 줄로 잇는다', () => {
  const body = '# 제목\n- 첫 줄\n- 둘째 줄\n\n두 번째 문단은 오지 않는다.';
  const clamped = mini.clampReaderBody(body);
  assert.equal(clamped.text, '제목 첫 줄 둘째 줄');
  assert.equal(clamped.clipped, true, '뒤 문단을 잘랐으므로 잘렸다고 말해야 한다');
  assert.equal(clamped.total, body.length);
  assert.equal(mini.foldNote('reader', { total: clamped.total }), `첫 문단만 · 전문 ${body.length}자는 캔버스에서`);
});

test('본문이 상한을 넘으면 말줄임을 붙인다', () => {
  const body = 'ㄱ'.repeat(200);
  const clamped = mini.clampReaderBody(body);
  assert.equal(clamped.text.length, 141, '140자 + 말줄임 1자');
  assert.ok(clamped.text.endsWith('…'));
  assert.equal(clamped.clipped, true);
});

test('짧은 단일 문단은 자르지도 고지하지도 않는다', () => {
  const clamped = mini.clampReaderBody('한 문단이고 짧다.');
  assert.equal(clamped.text, '한 문단이고 짧다.');
  assert.equal(clamped.clipped, false);
});

test('빈 본문은 텍스트 없이 돌아온다 — 빈 카드를 그리지 않게', () => {
  assert.equal(mini.clampReaderBody('').text, '');
  assert.equal(mini.clampReaderBody(null).text, '');
  assert.equal(mini.clampReaderBody('   \n\n  ').text, '');
});

test('스트림 시각은 day 정밀도에서 시:분을 지어내지 않는다', () => {
  const ts = '2026-07-19T15:12:00';
  assert.equal(mini.formatStreamTime(ts, 'day'), '07.19');
  assert.equal(mini.formatStreamTime(ts, 'second'), '07.19 15:12');
  assert.equal(mini.formatStreamTime(null), '');
  assert.equal(mini.formatStreamTime('알 수 없는 값'), '알 수 없는 값');
});

test('스트림 출처는 source → url 호스트 순이고 둘 다 없으면 빈 문자열이다', () => {
  assert.equal(mini.streamSource({ source: 'DART' }), 'DART');
  assert.equal(mini.streamSource({ url: 'https://www.example.com/a/b' }), 'example.com');
  assert.equal(mini.streamSource({ url: '깨진 주소' }), '');
  assert.equal(mini.streamSource({}), '');
});
