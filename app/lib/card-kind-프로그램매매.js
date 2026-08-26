// 카드 v3(.omc/state/card-v3-plan.md §2.3/§3 Wave 1-4 레인2) 카드종 스텁 — "프로그램매매"
// 레인 오너가 이 파일 안쪽만 채운다(신규 파일 생성 아님 → git 추가 충돌 없음). 지금은
// 항상 null을 돌려줘 canvas.js 후킹 지점(§2.2)이 기존 범용 body 빌드 코드로 폴백한다
// (all-or-nothing 계약의 안전 기본값 — card-kinds.js 참고).
(function () {
'use strict';

window.AthenaLib.CardKinds.register('프로그램매매', () => null);

})();
