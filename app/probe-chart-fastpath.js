// S1 fast-path 결선 확인 프로브 — "삼성전자 차트 보여줘"가 모델을 안 거치고
// buildChartDataset → runDirectRestDataset로 직행해 실제 차트 카드를 그리는지,
// 걸린 시간까지 실측한다. 백엔드(127.0.0.1:8010)가 떠 있어야 한다.
// ATHENA_NO_AUTOSTART를 안 켠다 — 그 플래그는 부팅 시 Kiwoom 종목명 인덱스
// 갱신 블록 전체를 건너뛰게 만들어(main.js 하단 app.whenReady 블록)
// buildChartDataset이 늘 entity-miss로 폴백한다(실측). ensureBackend는
// 이미 뜬 백엔드를 헬스체크로 감지해 재기동하지 않으니 안전하다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-chart-fastpath-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const QUERY = process.argv[2] || '삼성전자 차트 보여줘';

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  shellWin.focus();
  // Kiwoom 종목명 인덱스는 부팅 후 백엔드 3개 시장 순차 조회(레이트리밋 대기 포함)로
  // 채워진다 — 그전에 쏘면 buildChartDataset이 늘 미스(entity 없음)한다. mdlog가
  // "인덱스 갱신" 완료를 콘솔에 찍으므로 넉넉히 기다린다.
  await wait(12000);

  const startedAt = Date.now();
  const result = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'live', query: QUERY, expand: true })})`,
  );
  const elapsedMs = Date.now() - startedAt;
  await wait(500);

  const state = await shellWin.webContents.executeJavaScript(`(() => {
    const s = window.__athenaChartProbe && window.__athenaChartProbe.snapshot()[0];
    return s ? { 종목: s.stock, 주기: s.period, TR: s.trId, 봉: s.candleCount } : null;
  })()`);

  const img = await shellWin.webContents.capturePage();
  const shot = path.join(__dirname, 'captures', 'probe-chart-fastpath.png');
  fs.writeFileSync(shot, img.toPNG());
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-chart-fastpath.json'),
    JSON.stringify({ query: QUERY, elapsedMs, result, chartState: state }, null, 1),
  );
  console.log('[probe] query:', QUERY);
  console.log('[probe] elapsedMs:', elapsedMs);
  console.log('[probe] result.source:', result && result.source);
  console.log('[probe] result.ok:', result && result.ok);
  console.log('[probe] chartState:', JSON.stringify(state));
  app.exit(result && result.ok && state ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
