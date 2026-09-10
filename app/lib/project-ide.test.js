// project-ide.js 단위 테스트 — jsdom 없이 최소 DOM 스텁으로 검증한다
// (backtest-canvas.test.js가 세운 관례를 그대로 쓴다).
//
// 이 파일이 지키는 계약: 폴더는 부르는 쪽이 정한다(고르기 줄이 없다 — 기법 하나의 화면,
// 보드 20), 트리는 접힌다, 모든 UTF-8 텍스트가 편집기로 들어온다, 저장은 자동으로 디스크로 나간다(D2),
// 저장 안 한 버퍼는 탭을 옮겨도 살아 있다, 파일 탭 줄은 둘 이상 열렸을 때만 선다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const projectIde = require('./project-ide');
const { createProjectIde, basename, isPython, filterEntries, countFiles } = projectIde;

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
  // 자동 저장 타이머는 가짜다 — 테스트가 원할 때 runPending으로 돌린다.
  const pending = [];
  const deps = Object.assign({
    setTimeout: (fn) => { const entry = { fn }; pending.push(entry); return entry; },
    clearTimeout: (entry) => { const i = pending.indexOf(entry); if (i >= 0) pending.splice(i, 1); },
    listProjects: async () => ({ projects: [PROJECT], notice: null }),
    tree: async () => ({ project_id: 'p1', root: PROJECT.path, entries: TREE, truncated: false }),
    readFile: async (_id, p) => ({ path: p, text: FILE_TEXT[p] || '', size: 1, mtime: 1, py: true }),
    writeFile: async (id, p, text) => { written.push({ id, path: p, text }); return { path: p, size: text.length, mtime: 2 }; },
  }, overrides || {});
  const ide = createProjectIde({ deps });
  return { ide, root: ide.element, written, pending, deps };
}

// 쌓인 자동 저장 타이머를 지금 돌린다.
async function runPending(made) {
  const queued = made.pending.splice(0, made.pending.length);
  queued.forEach((entry) => entry.fn());
  await flush();
  await flush();
}

// 폴더를 연 뒤의 상태까지 한 번에 간다 — 대부분의 테스트가 여기서 시작한다. 폴더를 고르는
// 줄은 없다(기법 하나의 화면) — 부르는 쪽(캔버스)이 openFolder/openAt으로 정한다.
async function mountWithProject(made) {
  made.ide.mount();
  await flush();
  await made.ide.openFolder('p1');
  await flush();
}

async function openFileNamed(made, name) {
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === name));
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

test('countFiles: 폴더는 세지 않고 파일만 센다', () => {
  assert.equal(countFiles(TREE), 3);
  assert.equal(countFiles([]), 0);
  assert.equal(countFiles(null), 0);
});

