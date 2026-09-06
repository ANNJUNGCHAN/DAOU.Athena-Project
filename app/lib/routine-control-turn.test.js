// 제어 결과 턴(Paper 보드 08 · 4330-1) 단위 테스트 — 네 상태와 문구 규율.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildControlResultTurn, failLead, controlFactLine, NO_REASON_LEAD,
} = require('./routine-control-turn');

test('성공 결과 턴은 배지 · 리드 · 사실행 세 조각이다 — 설명문이 없다', () => {
  const turn = buildControlResultTurn({
    kind: 'success',
    badge: '작업 설정',
    lead: '일시중지됨',
    fact: '삼성전자 88,000원 감시 · 만료 보존',
  });
  assert.equal(turn.badge, '작업 설정');
  assert.equal(turn.statusBadge, '완료');
  assert.equal(turn.lead, '일시중지됨');
  assert.equal(turn.fact, '삼성전자 88,000원 감시 · 만료 보존');
  assert.deepEqual(turn.chips, []);
  assert.equal(turn.serverChanged, true);
  // 설명문(서술형 종결)이 붙지 않는다 — 상태 표기만이다.
  assert.doesNotMatch(`${turn.lead} ${turn.fact}`, /(습니다|합니다|됩니다)/);
});

test('실패 결과 턴에만 다시 시도 칩이 붙는다', () => {
  const kinds = ['success', 'reject', 'fail', 'view'];
  const chips = kinds.map((kind) => buildControlResultTurn({ kind }).chips);
  assert.deepEqual(chips, [[], [], ['다시 시도'], []]);
});

test('보류·뷰 이동은 서버 상태 불변 — 빈 변경이 정상이다', () => {
  assert.equal(buildControlResultTurn({ kind: 'reject' }).serverChanged, false);
  assert.equal(buildControlResultTurn({ kind: 'view' }).serverChanged, false);
  assert.equal(buildControlResultTurn({ kind: 'success' }).serverChanged, true);
  // 판정 배지는 Paper 네 열 그대로다.
  assert.equal(buildControlResultTurn({ kind: 'reject' }).statusBadge, '보류');
  assert.equal(buildControlResultTurn({ kind: 'view' }).statusBadge, '완료');
});

test('실패 문구에 백엔드 코드 번호가 들어가지 않는다', () => {
  const turn = buildControlResultTurn({
    kind: 'fail', badge: '지금 실행',
    reason: '이미 발화된 예약 — ROUTINE_409 (code: 409)',
  });
  assert.doesNotMatch(turn.lead, /[A-Z]{2,}_\d|code:/);
  assert.equal(turn.lead, '이미 발화된 예약');
  // 사유가 코드뿐이면 지어내지 않고 상태 표기 하나만 낸다.
  assert.equal(failLead('WATCH_500'), NO_REASON_LEAD);
  assert.equal(failLead(''), NO_REASON_LEAD);
});

test('단위는 한국어다 — 초 · 건 · 원', () => {
  const turn = buildControlResultTurn({
    kind: 'success',
    badge: '작업 설정',
    lead: '일시중지됨',
    fact: controlFactLine({ symbol: '005930', note: '거래량 급증 감시', cooldown_s: 600 }),
  });
  assert.equal(turn.fact, '005930 · 거래량 급증 감시 · 쿨다운 10분');
  assert.doesNotMatch(`${turn.lead} ${turn.fact}`, /\d+(sec|s)\b/);
  // 모르는 칸은 빠진다 — 채우지 않는다.
  assert.equal(controlFactLine({ note: '거래량 급증 감시' }), '거래량 급증 감시');
  assert.equal(controlFactLine(null), '');
});

test('모르는 kind는 실패로 읽는다 — 조용히 성공으로 그리지 않는다', () => {
  const turn = buildControlResultTurn({ kind: 'nope', reason: '알 수 없는 결과' });
  assert.equal(turn.kind, 'fail');
  assert.equal(turn.serverChanged, false);
  assert.deepEqual(turn.chips, ['다시 시도']);
  assert.equal(buildControlResultTurn(null).kind, 'fail');
});
