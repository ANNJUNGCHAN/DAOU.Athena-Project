'use strict';

// 보드 슬롯 하이드레이션 — 봉투가 못 채운 슬롯(surface_contract.unbound_slots)을
// 마운트 뒤에 한 번 더 채운다. 렌더러는 백엔드에 직접 붙지 않는다(backtest-bridge와
// 같은 관례): main이 REST를 부르고 봉투 {ok, data} 하나로 돌려준다.
//
// 계약(canvas_push.py internal_canvas_board_hydrate): POST /api/v1/internal/canvas/board-hydrate
//   요청 헤더 Authorization: Bearer <로컬 토큰>  — 없으면 401이다.
//   요청 {board_id, target: {manifest alias: 값}, account}
//   응답 {board_id, card_id, operations, surface_contract: {slot_values: [...], ...}}
//
// 붙은 백엔드에 이 경로가 없을 수 있다. 그때는 `status: 'unavailable'`을 돌려
// 렌더러가 로딩 오류와 재시도를 표시하게 한다. 없는 값을 완성 화면처럼 보이지 않는다.

const HYDRATE_PATH = '/api/v1/internal/canvas/board-hydrate';

// 미구현·미배포·차단을 전부 "아직 없다"로 본다. 500은 서버가 있는데 터진 것이라
// 여기 넣지 않는다 — 그건 오류로 보고한다.
const UNAVAILABLE_STATUS = new Set([0, 404, 405, 501, 502, 503]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

// target은 op의 manifest request alias로 적은 인자 가방이다(BoardHydrateRequest.target은
// dict — 문자열을 보내면 몸체 검증에서 422로 튕긴다). 값이 없는 alias는 아예 싣지 않는다
// (빈 문자열을 보내 백엔드가 ''를 인자로 오인하게 두지 않는다).
function buildTargetBag(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  const bag = {};
  for (const [alias, value] of Object.entries(target)) {
    if (!clean(alias) || value == null || clean(value) === '') continue;
    bag[alias] = value;
  }
  return Object.keys(bag).length ? bag : null;
}

// 요청 몸체는 계약이 정한 세 필드뿐이다. 값이 없는 필드는 아예 싣지 않는다.
function buildHydrateBody({ boardId, target, account, slotIds } = {}) {
  const board = clean(boardId);
  if (!board) throw new TypeError('board_id가 없다');
  const body = { board_id: board };
  const bag = buildTargetBag(target);
  if (bag) body.target = bag;
  const accountValue = clean(account);
  if (accountValue) body.account = accountValue;
  if (Array.isArray(slotIds)) {
    body.slot_ids = [...new Set(slotIds.map(clean).filter(Boolean))];
  }
  return body;
}

// 응답의 slot_values는 목록으로도 표로도 온다(봉투의 slot_values와 같은 관행).
// 어느 쪽이든 {slot_id: value} 표로 눌러 담는다. 모양이 틀린 항목은 버린다.
function normalizeSlotValues(raw) {
  if (!raw) return {};
  const values = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const slotId = clean(entry.slot_id);
      if (!slotId || !Object.prototype.hasOwnProperty.call(entry, 'value')) continue;
      values[slotId] = entry.value;
    }
    return values;
  }
  if (typeof raw !== 'object') return {};
  for (const [slotId, value] of Object.entries(raw)) {
    if (clean(slotId)) values[slotId] = value;
  }
  return values;
}

function normalizeOperations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const operationRef = clean(entry.operation_ref || entry.operationRef);
    const status = clean(entry.status);
    if (!operationRef || !status) return [];
    const normalized = { operation_ref: operationRef, status };
    const reason = clean(entry.reason);
    if (reason) normalized.reason = reason;
    if (Number.isInteger(entry.bound_count) && entry.bound_count >= 0) {
      normalized.bound_count = entry.bound_count;
    }
    return [normalized];
  });
}

async function hydrateBoard({ backendBase, fetchImpl, token, boardId, target, account, slotIds } = {}) {
  let body;
  try {
    body = buildHydrateBody({ boardId, target, account, slotIds });
  } catch (error) {
    return { ok: false, status: 'invalid', error: String((error && error.message) || error) };
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') {
    return { ok: false, status: 'unavailable', error: 'fetch 없음' };
  }
  // 로컬 베어러 — 이 경로는 require_local_bearer로 막혀 있다. 토큰이 없으면 빈
  // 자격을 지어내지 않고 헤더를 빼서, 401을 설정 결함으로 드러낸다.
  const headers = { 'Content-Type': 'application/json' };
  const bearer = clean(token);
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let response;
  try {
    response = await fetcher(`${clean(backendBase)}${HYDRATE_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    // 백엔드가 아직 안 떴거나 경로가 없다 — renderer가 재시도 가능한 오류로 표시한다.
    return { ok: false, status: 'unavailable', error: String((error && error.message) || error) };
  }
  const httpStatus = Number(response && response.status) || 0;
  if (!response || !response.ok) {
    if (UNAVAILABLE_STATUS.has(httpStatus)) {
      return { ok: false, status: 'unavailable', httpStatus };
    }
    return { ok: false, status: 'error', httpStatus, error: `HTTP ${httpStatus}` };
  }
  let payload = null;
  try {
    payload = typeof response.json === 'function' ? await response.json() : null;
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, status: 'error', httpStatus, error: '하이드레이션 응답이 비었다' };
  }
  // 값은 surface_contract 안에 있다(봉투의 표면 계약과 같은 자리). 최상위
  // slot_values는 옛 계약의 폴백으로만 본다.
  const contract = payload.surface_contract && typeof payload.surface_contract === 'object'
    ? payload.surface_contract
    : null;
  const slotValues = normalizeSlotValues(
    (contract && contract.slot_values) || payload.slot_values || payload.slotValues,
  );
  const operations = normalizeOperations(payload.operations);
  return {
    ok: true,
    status: 'hydrated',
    board_id: body.board_id,
    slot_values: slotValues,
    filled: Object.keys(slotValues).length,
    operations,
    // 하이드레이션으로 채워진 슬롯도 실시간 갱신을 받으려면 observation_id가 붙은
    // 원본 계약이 필요하다(렌더러가 realtimeSlotIndex를 다시 만든다).
    surface_contract: contract,
  };
}

module.exports = {
  HYDRATE_PATH,
  UNAVAILABLE_STATUS,
  buildHydrateBody,
  normalizeSlotValues,
  normalizeOperations,
  hydrateBoard,
};
