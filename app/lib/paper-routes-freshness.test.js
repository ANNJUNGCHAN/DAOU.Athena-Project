'use strict';

// 라우트표 신선도 게이트(`scripts/gates/check-paper-routes.mjs`)의 규칙 6종이 실제로
// 잡는지 잰다. 게이트가 참인 표만 통과시키는 것으로는 모자란다 — **틀린 표를 정말
// 거절하는가**를 안 재면 오라클이 조용히 죽어도 아무도 모른다(설계서 §4.4가 이
// 게이트를 두는 이유가 그 부류다). 그래서 규칙마다 일부러 틀린 표를 한 장씩 먹인다.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const gatePath = path.join(__dirname, '..', '..', 'scripts', 'gates', 'check-paper-routes.mjs');
let mod;
const load = async () => {
  if (!mod) mod = await import(pathToFileURL(gatePath).href);
  return mod;
};

// 대조 원본의 최소형. 실파일 대신 이걸 먹여 규칙 하나씩만 흔든다.
const BASE = () => ({
  ids: new Set(['settings', 'agentCanvas']),
  channels: new Set(['athena:account-list']),
  screenBoards: new Map([['AA-0', '1-0'], ['BB-0', '1-0']]),
  ledgerTexts: () => new Set(['계좌 등록', '연결 상태', '마지막 검증', '+1,850']),
  valueTexts: new Set(),
});

const ROUTE = () => ({
  board: 'AA-0',
  window: 'shell',
  reach: [{ do: 'ipc-fixture', channel: 'athena:account-list', data: {} }],
  root: '#settings',
  phrases: ['계좌 등록', '연결 상태', '마지막 검증'],
  structure: [{ what: 'count', selector: '#agentCanvas .agent-view-tab', equals: 4 }],
});

const run = async (routes, overrides = {}) => {
  const { checkPaperRoutes } = await load();
  return checkPaperRoutes({ routes, ...BASE(), ...overrides });
};

test('a table whose every reference is real passes', async () => {
  assert.deepEqual(await run([ROUTE()]), []);
});

test('rule 1 rejects a DOM id the markup does not have', async () => {
  const route = { ...ROUTE(), root: '#settingsPanel' };
  const failures = await run([route]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /#settingsPanel/);
});

test('rule 1 reads the structure selectors too, not only root', async () => {
  const route = { ...ROUTE(), structure: [{ what: 'count', selector: '#agentBoard .x', equals: 1 }] };
  assert.match((await run([route]))[0], /#agentBoard/);
});

test('rule 2 rejects an IPC channel neither preload nor main registers', async () => {
  const route = { ...ROUTE(), reach: [{ do: 'ipc-fixture', channel: 'athena:account-listing', data: {} }] };
  assert.match((await run([route]))[0], /athena:account-listing/);
});

test('rule 3 rejects a board the manifest does not call a screen', async () => {
  const route = { ...ROUTE(), board: 'ZZ-9' };
  assert.match((await run([route]))[0], /role=="screen"/);
});

test('rule 3 rejects the same board twice', async () => {
  const failures = await run([ROUTE(), { ...ROUTE(), root: '#agentCanvas' }]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /두 번/);
});

test('rule 4 rejects a phrase Paper never drew — the authoring typo', async () => {
  const route = { ...ROUTE(), phrases: ['계좌 등록', '연결 상태', '마지막 검중'] };
  const failures = await run([route]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /원장에 없는 문구/);
});

test('rule 5 rejects a data value even when Paper really draws it', async () => {
  const route = { ...ROUTE(), phrases: ['계좌 등록', '연결 상태', '+1,850'] };
  const failures = await run([route]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /E1/);
});

test('rule 6 rejects an eval escape hatch with no why', async () => {
  const route = { ...ROUTE(), reach: [{ do: 'eval', js: 'x()', why: '  ' }] };
  assert.match((await run([route]))[0], /why/);
});

// ---------- 저장소에 실제로 커밋된 표 ----------

test('the shipped route table is fresh against the real app and ledger', async () => {
  const { runGate } = await load();
  const { routes, screens, failures } = runGate();
  assert.deepEqual(failures, []);
  assert.ok(routes > 0);
  assert.ok(routes <= screens, '화면계 보드 수보다 라우트가 많을 수는 없다');
});
