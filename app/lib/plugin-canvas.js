// Paper 플러그인 페이지 01~04 — 기능 허용 · 설치 승인 · 허브 · 관리.
//
// 이 파일은 설치 파이프라인이나 저장소를 가정하지 않는다. 화면은 전달받은
// 목록만 그리고, 권한·설치·활성화 의도는 콜백으로 상위 셸에 돌려준다.
//
// 화면의 버튼은 아무것도 실행하지 않는다 — 제안을 만들어 deps.onPropose로
// 돌려주고, 실행은 승인 카드의 [승인] 하나뿐이다(모델이 낸 제안과 같은 자리).
// 아래 SAMPLE_* 는 **호스트가 아무 목록도 넘기지 않았을
// 때만** 쓰는 단위테스트용 샘플이다. 실제 셸은 언제나 명시적으로 배열을
// 넘기므로(빈 배열이라도) 앱 화면에 이 샘플이 뜨는 경로는 없다 — 설치된 적 없는
// 플러그인을 설치된 것처럼 보여주지 않기 위한 경계다. 값은 lib/plugin-catalog.js
// 와 같은 실서버를 쓴다(없는 플러그인 이름을 샘플로도 남기지 않는다).
(function () {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 카드 문구와 만료 판정은 순수 모듈이 소유한다(모델 경로와 GUI 경로가 같은
// 함수를 쓴다). 이 파일은 여전히 IPC를 모른다 — window.athena 호출 0건.
const PluginProposal = typeof module !== 'undefined' && module.exports
  ? require('./plugin-proposal')
  : window.AthenaLib.PluginProposal;
const { cardCopy, isProposalStale } = PluginProposal;

// 처리된 카드의 상태 문구. 실패 사유 원문(detail)은 절대 카드에 싣지 않는다.
const PROPOSAL_STATUS = Object.freeze({
  success: '승인됨',
  failed: '실패',
  rejected: '거부됨',
  stale: '만료됨',
});

const SAMPLE_INSTALLED = Object.freeze([
  Object.freeze({
    id: 'fetch',
    name: '웹 문서 읽기',
    description: '공시·리서치 웹 페이지를 마크다운으로 읽습니다',
    source: '연결 확인됨',
    enabled: true,
    featureCount: 1,
    features: [
      { id: 'fetch', name: 'fetch', description: '지정한 URL의 본문을 마크다운으로 가져옵니다', allowed: true },
    ],
  }),
  Object.freeze({
    id: 'time',
    name: '시간·시간대',
    description: '현재 시각과 시간대 변환을 정확히 계산합니다',
    source: '연결 확인됨',
    enabled: false,
    featureCount: 2,
    features: [
      { id: 'get_current_time', name: 'get_current_time', description: '지정한 시간대의 현재 시각', allowed: true },
      { id: 'convert_time', name: 'convert_time', description: '시간대 간 시각 변환', allowed: false },
    ],
  }),
]);

const SAMPLE_RECOMMENDED = Object.freeze([
  Object.freeze({
    id: 'sequential-thinking',
    name: '단계적 사고',
    description: '복잡한 판단을 단계로 쪼개 이어 붙입니다',
    provider: 'Model Context Protocol · server-sequential-thinking',
    purpose: '다단계 추론 보조',
    source: 'marketplace · athena-official',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    requestedFeatures: ['sequentialthinking — 생각 단계를 기록·수정하고 되돌립니다'],
  }),
  Object.freeze({
    id: 'memory',
    name: '지식 그래프 메모리',
    description: '관심 종목·성향을 그래프로 기억합니다',
    provider: 'Model Context Protocol · server-memory',
    purpose: '지식 그래프 기반 장기 기억',
    source: 'marketplace · athena-official',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    requestedFeatures: [
      'create_entities · create_relations · add_observations — 그래프에 쓰기',
      'read_graph · search_nodes · open_nodes — 그래프 읽기·검색',
    ],
  }),
  Object.freeze({
    id: 'korea-stock',
    name: '한국 주식 시세',
    description: '국내 종목 시세·재무를 대화에서 조회합니다',
    provider: 'drfirst · @drfirst/korea-stock-mcp',
    purpose: '국내 주식 시장 데이터 조회',
    source: 'marketplace · athena-official',
    command: 'npx',
    args: ['-y', '@drfirst/korea-stock-mcp'],
    requestedFeatures: [
      'search_stock_code · get_stock_price_by_code — 종목 검색과 시세',
      'get_market_cap_stocks · get_dividend_yield_stocks — 시총·배당 상위',
    ],
  }),
]);

const SAMPLE_MARKETPLACES = Object.freeze([
  Object.freeze({
    id: 'athena-official',
    name: 'athena-official',
    description: '앱 내장 카탈로그 · 키가 필요 없는 5종',
    enabled: true,
  }),
]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function cloneRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    features: Array.isArray(row.features) ? row.features.map((feature) => ({ ...feature })) : row.features,
    requestedFeatures: Array.isArray(row.requestedFeatures) ? [...row.requestedFeatures] : row.requestedFeatures,
  }));
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function plugIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M8 3v4M16 3v4M5 7h14v5a7 7 0 0 1-14 0Z');
  body.setAttribute('fill', 'none');
  body.setAttribute('stroke', '#5B6270');
  body.setAttribute('stroke-width', '1.7');
  const stem = document.createElementNS(SVG_NS, 'path');
  stem.setAttribute('d', 'M12 19v2');
  stem.setAttribute('fill', 'none');
  stem.setAttribute('stroke', '#5B6270');
  stem.setAttribute('stroke-width', '1.7');
  svg.appendChild(body);
  svg.appendChild(stem);
  return svg;
}

