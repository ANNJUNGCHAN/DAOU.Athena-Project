'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { INDICATOR_DEFS, DEFAULT_INDICATOR_VISIBLE, defaultParamsFor } = require('./chart-indicator-registry');
const { SPECS, SPEC_BY_ID, linesOf, toLineData } = require('./chart-indicator-render');
const IND = require('./chart-indicators');

// 아래 숫자는 "지금 몇 개인가"를 박아두는 게 아니라
// **레지스트리와 렌더러가 어긋나지 않는다**는 계약을 지킨다. 지표를 추가할 때
// 숫자 세 개만 고치고 나머지는 자동으로 검증되도록 짰다.
const IMPLEMENTED = INDICATOR_DEFS.filter((d) => d.implemented);
const NOT_IMPLEMENTED = INDICATOR_DEFS.filter((d) => !d.implemented);
// 2026-08-26: 지표가 두 부류가 됐다. 봉에서 계산하는 34종과, 별도 TR을 조회해
// 받은 시계열을 그리는 7종(source:'tr')이다. 아래 검사는 부류마다 다른 계약을 본다 —
// 외부 지표에 compute를 요구하면 영영 통과할 수 없다.
const COMPUTED = IMPLEMENTED.filter((d) => d.source !== 'tr');
const EXTERNAL = IMPLEMENTED.filter((d) => d.source === 'tr');

test('43종 전수 — 상단 12 + 하단 31 (하단 24 + 수급 7)', () => {
  assert.equal(INDICATOR_DEFS.length, 43);
  assert.equal(INDICATOR_DEFS.filter((d) => d.section === 'overlay').length, 12);
  assert.equal(INDICATOR_DEFS.filter((d) => d.section === 'pane').length, 31);
});

test('구현 41종(봉 34 + 수급 7) · 미구현 2종(일목 구름·고정 VWAP)', () => {
  assert.equal(IMPLEMENTED.length, 41);
  assert.equal(COMPUTED.length, 34);
  assert.equal(EXTERNAL.length, 7);
  assert.deepEqual(NOT_IMPLEMENTED.map((d) => d.id).sort(), ['ichimokuCloud', 'vwapAnchor']);
});

test('수급 지표는 그릴 열과 허용 주기를 명시한다 — 자동 선택 없음', () => {
  for (const def of EXTERNAL) {
    assert.ok(def.operationRef, `${def.id}: operationRef 없음`);
    // fieldAlias가 없으면 렌더러가 무엇을 그릴지 추측해야 한다. 계약의
    // column_priority 첫 열은 현재가/전일대비라 추측은 곧 오표시다.
    assert.ok(def.fieldAlias, `${def.id}: fieldAlias 없음`);
    assert.ok(Array.isArray(def.allowedPeriods) && def.allowedPeriods.length,
      `${def.id}: allowedPeriods 없음`);
  }
});

test('대차잔고는 잔고주수(rmnd)다 — 잔고금액(remn_amt)이 아니다', () => {
  const loan = INDICATOR_DEFS.find((d) => d.id === 'loanBalance');
  assert.equal(loan.fieldAlias, 'rmnd');
});

