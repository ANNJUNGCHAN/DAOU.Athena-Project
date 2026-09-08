// collection-settings.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderCollectionSettings, describeRendered, applySchedule, scheduleText, formatClock,
} = require('./collection-settings');
const { fakeNode, installFakeDocument, uninstallFakeDocument } = require('./fake-dom');

test.beforeEach(() => {
  installFakeDocument();
});

test.afterEach(() => {
  uninstallFakeDocument();
});

function settings(overrides) {
  return {
    collectChat: true,
    collectFills: true,
    collectHoldings: true,
    exposeToModel: true,
    chatIntervalMin: 60,
    fillsIntervalMin: 60,
    holdingsIntervalMin: 60,
    ...overrides,
  };
}

// 백엔드 GET /brain/schedule 응답 모양 그대로.
function schedule(overrides) {
  const row = (source, extra) => ({
    source, interval_minutes: 60, producer_wired: true,
    last_run_at: '2026-09-08T05:05:00Z', next_run_at: '2026-09-08T06:05:00Z',
    running: false, last_error: null, ...extra,
  });
  return {
    schedule_owner: 'backend',
    sources: [row('chat'), row('fills'), row('holdings')],
    ...overrides,
  };
}

function setup(options) {
  const opts = options || {};
  const writes = [];
  const intervalCalls = [];
  const runCalls = [];
  const container = fakeNode('div');
  let current = settings(opts.settings);
  const deps = {
    readSettings: () => current,
    writeSettings: (patch) => {
      writes.push(patch);
      current = { ...current, ...patch };
      return current;
    },
    setCollectChat: opts.setCollectChat,
    intervalOptions: [30, 60, 120],
    brainReady: opts.brainReady !== false,
    schedule: opts.schedule === undefined ? schedule() : opts.schedule,
    setSourceInterval: opts.setSourceInterval || (async (source, minutes) => {
      intervalCalls.push([source, minutes]);
      return null;
    }),
    runSource: opts.runSource || (async (source) => {
      runCalls.push(source);
      return null;
    }),
    resetBrain: opts.resetBrain,
  };
  renderCollectionSettings(container, deps);
  return { container, writes, intervalCalls, runCalls, deps, get current() { return current; } };
}

