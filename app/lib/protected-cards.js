// IIFE 스코프 격리 — order-ticket.js/routine-turn.js와 같은 UMD 패턴.
(function () {
'use strict';

// canvas.js의 renderEventCard/renderActionCard/renderStatusCard(Paper AT-CV-005
// "protected workflow templates")는 자기 envelope을 스스로 만들지 않는다 — 지금까지
// 이 세 canvas_type을 채우는 백엔드 경로가 없어(2026-08-26 동적 추적 확인,
// .omc/state/screen-matrix.md #11 정정) 렌더러만 있고 카드는 한 번도 뜬 적이 없었다.
// 이 모듈은 앱이 이미 갖고 있는 실신호 3종(루틴 발화·인증 토큰 상태·주문 티켓
// 종결 상태) **만**으로 그 envelope을 조립한다 — 새 필드를 지어내지 않는다.
// 순수 함수만 — DOM·IPC 구독은 호출부(canvas.js/chat.js)가 한다.

function _baseEnvelope(canvasType, caption, data) {
  return {
    canvas_type: canvasType,
    fell_back: false,
    fallback_reason: null,
    caption: caption == null ? null : caption,
    data,
    layout: null,
    drop_types: [],
  };
}

// athena:routine-event('routine-fired') → event 카드. 발화가 아닌 다른 루틴
// 이벤트(만료·복원실패)는 카드로 남기지 않는다(팀리드 지시 — "발화 이벤트가
// 카드로 남는다") — null을 돌려주면 호출부가 렌더를 건너뛴다.
function buildRoutineFiredEventCard(event) {
  if (!event || event.type !== 'routine-fired') return null;
  // order-ticket.js buildPrefill()과 같은 캡션 관용구 — 새 문구를 짓지 않는다.
  const caption = `루틴 '${event.note || event.routine_id}' 발화`;
  const record = {
    종목: event.symbol,
    관측값: event.observed,
    임계값: event.threshold,
    발화시각: event.fired_at,
  };
  return {
    status: 'success',
    envelope: _baseEnvelope('event', caption, { lifecycle: 'fired', records: [record] }),
  };
}

// athena:auth-token-changed({id, state, expiresInSec}) → status 카드. state는
// computeTokenState()의 4상태(needed/ready/refreshing/expired, board 28)를 그대로
// 옮긴다. configured/ready는 그 state에서 결정적으로 유도된다(별도 신호 없음):
// needed가 아닌 나머지 세 상태는 전부 tokenExpiresAt이 있어야만 나오므로(accounts.js
// computeTokenState) "한 번은 설정돼 발급까지 갔다"는 사실을 증명한다 — needed만
// 애매하지만(설정 전 vs 미발급) 그 경우 "아니오"로 보이는 게 기존 표기 관례와도
// 맞는다. expires_at은 auth-screen.js applyState()와 같은 유도식
// (Date.now() + expiresInSec*1000)이고, expiresInSec이 0(=만료/미발급)이면 실제
// 만료 시각을 이 신호에서 복원할 수 없으니 지어내지 않고 비워 둔다('—'로 보임).
function buildAuthTokenStatusCard(payload, nowMs) {
  const state = (payload && payload.state) || 'needed';
  const expiresInSec = payload && typeof payload.expiresInSec === 'number' ? payload.expiresInSec : 0;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const data = {
    lifecycle: state,
    ready: state === 'ready',
    configured: state !== 'needed',
  };
  if (expiresInSec > 0) data.expires_at = new Date(now + expiresInSec * 1000).toISOString();
  return { status: 'success', envelope: _baseEnvelope('status', null, data) };
}

// 주문 티켓 종결 상태(order-ticket.js: done|in_doubt|needs_confirm|failed) →
// action 카드. 428 확인 요청은 실패가 아니다(OBS-030). 표시 전용 영수증이다 —
// 이 함수도, 카드도 실행 버튼을 만들지 않는다(확정 결정 3 경계).
// receipt는 outcome==='done'일 때만 채운다: athena:order-execute 핸들러
// (main.js)는 2xx에서만 파싱한 JSON 본문(data)을 돌려주고 실패 응답에는 error
// 문자열만 있다 — 없는 영수증을 지어내지 않는다.
function buildOrderActionCard({ trId, body, outcome, response }) {
  const lifecycle = outcome === 'done' ? 'done'
    : outcome === 'in_doubt' ? 'in_doubt'
    : outcome === 'needs_confirm' ? 'needs_confirm'
    : 'failed';
  const receipt = (lifecycle === 'done' && response && response.data && typeof response.data === 'object')
    ? response.data
    : {};
  const sideLabel = trId === 'kt10000' ? '매수' : trId === 'kt10001' ? '매도' : trId;
  const symbol = body && body.stk_cd;
  const caption = symbol ? `${symbol} ${sideLabel} 주문 결과` : `${sideLabel} 주문 결과`;
  const built = {
    status: 'success',
    envelope: _baseEnvelope('action', caption, {
      lifecycle,
      // 주문 API의 2xx와 주문번호는 접수 증거이며 체결 확인은 별도 조회가 필요하다.
      state_label: lifecycle === 'done' ? '주문 접수됨'
        : lifecycle === 'in_doubt' ? '확인 필요'
        : lifecycle === 'needs_confirm' ? '확인 요청'
        : '실패',
      receipt,
      order: {
        stk_cd: symbol,
        ord_qty: body && body.ord_qty,
        side: sideLabel,
      },
    }),
  };
  built.envelope.card_title = '주문';
  return built;
}

const __exports = {
  buildRoutineFiredEventCard,
  buildAuthTokenStatusCard,
  buildOrderActionCard,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ProtectedCards = __exports;
}

})();
