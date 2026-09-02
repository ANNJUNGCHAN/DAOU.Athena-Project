'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MODES,
  SCHEMA_VERSION,
  isMode,
  createSnapshot,
  normalizeSnapshot,
  normalizeMessage,
  normalizeCard,
  messagePath,
  appendMessage,
  updateMessage,
  putCard,
  removeCard,
  mergeWorkspace,
  mergeViewport,
  attachJob,
  updateJobSeen,
  bumpRevision,
  titleFrom,
} = require('./session-snapshot');

const T0 = '2026-09-03T00:00:00.000Z';
const T1 = '2026-09-03T01:23:45.000Z';

function baseSnapshot(mode) {
  return createSnapshot({ id: 'sess_1', mode: mode || 'chat', projectId: 'default', now: T0 });
}

test('createSnapshot — 모드마다 workspace.kind가 따라온다', () => {
  for (const mode of MODES) {
    const snap = createSnapshot({ id: 'sess_1', mode, now: T0 });
    assert.equal(snap.mode, mode);
    assert.equal(snap.workspace.kind, mode);
  }
  assert.equal(createSnapshot({ id: 'sess_1', mode: 'nope', now: T0 }).mode, 'chat');
  assert.equal(createSnapshot({ id: 'sess_1', mode: 'nope', now: T0 }).workspace.kind, 'chat');
  assert.equal(isMode('backtest'), true);
  assert.equal(isMode('unknown'), false);
});

test('createSnapshot — 주입한 now가 두 시각에 그대로 쓰이고 기본값이 채워진다', () => {
  const snap = createSnapshot({ id: 'sess_1', mode: 'backtest', title: '추세추종 v3', now: T0 });
  assert.equal(snap.schemaVersion, SCHEMA_VERSION);
  assert.equal(snap.createdAt, T0);
  assert.equal(snap.updatedAt, T0);
  assert.equal(snap.revision, 0);
  assert.equal(snap.title, '추세추종 v3');
  assert.equal(snap.titleSource, 'auto');
  assert.equal(snap.projectId, 'default');
  assert.equal(snap.currentId, null);
  assert.deepEqual(snap.messages, []);
  assert.deepEqual(snap.canvasCards, []);
  assert.deepEqual(snap.jobs, []);
  assert.deepEqual(Object.keys(snap.viewport).sort(), ['canvas', 'chat', 'editor', 'sidebar']);
  assert.equal(createSnapshot({ id: 'sess_1', now: T0 }).titleSource, 'fallback');
});

test('normalizeSnapshot — null·문자열·배열도 던지지 않고 유효 레코드가 된다', () => {
  for (const raw of [null, undefined, '세션', 42, []]) {
    const snap = normalizeSnapshot(raw);
    assert.equal(snap.schemaVersion, SCHEMA_VERSION);
    assert.equal(snap.mode, 'chat');
    assert.equal(snap.workspace.kind, 'chat');
    assert.equal(snap.projectId, 'default');
    assert.equal(snap.title, '(제목 없음)');
    assert.equal(snap.revision, 0);
    assert.deepEqual(snap.messages, []);
  }
});

test('normalizeSnapshot — 부분 객체는 채우고 모르는 키·잘못된 원소는 버린다', () => {
  const snap = normalizeSnapshot({
    id: 'sess_9',
    mode: 'graph',
    revision: -3,
    createdAt: T0,
    쓸데없는키: 1,
    messages: [null, 7, 'x', { id: 'm1', text: '첫' }, { id: 'm1', text: '중복' }, { text: 'id없음' }],
    canvasCards: [{ cardId: 'c1', seq: 99 }, 'nope', { kind: 'chart' }],
    jobs: [{ id: 'job_1', kind: 'backtest.run' }, {}],
  });
  assert.equal(snap.mode, 'graph');
  assert.equal(snap.revision, 0);
  assert.equal(snap.createdAt, T0);
  assert.equal(snap.updatedAt, T0);
  assert.equal(snap.쓸데없는키, undefined);
  assert.deepEqual(snap.messages.map((m) => m.id), ['m1']);
  assert.equal(snap.messages[0].text, '첫');
  assert.deepEqual(snap.canvasCards.map((c) => [c.cardId, c.seq]), [['c1', 0]]);
  assert.deepEqual(snap.jobs.map((j) => j.id), ['job_1']);
  assert.deepEqual(snap.jobs[0].lastSeen, { status: null, pct: null, at: null });
});

test('normalizeMessage·normalizeCard — 기본값과 형 강제', () => {
  const message = normalizeMessage({ id: 'm1', toolSteps: 'nope', usage: { in: 1 } });
  assert.equal(message.role, 'user');
  assert.equal(message.parentId, null);
  assert.equal(message.done, true);
  assert.deepEqual(message.toolSteps, []);
  assert.deepEqual(message.usage, { in: 1 });
  assert.equal(normalizeMessage({ id: 'm1', done: false }).done, false);
  const card = normalizeCard({ cardId: 'c1', live: 1, protected: 'yes' });
  assert.equal(card.live, true);
  assert.equal(card.protected, true);
  assert.equal(card.envelope, null);
  assert.equal(card.dataRef, null);
});

