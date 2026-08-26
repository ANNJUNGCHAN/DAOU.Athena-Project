// 계좌 등록·활성 전환·주문 API 게이트·인증 토큰 상태 (AT-ST-001/002/003,
// AT-CV-OAUTH 토큰 4상태). 비밀값(APP KEY/SECRET KEY/발급 토큰)은 전부
// lib/main/secrets.js를 거쳐서만 만지고, 이 모듈의 상태 파일(athena-accounts.json)에는
// 절대 담지 않는다 — alias, 문자 수가 아니라 문자 수의 *출처*인 값, 토큰 만료
// 시각(비밀 아님) 같은 비민감 메타데이터만 평문 저장한다.
//
// "검증(토큰 발급)"은 실제 키움 모의투자 OAuth 엔드포인트를 호출한다
// (`https://mockapi.kiwoom.com/oauth2/token`, `backend/athena_api/kiwoom/auth.py`의
// `KiwoomAuth._issue_token_unlocked()`와 동일한 요청 모양 — api-id `au10001`,
// body `{grant_type, appkey, secretkey}`). 이 백엔드 파이썬 코드를 리버스해
// JS로 재구현한 게 아니라, 문서화된 실제 REST 계약을 그대로 다시 호출하는
// 것이다 — 검증 로직(승인/거부 판단) 자체는 여전히 upstream 서버가 한다.
// `backend/athena_api`는 건드리지 않는다(athena_mcp와 별개 패키지 — Kiwoom TR은
// athena_mcp v1 범위 밖, `backend/athena_mcp/__init__.py` 독스트링).

const fs = require('fs');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const secrets = require('./secrets');
const { writeJsonAtomic } = require('./json-store');

const KIWOOM_HOST = 'mockapi.kiwoom.com';
const TOKEN_PATH = '/oauth2/token';
const TOKEN_API_ID = 'au10001';
const REVOKE_PATH = '/oauth2/revoke';
const REVOKE_API_ID = 'au10002';

function statePath() {
  return path.join(app.getPath('userData'), 'athena-accounts.json');
}

function readState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return { activeId: parsed.activeId || null, accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] };
  } catch {
    return { activeId: null, accounts: [] };
  }
}

function writeState(state) {
  writeJsonAtomic(statePath(), state);
}

// ---------------------------------------------------------------------------
// 키움 REST 호출 공용 골격 — hostname/timeout/on-timeout/on-error/write/end를
// issueKiwoomToken·revokeKiwoomToken이 반복하던 부분만 뽑았다.
// statusCode·parsed만 돌려주고 판정(ok/reason 결정)은 각
// 호출부에 남긴다. 타임아웃·연결 에러·JSON 파싱 실패는 모두 statusCode:0·
// parsed:null로 뭉뚱그린다 — 호출부의 기존 "statusCode가 2xx가 아니면
// network" 판정이 그대로 이 경우도 처리하므로 동작은 이전과 같다.
// ---------------------------------------------------------------------------

function postKiwoomJson({ path: reqPath, apiId, extraHeaders, body }) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      {
        hostname: KIWOOM_HOST,
        path: reqPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'api-id': apiId,
          'Content-Length': Buffer.byteLength(bodyStr),
          ...extraHeaders,
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = null;
          }
          resolve({ statusCode: res.statusCode, parsed });
        });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, parsed: null }); });
    req.on('error', () => resolve({ statusCode: 0, parsed: null }));
    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 키움 모의투자 토큰 발급 — 실제 네트워크 호출, 판별된 실패 사유만 돌려준다.
// 원문 응답 본문(return_msg 등)은 호출자에게 그대로 넘기지 않는다(오케스트레이터
// 지시: "never a raw upstream body").
// ---------------------------------------------------------------------------

