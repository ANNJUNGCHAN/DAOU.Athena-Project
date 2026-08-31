// Paper 플러그인 페이지 01~04 — 기능 허용 · 설치 승인 · 허브 · 관리.
//
// 이 파일은 설치 파이프라인이나 저장소를 가정하지 않는다. 화면은 전달받은
// 목록만 그리고, 권한·설치·활성화 의도는 콜백으로 상위 셸에 돌려준다.
//
// 실제 설치는 MCP 서버 등록이다(canvas.js가 athena:mcp-* IPC로 잇는다):
// 카탈로그 승인 또는 스니펫 붙여넣기 → 등록 → 승인 → probe로 노출 도구 확인 →
// 도구별 허용 → 삭제. 아래 SAMPLE_* 는 **호스트가 아무 목록도 넘기지 않았을
// 때만** 쓰는 단위테스트용 샘플이다. 실제 셸은 언제나 명시적으로 배열을
// 넘기므로(빈 배열이라도) 앱 화면에 이 샘플이 뜨는 경로는 없다 — 설치된 적 없는
// 플러그인을 설치된 것처럼 보여주지 않기 위한 경계다. 값은 lib/plugin-catalog.js
// 와 같은 실서버를 쓴다(없는 플러그인 이름을 샘플로도 남기지 않는다).
(function () {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
    return { mount() {}, setView() {}, setSearch() {}, getState: () => ({ view: 'hub', search: '' }) };
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
    // 목록에 들어가고(canvas.js pluginSaveTools가 막고 있는 그 경로), 화면에는
    // "허용 1 / 1"이 떠서 다 된 것처럼 보인다. 비어 있으면 비어 있다고 쓴다.
    const features = Array.isArray(plugin.features) ? plugin.features : [];
    return features.map((feature, index) => ({
      id: feature.id || `feature-${index + 1}`,
      name: feature.name || feature.label || `기능 ${index + 1}`,
      description: feature.description || '',
      allowed: feature.allowed !== false,
    }));
  }

  // --- MCP 서버 추가(스니펫 붙여넣기) ---------------------------------------
  // Claude 커넥터와 같은 순서다: 스니펫 → 무엇이 등록되는지 확인 → 승인.
  // 호스트가 실제 athena:mcp-stage-snippet/register/approve/remove를 소유한다.
  function openAddSheet() {
    activeSheet = { kind: 'add', snippet: '', staged: null, error: null, busy: false };
    render();
  }

  async function runSheetStep(sheet, run, fallbackError) {
    if (sheet.busy) return null;
    sheet.busy = true;
    sheet.error = null;
    render();
    let result;
    try {
      result = await run();
    } catch (err) {
      result = { ok: false, error: String((err && err.message) || err) };
    }
    // 사용자가 그 사이 시트를 닫았으면 늦게 온 결과로 화면을 되돌리지 않는다.
    if (activeSheet !== sheet) return null;
    sheet.busy = false;
    if (!result || !result.ok) {
      sheet.error = (result && result.error) || fallbackError;
      render();
      return null;
    }
    return result;
  }

  async function stageSnippet(sheet) {
    if (!String(sheet.snippet || '').trim()) {
      sheet.error = 'Claude 설정 스니펫을 붙여넣습니다';
      render();
      return;
    }
    const result = await runSheetStep(
      sheet,
      () => (typeof deps.onStageSnippet === 'function'
        ? deps.onStageSnippet(sheet.snippet)
        : Promise.resolve({ ok: false, error: '설치 경로가 연결되지 않았다' })),
      '스니펫을 해석하지 못했다',
    );
    if (!result) return;
    const staged = Array.isArray(result.staged) ? result.staged : [];
    if (!staged.length) {
      sheet.error = '등록된 서버가 없다 — 스니펫 형식을 확인한다';
      render();
      return;
    }
    sheet.staged = staged;
    render();
  }

  async function approveStaged(sheet) {
    const result = await runSheetStep(
      sheet,
      () => (typeof deps.onApproveServer === 'function'
        ? deps.onApproveServer(sheet.staged)
        : Promise.resolve({ ok: false, error: '승인 경로가 연결되지 않았다' })),
      '승인에 실패했다',
    );
    if (!result) return;
    activeSheet = null;
    render();
  }

  // stage는 미리보기가 아니라 실제 등록까지 한다(mcp-cli.js stageSnippet 주석:
  // 파이썬 백엔드에 dry-run이 없다). 승인 없이 닫으면 미승인 서버가 레지스트리에
  // 남으므로 되돌리기를 호스트에 맡긴다 — 취소가 흔적을 남기면 안 된다.
  function cancelAddSheet(sheet) {
    if (sheet.staged && typeof deps.onDiscardStaged === 'function') {
      deps.onDiscardStaged(sheet.staged);
    }
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
    activeSheet = { kind: 'permissions', plugin, features: featureRowsFor(plugin, false) };
    render();
  }

  // 삭제는 되돌릴 수 없다(등록·승인·허용 목록이 함께 사라진다). 목록 행의 클릭
  // 한 번으로 지우지 않고 무엇이 사라지는지 먼저 보여준다.
  function openRemoveSheet(plugin) {
    activeSheet = {
      kind: 'remove',
      plugin,
      error: null,
      busy: false,
      returnFocusPluginId: plugin.id || plugin.name,
    };
    render();
  }

  function closeSheet() {
    const returnFocusPluginId = activeSheet && activeSheet.returnFocusPluginId;
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

  // 토글은 화면 상태가 아니라 실제 승인 상태다(플러그인 = consent approve/revoke,
  // 마켓플레이스 = 추천 노출). 그래서 낙관적으로 켜 두고 끝내지 않는다 — 호스트가
  // 실패를 돌려주면 원래 자리로 되돌리고 이유를 같은 행에 붙인다. 되돌리지 않으면
  // "켰는데 대화에서 안 쓰인다"가 화면상으로는 켜져 보인다.
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
      const previous = !!item.enabled;
      const next = !previous;
      item.enabled = next;
      paint();
      setRowError(row, null);
      const callback = kind === 'marketplace' ? deps.onToggleMarketplace : deps.onTogglePlugin;
      if (typeof callback !== 'function') return;
      button.disabled = true;
      let result;
      try {
        result = await callback(item, next);
      } catch (err) {
        result = { ok: false, error: String((err && err.message) || err) };
      }
      button.disabled = false;
      // 콜백이 아무것도 안 돌려주면(구형 호스트) 성공으로 본다 — 되돌릴 근거가 없다.
      if (result && result.ok === false) {
        item.enabled = previous;
        paint();
        setRowError(row, result.error || (next ? '켜지 못했습니다' : '끄지 못했습니다'));
      }
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
    if (kind !== 'marketplace' && typeof deps.onRemovePlugin === 'function') {
      row.appendChild(actionButton('삭제', 'is-danger', () => openRemoveSheet(item)));
    }
    row.appendChild(toggleButton(item, kind, row));
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

  // 승인 = 실제 등록·승인·probe다. 결과를 기다리지 않고 목록에 밀어 넣으면
  // 설치에 실패한 서버가 "설치됨"으로 남는다 — 호스트가 성공을 돌려준 뒤에만
  // 닫고, 목록 갱신은 호스트의 setData에 맡긴다(가짜 행을 만들지 않는다).
  async function approveInstall(sheet) {
    const features = allowedFeatures(sheet);
    const result = await runSheetStep(
      sheet,
      () => (typeof deps.onApproveInstall === 'function'
        ? deps.onApproveInstall({ ...sheet.plugin }, features)
        : Promise.resolve({ ok: false, error: '설치 경로가 연결되지 않았습니다' })),
      '설치에 실패했습니다',
    );
    if (!result) return;
    // 호스트가 setData로 목록을 갈아끼우기 전이라도 추천에서는 즉시 뺀다 —
    // 방금 설치한 항목이 추천에 남아 있으면 두 번 설치하려 든다.
    const index = recommended.findIndex((plugin) => plugin.id === sheet.plugin.id);
    if (index >= 0) recommended.splice(index, 1);
    activeSheet = null;
    render();
  }

  async function confirmRemove(sheet) {
    const result = await runSheetStep(
      sheet,
      () => (typeof deps.onRemovePlugin === 'function'
        ? deps.onRemovePlugin({ ...sheet.plugin })
        : Promise.resolve({ ok: false, error: '삭제 경로가 연결되지 않았습니다' })),
      '삭제에 실패했습니다',
    );
    if (!result) return;
    activeSheet = null;
    render();
  }

  // 저장은 allow/disallow CLI 호출이다 — 실패할 수 있다. 결과를 안 보고 화면을
  // 닫으면 "저장했는데 허용이 안 돼 있다"가 된다(설치·삭제와 같은 규칙).
  async function savePermissions(sheet) {
    const features = allowedFeatures(sheet);
    const snapshot = sheet.features.map((feature) => ({ ...feature }));
    const result = await runSheetStep(
      sheet,
      async () => {
        if (typeof deps.onSavePermissions !== 'function') return { ok: true };
        const outcome = await deps.onSavePermissions({ ...sheet.plugin }, features);
        // 명시적으로 실패라고 말한 경우에만 실패다 — 아무것도 돌려주지 않는
        // 호스트(구형 배선)를 조용한 실패로 만들지 않는다.
        return (outcome && outcome.ok === false) ? outcome : { ok: true };
      },
      '허용 설정을 저장하지 못했습니다',
    );
    if (!result) return;
    sheet.plugin.features = snapshot;
    sheet.plugin.featureCount = snapshot.length;
    activeSheet = null;
    render();
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
    actions.appendChild(actionButton(sheet.busy ? '저장하는 중…' : '선택 저장', 'is-sheet-confirm', () => { void savePermissions(sheet); }));
    footer.appendChild(actions);
    panel.appendChild(footer);
    panel.appendChild(el(
      'p',
      'plugin-canvas-boundary-note',
      'Kiwoom 시세·주문·계좌와 brain은 Athena 내장 API이므로 플러그인 권한 목록에 표시하지 않습니다.',
    ));
    return panel;
  }

  function stagedServerBlock(server) {
    const block = el('div', 'plugin-canvas-sheet-info');
    block.appendChild(el('div', 'plugin-canvas-sheet-plugin-name', server.alias));
    if (server.originalName && server.originalName !== server.alias) {
      block.appendChild(el('div', 'plugin-canvas-sheet-source', `스니펫 이름: ${server.originalName} → 별칭 ${server.alias}`));
    }
    block.appendChild(el(
      'div',
      'plugin-canvas-sheet-plugin-description',
      [server.command, (Array.isArray(server.args) ? server.args.join(' ') : '')].filter(Boolean).join(' '),
    ));
    // 값은 절대 싣지 않는다 — mcp-cli.js가 키 이름만 돌려준다(비밀은 safestorage).
    if (Array.isArray(server.envKeys) && server.envKeys.length) {
      block.appendChild(el('div', 'plugin-canvas-sheet-source', `환경변수 키: ${server.envKeys.join(', ')}`));
    }
    (Array.isArray(server.risks) ? server.risks : []).forEach((risk) => {
      block.appendChild(el('div', 'plugin-canvas-sheet-warning', risk));
    });
    return block;
  }

  function renderAddSheetBody(sheet) {
    const body = el('div', 'plugin-canvas-sheet-body');

    if (!sheet.staged) {
      const field = el('textarea', 'plugin-canvas-snippet-input');
      field.value = sheet.snippet || '';
      field.setAttribute('rows', '8');
      field.setAttribute('spellcheck', 'false');
      field.setAttribute('aria-label', 'MCP 서버 스니펫');
      field.placeholder = '{\n  "mcpServers": {\n    "server-name": {\n      "command": "npx",\n      "args": ["-y", "some-mcp"]\n    }\n  }\n}';
      field.addEventListener('input', (event) => {
        sheet.snippet = String(event && event.target ? event.target.value : '');
      });
      body.appendChild(field);
      body.appendChild(el(
        'div',
        'plugin-canvas-sheet-warning',
        '분석하면 서버가 레지스트리에 등록되지만 승인 전에는 실행되지 않습니다. 취소하면 등록을 되돌립니다.',
      ));
    } else {
      body.appendChild(el('h3', 'plugin-canvas-sheet-section-title', '등록할 서버'));
      sheet.staged.forEach((server) => body.appendChild(stagedServerBlock(server)));
      body.appendChild(el(
        'div',
        'plugin-canvas-sheet-warning',
        '승인하면 서버를 한 번 실행해 노출 도구를 확인합니다. 도구는 그 뒤 하나씩 허용합니다.',
      ));
    }

    if (sheet.error) body.appendChild(el('div', 'plugin-canvas-sheet-error', sheet.error));

    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('취소', 'is-sheet-cancel', () => cancelAddSheet(sheet)));
    actions.appendChild(sheet.staged
      ? actionButton(sheet.busy ? '승인하는 중…' : '승인', 'is-sheet-confirm', () => { void approveStaged(sheet); })
      : actionButton(sheet.busy ? '분석하는 중…' : '분석', 'is-sheet-confirm', () => { void stageSnippet(sheet); }));
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
    body.appendChild(el(
      'div',
      'plugin-canvas-sheet-warning',
      `승인하면 ${plugin.name} 플러그인이 설치되며, 허용한 기능만 현재 대화에서 사용할 수 있습니다.`,
    ));

    const badges = el('div', 'plugin-canvas-sheet-badges');
    badges.appendChild(el('span', 'plugin-canvas-count', `권한 ${sheet.features.length}개 요청`));
    badges.appendChild(el('span', 'plugin-canvas-count', '설치형 플러그인'));
    body.appendChild(badges);

    if (sheet.error) body.appendChild(el('div', 'plugin-canvas-sheet-error', sheet.error));

    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('거부', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton(sheet.busy ? '설치하는 중…' : '승인', 'is-sheet-confirm', () => { void approveInstall(sheet); }));
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
    if (sheet.error) body.appendChild(el('div', 'plugin-canvas-sheet-error', sheet.error));
    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('취소', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton(sheet.busy ? '삭제하는 중…' : '삭제', 'is-sheet-danger', () => { void confirmRemove(sheet); }));
    body.appendChild(actions);
    return body;
  }

  // 배경을 막는 시트는 이 셋뿐이다. 권한(permissions)은 시트가 아니라 캔버스를
  // 통째로 바꾸는 상세 화면이므로 여기 없다(Paper 01).
  const MODAL_SHEET_KINDS = new Set(['install', 'add', 'remove']);

  const SHEET_TITLES = {
    add: () => 'MCP 서버 추가',
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

  function render() {
    if (!mounted) return;
    hubLists = null;
    clear(root);
    root.setAttribute('data-view', view);
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

  function setView(nextView) {
    const normalized = nextView === 'manage' ? 'manage' : 'hub';
    if (normalized === view && mounted) return;
    view = normalized;
    activeSheet = null;
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

  function getState() {
    return {
      view,
      search,
      installed: cloneRows(installed),
      recommended: cloneRows(recommended),
      marketplaces: cloneRows(marketplaces),
      activeSheet: activeSheet ? activeSheet.kind : null,
    };
  }

  return { mount, setView, setSearch, setData, getState };
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
