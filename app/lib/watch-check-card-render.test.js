'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const checkLib = require('./watch-check-card');
const progressLib = require('./watch-progress-card');

// 실제 IPC 응답 전달·카드 조립을 실행한다. Electron 대신 DOM/IPC 경계만 주입한다.
const source = fs.readFileSync(path.join(__dirname, '..', 'chat.js'), 'utf8');
const start = source.indexOf('async function watchBlockOf(');
const end = source.indexOf('function approvalModeLine(', start);
assert.ok(start >= 0 && end > start);

function element(tag) {
  return {
    tag, className: '', textContent: '', children: [], attrs: {}, listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    addEventListener(kind, handler) { this.listeners[kind] = handler; },
    set innerHTML(_value) { throw new Error('응답 문자열은 HTML로 쓰지 않는다'); },
  };
}
function byClass(root, cls) {
  const out = [];
  (function walk(node) {
    if (node.className.split(/\s+/).includes(cls)) out.push(node);
    node.children.forEach(walk);
  })(root);
  return out;
}
function renderHarness(check, lastCheck = null, detailFails = false) {
  const history = element('history'), calls = [];
  const scope = {
    document: { createElement: element }, watchCheckCardLib: checkLib,
    window: { AthenaLib: { WatchProgressCard: progressLib }, athena: {
      invoke: async (channel, body) => {
        calls.push({ channel, body });
        if (channel === 'athena:routine-watch-check') return { ok: true, data: check };
        if (channel === 'athena:routine-detail') {
          if (detailFails) throw new Error('injected detail failure');
          return { ok: true, data: { last_check: lastCheck } };
        }
        return { ok: true };
      },
    } },
    _btn: (label, className) => Object.assign(element('button'), { textContent: label, className }),
    _mountTurn: (line, card) => { line.appendChild(card); history.appendChild(line); },
  };
  vm.createContext(scope);
  vm.runInContext(source.slice(start, end), scope);
  return { history, calls, scope };
}
const draft = { id: 'draft-1', symbol: '005930', note: '거래량 확인', cooldown_s: 86400,
  watch: { project_id: 'p1', path: 'watch/a.py', lookback_days: 30 } };
function checked(overrides = {}) {
  return { ok: true, count: 2, lookback_days: 30, counted_through: '2026-09-02',
    checked_at: '2026-09-02T15:30:00.123456+00:00',
    last_fire: '2026-08-26', code_hash: 'a'.repeat(64), symbol: '005930',
    warnings: [], error: null, diagnosis: null, reason: null, last_verdict: false,
    duration_ms: 120, counted_until: '어제까지로 세었음 · 오늘은 진행 중',
    fires: [{ dt: '2026-08-05', close: 71000 }, { dt: '2026-08-26', close: 74200 }], nodes: [], ...overrides };
}

test('채팅 검사 왕복: 응답의 날짜가 실제 30개 점과 울린 날 목록에 도착한다', async () => {
  // 현재 /watch/check에는 counted_through가 없고 같은 검사의 상세에만 있다.
  const check = checked();
  delete check.counted_through;
  const before = JSON.stringify(check);
  const h = renderHarness(check, checked());
  const result = await h.scope.runWatchCheck(draft);
  h.scope.renderWatchCheckCard(draft, result);
  const dots = byClass(h.history, 'agent-fix-dot');
  assert.equal(dots.length, 30);
  assert.equal(dots[0].attrs['data-day'], '2026-08-04');
  assert.equal(dots.at(-1).attrs['data-day'], '2026-09-02');
  assert.deepEqual(dots.filter((dot) => dot.className.includes('is-fired')).map((dot) => dot.attrs['data-day']), ['2026-08-05', '2026-08-26']);
  assert.deepEqual(byClass(h.history, 'agent-check-fire').map((row) => row.textContent), ['8/5 · 종가 71,000', '8/26 · 종가 74,200']);
  assert.deepEqual(h.calls.map((call) => call.channel), ['athena:routine-watch-check', 'athena:routine-detail'], '그리기만으로 승인하지 않는다');
  assert.equal(h.calls[1].body.id, 'draft-1');
  await byClass(h.history, 'routine-btn-approve')[0].listeners.click();
  assert.deepEqual(h.calls.map((call) => call.channel), ['athena:routine-watch-check', 'athena:routine-detail', 'athena:routine-confirm']);
  assert.equal(h.calls[2].body.id, 'draft-1');
  assert.equal(JSON.stringify(check), before);
});

