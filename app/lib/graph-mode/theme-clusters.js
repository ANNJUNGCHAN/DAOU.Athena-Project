// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 테마 군집 섹션(보드 06 §8 / 07 §8-2). cluster-map 페이로드({nodes, cluster_cohesion})를
// 군집별로 집계해 카드로 그린다. 기존 3개 모듈(store/layout/render)이 다루지
// 않는 새 데이터(군집별 집계·이름)라 새 leaf 모듈로 둔다(원칙1) — 다만 집계
// 로직 자체는 cluster-grouping.js의 groupByCluster를 그대로 호출해 재사용한다,
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
  const groups = window.AthenaLib.ClusterGrouping.groupByCluster(nodes);
  const cohesionByCluster = (payload && payload.cluster_cohesion) || null;
  const representativeByCluster = (payload && payload.cluster_representative_labels) || null;
  const aiLabelByCluster = (payload && payload.cluster_ai_labels) || null;
  return groups
    .filter((group) => group.cluster !== -1)
    .map((group) => ({
      cluster: group.cluster,
      size: group.members.length,
      name: null, // §0 발견1 — 이름 파이프라인이 없다, 지어내지 않는다.
      cohesion: cohesionByCluster ? cohesionByCluster[group.cluster] : undefined,
      // 제목 사다리의 마지막 실단서 — 지도와 같은 값을 쓴다(위 representativeName).
      representative: window.AthenaLib.ClusterGrouping.representativeName(group.members)
        || (representativeByCluster ? representativeByCluster[group.cluster] : undefined),
      // WP-F — LLM이 지은 **추정 이름**. name을 대체하지 않는다(아직 의미적으로
      // 100% 신뢰 가능한 이름이 아니다, G-F7) — "이름 없음" 배지·namedCount
      // 판정은 계속 name만 본다. 없으면(휴면·실패·구버전 backend) undefined.
      aiLabel: aiLabelByCluster ? aiLabelByCluster[group.cluster] : undefined,
    }));
}

// 카드 제목도 지도 버블과 **같은 폴백 사다리**를 쓴다(render.js clusterTitle):
// name → AI 추정 → 규칙 기반 대표 → "이름 없는 군집". 두 화면이 같은 군집을
// 다른 이름으로 부르면 사용자는 다른 군집으로 읽는다. 옛 판은 여기서만 "군집 0"
// + "이름 없음" 배지를 썼고, 그 결과 요약 카드는 "군집 0"인데 지도는 "미국 지수
// ETF · 추정"이었다(실측).
function clusterCardTitle(cluster) {
  if (cluster.name) return { text: cluster.name, estimated: false };
  if (cluster.aiLabel) return { text: cluster.aiLabel, estimated: true };
  if (cluster.representative) return { text: cluster.representative, estimated: true };
  return { text: '이름 없는 군집', estimated: false };
}