function byClass(container, className) {
  return container.querySelectorAll(className.startsWith('.') ? className : `.${className}`);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ── 골격(보드 05) ────────────────────────────────────────────────────────────

test('카드 두 장(수집·노출 · 브레인 상태)과 토글 네 개를 그린다', () => {
  const { container } = setup();
  const summary = describeRendered(container);
  assert.equal(summary.rendered, true);
  assert.equal(summary.cards, 2);
  assert.equal(summary.toggles, 4, '대화 · 체결내역 · 보유잔고 · 모델 전달');
});

test('컨테이너가 없으면 조용히 넘어간다', () => {
  assert.equal(renderCollectionSettings(null, { readSettings: () => settings() }), null);
});

test('다시 그리면 이전 내용을 지운다(카드가 쌓이지 않는다)', () => {
  const container = fakeNode('div');
  const deps = { readSettings: () => settings(), writeSettings: () => {}, intervalOptions: [60], brainReady: true };
  renderCollectionSettings(container, deps);
  renderCollectionSettings(container, deps);
  assert.equal(container.children.length, 1);
  assert.equal(describeRendered(container).cards, 2);
});

test('수집원 세 칸의 라벨이 보드 05 그대로다', () => {
  const { container } = setup();
  assert.deepEqual(
    byClass(container, 'graph-settings-source-label').map((n) => n.textContent),
    ['대화', '체결내역', '보유잔고']);
});

// ── 소스별 조회 주기 ─────────────────────────────────────────────────────────

test('세 칸 모두 조회 주기 선택기가 있고 각자의 저장값이 선택돼 있다', () => {
  const { container } = setup({ settings: { chatIntervalMin: 30, holdingsIntervalMin: 120 } });
  const selects = byClass(container, 'graph-settings-interval-select');
  assert.equal(selects.length, 3, '대화 · 체결내역 · 보유잔고');
  const picked = selects.map((s) => s.children.filter((o) => o.selected)[0].value);
  assert.deepEqual(picked, ['30', '60', '120']);
  assert.deepEqual(selects.map((s) => s.getAttribute('aria-label')),
    ['대화 조회 주기', '체결내역 조회 주기', '보유잔고 조회 주기']);
});

test('체결내역 주기를 바꾸면 그 키만 저장하고 백엔드에 그 소스만 밀어 넣는다', async () => {
  const { container, writes, intervalCalls } = setup();
  const select = byClass(container, 'graph-settings-interval-select')[1];
  select.value = '30';
  select.dispatchEvent({ type: 'change' });
  await tick();
  assert.deepEqual(writes, [{ fillsIntervalMin: 30 }]);
  assert.deepEqual(intervalCalls, [['fills', 30]]);
  assert.equal(select.disabled, false);
});

test('주기 반영이 실패해도 저장값은 남고 이유를 적는다', async () => {
  const { container, writes } = setup({
    setSourceInterval: async () => { throw new Error('백엔드 응답 503'); },
  });
  const select = byClass(container, 'graph-settings-interval-select')[0];
  select.value = '120';
  select.dispatchEvent({ type: 'change' });
  await tick();
  assert.deepEqual(writes, [{ chatIntervalMin: 120 }]);
  assert.match(byClass(container, 'graph-settings-error')[0].textContent, /503/);
});

// ── 수동 실행 ────────────────────────────────────────────────────────────────

test('세 칸 모두 재생 버튼이 있고 라벨이 소스를 말한다', () => {
  const { container } = setup();
  const runs = byClass(container, 'graph-settings-run');
  assert.equal(runs.length, 3);
  assert.deepEqual(runs.map((b) => b.getAttribute('aria-label')),
    ['대화 지금 실행', '체결내역 지금 실행', '보유잔고 지금 실행']);
  assert.deepEqual(runs.map((b) => b.disabled), [false, false, false]);
});

test('스케줄을 못 읽었으면 재생 버튼은 잠기고 시각을 지어내지 않는다', () => {
  const { container } = setup({ schedule: null, brainReady: false });
  assert.deepEqual(byClass(container, 'graph-settings-run').map((b) => b.disabled), [true, true, true]);
  assert.deepEqual(byClass(container, 'graph-settings-source-meta').map((n) => n.textContent),
    ['실행 시각 알 수 없음', '실행 시각 알 수 없음', '실행 시각 알 수 없음']);
});

test('재생을 누르면 그 소스만 실행하고, 도는 동안 "실행 중…"을 적은 뒤 새 시각으로 바꾼다', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-08T09:00:00Z') });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runCalls = [];
  const { container } = setup({
    runSource: async (source) => {
      runCalls.push(source);
      await gate;
      return schedule({
        sources: [
          { source: 'chat', interval_minutes: 60, producer_wired: true, last_run_at: '2026-09-08T05:05:00Z', next_run_at: '2026-09-08T06:05:00Z', running: false, last_error: null },
          { source: 'fills', interval_minutes: 60, producer_wired: true, last_run_at: '2026-09-08T07:30:00Z', next_run_at: '2026-09-08T08:30:00Z', running: false, last_error: null },
          { source: 'holdings', interval_minutes: 60, producer_wired: true, last_run_at: '2026-09-08T05:05:00Z', next_run_at: '2026-09-08T06:05:00Z', running: false, last_error: null },
        ],
      });
    },
  });
  const run = byClass(container, 'graph-settings-run')[1];
  const meta = byClass(container, 'graph-settings-source-meta')[1];
  run.dispatchEvent({ type: 'click' });
  assert.deepEqual(runCalls, ['fills']);
  assert.equal(run.disabled, true);
  assert.equal(meta.textContent, '실행 중…');
  release();
  await tick();
  assert.equal(run.disabled, false);
  assert.match(meta.textContent, /^마지막 \d\d:\d\d · 다음 \d\d:\d\d$/);
  assert.notEqual(meta.textContent, byClass(container, 'graph-settings-source-meta')[0].textContent,
    '체결내역만 새 시각이다');
});

test('실행이 실패하면 이유를 적고 버튼을 되살린다(조용히 성공한 척하지 않는다)', async () => {
  const { container } = setup({ runSource: async () => { throw new Error('IPC 끊김'); } });
  const run = byClass(container, 'graph-settings-run')[2];
  run.dispatchEvent({ type: 'click' });
  await tick();
  assert.equal(run.disabled, false);
  assert.match(byClass(container, 'graph-settings-error')[0].textContent, /IPC 끊김/);
  assert.match(byClass(container, 'graph-settings-source-meta')[2].textContent, /^마지막 /);
});

// ── 실행 시각 문구 ───────────────────────────────────────────────────────────

