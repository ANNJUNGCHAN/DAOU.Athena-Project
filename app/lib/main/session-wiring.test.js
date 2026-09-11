'use strict';

// 세션 저장 배선의 형상 계약(명세 4절 "언제 쓰는가"). 저장 타이밍 정책은
// session-bridge가 소유하고, main.js는 정해진 다섯 자리에서만 브리지를 부른다.
// 자리가 하나라도 빠지면 어떤 턴은 저장되고 어떤 턴은 안 되는 반쪽 저장이 된다 —
// 그것이 "일부 저장"이고, 사용자가 금지한 것이다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker missing: ${startMarker}`);
  // 끝 표식은 시작 표식 뒤에서 찾는다 — 같은 접두(ipcMain.handle()로 시작하는 다음 핸들러를 끝으로 쓸 수 있게.
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  assert.ok(end > start, `end marker missing: ${endMarker}`);
  return source.slice(start, end);
}

test('사용자 메시지는 질의가 모델로 가기 전에 세션에 적히고, 실패하면 턴을 시작하지 않는다', () => {
  const run = slice('async function runLiveQuery(', 'async function runLiveQueryInner(');
  const touchAt = run.indexOf('touchConversationEntry(query, turnConversationId);');
  const beginAt = run.indexOf('beginSessionTurn(turnConversationId, query');
  const busyAt = run.indexOf('liveQueryBusyDepth += 1');
  assert.ok(touchAt >= 0 && beginAt > touchAt && beginAt < busyAt, '이력 touch 뒤·busy 진입 전이어야 한다');
  assert.match(run, /if \(sessionTurnError\) return \{ ok: false/);
});

test('답변은 자리표시자로 먼저 적히고, 델타는 저널되며, 툴 단계는 이벤트로 저장된다', () => {
  const inner = slice('async function runLiveQueryInner(', '// finalResult.result는 claude -p의 마지막 assistant 텍스트다');
  assert.match(inner, /const sessionAssistantId = crypto\.randomUUID\(\)/);
  assert.match(inner, /bridge\.runAssistantTurn\(\{[\s\S]*?sessionId: turnConversationId,[\s\S]*?messageId: sessionAssistantId,/);
  assert.match(inner, /run: \(\) => runLiveQueryInnerBody\(query, expand, origin, turnConversationId, sessionAssistantId\)/);
  assert.match(inner, /createToolStepTracker\(\(step\) => \{[\s\S]*?bridge\.recordToolStep\(/);
  assert.match(inner, /onTextDelta: \(text, metadata\) => \{[\s\S]*?sendLiveTextDelta\(text, \{ \.\.\.metadata, conversationId: turnConversationId \}, origin\);[\s\S]*?bridge\.journalDelta\(/);
  // 세션 재시도로 Inner에 다시 들어가기 전에 첫 시도의 자리표시자를 중단으로 확정한다.
  const retryAt = inner.indexOf('return runLiveQueryInner(query, expand, origin, turnConversationId);');
  const interruptAt = inner.lastIndexOf('interrupted: true', retryAt);
  assert.ok(retryAt > 0 && interruptAt > 0 && retryAt - interruptAt < 400, '재시도 직전에 interrupted 확정이 있어야 한다');
});

test('턴이 끝나면 최종 텍스트·usage·오류를 한 번에 적는다', () => {
  const tail = slice('const answerText = resolveTerminalAnswerText(', 'return {');
  assert.match(tail, /resolveTerminalAnswerText\(\s*result\.finalResult && typeof result\.finalResult\.result === 'string' \? result\.finalResult\.result : null,\s*terminalAnswerText,\s*\)/);
  assert.match(tail, /bridge\.finishAssistant\(\{[\s\S]*?text: answerText === null \? undefined : answerText,[\s\S]*?interrupted: !result\.ok,/);
});

test('종료 경로가 대기 중인 세션 쓰기를 동기로 마저 쓴다', () => {
  const quit = slice('conversations.flushSync();', 'app.on(');
  assert.match(quit, /sessionBridge\.flushSync\(\)/);
});

test('렌더러 보고 채널과 복원 채널이 main에 있고, 세션 id는 main의 기록 대상을 쓴다', () => {
  for (const channel of ['athena:session-load', 'athena:session-replay-cards']) {
    assert.match(source, new RegExp(`ipcMain\\.handle\\('${channel}'`), channel);
  }
  for (const channel of ['athena:session-cards', 'athena:session-workspace', 'athena:session-viewport']) {
    const handler = slice(`ipcMain.on('${channel}'`, '});');
    assert.match(handler, /historyConversationId\(\)/, `${channel}는 main의 기록 대상을 세션 id로 쓴다`);
    assert.doesNotMatch(handler, /payload\.sessionId/, `${channel}는 렌더러가 보낸 id를 믿지 않는다`);
  }
  // 워크스페이스는 조각(patch)을 병합하고 kind는 그 대화의 모드로 main이 찍는다.
  const workspace = slice("ipcMain.on('athena:session-workspace'", 'bridge.saveWorkspace({ sessionId, workspace: merged });');
  assert.match(workspace, /payload\.patch/);
  assert.match(workspace, /kind: record \? record\.mode : listed\.activeMode/);
  // 복원 재생은 봉투가 있는 카드만, 같은 페인트 채널로.
  const replay = slice("ipcMain.handle('athena:session-replay-cards'", 'return { replayed };');
  assert.match(replay, /if \(!card \|\| !card\.envelope\) continue;/);
  assert.match(replay, /'athena:add-canvas-live'/);
});

test('preload가 세션 채널을 연다', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
  const invoke = preload.slice(preload.indexOf('const INVOKE_CHANNELS'), preload.indexOf('const SEND_CHANNELS'));
  const send = preload.slice(preload.indexOf('const SEND_CHANNELS'), preload.indexOf('const ON_CHANNELS'));
  const on = preload.slice(preload.indexOf('const ON_CHANNELS'));
  assert.match(invoke, /'athena:session-load'/);
  assert.match(invoke, /'athena:session-replay-cards'/);
  for (const channel of ['athena:session-cards', 'athena:session-workspace', 'athena:session-viewport']) {
    assert.match(send, new RegExp(`'${channel}'`), channel);
  }
  assert.match(on, /'athena:session-run-state'/);
});

// 플러그인 제안·승인은 세 다리를 모두 쓴다 — 어느 하나가 빠지면 카드가 뜨지
// 않거나(ON), 대기 등록이 사라지거나(SEND), 승인 버튼이 죽는다(INVOKE).
// 세 집합은 별개 화이트리스트다.
test('preload가 플러그인 제안 채널을 연다', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
  const invoke = preload.slice(preload.indexOf('const INVOKE_CHANNELS'), preload.indexOf('const SEND_CHANNELS'));
  const send = preload.slice(preload.indexOf('const SEND_CHANNELS'), preload.indexOf('const ON_CHANNELS'));
  const on = preload.slice(preload.indexOf('const ON_CHANNELS'));
  for (const channel of ['athena:plugin-approve', 'athena:plugin-reject', 'athena:plugin-pending']) {
    assert.match(invoke, new RegExp(`'${channel}'`), channel);
  }
  assert.match(send, /'athena:plugin-noted'/);
  assert.doesNotMatch(send, /'athena:plugin-approve'/);
  assert.match(on, /'athena:plugin-proposed'/);
});

test('preload가 배포 무장 채널을 연다', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
  const invoke = preload.slice(preload.indexOf('const INVOKE_CHANNELS'), preload.indexOf('const SEND_CHANNELS'));
  for (const channel of [
    'athena:backtest-deployment-create',
    'athena:backtest-deployment-stop',
    'athena:backtest-deployment-arm',
  ]) {
    assert.match(invoke, new RegExp(`'${channel}'`), channel);
  }
});

// 승인 순서는 레지스트리의 decide가 소유한다(그 순서는 실제 호출로
// plugin-proposal-registry.test.js가 잠근다). main이 지킬 몫은 두 가지다 —
// 순서를 여기서 다시 적지 않는 것, 그리고 판번호를 한 번만 읽어 넘기는 것.
test('플러그인 승인은 레지스트리 decide 한 번에 판번호와 조정자를 넘긴다', () => {
  const approve = slice('async function handlePluginApprove', 'function handlePluginReject');
  assert.equal((approve.match(/pluginProposalRegistry\.decide\(/g) || []).length, 1);
  assert.match(approve, /revisionNow: revision/);
  // 묶음은 정확히 한 번만 조정자를 탄다 — 동작마다 부르면 재기동이 그만큼 반복된다.
  assert.equal((approve.match(/runMcpMutation\(/g) || []).length, 1);
  assert.match(approve, /actions\.some\(\(action\) => action && action\.action === 'update_snippet'\)/);
  assert.match(approve, /runMutation: requiresMutationCoordinator \? \(\(run\) => runMcpMutation\('plugin-batch', run\)\) : null/);
  // 순서를 main이 다시 적으면 검증 스크립트와 갈라진다.
  for (const dead of ['pluginProposalRegistry.gate(', 'pluginProposalRegistry.consume(', 'pluginProposalRegistry.probe(', 'pluginProposalRegistry.release(']) {
    assert.ok(!approve.includes(dead), `${dead}가 main에 남아 있다`);
  }
  // 판번호는 한 번만 읽어 게이트 실패 반환에도 그대로 싣는다(pluginResult가 다시 읽지 않는다).
  assert.equal((approve.match(/mcpCli\.list\(\)/g) || []).length, 1);
  assert.match(approve, /revision,/);
});

function loadPluginApprove(providerRuntimeEnabled, { coordinatorFails = false } = {}) {
  const calls = [];
  const block = slice('function pluginResult', 'function handlePluginReject');
  const context = {
    providerRuntimeEnabled,
    mcpCli: { list: () => ({ revision: 7 }) },
    pluginProposalRegistry: {
      async decide(envelope, { revisionNow, runMutation }) {
        calls.push(['decide', revisionNow, typeof runMutation]);
        const apply = async () => {
          calls.push(['applyAndPersist', envelope.actions[0].action, envelope.actions[0].target]);
          return {
            kind: 'success', reason: null,
            results: [{ action: envelope.actions[0].action, target: envelope.actions[0].target, ok: true }],
            probes: [],
          };
        };
        if (!runMutation) return apply();
        const coordinated = await runMutation(apply);
        if (coordinated && coordinated.ok === false) {
          return {
            kind: 'failed',
            reason: '기존 연결을 정리하지 못해 설정을 저장하지 않았습니다. 다시 시도해 주세요',
            results: [],
            probes: [],
            mutationError: coordinated.error,
          };
        }
        return coordinated;
      },
    },
    async runMcpMutation(kind, run) {
      calls.push(['runMcpMutation', kind]);
      calls.push([providerRuntimeEnabled ? 'fencePersistentRuntime' : 'terminateColdRuntime']);
      if (coordinatorFails) {
        return { ok: false, persisted: false, error: 'cold session termination failed' };
      }
      return run();
    },
    mdlog: () => {},
  };
  return {
    calls,
    approve: vm.runInNewContext(`${block}\nhandlePluginApprove`, context),
  };
}

test('기본 모드의 스니펫 수정은 cold 세션 종료 실패 시 적용·저장하지 않는다', async () => {
  const { calls, approve } = loadPluginApprove(false, { coordinatorFails: true });
  const result = await approve(null, {
    actions: [{ action: 'update_snippet', target: 'discord', snippet: '{}' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'failed');
  assert.match(result.reason, /설정을 저장하지 않았습니다/);
  assert.deepEqual(calls, [
    ['decide', 7, 'function'],
    ['runMcpMutation', 'plugin-batch'],
    ['terminateColdRuntime'],
  ]);
});

test('기본 모드의 스니펫 수정은 cold 세션 종료 후 적용·저장한다', async () => {
  const { calls, approve } = loadPluginApprove(false);
  const result = await approve(null, {
    actions: [{ action: 'update_snippet', target: 'discord', snippet: '{}' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['decide', 7, 'function'],
    ['runMcpMutation', 'plugin-batch'],
    ['terminateColdRuntime'],
    ['applyAndPersist', 'update_snippet', 'discord'],
  ]);
});

test('기본 모드의 다른 플러그인 동작은 기존 범위대로 조정자를 우회한다', async () => {
  const { calls, approve } = loadPluginApprove(false);
  const result = await approve(null, {
    actions: [{ action: 'set_enabled', target: 'discord', enabled: false }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['decide', 7, 'object'],
    ['applyAndPersist', 'set_enabled', 'discord'],
  ]);
});

test('상주 런타임 모드의 스니펫 수정은 계속 plugin-batch 조정자를 탄다', async () => {
  const { calls, approve } = loadPluginApprove(true);
  const result = await approve(null, {
    actions: [{ action: 'update_snippet', target: 'discord', snippet: '{}' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['decide', 7, 'function'],
    ['runMcpMutation', 'plugin-batch'],
    ['fencePersistentRuntime'],
    ['applyAndPersist', 'update_snippet', 'discord'],
  ]);
});

test('플러그인 거부는 아무 CLI도 부르지 않는다', () => {
  const reject = slice('function handlePluginReject', 'function handlePluginPending');
  assert.doesNotMatch(reject, /mcpCli\./);
});

// 39번 보드 — 실행은 백테스트 채널 응답에서 붙고, 폴링 응답으로 갱신되며, 목록에 얹혀 나간다.
test('백테스트 run·backfill 응답이 실행으로 붙고 status·result 폴링이 그것을 갱신한다', () => {
  const run = slice("ipcMain.handle('athena:backtest-run'", "ipcMain.handle('athena:backtest-status'");
  assert.match(run, /attachSessionJob\(res, 'run_id', 'backtest\.run'\)/);
  const backfill = slice("ipcMain.handle('athena:backtest-backfill'", 'ipcMain.handle(');
  assert.match(backfill, /attachSessionJob\(res, 'job_id', 'backtest\.backfill'\)/);
  const status = slice("ipcMain.handle('athena:backtest-status'", 'ipcMain.handle(');
  assert.match(status, /syncSessionJob\(job_id, res\)/);
  const result = slice("ipcMain.handle('athena:backtest-result'", 'ipcMain.handle(');
  assert.match(result, /syncSessionJob\(run_id, res\)/);
  // 실행의 주인은 main의 기록 대상 대화다 — 렌더러가 고르지 않는다.
  const attach = slice('function attachSessionJob(', 'function syncSessionJob(');
  assert.match(attach, /historyConversationId\(\)/);
  assert.match(attach, /ensureSessionRecord\(bridge, sessionId\)/);
  assert.match(attach, /status: 'running'/);
});

test('목록은 대표 실행 상태를 얹어 주고, 변화는 사이드바로 밀리며, 부팅 때 지난 실행을 정리한다', () => {
  const list = slice("ipcMain.handle('athena:conversations-list'", 'ipcMain.handle(');
  assert.match(list, /bridge\.runStates\(\)/);
  assert.match(list, /runState: states\[row\.id\] \|\| null/);
  const bridge = slice('function getSessionBridge() {', 'function sendSessionRunState(');
  assert.match(bridge, /onRunState: \(\{ sessionId, runState \}\) => sendSessionRunState\(sessionId, runState\)/);
  const send = slice('function sendSessionRunState(', 'function attachSessionJob(');
  assert.match(send, /'athena:session-run-state', \{ id, runState \}/);
  const boot = slice('app.whenReady().then(() => {', 'startBootReadinessForVerify');
  assert.match(boot, /reconcileSessionJobs\(\)/);
  // 답변 턴은 프로세스와 함께 죽었으니 바로 interrupted, 백테스트는 백엔드에 물어본다.
  const reconcile = slice('async function reconcileSessionJobs(', '// 사용자 메시지를 세션에 즉시 적는다');
  assert.match(reconcile, /job\.kind === 'chat\.turn'[\s\S]*?status: 'interrupted'/);
  assert.match(reconcile, /fetchRunResult\(/);
  assert.match(reconcile, /fetchJobStatus\(/);
});
