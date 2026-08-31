// Paper 47/48 — 플러그인 허브·관리 캔버스.
//
// 이 파일은 설치 파이프라인이나 저장소를 가정하지 않는다. 화면은 전달받은
// 목록만 그리고, 권한·설치·활성화 의도는 콜백으로 상위 셸에 돌려준다.
//
// 실제 설치는 MCP 서버 등록이다(canvas.js가 athena:mcp-* IPC로 잇는다) —
// Claude 커넥터와 같은 흐름: 스니펫 붙여넣기 → 노출 도구 확인 → 승인 →
// 연결 확인 → 도구별 허용 → 제거. 아래 SAMPLE_* 는 **호스트가 아무 목록도
// 넘기지 않았을 때만** 쓰는 단위테스트용 샘플이다. 실제 셸은 언제나 명시적으로
// 배열을 넘기므로(빈 배열이라도) 앱 화면에 이 샘플이 뜨는 경로는 없다 —
// 설치된 적 없는 플러그인을 설치된 것처럼 보여주지 않기 위한 경계다.
(function () {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SAMPLE_INSTALLED = Object.freeze([
  Object.freeze({
    id: 'dart',
    name: 'DART 전자공시',
    description: '공시 원문·재무제표 · UI 권한 초안',
    source: 'marketplace · athena-official',
    enabled: true,
    featureCount: 4,
    features: [
      { id: 'disclosures', name: '공시 목록·원문 조회', description: '기업·기간별 공시 목록과 원문을 읽습니다', allowed: true },
      { id: 'company-search', name: '회사·보고서 검색', description: '회사 고유번호와 보고서 유형을 검색합니다', allowed: true },
      { id: 'financial-statements', name: '재무제표 조회', description: '표준 재무제표와 주요 계정 값을 읽습니다', allowed: true },
      { id: 'attachments', name: '첨부 문서 다운로드', description: '사용자가 요청한 첨부 파일만 가져옵니다 · 기본 OFF', allowed: false },
    ],
  }),
  Object.freeze({
    id: 'google-sheets',
    name: 'Google Sheets 내보내기',
    description: '계좌·체결 백업 · UI 권한 초안',
    source: '로컬 폴더',
    enabled: false,
    featureCount: 4,
    features: [
      { id: 'account-export', name: '계좌 잔고 내보내기', description: '선택한 계좌 잔고를 시트에 씁니다', allowed: true },
      { id: 'fills-export', name: '체결 내역 내보내기', description: '주문 체결 내역을 시트에 씁니다', allowed: true },
      { id: 'scheduled-backup', name: '정기 백업', description: '허용한 주기로 백업을 갱신합니다', allowed: true },
      { id: 'overwrite', name: '기존 시트 덮어쓰기', description: '동일한 범위의 기존 값을 교체합니다 · 기본 OFF', allowed: false },
    ],
  }),
]);

const SAMPLE_RECOMMENDED = Object.freeze([
  Object.freeze({ id: 'pdf-report', name: 'PDF 리포트 분석', description: '리서치·사업보고서 PDF를 카드로', source: 'marketplace · athena-official', requestedFeatures: ['PDF 문서 읽기', '표·본문 추출', '분석 카드 생성'] }),
  Object.freeze({ id: 'naver-finance-news', name: '네이버 금융 뉴스', description: '종목 뉴스·리서치를 대화로', source: 'marketplace · athena-official', requestedFeatures: ['종목 뉴스 검색', '기사 본문 읽기', '대화에 출처 첨부'] }),
  Object.freeze({ id: 'telegram-alerts', name: '텔레그램 알림', description: '감시 발화·체결을 폰으로', source: 'marketplace · athena-official', requestedFeatures: ['감시 발화 전송', '체결 알림 전송', '봇 연결 상태 확인'] }),
  Object.freeze({ id: 'broker-research', name: '증권사 리서치', description: '리포트 원문·목표가 변화를 요약', source: 'marketplace · athena-official', requestedFeatures: ['리포트 검색', '원문 읽기', '목표가 변화 요약'] }),
  Object.freeze({ id: 'earnings-calendar', name: '실적 캘린더', description: '보유·관심 종목의 실적 일정', source: 'marketplace · athena-official', requestedFeatures: ['실적 일정 조회', '관심 종목 연결', '일정 알림 생성'] }),
  Object.freeze({ id: 'krx-data', name: 'KRX 정보데이터', description: '지수·업종·수급 통계 원천', source: 'marketplace · athena-official', requestedFeatures: ['지수 통계 조회', '업종 통계 조회', '수급 통계 조회'] }),
]);

const SAMPLE_MARKETPLACES = Object.freeze([
  Object.freeze({
    id: 'athena-official',
    name: 'athena-official',
    description: 'github.com/daou/athena-plugins · 업그레이드 가능',
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
      card.appendChild(actionButton('도구 허용', 'is-primary', () => {
        if (typeof deps.onPermission === 'function') deps.onPermission(plugin);
        openPermissionSheet(plugin);
      }));
    } else {
      card.appendChild(actionButton('설치 미리보기', 'is-secondary', () => {
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
    const features = Array.isArray(plugin.features) && plugin.features.length
      ? plugin.features
      : [{ id: 'plugin-access', name: plugin.description || '플러그인 기능', description: '', allowed: true }];
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
    if (installedRows.length) installedRows.forEach((plugin) => hubLists.installedGrid.appendChild(pluginCard(plugin, 'installed')));
    else hubLists.installedGrid.appendChild(emptyMessage('검색과 일치하는 설치 플러그인이 없습니다'));
    if (recommendedRows.length) recommendedRows.forEach((plugin) => hubLists.recommendedGrid.appendChild(pluginCard(plugin, 'recommended')));
    else hubLists.recommendedGrid.appendChild(emptyMessage('검색과 일치하는 추천 플러그인이 없습니다'));
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
      '플러그인은 MCP 서버입니다. 등록한 서버의 도구를 하나씩 허용해 대화에서 쓰게 합니다. Kiwoom·brain은 Athena 내장 API라 여기 표시하지 않습니다.',
    ));

    if (restartRequired) {
      panel.appendChild(el(
        'div',
        'plugin-canvas-restart-notice',
        '이번에 바꾼 서버는 Athena를 다시 시작한 뒤의 대화부터 적용됩니다. 진행 중인 대화에는 아직 반영되지 않았습니다.',
      ));
    }
    panel.appendChild(el('h2', 'plugin-canvas-section-title', '등록된 서버'));
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

  function toggleButton(item, kind) {
    const button = el('button', `plugin-canvas-toggle ${item.enabled ? 'is-on' : 'is-off'}`);
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', `${item.name} UI 초안 ${item.enabled ? '끄기' : '켜기'}`);
    button.setAttribute('aria-checked', String(Boolean(item.enabled)));
    button.appendChild(el('span', 'plugin-canvas-toggle-knob'));
    button.addEventListener('click', () => {
      item.enabled = !item.enabled;
      button.className = `plugin-canvas-toggle ${item.enabled ? 'is-on' : 'is-off'}`;
      button.setAttribute('aria-checked', String(item.enabled));
      button.setAttribute('aria-label', `${item.name} UI 초안 ${item.enabled ? '끄기' : '켜기'}`);
      const callback = kind === 'marketplace' ? deps.onToggleMarketplace : deps.onTogglePlugin;
      if (typeof callback === 'function') callback(item, item.enabled);
    });
    return button;
  }

  function manageRow(item, kind) {
    const row = el('div', 'plugin-canvas-manage-row');
    row.setAttribute(kind === 'marketplace' ? 'data-marketplace-id' : 'data-plugin-id', item.id || item.name);
    row.appendChild(el('div', 'plugin-canvas-manage-name', item.name));
    row.appendChild(el('div', 'plugin-canvas-manage-source', item.source || item.description || ''));
    row.appendChild(el('div', 'plugin-canvas-spacer'));
    row.appendChild(toggleButton(item, kind));
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
      '플러그인 UI 세션의 설치·활성 초안을 관리합니다. 제공 기능은 상세 화면에서 허용하며 Athena 내장 API는 표시하지 않습니다.',
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
      '+ 마켓플레이스 추가 — GitHub·Git URL·로컬 폴더. 이 화면의 변경만으로 실제 플러그인이 실행되지는 않습니다.',
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

  function approveInstall(sheet) {
    const features = allowedFeatures(sheet);
    installed.push({
      ...sheet.plugin,
      enabled: true,
      featureCount: sheet.features.length,
      features: sheet.features.map((feature) => ({ ...feature })),
      description: `${sheet.plugin.description || sheet.plugin.name} · UI 설치 초안`,
    });
    const index = recommended.findIndex((plugin) => plugin.id === sheet.plugin.id);
    if (index >= 0) recommended.splice(index, 1);
    if (typeof deps.onApproveInstall === 'function') deps.onApproveInstall({ ...sheet.plugin }, features);
    activeSheet = null;
    render();
  }

  function savePermissions(sheet) {
    const features = allowedFeatures(sheet);
    sheet.plugin.features = sheet.features.map((feature) => ({ ...feature }));
    sheet.plugin.featureCount = sheet.features.length;
    if (typeof deps.onSavePermissions === 'function') deps.onSavePermissions({ ...sheet.plugin }, features);
    activeSheet = null;
    render();
  }

  function renderPermissionView() {
    const sheet = activeSheet;
    const panel = el('section', 'plugin-canvas-panel plugin-canvas-permissions-view');
    const header = el('div', 'plugin-canvas-header plugin-canvas-permissions-header');
    header.appendChild(el('h1', 'plugin-canvas-title', sheet.plugin.name));
    header.appendChild(el('div', 'plugin-canvas-spacer'));
    const allowed = allowedFeatures(sheet).length;
    [
      // 실제 등록·승인·핸드셰이크가 끝난 서버에까지 "UI 초안"을 붙이지 않는다 —
      // 호스트가 넣어준 연결 상태(source)를 그대로 쓴다.
      [sheet.plugin.source || '연결 미확인', 'is-primary'],
      [`기능 ${sheet.features.length}`, ''],
      [`허용 ${allowed}`, 'is-allowed-count'],
    ].forEach(([label, className]) => {
      header.appendChild(el('span', `plugin-canvas-count ${className}`.trim(), label));
    });
    panel.appendChild(header);
    panel.appendChild(el(
      'p',
      'plugin-canvas-description',
      `${sheet.plugin.description || '이 서버에서 대화에 노출할 도구만 선택합니다.'} · 허용한 도구만 대화에서 호출됩니다.`,
    ));

    const featureList = el('div', 'plugin-canvas-sheet-features plugin-canvas-permission-features');
    sheet.features.forEach((feature) => featureList.appendChild(sheetFeatureRow(feature, true)));
    panel.appendChild(featureList);

    const footer = el('div', 'plugin-canvas-permission-footer');
    footer.appendChild(el('div', 'plugin-canvas-sheet-count', `허용 ${allowed} / ${sheet.features.length}`));
    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('플러그인으로', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton('초안 저장', 'is-sheet-confirm', () => savePermissions(sheet)));
    footer.appendChild(actions);
    panel.appendChild(footer);
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

  function renderSheet() {
    const sheet = activeSheet;
    if (!sheet || (sheet.kind !== 'install' && sheet.kind !== 'add')) return null;
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

    const isAdd = sheet.kind === 'add';
    const header = el('div', 'plugin-canvas-sheet-header');
    const title = el(
      'h2',
      'plugin-canvas-sheet-title',
      isAdd ? 'MCP 서버 추가' : `${sheet.plugin.name} 설치 미리보기`,
    );
    title.setAttribute('id', titleId);
    header.appendChild(title);
    header.appendChild(el(
      'div',
      'plugin-canvas-sheet-subtitle',
      isAdd
        ? 'Claude 설정 형식의 스니펫을 붙여넣습니다'
        : '설치할 플러그인과 요청 권한을 확인합니다',
    ));
    dialog.appendChild(header);

    if (isAdd) {
      dialog.appendChild(renderAddSheetBody(sheet));
      overlay.appendChild(dialog);
      return overlay;
    }

    const body = el('div', 'plugin-canvas-sheet-body');
    const info = el('div', 'plugin-canvas-sheet-info');
    info.appendChild(el('div', 'plugin-canvas-sheet-plugin-name', sheet.plugin.name));
    info.appendChild(el('div', 'plugin-canvas-sheet-source', sheet.plugin.source || '등록된 플러그인 소스'));
    if (sheet.plugin.description) info.appendChild(el('div', 'plugin-canvas-sheet-plugin-description', sheet.plugin.description));
    body.appendChild(info);
    body.appendChild(el('h3', 'plugin-canvas-sheet-section-title', '요청 기능'));
    const featureList = el('div', 'plugin-canvas-sheet-features');
    sheet.features.forEach((feature) => featureList.appendChild(sheetFeatureRow(feature, false)));
    body.appendChild(featureList);
    body.appendChild(el('div', 'plugin-canvas-sheet-warning', '승인은 이 앱 세션의 UI 초안에 반영됩니다. 실제 사용은 플러그인 런타임 연결 뒤 활성화됩니다.'));
    const actions = el('div', 'plugin-canvas-sheet-actions');
    actions.appendChild(actionButton('취소', 'is-sheet-cancel', closeSheet));
    actions.appendChild(actionButton('세션 반영', 'is-sheet-confirm', () => approveInstall(sheet)));
    body.appendChild(actions);
    dialog.appendChild(body);
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
    if (activeSheet && (activeSheet.kind === 'install' || activeSheet.kind === 'add')) {
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
    if (activeSheet) {
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