test('formatBytes/parseCommand: 크기와 argv 입력을 셸 해석 없이 정규화한다', () => {
  assert.equal(projectIde.formatBytes(512), '512 B');
  assert.equal(projectIde.formatBytes(1536), '1.5 KB');
  assert.deepEqual(
    projectIde.parseCommand('python "tests/my strategy.py" --name "내 기법"'),
    ['python', 'tests/my strategy.py', '--name', '내 기법'],
  );
  assert.deepEqual(projectIde.parseCommand('python scripts\\check.py'), ['python', 'scripts\\check.py']);
  assert.throws(() => projectIde.parseCommand('python "닫히지 않음'), /따옴표/);
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

test('폴더를 고르는 줄은 없다 — 폴더는 부르는 쪽이 openFolder로 정한다(기법 하나의 화면)', async () => {
  const made = makeIde({ listProjects: async () => ({ projects: [PROJECT], notice: null }) });
  made.ide.mount();
  await flush();
  assert.equal(findByClass(made.root, 'project-ide-body').length, 0, '폴더를 열기 전에는 트리도 편집기도 없다');
  assert.equal(findByClass(made.root, 'project-ide-project').length, 0);
  assert.equal(findByClass(made.root, 'project-ide-new-project').length, 0);
  assert.equal(findByClass(made.root, 'project-ide-open-folder').length, 0);
  assert.doesNotMatch(textOf(made.root), /새 프로젝트|폴더 열기/);
  assert.equal(made.ide.currentProject(), null);

  assert.equal(await made.ide.openFolder('없는폴더'), false);
  assert.match(textOf(made.root), /그 폴더가 프로젝트 목록에 없습니다/);
  assert.equal(await made.ide.openFolder('p1'), true);
  assert.equal(made.ide.currentProject().id, 'p1');
  assert.equal(findByClass(made.root, 'project-ide-body').length, 1);
  assert.equal(made.ide.fileCount(), 3);
  assert.equal(findByClass(made.root, 'project-ide-side-label')[0].textContent, '탐색기');
  assert.equal(findByClass(made.root, 'project-ide-side-count')[0].textContent, '3개 파일');
  assert.match(findByClass(made.root, 'project-ide-folder')[0].textContent, /내 전략\//);
});

test('레지스트리 notice를 그대로 한 줄로 적는다(감추지 않는다)', async () => {
  const made = makeIde({
    listProjects: async () => ({ projects: [], notice: '레지스트리 파일이 아직 없어 빈 목록으로 시작한다' }),
  });
  made.ide.mount();
  await flush();
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /레지스트리 파일이 아직 없어/);
});

// ── 파일 트리 ───────────────────────────────────────────────────────────────

for (const pendingStage of ['tree', 'file']) {
  test(`suspend: 앞 세션의 ${pendingStage} 응답이 파일을 다시 활성화하지 않는다`, async () => {
    let finishPrevious;
    const previous = new Promise((resolve) => { finishPrevious = resolve; });
    const changes = [];
    let requests = 0;
    const made = makeIde({
      tree: () => pendingStage === 'tree'
        ? (requests += 1, previous) : Promise.resolve({ entries: TREE }),
      readFile: () => { requests += 1; return previous; },
      onProjectChange: (project) => changes.push(project),
    });
    made.ide.mount();
    await flush();
    const opening = made.ide.openAt('p1', 'strategy.py');
    await flush();
    assert.equal(requests, 1);
    made.ide.suspend();
    const before = changes.length;
    finishPrevious(pendingStage === 'tree' ? { entries: TREE } : { text: '# previous-session\n' });
    assert.equal(await opening, false);
    assert.equal(made.ide.currentProject(), null);
    assert.equal(made.ide.activeFile(), null);
    assert.equal(made.ide.activeText(), '');
    assert.equal(made.ide.isDirty(), false);
    assert.equal(changes.length, before);
    assert.equal(findByClass(made.root, 'project-ide-tab-name').length, 0);
  });
}

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

// ── 여닫기와 편집 ───────────────────────────────────────────────────────────

test('.py를 누르면 편집기에 본문과 파일 탭이 들어온다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  // 일반 코드 편집기처럼 파일 하나부터 탭이 선다.
  assert.equal(findByClass(made.root, 'project-ide-tabstrip').length, 1);
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0].value, 'PARAMS = {"fast": 5}\n');
  assert.equal(made.ide.activeFile().path, 'strategy.py');
  assert.equal(made.ide.activeText(), 'PARAMS = {"fast": 5}\n');
  // 편집기 머리줄 — 파일 경로 · 저장 상태 · 인코딩/편집 가능 여부.
  assert.equal(findByClass(made.root, 'project-ide-head-path')[0].textContent, 'strategy.py');
  assert.equal(findByClass(made.root, 'project-ide-save-state')[0].textContent, '자동 저장');
  assert.equal(findByClass(made.root, 'project-ide-head-note')[0].textContent, '편집 가능 · UTF-8');
  assert.equal(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py').className.includes('is-on'), true);
});

test('.py가 아닌 UTF-8 파일도 읽고 편집기에 연다', async () => {
  let read = 0;
  const made = makeIde({ readFile: async () => { read += 1; return { kind: 'text', text: 'date,close\n', editable: true }; } });
  await mountWithProject(made);
  await click(findByClass(made.root, 'is-other')[0]);
  await flush();
  assert.equal(read, 1);
  assert.equal(made.ide.activeFile().path, 'data/prices.csv');
  assert.equal(made.ide.activeText(), 'date,close\n');
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0].readOnly, false);
});

