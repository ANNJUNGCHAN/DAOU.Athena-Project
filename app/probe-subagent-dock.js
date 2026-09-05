// 하위 에이전트 도크 e2e 프로브(task #32) — 실배선 claude -p를 스폰하지 않고
// (window.athena.invoke를 렌더러 안에서 가로채 pending 상태로 묶는다,
// probe-turn-abort-record.js와 같은 기법) main.js가 실제로 내보내는 두
// 트래커(createToolStepTracker/createSubagentTracker, task #32 신규 export)에
// 합성 stream-json 이벤트를 직접 먹인다. 이벤트 순서·필드는
// app/captures/subagent-probe-1787815081507.ndjson(2026-08-27 worker-par 실측,
// 실 claude -p --output-format stream-json 캡처)에서 그대로 옮겼다 — 추측이
// 아니다. 이 프로브 자체는 그 파일을 안 읽는다(커밋 안 되는 captures/에
// 의존하면 재현성이 깨진다) — 값만 하드코딩해 합성한다.
//
// 아래는 main→renderer IPC부터 DOM까지 전부 실경로:
//   trackToolStep/trackSubagent(main.js) → shellWin.webContents.send(실 IPC)
//   → chat.js onLiveToolStep/onLiveSubagentStep(실 구독) → DOM
//
// 단언:
//   (1) 서브에이전트 내부 활동(Bash/mcp__athena__athena_search)이 최상위
//       진행 라인(.progress-tool-step)에 안 새고, Agent tool_use 자체도
//       거기 안 뜬다(둘 다 도크로 흡수)
//   (2) 하위 에이전트 도크에 행 2개 — 보드 37 실측 한 줄 "{이름} · {상태}"
//       (색점 is-running 토글), 카운트 "완료 / 전체" 포맷까지 실제 IPC로 정확
//   (3) 카드가 하나도 없는 턴 — 결과물·출처 행은 숨고 하위 에이전트 행만
//       보인다(도크 자체는 보인다) — 행별 독립 hidden 회귀 확인
//   (4) 서브에이전트 없는 별도 턴 — 하위 에이전트 행이 전혀 안 뜬다(기존
//       2단 도크 회귀)

process.env.ATHENA_NO_AUTOSTART = '1';
process.env.ATHENA_CANVAS_SOURCE = 'fixture';

const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const PROFILE = path.join(__dirname, '.probe-subagent-dock-profile');
fs.rmSync(PROFILE, { recursive: true, force: true });
fs.mkdirSync(PROFILE, { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'athena-onboarding.json'),
  JSON.stringify({ cliDone: true, accountDone: true }),
);
app.setPath('userData', PROFILE);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 합성 이벤트 — 실측 캡처(subagent-probe-1787815081507.ndjson) 그대로 옮김 ----------
const TASK_A = 'a89a5cffc32302b35';
const TOOLU_AGENT_A = 'toolu_01UngEhHX3JMVMfVgxuV2j8E';
const TOOLU_BASH_A = 'toolu_01RFxxxxxxxxxxxxxxxxxxxx';
const TASK_B = 'af51262199aaaaaaa';
const TOOLU_AGENT_B = 'toolu_015nEdVrvzSp4Lo2wqPEudKy';
const TOOLU_SEARCH_B = 'toolu_012Uxxxxxxxxxxxxxxxxxxx';

