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

test('buildLivePrompt: W3 번복 — describe 생략 금지(인자 목록이 describe에만 있음, 실측 턴 18→31 악화)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena_describe를 건너뛰지 마라'));
  assert.ok(p.includes('인자 추측')); // 생략 시 실패 루프의 원인 명시
  assert.ok(!p.includes('athena_describe를 생략하라')); // 옛 규칙 부활 방지
});

test('buildLivePrompt: W3 첫 카드 우선 — 첫 데이터 확보 즉시 render_canvas를 먼저 호출', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('먼저 render_canvas를 호출'));
  assert.ok(p.includes('첫 카드를 기다리고'));
});

test('buildLivePrompt: W3 작업 규율 — 초반 툴 로드 권고 + 재조회 금지 (run3~5 반복 사이클 실측의 수정)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('초반에 필요한 툴'));
  assert.ok(p.includes('athena__render_canvas')); // 로드 목록에 렌더 툴 포함 — 중간 사냥 방지
  assert.ok(p.includes('call을 반복하거나'));
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

test('buildLivePrompt: 조회 규율 — 명시 출처·상대 날짜·원문 확인·교차 출처 (2026-08-19 QA)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('조회 규율'));
  assert.ok(p.includes('조용한 대체 금지'));
  assert.ok(p.includes('날짜 확인 툴'));
  assert.ok(p.includes('원문 조회 툴로 본문을 확인'));
  assert.ok(p.includes('인용한 출처를 답변에 남긴다'));
});

test('buildLivePrompt: 주문·자동화 정책 — 실행 툴 없음·지속 감시 없음 (확정 결정 3)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('주문·자동화 정책'));
  assert.ok(p.includes('주문(매수·매도·정정·취소)을 실행하는 툴이'));
  assert.ok(p.includes('예약됐다고 확인하지 마라'));
});

test('buildLivePrompt: timeline 스키마 힌트 — 부분 데이터 허용 (2026-08-19 QA LIV-046)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('"timeline"'));
  assert.ok(p.includes('"price_series"'));
  assert.ok(p.includes('"events"'));
});

test('buildLivePrompt: 감시 방식 이분법 고지 — WS만 실시간, 공시·뉴스는 주기 (실행계획 §8)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('웹소켓 시세 계열'));
  assert.ok(p.includes('주기 확인 대상'));
  assert.ok(p.includes('실시간 공시 감시'));
});
