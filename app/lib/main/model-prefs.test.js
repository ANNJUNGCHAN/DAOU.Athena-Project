// model-prefs.js 단위 테스트 — 순수 `node --test`(Electron 없음)로 돈다.
// ATHENA_MODEL_PREFS_PATH 오버라이드(mcp-env.js의 ATHENA_MCP_REGISTRY_PATH와
// 같은 패턴)로 statePath()가 app.getPath()를 절대 안 건드리게 만든다 — 그래서
// require('electron')이 진짜 Electron이 아니어도(순수 Node에서 문자열을
// 돌려주는 잘 알려진 동작) 이 테스트는 안전하다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const modelPrefs = require('./model-prefs');

async function withTempState(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-model-prefs-test-'));
  const statePath = path.join(tmp, 'athena-model.json');
  const prev = process.env.ATHENA_MODEL_PREFS_PATH;
  process.env.ATHENA_MODEL_PREFS_PATH = statePath;
  try {
    return await fn(statePath);
  } finally {
    if (prev === undefined) delete process.env.ATHENA_MODEL_PREFS_PATH;
    else process.env.ATHENA_MODEL_PREFS_PATH = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('get: 상태 파일이 없으면 둘 다 기본값(null)', async () => {
  await withTempState(() => {
    assert.deepEqual(modelPrefs.get(), {
      claude: { model: null, effort: null },
      codex: { model: null, effort: null },
    });
  });
});

test('set: 유효한 모델 문자열을 저장하고 전체 상태를 돌려준다', async () => {
  await withTempState(() => {
    const result = modelPrefs.set({ provider: 'claude', patch: { model: 'claude-sonnet-5' } });
    assert.equal(result.ok, true);
    assert.equal(result.state.claude.model, 'claude-sonnet-5');
    assert.equal(modelPrefs.get().claude.model, 'claude-sonnet-5');
  });
});

test('set: 대괄호 확장 컨텍스트 접미사([1m])를 허용한다', async () => {
  await withTempState(() => {
    const result = modelPrefs.set({ provider: 'claude', patch: { model: 'claude-sonnet-4-5[1m]' } });
    assert.equal(result.ok, true);
    assert.equal(result.state.claude.model, 'claude-sonnet-4-5[1m]');
  });
});

test('set: 64자 모델 문자열은 경계값으로 허용된다', async () => {
  await withTempState(() => {
    const result = modelPrefs.set({ provider: 'claude', patch: { model: 'a'.repeat(64) } });
    assert.equal(result.ok, true);
  });
});

test('set: 65자 모델 문자열은 거부된다(64자 상한)', async () => {
  await withTempState(() => {
    const result = modelPrefs.set({ provider: 'claude', patch: { model: 'a'.repeat(65) } });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-model');
  });
});

test('set: 선두 "-"인 모델 문자열은 거부된다 — claude 인자 파서가 플래그로 오독하는 걸 막는다', async () => {
  await withTempState(() => {
    const result = modelPrefs.set({ provider: 'claude', patch: { model: '-model' } });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-model');
  });
});

test('set: 허용 문자셋(영문·숫자·점·하이픈·대괄호) 밖의 값은 거부된다', async () => {
  await withTempState(() => {
    for (const model of ['has space', 'a/b', 'a;b', 'a$b', 'a,b', '한글모델']) {
      const result = modelPrefs.set({ provider: 'claude', patch: { model } });
      assert.equal(result.ok, false, `${model}은 거부돼야 한다`);
      assert.equal(result.error, 'invalid-model');
    }
  });
});

test('set: claude effort 화이트리스트 — low/medium/high/xhigh/max만 허용, minimal은 거부', async () => {
  await withTempState(() => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const result = modelPrefs.set({ provider: 'claude', patch: { effort } });
      assert.equal(result.ok, true, `${effort}는 허용돼야 한다`);
    }
    const bad = modelPrefs.set({ provider: 'claude', patch: { effort: 'minimal' } });
    assert.equal(bad.ok, false); // minimal은 codex 전용
    assert.equal(bad.error, 'invalid-effort');
  });
});