test('채팅 검사 왕복: 상세가 다른 검사면 날짜를 섞지 않는다', async () => {
  const check = checked();
  delete check.counted_through;
  const h = renderHarness(check, checked({ checked_at: '2026-09-03T15:30:00.123456+00:00', counted_through: '2026-09-03' }));
  const result = await h.scope.runWatchCheck(draft);
  h.scope.renderWatchCheckCard(draft, result);
  assert.equal(byClass(h.history, 'agent-fix-dot').length, 0);
  assert.deepEqual(byClass(h.history, 'agent-check-fire').map((row) => row.textContent), ['8/5 · 종가 71,000', '8/26 · 종가 74,200']);
  assert.equal(result.counted_through, undefined);
});

test('채팅 검사 왕복: 상세 조회 실패는 실제 검사 결과를 버리거나 날짜로 메우지 않는다', async () => {
  const check = checked();
  delete check.counted_through;
  const h = renderHarness(check, null, true);
  const result = await h.scope.runWatchCheck(draft);
  assert.equal(result, check);
  assert.equal(result.counted_through, undefined);
});

test('채팅 검사 왕복: 상세가 ok:false면 날짜를 메우지 않고 울린 날만 남긴다', async () => {
  const check = checked();
  delete check.counted_through;
  const h = renderHarness(check);
  h.scope.window.athena.invoke = async (channel, body) => {
    h.calls.push({ channel, body });
    if (channel === 'athena:routine-watch-check') return { ok: true, data: check };
    if (channel === 'athena:routine-detail') return { ok: false, error: '없음' };
    return { ok: true };
  };
  const result = await h.scope.runWatchCheck(draft);
  h.scope.renderWatchCheckCard(draft, result);
  assert.equal(result, check);
  assert.equal(result.counted_through, undefined);
  assert.equal(byClass(h.history, 'agent-fix-dot').length, 0);
  assert.deepEqual(byClass(h.history, 'agent-check-fire').map((row) => row.textContent), ['8/5 · 종가 71,000', '8/26 · 종가 74,200']);
  assert.ok(byClass(h.history, 'agent-source').some((node) => /검사 구간 날짜를 붙이지 못함/.test(node.textContent)));
});

for (const kind of ['dated', 'failed']) {
  test(`채팅 검사 왕복: ${kind} 응답은 상세를 더 읽지 않는다`, async () => {
    const check = checked(kind === 'failed' ? { ok: false, counted_through: undefined } : {});
    const h = renderHarness(check);
    assert.equal(await h.scope.runWatchCheck(draft), check);
    assert.deepEqual(h.calls.map((call) => call.channel), ['athena:routine-watch-check']);
  });
}

test('채팅 검사 실패: 남아 온 날짜가 있어도 성공 점 띠·울린 목록·승인을 내지 않는다', () => {
  const h = renderHarness(null);
  h.scope.renderWatchCheckCard(draft, checked({ ok: false, reason: '코드 검사 실패' }));
  assert.equal(byClass(h.history, 'agent-fix-dot').length, 0);
  assert.equal(byClass(h.history, 'agent-check-fire').length, 0);
  assert.equal(byClass(h.history, 'routine-btn-approve').length, 0);
});

test('채팅 검사 0회: 실제 구간만 조용한 7칸으로 표시하고 목록을 만들지 않는다', () => {
  const h = renderHarness(null);
  h.scope.renderWatchCheckCard(draft, checked({ count: 0, lookback_days: 7, fires: [] }));
  assert.equal(byClass(h.history, 'agent-fix-dot').length, 7);
  assert.equal(byClass(h.history, 'is-fired').length, 0);
  assert.equal(byClass(h.history, 'agent-check-fires').length, 0);
});

test('브라우저 배선: shell의 실제 script 순서로 불러온 모델도 날짜·종가를 전달한다', () => {
  const browser = { window: { AthenaLib: {} } };
  vm.createContext(browser);
  const html = fs.readFileSync(path.join(__dirname, '..', 'shell.html'), 'utf8');
  const used = new Set(['lib/watch-check-card.js', 'lib/watch-nodes.js', 'lib/watch-fix-cycle.js']);
  for (const match of html.matchAll(/<script src="([^"]+)"/g)) {
    if (used.has(match[1])) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', match[1]), 'utf8'), browser);
  }
  const result = browser.window.AthenaLib.WatchCheckCard.checkCardModel(checked(), draft);
  assert.ok(Array.isArray(result.fireDots));
  assert.equal(result.fireDots.length, 30);
  assert.equal(result.fireRows[1], '8/26 · 종가 74,200');
});
