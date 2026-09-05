'use strict';

// 화면계 게이트의 판정과 래칫. electron 없이 도는 부분이라 여기서 전부 잰다.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SCREEN_FAILURE_CODES,
  blessRatchet,
  contractRecord,
  contractSentences,
  formatScreensCliReport,
  judgeRatchet,
  routeFailures,
  routeMissingRecord,
} = require('./paper-screens-report.js');

const ROUTE = {
  board: 'AA-0',
  root: '#settings',
  phrases: ['연결 상태', '＋ 새 작업'],
  structure: [{ what: 'count', selector: '.tab', equals: 4 }],
};
const OK = {
  reach_error: null,
  root_found: true,
  root_visible: true,
  visible_text: '연결 상태\n＋\n새 작업\n계좌',
  structure: [{ index: 0, actual: 4 }],
};

// ---------- 라우트 판정 ----------

test('a route whose phrases and counts are all there has no failures', () => {
  assert.deepEqual(routeFailures(ROUTE, OK), []);
});

test('phrases split across elements still match — the join is whitespace-normalized', () => {
  // 앱이 「＋」와 「새 작업」을 두 노드로 그려도 Paper의 한 낱말과 같은 문구다.
  assert.deepEqual(routeFailures(ROUTE, { ...OK, visible_text: '  연결\n 상태  ＋  새 작업 ' }), []);
});

test('a missing phrase names exactly the phrases that are gone', () => {
  const failures = routeFailures(ROUTE, { ...OK, visible_text: '연결 상태' });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'phrase_missing');
  assert.deepEqual(failures[0].phrases, ['＋ 새 작업']);
});

test('a reach step that threw is reported as reach_failed and nothing else', () => {
  const failures = routeFailures(ROUTE, { reach_error: { step: 2, verb: 'click', message: '누를 것이 없다' } });
  assert.deepEqual(failures.map((f) => f.code), ['reach_failed']);
  assert.equal(failures[0].step, 2);
});

test('an invisible root is its own code — counting phrases under it would be a lie', () => {
  const failures = routeFailures(ROUTE, { ...OK, root_visible: false });
  assert.deepEqual(failures.map((f) => f.code), ['root_not_visible']);
});

test('a count that does not match names both numbers', () => {
  const failures = routeFailures(ROUTE, { ...OK, structure: [{ index: 0, actual: 5 }] });
  assert.deepEqual(failures.map((f) => f.code), ['structure_mismatch']);
  assert.equal(failures[0].expected, 4);
  assert.equal(failures[0].actual, 5);
});

test('an absent check expects zero and fails when the app draws it anyway', () => {
  const route = { ...ROUTE, structure: [{ what: 'absent', selector: 'input' }] };
  assert.deepEqual(routeFailures(route, { ...OK, structure: [{ index: 0, actual: 0 }] }), []);
  assert.equal(routeFailures(route, { ...OK, structure: [{ index: 0, actual: 2 }] })[0].actual, 2);
});

test('an order check compares the sequence, not the count', () => {
  const route = { ...ROUTE, phrases: [], structure: [{ what: 'order', selector: '.tab', equals: ['작업', '알람'] }] };
  assert.deepEqual(routeFailures(route, { ...OK, structure: [{ index: 0, actual: ['작업', '알람'] }] }), []);
  assert.equal(routeFailures(route, { ...OK, structure: [{ index: 0, actual: ['알람', '작업'] }] })[0].code,
    'structure_mismatch');
});

test('a screen board with no route is a failure, not a skip', () => {
  const record = routeMissingRecord({ id: 'ZZ-0', page: '1-0', name: '99 · 미저작' });
  assert.equal(record.status, 'fail');
  assert.deepEqual(record.failures, [{ code: 'route_missing' }]);
});

