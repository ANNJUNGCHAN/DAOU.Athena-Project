'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shellCss = fs.readFileSync(path.join(__dirname, '..', 'shell.css'), 'utf8');
const shellHtml = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
const chatSource = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const verifySource = fs.readFileSync(path.join(__dirname, '..', 'verify.js'), 'utf8');

function mediaBlock(maxWidth) {
  const marker = `@media (max-width: ${maxWidth}px)`;
  const start = shellCss.indexOf(marker);
  assert.notEqual(start, -1, `${marker} 규칙이 있어야 한다`);
  const next = shellCss.indexOf('@media ', start + marker.length);
  return shellCss.slice(start, next === -1 ? shellCss.length : next);
}

function responsiveCssForWidth(width) {
  return [1279, 699]
    .filter((maxWidth) => width <= maxWidth)
    .map(mediaBlock)
    .join('\n');
}

test('현재 Paper 50: BrowserWindow 최소 폭은 330px이다', () => {
  assert.match(mainSource, /minW:\s*330\b/);
  assert.match(mainSource, /setMinimumSize\(DESIGN\.minW,\s*DESIGN\.minH\)/);
});

test('현재 Paper 50: 700–1279px은 이력이 있을 때 하단 대화 트레이를 연다', () => {
  const css = mediaBlock(1279);
  assert.match(css, /#shell\s*\{[^}]*grid-template-columns:\s*268px\s+minmax\(0,\s*1fr\)[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+54px[^}]*\}/);
  assert.match(css, /#shell:has\(#chatRegion\s+\.history:not\(:empty\)\)\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+clamp\(196px,\s*30vh,\s*248px\)[^}]*\}/);
  assert.match(css, /#historyRegion\s*\{[^}]*grid-row:\s*1\s*\/\s*3[^}]*\}/);
  assert.match(css, /#chatRegion\s*\{[^}]*grid-column:\s*2[^}]*grid-row:\s*2[^}]*\}/);
  assert.match(css, /#chatRegion\s*>\s*\.app\s*>\s*:not\(\.history\):not\(\.input-stack\)/);
  assert.doesNotMatch(css, /#chatRegion\s*>\s*\.app\s*>\s*:not\(\.input-stack\)/);
  assert.match(css, /#chatRegion\s*>\s*\.app\s*\{[^}]*overflow:\s*visible[^}]*\}/);
  assert.match(css, /#chatRegion\s+\.history\s*\{[^}]*display:\s*flex[^}]*overflow-y:\s*auto[^}]*\}/);
  assert.match(css, /#chatRegion\s+\.history:empty\s*\{[^}]*display:\s*none\s*!important[^}]*\}/);
  assert.match(css, /#chatRegion\s+\.input-stack\s*\{[^}]*position:\s*relative[^}]*margin-top:\s*auto[^}]*\}/);
  assert.match(css, /#chatRegion\s+\.input-row\s*\{[^}]*height:\s*54px[^}]*\}/);
});

test('현재 Paper 50: 빈 대화의 첨부 칩은 반응형 경계에서 실제 작성 스택 높이를 확보한다', () => {
  for (const width of [330, 500, 699, 700, 900, 1279]) {
    const css = responsiveCssForWidth(width);
    assert.match(css, /#shell:has\(#chatRegion\s+\.history:empty\):has\(#chatRegion\s+\.attach-chips:not\(\[hidden\]\)\)\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto[^}]*\}/, `${width}px shell row`);
    assert.match(css, /#chatRegion:has\(\.history:empty\):has\(\.attach-chips:not\(\[hidden\]\)\)\s*\{[^}]*height:\s*auto[^}]*\}/, `${width}px chat height`);
    assert.match(css, /#chatRegion:has\(\.history:empty\):has\(\.attach-chips:not\(\[hidden\]\)\)\s*>\s*\.app\s*\{[^}]*position:\s*relative[^}]*inset:\s*auto[^}]*\}/, `${width}px in-flow composer`);
  }
});

test('현재 Paper 50: 실화면 검증은 실제 viewport 경계·필수 팝오버 항목·실패 복구를 단언한다', () => {
  const start = verifySource.indexOf('const responsivePopoverProbe = async');
  const end = verifySource.indexOf('// ---------- 검증 3c:', start);
  assert.ok(start >= 0 && end > start, '반응형 실화면 검증 구간이 있어야 한다');
  const verifier = verifySource.slice(start, end);
  assert.match(verifier, /actualInnerWidth === item\.requestedViewportWidth/);
  for (const label of ['파일 첨부', '폴더 첨부', '모델 설정']) {
    assert.match(verifier, new RegExp(`['"]${label}['"]:\\s*1`), `${label} 필수 항목 계약`);
  }
  assert.match(verifier, /item\.requiredItems\.every/);
  assert.match(verifier, /\}\s*finally\s*\{/);
  assert.match(verifier, /attachments\s*=\s*\[\]/);
  assert.match(verifier, /closeKiumiMenu\(\)/);
  assert.match(verifier, /closeModelPopover\(\)/);
  assert.match(verifier, /verifyResponsiveTurn/);
  assert.match(verifier, /shellWin\.setBounds\(responsiveOrigin\)/);
});

test('검증22: 숨겨진 오브만 비활성 표시해 paint 후 검사하고 원래 visibility로 복구한다', () => {
  const start = verifySource.indexOf('// ---------- 검증 22:');
  const end = verifySource.indexOf('// ---------- 검증 18:', start);
  assert.ok(start >= 0 && end > start, '검증22 오브 시각 검증 구간이 있어야 한다');
  const verifier = verifySource.slice(start, end);
  assert.match(verifier, /orbWasVisibleBeforeVisualVerification\s*=\s*orbWin\.isVisible\(\)/);
  assert.match(verifier, /if\s*\(!orbWasVisibleBeforeVisualVerification\)\s*\{\s*orbWin\.showInactive\(\)/);
  assert.match(verifier, /requestAnimationFrame\(\(\)\s*=>\s*requestAnimationFrame/);
  assert.match(verifier, /visibleAfterPaintSettle/);
  assert.match(verifier, /\}\s*finally\s*\{/);
  assert.match(verifier, /!orbWasVisibleBeforeVisualVerification[^}]*orbWin\.hide\(\)/);
  assert.match(verifier, /restoredOriginalVisibility/);
  assert.doesNotMatch(verifier, /shellWin\.(?:hide|minimize)\(\)/);
});

test('현재 Paper 50: 대화 이력은 이름 있는 키보드 스크롤 영역이다', () => {
  const historyTag = shellHtml.match(/<[^>]*\bid=["']history["'][^>]*>/)?.[0] || '';
  assert.notEqual(historyTag, '', '#history 시작 태그가 있어야 한다');
  assert.match(historyTag, /\brole=["']log["']/);
  assert.match(historyTag, /\baria-label=["']현재 대화["']/);
  assert.match(historyTag, /\btabindex=["']0["']/);
});

test('현재 Paper 50: 첨부 칩 제거 버튼과 파일명은 키보드·전체 경로 계약을 유지한다', () => {
  const start = chatSource.indexOf('function renderAttachChips()');
  const end = chatSource.indexOf('async function pickAttachments', start);
  assert.ok(start >= 0 && end > start, 'renderAttachChips 구현 구간이 있어야 한다');
  const renderer = chatSource.slice(start, end);
  assert.match(renderer, /rm\.type\s*=\s*['"]button['"]/);
  assert.match(renderer, /rm\.className\s*=\s*['"]attach-chip-rm['"]/);
  assert.match(renderer, /rm\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]첨부 제거['"]\s*\)/);
  assert.match(renderer, /name\.title\s*=\s*att\.path/);
});

test('현재 Paper 50: 330–699px은 44px 아이콘 레일과 단일 중앙 열이다', () => {
  const css = mediaBlock(699);
  assert.match(css, /#shell\s*\{[^}]*grid-template-columns:\s*44px\s+minmax\(0,\s*1fr\)[^}]*\}/);
  assert.match(css, /#historyRegion\s*\{[^}]*width:\s*44px[^}]*\}/);
  assert.match(css, /[^{}]*\.sidebar-mode-item-label[^{}]*\{[^}]*display:\s*none\s*!important[^}]*\}/);
  assert.match(css, /[^{}]*\.sidebar-list[^{}]*\{[^}]*display:\s*none\s*!important[^}]*\}/);
  assert.match(css, /\.sidebar-mode-item\s*\{[^}]*width:\s*34px[^}]*height:\s*34px[^}]*\}/);
});
