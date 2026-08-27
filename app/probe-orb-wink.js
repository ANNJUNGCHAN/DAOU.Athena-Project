// 오브 윙크 표정 프로브(board-30⑧/31③, 2026-08-27 갭 클로징 Step 3b) —
// athena:orb-signal { signal: 'registered' } 주입 시 data-face="wink"로
// 바뀌고, DONE_HOLD(2000ms) 뒤 앰비언트 표정(idle)으로 스스로 복귀하는지,
// 그리고 발화(fired) 중에는 윙크가 끼어들지 못하는지 확인한다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-wink-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-wink] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function faceState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { face: root.dataset.face, alert: root.dataset.alert };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  // ---------- (1) 부팅 직후 기본 얼굴 ----------
  // 셸 창이 뜨면 커맨드바 입력이 자동 포커스돼(chat.js) 'listen' 실신호가 먼저
  // 온다 — 오브 앰비언트 기본은 'idle'이 아니라 'listen'으로 정착한다. 이 값을
  // 아래 (3)에서 "wink가 걷힌 뒤 되돌아갈 자리"로 재사용한다.
  const s0 = await faceState(orbWin);
  const ambientBaseline = s0.face;
  record('00-부팅 직후 이벤트 표정이 아니다', !['wink', 'done', 'fired', 'mopey', 'crying'].includes(s0.face), s0);

  // ---------- (2) registered 신호 → wink ----------
  orbWin.webContents.send('athena:orb-signal', { signal: 'registered' });
  await wait(200);
  const s1 = await faceState(orbWin);
  record('01-registered 신호 → data-face=wink', s1.face === 'wink', s1);

  // ---------- (3) DONE_HOLD(2000ms) 전에는 유지 ----------
  await wait(1500);
  const s2 = await faceState(orbWin);
  record('02-1.5s 경과 시점에도 wink 유지', s2.face === 'wink', s2);

  // ---------- (4) DONE_HOLD 경과 후 원래 앰비언트로 복귀 ----------
  await wait(900); // 누적 2.4s > DONE_HOLD 2000ms
  const s3 = await faceState(orbWin);
  record('03-DONE_HOLD 경과 후 앰비언트 복귀(wink 자기참조 교착 없음)', s3.face === ambientBaseline, s3);

  // ---------- (5) 발화(fired) 중에는 registered가 wink로 덮지 못한다 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'TEST', observed: 1, threshold: 1, mode: 'poll', note: 'probe',
  });
  await wait(200);
  const s4 = await faceState(orbWin);
  record('04-발화 이벤트 → data-face=fired', s4.face === 'fired' && s4.alert === 'fired', s4);

  orbWin.webContents.send('athena:orb-signal', { signal: 'registered' });
  await wait(200);
  const s5 = await faceState(orbWin);
  record('05-발화 중 registered 신호는 무시(여전히 fired)', s5.face === 'fired', s5);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-wink-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-wink] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-wink] 치명적 실패:', err);
  app.exit(1);
});
