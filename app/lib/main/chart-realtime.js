// 차트 실시간 — 키움 REAL 0B(주식체결)을 등록하고, 백엔드 스트림에서 받은 체결을
// 렌더러로 옮긴다. 진행봉으로 접는 일은 렌더러가 한다(lib/chart-tick-fold.js 주석).
//
// 왜 main에 두는가: 업스트림 구독은 프로세스당 하나여야 한다(routine-feed.js와 같은
// 이유). REG는 리미터를 소모하므로 종목당 1회만 등록하고, 등록분을 기억해 둔다.
'use strict';

// 0B 체결 필드(키움 실시간 규격). 값은 등락 부호가 붙은 문자열로 온다("-257000").
const F_TIME = '20';   // 체결시간 HHMMSS(KST)
const F_PRICE = '10';  // 현재가
const F_VOLUME = '15'; // 체결량(부호는 매수/매도 구분 — 크기만 쓴다)
// 시세 카드(단계 8 확장 조사, card-kind-시세.js 4열) 전용 — 진행봉 접기에는 안 쓴다.
// F_TIME/F_PRICE/F_VOLUME과 같은 외부 규격(키움 실시간 FID) 근거이되, 이 두 필드는
// 아직 실프레임으로 확인 전이다(백엔드 미기동 환경) — 없으면 null, 있으면 쓴다.
const F_CHANGE_RATE = '12'; // 등락율(기준가 대비, 부호가 방향 그 자체 — 지우면 안 된다)
const F_ACC_VOLUME = '13';  // 누적거래량

const REAL_TR_ID = '0B';
const KST_OFFSET_SEC = 9 * 3600;

function toMagnitude(value) {
  if (value == null) return null;
  const n = Number(String(value).trim().replace(/^[+-]/, ''));
  return Number.isFinite(n) ? n : null;
}

// 등락율은 부호가 방향 그 자체다(체결가/체결량과 달리 지우면 안 된다) — 부호를
// 보존한 채로만 숫자화한다. 없으면 null(값을 지어내지 않는다, §8).
function toSignedNumber(value) {
  if (value == null) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

// 'YYYYMMDD' + 'HHMMSS'(KST 벽시계) → epoch 초(UTC).
// lightweight-charts에 넣는 값은 UTC epoch이고 표기만 KST로 바꾼다
// (chart-card.js kstLabel) — 여기서 9시간을 더해 값을 위조하지 않는다.
function kstToEpochSec(yyyymmdd, hhmmss) {
  const date = String(yyyymmdd || '');
  const time = String(hhmmss || '').padStart(6, '0');
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) return null;
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6));
  const d = Number(date.slice(6, 8));
  return Math.floor(Date.UTC(
    y, mo - 1, d,
    Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6))
  ) / 1000) - KST_OFFSET_SEC;
}

function kstTradingDate(now) {
  const at = now instanceof Date ? now : new Date();
  const kst = new Date(at.getTime() + KST_OFFSET_SEC * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}`;
}

// REAL 프레임 한 행 → {symbol, at, price, volume}. 0B가 아니거나 값이 모자라면 null.
// 조용히 0이나 현재시각으로 메우지 않는다 — 그러면 없는 체결이 봉에 남는다(§8).
function parseRealTick(row, tradingDate) {
  if (!row || typeof row !== 'object') return null;
  if (String(row.type) !== REAL_TR_ID) return null;
  const symbol = String(row.item || '').trim();
  if (!symbol) return null;
  const values = row.values && typeof row.values === 'object' ? row.values : {};
  const price = toMagnitude(values[F_PRICE]);
  if (price == null || price <= 0) return null;
  const at = kstToEpochSec(tradingDate, values[F_TIME]);
  if (at == null) return null;
  return {
    symbol,
    at,
    price,
    volume: toMagnitude(values[F_VOLUME]) || 0,
    // 시세 카드 4열 확장분 — 프레임에 없으면 null(소비측이 갱신을 스킵한다).
    changeRate: toSignedNumber(values[F_CHANGE_RATE]),
    accVolume: toMagnitude(values[F_ACC_VOLUME]),
  };
}

// REAL 프레임 전체 → 체결 배열. trnm이 REAL이 아니면 빈 배열.
function parseRealFrame(message, tradingDate) {
  const frame = message && typeof message === 'object' ? message : {};
  if (String(frame.trnm) !== 'REAL' || !Array.isArray(frame.data)) return [];
  const out = [];
  for (const row of frame.data) {
    const tick = parseRealTick(row, tradingDate);
    if (tick) out.push(tick);
  }
  return out;
}

// 0B REG 본문 — generated/runtime.py가 data[].type이 tr_id와 대소문자까지
// 일치할 것을 요구한다(0g/0G 구분 사례). 여기서 문자열을 만들어 맞춘다.
function buildRegisterBody(symbols) {
  return {
    trnm: 'REG',
    grp_no: '1',
    refresh: '1',
    data: symbols.map((symbol) => ({ type: REAL_TR_ID, item: String(symbol) })),
  };
}

// 종목 등록기. REG는 리미터를 소모하므로 이미 등록한 종목은 다시 부르지 않는다.
function createRealtimeRegistrar(opts) {
  const o = opts || {};
  const backendBase = o.backendBase;
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const account = o.account || null;
  const mdlog = o.mdlog || (() => {});
  const registered = new Set();

  async function ensureSymbol(symbol) {
    const code = String(symbol || '').trim();
    if (!code) return false;
    if (registered.has(code)) return true;
    const headers = { 'Content-Type': 'application/json' };
    if (account) headers['X-Athena-Account'] = account;
    let res;
    try {
      res = await fetchImpl(`${backendBase}/api/v1/websocket/${REAL_TR_ID}`, {
        method: 'POST', headers, body: JSON.stringify(buildRegisterBody([code])),
      });
    } catch (err) {
      mdlog(`REAL 등록 실패(${code}): ${String((err && err.message) || err)}`);
      return false;
    }
    if (!res || !res.ok) {
      mdlog(`REAL 등록 거부(${code}): HTTP ${res ? res.status : '?'}`);
      return false;
    }
    registered.add(code);
    mdlog(`REAL 0B 등록 — ${code}`);
    return true;
  }

  return { ensureSymbol, isRegistered: (s) => registered.has(String(s)), size: () => registered.size };
}

module.exports = {
  REAL_TR_ID,
  parseRealTick,
  parseRealFrame,
  buildRegisterBody,
  kstToEpochSec,
  kstTradingDate,
  createRealtimeRegistrar,
};
