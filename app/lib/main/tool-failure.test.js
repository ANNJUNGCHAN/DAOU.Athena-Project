'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeToolFailure } = require('./tool-failure');

test('tool errors keep structured status without claiming every failure is a gateway outage', () => {
  const invalid = describeToolFailure([{ type: 'text', text: JSON.stringify({ status_code: 422, detail: { code: 'INVALID_ARGUMENTS' } }) }]);
  assert.equal(invalid.httpStatus, 422);
  assert.equal(invalid.code, 'INVALID_ARGUMENTS');
  assert.match(invalid.message, /요청 조건/);
  assert.doesNotMatch(invalid.message, /게이트웨이|upstream/);
  assert.equal(describeToolFailure('HTTP 502 Bad Gateway').httpStatus, 502);
  assert.equal(describeToolFailure('unclassified tool failure').httpStatus, null);
  const coverage = describeToolFailure({ status_code: 422, code: 'CANVAS_COVERAGE_MISSING' });
  assert.match(coverage.message, /화면으로 변환/);
  assert.doesNotMatch(coverage.message, /요청 조건/);
});

test('diagnostics never retain arbitrary tool text or credentials', () => {
  const source = { error: 'Authorization: Bearer private-token', status: 403, api_key: 'secret', code: 'private-token' };
  const result = describeToolFailure(source);
  assert.doesNotMatch(JSON.stringify(result), /private-token|secret|Authorization/);
  assert.match(result.message, /인증 또는 권한/);
  assert.equal(result.fingerprint, describeToolFailure(source).fingerprint);
});

test('order plans and legacy confirmation errors explain the order boundary', () => {
  for (const content of [
    { status_code: 409, detail: { code: 'ORDER_TICKET_REQUIRED' } },
    [{ type: 'text', text: 'plan 실행 실패 (HTTP 428): {"detail":"X-Athena-Confirm: true is required"}' }],
  ]) {
    const failure = describeToolFailure(content);
    assert.match(failure.message, /주문 티켓/);
    assert.match(failure.message, /주문은 접수되지 않았습니다/);
    assert.doesNotMatch(failure.message, /조회 도구|티켓을 열었습니다|X-Athena-Confirm/);
  }
  assert.equal(describeToolFailure({ detail: { code: 'ORDER_TICKET_REQUIRED' } }).code, 'ORDER_TICKET_REQUIRED');
  for (const unrelated of ['HTTP 428', { status_code: 428, detail: 'different precondition' }]) {
    assert.doesNotMatch(describeToolFailure(unrelated).message, /주문 티켓|주문은 접수/);
  }
});

test('a structured order rejection stays an error through the canvas result parser', () => {
  const { classifyCanvasBlock } = require('./stream-json-parser');
  const result = classifyCanvasBlock({
    toolUseId: 'order-plan',
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({
      status_code: 409,
      detail: { code: 'ORDER_TICKET_REQUIRED' },
    }) }],
  });
  assert.equal(result.status, 'error');
  assert.equal(result.failure.code, 'ORDER_TICKET_REQUIRED');
  assert.match(result.failure.message, /주문 티켓/);
  assert.equal(result.envelope, undefined);
});
