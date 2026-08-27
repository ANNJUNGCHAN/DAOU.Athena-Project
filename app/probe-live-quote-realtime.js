// 장중 라이브 시세 실시간 관측 프로브 — 합성 주입(probe-quote-realtime.js)과 달리
// 실백엔드·실 Claude CLI로 "삼성전자 시세" 질의를 실제로 보내고, 렌더된 시세
// 카드의 표를 30초간 샘플링해 REAL 0B 체결이 실제로 흘러드는지 관측한다.
// 판정은 하지 않는다 — 관측값만 남긴다(장 마감·거래 한산이면 행이 안 늘 수 있다).
//
// 실행: ATHENA_USERDATA_DIR=<격리 프로필> npx electron probe-live-quote-realtime.js

process.env.ATHENA_NO_AUTOSTART = '1';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', process.env.ATHENA_USERDATA_DIR
  || path.join(app.getPath('appData'), 'athena-shell'));

const OUT = path.join(__dirname, 'captures', 'PROBE-LIVE-QUOTE-REALTIME.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 시세 카드의 실시간 상태 스냅샷 — 행 수·첫 행(최신 체결) 텍스트·탭 상태.
const QUOTE_PROBE = `(() => {
  const card = [...document.querySelectorAll('#grid > .card')].find((c) =>
    (c.querySelector('.card-title') || {}).textContent === '시세' || c.textContent.includes('체결가'));
  if (!card) return { found: false };
  const rows = [...card.querySelectorAll('tbody tr')];
  const tabs = [...card.querySelectorAll('.quote-tab, [class*=tab]')].map((t) => ({
    text: t.textContent, active: t.classList.contains('is-active') }));
  return {
    found: true,
    rowCount: rows.length,
    latestRow: rows.length ? rows[0].textContent : null,
    tabs,
  };
})()`;

app.whenReady().then(async () => {
  const report = { started_at: new Date().toISOString(), samples: [] };
  try {
    const mainMod = require('./main.js');
    await mainMod.createWindows();
    const { shellWin } = mainMod.getWins();

    // 부팅 대기(#boot 소멸, #app 노출) — run-cases-ui.js와 같은 기준.
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const s = await shellWin.webContents.executeJavaScript(
        `(() => { const v=(id)=>{const n=document.getElementById(id);return !!n&&!n.hidden;}; return { boot: v('boot'), app: v('app'), onboard: v('onboard') }; })()`);
      if (!s.boot && s.app) break;
      if (s.onboard) { report.error = 'ONBOARD-BLOCKED'; throw new Error('onboard'); }
      await wait(400);
    }

    // 질의 발사.
    await shellWin.webContents.executeJavaScript(`(() => {
      const input = document.getElementById('input');
      input.value = ${JSON.stringify('삼성전자 시세 보여줘')};
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })();`);

    // 시세 카드 출현 대기(최대 200초 — 라이브 왕복).
    const t1 = Date.now();
    let first = { found: false };
    while (Date.now() - t1 < 200000) {
      first = await shellWin.webContents.executeJavaScript(QUOTE_PROBE);
      if (first.found) break;
      await wait(1000);
    }
    report.card_appeared_ms = first.found ? Date.now() - t1 : null;
    report.samples.push({ at_s: 0, ...first });

    if (first.found) {
      // 30초간 5초 간격 샘플링 — 장중이면 행 수/최신 체결가가 움직여야 한다.
      for (let i = 1; i <= 6; i += 1) {
        await wait(5000);
        const s = await shellWin.webContents.executeJavaScript(QUOTE_PROBE);
        report.samples.push({ at_s: i * 5, ...s });
      }
      const r0 = report.samples[1] ? report.samples[1].rowCount : first.rowCount;
      const rN = report.samples[report.samples.length - 1].rowCount;
      report.rows_grew = rN > first.rowCount;
      report.latest_changed = report.samples.some((s, i) =>
        i > 1 && s.latestRow && report.samples[1].latestRow && s.latestRow !== report.samples[1].latestRow);
    }
  } catch (e) {
    report.error = report.error || String((e && e.message) || e);
  }
  report.finished_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1), 'utf8');
  process.stdout.write(`[probe] ${JSON.stringify({
    appeared: report.card_appeared_ms, rows_grew: report.rows_grew,
    latest_changed: report.latest_changed, error: report.error || null })}\n`);
  app.exit(report.error ? 1 : 0);
});
