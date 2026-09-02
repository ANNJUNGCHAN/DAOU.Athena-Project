// project-ide.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (backtest-canvas.test.js가 세운 관례를 그대로 쓴다).
//
// 이 파일이 지키는 계약: 트리는 접히고 걸러진다, .py만 편집기로 들어온다(D3),
// 저장은 디스크로 나간다(D2), 저장 안 한 버퍼는 탭을 옮겨도 살아 있다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const projectIde = require('./project-ide');
const { createProjectIde, basename, isPython, filterEntries } = projectIde;

const PROJECT = {
  id: 'p1',
  name: '내 전략',
  path: 'C:\\Users\\me\\.athena\\projects\\내 전략',
  kind: 'managed',
  created_at: '2026-09-02T00:00:00Z',
  exists: true,
  py_files: 2,
};

const TREE = [
  {
    name: 'data',
    path: 'data',
    is_dir: true,
    py: false,
    size: 0,
    children: [
      { name: 'prices.csv', path: 'data/prices.csv', is_dir: false, py: false, size: 120 },
    ],
  },
  {
    name: 'strategies',
    path: 'strategies',
    is_dir: true,
    py: false,
    size: 0,
    children: [
      { name: 'golden.py', path: 'strategies/golden.py', is_dir: false, py: true, size: 40 },
    ],
  },
  { name: 'strategy.py', path: 'strategy.py', is_dir: false, py: true, size: 30 },
];

const FILE_TEXT = {
  'strategy.py': 'PARAMS = {"fast": 5}\n',
  'strategies/golden.py': 'PARAMS = {"slow": 20}\n',
};

function fakeNode(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    type: '',
    placeholder: '',
    value: '',
    checked: false,
    hidden: false,
    readOnly: false,
    spellcheck: true,
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
    children: [],
    attrs: {},
    _listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'class') this.className = String(v);
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    addEventListener(type, handler) {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    },
    dispatchEvent(event) {
      const handlers = this._listeners[event && event.type] || [];
      return Promise.all(handlers.map((h) => h(event)));
    },
  };
  return node;
}

test.beforeEach(() => {
  global.document = {
    createElement: (tag) => fakeNode(tag),
    createTextNode: (text) => ({ tag: '#text', textContent: text, children: [] }),
  };
});

test.afterEach(() => {
  delete global.document;
});

