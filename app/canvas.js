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
const rankingAxis = window.AthenaLib.RankingAxis;
const semanticDetailSheet = window.AthenaLib.SemanticDetailSheet;
const semanticWorkspace = window.AthenaLib.SemanticWorkspace;
const paperCardRouting = window.AthenaLib.PaperCardRouting;
const boardMount = window.AthenaLib.BoardMount;
const boardTemplateRegistry = window.AthenaLib.BoardTemplateRegistry;
const canvasTabs = window.AthenaLib.CanvasTabs;
const SEMANTIC_PRIMARY_TYPES = new Set(['table', 'chart', 'facts', 'compound', 'event', 'action', 'status']);

function developerDiagnosticsEnabled() {
  return window.__ATHENA_DEVELOPER_DIAGNOSTICS__ === true;
}

function upsertDeveloperDiagnostics(root, envelope) {
  if (!developerDiagnosticsEnabled() || !semanticDetailSheet) return null;
  // 보드 표면 카드에는 개발자 진단 시트("전체 원본 필드 ▸")도 덧대지 않는다 —
  // 카드가 보드 그 자체이므로 그 아래에 원시 필드 서랍이 붙을 자리가 없다(신념 8).
  if (integratedCardSurface.isBoardSurface(root)) return null;
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

// ---------- 캔버스 탭 뷰포트 (캔버스 탭·반응형 카드 계획 §1) ----------
// 키움 보드 카드(통합 카드)는 모자이크 2열에 나란히 눕지 않는다 — 탭 스트립 +
// 뷰포트 1개를 쓰고, 카드 크기 = 뷰포트 크기다. 판정·상태는 lib/canvas-tabs.js가
// 단독으로 갖는다(canvas.js는 shell.html에서만 도는 렌더러라 단위 테스트가 안 걸린다).
//
// 덱은 첫 보드 카드가 올 때 만들고 마지막 탭이 닫히면 지운다 — #grid 자식 수가
// 빈 캔버스 상태(#gridEmpty)의 유일한 판정 근거라, 빈 덱을 남겨두면 빈 화면이
// 영영 안 돌아온다.
let canvasTabDeck = null;

function discardCanvasTabDeck() {
  if (!canvasTabDeck || canvasTabDeck.keys().length) return;
  canvasTabDeck.element.remove();
  canvasTabDeck = null;
}

function ensureCanvasTabDeck() {
  if (canvasTabDeck && !canvasTabDeck.element.isConnected) {
    // 덱이 밖에서 떨어져 나갔다(grid.replaceChildren 류 — verify-semantic-workspaces가
    // recipe 사이에 그렇게 비운다). 캐시만 남은 덱에 카드를 넣으면 카드가 문서 밖으로
    // 사라진다(2026-09-04 실측: 두 번째 recipe의 호가 카드가 통째로 증발). 남은 탭은
    // 정식 경로로 닫아 세션·실시간 리스를 풀고, 덱은 새로 만든다.
    for (const key of canvasTabDeck.keys()) canvasTabDeck.close(key);
    canvasTabDeck = null;
  }
  if (canvasTabDeck) return canvasTabDeck;
  canvasTabDeck = canvasTabs.createDeck({
    onClose: (card) => {
      destroyCard(card);
      discardCanvasTabDeck();
    },
  });
  grid.prepend(canvasTabDeck.element);
  return canvasTabDeck;
}

// 통합 카드 root를 자기 탭으로 옮긴다. 같은 인스턴스 키면 탭이 늘지 않고 갱신된다.
function adoptIntoCanvasTab(root, envelope) {
  if (!root || !canvasTabs) return null;
  const key = integratedCardSurface.instanceKeyFor(envelope);
  if (!key) return null;
  const definition = integratedCardSurface.integratedDefinition(envelope);
  const deck = ensureCanvasTabDeck();
  return deck.upsert(root, {
    key,
    title: canvasTabs.tabTitleFor(envelope, definition && definition.title),
  });
}

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
      // 보드 표면 카드는 의미 작업대가 아니다 — 같은 프레임을 슬롯 이음매로 받는다.
      for (const host of root.querySelectorAll('.board-surface-host')) {
        applyBoardRealtimeTick(host, tick);
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
// ---------- 세션 카드 스택 보고(42번 보드) ----------
// 카드 DOM에 그린 근거(봉투)를 매달아 두고, 추가·닫기·비우기 뒤마다 그리드의
// 스택을 main에 보고한다. main이 세션에 적고, 복원은 같은 봉투를 같은 페인트
// 채널로 다시 흘려 그린다 — 별도 렌더러를 두지 않는다. 봉투가 없는 카드(알림·
// 상태 카드)는 스택에 넣지 않는다: 그릴 근거가 없는 것을 있다고 저장하지 않는다.
// 렌더 함수들은 카드 노드를 돌려주지 않는 것이 많다(renderTable은 문자열, 일부는 undefined).
// 그리드에 마지막으로 붙은 카드가 곧 방금 그린 카드다 — 그것을 태그한다.
function lastCardOr(node) {
  if (node && node.classList && node.classList.contains('card')) return node;
  const cards = grid.querySelectorAll('.card');
  return cards.length ? cards[cards.length - 1] : null;
}

function tagSessionCard(node, meta) {
  if (!node || !node.classList || !node.classList.contains('card') || !meta) return node;
  // 재생(복원)된 카드는 저장된 id를 그대로 쓴다 — 새 id를 주면 같은 카드가 두 장으로 저장된다.
  if (meta.cardId) node.dataset.sessionCardId = meta.cardId;
  if (!node.dataset.sessionCardId) node.dataset.sessionCardId = crypto.randomUUID();
  node.__athenaSessionCard = meta;
  return node;
}

function reportSessionCards() {
  const cards = [];
  for (const node of grid.querySelectorAll('.card')) {
    const meta = node.__athenaSessionCard;
    if (!meta) continue;
    cards.push({
      cardId: node.dataset.sessionCardId,
      kind: meta.kind || null,
      channel: meta.channel,
      envelope: meta.envelope || null,
      protected: node.dataset.protected === 'true',
    });
  }
  try { window.athena.send('athena:session-cards', { cards }); } catch { /* 채널이 없는 하네스 — 보고는 그림의 필요조건이 아니다 */ }
}

window.athena.on('athena:add-canvas', ({ type, sessionCardId }) => {
  Promise.resolve(addCard(type)).then((node) => {
    tagSessionCard(lastCardOr(node), { channel: 'fixture', kind: type, envelope: { type }, cardId: sessionCardId || null });
    reportSessionCards();
  });
});

// 카드 비우기 — 옛 판에서는 main이 캔버스 창을 수축시킬 때 `athena:clear-canvases`
// IPC로 보냈다. 두 영역이 같은 문서에 사는 지금은 IPC를 왕복할 이유가 없다:
// chat.js의 Esc(유휴 상태)가 shell.js 버스를 통해 이 함수를 직접 부른다.
function clearCanvases() {
  for (const card of grid.querySelectorAll('.card')) {
    destroyCard(card);
  }
  // 카드를 지워도 탭 스트립은 남는다 — 덱까지 닫아야 빈 캔버스로 돌아간다.
  if (canvasTabDeck) {
    for (const key of canvasTabDeck.keys()) canvasTabDeck.close(key);
    discardCanvasTabDeck();
  }
  activeDatasetId = null;
  reportSessionCards();
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
    tagSessionCard(lastCardOr(card), { channel: 'rest', kind: envelope.canvas_type || null, envelope });
    reportSessionCards();
    if (card && REST_RETRY_CARD_ID_PATTERN.test(String(payload.retryCardId || ''))) {
      Object.defineProperty(card, '__athenaRestRetryCardId', {
        value: String(payload.retryCardId), configurable: true, writable: false,
      });
    }
    const domAttachedAt = performance.now();
    const chartImportReadyAt = card && card.dataset.chartImportReadyAt
      ? Number(card.dataset.chartImportReadyAt) : null;
    const paint = await waitForVisiblePaint(card);
    // 차트는 껍질만 먼저 뜬다. 마운트 결과가 아직이면 pending으로 알리고, 결과가
    // 나오면 같은 correlation으로 최종 상태를 한 번 더 보낸다 — main은 그 값으로
    // 재조회 권위·실시간 등록·데이터 카드 집계를 결정한다.
    const chartSettled = card && card.dataset.renderState === 'loading' && card.dataset.chartPanelId
      ? chartMountSettlements.get(card.dataset.chartPanelId) || null
      : null;
    window.athena.send('athena:rest-canvas-painted', {
      dataset_id: correlation.dataset_id,
      item_id: correlation.item_id,
      ordinal: correlation.ordinal,
      operation_ref: payload.operationRef,
      canvas_type: payload.canvasType,
      render_state: card && card.dataset.renderState ? card.dataset.renderState : 'data',
      pending: !!chartSettled,
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
    if (chartSettled) {
      // 첫 ack는 이미 성공으로 나갔다. 후속 관측이 실패하더라도 눈에 보이는 카드를
      // paint 실패로 뒤집지 않는다 — main은 한도가 지나면 'timeout'으로 맺는다.
      try {
        const mountedState = await chartSettled;
        window.athena.send('athena:rest-canvas-painted', {
          dataset_id: correlation.dataset_id,
          item_id: correlation.item_id,
          ordinal: correlation.ordinal,
          operation_ref: payload.operationRef,
          canvas_type: payload.canvasType,
          render_state: mountedState,
          renderer_id: card.dataset.rendererId || null,
          panel_id: card.dataset.chartPanelId || null,
          generation: card.dataset.chartGeneration ? Number(card.dataset.chartGeneration) : null,
          verified_visible: true,
          pending: false,
        });
      } catch { /* 마운트 결과 관측 실패 — main의 pending 한도가 상태를 맺는다 */ }
    }
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
  tagSessionCard(lastCardOr(node), { channel: 'live', kind: result.envelope && result.envelope.canvas_type || null, envelope: result.envelope || null, cardId: result.sessionCardId || null });
  reportSessionCards();
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
  // 둘 다 이 필드로 어떤 카드를 그릴지 정한다. 알려진 3종(table/stream/reader) 중
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
  // 표면 계약이 실려 오면 Paper 보드 원문을 그대로 마운트한다(D1) — 런타임 레이아웃
  // 재조립 없이 텍스트 노드만 바뀐다. 계약이 없으면 기존 경로 그대로.
  // 단, D1의 예외 — 앱 렌더러(AITS 차트·호가 래더·주문 초안)가 primary인 봉투는
  // 그 렌더러를 품을 자리(primary.renderer)가 저작된 보드에만 보낸다. 자리가 없는
  // 보드가 가로채면 라이브 표면이 정적 목업으로 바뀐다(2026-09-04 실측). 자리가
  // 있으면 보드가 껍질을 그리고 렌더러는 그 안에 앉는다(mountBoardPrimary).
  // 판정은 paper-card-routing이 들고, 보드 쪽 사실은 색인이 동기로 답한다.
  const boardCard = paperCardRouting.preservesAppPrimary(envelope, boardPrimaryRendererOf(envelope))
    ? null : renderBoardSurfaceCard(envelope);
  if (boardCard) return boardCard;
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

// 보드 표면 카드 — surface_contract(백엔드 canvas_push가 싣는다)를 board-mount에
// 넘겨 Paper 원문 HTML을 마운트한다. 슬롯 값이 없으면 결측어가 뜨고(신념 5),
// 계약이 없으면 null을 돌려 기존 렌더 경로가 그대로 돈다.
function surfaceContractOf(envelope) {
  const contract = envelope && (envelope.surface_contract || envelope.surfaceContract);
  return contract && typeof contract === 'object' && contract.board_id ? contract : null;
}

// 이 봉투가 갈 보드에 전문 렌더러 자리가 저작돼 있는가. 청크(수 MB)가 아니라
// 색인을 읽는다 — 라우팅은 청크가 실리기 전에 답이 있어야 한다.
function boardPrimaryRendererOf(envelope) {
  const contract = surfaceContractOf(envelope);
  return contract ? boardTemplateRegistry.primaryRendererFor(contract.board_id) : '';
}

// slot_values는 {slot_id: value} 맵으로도, [{slot_id, value}] 목록으로도 온다.
function slotValuesOf(contract) {
  const raw = contract.slot_values || contract.slotValues;
  if (!raw) return {};
  if (!Array.isArray(raw)) return raw;
  const map = {};
  for (const entry of raw) {
    if (entry && entry.slot_id !== undefined) map[entry.slot_id] = entry.value;
  }
  return map;
}

// 상태 보드 링크 — 백엔드는 `state_boards`로 싣고 계약 문서는 `state_links`로 부른다.
// 둘 다 같은 목록이다: [{board_id, kind, control}].
function stateLinksOf(contract) {
  const raw = contract.state_links || contract.state_boards;
  return (Array.isArray(raw) ? raw : []).filter((link) => link && link.board_id);
}

// 하이드레이션 대상 — 백엔드는 op의 manifest request alias로 적은 인자 가방을 받는다
// (BoardHydrateRequest.target은 dict다). 봉투가 실어온 인자를 그대로 넘기고 종목코드만
// 봉투 머리에서 보강한다 — 백엔드가 op마다 자기 alias만 골라 쓴다.
function boardHydrateTarget(envelope) {
  const args = (envelope && (envelope.operation_args || envelope.arguments)) || {};
  const target = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  const stkCd = cardStkCd(envelope) || args.stk_cd || (envelope && envelope.symbol) || args.symbol;
  if (stkCd) target.stk_cd = stkCd;
  return target;
}

function boardHydrateAccount(envelope) {
  const args = (envelope && (envelope.operation_args || envelope.arguments)) || {};
  return envelope.account_id || envelope.account_no || args.account_id || args.account_no
    || args.acnt_no || '';
}

// 보드 마운트 상태 — 카드 1장이 사는 동안 값 표와 상태 보드 링크를 이어 쓴다.
// 상태 보드로 갈아타도 같은 값 표를 그대로 쓰고(D5) 부족분만 더 채운다.
function boardStateOf(host) {
  if (!host.__athenaBoard) {
    host.__athenaBoard = {
      values: {}, links: [], unbound: [], boardId: null,
      // binding_id → [slot_id]. 봉투가 두 표를 같이 실을 때만 채워진다 —
      // 비어 있으면 실시간 프레임은 보드에 아무것도 안 한다(추측하지 않는다).
      realtimeSlots: new Map(), surface: null, mountContract: null,
      // 지금 이 보드의 primary 자리에 열려 있는 앱 렌더러 패널 — 상태 보드를
      // 갈아타거나 카드를 닫을 때 이 id로 닫는다.
      primaryPanelId: '',
      // 그 자리가 잡은 실시간 리스를 놓는 문(호가 0D). 한 번만 나간다.
      primaryRelease: null,
      // 껍질 단계가 확정한 차트 신원과 그 마운트 결과를 기다리는 자리.
      // primaryMount는 "지금 진행 중인 마운트 시도"다(늦은 거부를 가려낸다).
      primaryDescriptor: null, primarySettle: null, primaryMount: null,
    };
  }
  return host.__athenaBoard;
}

// 마운트 계약(어느 노드에 어떤 슬롯이 앉는가)은 정적이라 board-template-registry가
// 갖고 있다. 봉투는 값(slot_values)과 상태 보드 목록만 나른다.
function boardMountOptions(host, envelope) {
  return {
    // ▸ 펼침 = 상태 보드 템플릿 교체(D5). 링크에 있는 보드로만 바꾼다 — 없으면
    // 아무것도 하지 않는다(없는 화면을 지어내지 않는다).
    onExpand: (boardId) => switchStateBoard(host, boardId, envelope),
  };
}

// 봉투가 실어온 계약으로 보드를 연다. 값 표·상태 링크·미결 슬롯은 여기서만 온다.
function openBoardSurface(host, contract, envelope) {
  const state = boardStateOf(host);
  state.values = slotValuesOf(contract);
  state.links = stateLinksOf(contract);
  state.unbound = Array.isArray(contract.unbound_slots) ? contract.unbound_slots.slice() : [];
  state.realtimeSlots = boardMount.realtimeSlotIndex(contract, realtimeBindingsOf(envelope));
  return mountBoardState(host, contract.board_id, envelope).then((mounted) => {
    // 계약이 갈아탈 탭을 지정했으면 기본 보드를 세운 **뒤에** 그리로 간다 — 사람이
    // 탭을 누른 것과 같은 경로이고, 형제 탭 레일은 색인이 다시 얹어 준다.
    // 값 표를 다 채운 뒤(기본 보드 하이드레이션까지 끝난 뒤)에 옮긴다 — 그래야 새
    // 보드가 결측어부터 그리지 않는다. 대신 첫 화면은 잠깐 기본 보드다.
    const initial = String(contract.initial_state_board || '');
    const switched = initial && switchStateBoard(host, initial, envelope);
    // 갈아타다 실패해도 이미 선 기본 보드는 지우지 않는다 — 사람이 탭을 눌렀을 때와 같다.
    return switched ? switched.catch(() => mounted) : mounted;
  });
}

// 봉투가 싣는 실시간 바인딩 표. semantic-workspace가 읽는 자리와 같은 자리다.
function realtimeBindingsOf(envelope) {
  const taskCanvas = (envelope && (envelope.task_canvas || envelope.taskCanvas)) || {};
  return [
    envelope && envelope.realtime_bindings, envelope && envelope.realtimeBindings,
    taskCanvas.realtime_bindings, taskCanvas.realtimeBindings,
  ].find(Array.isArray) || [];
}

// 실시간 프레임 → 보드 잎. 프레임이 아는 것은 binding_id뿐이고, 그것이 어느 슬롯을
// 가리키는지는 봉투가 이미 말해 뒀다(realtimeSlots). 모르는 binding은 버린다.
function applyBoardRealtimeTick(host, tick) {
  const state = host && host.__athenaBoard;
  if (!state || !state.surface || !state.mountContract || !state.realtimeSlots.size) return 0;
  const touched = [];
  for (const update of semanticWorkspace.semanticRealtimeUpdates(tick)) {
    for (const slotId of state.realtimeSlots.get(update.bindingId) || []) {
      state.values[slotId] = update.value;
      touched.push(slotId);
    }
  }
  if (!touched.length) return 0;
  boardMount.applyRealtimeSlots(state.surface, state.mountContract, state.values, touched);
  return touched.length;
}

// 원문 HTML은 카드 청크에 있다 — 그 카드의 첫 보드는 여기서 한 번 기다린다.
function mountBoardState(host, boardId, envelope) {
  const state = boardStateOf(host);
  state.boardId = String(boardId);
  // 상태 링크의 정본은 생성물 색인이다 — 봉투는 마운트한 그 보드의 직계 자식만 나르므로
  // 갈아탄 뒤에는 형제 탭도 되돌아갈 길도 목록에 없다. 색인이 모르는 보드(픽스처 계약)
  // 에서만 봉투가 실어온 목록을 그대로 쓴다.
  const links = boardTemplateRegistry.stateLinksFor(state.boardId);
  if (links.length) state.links = links;
  return boardMount.mountBoardAsync(host, state.boardId, state.values, boardMountOptions(host, envelope))
    .then((mounted) => {
      rememberMountedBoard(state, mounted);
      wireStateControls(host, envelope, mounted);
      // 껍질이 먼저다 — 여기서 기다리면 AITS 라이브러리 로드가 첫 피드백 3초
      // 계약을 넘긴다(renderLiveChart가 같은 판단을 한다). 던져 놓고 진행한다.
      void mountBoardPrimary(host, envelope, mounted);
      return hydrateBoardSlots(host, envelope, mounted);
    });
}

function switchStateBoard(host, boardId, envelope) {
  const state = boardStateOf(host);
  const target = String(boardId || '');
  if (!target || target === state.boardId) return null;
  if (!state.links.some((link) => link.board_id === target)) return null;
  // 표면을 통째로 갈면 컨테이너가 바뀐다 — 같은 panelId를 다른 컨테이너로 열면
  // AITS adapter가 던지므로(aits-chart-panel openPanel) 먼저 닫는다.
  destroyBoardPrimary(state);
  return mountBoardState(host, target, envelope);
}

// 스트립 칩·탭 = 상태 보드 조작. 추출 원문에서 칩은 그냥 텍스트 노드라, 계약이 준
// `control` 문구와 정확히 같은 글자를 내는 잎을 그 조작으로 본다(스트립·내비 안에서만).
function findStateControl(surface, control) {
  for (const node of surface.querySelectorAll('[data-state-control]')) {
    if (node.dataset.stateControl === control) return boardMount.stateControlActivationOwner(node);
  }
  for (const scope of surface.querySelectorAll('.bs-strip, nav, [role="tablist"]')) {
    for (const node of scope.querySelectorAll('*')) {
      if (node.childElementCount === 0 && node.textContent.trim() === control) {
        return boardMount.stateControlActivationOwner(node);
      }
    }
  }
  return null;
}

const RESPONSIVE_STATE_CONTROL_OWNER = '.bs-r-flow, .bs-r-scroll, .bs-r-scroll-table';

function isResponsiveStateControl(node) {
  return !!(node && node.childElementCount === 0 && typeof node.closest === 'function'
    && node.closest(RESPONSIVE_STATE_CONTROL_OWNER));
}

function wireStateControls(host, envelope, mounted) {
  const state = boardStateOf(host);
  const surface = mounted && mounted.surface;
  if (!surface || !state.links.length) return 0;
  let wired = 0;
  for (const link of state.links) {
    const control = String(link.control || '').trim();
    if (!control) continue;
    const node = findStateControl(surface, control);
    if (!node) continue;
    const didWire = boardMount.wireStateControlActivation(
      node,
      () => switchStateBoard(host, link.board_id, envelope),
      { keyboard: isResponsiveStateControl(node) },
    );
    if (!didWire) continue;
    // 표시는 CSS가 한다([data-state-board], board-surface.css) — 인라인 원문은 안 건드린다(D1).
    node.dataset.stateBoard = link.board_id;
    wired += 1;
  }
  return wired;
}

// 보드가 자기 자리에 얹을 줄 아는 앱 렌더러. paper-card-routing의
// BOARD_MOUNTED_RENDERERS와 같은 목록이어야 한다 — 어긋나면 봉투는 보드로 갔는데
// 그 자리가 목업인 채로 남는다.
const BOARD_CHART_RENDERER = 'athena-chart';
const BOARD_ORDERBOOK_RENDERER = 'orderbook-ladder';

// 열려 있는 보드 primary 패널을 닫는다. 상태 보드 전환과 카드 파괴가 같은 문을 쓴다.
function destroyBoardPrimary(state) {
  if (!state) return false;
  // 진행 중인 마운트는 이 순간부터 "현재 시도"가 아니다 — 늦게 거부돼도 그 사이
  // 새로 살아난 패널의 신원을 지우지 못한다.
  state.primaryMount = null;
  // 호가 0D 리스는 이 자리가 열 때만 잡는다(리스가 나르는 0B와 다르다) — 자리를
  // 놓으면 같이 놓는다. 안 놓으면 갈아탄 보드마다 REG가 하나씩 쌓인다.
  const release = state.primaryRelease;
  state.primaryRelease = null;
  const released = typeof release === 'function' ? release() : false;
  const panelId = state.primaryPanelId;
  if (!panelId) return released;
  state.primaryPanelId = '';
  const destroyed = aitsChartPanels.destroyPanel(panelId);
  if (destroyed) window.athena.send('athena:chart-panel-destroyed', { panelId });
  return destroyed || released;
}

// 이 봉투가 보드 primary 자리에 얹을 라이브 차트. 봉투가 차트를 안 실었거나 봉이
// 없으면 null이다 — 목업을 걷어낼 이유가 못 된다(봉을 지어내지 않는다). 계약이
// 깨졌으면 던진다 — 사유는 부르는 쪽이 드러낸다.
function boardChartDescriptor(envelope) {
  const data = envelope && typeof envelope.data === 'object' ? envelope.data : null;
  if (!data || !data.chart) return null;
  const descriptor = describeAitsChartPanel(data, envelope, 'live');
  return descriptor.body.candles.length ? descriptor : null;
}

// 껍질 단계에서 차트 신원을 카드에 찍고 마운트 결과를 기다릴 자리를 연다.
// paint ack(athena:add-rest-canvas)는 껍질이 선 그 시점의 dataset만 읽는다 —
// 안 찍으면 마운트도 안 끝난 차트가 render_state 'data'로 집계되고(false green),
// 확정 ack가 없어 재조회 권위도 못 선다(main chartReloadAuthority.registerPaint는
// panel_id·renderer_id·generation을 요구한다). 그러면 주기 전환과 과거봉 페이지가
// 권위 없는 패널로 막힌다 — 137X-2가 저작한 것이 바로 그 주기 조작이다.
function beginBoardChartMount(card, state, descriptor) {
  card.dataset.chartAuthority = 'AITS';
  card.dataset.rendererId = descriptor.rendererId;
  card.dataset.chartPanelId = descriptor.panelId;
  card.dataset.chartGeneration = String(descriptor.generation);
  card.dataset.renderState = 'loading';
  state.primaryDescriptor = descriptor;
  const settled = new Promise((resolve) => { state.primarySettle = resolve; });
  chartMountSettlements.set(descriptor.panelId, settled);
  void settled.then(() => {
    if (chartMountSettlements.get(descriptor.panelId) === settled) {
      chartMountSettlements.delete(descriptor.panelId);
    }
  });
  return settled;
}

// 마운트 결과를 첫 ack가 걸어둔 promise에 맺는다 — 한 카드당 한 번만 맺힌다.
function settleBoardChartMount(state, renderState) {
  const settle = state && state.primarySettle;
  if (!settle) return renderState;
  state.primarySettle = null;
  settle(renderState);
  return renderState;
}

// 마운트가 실패하면 껍질에 찍어둔 차트 신원을 거둔다 — 안 거두면 카드가 없는
// 패널을 가리킨 채 남는다(renderLiveChart 실패 분기와 같은 처리).
function clearBoardChartIdentity(card) {
  card.dataset.renderState = 'error';
  delete card.dataset.chartAuthority;
  delete card.dataset.rendererId;
  delete card.dataset.chartPanelId;
  delete card.dataset.chartGeneration;
}

// 같은 panelId가 다른 컨테이너에서 살아 있으면 먼저 놓아준다. 안 놓으면 adapter가
// 던지고(aits-chart-panel openPanel 컨테이너 충돌) 같은 종목의 두 번째 차트 봉투가
// 목업으로 되돌아간다. 보드 카드는 표면을 통째로 갈아 끼우므로 옛 자리에서 제자리
// 재조회할 길이 없다 — 옛 자리는 이미 화면에서 빠진 보드다.
function releaseBoardChartPanel(panelId) {
  if (!aitsChartPanels.has(panelId)) return false;
  for (const node of document.querySelectorAll('.board-surface-host')) {
    const other = node.__athenaBoard;
    if (!other || other.primaryPanelId !== panelId) continue;
    other.primaryPanelId = '';
    other.primaryMount = null;
  }
  const destroyed = aitsChartPanels.destroyPanel(panelId);
  if (destroyed) window.athena.send('athena:chart-panel-destroyed', { panelId });
  return destroyed;
}

// 이 보드의 primary가 어느 조회에서 값을 받는지는 계약이 저작해 뒀다(props_from).
// 봉투의 조회가 그 목록에 없으면 남의 보드다. 상태 보드를 갈아타면 같은 봉투가
// 다음 보드로 그대로 따라가므로(switchStateBoard → mountBoardState) 여기서 막지
// 않으면 137X-2의 종목 일봉이 32S7-0(업종 지수 캔들) 자리에 얹힌다 — 그 보드가
// 부르지 않는 조회의 봉이다. 출처를 저작하지 않은 보드는 아무 것도 주장하지
// 않은 것이므로 그대로 얹는다(픽스처 계약이 그 경우다).
function boardPrimaryAcceptsEnvelope(primary, envelope) {
  const sources = Array.isArray(primary.propsFrom) ? primary.propsFrom : [];
  if (!sources.length) return true;
  const operationRef = String((envelope && (envelope.operation_ref || envelope.operationRef)) || '');
  return sources.some((source) => String((source && source.mapping_id) || '') === operationRef);
}

// 보드 primary 자리에 호가 사다리를 얹는다. 조각은 카드종 렌더러가 만들고
// (all-or-nothing — 못 만들면 null) 여기서는 목업을 접고 그 자리에 넣기만 한다.
// 0D 호가잔량은 통합 카드 리스가 나르지 않는다 — 호가는 카드가 실제로 열려 있을
// 때만 REG를 쓰므로 여기서 명시로 acquire하고, 보드를 갈아타거나 카드를 닫을 때
// destroyBoardPrimary가 같은 문으로 놓아준다.
function mountBoardOrderbook(card, state, primary, envelope) {
  const kinds = window.AthenaLib.CardKinds;
  const render = kinds && kinds.resolve('호가');
  const built = render && render(envelope);
  // 조각이 없으면 목업을 걷어낼 이유가 못 된다 — 빈 사다리를 지어내지 않는다.
  if (!built) return null;
  boardMount.collapsePrimaryMockup(primary.mountPoint);
  // primary 자리는 Paper가 세로 flex 상자로 저작했다 — 남은 높이를 사다리가 받는다.
  built.style.flex = '1 1 auto';
  built.style.minHeight = '0';
  primary.mountPoint.appendChild(built);
  primary.mountPoint.dataset.bsPrimaryMounted = BOARD_ORDERBOOK_RENDERER;
  const hoga = window.AthenaLib.CardKindHoga;
  if (hoga.supportsLive0D(built)) {
    state.primaryRelease = wireOrderbookRealtime(
      card, built, envelope, hoga.applyLiveTick, { registerCardDestroyer: false },
    );
  }
  return built;
}

// 껍질(보드 HTML)이 선 뒤에 primary 자리의 Paper 목업을 접고 그 자리에 앱 렌더러를
// 얹는다. 목업은 지우지 않고 접는다(D1) — 마운트가 실패하면 되돌리고 사유를 얹는다.
// 실시간은 차트 자리에서는 다시 걸지 않는다: 통합 카드 리스가 이미 그 피드를 나르고
// (syncIntegratedRealtime → applyBoardRealtimeTick), 진행봉은 aitsChartPanels가 접는다.
async function mountBoardPrimary(host, envelope, mounted) {
  const state = boardStateOf(host);
  const primary = mounted && mounted.primary;
  const card = typeof host.closest === 'function' ? host.closest('.card') : null;
  // 호가 사다리는 동기 렌더러다 — 기다릴 라이브러리가 없고 차트 신원(paint ack의
  // panel_id·generation)도 쓰지 않으므로 껍질 ack가 그대로 확정이다.
  if (primary && primary.renderer === BOARD_ORDERBOOK_RENDERER && primary.mountPoint && card
    && boardPrimaryAcceptsEnvelope(primary, envelope)) {
    return mountBoardOrderbook(card, state, primary, envelope);
  }
  // 안 얹기로 한 것도 결과다 — 껍질이 'loading'을 찍어 두고 여기서 조용히 빠지면
  // 확정 ack가 영영 안 나가고 main의 pendingMount 한도 뒤 'timeout'으로 샌다.
  // (갈아탄 보드에서는 이미 맺힌 뒤라 settleBoardChartMount가 아무 것도 안 한다.)
  if (!primary || primary.renderer !== BOARD_CHART_RENDERER || !primary.mountPoint || !card
    || !boardPrimaryAcceptsEnvelope(primary, envelope)) {
    settleBoardChartMount(state, 'error');
    return null;
  }
  // 껍질 단계가 만든 신원을 그대로 쓴다 — 다시 만들면 paint ack가 실어 보낸
  // panel_id·generation과 어긋난다.
  let descriptor = state.primaryDescriptor;
  if (!descriptor) {
    try {
      descriptor = boardChartDescriptor(envelope);
    } catch (error) {
      primary.mountPoint.dataset.bsPrimaryError = String((error && error.message) || error);
      primary.mountPoint.prepend(errorNote('차트를 그리지 못했다'));
      return null;
    }
    if (!descriptor) return null;
  }
  const collapsed = boardMount.collapsePrimaryMockup(primary.mountPoint);
  const chartBody = document.createElement('div');
  chartBody.className = 'chart-card-body';
  // primary 자리는 Paper가 세로 flex 상자로 저작했다 — 남은 높이를 차트가 받는다.
  chartBody.style.flex = '1 1 auto';
  chartBody.style.minHeight = '0';
  primary.mountPoint.appendChild(chartBody);
  primary.mountPoint.dataset.bsPrimaryMounted = BOARD_CHART_RENDERER;
  releaseBoardChartPanel(descriptor.panelId);
  // 이 마운트 시도의 신원 — 늦게 거부된 시도가 그 사이 살아난 패널을 지우지 못하게 한다.
  const attempt = {};
  state.primaryMount = attempt;
  state.primaryPanelId = descriptor.panelId;
  try {
    // 카드 정리자는 renderBoardSurfaceCard가 이미 걸었다(보드 상태가 패널을 닫는다) —
    // 여기서 덮으면 통합 카드 root의 집계 정리자를 잃는다.
    const session = await mountAitsChartPanel(card, chartBody, descriptor, { registerCardDestroyer: false });
    // 성공도 실패와 같은 문으로 판정한다 — 그 사이 보드를 갈아탔으면(destroyBoardPrimary)
    // 이 자리는 이미 화면에서 빠진 표면이다. 그대로 'data'로 맺으면 main이 죽은
    // panelId에 재조회 권위와 실시간을 건다(main.js athena:rest-canvas-painted).
    if (state.primaryMount !== attempt) {
      session.destroy();
      chartBody.remove();
      delete primary.mountPoint.dataset.bsPrimaryMounted;
      boardMount.restorePrimaryMockup(collapsed);
      settleBoardChartMount(state, 'error');
      return null;
    }
    settleBoardChartMount(state, session.body.candles.length ? 'data' : 'empty');
    return session;
  } catch (error) {
    // 실패를 감추지 않는다 — 목업을 되돌리고 그 위에 사유를 얹는다. 사용자에게
    // 보이는 문구에는 내부 용어를 싣지 않는다(원문은 검수용으로 표식에 남긴다).
    chartBody.remove();
    delete primary.mountPoint.dataset.bsPrimaryMounted;
    boardMount.restorePrimaryMockup(collapsed);
    if (state.primaryMount !== attempt) {
      settleBoardChartMount(state, 'error');
      return null;
    }
    state.primaryMount = null;
    state.primaryPanelId = '';
    primary.mountPoint.dataset.bsPrimaryError = String((error && error.message) || error);
    primary.mountPoint.prepend(errorNote('차트를 그리지 못했다'));
    clearBoardChartIdentity(card);
    settleBoardChartMount(state, 'error');
    return null;
  }
}

// 봉투가 못 채운 슬롯을 마운트 뒤에 한 번 더 채운다. 엔드포인트가 아직 없으면
// 응답이 unavailable로 오고 화면은 결측어(미제공)를 그대로 둔다 — 값을 지어내지 않는다.
async function hydrateBoardSlots(host, envelope, mounted) {
  const state = boardStateOf(host);
  const pending = state.unbound.length
    ? state.unbound
    : ((mounted && mounted.plan && mounted.plan.missing) || []);
  if (!pending.length || !window.athena || typeof window.athena.invoke !== 'function') return mounted;
  let reply = null;
  try {
    reply = await window.athena.invoke('athena:canvas-board-hydrate', {
      boardId: state.boardId,
      target: boardHydrateTarget(envelope),
      account: boardHydrateAccount(envelope),
    });
  } catch {
    reply = null;
  }
  const filled = reply && reply.ok && reply.slot_values ? reply.slot_values : null;
  if (!filled || !Object.keys(filled).length) return mounted;
  state.values = { ...state.values, ...filled };
  state.unbound = state.unbound.filter((slotId) => !(slotId in filled));
  // 하이드레이션이 채운 슬롯도 실시간 프레임을 받아야 한다 — 응답 계약으로 색인을
  // 다시 만들어 덧댄다. 안 하면 이 슬롯들은 첫 값에서 영영 멈춘다.
  for (const [bindingId, slotIds] of boardMount.realtimeSlotIndex(
    reply.surface_contract, realtimeBindingsOf(envelope),
  )) {
    const bucket = state.realtimeSlots.get(bindingId) || [];
    for (const slotId of slotIds) if (!bucket.includes(slotId)) bucket.push(slotId);
    state.realtimeSlots.set(bindingId, bucket);
  }
  return boardMount
    .mountBoardAsync(host, state.boardId, state.values, boardMountOptions(host, envelope))
    .then((remounted) => rememberMountedBoard(state, remounted));
}

// 마운트 결과에서 실시간 갱신이 쓸 것만 남긴다: 표면 노드와 그 보드의 정적 슬롯 계약.
// 봉투의 surface_contract가 아니라 색인이 가진 마운트 계약이다(slots가 거기에만 있다).
function rememberMountedBoard(state, mounted) {
  if (mounted && mounted.surface) state.surface = mounted.surface;
  state.mountContract = boardTemplateRegistry.contractFor(state.boardId) || null;
  return mounted;
}

function renderBoardSurfaceCard(envelope) {
  const contract = surfaceContractOf(envelope);
  if (!contract || !boardMount) return null;
  const [title, subtitle] = cardTitleAndSubtitle(envelope, '보드');
  const { card, body } = makeCard(
    'board-surface', title, envelope.layout, envelope.correlation,
    subtitle, cardStkCd(envelope), envelope.screen_id,
  );
  card.dataset.semanticPrimary = 'specialized';
  card.dataset.boardId = contract.board_id;
  // 카드 = 보드 그 자체다. Paper 보드가 자기 헤더(제목·기준 시각)·스트립·푸터를
  // 갖고 있고 닫기는 탭 스트립이 맡으므로, 통합 카드 머리를 겹쳐 그리지 않는다.
  // 표시는 integrated-card-surface가 읽어 패널 탭 칩도 만들지 않는다.
  card.dataset.boardSurface = 'true';
  const head = card.querySelector(':scope > .card-head');
  if (head) head.remove();
  stampPaperScreen(card, envelope);
  const host = document.createElement('div');
  host.className = 'board-surface-host';
  // 마운트 전까지 카드 높이가 0이면 페인트 확인(폭·높이 둘 다 0보다 커야 한다)이
  // 카드가 서지 않은 것으로 읽는다. 보드가 서면 뗀다 — 전역 CSS에 두면 마운트를
  // 끝낸 보드의 레이아웃까지 건드린다.
  host.style.minHeight = '120px';
  body.appendChild(host);
  // 카드를 닫으면 보드가 품은 앱 렌더러도 닫는다 — 안 걸면 패널과 그 리스가 남는다.
  // host를 붙잡으므로 상태 보드를 갈아타 패널이 갈려도 "지금 열린 것"을 닫는다.
  cardDestroyers.set(card, () => destroyBoardPrimary(boardStateOf(host)));
  const state = boardStateOf(host);
  // 이 봉투가 보드 자리에 라이브 차트를 얹을 것이면 껍질 단계에서 신원을 찍는다 —
  // paint ack는 껍질이 선 시점의 dataset만 읽는다(beginBoardChartMount 주석).
  // 계약 오류는 여기서 삼키고 마운트가 사유와 함께 드러낸다.
  let chartDescriptor = null;
  if (boardPrimaryRendererOf(envelope) === BOARD_CHART_RENDERER) {
    try { chartDescriptor = boardChartDescriptor(envelope); } catch { chartDescriptor = null; }
  }
  if (chartDescriptor) beginBoardChartMount(card, state, chartDescriptor);
  openBoardSurface(host, contract, envelope).then(() => {
    host.style.minHeight = '';
  }).catch((error) => {
    // 보드가 안 서면 차트도 안 선다 — 첫 ack가 기다리는 결과를 여기서 맺는다.
    settleBoardChartMount(state, 'error');
    // 보드를 못 세우면 범용 카드로 조용히 떨어뜨리지 않는다 — 그건 계약 파생
    // 실패이고, 감추면 사용자는 알 수 없는 표를 본다(paper-card-routing과 같은 판단).
    body.replaceChildren(errorNote(String((error && error.message) || error)));
  });
  return card;
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
  // 보드 표면 카드에는 의미 작업대도 덧대지 않는다 — 카드가 Paper 보드 그 자체라
  // 그 아래에 같은 값을 다시 펴는 시트가 붙으면 "보드와 동일하게 그린다"가
  // 깨진다(upsertDeveloperDiagnostics의 보드 예외와 같은 판단).
  if (!integratedCardSurface.isBoardSurface(root)) semanticWorkspace.upsert(root, envelope);
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
    if (semanticWorkspace && !integratedCardSurface.isBoardSurface(existing)) semanticWorkspace.upsert(existing, envelope);
    decorateRankingPanel(existing, envelope);
    upsertDeveloperDiagnostics(existing, envelope);
    syncIntegratedRealtime(existing, envelope);
    adoptIntoCanvasTab(existing, envelope);
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

  if (semanticWorkspace && !integratedCardSurface.isBoardSurface(root)) semanticWorkspace.upsert(root, envelope);
  decorateRankingPanel(root, envelope, panelKey);
  upsertDeveloperDiagnostics(root, envelope);
  syncIntegratedRealtime(root, envelope);
  // 탭 뷰포트로 옮기는 것은 마지막이다 — 그 전 단계들이 grid 스코프 질의를 쓴다.
  adoptIntoCanvasTab(root, envelope);
  // 개발자 진단 surface를 명시적으로 켠 경우에만 wire occurrence identity를
  // 검사한다. production 제품 UI에는 이 DOM 자체를 만들지 않는다.
  if (developerDiagnosticsEnabled() && root.querySelector('.semantic-detail-row:not([data-field-occurrence-id])')) {
    destroyCard(root);
    throw new Error('통합 카드 field occurrence identity가 누락됐다');
  }
  return root;
}

// 순위 모드 패널 장식 — 축 스트립을 패널 맨 위에 세운다(Paper R01-T4~T6 · R03-T6).
// 축 전환은 카드가 조회를 발명하지 않고 seedChatInput 버스로 질문을 심는다
// ("새 작업은 채팅에서" — 에이전트 동선 규칙과 같은 경로).
function decorateRankingPanel(root, envelope, panelKey) {
  if (!rankingAxis || !root || !envelope || envelope.mode !== 'ranking') return;
  const key = panelKey || integratedCardSurface.panelKeyFor(envelope);
  const panel = Array.from(root.querySelectorAll('.integrated-card-panel'))
    .find((node) => node.__athenaPanelKey === key);
  if (!panel) return;
  panel.classList.add('integrated-card-panel--ranking');
  const existingStrip = panel.querySelector(':scope > .ranking-axis-strip');
  const strip = rankingAxis.renderAxisStrip(envelope, (item) => {
    if (window.AthenaShell && typeof window.AthenaShell.seedChatInput === 'function') {
      window.AthenaShell.seedChatInput(item.question);
    }
  });
  if (!strip) return;
  if (existingStrip) existingStrip.replaceWith(strip);
  else panel.prepend(strip);
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

// 통합 카드는 임시 카드의 body 자식을 root 패널로 옮기고 임시 카드를 지운다. 차트
// 마운트는 그보다 늦게 끝나므로 늦은 기록은 살아 있는 카드를 다시 찾아 써야 한다 —
// 안 그러면 renderState도 오류 문구도 이미 지워진 노드에만 남는다.
function liveChartCard(card, chartBody) {
  const host = chartBody && chartBody.isConnected ? chartBody.closest('.card') : null;
  if (host) return host;
  return card && card.isConnected ? card : null;
}

// panelId별 차트 마운트 결과('data'/'empty'/'error'). 첫 paint ack가 pending으로
// 나간 뒤 후속 ack가 여기서 최종 상태를 기다린다.
const chartMountSettlements = new Map();

async function mountAitsChartPanel(card, chartBody, descriptor, options = {}) {
  // panel identity와 provisional disposer를 await 전에 등록한다. 같은 panel의
  // 동시 reload/dataset 교체가 늦은 mount를 두 번째 renderer로 만들지 못한다.
  card.dataset.chartAuthority = 'AITS';
  card.dataset.rendererId = descriptor.rendererId;
  card.dataset.chartPanelId = descriptor.panelId;
  card.dataset.chartGeneration = String(descriptor.generation);
  descriptor.context.onReloadRequest = async (request) => {
    const active = aitsChartPanels.snapshot().find((candidate) => candidate.panelId === descriptor.panelId);
    if (!active) throw new Error('AITS chart session이 닫혔다');
    let reloadTimer;
    try {
      return await Promise.race([
        window.athena.invoke('athena:reload-chart-panel', {
          panelId: descriptor.panelId,
          generation: active.generation,
          period: request.period,
          interval: request.interval,
          adjusted: request.adjusted,
        }),
        new Promise((_, reject) => {
          reloadTimer = setTimeout(() => reject(new Error('재조회 8초 한도를 넘겼다')), 8000);
        }),
      ]);
    } finally {
      clearTimeout(reloadTimer);
    }
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
  // 보드 카드는 이미 자기 정리자를 갖고 있다(destroyBoardPrimary) — 거기서 덮으면
  // 통합 카드 root의 집계 정리자가 사라진다. 그 경우에만 등록을 건너뛴다.
  if (options.registerCardDestroyer !== false) {
    cardDestroyers.set(card, () => {
      aitsChartPanels.destroyPanel(descriptor.panelId);
      window.athena.send('athena:chart-panel-destroyed', { panelId: descriptor.panelId });
    });
  }
  const session = await aitsChartPanels.openPanel(chartBody, descriptor.body, descriptor.context);
  mountedChartSessions.set(descriptor.panelId, session);
  const mounted = liveChartCard(card, chartBody) || card;
  Object.defineProperty(mounted, '__athenaChartSessionId', {
    value: session.sessionId, configurable: true, writable: true,
  });
  Object.defineProperty(mounted, '__athenaChartTrId', {
    value: session.body.trId, configurable: true, writable: true,
  });
  mounted.dataset.chartGeneration = String(session.generation);
  mounted.dataset.renderState = session.body.candles.length ? 'data' : 'empty';
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
function wireOrderbookRealtime(card, wrap, envelope, applyTick, options = {}) {
  const symbol = resolveEnvelopeSymbol(envelope);
  if (!symbol || typeof applyTick !== 'function') return null;
  orderbookRealtimePanels.openPanel(card, symbol, (tick) => applyTick(wrap, envelope, tick));
  window.athena.send('athena:orderbook-realtime-acquire', { symbol });
  // 해제는 한 번만 나간다 — acquire보다 release가 많으면 main의 REG 셈이 무너져
  // 같은 종목을 보는 남의 카드 피드까지 끊긴다.
  let released = false;
  const release = () => {
    if (released) return false;
    released = true;
    orderbookRealtimePanels.closePanel(card);
    window.athena.send('athena:orderbook-realtime-release', { symbol });
    return true;
  };
  // 보드 카드는 정리자를 renderBoardSurfaceCard가 이미 걸었다(보드 상태가 자리를
  // 닫는다) — 여기서 덮으면 그 정리자를 잃고, 갈아탈 때마다 사슬만 길어진다.
  if (options.registerCardDestroyer === false) return release;
  const priorDestroy = cardDestroyers.get(card);
  cardDestroyers.set(card, () => {
    release();
    if (priorDestroy) priorDestroy();
  });
  return release;
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
  // 첫 피드백 3초 계약 — AITS 라이브러리 로드를 기다리면 paint ack가 마감을
  // 넘긴다. 카드 껍질을 먼저 붙이고 패널은 뒤에서 채운다. 그 사이 상태는
  // 'loading'이다 — 빈 dataset이 paint ack의 'data' 폴백으로 새면 마운트에
  // 실패한 차트가 데이터 카드로 집계된다.
  card.dataset.renderState = 'loading';
  const settled = mountAitsChartPanel(card, chartBody, descriptor).then(
    (session) => (session.body.candles.length ? 'data' : 'empty'),
    (err) => {
      const host = liveChartCard(card, chartBody) || card;
      const hostBody = chartBody.parentElement || body;
      chartBody.remove();
      host.dataset.renderState = 'error';
      delete host.dataset.chartAuthority;
      delete host.dataset.rendererId;
      delete host.dataset.chartPanelId;
      delete host.dataset.chartGeneration;
      delete host.__athenaChartSessionId;
      delete host.__athenaChartTrId;
      hostBody.appendChild(errorNote(`차트를 그리지 못했다 — ${err && err.message ? err.message : String(err)}`));
      return 'error';
    },
  );
  chartMountSettlements.set(descriptor.panelId, settled);
  void settled.then(() => {
    if (chartMountSettlements.get(descriptor.panelId) === settled) chartMountSettlements.delete(descriptor.panelId);
  });
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
  // 탭 뷰포트 카드는 탭이 소유한다 — 카드만 지우면 빈 패널을 가진 탭이 남는다.
  // 탭을 닫으면 덱의 onClose가 destroyCard까지 부르고 마지막 탭이면 덱도 지운다.
  const panel = card && card.parentElement;
  const tabKey = panel && panel.dataset ? panel.dataset.tabKey : null;
  if (tabKey && canvasTabDeck && canvasTabDeck.has(tabKey)) {
    canvasTabDeck.close(tabKey);
    return;
  }
  const destroy = cardDestroyers.get(card);
  if (destroy) {
    try { destroy(); } catch (err) { /* 카드가 이미 언마운트된 경우 등 — 닫기 자체는 막지 않는다 */ }
    cardDestroyers.delete(card);
  }
  // 부모에서 remove → 그리드가 비면 캔버스 접기는 ui-kit.js의
  // removeCard로 settings-cards.js와 공용화했다(포니테일 감사).
  removeCard(card);
  reportSessionCards();
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
  // 탭 뷰포트 카드는 높이 예산 밖이다 — 한 번에 한 장만 보이고 본문은 카드 안에서
  // 세로 스크롤한다(계획 §1). 여기서 세면 모자이크 카드가 도착할 때마다 문서 순서
  // 맨 앞인 탭 카드부터 지워진다.
  let cards = mosaicCards();
  while (
    cards.length > MIN_CARDS &&
    exceedsHeightBudget(grid.scrollHeight, grid.clientHeight, cards.length)
  ) {
    destroyCard(cards[0]);
    cards = mosaicCards();
  }
}

function mosaicCards() {
  return Array.from(grid.querySelectorAll('.card'))
    .filter((card) => !card.closest('.canvas-tab-deck'));
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

// 성향 신호 전체 캐시(창 안 전량) — 지도의 노드 채움과 패널의 관계 목록이 읽는다.
// 요약 표의 "상위 5"(graphSummaryTable.getEntries())와는 다른 목록이다.
let lastProfileSignals = [];

// 테마 군집 수 — 히어로 부제("테마 군집 7개")가 읽는다. loadThemeClusters()가 채운다.
let lastThemeClusterCount = 0;

// 숨은 연관(surprising-connections) 캐시(스텝14) — loadHiddenLinks()(아래, 보드
// 06/07 §9 카드용으로 이미 있던 fetch)가 채우고 graphMode.draw()/노드 선택이
// 재사용한다. 이중 fetch 금지(스텝11 보고에 대한 리드 지침) — 그래프 지도의
// 핑크 점선·컨텍스트 패널의 "숨은" 관계 행 전부 이 한 번의 fetch에서 나온다.
let lastSurprisingConnections = [];

// 그래프 화면의 CTA가 채팅에 시작 문장을 심는 공용 다리(2026-09-02).
//
// 보드 43 "새 작업은 채팅에서" 원칙의 seedChatInput 버스를 그대로 쓴다 —
// lib/agent-canvas.js의 "＋ 새 작업 · 채팅에서"와 같은 경로다. **보내지는 않는다**:
// 사람이 문장을 읽고 고친 뒤 Enter를 누른다.
//
// 그래프 모드에서는 이 문장이 곧 모델의 입력이 되고, 모델은 live-prompt.js의
// 그래프 접두로 화면 상태까지 함께 받는다 — 그래서 "확인이 필요한 것 3건"처럼
// 화면에만 있던 숫자를 채팅이 그대로 이어받는다.
function seedGraphChat(text) {
  if (window.AthenaShell && typeof window.AthenaShell.seedChatInput === 'function') {
    window.AthenaShell.seedChatInput(text);
    return true;
  }
  // 버스가 없으면(단독 로드 등) 최소한 입력창으로 데려간다 — 옛 동작.
  const inputEl = document.getElementById('input');
  if (inputEl) inputEl.focus();
  return false;
}

const graphMode = window.AthenaLib.GraphModeController.createGraphModeController({
  store: window.AthenaLib.GraphModeStore,
  grouping: window.AthenaLib.ClusterGrouping,
  prefs: window.AthenaLib.GraphModePrefs,
  // 라이브 군집 지도(2026-09-02) — 헤더의 "움직이는 그래프" 토글이 켤 때만
  // 실제로 만들어진다. vis-network가 없으면(vendoring 실패) 조용히 꺼진다.
  createLiveMap: window.AthenaLib.GraphLiveMap
    ? window.AthenaLib.GraphLiveMap.createLiveMap
    : undefined,
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
    // 모드별 채팅 헤더(보드 38 개정) — 그래프·백테스트 모드에서 보인다. 제목·부제
    // 문구는 graphMode.applyVisibility()가 모드별로 바꾼다.
    chatHead: document.getElementById('chatModeHead'),
    chatHeadTitle: document.querySelector('#chatModeHead .chat-mode-head-title'),
    chatHeadSub: document.querySelector('#chatModeHead .chat-mode-head-sub'),
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
    // 세 번째 서브뷰(보드 05 수집·노출) — 요약 표·군집 지도와 같은 축이라
    // 가시성도 같은 함수가 소유한다.
    graphSettings: document.getElementById('graphSettingsCanvas'),
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
  // 공통 패널 CTA(2026-09-02) — 배너 CTA와 같은 이유로 실제 질문을 심는다.
  // 문구는 패널의 리드인과 같은 축이다: 숨은 연관이면 "왜 이어졌나", 체결·잔고와
  // 대화가 어긋나면 "어느 쪽이 실제인가".
  //
  // 문장은 짧고 사람 말이어야 한다(2026-09-03 사용자 지적 "문장이 너무 길고
  // 기계적이다"). 두 가지를 걷어냈다:
  //   ① 모델 지시문 꼬리("사실과 추론을 구분해서", "근거가 약하면 그렇다고 말해줘").
  //      사람이 자기 입으로 그렇게 쓰지 않는다. 그리고 그 지시는 이미 그래프 접두가
  //      하고 있다(live-prompt.js) — 여기서 또 쓰면 두 벌이다.
  //   ② 주격 조사. target은 `"삼성화재"`처럼 따옴표로 싸여 있어서 `${target}이`가
  //      **"삼성화재"이**로 렌더됐다(받침 판정이 닿는 마지막 글자가 따옴표다).
  //      이름 뒤에 줄표를 두면 조사가 아예 필요 없고 채팅 말투로도 자연스럽다.
  onPanelCta: (ask) => {
    const name = ask && ask.name ? String(ask.name) : null;
    const target = name ? `"${name}"` : '지금 고른 것';
    if (ask && ask.kind === 'hidden') {
      seedGraphChat(`${target} — 왜 다른 군집과 이어졌어?`);
      return;
    }
    if (ask && ask.kind === 'conflict') {
      seedGraphChat(`${target} — 체결과 대화가 왜 다르게 나와?`);
      return;
    }
    seedGraphChat(`${target} — 그래프가 뭘 알고 있어?`);
  },
  // 스텝14 — 스텝11(숨은 연관 군집 쌍)·13(숨은 연관 엔티티 쌍)의 실배선. 위
  // lastSurprisingConnections 캐시를 그대로 읽는다(이중 fetch 없음).
  getSurprisingConnections: () => lastSurprisingConnections,
  // 지도·패널이 읽는 성향 신호는 표의 "상위 5"가 아니라 **창 전체**여야 한다.
  // 표가 받아 둔 5건만 주면 지도의 노드 채움(확정성 인코딩)이 다섯 노드 빼고
  // 전부 "모름"으로 떨어지고, 패널의 관계 목록도 상위 5에 든 엔티티에서만 뜬다
  // (실측: 9개 노드가 전부 테두리만 남았다). 그래서 별도 전체 캐시를 둔다 —
  // 표와 다른 limit이라 같은 fetch를 나눠 쓸 수 없다.
  getProfileSummaryEntries: () => lastProfileSignals,
  // §10-4 최근 변화(엔티티 타임라인, WP-G) — cluster-map처럼 부팅 시 1회
  // 캐시하는 패턴을 못 쓴다(entity_id별 호출당 API). 실패는 예외로 알린다 —
  // fetchClusterMap과 같은 이유({ok:false}가 정상 응답으로 흐르면 안 된다).
  fetchEntityTimeline: async (entityId) => {
    const res = await window.athena.invoke('athena:brain-entity-timeline', { entityId });
    if (!res || !res.ok) throw new Error((res && res.error) || '엔티티 타임라인을 받지 못했다');
    return res.events;
  },
  // 보드 05 수집·노출 — 탭에 들어올 때마다 다시 그린다(설정 오버레이가 같은
  // 저장소를 보는 두 번째 입구라, 거기서 바꾸고 돌아왔을 수 있다).
  // 패널 관계 목록의 삭제 손잡이(Paper 보드 04, 2026-09-03) — 화면에서 바로 고치는
  // 입구다. 확정 카드와 **같은 백엔드 입구**를 쓴다(athena:brain-retract-relation):
  // 두 화면이 다른 경로로 지우면 한쪽만 이력을 남기거나 한쪽만 리비전을 올리는
  // 어긋남이 생긴다. 여기서는 relation_id를 모르므로 (출발·도착·관계) 삼중을 넘기고
  // 백엔드가 id를 계산한다(그 해시를 렌더러에서 다시 구현하면 두 벌이 된다).
  onRelationDelete: async (target) => {
    let res = null;
    try {
      res = await window.athena.invoke('athena:brain-retract-relation', {
        subjectId: target.subjectId,
        objectId: target.objectId,
        kind: target.kind,
      });
    } catch (err) {
      console.warn('[graph-mode] 관계 삭제 실패', err);
      return;
    }
    // 실패를 조용히 넘기지 않는다 — 사람은 지웠다고 믿고 화면을 떠난다(§0 정직성).
    // 성공하면 main이 athena:brain-graph-updated를 쏘아 화면 전체가 다시 읽힌다.
    if (!res || !res.ok || res.removed === false) {
      console.warn('[graph-mode] 관계 삭제 반영 안 됨', res);
    }
  },
  onEnterSettings: () => renderGraphCollectionSettings(),
  // 헤더 필터 칩(보드 03/04) — 기간·최소 연결 수를 배치 전에 건다.
  filters: window.AthenaLib.GraphFilters,
  getFilters: () => window.AthenaLib.GraphModePrefs.readPrefs(),
});
window.AthenaCanvasMode = graphMode;

// ---------- 그래프 워크스페이스(42번 보드 "환경 전체가 저장된다") ----------
// 그래프 화면의 상태 가운데 공개 API로 되돌릴 수 있는 것 — 서브뷰(요약/지도/설정)와
// 고른 노드 — 를 세션에 남긴다. 컨트롤러는 변경 이벤트를 내지 않으므로 그래프 화면이
// 보이는 동안 1초마다 상태를 읽어 바뀐 조각만 보고한다. 되돌릴 수 없는 것(펼친 군집)은
// 저장하지 않는다 — 있다고 저장하고 못 돌리는 편이 더 나쁘다.
(function registerGraphWorkspace() {
  const bus = window.AthenaSessionWorkspace;
  if (!bus) return;
  const snapshotOf = () => {
    const s = graphMode.state || {};
    return { surface: s.surface || null, selectedEntityId: s.selectedEntityId || null };
  };
  let lastReported = null;
  setInterval(() => {
    if (!graphMode.state || graphMode.state.view !== 'graph') return;
    const key = JSON.stringify(snapshotOf());
    if (key === lastReported) return;
    lastReported = key;
    bus.report({ graph: JSON.parse(key) });
  }, 1000);
  bus.register('graph', {
    async restore(workspace) {
      const g = workspace && workspace.graph;
      if (!g) return;
      lastReported = JSON.stringify({ surface: g.surface || null, selectedEntityId: g.selectedEntityId || null });
      if (g.surface) await graphMode.setSurface(g.surface);
      if (g.selectedEntityId) graphMode.selectNode(g.selectedEntityId);
    },
  });
})();
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
const pluginCatalog = window.AthenaLib.PluginCatalog;

// 마켓플레이스 on/off는 "추천에 이 카탈로그를 보여줄까"만 정한다 — 레지스트리를
// 건드리지 않으므로 앱 로컬 설정으로 충분하다. 끄면 추천이 비고, 이미 설치한
// 서버는 그대로 남는다(끄기가 삭제로 읽히면 안 된다).
const PLUGIN_MARKETPLACE_PREFS_KEY = 'athena.plugin.marketplaces';

function readMarketplacePrefs() {
  try {
    const raw = window.localStorage.getItem(PLUGIN_MARKETPLACE_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function writeMarketplacePref(id, enabled) {
  try {
    const prefs = readMarketplacePrefs();
    prefs[id] = !!enabled;
    window.localStorage.setItem(PLUGIN_MARKETPLACE_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

function pluginMarketplaceRows() {
  const prefs = readMarketplacePrefs();
  return pluginCatalog.MARKETPLACES.map((marketplace) => ({
    id: marketplace.id,
    name: marketplace.name,
    description: marketplace.description,
    enabled: prefs[marketplace.id] !== false,
  }));
}

// 제안 봉투의 조립·모드 판정은 순수 모듈이 한다. 이 파일은 IPC만 잇는다.
const pluginProposal = window.AthenaLib.PluginProposal;
const pluginModeAdapter = window.AthenaLib.PluginModeAdapter;
// athena:mcp-list가 준 가장 최근 판번호. 아직 못 받았으면 null이고, 그때는
// 만료 판정을 하지 않는다(모르는 것을 낡았다고 말하지 않는다).
let pluginRevision = null;
// 화면에 떠 있는 미해결 봉투. pending 복원과 GUI·모델 제안이 함께 쌓인다.
const pluginProposals = [];

const pluginCanvas = window.AthenaLib.PluginCanvas.createPluginCanvas({
  container: document.getElementById('pluginCanvas'),
  // 실제 목록이 도착하기 전에도 샘플 폴백을 타지 않도록 항상 명시적으로 넘긴다.
  installed: [],
  recommended: [],
  marketplaces: [],
  onPermission: (plugin) => { void pluginProbe(plugin && plugin.id); },
  onManage: () => { void pluginRefresh(); },
  onToggleMarketplace: (marketplace, enabled) => pluginSetMarketplaceEnabled(marketplace && marketplace.id, enabled),
  // GUI 진입 6종(설치·허용·철회·켜기끄기·삭제·직접 등록)이 전부 여기로 합류한다.
  // 버튼은 봉투를 만들 뿐이고, athena:mcp-*를 부르는 실행은 승인 하나뿐이다.
  onPropose: (spec, reason) => { mountPluginProposal(buildGuiProposal(spec, reason)); },
  onApproveProposal: (envelope) => pluginDecide('athena:plugin-approve', envelope, { fromCard: true }),
  onRejectProposal: (envelope) => pluginDecide('athena:plugin-reject', envelope, { fromCard: true }),
  // 만료 카드를 지우는 것은 거부가 아니다 — 대기 목록에서만 빼고 채팅에는 알리지 않는다.
  onDismissProposal: (envelope) => { void pluginForgetProposal(envelope); },
  // 감사 로그는 읽기만 한다 — 실행 경로가 아니라서 승인 카드를 거치지 않는다.
  onAuditLog: () => pluginAuditLog(),
});
pluginCanvas.mount();

// 모드 재진입마다 미해결 제안을 되살린다. 사이드바(lib/sidebar.js)는 진입할 때
// setView('hub')만 부르므로 복원 훅의 거처는 이 래퍼다 — 사이드바는 만지지 않는다.
// plugin-canvas.js는 IPC를 모른다: invoke는 여기서 하고 결과만 setProposals로 넣는다.
window.AthenaPluginCanvas = {
  ...pluginCanvas,
  setView(view) {
    pluginCanvas.setView(view);
    void pluginRestorePending();
  },
};

// 감사 로그 조회. 실패 원문은 IPC 내부 문구라 화면에 올리지 않는다 — 사람이
// 읽을 한 줄로 바꿔 던지고, 카드가 그 줄과 '다시 확인'을 함께 보여준다.
async function pluginAuditLog() {
  try {
    return await window.athena.invoke('athena:mcp-audit');
  } catch {
    throw new Error('등록 목록을 확인하지 못했습니다');
  }
}

function buildGuiProposal(spec, reason) {
  return Array.isArray(spec)
    ? pluginProposal.buildBatchProposal(spec, reason, pluginRevision, 'gui')
    : pluginProposal.buildProposal(spec, reason, pluginRevision, 'gui');
}

// 모델 경로와 GUI 경로가 만나는 단 하나의 문. 모드 밖이면 봉투를 버린다 —
// 카드도 그리지 않고 대기 목록에도 넣지 않는다(보관했다 부활시키지 않는다).
// 채팅이 한 줄로 알릴 수 있게 렌더러 안에서만 신호를 낸다.
function mountPluginProposal(envelope) {
  if (!envelope) return false;
  // 모양이 어긋난 봉투는 그리지도, 대기 등록하지도 않는다 — 반쪽 카드를 세우면
  // 승인 버튼이 메인에서 거부될 것을 화면만 제안으로 그린다.
  if (!pluginProposal.validateProposal(envelope).ok) return false;
  if (pluginModeAdapter.currentMode() !== 'plugin') {
    window.dispatchEvent(new CustomEvent('athena:plugin-out-of-mode', { detail: { envelope } }));
    return false;
  }
  // 같은 번호가 다시 오면 앞의 카드(처리된 것일 수 있다)를 빼고 새 봉투로 건다.
  dropPluginProposal(envelope);
  pluginProposals.push(envelope);
  pluginCanvas.setProposals(pluginProposals, { revision: pluginRevision });
  // 대기 등록은 카드를 그린 뒤의 단방향 통보 하나뿐이다(응답을 기다리지 않는다).
  window.athena.send('athena:plugin-noted', envelope);
  return true;
}

// 모델 제안은 턴 밖에서도 살아 있어야 한다 — 모듈 스코프 구독이다(턴 스코프
// 형판을 여기 복제하면 턴이 끝나는 순간 카드가 사라진다).
window.athena.on('athena:plugin-proposed', (envelope) => { mountPluginProposal(envelope); });

function dropPluginProposal(envelope) {
  const index = pluginProposals.findIndex((row) => row.proposal_id === envelope.proposal_id);
  if (index >= 0) pluginProposals.splice(index, 1);
}

// 같은 봉투의 사본으로 갈아 끼운다 — plugin-canvas는 봉투가 바뀌면 그 카드의
// 처리 결과를 지우고 다시 대기로 그린다.
function pluginRearmProposal(envelope) {
  const index = pluginProposals.findIndex((row) => row.proposal_id === envelope.proposal_id);
  if (index < 0) return;
  pluginProposals[index] = { ...envelope };
  pluginCanvas.setProposals(pluginProposals, { revision: pluginRevision });
}

async function pluginForgetProposal(envelope) {
  dropPluginProposal(envelope);
  try {
    await window.athena.invoke('athena:plugin-reject', envelope);
  } catch (err) {
    console.warn('athena:plugin-reject 실패', err);
  }
}

// 사람의 클릭 하나가 유일한 실행 지점이다. 결과는 카드(반환값)와 채팅(이벤트)
// 두 곳으로 간다 — 채널을 새로 만들지 않고 같은 자리의 CustomEvent를 쓴다.
// 처리된 카드는 남는다 — 승인됨·실패·거부됨을 사람이 읽을 자리다. 목록에서 빼는
// 것은 모드 재진입(pluginRestorePending)·재등록·`다시 제안받기` 세 지점뿐이다.
async function pluginDecide(channel, envelope, options) {
  // 채팅 결과 턴의 `다시 시도`는 카드 밖에서 같은 봉투를 다시 보낸다 — 실패로
  // 굳은 카드를 사본으로 갈아 끼워 대기 상태로 되돌린다(카드 버튼 경로는 카드가
  // 스스로 처리 중·결과를 그리므로 건드리지 않는다).
  if (!(options && options.fromCard)) pluginRearmProposal(envelope);
  let result;
  try {
    result = await window.athena.invoke(channel, envelope);
  } catch (err) {
    result = { ok: false, kind: 'failed', reason: String((err && err.message) || err) };
  }
  const kind = (result && result.kind) || 'failed';
  if (result && typeof result.revision === 'number') pluginRevision = result.revision;
  if (kind === 'success') {
    pluginRegistryChangedThisSession = true;
    await pluginRefresh();
  }
  // 남은 카드의 만료 판정이 새 판번호를 쓰게 한다 — 방금 승인이 목록을
  // 바꿨으면 옆 카드는 이미 낡았다.
  pluginCanvas.setProposals(pluginProposals, { revision: pluginRevision });
  window.dispatchEvent(new CustomEvent('athena:plugin-result', { detail: { kind, envelope, result } }));
  return result;
}

async function pluginRestorePending() {
  let pending;
  try {
    pending = await window.athena.invoke('athena:plugin-pending');
  } catch (err) {
    console.warn('athena:plugin-pending 실패', err);
    return;
  }
  if (pending && typeof pending.revision === 'number') pluginRevision = pending.revision;
  // 처리된 카드는 여기서 사라진다 — 메인의 미해결 목록에 없기 때문이다.
  pluginProposals.length = 0;
  pluginProposals.push(...((pending && Array.isArray(pending.proposals)) ? pending.proposals : []));
  pluginCanvas.setProposals(pluginProposals, { revision: pluginRevision });
}

// probe는 실제 upstream 서버를 spawn한다(mcp-cli.js probe 주석) — 목록을 새로고칠
// 때마다 등록된 서버를 전부 띄우지 않는다. 권한 화면을 연 그 서버만 한 번 띄우고
// 결과를 캐시한다.
const pluginToolCache = new Map();
// probe 실패 사유. console.warn으로만 흘리면 화면에는 "기능 0개"만 남아서
// 사용자가 이유를 알 수 없다(2026-09-01 전수검사에서 확인한 결함).
const pluginProbeErrors = new Map();

function pluginHealthLabel(server) {
  if (!server.approved) return '꺼짐 — 대화에서 쓰이지 않습니다';
  if (server.health === 'ok') return '연결 확인됨';
  if (server.health === 'warning') return '연결됨 · 인코딩 경고';
  // probe를 한 번도 안 한 상태다. 임의로 "정상"이라고 쓰지 않는다.
  return '연결 미확인 — 권한 화면을 열면 확인한다';
}

function pluginRowFromServer(server) {
  const tools = pluginToolCache.get(server.alias) || null;
  // 카탈로그에서 설치한 서버는 사람이 읽는 이름을 되돌려준다. 모르는 별칭에는
  // 이름을 지어내지 않고 별칭 그대로 쓴다(BETA-017의 가짜 이름 재발 방지).
  const catalogEntry = pluginCatalog.findEntry(server.alias);
  return {
    id: server.alias,
    name: catalogEntry ? catalogEntry.name : server.alias,
    description: catalogEntry
      ? catalogEntry.description
      : [server.command, server.argsPreview].filter(Boolean).join(' '),
    source: pluginHealthLabel(server),
    enabled: !!server.approved,
    // probe 전에는 consent.json이 아는 허용 도구 수만 안다 — 그 수를 그대로 쓴다.
    featureCount: tools ? tools.length : server.toolCount,
    features: tools || [],
    error: pluginProbeErrors.get(server.alias) || null,
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
    // 목록과 함께 오는 판번호가 GUI 제안의 만료 기준이다(R-4).
    if (res && typeof res.revision === 'number') pluginRevision = res.revision;
    const marketplaces = pluginMarketplaceRows();
    const enabledMarketplaceIds = marketplaces.filter((m) => m.enabled).map((m) => m.id);
    pluginCanvas.setData({
      installed: servers.map(pluginRowFromServer),
      recommended: pluginCatalog.recommendedFor(servers.map((s) => s.alias), enabledMarketplaceIds),
      marketplaces,
      restartRequired: pluginRegistryChangedThisSession,
    });
    // 채팅의 @멘션 목록과 키우미 메뉴가 같은 레지스트리를 본다 — 여기서만
    // 알리고, 그쪽은 이 신호로 캐시를 버린다(양쪽이 각자 폴링하지 않는다).
    window.dispatchEvent(new CustomEvent('athena:plugins-changed', { detail: { servers } }));
    // 목록이 바뀌면 떠 있는 카드의 만료 판정도 함께 갱신된다.
    pluginCanvas.setProposals(pluginProposals, { revision: pluginRevision });
  } catch (err) {
    console.warn('athena:mcp-list 실패', err);
  }
}

async function pluginProbe(alias) {
  if (!alias) return;
  try {
    const res = await window.athena.invoke('athena:mcp-probe', { alias });
    if (!res || !res.ok || !Array.isArray(res.tools)) {
      pluginProbeErrors.set(alias, (res && res.error) || '도구 목록을 받지 못했습니다');
      await pluginRefresh();
      return;
    }
    pluginProbeErrors.delete(alias);
    pluginToolCache.set(alias, res.tools.map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description || '',
      allowed: !!tool.allowed,
    })));
    await pluginRefresh();
  } catch (err) {
    pluginProbeErrors.set(alias, String((err && err.message) || err));
    await pluginRefresh();
  }
}

async function pluginSetMarketplaceEnabled(id, enabled) {
  if (!id) return { ok: false, error: '대상 마켓플레이스를 찾지 못했습니다' };
  if (!writeMarketplacePref(id, enabled)) {
    return { ok: false, error: '설정을 저장하지 못했습니다' };
  }
  await pluginRefresh();
  return { ok: true };
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
  // status 0 = 연결 자체가 안 됐다. Node fetch는 이때 "fetch failed" 열두 글자만
  // 던지는데, 그 문구로는 사용자가 무엇을 해야 할지 알 수 없다 — 백엔드를 안 띄운
  // 것이 원인의 거의 전부다(2026-09-01 probe-backtest-mode 실측으로 잡았다).
  if (res && res.status === 0) return `백엔드에 연결하지 못했습니다 — 백엔드가 떠 있는지 확인하세요 (${raw})`;
  if (res && res.status === 503) return `백테스트 기능이 꺼져 있습니다 — 백엔드에서 ATHENA_BACKTEST_ENABLED를 켜야 합니다 (${raw})`;
  if (res && res.status === 404) return `백엔드에 백테스트 경로가 없습니다 — 백엔드가 이 브랜치 버전인지 확인하세요 (${raw})`;
  return raw;
}

// 프로젝트 라우트의 실패 문구 — 백엔드가 이미 한국어 문장으로 답하므로(경로 탈출·비 .py·
// 이름 충돌) 그 문장을 덮어쓰지 않는다. 백엔드가 아예 없을 때만 할 일을 알려준다.
function projectError(res, fallback) {
  const raw = (res && res.error) || fallback;
  if (res && res.status === 0) return `백엔드에 연결하지 못했습니다 — 백엔드가 떠 있는지 확인하세요 (${raw})`;
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
  run: async ({ yaml, params, allow_partial, source, project_id } = {}) => {
    const body = { yaml };
    if (params !== undefined) body.params = params;
    // 코드 경로 실행 — 캔버스가 실을 때만 붙는다. 이걸 빠뜨리면 백엔드는 source가
    // 없다고 보고 폼(yaml)으로 돌아, 사람이 고른 코드가 조용히 안 돈다.
    if (source) body.source = source;
    // 어느 폴더의 코드인가 — 백엔드가 그 폴더의 가상환경으로 돌린다(코드 경로에서만
    // 읽힌다). 빠뜨리면 사용자가 자기 폴더에 깐 패키지를 코드가 import하지 못한다.
    if (project_id) body.project_id = project_id;
    // 보유 구간만으로 실행(Paper 보드 04) — 휴장일을 from으로 준 경우의 영구 409
    // (계획서 §11-9)에서 빠져나오는 유일한 출구다. 사람이 그 버튼을 눌렀을 때만 붙는다.
    if (allow_partial) body.allow_partial = true;
    const res = await window.athena.invoke('athena:backtest-run', body);
    if (res && res.ok) {
      const runId = res.data && res.data.run_id;
      if (!runId) throw new Error('run_id를 받지 못했습니다');
      // 백엔드가 매 실행마다 남기는 전략·버전 id — 파일로 한 번 돌린 뒤 곧바로 배포로
      // 넘어가려면 화면이 "방금 그 실행이 어느 버전이었는가"를 알아야 한다.
      return {
        blocked: false,
        run_id: runId,
        partial: res.data.partial || null,
        strategy_id: res.data.strategy_id || null,
        version_id: res.data.version_id || null,
      };
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
  // 2026-09-01 전수 파리티 — Paper 보드 02·05·06·07·08·09.
  validate: async (body) => {
    const res = await window.athena.invoke('athena:backtest-validate', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '검증에 실패했습니다'));
    return res.data;
  },
  coverage: async (params) => {
    const res = await window.athena.invoke('athena:backtest-coverage', params);
    if (!res || !res.ok) throw new Error(backtestError(res, '캐시 상태를 불러오지 못했습니다'));
    return res.data;
  },
  // 흐름 지도(2026-09-03) — 설계의 첫 표면이다. 폼이든 코드든 같은 라우트로 간다.
  map: async (body) => {
    const res = await window.athena.invoke('athena:backtest-map', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '흐름 지도를 만들지 못했습니다'));
    return res.data;
  },
  // 지도 뒤의 코드를 만든다 — 사람이 [코드 열기]를 눌렀을 때만 부른다(저장은 하지 않는다).
  codegen: async (body) => {
    const res = await window.athena.invoke('athena:backtest-codegen', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '지도 뒤의 코드를 만들지 못했습니다'));
    return res.data;
  },
  // 새 기법 만들기(2026-09-03, 보드 20·21) — 코드 한 덩이를 두 가지로 읽는 둘.
  // 노드는 그 기법 파이썬의 함수 한 단위이고(범용 팔레트가 아니다), 검사는 차단 5(문법·계약·시험 실행·룩어헤드·워밍업)다. 라우트가 없는 백엔드(404)는 캔버스가 그대로 본다.
  techniqueNodes: async (body) => {
    const res = await window.athena.invoke('athena:backtest-technique-nodes', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '코드를 노드로 읽지 못했습니다'));
    return res.data;
  },
  techniqueCheck: async (body) => {
    const res = await window.athena.invoke('athena:backtest-technique-check', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '검사를 돌리지 못했습니다'));
    return res.data;
  },
  // 시각 설계 ↔ 코드 왕복(2026-09-03, US-007/008/009) — 지도 탭이 편집 가능해지는 자리.
  // 위 map/codegen과 같은 봉투 규칙이다. 라우트가 없는 백엔드(404)를 만나면 캔버스가 그
  // 실패를 한 번 보고 지도를 읽기 전용으로 접는다 — 여기서 감추면 화면이 이유를 못 댄다.
  visualRegistry: async () => {
    const res = await window.athena.invoke('athena:backtest-visual-registry');
    if (!res || !res.ok) throw new Error(backtestError(res, '노드 목록을 불러오지 못했습니다'));
    return res.data;
  },
  visualValidate: async (body) => {
    const res = await window.athena.invoke('athena:backtest-visual-validate', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '그래프를 검증하지 못했습니다'));
    return res.data;
  },
  visualCompile: async (body) => {
    const res = await window.athena.invoke('athena:backtest-visual-compile', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '그래프를 코드로 옮기지 못했습니다'));
    return res.data;
  },
  visualQuestion: async (body) => {
    const res = await window.athena.invoke('athena:backtest-visual-question', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '무엇을 물을지 정하지 못했습니다'));
    return res.data;
  },
  visualPatch: async (body) => {
    const res = await window.athena.invoke('athena:backtest-visual-patch', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '수정안을 만들지 못했습니다'));
    return res.data;
  },
  visualFromSpec: async (body) => {
    const res = await window.athena.invoke('athena:backtest-visual-from-spec', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '폼을 그래프로 옮기지 못했습니다'));
    return res.data;
  },
  // 저장만 status를 살려 던진다 — 409(그 사이 다른 수정이 먼저 저장됐다)는 실패가 아니라
  // "다시 검토"라는 다음 행동이고, 캔버스가 그 둘을 문구가 아니라 상태 코드로 갈라야 한다.
  visualSave: async (body) => {
    const res = await window.athena.invoke('athena:backtest-visual-save', body);
    if (res && res.ok) return res.data;
    const error = new Error(backtestError(res, '시각 버전을 저장하지 못했습니다'));
    error.status = res ? res.status : 0;
    throw error;
  },
  diagnose: async (body) => {
    const res = await window.athena.invoke('athena:backtest-diagnose', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '오류를 진단하지 못했습니다'));
    return res.data;
  },
  // 409(캐시 부족)를 실패로 던지지 않는 것은 run과 같은 이유다 — 실행하지 않았다는
  // 사실을 알려야지, 실패했다고 말하면 안 된다.
  optimize: async (body) => {
    const res = await window.athena.invoke('athena:backtest-optimize', body);
    if (res && res.ok) return res.data;
    if (res && res.status === 409 && res.detail) {
      throw new Error(
        `캐시가 부족해 탐색하지 않았습니다 — ${res.detail.needed_pages}페이지를 먼저 수집하세요`,
      );
    }
    throw new Error(backtestError(res, '최적화에 실패했습니다'));
  },
  createStrategy: async (body) => {
    const res = await window.athena.invoke('athena:backtest-strategy-create', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '전략을 저장하지 못했습니다'));
    return res.data;
  },
  addVersion: async (strategyId, body) => {
    const res = await window.athena.invoke(
      'athena:backtest-version-add', Object.assign({ strategy_id: strategyId }, body),
    );
    if (!res || !res.ok) throw new Error(backtestError(res, '버전을 저장하지 못했습니다'));
    return res.data;
  },
  versions: async (strategyId) => {
    const res = await window.athena.invoke('athena:backtest-versions', { strategy_id: strategyId });
    if (!res || !res.ok) throw new Error(backtestError(res, '버전 목록을 불러오지 못했습니다'));
    return (res.data && Array.isArray(res.data.versions)) ? res.data.versions : [];
  },
  versionDetail: async (strategyId, versionId) => {
    const res = await window.athena.invoke(
      'athena:backtest-version-detail', { strategy_id: strategyId, version_id: versionId },
    );
    if (!res || !res.ok) throw new Error(backtestError(res, '버전을 다시 열지 못했습니다'));
    return res.data;
  },
  // 사람 클릭 전용 — 모델의 MCP 툴에는 이 액션이 없다(§7.3).
  activate: async (strategyId, versionId) => {
    const res = await window.athena.invoke(
      'athena:backtest-activate', { strategy_id: strategyId, version_id: versionId },
    );
    if (!res || !res.ok) throw new Error(backtestError(res, '버전을 활성화하지 못했습니다'));
    return res.data;
  },
  deployments: async () => {
    const res = await window.athena.invoke('athena:backtest-deployments');
    if (!res || !res.ok) throw new Error(backtestError(res, '배포 목록을 불러오지 못했습니다'));
    return (res.data && Array.isArray(res.data.deployments)) ? res.data.deployments : [];
  },
  // 사람 클릭 전용 — 돈이 나가는 경로의 스위치다.
  createDeployment: async (body) => {
    const res = await window.athena.invoke('athena:backtest-deployment-create', body);
    if (!res || !res.ok) throw new Error(backtestError(res, '배포를 만들지 못했습니다'));
    return res.data;
  },
  stopDeployment: async (deploymentId) => {
    const res = await window.athena.invoke(
      'athena:backtest-deployment-stop', { deployment_id: deploymentId },
    );
    if (!res || !res.ok) throw new Error(backtestError(res, '배포를 중지하지 못했습니다'));
    return res.data;
  },
  // 자동 주문 무장 — 사람이 스위치를 누를 때만 불린다. 멈춘 배포면 백엔드가 409를
  // 주고, 화면이 그 이유를 적는다(조용히 켜진 척하지 않는다).
  armDeployment: async (deploymentId, armed) => {
    const res = await window.athena.invoke(
      'athena:backtest-deployment-arm', { deployment_id: deploymentId, armed: armed === true },
    );
    if (!res || !res.ok) throw new Error(backtestError(res, '무장 상태를 바꾸지 못했습니다'));
    return res.data;
  },
  signals: async (deploymentId) => {
    const res = await window.athena.invoke(
      'athena:backtest-signals', { deployment_id: deploymentId },
    );
    if (!res || !res.ok) throw new Error(backtestError(res, '신호 이력을 불러오지 못했습니다'));
    return (res.data && Array.isArray(res.data.signals)) ? res.data.signals : [];
  },
  // 내 전략 등록부(2026-09-02) — 내 폴더의 .py 하나가 프리셋과 같은 자리에 선다.
  // 등록·해제는 사람이 누르는 버튼이고(모델에게는 등록만 있다), 목록은 설계 폼이 읽는다.
  userStrategies: async () => {
    const res = await window.athena.invoke('athena:backtest-user-strategies');
    if (!res || !res.ok) throw new Error(backtestError(res, '내 전략 목록을 불러오지 못했습니다'));
    return (res.data && Array.isArray(res.data.strategies)) ? res.data.strategies : [];
  },
  registerUserStrategy: async (body) => {
    const res = await window.athena.invoke('athena:backtest-user-strategy-register', body);
    if (!res || !res.ok) throw new Error(projectError(res, '내 전략으로 등록하지 못했습니다'));
    return res.data;
  },
  unregisterUserStrategy: async (strategyId) => {
    const res = await window.athena.invoke(
      'athena:backtest-user-strategy-unregister', { strategy_id: strategyId },
    );
    if (!res || !res.ok) throw new Error(projectError(res, '등록을 지우지 못했습니다'));
    return res.data;
  },
  // 프로젝트 가상환경 — 만들기는 202+job_id라 진행은 위 status(잡 라우트)가 이어 본다.
  projectEnv: async (projectId) => {
    const res = await window.athena.invoke('athena:project-env-get', { project_id: projectId });
    if (!res || !res.ok) throw new Error(projectError(res, '환경 상태를 불러오지 못했습니다'));
    return res.data;
  },
  createProjectEnv: async (projectId, packages) => {
    const res = await window.athena.invoke(
      'athena:project-env-create', { project_id: projectId, packages },
    );
    if (!res || !res.ok) throw new Error(projectError(res, '환경을 만들지 못했습니다'));
    return res.data;
  },
  // 프로젝트 파일 IDE(2026-09-02, 코드 탭) — 봉투를 벗기는 규칙은 위 백테스트 배선과 같다.
  // 실패 문구만 다르다: 백엔드가 이미 사람이 읽을 한국어 detail로 답하므로(400/409/415)
  // 그것을 그대로 올리고, 백엔드가 아예 없을 때(status 0)만 할 일을 알려준다.
  listProjects: async () => {
    const res = await window.athena.invoke('athena:project-list');
    if (!res || !res.ok) throw new Error(projectError(res, '프로젝트 목록을 불러오지 못했습니다'));
    return res.data;
  },
  createProject: async (name) => {
    const res = await window.athena.invoke('athena:project-create', { name });
    if (!res || !res.ok) throw new Error(projectError(res, '프로젝트를 만들지 못했습니다'));
    return res.data;
  },
  // 폴더는 사람이 네이티브 창에서 고른다 — 렌더러가 경로를 지어내는 길은 없다.
  openProjectDialog: async () => {
    const res = await window.athena.invoke('athena:project-open-dialog');
    if (!res || !res.ok) throw new Error(projectError(res, '폴더 선택 창을 열지 못했습니다'));
    return res.data;
  },
  openProject: async (folderPath) => {
    const res = await window.athena.invoke('athena:project-open', { path: folderPath });
    if (!res || !res.ok) throw new Error(projectError(res, '폴더를 열지 못했습니다'));
    return res.data;
  },
  projectTree: async (projectId) => {
    const res = await window.athena.invoke('athena:project-tree', { project_id: projectId });
    if (!res || !res.ok) throw new Error(projectError(res, '파일 목록을 불러오지 못했습니다'));
    return res.data;
  },
  readProjectFile: async (projectId, filePath) => {
    const res = await window.athena.invoke(
      'athena:project-file-read', { project_id: projectId, path: filePath },
    );
    if (!res || !res.ok) throw new Error(projectError(res, '파일을 열지 못했습니다'));
    return res.data;
  },
  writeProjectFile: async (projectId, filePath, text) => {
    const res = await window.athena.invoke(
      'athena:project-file-write', { project_id: projectId, path: filePath, text },
    );
    if (!res || !res.ok) throw new Error(projectError(res, '파일을 저장하지 못했습니다'));
    return res.data;
  },
  createProjectFile: async (projectId, filePath, kind) => {
    const res = await window.athena.invoke(
      'athena:project-file-create', { project_id: projectId, path: filePath, kind },
    );
    if (!res || !res.ok) throw new Error(projectError(res, '파일을 만들지 못했습니다'));
    return res.data;
  },
  renameProjectFile: async (projectId, filePath, to) => {
    const res = await window.athena.invoke(
      'athena:project-file-rename', { project_id: projectId, path: filePath, to },
    );
    if (!res || !res.ok) throw new Error(projectError(res, '이름을 바꾸지 못했습니다'));
    return res.data;
  },
  deleteProjectFile: async (projectId, filePath) => {
    const res = await window.athena.invoke(
      'athena:project-file-delete', { project_id: projectId, path: filePath },
    );
    if (!res || !res.ok) throw new Error(projectError(res, '지우지 못했습니다'));
    return res.data;
  },
});
backtestCanvas.mount();
// 채팅이 athena_backtest로 낸 액션 4종(설정·코드·화면 전환·최적화 제안)의 구독자는
// chat.js 하나다 — 액션을 캔버스에 바로 반영하고, 무엇이 바뀌었는지와 [되돌리기]를
// 채팅 카드로 남긴다(여기서 또 들으면 같은 액션이 두 번 적용된다). 이 전역이 그
// 배선의 유일한 통로다.
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
  // 드릴인 "설정" 탭의 "채팅에서 고치기 ↗"(Paper 보드 03) — 동선 규칙②가
  // 말하는 그 경로다. 시트를 열지 않고 채팅 입력에 문장을 심는다(＋새 작업·
  // 제안 "추가"와 같은 seedChatInput 버스 — 편집 진입로를 새로 만들지 않는다).
  // 코드 알람(Step 7)은 두 번째 인자를 붙여 부른다 — 어떤 칸에 대해 무엇을 묻는지가
  // 문장에 들어가야 채팅이 그 칸부터 다시 검사할 수 있다(보드 11). 인자가 하나면
  // 옛 배선(드릴인 설정)의 문장을 글자 그대로 쓴다 — 기존 대조 프로브가 그 문장을 잰다.
  onEditInChat: (titleOrId, opts) => {
    if (!(window.AthenaShell && typeof window.AthenaShell.seedChatInput === 'function')) return;
    if (!opts) {
      window.AthenaShell.seedChatInput(`"${titleOrId}" 루틴을 고치고 싶어요 — `);
      return;
    }
    const name = opts.title || titleOrId;
    const node = opts.nodeTitle || opts.node || '';
    if (opts.kind === 'odd' && node) {
      window.AthenaShell.seedChatInput(`"${name}" 알람의 「${node}」 칸이 이상해 — `);
      return;
    }
    if (opts.kind === 'ask' && node) {
      window.AthenaShell.seedChatInput(`"${name}" 알람의 「${node}」 칸은 뭐야? `);
      return;
    }
    window.AthenaShell.seedChatInput(`"${name}" 알람을 말로 고치고 싶어 — `);
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
  // Step 7 — 코드 알람 상세. 목록에 없는 값(감시 블록·오늘 확인·노드 칸)은 상세
  // 라우트에만 있다(chat.js watchBlockOf와 같은 채널·같은 이유).
  fetchDetail: async (id) => {
    const res = await window.athena.invoke('athena:routine-detail', { id });
    return (res && res.ok && res.data) ? res.data : null;
  },
  // Step 7 — 상세의 「취소」. 일시중지·재개와 같은 자리의 사람 클릭 전용 채널.
  cancelRoutine: async (id) => {
    const res = await window.athena.invoke('athena:routine-cancel', { id });
    if (!res || !res.ok) throw new Error((res && res.error) || '취소 실패');
    return res.data;
  },
  // Step 7 — 초안 상세의 「검사」. 채팅 초안 카드의 검사 칩과 같은 본문·같은
  // 통로다(chat.js runWatchCheck) — 두 화면이 다른 것을 재면 안 된다.
  runWatchCheck: async (item) => {
    const raw = (item && item.raw) || {};
    const watch = (item && item.watch) || raw.watch;
    if (!watch || !watch.project_id || !watch.path) return null;
    const body = {
      project_id: watch.project_id,
      path: watch.path,
      symbol: raw.symbol,
      params: watch.params || {},
      lookback_days: watch.lookback_days || 30,
      cooldown_s: raw.cooldown_s,
      routine_id: item.id,
    };
    const res = await window.athena.invoke('athena:routine-watch-check', { body });
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
  // windowDays를 반드시 함께 넘긴다(2026-09-02 결함).
  //
  // summary-table.js는 헤더 기간 칩 값을 `{ limit, windowDays }`로 넘기고 main.js
  // 핸들러도 그걸 받아 `window_days`로 백엔드에 전달한다. 그런데 이 자리가
  // `{ limit }`만 구조분해해 windowDays를 **버리고 있었다** — 그 결과 "최근 30일"을
  // 골라도 표는 백엔드 기본 창을 그대로 봤다. graph-filters.js 머리말이 경계한
  // "안 되는 컨트롤보다 나쁜 것은 거짓말하는 라벨"이 그대로 재발한 상태였고,
  // 지도·전체 캐시(loadProfileSignals)는 제대로 넘기고 있어 **두 표면이 다른 창을**
  // 보고 있었다(applyGraphFilterChange 주석이 금지한 바로 그것).
  fetchProfileSummary: ({ limit, windowDays } = {}) => window.athena.invoke(
    'athena:brain-profile-summary', { limit, windowDays },
  ),
  selectEntity: (entityId, panelData) => graphMode.selectEntity(entityId, panelData),
  onError: (err) => console.warn('[graph-mode] profile-summary 실패', err),
  // 히어로(보드 06 §5)·확인 필요 배너(§6, 06 전용) — 스텝3. 배너 개수원은
  // loadEmptyCanvasExtras()가 캔버스 빈 상태 힌트에 이미 쓰는 것과 같은 IPC다.
  heroContainer: document.getElementById('graphSummaryHero'),
  bannerContainer: document.getElementById('graphConfirmBanner'),
  fetchSuggestedQuestions: () => window.athena.invoke('athena:brain-suggested-questions'),
  // 헤더 필터 칩(보드 01) — 기간은 window_days로 백엔드에, 정렬은 표 재정렬로.
  filters: window.AthenaLib.GraphFilters,
  getFilters: () => window.AthenaLib.GraphModePrefs.readPrefs(),
  // 히어로 부제 "테마 군집 N개" — 테마 군집 카드가 이미 받아 둔 수를 재사용한다.
  getClusterCount: () => lastThemeClusterCount,
  // 확인 필요 배너의 CTA "채팅에서 답하기"(2026-09-02) — 실제 질문을 심는다.
  //
  // 옛 판은 입력창에 포커스만 줬다. 버튼 문구가 "채팅에서 답하기"인데 눌러도
  // 아무 일이 없어서, 사용자가 직접 문장을 타이핑해야 했다(제보). 배너가 약속하는
  // 것("답하시면 그대로 그래프가 갱신됩니다")을 시작할 문장을 대신 써 준다.
  //
  // **보내지는 않는다** — 보드 43 "새 작업은 채팅에서" 원칙의 seedChatInput 버스가
  // 이 저장소의 관례고(lib/agent-canvas.js의 "＋ 새 작업"이 같은 경로), 사람이
  // 읽고 고친 뒤 Enter를 누른다.
  onConfirmCta: async (hintCount) => {
    // 되물을 것들 카드를 먼저 시도한다(2026-09-02) — 백엔드가 아는 그 N건을
    // 하나씩 묻고, 답을 모아 채팅으로 보낸다. 문장을 심어 사용자가 직접 묻게 하는
    // 것보다 정확하다: 모델이 후보를 추측하지 않고 실제 AMBIGUOUS 관계를 다룬다.
    if (window.AthenaShell && typeof window.AthenaShell.openBrainQuestions === 'function') {
      const opened = await window.AthenaShell.openBrainQuestions();
      if (opened) return;
    }
    // 카드를 못 열었으면(답변 중 · 물을 것이 0건 · 조회 실패) 빈손으로 두지 않고
    // 옛 경로로 내려간다 — 문장을 심어 사람이 직접 묻게 한다.
    // 위 패널 CTA와 같은 규칙 — 짧게, 지시문 꼬리 없이(2026-09-03).
    const count = Number.isFinite(hintCount) && hintCount > 0 ? hintCount : null;
    seedGraphChat(count
      ? `확인이 필요한 ${count}건, 하나씩 물어봐줘.`
      : '확인이 필요한 게 뭐야?');
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
// 세 헤더(#graphSummaryHeader · #graphHeader · #graphSettingsHeader)에 같은 3탭이
// 있어 버튼은 9개지만 store 상태는 하나다 — 서브뷰 키로 묶어 한 번에 동기화한다.
const SURFACE_TAB_IDS = {
  summary: ['summaryViewTab', 'graphHeaderSummaryTab', 'graphSettingsSummaryTab'],
  map: ['graphViewTab', 'graphHeaderMapTab', 'graphSettingsMapTab'],
  settings: ['settingsViewTab', 'graphHeaderSettingsTab', 'graphSettingsOwnTab'],
};
function updateSurfaceTabs() {
  const active = graphMode.state.surface;
  for (const [surface, ids] of Object.entries(SURFACE_TAB_IDS)) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('is-active', surface === active);
      el.setAttribute('aria-selected', surface === active ? 'true' : 'false');
    }
  }
}
// setSurface()는 hidden 갱신(applyVisibility())을 내부 await 이전에 동기로
// 끝낸다 — 탭의 활성 스타일도 그 직후 바로 갱신한다(await로 미루면 draw()의
// 네트워크 왕복이 끝날 때까지 탭이 안 눌린 것처럼 보인다, 실측으로 발견).
for (const [surface, ids] of Object.entries(SURFACE_TAB_IDS)) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('click', () => {
      graphMode.setSurface(surface);
      updateSurfaceTabs();
    });
  }
}

