// collection-settings.js 단위 테스트 — 의존을 전부 주입하므로 Electron이 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderCollectionSettings, describeRendered } = require('./collection-settings');
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
    holdingsIntervalMin: 60,
    ...overrides,
  };
}

function setup(options) {
  const opts = options || {};
  const writes = [];
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
    defaultIngestIntervalMinutes: 60,
    resetBrain: opts.resetBrain,
  };
  renderCollectionSettings(container, deps);
  return { container, writes, deps, get current() { return current; } };
}

function byClass(container, className) {
  return container.querySelectorAll(className.startsWith('.') ? className : `.${className}`);
}

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
  const deps = { readSettings: () => settings(), writeSettings: () => {}, intervalOptions: [60], brainReady: true, defaultIngestIntervalMinutes: 60 };
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

test('보유잔고 칸에만 조회 주기 선택기가 있고 저장값이 선택돼 있다', () => {
  const { container } = setup({ settings: { holdingsIntervalMin: 120 } });
  const selects = byClass(container, 'graph-settings-interval-select');
  assert.equal(selects.length, 1, '주기 선택기는 보유잔고 칸 하나뿐이다(보드 05)');
  const selected = selects[0].children.filter((o) => o.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].value, '120');
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
  await new Promise((resolve) => setImmediate(resolve));
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

test('이 화면이 못 바꾸는 값은 우측 곁말로 정직하게 표시된다(보드 05)', () => {
  const { container } = setup();
  assert.deepEqual(
    byClass(container, 'graph-settings-row-aside').map((n) => n.textContent),
    ['설정 파일', '제공 안 함']);
  assert.match(byClass(container, 'graph-settings-envvar')[0].textContent, /ATHENA_BRAIN_INGEST_INTERVAL_MINUTES/);
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
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resets, 1);
  const note = byClass(container, 'graph-settings-reset-result')[0];
  assert.match(note.textContent, /직접 재시작/, '앱이 띄운 백엔드가 아니면 자동 재기동을 약속하지 않는다');
});

test('삭제가 실패하면 오류를 적고 버튼을 되살린다(조용히 성공한 척하지 않는다)', async () => {
  const { container } = setup({ resetBrain: async () => ({ ok: false, error: '백엔드가 응답하지 않습니다' }) });
  const danger = byClass(container, 'graph-settings-danger')[0];
  danger.dispatchEvent({ type: 'click' });
  byClass(container, 'graph-settings-confirm-ok')[0].dispatchEvent({ type: 'click' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(byClass(container, 'graph-settings-error')[0].textContent, /백엔드가 응답하지 않습니다/);
  assert.equal(danger.disabled, false);
});

test('resetBrain이 예외를 던져도 화면이 깨지지 않는다', async () => {
  const { container } = setup({ resetBrain: async () => { throw new Error('IPC 끊김'); } });
  byClass(container, 'graph-settings-danger')[0].dispatchEvent({ type: 'click' });
  byClass(container, 'graph-settings-confirm-ok')[0].dispatchEvent({ type: 'click' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(byClass(container, 'graph-settings-error')[0].textContent, /IPC 끊김/);
});
