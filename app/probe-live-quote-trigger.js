// 실시간 트리거 stk_cd 기준 전환 프로브(P1, 2026-08-27) — QA 배치 전체에서 REG
// 0건이었던 원인 두 갈래를 검증한다: (1) main.js onCanvasResult가 card_title
// ==='시세'만 보던 옛 조건 — "삼성전자 시세 보여줘"는 실제로는 detail:ka10001 →
// card_title '종목정보' facts 카드로 라우팅돼(canvas_transform.py:865, 의도된
// 라우팅) 옛 조건을 못 넘었다. (2) '종목정보' facts 카드에 실시간 갱신 배선이
// 아예 없었다.
//
// probe-quote-realtime.js와 같은 기법 — 업스트림(키움 REAL WS)만 global.fetch로
// 대역하고, 그 아래(athena:chart-ticks IPC → canvas.js → 카드종 applyLiveTick)는
// 전부 실경로로 통과시킨다.
//
// 단언 4종:
//   (1) '종목정보' facts envelope(stk_cd 있음, card_title!=='시세')에서
//       extractLiveQuoteSymbol이 종목코드를 찾는다 — 옛 title 조건이면 놓쳤을 값.
//   (2) 그 종목코드로 ensureRealtimeForSymbol → REG fetch 1건.
//   (3) 카드 렌더 후 합성 틱 주입 → 현재가·등락 배지가 제자리 갱신(카드 재생성 없음).
//   (4) 카드 destroy → athena:realtime-release로 참조 해제 → REMOVE fetch 발화.
//   + 회귀: 기존 '시세' mcp-table 카드 경로가 여전히 렌더·실시간 갱신된다.

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'live';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const fetchCalls = [];
global.fetch = async (url, init) => {
  fetchCalls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
  return { ok: true, status: 200 };
};

