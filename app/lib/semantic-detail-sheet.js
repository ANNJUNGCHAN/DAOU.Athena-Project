(function () {
'use strict';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function scalarText(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function pathPart(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function flattenSourceData(value, path = '$', output = []) {
  if (Array.isArray(value)) {
    if (!value.length) output.push({ jsonPath: path, alias: path, value: [] });
    value.forEach((item, index) => flattenSourceData(item, `${path}[${index}]`, output));
    return output;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) output.push({ jsonPath: path, alias: path, value: {} });
    entries.forEach(([key, item]) => flattenSourceData(item, `${path}${pathPart(key)}`, output));
    return output;
  }
  output.push({ jsonPath: path, alias: path.split(/[.[]/).filter(Boolean).pop() || path, value });
  return output;
}

function contractEntries(fieldContract) {
  if (Array.isArray(fieldContract)) return fieldContract;
  const contract = asObject(fieldContract);
  for (const key of ['occurrences', 'fields', 'response_fields', 'field_occurrences']) {
    if (Array.isArray(contract[key])) return contract[key];
  }
  return [];
}

// field_contract는 배열 행을 `$.data[].price` 한 번으로 기술하고, 실제 원문은
// `$.data[0].price`, `$.data[1].price`처럼 펼쳐진다. 커버리지 비교에서만 둘을
// 같은 schema path로 본다. 화면/occurrence id에는 concrete index를 보존한다.
function canonicalCoveragePath(jsonPath) {
  return String(jsonPath || '$')
    .replace(/\[\d+\]/g, '[]')
    .replace(/\["((?:\\.|[^"\\])*)"\]/g, (_match, encoded) => {
      try { return `.${JSON.parse(`"${encoded}"`)}`; } catch { return `.${encoded}`; }
    })
    .replace(/\['((?:\\.|[^'\\])*)'\]/g, (_match, encoded) => (
      `.${encoded.replace(/\\'/g, "'").replace(/\\\\/g, '\\')}`
    ));
}

function valueAtPath(source, jsonPath) {
  if (!jsonPath || jsonPath === '$') return source;
  const tokens = [];
  String(jsonPath).replace(/^\$/, '').replace(/\[\]|\.([^.[\]]+)|\["([^"]*)"\]|\['([^']*)'\]|\[(\d+)\]|^([^.[\]]+)/g,
    (match, dot, dq, sq, index, first) => {
      tokens.push(match === '[]' ? '*'
        : dot !== undefined ? dot
          : dq !== undefined ? dq
            : sq !== undefined ? sq
              : index !== undefined ? Number(index) : first);
      return '';
    });
  function resolve(current, index) {
    if (index >= tokens.length) return current;
    if (current === null || current === undefined) return undefined;
    const token = tokens[index];
    if (token === '*') {
      if (!Array.isArray(current)) return undefined;
      return current.map((item) => resolve(item, index + 1));
    }
    return resolve(current[token], index + 1);
  }
  return resolve(source, 0);
}

function normalizeOccurrences(envelope) {
  const losslessPage = envelope && envelope.source_data;
  // backend의 source_data는 {operation_ref,data,continuation,canvas_context} 봉투다.
  // field_contract.json_path는 그 안의 TR 원문 data를 기준으로 하므로 raw_data/data를
  // 우선 선택한다. 최적화 projection인 envelope.data는 마지막 하위호환일 뿐이다.
  const source = envelope && Object.prototype.hasOwnProperty.call(envelope, 'raw_data')
    ? envelope.raw_data
    : (losslessPage && typeof losslessPage === 'object' && Object.prototype.hasOwnProperty.call(losslessPage, 'data'))
      ? losslessPage.data
      : envelope && Object.prototype.hasOwnProperty.call(envelope, 'source_data')
        ? losslessPage : (envelope ? envelope.data : undefined);
  const operationRef = String((envelope && (envelope.operation_ref || envelope.operationRef)) || 'unknown');
  const contracts = contractEntries(envelope && envelope.field_contract);
  const occurrences = [];
  const coveredPaths = new Set();

  contracts.forEach((raw, index) => {
    const field = asObject(raw);
    const jsonPath = String(field.json_path || field.path || field.source_path || '$');
    const ordinal = Number(field.ordinal || field.occurrence_ordinal || 1);
    const alias = String(field.alias || field.key || field.field_name || jsonPath);
    const occurrenceId = String(field.field_occurrence_id || field.occurrence_id
      || `${operationRef}:${jsonPath}:${Number.isFinite(ordinal) ? ordinal : index + 1}`);
    const opaque = field.official_opaque === true
      || field.semantic_status === 'official_opaque'
      || field.official_name === null;
    const value = Object.prototype.hasOwnProperty.call(field, 'value')
      ? field.value : valueAtPath(source, jsonPath);
    occurrences.push({
      occurrenceId,
      jsonPath,
      ordinal: Number.isFinite(ordinal) ? ordinal : index + 1,
      alias,
      label: opaque ? '공식 명칭 미제공' : String(field.official_name || field.label || alias),
      value,
      officialOpaque: opaque,
    });
    coveredPaths.add(canonicalCoveragePath(jsonPath));
  });

  flattenSourceData(source).forEach((field) => {
    // 계약 한 줄이 모든 실제 배열 행 값을 이미 wildcard resolver로 보여주므로,
    // 같은 schema path의 concrete 행을 fallback으로 다시 추가하지 않는다.
    if (coveredPaths.has(canonicalCoveragePath(field.jsonPath))) return;
    const ordinal = 1;
    occurrences.push({
      occurrenceId: `${operationRef}:${field.jsonPath}:${ordinal}`,
      jsonPath: field.jsonPath,
      ordinal,
      alias: field.alias,
      label: field.alias,
      value: field.value,
      officialOpaque: false,
    });
  });
  return occurrences;
}

