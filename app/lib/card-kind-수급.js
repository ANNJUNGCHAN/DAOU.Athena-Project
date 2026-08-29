// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인2) 카드종 — "수급".
//
// 실측(backend/athena_api/canvas_transform.py resolve_fixed_card_title, 2026-08-26):
// card_title="수급"으로 라우팅되는 TR은 10종 — domain=investor 3종(ka10008/ka10131/
// ka52301) + ka10061(domain=stockinfo) + 순위/시세 도메인의 투자자 매매 6종.
// ka10061의 응답 모델(Ka10061ResponseStkInvsrOrgnTotItem,
// backend/athena_api/generated/models.py:3181)이 ind_invsr(개인투자자)/frgnr_invsr
// (외국인투자자)/orgn(기관계) 필드를 그대로 갖고 있어 Paper 수급카드 목업(개인/외국인/기관
// 3행 부호값 막대)과 정확히 일치한다 — 10종 중 유일하게 목업을 문자 그대로
// 재현하는 조각이다. 나머지는 목업과 다른 필드셋이라 각자
// 가진 진짜 신호(부호 있는 순매매 필드)로 대체 시각화를 만든다 — 없는 필드를 지어내지
// 않는다(§4 원칙). ka10045만 compound이고 나머지는 table이므로 두 envelope 모양을 모두 읽는다.
// build_table은 컬럼 라벨을 원본 키 그대로 붙이므로(canvas_transform.py build_table) 한글
// 라벨은 이 실측 필드 전용으로 여기서 직접 단다.
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { ProportionalBar } = CardPrimitives;
const { formatDatetime } = FactsCard;

// ---------- 순수 로직 ----------

// ka10061(종목별투자자기관별합계요청) — Paper 목업과 정확히 같은 개인/외국인/기관 3필드.
// 10종 중 유일하게 목업을 그대로 재현하는 조각(§헤더 주석).
function detectStockInvestorSplit(row) {
  if (!row) return false;
  return 'ind_invsr' in row && 'frgnr_invsr' in row && 'orgn' in row;
}

// ka10131(기관외국인연속매매현황) — 종목별 순위 테이블. 1위 행(연속순매수 최상위 종목)의
// 기관/외국인 순매매금액을 보여준다 — 전 종목 합계가 아니라 "연속매매 1위 종목" 스냅샷임을
// 호출부가 라벨로 밝힌다(§4 정직성).
function detectContinuousTrade(row) {
  if (!row) return false;
  return 'stk_nm' in row && 'orgn_nettrde_amt' in row && 'frgnr_nettrde_amt' in row;
}

// ka10008(주식외국인종목별매매동향) — 종목 하나의 일자별 외국인 보유 변동 추이.
function detectForeignDaily(row) {
  if (!row) return false;
  return 'dt' in row && 'chg_qty' in row && 'frgnr_limit_irds' in row;
}

// ka52301(금현물투자자현황) — 매수/매도/순매수 금액 3필드.
function detectGoldInvestor(row) {
  if (!row) return false;
  return 'all_dfrt_trst_buy_amt' in row
    && 'all_dfrt_trst_sell_amt' in row
    && 'all_dfrt_trst_netprps_amt' in row;
}

function detectStockNetFlow(row) {
  if (!row || !('stk_nm' in row)) return false;
  return ['netslmt', 'netprps_qty', 'netprps_amt'].some((key) => key in row);
}

function detectForeignInstitutionRanking(row) {
  if (!row) return false;
  return 'for_netslmt_stk_nm' in row
    && 'for_netprps_stk_nm' in row
    && 'orgn_netslmt_stk_nm' in row
    && 'orgn_netprps_stk_nm' in row;
}

function detectInstitutionForeignDaily(row) {
  return !!row && 'dt' in row
    && 'orgn_daly_nettrde_qty' in row
    && 'for_daly_nettrde_qty' in row;
}

function extractFlowRows(envelope) {
  const data = envelope && envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const table = data.table && typeof data.table === 'object' ? data.table : data;
  return Array.isArray(table.rows) ? table.rows : [];
}

function detectShape(rows) {
  const first = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!first) return null;
  if (detectStockInvestorSplit(first)) return 'stock_investor_split';
  if (detectContinuousTrade(first)) return 'continuous_trade';
  if (detectForeignDaily(first)) return 'foreign_daily';
  if (detectGoldInvestor(first)) return 'gold_investor';
  if (detectForeignInstitutionRanking(first)) return 'foreign_institution_ranking';
  if (detectInstitutionForeignDaily(first)) return 'institution_foreign_daily';
  if (detectStockNetFlow(first)) return 'stock_net_flow';
  return null;
}

