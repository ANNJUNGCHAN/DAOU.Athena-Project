// 오브 장마감 졸림 프로브(board-30⑫/31⑨, 2026-08-27 갭 클로징 Step 6) —
// orb.js의 updateMarketClosed 15초 주기 판정이 실제로 data-face="drowsy"를
// 세우는지, 장이 열리면 다시 풀리는지, 듣는 중/생각 중이 여전히 drowsy보다
// 우선하는지 확인한다.
//
// isMarketOpen(new Date())은 실제 시스템 시각을 읽어서 프로브가 "시각을
// 직접 주입"할 수 없다 — 대신 orb.js가 바인딩한 window.AthenaLib.MarketHours
// 객체를 부팅 후에 실시간으로 바꿔치기한다(probe-orb-ring.js가 ipcMain
// 핸들러를 갈아끼우는 것과 같은 기법 — orb.js는 marketHours.isMarketOpen을
// 매 틱 프로퍼티 조회로 부르므로, 객체를 직접 고치면 다음 15초 틱부터
// 바로 반영된다).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-drowsy-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-drowsy] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function faceState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { face: root.dataset.face };
  })()`);
}

async function patchMarketOpen(orbWin, open) {
  await orbWin.webContents.executeJavaScript(
    // executeJavaScript는 실행 결과(마지막 식의 값)를 구조화 복제로 돌려줘야
    // 하는데, 대입식 그대로 두면 완료값이 함수 자체라 복제 불가 에러가 난다
    // (실측: "An object could not be cloned") — IIFE로 감싸 boolean을 돌려준다.
    `(() => { window.AthenaLib.MarketHours.isMarketOpen = () => ${open}; return true; })()`,
  );
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  // 셸 커맨드바 자동 포커스로 listening=true가 먼저 와 있을 수 있다
  // (probe-orb-wink.js가 실측한 것과 같은 이유) — drowsy 판정을 가리지 않게
  // 명시적으로 꺼둔다. listen/think가 drowsy보다 우선한다는 계약은 이 프로브가
  // 아니라 settleAmbientFace의 정적 분기로 보증되므로(코드 검사 대상), 여기서는
  // 순수 marketClosed 축만 격리해서 본다.
  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: false });
  await wait(200);

  // ---------- (1) 장중으로 강제 → drowsy가 아니다 ----------
  await patchMarketOpen(orbWin, true);
  await wait(15200); // updateMarketClosed 15초 주기 1회 대기
  const s1 = await faceState(orbWin);
  record('01-장중 강제 → data-face≠drowsy', s1.face !== 'drowsy', s1);

  // ---------- (2) 장외로 강제 → drowsy ----------
  await patchMarketOpen(orbWin, false);
  await wait(15200);
  const s2 = await faceState(orbWin);
  record('02-장외 강제 → data-face=drowsy', s2.face === 'drowsy', s2);

  // ---------- (3) 장외 중에도 듣는 중이 우선한다 ----------
  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: true });
  await wait(200);
  const s3 = await faceState(orbWin);
  record('03-장외 중 listen 신호 → data-face=listen(drowsy를 덮는다)', s3.face === 'listen', s3);

  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: false });
  await wait(200);
  const s3b = await faceState(orbWin);
  record('03b-listen 해제 → drowsy로 복귀(여전히 장외)', s3b.face === 'drowsy', s3b);

  // ---------- (4) 다시 장중으로 → drowsy가 풀린다 ----------
  await patchMarketOpen(orbWin, true);
  await wait(15200);
  const s4 = await faceState(orbWin);
  record('04-재개장 강제 → data-face≠drowsy', s4.face !== 'drowsy', s4);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-drowsy-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-drowsy] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-drowsy] 치명적 실패:', err);
  app.exit(1);
});
