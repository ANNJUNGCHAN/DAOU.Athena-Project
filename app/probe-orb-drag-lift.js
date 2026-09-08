// 오브 드래그 들림 프로브(board-30③, 2026-08-27 갭 클로징 Step 2) — 문턱(4px)을
// 넘는 드래그 도중 #orbRoot[data-dragging="true"]가 서고, 손을 떼면(pointerup)
// 지워지는지 확인한다.
//
// webContents.sendInputEvent로 진짜 mouseDown/mouseMove를 쏘는 probe-orb-click.js
// 관례를 먼저 시도했으나, 이 프로브 실행 환경(로컬 electron 미설치라 npx가 매번
// 새로 받는 버전)에서는 그 경로로 만든 pointermove의 movementX가 채워지지 않아
// probe-orb-click.js 자신의 03번 드래그 케이스(창 이동 검증)도 이 환경에서 동일하게
// 실패한다 — orb.js 코드의 결함이 아니라 이 환경의 합성 입력 한계다. 그래서 여기서는
// PointerEvent를 직접 구성해 #orb에 dispatchEvent한다 — OS 입력 파이프라인을
// 우회하지만 orb.js의 실제 pointerdown/pointermove 리스너(addEventListener 경로)를
// 그대로 통과하므로, 이 파일이 확인하려는 대상(리스너 안의 dataset.dragging
// 토글 로직)에는 충분하다.

// 2026-08-27 병합 점검 — 03(드래그 중 커서 신호가 관성 시선을 덮어쓰지 않는가,
// 결함③ 회귀)·04(초대형 드래그도 창 중심이 workArea 안에 남는가, K4 클램프)을
// 같은 하네스로 확인한다.

const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { writeProbeModelPrefs } = require('./lib/probe-model-prefs');

