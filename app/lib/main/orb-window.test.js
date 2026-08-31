// orb-window.js 단위 테스트 — 순수 함수, Electron 없이 `node --test`로 돈다.
// window-placement.test.js와 같은 원칙: 좌표 수학만 본다. 실제 setBounds 왕복·DPI
// 반올림 실측은 GUI 검증(npm run verify)이 담당한다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ORB_SIZE,
  EXPANDED_WIDTH,
  EXPANDED_HEIGHT,
  EXPANDED_HEIGHT_MAX,
  computeOrbPlacement,
  computeExpandedBounds,
  computeCollapsedBounds,
  buildOrbWindowOptions,
  applyOrbBounds,
  shouldShowOrbForShell,
  syncOrbVisibility,
} = require('./orb-window');

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };

test('ORB_SIZE는 76이다 — GLOSSARY §1이 못박은 수치', () => {
  assert.equal(ORB_SIZE, 76);
});

test('computeOrbPlacement: 워크에어리어 우하단 구석에 여백을 두고 놓는다', () => {
  const b = computeOrbPlacement(WORK_AREA);
  assert.equal(b.width, 76);
  assert.equal(b.height, 76);
  assert.equal(b.x, 1920 - 76 - 24);
  assert.equal(b.y, 1080 - 76 - 24);
});

test('computeOrbPlacement: 멀티 모니터 — workArea 오프셋을 기준으로 계산한다', () => {
  const b = computeOrbPlacement({ x: 1920, y: 40, width: 1280, height: 1000 });
  assert.equal(b.x, 1920 + 1280 - 76 - 24);
  assert.equal(b.y, 40 + 1000 - 76 - 24);
});

test('computeExpandedBounds: 우하단 오브는 좌상 방향으로 자란다(anchor bottom-right)', () => {
  const orb = computeOrbPlacement(WORK_AREA);
  const { bounds, anchor } = computeExpandedBounds(orb, WORK_AREA);
  assert.equal(anchor, 'bottom-right');
  assert.equal(bounds.width, EXPANDED_WIDTH);
  assert.equal(bounds.height, EXPANDED_HEIGHT);
  // 오브 원의 오른쪽 아래 모서리가 그대로 있어야 한다 — 원은 화면에서 안 움직인다.
  assert.equal(bounds.x + bounds.width, orb.x + ORB_SIZE);
  assert.equal(bounds.y + bounds.height, orb.y + ORB_SIZE);
});

test('computeExpandedBounds: board-33 — height를 상한(640)까지 올려도 얼굴 모서리는 안 움직인다', () => {
  // 콘텐츠가 길어져 패널이 400에서 640까지 자라는 경우다. 오브 원의 반대쪽
  // 모서리(anchor 쪽)는 높이가 얼마든 고정이어야 한다 — 패널만 자란다.
  const orb = computeOrbPlacement(WORK_AREA);
  const grown = computeExpandedBounds(orb, WORK_AREA, { height: EXPANDED_HEIGHT_MAX });
  assert.equal(grown.bounds.height, EXPANDED_HEIGHT_MAX);
  assert.equal(grown.bounds.x + grown.bounds.width, orb.x + ORB_SIZE);
  assert.equal(grown.bounds.y + grown.bounds.height, orb.y + ORB_SIZE);
  // 640에서 접으면 400에서 접었을 때와 같은 자리로 돌아와야 한다(왕복 불변).
  const collapsedFromMax = computeCollapsedBounds(grown.bounds, grown.anchor);
  assert.deepEqual(collapsedFromMax, orb);
});

test('computeExpandedBounds: 좌상단 오브는 우하 방향으로 자란다(anchor top-left)', () => {
  const orb = { x: 30, y: 30, width: ORB_SIZE, height: ORB_SIZE };
  const { bounds, anchor } = computeExpandedBounds(orb, WORK_AREA);
  assert.equal(anchor, 'top-left');
  assert.equal(bounds.x, 30);
  assert.equal(bounds.y, 30);
});

test('computeExpandedBounds: 사분면마다 anchor가 다르다(네 방향 전부)', () => {
  const cases = [
    [{ x: 30, y: 30 }, 'top-left'],
    [{ x: 1800, y: 30 }, 'top-right'],
    [{ x: 30, y: 980 }, 'bottom-left'],
    [{ x: 1800, y: 980 }, 'bottom-right'],
  ];
  for (const [pos, expected] of cases) {
    const orb = { ...pos, width: ORB_SIZE, height: ORB_SIZE };
    assert.equal(computeExpandedBounds(orb, WORK_AREA).anchor, expected, JSON.stringify(pos));
  }
});

test('펼침→접힘 왕복은 오브를 원래 자리로 되돌린다(네 사분면 전부)', () => {
  // 이게 깨지면 펼쳤다 접을 때마다 오브가 화면을 조금씩 기어간다 — 사용자가
  // 놓아둔 자리를 앱이 야금야금 옮기는 종류의 결함이라 눈에 잘 안 띈다.
  for (const pos of [{ x: 30, y: 30 }, { x: 1800, y: 30 }, { x: 30, y: 980 }, { x: 1800, y: 980 }]) {
    const orb = { ...pos, width: ORB_SIZE, height: ORB_SIZE };
    const { bounds, anchor } = computeExpandedBounds(orb, WORK_AREA);
    assert.deepEqual(computeCollapsedBounds(bounds, anchor), orb, JSON.stringify(pos));
  }
});

test('펼침→접힘 왕복은 여러 번 반복해도 표류하지 않는다', () => {
  let orb = computeOrbPlacement(WORK_AREA);
  const origin = { ...orb };
  for (let i = 0; i < 20; i += 1) {
    const { bounds, anchor } = computeExpandedBounds(orb, WORK_AREA);
    orb = computeCollapsedBounds(bounds, anchor);
  }
  assert.deepEqual(orb, origin);
});

