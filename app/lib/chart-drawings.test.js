'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDrawings, projectLine, DRAW_TOOLS } = require('./chart-drawings');

test('도구 7종 — 구현 2(수평선·추세선), 미구현 5 (spec §5 표)', () => {
  assert.equal(DRAW_TOOLS.length, 7);
  const impl = DRAW_TOOLS.filter((t) => t.implemented).map((t) => t.id).sort();
  assert.deepEqual(impl, ['hline', 'trend']);
});

test('sanitizeDrawings: 유효 항목만 통과, 손상 항목은 버린다', () => {
  const out = sanitizeDrawings({
    hlines: [{ id: 'h1', price: 70000 }, { price: 'oops' }, null],
    lines: [
      { id: 't1', a: { time: 100, price: 1 }, b: { time: 200, price: 2 } },
      { a: { time: 100 }, b: { time: 200, price: 2 } }, // a.price 없음
    ],
  });
  assert.equal(out.hlines.length, 1);
  assert.equal(out.hlines[0].price, 70000);
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].id, 't1');
});

test('sanitizeDrawings: null·비객체는 빈 드로잉', () => {
  assert.deepEqual(sanitizeDrawings(null), { hlines: [], lines: [] });
  assert.deepEqual(sanitizeDrawings('x'), { hlines: [], lines: [] });
});

test('projectLine: 데이터 좌표 → 픽셀 재투영 (선형 변환기 주입)', () => {
  const line = { a: { time: 10, price: 100 }, b: { time: 20, price: 200 } };
  const seg = projectLine(line, (t) => t * 2, (p) => 1000 - p);
  assert.deepEqual(seg, { x1: 20, y1: 900, x2: 40, y2: 800 });
});

test('projectLine: 화면 밖(변환 null) 점이 있으면 null — 렌더 생략', () => {
  const line = { a: { time: 10, price: 100 }, b: { time: 20, price: 200 } };
  assert.equal(projectLine(line, () => null, (p) => p), null);
});
