'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const conversations = require('./conversations');

async function withTempState(initial, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-conversations-test-'));
  const file = path.join(dir, 'conversations.json');
  const previous = process.env.ATHENA_CONVERSATIONS_PATH;
  process.env.ATHENA_CONVERSATIONS_PATH = file;
  if (initial !== undefined) fs.writeFileSync(file, JSON.stringify(initial), 'utf-8');
  try {
    return await fn(file);
  } finally {
    if (previous === undefined) delete process.env.ATHENA_CONVERSATIONS_PATH;
    else process.env.ATHENA_CONVERSATIONS_PATH = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('이전 단일 목록 상태를 기본 프로젝트로 마이그레이션한다', async () => {
  await withTempState({
    activeId: 'old-1',
    conversations: [{
      id: 'old-1', title: '이전 대화',
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
    }],
  }, () => {
    const state = conversations.list();
    assert.deepEqual(state.projects, [{ id: 'default', label: '기본 프로젝트' }]);
    assert.equal(state.currentProjectId, 'default');
    assert.equal(state.conversations[0].projectId, 'default');
    assert.equal(state.activeId, 'old-1');
  });
});

test('begin은 새 id/프로젝트를 활성화하지만 첫 touch 전에는 목록에 추가하지 않는다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [],
  }, (file) => {
    const begun = conversations.begin({ id: 'fresh-1', projectId: 'p1' });
    assert.equal(begun.activeId, 'fresh-1');
    assert.equal(begun.currentProjectId, 'p1');
    assert.deepEqual(begun.conversations, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')).conversations, []);

    const touched = conversations.touch({ id: 'fresh-1', title: '첫 질문' });
    assert.equal(touched.conversations.length, 1);
    assert.deepEqual(touched.conversations[0], {
      id: 'fresh-1',
      title: '첫 질문',
      createdAt: touched.conversations[0].createdAt,
      updatedAt: touched.conversations[0].updatedAt,
      projectId: 'p1',
    });

    conversations.touch({ id: 'fresh-1', title: '두 번째 질문' });
    const afterSecondTouch = conversations.list();
    assert.equal(afterSecondTouch.conversations.length, 1);
    assert.equal(afterSecondTouch.conversations[0].title, '첫 질문');
  });
});

test('프로젝트/최근 투영은 같은 conversation 객체와 id를 공유한다', () => {
  const state = conversations.normalizeState({
    projects: [{ id: 'p1', label: '프로젝트 1' }, { id: 'p2', label: '프로젝트 2' }],
    currentProjectId: 'p1',
    conversations: [
      { id: 'c1', title: '하나', projectId: 'p1', updatedAt: '2026-08-02T00:00:00.000Z' },
      { id: 'c2', title: '둘', projectId: 'p2', updatedAt: '2026-08-03T00:00:00.000Z' },
    ],
  });
  const recent = [...state.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const projected = conversations.projectConversations(state, 'p1');
  assert.equal(projected.length, 1);
  assert.equal(projected[0], recent.find((row) => row.id === 'c1'));
  assert.equal(projected[0].id, 'c1');
});

test('setActive는 선택 대화의 프로젝트도 현재 프로젝트로 맞춘다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '프로젝트 1' }, { id: 'p2', label: '프로젝트 2' }],
    currentProjectId: 'p1',
    conversations: [{ id: 'c2', title: '둘', projectId: 'p2', updatedAt: '2026-08-03T00:00:00.000Z' }],
  }, () => {
    const selected = conversations.setActive('c2');
    assert.equal(selected.activeId, 'c2');
    assert.equal(selected.currentProjectId, 'p2');
  });
});

test('연속으로 몰아친 touch가 서로를 덮어써 갱신을 잃지 않는다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [],
  }, async (file) => {
    for (let i = 0; i < 20; i++) {
      conversations.touch({ id: `rapid-${i}`, title: `질문 ${i}` });
    }
    await conversations.flush();

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(onDisk.conversations.length, 20);
    const ids = onDisk.conversations.map((row) => row.id).sort();
    assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => `rapid-${i}`).sort());
  });
});
