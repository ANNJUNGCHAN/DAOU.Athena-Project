// 카드 v3 "종목발굴" 카드종 렌더러.
// 순위·ETF·업종·테마·ELW처럼 서로 다른 응답도 한 API 안에 실제로 있는 열만 사용해
// 탐색 목록으로 압축한다. 이름 열을 찾을 수 없는 응답은 범용 렌더러로 폴백한다.
(function () {
'use strict';

const CardPrimitives = typeof module !== 'undefined' && module.exports
  ? require('./card-primitives')
  : window.AthenaLib.CardPrimitives;
const FactsCard = typeof module !== 'undefined' && module.exports
  ? require('./facts-card')
  : window.AthenaLib.FactsCard;
const { TwoLineRow, priceMagnitude } = CardPrimitives;
const { formatNumeric } = FactsCard;

const NAME_KEYS = ['stk_nm', 'inds_nm', 'thema_nm', 'theme_nm', 'condition_nm', 'cond_nm', 'item_nm', 'elw_nm', 'etf_nm'];
const VALUE_KEYS = ['cur_prc', 'now_pric', 'idx', 'nav', 'flu_rt', 'trde_qty', 'acc_trde_qty', 'stk_num'];
const CHANGE_KEYS = ['flu_rt', 'pred_pre', 'change_rt', 'change_rate'];
const RANK_KEYS = ['rank', 'rnk', 'rank_no', 'bigdata_rank', 'pred_rank'];
const CODE_KEYS = ['stk_cd', 'inds_cd', 'thema_cd', 'theme_cd', 'item_cd'];
const META_KEYS = new Set(['result_code', 'result_message', 'service_name', 'return_code', 'return_msg']);

function findColumnKey(columns, keys, labelPattern) {
  const list = Array.isArray(columns) ? columns : [];
  for (const key of keys) {
    if (list.some((column) => column && column.key === key)) return key;
  }
  const byLabel = list.find((column) => column && typeof column.key === 'string'
    && labelPattern.test(String(column.label || '')));
  return byLabel ? byLabel.key : null;
}

function unitForColumn(column) {
  const key = String(column && column.key || '');
  const label = String(column && column.label || '');
  if (/idx|index|지수/.test(`${key} ${label}`)) return '';
  if (/prc|price|현재가|가격/.test(`${key} ${label}`)) return '원';
  if (/rt|rate|ratio|등락률|비율/.test(`${key} ${label}`)) return '%';
  if (/qty|quant|vol|거래량|수량|주수/.test(`${key} ${label}`)) return '주';
  if (/num|count|종목수/.test(`${key} ${label}`)) return '개';
  return '';
}

function selectDiscoveryRows(columns, rows) {
  const cols = Array.isArray(columns) ? columns : [];
  const list = Array.isArray(rows) ? rows : [];
  const nameKey = findColumnKey(cols, NAME_KEYS, /종목명|업종명|테마명|조건명|ETF명|ELW명/);
  if (!nameKey) return null;
  const valueKey = findColumnKey(cols, VALUE_KEYS, /현재가|가격|지수|NAV|등락률|거래량|종목수/i);
  const changeKey = findColumnKey(cols, CHANGE_KEYS, /등락률|변동률/);
  const rankKey = findColumnKey(cols, RANK_KEYS, /순위/);
  const codeKey = findColumnKey(cols, CODE_KEYS, /종목코드|업종코드|테마코드/);
  const valueColumn = cols.find((column) => column && column.key === valueKey);
  const isIndexRow = nameKey === 'inds_nm' || codeKey === 'inds_cd';
  const valueUnit = isIndexRow ? '' : unitForColumn(valueColumn);
  const valueIsSignedPrice = /prc|pric|price/i.test(String(valueKey || ''));
  const out = [];
  list.forEach((row, index) => {
    if (!row || row[nameKey] === null || row[nameKey] === undefined || row[nameKey] === '') return;
    out.push({
      rank: rankKey && row[rankKey] !== null && row[rankKey] !== undefined && row[rankKey] !== ''
        ? row[rankKey]
        : index + 1,
      name: row[nameKey],
      code: codeKey && row[codeKey] !== undefined && row[codeKey] !== '' ? row[codeKey] : null,
      value: valueKey && valueIsSignedPrice ? priceMagnitude(row[valueKey]) : (valueKey ? row[valueKey] : null),
      unit: valueUnit,
      change: changeKey && changeKey !== valueKey && row[changeKey] !== undefined && row[changeKey] !== ''
        ? row[changeKey]
        : null,
    });
  });
  return out;
}

function selectDiscoveryFacts(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((field) => field && !META_KEYS.has(field.key)
      && field.value !== null && field.value !== undefined && field.value !== '')
    .map((field) => ({ label: field.label || field.key, value: field.value }));
}

function displayValue(value, unit) {
  if (value === null || value === undefined || value === '') return null;
  return `${formatNumeric(value)}${unit || ''}`;
}

function renderDiscoveryRows(rows) {
  if (!rows || !rows.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-discovery-list';
  rows.forEach((row) => {
    const titleSub = [row.code, row.rank !== null && row.rank !== undefined ? `#${row.rank}` : null]
      .filter(Boolean).join(' · ');
    const valueSub = row.change !== null && row.change !== undefined
      ? `${formatNumeric(row.change)}%`
      : null;
    wrap.appendChild(TwoLineRow({
      title: row.name,
      titleSub: titleSub || null,
      value: displayValue(row.value, row.unit),
      valueSub,
    }));
  });
  return wrap;
}

function renderDiscoveryFacts(fields) {
  if (!fields.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'card-kind-discovery-facts';
  fields.forEach((field) => wrap.appendChild(TwoLineRow({
    title: field.label,
    value: formatNumeric(field.value),
  })));
  return wrap;
}

function resolveDiscoveryData(data) {
  const source = data && typeof data === 'object' ? data : {};
  const table = source.table && typeof source.table === 'object' ? source.table : source;
  return {
    fields: Array.isArray(source.fields) ? source.fields : (Array.isArray(source.header) ? source.header : []),
    columns: Array.isArray(table.columns) ? table.columns : [],
    rows: Array.isArray(table.rows) ? table.rows : [],
  };
}

function selectDiscoveryView(data) {
  const resolved = resolveDiscoveryData(data);
  const facts = selectDiscoveryFacts(resolved.fields);
  if (resolved.rows.length) {
    const rows = selectDiscoveryRows(resolved.columns, resolved.rows);
    if (!rows || !rows.length) return null;
    return { facts, rows };
  }
  return facts.length ? { facts, rows: [] } : null;
}

function render종목발굴(envelope) {
  const data = envelope && envelope.data;
  if (!data) return null;
  const view = selectDiscoveryView(data);
  if (!view) return null;
  const facts = renderDiscoveryFacts(view.facts);
  const rows = renderDiscoveryRows(view.rows);
  if (facts && rows) {
    const wrap = document.createElement('div');
    wrap.className = 'card-kind-discovery-compound';
    wrap.append(facts, rows);
    return wrap;
  }
  return rows || facts;
}

const __exports = {
  selectDiscoveryRows,
  selectDiscoveryFacts,
  resolveDiscoveryData,
  selectDiscoveryView,
  render종목발굴,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib.CardKinds.register('종목발굴', render종목발굴);
}

})();
