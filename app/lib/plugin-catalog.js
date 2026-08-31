// Paper 플러그인 03(허브) "추천" 목록의 원천 — 내장 마켓플레이스 `athena-official`.
//
// 여기 있는 항목은 **실제로 설치된다**. 각 항목의 command/args는 그대로
// `athena-mcp register --alias <id> --command <command> --arg <arg>...`로 넘어가고,
// 그 뒤 approve → probe → allow가 이어진다(canvas.js pluginInstallCatalogEntry).
// 그래서 이 파일에 실행되지 않는 스펙을 넣으면 안 된다 — 설치 버튼은 눌리는데
// probe에서만 실패하는, 화면과 실제가 어긋나는 상태가 된다.
//
// 선정 기준 (2026-09-01):
//   1. API 키·계정이 필요 없다 — 설치 직후 바로 붙는다.
//   2. 실행기가 `uvx` 또는 `npx` 하나뿐이다 — 별도 설치 절차가 없다.
//   3. 투자 대화에서 실제로 쓸모가 있다.
//
// `requestedFeatures`/`toolNames`는 2026-09-01에 이 저장소에서 실제로
// register → approve → probe를 돌려 받아 적은 값이다(추측이 아니다). 그래도
// **설치 뒤 allowlist는 probe 결과만 쓴다** — 카탈로그가 낡으면 존재하지 않는
// 도구를 허용 목록에 넣게 되기 때문이다(canvas.js pluginSaveTools 주석의 그 결함).
// 여기 적힌 도구 이름은 설치 전 "무엇을 승인하는지" 보여주기 위한 표시값이다.
(function () {
'use strict';

const CATALOG = Object.freeze([
  Object.freeze({
    id: 'fetch',
    name: '웹 문서 읽기',
    description: '공시·리서치 웹 페이지를 마크다운으로 읽습니다',
    provider: 'Model Context Protocol · mcp-server-fetch',
    purpose: '웹 페이지 원문 조회 · HTML→마크다운 변환',
    source: 'marketplace · athena-official',
    marketplaceId: 'athena-official',
    runner: 'uvx',
    command: 'uvx',
    args: Object.freeze(['mcp-server-fetch']),
    toolNames: Object.freeze(['fetch']),
    requestedFeatures: Object.freeze([
      'fetch — 지정한 URL의 본문을 마크다운으로 가져옵니다',
    ]),
  }),
  Object.freeze({
    id: 'time',
    name: '시간·시간대',
    description: '현재 시각과 시간대 변환을 정확히 계산합니다',
    provider: 'Model Context Protocol · mcp-server-time',
    purpose: '현재 시각 조회 · IANA 시간대 변환',
    source: 'marketplace · athena-official',
    marketplaceId: 'athena-official',
    runner: 'uvx',
    command: 'uvx',
    args: Object.freeze(['mcp-server-time']),
    toolNames: Object.freeze(['get_current_time', 'convert_time']),
    requestedFeatures: Object.freeze([
      'get_current_time — 지정한 시간대의 현재 시각',
      'convert_time — 시간대 간 시각 변환',
    ]),
  }),
  Object.freeze({
    id: 'sequential-thinking',
    name: '단계적 사고',
    description: '복잡한 판단을 단계로 쪼개 이어 붙입니다',
    provider: 'Model Context Protocol · server-sequential-thinking',
    purpose: '다단계 추론 보조',
    source: 'marketplace · athena-official',
    marketplaceId: 'athena-official',
    runner: 'npx',
    command: 'npx',
    args: Object.freeze(['-y', '@modelcontextprotocol/server-sequential-thinking']),
    toolNames: Object.freeze(['sequentialthinking']),
    requestedFeatures: Object.freeze([
      'sequentialthinking — 생각 단계를 기록·수정하고 되돌립니다',
    ]),
  }),
  Object.freeze({
    id: 'memory',
    name: '지식 그래프 메모리',
    description: '관심 종목·성향을 그래프로 기억합니다',
    provider: 'Model Context Protocol · server-memory',
    purpose: '지식 그래프 기반 장기 기억',
    source: 'marketplace · athena-official',
    marketplaceId: 'athena-official',
    runner: 'npx',
    command: 'npx',
    args: Object.freeze(['-y', '@modelcontextprotocol/server-memory']),
    toolNames: Object.freeze([
      'create_entities', 'create_relations', 'add_observations',
      'delete_entities', 'delete_observations', 'delete_relations',
      'read_graph', 'search_nodes', 'open_nodes',
    ]),
    requestedFeatures: Object.freeze([
      'create_entities · create_relations · add_observations — 그래프에 쓰기',
      'delete_entities · delete_observations · delete_relations — 그래프에서 지우기',
      'read_graph · search_nodes · open_nodes — 그래프 읽기·검색',
    ]),
  }),
  Object.freeze({
    id: 'korea-stock',
    name: '한국 주식 시세',
    description: '국내 종목 시세·재무를 대화에서 조회합니다',
    provider: 'drfirst · @drfirst/korea-stock-mcp',
    purpose: '국내 주식 시장 데이터 조회',
    source: 'marketplace · athena-official',
    marketplaceId: 'athena-official',
    runner: 'npx',
    command: 'npx',
    args: Object.freeze(['-y', '@drfirst/korea-stock-mcp']),
    toolNames: Object.freeze([
      'search_stock_code', 'get_stock_price_by_code', 'get_market_cap_stocks',
      'get_dividend_yield_stocks', 'get_themes_with_leaders', 'get_etfs_by_market_cap',
    ]),
    requestedFeatures: Object.freeze([
      'search_stock_code · get_stock_price_by_code — 종목 검색과 시세',
      'get_market_cap_stocks · get_dividend_yield_stocks — 시총·배당 상위',
      'get_themes_with_leaders · get_etfs_by_market_cap — 테마주·ETF',
    ]),
  }),
]);

const MARKETPLACES = Object.freeze([
  Object.freeze({
    id: 'athena-official',
    name: 'athena-official',
    description: '앱 내장 카탈로그 · 키가 필요 없는 5종',
    builtin: true,
  }),
]);

// 허브 "추천"은 아직 등록되지 않은 항목만 보여준다. 이미 등록된 별칭을 추천에
// 남겨두면 같은 서버가 설치됨·추천 양쪽에 뜬다.
function recommendedFor(installedAliases, enabledMarketplaceIds) {
  const taken = new Set((installedAliases || []).map((a) => String(a)));
  const enabled = enabledMarketplaceIds == null
    ? null
    : new Set((enabledMarketplaceIds || []).map((id) => String(id)));
  return CATALOG
    .filter((entry) => !taken.has(entry.id))
    .filter((entry) => enabled == null || enabled.has(entry.marketplaceId))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      provider: entry.provider,
      purpose: entry.purpose,
      source: entry.source,
      runner: entry.runner,
      toolNames: [...entry.toolNames],
      command: entry.command,
      args: [...entry.args],
      requestedFeatures: [...entry.requestedFeatures],
    }));
}

function findEntry(id) {
  return CATALOG.find((entry) => entry.id === String(id)) || null;
}

// 레지스트리에 등록된 별칭이 카탈로그에서 왔으면 사람이 읽는 이름을 되돌려준다.
// 없으면 null — 호출자가 별칭을 그대로 쓴다(모르는 서버에 이름을 지어내지 않는다).
function displayNameFor(alias) {
  const entry = findEntry(alias);
  return entry ? entry.name : null;
}

const __exports = { CATALOG, MARKETPLACES, recommendedFor, findEntry, displayNameFor };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.PluginCatalog = __exports;
}

})();
