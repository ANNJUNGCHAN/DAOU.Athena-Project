'use strict';

const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');

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

test('AITS 렌더러 봉투는 보드 표면이 가로채지 않는다', () => {
  // 판정 축은 manifest presentation.renderer_id다 — recipe가 아니다.
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10081', card_id: 'CC-03', renderer_id: 'aits-chart-v1',
    canvas_type: 'table',
    presentation_contract: { recipe_id: 'instrument-chart', sections: [] },
    surface_contract: { board_id: '137X-2' },
  }), true);
});

test('차트 op 19종은 renderer_id 없이도 앱 primary로 남는다', () => {
  for (const ref of routing.APP_PRIMARY_CHART_OPS) {
    assert.strictEqual(
      routing.preservesAppPrimary({ operation_ref: ref, card_id: 'CC-03' }), true, ref,
    );
  }
});

test('차트 op 목록은 manifest의 AITS 렌더러 전집합과 정확히 같다', () => {
  // 정본은 manifest다. 목록이 드리프트하면 여기서 깨진다.
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'ref', 'kiwoom-common-screen-manifest.json'),
    'utf8',
  ));
  const fromManifest = manifest.mappings
    .filter((entry) => entry.presentation && entry.presentation.renderer_id === 'aits-chart-v1')
    .map((entry) => entry.operation_ref)
    .sort();
  assert.deepStrictEqual([...routing.APP_PRIMARY_CHART_OPS].sort(), fromManifest);
});

test('차트가 아닌 ka10084·ka10085는 자기 Paper 보드로 간다', () => {
  // 당일전일체결·계좌수익률은 차트가 아니다. 옛 /^base:ka1008[1-5]$/가 삼켜
  // 두 응답이 보드 표면을 건너뛰었다(2026-09-05 검수 실측).
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10084', card_id: 'CC-03', canvas_type: 'table',
    presentation_contract: { recipe_id: 'discovery-value', sections: [] },
    surface_contract: { board_id: '137X-2' },
  }), false);
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10085', card_id: 'CC-01', canvas_type: 'table',
    presentation_contract: { recipe_id: 'account-risk', sections: [] },
    surface_contract: { board_id: '133H-2' },
  }), false);
});

test('차트 recipe를 빌려 쓴 시세 봉투는 보드로 간다', () => {
  // detail:ka10001:current_trading은 manifest layout=facts인데 recipe만
  // instrument-chart를 빌려 쓴다(OPERATION_RECIPE_OVERRIDES). recipe 축으로
  // 판정하면 이 봉투가 137X-2 보드를 영영 못 받는다 — 이번 목표 그 자체다.
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'detail:ka10001:current_trading', card_id: 'CC-03',
    canvas_type: 'facts', card_title: '종목정보',
    presentation_contract: { recipe_id: 'instrument-chart', sections: [] },
    surface_contract: { board_id: '137X-2' },
  }), false);
});

test('렌더러 신호 없는 recipe는 보드 표면 판정을 막지 않는다', () => {
  for (const recipe of ['live-orderbook', 'order-safe-ticket', 'why-move-flow', 'gold-market']) {
    assert.strictEqual(routing.preservesAppPrimary({
      operation_ref: 'base:ka10001', canvas_type: 'table',
      presentation_contract: { recipe_id: recipe, sections: [] },
      surface_contract: { board_id: '133H-2' },
    }), false, recipe);
  }
});

test('호가 사다리·주문 티켓 op는 보드가 마운트 지점을 갖출 때까지 앱 primary로 남는다', () => {
  for (const ref of ['detail:ka10004:buy_bid_prices', 'detail:ka10087:trading_summary',
    'base:kt10000', 'base:kt10008']) {
    assert.strictEqual(routing.preservesAppPrimary({
      operation_ref: ref, canvas_type: 'table', surface_contract: { board_id: '13BC-2' },
    }), true, ref);
  }
});

test('호가·주문 예외는 op 목록이지 카드 이름이 아니다', () => {
  // card_title로 판정하면 실시간 접수 통보(base:00, 계좌 카드)가 '주문'이라는
  // 이름만으로 133H-2 보드를 잃는다 — 이번 작업이 없애려던 손실 그 자체다.
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:00', canvas_type: 'event', card_title: '주문',
    presentation_contract: { recipe_id: 'account-risk', sections: [] },
    surface_contract: { board_id: '133H-2' },
  }), false);
  // 반대로 이름이 '신용거래'·'시세'인 주문·호가 op는 예외 안에 남는다.
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:kt10006', canvas_type: 'action', card_title: '신용거래',
    surface_contract: { board_id: '2TJ6-1' },
  }), true);
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'detail:ka10007:session', canvas_type: 'facts', card_title: '시세',
    surface_contract: { board_id: '1JPU-0' },
  }), true);
});

test('호가·주문 op 목록은 capability 배정 원장과 정확히 같다', () => {
  // 정본은 backend/ref/kiwoom-capability-assignment.json이다(view_recipe_registry가
  // live-orderbook·order-safe-ticket recipe를 여기서 만든다). 드리프트하면 깨진다.
  const assignment = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'ref', 'kiwoom-capability-assignment.json'),
    'utf8',
  ));
  const opsOf = (capabilityId) => assignment.capabilities
    .find((entry) => entry.capability_id === capabilityId).mapping_ids.slice().sort();
  assert.deepStrictEqual([...routing.APP_PRIMARY_ORDERBOOK_OPS].sort(), opsOf('orderbook'));
  assert.deepStrictEqual([...routing.APP_PRIMARY_ORDER_OPS].sort(), opsOf('order'));
});

test('그 외 recipe·계약 없는 봉투는 보드 표면 판정을 막지 않는다', () => {
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10001', presentation_contract: { recipe_id: 'instrument-facts', sections: [] },
    surface_contract: { board_id: '133H-2' },
  }), false);
  assert.strictEqual(routing.preservesAppPrimary({ operation_ref: 'base:ka10001' }), false);
  assert.strictEqual(routing.preservesAppPrimary(null), false);
});

test('canvas_type chart는 recipe_id가 없어도 보드가 AITS를 가로채지 않는다', () => {
  // 차트 op 목록에 없는 ref로 canvas_type 축만 격리한다(2026-09-05 검수 발견 30).
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10001',
    canvas_type: 'chart',
    card_id: 'CC-03',
    surface_contract: { board_id: '2SKU-1' },
  }), true);
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10001',
    canvas_type: 'table',
    card_id: 'CC-03',
    surface_contract: { board_id: '2SKU-1' },
  }), false);
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10001',
    canvas_type: 'chart',
    fell_back: true,
  }), false);
});

test('semantic-workspaces 검증기의 preserve 판정은 이 모듈이 든다', () => {
  // 검증기가 자기 기준(recipe 3종)을 따로 들면 앱이 새로 보드로 보내는 봉투를
  // 채점하지 못한다 — 두 집합이 갈라질 수 없게 같은 함수를 부른다(2026-09-06 검수 P1).
  const verifier = fs.readFileSync(
    path.join(__dirname, '..', 'verify-semantic-workspaces.js'), 'utf8',
  );
  assert.match(verifier, /require\('\.\/lib\/paper-card-routing'\)/);
  assert.match(verifier, /primary_expected = paperCardRouting\.preservesAppPrimary\(/);
  assert.doesNotMatch(verifier, /preserve_primary/);
});
