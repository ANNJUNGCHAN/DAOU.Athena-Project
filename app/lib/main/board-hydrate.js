'use strict';

// 보드 슬롯 하이드레이션 — 봉투가 못 채운 슬롯(surface_contract.unbound_slots)을
// 마운트 뒤에 한 번 더 채운다. 렌더러는 백엔드에 직접 붙지 않는다(backtest-bridge와
// 같은 관례): main이 REST를 부르고 봉투 {ok, data} 하나로 돌려준다.
//
// 계약(레인 B2): POST /api/v1/internal/canvas/board-hydrate
//   요청 {board_id, target, account}
//   응답 {slot_values: [{slot_id, value}, ...]}  또는 {slot_values: {slot_id: value}}
//
// 엔드포인트가 아직 없을 수 있다(레인 B2 진행 중). 그때는 실패가 아니라
// `status: 'unavailable'`로 조용히 접는다 — 화면은 결측어(미제공)를 그대로 둔다.
// 없는 값을 지어내지 않는 것이 이 경로의 유일한 안전 조건이다(헌장 신념 5).

const HYDRATE_PATH = '/api/v1/internal/canvas/board-hydrate';

// 미구현·미배포·차단을 전부 "아직 없다"로 본다. 500은 서버가 있는데 터진 것이라
// 여기 넣지 않는다 — 그건 오류로 보고한다.
const UNAVAILABLE_STATUS = new Set([0, 404, 405, 501, 502, 503]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

// 요청 몸체는 계약이 정한 세 필드뿐이다. 값이 없는 필드는 아예 싣지 않는다
// (빈 문자열을 보내 백엔드가 ''를 계좌로 오인하게 두지 않는다).
function buildHydrateBody({ boardId, target, account } = {}) {
  const board = clean(boardId);
  if (!board) throw new TypeError('board_id가 없다');
  const body = { board_id: board };
  const targetValue = clean(target);
  if (targetValue) body.target = targetValue;
  const accountValue = clean(account);
  if (accountValue) body.account = accountValue;
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

async function hydrateBoard({ backendBase, fetchImpl, boardId, target, account } = {}) {
  let body;
  try {
    body = buildHydrateBody({ boardId, target, account });
  } catch (error) {
    return { ok: false, status: 'invalid', error: String((error && error.message) || error) };
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') {
    return { ok: false, status: 'unavailable', error: 'fetch 없음' };
  }
  let response;
  try {
    response = await fetcher(`${clean(backendBase)}${HYDRATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // 백엔드가 아직 안 떴거나 경로가 없다 — 화면은 결측어를 그대로 둔다.
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
  const slotValues = normalizeSlotValues(payload.slot_values || payload.slotValues);
  return {
    ok: true,
    status: 'hydrated',
    board_id: body.board_id,
    slot_values: slotValues,
    filled: Object.keys(slotValues).length,
  };
}

module.exports = {
  HYDRATE_PATH,
  UNAVAILABLE_STATUS,
  buildHydrateBody,
  normalizeSlotValues,
  hydrateBoard,
};
