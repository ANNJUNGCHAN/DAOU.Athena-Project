// 오브 놀람(급변) 표정 프로브(board-31⑤, 2026-08-27 갭 클로징 Step 5) —
// athena:routine-event로 fired 이벤트가 올 때 급변(관측값이 임계 초과폭
// 1.5배 이상 — routine-turn.js exceedRatio) 판정이면 data-face="surprise"로
// 서는지, 일반 발화는 여전히 data-face="fired"인지, 배지(data-alert)는
// 두 경우 모두 그대로 "fired"인지, 그리고 펼쳐서 읽으면 surprise도 fired와
// 똑같이 앰비언트로 풀리는지 확인한다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-surprise-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-surprise] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function faceState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { face: root.dataset.face, alert: root.dataset.alert };
  })()`);
}

/** 실제 눈 모양(px) — data-face/data-alert 문자열만으로는 CSS 캐스케이드
 * 충돌(예: [data-alert="fired"] 결합 규칙이 뒤에서 이겨버리는 것)을 못
 * 잡는다. getComputedStyle로 진짜 렌더 크기를 재서 놀람이 발화보다 실제로
 * 더 둥글고 크게 뜨는지 확인한다. */
async function eyeSize(orbWin) {
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

  // ---------- (1) 일반 발화(임계와 같은 값, 배율 1배) → fired(놀람 아님) ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'NORMAL', observed: 5.0, threshold: 5.0, mode: 'poll', note: 'probe-normal',
  });
  await wait(200);
  const s1 = await faceState(orbWin);
  record('01-일반 발화(배율 1배) → data-face=fired', s1.face === 'fired' && s1.alert === 'fired', s1);

  // ---------- (2) 급변 발화(임계의 2배) → surprise, 배지는 그대로 fired ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'SURGE', observed: 10.0, threshold: 5.0, mode: 'poll', note: 'probe-surge',
  });
  await wait(200);
  const s2 = await faceState(orbWin);
  record('02-급변 발화(배율 2배) → data-face=surprise, data-alert=fired', s2.face === 'surprise' && s2.alert === 'fired', s2);

  // 실제 렌더 크기 대조 — data-alert="fired" 결합 규칙에 눌리지 않고 놀람
  // 전용 26%/26% 원이 실제로 이겼는지(캐스케이드 순서 수정 검증).
  const eyeNormal = await (async () => {
    orbWin.webContents.send('athena:routine-event', {
      type: 'routine-fired', symbol: 'NORMAL2', observed: 5.0, threshold: 5.0, mode: 'poll', note: 'probe-normal-2',
    });
    await wait(200);
    return eyeSize(orbWin);
  })();
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'SURGE3', observed: 10.0, threshold: 5.0, mode: 'poll', note: 'probe-surge-3',
  });
  await wait(200);
  const eyeSurprise = await eyeSize(orbWin);
  record('02b-놀람 눈이 일반 발화 눈보다 실제로 더 크다(캐스케이드 승리)',
    eyeSurprise.width > eyeNormal.width && eyeSurprise.height > eyeNormal.height,
    { eyeNormal, eyeSurprise });

  // ---------- (3) 경계 미만(1.4배)은 surprise가 아니다 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'NEAR', observed: 7.0, threshold: 5.0, mode: 'poll', note: 'probe-near',
  });
  await wait(200);
  const s3 = await faceState(orbWin);
  record('03-경계 미만(1.4배) → 여전히 fired(surprise 아님)', s3.face === 'fired' && s3.alert === 'fired', s3);

  // ---------- (4) 펼쳐서 읽으면 surprise도 fired처럼 앰비언트로 풀린다 ----------
  orbWin.webContents.send('athena:routine-event', {
    type: 'routine-fired', symbol: 'SURGE2', observed: 20.0, threshold: 5.0, mode: 'poll', note: 'probe-surge-2',
  });
  await wait(200);
  const s4 = await faceState(orbWin);
  record('04-재확인 — data-face=surprise', s4.face === 'surprise', s4);

  await orbWin.webContents.executeJavaScript("document.getElementById('orbToggle').click()");
  await wait(300);
  const s5 = await faceState(orbWin);
  record('05-펼쳐 읽음 → surprise가 풀린다(fired 아님, alert도 none)', s5.face !== 'surprise' && s5.face !== 'fired' && s5.alert === 'none', s5);

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-surprise-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-surprise] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-surprise] 치명적 실패:', err);
  app.exit(1);
});