test('every code this module emits is in the closed set §6.4 reads', () => {
  const emitted = [
    ...routeFailures(ROUTE, { reach_error: { message: 'x' } }),
    ...routeFailures(ROUTE, { ...OK, root_found: false }),
    ...routeFailures(ROUTE, { ...OK, visible_text: '', structure: [{ index: 0, actual: 1 }] }),
    ...routeMissingRecord({ id: 'ZZ-0', page: '1-0', name: 'x' }).failures,
    ...contractRecord({ id: 'C-0', page: 'F-1', name: 'x' }, [], '').failures,
    ...contractRecord({ id: 'C-0', page: 'F-1', name: 'x' }, ['문장이다.'], '').failures,
  ].map((failure) => failure.code);
  for (const code of emitted) assert.ok(SCREEN_FAILURE_CODES.includes(code), code);
});

// ---------- 계약 보드(§4.6) ----------

test('contract sentences keep the prose and drop the table cells', () => {
  const texts = [
    { text: '값이 0이어도 행을 숨기지 않습니다. 구간은 공식 응답과 1:1입니다.' },
    { text: 'ka10004' },
    { text: '10행 표시 · 더보기 시 표 내부 스크롤 · 접기' },
    { text: '짧다.' },
    { text: '156,200,000 · 104,100,000.' },
  ];
  const hard = (text) => /[\d,]{7,}/.test(text); // E1~E7 자리에 놓는 최소 대역
  assert.deepEqual(contractSentences(texts, hard),
    ['값이 0이어도 행을 숨기지 않습니다. 구간은 공식 응답과 1:1입니다.']);
});

test('a contract sentence the docs never copied is contract_undocumented', () => {
  const record = contractRecord({ id: 'C-0', page: 'F-1', name: 'x' }, ['계약 문장이다.'], '# 문서\n다른 말\n');
  assert.equal(record.status, 'fail');
  assert.deepEqual(record.failures[0].code, 'contract_undocumented');
  assert.deepEqual(record.failures[0].sentences, ['계약 문장이다.']);
});

test('a contract board the docs already carry passes', () => {
  const record = contractRecord({ id: 'C-0', page: 'F-1', name: 'x' }, ['계약 문장이다.'], '앞말 계약 문장이다. 뒷말');
  assert.equal(record.status, 'pass');
  assert.equal(record.measured.sentences, 1);
});

test('a contract board with no sentence fails instead of passing on nothing', () => {
  const record = contractRecord({ id: 'C-0', page: 'F-1', name: 'x' }, [], '아무 문서');
  assert.equal(record.status, 'fail');
  assert.equal(record.failures[0].code, 'contract_no_sentence');
});

// ---------- 래칫(§4.5) ----------

const RATCHET = { passing: ['A', 'B'], passing_count: 2, shrink_log: [], target_boards: 4 };
const boards = (pairs) => pairs.map(([board_id, status]) => ({ board_id, status }));

test('a board outside the lock may fail — that is the unimplemented backlog, not a regression', () => {
  const verdict = judgeRatchet(RATCHET, boards([['A', 'pass'], ['B', 'pass'], ['C', 'fail']]), { canonical: true });
  assert.equal(verdict.exitCode, 0);
  assert.deepEqual(verdict.regressions, []);
});

test('a locked board that breaks is exit 1', () => {
  const verdict = judgeRatchet(RATCHET, boards([['A', 'fail'], ['B', 'pass']]), { canonical: true });
  assert.equal(verdict.exitCode, 1);
  assert.deepEqual(verdict.regressions, ['A']);
});

test('a newly passing board is a warning, not a failure', () => {
  const verdict = judgeRatchet(RATCHET, boards([['A', 'pass'], ['B', 'pass'], ['C', 'pass']]), { canonical: true });
  assert.equal(verdict.exitCode, 0);
  assert.deepEqual(verdict.newly_passing, ['C']);
});

test('a full run that never saw a locked board is exit 1 — the lock silently vanished', () => {
  const verdict = judgeRatchet(RATCHET, boards([['A', 'pass']]), { canonical: true });
  assert.deepEqual(verdict.missing, ['B']);
  assert.equal(verdict.exitCode, 1);
});

test('a partial run does not call the boards it skipped missing', () => {
  const verdict = judgeRatchet(RATCHET, boards([['A', 'pass']]), { canonical: false });
  assert.deepEqual(verdict.missing, []);
  assert.equal(verdict.exitCode, 0);
});