function renderClusterCard(cluster, warnUnnamed, badgeEstimated) {
  const card = el('div', warnUnnamed ? 'theme-cluster-card is-unnamed-warn' : 'theme-cluster-card');

  const title = el('div', 'theme-cluster-title');
  const heading = clusterCardTitle(cluster);
  const nameEl = el('span', heading.estimated ? 'theme-cluster-name is-estimated' : 'theme-cluster-name');
  nameEl.textContent = heading.text;
  title.appendChild(nameEl);
  // 배지는 섞여 있을 때만 — 전부 추정이면 섹션 헤더가 한 번 말한다(renderThemeClusters).
  if (heading.estimated && badgeEstimated) {
    const badge = el('span', 'theme-cluster-unnamed-badge');
    badge.textContent = '추정';
    title.appendChild(badge);
  }
  // 종목 수는 제목 줄의 오른쪽 끝에 붙는다(보드 01) — 이름과 수가 한 줄에 있어야
  // 카드 하나가 두 줄(제목+막대)로 끝난다. 별도 줄로 빼면 카드가 세 줄이 되어
  // 세 장을 세로로 쌓았을 때 표 아래가 스크롤 없이는 안 보인다(실측).
  const count = el('span', 'theme-cluster-count');
  count.textContent = `${cluster.size}종목`;
  title.appendChild(count);
  card.appendChild(title);

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

    // 백분율로 적는다(2026-09-03) — 예전에는 `응집 0.29`처럼 backend의 원시 값을
    // 그대로 찍었다. 0~1 스케일이라는 것을 화면이 어디서도 말하지 않아 0.29가
    // 무엇에 대한 0.29인지 읽히지 않았다(실사용 제보). 히어로가 이미 %로 말하고
    // (사실 69% · 추론 25%) 바로 옆 진행바도 같은 값의 %라, %가 이 화면의 어휘다.
    // pct는 위에서 바가 쓰는 값 그대로다 — 바와 숫자가 다른 값을 말하면 안 된다.
    const value = el('span', `theme-cluster-cohesion${warnUnnamed ? ' is-warn' : ''}`);
    value.textContent = `응집 ${pct}%`;
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
  // 큰 군집 순으로 자른다(2026-09-03). groupByCluster는 **군집 id 순**으로 정렬하므로
  // (cluster-grouping.js — `a[0] - b[0]`) 예전에는 slice(0,3)이 "내부 id가 낮은 3개"를
  // 뽑았다. 화면은 "7개 중 3개"라고 쓰는데 그 3개가 아무 기준도 아니었다 —
  // 숨은 연관이 가나다순으로 뽑히던 것과 같은 계열의 결함이다(analysis.py 참고).
  // id는 동점일 때의 결정적 tie-break로만 남긴다.
  const ranked = [...list].sort((a, b) => (
    (b.size || 0) - (a.size || 0) || (a.cluster || 0) - (b.cluster || 0)
  ));
  const shown = ranked.slice(0, limit);
  const totalCount = Number.isFinite(opts.totalCount) ? opts.totalCount : list.length;

  const namedCount = shown.filter((c) => c.name).length;
  const warnUnnamed = shouldWarnUnnamed(namedCount, shown.length);
  // '추정' 배지는 **섞여 있을 때만** 붙인다(2026-09-03 사용자 지적 "굳이 추정이라는
  // 배지가 항상 붙어있을 필요가 있는지는 모르겠어"). 이름 파이프라인이 없어(§0 발견1)
  // name은 늘 null이고, 그래서 거의 모든 카드가 추정이었다 — 전부에 붙는 배지는
  // 아무것도 구분하지 못하면서 이름 옆자리를 먹는다. 바로 위 shouldWarnUnnamed와
  // 같은 임계 규칙이다(0이거나 전부면 예외 표시를 쓰지 않는다).
  const estimatedCount = shown.filter((c) => clusterCardTitle(c).estimated).length;
  const badgeEstimated = estimatedCount > 0 && estimatedCount < shown.length;

  const wrap = el('div', 'theme-clusters');
  const head = el('div', 'theme-clusters-head');
  const title = el('span', 'theme-clusters-title');
  title.textContent = '테마 군집';
  head.appendChild(title);
  const subtitle = el('span', 'theme-clusters-subtitle');
  // 무엇을 골랐는지 밝힌다 — "7개 중 3개"만으로는 그 3개가 어떻게 뽑힌 것인지
  // 알 수 없다(그리고 예전에는 실제로 아무 기준도 아니었다, 위 ranked 주석).
  subtitle.textContent = totalCount > shown.length
    ? `${totalCount}개 중 가장 큰 ${shown.length}개`
    : `${shown.length}개`;
  head.appendChild(subtitle);
  // 전부 추정이면 배지를 카드마다 붙이는 대신 여기서 한 번 말한다(위 badgeEstimated).
  if (estimatedCount === shown.length && shown.length > 0) {
    const estimatedNote = el('span', 'theme-clusters-subtitle');
    estimatedNote.textContent = '이름은 추정';
    head.appendChild(estimatedNote);
  }
  wrap.appendChild(head);

  const cardRow = el('div', 'theme-cluster-cards');
  for (const cluster of shown) {
    cardRow.appendChild(renderClusterCard(cluster, warnUnnamed && !cluster.name, badgeEstimated));
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
