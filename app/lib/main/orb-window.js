// 알림 오브 창 — 데스크톱 구석 상시 원형 창 (2026-08-24 리프 1.3.1).
//
// GLOSSARY §1: 76px 원형 · alwaysOnTop · 자유 드래그 · 클릭으로 펼침. 펼침은
// **대화체 문장 1 + 대표 카드 1 + 더보기**까지이고 **실행 버튼도 미니 입력창도 없다**
// (확정 결정 3 — 주문은 사람이 낸다, 입력 지점은 셸 창 커맨드바 하나).
//
// 이 파일은 **기하와 옵션만** 진다. Electron 의존을 얇게 유지한 이유는 셸 창의
// window-placement.js와 같다: 좌표 계산은 순수 함수로 두고 단위 테스트로 고정한다.
// createOrbWindow()만 BrowserWindow를 만지고, 그것도 주입받은 생성자를 쓴다.
'use strict';

const path = require('path');
// 창 문서 화이트리스트를 공유한다 — 오브도 임의 경로를 loadFile에 넘기지 못한다.
const { resolveWindowHtmlPath } = require('./window-readiness');

/** 접힘 상태의 지름. GLOSSARY §1이 못박은 수치 — 바꾸면 정의가 바뀐다. */
const ORB_SIZE = 76;
/** 데스크톱 구석에서 띄우는 여백. 작업 표시줄은 workArea가 이미 뺀 영역이다. */
const ORB_MARGIN = 24;
/** 펼침 패널 치수 — 대화체 문장 1 + 대표 카드 1 + 더보기가 들어가는 최소치.
 * 2026-08-24 실측 정정: 264px에서는 대표 카드 5줄 중 2줄만 보이고 나머지가 스크롤
 * 뒤로 숨었다(캡처 23-orb-expanded.png). 숫자가 안 읽히면 실패다(soul.md §8) —
 * 본문 2줄 + 카드 5줄이 스크롤 없이 들어가는 높이로 올린다.
 * 2026-08-25 재정정: 328px도 6px 모자랐다 — verify 검증22가 대표 카드를
 * scrollHeight 111 vs clientHeight 105로 재서 잘림을 잡았다. 카드가 딱 맞는
 * 높이는 회귀에 너무 예민하므로(글꼴 단 하나만 올려도 다시 잘린다) 여유 6px을
 * 얹어 340으로 올린다. */
const EXPANDED_WIDTH = 360;
const EXPANDED_HEIGHT = 340;

/**
 * 부팅 시 오브를 놓을 자리 — 워크에어리어 우하단 구석.
 * 반환값을 그대로 setBounds에 쓴다(크기까지 한 번에 — DPI 반올림 누적 방지,
 * window-placement.js 상단 주석과 같은 이유).
 */
function computeOrbPlacement(workArea, { size = ORB_SIZE, margin = ORB_MARGIN } = {}) {
  return {
    x: Math.round(workArea.x + workArea.width - size - margin),
    y: Math.round(workArea.y + workArea.height - size - margin),
    width: size,
    height: size,
  };
}

/**
 * 펼침 기하. **오브 원은 화면에서 움직이지 않는다** — 패널이 화면 안쪽으로 자란다.
 * 사용자가 오브를 어디로 끌어놨든 성립해야 하므로 성장 방향을 사분면으로 정한다:
 * 오른쪽 절반에 있으면 왼쪽으로, 아래쪽 절반에 있으면 위로 자란다.
 *
 * anchor는 **펼친 창 안에서 오브 원이 앉는 모서리**다 — 렌더러가 이 값으로
 * 원과 패널의 자리를 잡는다(orb.css의 `[data-anchor]`).
 */
function computeExpandedBounds(orbBounds, workArea, {
  width = EXPANDED_WIDTH,
  height = EXPANDED_HEIGHT,
  size = ORB_SIZE,
} = {}) {
  const centerX = orbBounds.x + size / 2;
  const centerY = orbBounds.y + size / 2;
  const onRight = centerX >= workArea.x + workArea.width / 2;
  const onBottom = centerY >= workArea.y + workArea.height / 2;

  const x = onRight ? orbBounds.x + size - width : orbBounds.x;
  const y = onBottom ? orbBounds.y + size - height : orbBounds.y;

  return {
    bounds: { x: Math.round(x), y: Math.round(y), width, height },
    anchor: `${onBottom ? 'bottom' : 'top'}-${onRight ? 'right' : 'left'}`,
  };
}