test('bless grows the lock and keeps the shrink log untouched', () => {
  const result = blessRatchet(RATCHET, boards([['A', 'pass'], ['B', 'pass'], ['C', 'pass']]),
    { at: '2026-09-06T00:00:00.000Z' });
  assert.deepEqual(result.added, ['C']);
  assert.deepEqual(result.next.passing, ['A', 'B', 'C']);
  assert.equal(result.next.passing_count, 3);
  assert.deepEqual(result.next.shrink_log, []);
});

test('bless refuses to shrink the lock on its own', () => {
  const result = blessRatchet(RATCHET, boards([['A', 'pass'], ['B', 'fail']]), {});
  assert.match(result.error, /--allow-shrink/);
  assert.equal(result.next, undefined);
});

test('shrinking without a reason is refused even with --allow-shrink', () => {
  const result = blessRatchet(RATCHET, boards([['A', 'pass'], ['B', 'fail']]), { allowShrink: true, why: '  ' });
  assert.match(result.error, /--why/);
});

test('a reasoned shrink is allowed and leaves the reason behind', () => {
  const result = blessRatchet(RATCHET, boards([['A', 'pass'], ['B', 'fail']]),
    { allowShrink: true, why: '보드 B가 Paper에서 갈렸다', at: '2026-09-06T00:00:00.000Z' });
  assert.deepEqual(result.next.passing, ['A']);
  assert.deepEqual(result.next.shrink_log, [
    { at: '2026-09-06T00:00:00.000Z', removed: ['B'], why: '보드 B가 Paper에서 갈렸다' },
  ]);
});

// ---------- CLI ----------

const runtime = (over = {}) => ({
  selection: { canonical: true },
  elapsed_ms: 12000,
  totals: { boards: 3, pass: 1, fail: 2, route_missing: 1, contract: 1, contract_fail: 0 },
  boards: [
    { board_id: 'A', page: '1-0', status: 'fail', failures: [{ code: 'phrase_missing' }] },
    { board_id: 'Z', page: '1-0', status: 'fail', failures: [{ code: 'route_missing' }] },
    { board_id: 'B', page: '1-0', status: 'pass', failures: [] },
  ],
  ...over,
});

test('the CLI lists the boards that need work but not the 96 unwritten routes', () => {
  const verdict = { regressions: [], newly_passing: [], missing: [], locked_count: 1, exitCode: 0 };
  const { exitCode, lines } = formatScreensCliReport(runtime(), verdict, 'app/captures/paper-gates/PAPER-SCREENS.json');
  assert.equal(exitCode, 0);
  assert.ok(lines.some((line) => line.includes('FAIL A')));
  assert.equal(lines.some((line) => line.includes('FAIL Z')), false);
});

test('a run the ratchet let through does not get a green stamp while boards are red', () => {
  const verdict = { regressions: [], newly_passing: [], missing: [], locked_count: 1, exitCode: 0 };
  const { lines } = formatScreensCliReport(runtime(), verdict, 'x.json');
  assert.equal(lines.includes('paper screens verification passed'), false);
  assert.ok(lines.some((line) => line.includes('아직 안 막는다')));
});

test('the success marker appears only when nothing is red', () => {
  const clean = runtime({
    totals: { boards: 1, pass: 1, fail: 0, route_missing: 0, contract: 0, contract_fail: 0 },
    boards: [{ board_id: 'B', page: '1-0', status: 'pass', failures: [] }],
  });
  const verdict = { regressions: [], newly_passing: [], missing: [], locked_count: 1, exitCode: 0 };
  assert.ok(formatScreensCliReport(clean, verdict, 'x.json').lines.includes('paper screens verification passed'));
});

test('a regression prints why it blocks and drops the success marker', () => {
  const verdict = { regressions: ['A'], newly_passing: [], missing: [], locked_count: 2, exitCode: 1 };
  const { exitCode, lines } = formatScreensCliReport(runtime(), verdict, 'x.json');
  assert.equal(exitCode, 1);
  assert.ok(lines.some((line) => line.includes('[ratchet] 회귀: A')));
  assert.equal(lines.includes('paper screens verification passed'), false);
});
