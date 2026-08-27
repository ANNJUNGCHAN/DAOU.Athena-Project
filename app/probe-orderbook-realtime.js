// 호가 카드 실시간 배선 e2e 프로브(task #25) — probe-quote-realtime.js와 같은
// 기법이다: 합성 REAL 0D 프레임을 main의 실파서(lib/main/orderbook-realtime.js
// parseQuoteBookFrame)로 그대로 통과시켜, 그 아래(athena:orderbook-ticks IPC →
// canvas.js wireOrderbookRealtime → card-kind-호가.js applyLiveTick)는 전부
// 실경로로 통과시킨다. 업스트림(키움 REAL WS)과 백엔드(fetch)만 대역한다.
//
// 0B(시세/종목정보)와의 차이 — 호가는 카드가 뜰 때 명시적으로
// athena:orderbook-realtime-acquire를 보낸다(main이 봉투만 보고 알아서 REG하지
// 않는다). 그래서 이 프로브는 "REG가 카드 마운트에 정확히 물려 있는지"도 본다.
//
// 단언:
//   (1) 카드 마운트 → REG fetch 1건(엔드포인트 /api/v1/websocket/0D, type:'0D')
//   (2) 합성 0D 틱 주입 → 래더 카드(20행, ka10007_both 모양) 수량·막대 갱신
//   (3) 프레임에 없는 레벨은 이전 값 유지(0으로 지어내지 않는다)
//   (4) 비율바 카드(tot_sel_req/tot_buy_req 모양)도 같은 틱으로 갱신
//   (5) 다른 종목 틱은 섞이지 않는다(교차 오염 0)
//   (6) 카드 destroy → REMOVE fetch 1건 + 이후 틱 주입해도 예외 없음(카드 재생성 없음)

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'live'; // ensureOrderbookRealtimeForSymbol의 fixture 조기-return을 피한다

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const fetchCalls = [];
global.fetch = async (url, init) => {
  fetchCalls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
  return { ok: true, status: 200 };
};

const orderbookRealtime = require('./lib/main/orderbook-realtime');

