// 기법 폴더 편집기 — 기법 하나의 폴더 하나를 여는 자리(보드 20 · 폴더 하나 = 기법 하나 = 대화 하나).
//
// **왜 폴더를 고르는 줄이 없는가.** 이 화면은 기법 목록에서 기법 하나를 눌러 들어온다.
// 들어온 뒤에 다른 폴더를 고르는 길을 두면 한 페이지가 여러 알고리즘을 동시에 세팅하는
// 화면이 된다(2026-09-07 사용자 지적). 폴더는 부르는 쪽(backtest-canvas)이 openAt으로
// 정하고, 여기는 그 폴더 안만 보여준다. 목록으로 돌아가는 문은 캔버스 헤더의 [그만두기]다.
//
// **왜 sqlite가 아니라 파일인가.** 전략 버전 테이블은 실행 기록으로 남고, 편집·저장은
// 디스크의 .py를 직접 오간다(D2). 그래서 이 모듈에는 버전 개념이 없다 — 여는 것도 쓰는
// 것도 경로 하나뿐이고, 진실은 늘 파일 쪽에 있다.
//
// **왜 편집기를 또 만들지 않는가.** 줄번호·강조·탭 들여쓰기·diff는 backtest-code-editor.js가
// 이미 한다. 여기서 하는 일은 그 편집기 하나를 "지금 활성인 버퍼"에 붙였다 떼는 것뿐이다.
//
// **왜 루트 노드를 들고 있는가.** backtest-canvas.js의 render()는 매번 DOM을 새로 만든다.
// 그 규칙을 그대로 따르면 키를 한 번 누를 때마다 textarea가 새로 생겨 포커스와 IME 조합이
// 날아간다. 그래서 이 모듈은 자기 루트를 한 번 만들어 계속 들고 있고, 캔버스는 매 렌더에
// 그 노드를 붙이기만 한다(진짜 DOM에서 appendChild는 같은 노드를 옮긴다).
//
// **저장은 자동이다(보드 20 「자동 저장」).** 사람이 고치면 잠시 뒤 디스크에 쓴다 — 코드는
// AI가 쥐고 있고 사람은 가끔 손을 대는 자리라, 저장 버튼을 찾게 하지 않는다. Ctrl+S는
// 그대로 통한다. 저장이 잠깐 늦은 사이의 실행은 부르는 쪽이 isDirty()로 막는다(D2).
//
// 폴더 안의 파일은 확장자와 숨김 여부로 가리지 않는다. UTF-8 텍스트는 같은 편집기로
// 열고, 바이너리는 원문을 DOM에 싣지 않은 채 크기와 종류만 보여준다. 실행 가능한 파일을
// 고르는 규칙은 백테스트 쪽의 책임이고, 탐색기는 디스크에 실제로 있는 것을 숨기지 않는다.
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;
const CodeEditor = isNode
  ? require('./backtest-code-editor')
  : window.AthenaLib.BacktestCodeEditor;

// 사람이 타자를 멈춘 뒤 디스크에 쓰기까지의 시간. 한 자마다 쓰면 디스크와 검사가 타자를
// 따라 뛴다(기법 검사 디바운스 700ms보다 짧아, 검사가 늘 저장된 원문을 본다).
const AUTOSAVE_MS = 500;

// ---------- 순수 계산 ----------

function basename(pathText) {
  const parts = String(pathText == null ? '' : pathText).split('/');
  return parts[parts.length - 1] || String(pathText || '');
}

function isPython(pathText) {
  return /\.py$/i.test(String(pathText == null ? '' : pathText));
}

function formatBytes(value) {
  const size = Math.max(0, Number(value) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function parseCommand(text) {
  const source = String(text == null ? '' : text).trim();
  if (!source) return [];
  const argv = [];
  let value = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && source[i + 1] === quote) { value += quote; i += 1; }
      else value += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/.test(char)) {
      if (started) { argv.push(value); value = ''; started = false; }
      continue;
    }
    value += char;
    started = true;
  }
  if (quote) throw new Error('따옴표가 닫히지 않았습니다');
  if (started) argv.push(value);
  return argv;
}

