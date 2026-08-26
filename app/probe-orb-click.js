// 오브 펼침 회귀 프로브 — "오브를 어떻게 펼쳐? 안펼쳐" 신고를 실제 포인터
// 입력 경로로 재현한다. 이전 진단(probe-orb-chat.js)은
// document.getElementById('orbToggle').click()로 DOM 합성 클릭을 썼는데,
// 이는 pointerdown/pointermove/pointerup 시퀀스를 전혀 발생시키지 않아
// 2026-08-26 board-32 드래그 배선(orb.js pointerdown/move/up + 4px 문턱 +
// justDragged)을 통째로 건너뛴다 — 그래서 회귀를 못 잡았다.
// webContents.sendInputEvent로 진짜 mouseDown/mouseUp(+선택적 중간 mouseMove)을
// 쏴 Chromium이 실제로 pointerdown/pointerup/click을 합성하게 만든다.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-click-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-click] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function getToggleCenter(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('orbToggle');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
}

async function orbState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    return { state: root.dataset.state, orbMode: root.dataset.orbMode };
  })()`);
}

// 실제 마우스 down→(선택 이동)→up을 sendInputEvent로 쏜다. moves는 [{dx,dy}] 누적 오프셋.
async function realClick(win, x, y, moves = []) {
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  let cx = x, cy = y;
  for (const m of moves) {
    cx += m.dx; cy += m.dy;
    win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: cy, button: 'left' });
    await wait(16);
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', x: cx, y: cy, button: 'left', clickCount: 1 });
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  // 펼침/접힘마다 창 크기·앵커가 바뀌므로 클릭마다 좌표를 새로 잰다(고정 좌표를
  // 재사용하면 이전 상태 전환에서 창이 이미 움직여 오도(誤導) 실패로 보인다 —
  // 실측 중 실제로 걸렸던 함정이라 여기 남긴다).

  // ---------- (1) 진짜 정지 클릭(이동 0px) — 펼쳐져야 한다 ----------
  const before1 = await orbState(orbWin);
  const c1 = await getToggleCenter(orbWin);
  await realClick(orbWin, c1.x, c1.y);
  await wait(400);
  const after1 = await orbState(orbWin);
  record('01-정지 클릭(0px 이동) → 펼침', before1.state === 'collapsed' && after1.state === 'expanded', { before: before1, after: after1, coords: c1 });

  // 되접기(다음 케이스를 위해 원상복구) — 펼친 뒤 좌표를 다시 잰다
  const c1b = await getToggleCenter(orbWin);
  await realClick(orbWin, c1b.x, c1b.y);
  await wait(400);
  const collapsedAgain = await orbState(orbWin);
  record('01b-재클릭 → 접힘(토글 확인)', collapsedAgain.state === 'collapsed', { ...collapsedAgain, coords: c1b });

  // ---------- (2) 손떨림 수준 미세 이동(각 스텝 1px, 문턱 4px 미만) — 펼쳐져야 한다 ----------
  const c2 = await getToggleCenter(orbWin);
  await realClick(orbWin, c2.x, c2.y, [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }]);
  await wait(400);
  const after2 = await orbState(orbWin);
  record('02-미세 떨림(<4px) 클릭 → 펼침', after2.state === 'expanded', after2);

  // 다음 단계를 위해 접는다
  const c2b = await getToggleCenter(orbWin);
  await realClick(orbWin, c2b.x, c2b.y);
  await wait(400);
  const collapsedFor3 = await orbState(orbWin);
  record('02b-재클릭 → 접힘(다음 단계 준비)', collapsedFor3.state === 'collapsed', collapsedFor3);

  // ---------- (3) 진짜 드래그(문턱 이상 이동) — 펼치면 안 되고, justDragged가 다음 클릭 1건을 삼켜야 한다 ----------
  const c3 = await getToggleCenter(orbWin);
  const boundsBefore = orbWin.getBounds();
  await realClick(orbWin, c3.x, c3.y, [{ dx: 20, dy: 0 }, { dx: 20, dy: 0 }]);
  await wait(400);
  const boundsAfter = orbWin.getBounds();
  const after3 = await orbState(orbWin);
  const moved = boundsAfter.x !== boundsBefore.x || boundsAfter.y !== boundsBefore.y;
  record('03-40px 드래그 → 창 이동 + 펼침 억제', moved && after3.state === 'collapsed', { boundsBefore, boundsAfter, after3 });

  // ---------- (4) 드래그 직후 별도 클릭(justDragged 소비 후) — 정상적으로 펼쳐져야 한다 ----------
  const c4 = await getToggleCenter(orbWin);
  await realClick(orbWin, c4.x, c4.y);
  await wait(400);
  const after4 = await orbState(orbWin);
  record('04-드래그 이후 새 클릭 → 정상 펼침(justDragged 1회성 확인)', after4.state === 'expanded', { ...after4, coords: c4 });

  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-click-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-click] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-click] 치명적 실패:', err);
  app.exit(1);
});
