'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  values() { return new Set(String(this.owner.className || '').split(/\s+/).filter(Boolean)); }
  add(...names) { const next = this.values(); names.forEach((name) => next.add(name)); this.owner.className = [...next].join(' '); }
  remove(...names) { const next = this.values(); names.forEach((name) => next.delete(name)); this.owner.className = [...next].join(' '); }
  contains(name) { return this.values().has(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.classList = new FakeClassList(this);
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
  }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  click() { for (const listener of this.listeners.get('click') || []) listener({ stopPropagation() {} }); }
}

function findByText(root, tagName, text) {
  if (root.tagName === tagName.toUpperCase() && root.children.some((child) => child.textContent === text)) return root;
  for (const child of root.children) {
    const found = findByText(child, tagName, text);
    if (found) return found;
  }
  return null;
}

function containsText(root, text) {
  if (root.textContent === text) return true;
  return root.children.some((child) => containsText(child, text));
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushAsync() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

global.document = {
  createElement: (tagName) => new FakeElement(tagName),
  createElementNS: (_ns, tagName) => new FakeElement(tagName),
};

const ipcCalls = [];
let invokeImpl = async (channel) => {
  if (channel === 'athena:auth-token-status') return { state: 'needed' };
  if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
  return { ok: true };
};

global.window = {
  athena: {
    invoke: async (channel) => {
      ipcCalls.push(channel);
      return invokeImpl(channel);
    },
    on: () => () => {},
  },
};

const onboarding = require('./onboarding');
const authScreen = require('./auth-screen');

test('onboarding state는 new→2 / 3, partial→3 / 3, configured→메인 직행으로 해석한다', () => {
  assert.equal(onboarding.resolveOnboardingStartStep({ needed: true, step: 2 }), 2);
  assert.equal(onboarding.resolveOnboardingStartStep({ needed: true, step: 3 }), 3);
  assert.equal(onboarding.resolveOnboardingStartStep({ needed: false, step: 3 }), null);
});

test('advance 응답은 ok와 done을 각각 보존해 partial 성공을 완료로 축약하지 않는다', () => {
  assert.deepEqual(onboarding.normalizeOnboardingAdvanceResult({ ok: true, done: false }), {
    ok: true,
    done: false,
  });
  assert.deepEqual(onboarding.normalizeOnboardingAdvanceResult({ ok: true, done: true }), {
    ok: true,
    done: true,
  });
});

test('현재 최초 실제 단계인 CLI 2 / 3에는 이전 버튼이 없다', () => {
  const root = new FakeElement('div');
  const cleanup = onboarding.renderCliStep(root, { onContinue: async () => true });
  assert.equal(findByText(root, 'button', '이전'), null);
  cleanup();
});

test('3 / 3 계좌 단계의 이전은 CLI 2 / 3 callback만 호출하고 cleanup 뒤에는 동작하지 않는다', () => {
  ipcCalls.length = 0;
  const root = new FakeElement('div');
  let backCount = 0;
  const cleanup = onboarding.renderAccountStep(root, {
    onRegistered: () => assert.fail('등록되지 않은 상태에서 다음 단계로 가면 안 된다'),
    onBack: () => { backCount += 1; },
  });

  const back = findByText(root, 'button', '이전');
  assert.ok(back, '계좌 단계에 이전 버튼이 있어야 한다');
  back.click();
  assert.equal(backCount, 1);
  assert.deepEqual(ipcCalls, [], '이전 이동은 저장된 CLI/계좌 정보를 삭제하거나 롤백하지 않아야 한다');

  cleanup();
  back.click();
  assert.equal(backCount, 1, '정리된 화면의 listener는 전환을 다시 일으키지 않아야 한다');
});

test('3 / 3 계좌 입력과 저장 위치는 회색 면 채움 없이 열린 표면을 유지한다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'chat.css'), 'utf8');
  const inputRow = css.match(/\.onb-input-row\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';
  const savebox = css.match(/\.onb-savebox\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

  assert.match(inputRow, /background:\s*transparent\s*;/);
  assert.match(inputRow, /border:\s*1px solid var\(--color-k-line-soft\)\s*;/);
  assert.match(savebox, /background:\s*transparent\s*;/);
  assert.match(savebox, /border:\s*1px solid var\(--color-k-line-soft\)\s*;/);
  assert.doesNotMatch(`${inputRow}\n${savebox}`, /rgb\(\s*(?:16\s+19\s+26|29\s+34\s+44)\s*\/\s*(?:50|55)%\s*\)/);
  assert.match(css, /\.onb-input-row:focus-within\s*\{[^}]*border-color:\s*var\(--color-brand\)/s);
});

test('토큰 확인 화면의 이전은 계좌 3 / 3 callback을 호출하고 완료 callback은 건드리지 않는다', () => {
  ipcCalls.length = 0;
  const root = new FakeElement('div');
  let backCount = 0;
  let continueCount = 0;
  const cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'account-1',
    embedded: true,
    onBack: () => { backCount += 1; },
    onContinue: async () => { continueCount += 1; return true; },
  });

  const back = findByText(root, 'button', '이전');
  assert.ok(back, '토큰 확인 화면에 이전 버튼이 있어야 한다');
  back.click();
  assert.equal(backCount, 1);
  assert.equal(continueCount, 0, '이전은 온보딩 완료 persistence를 호출하지 않아야 한다');
  assert.equal(ipcCalls.includes('athena:auth-token-revoke'), false, '이전 이동은 준비된 토큰을 폐기하지 않아야 한다');

  cleanup();
  back.click();
  assert.equal(backCount, 1);
});

