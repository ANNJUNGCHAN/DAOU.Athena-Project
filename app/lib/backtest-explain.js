// 코드를 모르는 사람에게 오류를 설명하는 표면 — Paper 보드 09(오류 진단).
//
// **규율.** 백엔드가 만든 설명 페이로드를 그대로 그린다. 문구를 프런트가 갖고 있으면
// 백엔드 설명과 화면 문구가 갈라지고, 갈라진 순간 어느 쪽이 맞는지 아무도 모른다.
// 그래서 이 파일에는 **레이아웃만** 있고 문장은 payload에서 온다(diagnose.py `Diagnosis`).
//
// 흐름 지도(보드 11~14)는 여기 있었지만 없어졌다 — 한 페이지가 한 알고리즘을 다루고
// 요약 지도는 폐기됐다(2026-09-03 사용자 확정). 남은 것은 진단 하나다.
(function () {
'use strict';

const ROLE_LABELS = { entry: '진입', exit: '청산' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ---------- 순수 계산 ----------

// ---------- 오류 진단 ----------

// `onApply(newSource, alsoRun)`는 사람이 눌렀을 때만 불린다 — 이 파일 어디에서도
// 자동으로 코드를 바꾸지 않는다(diagnose.py 머리말의 규율을 화면에서도 지킨다).
function renderDiagnosis(container, diagnosis, options) {
  const opts = options || {};
  clear(container);
  const d = diagnosis || {};

  const banner = el('div', 'backtest-diag-banner');
  const mark = el('div', 'backtest-diag-mark');
  mark.appendChild(el('span', '', '!'));
  banner.appendChild(mark);
  const bannerBody = el('div', 'backtest-diag-banner-body');
  bannerBody.appendChild(el('div', 'backtest-diag-title', d.title || '실행 중에 멈췄습니다'));
  bannerBody.appendChild(el('div', 'backtest-diag-detail', d.detail || ''));
  banner.appendChild(bannerBody);

  // 원문은 접어두되 버리지 않는다 — 번역이 틀렸을 때 진짜 문구에 닿을 길을 없애면 안 된다.
  const rawToggle = el('button', 'backtest-diag-raw-toggle', '파이썬 원문 보기');
  rawToggle.type = 'button';
  banner.appendChild(rawToggle);
  container.appendChild(banner);

  const raw = el('pre', 'backtest-diag-raw', d.raw || '');
  raw.hidden = true;
  rawToggle.addEventListener('click', () => {
    raw.hidden = !raw.hidden;
    rawToggle.textContent = raw.hidden ? '파이썬 원문 보기' : '파이썬 원문 접기';
  });
  container.appendChild(raw);

  const why = el('div', 'backtest-diag-section');
  why.appendChild(el('div', 'backtest-diag-section-title', '왜 이렇게 됐나'));
  why.appendChild(el('div', 'backtest-diag-why', d.why || ''));
  container.appendChild(why);

  if (!d.suggestion) {
    const none = el('div', 'backtest-diag-nofix');
    none.appendChild(el('div', 'backtest-diag-nofix-title', '자동 수정안은 내지 않습니다'));
    none.appendChild(el(
      'div', 'backtest-diag-nofix-detail',
      d.unknown_reason || '어떻게 고칠지 확신하지 못했습니다',
    ));
    container.appendChild(none);
    return;
  }

  const fix = el('div', 'backtest-diag-section');
  const head = el('div', 'backtest-diag-fix-head');
  head.appendChild(el('div', 'backtest-diag-section-title', '어떻게 고칠지'));
  head.appendChild(el(
    'div', 'backtest-diag-fix-stat',
    `${d.suggestion.removed}줄 삭제 · ${d.suggestion.added}줄 추가`,
  ));
  fix.appendChild(head);
  fix.appendChild(el('div', 'backtest-diag-fix-summary', d.suggestion.summary || ''));

  const diff = el('div', 'backtest-diag-diff');
  (d.suggestion.diff_lines || []).forEach((row) => {
    const cls = row.mark === '+' ? 'is-add' : (row.mark === '-' ? 'is-del' : 'is-same');
    const line = el('div', `backtest-diff-row ${cls}`);
    line.appendChild(el('span', 'backtest-diff-mark', row.mark === ' ' ? '' : row.mark));
    line.appendChild(el('span', 'backtest-diff-text', row.text));
    diff.appendChild(line);
  });
  fix.appendChild(diff);
  container.appendChild(fix);

  const actions = el('div', 'backtest-diag-actions');
  const applyRun = el('button', 'backtest-diag-apply', '적용하고 다시 실행');
  applyRun.type = 'button';
  applyRun.addEventListener('click', () => {
    if (opts.onApply) opts.onApply(d.suggestion.new_source, true);
  });
  const applyOnly = el('button', 'backtest-diag-apply-only', '지도만 고치기');
  applyOnly.type = 'button';
  applyOnly.addEventListener('click', () => {
    if (opts.onApply) opts.onApply(d.suggestion.new_source, false);
  });
  const discard = el('button', 'backtest-diag-discard', '버리기');
  discard.type = 'button';
  discard.addEventListener('click', () => { if (opts.onDiscard) opts.onDiscard(); });
  actions.appendChild(applyRun);
  actions.appendChild(applyOnly);
  actions.appendChild(discard);
  actions.appendChild(el(
    'div', 'backtest-diag-actions-note',
    '적용하면 새 버전으로 저장되고 지금 버전은 이력에 남습니다 — 되돌릴 수 있습니다',
  ));
  container.appendChild(actions);
}

const __exports = {
  ROLE_LABELS,
  renderDiagnosis,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BacktestExplain = __exports;
}

})();