function createCell(className, text) {
  const cell = document.createElement('div');
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderOperationGroup(envelope) {
  const operationRef = String(envelope.operation_ref || envelope.operationRef || 'unknown');
  const occurrences = normalizeOccurrences(envelope);
  const group = document.createElement('section');
  group.className = 'semantic-detail-operation';
  group.dataset.operationRef = operationRef;

  const heading = document.createElement('div');
  heading.className = 'semantic-detail-operation-head';
  heading.textContent = `${operationRef} · ${occurrences.length}개 필드`;
  group.appendChild(heading);

  for (const occurrence of occurrences) {
    const row = document.createElement('div');
    row.className = 'semantic-detail-row';
    row.dataset.fieldOccurrenceId = occurrence.occurrenceId;
    row.dataset.jsonPath = occurrence.jsonPath;
    row.dataset.fieldAlias = occurrence.alias;
    if (occurrence.officialOpaque) row.classList.add('is-official-opaque');
    row.appendChild(createCell('semantic-detail-label', occurrence.label));
    row.appendChild(createCell('semantic-detail-value', scalarText(occurrence.value)));
    const wire = occurrence.officialOpaque
      ? `raw alias ${occurrence.alias} · ${occurrence.jsonPath} · #${occurrence.ordinal}`
      : `${occurrence.jsonPath} · #${occurrence.ordinal}`;
    row.appendChild(createCell('semantic-detail-wire', wire));
    group.appendChild(row);
  }
  return group;
}

function upsert(root, envelope) {
  if (!root || !envelope) return null;
  let sheet = root.querySelector('.semantic-detail-sheet');
  if (!sheet) {
    sheet = document.createElement('details');
    sheet.className = 'semantic-detail-sheet';
    const summary = document.createElement('summary');
    summary.className = 'semantic-detail-summary';
    sheet.appendChild(summary);
    const groups = document.createElement('div');
    groups.className = 'semantic-detail-groups';
    sheet.appendChild(groups);
    root.querySelector('.integrated-card-content').appendChild(sheet);
  }
  const operationRef = String(envelope.operation_ref || envelope.operationRef || 'unknown');
  const groups = sheet.querySelector('.semantic-detail-groups');
  const prior = Array.from(groups.children).find((node) => node.dataset.operationRef === operationRef);
  const next = renderOperationGroup(envelope);
  if (prior) prior.replaceWith(next); else groups.appendChild(next);
  const count = groups.querySelectorAll('[data-field-occurrence-id]').length;
  sheet.querySelector('.semantic-detail-summary').textContent = `전체 원본 필드 · ${count}개`;
  return sheet;
}

function applyRealtimeTick(root, tick) {
  if (!root || !tick || !tick.row) return 0;
  const values = tick.row.values && typeof tick.row.values === 'object'
    ? tick.row.values : {};
  const activePanel = Array.from(root.querySelectorAll('.integrated-card-panel'))
    .find((panel) => !panel.hidden);
  if (!activePanel) return 0;
  let strip = activePanel.querySelector('.integrated-realtime-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'integrated-realtime-strip';
    activePanel.prepend(strip);
  }
  strip.dataset.operationId = String(tick.operationId || '');
  strip.dataset.target = String(tick.target || '');
  strip.replaceChildren();
  const head = document.createElement('span');
  head.className = 'integrated-realtime-strip-head';
  head.textContent = `실시간 ${tick.operationId || ''} · ${tick.target || ''}`;
  strip.appendChild(head);
  for (const [alias, value] of Object.entries(values)) {
    const item = document.createElement('span');
    item.className = 'integrated-realtime-value';
    item.dataset.fieldAlias = alias;
    item.textContent = `${alias} ${scalarText(value)}`;
    strip.appendChild(item);
  }

  let updated = 0;
  root.querySelectorAll('.semantic-detail-row[data-field-alias]').forEach((row) => {
    const alias = row.dataset.fieldAlias;
    if (!Object.prototype.hasOwnProperty.call(values, alias)) return;
    const value = row.querySelector('.semantic-detail-value');
    if (value) value.textContent = scalarText(values[alias]);
    row.classList.add('is-realtime-updated');
    updated += 1;
  });
  root.dataset.lastRealtimeOperation = String(tick.operationId || '');
  root.dataset.lastRealtimeTarget = String(tick.target || '');
  return updated;
}

const api = {
  applyRealtimeTick, canonicalCoveragePath, flattenSourceData, normalizeOccurrences, valueAtPath, upsert,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.SemanticDetailSheet = api;
}
})();
