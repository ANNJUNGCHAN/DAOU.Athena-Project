// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드를 화면에 붙이는 배선. 상태(`graph-mode-store`)·배치(`cluster-layout`)·
// 그리기(`render`)는 각자 순수하고, 이 파일이 셋을 DOM과 백엔드에 잇는다.
//
// **의존을 전부 주입받는다.** DOM 노드도 fetch도 전역에서 집어오지 않는다 — 그래야
// Electron 없이 테스트할 수 있고, 이 리포는 이미 그 방식을 쓴다(history-badge.test.js).
//
// **리비전이 같으면 다시 그리지 않는다.** 백엔드가 군집을 캐시하므로 응답은 싸지만,
// 같은 그림을 다시 그리면 SVG가 통째로 교체되어 화면이 깜빡인다.

// 그래프 뷰 헤더 메타 텍스트(보드 14 §1.2/15 §2.2, 스텝9) — state.stage로
// 분기한다. 1단계('clusters'): "군집 N개 · 엔티티 M · 미분류 K" — K는 §0
// 발견5의 방어 코드(cluster-layout.js groupByCluster가 이미 -1로 묶어 둔 것)를
// 그대로 센다. 2단계('expanded'): "엔티티 M · 관계 E · 군집 N" — 순서가
// 바뀌고 미분류가 빠지며 관계 수(필터 전 원본 payload.edges)가 새로 들어간다
// (Paper 표 그대로). 모듈 스코프 순수 함수라 stage는 문자열 리터럴로 비교한다
// (graph-mode-store.js의 STAGE_EXPANDED 값과 반드시 같아야 한다 — 이 파일이
// createGraphModeController(deps) 밖에서도 테스트 가능해야 해서 store 주입에
// 기대지 않는다).
function computeGraphHeaderMeta(stage, payload, placed) {
  if (!payload || !placed) return '';
  const entityCount = Array.isArray(payload.nodes) ? payload.nodes.length : 0;
  // 미분류(-1)는 군집이 아니다 — 같은 문장 뒤쪽에서 "미분류 K"로 따로 세므로,
  // 앞의 군집 수에도 넣으면 같은 노드 뭉치를 두 번 말하게 된다(실측: 실제 군집이
  // 7개인데 헤더가 "군집 8개"라고 했다).
  const clusterCount = Array.isArray(placed.clusters)
    ? placed.clusters.filter((c) => c.cluster !== -1).length
    : 0;
  if (stage === 'expanded') {
    const relationCount = Array.isArray(payload.edges) ? payload.edges.length : 0;
    return `엔티티 ${entityCount} · 관계 ${relationCount} · 군집 ${clusterCount}`;
  }
  const unassignedCount = Array.isArray(placed.nodes)
    ? placed.nodes.filter((n) => n.cluster === -1).length
    : 0;
  return `군집 ${clusterCount}개 · 엔티티 ${entityCount} · 미분류 ${unassignedCount}`;
}

// ── 엔티티 타임라인(§10-4 최근 변화, WP-G) — 순수 헬퍼 3벌 ────────────────────
//
// computeGraphHeaderMeta와 같은 이유로 모듈 스코프 순수 함수다 —
// createGraphModeController(deps) 밖에서도 테스트 가능해야 한다.

// 날짜는 절대 MM-DD(G-G1, Paper 15 §2.5 실측 — Geist Mono 44px 고정폭 열).
// relativeDaysText(summary-table.js)와 다른 포맷인 이유: Paper가 명시적으로
// 절대 날짜를 그렸고 원칙3(Paper 우선)이 앱 내부 관례보다 앞선다.
// 파싱 불가면 빈 문자열 — 지어내지 않는다.
function formatEventDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// relation 한글 사전(G-G5: 이 패널 로컬 상수 — 공유 모듈화는 실사용 후 필요성
// 확인 시 후속). 어휘는 백엔드 RelationKind(ontology.py:78-95) 전체를 덮고,
// 미등록 relation은 원문 그대로 폴백한다(summary-table.js 기존 관례와 동일 —
// 지어낸 한글을 강제하지 않음).
// ── 정적 렌더러가 남기고 간 순수 함수들(2026-09-02) ─────────────────────────
// render.js / cluster-layout.js를 지우면서, 그리기와 무관한데 **공통 패널이 계속
// 쓰는** 것만 여기로 옮겼다. 좌표 계산은 통째로 버렸다 — 라이브 지도가 자기 좌표를
// 정하므로 배치 결과가 더는 필요 없고, 남은 것은 "무엇이 몇 개인가"뿐이다.

// 군집 제목 사다리(옛 render.clusterTitle). 확정 이름 → AI 추정 → 대표 멤버 →
// 없음. 추정인지 아닌지를 함께 돌려주는 것이 요점이다(화면이 "· 추정"을 붙인다).
function clusterTitle(cluster) {
  if (cluster.name) return { text: cluster.name, estimated: false };
  if (cluster.aiLabel) return { text: cluster.aiLabel, estimated: true };
  if (cluster.representative) return { text: cluster.representative, estimated: true };
  return { text: '이름 없는 군집', estimated: false };
}

function entityPairKey(a, b) {
  const [x, y] = String(a) < String(b) ? [a, b] : [b, a];
  return `${x} ${y}`;
}

const RELATION_LABELS = {
  relates_to: '연관',
  interested_in: '관심',
  prefers: '선호',
  owns: '보유',
  traded: '매매',
  researched: '탐색',
  belongs_to: '소속',
  exposed_to: '노출',
  avoids: '회피',
  targets: '목표',
};

// confidence 한글 라벨 — 원래 createGraphModeController 안(패널 티어 대조 카드
// 전용)에 있던 것을 타임라인 문구 조립(timelineEventText)과 공유하려고 모듈
// 스코프로 올렸다. 값은 그대로다(Paper 행2 "추론 → 사실로 승격"이 정확히 이 어휘).
const PANEL_CONFIDENCE_LABELS = { EXTRACTED: '사실', INFERRED: '추론', AMBIGUOUS: '불확실' };

// entity kind 한글 라벨 — 요약 표(summary-table.js ENTITY_KIND_LABELS)와 같은
// 어휘여야 표에서 고른 것과 패널에 뜬 것이 같은 말로 불린다. 배지에 `preference`
// 같은 원문이 그대로 뜨던 결함을 막는다(실측).
const PANEL_KIND_LABELS = {
  security: '종목', company: '기업', sector: '섹터', theme: '테마',
  goal: '목표', preference: '성향', risk_signal: '위험 신호', investor_profile: '프로필',
};

// confidence 위계(edge_changed의 "승격" 판정 전용) — 상승만 "…로 승격"(G-G4),
// 하강·동일·한쪽 미상은 전부 방어적 중립 "신뢰도 변경"으로 통일한다.
const CONFIDENCE_RANK = { AMBIGUOUS: 0, INFERRED: 1, EXTRACTED: 2 };

// 조사 '로/으로' — 받침이 없거나 ㄹ 받침이면 '로', 그 외에는 '으로'다.
// 라벨이 '사실'·'불확실'(ㄹ 받침)일 때는 맞았는데 '추론'(ㄴ 받침)에서 "추론로 승격"이
// 나왔다(2026-09-03 화면 실측). 한글 음절의 종성 인덱스는 (코드 − 0xAC00) % 28이고
// 0이면 받침 없음, 8이면 ㄹ이다(brain-questions.js hasJongseong과 같은 계산이지만
// 그 함수는 받침 유무만 보므로 ㄹ 예외를 알 수 없어 여기서 따로 판정한다).
function roParticle(word) {
  const last = String(word || '').slice(-1);
  const code = last.charCodeAt(0);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return '로'; // 한글이 아니면 그대로
  const jongseong = (code - 0xac00) % 28;
  return (jongseong === 0 || jongseong === 8) ? '로' : '으로';
}

// GraphEventOp별 문구 조립(G-G6 초안 그대로 채택 — Paper 대응 사례가 없는 op는
// GraphEventOp 주석 의미로 직역). entity_added의 대화 제목 인용구는 backend에
// 대응 필드가 없어 조립하지 않는다(G-G3, §0 정직성 원칙).
function timelineEventText(event) {
  const rel = event.relation ? (RELATION_LABELS[event.relation] || event.relation) : '';
  switch (event.op) {
    case 'entity_added': return '노드 처음 생김';
    case 'entity_removed': return '노드 제거됨';
    case 'entity_merged': return '다른 노드와 병합됨';
    case 'edge_added': return rel ? `관계 추가됨(${rel})` : '관계 추가됨';
    case 'edge_removed': return rel ? `관계 제거됨(${rel})` : '관계 제거됨';
    case 'edge_rejected': return rel ? `제안된 관계가 기각됨(${rel})` : '제안된 관계가 기각됨';
    case 'edge_changed': {
      const before = event.confidence_before;
      const after = event.confidence_after;
      const prefix = rel ? `${rel} 관계 ` : '관계 ';
      if (before && after && CONFIDENCE_RANK[after] > CONFIDENCE_RANK[before]) {
        const beforeLabel = PANEL_CONFIDENCE_LABELS[before] || before;
        const afterLabel = PANEL_CONFIDENCE_LABELS[after] || after;
        return `${prefix}${beforeLabel} → ${afterLabel}${roParticle(afterLabel)} 승격`;
      }
      return `${prefix}신뢰도 변경`;
    }
    default: return event.op; // 미등록 op도 원문 폴백 — relation 폴백과 같은 규칙.
  }
}

// EntityEventOut[] → 패널 행 [{date, text}] — 렌더(G3)가 그대로 소비한다.
// 같은 날 같은 문구가 잇달아 나오면 한 줄로 접고 횟수를 적는다. 적재가 한 번에
// 여러 소스를 처리하면 "선호 관계 신뢰도 변경"이 같은 날짜로 네 줄 반복되는데
// (실측), 네 줄은 한 줄보다 정보가 많지 않으면서 자리는 네 배를 쓴다. 접힌
// 횟수를 적으므로 사건 수는 잃지 않는다.
function buildTimelineRows(events) {
  if (!Array.isArray(events)) return [];
  const rows = [];
  for (const event of events.filter(Boolean)) {
    const date = formatEventDate(event.at);
    const text = timelineEventText(event);
    const last = rows[rows.length - 1];
    if (last && last.date === date && last.text === text) {
      last.count += 1;
      continue;
    }
    rows.push({ date, text, count: 1 });
  }
  return rows;
}

