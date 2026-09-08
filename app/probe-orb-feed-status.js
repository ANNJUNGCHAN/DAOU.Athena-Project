// 루틴 피드 연결 끊김 프로브(board-30⑩, 2026-08-27 갭 클로징 Step 4b) —
// athena:orb-signal { signal: 'feed-status', status } 주입 시 disconnected면
// 지속 찡그림(타이머로 안 풀린다 — Step 4a의 일시 찡그림과 대비해 확인),
// connected면 해제, unsupported는 무시되는지 확인한다. main.js의 RoutineFeed는
// 실제 WebSocket(백엔드 필요)이라 이 프로브에서는 우회하고, orb.js가 받는
// IPC 신호 자체를 직접 주입한다(main의 릴레이 배선은 main.js 소스를 읽는
// check-orb.mjs 게이트가 이미 검사한다).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = path.join(__dirname, '.probe-orb-feed-status-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-feed-status] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

function sendFeedStatus(orbWin, state) {
  orbWin.webContents.send('athena:orb-signal', { signal: 'feed-status', status: { state } });
}

async function faceState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { face: root.dataset.face };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  // ---------- (1) disconnected → frown ----------
  sendFeedStatus(orbWin, 'disconnected');
  await wait(200);
  const s1 = await faceState(orbWin);
  record('01-disconnected → data-face=frown', s1.face === 'frown', s1);

  // ---------- (2) 일시 찡그림과 달리 타이머로 안 풀린다(DONE_HOLD 2000ms 초과 대기) ----------
  await wait(2300);
  const s2 = await faceState(orbWin);
  record('02-2.3s 경과해도 disconnected면 frown 유지(지속 표정)', s2.face === 'frown', s2);

  // ---------- (3) connected 복귀 → frown 해제 ----------
  sendFeedStatus(orbWin, 'connected');
  await wait(200);
  const s3 = await faceState(orbWin);
  record('03-connected 복귀 → frown 해제', s3.face !== 'frown', s3);

  // ---------- (4) unsupported는 무시(신호 없음 취급) ----------
  sendFeedStatus(orbWin, 'disconnected');
  await wait(200);
  const s4a = await faceState(orbWin);
  record('04a-사전 준비: 다시 disconnected → frown', s4a.face === 'frown', s4a);
  sendFeedStatus(orbWin, 'unsupported');
  await wait(200);
  const s4b = await faceState(orbWin);
  record('04b-unsupported 신호는 무시(frown 상태 불변)', s4b.face === 'frown', s4b);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-feed-status-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-feed-status] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-feed-status] 치명적 실패:', err);
  app.exit(1);
});
