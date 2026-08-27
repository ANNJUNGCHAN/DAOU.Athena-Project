// 셸 창 하나를 워크에어리어의 절반(또는 전체)에 배치하는 순수 좌표 계산.
// Electron 의존 없음 — main.js의 placeWindows()가 이 결과를 그대로
// BrowserWindow.setBounds()에 먹인다.
//
// 크기는 항상 dims 그대로 돌려준다(불변) — 위치만 바뀐다. 호출자가 반드시
// {x,y,width,height}를 한 번에 setBounds()에 넘겨야 한다 — setPosition()만
// 쓰면 DPI 배율 화면에서 반올림이 누적돼 창이 자라는 버그가 있다(커밋
// 5e0a9ab, 드래그 폴링에서 실측·수정된 것과 같은 원인).
'use strict';

// dir: 'left' | 'right' | 그 외(전체 워크에어리어 중앙).
// workArea: {x,y,width,height}(대상 디스플레이의 screen.getDisplayMatching(...).workArea).
// dims: {width, height} — 셸 창의 *현재* 크기. 사용자가 리사이즈한 크기로 스냅해도
// 그 크기를 유지한 채 자리만 옮긴다.
//
// 반환: {bounds} — 그대로 setBounds에 쓴다.
function computeShellPlacement(dir, workArea, dims) {
  let regionX = workArea.x;
  let regionWidth = workArea.width;
  if (dir === 'left' || dir === 'right') {
    regionWidth = Math.floor(workArea.width / 2);
    if (dir === 'right') regionX = workArea.x + workArea.width - regionWidth;
  }
  // 구간 폭(절반 또는 전체) < 창 폭이면 중앙 정렬 공식이 자연히 음수 오프셋을
  // 내놓는다 — "그 구간 중앙에 겹쳐 배치"가 별도 분기 없이 성립한다.
  const x = Math.round(regionX + (regionWidth - dims.width) / 2);
  const y = Math.max(workArea.y, Math.round(workArea.y + (workArea.height - dims.height) / 2));

  return { bounds: { x, y, width: dims.width, height: dims.height } };
}

// 오브 드래그 클램프(2026-08-27 병합 점검 K4 결정) — 창 **중심**이 workArea 안에
// 남도록 x/y만 자른다(최소 절반은 항상 보인다). target: {x,y,width,height}(이동
// 목적지와 현재 창 크기), workArea: 목적지 중심에 가장 가까운 디스플레이의
// workArea — 호출자가 디스플레이 판정을 하므로 모니터 사이 이동은 막히지 않는다.
function clampCenterToWorkArea(target, workArea) {
  const halfW = target.width / 2;
  const halfH = target.height / 2;
  const x = Math.round(Math.min(Math.max(target.x, workArea.x - halfW), workArea.x + workArea.width - halfW));
  const y = Math.round(Math.min(Math.max(target.y, workArea.y - halfH), workArea.y + workArea.height - halfH));
  return { x, y };
}

module.exports = { computeShellPlacement, clampCenterToWorkArea };
