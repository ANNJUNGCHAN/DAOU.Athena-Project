// 오브 펼침 성장 전환 프로브(board-30 3단계 근사 Option B, 2026-08-27 갭 클로징
// Step 11) — orb.js의 athena:orb-state 핸들러가 hidden 해제 직후 작게 접힌 시작
// 프레임(data-panel-anim="enter")을 한 번 그리고 다음 프레임에서 최종 크기로
// 넘기는지, reduced-motion에서는 그 시작 프레임 없이 곧장 최종 상태로 가는지 잰다.
//
// probe-orb-drag-lift.js 관례를 따른다 — 실제 orb.js 리스너(ipcRenderer 경로)를
// 그대로 통과시키려면 main처럼 orbWin.webContents.send('athena:orb-state', …)로
// 진짜 이벤트를 쏘는 편이 dispatchEvent보다 이 대상에 더 가깝다(main.js:749와
// 같은 채널·같은 payload 모양). reduced-motion 강제는 verify.js forceMedia와
// 같은 CDP Emulation.setEmulatedMedia를 이 파일 안에 그대로 복제한다(probe는
// 서로 require하지 않는 관례).

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-orb-panel-grow-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-orb-panel-grow] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

async function forceMedia(win, features) {
  const wc = win.webContents;
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
}

async function clearMedia(win) {
  const wc = win.webContents;
  await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  if (wc.debugger.isAttached()) wc.debugger.detach();
}

function attachObserver(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    window.__growthLog = [];
    const root = document.getElementById('orbRoot');
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        window.__growthLog.push({ attr: m.attributeName, value: root.getAttribute(m.attributeName) });
      }
    });
    mo.observe(root, { attributes: true, attributeFilter: ['data-panel-anim', 'data-state'] });
    window.__growthObserver = mo;
    true;
  })()`);
}

function readState(orbWin) {
  return orbWin.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('orbRoot');
    const panel = document.getElementById('orbPanel');
    const cs = getComputedStyle(panel);
    return {
      log: window.__growthLog || [],
      panelAnim: root.dataset.panelAnim || null,
      state: root.dataset.state,
      hidden: panel.hidden,
      transform: cs.transform,
      borderRadius: cs.borderRadius,
      transitionProperty: cs.transitionProperty,
    };
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin, orbWin } = mainMod.getWins();
  shellWin.show();
  await wait(1500);

  // ── 1) 기본 모션 경로 — 시작 프레임(enter) → 최종 프레임 ──
  await attachObserver(orbWin);
  orbWin.webContents.send('athena:orb-state', { expanded: true, anchor: 'bottom-right' });
  await wait(50); // 시작 프레임(리플로우 직후, rAF 전) 포착
  const mid = await readState(orbWin);
  await wait(400); // transition(260ms) + rAF 여유 이후 최종 프레임
  const after = await readState(orbWin);

  record('00-전이 속성에 transform·border-radius가 함께 걸려 있다(opacity 단독 금지)',
    /transform/.test(after.transitionProperty) && /border-radius/.test(after.transitionProperty),
    { transitionProperty: after.transitionProperty });

  const sawEnter = mid.log.some((e) => e.attr === 'data-panel-anim' && e.value === 'enter')
    || after.log.some((e) => e.attr === 'data-panel-anim' && e.value === 'enter');
  record('01-등장 시 시작 프레임(data-panel-anim=enter)이 한 번 걸린다', sawEnter, { log: after.log });

  const enterRemoved = after.panelAnim === null;
  record('02-다음 프레임 이후 시작 프레임 속성이 제거된다', enterRemoved, { panelAnim: after.panelAnim });

  const grown = after.state === 'expanded' && after.hidden === false
    && (after.transform === 'none' || /matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)/.test(after.transform));
  record('03-최종적으로 scale(1)(다 자란 모양)에 도달한다', grown, { state: after.state, hidden: after.hidden, transform: after.transform });

  // 접기 — 즉시(과설계 금지, 전이 없음)
  orbWin.webContents.send('athena:orb-state', { expanded: false, anchor: 'bottom-right' });
  await wait(30);
  const closed = await readState(orbWin);
  record('04-접힘은 즉시 반영된다', closed.state === 'collapsed' && closed.hidden === true, { closed });

  // ── 2) reduced-motion — 시작 프레임 없이 곧장 최종 상태 ──
  await forceMedia(orbWin, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await attachObserver(orbWin);
  orbWin.webContents.send('athena:orb-state', { expanded: true, anchor: 'bottom-right' });
  await wait(80);
  const reduced = await readState(orbWin);
  await clearMedia(orbWin);

  const noEnterFrame = !reduced.log.some((e) => e.attr === 'data-panel-anim' && e.value === 'enter');
  record('05-reduced-motion에서는 시작 프레임(enter)이 전혀 걸리지 않는다', noEnterFrame, { log: reduced.log });
  record('06-reduced-motion에서도 최종적으로 펼침 상태에 도달한다',
    reduced.state === 'expanded' && reduced.hidden === false, { state: reduced.state, hidden: reduced.hidden });

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'captures', 'probe-orb-panel-grow-report.json'), JSON.stringify(report, null, 2));
  const okCount = report.steps.filter((s) => s.ok).length;
  console.log(`[probe-orb-panel-grow] 완료 — ok:${okCount}/${report.steps.length}`);
  app.exit(okCount === report.steps.length ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('[probe-orb-panel-grow] 치명적 실패:', err);
  app.exit(1);
});
