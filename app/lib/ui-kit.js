// IIFE 스코프 격리(2026-08-18 렌더러 격리) — <script> 태그는 top-level const/function을
// 문서 전체가 공유하는 하나의 스크립트 스코프에 넣는다(require()의 모듈별 격리와 다르다).
// el/sanitize 같은 흔한 이름이 파일 간에 충돌해 SyntaxError가 났다(실측, diag-isolation.js).
// CJS(require)는 이 IIFE 밖에서도 동일하게 동작한다 — Node의 모듈 래퍼가 이미 함수 스코프다.
(function () {
// 설정·온보딩 화면군이 공유하는 DOM 프리미티브.
//
// 왜 별도 모듈인가: 온보딩(대화 창)과 제어 캔버스(캔버스 창)는 서로 다른
// 렌더러 프로세스인데 같은 부품을 쓴다 — 표시등, 활성/비활성 배지, 연결 버튼,
// 진행 점. 창마다 각자 그리면 같은 배지가 두 벌로 갈라져 시간이 지나면
// 어긋난다. 치수는 Paper 화면설계서 실측값이다(plan/paper-specs/ 각 문서의
// "레이아웃 · 스타일" 절).
//
// 렌더링 계약은 lib/markdown.js와 같다: **문자열을 innerHTML로 파싱시키지
// 않는다.** 전부 createElement + textContent다. 이 화면군은 계정 이메일·서버
// 별칭·upstream 툴 설명처럼 남이 쓴 문자열을 그리므로 이 계약이 특히 중요하다
// — upstream 툴 설명은 backend/athena_mcp/SECURITY.md §3이 프롬프트 인젝션
// 공격면으로 명시한 바로 그 텍스트다.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function row(className, children) {
  const node = el('div', className);
  for (const c of children || []) if (c) node.appendChild(c);
  return node;
}

// 연결됨(녹색) / 미연결(회색) 7×7 원. AT-SY-002 Description 2, AT-ST-004 동일.
// 상태를 색으로만 구분하면 색각 이상에서 사라진다 — styles/access.css의
// 고대비 모드가 테두리를 얹을 수 있도록 상태를 class로도 남긴다.
function statusDot(on, label) {
  const d = el('span', `uk-dot ${on ? 'is-on' : 'is-off'}`);
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', label || (on ? '연결됨' : '미연결'));
  return d;
}

// 활성 = 브랜드색 솔리드, 비활성 = 아웃라인. AT-SY-002 Description 3.
// 활성 계정은 전체에서 1개뿐이라는 규칙은 호출자(상태 관리)가 지킨다.
function badge(active, label) {
  return el('span', `uk-badge ${active ? 'is-active' : 'is-idle'}`, label || (active ? '활성' : '비활성'));
}

// 화살표 아이콘. innerHTML 없이 SVG를 노드로 만든다.
// dir: 'up-right'(연결 ↗) | 'right'(계속 →)
function arrowIcon(dir) {
  const size = dir === 'right' ? 11 : 10;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  if (dir === 'right') {
    path.setAttribute('d', `M1 ${size / 2} H${size - 1} M${size - 4.5} ${size / 2 - 3.5} L${size - 1} ${size / 2} L${size - 4.5} ${size / 2 + 3.5}`);
    path.setAttribute('stroke-width', '1.5');
  } else {
    path.setAttribute('d', `M2.5 ${size - 2.5} L${size - 2.5} 2.5 M3.5 2.5 H${size - 2.5} V${size - 3.5}`);
    path.setAttribute('stroke-width', '1.4');
  }
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

// kind: 'primary'(브랜드 솔리드 — 화면 내 유일한 브랜드색 요소여야 한다)
//     | 'ghost'(아웃라인) | 'text'(테두리·배경 없음)
function button(kind, label, opts) {
  const o = opts || {};
  const b = el('button', `uk-btn uk-btn-${kind}`);
  b.type = 'button';
  b.appendChild(el('span', 'uk-btn-label', label));
  if (o.icon) b.appendChild(arrowIcon(o.icon));
  if (o.onClick) b.addEventListener('click', o.onClick);
  if (o.disabled) b.disabled = true;
  if (o.title) b.title = o.title;
  return b;
}

// 진행 점 3개(20×3px). 무채색 고정 — AT-SY-002 Description 5:
// "좌측 단계 표시는 무채색. 브랜드 색을 사용하지 않는다."
function progressDots(total, current) {
  const wrap = el('div', 'uk-dots');
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${total}단계 중 ${current}단계`);
  for (let i = 1; i <= total; i++) {
    let state = 'next';
    if (i < current) state = 'past';
    else if (i === current) state = 'now';
    wrap.appendChild(el('span', `uk-dot-pill is-${state}`));
  }
  return wrap;
}

// 라벨 + 값 한 줄. 스펙 패널 Meta 행과 카드 안 정보 행이 같은 모양이다.
function labeledRow(label, value, valueClass) {
  return row('uk-lrow', [
    el('span', 'uk-lrow-label', label),
    el('span', `uk-lrow-value ${valueClass || ''}`.trim(), value),
  ]);
}

// 카드 내부 시트(AT-ST-002/003/005/006). 새 창도 새 캔버스도 아니다 —
// 부모 카드 좌표계 안에서 덮는 오버레이다(plan/paper-specs/00-통합-계획.md §1.3).
// onClose가 없으면 닫기 버튼을 만들지 않는다(닫기 경로가 없는 시트도 있다).
function sheet(title, opts) {
  const o = opts || {};
  const root = el('div', 'uk-sheet');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title);

  const head = row('uk-sheet-head', [el('div', 'uk-sheet-title', title)]);
  if (o.subtitle) head.appendChild(el('div', 'uk-sheet-sub', o.subtitle));
  if (o.onClose) {
    const close = button('text', '닫기', { onClick: o.onClose });
    close.classList.add('uk-sheet-close');
    head.appendChild(close);
  }
  const body = el('div', 'uk-sheet-body');
  root.appendChild(head);
  root.appendChild(body);
  return { root, body, head };
}

// 비밀값을 화면에 되돌리지 않는다는 원칙(AT-ST-007)을 코드로 강제하는 표시기.
// 값이 아니라 **문자 수**만 받는다 — 값 자체를 인자로 받지 않으므로 이 함수를
// 통해서는 비밀값이 DOM에 닿을 수 없다.
function secretMask(charCount) {
  const n = Number(charCount) || 0;
  return el('span', 'uk-secret', n > 0 ? `저장됨 · ${n}자` : '미설정');
}

// 빈 상태. 목록이 0건일 때 조용히 빈 화면을 두지 않는다.
function emptyState(text, hint) {
  const wrap = el('div', 'uk-empty');
  wrap.appendChild(el('div', 'uk-empty-text', text));
  if (hint) wrap.appendChild(el('div', 'uk-empty-hint', hint));
  return wrap;
}

// 실패를 조용히 삼키지 않는다 — 게이트웨이 쪽 원칙("조용히 자르지 않는다")과
// 같은 태도를 UI에도 적용한다.
function errorNote(message) {
  const n = el('div', 'uk-error', message);
  n.setAttribute('role', 'alert');
  return n;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const __exports = {
  el,
  row,
  statusDot,
  badge,
  arrowIcon,
  button,
  progressDots,
  labeledRow,
  sheet,
  secretMask,
  emptyState,
  errorNote,
  clear,
};

// UMD 각주(2026-08-18 렌더러 격리) — sanitize.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.UiKit = __exports;
}

})();
