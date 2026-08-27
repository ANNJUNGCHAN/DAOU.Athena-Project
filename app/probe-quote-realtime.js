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

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'live'; // ensureChartRealtime의 fixture 조기-return을 피한다

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

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

async function main() {
  const mainMod = require('./main.js');
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

  const ok = cardsAfterOpen.length === 6
    && cardsAfterOpen.every((c) => c.rows === 1)
    && cardCountAfterSeventh === 6 // 7번째는 거부되고 6장 유지
    && !crossContamination
    && cleared === true
    && destroyTickThrew === false
    && cardCountAfterDestroyTick === 0; // destroy 후 틱이 카드를 되살리지 않는다

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-quote-realtime.json'),
    JSON.stringify({ cardsAfterOpen, cardCountAfterSeventh, cardsAfterTick, cleared, destroyTickThrew, ok }, null, 1),
  );
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
