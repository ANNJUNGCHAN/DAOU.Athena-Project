// 최초 실행 게이트 (AT-SY-002/003). 대화 창을 최대 높이로 확장해 온보딩을
// 보여줄지 결정하는 상태 머신 — 창 자체를 다루지 않는다(main.js가 한다).
//
// step 값 해석 — plan/paper-specs/00-통합-계획.md §7-2가 이미 기록한 열린
// 질문 그대로: 실제 아트보드 22개 전체에 "1 / 3" 화면이 존재하지 않는다.
// 존재하는 두 온보딩 화면은 "2 / 3"(AT-SY-002, CLI 연결)과 "3 / 3"(AT-SY-003,
// 계좌 연결)뿐이다. 그래서 이 모듈은 온보딩을 **2단계로** 구현한다 — step 2
// (CLI) → step 3(계좌). step 1은 IPC 계약의 타입(`1|2|3`)에는 남겨두되 이
// 모듈이 실제로 반환하지는 않는다. 이 해석은 오케스트레이터 확인이 필요한
// 가정이다(각주에 남긴 그대로) — README/보고서에서 다시 밝힌다.

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