function findByClass(node, cls) {
  const found = [];
  const walk = (n) => {
    if (String(n.className || '').split(/\s+/).includes(cls)) found.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return found;
}

function textOf(node) {
  const parts = [];
  const walk = (n) => {
    if (n.textContent && !(n.children || []).length) parts.push(n.textContent);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return parts.join(' ');
}

async function click(node) {
  await node.dispatchEvent({ type: 'click' });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeIde(overrides) {
  const written = [];
  const created = [];
  const renamed = [];
  const deleted = [];
  const deps = Object.assign({
    listProjects: async () => ({ projects: [PROJECT], notice: null }),
    tree: async () => ({ project_id: 'p1', root: PROJECT.path, entries: TREE, truncated: false }),
    readFile: async (_id, p) => ({ path: p, text: FILE_TEXT[p] || '', size: 1, mtime: 1, py: true }),
    writeFile: async (id, p, text) => { written.push({ id, path: p, text }); return { path: p, size: text.length, mtime: 2 }; },
    createFile: async (_id, p) => { created.push(p); return { path: p, is_dir: false, created_at: 'x' }; },
    renameFile: async (_id, from, to) => { renamed.push([from, to]); return { path: to, from, is_dir: false }; },
    deleteFile: async (_id, p) => { deleted.push(p); return { deleted: p, is_dir: false }; },
  }, overrides || {});
  const ide = createProjectIde({ deps });
  return { ide, root: ide.element, written, created, renamed, deleted, deps };
}

// 프로젝트를 고른 뒤의 상태까지 한 번에 간다 — 대부분의 테스트가 여기서 시작한다.
async function mountWithProject(made) {
  made.ide.mount();
  await flush();
  await click(findByClass(made.root, 'project-ide-project')[0]);
  await flush();
}

// ── 순수 계산 ───────────────────────────────────────────────────────────────

test('basename/isPython: 경로에서 이름과 파이썬 여부를 읽는다', () => {
  assert.equal(basename('strategies/golden.py'), 'golden.py');
  assert.equal(basename('strategy.py'), 'strategy.py');
  assert.equal(isPython('a/b.py'), true);
  assert.equal(isPython('a/b.PY'), true);
  assert.equal(isPython('a/b.csv'), false);
  assert.equal(isPython(null), false);
});

test('filterEntries: 파일 이름으로 거르고, 걸린 것이 있는 폴더만 남긴다', () => {
  const all = filterEntries(TREE, '');
  assert.equal(all.length, 3);
  const hit = filterEntries(TREE, 'golden');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, 'strategies');
  assert.equal(hit[0].children.length, 1);
  assert.equal(hit[0].children[0].path, 'strategies/golden.py');
  // 폴더 이름만 맞는 것은 남기지 않는다 — 무관한 파일이 딸려 나온다.
  assert.equal(filterEntries(TREE, 'data').length, 0);
});

// ── 프로젝트 고르기 ─────────────────────────────────────────────────────────

test('프로젝트가 없으면 고르기 줄과 안내만 그린다', async () => {
  const made = makeIde({ listProjects: async () => ({ projects: [], notice: null }) });
  made.ide.mount();
  await flush();
  assert.equal(findByClass(made.root, 'project-ide-project').length, 0);
  assert.equal(findByClass(made.root, 'project-ide-new-project').length, 1);
  assert.equal(findByClass(made.root, 'project-ide-open-folder').length, 1);
  assert.equal(findByClass(made.root, 'project-ide-body').length, 0);
  assert.match(textOf(made.root), /새 프로젝트/);
  assert.equal(made.ide.currentProject(), null);
});

test('레지스트리 notice를 그대로 한 줄로 적는다(감추지 않는다)', async () => {
  const made = makeIde({
    listProjects: async () => ({ projects: [], notice: '레지스트리 파일이 아직 없어 빈 목록으로 시작한다' }),
  });
  made.ide.mount();
  await flush();
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /레지스트리 파일이 아직 없어/);
});

test('새 프로젝트: 이름을 넣으면 만들고 바로 그 프로젝트로 들어간다', async () => {
  let asked = null;
  const made = makeIde({
    listProjects: async () => ({ projects: [], notice: null }),
    createProject: async (name) => { asked = name; return { project: PROJECT, seed: 'strategy.py' }; },
  });
  made.ide.mount();
  await flush();
  await click(findByClass(made.root, 'project-ide-new-project')[0]);
  const input = findByClass(made.root, 'project-ide-project-name')[0];
  input.value = '내 전략';
  await input.dispatchEvent({ type: 'input' });
  await click(findByClass(made.root, 'project-ide-project-go')[0]);
  await flush();
  assert.equal(asked, '내 전략');
  assert.equal(made.ide.currentProject().id, 'p1');
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /strategy\.py로 시작합니다/);
});

test('폴더 열기: 네이티브 대화상자 경로를 open으로 넘긴다 — 취소면 아무 일도 없다', async () => {
  let opened = null;
  let picked = { canceled: true, path: null };
  const made = makeIde({
    listProjects: async () => ({ projects: [], notice: null }),
    openDialog: async () => picked,
    openProject: async (p) => { opened = p; return { project: PROJECT }; },
  });
  made.ide.mount();
  await flush();
  await click(findByClass(made.root, 'project-ide-open-folder')[0]);
  await flush();
  assert.equal(opened, null);
  assert.equal(made.ide.currentProject(), null);

  picked = { canceled: false, path: 'D:\\quant\\my' };
  await click(findByClass(made.root, 'project-ide-open-folder')[0]);
  await flush();
  assert.equal(opened, 'D:\\quant\\my');
  assert.equal(made.ide.currentProject().id, 'p1');
});

// ── 파일 트리 ───────────────────────────────────────────────────────────────

test('트리가 중첩 폴더와 파일을 그린다 — 폴더를 누르면 접힌다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  assert.equal(findByClass(made.root, 'project-ide-dir').length, 2);
  // 파일 3개: data/prices.csv · strategies/golden.py · strategy.py
  assert.equal(findByClass(made.root, 'project-ide-file').length, 3);
  const dirs = findByClass(made.root, 'project-ide-dir');
  const strategies = dirs.find((d) => /strategies/.test(d.textContent));
  await click(strategies);
  const afterFiles = findByClass(made.root, 'project-ide-file');
  assert.equal(afterFiles.length, 2);
  assert.equal(afterFiles.some((f) => f.textContent === 'golden.py'), false);
  // 다시 누르면 펼쳐진다
  await click(findByClass(made.root, 'project-ide-dir').find((d) => /strategies/.test(d.textContent)));
  assert.equal(findByClass(made.root, 'project-ide-file').length, 3);
});