// --- 헤더 필터 칩 배선 (보드 01/03) ----------------------------------------
//
// 옛 판은 `<span class="filter-chip">최근 90일</span>` 정적 라벨이라 화면이
// "최근 90일"이라 주장하면서 실제로는 아무것도 안 걸고 있었다. 이제 세 컨트롤이
// 실제로 건다:
//   기간   → profile-summary의 window_days(표) + 엣지 observed_at(지도)
//   정렬   → 표 재정렬(graph-filters.sortEntries)
//   최소 연결 수 → 지도의 노드·엣지 필터
// 값은 graph-mode-prefs(localStorage)에 남아 다음에 열어도 같은 화면이 뜬다.
const GraphFilters = window.AthenaLib.GraphFilters;
const GraphPrefs = window.AthenaLib.GraphModePrefs;

function fillFilterSelect(el, options, current, labelFor, narrowedWhen) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const value of options) {
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = labelFor(value);
    if (value === current) opt.selected = true;
    el.appendChild(opt);
  }
  el.classList.toggle('is-narrowed', narrowedWhen(current));
}

function renderFilterChips() {
  const prefs = GraphPrefs.readPrefs();
  // 기간 칩은 두 헤더(요약·지도)에 하나씩 있고 같은 값을 본다 — 한쪽에서 바꾸면
  // 다른 쪽도 그 값으로 열려야 "지금 보고 있는 창"이 하나다.
  for (const id of ['summaryWindowFilter', 'graphWindowFilter']) {
    fillFilterSelect(document.getElementById(id), GraphFilters.WINDOW_DAY_OPTIONS,
      prefs.windowDays, GraphFilters.windowLabel, (v) => v !== GraphFilters.DEFAULTS.windowDays);
  }
  fillFilterSelect(document.getElementById('summarySortFilter'), GraphFilters.SORT_OPTIONS,
    prefs.summarySort, GraphFilters.sortLabel, (v) => v !== GraphFilters.DEFAULTS.summarySort);
  fillFilterSelect(document.getElementById('graphDegreeFilter'), GraphFilters.MIN_DEGREE_OPTIONS,
    prefs.minDegree, GraphFilters.minDegreeLabel, (v) => v > 0);
}

