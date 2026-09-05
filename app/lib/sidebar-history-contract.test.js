// 사이드바 이력 표면 계약(2026-09-05, 35·29·41번 보드 개정) — 렌더러 없이 소스만 읽는다
// (plugin-proposal-boundary.test.js와 같은 방식). 넷 다 사용자가 실앱에서 직접 짚은
// 어긋남이라, 되돌아오면 바로 잡히도록 여기 못 박는다. 동작 자체는 Electron 프로브
// (probe-session-restore.js)가 잰다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(appDir, ...parts), 'utf8');
const sidebar = read('lib', 'sidebar.js');
const chat = read('chat.js');
const chatCss = read('chat.css');
const shellCss = read('shell.css');

function renderListBody() {
  const start = sidebar.indexOf('function renderList()');
  assert.ok(start >= 0, 'renderList가 없다');
  const end = sidebar.indexOf('\n  function ', start + 1);
  return sidebar.slice(start, end > 0 ? end : undefined);
}

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
