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
