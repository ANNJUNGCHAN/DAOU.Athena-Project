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
      mode: 'chat',
      resumeSessionId: null,
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

test('대화는 만들어진 모드에 묶인다 — begin의 view가 레코드의 mode가 된다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [],
  }, () => {
    // 사이드바는 view 어휘('summary')를 보내고 레코드는 mode 어휘('chat')로 남는다.
    conversations.begin({ id: 'c-chat', projectId: 'p1', mode: 'summary' });
    const chat = conversations.touch({ id: 'c-chat', title: '수급 물어봄' });
    assert.equal(chat.conversations[0].mode, 'chat');
    assert.equal(chat.activeMode, 'chat');

    conversations.begin({ id: 'c-bt', projectId: 'p1', mode: 'backtest' });
    const bt = conversations.touch({ id: 'c-bt', title: '추세추종 v3' });
    assert.equal(bt.activeMode, 'backtest');
    assert.equal(bt.conversations.find((c) => c.id === 'c-bt').mode, 'backtest');
    // 앞 대화의 모드는 그대로다 — 모드가 대화의 경계다.
    assert.equal(bt.conversations.find((c) => c.id === 'c-chat').mode, 'chat');
  });
});

test('이미 있는 대화의 모드는 나중 touch가 바꾸지 못한다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [],
  }, () => {
    conversations.begin({ id: 'c1', projectId: 'p1', mode: 'graph' });
    conversations.touch({ id: 'c1', title: '성향 지도' });
    const after = conversations.touch({ id: 'c1', title: '무시됨', mode: 'backtest' });
    assert.equal(after.conversations[0].mode, 'graph');
    assert.equal(after.activeMode, 'graph');
  });
});

test('setActive는 그 대화의 모드로 activeMode를 옮긴다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [
      { id: 'a', title: '대화', projectId: 'p1', mode: 'chat', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'b', title: '백테스트', projectId: 'p1', mode: 'backtest', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' },
    ],
  }, () => {
    assert.equal(conversations.setActive('b').activeMode, 'backtest');
    assert.equal(conversations.setActive('a').activeMode, 'chat');
  });
});

test('mode가 없는 옛 레코드는 마이그레이션 없이 chat으로 읽힌다', () => {
  const state = conversations.normalizeState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [{ id: 'old', title: '옛 대화', projectId: 'p1' }],
  });
  assert.equal(state.conversations[0].mode, 'chat');
  assert.equal(state.activeMode, 'chat');
});

test('setResumeCursor는 대화마다 Claude 커서를 따로 적고, setActive가 그것을 돌려준다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [],
  }, () => {
    conversations.touch({ id: 'a', title: '첫 대화', mode: 'chat' });
    conversations.touch({ id: 'b', title: '둘째 대화', mode: 'backtest' });
    assert.equal(conversations.setResumeCursor({ id: 'a', resumeSessionId: 'sess-A' }), true);
    assert.equal(conversations.setResumeCursor({ id: '없음', resumeSessionId: 'x' }), false);
    const a = conversations.setActive('a');
    assert.equal(a.conversations.find((c) => c.id === 'a').resumeSessionId, 'sess-A');
    // 다른 대화의 커서는 그대로 비어 있다 — 커서는 대화마다 따로 산다.
    assert.equal(a.conversations.find((c) => c.id === 'b').resumeSessionId, null);
  });
});

test('addProject는 폴더 이름을 프로젝트 이름으로 삼고 현재 프로젝트를 그리로 옮긴다', async () => {
  await withTempState(undefined, async (file) => {
    const folder = path.join(path.dirname(file), '추세추종 v3');
    const added = conversations.addProject({ path: folder });
    assert.equal(added.ok, true);
    assert.equal(added.project.label, '추세추종 v3');
    assert.equal(added.project.path, folder);
    assert.equal(added.project.pinned, false);
    assert.match(added.project.id, /^proj-/);
    assert.equal(added.state.currentProjectId, added.project.id);

    await conversations.flush();
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const saved = onDisk.projects.find((row) => row.id === added.project.id);
    assert.equal(saved.path, folder);
    assert.equal(saved.pinned, false);
    assert.equal(onDisk.currentProjectId, added.project.id);
  });
});

test('같은 폴더로 두 번 만들면 거절된다 — 대소문자·구분자가 달라도', async () => {
  await withTempState(undefined, () => {
    const folder = path.join(path.dirname(process.env.ATHENA_CONVERSATIONS_PATH), 'quant');
    const first = conversations.addProject({ path: folder, label: '내 전략' });
    assert.equal(first.ok, true);

    const disguised = folder.split(path.sep).join('/').toUpperCase();
    const second = conversations.addProject({ path: disguised, label: '또 하나' });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'folder_taken');
    assert.equal(second.project.id, first.project.id);
    assert.equal(conversations.list().projects.filter((row) => row.path).length, 1);
  });
});

