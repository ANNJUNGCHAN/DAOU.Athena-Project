'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const settingsSource = fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8');
// 그래프 수집·노출 토글의 주인(Paper 보드 22) — 설정 4번째 카드가 아니라 그래프
// 모드의 「수집·노출」 탭이다. 접근 이름 계약은 그 파일에서 잰다.
const collectionSource = fs.readFileSync(path.join(__dirname, 'graph-mode', 'collection-settings.js'), 'utf8');
const settingsCss = fs.readFileSync(path.join(appDir, 'styles', 'settings-cards.css'), 'utf8');
const shellSource = fs.readFileSync(path.join(appDir, 'shell.js'), 'utf8');
// 카드의 두 버튼(내보내기 · 전체 삭제)이 실제로 다루는 저장소는 main이 정한다.
const mainSource = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = settingsCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `CSS rule not found: ${selector}`);
  return match[1];
}

test('설정 토글 행의 수동 하단 설명과 무의미한 창 배치 행이 없다', () => {
  assert.doesNotMatch(settingsSource, /uk-toggle-sub/);
  assert.doesNotMatch(settingsCss, /\.uk-toggle-sub\b/);
  for (const copy of [
    'OFF면 캔버스 창을 손으로 열어야 한다',
    'OFF면 그립을 끌어야만 창이 커진다',
    '두 창의 모든 텍스트에 적용된다',
    '두 창과 카드에 함께 적용된다',
    'Ctrl+= / Ctrl+- / Ctrl+휠과 같은 조작이다',
    'OFF일 때는 어떤 주문 요청도 실행되지 않는다',
    '대화가 끝날 때마다 · LLM 추출',
    '60분마다 · LLM 없이 그대로',
    '켜면 답변이 사용자를 알고 시작합니다',
    '수량이 바뀔 때만 기록',
  ]) {
    assert.doesNotMatch(settingsSource, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(settingsSource, /uk-toggle-label', '창 배치'/);
});

test('화면 설정에는 유리 투명도 선택 옵션이 없다', () => {
  assert.doesNotMatch(settingsSource, /유리 투명도/);
  assert.doesNotMatch(settingsSource, /glassLevel/);
  assert.doesNotMatch(settingsSource, /GLASS_CHIPS/);
});

test('설명문이 사라진 토글과 배율 컨트롤은 접근 가능한 이름을 가진다', () => {
  assert.match(settingsSource, /function toggleSwitch\(initial, onChange, ariaLabel\)/);
  for (const label of [
    '질의하면 캔버스 창을 자동으로 연다',
    '답변 길이에 따라 대화 창이 자란다',
    'AI가 이 계좌의 주문 API를 호출하도록 허용',
  ]) {
    assert.match(settingsSource, new RegExp(label));
  }
  for (const label of [
    '대화 수집',
    '체결내역',
    '보유 종목·수량과 대화 원문을 모델에 전달',
    '보유잔고 수집',
  ]) {
    assert.match(collectionSource, new RegExp(label));
  }
  assert.match(settingsSource, /zoomValue\.setAttribute\('aria-label', '현재 UI 배율'\)/);
  assert.match(settingsSource, /zoomValue\.setAttribute\('aria-live', 'polite'\)/);
  assert.doesNotMatch(settingsSource, /대화 모델에 성향 그래프 열기/);
});

test('UI 배율은 설정 버튼만 쓰고 shell 렌더러 단축키를 되살리지 않는다', () => {
  assert.match(settingsSource, /aria-label', 'UI 배율 축소'/);
  assert.match(settingsSource, /aria-label', 'UI 배율 확대'/);
  assert.match(settingsSource, /aria-label', 'UI 배율 재설정'/);
  assert.doesNotMatch(shellSource, /send\(\s*['"]athena:zoom['"]/);
  assert.doesNotMatch(shellSource, /addEventListener\(\s*['"]wheel['"]/);
});

test('조회 주기는 세 수집원 모두 토글 옆 기능 그룹이며 컨트롤 이름이 소스를 말한다', () => {
  assert.match(collectionSource, /graph-settings-source-controls/);
  // 2026-09-08 — 주기 선택기·수동 실행이 소스별로 붙으면서 이름은 소스 라벨에서 조립한다.
  assert.match(collectionSource, /setAttribute\('aria-label', `\$\{source\.label\} 조회 주기`\)/);
  assert.match(collectionSource, /setAttribute\('aria-label', `\$\{source\.label\} 지금 실행`\)/);
  assert.match(collectionSource, /label: '대화', intervalKey: 'chatIntervalMin'/);
  assert.match(collectionSource, /label: '체결내역', intervalKey: 'fillsIntervalMin'/);
  assert.match(collectionSource, /label: '보유잔고', intervalKey: 'holdingsIntervalMin'/);
  assert.match(collectionSource, /'보유잔고 수집'/);
  assert.doesNotMatch(settingsCss, /\.uk-holdings-sub\b/);
});

// ---------- Paper 보드 32 「설정 — 성향·이력」 ----------
// 네비 라벨만 성향·이력이고 내용은 보드 22(그래프 수집·노출)이던 어긋남을 닫는다.
// 같은 토글을 두 화면이 나눠 가지면 한쪽만 고쳐지는 날이 온다 — 수집·노출은
// 그래프 모드 「수집·노출」 탭 하나가 소유한다.
test('설정 4번째 카드는 Paper 32 성향·이력이다 — 수집 토글은 그래프 패널이 소유한다', () => {
  assert.match(settingsSource, /'성향·이력'/);
  assert.match(settingsSource, /'로컬 보관 · 언제든 내보내기 가능'/);
  assert.match(settingsSource, /'투자 성향'/);
  assert.match(settingsSource, /'대화 이력'/);
  assert.match(settingsSource, /'이력 내보내기'/);
  assert.match(settingsSource, /'삭제는 확인 단계를 한 번 더 거치며 되돌릴 수 없습니다'/);
  assert.doesNotMatch(settingsSource, /그래프 수집과 노출/);
  assert.doesNotMatch(settingsSource, /uk-holdings-controls/);
  assert.doesNotMatch(settingsCss, /\.uk-holdings-controls\b/);
});

// 전체 삭제는 브레인을 통째로 비운다 — 카드가 보여 주던 성향·보관 건수는 그
// 순간 옛 값이 된다. 다시 읽지 않으면 같은 카드가 위에서는 지운 값을, 아래에서는
// 「삭제 완료」를 말한다.
test('전체 삭제 성공 뒤에는 카드가 성향·이력 구역을 다시 읽는다', () => {
  const deleteHandler = settingsSource.slice(settingsSource.indexOf('function onDeleteClick('));
  assert.match(deleteHandler, /resultBox\.appendChild\(note\);[\s\S]{0,240}?fillHistorySections\(\);/);
});

// 카드가 세는 것과 두 버튼이 다루는 것이 다르면, 전체 삭제 뒤에도 같은 건수가
// 다시 서고 빈 이력을 「내보내기 완료」라고 적는다. 셋 다 브레인 하나를 본다.
test('보관 건수·내보내기·전체 삭제가 같은 저장소를 본다', () => {
  assert.match(settingsSource, /invoke\('athena:brain-conversations-count'\)/);
  assert.doesNotMatch(settingsSource, /athena:conversations-list/);
  const count = mainSource.slice(mainSource.indexOf("ipcMain.handle('athena:brain-conversations-count'"));
  assert.match(count.slice(0, 400), /\/api\/v1\/brain\/conversations/);
});

// 브레인 이력 조회는 상한을 안 넘기면 백엔드 기본값(대화 50 · 메시지 100)으로
// 조용히 잘린다 — 바로 옆이 되돌릴 수 없는 「전체 삭제」라, 다 담지 못했다면
// 카드가 그 사실을 말해야 한다.
test('이력 내보내기는 상한을 명시하고 담은 양을 카드가 말한다', () => {
  const exporter = mainSource.slice(
    mainSource.indexOf("ipcMain.handle('athena:history-export'"),
    mainSource.indexOf("ipcMain.handle('athena:brain-suggested-questions'"),
  );
  assert.match(exporter, /\/api\/v1\/brain\/conversations',\s*\{\s*params: \{ limit: BRAIN_HISTORY_PAGE_LIMIT \}/);
  assert.match(exporter, /conversation_id: summary\.conversation_id, limit: BRAIN_HISTORY_PAGE_LIMIT/);
  assert.match(exporter, /stored\.length < summary\.message_count\) truncated = true/);
  assert.match(exporter, /conversations: conversations\.length, messages, truncated/);
  assert.match(mainSource, /const BRAIN_HISTORY_PAGE_LIMIT = 500;/);
  assert.match(settingsSource, /내보내기 완료 — 대화 \$\{res\.conversations\}건 · 메시지 \$\{res\.messages\}건/);
  assert.match(settingsSource, /res\.truncated[\s\S]{0,120}이력이 많아 일부는 담기지 않았습니다/);
});

test('성향·이력 카드는 보드의 목업 수치를 하드코딩하지 않는다', () => {
  for (const mock of ['장기 ETF 적립형', '대화 128건', '42MB', '90일', '안정 추구', '지수 ETF · 반도체']) {
    assert.doesNotMatch(settingsSource, new RegExp(mock));
  }
});

test('#settingsGrid만 전체 높이를 채우고 카드 본문만 세로 스크롤한다', () => {
  const sharedGrid = cssRule('.settings-grid');
  assert.match(sharedGrid, /overflow:\s*auto/);
  assert.match(sharedGrid, /scroll-snap-type:\s*y proximity/);

  const grid = cssRule('#settingsGrid');
  assert.match(grid, /overflow:\s*hidden/);
  assert.match(grid, /scroll-snap-type:\s*none/);

  const card = cssRule('#settingsGrid > .card');
  assert.match(card, /flex:\s*1 1 0/);
  assert.match(card, /height:\s*100%/);
  assert.match(card, /min-height:\s*0/);
  assert.match(card, /max-height:\s*none/);

  const body = cssRule('#settingsGrid > .card > .card-body');
  assert.match(body, /overflow-y:\s*auto/);
  assert.match(body, /min-height:\s*0/);

  assert.doesNotMatch(settingsCss, /#orderBody\b/);
});

test('설정 4번째 네비 라벨은 Paper 13 성향・이력이다', () => {
  assert.match(settingsSource, /key: 'history', label: '성향・이력'/);
  assert.doesNotMatch(settingsSource, /key: 'history', label: '그래프'/);
});

// ---------- Paper AJ-0 「Shell 창 · 설정 모드」 ----------
// 보드가 그린 설정 모드는 1520×760 창 **전체**다 — 뒤에 사이드바도 대화 열도 없다.
// 반투명 오버레이만 올리던 옛 판은 셸이 그대로 비쳐 두 화면이 겹쳐 읽혔다.

test('설정을 열면 셸이 온보딩과 다른 전용 클래스로 숨는다', () => {
  const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
  const shellCss = fs.readFileSync(path.join(appDir, 'shell.css'), 'utf8');

  const open = chatSource.match(/function openSettings\(\)\s*\{([\s\S]*?)\n\}/);
  const close = chatSource.match(/function closeSettings\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(open && close, 'openSettings/closeSettings가 있다');
  assert.match(open[1], /\$shell\.classList\.add\('is-settings-hidden'\)/);
  assert.match(close[1], /\$shell\.classList\.remove\('is-settings-hidden'\)/);
  assert.doesNotMatch(open[1], /is-onboarding-hidden/, '온보딩 경로와 클래스를 나눠 서로 끄고 켜지 않는다');

  assert.match(shellCss, /#shell\.is-settings-hidden\s*\{[^}]*display:\s*none\s*!important/s);
});

test('설정 nav는 Paper AJ-0의 흰 패널과 어두운 선택 틴트다 — 다크 잔재가 아니다', () => {
  const chatCss = fs.readFileSync(path.join(appDir, 'chat.css'), 'utf8');
  const nav = chatCss.match(/\n\.settings-nav\s*\{([^}]*)\}/);
  const selected = chatCss.match(/\n\.settings-nav-item\.is-selected\s*\{([^}]*)\}/);
  assert.ok(nav && selected, '.settings-nav / .settings-nav-item.is-selected 규칙이 있다');

  // AY-0: background #FFFFFF59(=35%) · border #10131A0D(=5%)
  assert.match(nav[1], /background:\s*rgb\(255 255 255 \/ 35%\)/);
  assert.match(nav[1], /border:\s*1px solid rgb\(16 19 26 \/ 5%\)/);
  // B1-0: 선택 항목 #10131A12(=7%)
  assert.match(selected[1], /background:\s*rgb\(16 19 26 \/ 7%\)/);
  assert.doesNotMatch(selected[1], /255 255 255/, '흰 틴트는 흰 패널 위에서 보이지 않는다');
});
