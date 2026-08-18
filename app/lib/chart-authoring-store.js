'use strict';

// 저작 상태 영속(CC-104) — plan/chart-lens-spec.md §3 계약.
// 4종(지표 on/off+파라미터 · 차트형식 · 매물대 토글 · 드로잉)을 종목×주기 키로
// 저장·복원한다. AITS는 드로잉만 영속했지만(chart-card-control-spec §9) Athena는
// 4종 전부를 영속한다 — 갭을 승계하지 않는 신규 결정.
//
// 저장소는 렌더러 localStorage 1판이다(백엔드 영속은 후속 라운드 — 정직 표기는
// chart-card.js note에 있다). storage는 주입 가능한 인터페이스(getItem/setItem)로
// 추상화한다 — 단위 테스트는 메모리 맵을 쓴다.
//
// 직렬화 스키마는 화이트리스트다: 지표 가시성·파라미터, 형식, 매물대, 드로잉
// 배열만 나간다. 비밀값·계좌정보가 들어갈 자리 자체가 없고, 테스트가 이 사실을
// 고정한다(스키마에 없는 키는 역직렬화에서 버려진다).

const SCHEMA_VERSION = 1;
const KEY_PREFIX = 'chart.authoring';
const FORMS = new Set(['candle', 'bar', 'line', 'area']);

// 주기 토큰 — 키의 마지막 조각. 'D'/'W'/'M'/'Y'는 그대로, 분·틱은 세분을 붙인다
// (예: MIN3, TICK5). 세분을 키에 포함하는 이유: 3분봉과 30분봉은 사용자가 보는
// 시계열 밀도가 달라 저작 상태(지표 기간·매물대)도 따로 관리하는 게 자연스럽다 —
// AITS의 'D' 축약 관례(chart.drawings.005930.D)를 세분까지 확장한 형태.
function periodToken(period, interval) {
  if (period === 'MIN' || period === 'TICK') return `${period}${interval || 1}`;
  return period;
}

function authoringKey(symbol, token) {
  return `${KEY_PREFIX}.${symbol}.${token}`;
}

// state: {form, volumeProfileOn, visible: Set|Array, params: {[id]: {...}}, drawings?: []}
// → 직렬화 가능한 화이트리스트 평면 객체.
function serializeAuthoring(state) {
  const s = state || {};
  const visible = Array.from(s.visible || []).filter((v) => typeof v === 'string');
  visible.sort(); // 결정적 직렬화 — 같은 상태는 같은 문자열
  const params = {};
  for (const id of Object.keys(s.params || {})) {
    const p = s.params[id];
    if (p && typeof p === 'object') params[id] = JSON.parse(JSON.stringify(p));
  }
  return {
    v: SCHEMA_VERSION,
    form: FORMS.has(s.form) ? s.form : 'candle',
    volumeProfileOn: !!s.volumeProfileOn,
    indicators: { visible, params },
    drawings: Array.isArray(s.drawings) ? s.drawings : [], // CC-105가 채운다
  };
}

// 역직렬화 + 검증. 손상·버전 불일치·형 오류는 null(무시하고 기본값 사용) —
// 조용히 반쯤 깨진 상태를 복원하지 않는다.
function deserializeAuthoring(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.v !== SCHEMA_VERSION) return null; // 마이그레이션 가드 — 버전이 다르면 버린다(1판)
  if (!FORMS.has(obj.form)) return null;
  const ind = obj.indicators;
  if (!ind || typeof ind !== 'object' || !Array.isArray(ind.visible)) return null;
  return {
    form: obj.form,
    volumeProfileOn: !!obj.volumeProfileOn,
    indicators: {
      visible: ind.visible.filter((v) => typeof v === 'string'),
      params: ind.params && typeof ind.params === 'object' ? ind.params : {},
    },
    drawings: Array.isArray(obj.drawings) ? obj.drawings : [],
  };
}

// storage: {getItem(key), setItem(key, value)} — localStorage 또는 테스트용 맵.
function createAuthoringStore(storage) {
  const enabled = !!(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');

  function load(symbol, token) {
    if (!enabled) return null;
    try {
      return deserializeAuthoring(storage.getItem(authoringKey(symbol, token)));
    } catch (err) {
      return null;
    }
  }

  function save(symbol, token, state) {
    if (!enabled) return false;
    try {
      storage.setItem(authoringKey(symbol, token), JSON.stringify(serializeAuthoring(state)));
      return true;
    } catch (err) {
      return false; // 쿼터 초과 등 — 저장 실패는 조용히 삼키되 false로 알린다
    }
  }

  return { load, save, enabled };
}

module.exports = {
  periodToken,
  authoringKey,
  serializeAuthoring,
  deserializeAuthoring,
  createAuthoringStore,
  SCHEMA_VERSION,
};
