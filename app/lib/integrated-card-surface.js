(function () {
'use strict';

const CARD_DEFINITIONS = Object.freeze({
  'CC-01': Object.freeze({ kind: 'account', title: '계좌 통합 카드' }),
  'CC-02': Object.freeze({ kind: 'order', title: '주문 통합 카드' }),
  'CC-03': Object.freeze({ kind: 'instrument', title: '종목·상품 통합 카드' }),
  'CC-04': Object.freeze({ kind: 'orderbook', title: '호가 통합 카드' }),
  'CC-05': Object.freeze({ kind: 'flow', title: '수급 통합 카드' }),
  'CC-06': Object.freeze({ kind: 'explorer', title: '탐색 통합 카드' }),
});

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integratedDefinition(envelope) {
  const cardId = clean(envelope && envelope.card_id);
  const definition = cardId && CARD_DEFINITIONS[cardId];
  if (!definition) return null;
  const declaredKind = clean(envelope.card_kind);
  if (declaredKind && declaredKind !== definition.kind) return null;
  return { cardId, ...definition };
}

function targetIdentity(envelope) {
  const args = (envelope && (envelope.operation_args || envelope.arguments)) || {};
  const candidates = [
    envelope && envelope.account_id, envelope && envelope.account_no,
    args.account_id, args.account_no, args.acnt_no,
    envelope && envelope.stk_cd, envelope && envelope.symbol, envelope && envelope.target,
    args.stk_cd, args.symbol, args.target, args.market, args.market_code,
  ];
  return clean(candidates.find((value) => clean(value))) || 'default';
}

function normalizeIdentity(value) {
  return String(value || 'default').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '-');
}

function instanceKeyFor(envelope) {
  const definition = integratedDefinition(envelope);
  if (!definition) return null;
  const viewInstanceId = clean(envelope && (envelope.view_instance_id || envelope.viewInstanceId));
  return viewInstanceId
    ? `view:${normalizeIdentity(viewInstanceId)}`
    : `${definition.cardId}:${normalizeIdentity(targetIdentity(envelope))}`;
}

function matchesRealtimeTick(meta, tick) {
  if (!meta || !tick) return false;
  if (String(meta.leaseId || '') !== String(tick.leaseId || '')) return false;
  if (String(meta.cardId || '') !== String(tick.cardId || '')) return false;
  if (String(meta.mode || '') !== String(tick.mode || '')) return false;
  if (Number(meta.generation) !== Number(tick.generation)) return false;
  if (Number(meta.connectionGeneration) !== Number(tick.connectionGeneration)) return false;
  // Raw operation and target identities are consumed in the trusted main process.
  // The renderer receives only the lease identity, generations, and opaque updates.
  return true;
}

function requireRealtimeSuccess(state) {
  if (!state || state.ok !== true) {
    throw new Error((state && (state.error || state.message)) || '실시간 등록에 실패했습니다.');
  }
  return state;
}

function panelKeyFor(envelope) {
  // 순위 모드는 축(TR) 전환이 탭 안에서 일어난다 — operation_ref나 capability를
  // 키에 넣으면 축·수급 갈래마다 탭이 생겨 "1탭 · 다축" 계약(Paper R01-T4~T6 ·
  // R03-T6)이 깨진다. 카드 root가 다르므로 카드 간 충돌은 없다.
  const parts = clean(envelope.mode) === 'ranking'
    ? [envelope.mode, envelope.section]
    : [envelope.mode, envelope.section, envelope.capability,
       envelope.operation_ref || envelope.operationRef];
  return parts.map(clean).filter(Boolean).join(':') || 'primary';
}

function verifiedOperationRefsFor(envelope) {
  if (Array.isArray(envelope && envelope.operation_refs)) {
    return envelope.operation_refs.map(clean).filter(Boolean);
  }
  return [clean(envelope && (envelope.operation_ref || envelope.operationRef))].filter(Boolean);
}

function panelSessionStore(root) {
  if (!root) return null;
  if (!root.__athenaIntegratedPanelSessions) {
    Object.defineProperty(root, '__athenaIntegratedPanelSessions', {
      value: new Map(), configurable: true,
    });
  }
  return root.__athenaIntegratedPanelSessions;
}

function rememberPanelSession(root, envelope, renderedCard) {
  const operationRef = clean(envelope && (envelope.operation_ref || envelope.operationRef));
  const panelId = clean(renderedCard && renderedCard.dataset && renderedCard.dataset.chartPanelId);
  if (!root || !operationRef || !panelId) return null;
  const metadata = {
    operationRef,
    panelKey: panelKeyFor(envelope),
    panelId,
    generation: Number(renderedCard.dataset.chartGeneration) || 1,
    rendererId: clean(renderedCard.dataset.rendererId),
  };
  panelSessionStore(root).set(operationRef, metadata);
  return metadata;
}

function panelSessionFor(root, envelope) {
  const operationRef = clean(envelope && (envelope.operation_ref || envelope.operationRef));
  return operationRef && root && root.__athenaIntegratedPanelSessions
    ? root.__athenaIntegratedPanelSessions.get(operationRef) || null
    : null;
}

function forgetPanelSession(root, panelKey) {
  const sessions = root && root.__athenaIntegratedPanelSessions;
  if (!sessions) return;
  for (const [operationRef, metadata] of sessions) {
    if (metadata.panelKey === panelKey) sessions.delete(operationRef);
  }
}

function clearPanelSessions(root) {
  if (root && root.__athenaIntegratedPanelSessions) root.__athenaIntegratedPanelSessions.clear();
}

function detachForDestroy(root) {
  if (!root) return;
  if (root.dataset) root.dataset.destroying = 'true';
  clearPanelSessions(root);
  if (typeof root.remove === 'function') root.remove();
}

function findReusableRoot(candidates, instanceKey) {
  return Array.from(candidates || []).find((candidate) => (
    candidate && candidate.dataset
      && candidate.dataset.destroying !== 'true'
      && candidate.dataset.integratedInstanceKey === instanceKey
  )) || null;
}

function prepareExisting(root) {
  if (!root) return;
  // 전문 renderer의 `.chart`/`.orderbook` class와 session dataset은 유지한다.
  // makeCard가 integrated root를 legacy replacement 후보에서 제외하므로 더 이상
  // 중립 class로 바꿀 필요가 없다.
  for (const key of ['datasetId', 'itemId', 'ordinal']) delete root.dataset[key];
}

function specializedClassNames(...classNames) {
  const keep = new Set();
  for (const className of classNames) {
    String(className || '').split(/\s+/).filter(Boolean).forEach((name) => {
      if (name === 'card' || name === 'integrated-card' || name.startsWith('integrated-card--') || /^w-/.test(name)) return;
      keep.add(name);
    });
  }
  return [...keep];
}

function copySpecializedDatasets(root, renderedCard) {
  if (!root || !renderedCard || root === renderedCard) return;
  const reserved = new Set([
    'cardId', 'cardKind', 'integratedInstanceKey', 'operationRef', 'capability', 'mode', 'section',
    'datasetId', 'itemId', 'ordinal', 'realtimeLeaseId', 'realtimeStatus', 'realtimeMounted',
    'realtimeGeneration', 'realtimeConnectionGeneration',
  ]);
  for (const [key, value] of Object.entries(renderedCard.dataset || {})) {
    if (!reserved.has(key)) root.dataset[key] = value;
  }
}

function buttonLabel(envelope) {
  if (clean(envelope && envelope.mode) === 'ranking') return '순위';
  const contract = envelope && (envelope.presentation_contract || envelope.presentationContract) || {};
  const recipe = envelope && (envelope.view_recipe || envelope.viewRecipe) || {};
  const modeKey = clean(envelope && envelope.mode);
  const sectionKey = clean(envelope && envelope.section);
  const sections = Array.isArray(contract.sections) ? contract.sections : [];
  const activeSection = sections.find((section) => (
    clean(section && (section.section_id || section.sectionId)) === sectionKey
  ));
  // Prefer section/mode product labels before card-level titles so multi-panel
  // account cards do not collapse every tab to "요약" or the same card name.
  const candidates = [
    activeSection && (activeSection.title_ko || activeSection.titleKo),
    SECTION_TAB_LABELS_KO[sectionKey],
    MODE_TAB_LABELS_KO[modeKey],
    humanizeKeyLabel(sectionKey),
    humanizeKeyLabel(modeKey),
    recipe.title_ko || recipe.titleKo,
    contract.title_ko || contract.titleKo,
  ];
  return candidates.map(clean).find((label) => label && /[가-힣]/.test(label)) || '요약';
}

const MODE_TAB_LABELS_KO = Object.freeze({
  overview: '전체',
  holdings: '보유종목',
  balance: '예수금',
  deposit: '예수금',
  orderable: '주문가능',
  fills: '체결',
  executions: '체결',
  credit: '증감금',
  gold: '금현물',
  ranking: '순위',
});

const SECTION_TAB_LABELS_KO = Object.freeze({
  'ranked-results': '순위',
  overview: '전체',
  holdings: '보유종목',
  balance: '예수금',
  orderable: '주문가능',
  fills: '체결',
  credit: '증감금',
  gold: '금현물',
  'other-assets-and-income': '기타자산',
  other_assets_and_income: '기타자산',
});

function humanizeKeyLabel(value) {
  const key = clean(value);
  if (!key) return '';
  if (/[가-힣]/.test(key)) return key;
  return '';
}

function workflowStateLabel(value) {
  const state = clean(value);
  if (!state) return '상태 확인 중';
  const productLabels = {
    connecting: '실시간 연결 중',
    connected: '실시간 연결됨',
    reconnected: '실시간 다시 연결됨',
    reconnecting: '실시간 재연결 중',
    disconnected: '실시간 연결 중지',
    stopped: '실시간 연결 중지',
    paused: '실시간 수신 일시 중지',
    error: '실시간 연결 오류',
    entry: '주문 입력',
    draft: '주문 초안',
    review: '확인 대기',
    confirmation: '최종 확인',
    confirmed: '확인 완료',
    submitted: '주문 접수',
    accepted: '접수 완료',
    filled: '체결 완료',
    rejected: '주문 거절',
    cancelled: '주문 취소',
  };
  return productLabels[state.toLowerCase()] || state;
}

function stampPanelKey(node, panelKey) {
  Object.defineProperty(node, '__athenaPanelKey', {
    value: panelKey, configurable: true, writable: true,
  });
}

function activatePanel(root, panelKey) {
  root.querySelectorAll('.integrated-card-tab').forEach((tab) => {
    const active = tab.__athenaPanelKey === panelKey;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  root.querySelectorAll('.integrated-card-panel').forEach((panel) => {
    panel.hidden = panel.__athenaPanelKey !== panelKey;
  });
}

// 보드 표면 카드 = Paper 보드 그 자체. 보드가 자기 헤더(제목·기준 시각)·스트립·
// 푸터를 이미 갖고 있으므로 통합 카드 크롬(카드 머리·패널 탭 칩)을 그 위에 겹쳐
// 그리지 않는다 — 겹치면 같은 제목이 탭 스트립·카드 머리·보드 헤더에 세 번 뜬다.
// 표시는 canvas.js가 카드 root에 찍는다(renderBoardSurfaceCard).
function isBoardSurface(node) {
  return Boolean(node && node.dataset && node.dataset.boardSurface === 'true');
}

function ensureScaffold(root, definition) {
  const oldBody = root.querySelector(':scope > .card-body');
  if (oldBody && !oldBody.classList.contains('integrated-card-content')) {
    const initialNodes = Array.from(oldBody.childNodes);
    oldBody.replaceChildren();
    oldBody.className = 'card-body integrated-card-content';
    if (!isBoardSurface(root)) {
      const tabs = document.createElement('div');
      tabs.className = 'integrated-card-tabs';
      tabs.setAttribute('role', 'tablist');
      oldBody.appendChild(tabs);
    }
    const panels = document.createElement('div');
    panels.className = 'integrated-card-panels';
    oldBody.appendChild(panels);
    oldBody.__initialPrimaryNodes = initialNodes;
  }
  const title = root.querySelector(':scope > .card-head .card-title');
  if (title) title.textContent = definition.title;
  return oldBody;
}

function stampRoot(root, envelope, definition, renderedCard = root) {
  const specialized = specializedClassNames(root.className, renderedCard.className);
  root.className = `card ${specialized.join(' ')} integrated-card integrated-card--${definition.cardId.toLowerCase()} integrated-card--${definition.kind} w-full`;
  copySpecializedDatasets(root, renderedCard);
  root.dataset.cardId = definition.cardId;
  root.dataset.cardKind = definition.kind;
  root.dataset.integratedInstanceKey = instanceKeyFor(envelope);
  root.dataset.integratedTarget = normalizeIdentity(targetIdentity(envelope));
  Object.defineProperty(root, '__athenaIntegratedMetadata', {
    value: {
      operationRef: String(envelope.operation_ref || envelope.operationRef || ''),
      capability: clean(envelope.capability) || '',
      mode: clean(envelope.mode) || '',
      section: clean(envelope.section) || '',
    },
    configurable: true,
    writable: true,
  });
  for (const key of ['datasetId', 'itemId', 'ordinal']) delete root.dataset[key];
  const title = root.querySelector(':scope > .card-head .card-title');
  if (title) title.textContent = definition.title;
  return root;
}

function refreshExisting(root, envelope) {
  const definition = integratedDefinition(envelope);
  if (!root || !definition) return null;
  stampRoot(root, envelope, definition);
  activatePanel(root, panelKeyFor(envelope));
  return root;
}

function mountOrUpdate({ envelope, renderedCard, existingCard }) {
  const definition = integratedDefinition(envelope);
  if (!definition || !renderedCard) return null;
  const panelKey = panelKeyFor(envelope);
  const root = existingCard || renderedCard;
  const renderedBody = renderedCard.querySelector(':scope > .card-body');
  const incomingNodes = existingCard
    ? Array.from(renderedBody ? renderedBody.childNodes : [])
    : Array.from(renderedBody ? renderedBody.childNodes : []);

  stampRoot(root, envelope, definition, renderedCard);

  const content = ensureScaffold(root, definition);
  const panels = content.querySelector('.integrated-card-panels');
  const tabs = content.querySelector('.integrated-card-tabs');
  let panel = Array.from(panels.children).find((node) => node.__athenaPanelKey === panelKey);
  const replacedPanel = Boolean(panel);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'integrated-card-panel';
    stampPanelKey(panel, panelKey);
    panels.appendChild(panel);
    // 보드 표면 카드에는 탭 스트립 자체가 없다(ensureScaffold) — 칩도 안 만든다.
    if (tabs) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'integrated-card-tab';
      stampPanelKey(tab, panelKey);
      tab.setAttribute('role', 'tab');
      tab.textContent = buttonLabel(envelope);
      tab.addEventListener('click', () => activatePanel(root, panelKey));
      tabs.appendChild(tab);
    }
  }
  const nodes = content.__initialPrimaryNodes || incomingNodes;
  delete content.__initialPrimaryNodes;
  panel.replaceChildren(...nodes);
  activatePanel(root, panelKey);
  return { root, panelKey, replacedPanel, transientCard: existingCard ? renderedCard : null };
}

const api = {
  CARD_DEFINITIONS, integratedDefinition, instanceKeyFor, panelKeyFor,
  prepareExisting, mountOrUpdate, normalizeIdentity, targetIdentity,
  specializedClassNames, copySpecializedDatasets, refreshExisting,
  matchesRealtimeTick, requireRealtimeSuccess, verifiedOperationRefsFor,
  rememberPanelSession, panelSessionFor, forgetPanelSession, clearPanelSessions,
  detachForDestroy, findReusableRoot, buttonLabel, workflowStateLabel, isBoardSurface,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.IntegratedCardSurface = api;
}
})();
