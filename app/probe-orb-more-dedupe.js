// '더보기' 중복 카드 프로브(2026-08-27 질의응답 결정 — 이벤트당 1회) — 같은 발화
// 이벤트로 #orbMore를 두 번 누르면 두 번째는 event 없이(카드 재적재 없음) 셸만
// 띄우는지, 새 이벤트가 오면 다시 카드를 실어 보내는지 확인한다. main.js의
// athena:orb-open-shell 핸들러(revealShell+카드) 옆에 계측 리스너를 하나 더 붙여
// 페이로드에 event가 실렸는지만 센다 — PointerEvent 대신 click()으로 충분한 이유는
// 검증 대상이 리스너 안의 중복 억제 분기뿐이라서다(probe-orb-drag-lift.js 머리말 참고).

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-more-dedupe-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-more-dedupe] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

// main.js의 실제 핸들러와 별개로, 클릭마다 event 동봉 여부만 기록한다.
const opens = [];
ipcMain.on('athena:orb-open-shell', (e, payload = {}) => {
  opens.push(!!(payload && payload.event));
});

function sendFired(orbWin, note) {
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'DEDUP', observed: 5.0, threshold: 5.0, mode: 'poll', note, goal: false,
  });
}

const clickMore = (orbWin) => orbWin.webContents.executeJavaScript(
  `(() => { document.getElementById('orbMore').click(); return true; })()`);

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  sendFired(orbWin, 'probe-more-1');
  await wait(200);
  await clickMore(orbWin);
  await wait(150);
  record('01-첫 클릭은 카드 동봉', opens.length === 1 && opens[0] === true, { opens: [...opens] });

  await clickMore(orbWin);
  await wait(150);
  record('02-같은 이벤트 재클릭은 event 없이 셸만', opens.length === 2 && opens[1] === false, { opens: [...opens] });

  sendFired(orbWin, 'probe-more-2');
  await wait(200);
  await clickMore(orbWin);
  await wait(150);
  record('03-새 이벤트는 다시 카드 동봉', opens.length === 3 && opens[2] === true, { opens: [...opens] });

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-more-dedupe-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-more-dedupe] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-more-dedupe] 치명적 실패:', err);
  app.exit(1);
});