function wireFilterSelect(id, read) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    GraphPrefs.writePrefs(read(el.value));
    renderFilterChips();
    void applyGraphFilterChange();
  });
}

// 필터가 바뀌면 표와 지도를 둘 다 다시 읽는다 — 두 표면이 다른 창을 보고 있으면
// 같은 그래프에 대해 서로 다른 숫자를 말하게 된다.
async function applyGraphFilterChange() {
  // 기간이 바뀌면 채움 인코딩의 근거(성향 신호)와 히어로 부제의 군집 수가 함께
  // 바뀐다 — 둘 다 뒤 렌더의 입력이라 먼저 채운다(refreshConversationGraphSurfaces와 같은 순서).
  await Promise.allSettled([loadProfileSignals(), loadThemeClusters()]);
  await Promise.allSettled([
    graphSummaryTable.load().then(renderSummaryUpdatedAt),
    graphMode.refreshFiltered(),
  ]);
}

wireFilterSelect('summaryWindowFilter', (v) => ({ windowDays: Number(v) }));
wireFilterSelect('graphWindowFilter', (v) => ({ windowDays: Number(v) }));
wireFilterSelect('summarySortFilter', (v) => ({ summarySort: v }));
wireFilterSelect('graphDegreeFilter', (v) => ({ minDegree: Number(v) }));
renderFilterChips();

