// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인3) 카드종 — "보유주식".
// IIFE 스코프 격리 + UMD 각주(card-primitives.js와 같은 패턴).
//
// 실측 근거: .omc/state/card-v3-specs.json[12](보유주식카드 gap 분석),
// backend/athena_api/generated/models.py — 이 카드종 타이틀로 귀결되는 5개
// operation_ref의 포지션-행 모델 필드가 전부 다른 이름을 쓴다:
//   ka01690(Ka01690ResponseDayBalRtItem):        rmnd_qty / buy_uv  / evlt_amt / evltv_prft / prft_rt
//   kt00018:holdings(...AcntEvltRemnIndvTotItem): rmnd_qty / pur_pric/ evlt_amt / evltv_prft / prft_rt
//   kt50020:gold_holdings(...GoldAcntEvltPrstItem): real_qty / avg_prc / est_amt  / est_lspft  / est_ratio
//   kt00004(...StkAcntEvltPrstItem):              rmnd_qty / avg_prc / evlt_amt / pl_amt     / pl_rt
//   kt00005(...StkCntrRemnItem):                  cur_qty  / buy_uv  / evlt_amt / evltv_prft / pl_rt
// 의미(수량/평균단가/평가금액/손익금액/손익률)는 같으므로 후보 키 목록에서 처음
// 매치되는 값을 쓴다 — 값을 새로 계산하거나 다른 TR 응답과 섞지 않는다.
//
// 레인 스코프 제한(팀리드 지시, plan §3 Lane 3 행): TR별 독립 카드에 TwoLineRow만
// 적용한다 — "1 TR = 1 카드" 확정 규칙상 주식+금현물을 한 카드에 병합하지 않는다
// (gap 분석 결론과 일치). "N API" 배지·ACCOUNT TR 메타 패널은 문서용 섹션이라
// 구현 대상이 아니다. TR "04"(웹소켓 잔고)는 read_display 게이트를 통과 못 해
// 캔버스 카드 자체가 안 만들어지므로 이 파일이 다룰 일이 없다.
//
// 우측 2줄 배치: primitives 목록은 "평가금액+손익배지 2줄"이라고 적지만, TwoLineRow
// 프리미티브의 실제 계약(card-primitives.js)은 value|badge가 윗줄, valueSub가
// 아랫줄(항상 평문, 색 없음)이다 — 손익 방향색(색상반전, Paper 핵심 요구)을 지키려면
// 손익을 배지(ChangeBadge, 부호 기반 색)로 윗줄에 놓고 평가금액을 아랫줄 평문으로
// 내린다. 프리미티브 자체를 바꾸지 않는 선에서(레인 스코프 밖의 공유 파일) 색 신호를
// 순서보다 우선한 절충이다.
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { TwoLineRow, ChangeBadge } = CardPrimitives;
const { formatNumeric } = FactsCard;

const QTY_KEYS = ['rmnd_qty', 'real_qty', 'cur_qty'];
const AVG_PRICE_KEYS = ['buy_uv', 'pur_pric', 'avg_prc'];
const EVAL_AMT_KEYS = ['evlt_amt', 'est_amt'];
const PL_AMT_KEYS = ['evltv_prft', 'est_lspft', 'pl_amt'];
const PL_RATE_KEYS = ['prft_rt', 'est_ratio', 'pl_rt'];

function pick(row, keys) {
  for (const key of keys) {
    const v = row[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// row(테이블/compound 표 한 행) → 렌더용 모델 | null(종목명·수량·평가금액 중
// 하나라도 없으면 이 행을 생략한다 — 핵심 식별 필드 없이 반쪽으로 안 그린다).
function buildPositionLine(row) {
  if (!row) return null;
  const name = row.stk_nm;
  const qty = pick(row, QTY_KEYS);
  const evalAmt = pick(row, EVAL_AMT_KEYS);
  if (!name || qty === undefined || evalAmt === undefined) return null;
  return {
    name,
    qty,
    avgPrice: pick(row, AVG_PRICE_KEYS),
    evalAmt,
    plAmt: pick(row, PL_AMT_KEYS),
    plRate: pick(row, PL_RATE_KEYS),
  };
}

function formatSignedWon(raw) {
  if (raw === undefined || raw === null || raw === '') return null; // Number(null)===0이라 값 없음과 0을 헷갈리면 안 된다
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n).toLocaleString('ko-KR');
  if (n > 0) return `+${abs}원`;
  if (n < 0) return `-${abs}원`;
  return `${abs}원`;
}

function formatRatePct(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).trim();
  return text.endsWith('%') ? text : `${text}%`;
}

// plAmt/plRate → 배지 라벨("+565,000원 (7.1%)") | null(둘 다 없으면 배지를 안 만든다).
function buildPlLabel(plAmt, plRate) {
  const amt = formatSignedWon(plAmt);
  const rate = formatRatePct(plRate);
  if (amt && rate) return `${amt} (${rate})`;
  return amt || rate || null;
}

function extractPositionRows(envelope) {
  const data = envelope && envelope.data;
  if (!data) return [];
  if (Array.isArray(data.rows)) return data.rows; // table canvas_type(kt00018/kt50020/kt00004/kt00005)
  if (data.table && Array.isArray(data.table.rows)) return data.table.rows; // compound canvas_type(ka01690)
  return [];
}

function render보유주식(envelope) {
  const lines = extractPositionRows(envelope).map(buildPositionLine).filter(Boolean);
  if (!lines.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'card-kit-position-list';
  for (const line of lines) {
    const titleSub = line.avgPrice !== undefined
      ? `${formatNumeric(line.qty)}주 · 평균 ${formatNumeric(line.avgPrice)}원`
      : `${formatNumeric(line.qty)}주`;
    const plLabel = buildPlLabel(line.plAmt, line.plRate);
    const evalText = `${formatNumeric(line.evalAmt)}원`;
    if (plLabel) {
      wrap.appendChild(TwoLineRow({
        title: line.name,
        titleSub,
        badge: ChangeBadge({ value: line.plAmt !== undefined ? line.plAmt : line.plRate, label: plLabel }),
        valueSub: evalText,
      }));
    } else {
      wrap.appendChild(TwoLineRow({ title: line.name, titleSub, value: evalText }));
    }
  }
  return wrap;
}

const __exports = { buildPositionLine, buildPlLabel, render보유주식 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('보유주식', render보유주식);
}

})();
