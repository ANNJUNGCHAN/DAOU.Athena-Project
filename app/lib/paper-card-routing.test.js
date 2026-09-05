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

test('주문 티켓 op는 보드가 마운트 지점을 갖출 때까지 앱 primary로 남는다', () => {
  // 주문 보드(135M-2·2TAG-1 등)는 primary.renderer가 전부 null이다 — 가로채면
  // 사용자가 누를 수 없는 목업 주문 폼이 그 자리를 대신한다.
  for (const ref of ['base:kt10000', 'base:kt10008']) {
    assert.strictEqual(routing.preservesAppPrimary({
      operation_ref: ref, canvas_type: 'action', surface_contract: { board_id: '135M-2' },
    }), true, ref);
  }
});

test('호가 op는 자기 Paper 보드로 간다 — 사다리 자리가 없는 보드도 마찬가지다', () => {
  // 13BC-2·1JPU-0은 사다리를 품고, 시간외·금현물·낱값 보드(2QRP-1·2QX1-1·3N4O-0·
  // 3JT4-0)는 Paper가 5단·낱값으로 따로 저작했다 — 앱 사다리를 그 자리에 얹는
  // 것이 오히려 Paper와 다른 그림이다(2026-09-06 31 op 전수 대조).
  for (const [ref, boardRenderer] of [
    ['detail:ka10007:bid_prices', 'orderbook-ladder'],
    ['detail:ka10004:buy_bid_prices', 'orderbook-ladder'],
    ['detail:ka10087:trading_summary', ''],
    ['detail:ka10007:order_counts', ''],
    ['base:ka50101', ''],
    ['base:0D', 'orderbook-ladder'],
  ]) {
    assert.strictEqual(routing.preservesAppPrimary({
      operation_ref: ref, canvas_type: 'facts', card_title: '호가',
      presentation_contract: { recipe_id: 'live-orderbook', sections: [] },
    }, boardRenderer), false, ref);
  }
});

test('주문 예외는 op 목록이지 카드 이름이 아니다', () => {
  // card_title로 판정하면 실시간 접수 통보(base:00, 계좌 카드)가 '주문'이라는
  // 이름만으로 133H-2 보드를 잃는다 — 이번 작업이 없애려던 손실 그 자체다.
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:00', canvas_type: 'event', card_title: '주문',
    presentation_contract: { recipe_id: 'account-risk', sections: [] },
    surface_contract: { board_id: '133H-2' },
  }), false);
  // 반대로 이름이 '신용거래'인 주문 op는 예외 안에 남는다.
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:kt10006', canvas_type: 'action', card_title: '신용거래',
    surface_contract: { board_id: '2TJ6-1' },
  }), true);
});

test('주문 op 목록은 capability 배정 원장과 정확히 같다', () => {
  // 정본은 backend/ref/kiwoom-capability-assignment.json이다(view_recipe_registry가
  // order-safe-ticket recipe를 여기서 만든다). 드리프트하면 깨진다.
  const assignment = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'ref', 'kiwoom-capability-assignment.json'),
    'utf8',
  ));
  const opsOf = (capabilityId) => assignment.capabilities
    .find((entry) => entry.capability_id === capabilityId).mapping_ids.slice().sort();
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

test('보드가 그 앱 렌더러를 얹을 수 있으면 봉투는 보드로 간다', () => {
  const chart = {
    operation_ref: 'base:ka10081',
    renderer_id: 'aits-chart-v1',
    canvas_type: 'chart',
    card_id: 'CC-03',
    surface_contract: { board_id: '137X-2' },
  };
  // 자리가 없는 보드에서는 예외가 그대로다 — 가로채면 라이브가 목업으로 바뀐다.
  assert.strictEqual(routing.preservesAppPrimary(chart), true);
  assert.strictEqual(routing.preservesAppPrimary(chart, ''), true);
  assert.strictEqual(routing.preservesAppPrimary(chart, 'orderbook-ladder'), true);
  // 자리가 저작됐고 canvas가 그 종류를 얹을 줄 알면 보드가 껍질을 그린다.
  assert.strictEqual(routing.preservesAppPrimary(chart, 'athena-chart'), false);
  // 목록은 canvas가 실제로 마운트하는 종류다 — 저작만 된 종류는 아직 들어오지 않는다.
  assert.deepEqual(Array.from(routing.BOARD_MOUNTED_RENDERERS), ['athena-chart', 'orderbook-ladder']);
});

test('보드가 얹을 줄 아는 종류와 봉투가 필요한 종류가 달라도 예외는 그대로다', () => {
  // 차트 봉투를 호가 사다리 자리로 보내면 그 자리는 목업인 채로 남는다 —
  // 종류가 같을 때만 보드가 껍질을 가져간다.
  assert.strictEqual(routing.preservesAppPrimary({
    operation_ref: 'base:ka10081', renderer_id: 'aits-chart-v1', card_id: 'CC-04',
    surface_contract: { board_id: '13BC-2' },
  }, 'orderbook-ladder'), true);
});

test('semantic-workspaces 검증기의 preserve 판정은 이 모듈이 든다', () => {
  // 검증기가 자기 기준(recipe 3종)을 따로 들면 앱이 새로 보드로 보내는 봉투를
  // 채점하지 못한다 — 두 집합이 갈라질 수 없게 같은 함수를 부른다(2026-09-06 검수 P1).
  const verifier = fs.readFileSync(
    path.join(__dirname, '..', 'verify-semantic-workspaces.js'), 'utf8',
  );
  assert.match(verifier, /require\('\.\/lib\/paper-card-routing'\)/);
  assert.match(verifier, /primary_expected = paperCardRouting\.preservesAppPrimary\(/);
  // 보드 쪽 사실(그 보드가 앱 렌더러를 얹을 수 있는가)도 같이 넘긴다.
  assert.match(verifier, /boardTemplateRegistry\.primaryRendererFor\(surface\.board_id \|\| ''\)/);
  assert.doesNotMatch(verifier, /preserve_primary/);
});
