// 감시 궤도 링 프로브(board-30②, 2026-08-27 갭 클로징 Step 1) — orb.js가
// athena:routines-list로 잰 활성 감시 수만큼 #orbRing에 위성 점을 놓는지,
// 루틴 이벤트 수신 시 다시 재는지, 감시 0건이면 링을 아예 감추는지를 실제
// IPC 경로로 확인한다. probe-orb-click.js 관례(require('./main.js')를
// 라이브러리로 불러 createWindows() 직접 호출)를 따르되, main.js가 등록한
// 진짜 routines-list 핸들러는 백엔드(127.0.0.1:8010) fetch라 프로브 환경에는
// 없다 — 이 프로세스에서 ipcMain 핸들러를 모킹으로 갈아끼운다(같은 Electron
// 메인 프로세스라 require('electron')의 ipcMain은 main.js가 쓴 것과 동일 싱글턴).

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-ring-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-ring] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

let mockRoutines = [
  { status: 'active' }, { status: 'active' }, { status: 'active' }, { status: 'expired' },
];

async function ringState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    const ring = document.getElementById('orbRing');
    const dots = [...ring.querySelectorAll('.orb-ring-dot')].map((d) => d.style.getPropertyValue('--dot-angle'));
    return { watching: root.dataset.watching, dotCount: dots.length, dots };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  // main.js가 등록한 실제 routines-list 핸들러(백엔드 fetch)를 프로브 전용
  // 모킹으로 갈아끼운다 — 감시 궤도 링은 오브 렌더러 쪽 로직이라 백엔드 없이도
  // 검증할 수 있어야 한다.
  ipcMain.removeHandler('athena:routines-list');
  ipcMain.handle('athena:routines-list', async () => ({ ok: true, data: { routines: mockRoutines } }));

  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500); // orb.js 부팅 시 refreshSatelliteRing() 1회 호출 대기

  // ---------- (1) 활성 감시 3건 → 링 표시 + 위성 점 3개(0/120/240deg 등분) ----------
  const s1 = await ringState(orbWin);
  record('01-활성 3건 → watching=true, 점 3개', s1.watching === 'true' && s1.dotCount === 3, s1);
  const angles1 = s1.dots.map((d) => Math.round(parseFloat(d)));
  record('01b-점 각도 0/120/240deg 등분(computeSatelliteDots)', JSON.stringify(angles1) === JSON.stringify([0, 120, 240]), angles1);

  // ---------- (2) 루틴 이벤트 수신 시 재조회(60s 폴링과 별개 경로, board-30② 요구사항) ----------
  mockRoutines = [{ status: 'active' }]; // 1건으로 축소
  orbWin.webContents.send('athena:routine-event', { type: 'routine-fired', symbol: 'TEST', observed: 1, threshold: 1, mode: 'poll', note: 'probe' });
  await wait(400);
  const s2 = await ringState(orbWin);
  record('02-routine-event 수신 후 1건으로 갱신', s2.watching === 'true' && s2.dotCount === 1, s2);

  // ---------- (3) 감시 0건 → 링 자체를 감춘다(없는 감시를 있는 것처럼 보이면 안 된다) ----------
  mockRoutines = [];
  orbWin.webContents.send('athena:routine-event', { type: 'routine-expired', note: 'probe' });
  await wait(400);
  const s3 = await ringState(orbWin);
  record('03-감시 0건 → watching=false, 점 0개', s3.watching === 'false' && s3.dotCount === 0, s3);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-ring-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-ring] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-ring] 치명적 실패:', err);
  app.exit(1);
});
