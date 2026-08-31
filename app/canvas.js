const { sanitize } = window.AthenaLib.Sanitize;
const { renderMarkdownInto } = window.AthenaLib.Markdown;
const { errorNote, removeCard } = window.AthenaLib.UiKit;
const { widthGradeFor, dropTargetsFor, exceedsHeightBudget, MIN_CARDS } = window.AthenaLib.CanvasLayout;
const { foldColumns } = window.AthenaLib.ColumnFold;
const { createChartCard } = window.AthenaLib.ChartCard;
const { AITS_CHART_RENDERER_ID, createAitsChartPanelAdapter, fromAthenaChartData, parseAitsChartSnapshot, panelIdFor } = window.AthenaLib.AitsChartPanel;
const { classifyCell, changeTone, formatNumeric, formatDatetime, groupFactsFields } = window.AthenaLib.FactsCard;
const { isValidCorrelation, waitForVisiblePaint } = window.AthenaLib.RestCanvasPaint;
const integratedCardSurface = window.AthenaLib.IntegratedCardSurface;
const semanticDetailSheet = window.AthenaLib.SemanticDetailSheet;
const semanticWorkspace = window.AthenaLib.SemanticWorkspace;
const paperCardRouting = window.AthenaLib.PaperCardRouting;
const SEMANTIC_PRIMARY_TYPES = new Set(['table', 'chart', 'facts', 'compound', 'event', 'action', 'status']);

function developerDiagnosticsEnabled() {
  return window.__ATHENA_DEVELOPER_DIAGNOSTICS__ === true;
}

function upsertDeveloperDiagnostics(root, envelope) {
  if (!developerDiagnosticsEnabled() || !semanticDetailSheet) return null;
  return semanticDetailSheet.upsert(root, envelope);
}

// 모든 chart surface의 유일한 세션/DTO 권위. 실제 그리기는 기존 하나의
// lightweight-charts controller만 주입하며 별도 renderer/BrowserWindow는 없다.
const aitsChartPanels = createAitsChartPanelAdapter({ renderChart: createChartCard, maxPanels: 6 });
// 시세 카드 실시간 세션(단계 8 확장) — 차트와 같은 0B 체결 피드를 나눠 쓴다
// (아래 athena:chart-ticks 구독 하나가 둘 다에게 보낸다). 채널을 새로 안 만든다.
const { createQuoteRealtimePanelAdapter } = window.AthenaLib.QuoteRealtimePanel;
const quoteRealtimePanels = createQuoteRealtimePanelAdapter();
// 호가 카드 실시간 세션(task #25) — 같은 어댑터 팩토리를 새 인스턴스로 재사용한다
// (0B 체결과 0D 호가잔량은 완전히 다른 피드라 패널을 나눈다).
const orderbookRealtimePanels = createQuoteRealtimePanelAdapter();

// snapshot().period는 AITS 표기(day/week/…)다. 과거 조회 IPC는 툴바와 같은
// UI 주기 코드를 쓰므로 여기서 되돌린다.
const PERIOD_TO_ATHENA_UI = Object.freeze({
  tick: 'TICK', min: 'MIN', day: 'D', week: 'W', month: 'M', year: 'Y',
});

// 실시간 진행봉 — main이 키움 REAL 0B에서 파싱한 체결을 그대로 보낸다. 어댑터가
// 종목이 맞는 열린 패널마다 마지막 봉에 접어 넣는다(applyRealtimeTick). 해당
// 종목 패널이 없으면 아무 일도 일어나지 않는다 — 여기서 카드를 만들지 않는다.
if (window.athena && typeof window.athena.on === 'function') {
  window.athena.on('athena:chart-ticks', (ticks) => {
    if (!Array.isArray(ticks)) return;
    for (const tick of ticks) {
      aitsChartPanels.applyRealtimeTick(tick).catch(() => { /* 진행봉 실패는 차트를 죽이지 않는다 */ });
      quoteRealtimePanels.applyRealtimeTick(tick); // 종목 불일치·열린 카드 없음은 내부에서 조용히 버려진다
    }
  });
  // 호가잔량(0D, task #25) — main이 lib/main/orderbook-realtime.js로 파싱해
  // 넘긴다. 열린 호가 카드가 없으면(wireOrderbookRealtime 미배선) 내부에서
  // 조용히 버려진다.
  window.athena.on('athena:orderbook-ticks', (ticks) => {
    if (!Array.isArray(ticks)) return;
    for (const tick of ticks) orderbookRealtimePanels.applyRealtimeTick(tick);
  });
}

// event/status 카드(Paper AT-CV-005 보호 워크플로) — 지금까지 이 두 canvas_type을
// 채우는 발신처가 없어 렌더러만 있고 카드는 뜬 적이 없었다(2026-08-26 동적 추적,
// screen-matrix.md #11 정정). lib/protected-cards.js가 앱이 이미 갖고 있는 실신호
// (루틴 발화·인증 토큰 변경)만으로 기존 renderEventCard/renderStatusCard가 기대하는
// envelope을 조립한다 — 백엔드 WS 인프라를 새로 놓지 않는다.
if (window.athena && typeof window.athena.on === 'function' && window.AthenaLib.ProtectedCards) {
  const protectedCards = window.AthenaLib.ProtectedCards;
  window.athena.on('athena:routine-event', (event) => {
    const built = protectedCards.buildRoutineFiredEventCard(event);
    if (built) addLiveCard(built);
  });
  window.athena.on('athena:auth-token-changed', (payload) => {
    addLiveCard(protectedCards.buildAuthTokenStatusCard(payload));
  });
}

// 프로브·검증용 읽기 창구(window.addCard와 같은 관례). 상태를 바꾸지 않는다 —
// 실시간 진행봉이 실제로 갱신됐는지 값으로 확인할 길이 달리 없다(캔버스에 그려진
// 가격 라벨은 DOM이 아니다).
const mountedChartSessions = new Map();
window.__athenaChartProbe = {
  snapshot: () => aitsChartPanels.snapshot(),
  // 가시 구간을 직접 옮겨 "좌측 끝 도달"을 재현한다 — 사용자의 팬과 같은 신호를
  // 차트에 준다(subscribeVisibleLogicalRangeChange가 동일하게 발화한다).
  timeScale: () => {
    const session = mountedChartSessions.values().next().value;
    return session && session.renderer && session.renderer.chart
      ? session.renderer.chart.timeScale() : null;
  },
};

window.addEventListener('beforeunload', () => {
  // main의 releaseAll은 active/pending lease를 한 번에 drain한다. 개별 카드 DOM이
  // 브라우저 teardown으로 먼저 사라져도 REG가 남지 않게 renderer dispose 경로에서
  // 반드시 호출한다.
  void window.athena.invoke('athena:integrated-card-realtime-release-all').catch(() => {});
  for (const session of aitsChartPanels.snapshot()) {
    window.athena.send('athena:chart-panel-destroyed', { panelId: session.panelId });
  }
  aitsChartPanels.destroyAll();
}, { once: true });

async function loadFixture(kind) {
  return window.athena.invoke('athena:load-fixture', { kind });
}

// ---------- 글자 크기 5단계 (2026-08-19, 설정 › 화면 › 글자 크기) ----------
// chat.js와 같은 문법 — tokens.css의 :root[data-font-size=...] 토큰 세트를 켠다.
// md는 기본 토큰이라 속성을 지운다. 부팅 시 1회 조회 + prefs-changed 방송 반영.
function applyFontSizePref(p) {
  const v = p && p.fontSize;
  if (v && v !== 'md') document.documentElement.dataset.fontSize = v;
  else delete document.documentElement.dataset.fontSize;
  // 유리 투명도 3단(2026-08-22) — 같은 방송을 타고 두 창에 함께 적용된다.
  const g = p && p.glassLevel;
  if (g && g !== 'default') document.documentElement.dataset.glass = g;
  else delete document.documentElement.dataset.glass;
}
(async () => {
  try {
    applyFontSizePref(await window.athena.invoke('athena:settings:prefs:get'));
  } catch { /* 채널 없음 — 기본 크기 유지 */ }
})();
window.athena.on('athena:prefs-changed', (next) => applyFontSizePref(next));

// 카드별 destroy 콜백 — closeCard가 lightweight-charts 인스턴스를 누수 없이
// 정리하도록 카드 DOM 노드에 매달아둔다(WeakMap: 카드가 GC되면 콜백도 같이 사라짐).
const cardDestroyers = new WeakMap();
// 통합 카드 하나 안의 각 mode/section은 기존 차트·호가 renderer의 lifecycle을
// 그대로 소유한다. 같은 panel key가 갱신될 때만 해당 lifecycle을 닫고, 카드가
// 닫히면 남은 panel을 모두 닫는다.
const integratedPanelDestroyers = new WeakMap();
const integratedRealtimeTasks = new WeakMap();
let integratedRealtimePoliciesPromise = null;
const INTEGRATED_CLEANUP_TIMEOUT_MS = 1500;

function settleCleanup(pending, timeoutMs = INTEGRATED_CLEANUP_TIMEOUT_MS) {
  if (!pending || typeof pending.then !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    Promise.resolve(pending).catch(() => {}).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function destroyCard(card) {
  if (!card) return;
  const destroy = cardDestroyers.get(card);
  cardDestroyers.delete(card);
  // DOM 소유권은 정리 IPC보다 먼저 끝낸다. clear 직후 같은 instance가 다시
  // 렌더돼도 죽는 root를 재발견하지 않고, hung IPC가 화면을 붙잡지 못한다.
  integratedCardSurface.detachForDestroy(card);
  if (destroy) {
    try {
      const pending = destroy();
      if (pending && typeof pending.then === 'function') {
        return settleCleanup(pending);
      }
    } catch {}
  }
}

const grid = document.getElementById('grid');
let activeDatasetId = null;

if (window.athena && typeof window.athena.on === 'function') {
  window.athena.on('athena:integrated-card-realtime-state', (state) => {
    if (!state || !state.leaseId) return;
    const root = Array.from(grid.querySelectorAll('.card'))
      .find((candidate) => candidate.__athenaIntegratedRealtime
        && candidate.__athenaIntegratedRealtime.leaseId === String(state.leaseId));
    if (!root) return;
    stampIntegratedRealtimeState(root, state);
  });
  window.athena.on('athena:integrated-card-realtime-ticks', (ticks) => {
    for (const tick of Array.isArray(ticks) ? ticks : [ticks]) {
      if (!tick || !tick.leaseId) continue;
      const root = Array.from(grid.querySelectorAll('.card'))
        .find((candidate) => candidate.__athenaIntegratedRealtime
          && candidate.__athenaIntegratedRealtime.leaseId === String(tick.leaseId));
      if (!root) continue;
      const realtime = integratedRealtimeMeta(root);
      const accepts = integratedCardSurface.matchesRealtimeTick({
        leaseId: realtime.leaseId,
        cardId: root.dataset.cardId,
        mode: root.__athenaIntegratedMetadata && root.__athenaIntegratedMetadata.mode,
        target: realtime.target,
        generation: realtime.generation,
        connectionGeneration: realtime.connectionGeneration,
        operationIds: realtime.operationIds || [],
      }, tick);
      if (!accepts) continue;
      if (root.dataset.taskCanvas === 'true' && semanticWorkspace) {
        semanticWorkspace.applyRealtimeTick(root, tick);
      }
      if (developerDiagnosticsEnabled() && semanticDetailSheet) {
        semanticDetailSheet.applyRealtimeTick(root, tick);
      }
      root.dispatchEvent(new CustomEvent('athena-integrated-card-tick', { detail: tick }));
    }
  });
}

// 정지 상태 규범(soul.md §8 정보 정직성 — 데이터 위에 잔류 블러가 남으면 안 된다)은
// CSS 하나로 성립한다: canvas.css .glass-sheen의 blur(0px)가 유일한 값이고
// 이 값을 인라인으로 덮는 코드가 없다.

// ---------- 캔버스 빈 상태(보드 05) ----------
// 옛 판은 `.grid:empty::before` 한 줄짜리 CSS pseudo-content였다. 숫자·CTA를
// 담으려면 실DOM이 필요해 #grid의 형제(#gridEmpty)로 옮겼다 — pseudo-content는
// 정적 문자열만 가능하고 버튼도 못 담는다. 보이고/숨기고는 #grid의 자식 수에만
// 달렸으므로 카드 추가/삭제 호출부 전부를 따라다니는 대신 MutationObserver
// 하나로 건다 — "카드가 뜨면 사라지고 비면 돌아온다"가 어떤 경로로 비워지든
// (destroyCard/clearCanvases/enforceHeightBudget…) 자동으로 성립한다.
const gridEmptyEl = document.getElementById('gridEmpty');
function syncGridEmptyVisibility() {
  if (!gridEmptyEl) return;
  gridEmptyEl.hidden = grid.children.length > 0;
}
new MutationObserver(syncGridEmptyVisibility).observe(grid, { childList: true });
syncGridEmptyVisibility();

// 삽화 — 그래프 모티프(선 5·원 6), 참조 목업(board-05.png)의 성긴 비대칭 배치를
// 옮겼다. 그래프 모드 배치 알고리즘과는 무관한 순수 장식이다. 무채색(currentColor)
// 하나로 톤을 낮춘다 — 브랜드색은 화면당 인터랙션 지점 하나에만(palette.md).
function buildEmptyCanvasIllustration() {
  const wrap = document.createElement('div');
  wrap.className = 'canvas-empty-graph';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 74');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '74');
  svg.setAttribute('aria-hidden', 'true');
  const nodes = [
    { x: 22, y: 20, r: 4 },
    { x: 30, y: 44, r: 9 },
    { x: 66, y: 32, r: 7 },
    { x: 94, y: 18, r: 4.5 },
    { x: 100, y: 46, r: 4 },
    { x: 78, y: 58, r: 3.5 },
  ];
  const edges = [[1, 0], [1, 2], [2, 3], [2, 4], [2, 5]];
  for (const [a, b] of edges) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', nodes[a].x);
    line.setAttribute('y1', nodes[a].y);
    line.setAttribute('x2', nodes[b].x);
    line.setAttribute('y2', nodes[b].y);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1');
    line.setAttribute('opacity', '0.35');
    svg.appendChild(line);
  }
  nodes.forEach((n, i) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', n.r);
    circle.setAttribute('fill', 'currentColor');
    circle.setAttribute('opacity', i === 1 ? '0.55' : '0.3');
    svg.appendChild(circle);
  });
  wrap.appendChild(svg);
  return wrap;
}

// 뼈대(삽화+제목+부제)는 항상 그린다 — 브레인이 꺼져 있어도 "카드가 없다"는
// 사실 자체는 늘 참이다. 숫자·CTA·힌트는 뒤에서 준비되면 append로 더한다
// (appendEmptyCanvasExtras) — 브레인 상태를 아직 모르는 부팅 초반에도 빈
// 화면 대신 뼈대가 바로 보인다.
// 대화 모드 상징 삽화(보드 46 v3, 2026-08-27) — 그래프 쪽 노드 별자리와 같은
// 어휘(회색 선·점, currentColor)로 말풍선 둘 + 입력 중 점 셋을 그린다.
function buildChatIllustration() {
  const wrap = document.createElement('div');
  wrap.className = 'canvas-empty-art';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '72');
  svg.setAttribute('viewBox', '0 0 120 72');
  const mk = (tag, attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  // 큰 말풍선(질문) — 윤곽선 + 왼쪽 아래 꼬리
  svg.appendChild(mk('path', {
    d: 'M18 8 H74 Q84 8 84 18 V32 Q84 42 74 42 H36 L26 52 V42 H18 Q8 42 8 32 V18 Q8 8 18 8 Z',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', opacity: '0.35',
  }));
  // 입력 중 점 셋 — 가운데 점이 진하다(그래프 삽화의 허브 노드와 같은 강세)
  svg.appendChild(mk('circle', { cx: '34', cy: '25', r: '3', fill: 'currentColor', opacity: '0.3' }));
  svg.appendChild(mk('circle', { cx: '46', cy: '25', r: '3.5', fill: 'currentColor', opacity: '0.55' }));
  svg.appendChild(mk('circle', { cx: '58', cy: '25', r: '3', fill: 'currentColor', opacity: '0.3' }));
  // 작은 답변 말풍선 — 오른쪽 아래, 옅게
  svg.appendChild(mk('path', {
    d: 'M78 44 H104 Q112 44 112 51 V57 Q112 64 104 64 H90 L84 70 V64 H78 Q70 64 70 57 V51 Q70 44 78 44 Z',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', opacity: '0.28',
  }));
  wrap.appendChild(svg);
  return wrap;
}

