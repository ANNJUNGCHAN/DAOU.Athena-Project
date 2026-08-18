// codex-config.js 단위 테스트 — 순수 `node --test`(Electron 없음)로 돈다.
// CODEX_HOME을 임시 디렉토리로 돌려 이 머신의 진짜 ~/.codex/config.toml을
// 절대 건드리지 않는다(model-prefs.test.js의 ATHENA_MODEL_PREFS_PATH 오버라이드와
// 같은 격리 패턴).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const codexConfig = require('./codex-config');

async function withTempCodexHome(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-codex-config-test-'));
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = tmp;
  try {
    return await fn(tmp, path.join(tmp, 'config.toml'));
  } finally {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('codexHome/configPath: CODEX_HOME 환경변수를 그대로 따른다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    assert.equal(codexConfig.codexHome(), tmp);
    assert.equal(codexConfig.configPath(), cfgPath);
  });
});

test('readModelSettings: 파일이 없으면 model/effort null, exists:false', async () => {
  await withTempCodexHome(() => {
    assert.deepEqual(codexConfig.readModelSettings(), { model: null, effort: null, exists: false });
  });
});

test('(a) writeModelSettings: 파일이 없으면 새로 만들고 두 키를 쓴다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    const result = codexConfig.writeModelSettings({ model: 'gpt-5-codex', effort: 'medium' });
    assert.equal(result.ok, true);
    assert.equal(result.model, 'gpt-5-codex');
    assert.equal(result.effort, 'medium');
    assert.ok(fs.existsSync(cfgPath));
    const onDisk = fs.readFileSync(cfgPath, 'utf-8');
    assert.match(onDisk, /^model = "gpt-5-codex"$/m);
    assert.match(onDisk, /^model_reasoning_effort = "medium"$/m);
    assert.deepEqual(codexConfig.readModelSettings(), { model: 'gpt-5-codex', effort: 'medium', exists: true });
  });
});

test('(b) writeModelSettings: 기존 최상위 키를 in-place 교체한다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    fs.writeFileSync(cfgPath, [
      '# 내 codex 설정',
      'model = "old-model"',
      'model_reasoning_effort = "low"',
      '',
    ].join('\n'), 'utf-8');
    const result = codexConfig.writeModelSettings({ model: 'new-model' });
    assert.equal(result.ok, true);
    const onDisk = fs.readFileSync(cfgPath, 'utf-8');
    assert.equal(onDisk, [
      '# 내 codex 설정',
      'model = "new-model"',
      'model_reasoning_effort = "low"',
      '',
    ].join('\n'));
  });
});

test('(c) writeModelSettings: 키가 없으면 주석 뒤에 새로 추가한다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    fs.writeFileSync(cfgPath, [
      '# my codex config',
      'approval_policy = "never"',
      '',
    ].join('\n'), 'utf-8');
    const result = codexConfig.writeModelSettings({ effort: 'high' });
    assert.equal(result.ok, true);
    const onDisk = fs.readFileSync(cfgPath, 'utf-8');
    assert.equal(onDisk, [
      '# my codex config',
      'model_reasoning_effort = "high"',
      'approval_policy = "never"',
      '',
    ].join('\n'));
  });
});

test('(c-2) writeModelSettings: 둘 다 새로 추가하면 model 다음에 effort가 나란히 온다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    const result = codexConfig.writeModelSettings({ model: 'gpt-5-codex', effort: 'medium' });
    assert.equal(result.ok, true);
    const onDisk = fs.readFileSync(cfgPath, 'utf-8');
    const modelIdx = onDisk.indexOf('model = "gpt-5-codex"');
    const effortIdx = onDisk.indexOf('model_reasoning_effort = "medium"');
    assert.ok(modelIdx !== -1 && effortIdx !== -1 && modelIdx < effortIdx);
  });
});

