// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 그래프 모드의 렌더러 쪽 설정.
//
// 백엔드 설정(적재 주기·추출 argv·임계값)과 **다른 종류**다. 그쪽은 설정 파일이
// 정본이고 이 앱 밖에서도 적용되지만, 여기 있는 것은 "이 화면을 어떻게 볼까"라서
// 사용자마다·창마다 다를 수 있다. 그래서 저장소도 다르다 — 백엔드에 왕복하지 않는다.
//
// 저장은 주입받은 것을 쓴다(`localStorage` 기본). 렌더러 테스트가 브라우저 없이 돌아야
// 하는데, 모듈이 전역 `localStorage`를 직접 잡으면 그게 불가능해진다.

const STORAGE_KEY = 'athena.graphMode.prefs';

const DEFAULTS = Object.freeze({
  // 처음 열었을 때 요약을 보여줄지 그래프를 보여줄지.
  defaultView: 'summary',
  // 군집 지도에 이름표를 붙일지. 노드가 많으면 글자가 겹쳐 읽을 수 없게 되므로
  // 임계 이하일 때만 붙인다.
  labelThreshold: 40,
  // 군집 경계를 넘는 엣지를 강조할지. 이것이 "놀라운 연결"의 화면 표현이다.
  highlightCrossings: true,
});

const VALID_VIEWS = ['summary', 'graph'];
const MIN_LABEL_THRESHOLD = 0;
const MAX_LABEL_THRESHOLD = 500;

function clampThreshold(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULTS.labelThreshold;
  return Math.min(MAX_LABEL_THRESHOLD, Math.max(MIN_LABEL_THRESHOLD, Math.round(number)));
}

// 저장된 값이 무엇이든 유효한 설정을 돌려준다.
//
// 손상된 값에 기본값으로 조용히 물러서는 이유: 설정 하나가 깨졌다고 그래프 화면이
// 통째로 안 열리면 사용자는 되돌릴 방법이 없다(설정 화면도 같은 앱 안에 있다).
function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    defaultView: VALID_VIEWS.includes(source.defaultView)
      ? source.defaultView
      : DEFAULTS.defaultView,
    labelThreshold: clampThreshold(
      source.labelThreshold === undefined ? DEFAULTS.labelThreshold : source.labelThreshold
    ),
    highlightCrossings:
      typeof source.highlightCrossings === 'boolean'
        ? source.highlightCrossings
        : DEFAULTS.highlightCrossings,
  };
}

function readPrefs(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) return { ...DEFAULTS };
  let raw = null;
  try {
    raw = JSON.parse(store.getItem(STORAGE_KEY));
  } catch (err) {
    // JSON이 깨졌다. 지우지는 않는다 — 사용자가 손으로 고칠 수 있게 남겨둔다.
    raw = null;
  }
  return normalize(raw);
}

function writePrefs(patch, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const next = normalize({ ...readPrefs(store), ...(patch || {}) });
  if (store) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      // 저장 실패(용량 초과·사생활 모드)는 화면을 막을 이유가 아니다. 이번 세션에는
      // 적용된 값을 그대로 돌려준다.
    }
  }
  return next;
}

// 이름표를 붙일지. 노드 수가 임계를 넘으면 글자가 겹쳐 읽을 수 없다.
function shouldShowLabels(prefs, nodeCount) {
  const settings = normalize(prefs);
  return Number(nodeCount || 0) <= settings.labelThreshold;
}

const __exports = {
  STORAGE_KEY,
  DEFAULTS,
  VALID_VIEWS,
  normalize,
  readPrefs,
  writePrefs,
  shouldShowLabels,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphModePrefs = __exports;
}

})();
