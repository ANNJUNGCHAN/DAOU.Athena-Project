(function () {
'use strict';

const HIDDEN_FIELD_CLASSES = new Set(['transport', 'internal', 'unresolved', 'official_opaque', 'diagnostic']);
const NON_DATA_STATES = new Set(['loading', 'empty', 'unavailable', 'error']);
const DISPLAY_TIER_ORDER = Object.freeze({ answer: 0, primary: 1, support: 2, secondary: 2, detail: 3 });
const DIRECT_DISPLAY_TIERS = new Set(['answer', 'primary', 'support']);
const MAX_PRIMARY_TABLE_COLUMNS = 8;
const SOURCE_TABLE_PRIMARY_LABELS = Object.freeze({
  'base:ka10099': Object.freeze(['종목코드', '종목명']),
});
const TAXONOMY_LABELS = Object.freeze({
  fundamentals: '기업 기본 정보와 가치',
});
const SECTION_LABELS = Object.freeze({
  'identity-and-quote': '종목과 현재 시세',
  'price-history': '가격 흐름',
  'volume-and-period': '거래량과 기간',
  'quote-context': '현재 시세',
  'depth-ladder': '매수·매도 호가',
  'trade-tape': '실시간 체결',
  'move-summary': '가격 변화 요약',
  'participant-flow': '투자자별 수급',
  'position-and-risk': '포지션과 위험',
  'discovery-filters': '탐색 조건',
  'ranked-results': '탐색 결과',
  'valuation-and-profile': '가치와 기업 정보',
  'market-group-summary': '시장 그룹 요약',
  'group-performance': '업종·테마 흐름',
  constituents: '구성 종목',
  'saved-scope': '저장한 범위',
  'matching-instruments': '조건에 맞는 종목',
  'condition-status': '조건검색 상태',
  'etf-summary': 'ETF 요약',
  'nav-and-performance': 'NAV와 성과',
  'elw-summary': 'ELW 요약',
  'sensitivity-and-expiry': '민감도와 만기',
  'liquidity-provider': '유동성 공급자',
  'market-state': '시장 운영 상태',
  'vi-events': 'VI 발동 현황',
  'affected-instruments': '영향 종목',
  'account-summary': '계좌 요약',
  'positions-and-performance': '보유종목과 손익',
  'settlement-and-risk': '결제와 위험',
  'order-draft': '주문 내용',
  'cost-and-risk-preview': '예상 금액과 위험',
  'confirmation-and-receipt': '확인과 주문 상태',
  'gold-summary': '금현물 요약',
  'gold-market-data': '금현물 시장 정보',
  'gold-position-and-settlement': '보유와 결제',
  'product-detail': '상품 상세 정보',
  'result-table': '조회 결과',
  'ranking-table': '순위 결과',
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstText(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function userLabel(value) {
  const label = firstText(value);
  return TAXONOMY_LABELS[label.toLowerCase()] || label;
}

function presentationContract(envelope) {
  const taskCanvas = asObject(envelope && (envelope.task_canvas || envelope.taskCanvas));
  const data = asObject(envelope && envelope.data);
  const raw = (envelope && (envelope.presentation_contract || envelope.presentationContract))
      || taskCanvas.presentation_contract || taskCanvas.presentationContract
      || data.presentation_contract || data.presentationContract;
  if (Array.isArray(raw)) return { fields: raw };
  return asObject(raw);
}

function isTaskCanvasEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return false;
  const contract = presentationContract(envelope);
  const hasPresentation = Array.isArray(contract.sections) || Array.isArray(contract.fields)
    || Array.isArray(contract.entries);
  if (!hasPresentation) return false;
  return envelope.canvas_type === 'task-canvas'
    || envelope.canvas_type === 'task_canvas'
    || Boolean(envelope.task_canvas || envelope.taskCanvas)
    || Boolean(envelope.view_recipe || envelope.viewRecipe)
    || Boolean(contract.recipe_id || contract.recipeId);
}

function isSafePrimary(envelope, card) {
  if (!isTaskCanvasEnvelope(envelope)) return true;
  const dataset = asObject(card && card.dataset);
  if (dataset.semanticPrimary === 'specialized') return true;
  if (envelope.canvas_type === 'chart' && dataset.chartAuthority === 'AITS') return true;
  return ['action', 'status'].includes(envelope.canvas_type) && !envelope.fell_back;
}

function fieldClass(field) {
  return firstText(field.field_class, field.fieldClass, field.semantic_status, field.semanticStatus, 'semantic').toLowerCase();
}

function looksInternalLabel(label) {
  const value = String(label || '').trim();
  return !value
    || /^\d+$/.test(value)
    || /^(?:fid|raw|json\s*path|operation(?:[_\s-]?ref)?|trace(?:[_\s-]?id)?|mapping(?:[_\s-]?id)?)\b/i.test(value);
}

function userVisibleField(raw) {
  const field = asObject(raw);
  if (HIDDEN_FIELD_CLASSES.has(fieldClass(field))) return false;
  return !looksInternalLabel(firstText(field.label_ko, field.labelKo, field.display_label, field.displayLabel, field.label));
}

function observationsFor(envelope) {
  const taskCanvas = asObject(envelope && (envelope.task_canvas || envelope.taskCanvas));
  const contract = presentationContract(envelope);
  const candidates = [
    envelope && envelope.semantic_observations,
    envelope && envelope.semanticObservations,
    taskCanvas.observations,
    contract.observations,
  ];
  return candidates.find(Array.isArray) || [];
}

function observationKey(field) {
  return firstText(field.concept_id, field.conceptId, field.semantic_key, field.semanticKey);
}

function safeObservationId(field) {
  const value = firstText(field && field.observation_id, field && field.observationId);
  return /^obs_[a-f0-9]{12,64}$/i.test(value) ? value : '';
}

function safeRealtimeBindingId(value) {
  const bindingId = firstText(value);
  return /^rtb_[a-f0-9]{12,64}$/i.test(bindingId) ? bindingId : '';
}

function realtimeBindingsInput(envelope) {
  const taskCanvas = asObject(envelope && (envelope.task_canvas || envelope.taskCanvas));
  const candidates = [
    envelope && envelope.realtime_bindings,
    envelope && envelope.realtimeBindings,
    taskCanvas.realtime_bindings,
    taskCanvas.realtimeBindings,
  ];
  const rawBindings = candidates.find(Array.isArray);
  return {
    provided: Boolean(rawBindings),
    bindings: (rawBindings || []).map((raw) => {
      const binding = asObject(raw);
      const bindingId = safeRealtimeBindingId(binding.binding_id || binding.bindingId);
      const observationId = safeObservationId(binding);
      if (!bindingId || !observationId) return null;
      const arrayIndex = Number.isInteger(binding.array_index) ? binding.array_index
        : Number.isInteger(binding.arrayIndex) ? binding.arrayIndex : null;
      return { bindingId, observationId, arrayIndex };
    }).filter(Boolean),
  };
}

function generationValue(envelope, snakeKey, camelKey) {
  const taskCanvas = asObject(envelope && (envelope.task_canvas || envelope.taskCanvas));
  const candidates = [envelope && envelope[snakeKey], envelope && envelope[camelKey], taskCanvas[snakeKey], taskCanvas[camelKey]];
  const value = candidates.find((candidate) => Number.isSafeInteger(candidate) && candidate >= 0);
  return value === undefined ? null : value;
}

function envelopeGenerations(envelope) {
  return {
    workspaceGeneration: generationValue(envelope, 'workspace_generation', 'workspaceGeneration'),
    viewGeneration: generationValue(envelope, 'view_generation', 'viewGeneration'),
  };
}

function declaredUpdatePolicy(envelope) {
  const taskCanvas = asObject(envelope && (envelope.task_canvas || envelope.taskCanvas));
  return firstText(
    envelope && envelope.update_policy, envelope && envelope.updatePolicy,
    taskCanvas.update_policy, taskCanvas.updatePolicy,
  ).toLowerCase();
}

function updatePolicyFor(envelope) {
  const value = declaredUpdatePolicy(envelope);
  if (!value) return 'enrich';
  return value === 'replace' || value === 'enrich' ? value : '';
}

function typedEnvelopeContract(envelope) {
  const generations = envelopeGenerations(envelope);
  const isTyped = generations.workspaceGeneration !== null || generations.viewGeneration !== null;
  if (!isTyped) return { generations, valid: true };
  const declaredPolicy = declaredUpdatePolicy(envelope);
  return {
    generations,
    valid: generations.workspaceGeneration !== null
      && generations.viewGeneration !== null
      && (declaredPolicy === 'replace' || declaredPolicy === 'enrich')
      && realtimeBindingsInput(envelope).provided,
  };
}

function acceptsGeneration(current, incoming) {
  if (current === null) return true;
  if (incoming === null) return false;
  return incoming > current;
}

function acceptsEnvelopeForState(state, viewInstanceId, incomingGenerations) {
  if (!state) return true;
  if (!acceptsGeneration(state.workspaceGeneration, incomingGenerations.workspaceGeneration)) return false;
  return state.viewInstanceId !== viewInstanceId
    || acceptsGeneration(state.viewGeneration, incomingGenerations.viewGeneration);
}

function safeRowId(row) {
  const value = firstText(row && row.row_id, row && row.rowId);
  return /^row_[a-f0-9]{12,64}$/i.test(value) ? value : '';
}

function displayUnit(...values) {
  const value = firstText(...values);
  if (!value) return '';
  const descriptors = new Set([
    'source-defined-number-or-text', 'identifier', 'currency-or-price',
    'quantity', 'date', 'time', 'percentage-or-ratio',
  ]);
  return descriptors.has(value.toLowerCase()) ? '' : value;
}

function productDisplayMetadata(field) {
  const raw = asObject(field && (field.display_metadata || field.displayMetadata));
  const formatterId = firstText(raw.formatter_id, raw.formatterId);
  if (!formatterId) return null;
  return {
    formatterId,
    displayUnit: firstText(raw.display_unit, raw.displayUnit),
    signPolicy: firstText(raw.sign_policy, raw.signPolicy),
  };
}

function displayTier(field) {
  const tier = firstText(field.display_tier, field.displayTier).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(DISPLAY_TIER_ORDER, tier)) {
    return tier === 'secondary' ? 'support' : tier;
  }
  const visibility = firstText(field.visibility_policy, field.visibilityPolicy).toLowerCase();
  return Object.prototype.hasOwnProperty.call(DISPLAY_TIER_ORDER, visibility) ? visibility : 'support';
}

function displayOrder(field) {
  const value = Number(field.display_order ?? field.displayOrder);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function displaySlot(field) {
  const raw = field.display_slot ?? field.displaySlot;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizedSlotLabel(value) {
  return firstText(value).replace(/[\s_-]*\d+$/, '').trim();
}

function withSlotContext(items) {
  const slotsByGroup = new Map();
  for (const item of items) {
    if (item.displaySlot === null) continue;
    const group = item.displayGroup || item.label;
    if (!slotsByGroup.has(group)) slotsByGroup.set(group, new Set());
    slotsByGroup.get(group).add(item.displaySlot);
  }
  const ranksByGroup = new Map([...slotsByGroup].map(([group, slots]) => [
    group, new Map([...slots].sort((left, right) => left - right).map((slot, index) => [slot, index + 1])),
  ]));
  return items.map((item) => {
    if (item.displaySlot === null) return item;
    const group = item.displayGroup || item.label;
    const rank = ranksByGroup.get(group).get(item.displaySlot);
    return { ...item, slotLabel: `${item.label} ${rank}순위` };
  });
}

function compareDisplay(left, right) {
  return (DISPLAY_TIER_ORDER[left.displayTier] ?? DISPLAY_TIER_ORDER.support)
    - (DISPLAY_TIER_ORDER[right.displayTier] ?? DISPLAY_TIER_ORDER.support)
    || left.displayOrder - right.displayOrder
    || String(left.label || '').localeCompare(String(right.label || ''), 'ko');
}

function valueFor(field, observations) {
  for (const key of ['formatted_value', 'formattedValue', 'display_value', 'displayValue', 'value']) {
    if (Object.prototype.hasOwnProperty.call(field, key)) return field[key];
  }
  const concept = observationKey(field);
  if (!concept) return undefined;
  const requestedId = safeObservationId(field);
  const found = observations.find((item) => {
    const observation = asObject(item);
    return requestedId
      ? safeObservationId(observation) === requestedId
      : observationKey(observation) === concept;
  });
  if (!found) return undefined;
  for (const key of ['formatted_value', 'formattedValue', 'display_value', 'displayValue', 'value']) {
    if (Object.prototype.hasOwnProperty.call(found, key)) return found[key];
  }
  return undefined;
}

function normalizeField(raw, observations = []) {
  const field = asObject(raw);
  if (!userVisibleField(field)) return null;
  const rawLabel = firstText(field.label_ko, field.labelKo, field.display_label, field.displayLabel, field.label);
  const slot = displaySlot(field);
  const group = firstText(field.display_group, field.displayGroup);
  const label = slot === null ? rawLabel : normalizedSlotLabel(rawLabel || group);
  const value = valueFor(field, observations);
  // presentation metadata만 있고 observation이 아직 도착하지 않은 항목은 가짜
  // `미제공` metric을 만들지 않는다. 해당 named section이 unavailable 상태를
  // 담당하고, 값이 안전한 semantic observation으로 오면 그때 렌더한다.
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return null;
  const displayMetadata = productDisplayMetadata(field);
  return {
    concept: observationKey(field) || `label:${label}`,
    label,
    value,
    semanticUnit: firstText(field.unit_or_format, field.unitOrFormat),
    unit: displayMetadata ? displayMetadata.displayUnit
      : displayUnit(field.unit, field.unit_label, field.unitLabel, field.unit_or_format, field.unitOrFormat),
    displayMetadata,
    description: firstText(field.description_ko, field.descriptionKo, field.description),
    asOf: firstText(field.as_of, field.asOf, field.observed_at, field.observedAt),
    status: firstText(field.status, 'available').toLowerCase(),
    entity: firstText(field.entity_id, field.entityId, field.entity, 'default'),
    timeKey: firstText(field.time_key, field.timeKey, field.as_of, field.asOf, field.observed_at, field.observedAt, 'latest'),
    realtimeBindingId: safeRealtimeBindingId(field.realtime_binding_id || field.realtimeBindingId),
    visualRole: firstText(field.visual_role, field.visualRole, 'metric').toLowerCase(),
    displayTier: displayTier(field),
    displayGroup: slot === null ? group : normalizedSlotLabel(group || rawLabel),
    displaySlot: slot,
    displayOrder: displayOrder(field),
    visibilityPolicy: firstText(field.visibility_policy, field.visibilityPolicy),
    observationId: safeObservationId(field),
    arrayIndex: Number.isInteger(field.array_index) ? field.array_index
      : Number.isInteger(field.arrayIndex) ? field.arrayIndex : null,
  };
}

function dedupeFields(fields) {
  const seen = new Set();
  const output = [];
  for (const field of fields) {
    if (!field) continue;
    const key = field.observationId || [field.concept, field.entity, field.timeKey, field.semanticUnit || field.unit, field.arrayIndex ?? 'scalar'].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(field);
  }
  return output.sort(compareDisplay);
}

function fieldIdentity(field) {
  return field.observationId || [field.concept, field.entity, field.timeKey, field.semanticUnit || field.unit, field.arrayIndex ?? 'scalar'].join('|');
}

function mergeFields(previous, incoming) {
  const merged = new Map((previous || []).map((field) => [fieldIdentity(field), field]));
  for (const field of incoming || []) merged.set(fieldIdentity(field), field);
  return [...merged.values()].sort(compareDisplay);
}

function normalizeColumns(section) {
  const rawColumns = Array.isArray(section.columns) ? section.columns : [];
  return withSlotContext(rawColumns.map((raw) => {
    const column = asObject(raw);
    if (!userVisibleField(column)) return null;
    const rawLabel = firstText(column.label_ko, column.labelKo, column.display_label, column.displayLabel, column.label);
    const slot = displaySlot(column);
    const group = firstText(column.display_group, column.displayGroup);
    const displayMetadata = productDisplayMetadata(column);
    return {
      key: firstText(column.key, column.concept_id, column.conceptId, column.semantic_key, column.semanticKey),
      concept: observationKey(column),
      label: slot === null ? rawLabel : normalizedSlotLabel(group || rawLabel),
      semanticUnit: firstText(column.unit_or_format, column.unitOrFormat),
      unit: displayMetadata ? displayMetadata.displayUnit
        : displayUnit(column.unit, column.unit_label, column.unitLabel, column.unit_or_format, column.unitOrFormat),
      displayMetadata,
      displayTier: displayTier(column),
      displayGroup: slot === null ? group : normalizedSlotLabel(group || rawLabel),
      displaySlot: slot,
      displayOrder: displayOrder(column),
      visibilityPolicy: firstText(column.visibility_policy, column.visibilityPolicy),
      realtimeBindingId: safeRealtimeBindingId(column.realtime_binding_id || column.realtimeBindingId),
    };
  }).filter((column) => column && column.key).sort(compareDisplay));
}

function tableFromObservations(sectionId, observations) {
  const source = observations.filter((item) => {
    const observation = asObject(item);
    return firstText(observation.section_id, observation.sectionId) === sectionId
      && userVisibleField(observation)
      && valueFor(observation, []) !== undefined;
  });
  const counts = new Map();
  source.forEach((item) => {
    const concept = observationKey(asObject(item));
    counts.set(concept, (counts.get(concept) || 0) + 1);
  });
  const repeated = source.filter((item) => {
    const observation = asObject(item);
    return Number.isInteger(observation.array_index) || Number.isInteger(observation.arrayIndex)
      || (counts.get(observationKey(observation)) || 0) > 1;
  });
  if (!repeated.length) return { columns: [], rows: [], repeated: new Set() };

  const columns = [];
  const columnKeys = new Set();
  const groupedRows = new Map();
  repeated.forEach((item, ordinal) => {
    const observation = asObject(item);
    const concept = observationKey(observation);
    if (!concept) return;
    if (!columnKeys.has(concept)) {
      columnKeys.add(concept);
      columns.push({
        key: concept,
        concept,
        label: firstText(observation.label_ko, observation.labelKo, observation.label),
        semanticUnit: firstText(observation.unit_or_format, observation.unitOrFormat),
        unit: productDisplayMetadata(observation)?.displayUnit
          || displayUnit(observation.unit, observation.unit_label, observation.unitLabel),
        displayMetadata: productDisplayMetadata(observation),
        displayTier: displayTier(observation),
        displayGroup: displaySlot(observation) === null
          ? firstText(observation.display_group, observation.displayGroup)
          : normalizedSlotLabel(firstText(observation.display_group, observation.displayGroup, observation.label_ko, observation.labelKo, observation.label)),
        displaySlot: displaySlot(observation),
        displayOrder: displayOrder(observation),
        visibilityPolicy: firstText(observation.visibility_policy, observation.visibilityPolicy),
      });
    }
    const arrayIndex = Number.isInteger(observation.array_index) ? observation.array_index
      : Number.isInteger(observation.arrayIndex) ? observation.arrayIndex : null;
    const entity = firstText(observation.entity_id, observation.entityId, observation.entity);
    const time = firstText(observation.time_key, observation.timeKey, observation.as_of, observation.asOf, observation.observed_at, observation.observedAt);
    const rowKey = arrayIndex !== null ? `array:${arrayIndex}`
      : entity || time ? `entity:${entity}|time:${time}`
        : `observation:${safeObservationId(observation) || ordinal}`;
    if (!groupedRows.has(rowKey)) groupedRows.set(rowKey, { values: {}, observationIds: {} });
    const row = groupedRows.get(rowKey);
    row.values[concept] = valueFor(observation, []);
    const observationId = safeObservationId(observation);
    if (observationId) row.observationIds[concept] = observationId;
  });
  return { columns: withSlotContext(columns.sort(compareDisplay)), rows: [...groupedRows.values()], repeated: new Set(repeated) };
}

function rowIdentity(row) {
  const explicit = safeRowId(row);
  if (explicit) return explicit;
  const observationIds = Object.values(asObject(row && (row.observationIds || row.observation_ids)))
    .map((value) => safeObservationId({ observation_id: value }))
    .filter(Boolean)
    .sort();
  return observationIds.length ? observationIds.join('|') : '';
}

function dedupeRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const identity = rowIdentity(row);
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function normalizeSection(raw, envelope, recipePolicy = {}) {
  const section = asObject(raw);
  const policy = { ...asObject(recipePolicy), ...section };
  const sectionId = firstText(section.section_id, section.sectionId);
  const suppliedTitle = userLabel(firstText(
    section.title_ko, section.titleKo, section.title,
    section.label_ko, section.labelKo, section.label,
  ));
  const generatedTitle = sectionId.replace(/-/g, ' ');
  const title = suppliedTitle === generatedTitle
    ? firstText(SECTION_LABELS[sectionId], suppliedTitle)
    : firstText(suppliedTitle, SECTION_LABELS[sectionId]);
  if (!title || looksInternalLabel(title)) return null;
  const observations = observationsFor(envelope);
  const observationTable = tableFromObservations(sectionId, observations);
  const rawFields = [section.fields, section.metrics, section.items].find(Array.isArray) || [];
  const scalarObservations = observations.filter((item) => (
    firstText(item && item.section_id, item && item.sectionId) === sectionId
      && !observationTable.repeated.has(item)
  ));
  const fields = dedupeFields([...rawFields, ...scalarObservations].map((field) => normalizeField(field, observations)));
  const explicitColumns = normalizeColumns(section);
  const explicitRows = Array.isArray(section.rows) ? section.rows.filter((row) => row && typeof row === 'object') : [];
  const columns = explicitColumns.length ? explicitColumns : observationTable.columns;
  const rows = dedupeRows(explicitRows.length ? explicitRows : observationTable.rows);
  const explicitStatus = firstText(section.status).toLowerCase();
  const visibilityPolicy = firstText(policy.visibility_policy, policy.visibilityPolicy, 'when-data').toLowerCase();
  const required = policy.required === true || visibilityPolicy === 'always';
  const workflowOnly = policy.workflow_only === true || policy.workflowOnly === true || visibilityPolicy === 'workflow';
  const sectionOrder = Number(policy.section_order ?? policy.sectionOrder);
  return {
    id: firstText(sectionId, title),
    title,
    description: firstText(section.description_ko, section.descriptionKo, section.description),
    status: explicitStatus || (fields.length || (columns.length && rows.length) ? 'available' : 'unavailable'),
    statusLabel: firstText(section.status_label, section.statusLabel),
    asOf: firstText(section.as_of, section.asOf),
    fields,
    columns,
    rows,
    observations,
    visibilityPolicy,
    required,
    workflowOnly,
    sectionOrder: Number.isFinite(sectionOrder) ? sectionOrder : Number.MAX_SAFE_INTEGER,
    workflowContent: fields.length > 0 || (columns.length > 0 && rows.length > 0),
    primaryColumnLabels: SOURCE_TABLE_PRIMARY_LABELS[firstText(envelope.operation_ref, envelope.operationRef)] || [],
  };
}

function sectionHasData(section) {
  return !NON_DATA_STATES.has(section.status)
    && (section.fields.length > 0 || (section.columns.length > 0 && section.rows.length > 0));
}

function includeSection(section, context = {}) {
  const hasData = sectionHasData(section);
  if (section.workflowOnly || section.visibilityPolicy === 'workflow') return section.workflowContent && hasData;
  if (hasData) return true;
  if (context.presentationSucceeded && context.hasAnyData
    && ['empty', 'unavailable'].includes(section.status)) return false;
  if (section.required && section.visibilityPolicy === 'always') return true;
  return ['loading', 'stale', 'reconnecting'].includes(section.status);
}

function normalizePresentation(envelope) {
  if (!isTaskCanvasEnvelope(envelope)) return null;
  const contract = presentationContract(envelope);
  const taskCanvas = asObject(envelope.task_canvas || envelope.taskCanvas);
  const viewRecipe = asObject(envelope.view_recipe || envelope.viewRecipe);
  const flatFields = [contract.fields, contract.entries].find(Array.isArray) || [];
  const sectionMap = new Map();
  flatFields.forEach((field) => {
    const sectionId = firstText(field && field.section_id, field && field.sectionId);
    if (!sectionId) return;
    if (!sectionMap.has(sectionId)) sectionMap.set(sectionId, []);
    sectionMap.get(sectionId).push(field);
  });
  const recipeSectionIds = Array.isArray(viewRecipe.section_ids)
    ? viewRecipe.section_ids : Array.isArray(viewRecipe.sectionIds) ? viewRecipe.sectionIds : [];
  const recipePolicies = [viewRecipe.section_policies, viewRecipe.sectionPolicies].find(Array.isArray) || [];
  const policyBySection = new Map(recipePolicies.map((policy) => [
    firstText(policy && policy.section_id, policy && policy.sectionId), asObject(policy),
  ]));
  const orderedSectionIds = [...new Set([...recipeSectionIds, ...sectionMap.keys()])];
  const rawSections = Array.isArray(contract.sections) ? contract.sections : orderedSectionIds.map((sectionId) => ({
    section_id: sectionId,
    status: sectionMap.has(sectionId) ? 'available' : 'unavailable',
    fields: sectionMap.get(sectionId) || [],
  }));
  const status = firstText(contract.status, taskCanvas.status, 'available').toLowerCase();
  const normalizedSections = rawSections
    .map((section) => normalizeSection(section, envelope, policyBySection.get(firstText(section && section.section_id, section && section.sectionId))))
    .filter(Boolean);
  const hasAnyData = normalizedSections.some(sectionHasData);
  const presentationSucceeded = ['available', 'success', 'partial', 'stale'].includes(status);
  const visibleSections = normalizedSections
    .filter((section) => includeSection(section, { presentationSucceeded, hasAnyData }))
    .sort((left, right) => left.sectionOrder - right.sectionOrder);
  const atomicStatus = hasAnyData ? status
    : normalizedSections.some((section) => section.status === 'loading') ? 'loading'
      : normalizedSections.some((section) => section.status === 'error') ? 'error'
        : 'empty';
  return {
    title: userLabel(firstText(contract.title_ko, contract.titleKo, contract.title, taskCanvas.title_ko, taskCanvas.titleKo, taskCanvas.title, viewRecipe.title_ko, viewRecipe.titleKo, viewRecipe.title, envelope.caption, '분석 결과')),
    description: firstText(contract.description_ko, contract.descriptionKo, contract.description),
    status: atomicStatus,
    statusLabel: firstText(contract.status_label, contract.statusLabel, taskCanvas.status_label, taskCanvas.statusLabel),
    asOf: firstText(contract.as_of, contract.asOf, taskCanvas.as_of, taskCanvas.asOf),
    sections: hasAnyData ? visibleSections : [],
  };
}

function signedNumberParts(value) {
  const source = String(value).trim().replace(/,/g, '');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(source);
  if (!match) return null;
  return { sign: match[1], integer: match[2], decimal: match[3] || '' };
}

function displaySign(sign, policy) {
  if (policy === 'absolute' || policy === 'none') return '';
  if (policy === 'always') return sign === '-' ? '-' : '+';
  return sign;
}

function formatProductValue(value, metadata) {
  const raw = String(value);
  const formatterId = firstText(metadata && metadata.formatterId);
  const displayUnitValue = firstText(metadata && metadata.displayUnit);
  const signPolicy = firstText(metadata && metadata.signPolicy);
  let formatted;
  if (formatterId === 'stock-code') {
    formatted = raw;
  } else if (formatterId === 'date-yyyymmdd') {
    const source = raw.trim();
    formatted = /^\d{8}$/.test(source)
      ? `${source.slice(0, 4)}-${source.slice(4, 6)}-${source.slice(6, 8)}`
      : raw;
  } else if (formatterId === 'grouped-number' || formatterId === 'decimal-number') {
    const parts = signedNumberParts(raw);
    if (!parts) return raw;
    const integer = formatterId === 'grouped-number'
      ? parts.integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      : parts.integer;
    formatted = `${displaySign(parts.sign, signPolicy)}${integer}${parts.decimal ? `.${parts.decimal}` : ''}`;
  } else {
    return raw;
  }
  return `${formatted}${displayUnitValue}`;
}

function formatValue(value, display = '') {
  if (value === null || value === undefined || value === '') return '미제공';
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  if (display && typeof display === 'object') return formatProductValue(value, display);
  return `${String(value)}${display ? ` ${display}` : ''}`;
}

const STATE_TEXT = Object.freeze({
  loading: '데이터를 불러오는 중입니다.',
  empty: '표시할 데이터가 없습니다.',
  partial: '일부 정보를 불러오지 못했습니다. 확인된 정보만 표시합니다.',
  unavailable: '현재 제공할 수 없는 정보입니다.',
  error: '정보를 불러오지 못했습니다.',
  stale: '마지막으로 확인된 정보를 표시합니다.',
  reconnecting: '실시간 정보를 다시 연결하고 있습니다.',
});

function appendText(parent, tagName, className, text) {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function appendStatus(parent, status, label, asOf) {
  if (status === 'available' && !label && !asOf) return null;
  const statusNode = document.createElement('div');
  statusNode.className = `semantic-workspace-status is-${status}`;
  statusNode.setAttribute('role', 'status');
  statusNode.textContent = [label || STATE_TEXT[status] || '', asOf ? `${asOf} 기준` : ''].filter(Boolean).join(' · ');
  parent.appendChild(statusNode);
  return statusNode;
}

function renderMetrics(fields, parent, className = '') {
  const band = document.createElement('dl');
  band.className = ['semantic-workspace-metrics', className].filter(Boolean).join(' ');
  for (const field of fields) {
    const item = document.createElement('div');
    item.className = field.visualRole === 'description' ? 'semantic-workspace-description' : 'semantic-workspace-metric';
    if (field.observationId) item.dataset.semanticObservationId = field.observationId;
    Object.defineProperty(field, '__athenaSemanticNode', {
      value: item, configurable: true, writable: true,
    });
    appendText(item, 'dt', 'semantic-workspace-label', field.label);
    appendText(item, 'dd', 'semantic-workspace-value', formatValue(field.value, field.displayMetadata || field.unit));
    if (field.description) appendText(item, 'p', 'semantic-workspace-help', field.description);
    if (field.asOf) appendText(item, 'time', 'semantic-workspace-asof', `${field.asOf} 기준`);
    band.appendChild(item);
  }
  parent.appendChild(band);
}

function renderSlottedFields(fields, parent) {
  const families = new Map();
  for (const field of fields) {
    const group = field.displayGroup || field.label;
    if (!families.has(group)) families.set(group, new Map());
    const slots = families.get(group);
    if (!slots.has(field.displaySlot)) slots.set(field.displaySlot, []);
    slots.get(field.displaySlot).push(field);
  }
  for (const [group, slots] of families) {
    const family = document.createElement('section');
    family.className = 'semantic-workspace-slot-group';
    appendText(family, 'h4', 'semantic-workspace-slot-title', group);
    const list = document.createElement('dl');
    list.className = 'semantic-workspace-slot-list';
    [...slots].sort(([left], [right]) => left - right).forEach(([slot, slotFields]) => {
      const row = document.createElement('div');
      row.className = 'semantic-workspace-slot-row';
      appendText(row, 'dt', 'semantic-workspace-slot-rank', slot === 0 ? '기본' : `${slot}순위`);
      const values = document.createElement('dd');
      values.className = 'semantic-workspace-slot-fields';
      const subfields = document.createElement('dl');
      subfields.className = 'semantic-workspace-slot-subfields';
      slotFields.slice().sort(compareDisplay).forEach((field) => {
        const item = document.createElement('div');
        item.className = 'semantic-workspace-slot-subfield';
        if (field.observationId) item.dataset.semanticObservationId = field.observationId;
        Object.defineProperty(field, '__athenaSemanticNode', {
          value: item, configurable: true, writable: true,
        });
        appendText(item, 'dt', 'semantic-workspace-label', field.label);
        appendText(item, 'dd', 'semantic-workspace-value', formatValue(field.value, field.displayMetadata || field.unit));
        subfields.appendChild(item);
      });
      values.appendChild(subfields);
      row.appendChild(values);
      list.appendChild(row);
    });
    family.appendChild(list);
    parent.appendChild(family);
  }
}

function renderScalarFields(section, parent) {
  const direct = section.fields.filter((field) => DIRECT_DISPLAY_TIERS.has(field.displayTier));
  const detail = section.fields.filter((field) => field.displayTier === 'detail');
  const directPlain = direct.filter((field) => field.displaySlot === null);
  const directSlotted = direct.filter((field) => field.displaySlot !== null);
  if (directPlain.length) renderMetrics(directPlain, parent);
  if (directSlotted.length) renderSlottedFields(directSlotted, parent);
  if (!detail.length) return;
  const disclosure = document.createElement('details');
  disclosure.className = 'semantic-workspace-detail';
  appendText(disclosure, 'summary', 'semantic-workspace-detail-summary', `${section.title} 상세`);
  const detailPlain = detail.filter((field) => field.displaySlot === null);
  const detailSlotted = detail.filter((field) => field.displaySlot !== null);
  if (detailPlain.length) renderMetrics(detailPlain, disclosure, 'is-detail');
  if (detailSlotted.length) renderSlottedFields(detailSlotted, disclosure);
  parent.appendChild(disclosure);
}

function rowValue(row, column) {
  const values = asObject(row.values);
  if (Object.prototype.hasOwnProperty.call(values, column.key)) return values[column.key];
  return Object.prototype.hasOwnProperty.call(row, column.key) ? row[column.key] : undefined;
}

function stampCellObservation(cell, section, row, rowIndex, column) {
  const observationIds = asObject(row.observationIds || row.observation_ids);
  let observationId = safeObservationId({ observation_id: observationIds[column.key] });
  if (!observationId) {
    const matched = section.observations.find((item) => {
      const observation = asObject(item);
      const arrayIndex = Number.isInteger(observation.array_index)
        ? observation.array_index : observation.arrayIndex;
      const label = firstText(observation.label_ko, observation.labelKo, observation.label);
      return arrayIndex === rowIndex
        && (observationKey(observation) === column.concept || label === column.label);
    });
    observationId = safeObservationId(matched);
  }
  if (observationId) {
    cell.dataset.semanticObservationId = observationId;
    Object.defineProperty(cell, '__athenaSemanticUnit', {
      value: column.unit || '', configurable: true, writable: true,
    });
    Object.defineProperty(cell, '__athenaSemanticDisplayMetadata', {
      value: column.displayMetadata || null, configurable: true, writable: true,
    });
  }
}

function hasPresentedValue(row, column) {
  const value = rowValue(row, column);
  return value !== null && value !== undefined && value !== '';
}

function primaryTableColumns(section) {
  const preferred = section.columns.filter((column) => DIRECT_DISPLAY_TIERS.has(column.displayTier));
  if (!section.primaryColumnLabels.length) {
    return (preferred.length ? preferred : section.columns).slice(0, MAX_PRIMARY_TABLE_COLUMNS);
  }
  const identity = section.primaryColumnLabels
    .map((label) => section.columns.find((column) => column.label === label))
    .filter(Boolean);
  const selected = new Set(identity.map((column) => column.key));
  const populated = section.columns.filter((column) => (
    !selected.has(column.key) && section.rows.some((row) => hasPresentedValue(row, column))
  ));
  const preferredKeys = new Set(preferred.map((column) => column.key));
  const orderedPopulated = [
    ...preferred.filter((column) => !selected.has(column.key)),
    ...populated.filter((column) => !preferredKeys.has(column.key)),
  ];
  return [...identity, ...orderedPopulated].slice(0, MAX_PRIMARY_TABLE_COLUMNS);
}

function renderTable(section, parent) {
  const mainColumns = primaryTableColumns(section);
  const mainKeys = new Set(mainColumns.map((column) => column.key));
  const detailColumns = section.columns.filter((column) => !mainKeys.has(column.key));
  const wrap = document.createElement('div');
  wrap.className = 'semantic-workspace-table-wrap';
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('aria-label', `${section.title} 표`);
  const table = document.createElement('table');
  table.className = 'semantic-workspace-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of mainColumns) appendText(headRow, 'th', '', `${column.slotLabel || column.label}${column.unit ? ` (${column.unit})` : ''}`).setAttribute('scope', 'col');
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const [rowIndex, row] of section.rows.entries()) {
    const tr = document.createElement('tr');
    for (const column of mainColumns) {
      const cell = appendText(tr, 'td', '', formatValue(rowValue(row, column), column.displayMetadata || column.unit));
      cell.dataset.semanticLabel = column.slotLabel || column.label;
      stampCellObservation(cell, section, row, rowIndex, column);
    }
    tbody.appendChild(tr);
    if (detailColumns.length) {
      const detailRow = document.createElement('tr');
      detailRow.className = 'semantic-workspace-table-detail-row';
      const detailCell = document.createElement('td');
      detailCell.colSpan = mainColumns.length;
      const disclosure = document.createElement('details');
      disclosure.className = 'semantic-workspace-row-detail';
      appendText(disclosure, 'summary', 'semantic-workspace-row-detail-summary', `${section.title} ${rowIndex + 1}번째 항목 · 세부 지표`);
      const detailList = document.createElement('dl');
      detailList.className = 'semantic-workspace-row-detail-values';
      for (const column of detailColumns) {
        const item = document.createElement('div');
        item.className = 'semantic-workspace-row-detail-item';
        appendText(item, 'dt', 'semantic-workspace-label', column.slotLabel || column.label);
        const value = appendText(item, 'dd', 'semantic-workspace-value', formatValue(rowValue(row, column), column.displayMetadata || column.unit));
        stampCellObservation(value, section, row, rowIndex, column);
        detailList.appendChild(item);
      }
      disclosure.appendChild(detailList);
      detailCell.appendChild(disclosure);
      detailRow.appendChild(detailCell);
      tbody.appendChild(detailRow);
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  parent.appendChild(wrap);
}

function renderSection(section) {
  const node = document.createElement('section');
  node.className = 'semantic-workspace-section';
  node.dataset.semanticSection = section.id;
  appendText(node, 'h3', 'semantic-workspace-section-title', section.title);
  if (section.description) appendText(node, 'p', 'semantic-workspace-section-description', section.description);
  appendStatus(node, section.status, section.statusLabel, section.asOf);
  if (!NON_DATA_STATES.has(section.status)) {
    if (section.columns.length && section.rows.length) renderTable(section, node);
    if (section.fields.length) renderScalarFields(section, node);
  }
  if (!section.fields.length && !(section.columns.length && section.rows.length) && !NON_DATA_STATES.has(section.status)) {
    appendStatus(node, 'empty', '', '');
  }
  return node;
}

function workspaceState(root, presentation, envelope) {
  const viewInstanceId = firstText(envelope.view_instance_id, envelope.viewInstanceId, 'legacy');
  const typedContract = typedEnvelopeContract(envelope);
  const incomingGenerations = typedContract.generations;
  const incomingRealtime = realtimeBindingsInput(envelope);
  if (!typedContract.valid) return null;
  const updatePolicy = updatePolicyFor(envelope);
  if (!updatePolicy) return null;
  let state = root.__athenaSemanticWorkspaceState;
  if (!acceptsEnvelopeForState(state, viewInstanceId, incomingGenerations)) return null;
  if (!state || state.viewInstanceId !== viewInstanceId) {
    if (state) disposeRealtimeState(root, state);
    state = {
      viewInstanceId,
      workspaceGeneration: incomingGenerations.workspaceGeneration,
      viewGeneration: incomingGenerations.viewGeneration,
      sections: new Map(),
      realtimeBindings: new Map(),
      observationIndex: new Map(),
      pendingDomUpdates: new Map(),
      pendingAnnouncementIds: new Set(),
      highlightTimers: new Map(),
      renderRevision: 0,
    };
    Object.defineProperty(root, '__athenaSemanticWorkspaceState', {
      value: state, configurable: true, writable: true,
    });
  }
  state.workspaceGeneration = incomingGenerations.workspaceGeneration ?? state.workspaceGeneration;
  state.viewGeneration = incomingGenerations.viewGeneration ?? state.viewGeneration;
  if (updatePolicy === 'replace') state.sections.clear();
  state.title = presentation.title;
  state.description = presentation.description;
  state.status = presentation.status;
  state.statusLabel = presentation.statusLabel;
  state.asOf = presentation.asOf;
  if (incomingRealtime.provided || !(state.realtimeBindings instanceof Map)) {
    state.realtimeBindings = new Map();
    for (const binding of incomingRealtime.bindings) {
      if (!state.realtimeBindings.has(binding.bindingId)) state.realtimeBindings.set(binding.bindingId, []);
      state.realtimeBindings.get(binding.bindingId).push(binding);
    }
  }
  for (const incoming of presentation.sections) {
    const previous = state.sections.get(incoming.id);
    if (!previous) {
      state.sections.set(incoming.id, incoming);
      continue;
    }
    const hasIncomingData = incoming.fields.length || (incoming.columns.length && incoming.rows.length);
    state.sections.set(incoming.id, {
      ...previous,
      ...incoming,
      status: hasIncomingData || incoming.status !== 'unavailable' ? incoming.status : previous.status,
      statusLabel: hasIncomingData || incoming.status !== 'unavailable' ? incoming.statusLabel : previous.statusLabel,
      asOf: incoming.asOf || previous.asOf,
      fields: mergeFields(previous.fields, incoming.fields),
      columns: incoming.columns.length ? incoming.columns : previous.columns,
      rows: incoming.rows.length ? incoming.rows : previous.rows,
    });
  }
  return state;
}

function schedulerFor(root) {
  const injected = asObject(root && root.__athenaSemanticWorkspaceScheduler);
  const browser = typeof window !== 'undefined' ? window : null;
  return {
    requestFrame: typeof injected.requestFrame === 'function'
      ? injected.requestFrame
      : typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (callback) => { callback(); return null; },
    cancelFrame: typeof injected.cancelFrame === 'function'
      ? injected.cancelFrame
      : typeof globalThis.cancelAnimationFrame === 'function'
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : () => {},
    setTimer: typeof injected.setTimer === 'function'
      ? injected.setTimer
      : browser && typeof browser.setTimeout === 'function'
        ? browser.setTimeout.bind(browser)
        : (callback) => { callback(); return null; },
    clearTimer: typeof injected.clearTimer === 'function'
      ? injected.clearTimer
      : browser && typeof browser.clearTimeout === 'function'
        ? browser.clearTimeout.bind(browser)
        : () => {},
    reducedMotion: typeof injected.reducedMotion === 'boolean'
      ? injected.reducedMotion
      : Boolean(browser && browser.matchMedia
        && browser.matchMedia('(prefers-reduced-motion: reduce)').matches),
  };
}

function disposeRealtimeState(root, state) {
  if (!state) return;
  const scheduler = schedulerFor(root);
  if (state.frameHandle !== null && state.frameHandle !== undefined) {
    scheduler.cancelFrame(state.frameHandle);
  }
  if (state.ariaTimer !== null && state.ariaTimer !== undefined) {
    scheduler.clearTimer(state.ariaTimer);
  }
  for (const timer of state.highlightTimers || []) scheduler.clearTimer(timer[1]);
  for (const nodes of (state.observationIndex || new Map()).values()) {
    nodes.forEach((node) => node.classList.remove('is-realtime-updated'));
  }
  state.frameHandle = null;
  state.ariaTimer = null;
  state.pendingDomUpdates = new Map();
  state.pendingAnnouncementIds = new Set();
  state.highlightTimers = new Map();
  state.observationIndex = new Map();
  state.renderRevision = (state.renderRevision || 0) + 1;
}

function disposeRealtime(root) {
  disposeRealtimeState(root, root && root.__athenaSemanticWorkspaceState);
}

function rebuildObservationIndex(root, workspace, state) {
  const index = new Map();
  for (const node of workspace.querySelectorAll('[data-semantic-observation-id]')) {
    const observationId = safeObservationId({ observation_id: node.dataset.semanticObservationId });
    if (!observationId) continue;
    if (!index.has(observationId)) index.set(observationId, []);
    index.get(observationId).push(node);
  }
  state.observationIndex = index;
  state.reducedMotion = schedulerFor(root).reducedMotion;
}

function upsert(root, envelope) {
  const presentation = normalizePresentation(envelope);
  if (!root || !presentation) return null;
  const viewInstanceId = firstText(envelope.view_instance_id, envelope.viewInstanceId, 'legacy');
  const typedContract = typedEnvelopeContract(envelope);
  const incomingGenerations = typedContract.generations;
  if (!typedContract.valid) return root.querySelector('.semantic-workspace');
  if (!acceptsEnvelopeForState(
    root.__athenaSemanticWorkspaceState,
    viewInstanceId,
    incomingGenerations,
  )) return root.querySelector('.semantic-workspace');
  if (!presentation.sections.length && root.querySelector('.task-realtime-lifecycle')) {
    disposeRealtime(root);
    const existing = root.querySelector('.semantic-workspace');
    if (existing && typeof existing.remove === 'function') existing.remove();
    root.dataset.taskCanvas = 'true';
    delete root.dataset.semanticWorkspaceStatus;
    return null;
  }
  if (root.querySelector('.card-kit-hoga-live')) {
    presentation.sections = presentation.sections.filter((section) => section.id !== 'depth-ladder');
  }
  const state = workspaceState(root, presentation, envelope);
  if (!state) return root.querySelector('.semantic-workspace');
  let workspace = root.querySelector('.semantic-workspace');
  if (!workspace) {
    workspace = document.createElement('section');
    workspace.className = 'semantic-workspace';
    const host = root.querySelector('.integrated-card-content') || root.querySelector('.card-body') || root;
    host.appendChild(workspace);
  }
  disposeRealtime(root);
  workspace.replaceChildren();
  workspace.setAttribute('aria-label', state.title);
  const live = document.createElement('div');
  live.className = 'semantic-workspace-live';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  workspace.appendChild(live);
  appendText(workspace, 'h2', 'semantic-workspace-title', state.title);
  if (state.description) appendText(workspace, 'p', 'semantic-workspace-description-copy', state.description);
  appendStatus(workspace, state.status, state.statusLabel, state.asOf);
  [...state.sections.values()].forEach((section) => workspace.appendChild(renderSection(section)));
  root.dataset.taskCanvas = 'true';
  root.dataset.semanticWorkspaceStatus = state.status;
  rebuildObservationIndex(root, workspace, state);
  return workspace;
}

function semanticRealtimeUpdates(tick) {
  const updates = [];
  const semanticValues = asObject(
    tick && (tick.semantic_values || tick.semanticValues),
  );
  for (const [candidateId, rawValue] of Object.entries(semanticValues)) {
    const bindingId = safeRealtimeBindingId(candidateId);
    if (!bindingId) continue;
    const payload = asObject(rawValue);
    const hasWrappedValue = Object.prototype.hasOwnProperty.call(payload, 'value');
    const identity = optionalRealtimeIdentity(payload);
    if (!identity) continue;
    const { observationId, arrayIndex } = identity;
    updates.push({ bindingId, observationId, arrayIndex, value: hasWrappedValue ? payload.value : rawValue });
  }
  const listed = [
    tick && tick.semantic_updates,
    tick && tick.semanticUpdates,
  ].find(Array.isArray) || [];
  for (const raw of listed) {
    const update = asObject(raw);
    const bindingId = safeRealtimeBindingId(update.binding_id || update.bindingId);
    if (!bindingId) continue;
    if (!Object.prototype.hasOwnProperty.call(update, 'value')) continue;
    const identity = optionalRealtimeIdentity(update);
    if (!identity) continue;
    const { observationId, arrayIndex } = identity;
    updates.push({ bindingId, observationId, arrayIndex, value: update.value });
  }
  return updates;
}

function optionalRealtimeIdentity(raw) {
  const value = asObject(raw);
  const hasObservationId = Object.prototype.hasOwnProperty.call(value, 'observation_id')
    || Object.prototype.hasOwnProperty.call(value, 'observationId');
  const observationId = safeObservationId(value);
  if (hasObservationId && !observationId) return null;
  const hasArrayIndex = Object.prototype.hasOwnProperty.call(value, 'array_index')
    || Object.prototype.hasOwnProperty.call(value, 'arrayIndex');
  const suppliedArrayIndex = Object.prototype.hasOwnProperty.call(value, 'array_index')
    ? value.array_index : value.arrayIndex;
  if (hasArrayIndex && (!Number.isInteger(suppliedArrayIndex) || suppliedArrayIndex < 0)) return null;
  return {
    observationId,
    arrayIndex: hasArrayIndex ? suppliedArrayIndex : null,
  };
}

function boundObservations(state, update) {
  const bindings = state && state.realtimeBindings && state.realtimeBindings.get(update.bindingId);
  if (!bindings) return [];
  return bindings.filter((binding) => (
    (!update.observationId || update.observationId === binding.observationId)
      && (update.arrayIndex === null || binding.arrayIndex === update.arrayIndex)
  ));
}

function updateSemanticState(state, binding, update) {
  for (const section of state.sections.values()) {
    for (const field of section.fields) {
      if (field.observationId !== binding.observationId) continue;
      field.value = update.value;
      field.status = 'available';
    }
    const observation = section.observations.find((candidate) => (
      safeObservationId(candidate) === binding.observationId
    ));
    if (!observation) continue;
    const rowIndex = binding.arrayIndex !== null ? binding.arrayIndex
      : Number.isInteger(observation.array_index) ? observation.array_index
        : Number.isInteger(observation.arrayIndex) ? observation.arrayIndex : null;
    if (rowIndex === null || !section.rows[rowIndex]) continue;
    const observationConcept = observationKey(observation);
    const observationLabel = firstText(observation.label_ko, observation.labelKo, observation.label);
    const column = section.columns.find((candidate) => (
      candidate.realtimeBindingId === update.bindingId
        || candidate.concept === observationConcept
        || candidate.label === observationLabel
    ));
    if (!column) continue;
    const values = asObject(section.rows[rowIndex].values);
    if (Object.prototype.hasOwnProperty.call(values, column.key)) values[column.key] = update.value;
    else section.rows[rowIndex][column.key] = update.value;
  }
}

function displayForObservation(state, observationId, node) {
  for (const section of state.sections.values()) {
    const field = section.fields.find((candidate) => candidate.observationId === observationId);
    if (field) return field.displayMetadata || field.unit;
  }
  return node.__athenaSemanticDisplayMetadata || node.__athenaSemanticUnit || '';
}

function scheduleAnnouncement(root, state) {
  if (state.ariaTimer !== null && state.ariaTimer !== undefined) return;
  const scheduler = schedulerFor(root);
  const revision = state.renderRevision;
  let completed = false;
  const handle = scheduler.setTimer(() => {
    completed = true;
    state.ariaTimer = null;
    if (state.renderRevision !== revision) return;
    const count = state.pendingAnnouncementIds.size;
    state.pendingAnnouncementIds.clear();
    if (!count) return;
    const live = root.querySelector('.semantic-workspace-live');
    if (live) live.textContent = `${count}개 항목이 실시간으로 갱신되었습니다.`;
  }, 200);
  if (!completed) state.ariaTimer = handle;
}

function markRealtimeUpdated(root, state, observationId) {
  if (state.reducedMotion) return;
  const scheduler = schedulerFor(root);
  const existing = state.highlightTimers.get(observationId);
  if (existing !== undefined) scheduler.clearTimer(existing);
  const nodes = state.observationIndex.get(observationId) || [];
  nodes.forEach((node) => node.classList.add('is-realtime-updated'));
  const revision = state.renderRevision;
  let completed = false;
  const handle = scheduler.setTimer(() => {
    completed = true;
    state.highlightTimers.delete(observationId);
    if (state.renderRevision !== revision) return;
    nodes.forEach((node) => node.classList.remove('is-realtime-updated'));
  }, 900);
  if (!completed) state.highlightTimers.set(observationId, handle);
}

function flushRealtimeDom(root, state, revision) {
  state.frameHandle = null;
  if (state.renderRevision !== revision) return;
  const pending = state.pendingDomUpdates;
  state.pendingDomUpdates = new Map();
  for (const [observationId, update] of pending) {
    for (const node of state.observationIndex.get(observationId) || []) {
      const valueNode = node.querySelector('.semantic-workspace-value') || node;
      valueNode.textContent = formatValue(
        update.value,
        displayForObservation(state, observationId, node),
      );
    }
    markRealtimeUpdated(root, state, observationId);
  }
}

function scheduleRealtimeDom(root, state) {
  if (state.frameHandle !== null && state.frameHandle !== undefined) return;
  const scheduler = schedulerFor(root);
  const revision = state.renderRevision;
  let completed = false;
  const handle = scheduler.requestFrame(() => {
    completed = true;
    flushRealtimeDom(root, state, revision);
  });
  if (!completed) state.frameHandle = handle;
}

function applyRealtimeTick(root, tick) {
  if (!root || !tick) return 0;
  const state = root.__athenaSemanticWorkspaceState;
  if (!state || !state.sections) return 0;
  const updates = semanticRealtimeUpdates(tick);
  if (!updates.length) return 0;
  let updated = 0;
  for (const update of updates) {
    for (const binding of boundObservations(state, update)) {
      updateSemanticState(state, binding, update);
      if (!state.observationIndex.has(binding.observationId)) continue;
      state.pendingDomUpdates.set(binding.observationId, update);
      state.pendingAnnouncementIds.add(binding.observationId);
      updated += 1;
    }
  }
  if (updated) {
    scheduleRealtimeDom(root, state);
    scheduleAnnouncement(root, state);
  }
  return updated;
}

const api = {
  HIDDEN_FIELD_CLASSES, applyRealtimeTick, dedupeFields, disposeRealtime, formatValue,
  isSafePrimary, isTaskCanvasEnvelope, looksInternalLabel, normalizeField, normalizePresentation,
  presentationContract, safeRealtimeBindingId, semanticRealtimeUpdates, upsert, userVisibleField,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SemanticWorkspace = api;
}
})();
