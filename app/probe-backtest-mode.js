// 백테스트 모드 골격 프로브(P1) + 1차 기능 배선 프로브(P4) — 실앱에서 5중 배타가
// 실제 DOM으로 성립하는지, 백엔드 없이도 캔버스가 정직하게 도는지 실측한다.
// 단위 테스트(controller.test.js의 25칸 배타표, backtest-canvas.test.js의 상태
// 전이)는 fake-dom/가짜 deps 위라 shell.html 마크업·스크립트 로드 순서·canvas.js
// 실배선(window.athena.invoke IPC 왕복) 실수를 못 잡는다 — 이 프로브가 그
// 간극을 메운다(probe-orb-click.js와 같은 이유의 실DOM 프로브).
//
// 검사 축:
//  (1) #modeNavBacktest 클릭 → #backtestCanvas만 보이고 나머지 중앙 표면 hidden
//  (2) 빈 상태 문구가 실제로 렌더된다(가짜 데이터 없이)
//  (3) (P4) 백엔드가 안 떠 있어도 — 프리셋 IPC 왕복이 실패하면 정직한 에러
//      상태로 넘어간다(목업 데이터로 얼버무리지 않는다). 실백엔드를 띄운 뒤의
//      프리셋 목록·실행·결과 렌더는 이번 범위 아니다(P4 지시 원문 "실백엔드
//      프로브는 이번 범위 아니다").
//  (4) 대화로 복귀 → #mosaic 복원, #backtestCanvas 재숨김
//
// 실행: npx electron probe-backtest-mode.js  (요약은 stdout, 종료코드 0/1)

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 프로필은 매 실행 새 디렉터리다. 고정 이름을 지우고 다시 만드는 판은
// 앱이 띄운 MCP 서버 자식이 `mcp-config`를 붙잡고 있으면 rmSync가 EPERM으로
// 죽어 프로브가 통째로 멈춘다(2026-08-31 실측 — 저장소 안에 남은 프로필을
// 다음 실행이 못 지웠다). 임시 폴더에 유일 이름으로 만들고 끝에 최선노력으로
// 지운다 — 못 지워도 다음 실행을 막지 않는다.
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-probe-backtest-'));
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

// 백엔드 미기동 상태에서 프리셋 IPC가 실패했을 때 캔버스가 실제로 그리는
// 에러 패널을 잰다 — 목업 데이터로 채우지 않는지가 핵심이다(P3 정책).
function backtestErrorState(win) {
  return win.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('#backtestCanvas .backtest-canvas-error');
    if (!panel) return { rendered: false, title: null, sub: null };
    const title = panel.querySelector('.backtest-canvas-empty-title');
    const sub = panel.querySelector('.backtest-canvas-empty-sub');
    return {
      rendered: true,
      title: title ? title.textContent : null,
      sub: sub ? sub.textContent : null,
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

  // ---------- (4, P4) 백엔드 미기동 — 프리셋 IPC 실패가 정직한 에러 상태로 넘어가는가 ----------
  // 이 프로브는 실백엔드를 띄우지 않는다(P4 지시 원문) — BACKEND_HTTP_BASE
  // (기본 127.0.0.1:8010)에 아무도 안 듣고 있으므로 athena:backtest-presets
  // 왕복이 곧 실패한다. mount()의 loadPresets()가 그 실패를 삼키지 않고
  // error 상태로 넘어가는지, 목업 프리셋으로 얼버무리지 않는지를 잰다.
  await wait(2000);
  const errorState = await backtestErrorState(shellWin);
  // 부제는 "있기만" 하면 안 된다 — 404 원문("Not Found")만 보여주던 판을
  // 2026-08-31 실측으로 잡았다. 사용자가 손쓸 수 있는 문장인지까지 잰다.
  const sub = errorState.sub || '';
  record(
    '04-백엔드 미기동 → 손쓸 수 있는 에러 문구(목업 없음)',
    errorState.rendered
      && errorState.title === '백테스트'
      && sub.length > 12
      && (sub.includes('백엔드') || sub.includes('불러오지')),
    errorState,
  );

  // ---------- (5) 대화 복귀 — 원상복구 ----------
  await clickNav(shellWin, 'modeNavSummary');
  await wait(300);
  const back = await surfaces(shellWin);
  record('05-대화 복귀', back.mosaic === false && back.backtest === true && back.canvasMode === 'chat', back);

  const okAll = report.steps.every((s) => s.ok);
  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'backtest-mode-probe.json'),
    JSON.stringify(report, null, 1)
  );
  console.log(`[probe-backtest-mode] ${okAll ? 'ALL OK' : 'FAIL'} (${report.steps.filter((s) => s.ok).length}/${report.steps.length})`);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* 앱 자식이 붙잡고 있으면 남긴다 — 다음 실행은 새 디렉터리다 */ }
  app.exit(okAll ? 0 : 1);
}

app.whenReady().then(() => main().catch((err) => {
  console.error('[probe-backtest-mode] 프로브 자체 오류:', err);
  app.exit(1);
}));
