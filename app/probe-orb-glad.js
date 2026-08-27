// 오브 즐거움(glad, 목표가 도달) 표정 프로브(board-31④·32 "셀·신남", CP1a) —
// athena:routine-event로 fired 이벤트가 올 때 event.goal===true면
// data-face="glad"로 서는지, goal 없는 fired는 기존 동작(surprise/fired)을
// 그대로 유지하는지, 급변(exceedRatio 조건 충족)과 goal이 동시에 성립해도
// glad가 surprise보다 우선하는지, 그리고 펼쳐서 읽으면 glad도 fired/surprise와
// 똑같이 앰비언트로 풀리는지 확인한다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-glad-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-glad] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function faceState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { face: root.dataset.face, alert: root.dataset.alert };
  })()`);
}

/** 실제 눈 모양(px) — data-face 문자열만으로는 CSS 캐스케이드 충돌(예:
 * [data-alert="fired"] 결합 규칙이 뒤에서 이겨버리는 것)을 못 잡는다.
 * getComputedStyle로 진짜 렌더 크기를 재서 glad 전용 아치가 실제로 이겼는지
 * 확인한다(probe-orb-surprise.js와 같은 기법). */
async function eyeShape(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const eye = document.querySelector('.orb-eye-l');
    const cs = getComputedStyle(eye);
    return { width: parseFloat(cs.width), height: parseFloat(cs.height), radius: cs.borderRadius };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  // ---------- (1) goal 없는 일반 발화 → 기존 동작(fired), glad 아님 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'PLAIN', observed: 5.0, threshold: 5.0, mode: 'poll', note: 'probe-plain', goal: false,
  });
  await wait(200);
  const s1 = await faceState(orbWin);
  record('01-goal 없는 발화 → data-face=fired(glad 아님)', s1.face === 'fired' && s1.alert === 'fired', s1);

  // ---------- (2) goal=true 발화 → glad, 배지는 그대로 fired ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'GOAL', observed: 200000, threshold: 200000, mode: 'poll', note: 'probe-goal', goal: true,
  });
  await wait(200);
  const s2 = await faceState(orbWin);
  record('02-goal=true 발화 → data-face=glad, data-alert=fired', s2.face === 'glad' && s2.alert === 'fired', s2);

  // 실제 렌더 크기 대조 — [data-alert="fired"] 결합 규칙에 눌리지 않고 glad
  // 전용 27.4%/16.4% 아치가 실제로 이겼는지(캐스케이드 순서 검증).
  const eyeArch = await eyeShape(orbWin);
  record('02b-glad 눈이 아치 모양(사각 아님, done/glad 공용 규칙)으로 렌더된다',
    Math.abs(eyeArch.width - eyeArch.height * (27.4 / 16.4)) < 5 || eyeArch.radius.includes('0px 0px'),
    eyeArch);

  // ---------- (3) 급변(exceedRatio 충족)+goal=true 동시 → glad가 surprise를 이긴다 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'BOTH', observed: 10.0, threshold: 5.0, mode: 'poll', note: 'probe-both', goal: true,
  });
  await wait(200);
  const s3 = await faceState(orbWin);
  record('03-급변+goal 동시 → data-face=glad(surprise보다 우선)', s3.face === 'glad' && s3.alert === 'fired', s3);

  // ---------- (4) 급변만(goal=false) → 기존 surprise 동작은 그대로 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'SURGE', observed: 10.0, threshold: 5.0, mode: 'poll', note: 'probe-surge', goal: false,
  });
  await wait(200);
  const s4 = await faceState(orbWin);
  record('04-급변만(goal=false) → data-face=surprise(회귀 없음)', s4.face === 'surprise' && s4.alert === 'fired', s4);

  // ---------- (5) 펼쳐서 읽으면 glad도 fired/surprise처럼 앰비언트로 풀린다 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'GOAL2', observed: 200000, threshold: 200000, mode: 'poll', note: 'probe-goal-2', goal: true,
  });
  await wait(200);
  const s5 = await faceState(orbWin);
  record('05-재확인 — data-face=glad', s5.face === 'glad', s5);

  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(300);
  const s6 = await faceState(orbWin);
  record('06-펼쳐 읽음 → glad가 풀린다(fired/surprise 아님, alert도 none)',
    s6.face !== 'glad' && s6.face !== 'fired' && s6.face !== 'surprise' && s6.alert === 'none', s6);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-glad-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-glad] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-glad] 치명적 실패:', err);
  app.exit(1);
});
