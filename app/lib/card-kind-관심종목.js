// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인4) "관심종목" 카드종 렌더러.
//
// 스코프(§3 Lane 4 표 근거 칸): group→membership→price 3단 조인(ka01300→ka01301→ka10095)
// 은 스코프 밖이다(1TR=1카드 원칙 위반, §4 원칙 3 — ka01300/ka01301 응답 자체에 가격·
// 등락 필드가 없다, gap 분석 실측). 여기서는 ka10095(관심종목정보요청) 단일 응답에
// 대해서만 "레일 로우"(종목명+가격+등락)를 렌더한다. ka01300/ka01301처럼 이 모양이
// 아닌 envelope는 null을 돌려줘 범용 렌더러로 폴백한다(all-or-nothing 계약, card-kinds.js).
//
// 순수 판정 로직(selectWatchlistRows)과 DOM 조립을 나눈다 — card-kind-계좌.js와 같은
// 이유(card-primitives.js가 인용한 chart-card.js "순수 변환 분리" 관행). 판정 로직만
// node --test로 검증한다(card-kind-관심종목.test.js).
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;

/** columns/rows가 ka10095(atn_stk_infr[]) 모양(stk_nm+cur_prc 컬럼)이 아니면 null —
 * ka01300/ka01301의 얇은 compound 응답과 이렇게 구분한다. 모양은 맞아도 종목명·현재가가
 * 없는 행은 생략한다(§4 원칙 1). 등락(pred_pre/flu_rt)은 있으면 붙이고 없으면 change:null
 * — 없는 필드를 지어내 채우지 않는다. */
function selectWatchlistRows(columns, rows) {
  const cols = Array.isArray(columns) ? columns : [];
  const hasShape = cols.some((c) => c && c.key === 'stk_nm') && cols.some((c) => c && c.key === 'cur_prc');
  if (!hasShape) return null;
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    if (!row) continue;
    const name = row.stk_nm;
    const price = row.cur_prc;
    if (name === null || name === undefined || name === '') continue;
    if (price === null || price === undefined || price === '') continue;
    const item = { name, code: row.stk_cd || null, price, change: null };
    if (row.pred_pre !== null && row.pred_pre !== undefined && row.pred_pre !== '') {
      item.change = { signValue: row.pred_pre_sig, amount: row.pred_pre, rate: row.flu_rt };
    }
    out.push(item);
  }
  return out;
}

if (isNode) {
  module.exports = { selectWatchlistRows };
  return;
}

// ---------- DOM 조립 — document가 있는 렌더러 전용 ----------
const { TwoLineRow, ChangeBadge } = window.AthenaLib.CardPrimitives;
const { formatNumeric } = window.AthenaLib.FactsCard;

// 우측 두 줄은 "값+서브라인" 또는 "배지+서브라인" 중 하나다(TwoLineRow 계약 —
// card-primitives.js). 등락이 신호이므로 배지 쪽에 태우고, 가격은 서브라인으로
// 내린다 — 실제 표시되는 두 수치는 그대로다(파생 계산·추정치 없음), 자리만 바뀐다.
function buildRailRow({ name, code, price, change }) {
  const opts = { title: name, titleSub: code || undefined };
  if (change) {
    const rateText = change.rate !== null && change.rate !== undefined && change.rate !== ''
      ? ` (${formatNumeric(change.rate)}%)`
      : '';
    opts.badge = ChangeBadge({
      key: 'pred_pre_sig',
      value: change.signValue,
      label: `${formatNumeric(change.amount)}원${rateText}`,
    });
    opts.valueSub = `${formatNumeric(price)}원`;
  } else {
    opts.value = `${formatNumeric(price)}원`;
  }
  return TwoLineRow(opts);
}

window.AthenaLib.CardKinds.register('관심종목', (envelope) => {
  const data = envelope && envelope.data;
  if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return null;
  const rows = selectWatchlistRows(data.columns, data.rows);
  if (!rows || !rows.length) return null;
  const el = document.createElement('div');
  el.className = 'card-kind-watchlist-rail';
  rows.forEach((row) => el.appendChild(buildRailRow(row)));
  return el;
});

})();
