// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드 헤더의 필터(보드 01/02 "최근 90일 · 보강 순", 보드 03/04 "최근 90일 ·
// 보강 2회 이상")를 **실제로 거는** 순수 함수들.
//
// **왜 지금까지 정적 라벨이었나.** Paper가 활성/비활성 시각차와 상호작용 스펙을
// 안 그려서 `shell.html`이 `<span class="filter-chip">최근 90일</span>`을 박아 뒀다.
// 그 결과 화면은 "최근 90일"이라고 **주장**하면서 전체 기간 그래프를 그리고 있었다 —
// 안 되는 컨트롤보다 나쁜 것은 거짓말하는 라벨이다.
//
// **지도의 두 번째 칩이 "보강"이 아니라 "연결"인 이유.** 보강 횟수는 투자자 프로필에
// 걸린 관계에만 있는 값(`profile-summary.reinforcement`)이고, 군집 지도가 받는
// `cluster-map`에는 없다. 지도에서 "보강 2회 이상"이라고 쓰면 걸 수 없는 조건을
// 건 척하는 것이라, 지도가 실제로 가진 축인 **연결 수(degree)**로 바꿔 쓴다.
// 의도(약한 신호를 걷어내고 뼈대만 본다)는 Paper 그대로다.

const WINDOW_DAY_OPTIONS = [30, 90, 180, 365];
const MIN_DEGREE_OPTIONS = [0, 2, 3, 5];
const SORT_OPTIONS = ['reinforcement', 'recent'];

const DEFAULTS = Object.freeze({
  windowDays: 90,      // 보드 01/03의 "최근 90일" 그대로.
  minDegree: 0,        // 기본은 전부 — 처음 여는 사람에게 이미 걸린 필터를 숨기지 않는다.
  summarySort: 'reinforcement', // 보드 01의 "보강 순" 그대로.
});

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    windowDays: WINDOW_DAY_OPTIONS.includes(Number(source.windowDays))
      ? Number(source.windowDays) : DEFAULTS.windowDays,
    minDegree: MIN_DEGREE_OPTIONS.includes(Number(source.minDegree))
      ? Number(source.minDegree) : DEFAULTS.minDegree,
    summarySort: SORT_OPTIONS.includes(source.summarySort)
      ? source.summarySort : DEFAULTS.summarySort,
  };
}

// 성향 신호 표 정렬(보드 01 "보강 순"). 백엔드는 이미 보강 내림차순으로 주므로
// 그 경우는 순서를 건드리지 않는다 — 같은 값을 두 번 정렬하면 동점 처리 규칙이
// 백엔드와 어긋나 행이 이유 없이 자리를 바꾼다.
function sortEntries(entries, sort) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (sort !== 'recent') return list;
  return list.sort((a, b) => {
    const ta = Date.parse((a && a.observed_at) || '');
    const tb = Date.parse((b && b.observed_at) || '');
    // 파싱 불가는 맨 뒤로 — 없는 시각을 "아주 오래된 것"으로 취급하는 편이
    // "아주 최근"으로 올려 두는 것보다 덜 거짓말한다.
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    return tb - ta;
  });
}

