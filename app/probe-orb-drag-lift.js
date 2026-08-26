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

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-drag-lift-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
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
