'use strict';

// CC-105 수동 실측 프로브 — 드로잉 1판(수평선·추세선, 확장 모드 게이트).
// 실제 마우스 입력(webContents.sendInputEvent)으로 차트 캔버스를 클릭한다 —
// lightweight-charts subscribeClick은 합성 DOM click()이 아니라 실 포인터
// 이벤트에만 반응한다(실측).
// 단언: ① 축소 상태에선 도구바 비노출 ② 확장 시 노출(구현 2·미구현 5 비활성)
// ③ 수평선 1클릭 저장 ④ 추세선 2클릭 → SVG 세그먼트 + 저장 ⑤ 복귀 시 도구바
// 숨김·미완성 점 폐기·저장 목록 보존(localStorage drawings).
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const PROBE_PROFILE = path.join(__dirname, '.probe-chart-drawing-profile');
fs.rmSync(PROBE_PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROBE_PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROBE_PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }, null, 2),
  'utf-8'
);
app.setPath('userData', PROBE_PROFILE);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function realClick(canvasWin, x, y) {
  // lightweight-charts의 클릭 판정은 직전 포인터 위치 상태에 민감하다(실측:
  // move 없이 down을 다른 좌표로 보내면 두 번째 클릭이 드래그로 해석돼 click
  // 콜백이 안 온다). down 전에 해당 좌표로 move를 먼저 보낸다.
  canvasWin.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  await wait(80);
  canvasWin.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await wait(50);
  canvasWin.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await wait(300);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { canvasWin } = mainMod.getWins();
  if (!canvasWin) throw new Error('canvasWin을 못 찾았다');

  canvasWin.show();
  await wait(400);

  await canvasWin.webContents.executeJavaScript(`(() => {
    const del = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('chart.authoring.')) del.push(k);
    }
    del.forEach(k => localStorage.removeItem(k));
  })()`);

  await canvasWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(1500);

  const report = {};
  let step = 'init';
  const mark = (s) => { step = s; console.log('[probe-drawing] step:', s); };
  canvasWin.webContents.on('console-message', (e, level, message) => {
    if (level >= 2) console.log('[renderer]', message);
  });

  mark('collapsed');
  // ---- ① 축소 상태 — 도구바 비노출 ----
  report.collapsed = await canvasWin.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('.card.chart .chart-drawbar');
    return { barPresent: !!bar, barVisible: bar ? getComputedStyle(bar).display !== 'none' : null };
  })()`);

  mark('expand');
  // ---- ② 확장 — 도구바 노출·구성 ----
  await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('⛶')).click();
  })()`);
  await wait(500);
  report.expanded = await canvasWin.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('.card.chart .chart-drawbar');
    const btns = Array.from(bar.querySelectorAll('.chart-drawbar-btn'));
    return {
      barVisible: getComputedStyle(bar).display !== 'none',
      total: btns.length,
      disabledCount: btns.filter(b => b.disabled).length,
      enabledCount: btns.filter(b => !b.disabled).length,
    };
  })()`);

  // 차트 영역 중심 좌표(창 기준) — 실 클릭 좌표.
  const rect = await canvasWin.webContents.executeJavaScript(`(() => {
    const r = document.querySelector('.card.chart .chart-price-pane').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  const cx = Math.round(rect.x + rect.w * 0.45);
  const cy = Math.round(rect.y + rect.h * 0.5);

  mark('hline');
  // ---- ③ 수평선 — 도구 선택 + 1 실클릭 ----
  await canvasWin.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('.card.chart .chart-drawbar');
    Array.from(bar.querySelectorAll('.chart-drawbar-btn')).find(b => b.textContent === '—').click();
  })()`);
  await wait(120);
  await realClick(canvasWin, cx, cy);
  report.hline = await canvasWin.webContents.executeJavaScript(`(() => {
    const stored = JSON.parse(localStorage.getItem('chart.authoring.005930.D') || 'null');
    return { hlineCount: stored && stored.drawings ? stored.drawings.hlines.length : 0 };
  })()`);

  await canvasWin.webContents.executeJavaScript('window.__drawDebug = []');
  mark('trend');
  // ---- ④ 추세선 — 도구 선택 + 2 실클릭 ----
  await canvasWin.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('.card.chart .chart-drawbar');
    Array.from(bar.querySelectorAll('.chart-drawbar-btn')).find(b => b.textContent === '/').click();
  })()`);
  await wait(120);
  await realClick(canvasWin, Math.round(rect.x + rect.w * 0.25), Math.round(rect.y + rect.h * 0.6));
  await realClick(canvasWin, Math.round(rect.x + rect.w * 0.7), Math.round(rect.y + rect.h * 0.35));
  report.trend = await canvasWin.webContents.executeJavaScript(`(() => {
    const stored = JSON.parse(localStorage.getItem('chart.authoring.005930.D') || 'null');
    const svgLines = document.querySelectorAll('.card.chart .chart-draw-svg line').length;
    return { lineCount: stored && stored.drawings ? stored.drawings.lines.length : 0, svgLines, debug: window.__drawDebug };
  })()`);

  await wait(200);
  const img = await canvasWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-105-drawing.png'), img.toPNG());

  mark('exit');
  // ---- ⑤ 복귀 — 도구바 숨김·저장 보존 ----
  await canvasWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('✕')).click();
  })()`);
  await wait(400);
  report.afterExit = await canvasWin.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('.card.chart .chart-drawbar');
    const stored = JSON.parse(localStorage.getItem('chart.authoring.005930.D') || 'null');
    return {
      barVisible: getComputedStyle(bar).display !== 'none',
      hlinePreserved: stored.drawings.hlines.length,
      linePreserved: stored.drawings.lines.length,
      svgLinesStillRendered: document.querySelectorAll('.card.chart .chart-draw-svg line').length,
    };
  })()`);

  report.assertions = {
    collapsedHidden: report.collapsed.barVisible === false,
    expandedVisible: report.expanded.barVisible === true && report.expanded.total === 7
      && report.expanded.enabledCount === 2 && report.expanded.disabledCount === 5,
    hlineSaved: report.hline.hlineCount === 1,
    trendSavedAndRendered: report.trend.lineCount === 1 && report.trend.svgLines >= 1,
    exitPreserves: report.afterExit.barVisible === false
      && report.afterExit.hlinePreserved === 1 && report.afterExit.linePreserved === 1,
  };
  report.pass = Object.values(report.assertions).every(Boolean);

  fs.writeFileSync(path.join(CAPTURES, 'CC-105-probe-report.json'), JSON.stringify(report, null, 2), 'utf-8');
  console.log('[probe-drawing] pass =', report.pass, JSON.stringify(report.assertions));
  app.exit(report.pass ? 0 : 1);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[probe-drawing] 실패:', err && err.message);
    app.exit(1);
  });
});
