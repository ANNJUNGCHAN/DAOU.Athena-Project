'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { upsert } = require('./semantic-workspace');

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.classList = { add: (name) => { this.className = `${this.className} ${name}`.trim(); } };
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
    const output = [];
    for (const child of this.children) {
      if (className && String(child.className).split(/\s+/).includes(className)) output.push(child);
      output.push(...child.querySelectorAll(selector));
    }
    return output;
  }
}

const STATE_TEXT = {
  loading: '데이터를 불러오는 중입니다.',
  empty: '표시할 데이터가 없습니다.',
  partial: '일부 정보를 불러오지 못했습니다. 확인된 정보만 표시합니다.',
  error: '정보를 불러오지 못했습니다.',
  stale: '마지막으로 확인된 정보를 표시합니다.',
  reconnecting: '실시간 정보를 다시 연결하고 있습니다.',
};

function envelope(status) {
  return {
    canvas_type: 'task-canvas',
    view_instance_id: `state-${status}`,
    view_recipe: { recipe_id: 'instrument-chart', section_ids: ['answer'] },
    presentation_contract: {
      title_ko: '삼성전자 차트',
      status,
      sections: [{
        section_id: 'answer',
        title_ko: '핵심 정보',
        status,
        fields: status === 'partial' || status === 'stale' || status === 'reconnecting'
          ? [{ concept_id: 'quote.price', label_ko: '현재가', value: '150,000', unit_or_format: '원' }]
          : [],
      }],
    },
  };
}

for (const [status, expectedText] of Object.entries(STATE_TEXT)) {
  test(`Task Canvas renders the ${status} state as accessible product copy`, () => {
    const root = new FakeElement();
    const body = new FakeElement();
    body.className = 'card-body';
    root.appendChild(body);
    global.document = { createElement: (tagName) => new FakeElement(tagName) };
    try {
      const workspace = upsert(root, envelope(status));
      const statuses = workspace.querySelectorAll('.semantic-workspace-status');
      assert.ok(statuses.some((node) => node.className.includes(`is-${status}`)));
      assert.ok(statuses.some((node) => node.textContent.includes(expectedText)));
      assert.ok(statuses.every((node) => node.attributes.role === 'status'));
      assert.equal(root.dataset.semanticWorkspaceStatus, status);
      assert.equal(workspace.querySelector('.semantic-detail-sheet'), null);
    } finally {
      delete global.document;
    }
  });
}