const PROFILE = path.join(__dirname, '.probe-orb-drag-lift-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
writeProbeModelPrefs(PROFILE);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-drag-lift] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function simulateDragSequence(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const orb = document.getElementById('orb');
    const root = document.getElementById('orbRoot');
    const rect = orb.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const pointerId = 9001;
    const before = root.dataset.dragging || null;
    orb.dispatchEvent(new PointerEvent('pointerdown', { pointerId, clientX: cx, clientY: cy, button: 0, bubbles: true, cancelable: true }));
    // 4px 문턱을 넘는 이동 — movementX를 이벤트 초기화 값으로 직접 준다.
    orb.dispatchEvent(new PointerEvent('pointermove', { pointerId, clientX: cx + 20, clientY: cy, movementX: 20, movementY: 0, button: 0, bubbles: true, cancelable: true }));
    const mid = root.dataset.dragging || null;
    orb.dispatchEvent(new PointerEvent('pointerup', { pointerId, clientX: cx + 20, clientY: cy, button: 0, bubbles: true, cancelable: true }));
    const after = root.dataset.dragging || null;
    return { before, mid, after };
  })()`);
}

// 03 — 시선 경합(결함③ 회귀): 드래그 확정 중 athena:orb-cursor가 오면 관성
// 시선(이동 반대 방향, gx<0)이 유지돼야 한다 — 커서 추적이 물러나지 않으면
// 커서 방향(+x)으로 뒤집히거나 releaseCursor가 0으로 밀어버린다. dragGazeTimer
// (220ms)가 시선을 되돌리기 전에 읽어야 해서 대기는 60ms 하나다.
async function simulateGazeContention(orbWin) {
  await orbWin.webContents.executeJavaScript(`(() => {
    const orb = document.getElementById('orb');
    const rect = orb.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const pointerId = 9002;
    orb.dispatchEvent(new PointerEvent('pointerdown', { pointerId, clientX: cx, clientY: cy, button: 0, bubbles: true, cancelable: true }));
    orb.dispatchEvent(new PointerEvent('pointermove', { pointerId, clientX: cx + 20, clientY: cy, movementX: 20, movementY: 0, button: 0, bubbles: true, cancelable: true }));
    return true;
  })()`);
  // 커서가 반경 안(dist=100)에 있다는 신호 — main의 60ms 폴과 같은 페이로드 모양.
  orbWin.webContents.send('athena:orb-cursor', { dx: 100, dy: 0, dist: 100 });
  await wait(60);
  const gx = await orbWin.webContents.executeJavaScript(
    `parseFloat(document.getElementById('orbRoot').style.getPropertyValue('--orb-gx'))`);
  await orbWin.webContents.executeJavaScript(`(() => {
    document.getElementById('orb').dispatchEvent(new PointerEvent('pointerup', { pointerId: 9002, clientX: 0, clientY: 0, button: 0, bubbles: true, cancelable: true }));
    return true;
  })()`);
  return { gx };
}

// 04 — workArea 클램프(K4 결정): 좌상단으로 10만 px을 끌어도 창 중심이 어느
// 디스플레이의 workArea 안에는 남아야 한다 — 클램프가 없으면 창이 화면 밖으로
// 사라지고 복귀 수단이 앱 재시작뿐이다.
async function simulateClampDrag(orbWin) {
  await orbWin.webContents.executeJavaScript(`(() => {
    const orb = document.getElementById('orb');
    const pointerId = 9003;
    orb.dispatchEvent(new PointerEvent('pointerdown', { pointerId, clientX: 38, clientY: 38, button: 0, bubbles: true, cancelable: true }));
    orb.dispatchEvent(new PointerEvent('pointermove', { pointerId, clientX: 38, clientY: 38, movementX: -100000, movementY: -100000, button: 0, bubbles: true, cancelable: true }));
    orb.dispatchEvent(new PointerEvent('pointerup', { pointerId, clientX: 38, clientY: 38, button: 0, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await wait(150); // athena:orb-drag-move가 main에 닿아 setPosition할 시간
  const b = orbWin.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) }).workArea;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const inside = cx >= wa.x && cx <= wa.x + wa.width && cy >= wa.y && cy <= wa.y + wa.height;
  return { bounds: b, workArea: wa, inside };
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  const { before, mid, after } = await simulateDragSequence(orbWin);
  record('00-드래그 전 dragging 속성 없음', before === null, { before });
  record('01-문턱 이상 이동 중 dragging=true', mid === 'true', { mid });
  record('02-손을 뗀 후 dragging 속성 제거', after === null, { after });

  // 03 준비 — 시선 경합은 face=idle에서만 성립한다(커서 추적은 IDLE 밖에서 원래
  // 물러난다). 장외 시각엔 부팅 얼굴이 drowsy라 결함 유무와 무관하게 통과해버려
  // (2026-08-27 레드 검증 실측) probe-orb-drowsy.js와 같은 기법을 쓴다 —
  // isMarketOpen을 열림으로 바꿔치기하고 15초 주기 재판정 틱을 기다린다.
  // listen:false는 셸 커맨드바 자동 포커스 잔재 제거(probe-orb-drowsy와 같은 이유).
  orbWin.webContents.send('athena:orb-signal', { signal: 'listen', active: false });
  await orbWin.webContents.executeJavaScript(`(() => { window.AthenaLib.MarketHours.isMarketOpen = () => true; return true; })()`);
  await wait(16000);
  const preFace = await orbWin.webContents.executeJavaScript(`document.getElementById('orbRoot').dataset.face`);
  record('03a-경합 측정 전 idle 확보', preFace === 'idle', { face: preFace });

  const gaze = await simulateGazeContention(orbWin);
  record('03b-드래그 중 커서 신호에도 관성 시선 유지(gx<0)', Number.isFinite(gaze.gx) && gaze.gx < 0, gaze);

  const clamp = await simulateClampDrag(orbWin);
  record('04-초대형 드래그도 창 중심이 workArea 안(K4 클램프)', clamp.inside, { bounds: clamp.bounds, workArea: clamp.workArea });

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-drag-lift-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-drag-lift] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-drag-lift] 치명적 실패:', err);
  app.exit(1);
});
