'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionStore, createSessionStore, jobRunState } = require('./session-store');
const snapshot = require('../session-snapshot');

const MODE_LIST = Array.isArray(snapshot.MODES) ? snapshot.MODES : Object.values(snapshot.MODES || {});
const MODE_A = MODE_LIST[0];
const MODE_B = MODE_LIST[1];

function openStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-sess-'));
  const store = createSessionStore({ dbPath: path.join(dir, 'athena-sessions.sqlite3') });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

test('dbPath 없이 만들면 TypeError로 즉시 막는다', () => {
  assert.throws(() => new SessionStore({ dbPath: '' }), TypeError);
});

test('세션을 만들고 다시 열면 모드·프로젝트·워크스페이스 종류가 그대로다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '첫 세션' });
  store.saveWorkspace('sess_1', { kind: MODE_A, form: { symbol: '005930' } });

  const loaded = store.getSession('sess_1');
  assert.equal(loaded.id, 'sess_1');
  assert.equal(loaded.mode, MODE_A);
  assert.equal(loaded.projectId, 'proj_a');
  assert.equal(loaded.workspace.kind, MODE_A);
  assert.equal(store.getSession('없는-세션'), null);
});

test('같은 id로 두 번 만들어도 세션은 하나다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '원래 제목' });
  store.createSession({ id: 'sess_1', mode: MODE_B, projectId: 'proj_b', title: '덮어쓰기 시도' });

  const rows = store.listSessions();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mode, MODE_A);
  assert.equal(rows[0].projectId, 'proj_a');
  assert.equal(rows[0].title, '원래 제목');
});

test('메시지를 이어 붙이면 seq 순서와 currentId가 따라온다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });

  const first = store.appendMessage('sess_1', { id: 'm1', role: 'user', text: '질문', done: true });
  const second = store.appendMessage('sess_1', { id: 'm2', parentId: 'm1', role: 'assistant', text: '답', done: true });
  const third = store.appendMessage('sess_1', { id: 'm3', parentId: 'm2', role: 'user', text: '이어서', done: true });

  assert.equal(first.messageId, 'm1');
  assert.ok(second.revision > first.revision);
  assert.ok(third.revision > second.revision);

  const loaded = store.getSession('sess_1');
  assert.deepEqual(loaded.messages.map((m) => m.id), ['m1', 'm2', 'm3']);
  assert.equal(loaded.currentId, 'm3');
  assert.equal(store.appendMessage('없는-세션', { id: 'm9', role: 'user', text: 'x' }), null);
});

test('첫 user 메시지가 제목을 만들고, 사용자가 정한 제목은 자동이 못 덮는다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a' });
  store.appendMessage('sess_1', { id: 'm1', role: 'user', text: '추세추종 전략을 백테스트해줘', done: true });

  const auto = store.listSessions()[0];
  assert.ok(auto.title);
  assert.equal(auto.titleSource, 'auto');

  assert.equal(store.setTitle('sess_1', '내가 지은 제목', 'user'), true);
  assert.equal(store.setTitle('sess_1', '자동이 지은 제목', 'auto'), false);

  const locked = store.listSessions()[0];
  assert.equal(locked.title, '내가 지은 제목');
  assert.equal(locked.titleSource, 'user');
});

test('스트리밍 저널은 같은 행을 부분 갱신한다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });
  store.appendMessage('sess_1', { id: 'm1', role: 'assistant', text: '안녕', done: false });

  const patched = store.updateMessage('sess_1', 'm1', { text: '안녕하세요, 더 길어진 응답' });
  const message = store.getSession('sess_1').messages.find((m) => m.id === 'm1');
  assert.equal(message.text, '안녕하세요, 더 길어진 응답');
  assert.equal(message.done, false);
  assert.ok(patched.revision > 1);

  store.updateMessage('sess_1', 'm1', { done: true, usage: { inputTokens: 12 } });
  const finished = store.getSession('sess_1').messages.find((m) => m.id === 'm1');
  assert.equal(finished.done, true);
  assert.equal(finished.text, '안녕하세요, 더 길어진 응답');
  assert.equal(store.updateMessage('sess_1', '없는-메시지', { text: 'x' }), null);
});

