// window-placement.js 단위 테스트 — 순수 함수, Electron 없이 `node --test`로 돈다.
// 워크에어리어를 손으로 목킹해 좌표 계산만 검증한다(실제 BrowserWindow.setBounds
// 왕복·DPI 반올림 실측은 GUI 검증(app/README.md)이 담당 — 여기선 수학만 본다).
//
// 2026-08-24 Codex형 전환(리프 1.2.1): 짝 배치 테스트 10건을 셸 창 단일 배치로
// 재정의했다. 사라진 계약 3건(대화 창의 캔버스 폭 중앙 정렬 · 짝 높이 기준 세로
// 중앙 · 확장 높이의 하단 앵커)은 창이 하나가 되면서 존재 자체가 없어졌다 —
// 옛 테스트를 주석 처리해 남기지 않고 지웠다. 남은 계약(구간 중앙 · 음수 오프셋
// 허용 · 크기 불변 · 멀티모니터 오프셋 · workArea.y 하한)은 그대로 잰다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeShellPlacement } = require('./window-placement');

// 부팅 설계 치수(main.js DESIGN) 그대로 — 중앙 캔버스 1120 + 우측 채팅 400 = 1520.
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
