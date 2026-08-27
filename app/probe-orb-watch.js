// 오브 경계(watch) 프로브(board-30②b·32 '셀·경계', 2026-08-27 CP3-3) —
// athena:orb-signal { signal: 'watch', active } 주입 시 data-face="watch"가
// 서고, 이탈(active:false)에서 풀리고, 듣는 중(listen)이 여전히 watch보다
// 우선하는지(settleAmbientFace의 정적 우선순위: listen > watch > idle)
// 확인한다. main.js의 실제 WS 릴레이는 우회하고 orb.js가 받는 IPC 신호
// 자체를 직접 주입한다(probe-orb-feed-status.js와 같은 기법 — main의 릴레이
// 배선은 main.js 소스를 읽는 check-orb.mjs 게이트가 이미 검사한다).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-watch-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-watch] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

function sendWatch(orbWin, active) {
  orbWin.webContents.send('athena:orb-signal', { signal: 'watch', active, observed: 4.6, threshold: 5.0 });
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

  // 셸 커맨드바 자동 포커스로 listening=true가 먼저 와 있을 수 있다
  // (probe-orb-drowsy.js가 실측한 것과 같은 이유) — watch 판정을 가리지 않게
  // 명시적으로 꺼둔다.
  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: false });
  await wait(200);

  // ---------- (1) 근접 진입 → data-face=watch ----------
  sendWatch(orbWin, true);
  await wait(200);
  const s1 = await faceState(orbWin);
  record('01-근접 진입(active:true) → data-face=watch', s1.face === 'watch', s1);

  // ---------- (2) 근접 이탈 → watch가 풀린다(다른 활성 신호 없음 → idle) ----------
  sendWatch(orbWin, false);
  await wait(200);
  const s2 = await faceState(orbWin);
  record('02-근접 이탈(active:false) → data-face≠watch', s2.face !== 'watch', s2);

  // ---------- (3) 우선순위 — 근접 중에도 듣는 중이 이긴다 ----------
  sendWatch(orbWin, true);
  await wait(200);
  const s3pre = await faceState(orbWin);
  record('03pre-사전 준비: 다시 근접 → data-face=watch', s3pre.face === 'watch', s3pre);

  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: true });
  await wait(200);
  const s3 = await faceState(orbWin);
  record('03-근접 중 listen 신호 → data-face=listen(watch를 덮는다)', s3.face === 'listen', s3);

  // ---------- (3b) 듣는 중 해제 → 근접이 여전히 살아 있으면 watch로 복귀 ----------
  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: false });
  await wait(200);
  const s3b = await faceState(orbWin);
  record('03b-listen 해제 → watch로 복귀(여전히 근접 중)', s3b.face === 'watch', s3b);

  // ---------- (4) 마지막으로 근접도 해제 → idle ----------
  sendWatch(orbWin, false);
  await wait(200);
  const s4 = await faceState(orbWin);
  record('04-근접 해제 → data-face≠watch', s4.face !== 'watch', s4);

  // ---------- (5) 조합 결함 재현 — watch 유지 중 goal-fired(GLAD) → 펼쳐 읽음
  // → watch 복귀(CP3 불변식: 근접 이탈 신호가 와야 풀린다). renderPresence가
  // 읽음 처리에서 직접 setFace(FACE.IDLE)로 꽂으면 이 불변식이 깨진다 —
  // settleAmbientFace를 거쳐 watching을 다시 읽어야 한다. ----------
  sendWatch(orbWin, true);
  await wait(200);
  const s5pre = await faceState(orbWin);
  record('05pre-사전 준비: 근접 재진입 → data-face=watch', s5pre.face === 'watch', s5pre);

  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'GOALWATCH', observed: 200000, threshold: 200000, mode: 'poll', note: 'probe-goal-watch', goal: true,
  });
  await wait(200);
  const s5glad = await faceState(orbWin);
  record('05glad-근접 중 목표달성 발화 → data-face=glad(watch를 잠시 덮는다)', s5glad.face === 'glad', s5glad);

  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(300);
  const s5 = await faceState(orbWin);
  record('05-펼쳐 읽음 → glad가 풀리고 watch로 복귀(직접 idle 아님)', s5.face === 'watch', s5);

  // 다음 그룹을 위해 패널을 접고 근접도 해제한다.
  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(300);
  sendWatch(orbWin, false);
  await wait(200);

  // ---------- (6) 회귀 확인 — watch 없는 상태에서 goal-fired → 펼쳐 읽음 →
  // 기존대로 idle 복귀(앰비언트 신호가 하나도 없으면 settleAmbientFace도
  // idle로 떨어진다 — 구조가 맞다는 확인). ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'GOALPLAIN', observed: 200000, threshold: 200000, mode: 'poll', note: 'probe-goal-plain', goal: true,
  });
  await wait(200);
  const s6glad = await faceState(orbWin);
  record('06glad-근접 없이 목표달성 발화 → data-face=glad', s6glad.face === 'glad', s6glad);

  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(300);
  const s6 = await faceState(orbWin);
  record('06-펼쳐 읽음(근접 없음) → data-face=idle(회귀 없음)', s6.face === 'idle', s6);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-watch-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-watch] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-watch] 치명적 실패:', err);
  app.exit(1);
});
