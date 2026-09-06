'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const settingsSource = fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8');
const settingsCss = fs.readFileSync(path.join(appDir, 'styles', 'settings-cards.css'), 'utf8');
const shellSource = fs.readFileSync(path.join(appDir, 'shell.js'), 'utf8');

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

test('설명문이 사라진 토글과 배율 컨트롤은 접근 가능한 이름을 가진다', () => {
  assert.match(settingsSource, /function toggleSwitch\(initial, onChange, ariaLabel\)/);
  for (const label of [
    '질의하면 캔버스 창을 자동으로 연다',
    '답변 길이에 따라 대화 창이 자란다',
    'AI가 이 계좌의 주문 API를 호출하도록 허용',
    '대화',
    '체결내역',
    '보유 종목·수량과 대화 원문을 모델에 전달',
    '보유잔고 수집',
  ]) {
    assert.match(settingsSource, new RegExp(label));
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

test('보유잔고 조회 주기는 토글 옆 기능 그룹이며 컨트롤 이름이 있다', () => {
  assert.match(settingsSource, /uk-holdings-controls/);
  assert.match(settingsSource, /setAttribute\('aria-label', '보유잔고 조회 주기'\)/);
  assert.match(settingsSource, /'보유잔고 수집'/);
  assert.doesNotMatch(settingsCss, /\.uk-holdings-sub\b/);
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
