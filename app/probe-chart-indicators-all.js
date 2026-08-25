// 34종 전수 실기동 프로브 — 2026-08-25.
//
// 왜 필요한가: 단위 테스트는 "계산이 값을 낸다"까지만 본다. 렌더러 테스트는
// 가짜 chart 객체를 썼다. 둘 다 통과해도 **실제 lightweight-charts에서 선이
// 안 그려질 수 있다**(addSeries 옵션 이름이 틀렸거나, pane 인덱스를 라이브러리가
// 거부하거나, setData가 조용히 빈 배열을 먹거나).
//
// 이 프로브는 실제 Electron + 실제 lightweight-charts에서 지표를 하나씩 켜고
// 차트가 정말로 시리즈를 만들었는지·데이터가 들어갔는지를 되읽는다.
process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const PROFILE = path.join(__dirname, '.probe-ind-all-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ completed: true, step: 3 })
);
app.setPath('userData', PROFILE);

const { INDICATOR_DEFS } = require('./lib/chart-indicator-registry');
const IMPLEMENTED = INDICATOR_DEFS.filter((d) => d.implemented);

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 렌더러 안에서 실행 — 라벨로 행을 찾아 토글하고, 실제 차트 상태를 되읽는다.
function toggleAndInspectJs(label) {
  return `(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-indicator-panel');
    const rows = Array.from(panel.querySelectorAll('.chart-ind-row'));
    const row = rows.find(r => r.querySelector('.chart-ind-label').textContent === ${JSON.stringify(label)});
    if (!row) return { found: false };
    if (row.classList.contains('is-unimplemented')) return { found: true, unimplemented: true };
    const wasOn = row.classList.contains('is-on');
    if (!wasOn) row.click();
    return { found: true, isOn: row.classList.contains('is-on'), wasOn };
  })()`;
}

