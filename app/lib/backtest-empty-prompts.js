// 백테스트 빈 채팅의 예시 질문(Paper 40MW–40N3). 이력(:empty) 안에 넣으면
// 빈 안내 CSS가 죽는다 — 마운트는 #history의 동생에서만 한다.
(function () {
'use strict';

const BACKTEST_EMPTY_PROMPT_HEAD = '이런 걸 물어볼 수 있어요';
const BACKTEST_EMPTY_PROMPTS = Object.freeze([
  '이 기법은 다른 것과 뭐가 다른가요?',
  '왜 최근 두 달 동안 한 번도 안 샀죠?',
  '손절을 ATR 2배로 바꾸고 싶어요',
]);

function mountBacktestEmptyPrompts(root, onPick) {
  if (!root) return null;
  while (root.firstChild) root.removeChild(root.firstChild);
  const head = document.createElement('div');
  head.className = 'backtest-empty-prompts-head';
  head.textContent = BACKTEST_EMPTY_PROMPT_HEAD;
  root.appendChild(head);
  const row = document.createElement('div');
  row.className = 'backtest-empty-prompts-row';
  const pick = typeof onPick === 'function' ? onPick : function () {};
  BACKTEST_EMPTY_PROMPTS.forEach((text) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'backtest-empty-prompt';
    button.textContent = text;
    button.addEventListener('click', () => pick(text));
    row.appendChild(button);
  });
  root.appendChild(row);
  return root;
}

const __exports = {
  BACKTEST_EMPTY_PROMPT_HEAD,
  BACKTEST_EMPTY_PROMPTS,
  mountBacktestEmptyPrompts,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestEmptyPrompts = __exports;
}

})();
