// 속도 실측 프로브(2026-08-26, US-003) — "삼성전자 호가"가 REST 직결
// fast-path(buildOrderBookDataset)로 모델을 안 거치고 도는지, 걸린 시간까지
// 재는 최소 프로브. probe-chart-fastpath.js와 같은 관례.
// 백엔드(127.0.0.1:8010)가 떠 있어야 한다. ATHENA_NO_AUTOSTART를 안 켠다
// (Kiwoom 종목명 인덱스가 있어야 "삼성전자"가 fast-path로 풀린다).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orderbook-fastpath-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const QUERY = process.argv[2] || '삼성전자 호가';

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  shellWin.focus();
  await wait(12000); // Kiwoom 종목명 인덱스 채워질 때까지 대기(관례)

  const startedAt = Date.now();
  const result = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'live', query: QUERY, expand: true })})`,
  );
  const elapsedMs = Date.now() - startedAt;

  const summary = {
    query: QUERY,
    elapsedMs,
    resultSource: result && result.source,
    resultOk: result && result.ok,
  };
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-orderbook-fastpath.json'),
    JSON.stringify(summary, null, 1),
  );
  console.log('[probe]', JSON.stringify(summary, null, 1));
  app.exit(result && result.ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
