// 백테스트 모드 골격 프로브(P1) — 실앱에서 5중 배타가 실제 DOM으로 성립하는지
// 실측한다. 단위 테스트(controller.test.js의 25칸 배타표)는 fake-dom 위라
// shell.html 마크업·스크립트 로드 순서·canvas.js 배선 실수를 못 잡는다 —
// 이 프로브가 그 간극을 메운다(probe-orb-click.js와 같은 이유의 실DOM 프로브).
//
// 검사 축:
//  (1) #modeNavBacktest 클릭 → #backtestCanvas만 보이고 나머지 중앙 표면 hidden
//  (2) 빈 상태 문구가 실제로 렌더된다(가짜 데이터 없이)
//  (3) 대화로 복귀 → #mosaic 복원, #backtestCanvas 재숨김
//
// 실행: npx electron probe-backtest-mode.js  (요약은 stdout, 종료코드 0/1)

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-backtest-mode-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
// 온보딩을 건너뛴다 — 이 프로브는 모드 전환만 본다.
fs.writeFileSync(path.join(PROFILE, 'athena-onboarding.json'), JSON.stringify({ cliDone: true, accountDone: true }));
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [] };
function record(name, ok, data) {
  report.steps.push({ name, ok, data });
  console.log(`[probe-backtest-mode] ${ok ? 'OK' : 'FAIL'} — ${name}: ${JSON.stringify(data)}`);
}

// 중앙 표면 5개 + 네비 활성 상태를 한 번에 뜬다 — 배타표의 실DOM 판.
function surfaces(win) {
  return win.webContents.executeJavaScript(`(() => {
    const h = (id) => { const el = document.getElementById(id); return el ? el.hidden : null; };
    const nav = document.getElementById('modeNavBacktest');
    return {
      mosaic: h('mosaic'),
      summaryTable: h('graphSummaryTable'),
      graph: h('graphCanvas'),
      agent: h('agentCanvas'),
      plugin: h('pluginCanvas'),
      backtest: h('backtestCanvas'),
      navActive: nav ? nav.className.includes('is-active') : null,
      canvasMode: (document.getElementById('canvasRegion') || {}).dataset ? document.getElementById('canvasRegion').dataset.mode : null,
      emptyText: (document.getElementById('backtestCanvas') || { textContent: '' }).textContent.slice(0, 80),
    };
  })()`);
}

function clickNav(win, id) {
  return win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
}

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  shellWin.show();
  await wait(1800); // 렌더러 스크립트(canvas.js 포함) 로드 대기

  // ---------- (1) 부팅 직후 — 대화 모드, 백테스트 표면은 숨어 있어야 한다 ----------
  const boot = await surfaces(shellWin);
  record('01-부팅=대화 모드', boot.mosaic === false && boot.backtest === true && boot.navActive === false, boot);

  // ---------- (2) 백테스트 클릭 — 5중 배타의 다섯 번째 칸 ----------
  const clicked = await clickNav(shellWin, 'modeNavBacktest');
  await wait(300);
  const bt = await surfaces(shellWin);
  record(
    '02-백테스트 진입 → 단독 표시',
    clicked
      && bt.backtest === false
      && bt.mosaic === true && bt.summaryTable === true && bt.graph === true
      && bt.agent === true && bt.plugin === true
      && bt.navActive === true && bt.canvasMode === 'backtest',
    bt
  );

  // ---------- (3) 빈 상태가 정직한 문구를 실제로 그렸는가 ----------
  record('03-빈 상태 문구 렌더', bt.emptyText.includes('백테스트'), { emptyText: bt.emptyText });

  // ---------- (4) 대화 복귀 — 원상복구 ----------
  await clickNav(shellWin, 'modeNavSummary');
  await wait(300);
  const back = await surfaces(shellWin);
  record('04-대화 복귀', back.mosaic === false && back.backtest === true && back.canvasMode === 'chat', back);

  const okAll = report.steps.every((s) => s.ok);
  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'backtest-mode-probe.json'),
    JSON.stringify(report, null, 1)
  );
  console.log(`[probe-backtest-mode] ${okAll ? 'ALL OK' : 'FAIL'} (${report.steps.filter((s) => s.ok).length}/${report.steps.length})`);
  app.exit(okAll ? 0 : 1);
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[probe-backtest-mode] 프로브 자체 오류:', err);
  app.exit(1);
}));
