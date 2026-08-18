// 휘도 감지-적응 실측 프로브 (2026-08-19, 1회용) — 실제 데스크톱 위에서 샘플링
// 루프가 돌고, 두 렌더러의 유리 두께가 밝기에 반응해 갱신되는지를 확인한다.
// fixture가 아니므로(ATHENA_CANVAS_SOURCE 미설정) startBackdropSampling()이 돈다.
// 6.5초 대기(2초 주기 샘플 ~3회 + EMA 수렴) 후 CSS 변수 실측값을 저장하고 종료.
process.env.ATHENA_NO_AUTOSTART = '1';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const main = require('./main.js');
  await main.createWindows();
  await new Promise((r) => setTimeout(r, 6500));
  const { chatWin, canvasWin } = main.getWins();
  const chatVars = await chatWin.webContents.executeJavaScript(`(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      glassAlpha: s.getPropertyValue('--glass-alpha').trim(),
      appBg: getComputedStyle(document.querySelector('.app')).backgroundColor,
    };
  })()`);
  const canvasVars = await canvasWin.webContents.executeJavaScript(`(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      glassCanvasLive: s.getPropertyValue('--glass-canvas-live').trim(),
      mosaicBg: getComputedStyle(document.querySelector('.mosaic')).backgroundColor,
    };
  })()`);
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'backdrop-luma-probe.json'),
    JSON.stringify({ ranAt: new Date().toISOString(), chatVars, canvasVars }, null, 1)
  );
  app.quit();
});
