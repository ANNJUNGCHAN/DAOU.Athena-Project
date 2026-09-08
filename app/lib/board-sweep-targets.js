'use strict';

// 보드마다 **그 보드가 다루는 종목 종류**로 조회 대상을 고른다.
//
// 카드 표면 101장에는 ELW·ETF·금현물 화면이 섞여 있다. 전부 삼성전자(005930)로
// 조회하면 그 화면들의 응답이 빈 배열로 오거나(실측 2XY6-0: ka30011이 005930에 빈
// 배열) 상류가 502로 끊는다(실측 2RJ7-1: ka50012·ka50079~83) — 제품 결함이 아니라
// 검사가 잘못 물어본 것이다.
//
// 종류별 코드는 **API가 알려준 것만** 쓴다. 목록 op가 있으면 한 번 부르고 첫 항목을
// 쓰고, 없으면 그 op 요청 설명문에 Kiwoom이 적어 둔 코드를 쓴다 — 코드를 지어내지
// 않는다(백엔드의 연쇄 인자와 같은 규칙). 표는 백엔드 ref 하나에 있고 파이썬 검사기도
// 같은 파일을 읽는다(`scripts/card-api-sweep/verify_operations.py`).

const fs = require('node:fs');
const path = require('node:path');

const REF = path.resolve(
  __dirname, '..', '..', 'backend', 'ref', 'probe-instrument-targets.json',
);

function loadKinds() {
  const payload = JSON.parse(fs.readFileSync(REF, 'utf8'));
  return Object.freeze(payload.kinds.map((entry) => Object.freeze(entry)));
}

const KINDS = loadKinds();

function kindOfBoard(operationRefs) {
  for (const ref of operationRefs || []) {
    const parts = String(ref).split(':');
    const trId = parts.length >= 2 ? parts[1] : '';
    for (const entry of KINDS) {
      if (entry.tr_prefixes.some((prefix) => trId.startsWith(prefix))) return entry.kind;
    }
  }
  return 'stock';
}

async function resolveKindCode(kind, { backendBase, fetchImpl }) {
  const entry = KINDS.find((candidate) => candidate.kind === kind);
  if (!entry) return null;
  // 설명문이 코드를 적어 둔 종류는 호출 없이 그 코드를 쓴다.
  if (entry.code) return entry.code;
  const source = entry.list;
  if (!source) return null;
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') return null;
  let response;
  try {
    response = await fetcher(`${backendBase}${source.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source.body || {}),
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
  const rows = payload && Array.isArray(payload[source.list_field])
    ? payload[source.list_field]
    : [];
  for (const row of rows) {
    const code = row && typeof row[source.code_field] === 'string'
      ? row[source.code_field].trim()
      : '';
    if (code) return code;
  }
  return null;
}

module.exports = { KINDS, kindOfBoard, resolveKindCode };
