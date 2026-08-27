// 카드 v3 확장(단계 8 확장 조사, 2026-08-27) — 시세 카드 실시간 세션 어댑터.
// aits-chart-panel.js의 sessions Map + applyRealtimeTick 패턴을 그대로 차용한다
// (패널/세션이라는 새 개념을 또 만들지 않는다). 이 모듈은 순수 로직만 갖는다 —
// document를 참조하지 않는다. DOM 갱신은 호출자(canvas.js, 캔버스 배선 확장)가
// openPanel에 넘기는 onTick 콜백이 한다. card-kind-시세.js는 순수 렌더 함수(all-
// or-nothing envelope→DOM, 재조회 없음)로 그대로 남는다 — 실시간 갱신 책임은
// 이 어댑터가 진다(차트와 동일한 책임 분리).
//
// 구독 해제 부재(확정 타협) — 서버측 0B 구독은 여기서 해제하지 않는다.
// lib/main/chart-realtime.js의 registrar에 UNREG가 아예 없다(기존 차트 카드도
// 같은 처지 — 세션이 닫혀도 서버는 계속 틱을 보내고 클라이언트가 조용히 버린다).
// closePanel은 클라이언트 쪽 세션만 지운다. 백엔드가 등록취소를 노출하면 그때
// ref-count 기반 실해제로 업그레이드한다.
(function () {
'use strict';

const __isCjs = typeof module !== 'undefined' && module.exports;

// 종목당 열린 패널(시세 카드) 여러 개를 허용한다 — panelId로 구분한다(canvas.js가
// makeCard 생애주기에 맞춰 부여). tick: main.js가 보내는 {symbol, at, price, volume,
// changeRate, accVolume}(lib/main/chart-realtime.js parseRealTick 계약 그대로).
function createQuoteRealtimePanelAdapter() {
  const panels = new Map(); // panelId -> { symbol, onTick }

  // onTick(tick)은 매칭되는 체결마다 호출된다 — 이 어댑터는 tick을 그대로 넘길 뿐
  // 4열 서식(체결가/체결량/등락률/거래량)으로 바꾸지 않는다(그 변환은 card-kind-
  // 시세.js의 순수 함수 몫 — 여기서 두 벌로 짓지 않는다).
  function openPanel(panelId, symbol, onTick) {
    if (!panelId) throw new Error('panelId가 비어 있다');
    if (!symbol) throw new Error('symbol이 비어 있다');
    if (typeof onTick !== 'function') throw new TypeError('onTick 콜백이 필요하다');
    panels.set(panelId, { symbol: String(symbol), onTick });
  }

  // 카드 소멸 훅에서 부른다 — 이 패널로는 더 이상 틱이 안 간다(서버 구독은 위 머리말
  // 참고, 안 끊는다).
  function closePanel(panelId) {
    return panels.delete(panelId);
  }

  function isOpen(panelId) {
    return panels.has(panelId);
  }

  // 체결 1건을 해당 종목의 열린 패널마다 전달한다. 종목이 안 맞거나 열린 패널이
  // 없으면(카드 소멸 후 포함) 조용히 버린다 — 여기서 카드를 새로 만들지 않는다
  // (aits-chart-panel.js applyRealtimeTick과 동일 계약).
  function applyRealtimeTick(tick) {
    if (!tick || !tick.symbol) return 0;
    let applied = 0;
    for (const panel of panels.values()) {
      if (panel.symbol !== String(tick.symbol)) continue;
      panel.onTick(tick);
      applied += 1;
    }
    return applied;
  }

  return {
    openPanel,
    closePanel,
    isOpen,
    applyRealtimeTick,
    size: () => panels.size,
  };
}

const __exports = { createQuoteRealtimePanelAdapter };
if (__isCjs) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.QuoteRealtimePanel = __exports;
}

})();
