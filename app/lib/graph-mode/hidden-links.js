// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 숨은 연관 섹션(보드 06 §9 / 07 §9-2) — surprising-connections(군집 경계를
// 넘는 연결)를 "A ↔ B" + 관계 종류 나열로 그린다. 새 데이터(기존 3개 모듈이
// 안 다루는)라 theme-clusters.js와 같은 이유로 새 leaf 모듈이다(원칙1).
//
// **절대 점수(8.5류)는 없다 — 이 목록 안에서의 상대 순위만 있다(§0 발견3 후속,
// WP-B).** `SurprisingConnectionOut`은 source_entity_id/source_name/
// target_entity_id/target_name/kinds[]/source_cluster/target_cluster에 더해
// surprise_score(차수 역수 기반 min-max 정규화, [0,1])를 준다 — "두 군집을
// 잇는 유일한 연결·주변부에서 허브로·직접 말한 적 없음" 같은 서술 문장은
// 여전히 없다. kinds[]를 조인한 텍스트가 "설명" 자리를, surprise_score가
// 있으면 상대 순위 배지를 채운다.

function el(name, className) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  return node;
}

function renderConnectionRow(connection, rank, relationLabels) {
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

  // 순위 배지 — 숫자를 적지 않는다(2026-09-03).
  //
  // 예전에는 `상대 ${surprise_score * 10}`을 적었다. 그런데 backend의 점수는 min-max
  // 정규화라 1등은 **언제나** 1.0이고, 교차 다리가 전부 동점이면 전부 1.0이다
  // (analysis.py — hi == lo면 모두 1.0). 그래서 화면에는 "상대 10.0"이 여러 줄
  // 나란히 찍혔다: 라벨은 '상대'인데 순위 정보가 0이고, 10.0은 절대 점수처럼 읽힌다
  // (§0 발견3이 금지한 바로 그 8.5류 표기와 구별이 안 된다).
  //
  // 목록은 이제 놀라운 순으로 내려온다(analysis.py가 점수순으로 정렬한 뒤 자른다).
  // 그러면 순위는 **자리 자체**가 말한다 — 1·2·3을 적어 주면 그것으로 충분하고,
  // 지어낸 정밀도가 없다.
  if (Number.isFinite(rank)) {
    const badge = el('span', 'hidden-link-score');
    badge.textContent = `${rank}순위`;
    row.appendChild(badge);
  }

  // kinds[]가 유일한 실데이터 설명 재료다 — 없으면 빈 칸(지어내지 않는다).
  // 관계명은 한글로 바꿔 적는다(2026-09-03): 그대로 두면 화면에 `belongs_to`가
  // 새어 나온다(실측). 사전은 controller.js RELATION_LABELS가 진실이라 주입받는다 —
  // graph-edit-proposal.js와 같은 규약이고, 여기 복사하면 한쪽만 고치는 실수가 난다.
  // 사전에 없는 관계는 원문 그대로 남긴다(모르는 것을 지어내지 않는다).
  const labels = relationLabels || {};
  const kinds = Array.isArray(connection.kinds) ? connection.kinds : [];
  const desc = el('div', 'hidden-link-desc');
  desc.textContent = kinds.map((kind) => labels[kind] || kind).join(' · ');
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
  // 모수를 밝힌다(2026-09-03) — 바로 위 테마 군집은 "7개 중 3개"라고 말하는데
  // 여기만 잘린 사실을 숨기고 있었다. 화면만 보면 숨은 연관이 3개뿐인 줄 안다.
  // 자른 게 없으면 붙이지 않는다(3개 중 3개는 아무 말도 안 하는 문구다).
  if (list.length > shown.length) {
    const count = el('span', 'hidden-links-count');
    count.textContent = `${list.length}개 중 ${shown.length}개`;
    head.appendChild(count);
  }
  wrap.appendChild(head);

  const rows = el('div', 'hidden-link-list');
  // 순위는 화면에 그린 자리 그대로다 — backend가 놀라운 순으로 내려주고
  // (analysis.py), 여기서는 그 순서를 바꾸지 않는다.
  shown.forEach((connection, index) => {
    if (!connection) return;
    rows.appendChild(renderConnectionRow(connection, index + 1, opts.relationLabels));
  });
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