// 모드가 다르면 빈 화면도 다르다(Paper 보드 46, 2026-08-27 검토 결정) — 대화
// 캔버스에 그래프 일러스트가 나오던 문제의 처방. 두 변형을 모두 만들어 두고
// #canvasRegion[data-mode](graph-mode controller가 소유)가 하나만 보여준다.
function buildEmptyCanvasSkeleton() {
  if (!gridEmptyEl) return;
  gridEmptyEl.replaceChildren();
  // 대화 모드 — 상징 삽화 + 회전 문구(보드 46 v3, 2026-08-27 3차 피드백).
  // 문구는 applyEmptyCopy가 시간대·성향 풀에서 채운다.
  const chatBox = document.createElement('div');
  chatBox.className = 'canvas-empty canvas-empty-chat';
  chatBox.appendChild(buildChatIllustration());
  const chatCopy = document.createElement('div');
  chatCopy.className = 'canvas-empty-copy';
  const chatTitle = document.createElement('div');
  chatTitle.className = 'canvas-empty-title';
  const chatSub = document.createElement('div');
  chatSub.className = 'canvas-empty-sub';
  chatCopy.append(chatTitle, chatSub);
  chatBox.appendChild(chatCopy);
  // 그래프 모드 — 성향 축적 히어로. 옛 대화 빈 화면에서 이사 왔다(수치·힌트는
  // appendEmptyCanvasExtras가 브레인 준비 시에만 붙인다 — 정보 정직성 유지).
  const graphBox = document.createElement('div');
  graphBox.className = 'canvas-empty canvas-empty-graphmode';
  graphBox.appendChild(buildEmptyCanvasIllustration());
  const graphCopy = document.createElement('div');
  graphCopy.className = 'canvas-empty-copy';
  const graphTitle = document.createElement('div');
  graphTitle.className = 'canvas-empty-title';
  graphTitle.textContent = '그동안 나눈 대화와 체결로 성향은 계속 쌓이고 있습니다';
  graphCopy.appendChild(graphTitle);
  graphBox.appendChild(graphCopy);
  gridEmptyEl.append(chatBox, graphBox);
}
buildEmptyCanvasSkeleton();

// 문구 회전(보드 46 v3) — 시간대·성향 풀에서 시드로 고른다(lib/empty-canvas.js
// pickEmptyCopy, 순수·테스트됨). 빈 화면이 보일 때만 45초마다 다시 고른다.
// ponytail: 회전 주기 45s 고정 — 체감 조정이 필요하면 이 상수만 바꾼다.
let emptyCopyProfileTop = null;
function applyEmptyCopy(seed) {
  if (!gridEmptyEl) return;
  const box = gridEmptyEl.querySelector('.canvas-empty-chat');
  if (!box) return;
  const picked = window.AthenaLib.EmptyCanvas.pickEmptyCopy({
    hour: new Date().getHours(),
    profileTop: emptyCopyProfileTop,
    seed,
  });
  box.querySelector('.canvas-empty-title').textContent = picked.title;
  box.querySelector('.canvas-empty-sub').textContent = picked.sub;
}
applyEmptyCopy(Date.now());
setInterval(() => {
  if (gridEmptyEl && !gridEmptyEl.hidden) applyEmptyCopy(Date.now());
}, 45000);

// 수치·CTA·힌트 — 브레인이 준비됐을 때만 붙인다(그래프 필과 같은 규율 — 없는
// 기능을 있다고 표시하지 않는다). CTA는 그래프 모드 필과 똑같이 ready 하나에만
// 달렸다 — 군집 지도 조회가 실패해도 그래프 모드 자체는 열 수 있다.
// "최근 7일" 델타는 뺐다 — analysis/diff는 리비전 구간(from_revision) 기준이라
// "7일 전 리비전"을 알 방법이 없어 실측 없는 숫자를 만들게 된다(정보 정직성).
function appendEmptyCanvasExtras(stats, hintCount) {
  if (!gridEmptyEl) return;
  // 수치·힌트는 그래프 변형에만 붙는다(보드 46) — 대화 빈 화면은 깨끗하게.
  // '성향 그래프 열기' CTA는 없앴다: 진입로는 사이드바 모드 네비(셸 v2)가
  // 이미 상시 제공하고, 그래프 모드 안에서는 자기 자신을 여는 버튼이 된다.
  const box = gridEmptyEl.querySelector('.canvas-empty-graphmode');
  if (!box) return;
  if (stats) {
    const row = document.createElement('div');
    row.className = 'canvas-empty-stats';
    row.textContent = `엔티티 ${stats.entities} · 테마 군집 ${stats.clusters}`;
    box.appendChild(row);
  }
  if (hintCount) {
    const hint = document.createElement('div');
    hint.className = 'canvas-empty-hint';
    hint.textContent = `확인이 필요한 것 ${hintCount}건이 기다리고 있습니다`;
    box.appendChild(hint);
  }
}

// 브레인 상태 프로브(그래프 모드 부팅 IIFE, 아래)가 ready를 확인한 뒤 부른다 —
// 같은 확인을 두 번 왕복하지 않는다. 군집 지도·되물을 것들 조회가 실패해도
// CTA는 남는다(catch로 개별 무력화) — 숫자 하나 못 얻었다고 그래프 모드
// 진입로까지 지울 이유는 없다.
async function loadEmptyCanvasExtras() {
  const [clusterRes, questionsRes, profileRes] = await Promise.all([
    window.athena.invoke('athena:brain-cluster-map').catch(() => null),
    window.athena.invoke('athena:brain-suggested-questions').catch(() => null),
    // 회전 문구의 성향 갈래(보드 46 v3) — 상위 1건의 이름만 쓴다.
    window.athena.invoke('athena:brain-profile-summary', { limit: 1 }).catch(() => null),
  ]);
  const { clusterStats, suggestedCount } = window.AthenaLib.EmptyCanvas;
  const stats = clusterRes && clusterRes.ok ? clusterStats(clusterRes.nodes) : null;
  const hintCount = questionsRes && questionsRes.ok ? suggestedCount(questionsRes.questions) : null;
  appendEmptyCanvasExtras(stats, hintCount);
  const profEntries = profileRes && profileRes.ok ? (profileRes.entries || profileRes.rows) : null;
  const topEntry = Array.isArray(profEntries) ? profEntries[0] : null;
  emptyCopyProfileTop = (topEntry && (topEntry.entity_name || topEntry.entity_id)) || null;
  if (emptyCopyProfileTop) applyEmptyCopy(Date.now());
}

// ---------- 캔버스 카드 추가/초기화/하이라이트 ----------
window.athena.on('athena:add-canvas', ({ type }) => {
  addCard(type);
});

// 카드 비우기 — 옛 판에서는 main이 캔버스 창을 수축시킬 때 `athena:clear-canvases`
// IPC로 보냈다. 두 영역이 같은 문서에 사는 지금은 IPC를 왕복할 이유가 없다:
// chat.js의 Esc(유휴 상태)가 shell.js 버스를 통해 이 함수를 직접 부른다.
function clearCanvases() {
  for (const card of grid.querySelectorAll('.card')) {
    destroyCard(card);
  }
  activeDatasetId = null;
}

window.AthenaShell.registerCanvasClear(clearCanvases);

window.athena.on('athena:add-rest-canvas', async (payload) => {
  const receivedAt = performance.now();
  const correlation = payload && payload.envelope && payload.envelope.correlation;
  if (!payload || !isValidCorrelation(correlation)) return;
  try {
    const envelope = Object.assign({}, payload.envelope, {
      operation_ref: payload.operationRef,
      operation_args: payload.operationArgs,
    });
    const card = await addLiveCard({ status: 'success', envelope });
    if (card && REST_RETRY_CARD_ID_PATTERN.test(String(payload.retryCardId || ''))) {
      Object.defineProperty(card, '__athenaRestRetryCardId', {
        value: String(payload.retryCardId), configurable: true, writable: false,
      });
    }
    const domAttachedAt = performance.now();
    const chartImportReadyAt = card && card.dataset.chartImportReadyAt
      ? Number(card.dataset.chartImportReadyAt) : null;
    const paint = await waitForVisiblePaint(card);
    window.athena.send('athena:rest-canvas-painted', {
      dataset_id: correlation.dataset_id,
      item_id: correlation.item_id,
      ordinal: correlation.ordinal,
      operation_ref: payload.operationRef,
      canvas_type: payload.canvasType,
      render_state: card && card.dataset.renderState ? card.dataset.renderState : 'data',
      renderer_id: card && card.dataset.rendererId ? card.dataset.rendererId : null,
      panel_id: card && card.dataset.chartPanelId ? card.dataset.chartPanelId : null,
      generation: card && card.dataset.chartGeneration ? Number(card.dataset.chartGeneration) : null,
      verified_visible: paint.verifiedVisible,
      dom_attached_at: domAttachedAt,
      visible_paint_at: paint.visiblePaintAt,
      inline_to_chart_import_ms: Number.isFinite(chartImportReadyAt)
        ? Math.max(0, chartImportReadyAt - receivedAt) : null,
      chart_import_to_dom_ms: Number.isFinite(chartImportReadyAt)
        ? Math.max(0, domAttachedAt - Math.max(receivedAt, chartImportReadyAt)) : null,
      inline_to_dom_ms: Math.max(0, domAttachedAt - receivedAt),
      dom_to_paint_ack_ms: Math.max(0, paint.visiblePaintAt - domAttachedAt),
      rect: paint.rect,
    });
  } catch (error) {
    window.athena.send('athena:rest-canvas-painted', {
      dataset_id: correlation.dataset_id,
      item_id: correlation.item_id,
      ordinal: correlation.ordinal,
      operation_ref: payload.operationRef,
      canvas_type: payload.canvasType,
      render_state: 'error',
      renderer_id: null,
      panel_id: null,
      generation: null,
      verified_visible: false,
      error: String((error && error.message) || error),
    });
  }
});

const REST_RETRY_STATES = new Set(['timeout', 'cancelled', 'error']);
const REST_RETRY_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REST_RETRY_CARD_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function attachRestRetryAction(card, retryId) {
  if (!card || !retryId) return;
  const body = card.querySelector('.card-body');
  if (!body) return;
  const prior = card.querySelector('.rest-retry-action');
  if (prior) prior.remove();
  const action = document.createElement('div');
  action.className = 'rest-retry-action';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '다시 시도';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const finishConsumed = (message) => {
    button.remove();
    action.dataset.consumed = 'true';
    status.textContent = message;
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = '다시 시도 중…';
    status.textContent = '';
    try {
      const result = await window.athena.invoke('athena__render_canvas', {
        source: 'rest-retry',
        retryId,
      });
      if (!result || !result.ok) {
        finishConsumed((result && result.error) || '다시 조회하지 못했습니다.');
        return;
      }
      status.textContent = '다시 조회했습니다.';
      if (card.isConnected) destroyCard(card);
      else button.remove();
    } catch {
      finishConsumed('다시 조회하지 못했습니다.');
    }
  });
  action.appendChild(button);
  action.appendChild(status);
  body.appendChild(action);
}

window.athena.on('athena:rest-retry-available', (payload = {}) => {
  const retryId = typeof payload.retryId === 'string' ? payload.retryId : '';
  const state = String(payload.state || '');
  const cardId = typeof payload.cardId === 'string' ? payload.cardId : '';
  if (retryId.length !== 43 || !REST_RETRY_ID_PATTERN.test(retryId)
    || cardId.length !== 36 || !REST_RETRY_CARD_ID_PATTERN.test(cardId)
    || !REST_RETRY_STATES.has(state)) return;
  let card = Array.from(grid.querySelectorAll('.card'))
    .find((candidate) => candidate.__athenaRestRetryCardId === cardId);
  if (!card) {
    card = renderRestStateCard({ canvas_type: 'notice', state });
    Object.defineProperty(card, '__athenaRestRetryCardId', {
      value: cardId, configurable: true, writable: false,
    });
  }
  attachRestRetryAction(card, retryId);
});

// ---------- 실배선 — stream-json-parser.classifyCanvasBlock()의 결과를 렌더 ----------
// main.js가 athena__render_canvas(source:'live')로 claude -p를 실왕복한 뒤 매
// render_canvas tool_result마다 이걸 보낸다. status는 success/fallback(둘 다
// canvas_type을 읽어 렌더한다) · rejected/error/unparseable(카드 대신 안내만).
window.athena.on('athena:add-canvas-live', async (result) => {
  const rendererReceivedAt = performance.now();
  const node = await addLiveCard(result);
  if (!node || !result || (result.status !== 'success' && result.status !== 'fallback')) return;
  window.AthenaProviderFirstPaint.claimFirstVisible({
    clientSubmitId: result.clientSubmitId,
    turnId: result.turnId,
    sequence: result.sequence,
    origin: 'shell',
    owner: 'canvas',
    node,
    rendererReceivedAt,
  });
});

async function addLiveCard(result) {
  if (!result) return renderLiveNotice('빈 응답을 받았다.');
  if (result.status === 'rejected') {
    return renderLiveNotice('캔버스 호출이 거부됐다 — --allowedTools 권한이 없다.');
  }
  if (result.status === 'error') {
    return renderLiveNotice('캔버스 호출이 게이트웨이/upstream 에러로 실패했다.');
  }
  if (result.status === 'unparseable') {
    return renderLiveNotice(`캔버스 응답을 해석하지 못했다 — ${result.reason || '원인 미상'}.`);
  }
  const envelope = result.envelope;
  if (!envelope) return renderLiveNotice('캔버스 응답에 데이터가 없다.');
  if (envelope.state) return renderRestStateCard(envelope);
  // 턴별 큐레이션(배치·생애주기 규칙 3, canvas-taxonomy) — 모델이 봉투
  // drop_types로 지목한, 현재 질의와 무관해진 카드를 렌더 전에 치운다.
  // 'table'은 픽스처 table과 실배선 mcp-table 둘 다다(lib/canvas-layout.js).
  for (const cls of dropTargetsFor(envelope.drop_types)) {
    const el = grid.querySelector(`.card.${cls}`);
    if (el) destroyCard(el);
  }
  // ★ canvas_type은 응답값이다 — 요청값이 아니다(S4 RESULT.md §5). success/fallback
  // 둘 다 이 필드로 어떤 카드를 그릴지 정한다. 알려진 4종(table/stream/reader) 중
  // 하나가 아니면(대개 free로 폴백) 자유 카드로 떨어뜨린다 — 폴백은 예외가 아니라
  // 흔한 경로다. `!envelope.fell_back`은 방어적 중복이다 — canvas.py의
  // validate_canvas_payload()는 폴백 시 canvas_type 자체를 'free'로 바꿔 보내므로
  // (backend/athena_mcp/canvas.py L152-157) 이론상 fell_back=true인데 canvas_type이
  // 'stream'/'reader'/'table'로 남는 조합은 안 나오지만, 계약이 바뀌어도 조용히
  // 깨진 카드를 그리지 않도록 남겨둔다.
  // Paper 카드 전용 배선 — 판정 규칙은 lib/paper-card-routing.js가 단독 소유한다
  // (canvas.js는 shell.html에서만 도는 렌더러라 단위 테스트가 안 걸린다).
  // 키움 봉투인데 카드 계약이 없으면 레거시 범용 카드로 조용히 떨어뜨리지 않는다 —
  // 그건 백엔드 계약 파생 실패이고, 감추면 사용자는 알 수 없는 표를 본다.
  const route = paperCardRouting.paperCardRoute(envelope, {
    integratedCardSurface,
    semanticWorkspace,
  });
  if (route === 'integrated') return renderIntegratedCard(envelope);
  if (route === 'workspace') return renderTaskCanvasEnvelope(envelope);
  if (route === 'blocked') return renderLiveNotice(paperCardRouting.blockedReason(envelope));
  return renderPrimaryEnvelope(envelope);
}

function renderPrimaryEnvelope(envelope, options = {}) {
  if (envelope.canvas_type === 'table' && !envelope.fell_back) return renderMcpTable(envelope);
  if (envelope.canvas_type === 'stream' && !envelope.fell_back) return renderLiveStream(envelope);
  if (envelope.canvas_type === 'reader' && !envelope.fell_back) return renderLiveReader(envelope);
  if (envelope.canvas_type === 'chart' && !envelope.fell_back) return renderLiveChart(envelope, options.integratedRoot);
  if (envelope.canvas_type === 'facts' && !envelope.fell_back) return renderFactsCard(envelope);
  if (envelope.canvas_type === 'compound' && !envelope.fell_back) return renderCompoundCard(envelope);
  if (envelope.canvas_type === 'event' && !envelope.fell_back) return renderEventCard(envelope);
  if (envelope.canvas_type === 'action' && !envelope.fell_back) return renderActionCard(envelope);
  if (envelope.canvas_type === 'status' && !envelope.fell_back) return renderStatusCard(envelope);
  return renderFreeCanvas(envelope);
}

async function renderTaskCanvasEnvelope(envelope) {
  // task-canvas는 presentation_contract가 유일한 표시 계약이다. 전문 renderer가
  // 명시된 경우 기존 CardKinds/AITS 결과를 primary surface로 유지하지만, 알 수
  // 없는 canvas_type을 free JSON tree로 내리는 경로는 사용하지 않는다.
  let root = null;
  if (SEMANTIC_PRIMARY_TYPES.has(envelope.canvas_type) && !envelope.fell_back) {
    root = await renderPrimaryEnvelope(envelope);
  } else {
    root = createSemanticWorkspaceCard(envelope);
  }
  if (!root) root = createSemanticWorkspaceCard(envelope);
  root = replaceUnsafeTaskPrimary(root, envelope);
  semanticWorkspace.upsert(root, envelope);
  upsertDeveloperDiagnostics(root, envelope);
  return root;
}

function createSemanticWorkspaceCard(envelope) {
  const presentation = semanticWorkspace.normalizePresentation(envelope);
  return makeCard(
    'semantic-workspace-card',
    presentation ? presentation.title : '분석 결과',
    envelope.layout,
    envelope.correlation,
    undefined,
    cardStkCd(envelope),
    envelope.screen_id,
  ).card;
}

function replaceUnsafeTaskPrimary(rendered, envelope) {
  if (!rendered || semanticWorkspace.isSafePrimary(envelope, rendered)) return rendered;
  // Generic table/facts/compound/free renderers can contain backend alias keys.
  // task-canvas production DOM is presentation_contract-only, so discard the
  // transient generic card before any of its nodes enter an integrated root.
  destroyCard(rendered);
  return createSemanticWorkspaceCard(envelope);
}