// 수집·노출 서브뷰(보드 05) — 렌더는 collection-settings.js가, 저장은
// settings-cards.js가 이미 갖고 있다. 여기서는 둘을 잇기만 한다(같은 규칙을
// 두 벌 쓰지 않는다 — 설정 오버레이와 이 탭은 같은 localStorage 키를 본다).
let graphBrainReady = false;
function renderGraphCollectionSettings() {
  const container = document.getElementById('graphSettingsBody');
  if (!container) return;
  const settingsCards = window.AthenaLib.SettingsCards;
  window.AthenaLib.GraphCollectionSettings.renderCollectionSettings(container, {
    readSettings: () => settingsCards.readGraphSettings(),
    writeSettings: (patch) => settingsCards.writeGraphSettings(patch),
    setCollectChat: (enabled) => settingsCards.setCollectChatPreference(enabled),
    intervalOptions: settingsCards.HOLDINGS_INTERVAL_MINUTES,
    brainReady: graphBrainReady,
    // 백엔드 기본값(ATHENA_BRAIN_INGEST_INTERVAL_MINUTES)이다 — 이 화면이
    // 바꾸는 값이 아니라 알려 주기만 하는 값이라 상수로 둔다.
    defaultIngestIntervalMinutes: 60,
    resetBrain: () => window.athena.invoke('athena:brain-reset'),
  });
}

