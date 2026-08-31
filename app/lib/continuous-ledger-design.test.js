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

test('graph cluster and tier structures are flat ledger rows while controls and data bars remain styled', () => {
  for (const selector of ['.theme-cluster-card', '.panel-tier-card']) {
    assertTransparentLedgerRule(canvasCss, selector);
  }

  const functionalBackgrounds = new Map([
    ['.theme-cluster-bar', 'var(--color-k-bg)'],
    ['.theme-cluster-bar-fill', 'var(--color-k-text)'],
    ['.panel-tab.is-active', 'var(--color-k-panel)'],
  ]);
  for (const [selector, expected] of functionalBackgrounds) {
    assertFunctionalBackground(canvasCss, selector, expected);
  }
});

test('horizontal unnamed-cluster warnings win the divider cascade without restoring a card shell', () => {
  const horizontalDivider = ruleBody(
    canvasCss,
    '#canvasRegion:has(> .graph-panel:not([hidden])) .theme-cluster-card + .theme-cluster-card',
  );
  assert.match(horizontalDivider, /border-inline-start:\s*1px solid var\(--color-k-line\)/);

  const horizontalWarn = ruleBody(
    canvasCss,
    '#canvasRegion:has(> .graph-panel:not([hidden])) .theme-cluster-card + .theme-cluster-card.is-unnamed-warn',
  );
  assert.match(horizontalWarn, /border-inline-start-color:\s*rgba\(255, 152, 56, 0\.55\)/);

  const horizontalWarnBadge = ruleBody(
    canvasCss,
    '#canvasRegion:has(> .graph-panel:not([hidden])) .theme-cluster-card.is-unnamed-warn .theme-cluster-unnamed-badge',
  );
  assert.match(horizontalWarnBadge, /color:\s*var\(--color-warn\)/);

  const verticalWarn = ruleBody(canvasCss, '.theme-cluster-card.is-unnamed-warn');
  assert.match(verticalWarn, /border-top-color:\s*rgba\(255, 152, 56, 0\.55\)/);
  assert.deepEqual(declarationValues(verticalWarn, 'background'), ['transparent']);
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
