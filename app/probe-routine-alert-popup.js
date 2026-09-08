'use strict';

// Isolated renderer check: no backend, user profile, or live alarm writes.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { captureRoot } = require('./lib/probe-captures');

app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'athena-alert-probe-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 900, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const run = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadURL('about:blank');
    win.showInactive();
    for (const file of ['styles/tokens.css', 'styles/ui-kit.css', 'shell.css', 'styles/access.css']) {
      await win.webContents.insertCSS(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    }
    await run(`document.body.innerHTML = '<main style="padding:48px;font-family:Segoe UI,sans-serif;color:#676776"><h1>알람 표시 검증</h1><p>실제 알람이 아닌 화면 검증용 데이터입니다.</p><input id="draft" aria-label="작성 중인 메시지" value="작성 중인 메시지"></main>'; document.getElementById('draft').focus();`);
    await run(fs.readFileSync(path.join(__dirname, 'lib/routine-alert-popup.js'), 'utf8'));
    await run(`window.opened = []; window.popup = window.AthenaLib.RoutineAlertPopup.createRoutineAlertPopup({ document, onOpen: id => opened.push(id) });
      popup.show({ id: 'fixture-volume', title: '삼성전자 전일 대비 거래량 2배 이상 급등 시 알림', sub: '화면 검증용 예시 · 005930 · 관측 2.1', firedAt: Date.now() });`);
    const selector = '.routine-alert-popup';
    const measure = () => run(`(() => { const el = document.querySelector('${selector}'); const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,focus:document.activeElement.id,text:el.textContent }; })()`);
    const wide = await measure();
    assert.ok(wide.width >= 400 && wide.width <= 480, JSON.stringify(wide));
    assert.ok(wide.height >= 160 && wide.height < 450, JSON.stringify(wide));
    assert.equal(wide.focus, 'draft', 'Arrival must preserve typing focus');
    const root = captureRoot(__dirname);
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(root, 'routine-alert-popup-wide.png'), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(400, 600);
    await run(`popup.show({ id:'fixture-next', title:'두 번째 알람 — 긴 제목 '.repeat(12), sub:'검증용 데이터', firedAt:Date.now() }); popup.dismiss();`);
    const narrow = await measure();
    assert.ok(narrow.x >= 0 && narrow.right <= narrow.viewportWidth && narrow.bottom <= narrow.viewportHeight, JSON.stringify(narrow));
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(root, 'routine-alert-popup-narrow.png'), (await win.webContents.capturePage()).toPNG());
    await run(`Array.from(document.querySelectorAll('${selector} button')).find(b => b.textContent.includes('알람 확인')).click()`);
    assert.deepEqual(await run('opened'), ['fixture-next'], 'Dismiss must not acknowledge the first alarm');
    console.log(JSON.stringify({ ok:true, wide, narrow, captures:root }));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