// 군집 지도 페이로드에 기간·최소 연결 수를 건다.
//
// 순서가 중요하다: ① 기간 밖 엣지를 지우고 → ② 남은 엣지로 차수를 **다시 세고**
// → ③ 최소 연결 수 미만 노드를 지우고 → ④ 사라진 노드에 걸린 엣지를 지운다.
// 백엔드가 준 `degree`는 전체 기간 기준이라 ②를 건너뛰면 "연결 2개 이상"이라
// 써 놓고 화면엔 연결선 하나짜리 노드가 남는다.
//
// `observed_at`이 없는 엣지(구버전 backend)는 **남긴다** — 시각을 모른다고 해서
// 창 밖이라고 단정할 근거가 없다(§0 정책: 못 읽은 것과 없는 것은 다르다).
function applyGraphFilters(payload, filters, nowMs) {
  const settings = normalize(filters);
  const nodes = Array.isArray(payload && payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload && payload.edges) ? payload.edges : [];
  const details = Array.isArray(payload && payload.edge_details) ? payload.edge_details : [];
  if (nodes.length === 0) return payload;

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const cutoff = now - settings.windowDays * 86400000;
  const observedByPair = new Map();
  for (const detail of details) {
    if (!detail || detail.source == null || detail.target == null) continue;
    observedByPair.set(pairKey(detail.source, detail.target), detail.observed_at);
  }

  function withinWindow(pair) {
    const observed = observedByPair.get(pairKey(pair[0], pair[1]));
    if (!observed) return true; // 시각을 모르면 거르지 않는다.
    const t = Date.parse(observed);
    return !Number.isFinite(t) || t >= cutoff;
  }

  let keptEdges = edges.filter((pair) => Array.isArray(pair) && pair.length === 2 && withinWindow(pair));

  // ②③④ — 최소 연결 수는 지우면 다른 노드의 차수도 줄어드는 연쇄라 안정될
  // 때까지 반복한다(한 번만 돌리면 "2개 이상"을 통과한 노드가 이웃이 사라져
  // 1개가 된 채 남는다).
  let keptNodeIds = new Set(nodes.map((n) => String(n.entity_id)));
  if (settings.minDegree > 0) {
    for (;;) {
      const degree = new Map();
      for (const [a, b] of keptEdges) {
        if (!keptNodeIds.has(String(a)) || !keptNodeIds.has(String(b))) continue;
        degree.set(String(a), (degree.get(String(a)) || 0) + 1);
        degree.set(String(b), (degree.get(String(b)) || 0) + 1);
      }
      const next = new Set([...keptNodeIds].filter((id) => (degree.get(id) || 0) >= settings.minDegree));
      if (next.size === keptNodeIds.size) break;
      keptNodeIds = next;
      if (keptNodeIds.size === 0) break;
    }
  }
  keptEdges = keptEdges.filter(([a, b]) => keptNodeIds.has(String(a)) && keptNodeIds.has(String(b)));

  // 화면에 남은 것만으로 차수를 다시 센다 — 노드 크기가 "지금 보이는 연결 수"를
  // 말하게 하려면 여기서 갈아 끼워야 한다.
  const finalDegree = new Map();
  for (const [a, b] of keptEdges) {
    finalDegree.set(String(a), (finalDegree.get(String(a)) || 0) + 1);
    finalDegree.set(String(b), (finalDegree.get(String(b)) || 0) + 1);
  }

  return {
    ...payload,
    nodes: nodes
      .filter((n) => keptNodeIds.has(String(n.entity_id)))
      .map((n) => ({ ...n, degree: finalDegree.get(String(n.entity_id)) || 0 })),
    edges: keptEdges,
    edge_details: details.filter((d) => d && keptNodeIds.has(String(d.source)) && keptNodeIds.has(String(d.target))),
  };
}

function pairKey(a, b) {
  const [x, y] = String(a) < String(b) ? [a, b] : [b, a];
  return `${String(x)} ${String(y)}`;
}

// 칩 라벨 — select의 선택지 텍스트이자 Paper의 칩 문구다.
function windowLabel(days) {
  return `최근 ${days}일`;
}

function minDegreeLabel(minDegree) {
  // 기본값 문구가 "연결 전체"였다 — 무슨 필터인지 안 읽힌다(2026-09-03 실사용:
  // 이 칩을 찾지 못했다. "최소 연결 수"는 aria-label에만 있고 화면에는 없었다).
  // "제한 없음"이라고 쓰면 이것이 **거는 조건**이고 지금은 안 걸려 있다는 두 가지가
  // 함께 읽힌다. 걸린 상태의 문구("연결 3개 이상")와 같은 어휘를 유지한다.
  return minDegree > 0 ? `연결 ${minDegree}개 이상` : '연결 제한 없음';
}

function sortLabel(sort) {
  return sort === 'recent' ? '최근 순' : '보강 순';
}

const __exports = {
  WINDOW_DAY_OPTIONS,
  MIN_DEGREE_OPTIONS,
  SORT_OPTIONS,
  DEFAULTS,
  normalize,
  sortEntries,
  applyGraphFilters,
  windowLabel,
  minDegreeLabel,
  sortLabel,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphFilters = __exports;
}

})();