test('실행 시각은 같은 날이면 시:분, 다른 날이면 월/일 시:분이다', () => {
  const now = Date.parse('2026-09-08T09:00:00Z');
  assert.match(formatClock('2026-09-08T05:05:00Z', now), /^\d\d:\d\d$/);
  assert.match(formatClock('2026-09-07T05:05:00Z', now), /^\d{1,2}\/\d{1,2} \d\d:\d\d$/);
  assert.equal(formatClock('garbage', now), null);
});

test('아직 안 돌았으면 마지막은 —, 주기 주인이 외부면 다음 시각을 약속하지 않는다', () => {
  const never = schedule({ sources: [{ source: 'chat', interval_minutes: 60, producer_wired: true, last_run_at: null, next_run_at: '2026-09-08T06:05:00Z', running: false, last_error: null }] });
  assert.match(scheduleText(never, 'chat', Date.parse('2026-09-08T09:00:00Z')), /^마지막 — · 다음 \d\d:\d\d$/);
  const external = schedule({ schedule_owner: 'external' });
  assert.match(scheduleText(external, 'chat'), /· 자동 실행 없음$/);
});

test('실패·계정 미연결은 숨기지 않는다', () => {
  const s = schedule({
    sources: [
      { source: 'fills', interval_minutes: 60, producer_wired: false, last_run_at: '2026-09-08T05:05:00Z', next_run_at: '2026-09-08T06:05:00Z', running: false, last_error: 'RuntimeError' },
      { source: 'chat', interval_minutes: 60, producer_wired: true, last_run_at: null, next_run_at: null, running: true, last_error: null },
    ],
  });
  assert.match(scheduleText(s, 'fills'), /실패\(RuntimeError\) · 계정 미연결$/);
  assert.equal(scheduleText(s, 'chat'), '실행 중…');
});

test('applySchedule은 그려진 칸의 시각·버튼만 바꾸고 다시 그리지 않는다', () => {
  const { container } = setup({ schedule: null });
  const before = byClass(container, 'graph-settings-interval-select');
  applySchedule(container, schedule({
    sources: [
      { source: 'chat', interval_minutes: 60, producer_wired: true, last_run_at: '2026-09-08T05:05:00Z', next_run_at: '2026-09-08T06:05:00Z', running: false, last_error: null },
      { source: 'fills', interval_minutes: 60, producer_wired: true, last_run_at: null, next_run_at: null, running: true, last_error: null },
    ],
  }), Date.parse('2026-09-08T09:00:00Z'));
  const metas = byClass(container, 'graph-settings-source-meta').map((n) => n.textContent);
  assert.match(metas[0], /^마지막 \d\d:\d\d · 다음 \d\d:\d\d$/);
  assert.equal(metas[1], '실행 중…');
  assert.equal(metas[2], '실행 시각 알 수 없음', '응답에 없는 소스는 모른다고 말한다');
  assert.deepEqual(byClass(container, 'graph-settings-run').map((b) => b.disabled), [false, true, true]);
  assert.deepEqual(byClass(container, 'graph-settings-interval-select'), before, '노드가 그대로다');
});

// ── 토글 동작 ────────────────────────────────────────────────────────────────

test('체결내역 토글을 끄면 그 값만 저장된다', () => {
  const { container, writes } = setup();
  const toggles = byClass(container, 'graph-settings-toggle');
  toggles[1].dispatchEvent({ type: 'click' });
  assert.deepEqual(writes, [{ collectFills: false }]);
  assert.equal(toggles[1].getAttribute('aria-checked'), 'false');
});

test('모델 전달 토글은 마지막 토글이고 exposeToModel을 저장한다', () => {
  const { container, writes } = setup();
  const toggles = byClass(container, 'graph-settings-toggle');
  toggles[3].dispatchEvent({ type: 'click' });
  assert.deepEqual(writes, [{ exposeToModel: false }]);
});

test('꺼진 상태로 열면 토글이 꺼진 모습으로 그려진다', () => {
  const { container } = setup({ settings: { collectFills: false, exposeToModel: false } });
  const toggles = byClass(container, 'graph-settings-toggle');
  assert.equal(toggles[1].getAttribute('aria-checked'), 'false');
  assert.equal(toggles[3].getAttribute('aria-checked'), 'false');
  assert.equal(toggles[0].getAttribute('aria-checked'), 'true');
});