const PROFILE = path.join(__dirname, '.probe-orderbook-realtime-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SYM_LADDER = '900001';
const SYM_TOTALS = '900002';
const SYM_OTHER = '900003'; // 교차 오염 시험용 — 이 종목 틱은 위 두 카드 어느 쪽도 못 받아야 한다

function fact(key, value) {
  return { key, label: `라벨:${key}`, value };
}

// ka10007_both 모양(card-kind-호가.js _LADDER_SHAPES) — 매도/매수 각 10레벨.
function ladderEnvelope(symbol) {
  const fields = [];
  for (let i = 1; i <= 10; i += 1) fields.push(fact(`sel_${i}bid_req`, String(1000 - i * 10)));
  for (let i = 1; i <= 10; i += 1) fields.push(fact(`buy_${i}bid_req`, String(900 - i * 10)));
  return {
    canvas_type: 'facts',
    card_title: '호가',
    // top-level stk_cd — canvas.js cardStkCd()가 여기만 읽는다(operation_args만
    // 있으면 makeCard가 "종목코드 없음"으로 보고 같은 type의 다른 카드와 서로
    // 교체해버린다 — 실측으로 잡음). wireOrderbookRealtime의 심볼 추출은 둘 다
    // 보므로 REG는 정상 발화했지만 카드 자체가 사라져 있었다.
    stk_cd: symbol,
    operation_args: { stk_cd: symbol },
    data: { fields },
  };
}

function totalsEnvelope(symbol) {
  return {
    canvas_type: 'facts',
    card_title: '호가',
    stk_cd: symbol,
    operation_args: { stk_cd: symbol },
    data: { fields: [fact('tot_sel_req', '5000'), fact('tot_buy_req', '6200')] },
  };
}

// 합성 REAL 0D 프레임 한 행 — FID 근거는 orderbook-realtime.js 머리말 참고.
function real0DRow(symbol, { sellQty = {}, buyQty = {}, sellTotal, buyTotal } = {}) {
  const values = {};
  for (const [level, qty] of Object.entries(sellQty)) values[String(60 + Number(level))] = String(qty);
  for (const [level, qty] of Object.entries(buyQty)) values[String(70 + Number(level))] = String(qty);
  if (sellTotal !== undefined) values['121'] = String(sellTotal);
  if (buyTotal !== undefined) values['125'] = String(buyTotal);
  return { type: '0D', item: symbol, values };
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  const consoleErrors = [];
  shellWin.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) consoleErrors.push(message);
  });

  for (let i = 0; i < 100; i += 1) {
    const hidden = await shellWin.webContents.executeJavaScript("document.getElementById('app').hidden");
    if (hidden === false) break;
    await wait(100);
  }

  // ---------- 카드 2장 오픈 ----------
  shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: ladderEnvelope(SYM_LADDER) });
  await wait(400);
  shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: totalsEnvelope(SYM_TOTALS) });
  await wait(400);

  const cardsAfterOpen = await shellWin.webContents.executeJavaScript(`
    (() => ({
      ladderRows: document.querySelectorAll('.card-kit-hoga-ladder .card-kit-row-ladder').length,
      totalsRows: document.querySelectorAll('.card-kit-bar-proportional .card-kit-bar-row').length,
    }))()
  `);
  console.log('[probe] 카드 오픈 직후:', JSON.stringify(cardsAfterOpen));

  // ---------- (1) 마운트 → acquire IPC → REG fetch ----------
  await wait(200); // acquire IPC(athena:orderbook-realtime-acquire)는 렌더 직후 fire-and-forget
  const regCalls = fetchCalls.filter((c) => c.body && c.body.trnm === 'REG');
  const regOk = regCalls.length === 2
    && regCalls.every((c) => c.url.endsWith('/api/v1/websocket/0D'))
    && regCalls.some((c) => c.body.data[0].item === SYM_LADDER && c.body.data[0].type === '0D')
    && regCalls.some((c) => c.body.data[0].item === SYM_TOTALS && c.body.data[0].type === '0D');
  console.log('[probe] REG fetch 호출(카드 마운트 2장 기대):', JSON.stringify(regCalls));

  // ---------- (2)+(3) 합성 0D 프레임 — 래더 일부 레벨만 갱신 ----------
  const frame1 = {
    trnm: 'REAL',
    data: [
      real0DRow(SYM_LADDER, { sellQty: { 1: 555, 2: 444 }, buyQty: { 1: 333 } }),
      real0DRow(SYM_OTHER, { sellQty: { 1: 999999 } }), // 교차 오염 시험 — 큰 값으로 눈에 띄게
    ],
  };
  const ticks1 = orderbookRealtime.parseQuoteBookFrame(frame1);
  console.log('[probe] 파싱된 합성 틱 1:', JSON.stringify(ticks1));
  shellWin.webContents.send('athena:orderbook-ticks', ticks1);
  await wait(400);

  const afterTick1 = await shellWin.webContents.executeJavaScript(`
    (() => Array.from(document.querySelectorAll('.card-kit-hoga-ladder .card-kit-row-ladder')).map((row) => ({
      side: row.dataset.hogaSide, level: row.dataset.hogaLevel,
      qty: row.querySelector('.card-kit-row-ladder-qty').textContent,
      barWidth: row.querySelector('.card-kit-row-ladder-bar').style.width,
    })))()
  `);
  console.log('[probe] 틱1 이후 래더 행:', JSON.stringify(afterTick1));

  const askLevel1 = afterTick1.find((r) => r.side === 'ask' && r.level === '1');
  const askLevel2 = afterTick1.find((r) => r.side === 'ask' && r.level === '2');
  const bidLevel1 = afterTick1.find((r) => r.side === 'bid' && r.level === '1');
  // REST 초기값(ask3='970')이 이 틱에 없던 레벨 — 텍스트는 그대로 유지돼야
  // 한다(지어내지 않음). 단 막대 폭은 이 카드 20행 전체의 새 최댓값(970, 안
  // 건드린 ask3 자신이 최댓값이 됐다) 기준으로 다시 스케일되므로 100%가 된다 —
  // "부분 갱신이어도 막대 비율은 카드 전체 기준"이 이 단언의 핵심(위 함수 주석 참고).
  const askLevel3 = afterTick1.find((r) => r.side === 'ask' && r.level === '3');
  const newMax = 970; // max(555,444,970,960,...,900,333,880,...,800)
  const pct = (q) => `${Math.round((q / newMax) * 100)}%`;
  const tick1Applied = askLevel1 && askLevel1.qty === '555' && askLevel1.barWidth === pct(555)
    && askLevel2 && askLevel2.qty === '444' && askLevel2.barWidth === pct(444)
    && bidLevel1 && bidLevel1.qty === '333' && bidLevel1.barWidth === pct(333)
    && askLevel3 && askLevel3.qty === '970' // 초기 REST 값(1000-3*10) 그대로 — 텍스트는 안 바뀐다
    && askLevel3.barWidth === '100%'; // 이제 이 행이 카드 전체 최댓값이라 막대는 다시 그려진다

  // ---------- (4) 비율바 카드 갱신 ----------
  const frame2 = { trnm: 'REAL', data: [real0DRow(SYM_TOTALS, { sellTotal: 12000, buyTotal: 3000 })] };
  const ticks2 = orderbookRealtime.parseQuoteBookFrame(frame2);
  shellWin.webContents.send('athena:orderbook-ticks', ticks2);
  await wait(400);
  const afterTotalsTick = await shellWin.webContents.executeJavaScript(`
    (() => Array.from(document.querySelectorAll('.card-kit-bar-proportional .card-kit-bar-row')).map((row) => ({
      value: row.querySelector('.card-kit-bar-value').textContent,
      width: row.querySelector('.card-kit-bar-fill').style.width,
    })))()
  `);
  console.log('[probe] 비율바 갱신 후:', JSON.stringify(afterTotalsTick));
  const totalsTickApplied = afterTotalsTick.length === 2
    && afterTotalsTick[0].value === '12,000' && afterTotalsTick[0].width === '100%'
    && afterTotalsTick[1].value === '3,000' && afterTotalsTick[1].width === '25%';

  // ---------- (5) 교차 오염 — SYM_OTHER 틱이 래더 카드에 안 묻었는지 ----------
  const noContamination = !afterTick1.some((r) => r.qty === '999,999');

  // ---------- (6) destroy → REMOVE fetch + 이후 틱 무해 ----------
  const fetchCallsBeforeDestroy = fetchCalls.length;
  const cleared = await shellWin.webContents.executeJavaScript(
    "(() => { window.AthenaShell.clearCanvases(); return document.querySelectorAll('.card').length === 0; })()",
  );
  await wait(300);
  const removeCalls = fetchCalls.slice(fetchCallsBeforeDestroy).filter((c) => c.body && c.body.trnm === 'REMOVE');
  const removeOk = removeCalls.length === 2
    && removeCalls.every((c) => c.url.endsWith('/api/v1/websocket/0D') && c.body.data[0].type === '0D')
    && removeCalls.some((c) => c.body.data[0].item === SYM_LADDER)
    && removeCalls.some((c) => c.body.data[0].item === SYM_TOTALS);
  console.log('[probe] destroy 후 REMOVE fetch:', JSON.stringify(removeCalls));

  let destroyTickThrew = false;
  try {
    shellWin.webContents.send('athena:orderbook-ticks', ticks1);
    await wait(300);
  } catch {
    destroyTickThrew = true;
  }
  const cardCountAfterDestroyTick = await shellWin.webContents.executeJavaScript(
    'document.querySelectorAll(".card").length',
  );
  console.log('[probe] destroy 후 틱 주입 — 예외:', destroyTickThrew, '| 카드 수:', cardCountAfterDestroyTick);
  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);

  const ok = cardsAfterOpen.ladderRows === 20
    && cardsAfterOpen.totalsRows === 2
    && regOk
    && tick1Applied
    && totalsTickApplied
    && noContamination
    && cleared === true
    && removeOk
    && destroyTickThrew === false
    && cardCountAfterDestroyTick === 0
    && consoleErrors.length === 0;

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-orderbook-realtime.json'),
    JSON.stringify({
      cardsAfterOpen, regOk, regCalls, tick1Applied, afterTick1, totalsTickApplied, afterTotalsTick,
      noContamination, cleared, removeOk, removeCalls, destroyTickThrew, cardCountAfterDestroyTick,
      consoleErrors, ok,
    }, null, 1),
  );
  console.log('[probe] 최종 판정:', ok);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
