// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인4) "계좌" 카드종 렌더러.
//
// 스코프(§3 Lane 4 표 근거 칸): 4-TR 합성 자산요약은 스코프 밖이다(1TR=1카드 원칙 위반,
// §4 원칙 3) — 여기서는 이 envelope 하나가 이미 가진 필드만 본다. 다루는 건 둘뿐:
//   (a) facts 응답(예: kt00004:profit_and_loss, kt00018:portfolio_summary)의 손익
//       필드에 ChangeBadge를 입힌다 — 같은 응답에 딸려온 다른 실계좌 필드(매입금액 등)
//       는 손익이 아니어도 그대로 보여준다(값이 실재하면 버리지 않는다, §4 원칙 1).
//   (b) kt00001:foreign_currency_deposits(table) 응답에서 KRW/USD 두 행만 골라
//       TwoLineRow로 보여준다.
// 둘 다 이 envelope에 없으면 null — 범용 렌더러가 그대로 그린다(all-or-nothing 계약,
// card-kinds.js).
//
// 2026-08-26 데모 캡처 결함 수정: kt00018:portfolio_summary(계좌평가현황요청) 응답이
// tot_evlt_pl/tot_prft_rt를 안 알아봐서 손익 필드 0건 → 카드 전체가 범용 폴백으로
// 떨어져 raw 필드명(tot_pur_amt 등)·0-padding 원문 값(000000172645300)이 그대로
// 노출됐다(app/captures/card-demo/보유주식.png). 손익 키 목록을 확장하고, "손익 신호가
// 하나라도 있으면 이 envelope는 계좌 facts다" 판정 후 나머지 필드도 포맷해서 같이
// 보여주는 쪽으로 바꿨다 — 손익 필드만 골라 나머지를 버리면 그것도 정보 손실이다.
//
// 순수 판정 로직(selectAccountFacts/selectCurrencyRows)과 DOM 조립을 나눈다 —
// card-primitives.js가 인용한 chart-card.js의 "순수 변환 분리" 관행과 같은 이유다.
// 판정 로직만 node --test로 검증한다(card-kind-계좌.test.js) — DOM 빌더는 document가
// 있는 렌더러에서만 호출된다.
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;

// 손익(부호가 실제로 손익을 의미하는) 필드 — backend/athena_api/generated/models.py
// 실측: kt00004:profit_and_loss(6251-6264), kt00018:portfolio_summary(8691-8695),
// ka10072/73/77(당일매도손익·손익율), ka10074(실현손익), ka10077(당일실현손익) —
// 전부 Wave0-BE 라우팅 보정 이후 "계좌"로 떨어지는 실현손익 계열이다.
const PROFIT_AMOUNT_KEYS = ['lspft', 'lspft2', 'tdy_lspft', 'tot_evlt_pl', 'tdy_sel_pl', 'rlzt_pl', 'tdy_rlzt_pl'];
const PROFIT_RATE_KEYS = ['lspft_rt', 'lspft_ratio', 'tdy_lspft_rt', 'tot_prft_rt', 'pl_rt'];
// 손익은 아니지만(늘 양수) 같은 응답에 자주 같이 오는 원화 금액 필드 — 손익 옆에서
// 버려지지 않게 같이 포맷한다(단위 "원"까지 models.py 설명으로 확인된 것만).
const PLAIN_WON_KEYS = ['tot_pur_amt', 'tot_evlt_amt', 'prsm_dpst_aset_amt'];

// envelope에 label이 없을 때만 쓰는 대체 라벨 — 전부 models.py description 그대로다
// (지어낸 한글 이름 없음). label이 왜 비는지는 프런트 문제가 아니라 별도 보고 대상
// (이 HTTP 경로가 screen_reader_label 매핑을 안 태우는 것으로 보인다).
const LABEL_FALLBACK = {
  lspft: '누적투자손익', lspft2: '당월투자손익', tdy_lspft: '당일투자손익',
  lspft_rt: '누적손익율', lspft_ratio: '당월손익율', tdy_lspft_rt: '당일손익율',
  tot_evlt_pl: '총평가손익금액', tot_prft_rt: '총수익률',
  tdy_sel_pl: '당일매도손익', pl_rt: '손익율',
  rlzt_pl: '실현손익', tdy_rlzt_pl: '당일실현손익',
  tot_pur_amt: '총매입금액', tot_evlt_amt: '총평가금액', prsm_dpst_aset_amt: '추정예탁자산',
};

function classifyKey(key) {
  if (PROFIT_AMOUNT_KEYS.includes(key)) return { kind: 'profit', unit: '원' };
  if (PROFIT_RATE_KEYS.includes(key)) return { kind: 'profit', unit: '%' };
  if (PLAIN_WON_KEYS.includes(key)) return { kind: 'plain', unit: '원' };
  return { kind: 'plain', unit: '' };
}

/** facts 응답의 fields[]에서 계좌 필드를 {key,label,value,unit,kind} 목록으로 골라낸다.
 * kind는 'profit'(ChangeBadge 대상) | 'plain'(그대로 포맷만). 손익 키가 하나도 없으면
 * — 이 렌더러가 아는 계좌 손익 응답 모양이 아니라는 뜻이라 — null(범용 렌더러로
 * 폴백). 손익 키가 하나라도 있으면 값이 실재하는 필드는(손익이든 아니든) 전부
 * 포함한다 — 손익만 골라내고 나머지를 버리면 그것도 실데이터 유실이다(§4 원칙 1은
 * "없는 데이터를 채우지 말라"는 것이지 "있는 데이터를 버려도 된다"가 아니다).
 * 원래 fields 순서를 보존한다. */
function selectAccountFacts(fields) {
  const list = Array.isArray(fields) ? fields : [];
  const hasProfitField = list.some((f) => f && (PROFIT_AMOUNT_KEYS.includes(f.key) || PROFIT_RATE_KEYS.includes(f.key)));
  if (!hasProfitField) return null;
  const out = [];
  for (const field of list) {
    const key = field && field.key;
    if (!key) continue;
    const value = field.value;
    if (value === null || value === undefined || value === '') continue;
    const { kind, unit } = classifyKey(key);
    const label = (field.label && String(field.label).trim()) || LABEL_FALLBACK[key] || key;
    out.push({ key, label, value, unit, kind });
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
  module.exports = { selectAccountFacts, selectCurrencyRows };
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
    const rows = selectAccountFacts(data.fields);
    if (rows && rows.length) {
      return buildRowList(rows.map(({ key, label, value, unit, kind }) => (
        kind === 'profit'
          ? TwoLineRow({ title: label, badge: ChangeBadge({ key, value, label: `${formatNumeric(value)}${unit}` }) })
          : TwoLineRow({ title: label, value: `${formatNumeric(value)}${unit}` })
      )));
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
