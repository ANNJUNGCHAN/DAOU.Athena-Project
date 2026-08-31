// 코드를 모르는 사람에게 코드를 설명하는 두 표면 — Paper 보드 08(플로우 지도)·09(오류 진단).
//
// **두 화면을 한 파일에 둔 이유.** 둘 다 "백엔드가 만든 설명 페이로드를 그대로 그린다"는
// 같은 규율을 따른다. 문구를 프런트가 갖고 있으면 백엔드 설명과 화면 문구가 갈라지고,
// 갈라진 순간 어느 쪽이 맞는지 아무도 모른다. 그래서 이 파일에는 **레이아웃만** 있고
// 설명 문장은 하나도 없다 — 전부 payload에서 온다(flow.py `STAGE_LABELS`·`APP_STAGES_*`,
// diagnose.py `Diagnosis`).
//
// 예외 하나: 구역 라벨("여기부터 내 코드")은 payload에 없다. 그건 설명이 아니라 화면
// 구조라서다 — 어느 노드가 앱 것이고 어느 노드가 사용자 것인지는 payload의 배열 구분으로
// 이미 정해져 있고, 이 파일은 그 구분에 이름표만 붙인다.
(function () {
'use strict';

const BOUNDARY_APP_BEFORE = '앱이 준비해서 건넵니다';
const BOUNDARY_MINE = '여기부터 내 코드';
const BOUNDARY_APP_AFTER = '여기부터 다시 앱 — 코드가 손댈 수 없는 구간';

// 단계별 색 축 — 왼쪽 코드 블록과 오른쪽 지도 칸이 같은 색이어야 눈으로 이어진다.
const STAGE_TONE = {
  prepare: 'info',
  indicators: 'navy',
  conditions: 'brand',
  output: 'ok',
};

const STAGE_NUMERAL = { prepare: '①', indicators: '②', conditions: '③', output: '④' };

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

// 지도 오른쪽에 붙는 "데이터 모양" 한 줄. payload가 준 사실만 옮긴다.
function shapeText(node) {
  const produces = node.produces || [];
  const calls = node.calls || [];
  const parts = [];
  if (produces.length) parts.push(`${produces.join(' · ')} — ${produces.length}개`);
  if (calls.length) parts.push(calls.join(' · '));
  return parts.join('\n');
}

// 노드 하나가 코드의 몇 줄을 차지하는지. 지도 칸을 누르면 편집기가 켤 범위다.
function lineRange(node) {
  if (!node || node.first_line == null) return null;
  return { first: node.first_line, last: node.last_line == null ? node.first_line : node.last_line };
}

// ---------- 플로우 지도 ----------

function renderAppNode(spec) {
  const row = el('div', 'backtest-flow-node is-app');
  const badge = el('div', 'backtest-flow-badge is-app');
  badge.appendChild(el('span', '', '앱'));
  row.appendChild(badge);
  const body = el('div', 'backtest-flow-body');
  body.appendChild(el('div', 'backtest-flow-title', spec.title));
  body.appendChild(el('div', 'backtest-flow-detail', spec.detail));
  row.appendChild(body);
  row.appendChild(el('div', 'backtest-flow-shape', ''));
  return row;
}

function renderBoundary(label, tone) {
  const wrap = el('div', `backtest-flow-boundary${tone ? ` is-${tone}` : ''}`);
  wrap.appendChild(el('div', 'backtest-flow-boundary-label', label));
  wrap.appendChild(el('div', 'backtest-flow-boundary-line'));
  return wrap;
}

// `onSelect(range)`는 칸을 눌렀을 때 편집기에 줄 범위를 알려준다(보드 08 상호작용).
function renderFlowMap(container, payload, options) {
  const opts = options || {};
  clear(container);
  const data = payload || {};

  if (data.error) {
    const err = el('div', 'backtest-flow-error');
    err.appendChild(el('div', 'backtest-flow-error-title', '코드를 읽지 못해 지도를 그릴 수 없습니다'));
    err.appendChild(el('div', 'backtest-flow-error-detail', data.error));
    container.appendChild(err);
    return;
  }

  container.appendChild(renderBoundary(BOUNDARY_APP_BEFORE));
  (data.app_before || []).forEach((spec) => container.appendChild(renderAppNode(spec)));

  container.appendChild(renderBoundary(BOUNDARY_MINE, 'mine'));
  (data.nodes || []).forEach((node) => {
    const row = el('button', 'backtest-flow-node is-mine');
    row.type = 'button';
    const tone = STAGE_TONE[node.stage] || 'info';
    const badge = el('div', `backtest-flow-badge is-${tone}`);
    badge.appendChild(el('span', '', STAGE_NUMERAL[node.stage] || '·'));
    row.appendChild(badge);
    const body = el('div', 'backtest-flow-body');
    body.appendChild(el('div', 'backtest-flow-title', node.title));
    body.appendChild(el('div', 'backtest-flow-detail', `${node.first_line}–${node.last_line}줄`));
    row.appendChild(body);
    row.appendChild(el('div', 'backtest-flow-shape', shapeText(node)));
    row.addEventListener('click', () => {
      if (opts.onSelect) opts.onSelect(lineRange(node));
    });
    container.appendChild(row);
  });

  container.appendChild(renderBoundary(BOUNDARY_APP_AFTER));
  (data.app_after || []).forEach((spec) => container.appendChild(renderAppNode(spec)));

  // 확신하지 못한 것은 지도 아래에 그대로 남긴다 — 빈칸으로 두면 사용자는 지도가
  // 완전하다고 믿는다(flow.py `unknown`의 존재 이유).
  if ((data.unknown || []).length) {
    const warn = el('div', 'backtest-flow-unknown');
    warn.appendChild(el('div', 'backtest-flow-unknown-title', '확실하지 않은 곳'));
    (data.unknown || []).forEach((line) => {
      warn.appendChild(el('div', 'backtest-flow-unknown-line', line));
    });
    container.appendChild(warn);
  }
}

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
  const applyOnly = el('button', 'backtest-diag-apply-only', '적용만 하고 편집기로');
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
  BOUNDARY_APP_BEFORE,
  BOUNDARY_MINE,
  BOUNDARY_APP_AFTER,
  STAGE_TONE,
  STAGE_NUMERAL,
  shapeText,
  lineRange,
  renderFlowMap,
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