test('appendMessage — currentId를 옮기고 parentId를 잇는다(원본 불변)', () => {
  const snap = baseSnapshot('chat');
  const one = appendMessage(snap, { id: 'm1', role: 'user', text: '안녕' });
  const two = appendMessage(one, { id: 'm2', role: 'assistant', done: false });
  assert.equal(one.currentId, 'm1');
  assert.equal(one.messages[0].parentId, null);
  assert.equal(two.currentId, 'm2');
  assert.equal(two.messages[1].parentId, 'm1');
  assert.equal(two.messages.length, 2);
  // 명시한 parentId는 형제 생성이므로 currentId보다 우선한다.
  const sibling = appendMessage(two, { id: 'm3', role: 'assistant', parentId: 'm1' });
  assert.equal(sibling.messages[2].parentId, 'm1');
  assert.equal(sibling.currentId, 'm3');
  // 불변 — 원본과 중간본이 그대로다.
  assert.equal(snap.messages.length, 0);
  assert.equal(snap.currentId, null);
  assert.equal(one.messages.length, 1);
  assert.equal(two.messages.length, 2);
  assert.equal(two.currentId, 'm2');
});

test('messagePath — 분기 트리에서 currentId 경로만 돌려준다', () => {
  const messages = [
    { id: 'm1', parentId: null, done: true },
    { id: 'm2', parentId: 'm1', done: true },
    { id: 'm3', parentId: 'm1', done: true },
    { id: 'm4', parentId: 'm3', done: true },
  ];
  assert.deepEqual(messagePath(messages, 'm4').map((m) => m.id), ['m1', 'm3', 'm4']);
  assert.deepEqual(messagePath(messages, 'm2').map((m) => m.id), ['m1', 'm2']);
  // currentId가 없거나 끊기면 마지막 done 메시지까지의 경로.
  assert.deepEqual(messagePath(messages, null).map((m) => m.id), ['m1', 'm3', 'm4']);
  assert.deepEqual(messagePath(messages, 'msg_사라짐').map((m) => m.id), ['m1', 'm3', 'm4']);
  assert.deepEqual(messagePath([{ id: 'm1', parentId: null, done: false }], null), []);
  assert.deepEqual(messagePath(null, 'm1'), []);
});

test('messagePath — 순환 parentId에서 멈춘다', () => {
  const cycle = [
    { id: 'a', parentId: 'b', done: true },
    { id: 'b', parentId: 'a', done: true },
  ];
  assert.deepEqual(messagePath(cycle, 'a').map((m) => m.id), ['b', 'a']);
  const selfLoop = [{ id: 'x', parentId: 'x', done: true }];
  assert.deepEqual(messagePath(selfLoop, 'x').map((m) => m.id), ['x']);
});

test('updateMessage — 부분 갱신, 없는 id는 무변경', () => {
  const snap = appendMessage(baseSnapshot('chat'), {
    id: 'm1', role: 'assistant', text: '흐르는 중', done: false,
  });
  const patched = updateMessage(snap, 'm1', {
    text: '완성', done: true, usage: { out: 12 }, 모르는키: 'x', role: undefined,
  });
  assert.equal(patched.messages[0].text, '완성');
  assert.equal(patched.messages[0].done, true);
  assert.deepEqual(patched.messages[0].usage, { out: 12 });
  assert.equal(patched.messages[0].role, 'assistant');
  assert.equal(patched.messages[0].모르는키, undefined);
  assert.equal(snap.messages[0].text, '흐르는 중');
  assert.equal(snap.messages[0].done, false);
  assert.equal(updateMessage(snap, 'msg_없음', { text: 'x' }), snap);
});

test('putCard·removeCard — 교체·추가와 seq 재부여', () => {
  const snap = baseSnapshot('backtest');
  const one = putCard(snap, { cardId: 'c1', kind: '시세', seq: 42 });
  const two = putCard(one, { cardId: 'c2', kind: '차트' });
  assert.deepEqual(two.canvasCards.map((c) => [c.cardId, c.seq]), [['c1', 0], ['c2', 1]]);
  const replaced = putCard(two, { cardId: 'c1', kind: '호가', live: true });
  assert.equal(replaced.canvasCards.length, 2);
  assert.equal(replaced.canvasCards[0].kind, '호가');
  assert.equal(replaced.canvasCards[0].seq, 0);
  assert.equal(two.canvasCards[0].kind, '시세');
  const removed = removeCard(replaced, 'c1');
  assert.deepEqual(removed.canvasCards.map((c) => [c.cardId, c.seq]), [['c2', 0]]);
  assert.equal(replaced.canvasCards.length, 2);
  assert.equal(removeCard(removed, 'c_없음').canvasCards.length, 1);
});

