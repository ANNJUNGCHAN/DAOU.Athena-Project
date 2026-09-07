'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { captureRoot } = require('./lib/probe-captures');

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 700,
    height: 900,
    show: false,
    backgroundColor: '#EEF0F4',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  try {
    await win.loadFile(path.join(__dirname, 'hoga-live-fixture.html'));
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.__HOGA_LIVE_READY__) { clearInterval(timer); resolve(true); }
        else if (Date.now() - started > 3000) { clearInterval(timer); reject(new Error('hoga fixture timeout')); }
      }, 20);
    })`);

    const report = await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.card-kit-hoga-live');
      const ask1 = document.querySelector('[data-side="ask"][data-level="1"]');
      const bar = ask1 && ask1.querySelector('[data-role="bar"]');
      return {
        card: Boolean(card),
        rows: document.querySelectorAll('.card-kit-hoga-live-row').length,
        status: document.querySelector('[data-role="status"] span:nth-child(2)')?.textContent,
        currentPrice: document.querySelector('[data-role="current-price"]')?.textContent,
        expectedExecution: document.querySelector('[data-role="expected-execution"]')?.textContent,
        ask1Price: ask1?.querySelector('[data-role="price"]')?.textContent,
        ask1Quantity: ask1?.querySelector('[data-role="quantity"]')?.textContent,
        ask1BarWidth: bar?.style.width,
        stylesheet: document.querySelector('link[data-athena-hoga-live]')?.getAttribute('href'),
      };
    })()`);

    const expected = {
      card: true,
      rows: 20,
      status: '실시간',
      currentPrice: '88,100',
      expectedExecution: '예상체결 88,200 · 240주',
      ask1Price: '88,200',
      ask1Quantity: '1,320',
      stylesheet: './styles/card-kind-hoga.css',
    };
    for (const [key, value] of Object.entries(expected)) {
      if (report[key] !== value) throw new Error(`${key}: expected ${value}, got ${report[key]}`);
    }
    if (!report.ask1BarWidth || report.ask1BarWidth === '0%') throw new Error('ask1 bar did not move');

    const captures = captureRoot(__dirname);
    const image = await win.webContents.capturePage();
    const screenshotPath = path.join(captures, 'hoga-live.png');
    fs.writeFileSync(screenshotPath, image.toPNG());
    console.log(JSON.stringify({ ...report, screenshotPath }, null, 2));
  } finally {
    win.destroy();
    app.quit();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  app.exit(1);
});