function createPluginCanvas(options) {
  const deps = options || {};
  const container = deps.container;
  if (!container) {
    return {
      mount() {}, setView() {}, setSearch() {}, setData() {}, setProposals() {},
      getState: () => ({ view: 'hub', search: '' }),
    };
  }

  const installed = cloneRows(deps.installed || SAMPLE_INSTALLED);
  const recommended = cloneRows(deps.recommended || SAMPLE_RECOMMENDED);
  const marketplaces = cloneRows(deps.marketplaces || SAMPLE_MARKETPLACES);
  let view = deps.initialView === 'manage' ? 'manage' : 'hub';
  // 게이트웨이(athena_mcp serve)는 기동 시점에 레지스트리를 읽는다. 앱이 떠 있는
  // 동안 서버를 설치·승인·삭제해도 이미 실행 중인 대화 세션은 그 서버를 모른다 —
  // "설치했는데 대화에서 안 쓰인다"로 보이므로 화면에서 명시한다.
  let restartRequired = false;
  let search = '';
  let mounted = false;
  let root = null;
  let hubLists = null;
  let activeSheet = null;
  // 승인 카드. 봉투는 호스트가 setProposals로 넣고, 이 모듈은 그리기와 사람의
  // 승인·거부 의도만 돌려준다.
  let proposals = [];
  let proposalRevision = null;
  // 이미 승인·거부·폐기한 제안은 복원으로 되살아나지 않는다(부활 방지).
  const handled = new Set();
  // 저장 전 권한 토글은 사람이 만든 값이다 — 모드를 나갔다 와도 버리지 않는다.
  let permissionDraft = null; // { pluginId, base: {name:bool}, draft: {name:bool} }
  // 감사 로그는 호스트가 읽어다 준다. null = 아직 못 읽음(읽는 중 문구를 띄운다).
  let auditEntries = null;
  let auditError = false;
  let auditReason = '';
  let auditLoading = false;
  // 화면에 붙어 있는 최신 목록 노드. 재렌더로 갈아끼워지므로 함수 인자로 들고 다니지 않는다.
  let auditList = null;

  function matches(row) {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    if (!needle) return true;
    return [row.name, row.description, row.source]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
  }

  function actionButton(label, className, onClick) {
    const button = el('button', `plugin-canvas-action ${className || ''}`.trim(), label);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function pluginCard(plugin, kind) {
    const card = el('article', 'plugin-canvas-card');
    card.setAttribute('data-plugin-id', plugin.id || plugin.name);
    card.setAttribute('data-plugin-kind', kind);

    const icon = el('div', 'plugin-canvas-icon');
    icon.appendChild(plugIcon());
    card.appendChild(icon);

    const copy = el('div', 'plugin-canvas-card-copy');
    copy.appendChild(el('div', 'plugin-canvas-card-name', plugin.name));
    copy.appendChild(el('div', 'plugin-canvas-card-description', plugin.description || ''));
    // 연결·승인 상태는 카드에서 바로 보여야 한다 — 목록만 보고 "연결됐다"고
    // 넘겨짚게 두지 않는다(호스트가 probe 결과로만 채운다).
    if (plugin.source) {
      copy.appendChild(el('div', 'plugin-canvas-card-source', plugin.source));
    }
    card.appendChild(copy);

    if (kind === 'installed') {
      card.appendChild(actionButton('권한', 'is-primary', () => {
        if (typeof deps.onPermission === 'function') deps.onPermission(plugin);
        openPermissionSheet(plugin);
      }));
    } else {
      card.appendChild(actionButton('설치', 'is-secondary', () => {
        openInstallSheet(plugin);
      }));
    }
    return card;
  }

  function featureRowsFor(plugin, requestedOnly) {
    if (requestedOnly) {
      const requested = Array.isArray(plugin.requestedFeatures) && plugin.requestedFeatures.length
        ? plugin.requestedFeatures
        : [plugin.description || '플러그인 기능'];
      return requested.map((feature, index) => {
        if (feature && typeof feature === 'object') {
          return {
            id: feature.id || `feature-${index + 1}`,
            name: feature.name || feature.label || `기능 ${index + 1}`,
            description: feature.description || '',
            allowed: feature.allowed !== false,
          };
        }
        return { id: `feature-${index + 1}`, name: String(feature), description: '', allowed: true };
      });
    }
    // probe 전에는 노출 도구를 모른다. 설명 한 줄을 가짜 기능 행으로 만들어
    // 채우지 않는다 — 그 이름으로 allow를 부르면 존재하지 않는 도구가 허용
    // 목록에 들어가고(허용 저장이 probe 결과만 쓰는 이유다), 화면에는
    // "허용 1 / 1"이 떠서 다 된 것처럼 보인다. 비어 있으면 비어 있다고 쓴다.
    const features = Array.isArray(plugin.features) ? plugin.features : [];
    return features.map((feature, index) => ({
      id: feature.id || `feature-${index + 1}`,
      name: feature.name || feature.label || `기능 ${index + 1}`,
      description: feature.description || '',
      allowed: feature.allowed !== false,
    }));
  }

  // --- GUI 진입 6종의 유일한 출구 -------------------------------------------
  // 버튼은 아무것도 실행하지 않는다 — 제안을 만들 뿐이다. 실행은 승인 카드의
  // [승인] 하나뿐이고, 그 결과는 호스트가 setData로 돌려준다.
  function propose(spec, reason) {
    if (typeof deps.onPropose === 'function') deps.onPropose(spec, reason || null);
  }

  // --- 서버 직접 등록(스니펫 붙여넣기) ---------------------------------------
  function openAddSheet() {
    activeSheet = { kind: 'add', snippet: '', error: null };
    render();
  }

  function proposeSnippet(sheet) {
    if (!String(sheet.snippet || '').trim()) {
      sheet.error = 'Claude 설정 스니펫을 붙여넣습니다';
      render();
      return;
    }
    propose({ action: 'stage_snippet', target: null, snippet: sheet.snippet });
    closeSheet();
  }

  function openInstallSheet(plugin) {
    activeSheet = {
      kind: 'install',
      plugin,
      features: featureRowsFor(plugin, true),
      returnFocusPluginId: plugin.id || plugin.name,
    };
    render();
  }

  function openPermissionSheet(plugin) {
    const features = featureRowsFor(plugin, false);
    const base = {};
    features.forEach((feature) => { base[feature.name] = feature.allowed; });
    const sheet = { kind: 'permissions', plugin, features, base, divergence: [] };
    restoreDraft(sheet);
    activeSheet = sheet;
    render();
  }

  // 초안을 되살리면서, 그 사이 실제 허용이 달라진 기능을 함께 집는다(PM-4).
  // 덮어쓰기 전에 무엇이 갈렸는지 말하지 않으면 사람이 모르는 채로 되돌린다.
  function restoreDraft(sheet) {
    const pluginId = sheet.plugin.id || sheet.plugin.name;
    if (!permissionDraft || permissionDraft.pluginId !== pluginId) return;
    const divergence = [];
    sheet.features.forEach((feature) => {
      const was = permissionDraft.base[feature.name];
      if (was !== undefined && was !== feature.allowed) divergence.push(feature.name);
      const drafted = permissionDraft.draft[feature.name];
      if (drafted !== undefined) feature.allowed = drafted;
    });
    sheet.divergence = divergence;
  }

  // 모드를 나가거나 목록이 갈리기 직전에 지금 화면의 토글을 초안으로 굳힌다.
  function keepDraft() {
    if (!activeSheet || activeSheet.kind !== 'permissions') return;
    const draft = {};
    activeSheet.features.forEach((feature) => { draft[feature.name] = feature.allowed; });
    permissionDraft = {
      pluginId: activeSheet.plugin.id || activeSheet.plugin.name,
      base: { ...activeSheet.base },
      draft,
    };
  }

  function resetDraft(sheet) {
    permissionDraft = null;
    openPermissionSheet(sheet.plugin);
  }

  // 삭제는 되돌릴 수 없다(등록·승인·허용 목록이 함께 사라진다). 목록 행의 클릭
  // 한 번으로 지우지 않고 무엇이 사라지는지 먼저 보여준다.
  function openRemoveSheet(plugin) {
    activeSheet = {
      kind: 'remove',
      plugin,
      error: null,
      returnFocusPluginId: plugin.id || plugin.name,
    };
    render();
  }

  // 사람이 명시적으로 화면을 닫으면 초안도 함께 끝난다 — 되돌아왔을 때 저장한
  // 적 없는 값이 떠 있으면 그것이 실제 허용으로 읽힌다.
  function closeSheet() {
    const returnFocusPluginId = activeSheet && activeSheet.returnFocusPluginId;
    if (activeSheet && activeSheet.kind === 'permissions') permissionDraft = null;
    activeSheet = null;
    render();
    if (returnFocusPluginId && root && typeof root.querySelectorAll === 'function') {
      queueMicrotask(() => {
        const card = Array.from(root.querySelectorAll('.plugin-canvas-card'))
          .find((node) => node.getAttribute('data-plugin-id') === returnFocusPluginId);
        const action = card && card.querySelector('.plugin-canvas-action');
        if (action && typeof action.focus === 'function') action.focus();
      });
    }
  }

  function allowedFeatures(sheet) {
    return sheet.features.filter((feature) => feature.allowed).map((feature) => ({ ...feature }));
  }

  function emptyMessage(text) {
    return el('div', 'plugin-canvas-empty', text);
  }

  // --- 감사 로그(읽기 전용) ---------------------------------------------------
  // 실행된 기능만 시각·플러그인·기능·성공 여부 네 칸으로 남는다. 인자와 응답
  // 본문은 애초에 기록되지 않으므로 여기서도 보여줄 것이 없다.
  function auditTime(value) {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return String(value || '');
    const pad = (n) => String(n).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  function auditRow(entry) {
    const row = el('div', 'plugin-canvas-audit-row');
    row.setAttribute('data-audit-plugin', entry.alias || '');
    row.appendChild(el('div', 'plugin-canvas-audit-time', auditTime(entry.ts)));
    row.appendChild(el('div', 'plugin-canvas-audit-plugin', entry.alias || ''));
    row.appendChild(el('div', 'plugin-canvas-audit-feature', entry.tool || ''));
    row.appendChild(el(
      'div',
      `plugin-canvas-audit-result ${entry.success ? 'is-success' : 'is-failure'}`,
      entry.success ? '성공' : '실패',
    ));
    return row;
  }

  function paintAudit() {
    const list = auditList;
    if (!list) return;
    clear(list);
    if (auditError) {
      // 못 읽었다는 사실을 빈 목록으로 위장하지 않는다 — 이유와 재시도를 남긴다.
      const banner = el('div', 'plugin-canvas-error-banner');
      banner.setAttribute('role', 'alert');
      banner.appendChild(el(
        'span',
        'plugin-canvas-error-text',
        auditReason ? `실행 기록을 읽지 못했습니다 — ${auditReason}` : '실행 기록을 읽지 못했습니다',
      ));
      banner.appendChild(actionButton('다시 확인', 'is-retry', () => {
        auditError = false;
        auditReason = '';
        auditEntries = null;
        paintAudit();
        loadAudit();
      }));
      list.appendChild(banner);
      return;
    }
    if (auditEntries === null) {
      list.appendChild(emptyMessage('실행 기록을 읽는 중입니다'));
      return;
    }
    if (!auditEntries.length) {
      list.appendChild(emptyMessage('실행 기록이 없습니다'));
      return;
    }
    // 열 머리는 Paper 02와 같은 순서다 — 각 셀에 따로 이름을 붙이지 않는다.
    const head = el('div', 'plugin-canvas-audit-head');
    ['시각', '별칭', '도구', '결과'].forEach((label) => head.appendChild(el('div', null, label)));
    list.appendChild(head);
    auditEntries.forEach((entry) => list.appendChild(auditRow(entry)));
  }

  // 조회는 한 번에 하나만 난다 — 관리 뷰가 다시 그려도 진행 중인 읽기에 업혀 탄다.
  function loadAudit() {
    if (auditLoading || auditEntries !== null || auditError) return;
    if (typeof deps.onAuditLog !== 'function') {
      auditEntries = [];
      paintAudit();
      return;
    }
    auditLoading = true;
    Promise.resolve()
      .then(() => deps.onAuditLog())
      .then((result) => {
        const rows = (result && Array.isArray(result.entries)) ? result.entries : (Array.isArray(result) ? result : []);
        auditEntries = rows.map((entry) => ({
          ts: entry.ts,
          alias: entry.alias,
          tool: entry.tool,
          success: !!entry.success,
        }));
      })
      .catch((err) => {
        auditError = true;
        auditReason = String((err && err.message) || err || '').trim();
      })
      .then(() => {
        auditLoading = false;
        paintAudit();
      });
  }

  function renderAudit() {
    const section = el('section', 'plugin-canvas-audit');
    section.appendChild(el('h2', 'plugin-canvas-section-title', '감사 로그'));
    auditList = el('div', 'plugin-canvas-audit-list');
    section.appendChild(auditList);
    paintAudit();
    loadAudit();
    return section;
  }

  function renderHubLists() {
    if (!hubLists) return;
    const installedRows = installed.filter(matches);
    const recommendedRows = recommended.filter(matches);
    clear(hubLists.installedGrid);
    clear(hubLists.recommendedGrid);
    // 빈 이유를 뭉뚱그리지 않는다. 하나도 설치하지 않은 첫 화면에 "검색과
    // 일치하는 …이 없습니다"가 뜨면 검색어를 지우면 나올 것처럼 읽힌다.
    const searching = !!search.trim();
    if (installedRows.length) installedRows.forEach((plugin) => hubLists.installedGrid.appendChild(pluginCard(plugin, 'installed')));
    else hubLists.installedGrid.appendChild(emptyMessage(searching
      ? '검색과 일치하는 설치 플러그인이 없습니다'
      : '설치한 플러그인이 없습니다 · 아래 추천에서 설치합니다'));
    if (recommendedRows.length) recommendedRows.forEach((plugin) => hubLists.recommendedGrid.appendChild(pluginCard(plugin, 'recommended')));
    else hubLists.recommendedGrid.appendChild(emptyMessage(searching
      ? '검색과 일치하는 추천 플러그인이 없습니다'
      : '추천할 플러그인이 없습니다 · 마켓플레이스를 켜거나 서버를 직접 추가합니다'));
  }

  function renderHub() {
    const panel = el('section', 'plugin-canvas-panel plugin-canvas-hub');
    const header = el('div', 'plugin-canvas-header');
    header.appendChild(el('h1', 'plugin-canvas-title', '플러그인'));
    const spacer = el('div', 'plugin-canvas-spacer');
    header.appendChild(spacer);
    const searchInput = el('input', 'plugin-canvas-search');
    searchInput.type = 'search';
    searchInput.placeholder = '플러그인 검색';
    searchInput.value = search;
    searchInput.setAttribute('aria-label', '플러그인 검색');
    searchInput.addEventListener('input', (event) => {
      search = String(event && event.target ? event.target.value : search);
      renderHubLists();
    });
    header.appendChild(searchInput);
    header.appendChild(actionButton('+ 서버 추가', 'is-add', openAddSheet));
    header.appendChild(actionButton('관리', 'is-manage', () => {
      if (typeof deps.onManage === 'function') deps.onManage('manage');
      setView('manage');
    }));
    panel.appendChild(header);
    panel.appendChild(el(
      'p',
      'plugin-canvas-description',
      '플러그인은 설치 후 기능별로 허용합니다. Kiwoom·brain은 Athena 내장 API라 이 목록에 표시하지 않습니다.',
    ));

    if (restartRequired) {
      panel.appendChild(el(
        'div',
        'plugin-canvas-restart-notice',
        '이번에 바꾼 서버는 Athena를 다시 시작한 뒤의 대화부터 적용됩니다. 진행 중인 대화에는 아직 반영되지 않았습니다.',
      ));
    }
    panel.appendChild(el('h2', 'plugin-canvas-section-title', '설치됨'));
    const installedGrid = el('div', 'plugin-canvas-grid plugin-canvas-installed');
    panel.appendChild(installedGrid);
    panel.appendChild(el('h2', 'plugin-canvas-section-title', '추천'));
    const recommendedGrid = el('div', 'plugin-canvas-grid plugin-canvas-recommended');
    panel.appendChild(recommendedGrid);
    hubLists = { installedGrid, recommendedGrid };
    renderHubLists();
    return panel;
  }

  function countValue(explicit, fallback) {
    return Number.isFinite(explicit) ? explicit : fallback;
  }

  // 토글은 화면 상태가 아니라 실제 승인 상태다. 그래서 누른 즉시 켜 두지 않는다 —
  // 플러그인은 승인 카드가 확정할 때까지 행이 움직이지 않고, 마켓플레이스(추천
  // 노출 여부, 앱 로컬 설정)는 호스트가 성공을 돌려준 뒤에 움직인다. 낙관적으로
  // 켜 두면 "켰는데 대화에서 안 쓰인다"가 화면상으로는 켜져 보인다.
  function toggleButton(item, kind, row) {
    const label = (on) => `${item.name} ${on ? '끄기' : '켜기'}`;
    const button = el('button', `plugin-canvas-toggle ${item.enabled ? 'is-on' : 'is-off'}`);
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', label(item.enabled));
    button.setAttribute('aria-checked', String(Boolean(item.enabled)));
    button.appendChild(el('span', 'plugin-canvas-toggle-knob'));

    function paint() {
      button.className = `plugin-canvas-toggle ${item.enabled ? 'is-on' : 'is-off'}`;
      button.setAttribute('aria-checked', String(Boolean(item.enabled)));
      button.setAttribute('aria-label', label(item.enabled));
    }

    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const next = !item.enabled;
      setRowError(row, null);
      if (kind !== 'marketplace') {
        propose({ action: 'set_enabled', target: item.id || item.name, enabled: next });
        return;
      }
      if (typeof deps.onToggleMarketplace !== 'function') return;
      button.disabled = true;
      let result;
      try {
        result = await deps.onToggleMarketplace(item, next);
      } catch (err) {
        result = { ok: false, error: String((err && err.message) || err) };
      }
      button.disabled = false;
      if (result && result.ok === false) {
        setRowError(row, result.error || (next ? '켜지 못했습니다' : '끄지 못했습니다'));
        return;
      }
      // 콜백이 아무것도 안 돌려주면(구형 호스트) 성공으로 본다.
      item.enabled = next;
      paint();
    });
    return button;
  }

  function setRowError(row, message) {
    if (!row) return;
    const existing = row.__errorNode;
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    row.__errorNode = null;
    if (!message) return;
    const note = el('div', 'plugin-canvas-manage-error', message);
    note.setAttribute('role', 'status');
    row.appendChild(note);
    row.__errorNode = note;
  }

  function manageRow(item, kind) {
    const row = el('div', 'plugin-canvas-manage-row');
    row.setAttribute(kind === 'marketplace' ? 'data-marketplace-id' : 'data-plugin-id', item.id || item.name);
    row.appendChild(el('div', 'plugin-canvas-manage-name', item.name));
    row.appendChild(el('div', 'plugin-canvas-manage-source', item.source || item.description || ''));
    row.appendChild(el('div', 'plugin-canvas-spacer'));
    // 삭제는 플러그인 행에만 있다. 마켓플레이스는 끄기로 충분하고, 내장 카탈로그를
    // 지우면 되돌릴 화면이 없다.
    if (kind !== 'marketplace' && typeof deps.onPropose === 'function') {
      row.appendChild(actionButton('삭제', 'is-danger', () => openRemoveSheet(item)));
      row.appendChild(el('span', 'plugin-canvas-manage-hint', '승인 후 지웁니다'));
    }
    row.appendChild(toggleButton(item, kind, row));
    if (kind !== 'marketplace') {
      row.appendChild(el('span', 'plugin-canvas-manage-hint', '승인 후 반영됩니다'));
    }
    return row;
  }

  function renderManage() {
    const panel = el('section', 'plugin-canvas-panel plugin-canvas-manage');
    const header = el('div', 'plugin-canvas-header is-manage');
    header.appendChild(el('h1', 'plugin-canvas-title', '플러그인 관리'));
    header.appendChild(el('div', 'plugin-canvas-spacer'));
    const featureFallback = installed.reduce((sum, item) => sum + (Number(item.featureCount) || 0), 0);
    const counts = deps.counts || {};
    const pluginCount = countValue(deps.pluginCount, countValue(counts.plugins, installed.length));
    const featureCount = countValue(deps.featureCount, countValue(counts.features, featureFallback));
    const marketplaceCount = countValue(deps.marketplaceCount, countValue(counts.marketplaces, marketplaces.length));
    const countLabels = [
      ['플러그인', pluginCount, 'is-primary'],
      ['기능', featureCount, ''],
      ['마켓플레이스', marketplaceCount, ''],
    ];
    countLabels.forEach(([label, value, className]) => {
      header.appendChild(el('span', `plugin-canvas-count ${className}`.trim(), `${label} ${value}`));
    });
    // 직접 등록은 허브의 '+ 서버 추가'와 같은 시트다 — 붙여넣은 설정은 제안이
    // 되고, 실행은 승인 카드 하나뿐이다.
    header.appendChild(actionButton('직접 등록', 'is-add', openAddSheet));
    panel.appendChild(header);
    panel.appendChild(el(
      'p',
      'plugin-canvas-description',
      '플러그인만 설치·활성화합니다. 제공 기능은 상세 화면에서 허용하며 Athena 내장 API는 표시하지 않습니다.',
    ));

    const installedList = el('div', 'plugin-canvas-manage-list plugin-canvas-manage-plugins');
    installed.forEach((plugin) => installedList.appendChild(manageRow(plugin, 'plugin')));
    panel.appendChild(installedList);
    panel.appendChild(el('h2', 'plugin-canvas-section-title', '마켓플레이스'));
    const marketplaceList = el('div', 'plugin-canvas-manage-list plugin-canvas-marketplaces');
    marketplaces.forEach((marketplace) => marketplaceList.appendChild(manageRow(marketplace, 'marketplace')));
    panel.appendChild(marketplaceList);
    panel.appendChild(el(
      'p',
      'plugin-canvas-marketplace-note',
      '+ 마켓플레이스 추가 — GitHub·Git URL·로컬 폴더. 등록만으로는 아무것도 실행되지 않습니다 — 설치·활성은 항목별 승인 시트를 거칩니다.',
    ));
    panel.appendChild(renderAudit());
    return panel;
  }

  function sheetFeatureRow(feature, interactive) {
    const row = el('div', 'plugin-canvas-sheet-feature');
    row.setAttribute('data-feature-id', feature.id);
    const copy = el('div', 'plugin-canvas-sheet-feature-copy');
    copy.appendChild(el('div', 'plugin-canvas-sheet-feature-name', feature.name));
    if (feature.description) copy.appendChild(el('div', 'plugin-canvas-sheet-feature-description', feature.description));
    row.appendChild(copy);
    if (interactive) {
      const toggle = el('button', `plugin-canvas-toggle ${feature.allowed ? 'is-on' : 'is-off'}`);
      toggle.type = 'button';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', String(feature.allowed));
      toggle.setAttribute('aria-label', `${feature.name} ${feature.allowed ? '허용 끄기' : '허용 켜기'}`);
      toggle.appendChild(el('span', 'plugin-canvas-toggle-knob'));
      toggle.addEventListener('click', () => {
        feature.allowed = !feature.allowed;
        toggle.className = `plugin-canvas-toggle ${feature.allowed ? 'is-on' : 'is-off'}`;
        toggle.setAttribute('aria-checked', String(feature.allowed));
        toggle.setAttribute('aria-label', `${feature.name} ${feature.allowed ? '허용 끄기' : '허용 켜기'}`);
        refreshAllowedCounts();
      });
      row.appendChild(toggle);
    } else {
      row.appendChild(el('span', 'plugin-canvas-sheet-requested', '요청'));
    }
    return row;
  }

  function findByClassName(className) {
    if (!root) return null;
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      if (String(current.className || '').split(/\s+/).includes(className)) return current;
      // children은 실제 DOM에서 HTMLCollection이라 forEach가 없다(단위테스트의 가짜
      // DOM만 배열이었다) — 인덱스로 돈다. 이걸 forEach로 두면 앱에서만 예외가 나
      // 허용 수가 토글에 반응하지 않는다(2026-08-31 실측).
      const kids = current.children;
      if (kids) for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
    }
    return null;
  }

  function findAllowedCountLabel() {
    return findByClassName('plugin-canvas-sheet-count');
  }

  // 토글 하나가 바뀌면 하단 "허용 N / M"과 헤더 배지를 함께 다시 쓴다.
  function refreshAllowedCounts() {
    if (!activeSheet) return;
    const allowed = allowedFeatures(activeSheet).length;
    const footer = findAllowedCountLabel();
    if (footer) footer.textContent = `허용 ${allowed} / ${activeSheet.features.length}`;
    const badge = findByClassName('is-allowed-count');
    if (badge) badge.textContent = `허용 ${allowed}`;
  }

  // 승인 시트의 [승인]은 설치하지 않는다 — 승인 카드를 만든다. 목록은 승인이
  // 끝난 뒤 호스트의 setData가 갈아끼운다(가짜 행을 만들지 않는다).
  function approveInstall(sheet) {
    propose({
      action: 'install',
      target: sheet.plugin.id || sheet.plugin.name,
      features: sheet.features.map((feature) => feature.name),
    });
    closeSheet();
  }

  function confirmRemove(sheet) {
    propose({ action: 'remove', target: sheet.plugin.id || sheet.plugin.name });
    closeSheet();
  }

  // 저장은 초안과 실제의 차이만 제안으로 만든다 — 켤 것과 끌 것이 한 카드에
  // 함께 실린다(둘 다 있으면 두 동작을 담은 한 장이다).
  function savePermissions(sheet) {
    const target = sheet.plugin.id || sheet.plugin.name;
    const allow = [];
    const revoke = [];
    sheet.features.forEach((feature) => {
      const was = sheet.base[feature.name];
      if (feature.allowed && was !== true) allow.push(feature.name);
      if (!feature.allowed && was === true) revoke.push(feature.name);
    });
    const specs = [];
    if (allow.length) specs.push({ action: 'allow_tools', target, features: allow });
    if (revoke.length) specs.push({ action: 'revoke_tools', target, features: revoke });
    if (specs.length) propose(specs.length === 1 ? specs[0] : specs);
    closeSheet();
  }

  // Paper 플러그인 01 — 기능 허용. 배지 넷은 설치 상태 · 기능 수 · 허용 수 ·
  // 연결 상태다. 마지막 자리에 고정 문구를 넣지 않는 이유: 이 화면에서 사람이
  // 실제로 알아야 하는 건 "지금 이 서버가 붙었는가"이고, 그건 probe만 안다.
  function renderPermissionView() {
    const sheet = activeSheet;
    const plugin = sheet.plugin;
    const panel = el('section', 'plugin-canvas-panel plugin-canvas-permissions-view');
    const header = el('div', 'plugin-canvas-header plugin-canvas-permissions-header');
    header.appendChild(el('h1', 'plugin-canvas-title', plugin.name));
    header.appendChild(el('div', 'plugin-canvas-spacer'));
    const allowed = allowedFeatures(sheet).length;
    [
      ['설치됨', 'is-primary'],
      [`기능 ${sheet.features.length}`, ''],
      [`허용 ${allowed}`, 'is-allowed-count'],
      [plugin.source || '연결 미확인', 'is-health'],
    ].forEach(([label, className]) => {
      header.appendChild(el('span', `plugin-canvas-count ${className}`.trim(), label));
    });
    panel.appendChild(header);
    panel.appendChild(el(
      'p',
      'plugin-canvas-description',
      `기능 허용은 ${plugin.name} 플러그인에만 적용됩니다. Athena 내장 API는 이 목록에 나타나지 않습니다.`,
    ));

    // probe가 실패하면 기능 목록은 비거나 옛 캐시다. 그 사실을 숨기고 토글만
    // 보여주면 "허용했는데 안 된다"가 된다 — 이유를 위에 붙이고 재시도를 준다.
    if (plugin.error) {
      const banner = el('div', 'plugin-canvas-error-banner');
      banner.setAttribute('role', 'alert');
      banner.appendChild(el('span', 'plugin-canvas-error-text', `연결 실패 — ${plugin.error}`));
      banner.appendChild(actionButton('다시 확인', 'is-retry', () => {
        if (typeof deps.onPermission === 'function') deps.onPermission(plugin);
      }));
      panel.appendChild(banner);
    }

    if (sheet.error) panel.appendChild(el('div', 'plugin-canvas-sheet-error', sheet.error));

    // 초안이 실제와 갈렸으면 덮어쓰기 전에 무엇이 달라졌는지 먼저 말한다.
    if (Array.isArray(sheet.divergence) && sheet.divergence.length) {
      const notice = el('div', 'plugin-canvas-draft-divergence');
      notice.setAttribute('role', 'status');
      notice.appendChild(el(
        'span',
        'plugin-canvas-draft-divergence-text',
        `그 사이 바뀐 기능: ${sheet.divergence.join(' · ')}`,
      ));
      notice.appendChild(actionButton('초안대로 저장', 'is-draft-keep', () => savePermissions(sheet)));
      notice.appendChild(actionButton('현재 값으로 초기화', 'is-draft-reset', () => resetDraft(sheet)));
      panel.appendChild(notice);
    }

    panel.appendChild(el('h2', 'plugin-canvas-section-title', '권한 초안'));
    panel.appendChild(el('p', 'plugin-canvas-draft-note', '승인 카드로 확정합니다'));
    const featureList = el('div', 'plugin-canvas-sheet-features plugin-canvas-permission-features');
    if (sheet.features.length) {
      sheet.features.forEach((feature) => featureList.appendChild(sheetFeatureRow(feature, true)));
    } else {
      featureList.appendChild(emptyMessage('노출 기능을 아직 확인하지 못했습니다 · 다시 확인을 누릅니다'));
    }
    panel.appendChild(featureList);

    const footer = el('div', 'plugin-canvas-permission-footer');
    footer.appendChild(el('div', 'plugin-canvas-sheet-count', `허용 ${allowed} / ${sheet.features.length}`));
    footer.appendChild(el('div', 'plugin-canvas-permission-hint', `선택한 기능만 ${plugin.name} 플러그인에 노출됩니다`));
    footer.appendChild(el('div', 'plugin-canvas-spacer'));
    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('플러그인으로', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton('선택 저장', 'is-sheet-confirm', () => savePermissions(sheet)));
    footer.appendChild(actions);
    panel.appendChild(footer);
    panel.appendChild(el(
      'p',
      'plugin-canvas-boundary-note',
      'Kiwoom 시세·주문·계좌와 brain은 Athena 내장 API이므로 플러그인 권한 목록에 표시하지 않습니다.',
    ));
    return panel;
  }

  // 붙여넣기 한 번으로 제안이 만들어진다 — 이 시트는 아무것도 등록하지 않는다.
  // 무엇이 등록될지는 승인 카드가 보여주고, 등록은 그 카드의 [승인]이 한다.
  function renderAddSheetBody(sheet) {
    const body = el('div', 'plugin-canvas-sheet-body');

    const field = el('textarea', 'plugin-canvas-snippet-input');
    field.value = sheet.snippet || '';
    field.setAttribute('rows', '8');
    field.setAttribute('spellcheck', 'false');
    field.setAttribute('aria-label', '서버 스니펫');
    field.placeholder = '{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "some-mcp"]\n    }\n  }\n}';
    field.addEventListener('input', (event) => {
      sheet.snippet = String(event && event.target ? event.target.value : '');
    });
    body.appendChild(field);
    body.appendChild(el('div', 'plugin-canvas-sheet-warning', '등록만으로는 실행되지 않습니다'));
    body.appendChild(el('div', 'plugin-canvas-sheet-warning', '승인 카드로 확정합니다'));

    if (sheet.error) body.appendChild(el('div', 'plugin-canvas-sheet-error', sheet.error));

    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('취소', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton('승인', 'is-sheet-confirm', () => proposeSnippet(sheet)));
    body.appendChild(actions);
    return body;
  }

  // Paper 플러그인 02 — 설치 승인. "미리보기"가 아니라 승인 시점에 실제 등록·
  // 승인·probe가 일어난다. 그래서 무엇을 실행하는지(실행 명령)와 어디에 생기는지
  // (설치 위치)를 승인 전에 전부 보여준다.
  function renderInstallSheetBody(sheet) {
    const plugin = sheet.plugin;
    const body = el('div', 'plugin-canvas-sheet-body');

    body.appendChild(el('h3', 'plugin-canvas-sheet-section-title', '플러그인 정보'));
    const info = el('div', 'plugin-canvas-sheet-info');
    info.appendChild(el('div', 'plugin-canvas-sheet-plugin-name', plugin.name));
    info.appendChild(el('div', 'plugin-canvas-sheet-source', `제공: ${plugin.provider || plugin.source || '출처 미상'}`));
    info.appendChild(el('div', 'plugin-canvas-sheet-plugin-description', `용도: ${plugin.purpose || plugin.description || '-'}`));
    body.appendChild(info);
    body.appendChild(el(
      'div',
      'plugin-canvas-sheet-boundary',
      '설치 후 사용할 기능만 허용되며 Athena 내장 API와 분리됩니다.',
    ));

    body.appendChild(el('h3', 'plugin-canvas-sheet-section-title', '요청 기능'));
    const featureList = el('div', 'plugin-canvas-sheet-features');
    sheet.features.forEach((feature) => featureList.appendChild(sheetFeatureRow(feature, false)));
    body.appendChild(featureList);

    // 실행 명령을 감추면 사람이 승인하는 대상이 이름뿐이 된다. 스니펫 경로와
    // 같은 정보를 카탈로그 설치에서도 보여준다.
    const command = [plugin.command, (Array.isArray(plugin.args) ? plugin.args.join(' ') : '')]
      .filter(Boolean).join(' ');
    if (command) {
      body.appendChild(el('div', 'plugin-canvas-sheet-command', `실행 명령: ${command}`));
    }
    body.appendChild(el('div', 'plugin-canvas-sheet-location', `설치 위치 · 플러그인 모드 > ${plugin.name}`));
    body.appendChild(el('div', 'plugin-canvas-sheet-warning', '승인 카드로 확정합니다'));

    const badges = el('div', 'plugin-canvas-sheet-badges');
    badges.appendChild(el('span', 'plugin-canvas-count', `권한 ${sheet.features.length}개 요청`));
    badges.appendChild(el('span', 'plugin-canvas-count', '설치형 플러그인'));
    body.appendChild(badges);

    if (sheet.error) body.appendChild(el('div', 'plugin-canvas-sheet-error', sheet.error));

    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('거부', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton('승인', 'is-sheet-confirm', () => approveInstall(sheet)));
    body.appendChild(actions);
    return body;
  }

  function renderRemoveSheetBody(sheet) {
    const plugin = sheet.plugin;
    const body = el('div', 'plugin-canvas-sheet-body');
    const info = el('div', 'plugin-canvas-sheet-info');
    info.appendChild(el('div', 'plugin-canvas-sheet-plugin-name', plugin.name));
    if (plugin.source) info.appendChild(el('div', 'plugin-canvas-sheet-source', plugin.source));
    body.appendChild(info);
    body.appendChild(el(
      'div',
      'plugin-canvas-sheet-warning',
      '등록·승인·허용 기능이 함께 지워집니다. 되돌리려면 다시 설치하고 기능을 다시 허용해야 합니다.',
    ));
    body.appendChild(el('div', 'plugin-canvas-sheet-warning', '승인 후 지웁니다'));
    if (sheet.error) body.appendChild(el('div', 'plugin-canvas-sheet-error', sheet.error));
    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('취소', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton('삭제', 'is-sheet-danger', () => confirmRemove(sheet)));
    body.appendChild(actions);
    return body;
  }

  // 배경을 막는 시트는 이 셋뿐이다. 권한(permissions)은 시트가 아니라 캔버스를
  // 통째로 바꾸는 상세 화면이므로 여기 없다(Paper 01).
  const MODAL_SHEET_KINDS = new Set(['install', 'add', 'remove']);

  const SHEET_TITLES = {
    add: () => '서버 추가',
    install: (sheet) => `${sheet.plugin.name} 설치`,
    remove: (sheet) => `${sheet.plugin.name} 삭제`,
  };

  const SHEET_SUBTITLES = {
    add: () => 'Claude 설정 형식의 스니펫을 붙여넣습니다',
    install: () => '설치할 플러그인과 요청 권한을 확인하고 한 번에 하나씩 승인합니다',
    remove: () => '등록과 승인 기록을 함께 지웁니다',
  };

  const SHEET_BODIES = {
    add: renderAddSheetBody,
    install: renderInstallSheetBody,
    remove: renderRemoveSheetBody,
  };

  function renderSheet() {
    const sheet = activeSheet;
    if (!sheet || !MODAL_SHEET_KINDS.has(sheet.kind)) return null;
    const overlay = el('div', 'plugin-canvas-sheet-overlay');
    overlay.setAttribute('data-sheet-kind', sheet.kind);
    const dialog = el('section', `plugin-canvas-sheet plugin-canvas-${sheet.kind}-sheet`);
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const titleId = `plugin-canvas-${sheet.kind}-title`;
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.addEventListener('keydown', (event) => {
      if (!event) return;
      if (event.key === 'Escape') {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab' || typeof dialog.querySelectorAll !== 'function') return;
      const controls = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        first.focus();
      }
    });

    const header = el('div', 'plugin-canvas-sheet-header');
    const title = el('h2', 'plugin-canvas-sheet-title', SHEET_TITLES[sheet.kind](sheet));
    title.setAttribute('id', titleId);
    header.appendChild(title);
    header.appendChild(el('div', 'plugin-canvas-sheet-subtitle', SHEET_SUBTITLES[sheet.kind](sheet)));
    dialog.appendChild(header);
    dialog.appendChild(SHEET_BODIES[sheet.kind](sheet));
    overlay.appendChild(dialog);
    return overlay;
  }

  // --- 승인 카드 ---------------------------------------------------------------
  // 사람의 클릭 하나가 유일한 실행 지점이다. 모델이 낸 것도, 허브 버튼이 낸 것도
  // 여기로 모이고, 출처 라벨이 둘을 구분한다(만든 주체를 속이지 않는다).
  function proposalState(entry) {
    if (entry.done) return 'done';
    if (isProposalStale(entry.envelope, proposalRevision)) return 'stale';
    return 'pending';
  }

  function proposalStatusText(entry, state) {
    if (state === 'done') return PROPOSAL_STATUS[entry.done] || '처리됨';
    if (state === 'stale') return '만료됨';
    return entry.busy ? '처리 중' : '제안 대기';
  }

  async function respond(entry, decision) {
    if (entry.busy || entry.done) return;
    entry.busy = true;
    render();
    const callback = decision === 'approve' ? deps.onApproveProposal : deps.onRejectProposal;
    let result = null;
    try {
      if (typeof callback === 'function') result = await callback(entry.envelope);
    } catch {
      result = null;
    }
    entry.busy = false;
    // 경로가 연결되지 않았거나 던졌으면 성공이라고 말하지 않는다.
    entry.done = (result && result.kind) || (decision === 'approve' ? 'failed' : 'rejected');
    handled.add(entry.envelope.proposal_id);
    render();
  }

  // 만료 카드를 지우는 것은 거부가 아니다 — 채팅에 `그대로 뒀습니다`를 남기지
  // 않는다. 대기 목록에서만 빼고 사람이 다시 요청하게 둔다.
  function dismissProposal(entry) {
    handled.add(entry.envelope.proposal_id);
    proposals = proposals.filter((row) => row !== entry);
    if (typeof deps.onDismissProposal === 'function') deps.onDismissProposal(entry.envelope);
    render();
  }

  // 버튼은 전부 실제 <button>이라 Tab·Enter로 닿는다. 클릭 영역 32px은
  // .plugin-canvas-proposal-action 하나로 CSS가 준다(US-006).
  function proposalButton(label, modifier, onClick) {
    return actionButton(label, `plugin-canvas-proposal-action ${modifier}`, onClick);
  }

  function proposalCard(entry) {
    const copy = cardCopy(entry.envelope);
    const state = proposalState(entry);
    const card = el('article', 'plugin-canvas-proposal');
    card.setAttribute('data-proposal-id', entry.envelope.proposal_id);
    card.setAttribute('data-proposal-state', state);

    const head = el('div', 'plugin-canvas-proposal-head');
    head.appendChild(el('span', 'plugin-canvas-proposal-source', copy.sourceLabel));
    head.appendChild(el('h3', 'plugin-canvas-proposal-title', copy.title));
    const status = el('span', 'agent-mode', proposalStatusText(entry, state));
    status.setAttribute('role', 'status');
    head.appendChild(status);
    card.appendChild(head);

    copy.lines.forEach((line) => card.appendChild(el('div', 'plugin-canvas-proposal-line', line)));
    if (copy.reasonLine) card.appendChild(el('div', 'plugin-canvas-proposal-reason', copy.reasonLine));
    card.appendChild(el('div', 'plugin-canvas-proposal-note', '허브의 설치 버튼도 이 카드로 들어옵니다'));

    const actions = el('div', 'plugin-canvas-proposal-actions');
    const reject = proposalButton('거부', 'is-proposal-reject', () => { void respond(entry, 'reject'); });
    const approve = proposalButton('승인', 'is-proposal-approve', () => { void respond(entry, 'approve'); });
    if (state !== 'pending' || entry.busy) approve.disabled = true;
    if (state === 'done' || entry.busy) reject.disabled = true;
    actions.appendChild(reject);
    actions.appendChild(approve);
    // 만료는 승인 직전에도(메인이 kind='stale'로 돌려준다) 드러난다 — 그때도
    // 사람이 할 수 있는 일은 같다. 두 경로에 같은 칩을 준다.
    if (state === 'stale' || entry.done === 'stale') {
      actions.appendChild(proposalButton('다시 제안받기', 'is-proposal-again', () => dismissProposal(entry)));
    }
    card.appendChild(actions);
    return card;
  }

  function renderProposals() {
    if (!proposals.length) return null;
    const list = el('section', 'plugin-canvas-proposals');
    proposals.forEach((entry) => list.appendChild(proposalCard(entry)));
    return list;
  }

  function render() {
    if (!mounted) return;
    hubLists = null;
    clear(root);
    root.setAttribute('data-view', view);
    const cards = renderProposals();
    if (cards) {
      if (activeSheet && MODAL_SHEET_KINDS.has(activeSheet.kind)) {
        cards.setAttribute('aria-hidden', 'true');
        cards.setAttribute('inert', '');
      }
      root.appendChild(cards);
    }
    const panel = activeSheet && activeSheet.kind === 'permissions'
      ? renderPermissionView()
      : (view === 'manage' ? renderManage() : renderHub());
    if (activeSheet && MODAL_SHEET_KINDS.has(activeSheet.kind)) {
      panel.setAttribute('aria-hidden', 'true');
      panel.setAttribute('inert', '');
    }
    root.appendChild(panel);
    const sheet = renderSheet();
    if (sheet) {
      root.appendChild(sheet);
      if (typeof sheet.querySelector === 'function') {
        queueMicrotask(() => {
          const firstControl = sheet.querySelector('.plugin-canvas-action.is-sheet-cancel');
          if (firstControl && typeof firstControl.focus === 'function') firstControl.focus();
        });
      }
    }
  }

  function mount() {
    if (!root) {
      root = el('div', 'plugin-canvas');
      container.appendChild(root);
    }
    mounted = true;
    render();
  }

  // 사이드바는 모드 진입마다 setView('hub')를 부른다 — 그때 열려 있던 권한 화면의
  // 토글을 그냥 버리면 사람이 만든 값이 사라진다. 초안으로 굳혀 두고 다음 진입에
  // 되살린다(H4).
  function setView(nextView) {
    const normalized = nextView === 'manage' ? 'manage' : 'hub';
    if (normalized === view && mounted && !activeSheet) return;
    keepDraft();
    view = normalized;
    activeSheet = null;
    // 관리 뷰로 들어올 때마다 기록을 다시 읽는다 — 그 사이 실행된 것이 빠지면
    // "안 돌았다"로 읽힌다. 진행 중인 읽기가 있으면 loadAudit이 알아서 비킨다.
    if (normalized === 'manage' && !auditLoading) {
      auditEntries = null;
      auditError = false;
      auditReason = '';
    }
    render();
  }

  function setSearch(nextSearch) {
    search = String(nextSearch || '');
    if (view !== 'hub') view = 'hub';
    render();
  }

  // 마운트 뒤 목록을 실제 데이터로 갈아끼운다. 호스트(canvas.js)가 athena:mcp-list
  // 결과를 받을 때마다, 그리고 probe로 도구 목록이 늦게 도착할 때마다 부른다 —
  // 생성 시점 한 번만 캡처하면 등록·승인·삭제 뒤 화면이 옛 목록에 머문다.
  // 열려 있는 시트가 있으면 같은 행의 최신 스냅샷으로 다시 만든다(늦게 온 도구
  // 목록이 그 시트에 그대로 반영돼야 하므로).
  function replaceRows(target, next) {
    if (!Array.isArray(next)) return;
    target.length = 0;
    target.push(...cloneRows(next));
  }

  function setData(next) {
    if (!next) return;
    if (typeof next.restartRequired === 'boolean') restartRequired = next.restartRequired;
    replaceRows(installed, next.installed);
    replaceRows(recommended, next.recommended);
    replaceRows(marketplaces, next.marketplaces);
    // 'add' 시트에는 plugin이 없다 — 스니펫을 붙여넣는 중에 목록 갱신이
    // 도착하면 여기서 터졌다(activeSheet.plugin.id).
    if (activeSheet && activeSheet.plugin) {
      const openId = activeSheet.plugin.id || activeSheet.plugin.name;
      const fresh = installed.concat(recommended)
        .find((row) => (row.id || row.name) === openId);
      if (fresh && activeSheet.kind === 'permissions') {
        // 새 목록 위에 사람이 만든 초안을 다시 얹는다 — 갱신이 도착했다고 해서
        // 저장 전 토글을 지우지 않는다(그 사이 갈린 기능은 발산으로 알린다).
        keepDraft();
        openPermissionSheet(fresh);
        return;
      }
      if (fresh) {
        activeSheet = {
          ...activeSheet,
          plugin: fresh,
          features: featureRowsFor(fresh, activeSheet.kind === 'install'),
        };
      }
    }
    render();
  }

  // 호스트가 봉투를 넣는 유일한 함수. 판번호는 만료 판정에만 쓰인다.
  function setProposals(list, options) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'revision')) {
      proposalRevision = options.revision === undefined ? null : options.revision;
    }
    const previous = new Map(proposals.map((entry) => [entry.envelope.proposal_id, entry]));
    proposals = (Array.isArray(list) ? list : [])
      .filter((envelope) => envelope && envelope.proposal_id && !handled.has(envelope.proposal_id))
      .map((envelope) => previous.get(envelope.proposal_id) || { envelope, busy: false, done: null });
    render();
  }

  function getState() {
    return {
      view,
      search,
      installed: cloneRows(installed),
      recommended: cloneRows(recommended),
      marketplaces: cloneRows(marketplaces),
      activeSheet: activeSheet ? activeSheet.kind : null,
      revision: proposalRevision,
      proposals: proposals.map((entry) => ({
        id: entry.envelope.proposal_id,
        state: proposalState(entry),
        kind: entry.done || null,
      })),
      // 저장 전 토글은 모드를 나가도 남는다 — 그 사실을 상태로도 드러낸다.
      permissionDraft: permissionDraft
        ? { pluginId: permissionDraft.pluginId, draft: { ...permissionDraft.draft } }
        : null,
      divergence: (activeSheet && Array.isArray(activeSheet.divergence)) ? [...activeSheet.divergence] : [],
    };
  }

  return { mount, setView, setSearch, setData, setProposals, getState };
}

const __exports = {
  createPluginCanvas,
  SAMPLE_INSTALLED,
  SAMPLE_RECOMMENDED,
  SAMPLE_MARKETPLACES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.PluginCanvas = __exports;
}

})();