async function renderIntegratedCard(envelope) {
  const instanceKey = integratedCardSurface.instanceKeyFor(envelope);
  const existing = integratedCardSurface.findReusableRoot(
    grid.querySelectorAll('.card[data-integrated-instance-key]'), instanceKey,
  );
  // makeCard의 구형 type/dataset 교체 규칙이 같은 통합 root를 먼저 지우지 못하게
  // 잠시 중립화한다. 실제 renderer는 별도 임시 root에 완전한 primary UI를 만든다.
  integratedCardSurface.prepareExisting(existing);
  const isTaskCanvas = semanticWorkspace && semanticWorkspace.isTaskCanvasEnvelope(envelope);
  const hasPrimaryRenderer = SEMANTIC_PRIMARY_TYPES.has(envelope.canvas_type) && !envelope.fell_back;
  let rendered = isTaskCanvas && !hasPrimaryRenderer
    ? createSemanticWorkspaceCard(envelope)
    : await renderPrimaryEnvelope(envelope, { integratedRoot: existing });
  if (!rendered && isTaskCanvas) rendered = createSemanticWorkspaceCard(envelope);
  if (isTaskCanvas && hasPrimaryRenderer && rendered !== existing) {
    rendered = replaceUnsafeTaskPrimary(rendered, envelope);
  }
  if (!rendered) return existing;
  // AITS는 같은 panel_id를 기존 `.card.chart`에서 직접 reload하고 같은 root를
  // 돌려준다. 이 경우 scaffold를 다시 만들거나 lifecycle ownership을 옮기지 않는다.
  if (rendered === existing) {
    integratedCardSurface.refreshExisting(existing, envelope);
    if (semanticWorkspace) semanticWorkspace.upsert(existing, envelope);
    upsertDeveloperDiagnostics(existing, envelope);
    syncIntegratedRealtime(existing, envelope);
    return existing;
  }

  const incomingDestroy = cardDestroyers.get(rendered) || null;
  const mounted = integratedCardSurface.mountOrUpdate({
    envelope,
    renderedCard: rendered,
    existingCard: existing,
  });
  if (!mounted) return rendered;

  const { root, panelKey, replacedPanel, transientCard } = mounted;
  let panelDestroyers = integratedPanelDestroyers.get(root);
  if (!panelDestroyers) {
    panelDestroyers = new Map();
    integratedPanelDestroyers.set(root, panelDestroyers);
  }
  if (replacedPanel) {
    const priorDestroy = panelDestroyers.get(panelKey);
    if (priorDestroy) {
      try { priorDestroy(); } catch {}
      panelDestroyers.delete(panelKey);
    }
    integratedCardSurface.forgetPanelSession(root, panelKey);
  }
  if (incomingDestroy) panelDestroyers.set(panelKey, incomingDestroy);
  integratedCardSurface.rememberPanelSession(root, envelope, rendered);

  // rendered의 destroyer를 호출하면 방금 옮긴 chart/orderbook DOM까지 닫히므로
  // ownership만 root aggregate로 넘기고 임시 껍데기는 조용히 제거한다.
  cardDestroyers.delete(rendered);
  cardDestroyers.set(root, () => {
    // 차트/호가 세션은 첫 await 전에 닫는다. clear 직후 동일 operation이 오면
    // adapter에 남은 옛 panelId를 재사용해 새 root와 충돌할 수 있기 때문이다.
    const panelCleanup = [];
    for (const destroy of panelDestroyers.values()) {
      try {
        const pending = destroy();
        if (pending && typeof pending.then === 'function') panelCleanup.push(settleCleanup(pending));
      } catch {}
    }
    panelDestroyers.clear();
    integratedPanelDestroyers.delete(root);
    integratedCardSurface.clearPanelSessions(root);
    const realtimeCleanup = (async () => {
      const realtimeTask = integratedRealtimeTasks.get(root);
      if (realtimeTask) await settleCleanup(realtimeTask);
      const realtime = integratedRealtimeMeta(root);
      const leaseId = realtime.leaseId;
      if (leaseId && realtime.mounted === true) {
        await settleCleanup(window.athena.invoke('athena:integrated-card-realtime-unmount', { leaseId }));
      }
      integratedRealtimeTasks.delete(root);
    })();
    return Promise.all([realtimeCleanup, ...panelCleanup]);
  });
  if (transientCard) transientCard.remove();

  if (semanticWorkspace) semanticWorkspace.upsert(root, envelope);
  upsertDeveloperDiagnostics(root, envelope);
  syncIntegratedRealtime(root, envelope);
  // 개발자 진단 surface를 명시적으로 켠 경우에만 wire occurrence identity를
  // 검사한다. production 제품 UI에는 이 DOM 자체를 만들지 않는다.
  if (developerDiagnosticsEnabled() && root.querySelector('.semantic-detail-row:not([data-field-occurrence-id])')) {
    destroyCard(root);
    throw new Error('통합 카드 field occurrence identity가 누락됐다');
  }
  return root;
}

function integratedRealtimePayload(root, envelope) {
  const args = (envelope.operation_args && typeof envelope.operation_args === 'object')
    ? envelope.operation_args : {};
  const context = envelope.source_data && envelope.source_data.canvas_context
    && typeof envelope.source_data.canvas_context === 'object'
    ? envelope.source_data.canvas_context : {};
  const first = (...values) => values.find((value) => typeof value === 'string' && value.trim()) || '';
  const target = integratedCardSurface.targetIdentity(envelope);
  const semanticBindingIds = [...new Set(
    (Array.isArray(envelope.realtime_bindings) ? envelope.realtime_bindings : [])
      .map((binding) => String(binding && (binding.binding_id || binding.bindingId) || '').trim())
      .filter((bindingId) => /^rtb_[a-f0-9]{12,64}$/i.test(bindingId)),
  )];
  return {
    leaseId: root.dataset.integratedInstanceKey,
    cardId: envelope.card_id,
    mode: envelope.mode || envelope.capability || 'overview',
    target,
    symbol: first(envelope.stk_cd, envelope.symbol, args.stk_cd, args.symbol, context.symbol),
    accountId: first(envelope.account_id, envelope.account_no, args.account_id, args.account_no, args.acnt_no),
    conditionId: first(envelope.condition_id, args.condition_id, args.seq),
    sectorId: first(envelope.sector_id, args.sector_id, args.sect_code),
    visibleTargets: Array.isArray(envelope.visible_targets) ? envelope.visible_targets : undefined,
    verifiedOperationRefs: integratedCardSurface.verifiedOperationRefsFor(envelope),
    semanticBindingIds,
  };
}

function stampIntegratedRealtimeState(root, state) {
  if (!root || !state) return;
  const realtime = integratedRealtimeMeta(root);
  realtime.status = String(state.status || 'unknown');
  if (Number.isFinite(Number(state.generation))) realtime.generation = Number(state.generation);
  if (Number.isFinite(Number(state.connectionGeneration))) {
    realtime.connectionGeneration = Number(state.connectionGeneration);
  }
  const operationIds = Array.isArray(state.bindings)
    ? [...new Set(state.bindings.map((binding) => String(binding.operationId || '')).filter(Boolean))]
    : [];
  if (operationIds.length) realtime.operationIds = operationIds;
}

function integratedRealtimeMeta(root) {
  if (!root.__athenaIntegratedRealtime) {
    Object.defineProperty(root, '__athenaIntegratedRealtime', {
      value: {}, configurable: true, writable: true,
    });
  }
  return root.__athenaIntegratedRealtime;
}

function realtimePolicies() {
  if (!integratedRealtimePoliciesPromise) {
    integratedRealtimePoliciesPromise = window.athena.invoke('athena:integrated-card-realtime-policy')
      .then((result) => {
        if (result && result.ok === false) throw new Error(result.error || '실시간 정책 조회 실패');
        const policies = Array.isArray(result) ? result : (result && (result.operations || result.policies));
        if (!Array.isArray(policies) || !policies.length) throw new Error('실시간 정책이 비어 있다');
        return policies;
      })
      .catch((error) => {
        // 실패를 성공적인 빈 정책으로 영구 캐시하지 않는다. 사용자 재시도 또는 다음
        // envelope에서 반드시 정책 IPC를 다시 호출한다.
        integratedRealtimePoliciesPromise = null;
        throw error;
      });
  }
  return integratedRealtimePoliciesPromise;
}

function hasRealtimePolicy(policies, payload) {
  return policies.some((policy) => Array.isArray(policy.rules) && policy.rules.some((rule) => (
    rule.cardId === payload.cardId
      && Array.isArray(rule.modes)
      && rule.modes.includes(payload.mode)
  )));
}

function syncIntegratedRealtime(root, envelope) {
  if (!window.athena || typeof window.athena.invoke !== 'function') return;
  const payload = integratedRealtimePayload(root, envelope);
  const realtime = integratedRealtimeMeta(root);
  realtime.leaseId = payload.leaseId;
  realtime.target = integratedCardSurface.normalizeIdentity(payload.target);
  realtime.status = 'registering';
  const prior = integratedRealtimeTasks.get(root) || Promise.resolve();
  const task = prior.catch(() => {}).then(async () => {
    const policies = await realtimePolicies();
    if (!hasRealtimePolicy(policies, payload)) {
      if (realtime.mounted === true) {
        await window.athena.invoke('athena:integrated-card-realtime-unmount', { leaseId: payload.leaseId });
        realtime.mounted = false;
      }
      if (root.isConnected) realtime.status = 'static';
      clearIntegratedRealtimeError(root);
      return { ok: true, status: 'static' };
    }
    const channel = realtime.mounted === true
      ? 'athena:integrated-card-realtime-update'
      : 'athena:integrated-card-realtime-mount';
    const state = await window.athena.invoke(channel, payload);
    if (!root.isConnected && state && state.ok) {
      // close가 REG보다 먼저 끝난 경우 mount 성공 직후 즉시 REMOVE한다. destroyer는
      // realtimeMounted dataset이 찍히기 전이라 이 해제를 대신할 수 없다.
      await window.athena.invoke('athena:integrated-card-realtime-unmount', { leaseId: payload.leaseId }).catch(() => {});
      return state;
    }
    if (!root.isConnected) return state;
    integratedCardSurface.requireRealtimeSuccess(state);
    realtime.status = String(state.status || 'active');
    realtime.mounted = true;
    stampIntegratedRealtimeState(root, state);
    clearIntegratedRealtimeError(root);
    if (state && Number.isFinite(Number(state.generation))) {
      realtime.generation = Number(state.generation);
    }
    if (state && Number.isFinite(Number(state.connectionGeneration))) {
      realtime.connectionGeneration = Number(state.connectionGeneration);
    }
    return state;
  }).catch((error) => {
    if (root.isConnected) {
      realtime.status = 'error';
      showIntegratedRealtimeError(root, envelope, error);
    }
  });
  integratedRealtimeTasks.set(root, task);
}

function clearIntegratedRealtimeError(root) {
  const prior = root && root.querySelector('.integrated-realtime-error');
  if (prior) prior.remove();
}

function showIntegratedRealtimeError(root, envelope, error) {
  if (!root) return;
  clearIntegratedRealtimeError(root);
  const note = document.createElement('div');
  note.className = 'integrated-realtime-error';
  note.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = `실시간 연결 실패 — ${(error && error.message) || '정책을 불러오지 못했습니다.'}`;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '다시 시도';
  retry.addEventListener('click', () => syncIntegratedRealtime(root, envelope));
  note.appendChild(text);
  note.appendChild(retry);
  const content = root.querySelector('.integrated-card-content');
  if (content) content.prepend(note);
}

function renderRestStateCard(envelope) {
  const type = envelope.canvas_type === 'table' ? 'mcp-table' : envelope.canvas_type;
  const labels = {
    timeout: ['조회 시간 초과', '제한 시간 안에 데이터를 받지 못했습니다. 다시 시도해 주세요.'],
    cancelled: ['조회 취소됨', '요청이 취소되었습니다. 데이터 카드는 표시하지 않았습니다.'],
    error: ['조회 오류', '데이터를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'],
  };
  const [title, message] = labels[envelope.state] || labels.error;
  const { card, body } = makeCard(type, title, envelope.layout, envelope.correlation);
  card.dataset.screenState = envelope.state;
  card.dataset.renderState = envelope.state === 'timeout' ? 'timeout' : 'error';
  if (envelope.screen_id) card.dataset.screenId = envelope.screen_id;
  body.appendChild(errorNote(message));
  return card;
}

// 카드를 못 그릴 상황(거부/에러/해석불가)을 조용히 삼키지 않는다 — 모자이크에
// 안내 카드를 하나 띄운다. 'free'가 아니라 별도 타입('notice')을 쓴다 — 같은
// 세션에서 정상 free 카드가 이미 떠 있는데 이후 호출이 실패하면, makeCard가
// 같은 타입 카드를 갈아치우는 규칙(재요청 시 새로 갱신) 때문에 실제 데이터
// 카드가 에러 배너로 덮일 수 있어서다. ui-kit.errorNote는 role="alert"다.
function renderLiveNotice(message) {
  const { body } = makeCard('notice', '캔버스 알림');
  body.appendChild(errorNote(message));
}

function stampPaperScreen(card, envelope) {
  if (envelope && envelope.screen_id) card.dataset.screenId = envelope.screen_id;
  return card;
}

function describeAitsChartPanel(data, envelope, source) {
  const chartData = data && typeof data === 'object' ? data : {};
  const chartEnvelope = envelope && typeof envelope === 'object' ? envelope : {};
  if (source !== 'fixture') {
    const snapshot = parseAitsChartSnapshot(chartEnvelope);
    const context = {
      source,
      correlation: chartEnvelope.correlation,
      target: snapshot.body.target,
      stock: snapshot.stock,
    };
    const panelId = panelIdFor(context);
    const active = aitsChartPanels.snapshot().find((session) => session.panelId === panelId);
    const generation = active ? active.generation + 1 : 1;
    context.operationRef = chartEnvelope.operation_ref || chartEnvelope.operationRef;
    context.operationArgs = chartEnvelope.operation_args || chartEnvelope.operationArgs;
    // 분·틱 탭을 열 근거는 "이 패널의 reload 계약에 min·tick TR이 있는가" 하나다
    // (2026-08-25). 종전엔 "초기 주기가 분·틱인가"로 판정했는데, 그러면 일봉으로
    // 시작한 패널은 계약상 분봉을 받을 수 있어도 영영 잠긴 채였다 — 실측으로
    // live 카드에서 분·틱이 둘 다 locked로 남았다.
    const chartMeta = chartData.chart_meta && typeof chartData.chart_meta === 'object'
      ? chartData.chart_meta : {};
    const reloadTargets = chartMeta.reload_targets && typeof chartMeta.reload_targets === 'object'
      ? chartMeta.reload_targets : {};
    context.intradayAvailable = !!(reloadTargets.min || reloadTargets.tick);
    return {
      body: snapshot.body,
      context: Object.assign(context, { panelId, generation }),
      panelId,
      generation,
      rendererId: snapshot.rendererId,
    };
  }
  const stock = chartData.symbol || chartData.stock || chartData.code || 'UNKNOWN';
  const context = {
    source,
    panelId: chartData.panelId || chartData.panel_id,
    correlation: chartEnvelope.correlation,
    operationRef: chartEnvelope.operation_ref || chartEnvelope.operationRef,
    trId: chartData.trId || chartData.tr_id,
    target: chartData.target,
    stock,
    name: chartData.name,
    generation: 1,
  };
  return {
    body: fromAthenaChartData(chartData, context),
    context,
    panelId: panelIdFor(context),
    generation: 1,
    rendererId: AITS_CHART_RENDERER_ID,
  };
}

// 카드 제목의 주기 표기를 실제 주기에 맞춘다. 최초 캡션("삼성전자 일봉")은
// 그때의 주기라, 분봉으로 바꿔도 제목이 '일봉'으로 남으면 §8 정보 정직성 위반이다
// (실측 지적: "분틱 표시가 안돼" — 화면은 분봉인데 제목이 일봉이었다).
const PERIOD_TITLE = Object.freeze({
  tick: '틱', min: '분봉', day: '일봉', week: '주봉', month: '월봉', year: '년봉',
});

function retitleChartCard(card, period) {
  const label = PERIOD_TITLE[period];
  const title = card && card.querySelector('.card-title');
  if (!label || !title) return;
  // 끝에 붙은 주기 낱말만 갈아끼운다 — 나머지 타이틀(고정 카드명 또는 caption)은 그대로 둔다.
  const base = String(title.textContent || '').replace(/\s*(틱|분봉|일봉|주봉|월봉|년봉)\s*$/, '').trim();
  title.textContent = base ? `${base} ${label}` : label;
}

// 주기가 바뀌면 title은 retitleChartCard가 갱신하는데 subtitle(원래 caption —
// "일봉 — 삼성전자" 류, 종목명·주기가 함께 들어 있던 자리)은 그대로 남아 title과
// 어긋난다(2026-08-26 리뷰 결함). 초기 렌더(renderLiveChart)와 같은 유도식
// (cardTitleAndSubtitle)으로 다시 만든다 — 새 envelope에 caption이 없으면(빈
// envelope으로 재조회하는 픽스처 경로 등) 손대지 않는다. subtitle 자체가
// 없던 카드(card_title 없이 만들어진 카드)에도 새로 만들어 붙이지 않는다 —
// 있던 걸 갱신할 뿐, 없던 구조를 재조회 시점에 바꾸지 않는다.
function refreshChartSubtitle(card, envelope) {
  const subtitleEl = card && card.querySelector('.card-subtitle');
  if (!subtitleEl) return;
  const [, subtitle] = cardTitleAndSubtitle(envelope, '차트');
  if (subtitle) subtitleEl.textContent = subtitle;
}