// 관계별 보강 횟수(보드 04 관계 목록의 우측 숫자) — 타임라인 이벤트에서
// (관계, 상대 노드) 쌍이 몇 번 기록됐는지 센다. profile-summary의 `reinforcement`가
// 쓰는 것과 같은 자료(graph_events)라 두 화면의 "보강"이 같은 뜻이다.
// 이벤트를 못 읽었거나 그 쌍이 없으면 키가 없다 — 0을 지어내지 않는다.
function countRelationEvents(events) {
  const counts = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !event.object_id || !event.relation) continue;
    const key = `${event.relation} ${event.object_id}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

// 숨은 연관 근거 문장(보드 04 "왜 숨은 연관인가") — Paper의 세 절을 전부 실데이터로
// 만든다. 지어낸 절은 없다: 근거가 없는 절은 아예 빠진다(§0 정책).
//   ① "두 군집을 잇는 유일한 연결"  — 그 군집 쌍을 잇는 엣지가 정확히 1개일 때
//   ② "주변부(N)에서 허브(M)로"     — 양 끝 차수가 다를 때(작은 쪽이 주변부)
//   ③ "직접 말한 적 없음"           — 그 엣지의 confidence가 EXTRACTED가 아닐 때
function hiddenLinkReasonClauses({ crossingEdgeCount, sourceDegree, targetDegree, confidence }) {
  const clauses = [];
  if (crossingEdgeCount === 1) clauses.push('두 군집을 잇는 유일한 연결');
  if (Number.isFinite(sourceDegree) && Number.isFinite(targetDegree) && sourceDegree !== targetDegree) {
    const low = Math.min(sourceDegree, targetDegree);
    const high = Math.max(sourceDegree, targetDegree);
    clauses.push(`주변부(${low})에서 허브(${high})로`);
  }
  if (confidence && confidence !== 'EXTRACTED') clauses.push('직접 말한 적 없음');
  return clauses;
}

// 숨은 연관 강조 상한(보드 03 실측 — 핑크 점선은 지도에 **하나**뿐이다).
//
// backend의 `surprising_connections`는 군집 경계를 넘는 엣지를 **전부** 낸다.
// 작은 그래프에서는 군집이 바로 그 경계를 따라 갈리므로 거의 모든 종목↔테마
// 연결이 여기 걸린다 — 실측에서 지도의 연결선 8개가 전부 핑크였고, 그러면
// "예외"라는 뜻이 사라진다(모두가 예외면 아무도 예외가 아니다).
//
// 그래서 요약 뷰의 "숨은 연관" 카드가 보여주는 개수와 **같은 상한**을 지도와
// 패널에도 건다: 화면들이 같은 세 연결을 가리키게 된다. 순위는 backend가 매긴
// surprise_score를 그대로 쓰고, 동점은 이름으로 끊는다(다시 열어도 같은 셋).
const SURPRISING_HIGHLIGHT_LIMIT = 3;

function topSurprising(connections, limit) {
  const list = Array.isArray(connections) ? connections.filter(Boolean) : [];
  const cap = Number.isInteger(limit) ? limit : SURPRISING_HIGHLIGHT_LIMIT;
  return list
    .slice()
    .sort((a, b) => {
      const sa = Number.isFinite(a.surprise_score) ? a.surprise_score : -Infinity;
      const sb = Number.isFinite(b.surprise_score) ? b.surprise_score : -Infinity;
      if (sa !== sb) return sb - sa;
      return String(a.source_name || a.source_entity_id)
        .localeCompare(String(b.source_name || b.source_entity_id));
    })
    .slice(0, cap);
}

// 놀라움 표기 — 숫자를 적지 않는다(2026-09-03).
//
// 예전에는 Paper의 0~10 스케일(보드 01/02/04 "8.5")에 맞춰 `상대 ${score*10}`을
// 적었다. 그런데 backend의 surprise_score는 min-max 정규화라 1등은 **언제나** 1.0이고
// 교차 다리가 전부 동점이면 전부 1.0이다(analysis.py — hi == lo면 모두 1.0). 그래서
// 화면에 "상대 10.0"이 찍혔다: 라벨은 '상대'인데 순위 정보가 0이고, 10.0은 §0이
// 금지한 절대 점수처럼 읽힌다. 목록 쪽은 자리 순위("1순위")로 바꿨고(hidden-links.js)
// 여기는 노드 하나를 보는 자리라 순위 숫자가 뜻이 없다 — isTop만 말한다.
//
// 0은 "이 목록 안에서 가장 덜 놀랍다"는 뜻이라 여전히 아무 말도 하지 않는다.
function relativeScoreText(score) {
  if (!Number.isFinite(score) || score <= 0) return '';
  return '이 그래프에서 놀라운 연결에 듭니다';
}

function createGraphModeController(deps) {
  const {
    store,          // graph-mode-store
    grouping,       // cluster-grouping — 군집 집계(좌표 없음). 요약 뷰와 같은 구현을 쓴다.
    prefs,          // graph-mode-prefs (선택)
    elements,       // { summary, graph(가시성 전용 — applyVisibility()만 소유),
                    //   graphBody(렌더·클릭위임·크기측정 전용), summaryTable(선택 —
                    //   보드 07 성향 신호 표, 가시성 전용), panel(선택) — 보드 07/15의
                    //   "공통 패널", graphHeaderMeta(선택) — 보드 14/15 헤더 메타
                    //   텍스트(스텝9), mapGuide(선택) — 지도 안내 바(스텝9, 1단계 전용),
                    //   backtest(선택 — 5번째 모드 표면 #backtestCanvas, D4) — 안 들어오면
                    //   다른 선택 elements와 같은 계약으로 조용히 무시된다 }
    fetchClusterMap, // async () => payload
    onError,        // (err) => void (선택)
    onPanelCta,     // () => void (선택) — 공통 패널 CTA "채팅에서 답하기" 클릭 시(스텝8)
    // 스텝14 — 스텝11(숨은 연관 군집 쌍)·13(숨은 연관 엔티티 쌍)이 캡able로만
    // 만들어 뒀던 옵션을 실제로 채우는 두 소스. 둘 다 선택(없으면 그 기능이
    // 조용히 꺼진다 — §0 정직한 빈 데이터와 같은 논리) — canvas.js가 이미
    // loadHiddenLinks()/profile-summary 표 로드로 fetch해 둔 결과를 그대로
    // 캐시로 얹는다(이중 fetch 금지, 리드 지침).
    getSurprisingConnections, // () => connections[] (선택) — surprising-connections 원본.
    getProfileSummaryEntries, // () => entries[] (선택) — profile-summary 원본.
    // §10-4 최근 변화(WP-G) — 위 두 소스와 달리 동기 캐시가 아니라 entity_id별
    // IPC 왕복이 필요한 호출당 API라 async 함수로 주입받는다. 없으면 섹션이
    // 조용히 꺼진다(다른 선택 주입과 같은 계약).
    fetchEntityTimeline,      // async (entityId) => events[] (선택) — entity-timeline 원본.
    // 보드 05 수집·노출 서브뷰 진입 훅(선택) — 이 파일은 그 카드를 직접 그리지
    // 않는다(collection-settings.js 소관). 언제 다시 그려야 하는지만 알린다.
    onEnterSettings,
    // 관계 목록의 삭제 손잡이(2026-09-03) — 이 모듈은 부르기만 하고 쓰기는
    // 호출자가 한다(순수 렌더 계약). 안 주면 손잡이를 안 그린다.
    onRelationDelete,          // () => void (선택)
    // 헤더 필터 칩(보드 03/04 "최근 90일 · 연결 N개 이상")의 실적용(선택).
    // 안 주면 필터가 없는 것처럼 전체를 그린다 — 다른 선택 주입과 같은 계약이다.
    filters,                  // graph-filters 모듈 (선택)
    getFilters,               // () => {windowDays, minDegree} (선택)
    // 군집 지도의 라이브 렌더러(2026-09-02, live-map.js) — 힘 시뮬레이션을 계속
    // 돌리는 두 번째 렌더러다. 안 주면 지금까지처럼 정적 SVG만 그린다(다른 선택
    // 주입과 같은 계약). 둘 다 있으면 setLive()가 고른다.
    //
    // 인스턴스가 아니라 **팩토리**를 받는다 — 라이브 뷰의 노드 클릭은 정적 뷰와
    // 똑같이 이 파일 안의 handleNodeClick으로 들어가야 같은 공통 패널이 열리는데,
    // 그 함수는 여기 안에 있다. 밖에서 만들어 넘기면 그 배선을 호출자가 흉내 내야 하고
    // 두 뷰의 선택 동작이 갈라진다.
    createLiveMap,            // ({container, onSelect}) => liveMap (선택)
  } = deps;

  let state = store.createInitialState();
  let lastDrawnRevision = null;
  let lastPlaced = null; // 마지막으로 받은 배치. 펼침·접기·선택은 새 fetch 없이 이걸 다시 필터링해서 그린다.
  // 그래프 뷰 헤더 메타 텍스트(보드 14/15, 스텝9)의 "관계 E"는 필터 전 원본
  // 엣지 수여야 한다 — lastPlaced.edges는 이미 유효한 것만 걸러진 배치
  // 결과라 다르다. payload를 따로 캐싱해 redraw 시에도 재사용한다.
  let lastPayload = null;
  // 브레인 상태를 아직 모르는 부팅 초반엔 "못 씀"으로 가정한다 — setAvailable(true)가
  // 오기 전에 그래프 모드로 들어오면 renderUnavailable()의 정직한 안내를 보여준다.
  let available = false;
  // 군집 지도는 **라이브 렌더러 하나뿐이다**(2026-09-02 결정). 잠깐 정적 SVG와
  // 토글로 공존시켰지만, 만져 본 뒤 라이브를 채택하고 정적을 폐기했다.
  let liveMap = null; // 처음 그릴 때 만든다.

  // 라이브 뷰의 노드 선택을 정적 뷰와 같은 경로로 넣는다. 군집 번호는 패널 부제
  // ("군집 N · 연결 M")가 쓰는 값이라 마지막 응답에서 찾아 넘긴다.
  function handleLiveSelect(entityId) {
    if (!entityId) {
      state = store.clearSelection(state);
      renderSelection();
      return;
    }
    const nodes = (lastPayload && Array.isArray(lastPayload.nodes)) ? lastPayload.nodes : [];
    const node = nodes.find((n) => String(n.entity_id) === String(entityId));
    handleNodeClick(entityId, node ? String(node.cluster) : null);
  }

  function ensureLiveMap() {
    if (liveMap || typeof createLiveMap !== 'function' || !elements.graphBody) return liveMap;
    liveMap = createLiveMap({ container: elements.graphBody, onSelect: handleLiveSelect });
    return liveMap;
  }

  function liveActive() {
    const map = ensureLiveMap();
    return Boolean(map && map.available());
  }

  // 보드 12d/US-007 — 답변⇄그래프⇄에이전트⇄플러그인⇄백테스트 다섯 표면의 가시성은
  // 전부 이 함수 하나가 소유한다(5중 배타 — 리프 1.2.2 사이드바 모드 네비). 부팅 시
  // 다른 어디서도(예: canvas.js의 brain-status 콜백) summaryTable 같은
  // 그래프 표면의 hidden을 직접 건드리지 않는다 — 소유자가 둘이면 브레인 준비
  // 타이밍에 따라 그래프 표면이 답변 모드에 새어 보이는 결함이 재발한다(실측,
  // 2026-08-26 — summaryTable이 graphView와 무관하게 ready만으로 보였다 지워졌다 했다).
  //
  // 스텝2-보정 — 요약 표/군집 지도 두 표면이 그래프 기능 안에서 동시에
  // hidden=false였던 옛 결함(둘 다 92% 불투명 카드라 뒤 레이어가 비쳤다)을
  // state.surface로 정식 해소한다. 이 함수가 여전히 유일한 hidden 소유자다 —
  // canvas.js의 z-index 임시조치(.graph-surface-back)는 걷어냈다.
  //
  // D4 정규화(2026-08-31, backtest-mode-plan.md §3.3) — 5번째 모드(backtest)를
  // 옛 삼항 사슬(OR 4항·삼항 4중첩)에 그대로 이어 붙이는 대신, 함수 본문 안에서만
  // view→표면 키 맵으로 바꿨다. graph만 surface 축(요약 표/군집 지도)이 하나 더
  // 있어 맵 밖 예외로 남는다 — summary/agent/plugin/backtest는 view와 표면이 1:1이다.
  function applyVisibility() {
    const graphView = store.isGraphView(state);
    // view → 표면 키. graph는 surface 축이 따로 있어(요약 표/군집 지도) 이 맵에
    // 넣지 않는다 — 아래 elements.graph/summaryTable 두 줄이 그 축을 그대로 맡는다.
    const SURFACE_BY_VIEW = {
      [store.VIEW_SUMMARY]: 'summary',
      [store.VIEW_AGENT]: 'agent',
      [store.VIEW_PLUGIN]: 'plugin',
      [store.VIEW_BACKTEST]: 'backtest',
    };
    const activeSurface = graphView ? null : SURFACE_BY_VIEW[state.view];
    if (elements.summary) elements.summary.hidden = graphView || activeSurface !== 'summary';
    if (elements.graph) elements.graph.hidden = !graphView || state.surface !== store.SURFACE_MAP;
    if (elements.agent) elements.agent.hidden = activeSurface !== 'agent';
    if (elements.plugin) elements.plugin.hidden = activeSurface !== 'plugin';
    if (elements.backtest) elements.backtest.hidden = activeSurface !== 'backtest';
    if (elements.summaryTable) elements.summaryTable.hidden = !graphView || state.surface !== store.SURFACE_SUMMARY;
    // 세 번째 서브뷰(보드 05 수집·노출) — 요약/지도와 같은 축이라 같은 규칙을 쓴다.
    if (elements.graphSettings) {
      elements.graphSettings.hidden = !graphView || state.surface !== store.SURFACE_SETTINGS;
    }
    // 키우미 얼굴(2026-08-27, Paper 보드 45) — 지금 모드를 얼굴로 보여준다
    // (대화=눈 · 그래프=온톨로지 별자리). CSS가 data-mode로 얼굴을 고른다 —
    // agent·backtest 얼굴은 아직 CSS에 없어 기본 얼굴로 폴백한다(보드 39~43·45 후속).
    const modeLabel = graphView ? 'graph' : (activeSurface === 'summary' ? 'chat' : activeSurface);
    if (elements.kiumi) elements.kiumi.dataset.mode = modeLabel;
    // 캔버스 빈 상태의 모드별 변형(보드 46) — CSS가 이 축으로 하나만 보여준다.
    // (모드 네비 활성 하이라이트는 lib/sidebar-mode-nav.js가 소유한다 — 리프 1.2.2.)
    if (elements.canvasRegion) elements.canvasRegion.dataset.mode = modeLabel;
    // 모드별 채팅 헤더(보드 38 개정) — 그래프·백테스트·플러그인 모드에서 보인다.
    // 대화 모드엔 헤더가 없다(보드 37). 문구는 data-mode와 함께 여기서 바꾼다 —
    // shell.html의 두 span은 비어 있고 이 표가 유일한 출처다.
    const CHAT_HEAD_COPY = {
      graph: { title: '그래프에게 묻기', sub: '답이 캔버스를 바꿉니다' },
      backtest: { title: '기법에게 묻기', sub: '고른 기법을 다룹니다' },
      plugin: { title: '아테나 · 플러그인 대화', sub: '설치와 권한을 여기서 정합니다' },
    };
    const chatHeadMode = graphView ? 'graph' : (CHAT_HEAD_COPY[activeSurface] ? activeSurface : null);
    if (elements.chatHead) {
      elements.chatHead.hidden = !chatHeadMode;
      if (chatHeadMode) {
        elements.chatHead.dataset.mode = chatHeadMode;
        if (elements.chatHeadTitle) elements.chatHeadTitle.textContent = CHAT_HEAD_COPY[chatHeadMode].title;
        if (elements.chatHeadSub) elements.chatHeadSub.textContent = CHAT_HEAD_COPY[chatHeadMode].sub;
      }
    }
  }

  // 브레인이 안 됐는데 그래프 모드로 들어오면 빈 캔버스 대신 이렇게 정직하게
  // 알린다 — 없는 것(성향 자체가 없다)과 못 읽은 것(브레인 미기동)은 다르다.
  function renderUnavailable(message) {
    if (!elements.graphBody) return;
    while (elements.graphBody.firstChild) elements.graphBody.removeChild(elements.graphBody.firstChild);
    const note = document.createElement('div');
    note.className = 'graph-mode-unavailable';
    note.textContent = message || '아직 성향을 읽을 수 없습니다 — 브레인이 준비되면 여기 그래프로 보입니다.';
    elements.graphBody.appendChild(note);
    lastDrawnRevision = null; // available해지면 실제 그림으로 다시 그리게 한다.
  }

  // 노드 클릭 하나가 지금 단계에 따라 다른 뜻이다(보드 15): 1단계에서는 그 노드가
  // 속한 군집을 펼치고, 2단계에서는 그 노드를 고른다 — 공통 패널이 연다.
  // 노드 클릭은 언제나 **선택**이다. 옛 정적 지도는 1단계에서 클릭을 "군집 펼침"으로
  // 가로챘지만(2단계 진입), 라이브 지도는 노드를 처음부터 전부 펴므로 펼칠 단계가
  // 없다 — 그 분기를 남겨두면 클릭이 선택 대신 아무 일도 안 한다(실측).
  function handleNodeClick(entityId) {
    selectNode(entityId);
  }

  // 지금 배치에서 노드 하나 찾기 — 관계 목록·근거 블록이 상대 노드의 이름/차수/
  // 군집을 읽는 데 쓴다.
  function findNode(entityId) {
    return lastPlaced && Array.isArray(lastPlaced.nodes)
      ? lastPlaced.nodes.find((n) => n.entity_id === entityId) || null
      : null;
  }

  // 군집 쌍을 잇는 엣지 수 — "두 군집을 잇는 유일한 연결" 판정의 근거(보드 04).
  // aggregateClusterEdges를 다시 부르지 않고 lastPlaced.edges를 직접 센다(1단계
  // 전용 clusterEdges는 2단계에서 최신이 아닐 수 있다).
  function countCrossingEdges(clusterA, clusterB) {
    if (!lastPlaced || !Array.isArray(lastPlaced.edges)) return null;
    if (!Number.isInteger(clusterA) || !Number.isInteger(clusterB) || clusterA === clusterB) return null;
    const clusterOf = new Map((lastPlaced.nodes || []).map((n) => [n.entity_id, n.cluster]));
    let count = 0;
    for (const edge of lastPlaced.edges) {
      const from = clusterOf.get(edge.from);
      const to = clusterOf.get(edge.to);
      if ((from === clusterA && to === clusterB) || (from === clusterB && to === clusterA)) count += 1;
    }
    return count;
  }

  // 그 군집에서 반대 군집으로 건너가는 노드가 이 노드 하나뿐인가(보드 04 선택
  // 헤더 "두 군집을 잇는 유일한 노드").
  function isOnlyBridgeNode(entityId, clusterA, clusterB) {
    if (!lastPlaced || !Array.isArray(lastPlaced.edges)) return false;
    if (!Number.isInteger(clusterA) || !Number.isInteger(clusterB) || clusterA === clusterB) return false;
    const clusterOf = new Map((lastPlaced.nodes || []).map((n) => [n.entity_id, n.cluster]));
    const bridges = new Set();
    for (const edge of lastPlaced.edges) {
      const from = clusterOf.get(edge.from);
      const to = clusterOf.get(edge.to);
      if (from === clusterA && to === clusterB) bridges.add(edge.from);
      else if (from === clusterB && to === clusterA) bridges.add(edge.to);
    }
    return bridges.size === 1 && bridges.has(entityId);
  }

  // 군집 제목 — 지도 타원과 같은 사다리(render.js clusterTitle)를 재사용한다.
  // 두 곳이 다른 이름을 부르면 사용자는 다른 군집으로 읽는다.
  function clusterTitleText(cluster) {
    const meta = lastPlaced && Array.isArray(lastPlaced.clusters)
      ? lastPlaced.clusters.find((c) => c.cluster === cluster)
      : null;
    if (!meta) return null;
    const title = clusterTitle(meta);
    return title.estimated ? `${title.text}(추정)` : title.text;
  }

  function selectNode(entityId) {
    const node = findNode(entityId);
    // profile-summary에 같은 entity_id가 있으면(그래프 노드와 성향 신호 표는
    // 서로 다른 엔드포인트라 항상 겹치진 않는다) 그 항목의 근거·신뢰도·보강
    // 수까지 얹는다 — table 선택 경로(summary-table.js의 panelDataFor())와
    // 같은 수준의 패널을 그래프 선택에서도 보여줄 수 있으면 보여준다(스텝14,
    // §0 정책 — 있는 걸 재사용할 뿐 지어내지 않는다).
    const profileEntry = typeof getProfileSummaryEntries === 'function'
      ? (getProfileSummaryEntries() || []).find((e) => e && e.entity_id === entityId)
      : null;
    const panelData = {
      entityId,
      source: 'node', // §15 선택 출처 태그 — summary-table.js의 'table'과 짝.
      name: (node && node.name) || (profileEntry && profileEntry.entity_name) || undefined,
      kind: (node && node.kind) || (profileEntry && profileEntry.entity_kind) || undefined,
      cluster: node ? node.cluster : undefined,
      degree: node ? node.degree : undefined,
      relation: profileEntry ? profileEntry.relation_kind : undefined,
      rationale: profileEntry ? profileEntry.rationale : undefined,
      reinforcement: profileEntry ? profileEntry.reinforcement : undefined,
      confidence: profileEntry ? profileEntry.confidence : undefined,
      tier: profileEntry ? profileEntry.tier : undefined,
      // 선택 헤더 부제(보드 04 "반도체 대형주 군집 · 연결 7 · 두 군집을 잇는
      // 유일한 노드") — 세 절 전부 실데이터에서 나온다, 없는 절은 빠진다.
      clusterTitle: node ? clusterTitleText(node.cluster) : undefined,
    };
    state = store.selectEntity(state, entityId, panelData);
    // 지도를 다시 그린다 — 선택 테두리(보드 04의 핑크 링)는 renderClusterMap이
    // 그리기 시점에 얹는 클래스라 패널만 갱신하면 지도에는 아무 표시도 안 난다
    // (실측: 노드를 눌러도 어느 노드를 골랐는지 지도에서 알 수 없었다).
    // redrawFromCache()가 renderSelection()까지 부르므로 여기서 따로 안 부른다.
    redrawFromCache();
  }

  // 선택 헤더 부제 조립. 출처(node/table)에 따라 말이 달라진다 — 보드 04는
  // 그래프에서 고른 노드라 "군집 · 연결 수"를, 보드 02는 표에서 고른 신호라
  // "보강 N회 · 최근 언제"를 쓴다.
  function panelHeaderSubtext(data) {
    const parts = [];
    if (data.source === 'node') {
      // 군집 제목이 이 노드 이름에서 온 경우(테마가 자기 군집의 대표일 때)
      // "배당·인컴(추정) 군집"처럼 같은 말을 두 번 하게 된다 — 그 절을 뺀다.
      const selfNamesCluster = Boolean(data.name)
        && String(data.clusterTitle || '').startsWith(String(data.name));
      if (data.clusterTitle && !selfNamesCluster) parts.push(`${data.clusterTitle} 군집`);
      if (Number.isFinite(data.degree)) parts.push(`연결 ${data.degree}`);
      const reason = buildHiddenLinkReason(data.entityId);
      if (reason && isOnlyBridgeNode(data.entityId, reason.selfCluster, reason.partnerCluster)) {
        parts.push('두 군집을 잇는 유일한 노드');
      }
    } else {
      if (Number.isFinite(data.reinforcement)) {
        parts.push(data.isStrongest
          ? `보강 ${data.reinforcement}회로 그래프에서 가장 강한 신호`
          : `보강 ${data.reinforcement}회`);
      }
      // observedRelative는 표 쪽(summary-table.js panelDataFor)이 이미 계산해
      // 넘긴 문자열이다 — 이 파일이 window.AthenaLib을 새로 참조하지 않으려는
      // 원래 계약(의존은 전부 주입) 때문에 여기서 다시 계산하지 않는다. 두
      // 화면이 같은 시각을 다르게 말하지 않게 하는 효과도 같이 얻는다.
      if (data.observedRelative) parts.push(`최근 ${data.observedRelative}`);
    }
    return parts.join(' · ');
  }

  // 이 노드의 관계 전체(보드 04 §관계 목록) — 옛 판은 숨은 연관만 보여줬는데,
  // Paper는 관심·속함 같은 통상 관계까지 한 목록에 둔다("이 노드의 관계"라는
  // 제목이 그 뜻이다). 재료는 cluster-map 응답의 `edge_details`(kinds/tier/
  // confidence)와 이미 배치된 노드 이름이다 — 새 왕복 없이 있는 것만 조인한다.
  //
  // 정렬은 Paper 행 순서(관심 → 속함 → 숨은)를 규칙으로 옮긴다: 숨은 연관을
  // 맨 뒤로 보내고, 그 앞은 confidence가 높은(사실에 가까운) 순이다. 같으면
  // 상대 이름 오름차순 — 다시 열어도 같은 순서여야 한다.
  const RELATION_SORT_CONFIDENCE = { EXTRACTED: 0, INFERRED: 1, AMBIGUOUS: 2 };

  function buildRelationships(entityId, fromNode) {
    if (!entityId) return [];
    const hiddenPartners = new Set();
    const hiddenMeta = new Map();
    if (typeof getSurprisingConnections === 'function') {
      for (const c of topSurprising(getSurprisingConnections())) {
        if (!c) continue;
        if (c.source_entity_id === entityId) { hiddenPartners.add(c.target_entity_id); hiddenMeta.set(c.target_entity_id, c); }
        else if (c.target_entity_id === entityId) { hiddenPartners.add(c.source_entity_id); hiddenMeta.set(c.source_entity_id, c); }
      }
    }

    const rows = [];

    // ① 성향 관계(관심·보유·선호…) — 투자자 프로필에서 이 노드로 뻗은 관계다.
    // 지도의 **간선이 아니라 노드의 속성**이라 cluster-map의 edge_details에는 없고
    // (백엔드가 프로필 노드를 분석 투영에서 뺀다), profile-summary가 낸다.
    // 보드 04의 "관심 · HBM 장비 질문 4회 · 4" 행이 정확히 이것이다 — 보강 수까지
    // 여기서 온다(타임라인을 기다리지 않는다).
    //
    // 표에서 고른 선택(보드 02)에는 넣지 않는다: 그 화면은 바로 위 티어 대조
    // 카드가 같은 관계를 근거 문장까지 이미 보여줘서, 여기 또 넣으면 같은 문장이
    // 한 패널에 두 번 뜬다(실측).
    if (fromNode && typeof getProfileSummaryEntries === 'function') {
      for (const entry of getProfileSummaryEntries() || []) {
        if (!entry || entry.entity_id !== entityId) continue;
        rows.push({
          otherId: null,
          otherName: entry.rationale || '',
          relationLabel: RELATION_LABELS[entry.relation_kind] || entry.relation_kind,
          kinds: [entry.relation_kind],
          confidence: entry.confidence,
          tier: entry.tier,
          isHidden: false,
          isProfile: true,
          reinforcement: entry.reinforcement,
        });
      }
    }

    // ② 구조 관계(소속 등) — 종목↔테마처럼 엔티티끼리 이어진 지도의 실제 간선.
    const details = lastPayload && Array.isArray(lastPayload.edge_details) ? lastPayload.edge_details : [];
    for (const detail of details) {
      if (!detail) continue;
      let otherId = null;
      if (detail.source === entityId) otherId = detail.target;
      else if (detail.target === entityId) otherId = detail.source;
      if (!otherId) continue;
      const other = findNode(otherId);
      const kinds = Array.isArray(detail.kinds) ? detail.kinds : [];
      rows.push({
        otherId,
        otherName: (other && other.name) || otherId,
        // 방향을 여기서 실어 둔다(2026-09-03) — 선택 노드가 도착(target)일 수도
        // 있다. 렌더 시점에 "선택 노드 = 출발"로 지어내면 해시가 뒤집혀 취소가
        // 조용히 miss가 난다(백엔드 relation_id는 방향을 구분한다).
        subjectId: detail.source,
        objectId: detail.target,
        // 관계 라벨은 첫 kind를 한글로 — RELATION_LABELS는 타임라인 문구와 공유한다.
        relationLabel: kinds.length > 0 ? (RELATION_LABELS[kinds[0]] || kinds[0]) : '관계',
        kinds,
        confidence: detail.confidence,
        tier: detail.tier,
        isHidden: hiddenPartners.has(otherId),
        surpriseScore: hiddenMeta.get(otherId) ? hiddenMeta.get(otherId).surprise_score : undefined,
      });
    }

    // ③ 숨은 연관 — 위 두 경로에 이미 나온 상대는 거기서 isHidden으로 표시되므로,
    // 여기서는 edge_details에 없는 쌍만 보탠다(구버전 backend나, 지도 필터로
    // 엣지가 걸러진 경우).
    const seenPartners = new Set(rows.map((row) => row.otherId).filter(Boolean));
    {
      for (const [otherId, c] of hiddenMeta) {
        if (seenPartners.has(otherId)) continue;
        const isSource = c.source_entity_id === entityId;
        rows.push({
          otherId,
          otherName: (isSource ? c.target_name : c.source_name) || otherId,
          relationLabel: '숨은',
          kinds: Array.isArray(c.kinds) ? c.kinds : [],
          confidence: undefined,
          tier: undefined,
          isHidden: true,
          surpriseScore: c.surprise_score,
        });
      }
    }

    // 보드 04의 행 순서(관심 → 속함 → 숨은)를 규칙으로 옮긴다: 성향 관계(내가
    // 말했거나 체결한 것)가 먼저, 구조 관계(그래프가 이은 것)가 다음, 숨은 연관이
    // 맨 뒤. 같은 층에서는 confidence가 높은 순, 그다음 이름 오름차순 — 다시 열어도
    // 같은 순서여야 한다.
    return rows.sort((a, b) => {
      if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
      if (Boolean(a.isProfile) !== Boolean(b.isProfile)) return a.isProfile ? -1 : 1;
      const ca = RELATION_SORT_CONFIDENCE[a.confidence] ?? 3;
      const cb = RELATION_SORT_CONFIDENCE[b.confidence] ?? 3;
      if (ca !== cb) return ca - cb;
      return String(a.otherName).localeCompare(String(b.otherName));
    });
  }

  // 지도가 핑크로 칠할 쌍 — 요약 카드·관계 목록과 같은 셋이다.
  function highlightedHiddenPairs() {
    if (typeof getSurprisingConnections !== 'function') return [];
    return topSurprising(getSurprisingConnections())
      .map((c) => [c.source_entity_id, c.target_entity_id]);
  }

  // "왜 숨은 연관인가" 블록 재료(보드 04) — 선택 노드가 실제로 숨은 연관에
  // 걸려 있을 때만 값을 낸다. 아니면 null이고 섹션 자체가 안 그려진다.
  function buildHiddenLinkReason(entityId) {
    if (typeof getSurprisingConnections !== 'function' || !entityId) return null;
    const connections = topSurprising(getSurprisingConnections());
    const mine = connections.filter((c) => c && (c.source_entity_id === entityId || c.target_entity_id === entityId));
    if (mine.length === 0) return null;
    // 여러 건이면 상대 점수가 가장 높은 하나를 대표로 설명한다 — 나머지는 위
    // 관계 목록에 "숨은" 행으로 이미 다 나와 있다.
    const top = mine.reduce((best, c) =>
      (best === null || (c.surprise_score || 0) > (best.surprise_score || 0) ? c : best), null);
    const isSource = top.source_entity_id === entityId;
    const otherId = isSource ? top.target_entity_id : top.source_entity_id;
    const self = findNode(entityId);
    const other = findNode(otherId);
    const detail = (lastPayload && Array.isArray(lastPayload.edge_details) ? lastPayload.edge_details : [])
      .find((d) => d && ((d.source === entityId && d.target === otherId) || (d.source === otherId && d.target === entityId)));
    const clauses = hiddenLinkReasonClauses({
      crossingEdgeCount: countCrossingEdges(top.source_cluster, top.target_cluster),
      sourceDegree: self ? self.degree : undefined,
      targetDegree: other ? other.degree : undefined,
      confidence: detail ? detail.confidence : undefined,
    });
    const maxScore = connections.reduce((m, c) => Math.max(m, c && Number.isFinite(c.surprise_score) ? c.surprise_score : -Infinity), -Infinity);
    const isTop = Number.isFinite(top.surprise_score) && top.surprise_score === maxScore;
    return {
      partnerCluster: isSource ? top.target_cluster : top.source_cluster,
      selfCluster: isSource ? top.source_cluster : top.target_cluster,
      clauses,
      scoreText: relativeScoreText(top.surprise_score),
      isTop,
    };
  }

  // 필터가 화면을 통째로 비웠을 때의 안내(보드 07 정직성 상태). 빈 캔버스는
  // "성향이 없다"로 읽히는데, 실제로는 방금 건 조건이 너무 빡빡한 것이다 —
  // 어느 조건이 얼마나 걸려 있는지까지 적어 되돌릴 길을 준다. 실측: "연결 3개
  // 이상"을 걸면 이 그래프의 3-core가 비어 화면이 통째로 비었는데 아무 말이
  // 없었다(성긴 종목↔테마 그래프에서는 수학적으로 정상인 결과다).
  function renderFilteredEmpty() {
    if (!elements.graphBody) return;
    while (elements.graphBody.firstChild) elements.graphBody.removeChild(elements.graphBody.firstChild);
    const settings = typeof getFilters === 'function' ? getFilters() : null;
    const clauses = [];
    if (settings && filters) {
      if (settings.minDegree > 0) clauses.push(filters.minDegreeLabel(settings.minDegree));
      if (settings.windowDays && settings.windowDays !== filters.DEFAULTS.windowDays) {
        clauses.push(filters.windowLabel(settings.windowDays));
      }
    }
    const note = document.createElement('div');
    note.className = 'graph-mode-unavailable';
    note.textContent = clauses.length > 0
      ? `지금 걸린 조건(${clauses.join(' · ')})에 맞는 노드가 없습니다 — 헤더의 필터를 완화해 보세요.`
      : '아직 그릴 연결이 없습니다 — 대화와 체결이 쌓이면 여기 지도로 보입니다.';
    elements.graphBody.appendChild(note);
  }

  // 지금 상태로 마지막 배치를 다시 그린다 — 펼침·접기·선택 전부 이 경로를 탄다.
  // 배치는 이미 있으니 무엇을 보여줄지만 바뀐다, 네트워크 왕복이 필요 없다.
  // 새 fetch 없이 화면만 다시 맞춘다(선택 변경 등).
  //
  // **지도는 다시 그리지 않는다.** 옛 정적 시절엔 선택 표시가 SVG 안에 있어서 stage를
  // 통째로 다시 그려야 했다. 라이브 지도는 자기 상태를 들고 있어 그럴 필요가 없다 —
  // 오히려 그리면 정적 렌더러가 캔버스를 덮어써 지도가 옛 군집 버블 그림으로
  // 되돌아갔다(2026-09-02, probe-graph-doubleclick.js로 재현).
  //
  // 정적 렌더러를 지운 뒤에도 그 호출이 한 줄 남아 있었고, vis-network가 없는 경로
  // (로드 실패 · 라이브 지도를 주입하지 않은 테스트)에서 노드를 고르면
  // `ReferenceError: renderStage is not defined`로 죽었다 — 라이브 스텁을 주입하는
  // 단위 테스트는 그 분기를 안 타서 못 잡았다. 이제 분기 자체가 없다: 여기서 하는
  // 일은 선택 표시와 헤더 갱신뿐이고, 지도를 그리는 유일한 자리는 draw()다.
  function redrawFromCache() {
    if (!lastPlaced || !elements.graphBody) return;
    renderSelection();
    renderGraphHeader();
  }

  // 성향 신호 표 선택 하이라이트(보드 07) — applyVisibility()의 32행 주석
  // "가시성은 전부 이 함수 하나가 소유한다"는 단일 소유권 원칙을 선택
  // 하이라이트에도 적용한다: 새 상태·새 컴포넌트를 만들지 않고 기존
  // state.selectedEntityId를 그대로 읽어 .is-selected만 토글한다.
  function highlightSelectedRow() {
    if (!elements.summaryTable || typeof elements.summaryTable.querySelectorAll !== 'function') return;
    elements.summaryTable.querySelectorAll('.summary-row').forEach((row) => {
      row.classList.toggle('is-selected', row.getAttribute('data-entity-id') === state.selectedEntityId);
    });
  }

  // 헤더 메타 텍스트 + 지도 안내 바(보드 14 §1.3, 06/07 안내 바와 달리 1단계
  // 전용) 갱신 — draw()/redrawFromCache()/renderUnavailable() 끝에서 부른다.
  // 안내 바의 hidden은 이 함수 하나가 소유한다(applyVisibility()가 #graphCanvas
  // 전체를 숨기면 자식인 #graphHeader와 함께 자동으로 숨으므로, 이 로직은
  // 1단계⇄2단계 전환에만 관여하고 답변⇄그래프 모드 전환과는 무관하다).
  function renderGraphHeader() {
    if (elements.graphHeaderMeta) {
      elements.graphHeaderMeta.textContent = computeGraphHeaderMeta(state.stage, lastPayload, lastPlaced);
    }
    if (elements.mapGuide) {
      elements.mapGuide.hidden = state.stage !== store.STAGE_CLUSTERS;
    }
  }

  function elp(name, className) {
    const node = document.createElement(name);
    if (className) node.setAttribute('class', className);
    return node;
  }

  // dot 인코딩 재사용 — summary-table.js의 dotClass()와 같은 confidence/tier
  // 규칙(§0 원칙5 "근거 불명확한 추정 분류"). 그래프 노드 선택 경로
  // (selectNode())는 confidence/tier가 없어 이 판정이 항상 '테두리만'으로
  // 떨어진다 — 지어낸 값이 아니라 정직한 기본값이다.
  function panelDotClass(data) {
    if (data.confidence === 'EXTRACTED' && data.tier === 'deterministic') return 'panel-dot-fact';
    if (data.confidence === 'AMBIGUOUS') return 'panel-dot-warn';
    return 'panel-dot-soft';
  }

  // manual — 사람이 화면에서 직접 고친 것(2026-09-03). 체결도 대화도 아니라 별 라벨이
// 필요하다: 체결이라고 쓰면 체결한 적 없는 것을 체결이라 말하는 것이고, 대화라고
// 쓰면 모델이 추론한 것처럼 읽힌다.
const PANEL_TIER_LABELS = {
  deterministic: '체결·잔고', conversational: '대화', manual: '직접 수정',
};

  // §10-4 최근 변화(보드 15 §2.5, WP-G) — 2단계 렌더의 채움 단계. 응답 시점의
  // 실제 DOM에서 섹션을 다시 찾는다(선점해 둔 closure 노드는 같은 엔티티
  // 재렌더로 이미 교체됐을 수 있다). 행이 없으면 섹션을 걷어낸다 — 빈 섹션보다
  // 아예 없는 편이 정직하다(§0 정책).
  function fillTimelineSection(entityId, rows) {
    const panel = elements.panel;
    // stale 응답 가드 — 빠른 재선택으로 이미 다른 엔티티가 선택됐거나 선택이
    // 해제됐으면, 늦게 도착한 이 응답이 최신 선택 결과를 덮어쓰지 않게 버린다.
    if (!panel || state.selectedEntityId !== entityId) return;
    const section = panel.querySelector('.panel-recent-changes');
    if (!section) return;
    if (rows.length === 0) {
      panel.removeChild(section);
      return;
    }
    while (section.firstChild) section.removeChild(section.firstChild);
    const title = elp('div', 'panel-recent-changes-title');
    title.textContent = '최근 변화';
    section.appendChild(title);
    for (const row of rows) {
      const rowEl = elp('div', 'panel-change-row');
      const date = elp('span', 'panel-change-date');
      date.textContent = row.date;
      rowEl.appendChild(date);
      const desc = elp('span', 'panel-change-desc');
      desc.textContent = row.count > 1 ? `${row.text} ×${row.count}` : row.text;
      rowEl.appendChild(desc);
      section.appendChild(rowEl);
    }
    section.hidden = false;
  }

  // 공통 패널 콘텐츠(보드 07 §10, 스텝8). §10-1 탭("이력" 탭은 Paper에 콘텐츠
  // 스펙이 없어 클릭해도 전환 없음, §6 범위 밖) · §10-2 선택 헤더 · §10-3 티어
  // 대조(가용 필드가 rationale/confidence/tier뿐이라 두 카드 비교 "어긋남"
  // 대신 단일 카드로 축소, §0 정책) · §10-4 최근 변화(엔티티 타임라인, WP-G —
  // 유일한 비동기 채움 섹션, 아래 주석 참고) · §10-5 CTA를 그린다.
  function renderPanelContent(panel, data) {
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    const tabs = elp('div', 'panel-tabs');
    const traitTab = elp('button', 'panel-tab is-active');
    traitTab.setAttribute('type', 'button');
    traitTab.textContent = '성향';
    tabs.appendChild(traitTab);
    // 이력 탭은 아직 콘텐츠 스펙이 없다(위 주석 §10-1). 예전에는 눌리는 것처럼
    // 생긴 채로 아무 일도 안 해서 고장으로 읽혔다(2026-09-03 실사용: "이력은
    // 클릭해도 안열린다"). 없는 기능을 활성처럼 두지 않는다(P3) — 비활성으로
    // 표시하고 왜인지 말한다. 아래 §10-4 "최근 변화"가 지금은 그 역할을 한다.
    const historyTab = elp('button', 'panel-tab is-disabled');
    historyTab.setAttribute('type', 'button');
    historyTab.setAttribute('disabled', '');
    historyTab.setAttribute('aria-disabled', 'true');
    historyTab.setAttribute('title', '아직 없습니다 — 최근 변화는 아래에 있습니다');
    historyTab.textContent = '이력';
    tabs.appendChild(historyTab);
    tabs.appendChild(elp('span', 'panel-tabs-spacer'));
    const deselectBtn = elp('button', 'panel-deselect');
    deselectBtn.setAttribute('type', 'button');
    deselectBtn.textContent = '선택 해제';
    deselectBtn.addEventListener('click', () => {
      state = store.clearSelection(state);
      renderSelection();
    });
    tabs.appendChild(deselectBtn);
    panel.appendChild(tabs);

    const header = elp('div', 'panel-header');
    const row1 = elp('div', 'panel-header-row1');
    row1.appendChild(elp('span', `panel-dot ${panelDotClass(data)}`));
    const name = elp('span', 'panel-name');
    name.textContent = data.name || data.entityId;
    row1.appendChild(name);
    if (data.kind) {
      const kindBadge = elp('span', 'panel-kind-badge');
      kindBadge.textContent = PANEL_KIND_LABELS[data.kind] || data.kind;
      row1.appendChild(kindBadge);
    }
    header.appendChild(row1);
    const subtext = panelHeaderSubtext(data);
    if (subtext) {
      const row2 = elp('div', 'panel-header-row2');
      row2.textContent = subtext;
      header.appendChild(row2);
    }
    panel.appendChild(header);

    // 티어 대조(보드 02 "두 출처가 다르게 말합니다") — 같은 엔티티에 대해
    // 출처(체결·잔고 vs 대화)가 둘 이상이고 서로 다른 말을 할 때만 대조 제목과
    // "↕ 어긋남" 구분자를 붙인다. 하나뿐이면 카드 한 장만 — 없는 갈등을
    // 만들어내지 않는다(§0 정책).
    const sources = Array.isArray(data.sources) && data.sources.length > 0
      ? data.sources
      : ((data.rationale || data.tier || data.confidence) ? [data] : []);
    const distinctTiers = new Set(sources.map((s) => s.tier).filter(Boolean));
    const conflicting = sources.length > 1 && distinctTiers.size > 1;
    // 근거가 하나도 없으면 그 사실을 말한다(2026-09-03 실사용: "티어 대조 카드
    // 자체가 없다"). 지도에서 고른 노드는 성향 신호 표에 같은 entity가 없을 때
    // profileEntry가 비고(selectNode 주석), 그러면 이 절이 통째로 사라져 사용자는
    // 고장으로 읽는다 — 같은 노드인데 표에서 고르면 근거가 있고 지도에서 고르면
    // 없는 것처럼 보인다. 아래 관계 목록은 그대로 나오므로 "관계는 있고 성향
    // 기록은 없다"가 정확한 사실이고, 그것을 적는다(§0 정직성).
    if (sources.length === 0) {
      const note = elp('div', 'panel-tier-card');
      const noteBody = elp('div', 'panel-tier-body');
      noteBody.textContent = data.source === 'node'
        ? '이 노드에는 성향 기록이 없습니다 — 아래 관계만 그래프에 있습니다.'
        : '근거 문장이 아직 없습니다.';
      note.appendChild(noteBody);
      panel.appendChild(note);
    }
    if (conflicting) {
      const title = elp('div', 'panel-tier-contrast-title');
      title.textContent = '두 출처가 다르게 말합니다';
      panel.appendChild(title);
    }
    sources.forEach((source, index) => {
      if (conflicting && index > 0) {
        const divider = elp('div', 'panel-tier-divider');
        divider.textContent = '↕ 어긋남';
        panel.appendChild(divider);
      }
      const tierCard = elp('div', 'panel-tier-card');
      const tierRow = elp('div', 'panel-tier-row');
      tierRow.appendChild(elp('span', `panel-dot ${panelDotClass(source)}`));
      const tierLabel = elp('span', 'panel-tier-label');
      tierLabel.textContent = PANEL_TIER_LABELS[source.tier] || '출처 불명';
      tierRow.appendChild(tierLabel);
      if (source.confidence) {
        const confBadge = elp('span', 'panel-tier-confidence');
        confBadge.textContent = PANEL_CONFIDENCE_LABELS[source.confidence] || source.confidence;
        tierRow.appendChild(confBadge);
      }
      tierCard.appendChild(tierRow);
      if (source.rationale) {
        const tierBody = elp('div', 'panel-tier-body');
        tierBody.textContent = source.rationale;
        tierCard.appendChild(tierBody);
      }
      panel.appendChild(tierCard);
    });

    // 이 노드의 관계(보드 04) — 숨은 연관만이 아니라 통상 관계까지 한 목록에
    // 둔다. 관계별 보강 수는 아래 타임라인 응답이 오면 채운다(첫 렌더 시점엔
    // 없다 — 0을 지어내지 않는다). 하나도 없으면 섹션 자체를 안 그린다.
    const relationRows = buildRelationships(data.entityId, data.source === 'node');
    if (relationRows.length > 0) {
      const relations = elp('div', 'panel-relations');
      const title = elp('div', 'panel-relations-title');
      title.textContent = '이 노드의 관계';
      relations.appendChild(title);
      for (const rel of relationRows) {
        const row = elp('div', 'panel-relation-row');
        if (rel.otherId) row.setAttribute('data-other-id', rel.otherId);
        row.setAttribute('data-relation', rel.kinds[0] || '');
        row.appendChild(elp('span', `panel-relation-dot ${rel.isHidden ? 'is-hidden' : panelDotClass(rel)}`));
        const label = elp('span', `panel-relation-label${rel.isHidden ? ' is-hidden' : ''}`);
        label.textContent = rel.isHidden ? '숨은' : rel.relationLabel;
        row.appendChild(label);
        const desc = elp('span', 'panel-relation-desc');
        desc.textContent = rel.otherName;
        row.appendChild(desc);
        // 보강 수 — 성향 관계는 profile-summary가 이미 준다. 구조 관계는 값이
        // 없어 빈 칸으로 두고, 타임라인이 오면 fillRelationCounts()가 채운다
        // (열 자리는 항상 만든다 — 행마다 오른쪽 끝이 흔들리면 훑을 수 없다).
        const count = elp('span', 'panel-relation-count');
        if (Number.isFinite(rel.reinforcement) && rel.reinforcement > 0) {
          count.textContent = String(rel.reinforcement);
        }
        row.appendChild(count);
        // 삭제 손잡이(Paper 보드 04, 2026-09-03) — 화면에서 바로 고치는 입구다.
        // 여기서 그래프에 직접 쓰지 않는다: 이 모듈은 순수 렌더이고, 쓰기는 주입받은
        // onRelationDelete가 한다(canvas.js가 IPC로 잇는다). 계약을 뒤집지 않는다.
        //
        // relation_id는 화면이 모른다 — cluster-map의 edge_details가 (출발·도착·관계)만
        // 준다. id는 그 셋의 결정적 해시이므로 백엔드가 계산한다(brain.py 취소 입구).
        // 방향은 행이 만들어질 때 실려 온다(rel.subjectId/objectId — 선택 노드가
        // 도착일 수도 있다). 숨은 연관 행은 확정된 관계가 아니라 분석이 띄운
        // 표면이라 손잡이를 안 붙인다 — 엉뚱한 것을 지우는 것보다 못 지우는 게 낫다.
        if (typeof onRelationDelete === 'function' && rel.subjectId && rel.objectId
            && !rel.isHidden && rel.kinds.length > 0) {
          const del = elp('button', 'panel-relation-delete');
          del.setAttribute('type', 'button');
          del.textContent = '삭제';
          del.setAttribute('aria-label', `${rel.otherName} · ${rel.relationLabel} 연결 삭제`);
          del.addEventListener('click', (event) => {
            // 행 클릭(노드 선택)까지 번지면 지우면서 다른 노드로 넘어간다.
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            onRelationDelete({
              subjectId: rel.subjectId,
              objectId: rel.objectId,
              kind: rel.kinds[0],
              label: `${rel.otherName} · ${rel.relationLabel}`,
            });
          });
          row.appendChild(del);
        }
        relations.appendChild(row);
      }
      panel.appendChild(relations);
    }

    // 왜 숨은 연관인가(보드 04 근거 블록) — 선택 노드가 실제로 숨은 연관에
    // 걸렸을 때만. 절이 하나도 안 만들어지면(근거 없음) 블록을 안 그린다.
    const reason = buildHiddenLinkReason(data.entityId);
    if (reason && (reason.clauses.length > 0 || reason.scoreText)) {
      const block = elp('div', 'panel-reason');
      const title = elp('div', 'panel-reason-title');
      title.textContent = '왜 숨은 연관인가';
      block.appendChild(title);
      if (reason.clauses.length > 0) {
        const body = elp('div', 'panel-reason-body');
        body.textContent = reason.clauses.join(' · ');
        block.appendChild(body);
      }
      if (reason.scoreText) {
        const score = elp('div', 'panel-reason-score');
        // 1등이면 그렇게 말하고, 아니면 "든다"까지만 말한다 — 둘 다 숫자가 없다.
        score.textContent = reason.isTop
          ? '이 그래프에서 가장 놀라운 연결입니다'
          : reason.scoreText;
        block.appendChild(score);
      }
      panel.appendChild(block);
    }

    // §10-4 최근 변화(보드 15 §2.5, WP-G) — 유일한 비동기 채움 섹션(2단계
    // 렌더, G-G2). 다른 섹션은 전부 동기 캐시 조회지만 엔티티 타임라인은
    // entity_id별 IPC 왕복이라 첫 렌더 시점엔 데이터가 없다. 섹션 자리를
    // hidden으로 먼저 선점해 CTA보다 앞 순서를 고정해 두고(fake-dom에
    // insertBefore가 없어 자리 선점이 가장 단순하다), 응답이 오면
    // fillTimelineSection()이 채우거나(행 있음) 걷어낸다(행 없음·실패).
    // selectNode()/selectEntity()의 동기 계약은 그대로다 — 이 fetch를
    // 기다리지 않는다.
    if (typeof fetchEntityTimeline === 'function' && data.entityId) {
      const section = elp('div', 'panel-recent-changes');
      section.hidden = true;
      panel.appendChild(section);
      const requestedEntityId = data.entityId;
      Promise.resolve()
        .then(() => fetchEntityTimeline(requestedEntityId))
        .then((events) => {
          fillTimelineSection(requestedEntityId, buildTimelineRows(events));
          // 같은 응답으로 관계 목록의 보강 수도 채운다 — 왕복을 하나 더 쓰지 않는다.
          fillRelationCounts(requestedEntityId, countRelationEvents(events));
        })
        // 실패는 빈 상태 유지가 정직하다 — 화면을 깨지 않고 선점해 둔 섹션도
        // 걷어낸다(못 읽은 것을 "변화 없음"처럼 그리지 않으려면 섹션 자체가
        // 없는 게 맞다, renderUnavailable()과 같은 논리).
        .catch(() => fillTimelineSection(requestedEntityId, []));
    }

    // CTA(보드 02/04 §패널 CTA) — 리드인 문장과 버튼 문구가 무엇을 아직 안
    // 했는지에 따라 달라진다. 확인할 것이 없으면 리드인 없이 버튼만 둔다.
    const ctaBlock = elp('div', 'panel-cta-block');
    let ctaLabel = '채팅에서 답하기';
    let leadIn = '';
    if (reason) {
      leadIn = '이 연결을 확인하지 않으셨습니다.';
      ctaLabel = '채팅에서 물어보기';
    } else if (conflicting) {
      leadIn = '어느 쪽이 실제에 가까운지 아직 답하지 않으셨습니다.';
    }
    if (leadIn) {
      const lead = elp('div', 'panel-cta-lead');
      lead.textContent = leadIn;
      ctaBlock.appendChild(lead);
    }
    const cta = elp('button', 'panel-cta');
    cta.setAttribute('type', 'button');
    cta.textContent = ctaLabel;
    // 클릭에 **무엇을 물어야 하는지**를 함께 넘긴다(2026-09-02). 옛 판은 인자 없이
    // 불러서, 받는 쪽(canvas.js)이 입력창에 포커스만 주고 끝났다 — 버튼을 눌러도
    // 아무 일도 안 일어난다는 제보의 원인이다. 문구는 위 리드인과 같은 축을 쓴다:
    // 숨은 연관이면 "왜 이어졌나", 어긋나면 "어느 쪽이 실제인가".
    if (typeof onPanelCta === 'function') {
      const ask = {
        kind: reason ? 'hidden' : (conflicting ? 'conflict' : 'plain'),
        name: data.name || null,
        entityId: data.entityId || null,
      };
      cta.addEventListener('click', () => onPanelCta(ask));
    }
    ctaBlock.appendChild(cta);
    panel.appendChild(ctaBlock);
  }

  // 관계 목록의 보강 수 채움(보드 04 우측 숫자) — fillTimelineSection과 같은
  // stale 가드를 쓴다. 해당 쌍의 이벤트가 없으면 칸을 빈 채로 둔다(0을 찍으면
  // "관계가 0번 기록됐다"는 거짓이 된다 — 못 센 것과 없는 것은 다르다).
  function fillRelationCounts(entityId, counts) {
    const panel = elements.panel;
    if (!panel || state.selectedEntityId !== entityId) return;
    if (typeof panel.querySelectorAll !== 'function') return;
    for (const row of panel.querySelectorAll('.panel-relation-row')) {
      const relation = row.getAttribute('data-relation');
      const otherId = row.getAttribute('data-other-id');
      if (!relation || !otherId) continue;
      const count = counts.get(`${relation} ${otherId}`);
      if (!Number.isFinite(count) || count <= 0) continue;
      const cell = row.querySelectorAll('.panel-relation-count')[0];
      if (cell) cell.textContent = String(count);
    }
  }

  // 공통 패널 — 선택된 노드가 있으면 채우고 없으면 숨긴다. panel 요소는
  // 주입받는다(elements.panel) — 안 들어오면 조용히 건너뛴다, DOM을 전역에서
  // 만들지 않는다는 이 파일의 원래 계약을 지킨다.
  function renderSelection() {
    highlightSelectedRow();
    // 라이브 뷰에는 .graph-node DOM이 없다(캔버스에 그린다) — 강조를 network에
    // 직접 건다. 아래 이른 반환들보다 앞이어야 수집·노출로 갔다 와도 안 어긋난다.
    if (liveActive()) liveMap.selectEntity(state.selectedEntityId);
    const panel = elements.panel;
    if (!panel) return;
    // 수집·노출(보드 05)은 노드가 아니라 설정을 보는 화면이다 — 그 옆에 노드
    // 패널이 남아 있으면 무엇을 보고 있는지가 흐려진다. 선택 자체는 지우지
    // 않는다(요약·지도로 돌아오면 그대로 다시 뜬다).
    if (state.surface === store.SURFACE_SETTINGS) {
      panel.hidden = true;
      return;
    }
    if (!state.selectedEntityId || !state.panel) {
      panel.hidden = true;
      while (panel.firstChild) panel.removeChild(panel.firstChild);
      return;
    }
    panel.hidden = false;
    renderPanelContent(panel, state.panel);
  }

  async function draw(force) {
    if (!store.isGraphView(state)) return null;
    if (!available) {
      renderUnavailable();
      return null;
    }
    let payload;
    try {
      payload = await fetchClusterMap();
    } catch (err) {
      // 지도 요청 실패가 그래프 기능 전체를 닫게 하지 않는다. 현재 map 표면과
      // 헤더를 남겨야 사용자가 눈에 보이는 '요약' 탭으로 다시 돌아갈 수 있다.
      if (onError) onError(err);
      renderUnavailable('그래프 데이터를 불러오지 못했습니다. 요약 탭은 계속 사용할 수 있습니다.');
      return null;
    }

    state = store.applyRevision(state, payload && payload.revision);
    if (!force && lastDrawnRevision === state.revision) return null;

    // 헤더 필터를 배치 **전에** 건다(보드 03/04) — 그려 놓고 숨기면 좌표가 이미
    // 걸러진 노드까지 자리를 잡은 뒤라 남은 노드가 화면 한쪽에 뭉친다.
    if (filters && typeof getFilters === 'function') {
      payload = filters.applyGraphFilters(payload, getFilters());
    }

    const placed = grouping.projectPayload(payload);
    lastPlaced = placed;
    lastPayload = payload; // 헤더 메타의 "관계 E"(필터 전 원본)가 이 값을 읽는다.
    // 필터가 선택 노드를 걷어냈으면 선택도 놓는다 — 화면에 없는 노드의 패널이
    // 옆에 남아 있으면 지도와 패널이 다른 그래프를 말하게 된다(실측).
    if (state.selectedEntityId
      && !placed.nodes.some((node) => node.entity_id === state.selectedEntityId)) {
      state = store.clearSelection(state);
    }
    // 라이브 뷰는 좌표를 스스로 정한다 — placed는 헤더 메타("엔티티 N · 관계 E ·
    // 군집 C")를 위해 계속 계산하지만 그리기에는 쓰지 않는다. 노드 선택은
    // live-map.js의 onSelect가 handleNodeClick으로 넘겨 같은 공통 패널을 연다.
    if (!Array.isArray(placed.nodes) || placed.nodes.length === 0) {
      // 필터가 전부 걷어냈다 — 빈 화면 대신 무엇이 걸렸는지 적는다(보드 07
      // 정직성 상태). 렌더러보다 **먼저** 본다: 그릴 게 없는 것과 못 그리는 것은
      // 다르고, 지도에 빈 캔버스만 남기면 전자가 후자처럼 보인다.
      renderFilteredEmpty();
    } else if (liveActive()) {
      while (elements.graphBody && elements.graphBody.firstChild) {
        elements.graphBody.removeChild(elements.graphBody.firstChild);
      }
      // 핑크 점선은 군집을 넘는 연결 전부가 아니라 요약의 “숨은 연관” 카드와
      // **같은 상위 3쌍**에만 붙는다(보드 2QCN-2 › 2QF8-2) — 그 셋을 고르는
      // topSurprising은 패널·관계 목록이 이미 쓰는 것과 같은 함수다.
      liveMap.render(payload, { hiddenPairs: highlightedHiddenPairs() });
    } else {
      // vis-network를 못 불러왔다. 빈 화면 대신 정직하게 알린다 — 없는 것(그릴
      // 그래프가 없다)과 못 읽은 것(렌더러가 없다)은 다르다(§0 정책).
      renderUnavailable('그래프 렌더러를 불러오지 못했습니다. 요약 탭은 계속 사용할 수 있습니다.');
    }
    renderSelection();
    renderGraphHeader();
    lastDrawnRevision = state.revision;
    return placed;
  }

  return {
    get state() {
      return state;
    },
    async toggle() {
      state = store.toggleView(state);
      applyVisibility();
      renderSelection();
      return draw(true);
    },
    // 사이드바 모드 네비(4항목)의 유일한 진입점 — summary/graph/agent/plugin 어느
    // 값으로도 직접 전이한다(toggle()은 summary⇄graph 2값 순환 전용으로 그대로
    // 둔다, verify.js의 기존 toggle() 직접 호출을 깨지 않기 위해). draw()는
    // 그래프 뷰가 아니면 즉시 no-op을 돌려주므로 view와 무관하게 항상 불러도
    // 안전하다(toggle()과 같은 패턴).
    async setView(view) {
      state = store.setView(state, view);
      applyVisibility();
      renderSelection();
      return draw(true);
    },
    async refresh() {
      return draw(false);
    },
    // 헤더 필터가 바뀌었다 — 리비전은 그대로지만 그릴 것이 달라졌으므로
    // refresh()(리비전 같으면 no-op)로는 안 되고 강제로 다시 그린다.
    async refreshFiltered() {
      return draw(true);
    },
    // 모드 칩은 상시 보인다(Paper 보드 05) — 브레인 꺼짐은 칩을 숨기는 대신
    // 그래프 화면 안에서 renderUnavailable()로 정직하게 알린다. 그래프 모드
    // 자체는 브레인 상태와 무관하게 항상 열 수 있다.
    setAvailable(nextAvailable) {
      available = Boolean(nextAvailable);
      if (!store.isGraphView(state)) return undefined;
      if (available) {
        return draw(true); // 못 쓰던 그래프가 쓸 수 있게 됐다 — 안내 대신 실제로 그린다.
      }
      renderUnavailable();
      return undefined;
    },
    applyVisibility,
    // 그래프 모드 채팅에 실을 화면 상태(2026-09-02). backtest-canvas.js의
    // getContext()와 같은 역할이며, 같은 경로로 흐른다:
    //   chat.js → main.js → live-prompt.buildGraphModePrefix
    //
    // **왜 필요한가.** 그래프 모드에 들어와 있어도 모델은 그래프의 존재조차 몰랐다.
    // "확인이 필요한 것 3건이 뭐야?"에 "종목 시세·차트·공시 중 어느 쪽인가"라고
    // 되물은 것이 그 증거다(2026-09-02 제보) — 아는 도구 안에서 답한 것이다.
    //
    // **왜 노드를 전부 안 싣나.** cluster-map을 모델 컨텍스트에 쏟는 것은 답이 아니라
    // 비용이다(brain_tools.py 머리말이 cluster_map 액션을 뺀 이유와 같다). 지금
    // 40개지만 수백~수천으로 늘 수 있다. 그래서 여기서는 **집계와 지금 보고 있는
    // 것**만 싣고, 더 깊은 질문은 모델이 athena_brain으로 직접 조회한다.
    getContext() {
      const entries = typeof getProfileSummaryEntries === 'function'
        ? (getProfileSummaryEntries() || []) : [];
      const surprising = typeof getSurprisingConnections === 'function'
        ? (getSurprisingConnections() || []) : [];
      const nodes = (lastPlaced && Array.isArray(lastPlaced.nodes)) ? lastPlaced.nodes : [];
      const clusters = (lastPlaced && Array.isArray(lastPlaced.clusters)) ? lastPlaced.clusters : [];
      const panel = state.panel;
      return {
        available,
        surface: state.surface,
        revision: state.revision,
        filters: typeof getFilters === 'function' ? getFilters() : null,
        counts: {
          entities: nodes.length,
          relations: (lastPlaced && Array.isArray(lastPlaced.edges)) ? lastPlaced.edges.length : 0,
          clusters: clusters.filter((c) => c.cluster !== -1).length,
          unassigned: nodes.filter((n) => n.cluster === -1).length,
          signals: entries.length,
          hiddenLinks: surprising.length,
          // "확인이 필요한 것 N건" — 화면 배너와 같은 값이어야 한다. 채팅이 다른
          // 숫자를 말하면 사용자는 둘 중 어느 쪽을 믿어야 하는지 알 수 없다.
          uncertain: entries.filter((e) => e && e.confidence === 'AMBIGUOUS').length,
        },
        clusters: clusters.filter((c) => c.cluster !== -1).slice(0, 10).map((c) => ({
          cluster: c.cluster,
          size: c.size,
          cohesion: c.cohesion,
          title: clusterTitle(c).text,
          estimated: clusterTitle(c).estimated,
        })),
        // 상위 신호는 표의 "상위 5"가 아니라 창 전체에서 보강 순으로 고른다 —
        // 표가 5개만 보여도 모델은 더 물어볼 수 있어야 한다.
        topSignals: entries.slice(0, 12).map((e) => ({
          // id를 함께 싣는다(2026-09-03) — 채팅이 athena_graph_view action=select로
          // 노드를 지목하려면 id가 필요한데, 이름만 주면 모델이 그것을 알 길이
          // 없어 조회를 한 번 더 돌거나 이름을 id인 척 넣는다(전수 검증 실측).
          entityId: e.entity_id,
          name: e.entity_name,
          kind: e.entity_kind,
          relation: e.relation_kind,
          rationale: e.rationale,
          reinforcement: e.reinforcement,
          confidence: e.confidence,
          tier: e.tier,
          observedAt: e.observed_at,
        })),
        hiddenLinks: surprising.slice(0, 6).map((s) => ({
          source: s.source_name,
          target: s.target_name,
          score: s.surprise_score,
          kinds: s.kinds,
        })),
        selected: panel ? {
          entityId: state.selectedEntityId,
          name: panel.name,
          kind: panel.kind,
          cluster: panel.cluster,
          clusterTitle: panel.clusterTitle,
          degree: panel.degree,
          relation: panel.relation,
          rationale: panel.rationale,
          reinforcement: panel.reinforcement,
          confidence: panel.confidence,
          tier: panel.tier,
          relations: Array.isArray(panel.relations)
            ? panel.relations.slice(0, 15).map((r) => ({
              label: r.label, name: r.name, count: r.count, hidden: r.hidden,
            }))
            : [],
        } : null,
      };
    },
    // 노드 선택 — 렌더러와 무관한 진입점(2026-09-02). 라이브 지도의 onSelect가
    // 부르는 것과 **같은 경로**라, 지도 클릭과 이 호출이 같은 패널을 연다.
    //
    // 왜 필요한가: 옛 정적 SVG 시절에는 테스트도 사람도 `.graph-node` DOM을 클릭해
    // 선택을 일으켰다. 라이브 지도는 캔버스에 그려 클릭할 DOM이 없다 — 선택 로직이
    // 렌더러에 묶여 있으면 렌더러를 바꿀 때마다 그 로직의 검증이 통째로 무너진다.
    selectNode(entityId) {
      handleLiveSelect(entityId ? String(entityId) : null);
      return state.panel;
    },
    // 지도 카메라 — 채팅이 노드를 골라 주거나 "전체 다시 보여줘"라고 할 때 쓴다
    // (2026-09-03, athena_graph_view action=select·fit). 선택과 초점이 갈려 있는
    // 이유: 요약 표의 행 선택은 패널만 열어야 하고(지도를 안 보고 있다), 채팅이
    // 노드를 지목한 것은 지도에서도 그 노드가 보여야 한다.
    //
    // 지도가 없거나(요약 서브뷰) 그 노드가 필터에 걸려 지도에 없으면 false다 —
    // 호출자가 "아무 일도 안 일어났다"를 알아야 채팅이 됐다고 말하지 않는다.
    focusNode(entityId) {
      if (!liveActive() || !entityId) return false;
      return liveMap.focusEntity(String(entityId)) === true;
    },
    fitView() {
      if (!liveActive()) return false;
      return liveMap.fitView() === true;
    },
    // 공통 패널 공개 API — 그래프 밖(요약 표의 행 선택, 보드 07)에서도 같은 패널을
    // 열 수 있어야 한다는 게 store의 원래 계약이다("공통 패널: 어느 단계에서든
    // 노드를 고르면 같은 패널이 열린다"). 요약 표 자체는 이 디렉터리 밖(canvas.js)에
    // 있어 그 쪽 행 클릭 배선은 이 파일의 몫이 아니다 — 호출자가 entityId·설명
    // 데이터를 이 메서드로 넘기면 같은 패널이 연다.
    selectEntity(entityId, panelData) {
      state = store.selectEntity(state, entityId, panelData);
      renderSelection();
    },
    clearSelection() {
      state = store.clearSelection(state);
      renderSelection();
    },
    collapseCluster() {
      state = store.collapseCluster(state);
      redrawFromCache();
    },
    // 요약 표 ↔ 군집 지도 서브뷰 전환(스텝2-보정) — canvas.js의 옛 z-index
    // 임시조치(focusGraphSurface)를 대체한다. hidden 소유권은 applyVisibility()
    // 하나뿐이라 여기서도 안 건드리고 store.setSurface()로만 바꾼다.
    //
    // 지도로 전환할 때는 항상 강제로 다시 그린다(draw(true)) — #graphCanvas가
    // hidden인 동안엔 elements.graphBody.clientWidth/Height가 0이라(브레인
    // 응답이 요약 서브뷰를 보는 중에 도착하면 draw()가 이미 0×0으로 한 번
    // 그렸을 수 있다), 지도가 실제로 보이는 이 시점의 진짜 치수로 재계산해야
    // 배치가 한쪽에 뭉치지 않는다. redrawFromCache()는 이미 계산된(잘못됐을
    // 수 있는) 좌표를 재필터링만 할 뿐 치수를 다시 안 재므로 여기선 안 맞는다.
    async setSurface(nextSurface) {
      if (state.surface === nextSurface) return null;
      state = store.setSurface(state, nextSurface);
      applyVisibility();
      // 수집·노출(보드 05)은 진입할 때마다 다시 그린다 — 설정 오버레이(같은
      // 저장소를 보는 두 번째 입구)에서 값을 바꾸고 돌아왔을 수 있다.
      if (state.surface === store.SURFACE_SETTINGS) {
        renderSelection(); // 노드 패널을 접는다(위 renderSelection 주석 참고).
        if (typeof onEnterSettings === 'function') onEnterSettings();
        return null;
      }
      if (state.surface === store.SURFACE_MAP) {
        return draw(true);
      }
      renderSelection();
      return null;
    },
  };
}

const __exports = {
  createGraphModeController,
  // 관계명 한글 사전 — 되물을 것들 카드(brain-questions.js)가 주입받아 쓴다.
  // 공통 패널·엔티티 타임라인과 같은 사전이어야 한 화면이 두 말을 하지 않는다.
  RELATION_LABELS,
  clusterTitle,
  entityPairKey,
  computeGraphHeaderMeta,
  formatEventDate,
  buildTimelineRows,
  topSurprising,
  countRelationEvents,
  hiddenLinkReasonClauses,
  relativeScoreText,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphModeController = __exports;
}

})();
