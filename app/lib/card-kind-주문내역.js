// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인3) 카드종 — "주문내역".
// IIFE 스코프 격리 + UMD 각주(card-primitives.js와 같은 패턴).
//
// 실측 근거: .omc/state/card-v3-specs.json[2](주문내역카드 gap 분석),
// backend/athena_api/generated/models.py(Ka10075ResponseOsoItem L3530-3561 —
// stk_nm/ord_qty/io_tp_nm/ord_pric/tm/ord_stt 전부 실재).
//
// 레인 스코프 제한(팀리드 지시, plan §3 Lane 3 행): "대기"/"완료" 탭 필터는 이번
// 웨이브에 배정되지 않았다(TabSwitcher는 Lane 3 프리미티브 목록에 없음) — 필터 없이
// 응답이 돌려준 리스트를 그대로 2줄 압축 행(TwoLineRow)+상태 배지(StatusPill)로 그린다.
//
// ord_stt(주문상태) 값의 정확한 열거값은 backend/ref/kiwoom-screen-definitions.json에
// formatter=plain_text로만 표기돼 있고 열거 사전이 없다 — 위조 금지 원칙상 정확한
// 원문 문자열을 추측해 toneTable을 만들지 않는다. 대신 Paper가 명명한 두 상태
// ("대기"/"완료")를 부분 문자열로만 판정해 톤을 정한다 — 다른 상태 문자열이 오면
// 안전하게 무채색(flat)으로 떨어진다.
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { TwoLineRow, StatusPill } = CardPrimitives;
const { formatNumeric } = FactsCard;

// ord_stt 원문에 "완료"/"대기"가 부분 포함되는지로만 판정한다(정확한 열거값 미상).
function classifyOrderStatus(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!text) return 'flat';
  if (text.includes('완료')) return 'ok';
  if (text.includes('대기')) return 'warn';
  return 'flat';
}

// tm(HHmmss 또는 HHmm) → "HH:MM". 형식이 안 맞으면 원문 그대로(추측 변환 금지).
function formatOrderTime(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (/^\d{6}$/.test(text) || /^\d{4}$/.test(text)) return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
  return text || null;
}

// row(테이블 한 행) → 렌더용 모델 | null(종목명·주문수량 중 하나라도 없으면 이
// 행을 생략한다 — 필드 단위 생략 원칙).
function buildOrderLine(row) {
  if (!row) return null;
  const stkNm = row.stk_nm;
  const ordQty = row.ord_qty;
  if (!stkNm || ordQty === undefined || ordQty === null || ordQty === '') return null;

  const title = `${stkNm} ${formatNumeric(ordQty)}주`;
  const ioTp = row.io_tp_nm;
  const priceNum = Number(row.ord_pric);
  const parts = [];
  if (ioTp && Number.isFinite(priceNum) && priceNum > 0) parts.push(`${ioTp} ${formatNumeric(row.ord_pric)}원`);
  else if (ioTp) parts.push(ioTp);
  const time = formatOrderTime(row.tm);
  if (time) parts.push(time);

  return { title, titleSub: parts.join(' · ') || null, status: row.ord_stt };
}

function extractOrderRows(envelope) {
  return envelope && envelope.data && Array.isArray(envelope.data.rows) ? envelope.data.rows : [];
}

function render주문내역(envelope) {
  const lines = extractOrderRows(envelope).map(buildOrderLine).filter(Boolean);
  if (!lines.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'card-kit-order-list';
  for (const line of lines) {
    const badge = line.status
      // resolveStatusTone(status, toneTable)은 table[status]로 정확 일치 조회한다 —
      // 원문 열거값을 몰라도 "이번 값 자기 자신"을 키로 넣어 classifyOrderStatus의
      // 부분 문자열 판정 결과를 그 값에만 매핑한다(다른 값이 오면 항상 flat).
      ? StatusPill({ status: line.status, toneTable: { [line.status]: classifyOrderStatus(line.status) } })
      : undefined;
    wrap.appendChild(TwoLineRow({ title: line.title, titleSub: line.titleSub, badge }));
  }
  return wrap;
}

const __exports = { classifyOrderStatus, formatOrderTime, buildOrderLine, render주문내역 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('주문내역', render주문내역);
}

})();
