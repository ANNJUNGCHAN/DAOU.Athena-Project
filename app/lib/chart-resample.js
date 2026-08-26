// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
'use strict';


function toUtcDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

// ISO 주(월요일 시작)의 월요일 날짜 문자열을 돌려준다.
function mondayOf(dateStr) {
  const d = toUtcDate(dateStr);
  const dow = d.getUTCDay(); // 0=일 .. 6=토
  const diff = dow === 0 ? -6 : 1 - dow; // 일요일이면 6일 전 월요일
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function periodKey(dateStr, period) {
  if (period === 'W') return mondayOf(dateStr);
  if (period === 'M') return dateStr.slice(0, 7);
  if (period === 'Y') return dateStr.slice(0, 4);
  return dateStr; // 'D' — 그룹 없음(호출자가 안 쓴다)
}

// bars: [{time,open,high,low,close,volume}] 시간 오름차순 가정.
// period: 'W' | 'M' | 'Y'. 반환: 같은 형상의 집계 봉 배열.
function aggregatePeriod(bars, period) {
  const list = Array.isArray(bars) ? bars : [];
  if (!list.length) return [];
  if (period !== 'W' && period !== 'M' && period !== 'Y') return list.slice();

  const out = [];
  let group = null;
  let groupKey = null;
  for (const b of list) {
    if (!b || b.time == null) continue;
    const key = periodKey(b.time, period);
    if (key !== groupKey) {
      if (group) out.push(finalizeGroup(group));
      groupKey = key;
      group = { time: b.time, open: Number(b.open), high: Number(b.high), low: Number(b.low), close: Number(b.close), volume: 0 };
    }
    group.high = Math.max(group.high, Number(b.high));
    group.low = Math.min(group.low, Number(b.low));
    group.close = Number(b.close);
    group.volume += Number(b.volume) || 0;
  }
  if (group) out.push(finalizeGroup(group));
  return out;
}

function finalizeGroup(g) {
  return { time: g.time, open: g.open, high: g.high, low: g.low, close: g.close, volume: g.volume };
}

// 분·틱을 만들 수 없는 이유(2026-08-25). 예전엔 pseudoIntraday()가 일봉 하나를
// 결정론 시드로 30조각쯤 쪼개 의사 장중 봉을 만들었다. "실제 분포 아님" 각주를
// 달아두긴 했지만 두 가지가 걸린다:
//  ① 그 봉 위에서 지표 34종이 계산된다 — 화면엔 RSI 73, MACD 골든크로스처럼
//     판단 재료로 읽히는 숫자가 뜬다. 각주가 그걸 되돌리지 못한다(§8 정보 정직성).
//  ② 일봉 픽스처는 실제 데이터가 들어올 자리를 같은 모양으로 채워둔 것이라 TR이
//     붙으면 그대로 교체된다. 의사 분봉은 다르다 — 하루 30조각은 실제 1분봉
//     380봉과 영영 안 맞는다. 자리를 지킨 게 아니라 없는 구조를 지어낸 것이다.
// 그래서 만들지 않고 "없다"고 돌려준다. 주기 탭은 자리를 지키되 눌리지 않는다
// (chart-toolbar.js PERIOD_TABS의 unavailable). TR이 붙으면 여기만 갈아끼운다.
const INTRADAY_UNAVAILABLE = {
  MIN: '분봉 데이터가 아직 없다 — 일봉만 들어온다',
  TICK: '틱 데이터가 아직 없다 — 일봉만 들어온다',
};

// 주기 탭 하나의 통합 진입점 — chart-card.js가 이것만 부르면 된다.
// period: 'D'|'W'|'M'|'Y'|'MIN'|'TICK'. interval: 분/틱일 때만 의미 있음.
// 반환: { bars, mock, unavailable } — unavailable이 있으면 그릴 봉이 없다는
// 뜻이고, 호출자는 일봉으로 되돌리고 사유를 표시해야 한다(조용히 빈 차트 금지).
function resample(dailyBars, period, interval) {
  const daily = Array.isArray(dailyBars) ? dailyBars.slice() : [];
  if (INTRADAY_UNAVAILABLE[period]) {
    return { bars: daily, mock: false, unavailable: INTRADAY_UNAVAILABLE[period] };
  }
  if (period === 'W' || period === 'M' || period === 'Y') return { bars: aggregatePeriod(dailyBars, period), mock: false };
  return { bars: daily, mock: false };
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { aggregatePeriod, resample, mondayOf };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartResample = __exports;
}

})();
