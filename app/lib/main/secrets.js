// 비밀값을 다루는 유일한 모듈 (AT-ST-007 비밀값 원칙).
//
// 이 파일 밖으로는 절대 비밀값(APP KEY / SECRET KEY / MCP env 값 / 발급된
// 토큰 문자열)이 나가지 않는다 — 다른 lib/main/*.js는 이 모듈의 `getValue()`를
// 호출해 그 반환값을 즉시 쓰고 버릴 뿐, 자신의 상태(모듈 top-level 변수, 캐시)에
// 담아두지 않는다. IPC 핸들러(main.js)는 이 모듈의 `getValue()`/`getRaw()`를
// 절대 호출하지 않는다 — 문자 수(`getCharCount`)만 호출한다.
//
// 저장: Electron `safeStorage`(Windows에서는 DPAPI 경유)로 암호화한 뒤 base64로
// `userData/athena-secrets.json`에 쓴다. `safeStorage.isEncryptionAvailable()`가
// false면 평문 저장으로 조용히 대체하지 않는다 — 저장을 거부하고 판별 가능한
// 에러를 반환한다(오케스트레이터 지시 그대로).

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { writeJsonAtomic } = require('./json-store');

function storePath() {
  return path.join(app.getPath('userData'), 'athena-secrets.json');
}

function readStore() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// 원자적 쓰기 — registry.py의 tmp-then-replace 패턴과 동일한 이유(쓰다가
// 죽어도 파일이 반쪽으로 남지 않는다).
function writeStore(store) {
  writeJsonAtomic(storePath(), store);
}

function isEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

// value를 namespace(보통 계좌 id/MCP 별칭)/key(예: 'appKey','secretKey','kiwoomToken')
// 아래 암호화 저장한다. 반환값에는 문자 수만 담는다 — 값 자체는 절대 돌려주지 않는다.
function setValue(namespace, key, value) {
  if (!isEncryptionAvailable()) {
    return { ok: false, error: 'encryption-unavailable' };
  }
  const str = String(value == null ? '' : value);
  const blob = safeStorage.encryptString(str).toString('base64');
  const store = readStore();
  if (!store[namespace]) store[namespace] = {};
  store[namespace][key] = { blob, charCount: str.length };
  writeStore(store);
  return { ok: true, charCount: str.length };
}

// 내부 전용 — 실제 API 호출(Kiwoom 토큰 발급, MCP 자식 프로세스 env)에 쓸 때만
// 호출한다. 반환값을 호출자의 스코프를 벗어나 살아있는 변수에 담지 않는다.
function getValue(namespace, key) {
  const store = readStore();
  const entry = store[namespace] && store[namespace][key];
  if (!entry) return null;
  if (!isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(entry.blob, 'base64'));
  } catch {
    return null;
  }
}

function getCharCount(namespace, key) {
  const store = readStore();
  const entry = store[namespace] && store[namespace][key];
  return entry ? entry.charCount : 0;
}

function deleteValue(namespace, key) {
  const store = readStore();
  if (store[namespace]) {
    delete store[namespace][key];
    writeStore(store);
  }
}

function deleteNamespace(namespace) {
  const store = readStore();
  if (store[namespace]) {
    delete store[namespace];
    writeStore(store);
  }
}

module.exports = {
  isEncryptionAvailable,
  setValue,
  getValue,
  getCharCount,
  deleteValue,
  deleteNamespace,
};
