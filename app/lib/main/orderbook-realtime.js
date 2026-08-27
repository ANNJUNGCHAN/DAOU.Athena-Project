// 호가 실시간 — 키움 REAL 0D(주식호가잔량)를 파싱한다. chart-realtime.js(0B)와
// 같은 파일 구조·명명(REAL_TR_ID/parseReal*Frame)을 따르되 별도 파일로 분리한다
// (0B와 필드·소비처가 전혀 달라 한 파일에 섞으면 어느 쪽 파서인지 매번 되짚어야
// 한다). REG/REMOVE 본문 생성·참조 계수형 등록기는 chart-realtime.js의
// createRealtimeRegistrar를 trId:'0D'로 그대로 재사용한다(task #25 tr 매개화) —
// 여기서 다시 만들지 않는다.
//
// FID 근거: backend/ref/kiwoom-tr-inventory.json의 '0D' resp_body 실측(2026-08-27).
// 잔량 사다리(매도/매수 각 10레벨)와 총잔량만 쓴다 — 카드(card-kind-호가.js)가
// 실제로 그리는 필드가 그것뿐이다(레벨별 호가 자체·직전대비·LP/KRX/NXT 보조
// 사다리 등 나머지 필드는 지금 화면에 자리가 없어 파싱하지 않는다 — 안 쓰는
// 필드를 파싱해 두면 "언젠가 쓰겠지"로 죽은 코드가 남는다).
'use strict';

const REAL_TR_ID = '0D';

// 매도호가수량1~10 = FID 61~70, 매수호가수량1~10 = FID 71~80(레벨 오름차순).
const F_SELL_QTY = ['61', '62', '63', '64', '65', '66', '67', '68', '69', '70'];
const F_BUY_QTY = ['71', '72', '73', '74', '75', '76', '77', '78', '79', '80'];
const F_SELL_TOTAL = '121'; // 매도호가총잔량
const F_BUY_TOTAL = '125'; // 매수호가총잔량

// 잔량 필드는 키움 문서상 "단위: 1주"이지 부호가 포함된 숫자가 아니다(가격류와
// 다르다 — card-kind-호가.js 머리말의 가격류 부호 논의는 여기 적용되지 않는다).
// 그래도 방어적으로 트림·숫자 변환만 하고, 파싱 실패는 null(0으로 지어내지 않는다).
function toQuantity(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

// REAL 프레임 한 행 → {symbol, sellQuantities, buyQuantities, sellTotal, buyTotal}.
// 0D가 아니거나 종목코드가 없으면 null. 레벨 하나가 프레임에 없으면 그 자리만
// null(카드 쪽에서 "이 레벨은 갱신 안 함"으로 처리 — 0으로 지어내면 잔량이
// 실제로 0인 것과 구분이 안 된다).
function parseQuoteBookTick(row) {
  if (!row || typeof row !== 'object') return null;
  if (String(row.type) !== REAL_TR_ID) return null;
  const symbol = String(row.item || '').trim();
  if (!symbol) return null;
  const values = row.values && typeof row.values === 'object' ? row.values : {};
  return {
    symbol,
    sellQuantities: F_SELL_QTY.map((fid) => toQuantity(values[fid])),
    buyQuantities: F_BUY_QTY.map((fid) => toQuantity(values[fid])),
    sellTotal: toQuantity(values[F_SELL_TOTAL]),
    buyTotal: toQuantity(values[F_BUY_TOTAL]),
  };
}

// REAL 프레임 전체 → 호가잔량 틱 배열. trnm이 REAL이 아니면 빈 배열.
function parseQuoteBookFrame(message) {
  const frame = message && typeof message === 'object' ? message : {};
  if (String(frame.trnm) !== 'REAL' || !Array.isArray(frame.data)) return [];
  const out = [];
  for (const row of frame.data) {
    const tick = parseQuoteBookTick(row);
    if (tick) out.push(tick);
  }
  return out;
}

module.exports = {
  REAL_TR_ID,
  parseQuoteBookTick,
  parseQuoteBookFrame,
};
