// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인2) 카드종 — "수급".
//
// 실측(backend/athena_api/canvas_transform.py resolve_fixed_card_title, 2026-08-26):
// card_title="수급"으로 실제로 라우팅되는 TR은 domain=investor 3종(ka10008/ka10131/
// ka52301)뿐이다 — Paper 목업의 "개인/외국인/기관 3행" 원본 필드(ind_invsr/frgnr_invsr/
// orgn)는 ka10061(domain=stockinfo)에만 있고 ka10061은 card_title="종목정보"로 라우팅된다
// (다른 레인 소관, 이 파일에서 손 안 댐 — canvas_transform.py는 이 태스크 스코프 밖).
// 그래서 이 파일은 Paper 목업을 문자 그대로 재현하지 않고, 실제로 이 타이틀에 도달하는
// 3개 TR이 각자 가진 진짜 신호(부호 있는 순매매 필드)로 ProportionalBar를 만든다 —
// 없는 필드를 지어내지 않는다(§4 원칙). 전부 build_table 경유(layout=table, envelope.data
// = {columns, rows}) — build_table은 컬럼 라벨을 원본 키 그대로 붙이므로(canvas_transform.py
// build_table) 한글 라벨은 이 실측 필드 전용으로 여기서 직접 단다.
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

function detectShape(rows) {
  const first = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!first) return null;
  if (detectContinuousTrade(first)) return 'continuous_trade';
  if (detectForeignDaily(first)) return 'foreign_daily';
  if (detectGoldInvestor(first)) return 'gold_investor';
  return null;
}

const _DAILY_ROWS_MAX = 10;

// ---------- DOM 빌더 ----------

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

function render수급(envelope) {
  const rows = envelope && envelope.data && Array.isArray(envelope.data.rows)
    ? envelope.data.rows
    : null;
  if (!rows || !rows.length) return null;
  const shape = detectShape(rows);
  if (shape === 'continuous_trade') return buildContinuousTrade(rows[0]);
  if (shape === 'foreign_daily') return buildForeignDaily(rows);
  if (shape === 'gold_investor') return buildGoldInvestor(rows[0]);
  return null;
}

const __exports = {
  detectContinuousTrade,
  detectForeignDaily,
  detectGoldInvestor,
  detectShape,
  render수급,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.CardKindSugub = __exports;
  window.AthenaLib.CardKinds.register('수급', render수급);
}

})();
