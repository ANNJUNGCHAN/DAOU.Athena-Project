// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 숨은 연관 섹션(보드 06 §9 / 07 §9-2) — surprising-connections(군집 경계를
// 넘는 연결)를 "A ↔ B" + 관계 종류 나열로 그린다. 새 데이터(기존 3개 모듈이
// 안 다루는)라 theme-clusters.js와 같은 이유로 새 leaf 모듈이다(원칙1).
//
// **"점수 8.5"는 없다(§0 발견3).** `SurprisingConnectionOut`은
// source_entity_id/source_name/target_entity_id/target_name/kinds[]/
// source_cluster/target_cluster만 준다 — 점수 필드도, "두 군집을 잇는 유일한
// 연결·주변부에서 허브로·직접 말한 적 없음" 같은 서술 문장도 없다. kinds[]를
// 조인한 텍스트만 "설명" 자리에 정직하게 채운다.

function el(name, className) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  return node;
}

function renderConnectionRow(connection) {
  const row = el('div', 'hidden-link-row');

  const pair = el('div', 'hidden-link-pair');
  const source = el('span', 'hidden-link-entity');
  source.textContent = connection.source_name || connection.source_entity_id;
  pair.appendChild(source);
  const arrow = el('span', 'hidden-link-arrow');
  arrow.textContent = '↔';
  pair.appendChild(arrow);
  const target = el('span', 'hidden-link-entity');
  target.textContent = connection.target_name || connection.target_entity_id;
  pair.appendChild(target);
  row.appendChild(pair);

  // kinds[]가 유일한 실데이터 설명 재료다 — 없으면 빈 칸(지어내지 않는다).
  const kinds = Array.isArray(connection.kinds) ? connection.kinds : [];
  const desc = el('div', 'hidden-link-desc');
  desc.textContent = kinds.join(' · ');
  row.appendChild(desc);

  return row;
}

// 순수 렌더 — connections는 이미 IPC가 준 목록(또는 테스트용 모의 배열).
// container는 통째로 다시 채운다. 항목이 없으면 아예 안 그린다(§0 정책).
function renderHiddenLinks(container, connections, options) {
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);
  const list = Array.isArray(connections) ? connections : [];
  if (list.length === 0) return null;

  const opts = options || {};
  const limit = Number.isInteger(opts.limit) ? opts.limit : 3; // 보드 06/07 — 항목 3개
  const shown = list.slice(0, limit);

  const wrap = el('div', 'hidden-links');
  const head = el('div', 'hidden-links-head');
  const title = el('span', 'hidden-links-title');
  title.textContent = '숨은 연관';
  head.appendChild(title);
  const subtitle = el('span', 'hidden-links-subtitle');
  subtitle.textContent = '본인이 말한 적 없는 연결';
  head.appendChild(subtitle);
  wrap.appendChild(head);

  const rows = el('div', 'hidden-link-list');
  for (const connection of shown) {
    if (!connection) continue;
    rows.appendChild(renderConnectionRow(connection));
  }
  wrap.appendChild(rows);

  container.appendChild(wrap);
  return wrap;
}

const __exports = { renderHiddenLinks };

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.HiddenLinks = __exports;
}

})();