test('id 중복 없음', () => {
  const ids = INDICATOR_DEFS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('기본 on은 이평선·거래량MA 둘뿐 — 지표가 늘어도 첫 화면은 그대로다', () => {
  assert.deepEqual(DEFAULT_INDICATOR_VISIBLE.slice().sort(), ['ma', 'volMa']);
});

test('미구현 지표는 params가 없다(설정 패널에 입력 필드를 만들지 않는다)', () => {
  for (const d of NOT_IMPLEMENTED) {
    assert.ok(!d.params, `${d.id}는 미구현인데 params가 있다`);
  }
});

test('defaultParamsFor: 배열 기본값은 복사본이라 원본이 오염되지 않는다', () => {
  const p = defaultParamsFor('ma');
  assert.deepEqual(p.periods, [5, 10, 20, 60, 120]);
  p.periods.push(999);
  assert.deepEqual(defaultParamsFor('ma').periods, [5, 10, 20, 60, 120]);
});

test('defaultParamsFor: 미구현/미존재 id는 빈 객체', () => {
  assert.deepEqual(defaultParamsFor('ichimokuCloud'), {});
  assert.deepEqual(defaultParamsFor('no-such-id'), {});
});

// ---------------------------------------------------------------------------
// 레지스트리 ↔ 렌더러 계약. 이게 어긋나면 지표가 **조용히 안 그려진다** —
// 목록에는 켜진 것처럼 보이는데 화면엔 선이 없다(정보 정직성 위반).
// ---------------------------------------------------------------------------

test('구현 지표는 전부 렌더 스펙을 갖는다(외부 포함)', () => {
  const missing = IMPLEMENTED.map((d) => d.id).filter((id) => !SPEC_BY_ID.has(id));
  assert.deepEqual(missing, [], `렌더 스펙 없는 구현 지표: ${missing.join(', ')}`);
});

test('렌더 스펙에 레지스트리 밖 고아가 없다', () => {
  const ids = new Set(IMPLEMENTED.map((d) => d.id));
  const orphan = SPECS.map((s) => s.id).filter((id) => !ids.has(id));
  assert.deepEqual(orphan, [], `레지스트리에 없는 스펙: ${orphan.join(', ')}`);
});

test('스펙의 pane 값은 price/volume/own 셋 중 하나다', () => {
  for (const s of SPECS) {
    assert.ok(['price', 'volume', 'own'].includes(s.pane), `${s.id}의 pane=${s.pane}`);
  }
});

// 실제 픽스처로 계산해 "그릴 점이 있는가"까지 본다. 함수가 예외 없이 돌기만
// 하고 전부 null이면 화면엔 아무것도 안 나오므로 통과시키면 안 된다.
const BARS = require('../data/chart-mock-ohlcv.json').bars.map((b) => ({
  time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
}));

test('수급 7종의 렌더 스펙은 external이고 compute가 없다', () => {
  for (const def of EXTERNAL) {
    const spec = SPEC_BY_ID.get(def.id);
    assert.equal(spec.external, true, `${def.id}: external 표시 없음`);
    assert.equal(typeof spec.compute, 'undefined', `${def.id}: 외부 지표에 compute가 있다`);
    assert.equal(spec.pane, 'own', `${def.id}: 전용 pane이어야 한다`);
  }
});

test('봉 계산 34종 전부 — 선언한 선의 데이터를 채우고 그릴 점이 있다', () => {
  const times = BARS.map((b) => b.time);
  for (const def of COMPUTED) {
    const spec = SPEC_BY_ID.get(def.id);
    const params = defaultParamsFor(def.id);
    const result = spec.compute(BARS, params);

    const lines = linesOf(spec, params);
    assert.ok(lines && lines.length, `${def.id}: 선이 0개다`);

    for (const line of lines) {
      assert.ok(Array.isArray(result[line.key]), `${def.id}: compute가 '${line.key}'를 안 채웠다`);
    }
    if (spec.histogram) {
      assert.ok(Array.isArray(result[spec.histogram]), `${def.id}: 히스토그램 키 누락`);
    }
    const drawn = lines.reduce((n, l) => n + toLineData(times, result[l.key]).length, 0);
    assert.ok(drawn > 0, `${def.id}: 그릴 점이 0개다(선은 있는데 화면엔 안 보인다)`);
  }
});

test('일중 강도와 AD 라인은 서로 다른 값이다', () => {
  // 두 지표의 분자가 대수적으로 같아 누적하면 완전히 같은 선이 나왔다
  // (2026-08-25 실측: 둘 다 229,094,947.708). 일중 강도의 정규화가 유일한
  // 차이라서, 회귀하면 사용자는 "같은 지표 두 개"를 보게 된다.
  const last = (a) => { for (let i = a.length - 1; i >= 0; i -= 1) if (a[i] != null) return a[i]; return null; };
  const ad = last(IND.adLine(BARS));
  const ii = last(IND.intradayIntensity(BARS));
  assert.notEqual(ad, ii);
  assert.ok(Math.abs(ii) <= 100, `일중 강도는 비율(%)이라 |값| ≤ 100이어야 한다 — ${ii}`);
});

test('워밍업 구간은 null로 남기고 자리를 당기지 않는다', () => {
  // 길이가 줄면 시간축과 어긋나 값이 엉뚱한 봉에 붙는다.
  const closes = BARS.map((b) => b.close);
  assert.equal(IND.sma(closes, 20).length, closes.length);
  assert.equal(IND.rsi(closes, 14).length, closes.length);
  assert.equal(IND.atr(BARS, 14).length, BARS.length);
  assert.equal(IND.sma(closes, 20)[0], null);
});

test('경계 입력에서 예외가 나지 않는다 — 빈 배열·1봉·전봉 동일가·거래량 0', () => {
  const flat = Array.from({ length: 60 }, () => ({ open: 100, high: 100, low: 100, close: 100, volume: 0 }));
  assert.equal(IND.rsi([], 14).length, 0);
  assert.equal(IND.parabolicSar([BARS[0]]).length, 1);
  // 고가==저가면 분모가 0 — 관례값으로 떨어져야 한다(NaN 금지).
  for (const v of IND.stochastic(flat).k) if (v != null) assert.equal(v, 50);
  for (const v of IND.cci(flat)) if (v != null) assert.equal(v, 0);
  for (const v of IND.vwap(flat)) if (v != null) assert.ok(Number.isFinite(v));
});
