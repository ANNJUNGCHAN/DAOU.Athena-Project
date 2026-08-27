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

// REG 본문 — generated/runtime.py가 data[].type이 tr_id와 대소문자까지
// 일치할 것을 요구한다(0g/0G 구분 사례). 여기서 문자열을 만들어 맞춘다.
// trId 생략 시 0B(이 모듈의 기본 TR) — 기존 호출부는 그대로 동작한다.
function buildRegisterBody(symbols, trId = REAL_TR_ID) {
  return {
    trnm: 'REG',
    grp_no: '1',
    refresh: '1',
    data: symbols.map((symbol) => ({ type: trId, item: String(symbol) })),
  };
}

// REMOVE 본문 — REG와 같은 엔드포인트가 trnm만 보고 키움 WS remove()로
// 라우팅한다(backend/athena_api/generated/runtime.py, kiwoom/ws_client.py 실측,
// 2026-08-27). 백엔드 수정 없이 여기서 프레임만 뒤집는다.
function buildRemoveBody(symbols, trId = REAL_TR_ID) {
  return {
    trnm: 'REMOVE',
    grp_no: '1',
    refresh: '1',
    data: symbols.map((symbol) => ({ type: trId, item: String(symbol) })),
  };
}

// 종목 등록기 — 참조 계수형(2026-08-27, 카드를 닫으면 서버까지 구독을 끊는다).
// 계약: 카드 1장이 acquire 1회, 그 카드가 닫히면 release 1회(호출부 실측은
// main.js ensureChartRealtime/wireQuoteRealtime 쪽 주석 참고). 0→1로 올라갈 때만
// REG를, 1→0으로 내려갈 때만 REMOVE를 내보낸다 — 둘 다 리미터를 소모하므로
// 참조가 남아 있는 동안은 조용히 넘어간다.
//
// tr 매개화(task #25, 2026-08-27) — 이 레지스트라는 원래 0B 전용이었다. opts.trId로
// 다른 REAL TR(예: 호가잔량 0D)도 같은 참조 계수 로직을 재사용한다 — 생략하면
// 이 모듈의 REAL_TR_ID(0B)로 기존 동작 그대로다. 인스턴스마다 refCounts가
// 독립이므로(호출부가 TR별로 별도 인스턴스를 만든다) 0B/0D 참조가 서로 섞이지 않는다.
function createRealtimeRegistrar(opts) {
  const o = opts || {};
  const trId = o.trId || REAL_TR_ID;
  const backendBase = o.backendBase;
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const account = o.account || null;
  const mdlog = o.mdlog || (() => {});
  const refCounts = new Map(); // code -> 열린 참조 수(0 이하는 저장하지 않는다)
  const pendingRegister = new Map(); // code -> 진행 중인 REG의 Promise(경합 방지)

  async function postFrame(trnm, code) {
    const headers = { 'Content-Type': 'application/json' };
    if (account) headers['X-Athena-Account'] = account;
    const body = trnm === 'REMOVE' ? buildRemoveBody([code], trId) : buildRegisterBody([code], trId);
    let res;
    try {
      res = await fetchImpl(`${backendBase}/api/v1/websocket/${trId}`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
    } catch (err) {
      mdlog(`REAL ${trnm} 실패(${code}): ${String((err && err.message) || err)}`);
      return false;
    }
    if (!res || !res.ok) {
      mdlog(`REAL ${trnm} 거부(${code}): HTTP ${res ? res.status : '?'}`);
      return false;
    }
    return true;
  }

  // 같은 종목의 acquire가 REG 왕복 중(fetch await) 겹쳐 들어오면 — REST
  // 데이터셋 하나에 같은 종목 카드가 2장 있어 거의 동시에 paint ack가 오는 경우
  // 등 — 둘 다 카운트를 0으로 읽고 REG를 중복 발사한 뒤 마지막 쓰기가 앞선
  // 쓰기를 덮어써 참조가 샌다(실측: 2회 acquire 후 refCount가 1로 무너짐).
  // pendingRegister로 같은 종목의 진행 중인 REG 하나를 공유해 이를 막는다 —
  // REG 자체는 한 번만 나가고, 그 결과를 기다리던 모든 acquire가 각자 카운트를
  // 하나씩 올린다.
  async function acquire(symbol) {
    const code = String(symbol || '').trim();
    if (!code) return false;
    const count = refCounts.get(code) || 0;
    if (count > 0) {
      refCounts.set(code, count + 1);
      return true;
    }
    let inFlight = pendingRegister.get(code);
    if (!inFlight) {
      inFlight = postFrame('REG', code).finally(() => { pendingRegister.delete(code); });
      pendingRegister.set(code, inFlight);
    }
    const ok = await inFlight;
    if (!ok) return false;
    const next = (refCounts.get(code) || 0) + 1;
    refCounts.set(code, next);
    if (next === 1) mdlog(`REAL ${trId} 등록 — ${code}`);
    return true;
  }

  // 카드/패널이 닫힐 때 부른다. 참조가 아직 남아 있으면(같은 종목을 쓰는 다른
  // 카드가 있다) 카운트만 내리고 REMOVE는 안 보낸다. 0으로 내려가는 순간에만
  // REMOVE를 내보낸다. 쥔 적 없는 종목의 release는 조용히 무시한다(같은 종목을
  // 한 번도 acquire한 적 없는 카드가 닫히는 경우 — 다른 카드의 참조를 잘못
  // 갉아먹지 않는다). REMOVE가 네트워크 등으로 실패해도 로컬 카운트는 그대로
  // 0으로 둔다(fail-open — 스트림이 서버에 남는 건 기존 미해제 동작과 같은
  // 타협이고, 재시도 기계장치는 만들지 않는다).
  async function release(symbol) {
    const code = String(symbol || '').trim();
    if (!code) return false;
    const count = refCounts.get(code) || 0;
    if (count <= 0) return false;
    if (count > 1) {
      refCounts.set(code, count - 1);
      return true;
    }
    refCounts.delete(code);
    const ok = await postFrame('REMOVE', code);
    if (ok) mdlog(`REAL ${trId} 해제 — ${code}`);
    return true;
  }

  return {
    acquire,
    release,
    isRegistered: (s) => (refCounts.get(String(s || '').trim()) || 0) > 0,
    refCount: (s) => refCounts.get(String(s || '').trim()) || 0,
    size: () => refCounts.size,
  };
}

module.exports = {
  REAL_TR_ID,
  parseRealTick,
  parseRealFrame,
  buildRegisterBody,
  buildRemoveBody,
  kstToEpochSec,
  kstTradingDate,
  createRealtimeRegistrar,
};
