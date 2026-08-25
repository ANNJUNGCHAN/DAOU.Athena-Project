// 시연용 런처 — live 모드로 실제 차트를 띄운 채 창을 남긴다(프로브와 달리 exit 안 함).
// 백엔드(127.0.0.1:8010)가 떠 있어야 한다.
process.env.ATHENA_NO_AUTOSTART = '1';
// ATHENA_CANVAS_SOURCE를 설정하지 않는다 = live(실서버).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.open-live-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true })
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DATASET = {
  dataset_id: 'open-live-chart',
  question: '삼성전자 일봉 차트',
  operations: [{
    operation_ref: 'base:ka10081',
    args: { stk_cd: '005930', base_dt: '20260825', upd_stkpc_tp: '1' },
    caption: '삼성전자 일봉',
  }],
};

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  shellWin.focus();
  await wait(800);

  await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'rest-dataset', dataset: DATASET, expand: true })})`
  );
  await wait(5000);

  const state = await shellWin.webContents.executeJavaScript(`(() => {
    const s = window.__athenaChartProbe.snapshot()[0];
    return s ? { 종목: s.stock, 주기: s.period, TR: s.trId, 봉: s.candleCount } : null;
  })()`);
  // 실제로 떴다는 증거를 파일로 남긴다(파이프는 버퍼링돼 즉시 안 보인다).
  const img = await shellWin.webContents.capturePage();
  const shot = path.join(__dirname, 'captures', 'open-live-chart.png');
  fs.writeFileSync(shot, img.toPNG());
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'open-live-chart.json'),
    JSON.stringify({ state, shot }, null, 1)
  );
  console.log('[open] 차트 준비 완료:', JSON.stringify(state));
  console.log('[open] 창을 열어둔다 — 닫으면 종료된다.');
}

app.whenReady().then(main).catch((e) => { console.error('[open] 실패:', e); app.exit(1); });
