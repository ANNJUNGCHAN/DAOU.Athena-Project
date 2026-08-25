
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./json-store');

function statePath() {
  return path.join(app.getPath('userData'), 'athena-onboarding.json');
}

function readState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      cliDone: !!parsed.cliDone,
      accountDone: !!parsed.accountDone,
    };
  } catch {
    return { cliDone: false, accountDone: false };
  }
}

function writeState(state) {
  writeJsonAtomic(statePath(), state);
}

// athena:onboarding-state -> { needed, step }
function getState() {
  const s = readState();
  if (!s.cliDone) return { needed: true, step: 2 };
  if (!s.accountDone) return { needed: true, step: 3 };
  return { needed: false, step: 3 };
}

// athena:onboarding-advance { step } -> { ok, done }
// step 2 완료 = CLI 연결 단계 통과. step 3 완료 = 계좌 연결 단계 통과(=온보딩 전체 종료).
function advance(step) {
  const s = readState();
  if (step === 2) {
    s.cliDone = true;
  } else if (step === 3) {
    s.accountDone = true;
  } else {
    return { ok: false, done: false };
  }
  writeState(s);
  const done = s.cliDone && s.accountDone;
  return { ok: true, done };
}

module.exports = { getState, advance };
