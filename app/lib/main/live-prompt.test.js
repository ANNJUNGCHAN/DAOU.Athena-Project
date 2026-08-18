'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLivePrompt } = require('./live-prompt');

test('buildLivePrompt: 사용자 질문이 원문 그대로 마지막에 들어간다', () => {
  const p = buildLivePrompt('삼성전자 최근 공시에 대해서 알려줘');
  assert.ok(p.endsWith('사용자 질문:\n삼성전자 최근 공시에 대해서 알려줘'));
});

test('buildLivePrompt: 캔버스 렌더 지시와 table 스키마 힌트를 담는다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena__render_canvas'));
  assert.ok(p.includes('"columns"'));
  assert.ok(p.includes('"rows"'));
  // 조회 없는 질문의 탈출구가 있어야 잡담에 빈 캔버스를 강제하지 않는다.
  assert.ok(p.includes('캔버스 없이 짧게'));
});

test('buildLivePrompt: stream 스키마 힌트가 canvas.py STREAM_SCHEMA 필드명 그대로 들어간다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"stream"'));
  assert.ok(p.includes('"records"'));
  assert.ok(p.includes('"ts_precision"'));
  assert.ok(p.includes('"source"'));
});

test('buildLivePrompt: reader 스키마 힌트가 canvas.py READER_SCHEMA 필드명 그대로 들어간다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"reader"'));
  assert.ok(p.includes('"body_markdown"'));
  assert.ok(p.includes('"highlights"'));
});

test('buildLivePrompt: 키움 라우팅 규칙 — 마켓 데이터는 4단계 셀렉터로, 외부 MCP로 대체 금지', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena_search'));
  assert.ok(p.includes('athena_describe'));
  assert.ok(p.includes('athena_resolve'));
  assert.ok(p.includes('athena_call'));
  assert.ok(p.includes('외부 MCP나 웹으로 대체하지 마라'));
  assert.ok(p.includes('키움 백엔드가 미기동'));
});

test('buildLivePrompt: 4단계 사용법 — detail_group·plan_token 1회용 안내를 담는다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('detail_groups'));
  assert.ok(p.includes('detail_group'));
  assert.ok(p.includes('1회용'));
});

test('buildLivePrompt: chart 스키마 힌트 — canvas_type "chart"와 symbol/name/bars 형상', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"chart"'));
  assert.ok(p.includes('"symbol"'));
  assert.ok(p.includes('"bars"'));
  assert.ok(p.includes('"open"'));
  assert.ok(p.includes('"volume"'));
});

test('buildLivePrompt: chart 힌트 — 키움 ka10081 응답 필드 매핑과 오름차순 정렬 지시가 있다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('dt(YYYYMMDD)→time(YYYY-MM-DD)'));
  assert.ok(p.includes('open_pric→open'));
  assert.ok(p.includes('trde_qty→volume'));
  assert.ok(p.includes('오름차순'));
});
