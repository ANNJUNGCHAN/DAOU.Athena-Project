// 임시 시연 런처 — 차트 카드를 띄운 채 창을 남긴다(프로브와 달리 exit 안 함).
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.show-chart-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true })
);
app.setPath('userData', PROFILE);

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin) throw new Error('shellWin을 못 찾았다');
  shellWin.show();
  shellWin.focus();
  await wait(600);

  await shellWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(5000);

  // ① 캔들만 — 패널이 가리기 전 상태
  let img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'show-chart-1-candles.png'), img.toPNG());

  // ② 지표를 몇 개 켠다 — 이번에 새로 구현된 것들
  const turnedOn = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
    if (btn) btn.click();
    const panel = card.querySelector('.chart-indicator-panel');
    const want = ['일목균형표', '파라볼릭 SAR', '슈퍼트렌드', '엔벨로프', '스토캐스틱', 'CCI'];
    const done = [];
    for (const label of want) {
      const row = Array.from(panel.querySelectorAll('.chart-ind-row'))
        .find(r => r.querySelector('.chart-ind-label').textContent === label);
      if (row && !row.classList.contains('is-unimplemented') && !row.classList.contains('is-on')) {
        row.click();
        done.push(label);
      }
    }
    return done;
  })()`);
  await wait(2500);
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'show-chart-2-panel.png'), img.toPNG());

  // ③ 패널을 닫아 지표가 그려진 차트 자체를 보여준다
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
    if (btn) btn.click();
    return true;
  })()`);
  await wait(1500);
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'show-chart-3-drawn.png'), img.toPNG());

  console.log('[show] 켠 지표:', JSON.stringify(turnedOn));
  console.log('[show] 창 띄움 — 캡처 3장 captures/show-chart-*.png');
}

app.whenReady().then(main).catch((err) => {
  console.error('[show] 실패:', err);
  app.exit(1);
});
