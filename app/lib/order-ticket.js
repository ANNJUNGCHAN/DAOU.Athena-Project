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
    reason: `시장가 ${side === 'buy' ? '구매' : '판매'} 주문 초안 — 실행 전 내용을 확인하세요`,
  };
}

// 게이트 사전 판정 — 비활성이면 실행 버튼을 잠그고 사유를 보여준다(정직 고지).
function gateBlocker(accountInfo) {
  if (!accountInfo) return '계좌 정보를 확인할 수 없습니다 — 백엔드 기동을 확인해 주세요';
  if (!accountInfo.orderApi) {
    return '활성 계좌의 주문 API가 OFF입니다 — 설정 › 계좌에서 게이트를 여세요.';
  }
  return null;
}

// Paper 9F3-0 잠금 블록 — 라벨과 사유를 한 문장으로 붙이지 않는다.
function gateLockModel(blocker) {
  if (!blocker) return { locked: false, label: null, reason: null };
  return {
    locked: true,
    label: '지금은 실행할 수 없음',
    reason: String(blocker),
  };
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

// 총 주문 금액 추정 — 수량 × 발화 시점 관측값. 관측값은 집행 시점 값이 아니므로
// 라벨의 '(시장가 추정)'과 값의 '약'을 양쪽 다 남긴다. 관측값이나 수량이 없으면
// 행 자체를 만들지 않는다(0원을 지어내지 않는다).
function estimateOrderTotal(input) {
  const src = input || {};
  const qty = Number(src.qty);
  const observed = Number(src.observed);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (src.observed == null || !Number.isFinite(observed) || observed <= 0) return null;
  const total = Math.round(qty * observed);
  return {
    label: '총 주문 금액 (시장가 추정)',
    text: `약 ${String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`,
  };
}

// 가격 행 — 실행되는 것이 시장가 고정임을 각주가 아니라 값으로 드러낸다.
// 지정가는 P4 1차 범위 밖이라 눌리지 않는 세그먼트다(UI가 약속하면 거짓이 된다).
function priceRowModel() {
  return {
    segments: ['지정가', '시장가'],
    selected: '시장가',
    readout: '시장가 체결',
    limitEnabled: false,
  };
}

// Paper 1OP-0 수량 칩 — 10% · 25% · 50% · 최대. 매수여력·보유·관측가가 없으면
// 칩은 그리되 수량을 짓지 않는다(실주문 없음 · 없는 잔고를 있다고 하지 않는다).
const QTY_CHIP_FRACTIONS = Object.freeze([
  { label: '10%', fraction: 0.10 },
  { label: '25%', fraction: 0.25 },
  { label: '50%', fraction: 0.50 },
  { label: '최대', fraction: 1 },
]);

function qtyChipModel(input) {
  const src = input || {};
  const side = src.side === 'buy' || src.side === 'sell' ? src.side : null;
  const observed = Number(src.observed);
  const buyingPower = Number(src.buyingPower);
  const holdings = Number(src.holdings);
  let reason = null;
  if (!side) reason = '방향을 먼저 고르세요';
  else if (side === 'buy' && !(Number.isFinite(buyingPower) && buyingPower > 0)) {
    reason = '매수 가능 금액을 아직 모릅니다';
  } else if (side === 'sell' && !(Number.isFinite(holdings) && holdings > 0)) {
    reason = '보유 수량을 아직 모릅니다';
  } else if (side === 'buy' && !(Number.isFinite(observed) && observed > 0)) {
    reason = '관측가가 없어 수량을 계산할 수 없습니다';
  }
  return {
    unit: '주',
    chips: QTY_CHIP_FRACTIONS.map((chip) => {
      if (reason) return { label: chip.label, qty: null, enabled: false, reason };
      const raw = side === 'buy'
        ? Math.floor((buyingPower * chip.fraction) / observed)
        : Math.floor(holdings * chip.fraction);
      if (!Number.isFinite(raw) || raw < 1) {
        return { label: chip.label, qty: null, enabled: false, reason: '1주 미만입니다' };
      }
      const qty = Math.min(raw, 100000);
      return { label: chip.label, qty, enabled: true, reason: null };
    }),
  };
}

// HTTP 상태 → 티켓 상태. 409(멱등 충돌/IN_DOUBT)는 재전송 금지 상태다.
function interpretExecuteStatus(status) {
  if (status >= 200 && status < 300) return 'done';
  if (status === 409) return 'in_doubt';
  if (status === 428) return 'needs_confirm';
  return 'failed';
}

// 상태기계: review → executing → done | in_doubt | needs_confirm | failed.
// in_doubt/done은 종결 — 같은 티켓으로 재실행 불가(1회용, 중복 주문 방지).
// 428 확인 요청은 실패가 아니다 — 게이트로 돌아가 다시 누른다(OBS-030, Paper FY7-0).
function createTicket(prefill) {
  const side = prefill && (prefill.side === 'buy' || prefill.side === 'sell')
    ? prefill.side : null;
  const qty = prefill && Number.isInteger(prefill.qty)
    && prefill.qty > 0 && prefill.qty <= 100000 ? prefill.qty : null;
  return { state: 'review', prefill, side, qty, result: null };
}

const _TRANSITIONS = {
  review: ['executing'],
  executing: ['done', 'in_doubt', 'needs_confirm', 'failed'],
  failed: ['executing'], // 명시적 재시도는 사람이 새로 누른 경우만(새 멱등키)
  needs_confirm: ['executing'],
  done: [],
  in_doubt: [],
};

function ticketStateAfterExecute(outcome) {
  if (outcome === 'done' || outcome === 'in_doubt' || outcome === 'needs_confirm') return outcome;
  return 'failed';
}

function executeOutcomeCopy(outcome, res) {
  if (outcome === 'done') return '주문 접수됨 — 체결은 계좌에서 확인하세요.';
  if (outcome === 'in_doubt') {
    return '확인 중(IN_DOUBT) — 중복 방지를 위해 재전송하지 않습니다. 계좌에서 접수 여부를 확인하세요.';
  }
  if (outcome === 'needs_confirm') {
    return '확인 요청 — 조건을 확인한 뒤 주문 게이트로 돌아갑니다.';
  }
  return `실행 실패: ${(res && res.error) || 'HTTP ' + ((res && res.status) || '?')} — 재시도하려면 다시 실행을 누르세요(새 멱등키).`;
}

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
  gateLockModel,
  buildOrderPayload,
  estimateOrderTotal,
  priceRowModel,
  qtyChipModel,
  QTY_CHIP_FRACTIONS,
  interpretExecuteStatus,
  ticketStateAfterExecute,
  executeOutcomeCopy,
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
