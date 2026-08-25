// 분·틱 주기 + 세분 전환 진단.
process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-int-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true })
);
app.setPath('userData', PROFILE);

const CAPTURES = path.join(__dirname, 'captures');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DATASET = {
  dataset_id: 'probe-int-chart',
  question: '삼성전자 일봉 차트',
  operations: [{
    operation_ref: 'base:ka10081',
    args: { stk_cd: '005930', base_dt: '20260825', upd_stkpc_tp: '1' },
    caption: '삼성전자 일봉',
  }],
};

// 툴바가 보이는 상태 + 실제 그려진 봉의 양 끝 시각.
const STATE = `(() => {
  const card = document.querySelector('.card.chart');
  const tabs = Array.from(card.querySelectorAll('.chart-toolbar-tab'))
    .map(t => t.textContent + (t.classList.contains('is-active') ? '*' : '')).join(' ');
  const intervalBtn = Array.from(card.querySelectorAll('.chart-toolbar-btn'))
    .map(b => (b.textContent || '').trim())
    .find(t => /분|틱/.test(t) && /▾/.test(t));
  const s = window.__athenaChartProbe.snapshot()[0] || {};
  const note = card.querySelector('.chart-mock-note');
  return {
    제목: (card.querySelector('.card-title') || {}).textContent,
    tabs,
    세분버튼: intervalBtn || '(없음)',
    TR: s.trId, 봉: s.candleCount,
    처음: s.oldestCandle && s.oldestCandle.time,
    마지막: s.lastCandle && s.lastCandle.time,
    note: note && !note.hidden ? note.textContent.trim().slice(0, 110) : '',
  };
})()`;

const clickTab = (label) => `(() => {
  const card = document.querySelector('.card.chart');
  const t = Array.from(card.querySelectorAll('.chart-toolbar-tab'))
    .find(x => x.textContent === ${JSON.stringify(label)});
  if (!t) return 'no-tab';
  if (t.disabled) return 'locked';
  t.click();
  return 'clicked';
})()`;

// 세분 드롭다운 열고 원하는 라벨 고르기.
const pickInterval = (label) => `(() => {
  const card = document.querySelector('.card.chart');
  const btn = Array.from(card.querySelectorAll('.chart-toolbar-btn'))
    .find(b => /▾/.test(b.textContent || '') && /분|틱/.test(b.textContent || ''));
  if (!btn) return 'no-interval-btn';
  btn.click();
  const items = Array.from(document.querySelectorAll('.chart-toolbar-dropdown-item'));
  const found = items.find(i => (i.textContent || '').trim() === ${JSON.stringify(label)});
  if (!found) return 'no-item:' + items.map(i => (i.textContent||'').trim()).join('|').slice(0, 120);
  found.click();
  return 'picked';
})()`;

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
  console.log('[int] 일봉:', JSON.stringify(await shellWin.webContents.executeJavaScript(STATE)));

  console.log('[int] 분 클릭:', await shellWin.webContents.executeJavaScript(clickTab('분')));
  await wait(4000);
  console.log('[int] 분봉:', JSON.stringify(await shellWin.webContents.executeJavaScript(STATE)));
  let img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'int-min1.png'), img.toPNG());

  console.log('[int] 10분 선택:', await shellWin.webContents.executeJavaScript(pickInterval('10분')));
  await wait(4000);
  console.log('[int] 10분봉:', JSON.stringify(await shellWin.webContents.executeJavaScript(STATE)));
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'int-min10.png'), img.toPNG());

  console.log('[int] 틱 클릭:', await shellWin.webContents.executeJavaScript(clickTab('틱')));
  await wait(4000);
  console.log('[int] 틱봉:', JSON.stringify(await shellWin.webContents.executeJavaScript(STATE)));
  img = await shellWin.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURES, 'int-tick.png'), img.toPNG());

  app.exit(0);
}

app.whenReady().then(main).catch((e) => { console.error('[int] 실패:', e); app.exit(1); });