test('.py는 강조되고 다른 파일은 흐리게 표시된다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  assert.equal(findByClass(made.root, 'is-py').length, 2);
  assert.equal(findByClass(made.root, 'is-other').length, 1);
  assert.equal(findByClass(made.root, 'is-other')[0].textContent, 'prices.csv');
});

test('거르기 상자가 파일 이름으로 목록을 좁힌다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  const box = findByClass(made.root, 'project-ide-filter')[0];
  box.value = 'golden';
  await box.dispatchEvent({ type: 'input' });
  const files = findByClass(made.root, 'project-ide-file');
  assert.equal(files.length, 1);
  assert.equal(files[0].textContent, 'golden.py');
});

// ── 여닫기와 편집 ───────────────────────────────────────────────────────────

test('.py를 누르면 탭이 열리고 deps로 본문을 읽어 편집기에 넣는다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  const file = findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py');
  await click(file);
  await flush();
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 1);
  assert.equal(findByClass(made.root, 'project-ide-tab-name')[0].textContent, 'strategy.py');
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0].value, 'PARAMS = {"fast": 5}\n');
  assert.equal(made.ide.activeFile().path, 'strategy.py');
  assert.equal(made.ide.activeText(), 'PARAMS = {"fast": 5}\n');
  // 머리줄에 프로젝트 이름과 파일 경로가 함께 선다.
  assert.equal(findByClass(made.root, 'project-ide-head-project')[0].textContent, '내 전략');
  assert.equal(findByClass(made.root, 'project-ide-head-path')[0].textContent, 'strategy.py');
});

test('.py가 아닌 파일은 한 줄로 거절한다 — 탭도 안 열린다(D3)', async () => {
  let read = 0;
  const made = makeIde({ readFile: async () => { read += 1; return { text: '' }; } });
  await mountWithProject(made);
  await click(findByClass(made.root, 'is-other')[0]);
  await flush();
  assert.equal(read, 0);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 0);
  const notice = findByClass(made.root, 'project-ide-message')[0];
  assert.match(notice.textContent, /파이썬\(\.py\) 파일만 엽니다/);
  assert.match(notice.className, /is-bad/);
});

test('편집하면 탭에 더러움 점이 붙는다 — 편집기는 다시 만들지 않는다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  assert.equal(findByClass(made.root, 'project-ide-tab-dot')[0].className.includes('is-dirty'), false);
  area.value = 'PARAMS = {"fast": 9}\n';
  await area.dispatchEvent({ type: 'input' });
  assert.equal(made.ide.isDirty(), true);
  assert.match(findByClass(made.root, 'project-ide-tab-dot')[0].className, /is-dirty/);
  // 같은 textarea가 그대로 남아야 한다(포커스·IME 조합을 잃지 않는다).
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0], area);
});

test('저장은 버퍼를 그대로 디스크로 보내고 더러움을 지운다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = 'PARAMS = {"fast": 9}\n';
  await area.dispatchEvent({ type: 'input' });
  await click(findByClass(made.root, 'project-ide-save')[0]);
  await flush();
  assert.deepEqual(made.written, [{ id: 'p1', path: 'strategy.py', text: 'PARAMS = {"fast": 9}\n' }]);
  assert.equal(made.ide.isDirty(), false);
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /저장했습니다/);
});

test('Ctrl+S도 저장한다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  await made.root.dispatchEvent({ type: 'keydown', key: 's', ctrlKey: true });
  await flush();
  assert.equal(made.written.length, 1);
  assert.equal(made.written[0].path, 'strategy.py');
});

test('저장 실패는 감추지 않고 한 줄로 남긴다', async () => {
  const made = makeIde({
    writeFile: async () => { throw new Error('파일을 저장하지 못했다'); },
  });
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  await click(findByClass(made.root, 'project-ide-save')[0]);
  await flush();
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /파일을 저장하지 못했다/);
});

test('탭을 옮겨도 저장 안 한 버퍼가 살아 있다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 고치는 중\n';
  await area.dispatchEvent({ type: 'input' });

  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'golden.py'));
  await flush();
  assert.equal(made.ide.activeFile().path, 'strategies/golden.py');
  assert.equal(made.ide.activeText(), 'PARAMS = {"slow": 20}\n');

  const back = findByClass(made.root, 'project-ide-tab-name').find((t) => t.textContent === 'strategy.py');
  await click(back);
  await flush();
  assert.equal(made.ide.activeText(), '# 고치는 중\n');
  assert.equal(made.ide.isDirty(), true);
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0].value, '# 고치는 중\n');
});

