
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
  glassLevel: 'default',
};

// 글자 크기 5단계(2026-08-19 사용자 지시 "글자가 너무 큼") — 값은 tokens.css의
// :root[data-font-size=...] 토큰 세트 키다. 두 렌더러가 <html> dataset으로 적용한다.
const FONT_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'];

// 유리 투명도 5단(Paper 보드 07 AT-ST-010a, 2026-08-24 리프 1.1.2 — 3단
// clear/default/opaque 사이에 sheer·solid를 끼워 넣는다). 값은 tokens.css의
// :root[data-glass=...] 토큰 세트 키이고, 적용 문법은 글자 크기와 동일하다.
// 유리 사다리의 순서 계약(① 단계 안: window < card < canvas < window-max,
// ② 단계 간: clear < sheer < default < solid < opaque)은 다섯 단계 모두에서
// 지켜진다 — 단계는 스케일만 옮긴다.
const GLASS_LEVELS = ['clear', 'sheer', 'default', 'solid', 'opaque'];

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
      } else if (key === 'glassLevel') {
        if (GLASS_LEVELS.includes(raw[key])) out[key] = raw[key];
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
    } else if (key === 'glassLevel') {
      if (GLASS_LEVELS.includes(v)) next[key] = v;
    }
  }
  writeState(next);
  return next;
}

module.exports = { get, set };