// "최근 갱신"(보드 01 §4-1) — entries[].observed_at 중 가장 최신값으로만 채운다.
// Paper 목업 "12분 전"을 리터럴로 박지 않는다(§0 정직한 빈 데이터 정책) — 항목이
// 없거나 유효한 시각이 하나도 없으면 자리를 숨긴다.
//
// 포맷은 표의 "최근" 열과 같은 일 단위 자(relativeDaysText)를 쓴다. 예전엔 능동 턴
// 배지의 분·시간 자(routine-turn.relativeText)를 재사용했는데, 성향 신호는 날짜
// 단위로 쌓이는 값이라 "최근 갱신 24시간 0분 전" 같은 문구가 나왔다(실측) — 같은
// 사건을 표에서는 "1일 전", 헤더에서는 "24시간 0분 전"이라 부르는 셈이었다.
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
// --- 채팅 → 그래프 제어 (2026-09-03) ---------------------------------------
//
// main.js가 athena_graph_view의 delivered:'canvas' 봉투를 이 채널 하나로 보낸다
// (백테스트의 athena:backtest-chat-action과 같은 구조). 여기서 하는 일은 **사람이
// 직접 눌렀을 때와 같은 경로를 부르는 것**이다 — 탭 클릭 핸들러가 부르는
// graphMode.setSurface(), 지도 클릭이 부르는 graphMode.selectNode(), 필터 select의
// change가 부르는 GraphPrefs.writePrefs()+applyGraphFilterChange(). 채팅용 두 번째
// 경로를 만들면 한쪽만 고치는 실수가 나고, 두 입구가 다른 상태를 남긴다.
//
// edit_proposal만 다르다 — 그건 화면 상태가 아니라 사람에게 물을 것이라 채팅 쪽이
// 그린다. 이 파일은 그리지 않고 훅으로 넘긴다(shell.js openGraphEditProposal).
// 그 채널의 **구독은 여기 하나뿐**이다: 두 파일이 각각 구독하면 페이지 로드마다
// 리스너가 두 개씩 쌓여 ipcRenderer 상한을 이 채널만 먼저 넘었다(전수 검증 실측).
// 구독 해제를 들고 있다가 문서가 내려갈 때 푼다. 한 렌더러 프로세스에서 문서를
// 여러 번 로드하면(전수 검증 하네스가 그렇게 한다) preload의 ipcRenderer는 살아
// 있어서 리스너가 로드마다 쌓이고, 이 채널만 상한 10을 먼저 넘어 경고가 났다.
// 다른 채널이 조용했던 것은 그것들이 먼저 등록돼 상한에 안 닿았을 뿐이다.
const disposeGraphChatAction = window.athena.on('athena:graph-chat-action', async (message) => {
  if (!message || typeof message !== 'object') return;
  // 편집 제안은 그래프 기능 밖에서도 유효하다(사람의 답변 문장은 어디서든 보낼 수
  // 있다) — 아래 진입 게이트보다 앞에 둔다.
  if (message.kind === 'edit_proposal') {
    window.AthenaShell.openGraphEditProposal(message);
    return;
  }
  // 그래프 기능 밖에 있으면 아무 일도 안 한다 — 캔버스가 다른 모드를 그리는 중에
  // 서브뷰를 갈아치우면 사용자가 보던 화면이 이유 없이 사라진다.
  //
  // 진입 여부는 state.view다(state.active 같은 필드는 없다 — 첫 판에서 그것을
  // 읽어 게이트가 **항상** 조기 반환했고, 전수 검증이 그걸 잡았다). 값 비교 대신
  // store의 술어를 쓴다 — 'graph' 문자열을 여기 또 적으면 store가 바뀔 때 조용히
  // 어긋난다.
  if (!window.AthenaLib.GraphModeStore.isGraphView(graphMode.state)) return;

  if (message.kind === 'navigate' && SURFACE_TAB_IDS[message.surface]) {
    await graphMode.setSurface(message.surface);
    updateSurfaceTabs();
    return;
  }
  if (message.kind === 'select' && message.entityId) {
    // 지도를 보고 있지 않으면 먼저 지도로 옮긴다 — 노드를 골라 달라는 요청은
    // 그 노드를 보여 달라는 뜻이고, 요약 표에서는 선택이 표 밖의 일이 된다.
    if (graphMode.state.surface !== 'map') {
      await graphMode.setSurface('map');
      updateSurfaceTabs();
    }
    graphMode.selectNode(message.entityId);
    graphMode.focusNode(message.entityId);
    return;
  }
  if (message.kind === 'filter' && message.patch && typeof message.patch === 'object') {
    // 화이트리스트로만 받는다 — 봉투가 어디서 왔는지 모르는 채로 prefs에 쓰면
    // 모르는 키가 localStorage에 쌓이고, normalize()가 그것을 조용히 버린다.
    const patch = {};
    if (GraphFilters.WINDOW_DAY_OPTIONS.includes(message.patch.windowDays)) {
      patch.windowDays = message.patch.windowDays;
    }
    if (GraphFilters.MIN_DEGREE_OPTIONS.includes(message.patch.minDegree)) {
      patch.minDegree = message.patch.minDegree;
    }
    if (GraphFilters.SORT_OPTIONS.includes(message.patch.summarySort)) {
      patch.summarySort = message.patch.summarySort;
    }
    if (!Object.keys(patch).length) return;
    GraphPrefs.writePrefs(patch);
    renderFilterChips();
    await applyGraphFilterChange();
    return;
  }
  if (message.kind === 'fit') {
    graphMode.fitView();
  }
});
window.addEventListener('pagehide', disposeGraphChatAction, { once: true });

  const relative = window.AthenaLib.GraphSummaryTable.relativeDaysText(
    new Date(latestMs).toISOString(), Date.now());
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
  lastThemeClusterCount = clusters.length;
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
  // 관계명 한글 사전을 주입한다(2026-09-03) — 없으면 화면에 belongs_to가 샌다.
  // 사전의 진실은 controller.js RELATION_LABELS 하나다(graph-edit-proposal.js와 같은 규약).
  window.AthenaLib.HiddenLinks.renderHiddenLinks(container, res.connections, {
    relationLabels: window.AthenaLib.GraphModeController.RELATION_LABELS,
  });
}

