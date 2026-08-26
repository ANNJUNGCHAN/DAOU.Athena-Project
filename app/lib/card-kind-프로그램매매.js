// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인2) 카드종 — "프로그램매매".
//
// 스코프(팀리드 지시 + 실측): 순매수 증감·날짜 교차비교는 생략한다 — 시장 전체 단위
// TR(ka90005/07/10) 어디에도 "증감" 필드가 없고, 서로 다른 날짜를 한 응답에서 비교하려면
// 다중 호출 스티칭이 필요한데 그런 로직이 없다(canvas_data.py는 TR 1회 호출 = 카드 1장).
// 이 파일은 실제로 있는 필드(전체/비차익/차익의 매수·매도·순매수, 부호 포함)만으로
// TabSwitcher + ProportionalBar를 만든다. "9 API" 배지·QUOTES/STOCKINFO/WEBSOCKET
// 카탈로그 나열은 Paper 문서화 레이어라 플랜 §1/§4-5가 구현 대상에서 제외했다 — 안 만든다.
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const { ProportionalBar, TabSwitcher } = CardPrimitives;

// ---------- 순수 로직 ----------

// ka90005/ka90010(프로그램매매추이/누적추이 시간대별) — 실측: 전체/비차익/차익 3범주가
// 한 행에 9컬럼(각 매수·매도·순매수)으로 동시에 온다(탭으로 좁혀 주지 않는다).
function detectTrendRow(row) {
  if (!row) return null;
  if (!('all_buy' in row && 'all_sel' in row && 'all_netprps' in row)) return null;
  const hasNdiffpro = 'ndiffpro_trde_buy' in row && 'ndiffpro_trde_sel' in row && 'ndiffpro_trde_netprps' in row;
  const hasDfrt = 'dfrt_trde_buy' in row && 'dfrt_trde_sel' in row && 'dfrt_trde_netprps' in row;
  return { hasNdiffpro, hasDfrt };
}

// ka90004(종목별프로그램매매현황) — compound 헤더 합계 3필드(tot_2/4/5).
function detectStockSummaryHeader(header) {
  const map = new Map((Array.isArray(header) ? header : []).map((f) => [f.key, f]));
  if (map.has('tot_2') && map.has('tot_4') && map.has('tot_5')) return map;
  return null;
}

const _CATEGORIES = [
  { tab: '전체', buy: 'all_buy', sel: 'all_sel', net: 'all_netprps' },
  { tab: '비차익', buy: 'ndiffpro_trde_buy', sel: 'ndiffpro_trde_sel', net: 'ndiffpro_trde_netprps' },
  { tab: '차익', buy: 'dfrt_trde_buy', sel: 'dfrt_trde_sel', net: 'dfrt_trde_netprps' },
];

function categoryValues(row, category) {
  return {
    values: [Number(row[category.buy]) || 0, Number(row[category.sel]) || 0, Number(row[category.net]) || 0],
    labels: ['매수', '매도', '순매수'],
  };
}

// ---------- DOM 빌더 ----------

function buildTrend(row, shape) {
  const categories = [_CATEGORIES[0]];
  if (shape.hasNdiffpro) categories.push(_CATEGORIES[1]);
  if (shape.hasDfrt) categories.push(_CATEGORIES[2]);

  const wrap = document.createElement('div');
  wrap.className = 'card-kit-program-trend';
  let barEl = ProportionalBar(categoryValues(row, categories[0]));
  wrap.appendChild(barEl);
  if (categories.length === 1) return wrap; // 비차익/차익 필드가 없으면 탭 없이 전체만.

  const tabs = TabSwitcher({
    tabs: categories.map((c) => c.tab),
    activeIndex: 0,
    onSelect: (i) => {
      const next = ProportionalBar(categoryValues(row, categories[i]));
      wrap.replaceChild(next, barEl);
      barEl = next;
    },
  });
  wrap.insertBefore(tabs, barEl);
  return wrap;
}

function buildStockSummary(map) {
  return ProportionalBar({
    values: [Number(map.get('tot_2').value) || 0, Number(map.get('tot_4').value) || 0, Number(map.get('tot_5').value) || 0],
    labels: [map.get('tot_2').label, map.get('tot_4').label, map.get('tot_5').label],
  });
}

function render프로그램매매(envelope) {
  const data = envelope && envelope.data;
  if (!data) return null;

  if (Array.isArray(data.rows) && data.rows.length) {
    const shape = detectTrendRow(data.rows[0]);
    if (shape) return buildTrend(data.rows[0], shape);
  }

  if (Array.isArray(data.header)) {
    const headerMap = detectStockSummaryHeader(data.header);
    if (headerMap) return buildStockSummary(headerMap);
  }

  return null;
}

const __exports = {
  detectTrendRow,
  detectStockSummaryHeader,
  render프로그램매매,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('프로그램매매', render프로그램매매);
}

})();
