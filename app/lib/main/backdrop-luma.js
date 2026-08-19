// 휘도 감지-적응의 순수 계산부 (2026-08-19 구현 — palette.md "채택: 배경 밝기를
// 감지해 적응한다"의 실결선. 검증 보드 45가 실측으로 필요성을 증명했다: 밝은
// 배경 위에서 유리 0.30은 dim 계층 텍스트를 소실시킨다).
//
// Electron 의존 없음 — desktopCapturer 썸네일의 BGRA 버퍼를 받아 평균 휘도를
// 계산하고, 휘도→유리 두께 매핑·스무딩을 제공한다. 캡처·타이머·IPC는 main.js가
// 담당한다(이 분리 덕에 node:test로 단위 테스트된다).
//
// 값의 근거:
// - 유리 하한은 tokens.css 유리 사다리(창 0.30 / 캔버스 창 0.50)와 같아야 한다.
// - 밝은 배경 상한 0.72는 soul.md §7 "밝은 배경화면 위 ~0.70 이상"을 따른다.
// - 휘도 임계(60~180)는 보드 45 실측 배경(평균 휘도 ~200 부근에서 소실)과
//   verify 공유 데스크톱(어두운 배경 ~40 부근에서 문제 없음) 사이를 선형 보간.

'use strict';

const BRIGHT_ALPHA = 0.72; // 밝은 배경 상한 — soul.md §7 "~0.70 이상"
const LUMA_DARK = 60; // 이하면 완전히 어두운 배경으로 본다(b=0)
const LUMA_BRIGHT = 180; // 이상이면 완전히 밝은 배경으로 본다(b=1)

// BGRA 버퍼(nativeImage.toBitmap())의 평균 휘도(0~255). excludeRects(썸네일
// 좌표계) 안의 픽셀은 건너뛴다 — 화면 캡처에는 우리 창 자신도 찍히므로, 창
// 영역을 빼고 "창 밖 = 데스크톱"만 재야 배경 휘도가 된다. 전 픽셀이 제외되면
// null(판정 불가 — 호출자가 이전 값/폴백을 유지한다).
function computeAverageLuminance(buffer, width, height, excludeRects = []) {
  if (!buffer || buffer.length < width * height * 4) return null;
  let sum = 0;
  let count = 0;
  // 4픽셀 걸음 — 썸네일(수백 px)에서 정밀도 손실 없이 비용을 1/4로.
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let excluded = false;
      for (const r of excludeRects) {
        if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) { excluded = true; break; }
      }
      if (excluded) continue;
      const i = (y * width + x) * 4;
      // BGRA — Rec.709 계수
      sum += 0.0722 * buffer[i] + 0.7152 * buffer[i + 1] + 0.2126 * buffer[i + 2];
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}

// 휘도(0~255) → 밝음 정도 b(0~1). LUMA_DARK 이하 0, LUMA_BRIGHT 이상 1, 사이 선형.
function lumaToBrightness(luma) {
  if (!Number.isFinite(luma)) return 0;
  if (luma <= LUMA_DARK) return 0;
  if (luma >= LUMA_BRIGHT) return 1;
  return (luma - LUMA_DARK) / (LUMA_BRIGHT - LUMA_DARK);
}

// b(0~1) → 해당 표면의 유리 두께. 어두우면 사다리 기본값, 밝으면 0.72로 올라간다.
function brightnessToAlpha(b, baseAlpha) {
  const clamped = Math.min(1, Math.max(0, b));
  return baseAlpha + (BRIGHT_ALPHA - baseAlpha) * clamped;
}

// 지수 이동 평균 — 감지값 스무딩(palette.md: "급변은 깜빡임으로 보인다").
// k는 새 값의 비중. prev가 null이면 next를 그대로 시작점으로.
function smooth(prev, next, k = 0.35) {
  if (!Number.isFinite(prev)) return next;
  return prev + (next - prev) * k;
}

// 계단화 + 체류(2026-08-19 사용자 보고 "투명도가 막 바뀐다"): 연속 b값을 그대로
// 쓰면 배경 콘텐츠가 움직일 때마다(터미널 스크롤·영상) 유리가 2초 주기로 숨 쉬듯
// 변한다. b를 3계단(0 / 0.5 / 1)으로 양자화하고, **다른 계단이 dwell회 연속**
// 유지될 때만 전환한다 — 전환은 드물고 뚜렷하게. 경계에서 계단이 교대하면 체류
// 카운트가 리셋돼 현 계단에 머문다(히스테리시스).
function createBrightnessStepper({ dwell = 3 } = {}) {
  let current = null;
  let candidate = null;
  let count = 0;
  const stepOf = (b) => (b < 0.25 ? 0 : b < 0.75 ? 0.5 : 1);
  return function step(b) {
    const s = stepOf(b);
    if (current === null) { current = s; return current; }
    if (s === current) { candidate = null; count = 0; return current; }
    if (s === candidate) { count += 1; } else { candidate = s; count = 1; }
    if (count >= dwell) { current = s; candidate = null; count = 0; }
    return current;
  };
}

// 화면 좌표 rect → 썸네일 좌표 rect (버림/올림으로 창 영역을 보수적으로 넉넉히 제외)
function scaleRect(rect, scaleX, scaleY) {
  return {
    x: Math.floor(rect.x * scaleX),
    y: Math.floor(rect.y * scaleY),
    width: Math.ceil(rect.width * scaleX),
    height: Math.ceil(rect.height * scaleY),
  };
}

module.exports = {
  BRIGHT_ALPHA,
  LUMA_DARK,
  LUMA_BRIGHT,
  computeAverageLuminance,
  lumaToBrightness,
  brightnessToAlpha,
  smooth,
  createBrightnessStepper,
  scaleRect,
};
