'use strict';

// 같은 flex line에 있어도 align-items와 셀 높이가 다르면 top 좌표는 달라진다.
// 세로 구간이 실제로 겹치는 rect를 한 행으로 군집화해 열 수를 센다.
function visualRowCounts(rects, overlapTolerance = 1) {
  const candidates = (Array.isArray(rects) ? rects : [])
    .filter((rect) => rect
      && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)
      && rect.bottom > rect.top)
    .slice()
    .sort((left, right) => (left.top - right.top) || ((left.left || 0) - (right.left || 0)));
  const rows = [];

  for (const rect of candidates) {
    let matchingRow = null;
    let matchingOverlap = overlapTolerance;
    for (const row of rows) {
      const overlap = Math.min(row.bottom, rect.bottom) - Math.max(row.top, rect.top);
      if (overlap > matchingOverlap) {
        matchingRow = row;
        matchingOverlap = overlap;
      }
    }
    if (!matchingRow) {
      rows.push({ top: rect.top, bottom: rect.bottom, count: 1 });
      continue;
    }
    matchingRow.top = Math.min(matchingRow.top, rect.top);
    matchingRow.bottom = Math.max(matchingRow.bottom, rect.bottom);
    matchingRow.count += 1;
  }

  return rows.sort((left, right) => left.top - right.top).map((row) => row.count);
}

module.exports = { visualRowCounts };
