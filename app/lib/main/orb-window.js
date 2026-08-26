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
 * 얹어 340으로 올린다.
 * 2026-08-26 board-33: 340은 이제 **기본값**이지 고정값이 아니다 — 콘텐츠가
 * 길면(카드 필드가 많거나 소스 라벨이 길면) orb.js가 실측한 높이로 최대
 * EXPANDED_HEIGHT_MAX까지 자란다. 400으로 올린 건 기본 여유를 board-33 실측에
 * 맞춘 것뿐, 아래 로직은 그대로다. */
const EXPANDED_WIDTH = 360;
const EXPANDED_HEIGHT = 400;
/** 콘텐츠가 아무리 길어도 여기서 멈춘다 — 넘는 몫은 패널 안 스크롤(.orb-card)이
 * 진다. 화면을 절반 넘게 잡아먹는 알림 창은 그 자체로 침해다. */
const EXPANDED_HEIGHT_MAX = 640;

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
    // 2026-08-26 실사용 결함 — "네모 모서리가 살짝 보인다"(사용자 지적). 원인은
    // CSS가 아니라 OS 창 그림자였다: frame:false + transparent:true 창은 기본값
    // (hasShadow 미지정 = true)에서도 Windows DWM이 **사각 창 프레임 전체**에
    // 네이티브 그림자를 얹는다. 창 안쪽은 원 밖(76×76 정사각의 네 모서리, 원에
    // 안 덮이는 부분)이 완전 투명이라 원만 보여야 하는데, 그 사각 그림자의
    // 모서리가 원 밖으로 살짝 삐져나와 "네모 모서리"로 읽힌다 — 원이 정사각형에
    // 내접하는 한 기하적으로 항상 남는 네 귀퉁이(캔버스 스크린샷 실측 —
    // #orb를 76×76 상자 위에 그려보면 사각 배경이 그 네 귀퉁이에서 그대로
    // 보인다). #orb 자신의 box-shadow(orb.css)가 이미 원형 그림자를 그려주므로
    // OS 그림자는 중복이자 결함의 원인이다 — 꺼서 없앤다.
    hasShadow: false,
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
  EXPANDED_WIDTH,
  EXPANDED_HEIGHT,
  EXPANDED_HEIGHT_MAX,
  computeOrbPlacement,
  computeExpandedBounds,
  computeCollapsedBounds,
  buildOrbWindowOptions,
  applyOrbBounds,
  createOrbWindow,
};
