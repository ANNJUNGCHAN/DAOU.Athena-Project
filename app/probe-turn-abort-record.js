// Esc 중단 턴 기록 보존 e2e 프로브(task #26, AC10 반전) — 진행 중이던 실배선
// 질의를 Escape로 중단했을 때, 이미 실행된 도구 단계가 접힌 기록으로
// 남는지(아니면 남지 않아야 하는지)를 실측한다. 실제 claude -p를 스폰하지
// 않는다 — window.athena.invoke('athena__render_canvas', ...)만 렌더러
// 안에서 가로채 영원히 pending으로 묶어두고, 그 사이 main→renderer 실경로
// (athena:live-tool-step IPC)로 합성 단계를 흘려보낸다. 아래는 전부 실경로:
//   Escape keydown → chat.js Esc 핸들러 → foldExecutionRecord(aborted:true)
//   → DOM(.turn-exec-header.is-aborted)
//
// 단언:
//   (1) 도구 단계가 있던 채로 중단 → .turn-exec-record가 생긴다("N초 만에
//       중단됨" 라벨, warn-dot, 접기 캐럿 — 클릭하면 펼쳐진다)
//   (2) 도구 단계가 하나도 없던 채로(순수 판단 중) 중단 → 기록이 안 생긴다
//       (완료 턴의 "빈 기록 → null" 분기와 같은 취급, 기존 동작 유지)
//   (3) 중단 후 잠금 해제 — 새 질의를 다시 보낼 수 있다(상태 정리 확인)

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture'; // 이 프로브는 canvasSource 자체를 안 씀 — 그냥 검증 프로필 관례

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-turn-abort-record-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const mainMod = require('./main.js');
  await mainMod.createWindows();
  const { shellWin } = mainMod.getWins();
  const consoleErrors = [];
  shellWin.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) consoleErrors.push(message);
  });

  for (let i = 0; i < 100; i += 1) {
    const hidden = await shellWin.webContents.executeJavaScript("document.getElementById('app').hidden");
    if (hidden === false) break;
    await wait(100);
  }

  // window.athena.invoke를 렌더러 안에서 가로챈다 — athena__render_canvas만
  // 영원히 pending인 Promise로 묶고(claude -p 스폰 없음), 나머지 채널은
  // 원래 구현 그대로 통과시킨다. runQueryLive는 top-level function 선언이라
  // (chat.js가 IIFE로 안 감싸는 classic script) window.runQueryLive로 직접
  // 호출 가능하다 — 새 진입점을 만들지 않는다.
  await shellWin.webContents.executeJavaScript(`(() => {
    const origInvoke = window.athena.invoke.bind(window.athena);
    window.athena.invoke = (channel, payload) => {
      if (channel === 'athena__render_canvas') return new Promise(() => {}); // 영원히 pending
      return origInvoke(channel, payload);
    };
  })()`);

  // ---------- (1) 도구 단계가 있던 채로 중단 ----------
  shellWin.webContents.executeJavaScript("window.runQueryLive('테스트 — 도구 단계 있는 중단')");
  await wait(300);
  shellWin.webContents.send('athena:live-tool-step', { id: 'step-1', label: '종목 조회', done: false });
  await wait(150);
  shellWin.webContents.send('athena:live-tool-step', { id: 'step-1', label: '종목 조회', done: true, elapsedMs: 820 });
  await wait(150);

  const beforeEscape1 = await shellWin.webContents.executeJavaScript(`(() => ({
    progressToolStepRows: document.querySelectorAll('.progress-tool-step').length,
    hasToolStepStatesBridge: true, // liveProgressEl은 window에 없어 여기선 DOM 결과로만 판정
  }))()`);
  console.log('[probe] Escape 전 진행 라인 상태(1):', JSON.stringify(beforeEscape1));

  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
  );
  await wait(300);

  const afterEscape1 = await shellWin.webContents.executeJavaScript(`(() => {
    const header = document.querySelector('.turn-exec-header.is-aborted');
    const dot = header ? header.querySelector('.turn-fail-dot') : null;
    const label = header ? header.querySelector('.turn-exec-header-label') : null;
    const steps = header ? header.closest('.turn-exec-record').querySelector('.progress-tool-steps') : null;
    return {
      recordCount: document.querySelectorAll('.turn-exec-record').length,
      headerPresent: !!header,
      dotPresent: !!dot,
      labelText: label ? label.textContent : null,
      stepsHiddenInitially: steps ? steps.hidden : null,
      stepRowCount: steps ? steps.querySelectorAll('.progress-tool-step').length : 0,
      progressLineGone: document.querySelectorAll('.progress-line').length === 0,
      inputLocked: document.getElementById('input') ? document.getElementById('input').disabled : null,
    };
  })()`);
  console.log('[probe] Escape 후(1, 도구 단계 있음):', JSON.stringify(afterEscape1));

  // 클릭하면 펼쳐지는지(접기 어포던스 유지) — 완료 헤더와 동일 계약.
  const afterClick = await shellWin.webContents.executeJavaScript(`(() => {
    const header = document.querySelector('.turn-exec-header.is-aborted');
    header.click();
    const steps = header.closest('.turn-exec-record').querySelector('.progress-tool-steps');
    return { hiddenAfterClick: steps.hidden, caret: header.querySelector('.turn-exec-header-caret').textContent };
  })()`);
  console.log('[probe] 헤더 클릭 후(펼침 기대):', JSON.stringify(afterClick));

  const case1Ok = afterEscape1.recordCount === 1
    && afterEscape1.headerPresent === true
    && afterEscape1.dotPresent === true
    && /^\d+초 만에 중단됨$/.test(afterEscape1.labelText || '')
    && afterEscape1.stepsHiddenInitially === true
    && afterEscape1.stepRowCount === 1
    && afterEscape1.progressLineGone === true
    && afterClick.hiddenAfterClick === false
    && afterClick.caret === '⌃';

  // ---------- (2) 도구 단계 없이(순수 판단 중) 중단 — 기록 없어야 한다 ----------
  const recordCountBefore2 = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.turn-exec-record').length",
  );
  shellWin.webContents.executeJavaScript("window.runQueryLive('테스트 — 판단 중 즉시 중단')");
  await wait(200); // 도구 단계 이벤트를 하나도 안 보낸다
  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
  );
  await wait(300);
  const recordCountAfter2 = await shellWin.webContents.executeJavaScript(
    "document.querySelectorAll('.turn-exec-record').length",
  );
  console.log('[probe] 케이스2(도구 단계 없음) — 중단 전/후 기록 수:', recordCountBefore2, recordCountAfter2);
  const case2Ok = recordCountAfter2 === recordCountBefore2; // 새 기록이 안 생겼다

  // ---------- (3) 중단 후 입력 잠금 해제 확인 ----------
  const unlocked = await shellWin.webContents.executeJavaScript(
    "!document.getElementById('input').disabled",
  );
  console.log('[probe] 중단 후 입력 잠금 해제:', unlocked);

  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);

  const ok = case1Ok && case2Ok && unlocked === true && consoleErrors.length === 0;

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-turn-abort-record.json'),
    JSON.stringify({
      beforeEscape1, afterEscape1, afterClick, case1Ok,
      recordCountBefore2, recordCountAfter2, case2Ok,
      unlocked, consoleErrors, ok,
    }, null, 1),
  );
  console.log('[probe] 최종 판정:', ok);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
