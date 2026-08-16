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

const KIWOOM_HOST = 'mockapi.kiwoom.com';
const TOKEN_PATH = '/oauth2/token';
const TOKEN_API_ID = 'au10001';

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
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
// 키움 모의투자 토큰 발급 — 실제 네트워크 호출, 판별된 실패 사유만 돌려준다.
// 원문 응답 본문(return_msg 등)은 호출자에게 그대로 넘기지 않는다(오케스트레이터
// 지시: "never a raw upstream body").
// ---------------------------------------------------------------------------

function issueKiwoomToken(appKey, secretKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      secretkey: secretKey,
    });
    const req = https.request(
      {
        hostname: KIWOOM_HOST,
        path: TOKEN_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'api-id': TOKEN_API_ID,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 429) {
            resolve({ ok: false, reason: 'ratelimit' });
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            resolve({ ok: false, reason: 'network' });
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            resolve({ ok: false, reason: 'network' });
            return;
          }
          const returnCode = parsed.return_code == null ? '' : String(parsed.return_code);
          if (returnCode !== '' && returnCode !== '0') {
            // 레이트리밋을 구분할 별도 return_code 세트가 문서화돼 있지 않다
            // (AT-ST-003 데이터 계약이 이미 기록한 갭 — 실제 백엔드도 이 실패를
            // 세분화하지 않는다). return_msg의 한국어 키워드로 최선의 추정만 한다.
            const msg = String(parsed.return_msg || '');
            if (/초과|제한|과다/.test(msg)) {
              resolve({ ok: false, reason: 'ratelimit' });
            } else {
              resolve({ ok: false, reason: 'auth' });
            }
            return;
          }
          if (typeof parsed.token !== 'string' || !parsed.token || !parsed.expires_dt) {
            resolve({ ok: false, reason: 'network' });
            return;
          }
          resolve({ ok: true, token: parsed.token, expiresDt: String(parsed.expires_dt) });
        });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'network' }); });
    req.on('error', () => resolve({ ok: false, reason: 'network' }));
    req.write(body);
    req.end();
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

module.exports = {
  list,
  register,
  setActive,
  remove,
  orderApiSet,
  tokenStatus,
  tokenRefresh,
  onTokenChange,
};
