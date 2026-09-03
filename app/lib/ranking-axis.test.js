'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RANKING_AXES, axesForEnvelope, renderAxisStrip } = require('./ranking-axis');

function allItems() {
  return Object.values(RANKING_AXES).flatMap((groups) => groups.flatMap((group) => group.items));
}

test('axis catalog stays in lockstep with the backend presentation overrides', () => {
  const registrySource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'athena_api', 'canvas_card_registry.py'),
    'utf8',
  );
  const overrideBlock = registrySource.split('OPERATION_PRESENTATION_OVERRIDES')[1];
  assert.ok(overrideBlock, 'backend OPERATION_PRESENTATION_OVERRIDES must exist');
  const backendRefs = new Set(
    [...overrideBlock.matchAll(/"(base:[a-z0-9]+)":\s*\("ranking"/g)].map((match) => match[1]),
  );
  const appRefs = new Set(allItems().map((item) => item.operationRef));
  assert.deepEqual([...appRefs].sort(), [...backendRefs].sort());
  // 주식 10 + ETF 2 + ELW 6 + 수급 9 = 27 (kt20017은 행 선택 시 부속 조회라 축이 아니다)
  assert.equal(appRefs.size, 27);
});

test('every axis carries a Korean label and a chat question, with no duplicates', () => {
  const refs = allItems().map((item) => item.operationRef);
  assert.equal(new Set(refs).size, refs.length);
  for (const item of allItems()) {
    assert.match(item.label, /[가-힣]/);
    assert.match(item.question, /[가-힣]/);
  }
});

test('axesForEnvelope marks the active axis and refuses non-ranking envelopes', () => {
  const groups = axesForEnvelope({ card_id: 'CC-03', mode: 'ranking', operation_ref: 'base:ka10016' });
  const stock = groups.find((group) => group.group === '주식');
  assert.equal(stock.items.find((item) => item.operationRef === 'base:ka10016').active, true);
  assert.equal(stock.items.filter((item) => item.active).length, 1);
  assert.equal(axesForEnvelope({ card_id: 'CC-03', mode: 'chart', operation_ref: 'base:ka10081' }), null);
  assert.equal(axesForEnvelope({ card_id: 'CC-04', mode: 'ranking', operation_ref: 'base:ka10016' }), null);
});

test('axis strip renders one disabled active chip and clickable siblings', () => {
  const made = [];
  const doc = {
    createElement(tag) {
      const node = {
        tag, className: '', textContent: '', title: '', disabled: false,
        attributes: {}, children: [], listeners: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); return child; },
        addEventListener(type, handler) { this.listeners.push({ type, handler }); },
      };
      made.push(node);
      return node;
    },
  };
  const selected = [];
  const strip = renderAxisStrip(
    { card_id: 'CC-05', mode: 'ranking', operation_ref: 'base:ka90003' },
    (item) => selected.push(item.operationRef),
    doc,
  );
  const chips = made.filter((node) => node.className.startsWith('ranking-axis-chip'));
  assert.equal(chips.length, 9);
  const active = chips.filter((chip) => chip.className.includes('is-active'));
  assert.equal(active.length, 1);
  assert.equal(active[0].disabled, true);
  assert.equal(active[0].listeners.length, 0);
  // operationRef는 어떤 속성에도 실리지 않는다 — title·aria·data-* 전부 제품 UI 원시
  // 식별자 누출로 잡힌다(verify-semantic-workspaces, 2026-09-04 elw-product 실측). 칩은
  // 한국어 라벨로만 찾고, 어느 칩도 ref를 노출하지 않는지 함께 잠근다.
  const target = allItems().find((item) => item.operationRef === 'base:kt20016');
  const inactive = chips.find((chip) => chip.textContent === target.label);
  inactive.listeners[0].handler();
  assert.deepEqual(selected, ['base:kt20016']);
  for (const chip of chips) {
    assert.equal(chip.title, '');
    assert.doesNotMatch(JSON.stringify(chip.attributes), /(?:base|detail):[a-z0-9]/);
  }
  assert.equal(strip.className, 'ranking-axis-strip');
});
