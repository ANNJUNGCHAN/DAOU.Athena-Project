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

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// 세분값(분:1/3/5/10/30, 틱:1/5/10)마다 하루를 몇 조각으로 쪼갤지 — 세분이
// 작을수록(더 촘촘한 주기일수록) 조각을 더 낸다. 실제 장중 분·틱 개수를
// 흉내내지 않는다 — 순서만 그럴듯한 목업이다.
const SEGMENTS_BY_INTERVAL = {
  minute: { 1: 30, 3: 12, 5: 8, 10: 4, 30: 2 },
  tick: { 1: 20, 5: 8, 10: 4 },
};

// bars: 일봉 배열. kind: 'minute'|'tick'. interval: 세분값.
// 반환: 일봉 개수 × segments개의 의사 봉 배열, time은 'YYYY-MM-DDTHH' 형식
// 문자열(같은 날 안에서 순서만 보장 — 실제 장중 시각이 아니다).
function pseudoIntraday(bars, kind, interval) {
  const list = Array.isArray(bars) ? bars : [];
  if (!list.length) return [];
  const table = SEGMENTS_BY_INTERVAL[kind] || SEGMENTS_BY_INTERVAL.minute;
  const segments = table[interval] || table[1];

  const out = [];
  for (const b of list) {
    if (!b || b.time == null) continue;
    const open = Number(b.open);
    const high = Number(b.high);
    const low = Number(b.low);
    const close = Number(b.close);
    const volume = Number(b.volume) || 0;
    const span = high - low;
    const rng = mulberry32(hashSeed(`${b.time}|${kind}|${interval}`));

    let prevClose = open;
    for (let i = 0; i < segments; i += 1) {
      const isLast = i === segments - 1;
      const segClose = isLast ? close : low + rng() * span;
      const segHigh = Math.max(prevClose, segClose) + rng() * span * 0.05;
      const segLow = Math.min(prevClose, segClose) - rng() * span * 0.05;
      out.push({
        time: `${b.time}T${String(i).padStart(2, '0')}`,
        open: prevClose,
        high: Math.min(high, Math.max(segHigh, Math.max(prevClose, segClose))),
        low: Math.max(low, Math.min(segLow, Math.min(prevClose, segClose))),
        close: segClose,
        volume: Math.round(volume / segments),
      });
      prevClose = segClose;
    }
  }
  return out;
}

// 주기 탭 하나의 통합 진입점 — chart-card.js가 이것만 부르면 된다.
// period: 'D'|'W'|'M'|'Y'|'MIN'|'TICK'. interval: 분/틱일 때만 의미 있음.
// 반환: { bars, mock } — mock=true면 "목업 재샘플" 표기가 필요한 결과다.
function resample(dailyBars, period, interval) {
  if (period === 'MIN') return { bars: pseudoIntraday(dailyBars, 'minute', interval || 1), mock: true };
  if (period === 'TICK') return { bars: pseudoIntraday(dailyBars, 'tick', interval || 1), mock: true };
  if (period === 'W' || period === 'M' || period === 'Y') return { bars: aggregatePeriod(dailyBars, period), mock: false };
  return { bars: Array.isArray(dailyBars) ? dailyBars.slice() : [], mock: false };
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { aggregatePeriod, pseudoIntraday, resample, mondayOf, periodKey };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartResample = __exports;
}

})();
