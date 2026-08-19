// window-placement.js 단위 테스트 — 순수 함수, Electron 없이 `node --test`로 돈다.
// 워크에어리어를 손으로 목킹해 좌표 계산만 검증한다(실제 BrowserWindow.setBounds
// 왕복·DPI 반올림 실측은 GUI 검증(app/README.md)이 담당 — 여기선 수학만 본다).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computePlacement } = require('./window-placement');

// 부팅 설계 치수(main.js DESIGN) 그대로 — chatHeight=chatBaseH는 "확장 안 된
// 기본 대화 창" 상태를 뜻한다. AT-CH-001R(2026-08-19): chatW 900 < canvasW 1560,
// 대화 창은 캔버스 폭의 중앙에 정렬된다(chatX = x + (1560-900)/2 = x + 330).
const DIMS = { canvasW: 1560, canvasH: 800, chatW: 900, chatBaseH: 248, chatHeight: 248 };

test('computePlacement: left — 왼쪽 절반의 중앙에 짝을 배치한다', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computePlacement('left', workArea, DIMS);
  // 왼쪽 절반 폭 1920, 짝 폭 1560 -> 중앙 오프셋 (1920-1560)/2 = 180
  assert.equal(p.canvasBounds.x, 180);
  assert.equal(p.chatBounds.x, 180 + 330); // 캔버스 폭 중앙 정렬
  assert.equal(p.canvasBounds.width, 1560);
  assert.equal(p.canvasBounds.height, 800);
});

test('computePlacement: 대화 창은 캔버스 폭의 중앙에 정렬된다(AT-CH-001R)', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  for (const dir of ['left', 'right']) {
    const p = computePlacement(dir, workArea, DIMS);
    const expected = p.canvasBounds.x + Math.round((DIMS.canvasW - DIMS.chatW) / 2);
    assert.equal(p.chatBounds.x, expected);
    assert.equal(p.chatX, expected);
  }
});

test('computePlacement: right — 오른쪽 절반의 중앙에 짝을 배치한다', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computePlacement('right', workArea, DIMS);
  // 오른쪽 절반 시작 x=1920, 폭 1920, 중앙 오프셋 180 -> x = 1920+180 = 2100
  assert.equal(p.canvasBounds.x, 2100);
});

test('computePlacement: 세로는 짝 높이(캔버스+chatBaseH) 기준으로 워크에어리어 중앙에 놓는다', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computePlacement('left', workArea, DIMS);
  // pairH = 800+248=1048, (2160-1048)/2 = 556
  assert.equal(p.canvasBounds.y, 556);
});

test('computePlacement: 절반 폭 < 창 폭이면 그 절반 중앙에 겹쳐 배치된다(음수 오프셋 허용)', () => {
  const workArea = { x: 0, y: 0, width: 2000, height: 1200 }; // 절반=1000 < 짝 폭 1560
  const p = computePlacement('left', workArea, DIMS);
  // (1000-1560)/2 = -280 — 음수, 별도 분기 없이 자연히 겹쳐 배치된다
  assert.equal(p.canvasBounds.x, -280);
});

test('computePlacement: 대화 창은 캔버스 바로 아래에 붙는다(부팅 레이아웃과 같은 간격 0)', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const p = computePlacement('left', workArea, DIMS);
  assert.equal(p.chatBounds.y, p.canvasBounds.y + p.canvasBounds.height);
});

test('computePlacement: 대화 창이 확장된 높이(chatHeight > chatBaseH)여도 하단 앵커(chatBottom)는 그대로다', () => {
  const workArea = { x: 0, y: 0, width: 3840, height: 2160 };
  const expandedDims = { ...DIMS, chatHeight: 600 }; // #settings 패널이 열려 확장된 상태
  const p = computePlacement('left', workArea, expandedDims);
  assert.equal(p.chatBottom, p.canvasBounds.y + DIMS.canvasH + DIMS.chatBaseH);
  assert.equal(p.chatBounds.y, p.chatBottom - 600); // 위로만 자란다 — 하단 고정
  assert.equal(p.chatBounds.height, 600);
});

test('computePlacement: 멀티 모니터 — workArea.x가 0이 아니어도(오른쪽 모니터) 그 오프셋 기준으로 계산한다', () => {
  const workArea = { x: 3840, y: 0, width: 1920, height: 1080 }; // 두 번째 모니터
  const p = computePlacement('right', workArea, DIMS);
  // 오른쪽 절반: regionWidth=960, regionX=3840+1920-960=4800, 중앙오프셋(960-1560)/2=-300
  assert.equal(p.canvasBounds.x, 4500);
});

test('computePlacement: 크기는 항상 dims 그대로 — 위치만 바뀐다(불변 계약)', () => {
  const workArea = { x: 0, y: 0, width: 2560, height: 1440 };
  for (const dir of ['left', 'right']) {
    const p = computePlacement(dir, workArea, DIMS);
    assert.equal(p.canvasBounds.width, DIMS.canvasW);
    assert.equal(p.canvasBounds.height, DIMS.canvasH);
    assert.equal(p.chatBounds.width, DIMS.chatW);
    assert.equal(p.chatBounds.height, DIMS.chatHeight);
  }
});

test('computePlacement: y는 워크에어리어 상단(workArea.y) 아래로 내려가지 않는다', () => {
  const workArea = { x: 0, y: 40, width: 3840, height: 500 }; // 짝 높이(1004)보다 작은 화면
  const p = computePlacement('left', workArea, DIMS);
  assert.ok(p.canvasBounds.y >= workArea.y);
});
