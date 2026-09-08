'use strict';

// 프로브가 쓰는 모델 선택. 검사기는 사람이 고른 설정을 물려받지 않으므로(프로필이
// 매번 새로 난다) 어떤 모델로 돌았는지가 실행마다 달라진다. 검수 기준을 하나로
// 두려면 프로브 프로필에 그 값을 심어야 한다.
//
// 지정: Grok은 `grok-4.5` · 노력 `low`(2026-09-09 사용자 지정). Claude 쪽은 손대지
// 않는다 — 기본값(null)이면 앱이 자기 기본을 쓴다.
//
// 저장 형식은 `lib/main/model-prefs.js`의 상태 파일과 같다(`athena-model.json`).
// 그 파일이 무효한 값을 만나면 그 필드만 기본으로 저하되므로, 여기서 쓰는 값도
// 그 화이트리스트(GROK_EFFORTS·isValidModel)를 지켜야 조용히 무시되지 않는다.

const fs = require('node:fs');
const path = require('node:path');

const PROBE_MODEL_PREFS = Object.freeze({
  claude: { model: null, effort: null },
  grok: { model: 'grok-4.5', effort: 'low' },
});

function writeProbeModelPrefs(profileDirectory) {
  if (!profileDirectory) return null;
  const file = path.join(profileDirectory, 'athena-model.json');
  fs.writeFileSync(file, `${JSON.stringify(PROBE_MODEL_PREFS, null, 1)}\n`);
  return file;
}

module.exports = { PROBE_MODEL_PREFS, writeProbeModelPrefs };