test('카드 스택은 배열 순서로 seq를 다시 받고 지우면 사라진다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });
  store.putCards('sess_1', [
    { cardId: 'c1', kind: '시세', channel: 'chat', envelope: { v: 1 } },
    { cardId: 'c2', kind: '차트', channel: 'chat', envelope: { v: 1 } },
  ]);
  store.putCards('sess_1', [
    { cardId: 'c2', kind: '차트', channel: 'chat', envelope: { v: 2 } },
    { cardId: 'c1', kind: '시세', channel: 'chat', envelope: { v: 1 } },
  ]);

  const cards = store.getSession('sess_1').canvasCards;
  assert.deepEqual(cards.map((c) => c.cardId), ['c2', 'c1']);
  assert.deepEqual(cards.map((c) => c.seq), [0, 1]);
  assert.deepEqual(cards[0].envelope, { v: 2 });

  assert.equal(store.removeCard('sess_1', 'c2'), true);
  assert.equal(store.removeCard('sess_1', 'c2'), false);
  assert.deepEqual(store.getSession('sess_1').canvasCards.map((c) => c.cardId), ['c1']);
});

test('워크스페이스는 revision을 올리고 뷰포트는 올리지 않는다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });

  const saved = store.saveWorkspace('sess_1', { kind: MODE_A, filters: { period: '1y' } });
  assert.equal(store.listSessions()[0].revision, saved.revision);

  assert.equal(store.saveViewport('sess_1', { chat: { anchorMessageId: 'm1', atBottom: false } }), true);
  assert.equal(store.listSessions()[0].revision, saved.revision);

  const loaded = store.getSession('sess_1');
  assert.equal(loaded.workspace.kind, MODE_A);
  assert.equal(loaded.viewport.chat.anchorMessageId, 'm1');
  assert.equal(store.saveViewport('없는-세션', {}), false);
});

test('목록은 모드·프로젝트로 거르고 보관함은 기본에서 빠진다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_a', mode: MODE_A, projectId: 'proj_a', title: 'A' });
  store.createSession({ id: 'sess_b', mode: MODE_B, projectId: 'proj_a', title: 'B' });
  store.createSession({ id: 'sess_c', mode: MODE_A, projectId: 'proj_b', title: 'C' });

  assert.deepEqual(store.listSessions({ mode: MODE_A }).map((r) => r.id).sort(), ['sess_a', 'sess_c']);
  assert.deepEqual(store.listSessions({ projectId: 'proj_a' }).map((r) => r.id).sort(), ['sess_a', 'sess_b']);

  assert.equal(store.setArchived('sess_a', true), true);
  assert.deepEqual(store.listSessions({ mode: MODE_A }).map((r) => r.id), ['sess_c']);
  assert.deepEqual(
    store.listSessions({ mode: MODE_A, includeArchived: true }).map((r) => r.id).sort(),
    ['sess_a', 'sess_c'],
  );
  assert.equal(store.setPinned('sess_c', true), true);
  assert.equal(store.listSessions({ mode: MODE_A })[0].pinned, true);
});

test('heartbeat가 끊긴 running job은 interrupted로 정리된다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });
  const now = '2026-09-03T00:10:00.000Z';
  store.attachJob('sess_1', {
    id: 'job_old', kind: 'backtest.run', status: 'running',
    attachedAt: '2026-09-03T00:00:00.000Z', heartbeatAt: '2026-09-03T00:00:30.000Z',
  });
  store.attachJob('sess_1', {
    id: 'job_live', kind: 'backtest.run', status: 'running',
    attachedAt: '2026-09-03T00:09:00.000Z', heartbeatAt: '2026-09-03T00:09:55.000Z',
  });

  assert.deepEqual(store.listJobs('sess_1').map((j) => j.id), ['job_old', 'job_live']);
  assert.equal(store.updateJob('job_live', { progress: { pct: 42 } }), true);
  assert.equal(store.updateJob('없는-job', { progress: { pct: 1 } }), false);

  assert.equal(store.reconcileStaleJobs({ staleMs: 60_000, now }), 1);
  const jobs = store.listJobs('sess_1');
  assert.equal(jobs.find((j) => j.id === 'job_old').status, 'interrupted');
  assert.equal(jobs.find((j) => j.id === 'job_live').status, 'running');
  assert.deepEqual(jobs.find((j) => j.id === 'job_live').progress, { pct: 42 });
});