test('Paper 28 재발급 중은 모든 진행·해제 동작을 잠그고 이전만 허용한다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'refreshing', expiresInSec: 3599 };
    if (channel === 'athena:account-list') return { accounts: [] };
    return { ok: true };
  };
  const root = new FakeElement('div');
  const cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'fixture-account',
    embedded: true,
    onBack: () => {},
    onContinue: async () => true,
  });
  await flushAsync();

  assert.equal(containsText(root, '재발급 중'), true);
  assert.equal(findByText(root, 'button', '발급 중').disabled, true);
  assert.equal(findByText(root, 'button', '연결 해제').disabled, true);
  assert.equal(findByText(root, 'button', '계속').disabled, true);
  assert.equal(findByText(root, 'button', '이전').disabled, false);
  cleanup();
});

test('Paper 27 셸의 Paper 28 재발급 중 타이머와 비활성 ghost 동작은 회색 면 채움 없이 hairline만 유지한다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'chat.css'), 'utf8');
  const timer = css.match(/\.auth-timer-card\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';
  const disabledGhost = css.match(/\.onb-auth \.auth-btn-group \.uk-btn-ghost:disabled\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

  assert.match(timer, /background:\s*transparent\s*;/);
  assert.match(timer, /backdrop-filter:\s*none\s*;/);
  assert.match(timer, /border:\s*1px solid var\(--color-k-line-soft\)\s*;/);
  assert.match(disabledGhost, /background:\s*transparent\s*;/);
  assert.match(disabledGhost, /border-color:\s*var\(--color-k-line-soft\)\s*;/);
});

test('토큰 화면에서 돌아온 계좌 단계는 기존 accountId·alias로 재입력 없는 인증 복귀 경로를 제공한다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
    return { ok: true };
  };
  const root = new FakeElement('div');
  let resumedId = null;
  const cleanup = onboarding.renderAccountStep(root, {
    connectedAccountId: 'account-1',
    onUseRegistered: (accountId) => { resumedId = accountId; },
    onRegistered: () => assert.fail('기존 계좌 복귀에 중복 등록을 요구하면 안 된다'),
    onBack: () => {},
  });
  await flushAsync();

  assert.equal(containsText(root, '모의-1 · 자격증명 저장됨'), true);
  const resume = findByText(root, 'button', '인증 확인으로 돌아가기');
  assert.ok(resume);
  resume.click();
  assert.equal(resumedId, 'account-1');
  assert.equal(containsText(root, 'APP KEY'), true, '다른 계좌 등록 폼은 선택지로 남겨둔다');
  assert.equal(containsText(root, 'SECRET KEY'), true);
  cleanup();
});

test('{ok:true, done:false}는 완료시키지 않고 온보딩에 남는 명시 오류를 반환한다', () => {
  const guard = onboarding.createOnboardingRevisionGuard();
  const revision = guard.next();
  let finishCount = 0;
  const result = onboarding.completeOnboardingIfCurrent(
    { ok: true, done: false }, guard, revision, () => { finishCount += 1; },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /완료 상태를 확인하지 못했습니다/);
  assert.equal(finishCount, 0);
});