function issueKiwoomToken(appKey, secretKey) {
  return postKiwoomJson({
    path: TOKEN_PATH,
    apiId: TOKEN_API_ID,
    body: { grant_type: 'client_credentials', appkey: appKey, secretkey: secretKey },
  }).then(({ statusCode, parsed }) => {
    if (statusCode === 429) {
      return { ok: false, reason: 'ratelimit' };
    }
    if (statusCode < 200 || statusCode >= 300 || !parsed) {
      return { ok: false, reason: 'network' };
    }
    const returnCode = parsed.return_code == null ? '' : String(parsed.return_code);
    if (returnCode !== '' && returnCode !== '0') {
      // 레이트리밋을 구분할 별도 return_code 세트가 문서화돼 있지 않다
      // (AT-ST-003 데이터 계약이 이미 기록한 갭 — 실제 백엔드도 이 실패를
      // 세분화하지 않는다). return_msg의 한국어 키워드로 최선의 추정만 한다.
      const msg = String(parsed.return_msg || '');
      if (/초과|제한|과다/.test(msg)) {
        return { ok: false, reason: 'ratelimit' };
      }
      return { ok: false, reason: 'auth' };
    }
    if (typeof parsed.token !== 'string' || !parsed.token || !parsed.expires_dt) {
      return { ok: false, reason: 'network' };
    }
    return { ok: true, token: parsed.token, expiresDt: String(parsed.expires_dt) };
  });
}

// backend/athena_api/kiwoom/return_codes.py의 normalize_return_code와 동일한
// 규칙 — 숫자 문자열("0000" 등)을 정수로 정규화한다. tests/unit/test_auth.py
// ::test_revoke_accepts_string_zero_return_code가 "0000"도 성공으로 받아들이는
// 걸 실측으로 확정했다. issueKiwoomToken은 이 정규화 없이 이미 동작 중인 기존
// 코드라 건드리지 않는다 — 여기 revoke 쪽에서만 새로 쓴다.
function normalizeReturnCode(value) {
  if (value == null) return '';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return String(value);
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^[+-]?\d+$/.test(trimmed) ? String(parseInt(trimmed, 10)) : trimmed;
}

