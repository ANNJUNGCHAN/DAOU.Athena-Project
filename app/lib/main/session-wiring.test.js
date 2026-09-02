'use strict';

// 세션 저장 배선의 형상 계약(명세 4절 "언제 쓰는가"). 저장 타이밍 정책은
// session-bridge가 소유하고, main.js는 정해진 다섯 자리에서만 브리지를 부른다.
// 자리가 하나라도 빠지면 어떤 턴은 저장되고 어떤 턴은 안 되는 반쪽 저장이 된다 —
// 그것이 "일부 저장"이고, 사용자가 금지한 것이다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker missing: ${startMarker}`);
  const end = endMarker ? source.indexOf(endMarker, start) : source.length;
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
  assert.match(inner, /bridge\.beginAssistant\(\{ sessionId: turnConversationId, messageId: sessionAssistantId \}\)/);
  assert.match(inner, /createToolStepTracker\(\(step\) => \{[\s\S]*?bridge\.recordToolStep\(/);
  assert.match(inner, /onTextDelta: \(text, metadata\) => \{[\s\S]*?sendLiveTextDelta\(text, metadata\);[\s\S]*?bridge\.journalDelta\(/);
  // 세션 재시도로 Inner에 다시 들어가기 전에 첫 시도의 자리표시자를 중단으로 확정한다.
  const retryAt = inner.indexOf('return runLiveQueryInner(query, expand, origin, turnConversationId);');
  const interruptAt = inner.lastIndexOf('interrupted: true', retryAt);
  assert.ok(retryAt > 0 && interruptAt > 0 && retryAt - interruptAt < 400, '재시도 직전에 interrupted 확정이 있어야 한다');
});

test('턴이 끝나면 최종 텍스트·usage·오류를 한 번에 적는다', () => {
  const tail = slice("const answerText = result.finalResult && typeof result.finalResult.result === 'string'", 'return {');
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
  assert.match(invoke, /'athena:session-load'/);
  assert.match(invoke, /'athena:session-replay-cards'/);
  for (const channel of ['athena:session-cards', 'athena:session-workspace', 'athena:session-viewport']) {
    assert.match(send, new RegExp(`'${channel}'`), channel);
  }
});