test('편집하면 저장 상태가 「저장 대기」가 된다 — 편집기는 다시 만들지 않는다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  const state = findByClass(made.root, 'project-ide-save-state')[0];
  assert.equal(state.className.includes('is-dirty'), false);
  area.value = 'PARAMS = {"fast": 9}\n';
  await area.dispatchEvent({ type: 'input' });
  assert.equal(made.ide.isDirty(), true);
  assert.equal(state.textContent, '저장 대기');
  assert.match(state.className, /is-dirty/);
  // 같은 textarea가 그대로 남아야 한다(포커스·IME 조합을 잃지 않는다).
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0], area);
  // 두 파일이 열려 탭 줄이 서면 더러움 점도 그 탭에 붙는다.
  await openFileNamed(made, 'golden.py');
  const dot = findByClass(made.root, 'project-ide-tab-dot').find((d) => d.className.includes('is-dirty'));
  assert.ok(dot, '저장 안 한 strategy.py 탭에 점이 붙는다');
});

test('setReadOnly: 채팅 반영 중에는 새 입력을 거부하고 기존 버퍼는 그대로 둔다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const before = made.ide.activeText();

  made.ide.setReadOnly(true);
  const locked = findByClass(made.root, 'backtest-code-textarea')[0];
  assert.equal(locked.readOnly, true);
  locked.value = '# 잠금 중 입력\n';
  await locked.dispatchEvent({ type: 'input' });
  assert.equal(made.ide.activeText(), before);
  assert.equal(made.pending.length, 0);

  made.ide.setReadOnly(false);
  const unlocked = findByClass(made.root, 'backtest-code-textarea')[0];
  assert.equal(unlocked.readOnly, false);
  unlocked.value = '# 잠금 해제 뒤 입력\n';
  await unlocked.dispatchEvent({ type: 'input' });
  assert.equal(made.ide.activeText(), '# 잠금 해제 뒤 입력\n');
});

test('자동 저장: 타자를 멈추면 버퍼를 그대로 디스크로 보내고 더러움을 지운다 — 편집기는 다시 만들지 않는다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = 'PARAMS = {"fast": 9}\n';
  await area.dispatchEvent({ type: 'input' });
  assert.equal(made.pending.length, 1, '타이머 하나가 걸린다');
  assert.deepEqual(made.written, [], '아직 쓰지 않았다');
  await runPending(made);
  assert.deepEqual(made.written, [{ id: 'p1', path: 'strategy.py', text: 'PARAMS = {"fast": 9}\n' }]);
  assert.equal(made.ide.isDirty(), false);
  assert.equal(findByClass(made.root, 'project-ide-save-state')[0].textContent, '자동 저장');
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0], area, '저장이 편집기를 새로 만들면 안 된다');
});

test('자동 저장: 타자 뒤 다른 탭을 열어도 고친 원래 탭을 저장한다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 첫 탭에서 고침\n';
  await area.dispatchEvent({ type: 'input' });
  await openFileNamed(made, 'golden.py');

  await runPending(made);
  assert.deepEqual(made.written, [
    { id: 'p1', path: 'strategy.py', text: '# 첫 탭에서 고침\n' },
  ]);
  assert.equal(made.ide.activeFile().path, 'strategies/golden.py');
});

test('자동 저장: 쓰는 동안 더 친 것은 저장된 것이 아니다 — 다시 예약한다', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const written = [];
  const made = makeIde({
    writeFile: async (id, p, text) => { written.push(text); await gate; return { path: p }; },
  });
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = 'a\n';
  await area.dispatchEvent({ type: 'input' });
  made.pending.splice(0, 1)[0].fn();
  await flush();
  assert.deepEqual(written, ['a\n']);
  assert.equal(findByClass(made.root, 'project-ide-save-state')[0].textContent, '저장 중…');
  area.value = 'ab\n';
  await area.dispatchEvent({ type: 'input' });
  release();
  await flush();
  await flush();
  assert.equal(made.ide.isDirty(), true, '쓰는 동안 친 것은 아직 디스크에 없다');
  await runPending(made);
  assert.deepEqual(written, ['a\n', 'ab\n']);
  assert.equal(made.ide.isDirty(), false);
});

