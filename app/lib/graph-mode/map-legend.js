// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 지도 범례와 노드 채움 인코딩(보드 03 4IA-0 · 04 31H-0 · 07 2QCN-2).
//
// **왜 leaf 모듈인가.** 같은 값을 둘이 쓴다: live-map.js가 노드를 그 인코딩으로
// 칠하고, 이 파일의 범례가 그 칠을 글로 설명한다. 한쪽에 두면 다른 쪽이 상위
// 모듈을 거꾸로 의존하고, 복붙하면 범례가 화면이 실제로 하지 않는 인코딩을
// 설명하는 거짓말이 된다 — cluster-grouping.js 머리말과 같은 이유다.
//
// **채움 = 확정성**(보드 07 2QE8-2 「노드 채움 — 성향 신호 표와 같은 인코딩」,
// 2QE9-2 「원 크기가 이미 연결 수를 말하므로, 채움은 다른 축(확정성)을 말한다」).
// 세 칸의 뜻과 이름도 그 보드가 정했다 — 사실 · 체결·잔고 / 불확실 / 그 밖 · 모름.
//
// **불확실만 테두리로 말한다.** 성향 신호 표는 불확실을 주황 **채움**으로 그리지만
// (summary-table.js dotClass → .summary-row-dot-warn), 지도에서 그렇게 칠하면 그
// 노드만 군집색을 잃어 보드 03·04가 못박은 「색 = 군집」이 깨진다. 채움은 군집색으로
// 두고 주황을 테두리에 실어 두 축을 함께 살린다 — 범례 표식도 **똑같이** 그리므로
// 범례가 설명하는 것과 화면이 하는 것이 어긋나지 않는다.
const FILL_ITEMS = Object.freeze([
  Object.freeze({ key: 'fact', label: '사실 · 체결·잔고' }),
  Object.freeze({ key: 'uncertain', label: '불확실' }),
  Object.freeze({ key: 'unknown', label: '그 밖 · 모름' }),
]);

// 보드 03·04의 범례 여섯 줄 그대로다(4IA-0 › 3VBU-1). 앞의 둘은 노드의 색·크기이고
// 뒤의 넷은 선이다 — live-map.js의 CONFIDENCE·HIDDEN_COLOR가 실제로 그리는 것과
// 같은 순서·같은 이름이다.
const LINE_ITEMS = Object.freeze([
  Object.freeze({ key: 'fact', label: '사실' }),
  Object.freeze({ key: 'inferred', label: '추론' }),
  Object.freeze({ key: 'ambiguous', label: '불확실' }),
  Object.freeze({ key: 'hidden', label: '숨은 연관 — 군집을 넘는 연결' }),
]);

// 군집 이름이 확정 이름이 아닐 때 범례에 **한 번만** 붙는 캡션(보드 07 2QDY-2·2QE0-2).
// 버블마다 「· 추정」을 붙이지 않는 이유를 그 보드가 적어 두었다: 이름 파이프라인이
// 없는 실제 상태에서는 같은 꼬리표가 군집 수만큼 반복된다.
const ESTIMATED_NAME_CAPTION = '군집 이름은 대표 항목에서 추정';

// 성향 신호 한 줄의 확정성. summary-table.js dotClass()와 **같은 판정**이다
// (EXTRACTED+deterministic만 사실, AMBIGUOUS는 불확실, 나머지는 모름) — 보드 07이
// 「성향 신호 표와 같은 인코딩」이라고 못박았으므로 두 화면이 갈리면 안 된다.
function certaintyOfEntry(entry) {
  if (!entry) return 'unknown';
  if (entry.confidence === 'AMBIGUOUS') return 'uncertain';
  if (entry.confidence === 'EXTRACTED' && entry.tier === 'deterministic') return 'fact';
  return 'unknown';
}

// 한 엔티티에 신호가 여러 줄이면 **불확실이 이긴다**. 보드 07이 불확실을 「되물을
// 후보」라고 적었으므로, 체결발 사실 한 줄이 애매하다고 기록된 다른 줄을 덮으면
// 되물을 자리가 화면에서 사라진다. 신호가 한 줄도 없는 노드는 모름이다 — 같은 보드가
// 「성향 신호에 안 잡힌 구조 노드」를 그 칸에 넣었다.
const CERTAINTY_RANK = { uncertain: 2, fact: 1, unknown: 0 };

function certaintyByEntity(entries) {
  const by = new Map();
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const id = entry && entry.entity_id;
    if (id === undefined || id === null || id === '') continue;
    const key = String(id);
    const next = certaintyOfEntry(entry);
    const prev = by.get(key);
    if (prev === undefined || CERTAINTY_RANK[next] > CERTAINTY_RANK[prev]) by.set(key, next);
  }
  return by;
}

function el(name, className) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  return node;
}

function markItem(className, label, markClass) {
  const item = el('div', className);
  item.appendChild(el('span', markClass));
  const text = el('span', 'graph-legend-label');
  text.textContent = label;
  item.appendChild(text);
  return item;
}

// 범례 한 벌. container는 통째로 다시 채운다.
//
// options.estimatedNames — 군집 이름이 하나라도 확정 이름이 아니면 캡션을 한 번 붙인다.
function renderMapLegend(container, options) {
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);
  const opts = options || {};

  const wrap = el('div', 'graph-legend');

  const encoding = el('div', 'graph-legend-row');
  // 색 = 군집 — 표식은 군집 팔레트 네 칸(Paper 3VBW-1의 사각 넷 그대로).
  const clusters = el('div', 'graph-legend-item');
  const swatches = el('span', 'graph-legend-clusters');
  // 지도가 실제로 쓴 색만 넣는다 — 팔레트 전부를 그리면 없는 군집을 있다고 말한다.
  // 색을 정하는 함수는 지도가 갖고 있다(live-map.js clusterColor) — 여기서 다시
  // 구현하면 범례와 지도가 조용히 다른 색을 말한다.
  const clusterColor = window.AthenaLib.GraphLiveMap.clusterColor;
  for (const cluster of (Array.isArray(opts.clusters) ? opts.clusters : [])) {
    const chip = el('span', 'graph-legend-cluster-chip');
    chip.setAttribute('style', `background: ${clusterColor(cluster)}`);
    swatches.appendChild(chip);
  }
  clusters.appendChild(swatches);
  const clustersLabel = el('span', 'graph-legend-label');
  clustersLabel.textContent = '색 = 군집';
  clusters.appendChild(clustersLabel);
  encoding.appendChild(clusters);

  encoding.appendChild(markItem('graph-legend-item', '원 크기 = 연결 수', 'graph-legend-sizes'));
  for (const item of LINE_ITEMS) {
    encoding.appendChild(markItem('graph-legend-item', item.label, `graph-legend-line is-${item.key}`));
  }
  wrap.appendChild(encoding);

  const fills = el('div', 'graph-legend-row');
  for (const item of FILL_ITEMS) {
    fills.appendChild(markItem(
      'graph-legend-item graph-legend-fill-item', item.label, `graph-legend-fill is-${item.key}`,
    ));
  }
  if (opts.estimatedNames) {
    const caption = el('span', 'graph-legend-caption');
    caption.textContent = ESTIMATED_NAME_CAPTION;
    fills.appendChild(caption);
  }
  wrap.appendChild(fills);

  container.appendChild(wrap);
  return wrap;
}

const __exports = {
  certaintyOfEntry, certaintyByEntity, renderMapLegend,
  FILL_ITEMS, LINE_ITEMS, ESTIMATED_NAME_CAPTION,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphMapLegend = __exports;
}

})();
