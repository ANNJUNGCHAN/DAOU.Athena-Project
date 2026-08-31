'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applyRealtimeTick, upsert } = require('./semantic-workspace');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.classList = {
      add: (name) => { this.className = `${this.className} ${name}`.trim(); },
      remove: (name) => {
        this.className = String(this.className).split(/\s+/).filter((item) => item && item !== name).join(' ');
      },
    };
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  prepend(child) { this.children.unshift(child); child.parentNode = this; return child; }
  replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    for (const child of this.children) {
      if (className && String(child.className).split(/\s+/).includes(className)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  querySelectorAll(selector) {
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    const dataMatch = selector.match(/^\[data-([a-z-]+)\]$/);
    const dataKey = dataMatch && dataMatch[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const output = [];
    for (const child of this.children) {
      if (className && String(child.className).split(/\s+/).includes(className)) output.push(child);
      if (dataKey && Object.prototype.hasOwnProperty.call(child.dataset, dataKey)) output.push(child);
      output.push(...child.querySelectorAll(selector));
    }
    return output;
  }
}

function tableEnvelope() {
  return {
    canvas_type: 'task-canvas',
    view_instance_id: 'accessible-table',
    view_recipe: { recipe_id: 'discovery-value', section_ids: ['ranked-results'] },
    presentation_contract: {
      title_ko: '종목 탐색 결과',
      sections: [{
        section_id: 'ranked-results',
        title_ko: '조건에 맞는 종목',
        columns: [
          { key: 'name', label_ko: '종목명' },
          { key: 'price', label_ko: '현재가', unit_or_format: '원' },
        ],
        rows: [{ name: '삼성전자', price: '150,000' }],
      }, {
        section_id: 'live',
        title_ko: '실시간 시세',
        fields: [{
          observation_id: 'obs_aaaaaaaaaaaaaaaaaaaa',
          realtime_binding_id: 'rtb_bbbbbbbbbbbbbbbbbbbb', concept_id: 'quote.price',
          label_ko: '현재가', value: '150,000', unit_or_format: '원',
        }],
      }],
    },
    realtime_bindings: [{
      binding_id: 'rtb_bbbbbbbbbbbbbbbbbbbb', observation_id: 'obs_aaaaaaaaaaaaaaaaaaaa',
    }],
  };
}

function findTags(node, tagName) {
  return [
    ...(node.tagName === tagName.toUpperCase() ? [node] : []),
    ...node.children.flatMap((child) => findTags(child, tagName)),
  ];
}

test('table and realtime semantics remain keyboard and screen-reader accessible', () => {
  const root = new FakeElement();
  const body = new FakeElement();
  body.className = 'card-body';
  root.appendChild(body);
  global.document = { createElement: (tagName) => new FakeElement(tagName) };
  try {
    const workspace = upsert(root, tableEnvelope());
    assert.equal(workspace.attributes['aria-label'], '종목 탐색 결과');
    const tableWrap = workspace.querySelector('.semantic-workspace-table-wrap');
    assert.equal(tableWrap.attributes.tabindex, '0');
    assert.match(tableWrap.attributes['aria-label'], /조건에 맞는 종목 표/);
    assert.ok(findTags(workspace, 'table').length === 1);
    assert.ok(findTags(workspace, 'th').every((heading) => heading.attributes.scope === 'col'));
    assert.equal(applyRealtimeTick(root, {
      semantic_updates: [{ binding_id: 'rtb_bbbbbbbbbbbbbbbbbbbb', value: '150,100' }],
    }), 1);
    const live = workspace.querySelector('.semantic-workspace-live');
    assert.equal(live.attributes['aria-live'], 'polite');
    assert.equal(live.attributes['aria-atomic'], 'true');
  } finally {
    delete global.document;
  }
});

test('responsive CSS preserves touch targets, focus, overflow, and reduced motion', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'integrated-cards.css'), 'utf8');
  assert.match(css, /\.semantic-workspace-table-wrap\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.semantic-workspace-table-wrap:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?min-height:\s*44px;\s*min-width:\s*44px/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition:\s*none\s*!important;[\s\S]*?animation:\s*none\s*!important/);
});
