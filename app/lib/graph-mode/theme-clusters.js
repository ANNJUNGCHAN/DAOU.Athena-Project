// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 테마 군집 섹션(보드 06 §8 / 07 §8-2). cluster-map 페이로드({nodes, cluster_cohesion})를
// 군집별로 집계해 카드로 그린다. 기존 3개 모듈(store/layout/render)이 다루지
// 않는 새 데이터(군집별 집계·이름)라 새 leaf 모듈로 둔다(원칙1) — 다만 집계
// 로직 자체는 cluster-layout.js의 groupByCluster를 그대로 호출해 재사용한다,
// 복붙하지 않는다.
//
// **이름 없는 군집(§0 발견1).** 군집에 이름을 붙이는 파이프라인이 백엔드
// 어디에도 없다 — 그래서 모든 군집의 name은 항상 null이고, "이름 없음" 배지를
// 정직하게 항상 붙인다. 이름 파이프라인이 생기면 groupThemeClusters()의 name
// 한 줄만 실값을 읽도록 바꾸면 된다.
//
// **경고 시각 언어 임계 규칙(§0 r5).** Paper는 이름 없는 군집을 "예외적 경고"
// (주황 톤)로 그렸다. 지금처럼 군집 전부(0/N)가 무명이면 그 경고를 전 카드에
// 적용하는 순간 "희귀 경고"가 "보편적 기본 상태"로 뒤집혀 오히려 정보가
// 왜곡된다 — 그래서 이름 붙은 군집 수가 0 < named < total일 때만 경고 스타일을
// 켠다. 지금(0/N)은 항상 중립 스타일이다.
//
// **응집도.** 스텝5-2가 backend에 cluster_cohesion을 추가했다 — 존재하면 그
// 값으로 진행바·"응집 0.NN"을 채우고, 없으면(구버전 backend) 진행바·수치를
// 생략하고 "N종목"만 표기한다(§0 정책, 지어낸 숫자 없음).

function el(name, className) {
  const node = document.createElement(name);
  if (className) node.setAttribute('class', className);
  return node;
}

// 임계 규칙(§0 r5) — 이름 붙은 군집 수가 0이거나 전체와 같으면 경고 스타일을
// 안 쓴다(둘 다 "보편 상태"라 예외 취급하면 오히려 정보가 왜곡된다).
function shouldWarnUnnamed(namedCount, totalCount) {
  return namedCount > 0 && namedCount < totalCount;
}

// cluster-map 페이로드를 군집별로 집계한다. -1(미분류, cluster-layout.js
// groupByCluster의 방어 코드)은 테마가 아니므로 제외한다 — 그래프 뷰 헤더
// (스텝9)가 "미분류 K"로 따로 보고한다.
function groupThemeClusters(payload) {
  const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
  if (nodes.length === 0) return [];
  const groups = window.AthenaLib.GraphClusterLayout.groupByCluster(nodes);
  const cohesionByCluster = (payload && payload.cluster_cohesion) || null;
  return groups
    .filter((group) => group.cluster !== -1)
    .map((group) => ({
      cluster: group.cluster,
      size: group.members.length,
      name: null, // §0 발견1 — 이름 파이프라인이 없다, 지어내지 않는다.
      cohesion: cohesionByCluster ? cohesionByCluster[group.cluster] : undefined,
    }));
}

function renderClusterCard(cluster, warnUnnamed) {
  const card = el('div', warnUnnamed ? 'theme-cluster-card is-unnamed-warn' : 'theme-cluster-card');

  const title = el('div', 'theme-cluster-title');
  const nameEl = el('span', 'theme-cluster-name');
  nameEl.textContent = cluster.name || `군집 ${cluster.cluster}`;
  title.appendChild(nameEl);
  if (!cluster.name) {
    const badge = el('span', 'theme-cluster-unnamed-badge');
    badge.textContent = '이름 없음';
    title.appendChild(badge);
  }
  card.appendChild(title);

  const count = el('span', 'theme-cluster-count');
  count.textContent = `${cluster.size}종목`;
  card.appendChild(count);

  // 응집도는 스텝5-2 채택 여부에 따라 있을 수도 없을 수도 있다 — 없으면
  // 진행바·수치를 아예 생략한다(지어낸 숫자 없음, §0 정책).
  if (Number.isFinite(cluster.cohesion)) {
    const row = el('div', 'theme-cluster-bar-row');
    const track = el('div', 'theme-cluster-bar');
    const fill = el('div', `theme-cluster-bar-fill${warnUnnamed ? ' is-warn' : ''}`);
    const pct = Math.max(0, Math.min(100, Math.round(cluster.cohesion * 100)));
    // .style.width가 아니라 속성으로 쓴다 — render.js/summary-table.js와 같은
    // setAttribute 관례(el() 참고), fake-dom.js가 .style 프록시를 안 갖고 있다.
    fill.setAttribute('style', `width: ${pct}%`);
    track.appendChild(fill);
    row.appendChild(track);

    const value = el('span', `theme-cluster-cohesion${warnUnnamed ? ' is-warn' : ''}`);
    value.textContent = `응집 ${cluster.cohesion.toFixed(2)}`;
    row.appendChild(value);
    card.appendChild(row);
  }

  return card;
}

// 순수 렌더 — clusters는 이미 groupThemeClusters()가 만든 배열(또는 테스트용
// 모의 배열). container는 통째로 다시 채운다. totalCount(선택)는 헤더의
// "N개 중 M개" 문구용 — 없으면 clusters.length로 대신한다(잘려서 fetch됐을
// 가능성을 배제하지 않는다).
function renderThemeClusters(container, clusters, options) {
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);
  const list = Array.isArray(clusters) ? clusters : [];
  if (list.length === 0) return null;

  const opts = options || {};
  const limit = Number.isInteger(opts.limit) ? opts.limit : 3; // 보드 06/07 — 카드 3개
  const shown = list.slice(0, limit);
  const totalCount = Number.isFinite(opts.totalCount) ? opts.totalCount : list.length;

  const namedCount = shown.filter((c) => c.name).length;
  const warnUnnamed = shouldWarnUnnamed(namedCount, shown.length);

  const wrap = el('div', 'theme-clusters');
  const head = el('div', 'theme-clusters-head');
  const title = el('span', 'theme-clusters-title');
  title.textContent = '테마 군집';
  head.appendChild(title);
  const subtitle = el('span', 'theme-clusters-subtitle');
  subtitle.textContent = `${totalCount}개 중 ${shown.length}개`;
  head.appendChild(subtitle);
  wrap.appendChild(head);

  const cardRow = el('div', 'theme-cluster-cards');
  for (const cluster of shown) {
    cardRow.appendChild(renderClusterCard(cluster, warnUnnamed && !cluster.name));
  }
  wrap.appendChild(cardRow);

  container.appendChild(wrap);
  return wrap;
}

const __exports = {
  groupThemeClusters,
  shouldWarnUnnamed,
  renderThemeClusters,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ThemeClusters = __exports;
}

})();