test('(d) writeModelSettings: null 패치는 그 라인만 제거한다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    fs.writeFileSync(cfgPath, [
      'model = "gpt-5-codex"',
      'model_reasoning_effort = "medium"',
      '',
    ].join('\n'), 'utf-8');
    const result = codexConfig.writeModelSettings({ model: null });
    assert.equal(result.ok, true);
    assert.equal(result.model, null);
    assert.equal(result.effort, 'medium');
    const onDisk = fs.readFileSync(cfgPath, 'utf-8');
    assert.equal(onDisk, 'model_reasoning_effort = "medium"\n');
  });
});

test('(e) writeModelSettings: 주석·무관 키·[섹션]을 바이트 그대로 보존한다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    const original = [
      '# Athena가 아니라 사용자가 직접 쓴 codex 설정 파일이다',
      'model = "old-model"',
      'model_reasoning_effort = "low"',
      'approval_policy = "never"',
      '',
      '[mcp_servers.foo]',
      'command = "bar"',
      'args = ["--flag"]',
      '',
    ].join('\n');
    fs.writeFileSync(cfgPath, original, 'utf-8');
    codexConfig.writeModelSettings({ model: 'new-model' });
    const onDisk = fs.readFileSync(cfgPath, 'utf-8');
    const expected = original.replace('model = "old-model"', 'model = "new-model"');
    assert.equal(onDisk, expected);
  });
});

test('(f) writeModelSettings: 검증 실패 시 파일을 전혀 건드리지 않고 거부한다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    fs.writeFileSync(cfgPath, 'model = "keep-me"\n', 'utf-8');
    const badModel = codexConfig.writeModelSettings({ model: '-bad-flag-like' });
    assert.equal(badModel.ok, false);
    assert.equal(badModel.error, 'invalid-model');
    const badEffort = codexConfig.writeModelSettings({ effort: 'not-a-real-effort' });
    assert.equal(badEffort.ok, false);
    assert.equal(badEffort.error, 'invalid-effort');
    // codex effort 화이트리스트는 claude의 max를 안 받는다(공급자별 화이트리스트가 다르다)
    const claudeOnlyEffort = codexConfig.writeModelSettings({ effort: 'max' });
    assert.equal(claudeOnlyEffort.ok, false);
    assert.equal(claudeOnlyEffort.error, 'invalid-effort');
    assert.equal(fs.readFileSync(cfgPath, 'utf-8'), 'model = "keep-me"\n');
  });
});

test('(g) 최상위 스코프만 본다 — [섹션] 아래 동명 키를 오독하지 않는다', async () => {
  await withTempCodexHome((tmp, cfgPath) => {
    fs.writeFileSync(cfgPath, [
      'model = "top-level"',
      '',
      '[profile.default]',
      'model = "nested-value"',
      'model_reasoning_effort = "nested-effort"',
      '',
    ].join('\n'), 'utf-8');
    // 읽기: 최상위 값만 본다, 섹션 안의 effort는 최상위에 없으므로 null.
    assert.deepEqual(codexConfig.readModelSettings(), { model: 'top-level', effort: null, exists: true });
    // 쓰기: 최상위 model만 교체하고 섹션 안의 동명 키는 그대로 둔다.
    codexConfig.writeModelSettings({ model: 'changed' });
    const onDisk = fs.readFileSync(cfgPath, 'utf-8');
    assert.equal(onDisk, [
      'model = "changed"',
      '',
      '[profile.default]',
      'model = "nested-value"',
      'model_reasoning_effort = "nested-effort"',
      '',
    ].join('\n'));
  });
});

test('isValidCodexEffort: minimal~xhigh만 허용, claude 전용 max는 거부', () => {
  for (const effort of ['minimal', 'low', 'medium', 'high', 'xhigh']) {
    assert.equal(codexConfig.isValidCodexEffort(effort), true, `${effort}는 허용돼야 한다`);
  }
  assert.equal(codexConfig.isValidCodexEffort('max'), false);
  assert.equal(codexConfig.isValidCodexEffort('not-real'), false);
});
