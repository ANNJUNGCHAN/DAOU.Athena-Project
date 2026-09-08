'use strict';

// 공급자(Claude·Grok·Codex)가 화면에서 말하는 것과 앱이 실제로 도는 것이 어긋나지
// 않는지 잰다. chat.js는 렌더러 전역이라 require로 부를 순수 모듈이 없어
// product-copy-hygiene.test.js와 같은 방식으로 소스 텍스트를 읽는다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const settingsSource = fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
const chatCss = fs.readFileSync(path.join(appDir, 'chat.css'), 'utf8');

function body(source, signature) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${signature} 가 있다`);
  return match[0];
}

test('모델 카드 리드는 그 카드가 그리는 공급자를 하나도 빠뜨리지 않는다', () => {
  for (const title of ["title: 'Claude'", "title: 'Grok'", "title: 'Codex'"]) {
    assert.ok(settingsSource.includes(title), `${title} 섹션이 카드에 있다`);
  }
  assert.ok(settingsSource.includes('Claude·Grok·Codex CLI 로그인을 그대로 쓴다'));
  assert.ok(!settingsSource.includes('Claude·Codex CLI 로그인을 그대로 쓴다'),
    'Grok 섹션이 화면에 있는데 리드가 둘만 말하면 거짓말이다');
});

// 계정이 하나라도 감지되면 buildModelSection이 buildAccountCard를 부르고, 그것은
// sourceLabel(acc)을 호출한다 — 없으면 던져서 그 아래 섹션과 안내문이 통째로
// 사라진다(2026-09-06 Paper OJ-0 프로브 실측).
test('계정 카드를 그리는 공급자 섹션은 모두 출처 문구를 넘긴다', () => {
  const sections = settingsSource.match(/buildModelSection\(\{[\s\S]*?\n {2}\}\)\)/g) || [];
  assert.equal(sections.length, 3, '모델 카드는 공급자 섹션 셋을 그린다');
  for (const section of sections) {
    assert.match(section, /sourceLabel:/, `sourceLabel 없는 섹션: ${section.slice(0, 60)}`);
  }
});

// 어느 공급자의 값인지는 main.js resolveActiveModelSelection 하나가 정한다 —
// athena:model-get의 active를 셸 툴바·오브 스트립·실행기가 같이 읽는다. 렌더러가
// 계정 목록으로 따로 판정하면 오브는 FABLE, 셸은 Grok-4.5를 말한다(2026-09-08 실측).
test('작성창 툴바는 main이 정한 활성 공급자 값을 말한다', () => {
  assert.doesNotMatch(chatSource, /function activeQueryProvider\(\)/,
    '공급자 판정을 렌더러가 다시 하면 main·오브와 어긋날 수 있다');

  const render = body(chatSource, 'function renderComposerModel()');
  assert.match(render, /modelStateCache\.active/);
  assert.match(render, /s\.provider === 'grok'/);
  assert.match(render, /PILL_GROK_MODEL_CHIPS/);
  assert.match(render, /PILL_GROK_EFFORT_CHIPS/);
  assert.doesNotMatch(render, /modelStateCache\.claude/,
    'Grok이 활성인데 Claude 값을 말하면 실행기와 다른 이름이 뜬다');

  const mainSource = fs.readFileSync(path.join(appDir, 'main.js'), 'utf8');
  assert.match(body(mainSource, 'function handleModelGet()'), /active: resolveActiveModelSelection\(/);
  const orbSource = fs.readFileSync(path.join(appDir, 'orb.js'), 'utf8');
  const strip = body(orbSource, 'async function refreshChatControlStrip()');
  assert.match(strip, /st\.active/);
  assert.doesNotMatch(strip, /st\.claude/, '오브가 Claude 값을 따로 읽으면 셸과 다른 모델을 말한다');
  assert.match(orbSource, /window\.athena\.on\('athena:model-changed'/);

  assert.match(chatSource, /window\.athena\.on\('athena:cli-changed', \(list\) => applyCliState\(list\)\)/,
    '목록을 실어 오는 이벤트를 버리고 다시 물으면 계정 변경마다 codex 프로브가 한 번 더 돈다');
});

// athena:cli-list 핸들러는 `codex login status` 자식 프로세스를 최대 5초 기다린다
// (main.js handleCliList → cli-accounts.js reconcileCodexRuntimeAccountLocked, 캐시 없음).
// 그 왕복이 팝오버 여는 길에 들어가면 [모델]을 눌러도 2초 동안 아무 것도 안 열리고,
// 1Y3-0 라우트의 도달 절차(클릭 + settle)도 결정론을 잃는다.
test('팝오버 여는 길에 CLI 목록 왕복을 기다리지 않는다', () => {
  assert.doesNotMatch(body(chatSource, 'async function refreshModelState()'), /athena:cli-list/);
  assert.doesNotMatch(body(chatSource, 'async function openModelPopover()'), /athena:cli-list/);
  assert.match(body(chatSource, 'function applyCliState(list)'), /cliStateCache = list/);
  assert.match(chatSource, /window\.athena\.invoke\('athena:cli-list'\)\.then\(applyCliState/);
});

test('모델 팝오버의 Grok 칩은 연결 전에는 눌리지 않는다', () => {
  const popover = body(chatSource, 'function renderModelPopover()');
  assert.match(popover, /const grokLocked = !providerConnected\('grok'\)/);
  assert.match(popover, /popoverSection\('Grok 모델',[^)]*grokLocked\)/);
  assert.match(popover, /popoverSection\('Grok 사고 강도',[^)]*grokLocked\)/);

  const section = body(chatSource, 'function popoverSection(');
  assert.match(section, /b\.disabled = !!locked/);
  assert.match(section, /연결 후 사용/);

  assert.match(chatCss, /\.model-popover \.mp-chip:disabled\s*\{/);
});