const PROFILE = path.join(__dirname, '.probe-live-quote-trigger-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// backend 53ece06 실제 봉투 그대로 — "삼성전자 시세 보여줘"가 라우팅되는
// detail:ka10001 current_trading 그룹(card-kind-종목정보.js pickPrimaryView 실측).
// card_title은 '시세'가 아니라 '종목정보'다 — 옛 트리거 조건의 사각지대.
const STOCKINFO_ENVELOPE = {
  canvas_type: 'facts',
  fell_back: false,
  card_title: '종목정보',
  caption: '삼성전자 현재가',
  stk_cd: '005930',
  data: {
    fields: [
      { key: 'stk_nm', label: '종목명', value: '삼성전자' },
      { key: 'stk_cd', label: '종목코드', value: '005930' },
      { key: 'cur_prc', label: '현재가', value: '71,000' },
      { key: 'flu_rt', label: '등락률', value: '+1.20' },
    ],
  },
};

function quoteTableEnvelope(symbol) {
  return {
    canvas_type: 'table',
    fell_back: false,
    card_title: '시세',
    caption: '체결·현재가',
    stk_cd: symbol,
    data: {
      columns: [
        { key: 'cntr_pric', label: '체결가' },
        { key: 'cntr_qty', label: '체결량(주)' },
        { key: 'flu_rt', label: '등락률' },
        { key: 'acc_trde_qty', label: '거래량(주)' },
      ],
      rows: [{ cntr_tm: '090000', cntr_pric: '257000', cntr_qty: '10', flu_rt: '1.37', acc_trde_qty: '311392' }],
    },
  };
}

async function main() {
  const mainMod = require('./main.js');

  // ---------- (1)+(2) 실사용 경로 — 순수 모듈 호출로 옛/새 조건 차이를 직접 본다 ----------
  const oldConditionWouldFire = STOCKINFO_ENVELOPE.card_title === '시세'; // 옛 조건 — 사각지대 증명
  const liveSymbol = mainMod.extractLiveQuoteSymbol(STOCKINFO_ENVELOPE);
  console.log('[probe] 옛 조건(card_title===\'시세\')이 이 envelope에서 발화했을까:', oldConditionWouldFire);
  console.log('[probe] 새 조건(extractLiveQuoteSymbol)이 찾은 종목코드:', JSON.stringify(liveSymbol));
  mainMod.ensureRealtimeForSymbol(liveSymbol);
  await wait(200);
  const regCallForStockinfo = fetchCalls.find((c) => (
    c.body && c.body.trnm === 'REG' && c.body.data && c.body.data[0] && c.body.data[0].item === '005930'
  ));
  console.log('[probe] REG fetch(종목정보 경로):', JSON.stringify(regCallForStockinfo));

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

  // ---------- (3) 카드 렌더 + 합성 틱 → 현재가·등락 배지 제자리 갱신 ----------
  shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: STOCKINFO_ENVELOPE });
  await wait(400);
  const readStockinfoCard = () => shellWin.webContents.executeJavaScript(`
    (() => {
      const c = document.querySelector('.card.facts');
      if (!c) return null;
      return {
        stkCd: c.dataset.stkCd || null,
        price: c.querySelector('.card-kit-quote-price')?.textContent || '',
        badge: c.querySelector('.card-kit-badge-change')?.textContent || '',
        badgeTone: c.querySelector('.card-kit-badge-change')?.className || '',
      };
    })()
  `);
  const beforeTick = await readStockinfoCard();
  console.log('[probe] 종목정보 카드 렌더 직후:', JSON.stringify(beforeTick));

  shellWin.webContents.send('athena:chart-ticks', [
    { symbol: '005930', at: 1735000000, price: 71800, volume: 5, changeRate: -0.5, accVolume: 999 },
  ]);
  await wait(300);
  const afterTick = await readStockinfoCard();
  console.log('[probe] 합성 틱 주입 후 종목정보 카드:', JSON.stringify(afterTick));

  // ---------- (4) destroy → REMOVE ----------
  const fetchCallsBeforeClose = fetchCalls.length;
  await shellWin.webContents.executeJavaScript(`
    (() => { document.querySelector('.card.facts .uk-card-close').click(); })()
  `);
  await wait(300);
  const removeCall = fetchCalls.slice(fetchCallsBeforeClose).find((c) => (
    c.body && c.body.trnm === 'REMOVE' && c.body.data && c.body.data[0] && c.body.data[0].item === '005930'
  ));
  console.log('[probe] 카드 destroy 후 REMOVE fetch:', JSON.stringify(removeCall));
  const cardGoneAfterClose = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.card.facts').length",
  );

  // ---------- 회귀 — 기존 '시세' mcp-table 카드 경로 ----------
  shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: quoteTableEnvelope('000660') });
  await wait(400);
  const quoteCardBefore = await shellWin.webContents.executeJavaScript(`
    (() => {
      const c = document.querySelector('.card.mcp-table');
      return c ? c.querySelectorAll('.card-kind-시세-ticker tbody tr').length : null;
    })()
  `);
  shellWin.webContents.send('athena:chart-ticks', [
    { symbol: '000660', at: 1735000001, price: 210800, volume: 3, changeRate: 0.4, accVolume: 555 },
  ]);
  await wait(300);
  const quoteCardAfter = await shellWin.webContents.executeJavaScript(`
    (() => {
      const c = document.querySelector('.card.mcp-table');
      return c ? c.querySelectorAll('.card-kind-시세-ticker tbody tr').length : null;
    })()
  `);
  console.log('[probe] 회귀 — 시세 테이블 카드 행수(틱 전/후):', quoteCardBefore, quoteCardAfter);
  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);

  const triggerFixOk = oldConditionWouldFire === false // 사각지대였음을 증명
    && liveSymbol === '005930'
    && !!regCallForStockinfo
    && regCallForStockinfo.url.endsWith('/api/v1/websocket/0B');

  const cardWiredOk = !!beforeTick
    && beforeTick.stkCd === '005930'
    && beforeTick.price === '71,000'
    && afterTick.price === '71,800' // priceMagnitude+formatNumeric — 부호 없는 원본
    && afterTick.badge === '-0.5' // ChangeBadge 원문 그대로(반올림 안 함)
    && afterTick.badgeTone.includes('is-down');

  const releaseOk = !!removeCall
    && removeCall.url.endsWith('/api/v1/websocket/0B')
    && cardGoneAfterClose === 0;

  const regressionOk = quoteCardBefore === 1 && quoteCardAfter === 2;

  const ok = triggerFixOk && cardWiredOk && releaseOk && regressionOk && consoleErrors.length === 0;

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-live-quote-trigger.json'),
    JSON.stringify({
      oldConditionWouldFire, liveSymbol, regCallForStockinfo,
      beforeTick, afterTick, removeCall, cardGoneAfterClose,
      quoteCardBefore, quoteCardAfter, consoleErrors,
      triggerFixOk, cardWiredOk, releaseOk, regressionOk, ok,
    }, null, 1),
  );
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
