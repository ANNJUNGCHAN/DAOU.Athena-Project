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

test('buildLivePrompt: 키움 라우팅 규칙 — selector 후 manifest render, 외부 MCP 대체 금지', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena_search'));
  assert.ok(p.includes('athena_describe'));
  assert.ok(p.includes('athena_resolve'));
  assert.ok(p.includes('athena_call'));
  assert.ok(p.includes('athena_search → athena_describe → athena_resolve 순서로 선택'));
  assert.ok(!p.includes('athena_resolve → athena_call(키움 REST)'));
  assert.ok(p.includes('외부 MCP나 웹으로 대체하지 마라'));
  assert.ok(p.includes('키움 백엔드가 미기동'));
});

test('buildLivePrompt: detail_group 선택과 plan_token 1회용 안내를 담는다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('detail_groups'));
  assert.ok(p.includes('detail_group'));
  assert.ok(p.includes('typed local detail이 하나뿐일 때만'));
  assert.ok(p.includes('DETAIL_GROUP_REQUIRED'));
  assert.ok(p.includes('전체 응답이 된다고 가정하지 마라'));
  assert.ok(!p.includes('생략하면 전체 응답 — 항상 안전'));
  assert.ok(p.includes('1회용'));
});

test('buildLivePrompt: candidate는 soft hint, preferred는 describe 확인 canonical assertion으로 구분한다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('candidate_refs'));
  assert.ok(p.includes('soft hint'));
  assert.ok(p.includes('preferred_ref'));
  assert.ok(p.includes('canonical operation/family assertion'));
  assert.ok(p.includes('suggested_operation_ref'));
  assert.ok(p.includes('suggested_detail_group'));
  assert.ok(p.includes('실제로 소유하는지 확인'));
  assert.ok(p.includes('ambiguous'));
  assert.ok(p.includes('억지 resolve하지 말고'));
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
  assert.ok(p.includes('"period"'));
  assert.ok(p.includes('"target"'));
  assert.ok(p.includes('"trId"'));
  assert.ok(p.includes('"chart"'));
  assert.ok(p.includes('"candles"'));
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

test('buildLivePrompt: 주문·자동화 정책 v3b — 실행 툴 없음·루틴은 제안만 (P3)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('주문·자동화 정책'));
  assert.ok(p.includes('주문(매수·매도·정정·취소)을 실행하는 툴이'));
  assert.ok(p.includes('athena_routine'));
  assert.ok(p.includes('승인 카드'));
  assert.ok(p.includes('등록됐다·예약됐다고'));
  assert.ok(p.includes('감시 방식'));
});

test('buildLivePrompt: 실행 환경 제약 v3c — Bash 없음·승인 절차 없음·잘린 결과 대응 (2026-08-19 실사용 결함)', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('실행 환경 제약'));
  assert.ok(p.includes('Bash'));
  assert.ok(p.includes('승인해 주시면'));       // 금지 표현을 명시적으로 지목
  assert.ok(p.includes('접근할 수단은 없다'));
  assert.ok(p.includes('받은 부분만으로 즉시 카드를'));
});

test('buildLivePrompt: manifest-backed read 전체가 plan_token만으로 render_canvas 직행한다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('athena_call로 데이터를 읽어오지 마라'));
  assert.ok(p.includes('facts/table/compound/chart 전부'));
  assert.ok(p.includes('{plan_token:"..."}'));
  assert.ok(p.includes('canvas_type과 data는 보내지'));
  assert.ok(p.includes('manifest-unsupported'));
  assert.ok(p.includes('no-card fallback'));
  assert.ok(p.includes('정상 facts/compound/table/chart 조회에는 athena_call을 쓰지 않는다'));
  assert.ok(p.includes('summary'));
  assert.ok(p.includes('최근 N봉 기준'));
  assert.ok(!p.includes('chart/table 카드를 그릴 때는'));
  assert.ok(!p.includes('chart/table 외 카드를 직접 구성할 때만'));
});

test('buildLivePrompt: flagship 현재가도 backend manifest가 facts 카드를 고르는 plan 경로다', () => {
  const p = buildLivePrompt('x');
  assert.ok(p.includes('삼성전자 오늘 주가'));
  assert.ok(p.includes('resolve plan_token만 렌더'));
  assert.ok(p.includes('current-price facts 카드'));
  assert.ok(p.includes('모델이 facts나 compound payload를 직접 만들지 마라'));
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