test('더러운 탭을 닫으면 인라인으로 되묻고, 버리면 그때 닫힌다(모달 없음)', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 고치는 중\n';
  await area.dispatchEvent({ type: 'input' });

  await click(findByClass(made.root, 'project-ide-tab-close')[0]);
  assert.equal(findByClass(made.root, 'project-ide-confirm').length, 1);
  assert.match(textOf(findByClass(made.root, 'project-ide-confirm')[0]), /저장하지 않은 편집이 있습니다/);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 1, '되묻는 동안에는 안 닫힌다');

  await click(findByClass(made.root, 'project-ide-confirm-cancel')[0]);
  assert.equal(findByClass(made.root, 'project-ide-confirm').length, 0);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 1);

  await click(findByClass(made.root, 'project-ide-tab-close')[0]);
  await click(findByClass(made.root, 'project-ide-confirm-discard')[0]);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 0);
  assert.equal(made.ide.activeFile(), null);
});

test('깨끗한 탭은 되묻지 않고 바로 닫힌다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  await click(findByClass(made.root, 'project-ide-tab-close')[0]);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 0);
  assert.equal(findByClass(made.root, 'project-ide-confirm').length, 0);
});

// ── 새 파일 ─────────────────────────────────────────────────────────────────

test('새 파일: .py가 아닌 이름은 거절한다(D3)', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-new')[0]);
  const input = findByClass(made.root, 'project-ide-new-name')[0];
  input.value = 'notes.txt';
  await input.dispatchEvent({ type: 'input' });
  await click(findByClass(made.root, 'project-ide-new-go')[0]);
  await flush();
  assert.deepEqual(made.created, []);
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /파이썬\(\.py\) 파일만 만들 수 있습니다/);
});

test('새 파일: .py 이름이면 만들고 바로 연다', async () => {
  const made = makeIde({
    readFile: async (_id, p) => ({ path: p, text: '', size: 0, mtime: 1, py: true }),
  });
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-new')[0]);
  const input = findByClass(made.root, 'project-ide-new-name')[0];
  input.value = 'alpha.py';
  await input.dispatchEvent({ type: 'input' });
  await click(findByClass(made.root, 'project-ide-new-go')[0]);
  await flush();
  assert.deepEqual(made.created, ['alpha.py']);
  assert.equal(made.ide.activeFile().path, 'alpha.py');
});

// ── 이름 바꾸기 · 지우기 ────────────────────────────────────────────────────

test('이름 바꾸기: .py 밖으로는 못 나간다(D3), .py면 탭 경로까지 따라간다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();

  await click(findByClass(made.root, 'project-ide-rename')[0]);
  const input = findByClass(made.root, 'project-ide-rename-name')[0];
  assert.equal(input.value, 'strategy.py', '지금 경로가 미리 들어간다');
  input.value = 'strategy.txt';
  await input.dispatchEvent({ type: 'input' });
  await click(findByClass(made.root, 'project-ide-rename-go')[0]);
  await flush();
  assert.deepEqual(made.renamed, []);
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /파이썬\(\.py\)으로만 이름을 바꿀 수 있습니다/);

  const retry = findByClass(made.root, 'project-ide-rename-name')[0];
  retry.value = 'strategies/renamed.py';
  await retry.dispatchEvent({ type: 'input' });
  await click(findByClass(made.root, 'project-ide-rename-go')[0]);
  await flush();
  assert.deepEqual(made.renamed, [['strategy.py', 'strategies/renamed.py']]);
  assert.equal(made.ide.activeFile().path, 'strategies/renamed.py');
});

test('지우기: 인라인으로 되묻고, 지우면 탭도 함께 사라진다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();

  await click(findByClass(made.root, 'project-ide-delete')[0]);
  assert.equal(findByClass(made.root, 'project-ide-confirm').length, 1);
  await click(findByClass(made.root, 'project-ide-delete-cancel')[0]);
  assert.deepEqual(made.deleted, []);

  await click(findByClass(made.root, 'project-ide-delete')[0]);
  await click(findByClass(made.root, 'project-ide-delete-go')[0]);
  await flush();
  assert.deepEqual(made.deleted, ['strategy.py']);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 0);
  assert.equal(made.ide.activeFile(), null);
});

