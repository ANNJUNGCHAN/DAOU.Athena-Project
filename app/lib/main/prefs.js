// 화면 설정(autoExpandCanvas/autoGrowChat) — 병합 커밋 c0d874b가 "후속 커밋에서
// 모드 구현에 옮긴다"고 약속하고 누락한 기능의 복구(2026-08-18). 원본은
// `git show baa7e0e -- app/main.js`(PREFS_FILE=userData/settings.json,
// readPrefs/writePrefs)에 있다 — app/README.md L606-608이 이미 지시한 대로
// 파일명만 이 저장소의 관례(athena-*.json)로 바꾼다.
//
// 이 모듈은 app/lib/main/accounts.js·onboarding.js와 같은 골격이다: statePath()가
// userData 아래 athena-prefs.json을 가리키고, readState()는 실패 시 기본값으로
// 폴백하며, writeState()는 tmp-then-rename 원자적 쓰기를 쓴다(baa7e0e의
// writePrefs는 이 패턴을 안 썼다 — 되살리며 맞춘다).

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./json-store');

const PREF_DEFAULTS = {
  autoExpandCanvas: true,
  autoGrowChat: true,
  fontSize: 'xs',
  glassLevel: 'default',
};

// 글자 크기 5단계(2026-08-19 사용자 지시 "글자가 너무 큼") — 값은 tokens.css의
// :root[data-font-size=...] 토큰 세트 키다. 두 렌더러가 <html> dataset으로 적용한다.
const FONT_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'];

// 유리 투명도 3단(2026-08-22 사용자 지시 — 애플 Liquid Glass 레퍼런스가 투명도를
// 사용자 슬라이더로 준다: "가장 투명 / 중간(기본값) / 가장 불투명"). 값은 tokens.css의
// :root[data-glass=...] 토큰 세트 키이고, 적용 문법은 글자 크기와 동일하다.
// 유리 사다리의 순서 계약(window < card < canvas < window-max)은 세 단계 모두에서
// 지켜진다 — 단계는 스케일만 옮긴다.
const GLASS_LEVELS = ['clear', 'default', 'opaque'];

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

module.exports = { get, set, PREF_DEFAULTS, FONT_SIZES, GLASS_LEVELS };
