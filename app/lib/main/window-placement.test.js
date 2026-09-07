'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeShellPlacement, clampCenterToWorkArea } = require('./window-placement');

// 옛 부팅 설계 치수 — 순수 함수 배치 산수를 재는 고정 입력이다(현 main.js DESIGN과는 무관).
const DIMS = { width: 1520, height: 760 };

test('computeShellPlacement: left — 왼쪽 절반의 중앙에 셸 창을 놓는다', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computeShellPlacement('left', workArea, DIMS);
  // 왼쪽 절반 폭 1920, 창 폭 1520 -> 중앙 오프셋 (1920-1520)/2 = 200
  assert.equal(p.bounds.x, 200);
  assert.equal(p.bounds.width, 1520);
  assert.equal(p.bounds.height, 760);
});

test('computeShellPlacement: right — 오른쪽 절반의 중앙에 셸 창을 놓는다', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computeShellPlacement('right', workArea, DIMS);
  // 오른쪽 절반 시작 x=1920, 폭 1920, 중앙 오프셋 200 -> x = 2120
  assert.equal(p.bounds.x, 2120);
});

test('computeShellPlacement: dir이 left/right가 아니면 워크에어리어 전체의 중앙이다', () => {
  const workArea = { x: 0, y: 0, width: 2560, height: 1440 };
  const p = computeShellPlacement('center', workArea, DIMS);
  assert.equal(p.bounds.x, Math.round((2560 - 1520) / 2));
  assert.equal(p.bounds.y, Math.round((1440 - 760) / 2));
});

test('computeShellPlacement: 세로는 창 높이 기준으로 워크에어리어 중앙에 놓는다', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computeShellPlacement('left', workArea, DIMS);
  assert.equal(p.bounds.y, Math.round((2160 - 760) / 2)); // 700
});

test('computeShellPlacement: 절반 폭 < 창 폭이면 그 절반 중앙에 겹쳐 배치된다(음수 오프셋 허용)', () => {
  const workArea = { x: 0, y: 0, width: 2000, height: 1200 }; // 절반=1000 < 창 폭 1520
  const p = computeShellPlacement('left', workArea, DIMS);
  // (1000-1520)/2 = -260 — 음수, 별도 분기 없이 자연히 겹쳐 배치된다
  assert.equal(p.bounds.x, -260);
});

test('computeShellPlacement: 멀티 모니터 — workArea.x가 0이 아니어도 그 오프셋 기준으로 계산한다', () => {
  const workArea = { x: 3840, y: 0, width: 1920, height: 1080 }; // 두 번째 모니터
  const p = computeShellPlacement('right', workArea, DIMS);
  // 오른쪽 절반: regionWidth=960, regionX=3840+1920-960=4800, 중앙오프셋(960-1520)/2=-280
  assert.equal(p.bounds.x, 4520);
});

test('computeShellPlacement: 크기는 항상 dims 그대로 — 위치만 바뀐다(불변 계약)', () => {
  const workArea = { x: 0, y: 0, width: 2560, height: 1440 };
  // 사용자가 리사이즈한 크기로 스냅해도 그 크기가 유지돼야 한다.
  const resized = { width: 1100, height: 900 };
  for (const dir of ['left', 'right', 'center']) {
    for (const dims of [DIMS, resized]) {
      const p = computeShellPlacement(dir, workArea, dims);
      assert.equal(p.bounds.width, dims.width);
      assert.equal(p.bounds.height, dims.height);
    }
  }
});

test('computeShellPlacement: y는 워크에어리어 상단(workArea.y) 아래로 내려가지 않는다', () => {
  const workArea = { x: 0, y: 40, width: 3840, height: 500 }; // 창 높이(760)보다 작은 화면
  const p = computeShellPlacement('left', workArea, DIMS);
  assert.equal(p.bounds.y, workArea.y);
});

test('computeShellPlacement: 반환값에 짝 배치의 잔재가 없다(회귀 가드)', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computeShellPlacement('left', workArea, DIMS);
  assert.deepEqual(Object.keys(p), ['bounds']);
  assert.deepEqual(Object.keys(p.bounds).sort(), ['height', 'width', 'x', 'y']);
});

// ── clampCenterToWorkArea — 오브 드래그 클램프(2026-08-27 병합 점검 K4 결정) ──
// 접힌 오브 76×76 기준. 규칙은 하나 — 창 **중심**이 workArea 밖으로 못 나간다.
const ORB = { width: 76, height: 76 };
const WA = { x: 0, y: 0, width: 1920, height: 1040 };

test('clampCenterToWorkArea: 안쪽 이동은 손대지 않는다', () => {
  const p = clampCenterToWorkArea({ x: 500, y: 300, ...ORB }, WA);
  assert.deepEqual(p, { x: 500, y: 300 });
});

test('clampCenterToWorkArea: 왼쪽·위로 벗어나면 중심이 경계에 걸리는 자리까지만 간다', () => {
  const p = clampCenterToWorkArea({ x: -5000, y: -5000, ...ORB }, WA);
  // 중심 = x + 38이 workArea 왼끝(0)에 걸리는 x = -38 — 절반은 항상 보인다.
  assert.deepEqual(p, { x: -38, y: -38 });
});

test('clampCenterToWorkArea: 오른쪽·아래도 같은 규칙이다', () => {
  const p = clampCenterToWorkArea({ x: 99999, y: 99999, ...ORB }, WA);
  assert.deepEqual(p, { x: 1920 - 38, y: 1040 - 38 });
});

test('clampCenterToWorkArea: 음수 원점 모니터(왼쪽 보조)의 workArea 오프셋을 그대로 따른다', () => {
  const wa = { x: -1920, y: 0, width: 1920, height: 1080 };
  const inside = clampCenterToWorkArea({ x: -1000, y: 200, ...ORB }, wa);
  assert.deepEqual(inside, { x: -1000, y: 200 });
  const out = clampCenterToWorkArea({ x: -9999, y: 200, ...ORB }, wa);
  assert.equal(out.x, -1920 - 38);
});

test('clampCenterToWorkArea: 펼침 크기(400×640)도 같은 중심 규칙 — 크기만 다르다', () => {
  const p = clampCenterToWorkArea({ x: 99999, y: 0, width: 400, height: 640 }, WA);
  assert.equal(p.x, 1920 - 200);
});