// 성향 신호 전체를 받아 캐시에 담는다(위 lastProfileSignals 주석 참고).
// 기간 칩과 같은 창을 봐야 지도와 표가 같은 시점을 말한다.
async function loadProfileSignals() {
  const prefs = window.AthenaLib.GraphModePrefs.readPrefs();
  let res;
  try {
    res = await window.athena.invoke('athena:brain-profile-summary', {
      limit: 500, windowDays: prefs.windowDays,
    });
  } catch (err) {
    console.warn('[graph-mode] profile-summary(전체) 실패', err);
    return;
  }
  if (!res || !res.ok) return;
  lastProfileSignals = Array.isArray(res.entries) ? res.entries : [];
}

async function refreshConversationGraphSurfaces() {
  // 순서가 있다. 성향 신호 캐시는 지도의 노드 채움 인코딩이 읽고, 테마 군집 수는
  // 히어로 부제("테마 군집 7개")가 읽는다 — 둘 다 뒤에 오는 렌더의 **입력**이라
  // 병렬로 두면 첫 렌더가 "모름"·"0개"로 나온다(실측).
  await Promise.allSettled([loadProfileSignals(), loadThemeClusters()]);
  const visibleGraphRefresh = graphMode.setAvailable(true);
  await Promise.allSettled([
    Promise.resolve(visibleGraphRefresh),
    graphSummaryTable.load().then(renderSummaryUpdatedAt),
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
    graphBrainReady = ready; // 보드 05 "브레인 준비됨" 배지가 읽는 값.
    graphMode.setAvailable(ready);
    // hidden은 안 건드린다 — graphMode.applyVisibility()가 유일한 소유자다(US-007).
    // 여기서는 데이터를 미리 당겨올지만 결정한다(그래프 모드로 전환했을 때 바로
    // 보이도록 하는 프리페치 — 안 보이는 동안 부르는 낭비는 loadEmptyCanvasExtras와
    // 같은 기존 관례).
    // 프리페치도 같은 순서를 지킨다 — 캐시 둘을 먼저 채우고 그 위에 렌더를 얹는다.
    if (ready) {
      void Promise.allSettled([loadProfileSignals(), loadThemeClusters()]).then(() => {
        void graphMode.refreshFiltered();
        void graphSummaryTable.load().then(renderSummaryUpdatedAt);
      });
    }
    if (ready) loadHiddenLinks();
    // 빈 상태(보드 05) 숫자·CTA·힌트 — 같은 ready 확인에 얹는다(왕복 추가 없음).
    if (ready) loadEmptyCanvasExtras();
  } catch (err) {
    console.warn('[graph-mode] brain-status 실패 — 못 씀으로 둔다', err);
    graphMode.setAvailable(false);
  }
})();
