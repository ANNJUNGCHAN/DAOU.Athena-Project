// 대화 경로 카드 종목 단위 공존 프로브(P2, 2026-08-27) — canvas.js makeCard의
// 비데이터셋(non-dataset) 경로 검증. 옛 판은 correlation 없는 envelope이 오면
// 같은 canvas_type 카드를 무조건 destroy 후 재생성했다 — "삼성전자하고
// SK하이닉스 시세 비교해줘"처럼 같은 카드종(facts/'종목정보')으로 두 종목을
// 물으면 먼저 그린 카드가 사라졌다(실측: datasets/eval-runs/2026-08-27-
// intraday-ui-clean/). backend 53ece06이 봉인한 envelope.stk_cd로 교체 판정을
// 종목 단위까지 좁힌 수정을 여기서 검증한다.
//
// 단언 3종:
//   (1) 같은 canvas_type('facts')·다른 stk_cd envelope 2장 → 카드 2장 공존
//   (2) 같은 stk_cd로 재주입 → 그 카드만 교체(값 갱신), 다른 종목 카드는 그대로
//   (3) stk_cd 없는(하위 호환) envelope → 기존처럼 동일 타입 카드를 교체(카드 수 불변)

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'live';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-card-stkcd-coexist-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 실제 backend canvas_push.py/canvas_data.py가 봉인하는 그대로 — envelope.stk_cd
// 최상위 필드 + data.fields 안 표시용 stk_cd/stk_nm (render종목정보 pickPrimaryView
// 계약, card-kind-종목정보.js 실측).
function factsEnvelope(symbol, name, price, changeRate) {
  return {
    canvas_type: 'facts',
    fell_back: false,
    card_title: '종목정보',
    caption: `${name} 현재가`,
    stk_cd: symbol,
    data: {
      fields: [
        { key: 'stk_nm', label: '종목명', value: name },
        { key: 'stk_cd', label: '종목코드', value: symbol },
        { key: 'cur_prc', label: '현재가', value: price },
        { key: 'flu_rt', label: '등락률', value: changeRate },
      ],
    },
  };
}

// 하위 호환 확인용 — stk_cd 없는 envelope(백엔드가 아직 안 채우는 다른 TR을 흉내).
function factsEnvelopeNoStkCd(name, price, changeRate) {
  const env = factsEnvelope('__none__', name, price, changeRate);
  delete env.stk_cd;
  env.data.fields = env.data.fields.filter((f) => f.key !== 'stk_cd');
  return env;
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

  const readFactsCards = () => shellWin.webContents.executeJavaScript(`
    (() => Array.from(document.querySelectorAll('.card.facts')).map(c => ({
      stkCd: c.dataset.stkCd || null,
      title: c.querySelector('.card-title')?.textContent || '',
      price: c.querySelector('.card-kit-quote-price')?.textContent || '',
    })))()
  `);

  // ---------- (1) 다른 종목 2장 — 공존 기대 ----------
  shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success', envelope: factsEnvelope('005930', '삼성전자', '71,000', '+1.20%'),
  });
  await wait(400);
  shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success', envelope: factsEnvelope('000660', 'SK하이닉스', '210,500', '-0.80%'),
  });
  await wait(400);
  const afterTwoSymbols = await readFactsCards();
  console.log('[probe] 다른 종목 2장 주입 후 facts 카드:', JSON.stringify(afterTwoSymbols));

  // ---------- (2) 같은 종목(005930) 재주입 — 그 카드만 교체 기대 ----------
  shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success', envelope: factsEnvelope('005930', '삼성전자', '71,500', '+1.90%'),
  });
  await wait(400);
  const afterSameSymbolReplace = await readFactsCards();
  console.log('[probe] 같은 종목 재주입 후 facts 카드:', JSON.stringify(afterSameSymbolReplace));

  // ---------- (2b) 같은 종목·다른 화면(screen_id) — 공존 기대 ----------
  // 장중 QA 실측(2026-08-27): ka10004 호가 detail 5장(매도/매수/총잔량…)이 같은
  // 종목이라 서로를 지워 1장만 남았다 — screen_id가 다르면 공존해야 한다.
  shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success',
    envelope: { ...factsEnvelope('005930', '삼성전자', '72,000', '+2.60%'), screen_id: 'SCR-호가-매도' },
  });
  await wait(400);
  const afterOtherScreen = await readFactsCards();
  console.log('[probe] 같은 종목·다른 화면 주입 후 facts 카드(공존 기대):', JSON.stringify(afterOtherScreen));

  // 같은 종목·같은 화면 재주입 — 그 화면 카드만 교체(카드 수 불변) 기대.
  shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success',
    envelope: { ...factsEnvelope('005930', '삼성전자', '72,500', '+3.30%'), screen_id: 'SCR-호가-매도' },
  });
  await wait(400);
  const afterSameScreenReplace = await readFactsCards();
  console.log('[probe] 같은 종목·같은 화면 재주입 후(교체 기대):', JSON.stringify(afterSameScreenReplace));

  // ---------- (3) stk_cd 없는 envelope — 기존처럼 동일 타입이면 교체(하위 호환) ----------
  shellWin.webContents.send('athena:add-canvas-live', {
    status: 'success', envelope: factsEnvelopeNoStkCd('무명 종목', '1,000', '0.00%'),
  });
  await wait(400);
  const afterNoStkCd = await readFactsCards();
  console.log('[probe] stk_cd 없는 envelope 주입 후 facts 카드(하위 호환 — 교체 기대):', JSON.stringify(afterNoStkCd));

  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);

  const coexistOk = afterTwoSymbols.length === 2
    && afterTwoSymbols.some((c) => c.stkCd === '005930' && c.price === '71,000')
    && afterTwoSymbols.some((c) => c.stkCd === '000660' && c.price === '210,500');

  const replaceOk = afterSameSymbolReplace.length === 2
    && afterSameSymbolReplace.some((c) => c.stkCd === '005930' && c.price === '71,500') // 갱신됨
    && afterSameSymbolReplace.some((c) => c.stkCd === '000660' && c.price === '210,500'); // 그대로

  const screenCoexistOk = afterOtherScreen.length === 3
    && afterOtherScreen.some((c) => c.stkCd === '005930' && c.price === '72,000')
    && afterOtherScreen.some((c) => c.stkCd === '005930' && c.price === '71,500');

  const screenReplaceOk = afterSameScreenReplace.length === 3
    && afterSameScreenReplace.some((c) => c.stkCd === '005930' && c.price === '72,500')
    && !afterSameScreenReplace.some((c) => c.price === '72,000');

  // stk_cd 없는 envelope은 동일 타입 아무 카드나 교체한다(문서화된 하위 호환) —
  // 카드 수는 그대로(3장)이되, 새 카드(stkCd:null)가 그중 하나를 대체했는지만 본다.
  const backwardCompatOk = afterNoStkCd.length === 3
    && afterNoStkCd.some((c) => c.stkCd === null && c.price === '1,000');

  const ok = coexistOk && replaceOk && screenCoexistOk && screenReplaceOk
    && backwardCompatOk && consoleErrors.length === 0;

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-card-stkcd-coexist.json'),
    JSON.stringify({
      afterTwoSymbols, afterSameSymbolReplace, afterOtherScreen, afterSameScreenReplace, afterNoStkCd,
      coexistOk, replaceOk, screenCoexistOk, screenReplaceOk, backwardCompatOk, consoleErrors, ok,
    }, null, 1),
  );
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
