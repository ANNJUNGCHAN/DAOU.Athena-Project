// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인3) 카드종 — "거래원".
// IIFE 스코프 격리 + UMD 각주(card-primitives.js와 같은 패턴) — 순수 판정 함수는
// node --test로, DOM 빌더는 렌더러(document 존재)에서만 검증한다.
//
// 실측 근거: .omc/state/card-v3-specs.json[14](거래원카드 gap 분석),
// backend/athena_api/generated/models.py(Ka10040Response L2627-, Ka10002Response
// L1296-). "12 API"/도메인그룹/TR카탈로그 행은 카드-TR 매핑 문서 성격이라 런타임
// 렌더 대상이 아니다(gap 분석 결론, 사용자 확정 규칙) — 순위행만 그린다.
//
// 매수/매도 동시 표시 금지(레인 스코프 제한): ka10040/ka10002는 buy_brokers·
// sell_brokers가 서로 다른 detail_group 응답이라 한 envelope에 한쪽 필드만 온다.
// 한 카드에서 양쪽을 합성하지 않는다 — 카드 2장(매수 1장·매도 1장)으로 자연 처리된다.
//
// 필드 네이밍이 TR마다 다르다(실측):
//   ka10040: 이름=buy_trde_ori_N/sel_trde_ori_N, 수량=buy_trde_ori_qty_N/sel_trde_ori_qty_N
//   ka10002: 이름=buy_trde_ori_nm_N/sel_trde_ori_nm_N, 수량=buy_trde_qty_N/sel_trde_qty_N
// N=1..5. 코드(_cd_N)·증감(_irds_N)은 Paper 목업에 없는 필드라 생략한다(손실 아님).
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const { RankedRow } = CardPrimitives;

// 우선순위대로 시도 — 실제로는 한 envelope에 정확히 한 패턴의 필드만 있다(서로
// 다른 detail_group 응답이라 겹치지 않는다). 우선순위 자체는 안전망일 뿐이다.
const NAME_QTY_PATTERNS = [
  { side: 'buy', name: (n) => `buy_trde_ori_${n}`, qty: (n) => `buy_trde_ori_qty_${n}` },
  { side: 'sell', name: (n) => `sel_trde_ori_${n}`, qty: (n) => `sel_trde_ori_qty_${n}` },
  { side: 'buy', name: (n) => `buy_trde_ori_nm_${n}`, qty: (n) => `buy_trde_qty_${n}` },
  { side: 'sell', name: (n) => `sel_trde_ori_nm_${n}`, qty: (n) => `sel_trde_qty_${n}` },
];

// fieldMap: {key: value} — envelope.data.fields([{key,label,value}])를 호출부가 이미 눌러
// 넣은 lookup. 반환: { side: 'buy'|'sell', rows: [{rank,name,qty}] } | null(핵심 필드 없음).
function resolveBrokerRanking(fieldMap) {
  const map = fieldMap || {};
  for (const pattern of NAME_QTY_PATTERNS) {
    const rows = [];
    for (let n = 1; n <= 5; n += 1) {
      const name = map[pattern.name(n)];
      const qty = map[pattern.qty(n)];
      if (name === undefined || name === null || name === '') continue;
      if (qty === undefined || qty === null || qty === '') continue;
      rows.push({ rank: n, name, qty });
    }
    if (rows.length) return { side: pattern.side, rows };
  }
  return null;
}

function render거래원(envelope) {
  const fields = envelope && envelope.data && Array.isArray(envelope.data.fields) ? envelope.data.fields : [];
  const map = {};
  for (const f of fields) {
    if (f && f.key !== undefined && f.key !== null) map[f.key] = f.value;
  }
  const ranking = resolveBrokerRanking(map);
  if (!ranking) return null;

  const wrap = document.createElement('div');
  wrap.className = 'card-kit-broker-ranking';
  const label = document.createElement('div');
  label.className = 'card-kit-broker-ranking-label';
  label.textContent = ranking.side === 'buy' ? '매수 상위' : '매도 상위';
  wrap.appendChild(label);
  for (const row of ranking.rows) {
    wrap.appendChild(RankedRow({ rank: row.rank, name: row.name, value: row.qty, unit: '주' }));
  }
  return wrap;
}

const __exports = { resolveBrokerRanking, render거래원 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('거래원', render거래원);
}

})();
