// 코드를 모르는 사람에게 전략을 설명하는 두 표면 — Paper 보드 11~14(흐름 지도)·09(오류 진단).
//
// **두 화면을 한 파일에 둔 이유.** 둘 다 "백엔드가 만든 설명 페이로드를 그대로 그린다"는
// 같은 규율을 따른다. 문구를 프런트가 갖고 있으면 백엔드 설명과 화면 문구가 갈라지고,
// 갈라진 순간 어느 쪽이 맞는지 아무도 모른다. 그래서 이 파일에는 **레이아웃만** 있고
// 칸의 문장은 하나도 없다 — 전부 payload에서 온다(mapmodel.py `NUMERALS`·`STAGE_LABELS`,
// diagnose.py `Diagnosis`).
//
// 예외 둘: 구역 라벨("여기부터 내 전략")과 지도 머리말은 payload에 없다. 그건 설명이
// 아니라 화면 구조라서다 — 어느 칸이 앱 것이고 어느 칸이 사람 것인지는 payload의 배열
// 구분으로 이미 정해져 있고, 이 파일은 그 구분에 이름표만 붙인다.
//
// **왜 지도가 코드보다 앞인가(사용자 확정 2026-09-03).** "코드는 최후의 보루다 — 대화로
// 코드 플로우 지도를 고쳐 나가고, 그 지도 뒤에 코드가 있다." 그래서 이 지도는 줄 번호가
// 아니라 사람 말로 말하고, 코드는 아래 서랍 한 줄로만 존재한다.
(function () {
'use strict';

const BOUNDARY_APP_BEFORE = '앱이 준비해서 건넵니다';
const BOUNDARY_MINE = '여기부터 내 전략 — 대화로 고치는 칸들';
const BOUNDARY_APP_AFTER = '여기부터 다시 앱 — 전략이 손댈 수 없는 구간';

const MAP_TITLE = '이 전략은 이렇게 흐릅니다';
const MAP_SUB = '칸을 누르면 대화가 그 칸을 다룹니다';
const CHANGED_LABEL = '방금 바뀜';
const DRAWER_HEAD = '이 지도 뒤의 코드';
const DRAWER_NOTE = '웬만하면 열 일이 없습니다 — 최후의 보루';
const AHEAD_LABEL = '코드가 지도보다 앞섬';
const DRIFT_LABEL = '지도가 담지 못한 코드가 있습니다';

// 칸 색 축 — 번호와 제목은 payload가 준다(mapmodel.NUMERALS). 화면이 정하는 것은 색뿐이다.
const NODE_TONE = {
  params: 'info',
  indicators: 'navy',
  conditions: 'brand',
  guard: 'ok',
};

// 조건 칸만 문장이 둘이라 어느 쪽인지 이름표가 필요하다 — payload의 role을 옮긴다.
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

// 노드 하나가 코드의 몇 줄을 차지하는지. 코드 경로의 칸을 누르면 편집기가 켤 범위다
// (폼 경로의 칸에는 줄이 없다 — 그 칸 뒤의 코드는 아직 만들어지지 않았다).
function lineRange(node) {
  if (!node || node.first_line == null) return null;
  return { first: node.first_line, last: node.last_line == null ? node.first_line : node.last_line };
}

// "지도 v1과 일치" · "지도 v5와 일치" — 숫자를 한국어로 읽었을 때의 받침으로 조사를 고른다.
// 한 쪽으로 고정하면 두 버전 중 하나는 반드시 어색하게 읽힌다.
const DIGIT_HAS_FINAL = [true, true, false, true, false, false, true, true, true, false];

function versionParticle(version) {
  const digits = String(version == null ? '' : version).replace(/\D/g, '');
  if (!digits) return '과';
  return DIGIT_HAS_FINAL[Number(digits[digits.length - 1])] ? '과' : '와';
}

// 주기 라벨은 폼이 쓰는 것과 같아야 한다 — 여기서 따로 만들면 같은 값이 두 화면에서
// 다르게 읽힌다. 로드 순서에 기대지 않게 부를 때 찾는다.
function periodLabel(period) {
  const Spec = (typeof module !== 'undefined' && module.exports)
    ? require('./backtest-spec')
    : (window.AthenaLib && window.AthenaLib.BacktestSpec);
  const found = Spec && Spec.PERIODS ? Spec.PERIODS.find((row) => row[0] === period) : null;
  return found ? found[1] : String(period == null ? '' : period);
}

// 대상 한 줄 — 지도가 무엇을 두고 그려졌는지. payload의 target이 없으면 줄 자체가 없다.
function targetText(target) {
  if (!target) return '';
  const parts = [];
  if (target.symbol) parts.push(target.symbol);
  if (target.period) parts.push(periodLabel(target.period));
  if (target.from && target.to) parts.push(`${target.from}→${target.to}`);
  parts.push(target.adjusted ? '수정주가' : '원주가');
  return parts.join(' · ');
}

// ---------- 흐름 지도 ----------

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

function changedPill() {
  return el('span', 'backtest-map-changed', CHANGED_LABEL);
}

// 칸 하나. 상태 고리(error·suspect·unknown)는 payload가 정하고, 화면은 색만 입힌다 —
// "확실하지 않다"를 회색으로 뭉개면 사람은 그 칸을 믿어버린다.
function renderMapNode(node, opts, changed) {
  const status = node.status || 'ok';
  const row = el('button', `backtest-flow-node is-mine${status === 'ok' ? '' : ` is-${status}`}`);
  row.type = 'button';
  const badge = el('div', `backtest-flow-badge is-${NODE_TONE[node.id] || 'info'}`);
  badge.appendChild(el('span', '', node.numeral || '·'));
  row.appendChild(badge);

  const body = el('div', 'backtest-flow-body');
  const head = el('div', 'backtest-flow-title-row');
  head.appendChild(el('span', 'backtest-flow-title', node.title));
  if (changed) head.appendChild(changedPill());
  body.appendChild(head);
  // 상태가 ok가 아닐 때만 사유를 적는다 — 늘 뜨는 줄은 아무도 읽지 않는다.
  if (status !== 'ok' && node.note) body.appendChild(el('div', 'backtest-flow-note', node.note));
  (node.lines || []).forEach((line) => {
    const role = line && ROLE_LABELS[line.role];
    const text = (line && line.text) || '';
    body.appendChild(el('div', 'backtest-flow-detail', role ? `${role} — ${text}` : text));
  });
  row.appendChild(body);

  // 오른쪽 사실은 마지막 실행이 실제로 만든 값뿐이다 — 실행 전에는 빈칸이 맞다.
  row.appendChild(el('div', 'backtest-flow-shape', (node.facts || []).join('\n')));
  row.addEventListener('click', () => { if (opts.onSelect) opts.onSelect(node); });
  return row;
}

// 어느 칸에도 들어가지 않은 코드. 지도가 코드보다 좁다는 사실을 숨기지 않는다.
function renderFreeCode(block) {
  const row = el('div', 'backtest-flow-node is-free is-unknown');
  const badge = el('div', 'backtest-flow-badge is-app');
  badge.appendChild(el('span', '', '?'));
  row.appendChild(badge);
  const body = el('div', 'backtest-flow-body');
  body.appendChild(el(
    'div', 'backtest-flow-title',
    `${block.text} · ${block.first_line}–${block.last_line}줄`,
  ));
  row.appendChild(body);
  row.appendChild(el('div', 'backtest-flow-shape', ''));
  return row;
}

// 코드 서랍(보드 14-E) — 지도 뒤에 무엇이 있는지 한 줄로만 말한다. 여는 버튼이 여기
// 하나뿐인 이유: 코드는 최후의 보루라 매번 눈에 띄는 자리에 있으면 안 된다.
function renderDrawer(data, drawer) {
  const code = data.code || {};
  const wrap = el('div', 'backtest-map-drawer');
  const parts = [DRAWER_HEAD, drawer.fileLabel || '생성됨'];
  if (code.lines != null) parts.push(`${code.lines}줄`);
  if (!drawer.aheadOfMap && drawer.matchesMap && data.version != null) {
    parts.push(`지도 v${data.version}${versionParticle(data.version)} 일치`);
  }
  wrap.appendChild(el('div', 'backtest-map-drawer-text', parts.join(' · ')));
  if (drawer.aheadOfMap) {
    wrap.appendChild(el('span', 'backtest-map-drawer-badge', AHEAD_LABEL));
  } else if (!drawer.matchesMap) {
    wrap.appendChild(el('span', 'backtest-map-drawer-badge', DRIFT_LABEL));
  }
  wrap.appendChild(el('div', 'backtest-map-drawer-note', DRAWER_NOTE));
  const open = el('button', 'backtest-map-open-code', '코드 열기');
  open.type = 'button';
  open.addEventListener('click', () => { if (drawer.onOpenCode) drawer.onOpenCode(); });
  wrap.appendChild(open);
  if (drawer.aheadOfMap) {
    const back = el('button', 'backtest-map-back', '지도로 되돌리기');
    back.type = 'button';
    back.addEventListener('click', () => { if (drawer.onBackToMap) drawer.onBackToMap(); });
    wrap.appendChild(back);
  }
  return wrap;
}

// `onSelect(node)`는 칸을 눌렀을 때 그 칸을 통째로 넘긴다(보드 11 상호작용) — 줄 범위는
// 코드 경로의 칸에만 있으므로, 무엇을 할지는 부르는 쪽이 정한다.
function renderFlowMap(container, payload, options) {
  const opts = options || {};
  const changedIds = opts.changedIds || new Set();
  clear(container);
  const data = payload || {};

  if (data.error) {
    const err = el('div', 'backtest-flow-error');
    err.appendChild(el('div', 'backtest-flow-error-title', '코드를 읽지 못해 지도를 그릴 수 없습니다'));
    err.appendChild(el('div', 'backtest-flow-error-detail', data.error));
    container.appendChild(err);
    return;
  }

  const head = el('div', 'backtest-map-head');
  const headBody = el('div', 'backtest-map-head-body');
  headBody.appendChild(el('div', 'backtest-map-head-title', MAP_TITLE));
  headBody.appendChild(el(
    'div', 'backtest-map-head-sub',
    opts.lastRunLabel
      ? `${MAP_SUB} · 오른쪽 숫자는 지난 실행(#${opts.lastRunLabel})의 실제 값`
      : MAP_SUB,
  ));
  head.appendChild(headBody);
  if (data.version != null) {
    head.appendChild(el('div', 'backtest-map-version', `지도 v${data.version}`));
  }
  container.appendChild(head);

  const target = targetText(data.target);
  if (target) {
    const line = el('div', 'backtest-map-target');
    line.appendChild(el('span', 'backtest-map-target-text', target));
    if (changedIds.has('target')) line.appendChild(changedPill());
    container.appendChild(line);
  }

  container.appendChild(renderBoundary(BOUNDARY_APP_BEFORE));
  (data.app_before || []).forEach((spec) => container.appendChild(renderAppNode(spec)));

  container.appendChild(renderBoundary(BOUNDARY_MINE, 'mine'));
  (data.nodes || []).forEach((node) => {
    container.appendChild(renderMapNode(node, opts, changedIds.has(node.id)));
  });
  (data.free_code || []).forEach((block) => container.appendChild(renderFreeCode(block)));

  container.appendChild(renderBoundary(
    data.boundary_after_note
      ? `${BOUNDARY_APP_AFTER} · ${data.boundary_after_note}`
      : BOUNDARY_APP_AFTER,
  ));
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

  if (opts.drawer) container.appendChild(renderDrawer(data, opts.drawer));
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
  BOUNDARY_APP_BEFORE,
  BOUNDARY_MINE,
  BOUNDARY_APP_AFTER,
  NODE_TONE,
  ROLE_LABELS,
  lineRange,
  versionParticle,
  targetText,
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