// ── 밖에서 여는 길(openAt) ──────────────────────────────────────────────────
// 설계 폼의 [내 전략]이 부르는 자리다. 사람이 폴더를 고르고 트리를 누르는 그 경로를
// 그대로 타야 한다 — 두 길이 갈라지면 한쪽만 고쳐지는 날이 온다.

test('openAt: 목록을 안 읽었어도 폴더를 고르고 그 파일을 연다', async () => {
  const made = makeIde();
  const opened = await made.ide.openAt('p1', 'strategies/golden.py');
  await flush();
  assert.equal(opened, true);
  assert.equal(made.ide.currentProject().id, 'p1');
  assert.equal(made.ide.activeFile().path, 'strategies/golden.py');
  assert.equal(made.ide.activeText(), 'PARAMS = {"slow": 20}\n');
  assert.equal(findByClass(made.root, 'project-ide-body').length, 1);
});

test('openAt: 이미 그 폴더를 열어 뒀으면 폴더를 다시 고르지 않는다 — 열린 탭이 살아남는다', async () => {
  let treeCalls = 0;
  const made = makeIde({
    tree: async () => {
      treeCalls += 1;
      return { project_id: 'p1', root: PROJECT.path, entries: TREE, truncated: false };
    },
  });
  await mountWithProject(made);
  assert.equal(treeCalls, 1);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();

  const opened = await made.ide.openAt('p1', 'strategies/golden.py');
  await flush();
  assert.equal(opened, true);
  assert.equal(treeCalls, 1, '같은 폴더면 트리를 다시 읽지 않는다');
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 2, '먼저 연 탭이 남아야 한다');
  assert.equal(made.ide.activeFile().path, 'strategies/golden.py');
});

test('openAt: 처음 읽은 목록에 없던 폴더(이 세션에서 만든 프로젝트)는 목록을 다시 읽어 연다', async () => {
  // 전수 프로브 M10~M13 실측: 코드 탭이 먼저 목록을 읽어 두면 그 뒤 등록한 프로젝트는
  // 영영 "목록에 없습니다"였다. 찾는 id가 없으면 한 번 다시 읽어야 한다.
  const later = Object.assign({}, PROJECT, { id: 'p2', name: '나중에 만든 폴더', path: 'D:/quant/later' });
  let calls = 0;
  const made = makeIde({
    listProjects: async () => {
      calls += 1;
      return { projects: calls === 1 ? [PROJECT] : [PROJECT, later], notice: null };
    },
    tree: async () => ({ project_id: 'p2', root: later.path, entries: TREE, truncated: false }),
  });
  await mountWithProject(made);
  assert.equal(calls, 1);
  const opened = await made.ide.openAt('p2', 'strategies/golden.py');
  await flush();
  assert.equal(opened, true);
  assert.equal(calls, 2, '없는 id면 목록을 한 번 다시 읽는다');
  assert.equal(made.ide.currentProject().id, 'p2');
});

test('closeAll: 열린 파일을 전부 닫고 폴더 선택은 남긴다', async () => {
  const made = makeIde();
  await made.ide.openAt('p1', 'strategies/golden.py');
  await flush();
  assert.equal(made.ide.closeAll(), true);
  assert.equal(made.ide.activeFile(), null, '닫혔으면 활성 파일이 없다');
  assert.equal(made.ide.currentProject().id, 'p1', '폴더 선택은 남는다');
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 0);
});

test('openAt: 모르는 폴더·없는 파일은 false를 돌려주고 이유를 적는다', async () => {
  const made = makeIde({
    readFile: async () => { throw new Error('파일이 존재하지 않는다'); },
  });
  assert.equal(await made.ide.openAt('없는폴더', 'a.py'), false);
  assert.match(textOf(made.root), /그 폴더가 프로젝트 목록에 없습니다/);

  assert.equal(await made.ide.openAt('p1', 'strategies/golden.py'), false);
  await flush();
  assert.match(textOf(made.root), /파일이 존재하지 않는다/);
});

test('openAt: .py가 아니면 열지 않는다(D3 — 화면이 막는 것은 설명이고 백엔드가 보장이다)', async () => {
  const made = makeIde();
  assert.equal(await made.ide.openAt('p1', 'data/prices.csv'), false);
  assert.equal(made.ide.activeFile(), null);
  assert.match(textOf(made.root), /파이썬\(\.py\) 파일만 엽니다/);
});
