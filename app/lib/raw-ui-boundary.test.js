'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('production canvas never mounts raw detail diagnostics without the explicit developer flag', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  assert.match(canvas, /window\.__ATHENA_DEVELOPER_DIAGNOSTICS__ === true/);
  assert.match(canvas, /function upsertDeveloperDiagnostics/);
  assert.equal((canvas.match(/semanticDetailSheet\.upsert\(root, envelope\)/g) || []).length, 1);
  const helper = canvas.slice(canvas.indexOf('function upsertDeveloperDiagnostics'), canvas.indexOf('// 모든 chart surface'));
  assert.match(helper, /if \(!developerDiagnosticsEnabled\(\) \|\| !semanticDetailSheet\) return null/);
  assert.match(helper, /semanticDetailSheet\.upsert\(root, envelope\)/);
  assert.doesNotMatch(canvas, /semanticDetailSheet\.upsert\(existing, envelope\)/);
});

test('board surface cards draw no integrated card chrome over the Paper board', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const surface = fs.readFileSync(path.join(__dirname, 'integrated-card-surface.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'board-surface.css'), 'utf8');

  // 카드 머리(제목·기준 시각·×)는 만들지 않는다 — 탭 스트립이 그 셋을 맡는다.
  const board = canvas.slice(
    canvas.indexOf('function renderBoardSurfaceCard'),
    canvas.indexOf('async function renderTaskCanvasEnvelope'),
  );
  assert.match(board, /card\.dataset\.boardSurface = 'true'/);
  assert.match(board, /card\.querySelector\(':scope > \.card-head'\)/);
  assert.match(board, /if \(head\) head\.remove\(\)/);

  // 패널 탭 칩("요약" 등)도 만들지 않는다 — 스트립은 Paper 보드가 갖고 있다.
  const scaffold = surface.slice(
    surface.indexOf('function ensureScaffold'), surface.indexOf('function stampRoot'),
  );
  assert.match(surface, /function isBoardSurface\(node\)/);
  assert.match(surface, /node\.dataset\.boardSurface === 'true'/);
  assert.match(scaffold, /if \(!isBoardSurface\(root\)\) \{[\s\S]*integrated-card-tabs/);
  const mount = surface.slice(
    surface.indexOf('function mountOrUpdate'), surface.indexOf('const api = {'),
  );
  assert.match(mount, /if \(tabs\) \{[\s\S]*integrated-card-tab['"]/);

  // 하단 "전체 원본 필드 ▸"(헌장 신념 8) — 개발자 플래그를 켜도 보드에는 안 붙는다.
  const helper = canvas.slice(
    canvas.indexOf('function upsertDeveloperDiagnostics'), canvas.indexOf('// 모든 chart surface'),
  );
  assert.match(helper, /if \(integratedCardSurface\.isBoardSurface\(root\)\) return null/);
  assert.ok(
    helper.indexOf('isBoardSurface(root)') < helper.indexOf('semanticDetailSheet.upsert(root, envelope)'),
  );

  // 의미 작업대(semantic workspace)도 보드 아래에 붙이지 않는다 — 세 upsert
  // 호출부가 전부 같은 보드 예외를 든다. 하나라도 빠지면 보드 밑에 같은 값을
  // 다시 편 시트가 한 겹 더 생긴다.
  assert.equal((canvas.match(/semanticWorkspace\.upsert\(/g) || []).length, 3);
  assert.equal(
    (canvas.match(/!integratedCardSurface\.isBoardSurface\((?:root|existing)\)\) semanticWorkspace\.upsert\(/g) || []).length,
    3,
  );

  // 남은 카드 껍데기는 유리·테두리·여백을 보드에 내준다(테두리 두 줄 금지).
  assert.match(css, /\.card\[data-board-surface="true"\] \{[^}]*padding: 0;/);
  assert.match(css, /\.card\[data-board-surface="true"\] \{[^}]*border: 0;/);
});

test('task-canvas is routed through semantic presentation and cannot use free JSON fallback', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  assert.match(canvas, /semanticWorkspace\.isTaskCanvasEnvelope\(envelope\)/);
  assert.match(canvas, /isTaskCanvas && !hasPrimaryRenderer[\s\S]*createSemanticWorkspaceCard\(envelope\)/);
  const renderer = canvas.slice(canvas.indexOf('async function renderTaskCanvasEnvelope'), canvas.indexOf('async function renderIntegratedCard'));
  assert.match(renderer, /semanticWorkspace\.normalizePresentation/);
  assert.match(renderer, /semanticWorkspace\.upsert/);
  assert.doesNotMatch(renderer, /renderFreeCanvas|renderJsonTree|source_data|operation_ref|json_path/i);
});

test('generic task-canvas primary DOM is destroyed before semantic-only replacement', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const start = canvas.indexOf('function replaceUnsafeTaskPrimary');
  const end = canvas.indexOf('async function renderIntegratedCard');
  const helper = canvas.slice(start, end);
  assert.match(helper, /semanticWorkspace\.isSafePrimary\(envelope, rendered\)/);
  assert.match(helper, /destroyCard\(rendered\)/);
  assert.match(helper, /createSemanticWorkspaceCard\(envelope\)/);
  // 'specialized' 표시를 달 수 있는 자리는 정확히 5곳이다 — 전문 렌더러 4종
  // (facts·compound·event/action·chart 계열)과 Paper 보드 표면(renderBoardSurfaceCard).
  // 범용 렌더러가 이 표시를 달면 task-canvas 안전 판정을 통과해버리므로 개수를 고정한다.
  assert.equal((canvas.match(/card\.dataset\.semanticPrimary = 'specialized'/g) || []).length, 5);
  assert.match(
    canvas.slice(canvas.indexOf('function renderBoardSurfaceCard')),
    /card\.dataset\.semanticPrimary = 'specialized'/,
  );
  assert.match(canvas, /rendered = replaceUnsafeTaskPrimary\(rendered, envelope\)/);
  assert.equal((canvas.match(/if \(semanticWorkspace\.isTaskCanvasEnvelope\(envelope\)\) return null;/g) || []).length, 3);
});

test('task-canvas uses a sanitized lifecycle event while legacy event records remain available', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const primaryTypes = canvas.match(/const SEMANTIC_PRIMARY_TYPES = new Set\((\[[^;]+\])\)/)?.[1] || '';
  const taskRenderer = canvas.slice(canvas.indexOf('async function renderTaskCanvasEnvelope'), canvas.indexOf('async function renderIntegratedCard'));
  const legacyRenderer = canvas.slice(canvas.indexOf('function renderPrimaryEnvelope'), canvas.indexOf('async function renderTaskCanvasEnvelope'));
  const eventRenderer = canvas.slice(canvas.indexOf('function renderEventCard'), canvas.indexOf('function renderActionCard'));
  assert.match(primaryTypes, /['"]event['"]/);
  assert.match(taskRenderer, /renderPrimaryEnvelope/);
  assert.match(legacyRenderer, /canvas_type === 'event'[\s\S]*renderEventCard\(envelope\)/);
  const safeBranch = eventRenderer.slice(0, eventRenderer.indexOf('appendWorkflowState(body, data.state_label'));
  assert.match(safeBranch, /isTaskCanvasEnvelope\(envelope\)/);
  assert.match(safeBranch, /task-realtime-lifecycle/);
  assert.doesNotMatch(safeBranch, /Object\.entries|records|state_label/);
  assert.match(eventRenderer, /Object\.entries\(record \|\| \{\}\)/);
  const malicious = { records: [{ FID_1279: 'raw secret', operation_ref: 'detail:ka10004' }] };
  assert.match(JSON.stringify(malicious), /FID_1279|operation_ref/);
});

test('semantic product DOM emits no raw concept, unit, or realtime merge-key attributes', () => {
  const source = fs.readFileSync(path.join(__dirname, 'semantic-workspace.js'), 'utf8');
  assert.doesNotMatch(source, /dataset\.(?:semanticConcept|semanticUnit|realtimeMergeKey)\s*=/);
  assert.doesNotMatch(source, /\[data-realtime-merge-key\]/);
  assert.match(source, /dataset\.semanticObservationId = observationId/);
  assert.match(source, /Object\.defineProperty\(field, '__athenaSemanticNode'/);
  const realtimeReducer = source.slice(source.indexOf('function semanticRealtimeUpdates'), source.indexOf('function boundObservations'));
  assert.doesNotMatch(realtimeReducer, /realtime_merge_key|source_key|\.values\b/);
  assert.match(source, /safeRealtimeBindingId/);
  assert.match(source, /state\.realtimeBindings = new Map\(\)/);
});

test('AITS chart keeps its TR identity in internal state and never stamps it into product DOM', () => {
  const canvas = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const mount = canvas.slice(canvas.indexOf('async function mountAitsChartPanel'), canvas.indexOf('function buildFoldedTable'));
  const probe = fs.readFileSync(path.join(__dirname, '..', 'probe-live-chart.js'), 'utf8');
  assert.doesNotMatch(canvas, /dataset\.chart(?:TrId|SessionId)|data-chart-(?:tr|session)-id/i);
  assert.match(mount, /aitsChartPanels\.openPanel\(chartBody, descriptor\.body, descriptor\.context\)/);
  // 마운트가 끝난 시점의 카드는 통합 root일 수 있다(liveChartCard) — 어느 쪽이든
  // TR 신원은 JS 상태로만 남고 DOM 속성이 되지 않는다.
  assert.match(mount, /Object\.defineProperty\(mounted, '__athenaChartTrId'/);
  assert.match(mount, /value: session\.body\.trId/);
  assert.match(mount, /Object\.defineProperty\(mounted, '__athenaChartSessionId'/);
  assert.match(probe, /card\.__athenaChartTrId/);
  assert.doesNotMatch(probe, /dataset\.chartTrId|data-chart-tr-id/i);
});

test('integrated task metadata stays in JS state instead of technical product DOM attributes', () => {
  const surface = fs.readFileSync(path.join(__dirname, 'integrated-card-surface.js'), 'utf8');
  const stamp = surface.slice(surface.indexOf('function stampRoot'), surface.indexOf('function refreshExisting'));
  assert.doesNotMatch(stamp, /dataset\.(?:operationRef|capability|mode|section)\s*=/);
  assert.match(stamp, /Object\.defineProperty\(root, '__athenaIntegratedMetadata'/);
  assert.match(stamp, /operationRef:[\s\S]*capability:[\s\S]*mode:[\s\S]*section:/);
  assert.doesNotMatch(surface, /dataset\.panelKey|data-panel-key/i);
  assert.match(surface, /Object\.defineProperty\(node, '__athenaPanelKey'/);
});

test('semantic workspace module has no raw response traversal surface', () => {
  const source = fs.readFileSync(path.join(__dirname, 'semantic-workspace.js'), 'utf8');
  assert.doesNotMatch(source, /source_data|raw_data|json_path|field_occurrence_id/i);
  const operationRefs = source.match(/\boperation_ref\b/gi) || [];
  assert.equal(operationRefs.length, 1, 'operation_ref는 내부 기본 열 라벨 선택 한 곳에서만 쓴다');
  assert.match(source, /primaryColumnLabels: SOURCE_TABLE_PRIMARY_LABELS\[firstText\(envelope\.operation_ref, envelope\.operationRef\)\] \|\| \[\]/);
  assert.doesNotMatch(source, /dataset\.(?:operationRef|operation_ref)\s*=|data-operation-ref/i);
});

test('chart and orderbook product copy excludes transport and TR implementation terms', () => {
  const chart = fs.readFileSync(path.join(__dirname, 'chart-card.js'), 'utf8');
  const chartNote = chart.slice(chart.indexOf('function updateNote()'), chart.indexOf('function applyAdjusted('));
  const orderbook = fs.readFileSync(path.join(__dirname, 'card-kind-호가.js'), 'utf8');
  const orderbookDom = orderbook.slice(orderbook.indexOf('function buildIntegratedOrderbook('), orderbook.indexOf('function render호가('));
  assert.doesNotMatch(chartNote, /AITS ka10081 canonical snapshot|canonical snapshot/i);
  assert.match(chartNote, /서버에서 조회한 차트 데이터/);
  assert.doesNotMatch(orderbookDom, /['"`]([^'"`]*\b(?:REST|0D)\b[^'"`]*)['"`]/i);
  assert.match(orderbookDom, /실시간 호가 데이터/);
  assert.match(orderbook, /wrap\.__athenaOrderbookState = state/);
  assert.doesNotMatch(orderbook, /dataset\.liveSource|data-live-source/i);
  assert.match(chart, /if \(replacement\.trId\) currentTrId = replacement\.trId/);
  assert.match(chart, /preSampled/);
});
