'use strict';

// CC-104 수동 실측 프로브 — 저작 상태 영속(종목×주기 키)이 실제로 동작하는지
// 확인한다("될 것이다"로 넘기지 않는다). 시나리오는 PRD CC-104 수용 기준 그대로:
//   일봉에서 볼린저 on · 형식 바 · 매물대 on
//   → 주봉 전환(독립 상태 — 매물대 off·형식 캔들로 바꿔 차이를 만든다)
//   → 일봉 복귀 → 3가지(볼린저·형식·매물대) 전부 복원 단언.
// localStorage(chart.authoring.005930.D / .W) 실제 키·값도 함께 검증한다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const PROBE_PROFILE = path.join(__dirname, '.probe-chart-authoring-profile');
fs.rmSync(PROBE_PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROBE_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROBE_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
app.setPath('userData', PROBE_PROFILE);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function clickIndicatorPanelButton(shellWin) {
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
    btn.click();
  })()`);
  await wait(120);
}

async function clickPanelRow(shellWin, label) {
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-indicator-panel');
    const row = Array.from(panel.querySelectorAll('.chart-ind-row')).find(r => r.querySelector('.chart-ind-label').textContent === ${JSON.stringify(label)});
    row.click();
  })()`);
  await wait(200);
}

async function clickVpRow(shellWin) {
  await shellWin.webContents.executeJavaScript(`(() => {
    document.querySelector('.card.chart .chart-ind-vp-row').click();
  })()`);
  await wait(250);
}

async function closePanel(shellWin) {
  await shellWin.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await wait(120);
}

async function selectChartForm(shellWin, label) {
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const formBtn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('▦'));
    formBtn.click();
  })()`);
  await wait(80);
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-toolbar-dropdown');
    const opt = panel && Array.from(panel.querySelectorAll('.chart-toolbar-dropdown-item')).find(b => b.textContent === ${JSON.stringify(label)});
    if (opt) opt.click();
  })()`);
  await wait(250);
}

async function clickPeriodTab(shellWin, label) {
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const tab = Array.from(card.querySelectorAll('.chart-toolbar-tab')).find(b => b.textContent === ${JSON.stringify(label)});
    tab.click();
  })()`);
  await wait(300);
}

// 현재 카드의 저작 관련 실측 스냅샷 — 패널을 열어 행 체크 상태를 읽고 다시 닫는다.
const READ_STATE_JS = `(async () => {
  const card = document.querySelector('.card.chart');
  const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
  btn.click();
  await new Promise(r => setTimeout(r, 120));
  let panel = card.querySelector('.chart-indicator-panel');
  if (!panel) { // 직전 드롭다운 닫힘과 경합하면 첫 클릭이 소모될 수 있다 — 한 번 더
    btn.click();
    await new Promise(r => setTimeout(r, 120));
    panel = card.querySelector('.chart-indicator-panel');
  }
  const bollRow = Array.from(panel.querySelectorAll('.chart-ind-row')).find(r => r.querySelector('.chart-ind-label').textContent === '볼린저');
  const vpRow = panel.querySelector('.chart-ind-vp-row');
  const state = {
    bollChecked: bollRow.getAttribute('aria-checked') === 'true',
    vpChecked: vpRow.getAttribute('aria-checked') === 'true',
  };
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await new Promise(r => setTimeout(r, 80));
  const overlay = card.querySelector('.chart-volume-profile-overlay');
  state.vpOverlayDisplayed = !!overlay && getComputedStyle(overlay).display !== 'none' && overlay.children.length > 0;
  state.storedD = localStorage.getItem('chart.authoring.005930.D');
  state.storedW = localStorage.getItem('chart.authoring.005930.W');
  return state;
})()`;

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin) throw new Error('shellWin을 못 찾았다');

  shellWin.show();
  await wait(400);

  // 이전 실행 잔여 상태 제거 — 프로브는 결정적이어야 한다.
  await shellWin.webContents.executeJavaScript(`(() => {
    const del = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('chart.authoring.')) del.push(k);
    }
    del.forEach(k => localStorage.removeItem(k));
    return del.length;
  })()`);

  await shellWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(1500);

  const report = {};
  let step = 'init';
  const mark = (s) => { step = s; console.log('[probe-authoring] step:', s); };

  try {
    // ---- ① 일봉에서 저작: 볼린저 on · 형식 바 · 매물대 on ----
    mark('D:패널 열기'); await clickIndicatorPanelButton(shellWin);
    mark('D:볼린저 on'); await clickPanelRow(shellWin, '볼린저');
    mark('D:매물대 on'); await clickVpRow(shellWin);
    mark('D:패널 닫기'); await closePanel(shellWin);
    mark('D:형식 바'); await selectChartForm(shellWin, '바');
    mark('D:상태 읽기'); report.afterAuthoringOnD = await shellWin.webContents.executeJavaScript(READ_STATE_JS);

    // ---- ② 주봉 전환 — 독립 상태를 만든다(매물대 off·형식 캔들) ----
    mark('W:주 탭'); await clickPeriodTab(shellWin, '주');
    mark('W:패널 열기'); await clickIndicatorPanelButton(shellWin);
    mark('W:매물대 off'); await clickVpRow(shellWin);
    mark('W:패널 닫기'); await closePanel(shellWin);
    mark('W:형식 캔들'); await selectChartForm(shellWin, '캔들');
    mark('W:상태 읽기'); report.afterChangesOnW = await shellWin.webContents.executeJavaScript(READ_STATE_JS);

    // ---- ③ 일봉 복귀 — 3종 복원 단언 ----
    mark('D복귀:일 탭'); await clickPeriodTab(shellWin, '일');
    mark('D복귀:상태 읽기'); report.afterReturnToD = await shellWin.webContents.executeJavaScript(READ_STATE_JS);
  } catch (err) {
    console.error(`[probe-authoring] 단계 "${step}"에서 실패:`, err && err.message);
    throw err;
  }

  const d = report.afterReturnToD;
  const storedD = d.storedD ? JSON.parse(d.storedD) : null;
  const storedW = report.afterChangesOnW.storedW ? JSON.parse(report.afterChangesOnW.storedW) : null;
  report.assertions = {
    dBollRestored: d.bollChecked === true,
    dVpRestored: d.vpChecked === true && d.vpOverlayDisplayed === true,
    dFormRestored: !!storedD && storedD.form === 'bar',
    wIndependent: !!storedW && storedW.volumeProfileOn === false && storedW.form === 'candle',
    storageKeysExist: !!d.storedD && !!d.storedW,
  };
  report.pass = Object.values(report.assertions).every(Boolean);

  await wait(300);
  const img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-104-restore.png'), img.toPNG());
  fs.writeFileSync(path.join(CAPTURES, 'CC-104-probe-report.json'), JSON.stringify(report, null, 2), 'utf-8');

  console.log('[probe-authoring] pass =', report.pass, JSON.stringify(report.assertions));
  app.exit(report.pass ? 0 : 1);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[probe-authoring] 실패:', err);
    app.exit(1);
  });
});
