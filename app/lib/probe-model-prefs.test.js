// 프로브가 심는 모델 선택이 **앱이 읽는 값과 같은지** 본다. 값만 파일에 적어 두고
// 화이트리스트를 어기면 model-prefs가 그 필드만 조용히 기본으로 저하시켜(readState),
// 검사기는 지정한 모델이 아니라 앱 기본으로 돌면서도 아무 말을 하지 않는다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PROBE_MODEL_PREFS, writeProbeModelPrefs } = require('./probe-model-prefs');
const modelPrefs = require('./main/model-prefs');

test('프로브 프로필에 심은 모델 선택을 앱이 그대로 읽는다', () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-model-'));
  const file = writeProbeModelPrefs(profile);
  assert.equal(file, path.join(profile, 'athena-model.json'));

  const previous = process.env.ATHENA_MODEL_PREFS_PATH;
  process.env.ATHENA_MODEL_PREFS_PATH = file;
  try {
    assert.deepEqual(modelPrefs.get(), {
      claude: { model: null, effort: null },
      grok: { model: 'grok-4.5', effort: 'low' },
    });
  } finally {
    if (previous === undefined) delete process.env.ATHENA_MODEL_PREFS_PATH;
    else process.env.ATHENA_MODEL_PREFS_PATH = previous;
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

test('심는 값은 grok-4.5 · low로 못박혀 있다', () => {
  assert.equal(PROBE_MODEL_PREFS.grok.model, 'grok-4.5');
  assert.equal(PROBE_MODEL_PREFS.grok.effort, 'low');
});
