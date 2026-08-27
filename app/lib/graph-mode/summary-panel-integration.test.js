// 스텝0-2 소유권 계약의 통합 회귀 가드 — summary-table.js(표)와 controller.js
// (공통 패널)가 실제로 같은 부모(#graphSummaryBody)를 공유할 때만 나는 결함을
// fake-dom 유닛 테스트가 놓친다는 지적(Architect 지적4)을 이 파일로 메운다.
// #graphSummaryTableArea·#graphPanel을 진짜 형제로 두고 두 컨트롤러를 함께
// 구동한다 — Critic 필수수정①·§0-2 소유권 계약이 계속 지켜지는지 지킨다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('./graph-mode-store');
const layout = require('./cluster-layout');
const render = require('./render');
const { createGraphModeController } = require('./controller');
const { createSummaryTableController } = require('./summary-table');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

test.beforeEach(() => {
  installFakeDocument();
});

test.afterEach(() => {
  uninstallFakeDocument();
});

function entry(overrides) {
  return {
    entity_id: 'e:samsung',
    entity_kind: 'stock',
    entity_name: '삼성전자',
    relation_kind: '보유',
    confidence: 'EXTRACTED',
    tier: 'deterministic',
    rationale: '체결 4건 · 평균 71,200원',
    observed_at: '2026-08-24T00:00:00+00:00',
    reinforcement: 12,
    ...overrides,
  };
}

// 스텝0-2가 만든 실제 구조를 그대로 재현한다: #graphSummaryBody(부모) 안에
// #graphSummaryTableArea와 #graphPanel이 형제로 산다.
function setupSharedParent(options) {
  const opts = options || {};
  const body = fakeNode('div');
  const tableArea = fakeNode('div');
  const panel = fakeNode('div');
  body.appendChild(tableArea);
  body.appendChild(panel);

  const graphMode = createGraphModeController({
    store,
    layout,
    render,
    prefs: null,
    elements: {
      pill: fakeNode('button'),
      summary: fakeNode('div'),
      graph: fakeNode('div'),
      graphBody: fakeNode('div'),
      summaryTable: fakeNode('div'),
      panel,
    },
    fetchClusterMap: async () => ({ revision: 1, nodes: [], edges: [] }),
  });

  let fetchCount = 0;
  const entries = opts.entries || [entry()];
  const summaryTable = createSummaryTableController({
    container: tableArea,
    limit: 5,
    fetchProfileSummary: async () => {
      fetchCount += 1;
      return { ok: true, entries };
    },
    selectEntity: (entityId, panelData) => graphMode.selectEntity(entityId, panelData),
  });

  return { body, tableArea, panel, graphMode, summaryTable, fetchCalls: () => fetchCount };
}

test('표를 두 번 load()해도 #graphPanel이 부모(#graphSummaryBody)에서 안 떨어진다', async () => {
  const { body, panel, summaryTable } = setupSharedParent();
  await summaryTable.load();
  await summaryTable.load(); // 표 리로드 — renderSummaryTable()이 tableArea 자식만 통째로 비운다.
  assert.ok(body.children.includes(panel), '#graphPanel이 여전히 부모의 자식 목록에 있다');
  assert.equal(panel.parentNode, body, 'parentNode가 null이 아니라 여전히 #graphSummaryBody다');
});

test('행 선택 후 표를 리로드해도 패널 선택 상태가 유지된다', async () => {
  const { panel, tableArea, summaryTable } = setupSharedParent();
  await summaryTable.load();
  const row = tableArea.querySelector('.summary-row');
  row.dispatchEvent({ type: 'click' });
  assert.equal(panel.hidden, false, '선택 직후 패널이 열려 있다');
  assert.match(panel.textContent, /삼성전자/);

  await summaryTable.load(); // 표 리로드 — 패널은 표 렌더 대상 밖이라 안 지워져야 한다.
  assert.equal(panel.hidden, false, '표 리로드 후에도 패널이 계속 열려 있다(선택이 안 풀린다)');
  assert.match(panel.textContent, /삼성전자/, '리로드 후에도 선택했던 엔티티 내용이 그대로다');
});
