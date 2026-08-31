'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function rgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'integrated-cards.css'), 'utf8');
const workspaceCss = css.slice(css.indexOf('.semantic-workspace {'), css.indexOf('@media (max-width: 720px)'));
const lightCardChromeCss = css.slice(
  css.indexOf('.card.integrated-card .integrated-card-tab {'),
  css.indexOf('.semantic-detail-sheet {'),
);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ruleBody(source, selector) {
  const match = source.match(new RegExp(`${escapeRegex(selector)}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `CSS rule not found: ${selector}`);
  return match[1];
}

test('semantic workspace light-surface text colors satisfy WCAG AA contrast', () => {
  assert.ok(contrast('#14171d', '#ffffff') >= 4.5);
  assert.ok(contrast('#5b6270', '#ffffff') >= 4.5);
  assert.ok(contrast('#4f596b', '#ffffff') >= 4.5);
  assert.match(workspaceCss, /--semantic-ink: #14171d/);
  assert.match(workspaceCss, /--semantic-muted: #5b6270/);
});

test('semantic status uses a transparent continuous-ledger row without a left rail', () => {
  const body = ruleBody(workspaceCss, '.semantic-workspace-status');
  assert.match(body, /background:\s*transparent/);
  assert.match(body, /border-radius:\s*0/);
  assert.match(body, /box-shadow:\s*none/);
  assert.doesNotMatch(body, /border-(?:inline-start|left)(?:-width)?:\s*3px/);
});

test('semantic default status text satisfies WCAG AA on the transparent light surface', () => {
  const body = ruleBody(workspaceCss, '.semantic-workspace-status');
  assert.ok(contrast('#4f596b', '#ffffff') >= 4.5);
  assert.match(body, /color:\s*#4f596b/);
});

test('semantic status dot inherits the readable status text color', () => {
  const body = ruleBody(workspaceCss, '.semantic-workspace-status::before');
  assert.match(body, /background:\s*currentColor/);
});

test('semantic partial and unavailable status text satisfies WCAG AA on the transparent light surface', () => {
  const partialBody = ruleBody(
    workspaceCss,
    '.semantic-workspace-status.is-partial,\n.semantic-workspace-status.is-stale,\n.semantic-workspace-status.is-reconnecting',
  );
  const unavailableBody = ruleBody(
    workspaceCss,
    '.semantic-workspace-status.is-error,\n.semantic-workspace-status.is-unavailable',
  );

  assert.ok(contrast('#694500', '#ffffff') >= 4.5);
  assert.ok(contrast('#842f24', '#ffffff') >= 4.5);
  assert.match(partialBody, /color:\s*#694500/);
  assert.match(unavailableBody, /color:\s*#842f24/);
  assert.doesNotMatch(partialBody, /background:/);
  assert.doesNotMatch(unavailableBody, /background:/);
});

test('semantic workspace no longer inherits dark-surface text tokens', () => {
  assert.doesNotMatch(workspaceCss, /var\(--text(?:-muted)?/);
  assert.doesNotMatch(workspaceCss, /#eef1f7|#f4f6fb|#a8b0c0|#b2bac9/);
});

test('light integrated-card tabs and realtime error chrome satisfy WCAG AA contrast', () => {
  assert.ok(contrast('#5b6270', '#ffffff') >= 4.5);
  assert.ok(contrast('#14171d', '#e9ebff') >= 4.5);
  assert.ok(contrast('#842f24', '#fff0ed') >= 4.5);
  assert.ok(contrast('#842f24', '#ffe1dc') >= 4.5);
  assert.match(lightCardChromeCss, /\.card\.integrated-card \.integrated-card-tab\.is-active\s*\{[^}]*color: #14171d;[^}]*background: #e9ebff;/);
  assert.match(lightCardChromeCss, /\.card\.integrated-card \.integrated-realtime-error\s*\{[^}]*color: #842f24;[^}]*background: #fff0ed;/);
  assert.match(lightCardChromeCss, /\.card\.integrated-card \.integrated-realtime-error button\s*\{[^}]*color: #842f24;[^}]*background: #ffe1dc;/);
});
