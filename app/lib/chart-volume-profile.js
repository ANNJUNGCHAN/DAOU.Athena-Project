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

module.exports = { volumeProfile, VOLUME_PROFILE_BUCKETS };
