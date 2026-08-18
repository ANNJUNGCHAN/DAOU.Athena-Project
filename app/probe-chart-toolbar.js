// CC-102 수동 실측 프로브 — 툴바가 실제로 동작하는지 확인한다("될 것이다"로
// 넘기지 않는다, CLAUDE.md §3). probe-chart-card.js(CC-101)와 같은 성격 —
// 캔버스 창을 띄우고 addCard('chart')로 실제 카드를 만든 뒤, 툴바 버튼을
// executeJavaScript로 직접 클릭해 DOM 상태 변화를 잰다.
//
// 2026-08-18 팀 리드 검수 결함 1건 재발 방지: 차트모양 전환(형식 재생성) 후
// 거래량이 가격 pane과 겹쳐 그려지는 회귀가 있었다(lightweight-charts가 가격
// pane을 비우는 순간 빈 pane을 자동 정리해 거래량 pane이 0으로 당겨짐 — 원인은
// lib/chart-card.js buildPriceSeries 주석 참고). 이 프로브는 4형식(바·캔들·
// 라인·영역) 전부에서 가격 pane과 거래량 pane이 실제로 DOM 상에서 겹치지 않는지
// (row 높이·경계) 단언한다 — 재발하면 이 프로브가 실패해야 한다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const PROBE_PROFILE = path.join(__dirname, '.probe-chart-toolbar-profile');
fs.rmSync(PROBE_PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROBE_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROBE_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
app.setPath('userData', PROBE_PROFILE);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// lightweight-charts는 pane마다 <table><tr> 행을 하나씩 쓴다(실측:
// 1회성 진단 프로브로 확인 — 항상 4행: [가격 pane, 1px 구분선, 거래량 pane,
// 시간축]). 처음엔 거래량 pane 높이를 setHeight(80) 그대로의 고정 픽셀 범위
// (70~90px)로 식별하려 했는데, 실측해보니 setHeight()는 절대 픽셀이 아니라
// 상대 스트레치 비율이었다 — 전체화면처럼 컨테이너가 커지면 거래량 pane도
// 비례해서 커진다(80/221 ≈ 163/449, 같은 비율, 실측 확인). 그래서 높이 범위가
// 아니라 **행 위치**(rows[0]=가격, rows[2]=거래량)로 식별한다 — 구조 자체가
// pane 분리 계약이라 위치가 더 안정적인 신호다.
const MEASURE_PANES_JS = `(() => {
  const card = document.querySelector('.card.chart');
  const rows = Array.from(card.querySelectorAll('.chart-price-pane table tr'))
    .map(tr => tr.getBoundingClientRect())
    .filter(r => r.height > 0);
  const priceRow = rows[0] || null;
  const volumeRow = rows[2] || null;
  const overlapPx = (priceRow && volumeRow)
    ? Math.max(0, Math.min(priceRow.bottom, volumeRow.bottom) - Math.max(priceRow.top, volumeRow.top))
    : null;
  return {
    rowCount: rows.length,
    rowHeights: rows.map(r => Math.round(r.height)),
    volumeRowFound: !!volumeRow,
    priceRowFound: !!priceRow,
    overlapPx,
    separated: rows.length === 4 && !!priceRow && !!volumeRow && overlapPx === 0,
  };
})()`;

async function selectChartForm(canvasWin, label) {
  await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const formBtn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('▦'));
    formBtn.click();
  })()`);
  await wait(80);
  await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-toolbar-dropdown');
    const opt = panel && Array.from(panel.querySelectorAll('.chart-toolbar-dropdown-item')).find(b => b.textContent === ${JSON.stringify(label)});
    if (opt) opt.click();
  })()`);
  await wait(250); // lightweight-charts 시리즈 재생성 + 재측정 안정화
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { canvasWin } = mainMod.getWins();
  if (!canvasWin) throw new Error('canvasWin을 못 찾았다');

  canvasWin.show();
  await wait(400);

  await canvasWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(1500); // createChartCard는 동적 import + 비동기 마운트

  const report = {};

  // ---- 기본 상태(캔들·일봉) 스크린샷 — 전환 실험 전에 먼저 뜬다 ----
  const toolbarImg = await canvasWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-102-toolbar.png'), toolbarImg.toPNG());

  // ---- ① 주기 탭: 일→주 전환 시 활성 탭이 바뀐다 ----
  report.periodSwitch = await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const tabs = Array.from(card.querySelectorAll('.chart-toolbar-tab'));
    const dayTab = tabs.find(b => b.textContent === '일');
    const weekTab = tabs.find(b => b.textContent === '주');
    const before = { activeLabel: tabs.find(b => b.classList.contains('is-active'))?.textContent };
    weekTab.click();
    const afterActive = tabs.find(b => b.classList.contains('is-active'))?.textContent;
    return { before, afterActive, weekTabPresent: !!weekTab, dayTabPresent: !!dayTab };
  })()`);
  await wait(200);

  // 세분 드롭다운 — 분 탭으로 전환하면 세분 버튼이 나타나야 한다.
  report.intervalDropdown = await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const tabs = Array.from(card.querySelectorAll('.chart-toolbar-tab'));
    const minTab = tabs.find(b => b.textContent === '분');
    minTab.click();
    const intervalBtn = card.querySelector('.chart-toolbar-interval');
    const hiddenBeforeClick = intervalBtn.hidden;
    const labelAfterMinuteSelect = intervalBtn.textContent;
    intervalBtn.click();
    const panel = card.querySelector('.chart-toolbar-dropdown');
    const optionLabels = panel ? Array.from(panel.querySelectorAll('.chart-toolbar-dropdown-item')).map(b => b.textContent) : [];
    const opt3 = panel && Array.from(panel.querySelectorAll('.chart-toolbar-dropdown-item')).find(b => b.textContent === '3분');
    if (opt3) opt3.click();
    const labelAfterSelect3 = intervalBtn.textContent;
    return { hiddenBeforeClick, labelAfterMinuteSelect, optionLabels, labelAfterSelect3 };
  })()`);
  await wait(200);

  // 일봉으로 복귀(다음 검사를 위해)
  await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const dayTab = Array.from(card.querySelectorAll('.chart-toolbar-tab')).find(b => b.textContent === '일');
    dayTab.click();
  })()`);
  await wait(200);

  // ---- ② 차트모양 드롭다운: 4종 라벨 확인 + 형식마다 가격/거래량 pane 분리 유지 ----
  report.formLabels = await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const formBtn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('▦'));
    formBtn.click();
    const panel = card.querySelector('.chart-toolbar-dropdown');
    const labels = panel ? Array.from(panel.querySelectorAll('.chart-toolbar-dropdown-item')).map(b => b.textContent) : [];
    panel.querySelector('.chart-toolbar-dropdown-item')?.blur();
    document.body.click(); // 드롭다운 닫기(측정만 하고 선택은 안 함)
    return labels;
  })()`);
  await wait(150);

  report.paneSeparationByForm = {};
  for (const label of ['바', '캔들', '라인', '영역']) {
    await selectChartForm(canvasWin, label);
    const measured = await canvasWin.webContents.executeJavaScript(MEASURE_PANES_JS);
    report.paneSeparationByForm[label] = measured;
    if (label === '라인') {
      const lineImg = await canvasWin.webContents.capturePage();
      fs.writeFileSync(path.join(CAPTURES, 'CC-102-form-line.png'), lineImg.toPNG());
    }
  }
  // 캔들(기본값)로 복귀 — 이후 검사(전체화면 캡처 등)는 기본 상태로 한다.
  await selectChartForm(canvasWin, '캔들');

  // ---- ③ 수정주가 토글 ----
  report.adjustedToggle = await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const btn = card.querySelector('.chart-toolbar-adjusted');
    const before = btn.textContent;
    const noteBefore = card.querySelector('.chart-mock-note').textContent;
    btn.click();
    const after = btn.textContent;
    return { before, after, noteBefore, notePresent: !!noteBefore.length };
  })()`);
  await wait(200);
  // 수정주가 원상복귀(기본 on)
  await canvasWin.webContents.executeJavaScript(`document.querySelector('.card.chart .chart-toolbar-adjusted').click()`);
  await wait(150);

  // ---- ④ 전체화면 진입/복귀(캔들·일봉 기본 상태에서) ----
  report.fullscreen = await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const grid = document.getElementById('grid');
    const fsBtn = card.querySelector('.chart-toolbar-fullscreen');
    const beforeExpanded = card.classList.contains('is-expanded');
    const beforeLabel = fsBtn.textContent;
    fsBtn.click();
    const afterEnterExpanded = card.classList.contains('is-expanded');
    const afterEnterGridHasExpanded = grid.classList.contains('has-expanded');
    const afterEnterLabel = fsBtn.textContent;
    return { beforeExpanded, beforeLabel, afterEnterExpanded, afterEnterGridHasExpanded, afterEnterLabel };
  })()`);
  await wait(300);
  report.fullscreenPaneSeparation = await canvasWin.webContents.executeJavaScript(MEASURE_PANES_JS);
  const fsImg = await canvasWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-102-fullscreen.png'), fsImg.toPNG());

  report.fullscreenExit = await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const grid = document.getElementById('grid');
    const fsBtn = card.querySelector('.chart-toolbar-fullscreen');
    fsBtn.click();
    return {
      afterExitExpanded: card.classList.contains('is-expanded'),
      afterExitGridHasExpanded: grid.classList.contains('has-expanded'),
      afterExitLabel: fsBtn.textContent,
    };
  })()`);
  await wait(300);

  fs.writeFileSync(
    path.join(CAPTURES, 'CC-102-probe-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf-8'
  );

  console.log('[probe] 리포트:', JSON.stringify(report, null, 2));
  console.log('[probe] 스크린샷:', path.join(CAPTURES, 'CC-102-toolbar.png'), path.join(CAPTURES, 'CC-102-form-line.png'), path.join(CAPTURES, 'CC-102-fullscreen.png'));

  const allSeparated = ['바', '캔들', '라인', '영역'].every((l) => report.paneSeparationByForm[l] && report.paneSeparationByForm[l].separated);
  if (!allSeparated || !report.fullscreenPaneSeparation.separated) {
    console.error('[probe] 실패 — 거래량/가격 pane이 겹치는 형식이 있다:', JSON.stringify(report.paneSeparationByForm));
    fs.writeFileSync(path.join(CAPTURES, 'CC-102-probe-error.log'), 'pane 분리 단언 실패 — CC-102-probe-report.json 참고', 'utf-8');
    app.exit(1);
    return;
  }

  app.quit();
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[probe] 실패:', err);
  fs.writeFileSync(path.join(CAPTURES, 'CC-102-probe-error.log'), String(err && err.stack || err), 'utf-8');
  app.exit(1);
}));
