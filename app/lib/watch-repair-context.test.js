'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WatchFixCycle = require('./watch-fix-cycle');

const source = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const start = source.indexOf('function draftFixSeedText(');
const end = source.indexOf('function renderApprovalCard(', start);
assert.ok(start >= 0 && end > start, 'chat repair handler must exist');

function harness(detail, conversationId = 'chat-a') {
  const calls = [];
  const seeded = [];
  let opened = 0;
  const scope = {
    displayedConversationId: conversationId,
    openAgentCanvas: () => { opened += 1; },
    watchFixCycleLib: WatchFixCycle,
    window: {
      athena: {
        invoke: async (channel, body) => {
          calls.push({ channel, id: body.id });
          if (detail instanceof Error) throw detail;
          return { ok: true, data: detail };
        },
      },
      AthenaShell: { seedChatInput: (text) => seeded.push(text) },
    },
  };
  const repair = vm.runInNewContext(`${source.slice(start, end)}; beginWatchRepair`, scope);
  return { repair, calls, seeded, scope, opened: () => opened };
}

const blocked = {
  id: 'watch-draft', mode: 'code-watch', note: '삼성전자 거래량 감시',
  activation_blocker: '감시 코드 파일 없음 — 다시 만들기',
};

test('차단된 채팅 카드의 복구는 상세 설정을 읽고 승인 없이 에이전트 입력을 준비한다', async () => {
  const h = harness({
    ...blocked, symbol: '005930', cooldown_s: 86400, expires_at: '2026-10-03T17:52:48Z',
    condition: { source: 'code.watch', op: '==', value: true },
    watch: { project_id: 'project-1', path: 'watch/volume_spike.py', params: { days: 3, ratio: 1.5 }, poll_interval_s: 60 },
  });
  await h.repair(blocked);
  assert.equal(h.opened(), 1);
  assert.deepEqual(h.calls, [{ channel: 'athena:routine-detail', id: 'watch-draft' }]);
  assert.equal(h.seeded.length, 1);
  for (const value of ['watch-draft', '감시 코드 파일 없음', 'watch/volume_spike.py', '005930', '"days":3', '"ratio":1.5', '86400', '2026-10-03T17:52:48Z']) {
    assert.ok(h.seeded[0].includes(value), `recovery must retain ${value}`);
  }
});

test('상세 조회가 실패해도 기존 알람 식별자와 차단 사유를 잃지 않는다', async () => {
  const h = harness(new Error('offline'));
  await h.repair(blocked);
  assert.equal(h.calls.length, 1);
  assert.match(h.seeded[0], /watch-draft/);
  assert.match(h.seeded[0], /감시 코드 파일 없음/);
  assert.match(h.seeded[0], /프로젝트 만들기|폴더 열기/);
});

test('일반 코드 감시 수정은 조건을 임의로 복구하지 않고 기존 문구를 유지한다', async () => {
  const h = harness(null);
  await h.repair({ id: 'normal', mode: 'code-watch', note: '정상 초안' });
  assert.equal(h.opened(), 1);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.seeded, ['"정상 초안" 초안을 고쳐줘 — ']);
});

test('상세를 읽는 동안 다른 대화로 이동하면 복구 문구를 새 대화 입력에 넣지 않는다', async () => {
  const h = harness({ ...blocked, symbol: '005930' });
  const pending = h.repair(blocked, 'chat-a');
  h.scope.displayedConversationId = 'chat-b';
  await pending;
  assert.equal(h.opened(), 1);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.seeded, []);
});

test('캔버스의 프로젝트 소실 복구는 재생성 전에 폴더 연결을 안내한다', async () => {
  const h = harness(null);
  await h.repair({
    repair: true, routineId: 'missing-folder', title: '폴더 소실',
    reason: '프로젝트 폴더 없음 — 다시 연결',
    watch: { project_id: 'stale-project', path: 'watch/volume_spike.py' },
  });
  assert.deepEqual(h.calls, []);
  assert.match(h.seeded[0], /missing-folder/);
  assert.match(h.seeded[0], /폴더 열기/);
  assert.match(h.seeded[0], /연결/);
});