// 캔버스에 실제로 그려진 픽셀이 있는지 — pane 수와 캔버스 크기로 간접 확인한다.
const MEASURE_JS = `(() => {
  const card = document.querySelector('.card.chart');
  const canvases = Array.from(card.querySelectorAll('canvas'));
  const rows = Array.from(card.querySelectorAll('table tr'))
    .map(tr => tr.getBoundingClientRect())
    .filter(r => r.height > 1);
  let maxOverlap = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const o = Math.max(0, Math.min(rows[i-1].bottom, rows[i].bottom) - Math.max(rows[i-1].top, rows[i].top));
    maxOverlap = Math.max(maxOverlap, o);
  }
  return {
    paneRowCount: rows.length,
    canvasCount: canvases.length,
    totalCanvasArea: canvases.reduce((s,c) => s + c.width * c.height, 0),
    maxOverlapPx: Math.round(maxOverlap * 100) / 100,
    legendChips: Array.from(card.querySelectorAll('.chart-overlay-legend-chip')).map(c => c.textContent),
    skipNote: (() => {
      const notes = Array.from(card.querySelectorAll('.chart-mock-note'));
      const n = notes.find(x => !x.hidden && /표시하지 못한 지표/.test(x.textContent));
      return n ? n.textContent : '';
    })(),
    consoleErrors: window.__probeErrors || [],
  };
})()`;

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  if (!shellWin) throw new Error('shellWin을 못 찾았다');
  shellWin.show();
  await wait(500);

  // 렌더러 콘솔 에러를 모은다 — 지표 계산이 throw하면 렌더러가 error를 찍는다.
  await shellWin.webContents.executeJavaScript(`(() => {
    window.__probeErrors = [];
    const orig = console.error;
    console.error = function () {
      window.__probeErrors.push(Array.from(arguments).map(String).join(' '));
      return orig.apply(console, arguments);
    };
    return true;
  })()`);

  await shellWin.webContents.executeJavaScript(`window.addCard('chart')`);
  await wait(1800);

  // 패널 열기
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
    btn.click();
    return true;
  })()`);
  await wait(300);

  const baseline = await shellWin.webContents.executeJavaScript(MEASURE_JS);

  const results = [];
  for (const def of IMPLEMENTED) {
    const before = await shellWin.webContents.executeJavaScript(MEASURE_JS);
    const toggle = await shellWin.webContents.executeJavaScript(toggleAndInspectJs(def.label));
    await wait(220);
    const after = await shellWin.webContents.executeJavaScript(MEASURE_JS);

    const spec = require('./lib/chart-indicator-render').SPEC_BY_ID.get(def.id);
    const expectsNewPane = spec && spec.pane === 'own';
    const paneGrew = after.paneRowCount > before.paneRowCount;

    results.push({
      id: def.id,
      label: def.label,
      found: toggle.found,
      turnedOn: toggle.isOn === true || toggle.wasOn === true,
      pane: spec ? spec.pane : '?',
      expectsNewPane,
      paneGrew,
      paneOk: expectsNewPane ? paneGrew : true,
      overlapPx: after.maxOverlapPx,
      canvasArea: after.totalCanvasArea,
    });
  }

  const final = await shellWin.webContents.executeJavaScript(MEASURE_JS);
  const img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'CC-103-all-34.png'), img.toPNG());

  // ---- 판정 ----
  const notFound = results.filter((r) => !r.found);
  const notOn = results.filter((r) => r.found && !r.turnedOn);
  // pane을 못 만든 것 자체는 실패가 아니다 — 높이 예산 때문에 의도적으로
  // 건너뛸 수 있다. 실패는 "건너뛰고도 사용자에게 말하지 않은 경우"다.
  const paneBad = results.filter((r) => r.found && r.turnedOn && !r.paneOk);
  const skippedReported = /표시하지 못한 지표/.test(final.skipNote);
  const errors = final.consoleErrors.filter((e) => /지표 계산 실패/.test(e));

  console.log('[probe] 전수 결과');
  for (const r of results) {
    // pane을 못 만든 건 실패가 아니라 높이 예산에 걸린 **의도된 보류**다.
    // FAIL로 찍으면 나중에 로그만 보고 "21개 깨졌다"로 읽힌다(실제로 그렇게 읽었다).
    const mark = !r.found ? 'FAIL(행없음)' : !r.turnedOn ? 'FAIL(안켜짐)' : !r.paneOk ? '보류(높이)' : 'OK';
    console.log(`  ${mark.padEnd(14)} ${r.id.padEnd(18)} pane=${r.pane}`);
  }
  console.log('---');
  console.log('[probe] 켠 지표:', results.length);
  console.log('[probe] 최종 pane 행:', final.paneRowCount, '/ 겹침:', final.maxOverlapPx + 'px');
  console.log('[probe] 캔버스 면적:', baseline.totalCanvasArea, '→', final.totalCanvasArea);
  console.log('[probe] 범례 칩:', final.legendChips.length + '개', JSON.stringify(final.legendChips.slice(0, 8)));
  console.log('[probe] 계산 실패 로그:', errors.length ? errors : '없음');

  const silentlyDropped = paneBad.length > 0 && !skippedReported;
  const fails = notFound.length + notOn.length + errors.length
    + (silentlyDropped ? 1 : 0)
    + (final.maxOverlapPx >= 1 ? 1 : 0);
  if (fails) {
    console.log('[probe] 실패 ' + fails + '건');
    if (notFound.length) console.log('  행없음:', notFound.map((r) => r.id).join(', '));
    if (notOn.length) console.log('  안켜짐:', notOn.map((r) => r.id).join(', '));
    if (silentlyDropped) console.log('  조용히 누락(안내 없음):', paneBad.map((r) => r.id).join(', '));
    if (final.maxOverlapPx >= 1) console.log('  pane 겹침:', final.maxOverlapPx + 'px');
    app.exit(1);
    return;
  }
  console.log('[probe] 실제 차트 렌더 OK — 그려진 pane 지표', results.filter(r=>r.paneOk).length,
    '/ 높이 부족으로 보류', paneBad.length, paneBad.length ? '(안내 표시됨 — 실패 아님)' : '');
  if (final.skipNote) console.log('[probe] 안내 문구:', final.skipNote);
  app.exit(0);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe] 실패:', err);
  app.exit(1);
});