test('대화 토글은 백엔드 왕복이 실패하면 원래 자리로 되돌아가고 이유를 적는다', async () => {
  let called = null;
  const { container } = setup({
    setCollectChat: async (enabled) => {
      called = enabled;
      throw new Error('대화 이력 수집을 켜지 못했습니다. 개인정보 보호를 위해 OFF로 유지됩니다.');
    },
  });
  const chatToggle = byClass(container, 'graph-settings-toggle')[0];
  chatToggle.dispatchEvent({ type: 'click' });
  await tick();
  assert.equal(called, false);
  assert.equal(chatToggle.getAttribute('aria-checked'), 'false', '실패했으니 켜진 척하지 않는다');
  const error = byClass(container, 'graph-settings-error')[0];
  assert.match(error.textContent, /개인정보 보호를 위해 OFF로 유지됩니다/);
});

// ── 브레인 상태 카드 ─────────────────────────────────────────────────────────

test('브레인 상태 배지는 준비 여부를 색이 아니라 문구로도 말한다', () => {
  assert.equal(byClass(setup({ brainReady: true }).container, 'graph-settings-badge')[0].textContent, '브레인 준비됨');
  const notReady = byClass(setup({ brainReady: false }).container, 'graph-settings-badge')[0];
  assert.equal(notReady.textContent, '브레인 준비 안 됨');
  assert.ok(!String(notReady.attrs.class).includes('is-ready'));
});

test('브레인 상태 카드에는 배치 주기·수동 실행 행이 없다 — 그 셋은 수집원 칸으로 갔다', () => {
  const { container } = setup();
  assert.deepEqual(byClass(container, 'graph-settings-row-title').map((n) => n.textContent), ['전체 삭제']);
  assert.equal(byClass(container, 'graph-settings-row-aside').length, 0);
  assert.equal(byClass(container, 'graph-settings-envvar').length, 0);
});

test('전체 삭제는 한 번 더 묻고, 확인 전에는 아무것도 안 지운다', () => {
  let resets = 0;
  const { container } = setup({ resetBrain: async () => { resets += 1; return { ok: true, selfSpawned: true }; } });
  byClass(container, 'graph-settings-danger')[0].dispatchEvent({ type: 'click' });
  assert.equal(resets, 0, '확인 막대만 떴을 뿐 아직 안 지운다');
  assert.equal(byClass(container, 'graph-settings-confirm').length, 1);
});

test('확인을 취소하면 삭제 버튼이 다시 살아난다', () => {
  const { container } = setup({ resetBrain: async () => ({ ok: true }) });
  const danger = byClass(container, 'graph-settings-danger')[0];
  danger.dispatchEvent({ type: 'click' });
  assert.equal(danger.disabled, true);
  byClass(container, 'graph-settings-confirm-cancel')[0].dispatchEvent({ type: 'click' });
  assert.equal(danger.disabled, false);
  assert.equal(byClass(container, 'graph-settings-confirm').length, 0);
});

test('확인하면 실제로 지우고 재기동 여부를 문구로 구분한다', async () => {
  let resets = 0;
  const { container } = setup({ resetBrain: async () => { resets += 1; return { ok: true, selfSpawned: false }; } });
  byClass(container, 'graph-settings-danger')[0].dispatchEvent({ type: 'click' });
  byClass(container, 'graph-settings-confirm-ok')[0].dispatchEvent({ type: 'click' });
  await tick();
  assert.equal(resets, 1);
  const note = byClass(container, 'graph-settings-reset-result')[0];
  assert.match(note.textContent, /직접 재시작/, '앱이 띄운 백엔드가 아니면 자동 재기동을 약속하지 않는다');
});

test('삭제가 실패하면 오류를 적고 버튼을 되살린다(조용히 성공한 척하지 않는다)', async () => {
  const { container } = setup({ resetBrain: async () => ({ ok: false, error: '백엔드가 응답하지 않습니다' }) });
  const danger = byClass(container, 'graph-settings-danger')[0];
  danger.dispatchEvent({ type: 'click' });
  byClass(container, 'graph-settings-confirm-ok')[0].dispatchEvent({ type: 'click' });
  await tick();
  assert.match(byClass(container, 'graph-settings-error')[0].textContent, /백엔드가 응답하지 않습니다/);
  assert.equal(danger.disabled, false);
});

test('resetBrain이 예외를 던져도 화면이 깨지지 않는다', async () => {
  const { container } = setup({ resetBrain: async () => { throw new Error('IPC 끊김'); } });
  byClass(container, 'graph-settings-danger')[0].dispatchEvent({ type: 'click' });
  byClass(container, 'graph-settings-confirm-ok')[0].dispatchEvent({ type: 'click' });
  await tick();
  assert.match(byClass(container, 'graph-settings-error')[0].textContent, /IPC 끊김/);
});
