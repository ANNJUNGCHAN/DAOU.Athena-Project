// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인4) "계좌" 카드종 렌더러.
//
// 스코프(§3 Lane 4 표 근거 칸): 4-TR 합성 자산요약은 스코프 밖이다(1TR=1카드 원칙 위반,
// §4 원칙 3) — 여기서는 이 envelope 하나가 이미 가진 필드만 본다. 다루는 건 둘뿐:
//   (a) facts 응답(예: kt00004:profit_and_loss)의 손익 필드에 ChangeBadge를 입힌다.
//   (b) kt00001:foreign_currency_deposits(table) 응답에서 KRW/USD 두 행만 골라
//       TwoLineRow로 보여준다.
// 둘 다 이 envelope에 없으면 null — 범용 렌더러가 그대로 그린다(all-or-nothing 계약,
// card-kinds.js).
//
// 순수 판정 로직(selectProfitFields/selectCurrencyRows)과 DOM 조립을 나눈다 —
// card-primitives.js가 인용한 chart-card.js의 "순수 변환 분리" 관행과 같은 이유다.
// 판정 로직만 node --test로 검증한다(card-kind-계좌.test.js) — DOM 빌더는 document가
// 있는 렌더러에서만 호출된다.
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;

// 손익(부호가 실제로 손익을 의미하는) 필드만 고른다. 원금·기준금액(tdy_lspft_amt/
// lspft_amt/invt_bsamt 등)은 늘 양수라 대상이 아니다 — backend/athena_api/generated/
// models.py:6251-6264(kt00004:profit_and_loss) 실측.
const PROFIT_AMOUNT_KEYS = ['lspft', 'lspft2', 'tdy_lspft'];
const PROFIT_RATE_KEYS = ['lspft_rt', 'lspft_ratio', 'tdy_lspft_rt'];

/** facts 응답의 fields[]에서 손익 필드만 {key,label,value,unit} 목록으로 골라낸다.
 * 원래 fields 순서를 보존한다. 값이 없는(null/undefined/빈문자) 필드는 생략한다
 * — 실데이터 없는 필드는 렌더에서 생략(§4 원칙 1). 손익 필드가 하나도 없으면 빈 배열. */
function selectProfitFields(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const out = [];
  for (const field of list) {
    const key = field && field.key;
    if (!key) continue;
    const isAmount = PROFIT_AMOUNT_KEYS.includes(key);
    const isRate = PROFIT_RATE_KEYS.includes(key);
    if (!isAmount && !isRate) continue;
    const value = field.value;
    if (value === null || value === undefined || value === '') continue;
    out.push({ key, label: field.label || key, value, unit: isAmount ? '원' : '%' });
  }
  return out;
}

// kt00001:foreign_currency_deposits — 통화별 표(§3 Lane 4 스코프: KRW/USD만).
const CURRENCY_LABEL = { KRW: '원화', USD: '달러' };

/** columns/rows가 foreign_currency_deposits 모양(crnc_cd+fx_entr 컬럼)이 아니면 null
 * (이 카드종에 온 다른 table 응답과 구분). 모양은 맞지만 KRW/USD 행이 하나도 없거나
 * 값이 비어 있으면 빈 배열. */
function selectCurrencyRows(columns, rows) {
  const cols = Array.isArray(columns) ? columns : [];
  const hasShape = cols.some((c) => c && c.key === 'crnc_cd') && cols.some((c) => c && c.key === 'fx_entr');
  if (!hasShape) return null;
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const row of list) {
    if (!row) continue;
    const code = String(row.crnc_cd || '').trim().toUpperCase();
    const label = CURRENCY_LABEL[code];
    if (!label) continue;
    if (row.fx_entr === null || row.fx_entr === undefined || row.fx_entr === '') continue;
    out.push({ code, label, amount: row.fx_entr });
  }
  return out;
}

if (isNode) {
  module.exports = { selectProfitFields, selectCurrencyRows };
  return;
}

// ---------- DOM 조립 — document가 있는 렌더러 전용 ----------
const { TwoLineRow, ChangeBadge } = window.AthenaLib.CardPrimitives;
const { formatNumeric } = window.AthenaLib.FactsCard;

function buildRowList(rows) {
  const el = document.createElement('div');
  el.className = 'card-kind-account-rows';
  rows.forEach((row) => el.appendChild(row));
  return el;
}

window.AthenaLib.CardKinds.register('계좌', (envelope) => {
  const data = envelope && envelope.data;
  if (!data) return null;

  if (Array.isArray(data.fields)) {
    const profit = selectProfitFields(data.fields);
    if (profit.length) {
      return buildRowList(profit.map(({ key, label, value, unit }) => TwoLineRow({
        title: label,
        badge: ChangeBadge({ key, value, label: `${formatNumeric(value)}${unit}` }),
      })));
    }
  }

  if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
    const currency = selectCurrencyRows(data.columns, data.rows);
    if (currency && currency.length) {
      return buildRowList(currency.map(({ label, code, amount }) => TwoLineRow({
        title: label,
        titleSub: code,
        value: `${formatNumeric(amount)}원`,
      })));
    }
  }

  return null;
});

})();
