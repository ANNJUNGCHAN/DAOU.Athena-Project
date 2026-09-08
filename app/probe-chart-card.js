process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const PROBE_PROFILE = path.join(__dirname, '.probe-chart-profile');
fs.rmSync(PROBE_PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROBE_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROBE_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
writeProbeModelPrefs(PROBE_PROFILE);
app.setPath('userData', PROBE_PROFILE);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin) throw new Error('shellWin을 못 찾았다 — getWins() 반환 형상 확인 필요');

  shellWin.show();
  await wait(400);

  const before = await shellWin.webContents.executeJavaScript(`document.querySelectorAll('.card').length`);

  // addCard는 canvas.js의 스크립트 전역 함수 — classic script라 window에 걸린다.
  await shellWin.webContents.executeJavaScript(`window.addCard('chart')`);
  // createChartCard는 동적 import + lightweight-charts 마운트라 비동기다. 카드
  // 개수(동기, makeCard가 즉시 DOM에 붙임)와 실제 캔버스 엘리먼트(비동기) 둘 다 잰다.
  await wait(1500);

  const report = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    if (!card) return { cardPresent: false };
    const canvases = card.querySelectorAll('canvas');
    const priceWrap = card.querySelector('.chart-price-pane');
    return {
      cardPresent: true,
      title: card.querySelector('.card-title') && card.querySelector('.card-title').textContent,
      canvasElementCount: canvases.length,
      priceWrapPresent: !!priceWrap,
      priceWrapRect: priceWrap ? priceWrap.getBoundingClientRect().toJSON() : null,
      errorNotePresent: !!card.querySelector('.uk-error'),
    };
  })()`);

  fs.writeFileSync(
    path.join(CAPTURES, 'CC-101-probe-report.json'),
    JSON.stringify({ before, after: report }, null, 2) + '\n',
    'utf-8'
  );

  const img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-101-chart-card.png'), img.toPNG());

  // 카드 닫기(destroy) 누수 확인 — 닫기 버튼 클릭 후 canvas 엘리먼트가 실제로 사라지는지.
  await shellWin.webContents.executeJavaScript(`document.querySelector('.card.chart .uk-card-close').click()`);
  await wait(300);
  const afterClose = await shellWin.webContents.executeJavaScript(`({
    cardStillPresent: !!document.querySelector('.card.chart'),
    canvasNodesRemaining: document.querySelectorAll('.card.chart canvas').length,
  })`);

  console.log('[probe] before:', before, 'after:', JSON.stringify(report));
  console.log('[probe] afterClose:', JSON.stringify(afterClose));
  console.log('[probe] 스크린샷:', path.join(CAPTURES, 'CC-101-chart-card.png'));

  fs.writeFileSync(
    path.join(CAPTURES, 'CC-101-probe-report.json'),
    JSON.stringify({ before, after: report, afterClose }, null, 2) + '\n',
    'utf-8'
  );

  app.quit();
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[probe] 실패:', err);
  fs.writeFileSync(path.join(CAPTURES, 'CC-101-probe-error.log'), String(err && err.stack || err), 'utf-8');
  app.exit(1);
}));
