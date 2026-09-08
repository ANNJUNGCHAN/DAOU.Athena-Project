
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./json-store');

const PREF_DEFAULTS = {
  autoExpandCanvas: true,
  autoGrowChat: true,
  // 'xs'였던 것이 2026-08-24 실측 버그였다: 렌더러 폴백(chat.js:92)과 무표시
  // 상태 기준(chat.js:97-99)은 'md'인데 메인 프로세스가 'xs'를 돌려줘서 IPC
  // 응답 전후로 글자 크기가 튀었다. tokens.css :root의 --text-base:13px가 곧
  // md 스케일이므로(FONT_SIZES 선언부 주석 참고) 기본값은 'md'가 맞다.
  fontSize: 'md',
  // WP-D1(그래프 후속 계획) — false면 history-sink.js가 대화 저장 자체를
  // 건너뛴다(원문 미적재). settings-cards.js의 그래프 설정 카드(localStorage)와
  // 이름은 같지만 이 값이 main 프로세스에서 실제로 게이팅하는 원본이다.
  collectChat: true,
  // WP-I I4 — backend 게이트(POST /settings/expose-to-model)에 미는 원본.
  // 기본값은 렌더러 카드(settings-cards.js GRAPH_SETTINGS_DEFAULTS)와 같은
  // true다 — backend 기동 초기값이 안전측 False(G-I5)라, 재동기화가 닿기
  // 전까지는 게이트가 닫혀 있다.
  exposeToModel: true,
};

// 글자 크기 5단계(2026-08-19 사용자 지시 "글자가 너무 큼") — 값은 tokens.css의
// :root[data-font-size=...] 토큰 세트 키다. 두 렌더러가 <html> dataset으로 적용한다.
const FONT_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'];

function statePath() {
  return path.join(app.getPath('userData'), 'athena-prefs.json');
}

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf-8'));
    const out = { ...PREF_DEFAULTS };
    for (const key of Object.keys(PREF_DEFAULTS)) {
      if (typeof PREF_DEFAULTS[key] === 'boolean') {
        if (typeof raw[key] === 'boolean') out[key] = raw[key];
      } else if (key === 'fontSize') {
        if (FONT_SIZES.includes(raw[key])) out[key] = raw[key];
      }
    }
    return out;
  } catch {
    return { ...PREF_DEFAULTS };
  }
}

function writeState(state) {
  writeJsonAtomic(statePath(), state);
}

// athena:settings:prefs:get -> { autoExpandCanvas, autoGrowChat }
function get() {
  return readState();
}

// athena:settings:prefs:set(patch) -> 저장된 최종 상태. 검증을 통과하지 못한 키는
// 무시한다(baa7e0e의 readPrefs 검증 규칙 계승 — 잘못된 값으로 상태가 오염되지 않는다).
function set(patch) {
  const next = { ...readState() };
  for (const key of Object.keys(PREF_DEFAULTS)) {
    const v = patch && patch[key];
    if (typeof PREF_DEFAULTS[key] === 'boolean') {
      if (typeof v === 'boolean') next[key] = v;
    } else if (key === 'fontSize') {
      if (FONT_SIZES.includes(v)) next[key] = v;
    }
  }
  writeState(next);
  return next;
}

module.exports = { get, set };