test('mergeWorkspace — undefined는 무시하고 kind는 mode로 강제', () => {
  const snap = baseSnapshot('backtest');
  const one = mergeWorkspace(snap, {
    kind: 'chat', form: { stkCd: '005930', period: '1y' }, log: undefined,
  });
  assert.equal(one.workspace.kind, 'backtest');
  assert.deepEqual(one.workspace.form, { stkCd: '005930', period: '1y' });
  assert.equal('log' in one.workspace, false);
  // 깊이 2 병합 — 안쪽 키는 덮어쓰되 undefined는 남긴다.
  const two = mergeWorkspace(one, { form: { period: '3y', stkCd: undefined }, filters: { tf: 'D' } });
  assert.deepEqual(two.workspace.form, { stkCd: '005930', period: '3y' });
  assert.deepEqual(two.workspace.filters, { tf: 'D' });
  assert.deepEqual(one.workspace.form, { stkCd: '005930', period: '1y' });
});

test('mergeViewport — 알려진 영역만 깊이 2로 병합', () => {
  const snap = baseSnapshot('chat');
  const one = mergeViewport(snap, { chat: { atBottom: true }, 모르는영역: { x: 1 } });
  assert.deepEqual(one.viewport.chat, { atBottom: true });
  assert.equal(one.viewport.모르는영역, undefined);
  const two = mergeViewport(one, { chat: { anchorMessageId: 'm1', atBottom: undefined } });
  assert.deepEqual(two.viewport.chat, { atBottom: true, anchorMessageId: 'm1' });
  assert.deepEqual(snap.viewport.chat, {});
});

test('attachJob·updateJobSeen — id로 교체하고 lastSeen만 갱신', () => {
  const snap = attachJob(baseSnapshot('backtest'), {
    id: 'job_1', kind: 'backtest.run', attachedAt: T0,
  });
  assert.deepEqual(snap.jobs.map((j) => j.id), ['job_1']);
  const seen = updateJobSeen(snap, 'job_1', { status: 'running', pct: 42, at: T1 });
  assert.deepEqual(seen.jobs[0].lastSeen, { status: 'running', pct: 42, at: T1 });
  assert.equal(seen.jobs[0].kind, 'backtest.run');
  assert.deepEqual(snap.jobs[0].lastSeen, { status: null, pct: null, at: null });
  const partial = updateJobSeen(seen, 'job_1', { pct: 80 });
  assert.deepEqual(partial.jobs[0].lastSeen, { status: 'running', pct: 80, at: T1 });
  assert.equal(updateJobSeen(seen, 'job_없음', { pct: 1 }), seen);
  assert.equal(attachJob(snap, { id: 'job_1', kind: 'backtest.run', attachedAt: T1 }).jobs.length, 1);
});

test('bumpRevision — revision과 updatedAt만 오른다', () => {
  const snap = baseSnapshot('chat');
  const one = bumpRevision(snap, T1);
  assert.equal(one.revision, 1);
  assert.equal(one.updatedAt, T1);
  assert.equal(one.createdAt, T0);
  assert.equal(bumpRevision(one, T1).revision, 2);
  // 변경 함수는 revision을 올리지 않는다 — 호출자가 명시적으로 올린다.
  assert.equal(appendMessage(snap, { id: 'm1' }).revision, 0);
  assert.equal(snap.revision, 0);
  assert.equal(snap.updatedAt, T0);
});

test('titleFrom — 40자 절단·공백 정리·빈 값', () => {
  assert.equal(titleFrom('  추세추종\n\n  v3  '), '추세추종 v3');
  assert.equal(titleFrom(''), '(제목 없음)');
  assert.equal(titleFrom(null), '(제목 없음)');
  assert.equal(titleFrom('   '), '(제목 없음)');
  const long = '가'.repeat(41);
  assert.equal(titleFrom(long), `${'가'.repeat(40)}…`);
  assert.equal(titleFrom('가'.repeat(40)), '가'.repeat(40));
});

const sessionSnapshot = require('./session-snapshot');

test('viewToMode·modeToView — summary와 chat을 잇는다', () => {
  assert.equal(sessionSnapshot.viewToMode('summary'), 'chat');
  assert.equal(sessionSnapshot.modeToView('chat'), 'summary');
  for (const mode of ['graph', 'agent', 'plugin', 'backtest']) {
    assert.equal(sessionSnapshot.viewToMode(mode), mode);
    assert.equal(sessionSnapshot.modeToView(mode), mode);
  }
  assert.equal(sessionSnapshot.viewToMode('없는것'), 'chat');
  assert.equal(sessionSnapshot.modeToView('없는것'), 'summary');
  assert.equal(sessionSnapshot.viewToMode(null), 'chat');
  assert.equal(sessionSnapshot.modeToView(undefined), 'summary');
});
