(function () {
'use strict';

// 실시간 체결 → 진행봉 접기. 렌더러·메인 양쪽에서 쓴다(UMD).
//
// 왜 렌더러가 접는가: "직전 봉"을 들고 있는 쪽이 렌더러다(aits-chart-panel의
// state.body.candles). 메인이 접으려면 패널마다 봉을 복제해 들고 있어야 하고,
// 재조회로 봉이 통째로 갈릴 때마다 두 벌이 어긋난다. 메인은 체결을 옮기기만 한다.

const KST_OFFSET_SEC = 9 * 3600;
const MINUTE = 60;

// slot(epoch 초) → 'YYYY-MM-DD'(KST 기준 날짜).
function isoDateOfSlot(slotSec) {
  const kst = new Date((slotSec + KST_OFFSET_SEC) * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())}`;
}

// 이 체결이 속하는 봉의 시작 시각(epoch 초). 틱은 체결 하나가 곧 봉이라 그대로다.
// 일·주·월·년은 KST 자정으로 자른다 — 주·월·년도 실시간으로는 마지막 봉의
// 종가·고저만 움직인다. 주의 시작일을 여기서 자체 계산하면 서버 집계와 어긋나므로
// 경계 확정은 주기 전환 시의 서버 재조회에 맡긴다.
function slotStartSec(at, period, interval) {
  if (!Number.isFinite(at)) return null;
  if (period === 'TICK') return at;
  if (period === 'MIN') {
    const step = Math.max(1, Number(interval) || 1) * MINUTE;
    return Math.floor(at / step) * step;
  }
  const kst = at + KST_OFFSET_SEC;
  return Math.floor(kst / 86400) * 86400 - KST_OFFSET_SEC;
}

// 직전 봉 + 체결 → {kind:'update'|'rollover', candle}.
// prevBar는 렌더러가 그리고 있는 마지막 봉이다. 없거나 슬롯이 넘어갔으면 rollover.
function foldTick(prevBar, tick, period, interval) {
  if (!tick || !Number.isFinite(Number(tick.price)) || Number(tick.price) <= 0) return null;
  const slot = slotStartSec(Number(tick.at), period, interval);
  if (slot == null) return null;
  // 일·주·월·년 봉의 time은 'YYYY-MM-DD' 문자열이다 — 같은 표현끼리 비교한다.
  const intraday = period === 'MIN' || period === 'TICK';
  const time = intraday ? slot : isoDateOfSlot(slot);
  const price = Number(tick.price);
  const volume = Number(tick.volume) || 0;
  const prev = prevBar && typeof prevBar === 'object' ? prevBar : null;
  if (!prev || prev.time !== time) {
    return {
      kind: 'rollover',
      candle: { time, open: price, high: price, low: price, close: price, volume },
    };
  }
  return {
    kind: 'update',
    candle: {
      time,
      open: Number(prev.open),
      high: Math.max(Number(prev.high), price),
      low: Math.min(Number(prev.low), price),
      close: price,
      // 진행봉 누적 — 직전 봉 위에 더한다.
      volume: (Number(prev.volume) || 0) + volume,
    },
  };
}

const __exports = { foldTick, slotStartSec, isoDateOfSlot };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartTickFold = __exports;
}

})();
