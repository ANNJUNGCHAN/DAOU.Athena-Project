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
  return definition ? `${definition.cardId}:${normalizeIdentity(targetIdentity(envelope))}` : null;
}

function matchesRealtimeTick(meta, tick) {
  if (!meta || !tick) return false;
  if (String(meta.leaseId || '') !== String(tick.leaseId || '')) return false;
  if (String(meta.cardId || '') !== String(tick.cardId || '')) return false;
  if (String(meta.mode || '') !== String(tick.mode || '')) return false;
  if (Number(meta.generation) !== Number(tick.generation)) return false;
  if (Number(meta.connectionGeneration) !== Number(tick.connectionGeneration)) return false;
  const operations = Array.isArray(meta.operationIds) ? meta.operationIds : [];
  if (!operations.includes(String(tick.operationId || ''))) return false;
  const expectedTarget = normalizeIdentity(meta.target);
  const observedTarget = normalizeIdentity(tick.target);
  return expectedTarget === 'default' || expectedTarget === observedTarget;
}

function requireRealtimeSuccess(state) {
  if (!state || state.ok !== true) {
    throw new Error((state && (state.error || state.message)) || '실시간 등록에 실패했습니다.');
  }
  return state;
}

function panelKeyFor(envelope) {
  return [envelope.mode, envelope.section, envelope.capability, envelope.operation_ref || envelope.operationRef]
    .map(clean).filter(Boolean).join(':') || 'primary';
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
  return clean(envelope.section) || clean(envelope.mode) || clean(envelope.capability)
    || clean(envelope.operation_ref || envelope.operationRef) || '요약';
}

function activatePanel(root, panelKey) {
  root.querySelectorAll('.integrated-card-tab').forEach((tab) => {
    const active = tab.dataset.panelKey === panelKey;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  root.querySelectorAll('.integrated-card-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panelKey !== panelKey;
  });
}

function ensureScaffold(root, definition) {
  const oldBody = root.querySelector(':scope > .card-body');
  if (oldBody && !oldBody.classList.contains('integrated-card-content')) {
    const initialNodes = Array.from(oldBody.childNodes);
    oldBody.replaceChildren();
    oldBody.className = 'card-body integrated-card-content';
    const tabs = document.createElement('div');
    tabs.className = 'integrated-card-tabs';
    tabs.setAttribute('role', 'tablist');
    const panels = document.createElement('div');
    panels.className = 'integrated-card-panels';
    oldBody.appendChild(tabs);
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
  root.dataset.operationRef = String(envelope.operation_ref || envelope.operationRef || '');
  root.dataset.capability = clean(envelope.capability) || '';
  root.dataset.mode = clean(envelope.mode) || '';
  root.dataset.section = clean(envelope.section) || '';
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
  let panel = Array.from(panels.children).find((node) => node.dataset.panelKey === panelKey);
  const replacedPanel = Boolean(panel);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'integrated-card-panel';
    panel.dataset.panelKey = panelKey;
    panels.appendChild(panel);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'integrated-card-tab';
    tab.dataset.panelKey = panelKey;
    tab.setAttribute('role', 'tab');
    tab.textContent = buttonLabel(envelope);
    tab.addEventListener('click', () => activatePanel(root, panelKey));
    tabs.appendChild(tab);
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
  detachForDestroy, findReusableRoot,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.IntegratedCardSurface = api;
}
})();