/**
 * 접힘 기하 — 펼친 창과 anchor로부터 오브 원이 있던 자리를 되돌린다.
 * computeExpandedBounds()의 역함수여야 한다(왕복 불변: expand → collapse == 원래 자리).
 * 이게 깨지면 펼쳤다 접을 때마다 오브가 화면을 조금씩 기어간다.
 */
function computeCollapsedBounds(expandedBounds, anchor, { size = ORB_SIZE } = {}) {
  const onRight = String(anchor).endsWith('right');
  const onBottom = String(anchor).startsWith('bottom');
  return {
    x: onRight ? expandedBounds.x + expandedBounds.width - size : expandedBounds.x,
    y: onBottom ? expandedBounds.y + expandedBounds.height - size : expandedBounds.y,
    width: size,
    height: size,
  };
}

/**
 * BrowserWindow 옵션. 셸 창의 commonWinOpts와 **일부러 공유하지 않는다** —
 * alwaysOnTop이 그쪽으로 새면 "다른 앱 위에 영구히 떠서 창을 내릴 수 없다"는
 * 2026-08-17 실사용 문제가 셸 창에 되살아난다. 오브만 예외다.
 */
function buildOrbWindowOptions(bounds, preloadPath) {
  return {
    ...bounds,
    frame: false,
    // 원형 창은 투명창으로만 성립한다 — 불투명 배경이면 사각 판이 남아
    // "장식용 유리"(soul.md §7 금지 목록)가 된다.
    transparent: true,
    backgroundColor: '#00000000',
    // 상시 표시가 사양이다(GLOSSARY §1). 셸 창과 달리 이건 의도된 예외다.
    alwaysOnTop: true,
    // 작업 표시줄을 차지하지 않는다 — 앱 창이 아니라 상주 표면이다.
    skipTaskbar: true,
    // 크기는 접힘/펼침 두 상태뿐이다. 사용자 리사이즈 대상이 아니다.
    // (앱 주도 크기 변경은 applyOrbBounds()가 setResizable로 잠깐 풀고 되잠근다.)
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
      // 셸 창과 같은 이유 — 배경으로 물러나도 프레임을 계속 만들어야 한다.
      // 오브는 대부분의 시간을 비포커스로 보내므로 여기가 더 중요하다.
      backgroundThrottling: false,
    },
  };
}

/**
 * resizable:false 창의 크기를 앱이 바꾼다. Windows에서 setBounds는 리사이즈 불가
 * 창의 크기 변경을 무시하는 경우가 있어(스타일 플래그에 WS_THICKFRAME이 없다),
 * 잠깐 풀고 바꾸고 되잠근다. win은 덕 타이핑이라 테스트에서 가짜 객체로 대체된다.
 */
function applyOrbBounds(win, bounds) {
  if (!win || win.isDestroyed()) return false;
  win.setResizable(true);
  win.setBounds(bounds);
  win.setResizable(false);
  return true;
}

/**
 * 오브 창 생성. BrowserWindow를 주입받아 이 모듈이 electron을 require하지 않게 한다
 * (단위 테스트가 Electron 없이 돈다 — window-placement.js와 같은 원칙).
 */
function createOrbWindow({ BrowserWindow, appDir, workArea }) {
  const bounds = computeOrbPlacement(workArea);
  const win = new BrowserWindow(buildOrbWindowOptions(bounds, path.join(appDir, 'preload.js')));
  win.loadFile(resolveWindowHtmlPath(appDir, 'orb.html'));
  return { win, bounds };
}

module.exports = {
  ORB_SIZE,
  ORB_MARGIN,
  EXPANDED_WIDTH,
  EXPANDED_HEIGHT,
  computeOrbPlacement,
  computeExpandedBounds,
  computeCollapsedBounds,
  buildOrbWindowOptions,
  applyOrbBounds,
  createOrbWindow,
};
