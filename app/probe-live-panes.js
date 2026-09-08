// 토스 방식 검증 — 하단 지표를 여러 개 켜면 카드가 자라고 아무것도 거부되지 않는가.
process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = path.join(__dirname, '.probe-panes-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true })
);
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const CAPTURES = path.join(__dirname, 'captures');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DATASET = {
  dataset_id: 'probe-panes-chart',
  question: '삼성전자 일봉 차트',
  operations: [{
    operation_ref: 'base:ka10081',
    args: { stk_cd: '005930', base_dt: '20260825', upd_stkpc_tp: '1' },
    caption: '삼성전자 일봉',
  }],
};

const MEASURE = `(() => {
  const card = document.querySelector('.card.chart');
  const note = card.querySelector('.chart-ind-note') || card.querySelector('.chart-mock-note');
  const rows = Array.from(card.querySelectorAll('table tr')).map(tr => tr.getBoundingClientRect()).filter(r => r.height > 1);
  let maxOverlap = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const o = Math.max(0, Math.min(rows[i-1].bottom, rows[i].bottom) - Math.max(rows[i-1].top, rows[i].top));
    maxOverlap = Math.max(maxOverlap, o);
  }
  const skip = Array.from(card.querySelectorAll('div')).map(d => d.textContent || '')
    .find(t => /표시하지 못한 지표/.test(t)) || '';
  return {
    cardH: Math.round(card.getBoundingClientRect().height),
    cssVar: card.style.getPropertyValue('--chart-card-h') || '(없음)',
    paneRows: rows.length,
    maxOverlapPx: Math.round(maxOverlap * 100) / 100,
    skipNote: skip.slice(0, 120),
  };
})()`;

const OPEN_PANEL = `(() => {
  const card = document.querySelector('.card.chart');
  const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => b.textContent.includes('∿'));
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked';
})()`;

function toggle(labels) {
  return `(() => {
    const card = document.querySelector('.card.chart');
    const panel = card.querySelector('.chart-indicator-panel')
      || document.querySelector('.chart-indicator-panel');
    if (!panel) return { err: 'no-panel' };
    const rows = Array.from(panel.querySelectorAll('.chart-ind-row'));
    const done = [];
    const missing = [];
    for (const label of ${JSON.stringify(labels)}) {
      const row = rows.find(r => {
        const l = r.querySelector('.chart-ind-label');
        return l && l.textContent === label;
      });
      if (!row) { missing.push(label); continue; }
      if (row.classList.contains('is-unimplemented')) { missing.push(label + '(미구현)'); continue; }
      if (!row.classList.contains('is-on')) { row.click(); done.push(label); }
    }
    return { done, missing, rowCount: rows.length };
  })()`;
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  await wait(800);

  await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'rest-dataset', dataset: DATASET, expand: true })})`
  );
  await wait(6000);

  console.log('[panes] 지표 0개:', JSON.stringify(await shellWin.webContents.executeJavaScript(MEASURE)));
  let img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'panes-0.png'), img.toPNG());

  const WANT = ['스토캐스틱', 'CCI', 'RSI', 'MACD'];
  console.log('[panes] 패널 열기:', await shellWin.webContents.executeJavaScript(OPEN_PANEL));
  await wait(1200);
  const on = await shellWin.webContents.executeJavaScript(toggle(WANT));
  console.log('[panes] 켠 지표:', JSON.stringify(on));
  await wait(3000);

  const after = await shellWin.webContents.executeJavaScript(MEASURE);
  console.log('[panes] 지표 4개:', JSON.stringify(after));
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'panes-4.png'), img.toPNG());

  // 전체화면 — 같은 지표 조합이 더 넓은 카드에서 어떻게 보이는지.
  await shellWin.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.card.chart');
    const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn')).find(b => (b.title||'').includes('전체') || b.textContent.includes('⛶'));
    if (btn) { btn.click(); return 'clicked'; }
    card.classList.add('is-expanded'); return 'class';
  })()`);
  await wait(2500);
  const full = await shellWin.webContents.executeJavaScript(MEASURE);
  console.log('[panes] 전체화면:', JSON.stringify(full));
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'panes-4-full.png'), img.toPNG());

  const allOn = (on.done || []).length === WANT.length && !(on.missing || []).length;
  const noSkip = !after.skipNote;
  const noOverlap = after.maxOverlapPx < 1 && full.maxOverlapPx < 1;
  const paneCount = after.paneRows;
  console.log(`[panes] 판정 — 전부 켜짐:${allOn ? 'OK' : 'FAIL'} 거부 없음:${noSkip ? 'OK' : 'FAIL'} 겹침 없음:${noOverlap ? 'OK' : 'FAIL'} pane행 ${paneCount}`);
  app.exit(allOn && noSkip && noOverlap ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[panes] 실패:', e); app.exit(1); });