async function reloadExistingAitsChartPanel(descriptor, envelope, integratedRoot = null) {
  const integratedSession = integratedCardSurface.panelSessionFor(integratedRoot, envelope);
  if (integratedSession) {
    descriptor.panelId = integratedSession.panelId;
    descriptor.context.panelId = integratedSession.panelId;
    const active = aitsChartPanels.snapshot().find((session) => session.panelId === integratedSession.panelId);
    descriptor.generation = active ? active.generation + 1 : integratedSession.generation + 1;
    descriptor.context.generation = descriptor.generation;
  }
  const card = integratedSession ? integratedRoot : Array.from(grid.querySelectorAll('.card.chart')).find(
    (candidate) => candidate.dataset.chartPanelId === descriptor.panelId
  );
  if (!card || !aitsChartPanels.has(descriptor.panelId)) return null;
  // 세분(분·틱)은 서버가 실제로 쓴 tic_scope를 따른다. 이걸 안 넘기면 재조회
  // 후 툴바가 1로 되돌아가 "10분을 눌렀는데 1분으로 돌아간다"가 된다(실측).
  const args = (descriptor.context && descriptor.context.operationArgs) || {};
  const ticScope = Number(args.tic_scope);
  await aitsChartPanels.reloadPanel(descriptor.panelId, descriptor.body, {
    generation: descriptor.generation,
    interval: Number.isFinite(ticScope) && ticScope > 0 ? ticScope : 1,
  });
  if (integratedSession) integratedSession.generation = descriptor.generation;
  retitleChartCard(card, descriptor.body.period);
  refreshChartSubtitle(card, envelope);
  stampPaperScreen(card, envelope);
  card.dataset.renderState = descriptor.body.candles.length ? 'data' : 'empty';
  card.dataset.chartPanelId = descriptor.panelId;
  card.dataset.rendererId = descriptor.rendererId;
  card.dataset.chartGeneration = String(descriptor.generation);
  card.scrollIntoView({ block: 'nearest' });
  return card;
}

async function mountAitsChartPanel(card, chartBody, descriptor) {
  // panel identity와 provisional disposer를 await 전에 등록한다. 같은 panel의
  // 동시 reload/dataset 교체가 늦은 mount를 두 번째 renderer로 만들지 못한다.
  card.dataset.chartAuthority = 'AITS';
  card.dataset.rendererId = descriptor.rendererId;
  card.dataset.chartPanelId = descriptor.panelId;
  card.dataset.chartGeneration = String(descriptor.generation);
  card.dataset.renderState = 'loading';
  descriptor.context.onReloadRequest = async (request) => {
    const active = aitsChartPanels.snapshot().find((candidate) => candidate.panelId === descriptor.panelId);
    if (!active) throw new Error('AITS chart session이 닫혔다');
    return window.athena.invoke('athena:reload-chart-panel', {
      panelId: descriptor.panelId,
      generation: active.generation,
      period: request.period,
      interval: request.interval,
      adjusted: request.adjusted,
    });
  };
  // 과거 봉 덧붙이기 — main이 base_dt 커서로 그 앞 구간을 받아 candles만 돌려준다.
  // reload와 달리 카드를 갈아치우지 않으므로 generation을 올리지 않는다.
  descriptor.context.onHistoryRequest = async (beforeDate) => {
    const active = aitsChartPanels.snapshot().find((candidate) => candidate.panelId === descriptor.panelId);
    if (!active) return [];
    const res = await window.athena.invoke('athena:chart-history-page', {
      panelId: descriptor.panelId,
      generation: active.generation,
      period: PERIOD_TO_ATHENA_UI[active.period] || 'D',
      interval: 1,
      adjusted: true,
      beforeDate,
    });
    if (!res || !res.ok || !Array.isArray(res.candles)) return 0;
    // 어댑터가 정본(body.candles)에 붙이고 렌더러 표시까지 맞춘다.
    return aitsChartPanels.prependHistory(descriptor.panelId, res.candles);
  };
  descriptor.context.onChartLibraryReady = (readyAt) => {
    if (Number.isFinite(Number(readyAt))) card.dataset.chartImportReadyAt = String(Number(readyAt));
  };
  cardDestroyers.set(card, () => {
    aitsChartPanels.destroyPanel(descriptor.panelId);
    window.athena.send('athena:chart-panel-destroyed', { panelId: descriptor.panelId });
  });
  const session = await aitsChartPanels.openPanel(chartBody, descriptor.body, descriptor.context);
  mountedChartSessions.set(descriptor.panelId, session);
  Object.defineProperty(card, '__athenaChartSessionId', {
    value: session.sessionId, configurable: true, writable: true,
  });
  Object.defineProperty(card, '__athenaChartTrId', {
    value: session.body.trId, configurable: true, writable: true,
  });
  card.dataset.chartGeneration = String(session.generation);
  card.dataset.renderState = session.body.candles.length ? 'data' : 'empty';
  return session;
}

// TR이 Paper 보드 12d 카드 16종 중 하나로 확정되면 백엔드가 envelope.card_title에
// 고정 이름을 채운다(canvas_transform.resolve_fixed_card_title) — 그 경우 카드
// 타이틀은 고정 이름, 이전까지 타이틀이던 caption(종목명·주기 등)은 서브타이틀로
// 내려간다(정보 손실 없음). card_title이 없으면(16종 밖) 기존처럼 caption이
// 타이틀이다.
function cardTitleAndSubtitle(envelope, fallback) {
  const fixedTitle = envelope && typeof envelope.card_title === 'string' && envelope.card_title
    ? envelope.card_title
    : null;
  const caption = envelope && envelope.caption;
  if (fixedTitle) return [fixedTitle, caption || null];
  return [caption || fallback, null];
}

// 시세류 카드 실시간 등록(단계 8 확장, P1 2026-08-27 카드종 확장) — 종목코드를
// 아는 경우에만 세션을 연다. REST 데이터셋 직결 카드는 envelope.operation_args.
// stk_cd가 있다(canvas.js athena:add-rest-canvas 핸들러가 채운다 — 위쪽 참고).
// 서버측 0B REG는 main.js ensureRealtimeForSymbol이 두 경로(REST 데이터셋
// 직결·클로드 툴 실시간) 모두에서 같은 후보 자리를 본다 — main.js
// extractLiveQuoteSymbol 주석 참고. 여기서는 렌더러 쪽 세션만 열어서 그 종목의
// 체결을 applyTick이 그 카드종 body에 이어붙이게 한다 — 카드종마다 갱신할 필드가
// 달라(시세 카드는 표 행, 종목정보 카드는 QuoteHeader) 호출부가 자기 카드종의
// applyLiveTick을 넘긴다.
//
// backend 53ece06 이후 envelope.stk_cd는 시장 데이터 3도메인(charts·stockinfo·
// quotes)에 봉인돼 오므로 대부분의 호출에서 아래 후보 중 하나는 찾는다 — 계좌·
// 주문류(그 게이트 밖)는 여전히 못 찾아 자연 배제된다(정보 정직성 — 모르는
// 종목을 안다고 지어내지 않는다).
// wireQuoteRealtime/wireOrderbookRealtime이 공유하는 종목코드 추출(2026-08-27,
// task #25에서 두 번째 호출부가 생기며 뺐다 — 로직 자체는 그대로).
function resolveEnvelopeSymbol(envelope) {
  const args = envelope.operation_args || envelope.operationArgs;
  return String(
    (args && args.stk_cd)
    || envelope.stk_cd
    || (envelope.data && envelope.data.stk_cd)
    || (envelope.data && envelope.data.symbol)
    || '',
  ).trim();
}

function wireQuoteRealtime(card, wrap, envelope, applyTick) {
  const symbol = resolveEnvelopeSymbol(envelope);
  if (!symbol || typeof applyTick !== 'function') return;
  quoteRealtimePanels.openPanel(card, symbol, (tick) => applyTick(wrap, envelope, tick));
  const priorDestroy = cardDestroyers.get(card);
  cardDestroyers.set(card, () => {
    quoteRealtimePanels.closePanel(card);
    // 카드 1장을 참조 1개로 센다(main.js ensureChartRealtime 주석 참고) — 이
    // 카드가 위에서 연 세션과 같은 symbol로만 해제한다. main이 acquire 때 보는
    // 것과 같은 envelope 필드에서 뽑은 값이라 카운트가 서로 어긋나지 않는다.
    window.athena.send('athena:realtime-release', { symbol });
    if (priorDestroy) priorDestroy();
  });
}

// 호가 카드(0D 호가잔량) 전용 — wireQuoteRealtime(0B)과 달리 main이 봉투만
// 보고 알아서 acquire하지 않는다(0B는 "시장 데이터 도메인이면 무조건 REG",
// 호가는 카드가 실제로 열려 있을 때만 REG를 쓴다 — task #25, 리미터 절약).
// 그래서 여기서 acquire를 명시적으로 보낸다 — release와 짝이 대칭이다.
function wireOrderbookRealtime(card, wrap, envelope, applyTick) {
  const symbol = resolveEnvelopeSymbol(envelope);
  if (!symbol || typeof applyTick !== 'function') return;
  orderbookRealtimePanels.openPanel(card, symbol, (tick) => applyTick(wrap, envelope, tick));
  window.athena.send('athena:orderbook-realtime-acquire', { symbol });
  const priorDestroy = cardDestroyers.get(card);
  cardDestroyers.set(card, () => {
    orderbookRealtimePanels.closePanel(card);
    window.athena.send('athena:orderbook-realtime-release', { symbol });
    if (priorDestroy) priorDestroy();
  });
}

