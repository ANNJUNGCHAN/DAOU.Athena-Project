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

const PREF_DEFAULTS = { autoExpandCanvas: true, autoGrowChat: true };

function statePath() {
  return path.join(app.getPath('userData'), 'athena-prefs.json');
}

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf-8'));
    const out = { ...PREF_DEFAULTS };
    for (const key of Object.keys(PREF_DEFAULTS)) {
      if (typeof raw[key] === 'boolean') out[key] = raw[key];
    }
    return out;
  } catch {
    return { ...PREF_DEFAULTS };
  }
}

function writeState(state) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// athena:settings:prefs:get -> { autoExpandCanvas, autoGrowChat }
function get() {
  return readState();
}

// athena:settings:prefs:set(patch) -> 저장된 최종 상태. boolean이 아닌 키는 무시한다
// (baa7e0e의 readPrefs 검증 규칙 그대로 — 잘못된 값으로 상태가 오염되지 않는다).
function set(patch) {
  const next = { ...readState() };
  for (const key of Object.keys(PREF_DEFAULTS)) {
    if (typeof (patch && patch[key]) === 'boolean') next[key] = patch[key];
  }
  writeState(next);
  return next;
}

module.exports = { get, set, PREF_DEFAULTS };