test('set: codex effort 화이트리스트 — minimal/low/medium/high/xhigh만 허용, max는 거부', async () => {
  await withTempState(() => {
    for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
      const result = modelPrefs.set({ provider: 'codex', patch: { effort } });
      assert.equal(result.ok, true, `${effort}는 허용돼야 한다`);
    }
    const bad = modelPrefs.set({ provider: 'codex', patch: { effort: 'max' } });
    assert.equal(bad.ok, false); // max는 claude 전용
    assert.equal(bad.error, 'invalid-effort');
  });
});

test('set: patch 값 null은 그 필드만 기본값으로 되돌린다', async () => {
  await withTempState(() => {
    modelPrefs.set({ provider: 'claude', patch: { model: 'claude-opus-5', effort: 'high' } });
    const result = modelPrefs.set({ provider: 'claude', patch: { model: null, effort: null } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.state.claude, { model: null, effort: null });
  });
});

test('set: patch에 없는 키는 건드리지 않는다(부분 갱신)', async () => {
  await withTempState(() => {
    modelPrefs.set({ provider: 'claude', patch: { model: 'claude-opus-5', effort: 'high' } });
    const result = modelPrefs.set({ provider: 'claude', patch: { effort: 'low' } });
    assert.equal(result.state.claude.model, 'claude-opus-5'); // model은 그대로
    assert.equal(result.state.claude.effort, 'low');
  });
});

test('set: 알 수 없는 provider는 거부된다', async () => {
  await withTempState(() => {
    const result = modelPrefs.set({ provider: 'gemini', patch: { model: 'x' } });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-provider');
  });
});

test('set: 한쪽 provider 갱신이 다른 쪽 provider 값을 건드리지 않는다', async () => {
  await withTempState(() => {
    modelPrefs.set({ provider: 'codex', patch: { model: 'gpt-5-codex' } });
    const result = modelPrefs.set({ provider: 'claude', patch: { model: 'claude-sonnet-5' } });
    assert.equal(result.state.codex.model, 'gpt-5-codex');
    assert.equal(result.state.claude.model, 'claude-sonnet-5');
  });
});

test('원자적 쓰기: 쓰고 나면 .tmp 파일이 안 남고 최종 파일에만 값이 있다', async () => {
  await withTempState((statePath) => {
    modelPrefs.set({ provider: 'claude', patch: { model: 'claude-sonnet-5' } });
    assert.ok(fs.existsSync(statePath));
    assert.ok(!fs.existsSync(`${statePath}.tmp`));
    const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.equal(onDisk.claude.model, 'claude-sonnet-5');
  });
});

test('fail-open: 상태 파일이 깨진 JSON이어도 기본값으로 저하된다(던지지 않는다)', async () => {
  await withTempState((statePath) => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{이건 JSON이 아니다', 'utf-8');
    assert.doesNotThrow(() => modelPrefs.get());
    assert.deepEqual(modelPrefs.get(), {
      claude: { model: null, effort: null },
      codex: { model: null, effort: null },
    });
  });
});

test('fail-open: 저장된 값 중 검증에 실패하는 필드만 기본값으로 저하되고 나머지는 보존된다', async () => {
  await withTempState((statePath) => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      claude: { model: '-bad-flag-like', effort: 'not-a-real-effort' },
      codex: { model: 'gpt-5-codex', effort: 'medium' },
    }), 'utf-8');
    const state = modelPrefs.get();
    assert.deepEqual(state.claude, { model: null, effort: null });
    assert.deepEqual(state.codex, { model: 'gpt-5-codex', effort: 'medium' });
  });
});

test('isValidModel/isValidEffort: 모듈 내부 검증 함수도 직접 호출 가능하다', () => {
  assert.equal(modelPrefs.isValidModel('claude-sonnet-5'), true);
  assert.equal(modelPrefs.isValidModel('-x'), false);
  assert.equal(modelPrefs.isValidEffort('claude', 'max'), true);
  assert.equal(modelPrefs.isValidEffort('codex', 'max'), false);
});