// 키움 모의투자 토큰 폐기 — 문서화된 au10002 계약(backend/docs/KIWOOM_API_IO.md
// "접근토큰폐기": POST /oauth2/revoke, body {appkey, secretkey, token})을
// issueKiwoomToken과 같은 방식으로 그대로 다시 호출한다. authorization 헤더는
// backend/athena_api/kiwoom/auth.py:141-153(KiwoomAuth.revoke_token, 같은
// upstream을 실제로 호출하는 유일한 참조 구현)가 실어 보내는 것과 동일하게
// 채운다.
function revokeKiwoomToken(appKey, secretKey, token) {
  return postKiwoomJson({
    path: REVOKE_PATH,
    apiId: REVOKE_API_ID,
    extraHeaders: { authorization: `Bearer ${token}` },
    body: { appkey: appKey, secretkey: secretKey, token },
  }).then(({ statusCode, parsed }) => {
    if (statusCode < 200 || statusCode >= 300) {
      return { ok: false, reason: 'network' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('return_code' in parsed)) {
      return { ok: false, reason: 'network' };
    }
    const returnCode = normalizeReturnCode(parsed.return_code);
    if (returnCode !== '0') {
      return { ok: false, reason: 'auth' };
    }
    return { ok: true };
  });
}

// 키움 응답 포맷 "YYYYMMDDHHMMSS" -> Date. auth.py의 `parse_kiwoom_datetime`과
// 동일하게 naive(로컬 시각 취급)로 파싱한다.
function parseKiwoomDatetime(value) {
  const s = String(value);
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  const h = Number(s.slice(8, 10));
  const mi = Number(s.slice(10, 12));
  const se = Number(s.slice(12, 14));
  return new Date(y, mo - 1, d, h, mi, se);
}

function computeTokenState(entry) {
  if (entry.tokenOverride === 'refreshing') return 'refreshing';
  if (!entry.tokenExpiresAt) return 'needed';
  return new Date(entry.tokenExpiresAt).getTime() > Date.now() ? 'ready' : 'expired';
}

let changeListener = null;
function onTokenChange(fn) { changeListener = fn; }
// event athena:auth-token-changed -> { id, state, expiresInSec } (issuedAt 없음 — 계약 그대로)
function emitChange(id) {
  if (!changeListener) return;
  const { state, expiresInSec } = tokenStatus(id);
  try { changeListener({ id, state, expiresInSec }); } catch { /* 리스너 실패가 계좌 로직을 죽이면 안 된다 */ }
}

// ---------------------------------------------------------------------------
// athena:account-list
// ---------------------------------------------------------------------------

function list() {
  const state = readState();
  return {
    accounts: state.accounts.map((a) => {
      const tokenState = computeTokenState(a);
      return {
        id: a.id,
        alias: a.alias,
        connected: tokenState === 'ready',
        active: a.id === state.activeId,
        orderApi: !!a.orderApi,
        tokenState,
        appKeyChars: secrets.getCharCount(a.id, 'appKey'),
        secretKeyChars: secrets.getCharCount(a.id, 'secretKey'),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// athena:account-register
// ---------------------------------------------------------------------------

async function register({ alias, appKey, secretKey }) {
  const cleanAlias = String(alias || '').trim();
  if (!cleanAlias || !appKey || !secretKey) {
    return { ok: false, error: 'invalid' };
  }
  const state = readState();
  if (state.accounts.some((a) => a.alias === cleanAlias)) {
    return { ok: false, error: 'invalid' };
  }
  if (!secrets.isEncryptionAvailable()) {
    // 오케스트레이터 지시: "safeStorage.isEncryptionAvailable()가 false일 수
    // 있다. 조용히 평문 저장으로 대체하지 말고, 판별 가능한 에러를 반환하라."
    // IPC 계약의 4종 에러('auth'|'network'|'ratelimit'|'invalid')엔 이
    // 경우를 위한 슬롯이 없다 — 'storage'로 확장한다. 렌더러의
    // accountErrorMessage()는 인식 못 하는 코드를 일반 실패 문구로 안전하게
    // 처리하므로 화면이 깨지지는 않지만, 정확한 사유를 보여주려면 렌더러 쪽
    // 매핑에도 'storage' 분기를 추가해야 한다 — 보고서에 남긴다.
    return { ok: false, error: 'storage' };
  }

  const result = await issueKiwoomToken(appKey, secretKey);
  if (!result.ok) {
    return { ok: false, error: result.reason };
  }

  const id = crypto.randomUUID();
  secrets.setValue(id, 'appKey', appKey);
  secrets.setValue(id, 'secretKey', secretKey);
  secrets.setValue(id, 'kiwoomToken', result.token);

  const nowIso = new Date().toISOString();
  state.accounts.push({
    id,
    alias: cleanAlias,
    createdAt: nowIso,
    tokenIssuedAt: nowIso,
    tokenExpiresAt: parseKiwoomDatetime(result.expiresDt).toISOString(),
    orderApi: false,
  });
  if (!state.activeId) state.activeId = id;
  writeState(state);
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// athena:account-set-active / athena:account-remove
// ---------------------------------------------------------------------------

function setActive(id) {
  const state = readState();
  if (!state.accounts.some((a) => a.id === id)) return { ok: false };
  state.activeId = id;
  writeState(state);
  return { ok: true };
}

function remove(id) {
  const state = readState();
  const had = state.accounts.some((a) => a.id === id);
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (state.activeId === id) {
    state.activeId = state.accounts.length ? state.accounts[0].id : null;
  }
  writeState(state);
  if (had) secrets.deleteNamespace(id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// athena:order-api-set — AT-ST-003 체크리스트를 정직하게 판정한다. 검증
// 불가능한 조건을 임의로 "충족"으로 표시하지 않는다.
// ---------------------------------------------------------------------------

function orderApiSet(id, enabled) {
  const state = readState();
  const entry = state.accounts.find((a) => a.id === id);
  if (!entry) return { ok: false, checklist: [], error: '계좌를 찾을 수 없다' };

  const tokenMet = computeTokenState(entry) === 'ready';

  if (!enabled) {
    // 되돌리기(OFF)는 항상 즉시 반영된다 — 확인 게이트 없음(Desc 5).
    entry.orderApi = false;
    writeState(state);
    return {
      ok: true,
      checklist: [
        { key: 'orderApi', label: '주문 API 허용 (토글)', met: false },
        { key: 'token', label: '로컬 인증 토큰 설정', met: tokenMet },
      ],
    };
  }

  const checklist = [
    { key: 'orderApi', label: '주문 API 허용 (토글)', met: true },
    { key: 'token', label: '로컬 인증 토큰 설정', met: tokenMet },
  ];
  if (!tokenMet) {
    return { ok: false, checklist, error: '로컬 인증 토큰이 설정되지 않았다 — 계좌 인증 상태를 먼저 확인한다' };
  }
  entry.orderApi = true;
  writeState(state);
  return { ok: true, checklist };
}

// ---------------------------------------------------------------------------
// athena:auth-token-status / athena:auth-token-refresh
// ---------------------------------------------------------------------------

// athena:auth-token-status -> { state, expiresInSec, issuedAt } — id는 넣지
// 않는다(호출자가 이미 안다, IPC 계약이 고정한 모양 그대로). 이벤트
// athena:auth-token-changed는 반대로 id는 있고 issuedAt은 없는 별도 모양이라
// emitChange()가 따로 조립한다 — 둘을 하나로 합쳐 슈퍼셋을 돌려주지 않는다.
function tokenStatus(id) {
  const state = readState();
  const entry = state.accounts.find((a) => a.id === id);
  if (!entry) return { state: 'needed', expiresInSec: 0, issuedAt: null };
  const tokenState = computeTokenState(entry);
  const expiresInSec = entry.tokenExpiresAt
    ? Math.max(0, Math.round((new Date(entry.tokenExpiresAt).getTime() - Date.now()) / 1000))
    : 0;
  return { state: tokenState, expiresInSec, issuedAt: entry.tokenIssuedAt || null };
}

async function tokenRefresh(id) {
  const state = readState();
  const entry = state.accounts.find((a) => a.id === id);
  if (!entry) return { ok: false, state: 'needed' };

  entry.tokenOverride = 'refreshing';
  writeState(state);
  emitChange(id); // 재발급 중 — 4상태 중 ③ (1Q0-0)

  const appKey = secrets.getValue(id, 'appKey');
  const secretKey = secrets.getValue(id, 'secretKey');
  let result = { ok: false, reason: 'invalid' };
  if (appKey && secretKey) {
    result = await issueKiwoomToken(appKey, secretKey);
  }

  const state2 = readState();
  const entry2 = state2.accounts.find((a) => a.id === id);
  if (entry2) {
    delete entry2.tokenOverride;
    if (result.ok) {
      secrets.setValue(id, 'kiwoomToken', result.token);
      entry2.tokenIssuedAt = new Date().toISOString();
      entry2.tokenExpiresAt = parseKiwoomDatetime(result.expiresDt).toISOString();
    }
    writeState(state2);
  }
  const finalState = entry2 ? computeTokenState(entry2) : 'expired';
  emitChange(id);
  return { ok: !!result.ok, state: finalState };
}

// ---------------------------------------------------------------------------
// athena:auth-token-revoke — auth-screen.js의 "연결 해제" 버튼. 갭이었던 IPC
// 채널을 여기서 채운다(2026-08-17, 팀리드 지시). backend/athena_api/kiwoom/
// auth.py의 KiwoomAuth.revoke_token()이 이미 이 upstream을 실제로 호출해
// 검증됐고(테스트로 확정), 그 구현은 upstream이 거부해도 `finally`에서 로컬
// 토큰을 항상 지운다 — "연결 해제"는 사용자가 명시적으로 요청한 동작이라
// upstream 실패로 로컬에 죽은 토큰이 남아있는 것보다 지우는 쪽이 낫다고 이미
// 내려진 결정을 그대로 따른다. 그래서 이 함수는 항상 state: 'needed'로
// 끝나고, ok는 upstream 폐기 확인이 성공했는지만 별도로 알려준다.
async function tokenRevoke(id) {
  const state = readState();
  const entry = state.accounts.find((a) => a.id === id);
  if (!entry) return { ok: false, state: 'needed' };

  // 로컬에 발급된 토큰 자체가 없으면(state 'needed') 폐기할 게 없다 —
  // revoke_token()이 `if not self._token: return`으로 upstream 호출 없이
  // 끝내는 것과 동일하게 처리한다.
  if (computeTokenState(entry) === 'needed') return { ok: true, state: 'needed' };

  const appKey = secrets.getValue(id, 'appKey');
  const secretKey = secrets.getValue(id, 'secretKey');
  const token = secrets.getValue(id, 'kiwoomToken');

  let result = { ok: false, reason: 'invalid' };
  if (appKey && secretKey && token) {
    result = await revokeKiwoomToken(appKey, secretKey, token);
  }

  const state2 = readState();
  const entry2 = state2.accounts.find((a) => a.id === id);
  if (entry2) {
    delete entry2.tokenOverride;
    delete entry2.tokenExpiresAt;
    delete entry2.tokenIssuedAt;
    writeState(state2);
  }
  secrets.deleteValue(id, 'kiwoomToken');
  emitChange(id);
  return { ok: !!result.ok, state: 'needed' };
}

module.exports = {
  list,
  register,
  setActive,
  remove,
  orderApiSet,
  tokenStatus,
  tokenRefresh,
  tokenRevoke,
  onTokenChange,
};
