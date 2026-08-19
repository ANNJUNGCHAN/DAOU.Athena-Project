// backdrop-luma.js 단위 테스트 — 휘도 계산·매핑·스무딩·좌표 변환.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BRIGHT_ALPHA,
  createBrightnessStepper,
  computeAverageLuminance,
  lumaToBrightness,
  brightnessToAlpha,
  smooth,
  scaleRect,
} = require('./backdrop-luma');

// BGRA 단색 버퍼 생성 헬퍼
function solidBuffer(width, height, b, g, r) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = b;
    buf[i * 4 + 1] = g;
    buf[i * 4 + 2] = r;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

test('computeAverageLuminance: 흰색 화면은 ~255', () => {
  const luma = computeAverageLuminance(solidBuffer(8, 8, 255, 255, 255), 8, 8);
  assert.ok(Math.abs(luma - 255) < 1, `expected ~255, got ${luma}`);
});

test('computeAverageLuminance: 검은 화면은 0', () => {
  assert.equal(computeAverageLuminance(solidBuffer(8, 8, 0, 0, 0), 8, 8), 0);
});

test('computeAverageLuminance: 제외 영역을 빼고 계산한다', () => {
  // 좌반 흰색(0..3), 우반 검정(4..7) — 우반을 제외하면 흰색만 남는다
  const w = 8; const h = 8;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x < 4 ? 255 : 0;
      const i = (y * w + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 255;
    }
  }
  const luma = computeAverageLuminance(buf, w, h, [{ x: 4, y: 0, width: 4, height: 8 }]);
  assert.ok(Math.abs(luma - 255) < 1, `expected ~255 after excluding dark half, got ${luma}`);
});

test('computeAverageLuminance: 전 픽셀 제외면 null(판정 불가)', () => {
  const luma = computeAverageLuminance(solidBuffer(4, 4, 10, 10, 10), 4, 4, [{ x: 0, y: 0, width: 4, height: 4 }]);
  assert.equal(luma, null);
});

test('computeAverageLuminance: 버퍼가 없거나 짧으면 null', () => {
  assert.equal(computeAverageLuminance(null, 4, 4), null);
  assert.equal(computeAverageLuminance(Buffer.alloc(3), 4, 4), null);
});

test('lumaToBrightness: 임계 아래 0 · 위 1 · 사이 선형', () => {
  assert.equal(lumaToBrightness(0), 0);
  assert.equal(lumaToBrightness(60), 0);
  assert.equal(lumaToBrightness(180), 1);
  assert.equal(lumaToBrightness(255), 1);
  assert.ok(Math.abs(lumaToBrightness(120) - 0.5) < 1e-9);
  assert.equal(lumaToBrightness(NaN), 0); // 판정 불가 — 어두운 쪽 폴백(사다리 기본값)
});

test('brightnessToAlpha: b=0이면 사다리 기본값, b=1이면 0.72', () => {
  assert.equal(brightnessToAlpha(0, 0.30), 0.30);
  assert.equal(brightnessToAlpha(1, 0.30), BRIGHT_ALPHA);
  assert.equal(brightnessToAlpha(1, 0.50), BRIGHT_ALPHA);
  // 중간값 단조 증가
  const mid = brightnessToAlpha(0.5, 0.30);
  assert.ok(mid > 0.30 && mid < BRIGHT_ALPHA);
  // 범위 밖 b는 클램프
  assert.equal(brightnessToAlpha(-1, 0.30), 0.30);
  assert.equal(brightnessToAlpha(2, 0.30), BRIGHT_ALPHA);
});

test('smooth: 이전 값이 없으면 새 값 그대로, 있으면 EMA', () => {
  assert.equal(smooth(null, 100), 100);
  assert.equal(smooth(NaN, 100), 100);
  assert.equal(smooth(0, 100, 0.35), 35);
  assert.equal(smooth(100, 100), 100);
});

test('scaleRect: 창 영역을 보수적으로(넉넉히) 썸네일 좌표로 변환', () => {
  const r = scaleRect({ x: 100, y: 50, width: 300, height: 200 }, 0.1, 0.1);
  assert.deepEqual(r, { x: 10, y: 5, width: 30, height: 20 });
  // 반올림 경계 — floor(x)·ceil(size)라 원 영역을 절대 덜 덮지 않는다
  const r2 = scaleRect({ x: 15, y: 15, width: 15, height: 15 }, 0.1, 0.1);
  assert.deepEqual(r2, { x: 1, y: 1, width: 2, height: 2 });
});

// ---------- 계단화 + 체류 (2026-08-19 "투명도가 막 바뀐다" 수정) ----------

test('계단화: 첫 관측은 즉시 채택, 다른 계단은 dwell 연속일 때만 전환', () => {
  const step = createBrightnessStepper({ dwell: 3 });
  assert.equal(step(0.1), 0);
  assert.equal(step(0.9), 0); // 1회 — 유지
  assert.equal(step(0.9), 0); // 2회 — 유지
  assert.equal(step(0.9), 1); // 3연속 — 전환
});

test('계단화: 경계 교대는 체류 리셋 — 현 계단에 머문다(숨쉬기 방지의 핵심)', () => {
  const step = createBrightnessStepper({ dwell: 3 });
  step(0.1);
  assert.equal(step(0.9), 0);
  assert.equal(step(0.1), 0);
  assert.equal(step(0.9), 0);
  assert.equal(step(0.1), 0);
  assert.equal(step(0.9), 0); // 교대가 계속되는 한 영원히 0
});

test('계단화: 같은 계단 안의 연속 변화(0.3→0.6 경계 미만 흔들림)는 전환 없음', () => {
  const step = createBrightnessStepper({ dwell: 2 });
  assert.equal(step(0.3), 0.5);
  assert.equal(step(0.6), 0.5);
  assert.equal(step(0.4), 0.5);
});

test('계단화: 중간 계단(0.5)에서 밝음(1)으로도 같은 규칙', () => {
  const step = createBrightnessStepper({ dwell: 2 });
  assert.equal(step(0.5), 0.5);
  assert.equal(step(0.9), 0.5); // 1회
  assert.equal(step(0.9), 1);   // 2연속 — 전환
});
