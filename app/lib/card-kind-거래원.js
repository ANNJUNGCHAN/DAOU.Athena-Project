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
//
// 2026-08-26 추가(팀리드 지시) — 속도 레인이 연 새 fast-path가 base:ka10038
// (종목별증권사순위요청)로도 "거래원" 타이틀에 온다. 실측(backend/ref/
// kiwoom-screen-definitions.json:15845-15864): presentation.card="CompoundCard"
// /layout="compound"다 — "테이블 모양"이라는 요청 설명과 달리 실제로는
// envelope.data.rows가 아니라 envelope.data.table.rows로 온다(canvas.js
// renderCompoundCard 후킹). 행 하나는 models.py Ka10038ResponseStkSecRankItem
// 그대로: rank(순위, 이미 매겨져 있다 — N분할 facts 갈래처럼 배열 인덱스로
// 다시 매길 필요가 없다)/mmcm_nm(회원사명)/buy_qty/sell_qty/acc_netprps_qty.
// 값 하나만 보여줄 수 있는 RankedRow 계약상 세 수량 중 하나를 골라야 하는데,
// "종목별증권사순위"라는 TR 성격상 순위를 매기는 자연스러운 기준은 누적
// 순매수(acc_netprps_qty)다(매수/매도 단독이면 애초에 ka10040/ka10002 분기와
// 같은 편향 지표가 된다) — buy_qty/sell_qty는 여기서 버리지 않고 그냥
// "이 값으로 순위를 매겼다"는 걸 라벨로만 밝힌다(정직성, 값 자체를 숨기진
// 않되 지어낸 합성값을 만들지도 않는다).
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const { RankedRow } = CardPrimitives;

const SIDE_LABELS = { buy: '매수 상위', sell: '매도 상위', net: '순매수 상위' };

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

// ka10038 stk_sec_rank 한 행 → {rank,name,qty} | null(핵심 필드 없으면 그
// 행만 생략한다 — 카드 전체를 죽이지 않는다). rank는 이미 응답에 있는 값을
// 그대로 쓴다(facts 갈래처럼 배열 인덱스로 다시 매기지 않는다).
function buildBrokerTableRow(row) {
  if (!row) return null;
  const rank = row.rank;
  const name = row.mmcm_nm;
  const qty = row.acc_netprps_qty;
  if (rank === undefined || rank === null || rank === '') return null;
  if (!name) return null;
  if (qty === undefined || qty === null || qty === '') return null;
  return { rank, name, qty };
}

// rows: envelope.data.table.rows(compound, ka10038). 반환:
// { side: 'net', rows: [{rank,name,qty}] } | null(핵심 필드가 있는 행이 하나도 없음).
function resolveBrokerRankingTable(rows) {
  const list = (Array.isArray(rows) ? rows : []).map(buildBrokerTableRow).filter(Boolean);
  if (!list.length) return null;
  return { side: 'net', rows: list };
}

function buildRankingEl(ranking) {
  const wrap = document.createElement('div');
  wrap.className = 'card-kit-broker-ranking';
  const label = document.createElement('div');
  label.className = 'card-kit-broker-ranking-label';
  label.textContent = SIDE_LABELS[ranking.side] || '거래원 순위';
  wrap.appendChild(label);
  for (const row of ranking.rows) {
    wrap.appendChild(RankedRow({ rank: row.rank, name: row.name, value: row.qty, unit: '주' }));
  }
  return wrap;
}

function render거래원(envelope) {
  // 갈래 1 — facts 봉투(ka10040/ka10002, N분할 스칼라 필드).
  const fields = envelope && envelope.data && Array.isArray(envelope.data.fields) ? envelope.data.fields : [];
  if (fields.length) {
    const map = {};
    for (const f of fields) {
      if (f && f.key !== undefined && f.key !== null) map[f.key] = f.value;
    }
    const ranking = resolveBrokerRanking(map);
    if (ranking) return buildRankingEl(ranking);
  }

  // 갈래 2 — compound 봉투(ka10038, envelope.data.table.rows).
  const tableRows = envelope && envelope.data && envelope.data.table && Array.isArray(envelope.data.table.rows)
    ? envelope.data.table.rows
    : [];
  const tableRanking = resolveBrokerRankingTable(tableRows);
  if (tableRanking) return buildRankingEl(tableRanking);

  return null;
}

const __exports = { resolveBrokerRanking, resolveBrokerRankingTable, buildBrokerTableRow, render거래원 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('거래원', render거래원);
}

})();
