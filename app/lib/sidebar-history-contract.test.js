// 사이드바 이력 표면 계약(2026-09-05, 35·29·41번 보드 개정) — 렌더러 없이 소스만 읽는다
// (plugin-proposal-boundary.test.js와 같은 방식). 넷 다 사용자가 실앱에서 직접 짚은
// 어긋남이라, 되돌아오면 바로 잡히도록 여기 못 박는다. 동작 자체는 Electron 프로브
// (probe-session-restore.js)가 잰다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSessionWorkspace } = require('./session-workspace');

const appDir = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(appDir, ...parts), 'utf8');
const sidebar = read('lib', 'sidebar.js');
const chat = read('chat.js');
const chatCss = read('chat.css');
const shellCss = read('shell.css');
const shellHtml = read('shell.html');

test('계정 메뉴 사용량 값은 토큰 접두 없이 남고 머리·항목에 아이콘이 있다', () => {
  const start = sidebar.indexOf('function menuItemIcon');
  const end = sidebar.indexOf('function openSettingsBridge');
  const menu = sidebar.slice(start, end);
  assert.match(menu, /sidebar-menu-avatar/);
  assert.match(menu, /sidebar-menu-item-ic/);
  assert.match(menu, /viewBox', '0 0 14 14'/);
  const clickStart = sidebar.indexOf("$accountRow.addEventListener('click'");
  const clickEnd = sidebar.indexOf('document.addEventListener(\'mousedown\'', clickStart);
  const click = sidebar.slice(clickStart, clickEnd);
  assert.match(click, /formatTokenRemaining\(status\.expiresInSec\)/);
  assert.equal(click.includes('`토큰 ${formatTokenRemaining'), false);
  assert.match(shellCss, /\.sidebar-menu-avatar \{[^}]*width:\s*26px/s);
  assert.match(shellCss, /\.sidebar-menu-item-ic \{[^}]*width:\s*14px/s);
});

test('에이전트 모드 행에 활성 감시 수가 있다 — 스트립 필 「감시 N」의 자리', () => {
  assert.match(shellHtml, /id="modeNavAgentWatch"/);
  assert.match(sidebar, /getElementById\('modeNavAgentWatch'\)/);
  assert.match(sidebar, /activeWatchCount\(routines\)/);
  assert.match(sidebar, /setWatchCount\(/);
  assert.doesNotMatch(shellHtml, /감시 수=사이드바 에이전트 배지\(예정\)/);
  assert.match(chat, /사이드바 #modeNavAgentWatch/);
  const fnStart = sidebar.indexOf('async function loadAgentRoutines()');
  const fnEnd = sidebar.indexOf('\n  const INITIAL_VISIBLE', fnStart);
  const fn = sidebar.slice(fnStart, fnEnd);
  const guard = fn.indexOf('if (requestId !== agentRoutinesRequestId) return');
  const apply = fn.lastIndexOf('setWatchCount(');
  assert.ok(guard >= 0 && apply > guard, '낡은 routines 응답이 감시 수를 덮으면 안 된다');
  const agentBtn = shellHtml.slice(shellHtml.indexOf('id="modeNavAgent"'), shellHtml.indexOf('id="modeNavPlugin"'));
  assert.ok(agentBtn.indexOf('modeNavAgentCount') < agentBtn.indexOf('modeNavAgentWatch'));
  assert.ok(agentBtn.indexOf('modeNavAgentWatch') < agentBtn.indexOf('modeNavAgentBadge'));
  assert.match(sidebar, /listed && agentRoutinesRequestId === 0/);
});

function renderListBody() {
  const start = sidebar.indexOf('function renderList()');
  assert.ok(start >= 0, 'renderList가 없다');
  const end = sidebar.indexOf('\n  function ', start + 1);
  return sidebar.slice(start, end > 0 ? end : undefined);
}

test('펜 모드 선택 줄마다 현재 대화 수가 있다', () => {
  const start = sidebar.indexOf('function makeModePicker');
  const end = sidebar.indexOf('\n  function ', start + 1);
  const body = sidebar.slice(start, end);
  assert.match(body, /countConversationsByMode\(conversationsCache, project\.id\)/);
  assert.match(body, /sidebar-mode-picker-count/);
  assert.match(body, /modeCountLabel\(counts\[choice\.mode\]\)/);
  const sessionCss = read('styles', 'sidebar-session.css');
  assert.match(sessionCss, /\.sidebar-mode-picker-count/);
});

test('최근 캡션 오른쪽에 「전체」가 있고 목록 발치 「더 보기」는 없다', () => {
  const body = renderListBody();
  const sessionCss = read('styles', 'sidebar-session.css');
  assert.match(body, /makeRecentAllButton\(/);
  assert.match(sidebar, /textContent = '전체'/);
  assert.doesNotMatch(body, /더 보기/);
  assert.match(sessionCss, /\.sidebar-recent-all/);
});

test('모드 클릭은 목록을 거르지 않는다 — renderList에 현재 모드 필터가 없다', () => {
  const body = renderListBody();
  assert.ok(!body.includes('viewToMode(currentMode())'), 'renderList가 현재 모드로 대화를 거른다');
  assert.ok(!/const inMode\b/.test(body), 'inMode 필터가 되살아났다');
  assert.match(body, /conversationsCache\.filter\(\(c\) => c\.title/, '검색은 여전히 제목으로 거른다');
});

test('대화 행마다 모드 아이콘 슬롯이 제목 앞에 선다', () => {
  const start = sidebar.indexOf('function makeConversationItem(');
  const body = sidebar.slice(start, sidebar.indexOf('\n  function ', start + 1));
  const icon = body.indexOf('makeModeIcon(conv.mode)');
  const label = body.indexOf("el('span', 'sidebar-item-label')");
  assert.ok(icon >= 0, '행에 makeModeIcon이 없다');
  assert.ok(label > icon, '아이콘이 제목 뒤에 붙는다 — 레인 순서는 아이콘 · 제목 · 실행 점');
  assert.match(sidebar, /#sidebarModeNav \.sidebar-mode-item\[data-view="\$\{view\}"\] \.sidebar-mode-item-ic/,
    '아이콘은 모드 네비의 SVG를 복제해야 한다(원본 둘 금지)');
  assert.match(shellCss, /\.sidebar-item-mode-ic\s*\{[^}]*width:\s*14px/, '슬롯 폭이 고정돼야 제목 레인이 안 흔들린다');
});

test('복원은 조용하다 — 채팅에 복원 배너가 없다', () => {
  // 주석은 옛 문구를 인용할 수 있으니 코드 모양(className 대입·textContent 대입)만 본다.
  assert.ok(!/className\s*=\s*['"]past-banner/.test(chat), 'chat.js가 past-banner를 다시 그린다');
  assert.ok(!/textContent\s*=[^\n]*복원됨/.test(chat), 'chat.js가 "복원됨" 배너 문구를 그린다');
  assert.ok(!/[=?:]\s*[`'"]이어서 말할 수 있습니다/.test(chat), '문맥 안내 문구가 코드에 남아 있다');
  assert.ok(!/\.past-banner\b/.test(chatCss), 'chat.css에 죽은 .past-banner 규칙이 남아 있다');
  assert.match(chatCss, /\.past-empty\s*\{/, '메시지 0건의 빈 상태는 남아야 한다');
});

test('프로젝트 행을 두 번 누르면 이름 수정 패널이 열린다', () => {
  const start = sidebar.indexOf('function makeProjectRow');
  const end = sidebar.indexOf('\n  function ', start + 1);
  const body = sidebar.slice(start, end);
  assert.match(body, /addEventListener\('dblclick'/);
  assert.match(body, /if \(clickTimer\) \{ clearTimeout\(clickTimer\)/);
  assert.match(body, /openEditProjectId = project\.id/);
  assert.match(body, /restoreCaret\('\.sidebar-project-edit-input\[data-field="label"\]'\)/);
});

test('프로젝트 설명 카드는 버튼 밖에 살고, 프로젝트 수정은 진짜 버튼이다', () => {
  const start = sidebar.indexOf('function makeProjectRow(');
  const body = sidebar.slice(start, sidebar.indexOf('\n  function ', start + 1));
  assert.ok(!body.includes('main.title ='), '행 title 툴팁이 설명 카드 위에 겹친다');
  assert.ok(!body.includes('main.appendChild(description)'), '설명 카드가 버튼 안에 있으면 클릭이 버튼으로 샌다');
  assert.match(body, /wrap\.appendChild\(description\)/, '설명 카드는 행 묶음의 형제여야 한다');
  assert.match(body, /el\('button', 'sidebar-project-description-action'\)/, "'프로젝트 수정'은 button이어야 한다");
  assert.match(body, /openEditProjectId = project\.id/, "'프로젝트 수정'이 편집 패널을 열어야 한다");
  const descriptionRule = shellCss.match(/\.sidebar-project-description\s*\{([^}]*)\}/);
  assert.ok(descriptionRule, '.sidebar-project-description 규칙이 없다');
  assert.ok(!/pointer-events:\s*none/.test(descriptionRule[1]), '카드가 포인터를 막으면 버튼을 누를 수 없다');
});

test('계정 메뉴의 「계좌 전환」은 설정이 아니라 계좌 전환 화면(Paper 1M3-0)을 연다', () => {
  const start = sidebar.indexOf('function buildAccountMenu(');
  assert.ok(start >= 0, 'buildAccountMenu가 없다');
  const body = sidebar.slice(start, sidebar.indexOf('\n  function ', start + 1));
  const switcherStart = body.indexOf("switchLabel.textContent = '계좌 전환'");
  const switcher = body.slice(switcherStart, body.indexOf('$accountMenu.appendChild(switcher);', switcherStart));
  assert.match(switcher, /switcher\.addEventListener\('click', \(\) => \{ closeAccountMenu\(\); openAccountSwitchBridge\(\); \}\)/);
  assert.ok(!switcher.includes('openSettingsBridge'), '계좌 전환이 설정 창을 여는 옛 배선이 남았다');

  assert.match(sidebar, /window\.AthenaShell\.openAccountSwitch\(/, '버스로 넘긴다');
  // 나머지 두 항목은 그대로 설정으로 간다.
  assert.match(body, /usage\.addEventListener\('click', \(\) => \{ closeAccountMenu\(\); openSettingsBridge\(\); \}\)/);
  assert.match(body, /settings\.addEventListener\('click', \(\) => \{ closeAccountMenu\(\); openSettingsBridge\(\); \}\)/);
});

test('계좌 전환 화면은 embedded가 아니고 온보딩 3 / 3 호출자는 그대로 embedded다', () => {
  const shellJs = read('shell.js');
  assert.match(shellJs, /registerOpenAccountSwitch\(fn\)/);
  assert.match(shellJs, /openAccountSwitch\(accountId\)/);

  const open = chat.match(/function openAccountSwitchScreen\(accountId\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(open, 'chat.js에 계좌 전환 진입 함수가 있다');
  assert.match(open[1], /embedded: false/);
  assert.match(open[1], /initialView: 'switch'/);
  // 온보딩 3/3(showAuthConfirm)은 여전히 embedded: true다 — 새 호출자를 더한 것이지
  // 기존 값을 뒤집은 것이 아니다.
  const confirm = chat.match(/function showAuthConfirm\(accountId\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(confirm);
  assert.match(confirm[1], /embedded: true/);
});

// Paper 보드 34(2V27-1)는 검색 패널을 두 판으로 그렸다 — 결과판과 빈 결과판이다.
// 빈 판은 질의가 있고 결과가 0건일 때만 서는 자리라 Paper 화면 게이트가 못 재고
// (라우트는 결과판 하나만 도달한다), 「검색 결과 없음」 한 줄로 되돌아가기 쉽다.
test('검색 빈 결과판은 Paper 34의 세 조각을 그린다 — 안내문과 새 대화 문이 있다', () => {
  const start = sidebar.indexOf('function renderSearchPanel()');
  assert.ok(start >= 0, 'renderSearchPanel이 없다');
  const body = sidebar.slice(start, sidebar.indexOf('\n  function ', start + 1));
  assert.match(body, /'sidebar-search-empty', '결과 없음'/);
  assert.match(body, /'sidebar-search-empty-note', '아직 이 주제로 나눈 대화가 없습니다'/);
  assert.match(body, /'sidebar-search-empty-cta', '새 대화로 물어보기'/);
  assert.match(body, /startNewConversation\(currentProjectId\)/, '새 대화 문이 실제로 대화를 연다');
  // 발치의 키보드 안내·총 건수는 결과판에만 있다(Paper 빈 판에는 없다).
  assert.match(body, /if \(result\.total\) \{\s+const foot = /, '발치가 빈 판에도 붙는다');
  assert.match(shellCss, /\.sidebar-search-empty-cta\s*\{/, 'CTA 스타일이 없다');
});

test('새 대화 요청 전에 앞 세션의 지연 작업공간을 흘린다', async () => {
  let activeId = 'previous';
  const saved = [];
  const workspace = createSessionWorkspace({
    send: (payload) => { saved.push({ id: activeId, patch: payload.patch }); },
  });
  workspace.register('backtest', {
    restore() {},
    flush() { workspace.report({ run: { runId: 'previous-run' } }); },
    clear() {},
  });
  // Electron 대신 IPC 경계만 대체한다. 함수 본문은 sidebar.js의 실제 새 대화 경로다.
  const context = vm.createContext({
    Event,
    window: {
      dispatchEvent: (event) => {
        if (event.type === 'athena:new-conversation') { workspace.flush(); workspace.clear(); }
      },
      athena: { invoke: async (channel) => {
        assert.equal(channel, 'athena:conversations-new');
        activeId = 'next';
        return { activeId };
      } },
    },
    projectsCache: [{ id: 'project' }], currentProjectId: 'project',
    conversationsCache: [], activeConversationId: 'previous', selectedNotifyId: null,
    $history: { firstChild: null }, $roomBanner: {}, $input: null,
    currentMode: () => 'backtest', renderList() {}, updateModeCounts() {},
  });
  const start = sidebar.indexOf('  function clearConversationUi()');
  const end = sidebar.indexOf("  $newChat.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(sidebar.slice(start, end), context);
  await vm.runInContext("startNewConversation('project')", context);
  assert.deepEqual(saved, [{ id: 'previous', patch: { run: { runId: 'previous-run' } } }]);
  assert.equal(activeId, 'next');
});