test('저장되면 onSaved로 경로와 본문을 알린다 — 부르는 쪽이 검사를 이어 건다', async () => {
  const saved = [];
  const made = makeIde({ onSaved: (path, text) => saved.push([path, text]) });
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = 'x = 1\n';
  await area.dispatchEvent({ type: 'input' });
  await runPending(made);
  assert.deepEqual(saved, [['strategy.py', 'x = 1\n']]);
});

test('Ctrl+S는 타이머를 기다리지 않고 바로 저장한다 — 깨끗하면 쓰지 않는다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  await made.root.dispatchEvent({ type: 'keydown', key: 's', ctrlKey: true });
  await flush();
  assert.equal(made.written.length, 0, '바뀐 것이 없으면 디스크를 건드리지 않는다');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = 'PARAMS = {"fast": 9}\n';
  await area.dispatchEvent({ type: 'input' });
  await made.root.dispatchEvent({ type: 'keydown', key: 's', ctrlKey: true });
  await flush();
  assert.equal(made.written.length, 1);
  assert.equal(made.written[0].path, 'strategy.py');
  // 걸려 있던 자동 저장 타이머가 뒤늦게 돌아도 두 번 쓰지 않는다.
  await runPending(made);
  assert.equal(made.written.length, 1);
});

test('저장 실패는 감추지 않고 한 줄로 남긴다', async () => {
  const made = makeIde({
    writeFile: async () => { throw new Error('파일을 저장하지 못했다'); },
  });
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 고침\n';
  await area.dispatchEvent({ type: 'input' });
  await runPending(made);
  assert.match(textOf(findByClass(made.root, 'project-ide-message')[0]), /파일을 저장하지 못했다/);
  assert.equal(made.ide.isDirty(), true, '못 썼으면 더러움이 남는다');
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

// 밖에서 쓴 파일(채팅이 낸 코드를 캔버스가 자동 수락한 자리)을 열린 버퍼에 되비친다 —
// 안 되비치면 디스크와 화면이 갈라져, 도는 코드와 보이는 코드가 달라진다.
test('adoptExternalWrite: 열린 버퍼를 디스크의 새 내용으로 맞춘다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  assert.equal(made.ide.adoptExternalWrite('strategy.py', '# AI가 쓴 코드\n'), true);
  assert.equal(made.ide.activeText(), '# AI가 쓴 코드\n');
  assert.equal(made.ide.isDirty(), false, '디스크와 같아졌으니 더럽지 않다');
  assert.equal(findByClass(made.root, 'backtest-code-textarea')[0].value, '# AI가 쓴 코드\n');
  // 안 연 파일은 되비칠 버퍼가 없다 — 조용히 false다.
  assert.equal(made.ide.adoptExternalWrite('없는파일.py', 'x'), false);
});

test('adoptExternalWrite: 저장 안 한 편집은 덮지 않는다 — 사람이 친 것이 이긴다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await click(findByClass(made.root, 'project-ide-file').find((f) => f.textContent === 'strategy.py'));
  await flush();
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 내가 치던 중\n';
  await area.dispatchEvent({ type: 'input' });
  assert.equal(made.ide.adoptExternalWrite('strategy.py', '# AI가 쓴 코드\n'), false);
  assert.equal(made.ide.activeText(), '# 내가 치던 중\n');
  assert.equal(made.ide.isDirty(), true);
});

// 탭을 닫는 손잡이는 탭 줄에 있고, 탭 줄은 파일이 둘 이상일 때 선다.
function closeButtonOf(made, name) {
  const tab = findByClass(made.root, 'project-ide-tab')
    .find((t) => findByClass(t, 'project-ide-tab-name')[0].textContent === name);
  return findByClass(tab, 'project-ide-tab-close')[0];
}

test('더러운 탭을 닫으면 인라인으로 되묻고, 버리면 그때 닫힌다(모달 없음)', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 고치는 중\n';
  await area.dispatchEvent({ type: 'input' });
  await openFileNamed(made, 'golden.py');
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 2, '둘이 열리면 탭 줄이 선다');

  await click(closeButtonOf(made, 'strategy.py'));
  assert.equal(findByClass(made.root, 'project-ide-confirm').length, 1);
  assert.match(textOf(findByClass(made.root, 'project-ide-confirm')[0]), /저장하지 않은 편집이 있습니다/);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 2, '되묻는 동안에는 안 닫힌다');

  await click(findByClass(made.root, 'project-ide-confirm-cancel')[0]);
  assert.equal(findByClass(made.root, 'project-ide-confirm').length, 0);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 2);

  await click(closeButtonOf(made, 'strategy.py'));
  await click(findByClass(made.root, 'project-ide-confirm-discard')[0]);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 1);
  assert.equal(made.ide.activeFile().path, 'strategies/golden.py');
  assert.equal(made.ide.isDirty(), false);
});

