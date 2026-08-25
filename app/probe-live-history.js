// 3단계 진단 — 좌측 끝에 닿으면 과거 봉이 실제로 덧붙는지 실서버로 확인한다.
process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-hist-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true })
);
app.setPath('userData', PROFILE);

const CAPTURES = path.join(__dirname, 'captures');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DATASET = {
  dataset_id: 'probe-hist-chart',
  question: '삼성전자 일봉 차트',
  operations: [{
    operation_ref: 'base:ka10081',
    args: { stk_cd: '005930', base_dt: '20260825', upd_stkpc_tp: '1' },
    caption: '삼성전자 일봉',
  }],
};

const STATE = `(() => {
  const s = window.__athenaChartProbe.snapshot()[0];
  if (!s) return { session: false };
  return { session: true, period: s.period, count: s.candleCount, oldest: s.oldestCandle, last: s.lastCandle };
})()`;

// 왼쪽 끝까지 스크롤 — 실제 사용자가 팬하는 것과 같은 경로(가시 논리 범위 이동)다.
const SCROLL_LEFT = `(() => {
  const api = window.__athenaChartProbe.timeScale();
  if (!api) return false;
  const r = api.getVisibleLogicalRange();
  if (!r) return false;
  const span = r.to - r.from;
  api.setVisibleLogicalRange({ from: -5, to: -5 + span });
  return true;
})()`;

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  shellWin.webContents.on('console-message', (_e, level, message) => {
    if (/HISTDBG/.test(message)) console.log('[hist][renderer]', message);
  });
  await wait(800);

  await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'rest-dataset', dataset: DATASET, expand: true })})`
  );
  await wait(6000);

  // IPC를 직접 불러 main 경로를 먼저 분리 검증한다.
  const wired = await shellWin.webContents.executeJavaScript(`(() => {
    const s = window.__athenaChartProbe.snapshot()[0];
    return { hasProbe: true, panels: window.__athenaChartProbe.snapshot().length, hasTimeScale: !!window.__athenaChartProbe.timeScale() };
  })()`);
  console.log('[hist] 배선 상태:', JSON.stringify(wired));

  const direct = await shellWin.webContents.executeJavaScript(`(async () => {
    const s = window.__athenaChartProbe.snapshot()[0];
    try {
      const r = await window.athena.invoke('athena:chart-history-page', {
        panelId: s.panelId, generation: s.generation, period: 'D', interval: 1,
        adjusted: true, beforeDate: String(s.oldestCandle.time).replace(/-/g, ''),
      });
      return { ok: r && r.ok, n: r && r.candles ? r.candles.length : 0, err: r && r.error };
    } catch (e) { return { threw: String(e && e.message || e) }; }
  })()`);
  console.log('[hist] IPC 직접 호출:', JSON.stringify(direct));

  const before = await shellWin.webContents.executeJavaScript(STATE);
  console.log('[hist] 전:', JSON.stringify({ count: before.count, oldest: before.oldest && before.oldest.time }));

  let img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'hist-before.png'), img.toPNG());

  for (let i = 1; i <= 2; i += 1) {
    const ok = await shellWin.webContents.executeJavaScript(SCROLL_LEFT);
    console.log(`[hist] 좌측 끝으로 스크롤 ${i}회: ${ok ? '이동' : '실패'}`);
    await wait(1500);
    const r = await shellWin.webContents.executeJavaScript(
      `JSON.stringify(window.__athenaChartProbe.timeScale().getVisibleLogicalRange())`);
    console.log(`[hist] 가시 논리범위: ${r}`);
    await wait(5000);
    const s = await shellWin.webContents.executeJavaScript(STATE);
    console.log(`[hist] 후${i}: 봉 ${s.count} | 가장 오래된 ${s.oldest && s.oldest.time}`);
  }

  const dump = await shellWin.webContents.executeJavaScript(`(() => {
    const p = window.__athenaChartProbe;
    const s = p.snapshot()[0];
    const ts = p.timeScale();
    return { adapterPeriod: s.period, adapterCount: s.candleCount,
             adapterOldest: s.oldestCandle && s.oldestCandle.time,
             adapterLast: s.lastCandle && s.lastCandle.time };
  })()`);
  console.log('[hist] 덤프:', JSON.stringify(dump));

  const after = await shellWin.webContents.executeJavaScript(STATE);
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'hist-after.png'), img.toPNG());

  const grew = after.count > before.count;
  const older = String(after.oldest && after.oldest.time) < String(before.oldest && before.oldest.time);
  console.log(`[hist] 판정 — 봉 증가:${grew ? 'OK' : 'FAIL'}(${before.count}→${after.count}) 과거로 확장:${older ? 'OK' : 'FAIL'}`);
  app.exit(grew && older ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[hist] 실패:', e); app.exit(1); });