const events = [
  // 최상위 — 서브에이전트 A 시작 지시(parent:null, Agent tool_use).
  { type: 'assistant', parent_tool_use_id: null, message: { content: [
    { type: 'tool_use', id: TOOLU_AGENT_A, name: 'Agent', input: { description: 'Bash echo probe', subagent_type: 'general-purpose' } },
  ] } },
  { type: 'system', subtype: 'task_started', task_id: TASK_A, tool_use_id: TOOLU_AGENT_A, description: 'Bash echo probe', subagent_type: 'general-purpose' },
  { type: 'system', subtype: 'task_progress', task_id: TASK_A, description: 'Running Print hi to stdout', last_tool_name: 'Bash', usage: { duration_ms: 2524 } },
  // A 내부 — 진짜 작업(parent:A의 tool_use id). 최상위 진행 라인에 새면 안 된다.
  { type: 'assistant', parent_tool_use_id: TOOLU_AGENT_A, message: { content: [
    { type: 'tool_use', id: TOOLU_BASH_A, name: 'Bash', input: { command: 'echo hi' } },
  ] } },
  { type: 'user', parent_tool_use_id: TOOLU_AGENT_A, message: { content: [
    { type: 'tool_result', tool_use_id: TOOLU_BASH_A, content: 'hi', is_error: false },
  ] } },
  // 최상위 — 서브에이전트 B 시작 지시(A와 병렬).
  { type: 'assistant', parent_tool_use_id: null, message: { content: [
    { type: 'tool_use', id: TOOLU_AGENT_B, name: 'Agent', input: { description: 'athena_search probe', subagent_type: 'general-purpose' } },
  ] } },
  { type: 'system', subtype: 'task_started', task_id: TASK_B, tool_use_id: TOOLU_AGENT_B, description: 'athena_search probe', subagent_type: 'general-purpose' },
  { type: 'system', subtype: 'task_progress', task_id: TASK_B, description: 'Searching 삼성전자', last_tool_name: 'mcp__athena__athena_search', usage: { duration_ms: 1800 } },
  // A 완료 — task_updated → task_notification → 최상위로 결과 도착(parent:null).
  { type: 'system', subtype: 'task_updated', task_id: TASK_A, patch: { status: 'completed', end_time: Date.now() } },
  { type: 'system', subtype: 'task_notification', task_id: TASK_A, status: 'completed', summary: '(1) 시도한 명령: `echo hi`\n\n(2) 결과: 성공' },
  { type: 'user', parent_tool_use_id: null, message: { content: [
    { type: 'tool_result', tool_use_id: TOOLU_AGENT_A, content: '(1) 시도한 명령: echo hi\n(2) 결과: 성공', is_error: false },
  ] } },
  // B 내부 — mcp 호출(parent:B의 tool_use id).
  { type: 'assistant', parent_tool_use_id: TOOLU_AGENT_B, message: { content: [
    { type: 'tool_use', id: TOOLU_SEARCH_B, name: 'mcp__athena__athena_search', input: { query: '삼성전자' } },
  ] } },
  { type: 'user', parent_tool_use_id: TOOLU_AGENT_B, message: { content: [
    { type: 'tool_result', tool_use_id: TOOLU_SEARCH_B, content: '[{"stk_cd":"005930"}]', is_error: false },
  ] } },
  // B 완료.
  { type: 'system', subtype: 'task_updated', task_id: TASK_B, patch: { status: 'completed', end_time: Date.now() } },
  { type: 'system', subtype: 'task_notification', task_id: TASK_B, status: 'completed', summary: '005930 찾음' },
  { type: 'user', parent_tool_use_id: null, message: { content: [
    { type: 'tool_result', tool_use_id: TOOLU_AGENT_B, content: '005930', is_error: false },
  ] } },
];

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

  // 질의를 영원히 pending으로 묶는다 — 렌더러의 window.athena는 contextBridge 객체라 갈아끼울 수
  // 없으므로(대입이 조용히 무시된다) main 쪽 핸들러를 바꾼다(2026-09-05).
  ipcMain.removeHandler('athena__render_canvas');
  ipcMain.handle('athena__render_canvas', () => new Promise(() => {}));

  // ---------- 케이스 A: 서브에이전트 2개짜리 턴 ----------
  shellWin.webContents.executeJavaScript("window.runQueryLive('테스트 — 서브에이전트 2개')");
  await wait(300);

  const trackToolStep = mainMod.createToolStepTracker();
  const trackSubagent = mainMod.createSubagentTracker();
  for (const ev of events) {
    trackToolStep(ev);
    trackSubagent(ev);
    await wait(30); // IPC가 렌더러에 그려질 시간
  }
  await wait(300);

  const snapshot = await shellWin.webContents.executeJavaScript(`(() => {
    const topLevelSteps = Array.from(document.querySelectorAll('.progress-tool-step .progress-tool-step-label'))
      .map((el) => el.textContent);
    // Paper 44(2026-09-05): 하위 에이전트는 도크 행이 아니라 이력의 에이전트 카드 하나다.
    const card = document.querySelector('.agent-card');
    const agentRows = card ? Array.from(card.querySelectorAll('.agent-card-row')).map((row) => ({
      label: row.querySelector('.agent-card-row-name').textContent + ' · ' + row.querySelector('.agent-card-row-state').textContent,
      isRunning: row.querySelector('.agent-card-row-cell').classList.contains('is-running'),
      hasDot: !!row.querySelector('.agent-card-row-cell'),
    })) : [];
    return {
      topLevelSteps,
      agentRowCount: agentRows.length,
      agentRows,
      agentCountLabel: card ? card.querySelector('.agent-card-count').textContent : null,
      cellCount: card ? card.querySelectorAll('.agent-card-grid .agent-card-cell').length : 0,
      doneCellCount: card ? card.querySelectorAll('.agent-card-grid .agent-card-cell.is-done').length : 0,
      cardCount: document.querySelectorAll('.agent-card').length,
      resultDockHidden: document.querySelector('.result-dock').hidden,
    };
  })()`);
  console.log('[probe] 케이스A 스냅샷:', JSON.stringify(snapshot, null, 1));

  const noSubagentLeakage = !snapshot.topLevelSteps.some((l) => l === '처리 중' || l.includes('echo'))
    && snapshot.topLevelSteps.length === 0; // Bash/mcp/Agent 전부 도크로 흡수 — 최상위엔 아무 것도 안 남는다

  // 이름은 task_progress가 오면 최신 값으로 갱신된다(설계대로 — 연구 문서 §2b
  // "도크에 라벨을 쓴다면 이 필드가 매 progress마다 바뀔 수 있음을 감안해야
  // 한다"). 두 케이스 다 progress의 최신 설명으로 찾는다.
  const rowA = snapshot.agentRows.find((r) => r.label === 'Running Print hi to stdout · 완료');
  const rowB = snapshot.agentRows.find((r) => r.label === 'Searching 삼성전자 · 완료');
  const rowsOk = snapshot.agentRowCount === 2
    && !!rowA && rowA.isRunning === false && rowA.hasDot
    && !!rowB && rowB.isRunning === false && rowB.hasDot;

  const visibilityOk = snapshot.resultDockHidden === true // 카드 0개 — 결과물 바는 숨는다(Paper 44)
    && snapshot.cardCount === 1 // 턴에 카드 하나
    && snapshot.cellCount === 2 && snapshot.doneCellCount === 2 // 격자 = 에이전트 수, 둘 다 완료
    && snapshot.agentCountLabel === '2개';

  // 이 턴을 정리(abort)한다 — 다음 케이스를 깨끗한 상태에서 시작하기 위해.
  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
  );
  await wait(300);

  // ---------- 케이스 B: 서브에이전트 없는 턴 — 기존 2단 도크 회귀 ----------
  shellWin.webContents.executeJavaScript("window.runQueryLive('테스트 — 서브에이전트 없음')");
  await wait(300);
  shellWin.webContents.send('athena:live-tool-step', { id: 'plain-step', label: '조회', done: false });
  await wait(200);
  const regressionSnapshot = await shellWin.webContents.executeJavaScript(`(() => ({
    // 케이스A의 카드는 기록으로 남는다(Paper 44) — 새 턴이 카드를 하나도 더 만들지 않아야 한다.
    cardCountNow: document.querySelectorAll('.agent-card').length,
    liveCardAfterProgress: !!(document.querySelector('.progress-line') && document.querySelector('.progress-line').nextElementSibling
      && document.querySelector('.progress-line').nextElementSibling.querySelector('.agent-card')),
  }))()`);
  console.log('[probe] 케이스B(에이전트 없음) 스냅샷:', JSON.stringify(regressionSnapshot));
  // 케이스A의 잔여 행(2개)이 새 턴 시작 시 지워지고, 이번 턴엔 하나도 안 늘어야 한다.
  const regressionOk = regressionSnapshot.cardCountNow === 1 && regressionSnapshot.liveCardAfterProgress === false;

  await shellWin.webContents.executeJavaScript(
    "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
  );
  await wait(200);

  console.log('[probe] 렌더러 콘솔 에러 로그 수:', consoleErrors.length);

  const ok = noSubagentLeakage && rowsOk && visibilityOk && regressionOk && consoleErrors.length === 0;

  fs.mkdirSync(path.join(__dirname, 'captures'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, 'captures', 'probe-subagent-dock.json'),
    JSON.stringify({
      snapshot, noSubagentLeakage, rowsOk, visibilityOk, regressionSnapshot, regressionOk, consoleErrors, ok,
    }, null, 1),
  );
  console.log('[probe] 최종 판정:', ok);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error('[probe] 실패:', e); app.exit(1); });