test('토큰 renderer는 done:false 결과의 명시 오류를 화면에 표시한다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'ready', expiresInSec: 3600 };
    if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
    return { ok: true };
  };
  const root = new FakeElement('div');
  const cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'account-1',
    embedded: true,
    onBack: () => {},
    onContinue: async () => ({
      ok: false,
      error: '온보딩 완료 상태를 확인하지 못했습니다. 계좌 연결 상태를 다시 확인해주세요.',
    }),
  });
  await flushAsync();
  findByText(root, 'button', '계속').click();
  await flushAsync();
  assert.equal(
    containsText(root, '온보딩 완료 상태를 확인하지 못했습니다. 계좌 연결 상태를 다시 확인해주세요.'),
    true,
  );
  cleanup();
});

test('최종 persistence await 중 이전으로 화면 revision이 바뀌면 늦은 done:true가 셸을 열지 않는다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'ready', expiresInSec: 3600 };
    if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
    return { ok: true };
  };
  const pending = deferred();
  const guard = onboarding.createOnboardingRevisionGuard();
  const revision = guard.next();
  const root = new FakeElement('div');
  let finishCount = 0;
  let cleanup;
  cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'account-1',
    embedded: true,
    onBack: () => {
      guard.next();
      cleanup();
    },
    onContinue: async () => onboarding.completeOnboardingIfCurrent(
      await pending.promise, guard, revision, () => { finishCount += 1; },
    ),
  });
  await flushAsync();

  findByText(root, 'button', '계속').click();
  findByText(root, 'button', '이전').click();
  pending.resolve({ ok: true, done: true });
  await flushAsync();

  assert.equal(finishCount, 0);
});

test('온보딩 중 receipt는 화면을 열거나 버리지 않고 즉시 안정된 fail ACK로 waiter를 종료한다', () => {
  const onboard = new FakeElement('div');
  onboard.hidden = false;
  const sent = [];
  const handled = onboarding.ackRestReceiptBlockedByOnboarding(
    onboard,
    (channel, payload) => sent.push([channel, payload]),
    'receipt-1',
  );
  assert.equal(handled, true);
  assert.deepEqual(sent, [[
    'athena:rest-receipt-painted',
    { receipt_id: 'receipt-1', verified_visible: false, error: 'onboarding_active' },
  ]]);
});

test('최초 실행은 부팅 뒤 전용 온보딩만 보이고 완료 전 메인 셸은 모든 상호작용에서 차단된다', () => {
  const shell = new FakeElement('div');
  const app = new FakeElement('div');
  shell.hidden = false; // revealChrome이 먼저 실행된 경우도 차단되어야 한다.
  app.hidden = false;

  onboarding.setAppBlockedForOnboarding(shell, app, true);

  assert.equal(shell.classList.contains('is-onboarding-hidden'), true);
  assert.equal(shell.getAttribute('aria-hidden'), 'true');
  assert.equal(shell.inert, true);
  assert.equal(app.hidden, true);

  const css = fs.readFileSync(path.join(__dirname, '..', 'shell.css'), 'utf8');
  assert.match(css, /#shell\.is-onboarding-hidden\s*\{[^}]*display:\s*none\s*!important/s);

  // CLI + 계좌 + 토큰이 끝나기 전에는 false를 호출하지 않으므로 계속 차단된다.
  assert.equal(shell.classList.contains('is-onboarding-hidden'), true);
});

test('CLI + 계좌 + 토큰 완료를 persistence한 뒤에만 메인 셸과 채팅을 정확히 복구한다', () => {
  const shell = new FakeElement('div');
  const app = new FakeElement('div');
  const guard = onboarding.createOnboardingRevisionGuard();
  const revision = guard.next();
  onboarding.setAppBlockedForOnboarding(shell, app, true);

  const result = onboarding.completeOnboardingIfCurrent(
    { ok: true, done: true },
    guard,
    revision,
    () => onboarding.setAppBlockedForOnboarding(shell, app, false),
  );

  assert.equal(result.ok, true);
  assert.equal(shell.classList.contains('is-onboarding-hidden'), false);
  assert.equal(shell.getAttribute('aria-hidden'), null);
  assert.equal(shell.inert, false);
  assert.equal(shell.hidden, false);
  assert.equal(app.hidden, false);
});
