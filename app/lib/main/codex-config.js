// Codex 모델·추론강도 설정 — 이 앱 밖(userData)이 아니라 Codex 본인의 설정
// 파일에 직접 쓴다. 팀리드 지시(2026-08-18, 공식 문서 조사 근거): Codex 사용자
// 설정은 `$CODEX_HOME/config.toml`(CODEX_HOME 미설정 시 `~/.codex`)이고, 최상위
// 키 `model`(string) · `model_reasoning_effort`("minimal"|"low"|"medium"|
// "high"|"xhigh")를 쓴다. `codexHome()`은 cli-accounts.js의 detectCodex()와
// 같은 규칙(CODEX_HOME env 우선, 폴백 os.homedir()/.codex)이다 — 둘이 다른
// 디렉토리를 보면 "연결 표시는 됐는데 모델 설정은 딴 곳에 쓰인다"는 불일치가
// 생긴다.
//
// 외부 프로그램(Codex CLI)이 관리하는 파일이라 전체 TOML 재직렬화는 하지 않는다
// — 알려진 두 키만 라인 단위로 in-place 패치하고, 주석·미지 키·[섹션]은 바이트
// 그대로 보존한다. 최상위(top-level, 첫 `[section]` 헤더 이전)의 키만 대상으로
// 삼는다 — `[profile.default]` 아래 동명 `model` 키를 오독하면 사용자가 설정한
// 프로필별 값을 엉뚱하게 덮어쓴다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isValidModel } = require('./model-prefs');

// codex config model_reasoning_effort 화이트리스트 — model-prefs.js의 claude
// 화이트리스트(low/medium/high/xhigh/max)와 다르다. 여기서 독립적으로 정의한다
// (model-prefs.js는 이제 claude 전용이라 codex 값을 모른다).
const CODEX_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

function isValidCodexEffort(effort) {
  return typeof effort === 'string' && CODEX_EFFORTS.has(effort);
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function configPath() {
  return path.join(codexHome(), 'config.toml');
}

// `key = value` 라인의 value 쪽을 해석한다 — 따옴표(작은/큰) 문자열이면 안쪽만,
// 안 따옴표면 인라인 주석(#) 이전까지 트림해서 돌려준다. 못 읽으면 null.
function unquoteValue(raw) {
  const v = raw.trim();
  if (!v) return null;
  const quote = v[0];
  if (quote === '"' || quote === "'") {
    const end = v.indexOf(quote, 1);
    if (end === -1) return null;
    return v.slice(1, end);
  }
  const hashIdx = v.indexOf('#');
  const bare = (hashIdx === -1 ? v : v.slice(0, hashIdx)).trim();
  return bare || null;
}

// trimmed 라인이 최상위 `<key> = ...` 형태인지 — "model"과 "model_reasoning_effort"를
// 서로 오독하지 않는다("model" 뒤에 공백/`=`가 바로 와야 매치되므로 "model_..."은
// "model" 키로 안 걸린다).
function isKeyLine(trimmedLine, key) {
  const re = new RegExp(`^${key}\\s*=`);
  return re.test(trimmedLine);
}

// athena:model-get의 codex 절 → { model, effort, exists }. exists:false면
// config.toml 자체가 없다는 뜻(model/effort는 null) — Codex를 아직 한 번도
// 설정하지 않은 상태와 파일이 있는데 두 키가 없는 상태를 UI가 구분하고 싶어지면
// exists로 가른다.
function readModelSettings() {
  const p = configPath();
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch {
    return { model: null, effort: null, exists: false };
  }
  const lines = raw.split(/\r\n|\n/);
  let inTopLevel = true;
  let model = null;
  let effort = null;
  for (const line of lines) {
    const t = line.trim();
    if (/^\[/.test(t)) { inTopLevel = false; continue; }
    if (!inTopLevel) continue;
    if (isKeyLine(t, 'model')) {
      model = unquoteValue(t.slice(t.indexOf('=') + 1));
      continue;
    }
    if (isKeyLine(t, 'model_reasoning_effort')) {
      effort = unquoteValue(t.slice(t.indexOf('=') + 1));
    }
  }
  return { model, effort, exists: true };
}

// athena:model-set({provider:'codex', patch}) → { ok:true, model, effort } |
// { ok:false, error }. patch.model/patch.effort가 null이면 그 라인을 제거한다
// (기본값으로 되돌림 = codex CLI 자체 기본값을 쓰겠다는 뜻). patch에 없는 키는
// 건드리지 않는다. 검증 실패면 파일을 전혀 건드리지 않고 거부한다(부분 적용 없음).
function writeModelSettings(patch = {}) {
  if ('model' in patch && patch.model !== null && !isValidModel(patch.model)) {
    return { ok: false, error: 'invalid-model' };
  }
  if ('effort' in patch && patch.effort !== null && !isValidCodexEffort(patch.effort)) {
    return { ok: false, error: 'invalid-effort' };
  }

  const p = configPath();
  let raw = '';
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch {
    raw = '';
  }
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.length ? raw.split(/\r\n|\n/) : [];

  // 이번 호출에서 새로 삽입한 라인 다음 자리를 기억해, model·effort를 둘 다
  // 새로 추가할 때 파일 맨 위(주석 뒤)에 나란히 붙게 한다(둘 다 매번 "주석
  // 바로 뒤"를 다시 계산하면 나중 키가 먼저 온 키 위로 끼어든다).
  let nextInsertAt = null;

  function findTopLevelIndex(key) {
    let inTop = true;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/^\[/.test(t)) { inTop = false; continue; }
      if (!inTop) continue;
      if (isKeyLine(t, key)) return i;
    }
    return -1;
  }

  function leadingCommentSkip() {
    let i = 0;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('#')) { i++; continue; }
      break;
    }
    return i;
  }

  function applyKey(key, value) {
    const foundIdx = findTopLevelIndex(key);
    if (value === null) {
      if (foundIdx !== -1) lines.splice(foundIdx, 1);
      return;
    }
    const newLine = `${key} = ${JSON.stringify(value)}`;
    if (foundIdx !== -1) {
      lines[foundIdx] = newLine;
      return;
    }
    const insertAt = nextInsertAt !== null ? nextInsertAt : leadingCommentSkip();
    lines.splice(insertAt, 0, newLine);
    nextInsertAt = insertAt + 1;
  }

  if ('model' in patch) applyKey('model', patch.model);
  if ('effort' in patch) applyKey('model_reasoning_effort', patch.effort);

  fs.mkdirSync(path.dirname(p), { recursive: true });
  const content = lines.length ? lines.join(eol) : '';
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, p);

  return { ok: true, ...readModelSettings() };
}

module.exports = { codexHome, configPath, readModelSettings, writeModelSettings, isValidCodexEffort };
