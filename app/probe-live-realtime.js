// 2단계 진단 — 실시간 배선을 합성 체결로 검증한다.
// 장이 닫혀 있어 진짜 틱은 안 흐르므로, main이 REAL 프레임을 파싱해 보내는 지점부터
// 아래(preload → canvas → 어댑터 → 차트 진행봉)를 전부 실제 경로로 통과시킨다.
// 업스트림(키움 REAL WS)만 대역한다 — 그 위는 장중에 봐야 한다.
process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-rt-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true })
);
app.setPath('userData', PROFILE);

const CAPTURES = path.join(__dirname, 'captures');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const chartRealtime = require('./lib/main/chart-realtime');

const DATASET = {
  dataset_id: 'probe-rt-chart',
  question: '삼성전자 일봉 차트',
  operations: [{
    operation_ref: 'base:ka10081',
    args: { stk_cd: '005930', base_dt: '20260825', upd_stkpc_tp: '1' },
    caption: '삼성전자 일봉',
  }],
};

// 마지막 봉을 어댑터에서 되읽는다 — 진행봉이 실제로 갱신됐는지 값으로 본다.
const LAST_BAR = `(() => {
  const probe = window.__athenaChartProbe;
  if (!probe) return { probe: false };
  const s = probe.snapshot()[0];
  if (!s) return { probe: true, session: false };
  return { probe: true, session: true, stock: s.stock, period: s.period, count: s.candleCount, last: s.lastCandle };
})()`;

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  await wait(800);

  await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'rest-dataset', dataset: DATASET, expand: true })})`
  );
  await wait(6000);

  // ① 아무것도 주입하지 않고 관찰한다 — 진짜 REAL 체결이 흐르면 봉이 저절로 움직인다.
  const t0 = await shellWin.webContents.executeJavaScript(LAST_BAR);
  console.log('[rt] 자연 관찰 t0:', JSON.stringify(t0.last));
  await wait(8000);
  const t1 = await shellWin.webContents.executeJavaScript(LAST_BAR);
  console.log('[rt] 자연 관찰 t1(+8s):', JSON.stringify(t1.last));
  const naturalMoved = JSON.stringify(t0.last) !== JSON.stringify(t1.last);
  console.log(`[rt] 실제 체결 유입: ${naturalMoved ? 'OK — 봉이 스스로 움직였다' : '없음(장 마감/무체결)'}`);

  const before = await shellWin.webContents.executeJavaScript(LAST_BAR);
  console.log('[rt] 체결 주입 전:', JSON.stringify(before));
  let img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'rt-before.png'), img.toPNG());

  // 진짜 REAL 프레임 모양 그대로 만든다 — main의 파서를 그대로 통과시킨다.
  const tradingDate = chartRealtime.kstTradingDate();
  const frame = {
    trnm: 'REAL',
    data: [{ type: '0B', item: '005930', values: { 20: '151500', 10: '+321000', 15: '+4242' } }],
  };
  const ticks = chartRealtime.parseRealFrame(frame, tradingDate);
  console.log('[rt] 파싱된 체결:', JSON.stringify(ticks));
  shellWin.webContents.send('athena:chart-ticks', ticks);
  await wait(2000);

  const after = await shellWin.webContents.executeJavaScript(LAST_BAR);
  console.log('[rt] 체결 주입 후:', JSON.stringify(after));
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'rt-after.png'), img.toPNG());

  const b = before.last || {};
  const a = after.last || {};
  // 종가로 판정하지 않는다 — 진짜 체결이 계속 흘러 들어와 주입 직후 값을 덮는다.
  // 주입분이 반드시 남기는 흔적은 고가(321000은 실제 체결 범위 밖)와 거래량 누적이다.
  const highTook = Number(a.high) >= 321000;
  const volumeGrew = Number(a.volume) >= Number(b.volume) + 4242;
  const kept = Number(a.open) === Number(b.open);
  console.log(`[rt] 판정 — 고가 반영:${highTook ? 'OK' : 'FAIL'} 거래량 누적:${volumeGrew ? 'OK' : 'FAIL'} 시가 보존:${kept ? 'OK' : 'FAIL'} 봉수 ${before.count}→${after.count}`);
  app.exit(highTook && volumeGrew && kept ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[rt] 실패:', e); app.exit(1); });