test('본문 검색은 메시지 텍스트로 세션을 찾아준다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });
  store.appendMessage('sess_1', { id: 'm1', role: 'user', text: '이동평균 교차 전략을 만들어줘', done: true });
  store.appendMessage('sess_1', { id: 'm2', role: 'assistant', text: '변동성 돌파로 바꿨습니다', done: true });

  const hits = store.searchMessages('이동평균');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sessionId, 'sess_1');
  assert.equal(hits[0].messageId, 'm1');
  assert.equal(hits[0].mode, MODE_A);
  assert.ok(hits[0].snippet.includes('이동평균'));
  assert.equal(store.searchMessages('없는말').length, 0);
  assert.equal(store.searchMessages('').length, 0);
});

test('세션 삭제는 네 테이블에서 모두 지운다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });
  store.appendMessage('sess_1', { id: 'm1', role: 'user', text: '지워질 본문', done: true });
  store.putCards('sess_1', [{ cardId: 'c1', kind: '시세', channel: 'chat', envelope: { v: 1 } }]);
  store.attachJob('sess_1', { id: 'job_1', kind: 'backtest.run', status: 'done' });

  assert.equal(store.deleteSession('sess_1'), true);
  assert.equal(store.getSession('sess_1'), null);
  assert.equal(store.listJobs('sess_1').length, 0);
  assert.equal(store.searchMessages('지워질 본문').length, 0);
  const cards = store.db.prepare('SELECT COUNT(*) AS count FROM session_cards WHERE session_id = ?').get('sess_1');
  assert.equal(cards.count, 0);
  assert.equal(store.deleteSession('sess_1'), false);
});

test('손상된 workspace_json이 있어도 세션은 열린다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_1', mode: MODE_A, projectId: 'proj_a', title: '제목' });
  store.appendMessage('sess_1', { id: 'm1', role: 'user', text: '살아남을 본문', done: true });
  store.db.prepare('UPDATE sessions SET workspace_json = ? WHERE id = ?').run('{잘린 json', 'sess_1');

  const loaded = store.getSession('sess_1');
  assert.equal(loaded.id, 'sess_1');
  assert.equal(loaded.messages.length, 1);
  assert.ok(loaded.workspace);
});

test('putCards는 넘어온 배열을 스택의 전부로 본다 — 빠진 카드는 지운다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-sess-stack-'));
  const store = createSessionStore({ dbPath: path.join(dir, 's.sqlite3') });
  try {
    store.createSession({ id: 'S', mode: 'chat', projectId: 'default', title: 't' });
    store.putCards('S', [{ cardId: 'a', kind: 'table', channel: 'fixture' }, { cardId: 'b', kind: 'chart', channel: 'live' }]);
    assert.equal(store.getSession('S').canvasCards.length, 2);
    // 다시 그린 뒤 보고: b만 남았다(a는 닫힘) → a는 지워지고 b만 남는다.
    store.putCards('S', [{ cardId: 'b', kind: 'chart', channel: 'live' }]);
    const cards = store.getSession('S').canvasCards;
    assert.deepEqual(cards.map((c) => c.cardId), ['b']);
    assert.equal(cards[0].seq, 0);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runStates는 세션마다 점 하나 — 실행 중 > 대기 > 실패 > 완료, job 없는 세션은 키가 없다', (t) => {
  const store = openStore(t);
  store.createSession({ id: 'sess_run', mode: MODE_A, projectId: 'proj_a', title: '도는 중' });
  store.createSession({ id: 'sess_done', mode: MODE_A, projectId: 'proj_a', title: '끝남' });
  store.createSession({ id: 'sess_idle', mode: MODE_A, projectId: 'proj_a', title: '없음' });
  store.attachJob('sess_run', { id: 'j1', kind: 'backtest.run', status: 'done' });
  store.attachJob('sess_run', { id: 'j2', kind: 'chat.turn', status: 'running' });
  store.attachJob('sess_done', { id: 'j3', kind: 'backtest.run', status: 'cancelled' });
  store.attachJob('sess_done', { id: 'j4', kind: 'backtest.run', status: 'interrupted' });
  assert.deepEqual(store.runStates(), { sess_run: 'running', sess_done: 'failed' });
  assert.equal(store.getJob('j2').sessionId, 'sess_run');
  assert.equal(store.getJob('없음'), null);
  assert.deepEqual(store.listJobsByStatus('running').map((j) => j.id), ['j2']);
  assert.equal(jobRunState('queued'), 'waiting');
  assert.equal(jobRunState('모름'), null);
});
