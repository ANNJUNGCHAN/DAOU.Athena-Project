// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
'use strict';

// 매물대(가격대별거래량) 순수 계산 — plan/chart-card-control-spec.md §4 (AITS chart-volume-profile.ts 실측 계약).
// 배분은 종가 기준 단순 배분이다: 각 봉의 거래량 전량을 그 봉 종가가 속한 버킷에 합산.
// 고저 균등배분이 아님 — AITS 방식 그대로가 1판 기본 (spec §10).

const VOLUME_PROFILE_BUCKETS = 24;

// rows: [{ high, low, close, volume }] — 적재된 캔들 전체.
// 반환: { buckets: [{ low, high, volume }], pocIndex }
//  - 빈 rows 또는 bucketCount<=0 → 빈 프로파일 { buckets: [], pocIndex: -1 }
//  - 가격범위 0(전 봉 동일가) → 단일 버킷
//  - 종가 == 전체 최고가 → 마지막 버킷 귀속
//  - POC 동률 → 최저가 쪽(먼저 등장한 버킷) 유지
function volumeProfile(rows, bucketCount = VOLUME_PROFILE_BUCKETS) {
  if (!Array.isArray(rows) || rows.length === 0 || bucketCount <= 0) {
    return { buckets: [], pocIndex: -1 };
  }

  let priceLow = Infinity;
  let priceHigh = -Infinity;
  for (const r of rows) {
    if (r.low < priceLow) priceLow = r.low;
    if (r.high > priceHigh) priceHigh = r.high;
  }

  if (!(priceHigh > priceLow)) {
    // 가격범위 0 — 단일 버킷에 전량
    let total = 0;
    for (const r of rows) total += r.volume || 0;
    return { buckets: [{ low: priceLow, high: priceHigh, volume: total }], pocIndex: 0 };
  }

  const span = priceHigh - priceLow;
  const buckets = [];
  for (let i = 0; i < bucketCount; i += 1) {
    buckets.push({
      low: priceLow + (span * i) / bucketCount,
      high: priceLow + (span * (i + 1)) / bucketCount,
      volume: 0,
    });
  }

  for (const r of rows) {
    let idx = Math.floor(((r.close - priceLow) / span) * bucketCount);
    if (idx >= bucketCount) idx = bucketCount - 1; // 종가 == priceHigh → 마지막 버킷
    if (idx < 0) idx = 0;
    buckets[idx].volume += r.volume || 0;
  }

  let pocIndex = 0;
  for (let i = 1; i < bucketCount; i += 1) {
    // 동률이면 교체하지 않는다 — 최저가 쪽(먼저 등장) 유지
    if (buckets[i].volume > buckets[pocIndex].volume) pocIndex = i;
  }

  return { buckets, pocIndex };
}

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
const __exports = { volumeProfile, VOLUME_PROFILE_BUCKETS };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ChartVolumeProfile = __exports;
}

})();
