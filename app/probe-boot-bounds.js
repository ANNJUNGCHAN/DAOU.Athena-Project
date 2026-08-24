// 부팅 동안 대화 창 OS bounds가 단계별로 변하는지 실측하는 1회용 프로브.
// "세로 전개·창 확정도 채팅창과 같은 크기여야 한다"(2026-08-18 사용자 지시)의
// 앱 쪽 사실 확인용 — 50ms 간격으로 2.5초간 getBounds()를 표집한다.
process.env.ATHENA_NO_AUTOSTART = '1';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const main = require('./main.js');
  const t0 = Date.now();
  const samples = [];
  const created = main.createWindows();
  const timer = setInterval(() => {
    const { shellWin } = main.getWins();
    if (shellWin && !shellWin.isDestroyed()) {
      const b = shellWin.getBounds();
      const last = samples[samples.length - 1];
      if (!last || last.w !== b.width || last.h !== b.height) {
        samples.push({ t: Date.now() - t0, w: b.width, h: b.height, x: b.x, y: b.y });
      }
    }
  }, 50);
  await created;
  setTimeout(() => {
    clearInterval(timer);
    fs.writeFileSync(
      path.join(__dirname, 'captures', 'boot-bounds-probe.json'),
      JSON.stringify({ layout: main.getLayout(), samples }, null, 1)
    );
    app.quit();
  }, 2500);
});
