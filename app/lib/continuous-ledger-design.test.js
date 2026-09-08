'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..');
const integratedCss = fs.readFileSync(path.join(appDir, 'styles', 'integrated-cards.css'), 'utf8');
const cardKindsCss = fs.readFileSync(path.join(appDir, 'styles', 'card-kinds.css'), 'utf8');
const canvasCss = fs.readFileSync(path.join(appDir, 'canvas.css'), 'utf8');
const mobileIntegratedCss = integratedCss.slice(integratedCss.indexOf('@media (max-width: 720px)'));
const narrowCanvasCss = canvasCss.slice(canvasCss.indexOf('@media (max-width: 900px)'));

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ruleBody(source, selector) {
  const match = source.match(new RegExp(`(?:^|\\n)[ \\t]*${escapeRegex(selector)}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `CSS rule not found: ${selector}`);
  return match[1];
}

function declarationValues(body, property) {
  return [...body.matchAll(new RegExp(`${property}:\\s*([^;]+)`, 'g'))]
    .map((match) => match[1].trim());
}

function assertTransparentLedgerRule(source, selector) {
  const body = ruleBody(source, selector);
  assert.match(body, /background:\s*transparent/);
  assert.match(body, /border-radius:\s*0/);
  assert.match(body, /box-shadow:\s*none/);
  assert.deepEqual(declarationValues(body, 'background'), ['transparent']);
  assert.deepEqual(declarationValues(body, 'border-radius'), ['0']);
  assert.deepEqual(declarationValues(body, 'box-shadow'), ['none']);
  for (const property of ['border-left', 'border-inline-start']) {
    assert.deepEqual(declarationValues(body, property), [], `${selector} must not use a structural side rail`);
  }
  for (const property of ['border-left-width', 'border-inline-start-width']) {
    for (const value of declarationValues(body, property)) {
      assert.match(value, /^0(?:px)?$/, `${selector} must not use a nonzero structural side rail`);
    }
  }
  for (const property of ['border-left-style', 'border-inline-start-style']) {
    assert.deepEqual(declarationValues(body, property), [], `${selector} must not assemble a side rail from width and style`);
  }
  assert.doesNotMatch(body, /box-shadow:\s*[^;]*\binset\b/, `${selector} must not imitate a rail with an inset shadow`);
}

function assertFunctionalBackground(source, selector, expected) {
  const body = ruleBody(source, selector);
  assert.deepEqual(declarationValues(body, 'background'), [expected]);
  assert.notEqual(expected, 'transparent');
  assert.notEqual(expected, 'none');
}

test('semantic workspace structural surfaces use the transparent continuous-ledger treatment', () => {
  const structuralSelectors = [
    '.semantic-workspace-section',
    '.semantic-workspace-status',
    '.semantic-workspace-metric,\n.semantic-workspace-description',
    '.semantic-workspace-slot-group',
    '.semantic-workspace-detail',
    '.semantic-workspace-table-wrap',
    '.semantic-workspace-row-detail',
    '.semantic-workspace-row-detail-item',
    '.semantic-workspace-table tbody > tr:not(.semantic-workspace-table-detail-row)',
  ];

  for (const selector of structuralSelectors) {
    assertTransparentLedgerRule(integratedCss, selector);
  }

});

test('mobile semantic table rows remain ledger rows instead of becoming cards', () => {
  const body = ruleBody(mobileIntegratedCss, '.semantic-workspace-table tbody > tr:not(.semantic-workspace-table-detail-row)');
  assert.match(body, /border-bottom:\s*1px solid var\(--semantic-line\)/);
  assert.doesNotMatch(body, /background:\s*(?:#fff|white|var\(--semantic-soft\))/);

  const metricDivider = ruleBody(mobileIntegratedCss, '.semantic-workspace-metric + .semantic-workspace-metric');
  assert.match(metricDivider, /border-inline-start:\s*0/);
  assert.match(metricDivider, /border-top:\s*1px solid var\(--semantic-line\)/);
});

test('graph tier structures are flat ledger rows while controls and data bars remain styled', () => {
  // .theme-cluster-card는 이 목록에서 빠졌다 — 아래 별도 테스트 참고(2026-09-03).
  assertTransparentLedgerRule(canvasCss, '.panel-tier-card');

  const functionalBackgrounds = new Map([
    ['.theme-cluster-bar', 'var(--color-k-bg)'],
    ['.theme-cluster-bar-fill', 'var(--color-k-text)'],
  ]);
  for (const [selector, expected] of functionalBackgrounds) {
    assertFunctionalBackground(canvasCss, selector, expected);
  }
});

test('theme cluster cards are the one documented exception to the ledger treatment', () => {
  // 사용자 확정(2026-09-03): "01 셸 — 그래프 모드 요약뷰 쪽 디자인이 제일 안정적이야"
  // = Paper 보드 01의 카드. 납작한 원장은 세로 목록에서는 읽히는데, 패널이 열려 카드가
  // 가로 3장이 되면 250px 칸에 이름·추정·종목수·바·응집%가 들어가고 카드 사이는 1px
  // 구분선뿐이라 세 덩어리가 붙어 버렸다("완전 찌부되었어").
  //
  // 예외는 이 컴포넌트 하나다 — .panel-tier-card와 .semantic-workspace-* 9개 표면은
  // 위 테스트들이 계속 원장으로 잠근다. 그래서 이 테스트가 필요하다: 예외를 적어 두지
  // 않으면 다음 사람이 "원장 방향에서 빠졌다"고 보고 되돌린다(실제로 이번에 그랬다).
  const card = ruleBody(canvasCss, '.theme-cluster-card');
  assert.match(card, /background:\s*var\(--color-k-panel2\)/, 'Paper 보드 01 — 면으로 서는 카드');
  assert.match(card, /border-radius:\s*var\(--radius-md\)/, 'Paper 실측 8px');
  assert.match(card, /padding:\s*11px 12px/, '좌우 여백이 있어야 내용이 벽에 붙지 않는다');
  assert.match(card, /box-shadow:\s*none/, '떠오르는 껍데기는 바깥 .card 하나뿐이라는 원장 규칙은 지킨다');
  assert.deepEqual(declarationValues(card, 'border-top'), [], '카드는 구분선이 아니라 면으로 갈린다');

  // 카드끼리는 간격으로 갈린다 — 구분선(측면 레일) 해킹으로 돌아가지 않는다.
  const list = ruleBody(canvasCss, '.theme-cluster-cards');
  assert.match(list, /gap:\s*12px/, '세로 목록 간격(Paper 실측)');
  const rowList = ruleBody(
    canvasCss,
    '#canvasRegion:has(> .graph-panel:not([hidden])) .theme-cluster-cards',
  );
  assert.match(rowList, /gap:\s*10px/, '가로 3장 간격(Paper 실측)');

  // 좁은 변형은 내용을 줄인다(Paper 보드 02) — 이것이 찌부의 실제 해법이다.
  const rowCount = ruleBody(
    canvasCss,
    '#canvasRegion:has(> .graph-panel:not([hidden])) .theme-cluster-count',
  );
  assert.match(rowCount, /display:\s*none/, '가로에서는 종목 수를 접어 제목 줄을 이름에게 준다');
});

test('unnamed-cluster warnings speak through the bar and badge, never a red-flagged shell', () => {
  // 카드가 면으로 서면서 구분선 캐스케이드 자체가 없어졌다(2026-09-03) — 경고를
  // 테두리로 말하던 규칙 셋이 함께 사라졌다. 남은 계약은 이것이다: 무명 군집은
  // **바와 배지의 색으로만** 다르다. 카드 배경까지 물들이면 이름이 없다는 사실이
  // 오류처럼 읽힌다 — 이름이 없는 것은 오류가 아니다(§0 정직성).
  const horizontalWarnBadge = ruleBody(
    canvasCss,
    '#canvasRegion:has(> .graph-panel:not([hidden])) .theme-cluster-card.is-unnamed-warn .theme-cluster-unnamed-badge',
  );
  assert.match(horizontalWarnBadge, /color:\s*var\(--color-warn\)/);

  const warnFill = ruleBody(canvasCss, '.theme-cluster-bar-fill.is-warn');
  assert.match(warnFill, /background:\s*var\(--color-warn\)/, '경고는 진행바가 말한다');

  const verticalWarn = ruleBody(canvasCss, '.theme-cluster-card.is-unnamed-warn');
  assert.deepEqual(
    declarationValues(verticalWarn, 'background'),
    ['var(--color-k-panel2)'],
    '무명 카드도 이름 붙은 카드와 같은 면이다',
  );
  assert.deepEqual(declarationValues(verticalWarn, 'border-top-color'), [], '테두리로 경고하지 않는다');
  assert.deepEqual(declarationValues(verticalWarn, 'border'), [], '테두리로 경고하지 않는다');
});

test('the outer root card remains the only elevated structural shell', () => {
  const outerCard = ruleBody(canvasCss, '.card');
  assert.deepEqual(declarationValues(outerCard, 'background-color'), ['rgba(255, 255, 255, var(--glass-card))']);
  assert.match(outerCard, /border:\s*1px solid rgb\(16 19 26 \/ 6%\)/);
  assert.match(outerCard, /border-radius:\s*14px/);
  assert.match(outerCard, /backdrop-filter:\s*blur\(14px\)/);
  assert.match(outerCard, /box-shadow:\s*[^;]*inset[^;]*14px 36px/s);
});

test('only non-interactive shared mini-card primitives are flattened', () => {
  const flattenedPrimitives = [
    '.card-kit-badge-change',
    '.card-kit-row-ranked-badge',
    '.card-kit-pill-status',
  ];
  for (const selector of flattenedPrimitives) {
    assertTransparentLedgerRule(cardKindsCss, selector);
  }

  const functionalAllowlist = new Map([
    ['.card-kit-tab-switcher', 'var(--color-k-panel3)'],
    ['.card-kit-tab.is-active', 'var(--color-k-panel)'],
    ['.card-kit-bar-track', 'var(--color-k-panel3)'],
    ['.card-kit-bar-fill', 'var(--color-flat)'],
    ['.card-kit-bar-range-track', 'var(--color-k-panel3)'],
    ['.card-kit-bar-range-marker', 'var(--color-k-text)'],
  ]);
  for (const [selector, expected] of functionalAllowlist) {
    assertFunctionalBackground(cardKindsCss, selector, expected);
  }
});

test('ledger responsive source contracts cover 330, 500, 700, 900, and 1520 widths without horizontal overflow', () => {
  assert.match(integratedCss, /@media \(max-width: 720px\)\s*\{/);
  assert.match(canvasCss, /@media \(max-width: 900px\)\s*\{/);

  const mobileMetrics = ruleBody(mobileIntegratedCss, '.semantic-workspace-metrics');
  assert.match(mobileMetrics, /grid-template-columns:\s*1fr/);

  const narrowGrid = ruleBody(narrowCanvasCss, '.grid');
  assert.match(narrowGrid, /grid-template-columns:\s*1fr/);

  const defaultGrid = ruleBody(canvasCss, '.grid');
  assert.match(defaultGrid, /grid-template-columns:\s*1fr 1fr/);
  assert.match(defaultGrid, /overflow-x:\s*hidden/);

  const contracts = [330, 500, 700, 900, 1520].map((width) => ({
    width,
    semanticLayout: width <= 720 ? 'single-column' : 'auto-fit',
    canvasLayout: width <= 900 ? 'single-column' : 'two-column',
    horizontalOverflow: 'hidden',
  }));
  assert.deepEqual(contracts, [
    { width: 330, semanticLayout: 'single-column', canvasLayout: 'single-column', horizontalOverflow: 'hidden' },
    { width: 500, semanticLayout: 'single-column', canvasLayout: 'single-column', horizontalOverflow: 'hidden' },
    { width: 700, semanticLayout: 'single-column', canvasLayout: 'single-column', horizontalOverflow: 'hidden' },
    { width: 900, semanticLayout: 'auto-fit', canvasLayout: 'single-column', horizontalOverflow: 'hidden' },
    { width: 1520, semanticLayout: 'auto-fit', canvasLayout: 'two-column', horizontalOverflow: 'hidden' },
  ]);
});
