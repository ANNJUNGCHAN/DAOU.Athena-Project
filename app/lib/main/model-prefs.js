// 모델·추론강도(effort) 설정 저장소 — 설정 화면의 모델 패널이 쓴다
// (plan/paper-specs 모델 패널 조사, 팀리드 지시 2026-08-18).
//
// prefs.js·accounts.js와 같은 골격이다: statePath()가 userData 아래
// athena-model.json을 가리키고, readState()는 실패·검증 실패 시 기본값으로
// 폴백하며(fail-open), writeState()는 tmp-then-rename 원자적 쓰기를 쓴다.
//
// 형상: { claude: {model, effort}, codex: {model, effort} } — model/effort가
// null이면 "기본"이다. claude-runner.js의 buildArgs()는 null을 받으면
// --model/--effort 인자 자체를 안 붙인다(claude CLI 자체 기본값을 쓴다는 뜻).
//
// codex 쪽은 저장만 한다 — 이 앱은 지금 codex를 질의에 쓰지 않는다(CLAUDE.md가
// 규정하는 실배선은 claude -p 하나뿐). codex config 파일(model/model_reasoning_effort)은
// 건드리지 않는다. 여기 값은 설정 화면에 값만 보존해 두는 용도다.
//
// 검증(저장 전 거부, 무시가 아니다): model은 조사 확정 근거(claude -p --model
// <별칭|전체ID>, 예: fable/opus/sonnet/haiku/default, 확장 컨텍스트 접미사
// "claude-sonnet-4-5[1m]" 등)를 따라 영문·숫자·점·하이픈·대괄호만, 최대 64자,
// 선두 '-' 금지(claude의 인자 파서가 값을 플래그로 오독하는 걸 막는다 — 팀리드
// 지시). effort는 claude ∈ {low,medium,high,xhigh,max}(claude -p --effort),
// codex ∈ {minimal,low,medium,high,xhigh}(codex config model_reasoning_effort).
// 화이트리스트 밖 값은 { ok:false, error } — 조용히 버리지 않는다.
'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_STATE = {
  claude: { model: null, effort: null },
  codex: { model: null, effort: null },
};

const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CODEX_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
const EFFORT_SETS = { claude: CLAUDE_EFFORTS, codex: CODEX_EFFORTS };

// 영문·숫자·점·하이픈·대괄호, 1~64자. 하이픈은 문자셋에 포함되므로 "선두 금지"는
// 별도로 검사한다(정규식만으로는 "-model" 같은 값을 걸러내지 못한다).
const MODEL_CHARSET_RE = /^[A-Za-z0-9.[\]-]{1,64}$/;

function isValidModel(model) {
  if (typeof model !== 'string' || !model) return false;
  if (model.startsWith('-')) return false;
  return MODEL_CHARSET_RE.test(model);
}

function isValidEffort(provider, effort) {
  const set = EFFORT_SETS[provider];
  return !!set && typeof effort === 'string' && set.has(effort);
}

// 테스트 오버라이드 — mcp-env.js/mcp-cli.js의 ATHENA_MCP_REGISTRY_PATH와 같은
// 패턴이다. 이 덕분에 순수 `node --test`에서 `app.getPath()`(진짜 Electron
// 필요)를 안 건드리고도 원자적 쓰기·검증·fail-open을 검증할 수 있다.
function statePath() {
  return process.env.ATHENA_MODEL_PREFS_PATH || path.join(app.getPath('userData'), 'athena-model.json');
}

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf-8'));
    const out = { claude: { ...DEFAULT_STATE.claude }, codex: { ...DEFAULT_STATE.codex } };
    for (const provider of Object.keys(DEFAULT_STATE)) {
      const entry = raw && raw[provider];
      if (!entry || typeof entry !== 'object') continue;
      // 저장된 값이 지금 기준으로 무효면(예: 화이트리스트가 바뀜) 그 필드만
      // 기본값으로 저하된다 — 파일 전체를 버리지 않는다.
      if (typeof entry.model === 'string' && isValidModel(entry.model)) out[provider].model = entry.model;
      if (typeof entry.effort === 'string' && isValidEffort(provider, entry.effort)) out[provider].effort = entry.effort;
    }
    return out;
  } catch {
    return { claude: { ...DEFAULT_STATE.claude }, codex: { ...DEFAULT_STATE.codex } };
  }
}

function writeState(state) {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// athena:model-get -> { claude: {model, effort}, codex: {model, effort} }
function get() {
  return readState();
}

// athena:model-set({provider, patch}) -> { ok:true, state } | { ok:false, error }
// patch.model/patch.effort가 null이면 그 필드만 기본(null)으로 되돌린다.
// patch에 없는 키는 건드리지 않는다(부분 갱신).
function set({ provider, patch } = {}) {
  if (provider !== 'claude' && provider !== 'codex') {
    return { ok: false, error: 'invalid-provider' };
  }
  const patchObj = patch && typeof patch === 'object' ? patch : {};
  const state = readState();
  const next = { ...state[provider] };

  if ('model' in patchObj) {
    if (patchObj.model === null) {
      next.model = null;
    } else if (!isValidModel(patchObj.model)) {
      return { ok: false, error: 'invalid-model' };
    } else {
      next.model = patchObj.model;
    }
  }

  if ('effort' in patchObj) {
    if (patchObj.effort === null) {
      next.effort = null;
    } else if (!isValidEffort(provider, patchObj.effort)) {
      return { ok: false, error: 'invalid-effort' };
    } else {
      next.effort = patchObj.effort;
    }
  }

  state[provider] = next;
  writeState(state);
  return { ok: true, state };
}

module.exports = { get, set, isValidModel, isValidEffort };