test('깨끗한 탭은 되묻지 않고 바로 닫힌다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  await openFileNamed(made, 'golden.py');
  await click(closeButtonOf(made, 'golden.py'));
  assert.equal(findByClass(made.root, 'project-ide-confirm').length, 0);
  assert.equal(findByClass(made.root, 'project-ide-tab').length, 1);
  assert.equal(made.ide.activeFile().path, 'strategy.py');
});

// ── 밖에서 여는 길(openAt) ──────────────────────────────────────────────────
// 기법 목록에서 기법을 고른 때와 새 기법의 폴더를 만든 때가 부르는 자리다. 사람이 트리를
// 누르는 그 경로를 그대로 타야 한다 — 두 길이 갈라지면 한쪽만 고쳐지는 날이 온다.

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

test('openFolder: 다른 프로젝트로 옮기기 전에 모든 편집을 저장한다', async () => {
  const other = Object.assign({}, PROJECT, { id: 'p2', name: '다른 기법', path: 'D:/quant/other' });
  const made = makeIde({
    listProjects: async () => ({ projects: [PROJECT, other], notice: null }),
  });
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 옮기기 전 저장\n';
  await area.dispatchEvent({ type: 'input' });

  assert.equal(await made.ide.openFolder('p2'), true);
  assert.deepEqual(made.written, [
    { id: 'p1', path: 'strategy.py', text: '# 옮기기 전 저장\n' },
  ]);
  assert.equal(made.ide.currentProject().id, 'p2');
});

