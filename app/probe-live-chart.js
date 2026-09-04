// 1단계 진단 — live 모드에서 실제 TR로 차트 카드를 띄우고 6주기 전환을 확인한다.
// 백엔드(127.0.0.1:8010)가 이미 떠 있어야 한다.
process.env.ATHENA_NO_AUTOSTART = '1';
// ATHENA_CANVAS_SOURCE를 설정하지 않는다 = live.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-live-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true })
);
app.setPath('userData', PROFILE);

const CAPTURES = path.join(__dirname, 'captures');
if (!fs.existsSync(CAPTURES)) fs.mkdirSync(CAPTURES, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DATASET = {
  dataset_id: 'probe-live-chart',
  question: '삼성전자 일봉 차트',
  operations: [{
    operation_ref: 'base:ka10081',
    args: { stk_cd: '005930', base_dt: '20260825', upd_stkpc_tp: '1' },
    caption: '삼성전자 일봉',
  }],
};

// 카드 상태 되읽기 — 봉 수·표시 주기·잠긴 탭·에러를 한 번에 본다.
const MEASURE = `(() => {
  const card = document.querySelector('.card.chart');
  if (!card) return { card: false };
  const tabs = Array.from(card.querySelectorAll('.chart-toolbar-tab')).map(t => ({
    label: t.textContent, active: t.classList.contains('is-active'),
    locked: t.disabled === true,
  }));
  const note = card.querySelector('.chart-mock-note');
  return {
    card: true,
    renderState: card.dataset.renderState,
    trId: card.__athenaChartTrId || null,
    tabs,
    note: note && !note.hidden ? note.textContent.trim() : '',
    lastPrice: (card.querySelector('.chart-legend-foot') || {}).textContent || null,
  };
})()`;

function clickTab(label) {
  return `(() => {
    const card = document.querySelector('.card.chart');
    const t = Array.from(card.querySelectorAll('.chart-toolbar-tab'))
      .find(x => x.textContent === ${JSON.stringify(label)});
    if (!t) return 'no-tab';
    if (t.disabled) return 'locked';
    t.click();
    return 'clicked';
  })()`;
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  await wait(800);

  const rendered = await shellWin.webContents.executeJavaScript(
    `window.athena.invoke('athena__render_canvas', ${JSON.stringify({ source: 'rest-dataset', dataset: DATASET, expand: true })})`
  );
  console.log('[live] render_canvas:', JSON.stringify(rendered).slice(0, 400));
  await wait(6000);

  const base = await shellWin.webContents.executeJavaScript(MEASURE);
  console.log('[live] 초기 상태:', JSON.stringify(base, null, 1));

  async function captureOrSkip(name) {
    const img = await Promise.race([
      shellWin.webContents.capturePage(),
      wait(12000).then(() => null),
    ]);
    if (!img) {
      console.log(`[live] capture skip: ${name}`);
      return;
    }
    fs.writeFileSync(path.join(CAPTURES, name), img.toPNG());
  }

  await captureOrSkip('live-chart-day.png');

  for (const label of ['주', '월', '년', '분', '틱']) {
    const r = await shellWin.webContents.executeJavaScript(clickTab(label));
    await wait(3500);
    const m = await shellWin.webContents.executeJavaScript(MEASURE);
    console.log(`[live] '${label}' → ${r} | trId=${m.trId} | note=${m.note.slice(0, 90)}`);
    await captureOrSkip(`live-chart-${label}.png`);
  }

  app.exit(0);
}

app.whenReady().then(main).catch((e) => { console.error('[live] 실패:', e); app.exit(1); });
