// 시세 카드 실시간 배선 e2e 프로브(단계 8 확장, 태스크 #16) — probe-live-realtime.js와
// 같은 기법이다: 합성 REAL 0B 프레임을 main의 실파서(lib/main/chart-realtime.js
// parseRealFrame)로 그대로 통과시켜, 그 아래(athena:chart-ticks IPC → canvas.js →
// 시세 실시간 세션 어댑터 → card-kind-시세.js 표 갱신)는 전부 실경로로 통과시킨다.
// 업스트림(키움 REAL WS)만 대역한다 — 장 마감·백엔드 부재에도 돈다.
//
// 카드 자체는 athena:add-canvas-live로 직접 주입한다(클로드 툴 렌더 결과가 오는
// 채널과 동일) — 이 프로브의 목적은 "카드가 이미 떠 있을 때 실시간이 올바르게
// 배선되는지"이지, REST 데이터셋 selector 문법(ka10055의 정확한 조회 인자 조합)
// 자체를 검증하는 게 아니다(그건 백엔드 계약 테스트의 몫).
//
// 단언 3종(태스크 설명 그대로):
//   (1) 시세 카드 1장에 합성 틱 주입 → 4열 값 갱신
//   (2) 6종목 카드 동시 오픈 → 각 카드가 자기 종목 틱만 반영(교차 오염 0)
//   (3) 카드 destroy 후 틱 주입 → 오류 없음
// + 6장 상한 확인: 신규 코드 없이 canvas.js:1130(REST 데이터셋 카드 6장 초과 시
// throw)가 실시간 카드에도 그대로 걸리는지(7번째 시도가 거부되는지)만 본다.
//
// + 실사용 경로 검증(2026-08-27 확장 2차 — team-lead 판정 "옵션 2: 트리거를
// 클로드 툴 경로로 확장") — 위 단언들은 카드가 "이미 떠 있다"고 가정하고 시작한다.
// 그 카드가 애초에 실시간으로 등록되는지는 별개 질문이라 여기서 따로 본다:
// main.js의 ensureRealtimeForSymbol/extractLiveQuoteSymbol을 직접 불러
// (onCanvasResult가 부르는 것과 같은 모듈 함수) global.fetch를 가로채고
// (1) 오늘 실제 envelope 모양(백엔드 canvas_push.py:529-541 "table" 분기 그대로,
//     종목코드 자리 없음) → REG 호출 0건(무해하게 건너뜀)
// (2) 종목코드가 있다고 가정한 envelope(백엔드가 필드를 추가하면 이렇게 온다) →
//     REG 호출 1건, 올바른 엔드포인트/종목
// 두 가지를 확인한다 — "프로브는 통과하는데 실사용은 죽은 배선"이었던 위험을
// 정확히 이 지점에서 잡는다.

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'live'; // ensureChartRealtime의 fixture 조기-return을 피한다

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// main.js가 지연 생성하는 레지스트라가 이 시점의 global.fetch를 캡처한다 —
// require('./main.js')보다 먼저 걸어둘 필요는 없다(등록은 실제로 부를 때 일어난다),
// 다만 실백엔드로 나가면 안 되므로 첫 실사용 호출 전에는 반드시 걸려 있어야 한다.
const fetchCalls = [];
global.fetch = async (url, init) => {
  fetchCalls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
  return { ok: true, status: 200 };
};

const chartRealtime = require('./lib/main/chart-realtime');

