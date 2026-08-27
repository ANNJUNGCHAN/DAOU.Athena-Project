// 오브 시무룩·우는 표정 캐스케이드 프로브(board-30⑨⑪, 2026-08-27 갭 클로징
// D.12 결함 수정) — orb.css의 mopey/crying 눈 모양 규칙이 fired 결합 규칙
// ([data-alert="fired"] .orb-eye)과 같은 특정성인데 소스 순서상 앞에 있어
// 항상 졌던 결함(af8bb81 이전부터 있던 순서 문제)을 고쳤는지 검증한다. 실사용
// 경로 그대로 routine-expired/routine-restore-failed 이벤트를 보내
// unread.push→renderPresence(→data-alert="fired")가 먼저 서고 그 뒤
// setFace(MOPEY/CRYING)가 실행되는 순서를 재현한다 — data-face와 data-alert가
// 동시에 서는 것이 이 결함의 핵심 조건이었다(orb.js routine-event 핸들러).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-mopey-crying-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-mopey-crying] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function faceState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { face: root.dataset.face, alert: root.dataset.alert };
  })()`);
}

/** 실제 눈 모양(px) — surprise 프로브와 같은 이유로 data-face/data-alert
 * 문자열만으로는 캐스케이드 충돌(같은 특정성 규칙이 소스 순서로 지는 것)을
 * 못 잡는다. getComputedStyle로 진짜 렌더 크기를 잰다. */
async function eyeSize(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const eye = document.querySelector('.orb-eye-l');
    const cs = getComputedStyle(eye);
    return { width: parseFloat(cs.width), height: parseFloat(cs.height), borderRadius: cs.borderRadius };
  })()`);
}

/** 우는 표정 전용 — 눈물 방울(::after)이 실제로 그려지는지. crying 블록
 * 전체(종속 규칙 포함)를 통째로 옮겼으므로 이동 중 떨어져 나가지 않았는지 확인한다. */
async function tearVisible(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const eye = document.querySelector('.orb-eye-r');
    const cs = getComputedStyle(eye, '::after');
    return cs.content !== 'none' && cs.content !== '';
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  // ---------- (0) 기준선 — 발화(fired) 단독, 회귀 확인용 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'BASE', observed: 5.0, threshold: 5.0, mode: 'poll', note: 'probe-base',
  });
  await wait(200);
  const s0 = await faceState(orbWin);
  const eyeFired = await eyeSize(orbWin);
  record('00-발화 단독 → data-face=fired, data-alert=fired(회귀 없음)',
    s0.face === 'fired' && s0.alert === 'fired', s0);

  // ---------- (1) 루틴 만료 → mopey, 그런데 alert는 그대로 fired(버그의 핵심 조건) ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-expired', routine_id: 'R1', note: 'probe-expired',
  });
  await wait(200);
  const s1 = await faceState(orbWin);
  const eyeMopey = await eyeSize(orbWin);
  record('01-루틴 만료 → data-face=mopey, data-alert=fired(동시 성립)',
    s1.face === 'mopey' && s1.alert === 'fired', s1);
  record('01b-mopey 눈이 fired 눈보다 실제로 더 낮다·평평하다(캐스케이드 승리, 의도한 좁은 막대)',
    eyeMopey.height < eyeFired.height * 0.7 && eyeMopey.width > 0,
    { eyeFired, eyeMopey });

  // ---------- (2) 감시 복원 실패 → crying, alert는 여전히 fired ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-restore-failed', note: 'probe-restore-failed',
  });
  await wait(200);
  const s2 = await faceState(orbWin);
  const eyeCrying = await eyeSize(orbWin);
  const tear = await tearVisible(orbWin);
  record('02-복원 실패 → data-face=crying, data-alert=fired(동시 성립)',
    s2.face === 'crying' && s2.alert === 'fired', s2);
  record('02b-crying 눈도 fired보다 낮다·평평하다(캐스케이드 승리) + 눈물 방울 유지(이동 중 안 떨어짐)',
    eyeCrying.height < eyeFired.height * 0.7 && tear === true,
    { eyeFired, eyeCrying, tear });

  // ---------- (3) 놀람+발화 순서 훼손 없음(회귀) — surprise가 여전히 fired를 이긴다 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'SURGE', observed: 10.0, threshold: 5.0, mode: 'poll', note: 'probe-surge',
  });
  await wait(200);
  const s3 = await faceState(orbWin);
  const eyeSurprise = await eyeSize(orbWin);
  record('03-급변 발화 → data-face=surprise(순서 훼손 없음)',
    s3.face === 'surprise' && s3.alert === 'fired', s3);
  record('03b-surprise 눈이 fired 눈보다 실제로 더 크다(회귀 없음)',
    eyeSurprise.width > eyeFired.width && eyeSurprise.height > eyeFired.height,
    { eyeFired, eyeSurprise });

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-mopey-crying-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-mopey-crying] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-mopey-crying] 치명적 실패:', err);
  app.exit(1);
});