test('addProject는 백엔드가 준 id를 그대로 쓰고, 같은 id는 거절한다', async () => {
  await withTempState(undefined, () => {
    const dir = path.dirname(process.env.ATHENA_CONVERSATIONS_PATH);
    const first = conversations.addProject({ id: 'proj_backend_1', path: path.join(dir, 'a') });
    assert.equal(first.ok, true);
    assert.equal(first.project.id, 'proj_backend_1');
    assert.equal(conversations.projectById('proj_backend_1').path, path.join(dir, 'a'));

    const second = conversations.addProject({ id: 'proj_backend_1', path: path.join(dir, 'b') });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'id_taken');
    assert.equal(second.project.id, 'proj_backend_1');
  });
});

test('normalizeState는 같은 폴더의 프로젝트 중복을 하나로 접는다', () => {
  const state = conversations.normalizeState({
    projects: [
      { id: 'p1', label: '먼저', path: 'C:/quant/my' },
      { id: 'p2', label: '나중', path: 'C:/QUANT/my' },
      { id: 'p3', label: '다른 폴더', path: 'C:/quant/other' },
    ],
  });
  assert.deepEqual(state.projects.map((row) => row.id), ['p1', 'p3']);
});

test('setProjectPinned는 프로젝트를 맨 앞으로 올리고, 해제하면 원래 자리로 돌아온다', async () => {
  await withTempState({
    projects: [
      { id: 'p1', label: '하나' },
      { id: 'p2', label: '둘' },
      { id: 'p3', label: '셋' },
    ],
    currentProjectId: 'p1',
    conversations: [],
  }, () => {
    const pinned = conversations.setProjectPinned('p3', true);
    assert.deepEqual(pinned.projects.map((row) => row.id), ['p3', 'p1', 'p2']);
    assert.equal(pinned.projects[0].pinned, true);

    const released = conversations.setProjectPinned('p3', false);
    assert.deepEqual(released.projects.map((row) => row.id), ['p1', 'p2', 'p3']);
    assert.deepEqual(conversations.setProjectPinned('없음', true).projects.map((row) => row.id), ['p1', 'p2', 'p3']);
  });
});

test('updateProject는 이름·설명만 고치고, 빈 이름은 거절한다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '하나', path: 'C:\athena', pinned: true }],
    currentProjectId: 'p1',
    conversations: [],
  }, () => {
    const updated = conversations.updateProject({ id: 'p1', label: ' 아테나 ', description: '연구 노트' });
    assert.equal(updated.ok, true);
    assert.equal(updated.project.label, '아테나');
    assert.equal(updated.project.description, '연구 노트');
    assert.equal(updated.project.pinned, true);      // 고정·폴더는 그대로다.
    assert.equal(updated.project.path, 'C:\athena');
    assert.equal(updated.state.projects[0].label, '아테나');

    const cleared = conversations.updateProject({ id: 'p1', label: '아테나', description: '   ' });
    assert.equal(cleared.ok, true);
    assert.equal('description' in cleared.project, false); // 빈 설명은 필드를 지운다.

    assert.deepEqual(conversations.updateProject({ id: 'p1', label: '  ' }), { ok: false, reason: 'invalid_label' });
    assert.deepEqual(conversations.updateProject({ id: '없음', label: 'x' }), { ok: false, reason: 'unknown_project' });
    assert.equal(conversations.list().projects[0].label, '아테나'); // 거절은 아무것도 바꾸지 않는다.
  });
});

test('removeProject는 프로젝트와 그 대화들을 지우고 현재 프로젝트·활성 대화를 정리한다', async () => {
  await withTempState({
    projects: [{ id: 'p1', label: '하나' }, { id: 'p2', label: '둘', path: 'C:/quant/two' }],
    currentProjectId: 'p2',
    activeId: 'c2',
    conversations: [
      { id: 'c1', title: '남는다', projectId: 'p1', updatedAt: '2026-09-01T00:00:00.000Z' },
      { id: 'c2', title: '지워진다', projectId: 'p2', updatedAt: '2026-09-02T00:00:00.000Z' },
    ],
  }, async (file) => {
    const removed = conversations.removeProject('p2');
    assert.equal(removed.ok, true);
    assert.equal(removed.removed.project.path, 'C:/quant/two');
    assert.deepEqual(removed.removed.conversationIds, ['c2']);
    assert.deepEqual(removed.state.projects.map((row) => row.id), ['p1']);
    assert.deepEqual(removed.state.conversations.map((row) => row.id), ['c1']);
    assert.equal(removed.state.currentProjectId, 'p1');
    assert.equal(removed.state.activeId, null);

    await conversations.flush();
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.deepEqual(onDisk.projects.map((row) => row.id), ['p1']);
    assert.deepEqual(onDisk.conversations.map((row) => row.id), ['c1']);
  });
});

test('기본 프로젝트는 지울 수 없다', async () => {
  await withTempState(undefined, () => {
    const refused = conversations.removeProject('default');
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, 'default_project');
    assert.deepEqual(conversations.list().projects.map((row) => row.id), ['default']);
  });
});

test('path가 없는 옛 프로젝트 레코드는 path:null·pinned:false로 읽힌다', () => {
  const state = conversations.normalizeState({
    projects: [{ id: 'p1', label: '프로젝트 1' }],
    currentProjectId: 'p1',
    conversations: [],
  });
  assert.equal(state.projects[0].path, null);
  assert.equal(state.projects[0].pinned, false);
});