test('buildOrbWindowOptions: 계약 플래그 — alwaysOnTop · 투명 · 프레임 없음 · 작업표시줄 제외', () => {
  const o = buildOrbWindowOptions({ x: 1, y: 2, width: 76, height: 76 }, 'C:/app/preload.js');
  assert.equal(o.alwaysOnTop, true);
  assert.equal(o.transparent, true);
  assert.equal(o.frame, false);
  assert.equal(o.skipTaskbar, true);
  assert.equal(o.resizable, false);
  assert.equal(o.movable, true);
  assert.equal(o.x, 1);
  assert.equal(o.width, 76);
});

test('buildOrbWindowOptions: 렌더러 격리는 셸 창과 같은 수준이다', () => {
  const o = buildOrbWindowOptions({ x: 0, y: 0, width: 76, height: 76 }, 'C:/app/preload.js');
  assert.equal(o.webPreferences.nodeIntegration, false);
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.sandbox, true);
  assert.equal(o.webPreferences.backgroundThrottling, false);
  assert.equal(o.webPreferences.preload, 'C:/app/preload.js');
});

test('applyOrbBounds: resizable을 잠깐 풀고 크기를 바꾼 뒤 되잠근다', () => {
  // Windows에서 resizable:false 창은 setBounds의 크기 변경을 무시할 수 있다
  // (WS_THICKFRAME 부재). 순서가 계약이다 — 되잠그기를 빠뜨리면 사용자가 오브를
  // 리사이즈할 수 있게 된다.
  const calls = [];
  const fake = {
    isDestroyed: () => false,
    setResizable: (v) => calls.push(['setResizable', v]),
    setBounds: (b) => calls.push(['setBounds', b]),
  };
  const target = { x: 10, y: 20, width: 360, height: 264 };
  assert.equal(applyOrbBounds(fake, target), true);
  assert.deepEqual(calls, [
    ['setResizable', true],
    ['setBounds', target],
    ['setResizable', false],
  ]);
});

test('applyOrbBounds: 파괴된/없는 창에는 아무것도 안 한다', () => {
  assert.equal(applyOrbBounds(null, { x: 0, y: 0, width: 76, height: 76 }), false);
  let touched = false;
  const destroyed = {
    isDestroyed: () => true,
    setResizable: () => { touched = true; },
    setBounds: () => { touched = true; },
  };
  assert.equal(applyOrbBounds(destroyed, { x: 0, y: 0, width: 76, height: 76 }), false);
  assert.equal(touched, false);
});

function fakeShellWindow({ visible, minimized = false, destroyed = false }) {
  return {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
  };
}

function fakeOrbWindow({ visible, destroyed = false }) {
  const calls = [];
  let currentVisible = visible;
  return {
    calls,
    isDestroyed: () => destroyed,
    isVisible: () => currentVisible,
    showInactive: () => {
      calls.push('showInactive');
      currentVisible = true;
    },
    hide: () => {
      calls.push('hide');
      currentVisible = false;
    },
  };
}

test('orb visibility: 보이는 메인창이 있으면 키우미 native 창을 숨긴다', () => {
  const shell = fakeShellWindow({ visible: true });
  const orb = fakeOrbWindow({ visible: true });

  assert.equal(shouldShowOrbForShell(shell), false);
  assert.equal(syncOrbVisibility(shell, orb), false);
  assert.deepEqual(orb.calls, ['hide']);
});

test('orb visibility: 닫기-백그라운드로 숨은 메인창이면 키우미를 표시한다', () => {
  const shell = fakeShellWindow({ visible: false });
  const orb = fakeOrbWindow({ visible: false });

  assert.equal(shouldShowOrbForShell(shell), true);
  assert.equal(syncOrbVisibility(shell, orb), true);
  assert.deepEqual(orb.calls, ['showInactive']);
});

test('orb visibility: 최소화된 메인창도 눈에 보이지 않는 상태라 키우미를 표시한다', () => {
  const shell = fakeShellWindow({ visible: false, minimized: true });
  const orb = fakeOrbWindow({ visible: false });

  assert.equal(shouldShowOrbForShell(shell), true);
  assert.equal(syncOrbVisibility(shell, orb), true);
  assert.deepEqual(orb.calls, ['showInactive']);
});

test('orb visibility: 이미 원하는 상태면 show/hide를 중복 호출하지 않는다', () => {
  const visibleShell = fakeShellWindow({ visible: true });
  const hiddenShell = fakeShellWindow({ visible: false });
  const hiddenOrb = fakeOrbWindow({ visible: false });
  const visibleOrb = fakeOrbWindow({ visible: true });

  assert.equal(syncOrbVisibility(visibleShell, hiddenOrb), false);
  assert.equal(syncOrbVisibility(hiddenShell, visibleOrb), true);
  assert.deepEqual(hiddenOrb.calls, []);
  assert.deepEqual(visibleOrb.calls, []);
});

test('orb visibility: 앱 종료 중 파괴된 창에는 키우미를 다시 표시하지 않는다', () => {
  const destroyedShell = fakeShellWindow({ visible: false, destroyed: true });
  const visibleOrb = fakeOrbWindow({ visible: true });
  const destroyedOrb = fakeOrbWindow({ visible: false, destroyed: true });

  assert.equal(shouldShowOrbForShell(destroyedShell), false);
  assert.equal(syncOrbVisibility(destroyedShell, visibleOrb), false);
  assert.deepEqual(visibleOrb.calls, ['hide']);
  assert.equal(syncOrbVisibility(fakeShellWindow({ visible: false }), destroyedOrb), false);
  assert.deepEqual(destroyedOrb.calls, []);
});
