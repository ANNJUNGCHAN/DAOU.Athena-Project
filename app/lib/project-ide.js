// 프로젝트 IDE — 코드 탭이 "내 컴퓨터의 폴더 하나"를 여는 자리(결정 D1~D4).
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
// **PYTHON ONLY(D3).** 만들기·저장·이름 바꾸기는 .py에만 열려 있다. 다른 파일은 보이되
// (사람이 자기 데이터를 봐야 한다) 편집기로는 못 들어온다 — 누르면 한 줄로 거절한다.
// 이 규율은 백엔드도 415로 다시 막는다. 두 겹인 이유는, 화면에서 막는 것은 설명이고
// 백엔드에서 막는 것은 보장이기 때문이다.
(function () {
'use strict';

const isNode = typeof module !== 'undefined' && module.exports;
const CodeEditor = isNode
  ? require('./backtest-code-editor')
  : window.AthenaLib.BacktestCodeEditor;

// ---------- 순수 계산 ----------

function basename(pathText) {
  const parts = String(pathText == null ? '' : pathText).split('/');
  return parts[parts.length - 1] || String(pathText || '');
}

function isPython(pathText) {
  return /\.py$/i.test(String(pathText == null ? '' : pathText));
}

// 파일 이름으로 거른다 — 폴더는 "안에 걸린 것이 있을 때만" 남는다. 폴더 이름까지 맞추면
// 이름이 걸린 폴더의 무관한 파일이 전부 딸려 나와 거르는 의미가 없어진다.
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

// ---------- IDE ----------

function createProjectIde(options) {
  const opts = options || {};
  const deps = opts.deps || {};
  const root = el('div', 'project-ide');
  if (opts.container) opts.container.appendChild(root);

  let projects = [];
  let project = null;          // 고른 프로젝트(Project)
  let entries = [];            // 트리(TreeEntry[])
  let truncated = false;
  let tabs = [];               // [{path, text, saved, dirty}]
  let activePath = null;
  let filter = '';
  let message = null;          // {text, bad}
  let closing = null;          // 더러운 탭을 닫으려는 중인 경로
  let namingProject = false;
  let projectName = '';
  let namingFile = false;
  let fileName = '';
  let renaming = false;
  let renameTo = '';
  let deleting = null;          // 지우려는 중인 경로
  let loaded = false;
  // 접힌 폴더(경로 → true)와 트리 노드 참조. 트리만 따로 갈아 끼우는 데 쓴다.
  const collapsed = {};
  let treeNode = null;
  // 더러움 표시만 따로 갱신하기 위한 참조 — 한 글자 칠 때마다 다시 그리면 포커스가 날아간다.
  let dotNodes = {};

  function say(text, bad) {
    message = text ? { text: String(text), bad: !!bad } : null;
  }

  function fail(err) {
    say(String((err && err.message) || err), true);
  }

  function findTab(pathText) {
    return tabs.find((t) => t.path === pathText) || null;
  }

  function activeTab() {
    return activePath ? findTab(activePath) : null;
  }

  // ---------- 데이터 ----------

  async function loadProjects() {
    if (!deps.listProjects) return;
    try {
      const res = await deps.listProjects();
      projects = (res && Array.isArray(res.projects)) ? res.projects : [];
      if (res && res.notice) say(res.notice, false);
    } catch (err) { fail(err); }
    loaded = true;
    paint();
  }

  async function loadTree() {
    if (!project || !deps.tree) { entries = []; truncated = false; return; }
    try {
      const res = await deps.tree(project.id);
      entries = (res && Array.isArray(res.entries)) ? res.entries : [];
      truncated = !!(res && res.truncated);
    } catch (err) { entries = []; truncated = false; fail(err); }
  }

  async function selectProject(next) {
    project = next || null;
    tabs = [];
    activePath = null;
    closing = null;
    deleting = null;
    renaming = false;
    filter = '';
    await loadTree();
    paint();
    // 프로젝트를 고르고 나면 코드 탭의 구성이 바뀐다(옛 단일 편집기 ↔ IDE) — 그 판단은
    // 캔버스가 하므로 여기서 한 번 알린다.
    if (deps.onProjectChange) deps.onProjectChange(project);
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name) { say('프로젝트 이름을 적어주세요', true); paint(); return; }
    if (!deps.createProject) return;
    try {
      const res = await deps.createProject(name);
      namingProject = false;
      projectName = '';
      projects = projects.concat([res.project]);
      say(`${res.seed}로 시작합니다`, false);
      await selectProject(res.project);
    } catch (err) { fail(err); paint(); }
  }

  // 네이티브 폴더 선택은 main 프로세스만 열 수 있다 — 렌더러가 고를 수 있는 경로는 없다.
  async function openFolder() {
    if (!deps.openDialog || !deps.openProject) return;
    let picked;
    try { picked = await deps.openDialog(); } catch (err) { fail(err); paint(); return; }
    if (!picked || picked.canceled || !picked.path) return;
    try {
      const res = await deps.openProject(picked.path);
      const already = projects.find((p) => p.id === res.project.id);
      if (!already) projects = projects.concat([res.project]);
      await selectProject(res.project);
    } catch (err) { fail(err); paint(); }
  }

  async function openFile(pathText) {
    if (!isPython(pathText)) {
      say('이 기능은 파이썬(.py) 파일만 엽니다 — 다른 파일은 보기만 합니다', true);
      paint();
      return;
    }
    const already = findTab(pathText);
    if (already) { activePath = pathText; say(null); paint(); return; }
    if (!deps.readFile || !project) return;
    try {
      const res = await deps.readFile(project.id, pathText);
      const text = String((res && res.text) || '');
      tabs = tabs.concat([{ path: pathText, text, saved: text, dirty: false }]);
      activePath = pathText;
      say(null);
    } catch (err) { fail(err); }
    paint();
  }

  async function save() {
    const tab = activeTab();
    if (!tab || !project || !deps.writeFile) return;
    try {
      await deps.writeFile(project.id, tab.path, tab.text);
      tab.saved = tab.text;
      tab.dirty = false;
      say('저장했습니다', false);
    } catch (err) { fail(err); }
    paint();
  }

  async function createFile() {
    const name = fileName.trim();
    if (!isPython(name)) {
      say('파이썬(.py) 파일만 만들 수 있습니다', true);
      paint();
      return;
    }
    if (!project || !deps.createFile) return;
    try {
      const res = await deps.createFile(project.id, name, 'file');
      namingFile = false;
      fileName = '';
      await loadTree();
      await openFile(res.path);
      return;
    } catch (err) { fail(err); }
    paint();
  }

  // 이름 바꾸기도 .py 밖으로는 못 나간다(D3) — 백엔드가 415로 다시 막는 그 규칙이다.
  async function renameActive() {
    const tab = activeTab();
    const to = renameTo.trim();
    if (!tab || !project || !deps.renameFile) return;
    if (!isPython(to)) {
      say('파일은 파이썬(.py)으로만 이름을 바꿀 수 있습니다', true);
      paint();
      return;
    }
    try {
      const res = await deps.renameFile(project.id, tab.path, to);
      tab.path = res.path;
      activePath = res.path;
      renaming = false;
      renameTo = '';
      await loadTree();
      say(null);
    } catch (err) { fail(err); }
    paint();
  }

  async function deleteActive() {
    const target = deleting;
    if (!target || !project || !deps.deleteFile) return;
    try {
      await deps.deleteFile(project.id, target);
      deleting = null;
      tabs = tabs.filter((t) => t.path !== target);
      if (activePath === target) activePath = tabs.length ? tabs[tabs.length - 1].path : null;
      await loadTree();
      say(`${basename(target)}를 지웠습니다`, false);
    } catch (err) { fail(err); }
    paint();
  }

  // 밖에서 "이 폴더의 이 파일을 열어라"라고 부르는 자리(설계 폼의 [내 전략] 선택).
  // 사람이 목록에서 폴더를 고르고 트리에서 파일을 누르는 그 경로를 그대로 탄다 — 두 길을
  // 따로 만들면 언젠가 한쪽만 고쳐진다. 열렸는지를 불리언으로 돌려주는 이유: 부른 쪽이
  // "열었다"고 말하기 전에 정말 열렸는지 알아야 한다(등록부의 파일은 지워졌을 수 있다).
  async function openAt(projectId, pathText) {
    // 목록이 비었을 때만 다시 읽으면, 이 세션에서 만든 프로젝트(등록 뒤 열기)는 영영
    // 없는 폴더가 된다 — 처음 그린 목록이 그대로 남기 때문이다(프로브 M10~M13 실측).
    // 찾는 id가 없을 때도 한 번 다시 읽는다.
    if (!projects.length || !projects.some((p) => p.id === projectId)) await loadProjects();
    const next = projects.find((p) => p.id === projectId);
    if (!next) {
      say('그 폴더가 프로젝트 목록에 없습니다', true);
      paint();
      return false;
    }
    if (!project || project.id !== projectId) await selectProject(next);
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
    tabs = tabs.filter((t) => t.path !== pathText);
    closing = null;
    if (activePath === pathText) {
      const next = tabs[index] || tabs[index - 1] || null;
      activePath = next ? next.path : null;
    }
    paint();
  }

  // 열린 파일을 전부 닫는다 — 프리셋을 고르면 새 전략이라(backtest-canvas selectPreset) 앞
  // 폴더의 .py가 열린 채 남으면 화면은 프리셋인데 실행은 그 파이썬이 돈다(프로브 실측).
  // 고치다 만(dirty) 탭은 닫지 않고 false를 돌려준다 — 저장 안 한 편집을 소리 없이 버리지
  // 않는다. 그 탭이 남아 있으면 지도는 계속 코드 전용으로 읽히는데, 그게 사실이다.
  function closeAll() {
    const dirty = tabs.filter((t) => t.dirty);
    tabs = dirty;
    closing = null;
    activePath = dirty.length ? dirty[dirty.length - 1].path : null;
    paint();
    return dirty.length === 0;
  }

  // ---------- 그리기 ----------

  function renderPicker() {
    const wrap = el('div', 'project-ide-picker');
    projects.forEach((p) => {
      const isOn = !!(project && project.id === p.id);
      const item = button(
        `project-ide-project${isOn ? ' is-on' : ''}`, p.name,
        () => { void selectProject(p); },
      );
      item.setAttribute('aria-pressed', String(isOn));
      wrap.appendChild(item);
    });
    wrap.appendChild(button('project-ide-new-project', '새 프로젝트', () => {
      namingProject = !namingProject;
      paint();
    }));
    wrap.appendChild(button('project-ide-open-folder', '폴더 열기', () => { void openFolder(); }));
    if (namingProject) {
      const input = el('input', 'project-ide-project-name');
      input.type = 'text';
      input.placeholder = '프로젝트 이름';
      input.value = projectName;
      // 입력마다 다시 그리면 커서가 날아간다 — 값만 모델에 담고 화면은 그대로 둔다.
      input.addEventListener('input', () => { projectName = input.value; });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { projectName = input.value; void createProject(); }
      });
      wrap.appendChild(input);
      wrap.appendChild(button('project-ide-project-go', '만들기', () => { void createProject(); }));
    }
    return wrap;
  }

  function renderTreeNode(entry, depth, out) {
    const row = el('div', 'project-ide-row');
    row.setAttribute('style', `padding-left:${depth * 12}px`);
    if (entry.is_dir) {
      const isOpen = !collapsed[entry.path] || !!filter.trim();
      const node = button(
        `project-ide-dir${isOpen ? ' is-open' : ''}`,
        `${isOpen ? '▾' : '▸'} ${entry.name}`,
        () => {
          if (collapsed[entry.path]) delete collapsed[entry.path];
          else collapsed[entry.path] = true;
          paint();
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
    const isOn = activePath === entry.path;
    const node = button(
      `project-ide-file ${py ? 'is-py' : 'is-other'}${isOn ? ' is-on' : ''}`,
      entry.name,
      () => { void openFile(entry.path); },
    );
    node.setAttribute('aria-pressed', String(isOn));
    row.appendChild(node);
    out.appendChild(row);
  }

  function renderSide() {
    const side = el('div', 'project-ide-side');
    const box = el('input', 'project-ide-filter');
    box.type = 'text';
    box.placeholder = '파일 이름으로 거르기';
    box.value = filter;
    box.addEventListener('input', () => { filter = box.value; paintTree(); });
    side.appendChild(box);

    const tree = el('div', 'project-ide-tree');
    side.appendChild(tree);
    treeNode = tree;
    paintTree();

    const newRow = el('div', 'project-ide-new-row');
    newRow.appendChild(button('project-ide-new', '새 파일', () => {
      namingFile = !namingFile;
      paint();
    }));
    if (namingFile) {
      const input = el('input', 'project-ide-new-name');
      input.type = 'text';
      input.placeholder = '이름.py';
      input.value = fileName;
      input.addEventListener('input', () => { fileName = input.value; });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { fileName = input.value; void createFile(); }
      });
      newRow.appendChild(input);
      newRow.appendChild(button('project-ide-new-go', '만들기', () => { void createFile(); }));
    }
    side.appendChild(newRow);
    if (truncated) {
      side.appendChild(el('div', 'project-ide-truncated', '파일이 너무 많아 일부만 보여줍니다'));
    }
    return side;
  }

  // 트리만 따로 다시 그린다 — 거르기 입력이 매 글자마다 포커스를 잃으면 못 쓴다.
  function paintTree() {
    if (!treeNode) return;
    clear(treeNode);
    const shown = filterEntries(entries, filter);
    if (!shown.length) {
      treeNode.appendChild(el('div', 'project-ide-empty', filter.trim() ? '걸린 파일이 없습니다' : '빈 폴더입니다'));
      return;
    }
    shown.forEach((entry) => renderTreeNode(entry, 0, treeNode));
  }

  function renderTabStrip() {
    const strip = el('div', 'project-ide-tabstrip');
    dotNodes = {};
    tabs.forEach((tab) => {
      const isOn = activePath === tab.path;
      const item = el('div', `project-ide-tab${isOn ? ' is-on' : ''}`);
      const name = button('project-ide-tab-name', basename(tab.path), () => {
        activePath = tab.path;
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

  function syncDirtyMarks() {
    tabs.forEach((tab) => {
      const dot = dotNodes[tab.path];
      if (!dot) return;
      dot.className = `project-ide-tab-dot${tab.dirty ? ' is-dirty' : ''}`;
      dot.textContent = tab.dirty ? '●' : '';
    });
  }

  function renderMain() {
    const main = el('div', 'project-ide-main');
    main.appendChild(renderTabStrip());

    const tab = activeTab();
    const head = el('div', 'project-ide-head');
    head.appendChild(el('span', 'project-ide-head-project', project ? project.name : ''));
    head.appendChild(el('span', 'project-ide-head-path', tab ? tab.path : '연 파일이 없습니다'));
    head.appendChild(button('project-ide-save', '저장', () => { void save(); }));
    if (tab) {
      head.appendChild(button('project-ide-rename', '이름 바꾸기', () => {
        renaming = !renaming;
        renameTo = tab.path;
        paint();
      }));
      head.appendChild(button('project-ide-delete', '지우기', () => {
        deleting = tab.path;
        paint();
      }));
    }
    main.appendChild(head);

    if (tab && renaming) {
      const row = el('div', 'project-ide-rename-row');
      const input = el('input', 'project-ide-rename-name');
      input.type = 'text';
      input.placeholder = '새 경로.py';
      input.value = renameTo;
      input.addEventListener('input', () => { renameTo = input.value; });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { renameTo = input.value; void renameActive(); }
      });
      row.appendChild(input);
      row.appendChild(button('project-ide-rename-go', '적용', () => { void renameActive(); }));
      main.appendChild(row);
    }

    if (deleting) {
      const bar = el('div', 'project-ide-confirm');
      bar.appendChild(el(
        'span', 'project-ide-confirm-text', `${basename(deleting)}를 디스크에서 지웁니다`,
      ));
      bar.appendChild(button('project-ide-delete-go', '지우기', () => { void deleteActive(); }));
      bar.appendChild(button('project-ide-delete-cancel', '취소', () => {
        deleting = null;
        paint();
      }));
      main.appendChild(bar);
    }

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
    if (tab) {
      CodeEditor.createCodeEditor({
        container: host,
        value: tab.text,
        onChange: (next) => {
          tab.text = next;
          tab.dirty = tab.text !== tab.saved;
          // 편집기를 다시 만들면 조합 중인 한글이 날아간다 — 점만 갈아 끼운다.
          syncDirtyMarks();
        },
      });
    } else {
      host.appendChild(el('div', 'project-ide-empty', '왼쪽에서 .py 파일을 고르세요'));
    }
    return main;
  }

  function paint() {
    clear(root);
    treeNode = null;
    root.appendChild(renderPicker());
    if (message) {
      root.appendChild(el(
        'div', `project-ide-message${message.bad ? ' is-bad' : ''}`, message.text,
      ));
    }
    if (!project) {
      if (loaded && !projects.length) {
        root.appendChild(el(
          'div', 'project-ide-empty',
          '아직 프로젝트가 없습니다 — [새 프로젝트]나 [폴더 열기]로 시작하세요',
        ));
      }
      return;
    }
    const body = el('div', 'project-ide-body');
    body.appendChild(renderSide());
    body.appendChild(renderMain());
    root.appendChild(body);
  }

  // Ctrl+S는 편집기 textarea에서 올라온다(진짜 DOM의 버블링). 테스트는 루트에 바로 쏜다.
  function handleKeydown(event) {
    if (!event || !(event.ctrlKey || event.metaKey)) return false;
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
    currentProject() { return project; },
    openAt,
    closeAll,
    adoptExternalWrite,
    activeFile() {
      const tab = activeTab();
      return tab ? { path: tab.path, text: tab.text, dirty: tab.dirty } : null;
    },
    activeText() {
      const tab = activeTab();
      return tab ? tab.text : '';
    },
    isDirty() {
      const tab = activeTab();
      return !!(tab && tab.dirty);
    },
    save,
    handleKeydown,
  };
}

const __exports = {
  createProjectIde,
  // 순수 계산 — node --test 대상(card-primitives.js와 같은 노출 원칙)
  basename,
  isPython,
  filterEntries,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.ProjectIde = __exports;
}

})();