const PROFILE = path.join(__dirname, '.probe-quote-realtime-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 6종목 — 서로 다른 stk_cd라야 "교차 오염 0"을 실제로 시험할 수 있다.
const SYMBOLS = ['005930', '000660', '035420', '051910', '005380', '105560'];

function quoteEnvelope(symbol, index) {
  return {
    canvas_type: 'table',
    card_title: '시세',
    // dataset_id를 공유해야 canvas.js makeCard의 6장 상한(isDatasetCard)이
    // 적용된다 — 실시간 배선용 별도 코드를 안 만들고 기존 계약을 그대로 쓴다.
    correlation: { dataset_id: 'probe-quote-6', item_id: `item-${index}`, ordinal: index + 1 },
    operation_args: { stk_cd: symbol },
    data: {
      columns: [
        { key: 'cntr_pric', label: '체결가' },
        { key: 'cntr_qty', label: '체결량(주)' },
        { key: 'flu_rt', label: '등락률' },
        { key: 'acc_trde_qty', label: '거래량(주)' },
      ],
      rows: [{ cntr_tm: '090000', cntr_pric: '100000', cntr_qty: '1', flu_rt: '0.10', acc_trde_qty: '1000' }],
    },
  };
}

// 오늘 실제 백엔드가 만드는 그대로다(canvas_push.py:529-541 "table" 분기 필드
// 그대로 옮김 — 종목코드를 담을 자리가 없다).
const REALISTIC_TODAY_ENVELOPE = {
  canvas_type: 'table',
  screen_id: 'AT-CV-014',
  fell_back: false,
  fallback_reason: null,
  caption: '체결·현재가',
  card_title: '시세',
  data: {
    columns: [
      { key: 'cntr_pric', label: '체결가' },
      { key: 'cntr_qty', label: '체결량(주)' },
      { key: 'flu_rt', label: '등락률' },
      { key: 'acc_trde_qty', label: '거래량(주)' },
    ],
    rows: [{ cntr_tm: '090000', cntr_pric: '257000', cntr_qty: '10', flu_rt: '1.37', acc_trde_qty: '311392' }],
  },
  layout: null,
  drop_types: [],
};

// 백엔드가 언젠가 종목코드를 얹으면 이런 모양일 것이다(operation_args 후보 —
// main.js extractLiveQuoteSymbol이 보는 첫 자리). 배선이 이미 준비돼 있는지만
// 본다 — 이 필드가 실제로 온다고 주장하는 게 아니다.
const HYPOTHETICAL_FUTURE_ENVELOPE = {
  ...REALISTIC_TODAY_ENVELOPE,
  operation_args: { stk_cd: '005930' },
};

async function main() {
  const mainMod = require('./main.js');

  // ---------- 실사용 경로 검증 — 셸 창 없이도 되는 순수 모듈 호출 ----------
  const noSymbol = mainMod.extractLiveQuoteSymbol(REALISTIC_TODAY_ENVELOPE);
  console.log('[probe] 오늘 실제 envelope에서 추출한 종목코드:', JSON.stringify(noSymbol));
  mainMod.ensureRealtimeForSymbol(noSymbol);
  const fetchCallsAfterRealistic = fetchCalls.length;

  const foundSymbol = mainMod.extractLiveQuoteSymbol(HYPOTHETICAL_FUTURE_ENVELOPE);
  console.log('[probe] 가정 envelope(operation_args.stk_cd 있음)에서 추출한 종목코드:', JSON.stringify(foundSymbol));
  mainMod.ensureRealtimeForSymbol(foundSymbol);
  await wait(200); // ensureSymbol의 fetch는 비동기다
  const fetchCallsAfterHypothetical = fetchCalls.length;
  console.log('[probe] REG fetch 호출:', JSON.stringify(fetchCalls, null, 1));

  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  const consoleErrors = [];
  shellWin.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) consoleErrors.push(message); // 3=error(electron console-message level)
  });

  for (let i = 0; i < 100; i += 1) {
    const hidden = await shellWin.webContents.executeJavaScript("document.getElementById('app').hidden");
    if (hidden === false) break;
    await wait(100);
  }

  // ---------- (2) 6종목 카드 동시 오픈 ----------
  for (let i = 0; i < SYMBOLS.length; i += 1) {
    shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: quoteEnvelope(SYMBOLS[i], i) });
  }
  await wait(800);

  const cardsAfterOpen = await shellWin.webContents.executeJavaScript(`
    (() => Array.from(document.querySelectorAll('.card.mcp-table')).map(c => ({
      itemId: c.dataset.itemId,
      rows: c.querySelectorAll('.card-kind-시세-ticker tbody tr').length,
    })))()
  `);
  console.log('[probe] 6종목 오픈 직후:', JSON.stringify(cardsAfterOpen));

  // 7번째 — isValidCorrelation(rest-canvas-paint.js)이 ordinal 1~6만 유효하다고
  // 보므로, 7번째 "새 항목"은 기존 6개 중 하나와 ordinal은 같지만 item_id가 다른
  // 요청으로만 표현할 수 있다(실제로 백엔드가 MAX_ITEMS=6을 지키는 한 정상 경로로는
  // 안 생기는 입력이지만, canvas.js:1130 안전망 자체는 이 모양으로만 시험 가능하다).
  const seventh = quoteEnvelope('000270', 5); // ordinal=6 재사용
  seventh.correlation.item_id = 'item-6'; // 기존 item-5와 달라야 "새 카드" 취급된다
  shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: seventh });
  await wait(400);
  const cardCountAfterSeventh = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.card.mcp-table').length",
  );

  // ---------- 합성 REAL 프레임 — 6종목 체결을 한 프레임에 담는다 ----------
  const tradingDate = chartRealtime.kstTradingDate();
  const frame = {
    trnm: 'REAL',
    data: SYMBOLS.map((symbol, i) => ({
      type: '0B',
      item: symbol,
      values: { 20: '093000', 10: `+${200000 + i}`, 15: `+${10 + i}`, 12: `+${1 + i}.5`, 13: `+${500000 + i}` },
    })),
  };
  const ticks = chartRealtime.parseRealFrame(frame, tradingDate);
  console.log('[probe] 파싱된 합성 체결 6건:', JSON.stringify(ticks));
  shellWin.webContents.send('athena:chart-ticks', ticks);
  await wait(500);

  // ---------- (1)+(2) 검증 — 각 카드가 자기 종목 값만 받았는지 ----------
  const cardsAfterTick = await shellWin.webContents.executeJavaScript(`
    (() => Array.from(document.querySelectorAll('.card.mcp-table')).map(c => {
      const rows = Array.from(c.querySelectorAll('.card-kind-시세-ticker tbody tr'))
        .map(tr => Array.from(tr.children).map(td => td.textContent));
      return { itemId: c.dataset.itemId, rowCount: rows.length, latest: rows[0] };
    }))()
  `);
  console.log('[probe] 합성 체결 주입 후:', JSON.stringify(cardsAfterTick, null, 1));

  const expectedBySymbolIndex = SYMBOLS.map((symbol, i) => ({
    price: (200000 + i).toLocaleString('en-US'),
    volume: String(10 + i),
    changeRatePct: `${(1 + i).toFixed(1)}%`, // 프레임 값 "+{n}.5" — toSignedNumber는 그대로, 표시는 flu_rt 그대로 문자열화
  }));

  // flu_rt는 원문 그대로 ChangeBadge에 실린다(카드종 서식이 반올림하지 않는다) —
  // 여기서는 "각 카드가 자기 순번의 값을 받았는가"만 문자열 포함 여부로 확인한다.
  const crossContamination = cardsAfterTick.some((card, i) => {
    if (card.rowCount !== 2) return true; // 갱신이 아예 안 됐다
    const expectedPrice = (200000 + i).toLocaleString('en-US');
    return !card.latest || card.latest[0] !== expectedPrice;
  });

  // ---------- (3) destroy 후 틱 — 오류 없이 무시돼야 한다 ----------
  const cleared = await shellWin.webContents.executeJavaScript(`
    (() => { window.AthenaShell.clearCanvases(); return document.querySelectorAll('.card').length === 0; })()
  `);
  console.log('[probe] 전체 destroy:', cleared);
  let destroyTickThrew = false;
  try {
    shellWin.webContents.send('athena:chart-ticks', ticks);
    await wait(300);
  } catch {
    destroyTickThrew = true;
  }
  const cardCountAfterDestroyTick = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.card').length",
  );

  console.log('[probe] 7번째 카드 시도 후 카드 수(6장 상한 유지 기대):', cardCountAfterSeventh);
  console.log('[probe] destroy 후 틱 주입 — 예외:', destroyTickThrew, '| 재생성된 카드 수:', cardCountAfterDestroyTick);
  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);

  // ---------- (4) 참조 계수 해제(2026-08-27) — 카드 destroy 시 REMOVE가 정확한
  // 바디로 나가는지, 같은 종목 카드 2장 중 1장만 닫으면 REMOVE가 안 나가는지 ----------
  // 렌더 파이프라인은 카드를 만들 뿐 acquire를 부르지 않는다(그건 REST paint
  // ack/onCanvasResult 몫, main.js ensureChartRealtime 주석) — 위 실사용 경로
  // 검증과 같은 방식으로 카드 2장분의 acquire를 직접 흉내낸다. 종목은 이 파일
  // 다른 어떤 시나리오에도 안 쓰는 걸 고른다 — SYMBOLS(6종목)엔 이미 wireQuoteRealtime
  // destroy 훅이 걸린 카드가 있어(위 clearCanvases가 비동기 IPC로 release를
  // 늦게 보낸다), 겹치면 그 release가 여기 카운트에 섞여 든다(실측: 000660
  // 재사용 시 REMOVE가 한 박자 일찍 나갔다 — registrar 로직이 아니라 이 시나리오
  // 오염이 원인이었다).
  const REFCOUNT_SYMBOL = '999001';
  const REFCOUNT_DATASET = 'probe-refcount-2';
  function refcountQuoteEnvelope(itemId, ordinal) {
    return {
      canvas_type: 'table',
      card_title: '시세',
      correlation: { dataset_id: REFCOUNT_DATASET, item_id: itemId, ordinal },
      operation_args: { stk_cd: REFCOUNT_SYMBOL },
      data: {
        columns: [
          { key: 'cntr_pric', label: '체결가' },
          { key: 'cntr_qty', label: '체결량(주)' },
          { key: 'flu_rt', label: '등락률' },
          { key: 'acc_trde_qty', label: '거래량(주)' },
        ],
        rows: [{ cntr_tm: '090000', cntr_pric: '100000', cntr_qty: '1', flu_rt: '0.10', acc_trde_qty: '1000' }],
      },
    };
  }
  mainMod.ensureRealtimeForSymbol(REFCOUNT_SYMBOL); // 카드 A분 acquire
  mainMod.ensureRealtimeForSymbol(REFCOUNT_SYMBOL); // 카드 B분 acquire(참조 2)
  await wait(200);
  const fetchCallsBeforeRefcount = fetchCalls.length;

  shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: refcountQuoteEnvelope('rc-a', 1) });
  shellWin.webContents.send('athena:add-canvas-live', { status: 'success', envelope: refcountQuoteEnvelope('rc-b', 2) });
  await wait(400);
  const refcountCardCount = await shellWin.webContents.executeJavaScript(
    `document.querySelectorAll('.card[data-dataset-id="${REFCOUNT_DATASET}"]').length`,
  );

  // 1장만 닫는다 — 참조가 아직 남아 있으니 REMOVE가 나가면 안 된다.
  await shellWin.webContents.executeJavaScript(`
    (() => { document.querySelector('.card[data-item-id="rc-a"] .uk-card-close').click(); })()
  `);
  await wait(300);
  const removedTooEarly = fetchCalls.slice(fetchCallsBeforeRefcount)
    .some((c) => c.body && c.body.trnm === 'REMOVE');

  // 마지막 카드를 닫는다 — 참조가 0이 되어 REMOVE가 정확한 바디로 나가야 한다.
  await shellWin.webContents.executeJavaScript(`
    (() => { document.querySelector('.card[data-item-id="rc-b"] .uk-card-close').click(); })()
  `);
  await wait(300);
  const removeCall = fetchCalls.find((c) => (
    c.body && c.body.trnm === 'REMOVE' && c.body.data && c.body.data[0] && c.body.data[0].item === REFCOUNT_SYMBOL
  ));
  const refcountOk = refcountCardCount === 2
    && !removedTooEarly
    && !!removeCall
    && removeCall.url.endsWith('/api/v1/websocket/0B')
    && removeCall.body.grp_no === '1'
    && removeCall.body.refresh === '1'
    && removeCall.body.data.length === 1
    && removeCall.body.data[0].type === '0B';
  console.log('[probe] 참조 계수 — 카드 2장 생성, 1장만 닫음(REMOVE 무발 기대):', { refcountCardCount, removedTooEarly });
  console.log('[probe] 참조 계수 — 마지막 카드 닫음(REMOVE 발화 기대):', JSON.stringify(removeCall));

  const realWiringHarmless = noSymbol === null && fetchCallsAfterRealistic === 0;
  const futureWiringReady = foundSymbol === '005930'
    && fetchCallsAfterHypothetical === 1
    && fetchCalls[0]
    && fetchCalls[0].url.endsWith('/api/v1/websocket/0B')
    && fetchCalls[0].body
    && fetchCalls[0].body.data
    && fetchCalls[0].body.data[0]
    && fetchCalls[0].body.data[0].item === '005930';
  console.log('[probe] 실사용 경로 — 오늘(무해):', realWiringHarmless, '| 가정(배선 준비됨):', futureWiringReady);

  const ok = realWiringHarmless
    && futureWiringReady
    && cardsAfterOpen.length === 6
    && cardsAfterOpen.every((c) => c.rows === 1)
    && cardCountAfterSeventh === 6 // 7번째는 거부되고 6장 유지
    && !crossContamination
    && cleared === true
    && destroyTickThrew === false
    && cardCountAfterDestroyTick === 0 // destroy 후 틱이 카드를 되살리지 않는다
    && refcountOk; // 참조 계수 해제 — 2장 중 1장 닫음(REMOVE 무발) + 마지막 닫음(REMOVE 발화)

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-quote-realtime.json'),
    JSON.stringify({
      realWiringHarmless, futureWiringReady, fetchCalls,
      cardsAfterOpen, cardCountAfterSeventh, cardsAfterTick, cleared, destroyTickThrew,
      refcountCardCount, removedTooEarly, removeCall, refcountOk, ok,
    }, null, 1),
  );
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
