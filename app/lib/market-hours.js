// 장중 판정(board-30⑫/31⑨ "감시가 쉬는 시간") — 순수 함수, IIFE 스코프
// 격리(routine-turn.js와 같은 UMD 패턴). Date를 인자로 받아 테스트에서 임의
// 시각을 주입할 수 있다.
//
// v1 캐비엇 — 공휴일 미반영이다(설·추석 등 휴장일도 평일이면 장중으로
// 오판한다). 거래일 캘린더 연동 시 이 파일이 교체 지점이다.
(function () {
'use strict';

const OPEN_MIN = 9 * 60;        // 09:00 개장
const CLOSE_MIN = 15 * 60 + 30; // 15:30 마감(경계 포함 — 마감 틱까지 장중으로 본다)

/** date가 KST 기준 장중(평일 09:00~15:30)인지. 시스템 로컬 타임존과
 * 무관하게 Asia/Seoul로 환산해서 본다 — 실행기(오브 창)의 OS 타임존이
 * KST가 아니면 로컬 시각만으로는 틀린다. 파싱 실패(비Date·Invalid Date)는
 * 장중이 아니다(false)로 본다. */
function isMarketOpen(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const byType = {};
  for (const p of parts) byType[p.type] = p.value;

  if (byType.weekday === 'Sat' || byType.weekday === 'Sun') return false;

  // hour12:false에서 자정을 '24'로 주는 로케일/엔진이 있어 24를 0으로 접는다.
  const hour = Number(byType.hour) % 24;
  const minute = Number(byType.minute);
  const mins = hour * 60 + minute;
  return mins >= OPEN_MIN && mins <= CLOSE_MIN;
}

const __exports = { isMarketOpen };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.MarketHours = __exports;
}

})();
