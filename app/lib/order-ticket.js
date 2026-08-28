// IIFE 스코프 격리 — canvas-layout.js와 같은 UMD 패턴.
(function () {
'use strict';

// 발화 이벤트 → 티켓 프리필. AI가 채우는 것은 값(종목·발화 시점 관측값)과
// 사유까지다 — 방향·수량은 사람이 티켓에서 정한다(자동 주문 제안 아님).
function buildPrefill(event) {
  if (!event || event.type !== 'routine-fired') return null;
  return {
    symbol: event.symbol,
    firedAt: event.fired_at || null,
    observed: event.observed,
    mode: event.mode,
    reason: `루틴 '${event.note || event.routine_id}' ${event.fired_at ? '발화' : ''}`.trim(),
  };
}

// Selector one-shot 응답 → 사람 확인용 주문 티켓 프리필.
// 현금 주식 시장가 매수/매도만 1차 범위로 허용하며 실행 능력은 전혀 없다.
function buildSelectorOrderPrefill(payload) {
  if (!payload || payload.status !== 'guarded') return null;
  const side = payload.operation_ref === 'base:kt10000' ? 'buy'
    : payload.operation_ref === 'base:kt10001' ? 'sell' : null;
  if (!side) return null;

  const draft = payload.order_draft;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  if (draft.side != null && draft.side !== side) return null;
  if (draft.dmst_stex_tp !== 'KRX' || String(draft.trde_tp) !== '3') return null;
  if (typeof draft.stk_cd !== 'string' || !/^\d{6}$/.test(draft.stk_cd)) return null;

  const qtyText = typeof draft.ord_qty === 'number'
    ? String(draft.ord_qty) : draft.ord_qty;
  if (typeof qtyText !== 'string' || !/^[1-9]\d*$/.test(qtyText)) return null;
  const qty = Number(qtyText);
  if (!Number.isSafeInteger(qty) || qty > 100000) return null;

  return {
    symbol: draft.stk_cd,
    side,
    qty,
    orderType: 'market',
    reason: `시장가 ${side === 'buy' ? '매수' : '매도'} 주문 초안 — 실행 전 내용을 확인하세요`,
  };
}

// 게이트 사전 판정 — 비활성이면 실행 버튼을 잠그고 사유를 보여준다(정직 고지).
function gateBlocker(accountInfo) {
  if (!accountInfo) return '계좌 정보를 확인할 수 없다 — 백엔드 기동을 확인해 달라';
  if (!accountInfo.orderApi) {
    return '주문 API 비활성 — 설정 → 계좌에서 활성화해야 실행할 수 있다 (모의계좌 전용)';
  }
  return null;
}

// 매수 kt10000 / 매도 kt10001 — generated/models.py 실측 필드만 쓴다.
function buildOrderPayload(ticket) {
  if (!/^\d{6}$/.test(ticket.symbol || '')) throw new Error('종목코드가 유효하지 않다');
  const qty = Number(ticket.qty);
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100000) {
    throw new Error('수량은 1~100,000 사이 정수여야 한다');
  }
  if (ticket.side !== 'buy' && ticket.side !== 'sell') {
    throw new Error('방향(매수/매도)을 선택해야 한다');
  }
  return {
    tr_id: ticket.side === 'buy' ? 'kt10000' : 'kt10001',
    body: {
      dmst_stex_tp: 'KRX',
      stk_cd: ticket.symbol,
      ord_qty: String(qty),
      trde_tp: '3', // 시장가 — P4 1차 범위(지정가는 후속)
    },
  };
}

// HTTP 상태 → 티켓 상태. 409(멱등 충돌/IN_DOUBT)는 재전송 금지 상태다.
function interpretExecuteStatus(status) {
  if (status >= 200 && status < 300) return 'done';
  if (status === 409) return 'in_doubt';
  if (status === 428) return 'needs_confirm';
  return 'failed';
}

// 상태기계: review → executing → done | in_doubt | failed.
// in_doubt/done은 종결 — 같은 티켓으로 재실행 불가(1회용, 중복 주문 방지).
function createTicket(prefill) {
  const side = prefill && (prefill.side === 'buy' || prefill.side === 'sell')
    ? prefill.side : null;
  const qty = prefill && Number.isInteger(prefill.qty)
    && prefill.qty > 0 && prefill.qty <= 100000 ? prefill.qty : null;
  return { state: 'review', prefill, side, qty, result: null };
}

const _TRANSITIONS = {
  review: ['executing'],
  executing: ['done', 'in_doubt', 'failed'],
  failed: ['executing'], // 명시적 재시도는 사람이 새로 누른 경우만(새 멱등키)
  done: [],
  in_doubt: [],
};

function transition(ticket, next) {
  const allowed = _TRANSITIONS[ticket.state] || [];
  if (!allowed.includes(next)) {
    throw new Error(`티켓 전이 불가: ${ticket.state} → ${next}`);
  }
  ticket.state = next;
  return ticket;
}

function newIdempotencyKey(randomFn) {
  const rand = randomFn || Math.random;
  return `ticket-${Date.now().toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

const __exports = {
  buildPrefill,
  buildSelectorOrderPrefill,
  gateBlocker,
  buildOrderPayload,
  interpretExecuteStatus,
  createTicket,
  transition,
  newIdempotencyKey,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.OrderTicket = __exports;
}

})();