function renderMcpTable(envelope) {
  const [title, subtitle] = cardTitleAndSubtitle(envelope, '공통 테이블');
  // 카드 v3(.omc/state/card-v3-plan.md §2.2) 카드종 후킹 — title이 Paper 16종 고정
  // 이름 중 하나로 등록돼 있으면 전용 body를 먼저 시도한다. all-or-nothing 계약
  // (card-kinds.js)이라 renderFn이 null을 돌려주면 아래 범용 표 빌드로 그대로 폴백한다.
  const kindRender = window.AthenaLib.CardKinds.resolve(title);
  const built = kindRender && kindRender(envelope);
  if (built) {
    const { card, body } = makeCard('mcp-table', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
    card.dataset.semanticPrimary = 'specialized';
    stampPaperScreen(card, envelope);
    body.appendChild(built);
    if (title === '시세') wireQuoteRealtime(card, built, envelope, window.AthenaLib.CardKindQuote.applyLiveTick);
    return card;
  }
  if (semanticWorkspace.isTaskCanvasEnvelope(envelope)) return null;
  const { card, body } = makeCard('mcp-table', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
  stampPaperScreen(card, envelope);
  const rawCols = (envelope.data && Array.isArray(envelope.data.columns)) ? envelope.data.columns : [];
  const rows = (envelope.data && Array.isArray(envelope.data.rows)) ? envelope.data.rows : [];
  const header = (envelope.data && Array.isArray(envelope.data.header)) ? envelope.data.header : [];

  if (!rawCols.length || !rows.length) {
    body.appendChild(errorNote('빈 테이블 — columns 또는 rows가 없다.'));
    return card;
  }
  if (header.length) body.appendChild(renderCompoundHeaderBand(header));
  body.appendChild(buildFoldedTable(rawCols, rows));
  return card;
}

// table 카드와 compound 카드(P4)가 공유하는 표 빌더 — §5.3.1 컬럼 우선순위 흡수(2층):
// columns는 이미 백엔드가 §5.3.1 규칙(식별 컬럼 고정 + 실측 alias 빈도 tie-break,
// backend/scripts/generate_api.py의 column_priority_ranking)으로 정렬해 보낸다고
// 가정한다 — 여기서는 그 순서 위에서 1560px 캔버스 폭 기준으로 접기만 한다
// (app/lib/column-fold.js). ka10095(63컬럼) 같은 넓은 표가 스크롤 없이 fold되어
// 보이는 게 이 단계의 목표다. 반환은 table 엘리먼트 하나 — 카드 뼈대(makeCard)는
// 호출부가 짓는다.
function buildFoldedTable(rawCols, rows) {
  const { visible: cols, hidden } = foldColumns(rawCols);

  const table = document.createElement('table');
  table.className = 'fin-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const col of cols) {
    const th = document.createElement('th');
    th.textContent = col && col.label != null ? col.label : (col && col.key) || '';
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const col of cols) {
      const td = document.createElement('td');
      const v = r ? r[col.key] : undefined;
      td.textContent = v == null ? '—' : String(v);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  table.dataset.totalColumns = String(rawCols.length);
  table.dataset.visibleColumns = String(cols.length);
  table.dataset.hiddenColumns = String(hidden.length);
  return table;
}

// ---------- 실배선 FactsCard/CompoundCard(P4) — MCP render_canvas의 facts/compound 응답 ----------
// canvas.py FACTS_SCHEMA(L161-167)/COMPOUND_SCHEMA(L169-176) 실측: facts는
// {fields:[{key,label,value}]}, compound는 {header:[...같은 필드 계약...], table:{columns,rows}}.
// 필드별 개별 렌더러는 만들지 않는다 — lib/facts-card.js의 셀 프리미티브 5종
// (spec §4: 가격/등락/수량/종목/일시)이 key로 포맷을 결정하고, 나머지는 일반 텍스트다.

// FactsCard(F1 단일 그룹 · F2 2단 그룹, spec §3.1) — key/value dl 하나 또는 둘.
// 그룹 분할은 lib/facts-card.js groupFactsFields(순수 함수, facts-card.test.js가 검증).
function renderFactsFieldGroup(fields) {
  const dl = document.createElement('dl');
  dl.className = 'facts-group';
  for (const field of fields) {
    const key = field && field.key;
    const cell = classifyCell(key);
    const value = field ? field.value : undefined;

    const dt = document.createElement('dt');
    dt.className = 'facts-key';
    dt.textContent = (field && (field.label != null ? field.label : field.key)) || '';

    const dd = document.createElement('dd');
    dd.className = `facts-value facts-value-${cell}`;
    if (cell === 'change') {
      dd.classList.add(`is-${changeTone(key, value)}`);
      dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
    } else if (cell === 'price' || cell === 'quantity') {
      dd.textContent = formatNumeric(value);
    } else if (cell === 'datetime') {
      dd.textContent = formatDatetime(value);
    } else {
      dd.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
    }
    // dt+dd를 .facts-row로 묶는다(HTML5 dl은 그룹을 div로 감싸는 것을 허용한다) —
    // facts-grid(세로: 라벨 위·값 아래)와 compound 헤더 밴드(가로 칩)가 같은 DOM을
    // CSS만 바꿔 재사용하려면 한 쌍이 붙어 다녀야 한다(순수 dt/dd 나열은 flex-wrap
    // 시 쌍이 흩어진다).
    const row = document.createElement('div');
    row.className = 'facts-row';
    row.appendChild(dt);
    row.appendChild(dd);
    dl.appendChild(row);
  }
  return dl;
}

function renderFactsGrid(fields) {
  const groups = groupFactsFields(fields);
  const wrap = document.createElement('div');
  wrap.className = groups.length > 1 ? 'facts-grid facts-grid-2col' : 'facts-grid';
  for (const group of groups) wrap.appendChild(renderFactsFieldGroup(group));
  return wrap;
}

function renderFactsCard(envelope) {
  const [title, subtitle] = cardTitleAndSubtitle(envelope, 'Facts');
  // 카드 v3(§2.2) 카드종 후킹 — renderMcpTable과 같은 계약(all-or-nothing, card-kinds.js).
  const kindRender = window.AthenaLib.CardKinds.resolve(title);
  const built = kindRender && kindRender(envelope);
  if (built) {
    const { card, body } = makeCard('facts', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
    card.dataset.semanticPrimary = 'specialized';
    stampPaperScreen(card, envelope);
    body.appendChild(built);
    // '종목정보' 카드종만 실시간을 켠다(P1) — QuoteHeader 조각(가격+등락)이 있는
    // 경우에만 갱신 대상이 있다. daily-range/year-range 조각뿐인 응답은
    // applyLiveTick 내부에서 대상 엘리먼트가 없어 조용히 건너뛴다.
    if (title === '종목정보') wireQuoteRealtime(card, built, envelope, window.AthenaLib.CardKindStockInfo.applyLiveTick);
    // '호가' 카드종 — 호가잔량(0D)으로 래더 행·비율바를 제자리 갱신한다(task #25).
    // quote-emphasis(QuoteHeader) 조각은 0D에 대응 필드가 없어 갱신하지 않는다
    // (card-kind-호가.js applyLiveTick 주석 참고 — 없는 값을 지어내지 않는다).
    if (title === '호가' && window.AthenaLib.CardKindHoga.supportsLive0D(built)) wireOrderbookRealtime(card, built, envelope, window.AthenaLib.CardKindHoga.applyLiveTick);
    return card;
  }
  if (semanticWorkspace.isTaskCanvasEnvelope(envelope)) return null;
  const { card, body } = makeCard('facts', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
  stampPaperScreen(card, envelope);
  const fields = (envelope.data && Array.isArray(envelope.data.fields)) ? envelope.data.fields : [];
  if (!fields.length) {
    body.appendChild(errorNote('빈 facts — fields가 없다.'));
    return card;
  }
  body.appendChild(renderFactsGrid(fields));
  return card;
}

// CompoundCard 일반(C2, spec §3.3) — "이름과 달리 다중 표가 아니다": 스칼라 헤더 밴드
// 하나 + 표 하나로 고정. 헤더는 facts와 같은 셀 프리미티브를 재사용하되 세로 그리드가
// 아니라 가로 밴드(스칼라 2~9개, §3.3 실측이라 F2 2단 분할까지는 가지 않는다)로 편다.
// 표는 buildFoldedTable을 그대로 재사용한다(mcp-table과 드리프트하지 않는다).
function renderCompoundHeaderBand(fields) {
  const band = document.createElement('div');
  band.className = 'compound-header-band';
  band.appendChild(renderFactsFieldGroup(fields));
  return band;
}

function renderCompoundCard(envelope) {
  const [title, subtitle] = cardTitleAndSubtitle(envelope, 'Compound');
  // 카드 v3(§2.2) 카드종 후킹 — renderMcpTable과 같은 계약(all-or-nothing, card-kinds.js).
  const kindRender = window.AthenaLib.CardKinds.resolve(title);
  const built = kindRender && kindRender(envelope);
  if (built) {
    const { card, body } = makeCard('compound', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
    card.dataset.semanticPrimary = 'specialized';
    stampPaperScreen(card, envelope);
    body.appendChild(built);
    // 실시간 미배선(의도적 — task #24, 2026-08-27 실측). renderFactsCard/
    // renderMcpTable과 달리 wireQuoteRealtime을 걸지 않는다: applyLiveTick을 가진
    // 카드종은 시세·종목정보 둘뿐인데, 둘 다 compound 모양(data.header/data.table)
    // 에는 관여하지 않는다 — render종목정보은 envelope.data.fields를,
    // render시세는 envelope.data.columns/rows를 직접 요구해 compound envelope에서는
    // 항상 null을 돌려준다(각 파일 주석 참고). 실제 backend 매니페스트에서도
    // layout=compound인 quotes/stockinfo 도메인 TR 3종(ka10045/ka90004/kt20016)의
    // card_title은 None·프로그램매매·신용거래이고, 이 둘은 애초에 applyLiveTick이
    // 없다. 즉 지금 compound 카드에는 실시간을 이어붙일 현재가류 표시 조각이
    // 존재하지 않는다 — 없는 REG를 지어서 걸지 않는다.
    return card;
  }
  if (semanticWorkspace.isTaskCanvasEnvelope(envelope)) return null;
  const { card, body } = makeCard('compound', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
  stampPaperScreen(card, envelope);
  const data = (envelope.data && typeof envelope.data === 'object') ? envelope.data : {};
  const header = Array.isArray(data.header) ? data.header : [];
  const table = data.table;
  const tableCols = table && Array.isArray(table.columns) ? table.columns : [];
  const tableRows = table && Array.isArray(table.rows) ? table.rows : [];
  if (!header.length || !tableCols.length || !tableRows.length) {
    body.appendChild(errorNote('빈 compound — header 또는 table이 없다.'));
    return card;
  }
  body.appendChild(renderCompoundHeaderBand(header));
  body.appendChild(buildFoldedTable(tableCols, tableRows));
  return card;
}

// Paper AT-CV-005 protected workflow templates. These cards are display-only:
// they expose lifecycle and allowlisted receipt/event fields, never credentials,
// order execution, OAuth actions, or raw WebSocket frames.
function appendWorkflowState(body, state, label = '상태') {
  const row = document.createElement('div');
  row.className = 'workflow-state';
  const key = document.createElement('span');
  key.className = 'workflow-state-label';
  key.textContent = label;
  const value = document.createElement('span');
  value.className = 'workflow-state-value';
  value.textContent = integratedCardSurface.workflowStateLabel(state);
  row.appendChild(key);
  row.appendChild(value);
  body.appendChild(row);
  return row;
}

function stampWorkflowState(card, envelope, workflow, state) {
  if (semanticWorkspace && semanticWorkspace.isTaskCanvasEnvelope(envelope)) {
    Object.defineProperty(card, '__athenaWorkflowState', {
      value: { workflow, state }, configurable: true, writable: true,
    });
    delete card.dataset.workflow;
    delete card.dataset.screenState;
    return;
  }
  card.dataset.workflow = workflow;
  card.dataset.screenState = state;
}

function taskRealtimeLifecycle(value) {
  const state = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return new Set([
    'connecting', 'connected', 'reconnected', 'reconnecting',
    'disconnected', 'stopped', 'paused', 'error',
  ]).has(state) ? state : 'connecting';
}

function renderEventCard(envelope) {
  const [title, subtitle] = cardTitleAndSubtitle(envelope, '실시간 이벤트');
  const { card, body } = makeCard('event', title, envelope.layout, envelope.correlation, subtitle);
  stampPaperScreen(card, envelope);
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const taskCanvas = semanticWorkspace.isTaskCanvasEnvelope(envelope);
  const lifecycle = taskCanvas
    ? taskRealtimeLifecycle(data.lifecycle || data.state)
    : data.lifecycle || data.state || 'connecting';
  stampWorkflowState(card, envelope, 'websocket_lifecycle', lifecycle);
  if (taskCanvas) {
    card.dataset.semanticPrimary = 'specialized';
    const state = appendWorkflowState(body, lifecycle, '실시간 상태');
    state.classList.add('task-realtime-lifecycle');
    const guard = document.createElement('div');
    guard.className = 'workflow-guard';
    guard.textContent = '실시간 데이터 수신 상태를 표시합니다.';
    body.appendChild(guard);
    return card;
  }
  appendWorkflowState(body, data.state_label || lifecycle, '수신 상태');
  const kindRender = window.AthenaLib.CardKinds.resolve(title);
  const built = kindRender && kindRender(envelope);
  if (built) body.appendChild(built);
  const records = Array.isArray(data.records) ? data.records.slice(0, 20) : [];
  if (!built) {
    const list = document.createElement('ol');
    list.className = 'event-log';
    list.setAttribute('aria-label', '제한된 이벤트 로그');
    for (const record of records) {
      const item = document.createElement('li');
      item.className = 'event-log-item';
      item.textContent = typeof record === 'string'
        ? record
        : Object.entries(record || {}).slice(0, 5).map(([key, value]) => `${key} ${value}`).join(' · ');
      list.appendChild(item);
    }
    if (!records.length) {
      const item = document.createElement('li');
      item.className = 'event-log-item is-empty';
      item.textContent = '표시할 이벤트가 없습니다.';
      list.appendChild(item);
    }
    body.appendChild(list);
  }
  const guard = document.createElement('div');
  guard.className = 'workflow-guard';
  guard.textContent = '표시 전용 · 원본 프레임과 인증값은 노출하지 않음';
  body.appendChild(guard);
  return card;
}

function renderActionCard(envelope) {
  const [title, subtitle] = cardTitleAndSubtitle(envelope, '주문 확인');
  const { card, body } = makeCard('action', title, envelope.layout, envelope.correlation, subtitle);
  stampPaperScreen(card, envelope);
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const workflowState = data.lifecycle || data.state || 'review';
  stampWorkflowState(card, envelope, 'guarded_order', workflowState);
  appendWorkflowState(body, data.state_label || workflowState, '주문 단계');
  const kindRender = window.AthenaLib.CardKinds.resolve(title);
  const built = kindRender && kindRender(envelope);
  if (built) body.appendChild(built);
  const receipt = data.receipt && typeof data.receipt === 'object' ? data.receipt : {};
  const allowlisted = [
    { key: 'ord_no', label: '주문번호' },
    { key: 'dmst_stex_tp', label: '거래소 구분' },
  ].filter((field) => receipt[field.key] !== undefined);
  if (!built && allowlisted.length) {
    body.appendChild(renderFactsGrid(allowlisted.map((field) => ({
      key: field.key,
      label: field.label,
      value: receipt[field.key],
    }))));
  }
  const guard = document.createElement('div');
  guard.className = 'workflow-guard';
  guard.textContent = '표시 전용 · 실행과 최종 확인은 대화창에서만 가능';
  body.appendChild(guard);
  return card;
}

function renderStatusCard(envelope) {
  const { card, body } = makeCard('status', envelope.caption || '연결 상태', envelope.layout, envelope.correlation);
  stampPaperScreen(card, envelope);
  const data = envelope.data && typeof envelope.data === 'object' ? envelope.data : {};
  const lifecycle = data.lifecycle || data.state || (data.ready ? 'ready' : 'auth_required');
  stampWorkflowState(card, envelope, 'oauth_lifecycle', lifecycle);
  appendWorkflowState(body, lifecycle, '인증 상태');
  body.appendChild(renderFactsGrid([
    { key: 'configured', label: '설정됨', value: data.configured === true ? '예' : '아니오' },
    { key: 'ready', label: '사용 가능', value: data.ready === true ? '예' : '아니오' },
    { key: 'expires_at', label: '만료 시각', value: data.expires_at || '—' },
  ]));
  const guard = document.createElement('div');
  guard.className = 'workflow-guard';
  guard.textContent = '토큰과 자격 증명 값은 문서에 표시하지 않음';
  body.appendChild(guard);
  return card;
}

function renderLiveStream(envelope) {
  const { card, body } = makeCard('stream', envelope.caption || '스트림 · 뉴스', envelope.layout, envelope.correlation);
  const records = (envelope.data && Array.isArray(envelope.data.records)) ? envelope.data.records : [];
  if (!records.length) {
    body.appendChild(errorNote('빈 스트림 — records가 없다.'));
    return card;
  }
  const ul = document.createElement('ul');
  ul.className = 'stream-list';
  const SHOW = 14;
  for (const rec of records.slice(0, SHOW)) {
    const li = document.createElement('li');
    li.className = 'stream-item';

    const time = document.createElement('span');
    time.className = 'stream-time';
    time.textContent = formatRecordTs(rec && rec.ts, rec && rec.ts_precision);

    const source = document.createElement('span');
    source.className = 'stream-source';
    source.textContent = (rec && rec.source) || domainOf(rec && rec.url);

    const title = document.createElement('span');
    title.className = 'stream-title';
    title.textContent = sanitize(rec && rec.title) || '(제목 없음)'; // 텍스트 노드만

    li.appendChild(time);
    li.appendChild(source);
    li.appendChild(title);
    ul.appendChild(li);
  }
  body.appendChild(ul);
  if (records.length > SHOW) {
    const more = document.createElement('div');
    more.className = 'stream-more';
    more.textContent = `+ ${records.length - SHOW}건 더`;
    body.appendChild(more);
  }
  return card;
}

// `ts`가 second/day 어느 정밀도든 한 형식으로 렌더한다 — day 정밀도에서 없는
// 시:분을 지어내지 않는다(정보 정직성, soul.md §8).
function formatRecordTs(ts, precision) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (precision === 'day') return `${mm}.${dd}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

// ---------- 실배선 리더(신규②) — MCP render_canvas의 실제 reader 응답 ----------
// canvas.py READER_SCHEMA 실측(L57-68): data는 {title, body_markdown,
// format?:"markdown"|"raw"(기본 markdown), highlights?[], error_state?:
// null|"not_found"|"processing_delayed"}. error_state가 있으면 문서가 아예
// 없거나(당일 접수 공시 등) 처리 지연 중이라는 뜻이라 본문 대신 안내만 낸다 —
// 조용히 빈 카드를 그리지 않는다. format:"raw"는 마크다운 문법으로 해석하지
// 않고 문단 하나로 그대로 낸다.
function renderLiveReader(envelope) {
  const data = (envelope.data && typeof envelope.data === 'object') ? envelope.data : {};
  const { card, body } = makeCard('reader', data.title || envelope.caption || '리더 · 공시 원문', envelope.layout, envelope.correlation);
  if (data.error_state === 'not_found') {
    body.appendChild(errorNote('문서를 찾을 수 없다 — not_found.'));
    return card;
  }
  if (data.error_state === 'processing_delayed') {
    body.appendChild(errorNote('문서 처리가 지연되고 있다 — processing_delayed.'));
    return card;
  }
  if (!data.body_markdown) {
    body.appendChild(errorNote('빈 리더 — body_markdown이 없다.'));
    return card;
  }
  if (Array.isArray(data.highlights) && data.highlights.length) {
    const note = document.createElement('div');
    note.className = 'fin-meta';
    note.textContent = `하이라이트: ${data.highlights.join(' · ')}`;
    body.appendChild(note);
  }
  if (data.format === 'raw') {
    const p = document.createElement('p');
    p.className = 'md-p';
    p.textContent = data.body_markdown; // 텍스트 노드 — innerHTML 금지
    body.appendChild(p);
  } else {
    renderMarkdownInto(body, data.body_markdown);
  }
  return card;
}

// ---------- 실배선 AITS 차트 — REST inline/MCP side-channel 공용 ----------
// backend/manifest가 확정한 renderer_id='aits-chart-v1'과 data.chart
// ChartCardBody만 받는다. renderer는 period/target/trId를 추측하지 않고, 계약이
// 빠지거나 다르면 같은 카드 슬롯에 error 상태를 표시한다. fixture도 최종 DOM은
// 동일한 aitsChartPanels adapter를 거치며 저수준 createChartCard 직접 호출은 없다.
async function renderLiveChart(envelope, integratedRoot = null) {
  const data = (envelope.data && typeof envelope.data === 'object') ? envelope.data : {};
  const [title, subtitle] = cardTitleAndSubtitle(envelope, '차트');
  let descriptor;
  try {
    descriptor = describeAitsChartPanel(data, envelope, 'live');
  } catch (err) {
    const { card, body } = makeCard('chart', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
    stampPaperScreen(card, envelope);
    card.dataset.renderState = 'error';
    body.appendChild(errorNote(`AITS 차트 계약 오류 — ${err && err.message ? err.message : String(err)}`));
    return card;
  }
  const reloaded = await reloadExistingAitsChartPanel(descriptor, envelope, integratedRoot);
  if (reloaded) return reloaded;
  const { card, body } = makeCard('chart', title, envelope.layout, envelope.correlation, subtitle, cardStkCd(envelope), envelope.screen_id);
  stampPaperScreen(card, envelope);
  // 카드 v3(.omc/state/card-v3-plan.md §2.2) 카드종 후킹 — 차트 전용 변형. 다른 3곳
  // (renderFactsCard/renderMcpTable/renderCompoundCard)은 renderFn이 body 전체를
  // 대체하는 all-or-nothing 계약인데, 차트는 범용 body(툴바+캔들, chart-card.js)가
  // 이미 완전한 렌더러라 대체할 대상이 없다 — 여기서는 AUGMENT(위에 얹기)만 한다.
  // renderFn이 돌려준 조각을 차트 마운트 지점(chartBody) 바로 위에 붙인다. null이면
  // 아무것도 얹지 않는다(기존 동작과 100% 동일) — chart-card.js/chart-toolbar.js는
  // 손대지 않는다.
  const kindAugment = window.AthenaLib.CardKinds.resolve(title);
  const augmentEl = kindAugment && kindAugment(envelope);
  if (augmentEl) body.appendChild(augmentEl);
  if (!descriptor.body.candles.length) {
    card.dataset.renderState = 'empty';
    body.appendChild(errorNote('빈 차트 — candles가 없다.'));
    return card;
  }
  const chartBody = document.createElement('div');
  chartBody.className = 'chart-card-body';
  body.appendChild(chartBody);
  try {
    await mountAitsChartPanel(card, chartBody, descriptor);
  } catch (err) {
    chartBody.remove();
    card.dataset.renderState = 'error';
    delete card.dataset.chartAuthority;
    delete card.dataset.rendererId;
    delete card.dataset.chartPanelId;
    delete card.dataset.chartGeneration;
    delete card.__athenaChartSessionId;
    delete card.__athenaChartTrId;
    body.appendChild(errorNote(`차트를 그리지 못했다 — ${err && err.message ? err.message : String(err)}`));
  }
  return card;
}

function renderFreeCanvas(envelope) {
  const { card, body } = makeCard('free', envelope.caption || '자유 카드', envelope.layout, envelope.correlation, undefined, cardStkCd(envelope), envelope.screen_id);
  if (envelope.fell_back) {
    const note = document.createElement('div');
    note.className = 'fin-meta';
    note.textContent = `table 카드로 못 그려 자유 카드로 폴백함 — ${envelope.fallback_reason || '사유 미상'}`;
    body.appendChild(note);
  }
  body.appendChild(renderJsonTree(envelope.data));
  return card;
}

function renderJsonTree(value) {
  if (Array.isArray(value)) {
    const ul = document.createElement('ul');
    ul.className = 'free-tree-list';
    for (const item of value) {
      const li = document.createElement('li');
      li.appendChild(renderJsonTree(item));
      ul.appendChild(li);
    }
    return ul;
  }
  if (value !== null && typeof value === 'object') {
    const dl = document.createElement('dl');
    dl.className = 'free-tree-dl';
    for (const [k, v] of Object.entries(value)) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.appendChild(renderJsonTree(v));
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    return dl;
  }
  const span = document.createElement('span');
  span.className = 'free-tree-scalar';
  span.textContent = value === null || value === undefined ? '—' : String(value);
  return span;
}

window.athena.on('athena:highlight-canvas', (type) => {
  const el = grid.querySelector(`.card.${type}`);
  if (!el) return;
  el.classList.add('highlight');
  el.scrollIntoView({ block: 'nearest' });
  setTimeout(() => el.classList.remove('highlight'), 1200);
});

function freshLabel() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} 기준`;
}

// ---------- 카드별 닫기 (D7) ----------
// 지금까지 전역 Esc(athena:collapse-canvas → 캔버스 전체 접기)만 있었다 —
// 설계가 여는 법만 정하고 카드 하나만 닫는 법은 안 정했다. accounts/mcp
// 카드(lib/settings-cards.js)에 같은 어포던스를 다는 김에 여기 3개 카드
// (stream/reader/table)도 일관되게 맞춘다 — 5개 카드 중 2개만 닫히면
// 사용자 입장에서 더 헷갈린다는 판단(기존 동작 확장, 보고서에 별도로 남김).
// 마지막 카드를 닫으면 빈 유리창을 남기지 않고 캔버스 자체를 접는다 — Esc가
// 쓰는 채널을 그대로 재사용한다.
function closeCard(card) {
  const destroy = cardDestroyers.get(card);
  if (destroy) {
    try { destroy(); } catch (err) { /* 카드가 이미 언마운트된 경우 등 — 닫기 자체는 막지 않는다 */ }
    cardDestroyers.delete(card);
  }
  // 부모에서 remove → 그리드가 비면 캔버스 접기는 ui-kit.js의
  // removeCard로 settings-cards.js와 공용화했다(포니테일 감사).
  removeCard(card);
}

function cardCloseButton(card) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'uk-card-close';
  b.setAttribute('aria-label', '카드 닫기');
  b.title = '이 카드 닫기';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('width', '10');
  svg.setAttribute('height', '10');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M1.2 1.2 L8.8 8.8', 'M8.8 1.2 L1.2 8.8']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.3');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  }
  b.appendChild(svg);
  b.addEventListener('click', () => closeCard(card));
  return b;
}

// 높이 예산 안전망(배치·생애주기 규칙 4) — 총높이 ≤ 뷰포트 2배, 최소 3장 보장.
// 큐레이션(규칙 3, drop_types)이 먼저 돌므로 여기 닿는 경우는 드물어야 한다.
// 초과 시 가장 오래된(도착순 맨 앞) 카드부터 제거한다. 판정 로직은
// lib/canvas-layout.js — 순수 함수라 node --test로 검증된다.
function enforceHeightBudget() {
  // REST 데이터셋은 최대 6장 전체가 한 결과 집합이다. 오래된 카드를 높이 예산으로
  // 제거하면 같은 타입 공존·ordinal 계약이 깨지므로 스크롤로 모두 보존한다.
  if (grid.querySelector('.card[data-dataset-id]')) return;
  let cards = grid.querySelectorAll('.card');
  while (
    cards.length > MIN_CARDS &&
    exceedsHeightBudget(grid.scrollHeight, grid.clientHeight, cards.length)
  ) {
    destroyCard(cards[0]);
    cards = grid.querySelectorAll('.card');
  }
}

// 대화 경로 카드 공존 키(P2, 2026-08-27) — envelope.stk_cd(backend 53ece06, 시장
// 데이터 3도메인(charts·stockinfo·quotes) 봉인)가 있으면 makeCard 교체 판정에
// 종목코드까지 쓴다. "삼성전자 시세"·"SK하이닉스 시세"처럼 같은 카드종이 다른
// 종목이면 공존해야 하는데, 옛 판은 타입만 보고 무조건 교체해 먼저 그린 카드가
// 사라졌다(실측: datasets/eval-runs/2026-08-27-intraday-ui-clean/).
function cardStkCd(envelope) {
  const v = envelope && envelope.stk_cd;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function makeCard(type, title, layoutHint, correlation, subtitle, stkCd, screenId) {
  const isDatasetCard = isValidCorrelation(correlation);
  if (isDatasetCard && activeDatasetId !== correlation.dataset_id) {
    for (const prior of grid.querySelectorAll('.card[data-dataset-id]')) {
      destroyCard(prior);
    }
    activeDatasetId = correlation.dataset_id;
  }
  const existing = isDatasetCard
    ? Array.from(grid.querySelectorAll('.card[data-dataset-id]')).find((candidate) => (
      candidate.dataset.datasetId === correlation.dataset_id
      && candidate.dataset.itemId === correlation.item_id
      && Number(candidate.dataset.ordinal) === correlation.ordinal
    ))
    : Array.from(grid.querySelectorAll(`.card.${type}`)).find((candidate) => {
      if (candidate.classList.contains('integrated-card')) return false;
      if (candidate.dataset.datasetId) return false;
      // stk_cd 없는 요청(종목코드 자리가 없는 카드종·구버전 envelope)은 기존
      // 동작 그대로 — 동일 타입이면 무조건 교체(하위 호환).
      if (!stkCd) return true;
      // stk_cd 있는 요청은 같은 종목 + 같은 화면(screen_id)만 교체 대상 —
      // 다른 종목은 물론, 같은 종목의 다른 화면(호가 매도/매수/총잔량처럼
      // ka10004 detail 5장이 연달아 오는 경우)도 공존한다(2026-08-27 장중
      // QA 실측: screen_id 없이 종목만 보면 5장이 서로를 지워 1장만 남았다).
      return candidate.dataset.stkCd === stkCd
        && (candidate.dataset.screenId || '') === (screenId || '');
    });
  const activeDatasetCardCount = Array.from(grid.querySelectorAll('.card[data-dataset-id]'))
    .filter((candidate) => candidate.dataset.datasetId === correlation.dataset_id).length;
  if (isDatasetCard && !existing && activeDatasetCardCount >= 6) {
    throw new Error('REST 데이터셋 카드는 최대 6개다');
  }
  if (existing) destroyCard(existing); // 재요청 시 새로 갱신 — renderer/session도 함께 폐기
  const card = document.createElement('div');
  // 폭은 형상이 정하고(w-half/w-full), AI layout 힌트는 등급 승격·강등만 한다.
  // 순서는 도착순(appendChild) — canvas-taxonomy "배치·생애주기 규칙 (2026-08-18)".
  card.className = `card ${type} w-${widthGradeFor(type, layoutHint)}`;
  if (isDatasetCard) {
    card.dataset.datasetId = correlation.dataset_id;
    card.dataset.itemId = correlation.item_id;
    card.dataset.ordinal = String(correlation.ordinal);
  } else if (stkCd) {
    card.dataset.stkCd = stkCd;
    if (screenId) card.dataset.screenId = String(screenId);
  }
  const head = document.createElement('div');
  head.className = 'card-head';
  // .card-head는 space-between 2-child 배선이다(title↔head-right) — 서브타이틀은
  // 세 번째 flex item으로 흩뿌리지 않고 title과 함께 .card-titles에 묶는다.
  const titles = document.createElement('div');
  titles.className = 'card-titles';
  const h = document.createElement('div');
  h.className = 'card-title';
  h.textContent = title;
  titles.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'card-subtitle';
    sub.textContent = subtitle;
    titles.appendChild(sub);
  }
  const fresh = document.createElement('div');
  fresh.className = 'card-fresh';
  fresh.textContent = freshLabel();
  const rightGroup = document.createElement('div');
  rightGroup.className = 'card-head-right';
  rightGroup.appendChild(fresh);
  rightGroup.appendChild(cardCloseButton(card));
  head.appendChild(titles);
  head.appendChild(rightGroup);
  const body = document.createElement('div');
  body.className = 'card-body';
  card.appendChild(head);
  card.appendChild(body);
  grid.appendChild(card);
  enforceHeightBudget();
  // 2026-08-19 QA 결함 #2 실제 원인 — .grid는 overflow-y:auto라 카드가 쌓여
  // 뷰포트를 넘기면, 새/갱신 카드가 스크롤 위치 밖(화면 아래)에 조용히 붙는다.
  // scrollTop을 아무도 옮기지 않으니 사용자는 새 카드가 도착한 줄도 모른다 —
  // capturePage() 캡처가 "안 바뀐 것처럼" 보인 진짜 이유였다(19-chart-card.png /
  // 20-live-chart-card.png가 MD5까지 같았던 것 — 캔버스 자체는 매번 옳게 갱신됐고,
  // 화면에 안 보이는 위치에 있었을 뿐). 캡처 버그가 아니라 실사용에서도 새 카드가
  // 안 보일 수 있는 결함이라 여기(카드 생성 지점)에서 고친다.
  card.scrollIntoView({ block: 'nearest' });
  // 2026-08-19 QA 결함 #5 — 하단 경계에서 반쯤 잘린 글리프가 다른 글자로 읽힌다
  // (픽스처 원문 "주주균등처분(주)"이 03-mosaic-expanded.png에서 "조조규등처부(조)"로
  // 보였다 — 인코딩이 아니라 descender 절단). 스크롤이 실제로 생겼을 때만
  // .is-clipped를 붙여 CSS 페이드(잘림의 정직한 표시)를 켠다. 내용이 다 보이면
  // 페이드도 없다 — 정보 정직성 우선.
  const syncClipped = () => {
    body.classList.toggle('is-clipped', body.scrollHeight > body.clientHeight + 1);
  };
  new ResizeObserver(syncClipped).observe(body);
  new MutationObserver(syncClipped).observe(body, { childList: true, subtree: true });
  return { card, body };
}

async function addCard(type) {
  if (type === 'stream') return renderStream();
  if (type === 'reader') return renderReader();
  if (type === 'table') return renderTable();
  if (type === 'chart') return renderChartCard();
}

async function renderChartCard() {
  const fixtureData = await loadFixture('chart');
  const data = { symbol: '005930', name: '삼성전자', bars: fixtureData.bars, trId: 'ka10081', target: 'stock', period: 'day' };
  const descriptor = describeAitsChartPanel(data, {}, 'fixture');
  const reloaded = await reloadExistingAitsChartPanel(descriptor, {});
  if (reloaded) return reloaded;
  const { card, body } = makeCard('chart', '일봉 — 삼성전자');
  const chartBody = document.createElement('div');
  chartBody.className = 'chart-card-body';
  body.appendChild(chartBody);
  try {
    await mountAitsChartPanel(card, chartBody, descriptor);
  } catch (err) {
    chartBody.remove();
    body.appendChild(errorNote(`차트를 그리지 못했다 — ${err && err.message ? err.message : String(err)}`));
  }
}

// ① 스트림 — sanitize한 문자열은 절대 innerHTML로 넣지 않는다. textContent로만.
async function renderStream() {
  const { body } = makeCard('stream', '스트림 · 뉴스');
  const { items } = await loadFixture('stream');
  const ul = document.createElement('ul');
  ul.className = 'stream-list';
  const SHOW = 14;
  for (const item of items.slice(0, SHOW)) {
    const li = document.createElement('li');
    li.className = 'stream-item';

    const time = document.createElement('span');
    time.className = 'stream-time';
    time.textContent = formatPubDate(item.pubDate);

    const source = document.createElement('span');
    source.className = 'stream-source';
    const url = item.originallink || item.link;
    source.textContent = domainOf(url);

    const title = document.createElement('span');
    title.className = 'stream-title';
    title.textContent = sanitize(item.title); // 텍스트 노드

    li.appendChild(time);
    li.appendChild(source);
    li.appendChild(title);
    ul.appendChild(li);
  }
  body.appendChild(ul);
  if (items.length > SHOW) {
    const more = document.createElement('div');
    more.className = 'stream-more';
    more.textContent = `+ ${items.length - SHOW}건 더`;
    body.appendChild(more);
  }
}

function domainOf(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function formatPubDate(pubDate) {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return pubDate;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

// ② 리더 — 마크다운을 직접 DOM으로 렌더(innerHTML 미사용, lib/markdown.js)
async function renderReader() {
  const { body } = makeCard('reader', '리더 · 공시 원문');
  const { markdown: md } = await loadFixture('reader');
  const note = document.createElement('div');
  note.className = 'fin-meta';
  note.textContent = '원문 일부(캡처 당시 미리보기 필드 한도로 절단됨) — DART 자기주식 처분 결정 공시';
  body.appendChild(note);
  renderMarkdownInto(body, md);
}

// ④ 공통 테이블 — 재무제표(재무상태표) 스냅샷
async function renderTable() {
  const { body } = makeCard('table', '재무제표(연결)');
  const { meta, list } = await loadFixture('table');
  const rows = list.filter((r) => r.sj_nm === '재무상태표');

  const note = document.createElement('div');
  note.className = 'fin-meta';
  note.textContent = `corp_code ${meta.corp_code} · ${meta.fs_div} · ${meta.bsns_year} 사업연도 · ${rows.length}개 계정`;
  body.appendChild(note);

  const table = document.createElement('table');
  table.className = 'fin-table';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const headers = ['계정과목', rows[0]?.thstrm_nm || '당기', rows[0]?.frmtrm_nm || '전기', rows[0]?.bfefrmtrm_nm || '전전기'];
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    const cells = [r.account_nm, fmtWon(r.thstrm_amount), fmtWon(r.frmtrm_amount), fmtWon(r.bfefrmtrm_amount)];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

function fmtWon(raw) {
  if (!raw) return '—';
  const n = Number(raw);
  if (Number.isNaN(n)) return raw;
  return n.toLocaleString('ko-KR');
}

// 창에 속하는 것(창 크롬·창 단축키·네이티브 캡션 드래그 손잡이 #dragStrip)은
// shell.js가 한 벌만 가진다 — 이 파일에는 없다. 크기는 설정 › 화면에서만 바뀐다.

// --- 그래프 모드 배선 (leaf 8 / W2-3, 3상태는 리프 1.2.2) -------------------
//
// 상태·배치·그리기는 lib/graph-mode/**가 순수하게 갖고 있고, 여기서는 DOM과
// 백엔드에만 잇는다. 전환 진입로는 사이드바 모드 네비 하나다(보드 45 v5에서
// 스트립 필 줄 전면 제거) — 브레인이 꺼져 있어도 그래프 모드 자체는 열 수 있고,
// 못 쓰는 이유는 캔버스 안에서 정직하게 보여준다(controller.js renderUnavailable).

// 숨은 연관(surprising-connections) 캐시(스텝14) — loadHiddenLinks()(아래, 보드
// 06/07 §9 카드용으로 이미 있던 fetch)가 채우고 graphMode.draw()/노드 선택이
// 재사용한다. 이중 fetch 금지(스텝11 보고에 대한 리드 지침) — 그래프 지도의
// 핑크 점선·컨텍스트 패널의 "숨은" 관계 행 전부 이 한 번의 fetch에서 나온다.
let lastSurprisingConnections = [];

const graphMode = window.AthenaLib.GraphModeController.createGraphModeController({
  store: window.AthenaLib.GraphModeStore,
  layout: window.AthenaLib.GraphClusterLayout,
  render: window.AthenaLib.GraphRender,
  prefs: window.AthenaLib.GraphModePrefs,
  elements: {
    summary: document.getElementById('mosaic'),
    // 가시성 전용 — graphMode.applyVisibility() 하나만 이 hidden을 건드린다.
    graph: document.getElementById('graphCanvas'),
    // 3영역 3중 배타의 세 번째 자리(Paper 보드 39/44) — 내용은 4/5단계에서 채운다.
    agent: document.getElementById('agentCanvas'),
    // Paper 47/48의 네 번째 모드. 허브·관리 내용은 PluginCanvas가 소유하고,
    // 이 컨트롤러는 다른 중앙 표면과의 배타 가시성만 소유한다.
    plugin: document.getElementById('pluginCanvas'),
    // 5번째 모드(P1 모드 골격, backtest-mode-plan.md §3.2). 내용은
    // BacktestCanvas가 소유하고, 이 컨트롤러는 배타 가시성만 소유한다.
    backtest: document.getElementById('backtestCanvas'),
    // 보드 07 성향 신호 표 — 그래프 표면이라 답변 모드에선 숨는다(아래 §요약 뷰
    // 배선 주석·US-007 참고). graphMode.applyVisibility() 하나가 소유한다.
    summaryTable: document.getElementById('graphSummaryTable'),
    // 키우미(2026-08-27, Paper 보드 45) — 얼굴이 지금 모드를 수동 표시한다.
    kiumi: document.getElementById('dot'),
    // (모드 네비 활성 하이라이트는 lib/sidebar-mode-nav.js 소유 — 리프 1.2.2.)
    // 캔버스 영역 — 빈 상태 모드별 변형(보드 46)을 CSS로 가르는 data-mode 축.
    canvasRegion: document.getElementById('canvasRegion'),
    // 모드별 채팅 헤더(보드 38) — 그래프 모드에서만 보인다.
    chatHead: document.getElementById('chatModeHead'),
    // 그래프 뷰 본문 — 렌더·클릭위임·크기측정 전용(가시성은 위 graph가 계속
    // 소유). #graphCanvas 안 #graphHeader의 영구 형제라 다시 그려도 헤더는 안 지워진다.
    graphBody: document.getElementById('graphBody'),
    // 공통 패널(보드 07/15) — #graphSummaryTableArea의 영구 형제. renderSelection()이
    // hidden·텍스트만 갱신하고, 표 리로드가 이 노드를 건드릴 방법이 구조적으로 없다.
    panel: document.getElementById('graphPanel'),
    // 그래프 뷰 헤더 메타 텍스트(보드 14/15, 스텝9) — controller.js가
    // draw()/redrawFromCache() 끝에서 state.stage로 계산해 채운다.
    graphHeaderMeta: document.getElementById('graphHeaderMeta'),
    // 지도 안내 바(보드 14 §1.3, 스텝9) — 1단계에서만 보인다. hidden 소유자는
    // controller.js 하나(renderGraphHeader) — #graphCanvas 전체가 숨으면
    // 자식이라 함께 자동으로 숨으므로 이 로직은 1↔2단계 전환에만 관여한다.
    mapGuide: document.getElementById('graphMapGuide'),
  },
  // main은 실패를 {ok:false}로 돌려준다. 컨트롤러는 **예외**로 실패를 안다 —
  // 여기서 바꿔주지 않으면 `{ok:false}`가 정상 응답으로 흘러 빈 그래프가 그려지고,
  // 그것은 "성향이 없다"로 읽힌다.
  fetchClusterMap: async () => {
    const res = await window.athena.invoke('athena:brain-cluster-map');
    if (!res || !res.ok) throw new Error((res && res.error) || '군집 지도를 받지 못했다');
    return res;
  },
  onError: (err) => console.warn('[graph-mode] cluster-map 실패', err),
  // 공통 패널 CTA "채팅에서 답하기"(보드 07 §10-5, 스텝8) — 06 확인 필요 배너의
  // onConfirmCta와 같은 최소 구현(새 기능 발명 없음, 입력창 포커스만).
  onPanelCta: () => {
    const inputEl = document.getElementById('input');
    if (inputEl) inputEl.focus();
  },
  // 스텝14 — 스텝11(숨은 연관 군집 쌍)·13(숨은 연관 엔티티 쌍)의 실배선. 위
  // lastSurprisingConnections 캐시를 그대로 읽는다(이중 fetch 없음).
  getSurprisingConnections: () => lastSurprisingConnections,
  // 그래프 노드 선택 시 성향 신호 표와 같은 profile-summary 항목을 재사용한다
  // (이중 fetch 금지) — graphSummaryTable은 이 파일 아래에서 선언되지만 이
  // 함수는 나중에(사용자가 실제로 노드를 고를 때) 불리므로 문제없다.
  getProfileSummaryEntries: () => graphSummaryTable.getEntries(),
  // §10-4 최근 변화(엔티티 타임라인, WP-G) — cluster-map처럼 부팅 시 1회
  // 캐시하는 패턴을 못 쓴다(entity_id별 호출당 API). 실패는 예외로 알린다 —
  // fetchClusterMap과 같은 이유({ok:false}가 정상 응답으로 흐르면 안 된다).
  fetchEntityTimeline: async (entityId) => {
    const res = await window.athena.invoke('athena:brain-entity-timeline', { entityId });
    if (!res || !res.ok) throw new Error((res && res.error) || '엔티티 타임라인을 받지 못했다');
    return res.events;
  },
});
window.AthenaCanvasMode = graphMode;
// 부팅을 순수 답변 모드로 고정한다(US-007) — 정적 HTML의 기본 hidden 속성이
// 우연히 답변 모드와 맞아떨어지는 데 기대지 않고, 여기서 명시적으로 한 번
// 그린다. 이후 모든 가시성 변경은 toggle()/setView()/setAvailable() 안에서 이
// 함수가 계속 소유한다 — 다른 곳(예: 아래 brain-status 콜백)이 그래프 표면의
// hidden을 직접 건드리면 브레인 준비 타이밍에 따라 답변/그래프가 섞여 보인다
// (실측 결함).
graphMode.applyVisibility();

// --- 플러그인 모드 캔버스 배선 (Paper 47/48) -------------------------------
// 플러그인 = MCP 서버다. 등록·승인·도구 허용·삭제는 전부 main.js의 athena:mcp-*
// 핸들러(= backend/athena_mcp CLI)가 소유한다 — 이 화면은 그 결과만 그리고 사람의
// 의도를 그대로 되돌려준다. 하드코딩 목록은 쓰지 않는다: 설치된 적 없는 서버를
// 설치된 것처럼 보여주면 화면 전체가 신뢰를 잃고, 실제로 설치된 서버가 그 가짜에
// 가려진다(BETA-017 실측 — dart-mcp가 등록돼 있는데 가짜 "DART 전자공시"만 떴다).
const pluginCanvas = window.AthenaLib.PluginCanvas.createPluginCanvas({
  container: document.getElementById('pluginCanvas'),
  // 실제 목록이 도착하기 전에도 샘플 폴백을 타지 않도록 항상 명시적으로 넘긴다.
  installed: [],
  recommended: [],
  marketplaces: [],
  onPermission: (plugin) => { void pluginProbe(plugin && plugin.id); },
  onSavePermissions: (plugin, features) => { void pluginSaveTools(plugin && plugin.id, features); },
  onManage: () => { void pluginRefresh(); },
  onStageSnippet: (snippet) => pluginStageSnippet(snippet),
  onApproveServer: (staged) => pluginApproveStaged(staged),
  onDiscardStaged: (staged) => { void pluginDiscardStaged(staged); },
});
pluginCanvas.mount();
window.AthenaPluginCanvas = pluginCanvas;

// probe는 실제 upstream 서버를 spawn한다(mcp-cli.js probe 주석) — 목록을 새로고칠
// 때마다 등록된 서버를 전부 띄우지 않는다. 권한 화면을 연 그 서버만 한 번 띄우고
// 결과를 캐시한다.
const pluginToolCache = new Map();

function pluginHealthLabel(server) {
  if (!server.approved) return '승인 대기 — 도구가 아직 허용되지 않았다';
  if (server.health === 'ok') return '연결 확인됨';
  if (server.health === 'warning') return '연결됨 · 인코딩 경고';
  // probe를 한 번도 안 한 상태다. 임의로 "정상"이라고 쓰지 않는다.
  return '연결 미확인 — 권한 화면을 열면 확인한다';
}

function pluginRowFromServer(server) {
  const tools = pluginToolCache.get(server.alias) || null;
  return {
    id: server.alias,
    name: server.alias,
    description: [server.command, server.argsPreview].filter(Boolean).join(' '),
    source: pluginHealthLabel(server),
    enabled: !!server.approved,
    // probe 전에는 consent.json이 아는 허용 도구 수만 안다 — 그 수를 그대로 쓴다.
    featureCount: tools ? tools.length : server.toolCount,
    features: tools || [],
    warnings: Array.isArray(server.warnings) ? server.warnings : [],
  };
}

// 게이트웨이는 기동 시점에 레지스트리를 읽는다 — 이번 세션에서 서버를 승인·허용·
// 삭제했다면 그 변경은 다음 실행부터 대화에 반영된다. 사용자가 "설치했는데 안 쓰인다"로
// 오해하지 않도록 화면에 명시한다.
let pluginRegistryChangedThisSession = false;

async function pluginRefresh() {
  try {
    const res = await window.athena.invoke('athena:mcp-list');
    const servers = (res && Array.isArray(res.servers)) ? res.servers : [];
    pluginCanvas.setData({
      installed: servers.map(pluginRowFromServer),
      restartRequired: pluginRegistryChangedThisSession,
    });
  } catch (err) {
    console.warn('athena:mcp-list 실패', err);
  }
}

async function pluginProbe(alias) {
  if (!alias) return;
  try {
    const res = await window.athena.invoke('athena:mcp-probe', { alias });
    if (!res || !res.ok || !Array.isArray(res.tools)) return;
    pluginToolCache.set(alias, res.tools.map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description || '',
      allowed: !!tool.allowed,
    })));
    await pluginRefresh();
  } catch (err) {
    console.warn('athena:mcp-probe 실패', err);
  }
}

async function pluginSaveTools(alias, features) {
  if (!alias || !Array.isArray(features)) return;
  const known = new Map((pluginToolCache.get(alias) || []).map((tool) => [tool.name, !!tool.allowed]));
  for (const feature of features) {
    const name = feature && feature.name;
    // probe로 실재가 확인된 도구만 건드린다. probe 전 시트는 설명 한 줄을 가짜
    // 기능 행으로 채우는데(featureRowsFor 폴백), 그 이름으로 allow를 부르면
    // 존재하지 않는 도구를 승인 목록에 넣게 된다.
    if (!name || !known.has(name)) continue;
    if (known.get(name) === !!feature.allowed) continue; // 바뀐 것만 CLI를 부른다
    await window.athena.invoke('athena:mcp-allow-tool', { alias, tool: name, allowed: !!feature.allowed });
  }
  pluginRegistryChangedThisSession = true;
  pluginToolCache.delete(alias);
  await pluginProbe(alias);
}

// 스니펫 분석 = athena:mcp-stage-snippet. 이름과 달리 실제로 레지스트리에 등록까지
// 한다(mcp-cli.js stageSnippet 주석 — 파이썬 백엔드에 dry-run이 없다). 승인 전에는
// consent 게이트가 서버 spawn을 막으므로 안전하고, 취소는 아래 discard가 되돌린다.
async function pluginStageSnippet(snippet) {
  try {
    return await window.athena.invoke('athena:mcp-stage-snippet', { snippet });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// 승인 = register 재확인 → approve → probe. probe까지 해야 노출 도구를 알 수 있고,
// 그래야 사용자가 도구를 하나씩 허용할 수 있다.
async function pluginApproveStaged(staged) {
  const servers = Array.isArray(staged) ? staged : [];
  if (!servers.length) return { ok: false, error: '승인할 서버가 없다' };
  for (const server of servers) {
    try {
      const registered = await window.athena.invoke('athena:mcp-register', { staged: server });
      if (!registered || !registered.ok) {
        return { ok: false, error: (registered && registered.error) || '등록 확인에 실패했다' };
      }
      const approved = await window.athena.invoke('athena:mcp-approve', { alias: server.alias });
      if (!approved || !approved.ok) {
        return { ok: false, error: (approved && approved.error) || '승인에 실패했다' };
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }
  pluginRegistryChangedThisSession = true;
  // probe는 서버를 실제로 띄운다 — 실패해도 등록·승인은 유효하므로 승인 자체를
  // 실패로 만들지 않는다. 도구 목록은 권한 화면에서 다시 시도할 수 있다.
  for (const server of servers) await pluginProbe(server.alias);
  await pluginRefresh();
  return { ok: true };
}

// 취소는 흔적을 남기지 않는다 — 분석 단계가 이미 등록했으므로 되돌린다.
async function pluginDiscardStaged(staged) {
  for (const server of (Array.isArray(staged) ? staged : [])) {
    try {
      await window.athena.invoke('athena:mcp-remove', { alias: server.alias });
    } catch (err) {
      console.warn('athena:mcp-remove 실패', err);
    }
    pluginToolCache.delete(server.alias);
  }
  await pluginRefresh();
}

void pluginRefresh();

// --- 백테스트모드 캔버스 배선 (P4, backtest-mode-plan.md §8.2) ---------------
// 8채널을 agentCanvas의 fetchRoutines와 같은 모양으로 잇는다 — IPC 봉투
// ({ok,data}|{ok:false,status,error,detail})를 여기서 벗기고, 실패는 던져서
// backtest-canvas.js가 하나의 try/catch로 처리하게 한다. backfill만 사람 클릭
// 전용 경로다(라우틴 confirm/cancel과 같은 원칙 — 쿼터를 태우는 백필은 모델
// 툴에 없다).
// 실패 문구 — 봉투의 status를 버리고 error 원문만 보여주면 404가 "Not Found"로
// 끝나 사용자가 무엇을 해야 할지 알 수 없다(2026-08-31 프로브 실측). 손쓸 수 있는
// 두 상태만 문장으로 바꾸고 원문은 괄호로 남긴다 — 감추지 않는다.
function backtestError(res, fallback) {
  const raw = (res && res.error) || fallback;
  if (res && res.status === 503) return `백테스트 기능이 꺼져 있습니다 — 백엔드에서 ATHENA_BACKTEST_ENABLED를 켜야 합니다 (${raw})`;
  if (res && res.status === 404) return `백엔드에 백테스트 경로가 없습니다 — 백엔드가 이 브랜치 버전인지 확인하세요 (${raw})`;
  return raw;
}

const backtestCanvas = window.AthenaLib.BacktestCanvas.createBacktestCanvas({
  container: document.getElementById('backtestCanvas'),
  fetchPresets: async () => {
    const res = await window.athena.invoke('athena:backtest-presets');
    if (!res || !res.ok) throw new Error(backtestError(res, '프리셋을 불러오지 못했습니다'));
    return (res.data && Array.isArray(res.data.presets)) ? res.data.presets : [];
  },
  // P4 상태 기계는 직접 부르지 않는다(설계 폼이 최소 입력뿐이라 사전 계획
  // 조회를 안 거친다, backtest-canvas.js 머리말 참고) — P5/P6이 이어 쓸 자리다.
  plan: async (params) => {
    const res = await window.athena.invoke('athena:backtest-plan', params);
    if (!res || !res.ok) throw new Error(backtestError(res, '데이터 계획을 불러오지 못했습니다'));
    return res.data;
  },
  // 409(캐시 부족)는 실패가 아니라 승인 화면 전환 신호다(backtest-bridge.js
  // 머리말과 같은 원칙) — blocked로 정규화해 돌려주고, 그 외 실패만 던진다.
  run: async ({ yaml, params } = {}) => {
    const body = params !== undefined ? { yaml, params } : { yaml };
    const res = await window.athena.invoke('athena:backtest-run', body);
    if (res && res.ok) {
      const runId = res.data && res.data.run_id;
      if (!runId) throw new Error('run_id를 받지 못했습니다');
      return { blocked: false, run_id: runId };
    }
    if (res && res.status === 409 && res.detail) {
      return { blocked: true, needed_pages: res.detail.needed_pages, est_seconds: res.detail.est_seconds };
    }
    throw new Error(backtestError(res, '백테스트 실행에 실패했습니다'));
  },
  // 백필 잡 상태 — 수집 승인 카드 이후 running 상태가 1초 간격으로 부른다.
  status: async ({ job_id } = {}) => {
    const res = await window.athena.invoke('athena:backtest-status', { job_id });
    if (!res || !res.ok) throw new Error(backtestError(res, '수집 상태를 불러오지 못했습니다'));
    return res.data;
  },
  // 실행 상태+지표+자산곡선+stdout — running 상태가 1초 간격으로 부른다.
  result: async ({ run_id } = {}) => {
    const res = await window.athena.invoke('athena:backtest-result', { run_id });
    if (!res || !res.ok) throw new Error(backtestError(res, '실행 결과를 불러오지 못했습니다'));
    return res.data;
  },
  trades: async ({ run_id } = {}) => {
    const res = await window.athena.invoke('athena:backtest-trades', { run_id });
    if (!res || !res.ok) throw new Error(backtestError(res, '체결 내역을 불러오지 못했습니다'));
    return (res.data && Array.isArray(res.data.trades)) ? res.data.trades : [];
  },
  // 이력 목록 — P4 상태 기계는 직접 부르지 않는다(이력 비교 화면은 P6).
  runs: async () => {
    const res = await window.athena.invoke('athena:backtest-runs');
    if (!res || !res.ok) throw new Error(backtestError(res, '실행 이력을 불러오지 못했습니다'));
    return (res.data && Array.isArray(res.data.runs)) ? res.data.runs : [];
  },
  // 사람 클릭 전용 — 캔버스의 [수집하고 실행] 버튼에서만 부른다.
  backfill: async (params) => {
    const res = await window.athena.invoke('athena:backtest-backfill', params);
    if (!res || !res.ok) throw new Error(backtestError(res, '데이터 수집을 시작하지 못했습니다'));
    const jobId = res.data && res.data.job_id;
    if (!jobId) throw new Error('job_id를 받지 못했습니다');
    return { job_id: jobId };
  },
});
backtestCanvas.mount();
window.AthenaBacktestCanvas = backtestCanvas;

// --- 에이전트모드 캔버스 배선 (4단계, Paper 보드 39) -------------------------
//
// 헤더·탭·통계 카드·리스트는 lib/agent-canvas.js가 전부 그린다 — 여기서는
// 컨테이너와 실제 IPC(3단계 sidebar.js가 쓰는 것과 같은 athena:routines-list
// 채널)만 잇는다. refresh()는 모드 전환 시점에 sidebar.js의 모드 네비
// onSelect가 window.AthenaAgentCanvas를 통해 부른다(사이드바 라우틴 목록
// 새로고침과 같은 진입점, 단일 소유자 원칙).
//
// wsConnected는 createAgentCanvas(...)의 getWsConnected 클로저가 참조하고,
// mount()가 그 자리에서 동기적으로 한 번 부른다(renderWsStatus) — 그래서
// let 선언이 이 호출보다 뒤에 있으면 TDZ ReferenceError로 mount() 전체가
// 죽는다(실측: window.AthenaAgentCanvas가 끝내 안 잡혀 이후 모든 블록이
// 연쇄로 깨졌다). 반드시 호출보다 먼저 선언한다.
let wsConnected = false;
const agentCanvas = window.AthenaLib.AgentCanvas.createAgentCanvas({
  container: document.getElementById('agentCanvas'),
  fetchRoutines: async () => {
    const res = await window.athena.invoke('athena:routines-list');
    return (res && res.ok && res.data && Array.isArray(res.data.routines)) ? res.data.routines : [];
  },
  // 3단계 — "오늘 발화" 통계 타일. fired_today는 routines 배열이 아니라 같은
  // 응답의 최상위 필드(2단계, ledger 단일 스캔 집계)라 별개 왕복으로 뗀다
  // (agent-canvas.js 머리말 "네 소스는 서로 무관한 왕복이다" 원칙 재사용).
  fetchFiredToday: async () => {
    const res = await window.athena.invoke('athena:routines-list');
    return (res && res.ok && res.data && typeof res.data.fired_today === 'number') ? res.data.fired_today : null;
  },
  // 동선 규칙①(8단계) — 시트를 열지 않고 채팅 입력에 시작 문장을 심고 포커스만
  // 옮긴다(shell.js seedChatInput 버스, 7단계 제안 "추가"와 같은 경로).
  onNewTaskClick: () => {
    if (window.AthenaShell && typeof window.AthenaShell.seedChatInput === 'function') {
      window.AthenaShell.seedChatInput('새 작업을 만들어줘 — ');
    }
  },
  // 6.5단계 — 상세 패널 일시중지·재개. 6단계 엔드포인트를 사람 클릭 전용
  // 채널(athena:routine-confirm/cancel과 같은 자리)로 부른다.
  pauseRoutine: async (id) => {
    const res = await window.athena.invoke('athena:routine-pause', { id });
    if (!res || !res.ok) throw new Error((res && res.error) || '일시중지 실패');
    return res.data;
  },
  resumeRoutine: async (id) => {
    const res = await window.athena.invoke('athena:routine-resume', { id });
    if (!res || !res.ok) throw new Error((res && res.error) || '재개 실패');
    return res.data;
  },
  // 7단계 — 제안 섹션. 그래프 모드 요약 뷰(보드 07)가 쓰는 것과 같은 엔드포인트
  // (athena:brain-profile-summary) — 보드 39는 목업에서도 "2건 대기"라 상위 2만 요청한다.
  fetchProfileSummary: async () => {
    const res = await window.athena.invoke('athena:brain-profile-summary', { limit: 2 });
    if (!res || !res.ok) throw new Error((res && res.error) || '성향 신호를 받지 못했다');
    return Array.isArray(res.entries) ? res.entries : [];
  },
  // "추가" 클릭 → 시트 없이 채팅으로(43 원칙, shell.js 버스 — chat.js가 등록).
  onAddSuggestion: (text) => {
    if (window.AthenaShell && typeof window.AthenaShell.seedChatInput === 'function') {
      window.AthenaShell.seedChatInput(text);
    }
  },
  // 9단계 — 알람 센터. notifyRooms는 sidebar.js가 소유한다(세션 메모리) —
  // window.AthenaNotify 다리로 읽기+"모두 읽음"만 받는다(단일 소유자 원칙).
  fetchAlerts: () => (window.AthenaNotify ? window.AthenaNotify.list() : []),
  markAllAlertsRead: () => { if (window.AthenaNotify) window.AthenaNotify.markAllRead(); },
  getWsConnected: () => wsConnected,
  // F-fix1 — 39번 상세 패널 "채팅에서 열기 ↗"(본편 이월 갭). 알림 방이 있으면
  // sidebar.js의 selectNotifyRoom과 완전히 같은 경로(ack·opened 계측 포함)를
  // 그 다리로 타고, 없으면 채팅 입력 포커스로 폴백한다(seedChatInput을 인자
  // 없이 부르면 시드 문장 없이 포커스만 옮긴다 — 죽은 버튼 금지, P3).
  onOpenInChat: (routineId) => {
    const opened = !!(window.AthenaNotify && typeof window.AthenaNotify.selectRoom === 'function'
      && window.AthenaNotify.selectRoom(routineId));
    if (!opened && window.AthenaShell && typeof window.AthenaShell.seedChatInput === 'function') {
      window.AthenaShell.seedChatInput();
    }
  },
  // 10단계 — 실행 이력 드릴인. 6단계 GET /{id}/runs를 사람 클릭 전용 채널로.
  fetchRuns: async (id) => {
    const res = await window.athena.invoke('athena:routine-runs', { id });
    return (res && res.ok && res.data && Array.isArray(res.data.runs)) ? res.data.runs : [];
  },
  // 5단계 — 드릴인 "30회 통계"의 "평균" 타일. avg_duration_ms는 runs 배열이
  // 아니라 같은 응답의 다른 필드(4단계, 최근 30건 non-null 평균)라 별개
  // 왕복으로 뗀다(fetchFiredToday와 같은 이유).
  fetchAvgDuration: async (id) => {
    const res = await window.athena.invoke('athena:routine-runs', { id });
    return (res && res.ok && res.data && typeof res.data.avg_duration_ms === 'number') ? res.data.avg_duration_ms : null;
  },
  // F-stage5b-FE — 드릴인 "30회 통계"의 "발화→열람"·"이어진 대화" 타일.
  // opened_rate·replied_count도 같은 /runs 응답의 다른 필드라 별개 왕복으로 뗀다.
  fetchEngagement: async (id) => {
    const res = await window.athena.invoke('athena:routine-runs', { id });
    if (!res || !res.ok || !res.data) return null;
    return {
      openedRate: typeof res.data.opened_rate === 'number' ? res.data.opened_rate : null,
      repliedCount: typeof res.data.replied_count === 'number' ? res.data.replied_count : null,
    };
  },
  // F-stage9 — 말걸기 가드 패널. 저장(POST)은 이 패널이 아니라 채팅 확인
  // 카드가 부른다(chat.js, 43 원칙 — 편집은 채팅 경로로만).
  fetchNudgeGuard: async () => {
    const res = await window.athena.invoke('athena:nudge-guard-get');
    return (res && res.ok && res.data) ? res.data : null;
  },
  // 11단계 — "그래프 모드에서 근거 보기 →". 사이드바 모드 네비와 같은 두 걸음
  // (캔버스 전환 + 네비 활성 표시)을 그대로 재현한다(sidebar.js 참고).
  onOpenGraph: () => {
    if (window.AthenaCanvasMode && typeof window.AthenaCanvasMode.setView === 'function') {
      window.AthenaCanvasMode.setView('graph');
    }
    if (window.AthenaModeNav && typeof window.AthenaModeNav.setActive === 'function') {
      window.AthenaModeNav.setActive('graph');
    }
  },
});
agentCanvas.mount();
window.AthenaAgentCanvas = agentCanvas;

// 9단계 — "● WS 연결됨"(알람 센터 라이브 컬럼)의 실 신호. main.js RoutineFeed의
// onStatus를 이번에 처음 렌더러로 릴레이했다(이전엔 no-op). 검증 하네스
// (ATHENA_CANVAS_SOURCE=fixture)는 피드 자체를 안 돌리므로 이벤트가 안 와도
// 기본값 false(연결 안 됨)가 정직하다 — 지어내지 않는다(P3). wsConnected
// 선언 자체는 위(createAgentCanvas 호출보다 먼저)에 있다 — 이유는 그 옆 주석.
if (window.athena && typeof window.athena.on === 'function') {
  window.athena.on('athena:routine-feed-status', (s) => {
    wsConnected = !!(s && s.state === 'connected');
    if (typeof agentCanvas.updateWsStatus === 'function') agentCanvas.updateWsStatus();
  });
}

// --- 그래프 모드 요약 뷰 배선 (보드 07) --------------------------------------
//
// 표 렌더·행 클릭·selectEntity 호출은 lib/graph-mode/summary-table.js가 갖고
// 있다 — 여기서는 컨테이너와 실제 IPC·selectEntity(#13의 공통 패널 API)만 잇는다.
// #graphSummaryTable의 보이고/숨고는 위 graphMode(elements.summaryTable)가
// graphView 하나로 소유한다(US-007) — 예전엔 "#mosaic의 자식이라 브레인이
// 꺼지면 같이 안 보인다"고 가정했지만 틀렸다: #mosaic 자체는 답변 모드에서
// 안 숨는다. 그래서 브레인 ready만으로 이 엘리먼트의 hidden을 따로 건드리면
// 답변 모드에 그래프 콘텐츠가 새어 보였다(실측). 이 파일은 데이터 로드
// 시점(ready)만 결정하고, 보이고 숨기는 건 절대 안 건드린다.
const graphSummaryTable = window.AthenaLib.GraphSummaryTable.createSummaryTableController({
  // 표 전용 렌더 대상 — #graphSummaryTable(가시성 전용) 안 #graphSummaryTableArea.
  // #graphPanel은 그 바깥 형제라 표 리로드(renderSummaryTable의 통째 비움)가
  // 패널을 건드리지 않는다(스텝0-2 소유권 계약).
  container: document.getElementById('graphSummaryTableArea'),
  limit: 5, // 보드 07 "성향 신호 상위 5"
  fetchProfileSummary: ({ limit } = {}) => window.athena.invoke('athena:brain-profile-summary', { limit }),
  selectEntity: (entityId, panelData) => graphMode.selectEntity(entityId, panelData),
  onError: (err) => console.warn('[graph-mode] profile-summary 실패', err),
  // 히어로(보드 06 §5)·확인 필요 배너(§6, 06 전용) — 스텝3. 배너 개수원은
  // loadEmptyCanvasExtras()가 캔버스 빈 상태 힌트에 이미 쓰는 것과 같은 IPC다.
  heroContainer: document.getElementById('graphSummaryHero'),
  bannerContainer: document.getElementById('graphConfirmBanner'),
  fetchSuggestedQuestions: () => window.athena.invoke('athena:brain-suggested-questions'),
  // CTA "채팅에서 답하기" — 새 기능을 발명하지 않는다, 입력창에 포커스만 준다.
  onConfirmCta: () => {
    const inputEl = document.getElementById('input');
    if (inputEl) inputEl.focus();
  },
});

// --- 요약/그래프 뷰 헤더 배선 (보드 06/07 §4-1,4-3 / 14 §1.2 — 스텝2·스텝9) ---
//
// "요약"/"그래프" 서브뷰 토글 — 사이드바 모드 네비의 그래프 기능 진입·이탈
// (graphMode.toggle())과는 다른 축이다. graphMode.setSurface()가 store 상태
// (state.surface)를 바꾸고, hidden은 계속 applyVisibility() 하나가 소유한다
// (스텝2-보정 — 두 표면이 동시에 hidden=false였던 z-index 임시조치를 걷어냈다,
// canvas.css의 .graph-surface-back 삭제 참고). 헤더가 두 곳(#graphSummaryHeader
// ·#graphHeader)에 있어 탭은 4개지만 store 상태는 하나 — 이 함수 하나로 양쪽을
// 동기화한다(스텝16 사이드바 모드 네비도 같은 축을 쓸 예정, z-index 금지).
const summaryViewTabEl = document.getElementById('summaryViewTab');
const graphViewTabEl = document.getElementById('graphViewTab');
const graphHeaderSummaryTabEl = document.getElementById('graphHeaderSummaryTab');
const graphHeaderMapTabEl = document.getElementById('graphHeaderMapTab');
function updateSurfaceTabs() {
  const showGraph = graphMode.state.surface === window.AthenaLib.GraphModeStore.SURFACE_MAP;
  [summaryViewTabEl, graphHeaderSummaryTabEl].forEach((el) => {
    if (!el) return;
    el.classList.toggle('is-active', !showGraph);
    el.setAttribute('aria-selected', showGraph ? 'false' : 'true');
  });
  [graphViewTabEl, graphHeaderMapTabEl].forEach((el) => {
    if (!el) return;
    el.classList.toggle('is-active', showGraph);
    el.setAttribute('aria-selected', showGraph ? 'true' : 'false');
  });
}
// setSurface()는 hidden 갱신(applyVisibility())을 내부 await 이전에 동기로
// 끝낸다 — 탭의 활성 스타일도 그 직후 바로 갱신한다(await로 미루면 draw()의
// 네트워크 왕복이 끝날 때까지 탭이 안 눌린 것처럼 보인다, 실측으로 발견).
function wireSurfaceTab(el, surface) {
  if (!el) return;
  el.addEventListener('click', () => {
    graphMode.setSurface(surface);
    updateSurfaceTabs();
  });
}
wireSurfaceTab(summaryViewTabEl, window.AthenaLib.GraphModeStore.SURFACE_SUMMARY);
wireSurfaceTab(graphViewTabEl, window.AthenaLib.GraphModeStore.SURFACE_MAP);
wireSurfaceTab(graphHeaderSummaryTabEl, window.AthenaLib.GraphModeStore.SURFACE_SUMMARY);
wireSurfaceTab(graphHeaderMapTabEl, window.AthenaLib.GraphModeStore.SURFACE_MAP);

// "최근 갱신"(06 §4-1) — entries[].observed_at 중 가장 최신값으로만 채운다. Paper
// 목업 "12분 전"을 리터럴로 박지 않는다(§0 정직한 빈 데이터 정책) — 항목이 없거나
// 유효한 시각이 하나도 없으면 자리를 숨긴다. 상대 시간 포맷은 새로 만들지 않고
// 능동 턴 배지가 이미 쓰는 relativeText를 재사용한다(routine-turn.js).
function renderSummaryUpdatedAt(entries) {
  const el = document.getElementById('summaryUpdatedAt');
  if (!el) return;
  const list = Array.isArray(entries) ? entries : [];
  let latestMs = null;
  for (const entry of list) {
    const t = entry && Date.parse(entry.observed_at);
    if (Number.isFinite(t) && (latestMs === null || t > latestMs)) latestMs = t;
  }
  if (latestMs === null) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  const relative = window.AthenaLib.RoutineTurn.relativeText(new Date(latestMs).toISOString(), Date.now());
  el.hidden = !relative;
  el.textContent = relative ? `최근 갱신 ${relative}` : '';
}

// 테마 군집 섹션(보드 06 §8/07 §8-2, 스텝6) — cluster-map을 재사용한다(이미
// graphMode.fetchClusterMap이 쓰는 것과 같은 IPC, 여기서는 별도로 다시
// 부른다 — 그래프 뷰를 안 열어도 요약 뷰에서 이 카드가 보여야 하므로 graphMode
// 내부 캐시에 기대지 않는다). 실패해도 표 자체는 이미 그려졌으니 조용히
// 숨긴다(§0 정책 — 지어낸 카드를 보여주지 않는다).
async function loadThemeClusters() {
  const container = document.getElementById('graphThemeClusters');
  if (!container) return;
  let res;
  try {
    res = await window.athena.invoke('athena:brain-cluster-map');
  } catch (err) {
    console.warn('[graph-mode] cluster-map(테마 군집) 실패', err);
    return;
  }
  if (!res || !res.ok) return;
  const clusters = window.AthenaLib.ThemeClusters.groupThemeClusters(res);
  window.AthenaLib.ThemeClusters.renderThemeClusters(container, clusters);
}

// 숨은 연관 섹션(보드 06 §9/07 §9-2, 스텝7) — athena:brain-surprising-connections
// (이번 스텝에서 신설한 IPC, main.js/preload.js 참고). 실패해도 조용히 숨긴다
// (§0 정책 — 지어낸 항목을 보여주지 않는다).
async function loadHiddenLinks() {
  const container = document.getElementById('graphHiddenLinks');
  if (!container) return;
  let res;
  try {
    res = await window.athena.invoke('athena:brain-surprising-connections');
  } catch (err) {
    console.warn('[graph-mode] surprising-connections(숨은 연관) 실패', err);
    return;
  }
  if (!res || !res.ok) return;
  // 스텝14 — 그래프 지도(핑크 점선)·컨텍스트 패널("숨은" 관계 행)이 재사용할
  // 캐시를 여기서 채운다(위 lastSurprisingConnections 선언 참고).
  lastSurprisingConnections = Array.isArray(res.connections) ? res.connections : [];
  window.AthenaLib.HiddenLinks.renderHiddenLinks(container, res.connections);
}

async function refreshConversationGraphSurfaces() {
  const visibleGraphRefresh = graphMode.setAvailable(true);
  await Promise.allSettled([
    Promise.resolve(visibleGraphRefresh),
    graphSummaryTable.load().then(renderSummaryUpdatedAt),
    loadThemeClusters(),
    loadHiddenLinks(),
    loadEmptyCanvasExtras(),
  ]);
}

if (window.athena && typeof window.athena.on === 'function') {
  window.athena.on('athena:brain-graph-updated', () => {
    void refreshConversationGraphSurfaces();
  });
}

// 모드 칩은 항상 보이지만, 컨트롤러는 아직 "못 씀"으로 가정한 채 태어난다
// (controller.js 기본값) — 이 프로브가 브레인 상태를 확인해 바로잡는다. 프로브 전에
// 사람이 그래프 모드로 들어와도 renderUnavailable()의 정직한 안내가 뜨지, 막히지 않는다.
(async () => {
  try {
    const status = await window.athena.invoke('athena:brain-status');
    const ready = Boolean(status && status.ok && status.ready);
    graphMode.setAvailable(ready);
    // hidden은 안 건드린다 — graphMode.applyVisibility()가 유일한 소유자다(US-007).
    // 여기서는 데이터를 미리 당겨올지만 결정한다(그래프 모드로 전환했을 때 바로
    // 보이도록 하는 프리페치 — 안 보이는 동안 부르는 낭비는 loadEmptyCanvasExtras와
    // 같은 기존 관례).
    if (ready) graphSummaryTable.load().then(renderSummaryUpdatedAt);
    if (ready) loadThemeClusters();
    if (ready) loadHiddenLinks();
    // 빈 상태(보드 05) 숫자·CTA·힌트 — 같은 ready 확인에 얹는다(왕복 추가 없음).
    if (ready) loadEmptyCanvasExtras();
  } catch (err) {
    console.warn('[graph-mode] brain-status 실패 — 못 씀으로 둔다', err);
    graphMode.setAvailable(false);
  }
})();
