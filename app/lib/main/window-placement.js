// 창 짝(캔버스 창 + 대화 창)을 워크에어리어의 절반에 배치하는 순수 좌표 계산.
// Electron 의존 없음 — main.js의 placeWindows()가 이 결과를 그대로
// BrowserWindow.setBounds()에 먹인다. Win+↑/↓(최대화 토글·복원-또는-최소화)는
// 위치가 아니라 대화 창 높이(chatBaseH↔chatMaxH)만 바꾸는 별개 경로라 여기서
// 안 다룬다 — main.js의 toggleChatMaximize()/placeWindows()가 기존
// setChatHeight()를 직접 부른다.
//
// 크기는 항상 dims 그대로 돌려준다(불변) — 위치만 바뀐다. 호출자가 반드시
// {x,y,width,height}를 한 번에 setBounds()에 넘겨야 한다 — setPosition()만
// 쓰면 DPI 배율 화면에서 반올림이 누적돼 창이 자라는 버그가 있다(커밋
// 5e0a9ab, 드래그 폴링에서 실측·수정된 것과 같은 원인).
'use strict';

// dir: 'left' | 'right'. workArea: {x,y,width,height}(대상 디스플레이의
// screen.getDisplayMatching(...).workArea). dims: {canvasW, canvasH, chatW,
// chatBaseH, chatHeight} — chatHeight는 *현재* 대화 창 높이(설정 등 모드로
// 확장돼 있어도 그 높이를 유지한 채 자리만 옮긴다).
//
// 반환: canvasBounds/chatBounds 둘 다 {x,y,width,height} — 그대로 setBounds에
// 쓴다. chatBottom/chatX는 main.js의 앵커 변수(대화 창이 위로만 자라게 하는
// 기준) 갱신용이다.
function computePlacement(dir, workArea, dims) {
  const pairW = dims.canvasW;
  const pairH = dims.canvasH + dims.chatBaseH;

  let regionX = workArea.x;
  let regionWidth = workArea.width;
  if (dir === 'left' || dir === 'right') {
    regionWidth = Math.floor(workArea.width / 2);
    if (dir === 'right') regionX = workArea.x + workArea.width - regionWidth;
  }
  // 구간 폭(절반 또는 전체) < 창 폭이면 중앙 정렬 공식이 자연히 음수 오프셋을
  // 내놓는다 — "그 구간 중앙에 겹쳐 배치"가 별도 분기 없이 성립한다.
  const x = Math.round(regionX + (regionWidth - pairW) / 2);
  const y = Math.max(workArea.y, Math.round(workArea.y + (workArea.height - pairH) / 2));
  const chatBottom = y + dims.canvasH + dims.chatBaseH;

  return {
    canvasBounds: { x, y, width: dims.canvasW, height: dims.canvasH },
    chatBounds: { x, y: chatBottom - dims.chatHeight, width: dims.chatW, height: dims.chatHeight },
    chatBottom,
    chatX: x,
  };
}

module.exports = { computePlacement };