// 파일 이름으로 거른다 — 폴더는 "안에 걸린 것이 있을 때만" 남는다. 폴더 이름까지 맞추면
// 이름이 걸린 폴더의 무관한 파일이 전부 딸려 나와 거르는 의미가 없어진다.
// (화면의 거르기 상자는 보드 20에 없어 빠졌다 — 순수 계산은 남겨 둔다.)
function filterEntries(entries, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return Array.isArray(entries) ? entries : [];
  const walk = (list) => {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((entry) => {
      if (entry && entry.is_dir) {
        const kids = walk(entry.children);
        if (kids.length) out.push(Object.assign({}, entry, { children: kids }));
        return;
      }
      if (entry && String(entry.name || '').toLowerCase().includes(q)) out.push(entry);
    });
    return out;
  };
  return walk(entries);
}

// 트리의 파일 수 — 헤더의 「N개 파일」이 읽는다. 폴더는 세지 않는다.
function countFiles(entries) {
  let n = 0;
  const walk = (list) => {
    (Array.isArray(list) ? list : []).forEach((entry) => {
      if (!entry) return;
      if (entry.is_dir) walk(entry.children);
      else n += 1;
    });
  };
  walk(entries);
  return n;
}

// ---------- DOM ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ---------- 편집기 ----------

function createProjectIde(options) {
  const opts = options || {};
  const deps = opts.deps || {};
  const setTimeoutImpl = deps.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null);
  const clearTimeoutImpl = deps.clearTimeout || (typeof clearTimeout === 'function' ? clearTimeout : null);
  const root = el('div', 'project-ide');
  if (opts.container) opts.container.appendChild(root);

  let projects = [];
  let project = null;          // 지금 연 폴더(Project)
  let rootPath = '';           // 프로젝트 안에서 탐색기의 루트로 삼은 기법 폴더
  let entries = [];            // 트리(TreeEntry[])
  let truncated = false;
  let tabs = [];               // [{path, text, saved, dirty}]
  let activePath = null;
  let workspaceGeneration = 0;
  let folderRequestGeneration = 0;
  let fileRequestGeneration = 0;
  let suspended = false;
  let readOnlyLocked = false;
  let message = null;          // {text, bad}
  let closing = null;          // 더러운 탭을 닫으려는 중인 경로
  const savingPaths = new Set();
  const autosaveTimers = new Map();
  // 접힌 폴더(경로 → true)와 왼쪽 열 노드 참조. 왼쪽 열만 따로 갈아 끼우는 데 쓴다.
  const collapsed = {};
  let sideNode = null;
  // 더러움·저장 표시만 따로 갱신하기 위한 참조 — 한 글자 칠 때마다 다시 그리면 포커스가 날아간다.
  let dotNodes = {};
  let saveStateNode = null;
  let messageNode = null;
  let terminalOpen = true;
  let terminalRunning = false;
  let terminalRows = [];
  let terminalLogNode = null;

  function say(text, bad) {
    message = text ? { text: String(text), bad: !!bad } : null;
    syncMessage();
  }

  function fail(err) {
    say(String((err && err.message) || err), true);
  }

  function findTab(pathText) {
    return tabs.find((t) => t.path === pathText) || null;
  }

  function activeTab() {
    return !suspended && activePath ? findTab(activePath) : null;
  }

  // 세션 전환은 파일 편집을 버리는 동작이 아니다. 탭은 남기되, 명시적으로 다시
  // 고르기 전까지 앞 세션 파일을 현재 코드·실행 대상으로 내주지 않는다.
  function suspend() {
    workspaceGeneration += 1;
    folderRequestGeneration += 1;
    fileRequestGeneration += 1;
    suspended = true;
    activePath = null;
    closing = null;
    paint();
  }

  function resumeWorkspace() {
    if (!suspended) return;
    suspended = false;
    if (deps.onProjectChange) deps.onProjectChange(project);
  }

  // ---------- 데이터 ----------

  async function loadProjects() {
    if (!deps.listProjects) return;
    try {
      const res = await deps.listProjects();
      projects = (res && Array.isArray(res.projects)) ? res.projects : [];
      if (res && res.notice) say(res.notice, false);
    } catch (err) { fail(err); }
    paint();
  }

  async function loadTree(targetProject, targetRoot, generation) {
    const selected = targetProject || project;
    const selectedRoot = targetRoot == null ? rootPath : targetRoot;
    const expectedGeneration = generation == null ? workspaceGeneration : generation;
    if (!selected || !deps.tree) { entries = []; truncated = false; return true; }
    try {
      const res = await deps.tree(selected.id, selectedRoot);
      if (expectedGeneration !== workspaceGeneration || project !== selected || rootPath !== selectedRoot) {
        return false;
      }
      entries = (res && Array.isArray(res.entries)) ? res.entries : [];
      truncated = !!(res && res.truncated);
    } catch (err) {
      if (expectedGeneration !== workspaceGeneration || project !== selected || rootPath !== selectedRoot) {
        return false;
      }
      entries = [];
      truncated = false;
      fail(err);
    }
    return true;
  }

  async function refreshTree() {
    if (!project || suspended) return false;
    const selected = project;
    const selectedRoot = rootPath;
    const generation = workspaceGeneration;
    if (!await loadTree(selected, selectedRoot, generation)) return false;
    paintSide();
    return true;
  }

  async function selectProject(next, nextRootPath) {
    const requestedRoot = String(nextRootPath == null ? '' : nextRootPath);
    if (suspended && project && next && project.id === next.id && rootPath === requestedRoot) {
      resumeWorkspace();
      paint();
      return true;
    }
    if (project && (project.id !== (next && next.id) || rootPath !== requestedRoot)) {
      const saved = await saveAllDirty();
      if (!saved) return false;
    }
    const generation = ++workspaceGeneration;
    fileRequestGeneration += 1;
    suspended = false;
    project = next || null;
    rootPath = requestedRoot;
    tabs = [];
    activePath = null;
    closing = null;
    if (!await loadTree(project, rootPath, generation)) return false;
    paint();
    // 폴더가 정해지면 코드 탭의 구성이 바뀐다(단일 편집기 ↔ 폴더 편집기) — 그 판단은
    // 캔버스가 하므로 여기서 한 번 알린다.
    if (deps.onProjectChange) deps.onProjectChange(project);
    return true;
  }

  async function openFile(pathText) {
    const generation = workspaceGeneration;
    const requestGeneration = ++fileRequestGeneration;
    const already = findTab(pathText);
    if (already) { activePath = pathText; resumeWorkspace(); say(null); paint(); return; }
    if (!deps.readFile || !project) return;
    try {
      const res = await deps.readFile(project.id, pathText);
      if (generation !== workspaceGeneration || requestGeneration !== fileRequestGeneration) return;
      const binary = !!(res && (res.binary || res.kind === 'binary'));
      const text = binary ? '' : String((res && res.text) || '');
      tabs = tabs.concat([{
        path: pathText,
        text,
        saved: text,
        dirty: false,
        kind: binary ? 'binary' : 'text',
        editable: !binary && (!res || res.editable !== false),
        size: Number(res && res.size) || 0,
        mime: res && res.mime ? String(res.mime) : '',
      }]);
      activePath = pathText;
      resumeWorkspace();
      say(null);
    } catch (err) {
      if (generation !== workspaceGeneration || requestGeneration !== fileRequestGeneration) return;
      fail(err);
    }
    paint();
  }

  // 저장 — 다시 그리지 않는다. 자동 저장은 사람이 타자를 멈춘 직후에 오므로, 여기서
  // paint()를 부르면 막 이어 치려는 순간 편집기가 새로 만들어져 캐럿과 조합이 날아간다.
  // 바뀌는 것은 점과 저장 상태 글자뿐이라 그 둘만 갈아 끼운다.
  async function saveTab(tab) {
    if (!tab || !project || !deps.writeFile) return;
    cancelAutosave(tab.path);
    if (tab.saving) {
      await tab.saving;
      return tab.dirty ? saveTab(tab) : true;
    }
    if (!tab.dirty) return true;
    const text = tab.text;
    const projectId = project.id;
    savingPaths.add(tab.path);
    syncDirtyMarks();
    tab.saving = (async () => {
      try {
        await deps.writeFile(projectId, tab.path, text);
        // 쓰는 동안 더 쳤으면 그 뒤는 아직 안 저장된 것이다 — 그때 dirty는 남는다.
        tab.saved = text;
        tab.dirty = tab.text !== tab.saved;
        say(null);
        if (deps.onSaved) deps.onSaved(tab.path, text);
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    })();
    const saved = await tab.saving;
    tab.saving = null;
    savingPaths.delete(tab.path);
    // 쓰는 동안 친 것이 이미 타이머를 걸었으면 그것이 쓴다 — 두 번 걸지 않는다.
    if (tab.dirty && !autosaveTimers.has(tab.path)) scheduleAutosave(tab);
    syncDirtyMarks();
    return saved;
  }

  async function save() {
    return saveTab(activeTab());
  }

  async function saveAllDirty() {
    for (const tab of tabs.slice()) {
      if (!tab.dirty && !tab.saving) continue;
      if (!await saveTab(tab)) return false;
    }
    return true;
  }

  function scheduleAutosave(tab) {
    if (!tab) return;
    cancelAutosave(tab.path);
    if (!setTimeoutImpl) return;
    const timer = setTimeoutImpl(() => {
      autosaveTimers.delete(tab.path);
      void saveTab(tab);
    }, AUTOSAVE_MS);
    autosaveTimers.set(tab.path, timer);
  }

  function cancelAutosave(pathText) {
    const timer = autosaveTimers.get(pathText);
    if (timer != null && clearTimeoutImpl) clearTimeoutImpl(timer);
    autosaveTimers.delete(pathText);
  }

  // 밖에서 "이 폴더를 열어라" — 목록을 안 읽었거나 찾는 id가 없으면 한 번 다시 읽는다.
  // 이 세션에서 만든 폴더(등록 뒤 열기)는 처음 그린 목록에 없기 때문이다(프로브 M10~M13 실측).
  async function openFolder(projectId, options_) {
    const nextRootPath = typeof options_ === 'string'
      ? options_
      : String((options_ && options_.rootPath) || '');
    const requestGeneration = ++folderRequestGeneration;
    if (!projects.length || !projects.some((p) => p.id === projectId)) await loadProjects();
    if (requestGeneration !== folderRequestGeneration) return false;
    const next = projects.find((p) => p.id === projectId);
    if (!next) {
      say('그 폴더가 프로젝트 목록에 없습니다', true);
      paint();
      return false;
    }
    if (!project || project.id !== projectId || rootPath !== nextRootPath) {
      if (!await selectProject(next, nextRootPath)) return false;
    }
    return requestGeneration === folderRequestGeneration;
  }

  // 밖에서 "이 폴더의 이 파일을 열어라"라고 부르는 자리(기법 목록에서 기법을 고른 때,
  // 새 기법의 폴더를 만든 때). 사람이 트리에서 파일을 누르는 그 경로를 그대로 탄다 —
  // 두 길을 따로 만들면 언젠가 한쪽만 고쳐진다. 열렸는지를 불리언으로 돌려주는 이유:
  // 부른 쪽이 "열었다"고 말하기 전에 정말 열렸는지 알아야 한다(등록부의 파일은 지워졌을 수 있다).
  async function openAt(projectId, pathText, options_) {
    if (!await openFolder(projectId, options_)) return false;
    await openFile(pathText);
    return activePath === pathText;
  }

  // 밖에서 이 파일을 디스크에 썼다(채팅이 낸 코드를 캔버스가 자동 수락한 자리) — 열어둔
  // 버퍼를 그 내용으로 맞춘다. 안 맞추면 디스크와 화면이 갈라져, 도는 코드와 보이는 코드가
  // 다른 상태가 된다(실행은 늘 디스크를 다시 읽는다, D2).
  //
  // 저장하지 않은 사람의 편집이 있으면 건드리지 않고 false를 돌려준다 — 사람이 친 것을
  // 소리 없이 덮지 않는다(closeAll이 dirty 탭을 남기는 것과 같은 규칙이다).
  function adoptExternalWrite(pathText, text) {
    const tab = findTab(pathText);
    if (!tab || tab.dirty) return false;
    tab.text = String(text == null ? '' : text);
    tab.saved = tab.text;
    tab.dirty = false;
    paint();
    return true;
  }

  function closeTab(pathText) {
    const tab = findTab(pathText);
    if (!tab) return;
    if (tab.dirty) { closing = pathText; paint(); return; }
    discardTab(pathText);
  }

  function discardTab(pathText) {
    const index = tabs.findIndex((t) => t.path === pathText);
    if (index < 0) return;
    cancelAutosave(pathText);
    tabs = tabs.filter((t) => t.path !== pathText);
    closing = null;
    if (activePath === pathText) {
      const next = tabs[index] || tabs[index - 1] || null;
      activePath = next ? next.path : null;
    }
    paint();
  }

  // 열린 파일을 전부 닫는다 — 다른 기법을 고르면 새 기법이라(backtest-canvas selectPreset)
  // 앞 폴더의 .py가 열린 채 남으면 화면은 그 기법인데 실행은 이 파이썬이 돈다(프로브 실측).
  // 고치다 만(dirty) 탭은 닫지 않고 false를 돌려준다 — 저장 안 한 편집을 소리 없이 버리지
  // 않는다.
  function closeAll() {
    const dirty = tabs.filter((t) => t.dirty);
    tabs = dirty;
    closing = null;
    activePath = dirty.length ? dirty[dirty.length - 1].path : null;
    paint();
    return dirty.length === 0;
  }

  // ---------- 그리기 ----------

  function renderTreeNode(entry, depth, out) {
    const row = el('div', 'project-ide-row');
    row.setAttribute('style', `padding-left:${depth * 12}px`);
    if (entry.is_dir) {
      const isOpen = !collapsed[entry.path];
      const node = button(
        `project-ide-dir${isOpen ? ' is-open' : ''}`,
        `${isOpen ? '▾' : '▸'} ${entry.name}/`,
        () => {
          if (collapsed[entry.path]) delete collapsed[entry.path];
          else collapsed[entry.path] = true;
          paintSide();
        },
      );
      node.setAttribute('aria-expanded', String(isOpen));
      row.appendChild(node);
      out.appendChild(row);
      if (isOpen) {
        (entry.children || []).forEach((child) => renderTreeNode(child, depth + 1, out));
      }
      return;
    }
    const py = isPython(entry.path);
    const isOn = !suspended && activePath === entry.path;
    const node = button(
      `project-ide-file ${py ? 'is-py' : 'is-other'}${isOn ? ' is-on' : ''}`,
      entry.name,
      () => { void openFile(entry.path); },
    );
    node.setAttribute('aria-pressed', String(isOn));
    row.appendChild(node);
    out.appendChild(row);
  }

  // 왼쪽 탐색기는 서버가 돌려준 항목을 종류와 이름에 관계없이 전부 보여준다.
  // 노드를 새로 만들지 않고 주어진 노드를 채운다 — 왼쪽 열만 갈아 끼울 때 같은 노드가
  // 제자리에 남아야 한다(paintSide).
  function renderSideInto(side) {
    clear(side);
    const title = el('div', 'project-ide-side-title');
    title.appendChild(el('span', 'project-ide-side-label', '탐색기'));
    title.appendChild(el('span', 'project-ide-side-count', `${countFiles(entries)}개 파일`));
    side.appendChild(title);
    side.appendChild(el(
      'div', 'project-ide-folder', `▾ ${rootPath || (project ? project.name : '')}/`,
    ));
    const tree = el('div', 'project-ide-tree');
    if (!entries.length) {
      tree.appendChild(el('div', 'project-ide-empty', '빈 폴더입니다'));
    } else {
      entries.forEach((entry) => renderTreeNode(entry, 1, tree));
    }
    side.appendChild(tree);
    if (truncated) {
      side.appendChild(el('div', 'project-ide-truncated', '파일이 너무 많아 일부만 보여줍니다'));
    }
    return side;
  }

  // 왼쪽 열만 다시 그린다 — 폴더를 접거나 검사 결과가 바뀔 때 편집기까지 새로 만들면
  // 타자 중인 포커스가 날아간다.
  function paintSide() {
    if (!sideNode) return;
    renderSideInto(sideNode);
  }

  // 파일 탭은 하나만 열려도 선다. 탐색기·탭·편집기 관계가 일반 코드 편집기와 같아야 한다.
  function renderTabStrip() {
    const strip = el('div', 'project-ide-tabstrip');
    dotNodes = {};
    tabs.forEach((tab) => {
      const isOn = !suspended && activePath === tab.path;
      const item = el('div', `project-ide-tab${isOn ? ' is-on' : ''}`);
      const name = button('project-ide-tab-name', basename(tab.path), () => {
        activePath = tab.path;
        resumeWorkspace();
        closing = null;
        paint();
      });
      name.setAttribute('aria-pressed', String(isOn));
      item.appendChild(name);
      const dot = el('span', `project-ide-tab-dot${tab.dirty ? ' is-dirty' : ''}`, tab.dirty ? '●' : '');
      dotNodes[tab.path] = dot;
      item.appendChild(dot);
      item.appendChild(button('project-ide-tab-close', '×', () => { closeTab(tab.path); }));
      strip.appendChild(item);
    });
    return strip;
  }

  function saveStateText(tab) {
    if (!tab) return '';
    if (savingPaths.has(tab.path)) return '저장 중…';
    if (tab.dirty) return '저장 대기';
    return '자동 저장';
  }

  function syncDirtyMarks() {
    tabs.forEach((tab) => {
      const dot = dotNodes[tab.path];
      if (!dot) return;
      dot.className = `project-ide-tab-dot${tab.dirty ? ' is-dirty' : ''}`;
      dot.textContent = tab.dirty ? '●' : '';
    });
    if (saveStateNode) {
      const tab = activeTab();
      saveStateNode.textContent = saveStateText(tab);
      saveStateNode.className = `project-ide-save-state${tab && tab.dirty ? ' is-dirty' : ''}`;
    }
  }

  function syncMessage() {
    if (!messageNode) return;
    messageNode.textContent = message ? message.text : '';
    messageNode.className = `project-ide-message${message && message.bad ? ' is-bad' : ''}${message ? '' : ' is-empty'}`;
  }

  function renderMain() {
    const main = el('div', 'project-ide-main');
    const tab = activeTab();
    if (tabs.length) main.appendChild(renderTabStrip());
    else dotNodes = {};

    // 편집기 머리(보드 20) — 파일 이름 · 저장 상태 · 이 코드가 쓰는 것.
    const head = el('div', 'project-ide-head');
    head.appendChild(el('span', 'project-ide-head-path', tab ? tab.path : '연 파일이 없습니다'));
    saveStateNode = el('span', 'project-ide-save-state', saveStateText(tab));
    head.appendChild(saveStateNode);
    head.appendChild(el(
      'span', 'project-ide-head-note', tab && tab.kind === 'binary'
        ? `${tab.mime || '바이너리'} · ${formatBytes(tab.size)}`
        : (tab ? `${tab.editable && !readOnlyLocked ? '편집 가능' : '읽기 전용'} · UTF-8` : ''),
    ));
    main.appendChild(head);

    if (closing) {
      const bar = el('div', 'project-ide-confirm');
      bar.appendChild(el(
        'span', 'project-ide-confirm-text',
        `${basename(closing)}에 저장하지 않은 편집이 있습니다 — 닫으면 사라집니다`,
      ));
      const target = closing;
      bar.appendChild(button('project-ide-confirm-discard', '버리고 닫기', () => {
        discardTab(target);
      }));
      bar.appendChild(button('project-ide-confirm-cancel', '취소', () => {
        closing = null;
        paint();
      }));
      main.appendChild(bar);
    }

    const host = el('div', 'project-ide-editor');
    main.appendChild(host);
    if (tab && tab.kind === 'text') {
      CodeEditor.createCodeEditor({
        container: host,
        value: tab.text,
        readOnly: !tab.editable || readOnlyLocked,
        onChange: (next) => {
          if (!tab.editable || readOnlyLocked) return;
          tab.text = next;
          tab.dirty = tab.text !== tab.saved;
          // 편집기를 다시 만들면 조합 중인 한글이 날아간다 — 점과 저장 상태만 갈아 끼운다.
          syncDirtyMarks();
          if (tab.dirty) scheduleAutosave(tab);
          else cancelAutosave(tab.path);
        },
      });
    } else if (tab) {
      const binary = el('div', 'project-ide-binary');
      binary.appendChild(el('div', 'project-ide-binary-icon', '01'));
      binary.appendChild(el('div', 'project-ide-binary-title', basename(tab.path)));
      binary.appendChild(el(
        'div', 'project-ide-binary-copy',
        `바이너리 파일 · ${formatBytes(tab.size)} · 안전을 위해 내용 미리보기를 열지 않았습니다`,
      ));
      host.appendChild(binary);
    } else {
      host.appendChild(el('div', 'project-ide-empty', '왼쪽 탐색기에서 파일을 선택하세요'));
    }
    return main;
  }

  function syncTerminal() {
    if (!terminalLogNode) return;
    clear(terminalLogNode);
    if (!terminalRows.length) {
      terminalLogNode.appendChild(el('div', 'project-ide-terminal-empty', '실행된 명령이 없습니다'));
      return;
    }
    terminalRows.forEach((row) => {
      terminalLogNode.appendChild(el(
        'div', `project-ide-terminal-line is-${row.kind || 'stdout'}`, row.text,
      ));
    });
    terminalLogNode.scrollTop = 1000000000;
  }

  function recordTerminalResult(result, command) {
    const res = result || {};
    if (res.project_id && (!project || String(res.project_id) !== String(project.id))) return false;
    if (res.cwd != null && String(res.cwd) !== rootPath) return false;
    const shownCommand = command || (Array.isArray(res.argv) ? res.argv.map(String).join(' ') : '');
    if (shownCommand) terminalRows.push({ kind: 'command', text: `$ ${shownCommand}` });
    String(res.stdout || '').split(/\r?\n/).filter(Boolean)
      .forEach((line) => terminalRows.push({ kind: 'stdout', text: line }));
    String(res.stderr || '').split(/\r?\n/).filter(Boolean)
      .forEach((line) => terminalRows.push({ kind: 'stderr', text: line }));
    if (res.timed_out) terminalRows.push({ kind: 'stderr', text: '명령 시간이 초과되었습니다' });
    if (res.exit_code != null) {
      terminalRows.push({
        kind: Number(res.exit_code) === 0 ? 'status' : 'stderr',
        text: `프로세스 종료 코드 ${res.exit_code}`,
      });
    }
    syncTerminal();
    return true;
  }

  async function runTerminal(commandOrArgv) {
    if (readOnlyLocked) return null;
    if (!project) throw new Error('열린 프로젝트가 없습니다');
    if (!deps.runTerminal) throw new Error('터미널 실행 통로가 연결되지 않았습니다');
    const argv = Array.isArray(commandOrArgv) ? commandOrArgv.map(String) : parseCommand(commandOrArgv);
    if (!argv.length) return null;
    terminalRunning = true;
    paint();
    try {
      const result = await deps.runTerminal(project.id, { argv, cwd: rootPath });
      recordTerminalResult(result, argv.join(' '));
      return result;
    } catch (err) {
      recordTerminalResult({ stderr: String((err && err.message) || err) }, argv.join(' '));
      throw err;
    } finally {
      terminalRunning = false;
      paint();
    }
  }

  function renderTerminal() {
    const panel = el('section', `project-ide-terminal${terminalOpen ? ' is-open' : ''}`);
    const head = el('div', 'project-ide-terminal-head');
    head.appendChild(button('project-ide-terminal-toggle', terminalOpen ? '▾ 터미널' : '▸ 터미널', () => {
      terminalOpen = !terminalOpen;
      paint();
    }));
    head.appendChild(el('span', 'project-ide-terminal-cwd', rootPath ? `/${rootPath}` : '/'));
    head.appendChild(button('project-ide-terminal-clear', '지우기', () => {
      terminalRows = [];
      syncTerminal();
    }));
    panel.appendChild(head);
    if (!terminalOpen) return panel;
    terminalLogNode = el('div', 'project-ide-terminal-log');
    panel.appendChild(terminalLogNode);
    syncTerminal();
    const form = el('div', 'project-ide-terminal-form');
    form.appendChild(el('span', 'project-ide-terminal-prompt', '$'));
    const input = document.createElement('input');
    input.className = 'project-ide-terminal-input';
    input.type = 'text';
    input.placeholder = readOnlyLocked
      ? '채팅 반영이 끝나면 명령을 실행할 수 있습니다'
      : (deps.runTerminal ? '명령과 인자를 입력하세요' : '터미널 연결 대기 중');
    input.disabled = readOnlyLocked || terminalRunning || !deps.runTerminal;
    input.setAttribute('aria-label', '프로젝트 터미널 명령');
    input.addEventListener('keydown', (event) => {
      if (!event || event.key !== 'Enter') return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const command = input.value;
      input.value = '';
      void runTerminal(command).catch(() => {});
    });
    form.appendChild(input);
    panel.appendChild(form);
    return panel;
  }

  function paint() {
    clear(root);
    sideNode = null;
    saveStateNode = null;
    messageNode = el('div', 'project-ide-message');
    root.appendChild(messageNode);
    syncMessage();
    if (!project) return;
    const body = el('div', 'project-ide-body');
    sideNode = renderSideInto(el('div', 'project-ide-side'));
    body.appendChild(sideNode);
    const workbench = el('div', 'project-ide-workbench');
    workbench.appendChild(renderMain());
    workbench.appendChild(renderTerminal());
    body.appendChild(workbench);
    root.appendChild(body);
  }

  // Ctrl+S는 편집기 textarea에서 올라온다(진짜 DOM의 버블링). 테스트는 루트에 바로 쏜다.
  function handleKeydown(event) {
    if (!event || !(event.ctrlKey || event.metaKey)) return false;
    if (event.key === '`') {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      terminalOpen = !terminalOpen;
      paint();
      return true;
    }
    if (String(event.key || '').toLowerCase() !== 's') return false;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    void save();
    return true;
  }
  root.addEventListener('keydown', handleKeydown);

  paint();

  return {
    element: root,
    mount() { void loadProjects(); },
    refresh() { paint(); },
    refreshTree,
    // 왼쪽 열만 — 부르는 쪽의 검사·환경이 바뀔 때 편집기를 건드리지 않고 갱신한다.
    refreshSide() { paintSide(); },
    currentProject() { return suspended ? null : project; },
    currentRootPath() { return suspended ? '' : rootPath; },
    fileCount() { return project ? countFiles(entries) : 0; },
    openFolder,
    openAt,
    closeAll,
    suspend,
    adoptExternalWrite,
    activeFile() {
      const tab = activeTab();
      return tab ? {
        path: tab.path, text: tab.text, dirty: tab.dirty,
        kind: tab.kind, editable: tab.editable,
      } : null;
    },
    activeText() {
      const tab = activeTab();
      return tab ? tab.text : '';
    },
    hasDirtyFile(pathText) {
      const tab = findTab(pathText);
      return !!(tab && tab.dirty);
    },
    isDirty() {
      const tab = activeTab();
      return !!(tab && tab.dirty);
    },
    save,
    flushAll: saveAllDirty,
    setReadOnly(value) {
      const next = !!value;
      if (readOnlyLocked === next) return;
      readOnlyLocked = next;
      paint();
    },
    runTerminal,
    recordTerminalResult,
    openTerminal() { terminalOpen = true; paint(); },
    terminalEntries() { return terminalRows.map((row) => Object.assign({}, row)); },
    handleKeydown,
  };
}

const __exports = {
  createProjectIde,
  // 순수 계산 — node --test 대상(card-primitives.js와 같은 노출 원칙)
  basename,
  isPython,
  formatBytes,
  parseCommand,
  filterEntries,
  countFiles,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ProjectIde = __exports;
}

})();