const _DAILY_ROWS_MAX = 10;

// ---------- DOM 빌더 ----------

function buildStockInvestorSplit(row) {
  return ProportionalBar({
    values: [Number(row.ind_invsr) || 0, Number(row.frgnr_invsr) || 0, Number(row.orgn) || 0],
    labels: ['개인', '외국인', '기관'],
  });
}

function buildContinuousTrade(row) {
  const wrap = document.createElement('div');
  wrap.className = 'card-kit-sugub-note';
  wrap.textContent = `연속매매 1위 · ${row.stk_nm || '—'}`;
  const bar = ProportionalBar({
    values: [Number(row.orgn_nettrde_amt) || 0, Number(row.frgnr_nettrde_amt) || 0],
    labels: ['기관순매매금액', '외국인순매매액'],
  });
  const el = document.createElement('div');
  el.appendChild(wrap);
  el.appendChild(bar);
  return el;
}

function buildForeignDaily(rows) {
  const kept = rows.slice(0, _DAILY_ROWS_MAX).filter((r) => r && 'chg_qty' in r);
  if (!kept.length) return null;
  return ProportionalBar({
    values: kept.map((r) => Number(r.chg_qty) || 0),
    labels: kept.map((r) => formatDatetime(r.dt)),
  });
}

function buildGoldInvestor(row) {
  return ProportionalBar({
    values: [
      Number(row.all_dfrt_trst_buy_amt) || 0,
      Number(row.all_dfrt_trst_sell_amt) || 0,
      Number(row.all_dfrt_trst_netprps_amt) || 0,
    ],
    labels: ['매수금액', '매도금액', '순매수금액'],
  });
}

function buildStockNetFlow(rows) {
  const kept = rows.slice(0, _DAILY_ROWS_MAX).filter((row) => row && row.stk_nm);
  if (!kept.length) return null;
  const value = (row) => row.netslmt ?? row.netprps_qty ?? row.netprps_amt ?? 0;
  return ProportionalBar({
    values: kept.map((row) => Number(value(row)) || 0),
    labels: kept.map((row) => row.stk_nm),
  });
}

function buildForeignInstitutionRanking(row) {
  return ProportionalBar({
    values: [
      -(Math.abs(Number(row.for_netslmt_qty ?? row.for_netslmt_amt) || 0)),
      Number(row.for_netprps_qty ?? row.for_netprps_amt) || 0,
      -(Math.abs(Number(row.orgn_netslmt_qty ?? row.orgn_netslmt_amt) || 0)),
      Number(row.orgn_netprps_qty ?? row.orgn_netprps_amt) || 0,
    ],
    labels: [
      `외국인 매도 · ${row.for_netslmt_stk_nm || '—'}`,
      `외국인 매수 · ${row.for_netprps_stk_nm || '—'}`,
      `기관 매도 · ${row.orgn_netslmt_stk_nm || '—'}`,
      `기관 매수 · ${row.orgn_netprps_stk_nm || '—'}`,
    ],
  });
}

function buildInstitutionForeignDaily(rows) {
  const kept = rows.slice(0, 5).filter(detectInstitutionForeignDaily);
  if (!kept.length) return null;
  return ProportionalBar({
    values: kept.flatMap((row) => [
      Number(row.orgn_daly_nettrde_qty) || 0,
      Number(row.for_daly_nettrde_qty) || 0,
    ]),
    labels: kept.flatMap((row) => [
      `${formatDatetime(row.dt)} · 기관`,
      `${formatDatetime(row.dt)} · 외국인`,
    ]),
  });
}

function render수급(envelope) {
  const rows = extractFlowRows(envelope);
  if (!rows.length) return null;
  const shape = detectShape(rows);
  if (shape === 'stock_investor_split') return buildStockInvestorSplit(rows[0]);
  if (shape === 'continuous_trade') return buildContinuousTrade(rows[0]);
  if (shape === 'foreign_daily') return buildForeignDaily(rows);
  if (shape === 'gold_investor') return buildGoldInvestor(rows[0]);
  if (shape === 'foreign_institution_ranking') return buildForeignInstitutionRanking(rows[0]);
  if (shape === 'institution_foreign_daily') return buildInstitutionForeignDaily(rows);
  if (shape === 'stock_net_flow') return buildStockNetFlow(rows);
  return null;
}

const __exports = {
  detectStockInvestorSplit,
  detectContinuousTrade,
  detectForeignDaily,
  detectGoldInvestor,
  detectStockNetFlow,
  detectForeignInstitutionRanking,
  detectInstitutionForeignDaily,
  extractFlowRows,
  detectShape,
  render수급,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('수급', render수급);
}

})();
