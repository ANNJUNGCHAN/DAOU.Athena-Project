'use strict';

const test = require('node:test');
const assert = require('node:assert');

const routing = require('./paper-card-routing');

const integratedCardSurface = {
  integratedDefinition(envelope) {
    const id = envelope && envelope.card_id;
    return id === 'CC-03' ? { cardId: 'CC-03', kind: 'instrument' } : null;
  },
};

const semanticWorkspace = {
  isTaskCanvasEnvelope(envelope) {
    return Boolean(envelope && envelope.presentation_contract);
  },
};

const surfaces = { integratedCardSurface, semanticWorkspace };

test('통합 카드 계약이 붙은 키움 봉투는 CC 카드로 간다', () => {
  const route = routing.paperCardRoute(
    { operation_ref: 'base:ka10060', card_id: 'CC-03' },
    surfaces,
  );
  assert.strictEqual(route, 'integrated');
});

test('card_id 없이 presentation_contract만 있으면 semantic workspace로 간다', () => {
  const route = routing.paperCardRoute(
    { operation_ref: 'base:ka10060', presentation_contract: { sections: [] } },
    surfaces,
  );
  assert.strictEqual(route, 'workspace');
});

test('계약 없는 키움 봉투는 레거시 범용 카드로 떨어지지 않고 차단된다', () => {
  // 이게 이 프로젝트의 핵심 계약이다 — 키움 응답이 범용 표로 새는 경로를 막는다.
  const route = routing.paperCardRoute(
    { operation_ref: 'base:ka10060', canvas_type: 'table', data: { rows: [] } },
    surfaces,
  );
  assert.strictEqual(route, 'blocked');
});

test('차단 사유는 어떤 operation이 문제인지 드러낸다', () => {
  const reason = routing.blockedReason({ operation_ref: 'base:ka10060' });
  assert.ok(reason.includes('base:ka10060'), reason);
});

test('operation_ref가 없는 비 키움 봉투는 기존 범용 경로를 그대로 쓴다', () => {
  const route = routing.paperCardRoute(
    { canvas_type: 'chart', data: { symbol: '005930' } },
    surfaces,
  );
  assert.strictEqual(route, 'generic');
});

test('공백뿐인 operation_ref는 키움 봉투로 보지 않는다', () => {
  assert.strictEqual(routing.isKiwoomEnvelope({ operation_ref: '   ' }), false);
  assert.strictEqual(routing.isKiwoomEnvelope({ operation_ref: 'base:00' }), true);
});
