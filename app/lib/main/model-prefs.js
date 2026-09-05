'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { writeJsonAtomic } = require('./json-store');

const DEFAULT_STATE = {
  claude: { model: null, effort: null },
  grok: { model: null, effort: null },
};

const CLAUDE_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const GROK_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const EFFORT_SETS = { claude: CLAUDE_EFFORTS, grok: GROK_EFFORTS };

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
    const out = {
      claude: { ...DEFAULT_STATE.claude },
      grok: { ...DEFAULT_STATE.grok },
    };
    for (const provider of Object.keys(DEFAULT_STATE)) {
      const entry = raw && raw[provider];
      if (!entry || typeof entry !== 'object') continue;
      // 저장된 값이 지금 기준으로 무효면(예: 화이트리스트가 바뀜) 그 필드만
      // 기본값으로 저하된다 — 파일 전체를 버리지 않는다. raw에 남아 있을 수
      // 있는 옛 codex 키는 Object.keys(DEFAULT_STATE)에 없어 애초에 안 읽힌다.
      if (typeof entry.model === 'string' && isValidModel(entry.model)) out[provider].model = entry.model;
      if (typeof entry.effort === 'string' && isValidEffort(provider, entry.effort)) out[provider].effort = entry.effort;
    }
    return out;
  } catch {
    return {
      claude: { ...DEFAULT_STATE.claude },
      grok: { ...DEFAULT_STATE.grok },
    };
  }
}

function writeState(state) {
  writeJsonAtomic(statePath(), state);
}

// athena:model-get -> { claude, grok } — main.js의 handleModelGet이
// 여기에 codex-config.js의 config.toml 값을 얹어 렌더러가 보는 전체 계약
// { claude, grok, codex }를 만든다(model-prefs.js 자체는 codex를 모른다).
function get() {
  return readState();
}

// athena:model-set({provider, patch}) -> { ok:true, state } | { ok:false, error }
// patch.model/patch.effort가 null이면 그 필드만 기본(null)으로 되돌린다.
// patch에 없는 키는 건드리지 않는다(부분 갱신). provider:'codex'는 여기서
// 다루지 않는다 — main.js의 handleModelSet이 codex-config.js로 라우팅한다.
function set({ provider, patch } = {}) {
  if (provider !== 'claude' && provider !== 'grok') {
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
