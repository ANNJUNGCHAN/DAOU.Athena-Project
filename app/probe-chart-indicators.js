// CC-103 수동 실측 프로브 — 보조지표 패널(∿▾)·매물대가 실제로 동작하는지
// 확인한다("될 것이다"로 넘기지 않는다, CLAUDE.md §3). probe-chart-toolbar.js
// (CC-102)와 같은 성격 — 캔버스 창을 띄우고 addCard('chart')로 실제 카드를
// 만든 뒤, 패널·토글을 executeJavaScript로 직접 클릭해 DOM 상태 변화를 잰다.
//
// CC-102의 pane 분리 회귀(가격 pane을 비우는 순간 자동 정리되며 거래량 pane이
// 0으로 당겨지는 문제)와 같은 성격의 위험이 CC-103에도 있다 — RSI/MACD가 새
// pane을 추가·제거할 때 기존 가격(0)·거래량(1) pane 분리가 깨지지 않는지,
// 그리고 차트형식 전환(CC-102 회귀 지점) 이후에도 유지되는지 재단언한다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const PROBE_PROFILE = path.join(__dirname, '.probe-chart-indicators-profile');
fs.rmSync(PROBE_PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROBE_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROBE_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
app.setPath('userData', PROBE_PROFILE);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// probe-chart-toolbar.js MEASURE_PANES_JS와 같은 신호(행 위치가 구조 계약이다) —
// 여기서는 하단 지표(RSI·MACD)가 추가한 pane까지 포함해 인접한 모든 행 사이에
// 겹침이 없는지를 잰다.
const MEASURE_ALL_PANES_JS = `(() => {
  const card = document.querySelector('.card.chart');
  const rows = Array.from(card.querySelectorAll('.chart-price-pane table tr'))
    .map(tr => tr.getBoundingClientRect())
    .filter(r => r.height > 0);
  let maxOverlap = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const overlap = Math.max(0, Math.min(rows[i - 1].bottom, rows[i].bottom) - Math.max(rows[i - 1].top, rows[i].top));
    maxOverlap = Math.max(maxOverlap, overlap);
  }
  // 부동소수점 렌더 오차(실측: ~1.5e-5px, getBoundingClientRect subpixel) 허용 — 육안·실사용
  // 기준으로 겹침이 아닌 값까지 실패로 잡지 않는다. 1px 미만이면 분리로 본다.
  return { rowCount: rows.length, rowHeights: rows.map(r => Math.round(r.height)), maxOverlapPx: maxOverlap, noOverlap: maxOverlap < 1 };
})()`;

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin) throw new Error('shellWin을 못 찾았다');

  shellWin.show();
  await wait(400);

  await shellWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(1500); // createChartCard는 동적 import + 비동기 마운트

  const report = {};

  // ---- ① ∿ 클릭 → 패널 열림, 35종 노출 확인 ----
  report.panelOpen = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
    const disabledBefore = btn.disabled;
    btn.click();
    const panel = card.querySelector('.chart-indicator-panel');
    const rows = panel ? Array.from(panel.querySelectorAll('.chart-ind-row')) : [];
    const implementedRows = rows.filter(r => !r.classList.contains('is-unimplemented'));
    const unimplementedRows = rows.filter(r => r.classList.contains('is-unimplemented'));
    const badgeTexts = unimplementedRows.map(r => r.querySelector('.chart-ind-badge')?.textContent);
    const sectionTitles = panel ? Array.from(panel.querySelectorAll('.chart-ind-section-title')).map(s => s.textContent) : [];
    const defaultOnLabels = rows.filter(r => r.classList.contains('is-on')).map(r => r.querySelector('.chart-ind-label').textContent);
    const vpRow = panel ? panel.querySelector('.chart-ind-vp-row') : null;
    return {
      disabledBefore,
      panelPresent: !!panel,
      totalRows: rows.length,
      implementedCount: implementedRows.length,
      unimplementedCount: unimplementedRows.length,
      allUnimplementedBadged: badgeTexts.every(t => t === '미구현'),
      sectionTitles,
      defaultOnLabels,
      volumeProfileRowInFooter: !!vpRow && panel.querySelector('.chart-indicator-panel-footer').contains(vpRow),
      volumeProfileDefaultOff: vpRow ? !vpRow.classList.contains('is-on') : null,
    };
  })()`);
  await wait(150);
  const panelImg = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-103-indicators.png'), panelImg.toPNG());

  // ---- ② 볼린저 on(가격 pane 오버레이 — 새 pane 아님) ----
  report.bollOn = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-indicator-panel');
    const row = Array.from(panel.querySelectorAll('.chart-ind-row')).find(r => r.querySelector('.chart-ind-label').textContent === '볼린저');
    row.click();
    return { isOn: row.classList.contains('is-on'), ariaChecked: row.getAttribute('aria-checked') };
  })()`);
  await wait(200);
  report.paneSeparationAfterBoll = await shellWin.webContents.executeJavaScript(MEASURE_ALL_PANES_JS);

  // ---- ③ RSI on(하단 새 pane 추가) ----
  report.rsiOn = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-indicator-panel');
    const row = Array.from(panel.querySelectorAll('.chart-ind-row')).find(r => r.querySelector('.chart-ind-label').textContent === 'RSI');
    const rowCountBefore = Array.from(card.querySelectorAll('.chart-price-pane table tr')).filter(tr => tr.getBoundingClientRect().height > 0).length;
    row.click();
    return { isOn: row.classList.contains('is-on'), rowCountBefore };
  })()`);
  await wait(250);
  report.paneSeparationAfterRsi = await shellWin.webContents.executeJavaScript(MEASURE_ALL_PANES_JS);

  // ---- ④ 매물대 on(오버레이 존재 + POC 색) ----
  report.volumeProfileOn = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-indicator-panel');
    const vpRow = panel.querySelector('.chart-ind-vp-row');
    vpRow.click();
    return { isOn: vpRow.classList.contains('is-on') };
  })()`);
  await wait(300); // requestAnimationFrame 두 번(fitContent 이후 재계산) 여유
  report.volumeProfileOverlay = await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const overlay = card.querySelector('.chart-volume-profile-overlay');
    const bars = overlay ? Array.from(overlay.querySelectorAll('.chart-vp-bar')) : [];
    const pocBars = bars.filter(b => b.classList.contains('is-poc'));
    const displayed = overlay ? getComputedStyle(overlay).display !== 'none' : false;
    const pocColor = pocBars[0] ? getComputedStyle(pocBars[0]).backgroundColor : null;
    const normalColor = bars.find(b => !b.classList.contains('is-poc')) ? getComputedStyle(bars.find(b => !b.classList.contains('is-poc'))).backgroundColor : null;
    return { overlayPresent: !!overlay, displayed, barCount: bars.length, pocBarCount: pocBars.length, pocColor, normalColor };
  })()`);
  const vpImg = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-103-volume-profile.png'), vpImg.toPNG());

  // 패널 닫기(다음 검사 전 정리)
  await shellWin.webContents.executeJavaScript(`document.body.click()`);
  await wait(150);

  // ---- ⑤ 형식 전환(바→캔들) 후 pane overlap 0 재단언 — CC-102 회귀 지점 ----
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const formBtn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('▦'));
    formBtn.click();
  })()`);
  await wait(80);
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-toolbar-dropdown');
    const opt = panel && Array.from(panel.querySelectorAll('.chart-toolbar-dropdown-item')).find(b => b.textContent === '바');
    if (opt) opt.click();
  })()`);
  await wait(300);
  report.paneSeparationAfterFormSwitch = await shellWin.webContents.executeJavaScript(MEASURE_ALL_PANES_JS);

  fs.writeFileSync(
    path.join(CAPTURES, 'CC-103-probe-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf-8'
  );

  console.log('[probe] 리포트:', JSON.stringify(report, null, 2));
  console.log('[probe] 스크린샷:', path.join(CAPTURES, 'CC-103-indicators.png'), path.join(CAPTURES, 'CC-103-volume-profile.png'));

  const failures = [];
  if (report.panelOpen.disabledBefore) failures.push('∿ 버튼이 여전히 disabled다');
  if (report.panelOpen.totalRows !== 35) failures.push(`토글 행 수가 35가 아니다: ${report.panelOpen.totalRows}`);
  if (report.panelOpen.implementedCount !== 5) failures.push(`구현 행 수가 5가 아니다: ${report.panelOpen.implementedCount}`);
  if (!report.panelOpen.allUnimplementedBadged) failures.push('미구현 행에 "미구현" 배지가 없다');
  if (!report.bollOn.isOn) failures.push('볼린저 토글이 켜지지 않았다');
  if (!report.paneSeparationAfterBoll.noOverlap) failures.push('볼린저 on 후 pane 겹침 발생');
  if (!report.rsiOn.isOn) failures.push('RSI 토글이 켜지지 않았다');
  if (!report.paneSeparationAfterRsi.noOverlap) failures.push('RSI on 후 pane 겹침 발생');
  if (!report.volumeProfileOn.isOn) failures.push('매물대 토글이 켜지지 않았다');
  if (!report.volumeProfileOverlay.displayed || report.volumeProfileOverlay.barCount === 0) failures.push('매물대 오버레이가 렌더되지 않았다');
  if (report.volumeProfileOverlay.pocBarCount < 1) failures.push('POC 막대가 없다');
  if (report.volumeProfileOverlay.pocColor === report.volumeProfileOverlay.normalColor) failures.push('POC 색이 일반 막대와 구분되지 않는다');
  if (!report.paneSeparationAfterFormSwitch.noOverlap) failures.push('형식 전환 후 pane 겹침 발생(CC-102 회귀)');

  if (failures.length) {
    console.error('[probe] 실패:', failures.join(' / '));
    fs.writeFileSync(path.join(CAPTURES, 'CC-103-probe-error.log'), failures.join('\n'), 'utf-8');
    app.exit(1);
    return;
  }

  app.quit();
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[probe] 실패:', err);
  fs.writeFileSync(path.join(CAPTURES, 'CC-103-probe-error.log'), String(err && err.stack || err), 'utf-8');
  app.exit(1);
}));