test('openFolder: 저장이 실패하면 현재 프로젝트와 편집을 그대로 둔다', async () => {
  const other = Object.assign({}, PROJECT, { id: 'p2', name: '다른 기법', path: 'D:/quant/other' });
  const made = makeIde({
    listProjects: async () => ({ projects: [PROJECT, other], notice: null }),
    writeFile: async () => { throw new Error('전환 전 저장 실패'); },
  });
  await mountWithProject(made);
  await openFileNamed(made, 'strategy.py');
  const area = findByClass(made.root, 'backtest-code-textarea')[0];
  area.value = '# 남겨야 하는 편집\n';
  await area.dispatchEvent({ type: 'input' });

  assert.equal(await made.ide.openFolder('p2'), false);
  assert.equal(made.ide.currentProject().id, 'p1');
  assert.equal(made.ide.activeText(), '# 남겨야 하는 편집\n');
  assert.equal(made.ide.isDirty(), true);
  assert.match(textOf(made.root), /전환 전 저장 실패/);
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

test('openAt: 앞 폴더의 늦은 트리 응답이 뒤에 연 폴더를 덮지 않는다', async () => {
  const other = Object.assign({}, PROJECT, { id: 'p2', name: '다른 기법', path: 'D:/quant/other' });
  let releaseFirst;
  const firstTree = new Promise((resolve) => { releaseFirst = resolve; });
  const made = makeIde({
    listProjects: async () => ({ projects: [PROJECT, other], notice: null }),
    tree: async (id) => {
      if (id === 'p1') return firstTree;
      return {
        project_id: 'p2', root: other.path,
        entries: [{ name: 'other.py', path: 'other.py', is_dir: false, py: true, size: 1 }],
        truncated: false,
      };
    },
    readFile: async (_id, path) => ({ path, kind: 'text', text: '# other\n', editable: true }),
  });
  made.ide.mount();
  await flush();

  const first = made.ide.openAt('p1', 'strategy.py');
  await flush();
  const second = made.ide.openAt('p2', 'other.py');
  assert.equal(await second, true);
  releaseFirst({ project_id: 'p1', root: PROJECT.path, entries: TREE, truncated: false });
  assert.equal(await first, false);

  assert.equal(made.ide.currentProject().id, 'p2');
  assert.equal(made.ide.activeFile().path, 'other.py');
  assert.deepEqual(findByClass(made.root, 'project-ide-file').map((node) => node.textContent), ['other.py']);
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

test('openAt: .py가 아닌 파일도 연다', async () => {
  const made = makeIde();
  assert.equal(await made.ide.openAt('p1', 'data/prices.csv'), true);
  assert.equal(made.ide.activeFile().path, 'data/prices.csv');
});

test('바이너리 파일은 내용을 싣지 않고 크기만 안전하게 미리보기한다', async () => {
  const made = makeIde({
    readFile: async (_id, path) => ({ path, kind: 'binary', binary: true, size: 1536, editable: false }),
  });
  assert.equal(await made.ide.openAt('p1', 'data/prices.csv'), true);
  assert.equal(made.ide.activeFile().kind, 'binary');
  assert.equal(made.ide.activeFile().editable, false);
  assert.equal(findByClass(made.root, 'backtest-code-textarea').length, 0);
  assert.match(textOf(findByClass(made.root, 'project-ide-binary')[0]), /1.5 KB/);
  assert.match(textOf(findByClass(made.root, 'project-ide-binary')[0]), /내용 미리보기를 열지 않았습니다/);
});

test('openAt rootPath는 트리와 터미널 cwd에 같은 프로젝트 내부 경로를 쓴다', async () => {
  const treeCalls = [];
  const terminalCalls = [];
  const made = makeIde({
    tree: async (id, rootPath) => {
      treeCalls.push([id, rootPath]);
      return { entries: TREE };
    },
    runTerminal: async (id, body) => {
      terminalCalls.push([id, body]);
      return { exit_code: 0, stdout: '3 passed\n', stderr: '', timed_out: false };
    },
  });
  assert.equal(await made.ide.openAt('p1', 'strategies/golden.py', { rootPath: 'strategies' }), true);
  assert.deepEqual(treeCalls, [['p1', 'strategies']]);
  assert.equal(made.ide.currentRootPath(), 'strategies');
  const result = await made.ide.runTerminal(['python', '-m', 'pytest']);
  assert.equal(result.exit_code, 0);
  assert.deepEqual(terminalCalls, [['p1', { argv: ['python', '-m', 'pytest'], cwd: 'strategies' }]]);
  assert.match(made.ide.terminalEntries().map((row) => row.text).join(' '), /3 passed/);
  assert.match(textOf(findByClass(made.root, 'project-ide-terminal-log')[0]), /프로세스 종료 코드 0/);
});

test('setReadOnly: 채팅 반영 중에는 수동 터미널 실행을 막고 도구 결과 기록은 허용한다', async () => {
  const terminalCalls = [];
  const made = makeIde({
    runTerminal: async (id, body) => {
      terminalCalls.push([id, body]);
      return { exit_code: 0, stdout: 'manual', stderr: '', timed_out: false };
    },
  });
  await mountWithProject(made);
  made.ide.setReadOnly(true);

  const input = findByClass(made.root, 'project-ide-terminal-input')[0];
  assert.equal(input.disabled, true);
  assert.match(input.placeholder, /채팅 반영이 끝나면/);
  assert.equal(await made.ide.runTerminal(['python', '-V']), null);
  assert.deepEqual(terminalCalls, []);

  assert.equal(made.ide.recordTerminalResult({
    project_id: 'p1', cwd: '', argv: ['python', '-V'], exit_code: 0, stdout: 'Python 3.12',
  }), true);
  assert.match(textOf(findByClass(made.root, 'project-ide-terminal-log')[0]), /Python 3\.12/);
});

test('채팅이 받은 실제 터미널 결과를 작업공간에 추가할 수 있다', async () => {
  const made = makeIde();
  await mountWithProject(made);
  made.ide.recordTerminalResult({ exit_code: 2, stderr: '검사 실패' }, 'python -m pytest');
  const text = textOf(findByClass(made.root, 'project-ide-terminal-log')[0]);
  assert.match(text, /\$ python -m pytest/);
  assert.match(text, /검사 실패/);
  assert.match(text, /프로세스 종료 코드 2/);
});
