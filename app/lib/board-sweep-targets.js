'use strict';

// 보드마다 **그 보드가 다루는 종목 종류**로 조회 대상을 고른다.
//
// 카드 표면 101장에는 ELW·ETF·금현물 화면이 섞여 있다. 전부 삼성전자(005930)로
// 조회하면 그 화면들의 응답이 빈 배열로 와서 결측어가 잔뜩 뜬다 — 제품 결함이 아니라
// 검사가 잘못 물어본 것이다(실측 2XY6-0: ka30011이 005930에 빈 배열).
//
// 종류별 코드는 **API가 직접 알려준다**. 목록 op를 한 번 부르고 첫 항목을 쓴다 —
// 코드를 지어내지 않는다(백엔드의 연쇄 인자와 같은 규칙).

// TR id 접두 → 종목 종류. Kiwoom TR 번호대가 곧 종류다(ka30=ELW · ka40=ETF ·
// ka50=금현물). 보드가 그 종류의 op를 하나라도 쓰면 그 종류의 코드로 조회한다.
const KIND_BY_PREFIX = Object.freeze([
  { prefix: 'ka30', kind: 'elw' },
  { prefix: 'ka40', kind: 'etf' },
  { prefix: 'ka50', kind: 'gold' },
]);

// 종류별 코드를 알려주는 목록 op와 그 경로. 실측으로 자료가 오는 op를 골랐다.
const KIND_SOURCE = Object.freeze({
  elw: { path: '/api/v1/tr/elw/ka30009', body: {}, list: 'elwflu_rt_rank', field: 'stk_cd' },
  etf: { path: '/api/v1/tr/etf/ka40004', body: { txon_type: '0', navpre: '0', mngmcomp: '0000', txon_yn: '0', trace_idex: '0', stex_tp: '3' }, list: 'etfall_mrpr', field: 'stk_cd' },
});

function kindOfBoard(operationRefs) {
  for (const ref of operationRefs || []) {
    const parts = String(ref).split(':');
    const trId = parts.length >= 2 ? parts[1] : '';
    for (const entry of KIND_BY_PREFIX) {
      if (trId.startsWith(entry.prefix)) return entry.kind;
    }
  }
  return 'stock';
}

async function resolveKindCode(kind, { backendBase, fetchImpl }) {
  const source = KIND_SOURCE[kind];
  if (!source) return null;
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') return null;
  let response;
  try {
    response = await fetcher(`${backendBase}${source.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source.body),
    });
  } catch {
    return null;
  }
  if (!response || !response.ok) return null;
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  const rows = payload && Array.isArray(payload[source.list]) ? payload[source.list] : [];
  for (const row of rows) {
    const code = row && typeof row[source.field] === 'string' ? row[source.field].trim() : '';
    if (code) return code;
  }
  return null;
}

module.exports = { KIND_BY_PREFIX, KIND_SOURCE, kindOfBoard, resolveKindCode };
