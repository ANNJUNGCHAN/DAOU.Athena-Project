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

function findByClass(root, className) {
  if (root.classList && root.classList.contains(className)) return root;
  for (const child of root.children) {
    const found = findByClass(child, className);
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

test('Paper 33 — 연결에 실패한 CLI 행은 [연결] 자리에 재시도를 두고 행 클릭이 다시 시도한다', async () => {
  const previousInvoke = invokeImpl;
  let loginLaunches = false;
  invokeImpl = async (channel) => {
    if (channel === 'athena:cli-list') {
      return { providers: [{ id: 'grok', name: 'Grok', connected: false, accounts: [] }] };
    }
    if (channel === 'athena:cli-login') {
      return loginLaunches
        ? { ok: true, launched: true, message: '' }
        : { ok: false, launched: false, message: 'Grok CLI가 이 컴퓨터에 설치되어 있지 않다' };
    }
    return { ok: true };
  };
  const root = new FakeElement('div');
  const cleanup = onboarding.renderCliStep(root, { onContinue: async () => true });
  await flushAsync();

  findByText(root, 'button', '연결').click();
  await flushAsync();
  assert.equal(containsText(root, '연결 실패 · 재시도'), true);
  assert.equal(findByText(root, 'button', '연결'), null, '실패한 행은 [연결]을 그대로 두지 않는다');

  loginLaunches = true;
  findByClass(root, 'onb-cli-row').click();
  await flushAsync();
  assert.equal(containsText(root, '로그인 대기 중…'), true, '행 클릭이 재시도가 되어야 막다른 길이 아니다');

  cleanup();
  invokeImpl = previousInvoke;
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

test('같은 오버레이를 쓰는 계좌 전환 화면은 자기 사유로 fail ACK한다', () => {
  const onboard = new FakeElement('div');
  onboard.hidden = false;
  const sent = [];
  const handled = onboarding.ackRestReceiptBlockedByOnboarding(
    onboard,
    (channel, payload) => sent.push([channel, payload]),
    'receipt-2',
    'account_switch_active',
  );
  assert.equal(handled, true);
  assert.deepEqual(sent, [[
    'athena:rest-receipt-painted',
    { receipt_id: 'receipt-2', verified_visible: false, error: 'account_switch_active' },
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

// ---------- Paper 1M3-0 「계좌 전환」 진입로 ----------
// 보드 19가 계좌 상태 행에 붙인 이름이 「uk-lrow (클릭 → 계좌 전환)」이고, 그
// 다음 화면(1M3-0)이 경고·4단계 흐름·[전환하고 다시 인증]을 그린다. 배포 앱에서는
// 온보딩 3/3을 지나면 그 화면에 닿을 길이 없었다 — 사이드바 계정 메뉴가 새 진입로다.

test('embedded=false로 열면 계좌 행 클릭이 계좌 전환 뷰로 간다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'ready', expiresInSec: 3600 };
    if (channel === 'athena:account-list') {
      return { accounts: [{ id: 'account-1', alias: '모의-1' }, { id: 'account-2', alias: '모의-2' }] };
    }
    return { ok: true };
  };
  const root = new FakeElement('div');
  const cleanup = authScreen.renderAuthTokenStatus(root, { accountId: 'account-1', embedded: false });
  await flushAsync();

  const rows = findByClass(root, 'auth-status-rows');
  assert.ok(rows, '계좌 상태 행 묶음이 있다');
  const accRow = rows.children.find((child) => child.classList.contains('is-clickable'));
  assert.ok(accRow, '계좌 행이 클릭 가능하다');
  accRow.click();
  await flushAsync();

  assert.equal(
    containsText(root, '전환하면 지금 토큰을 폐기하고 새 계좌로 다시 발급받습니다. 진행 중인 실시간 구독은 모두 끊겼다가 다시 등록됩니다.'),
    true,
  );
  assert.ok(findByText(root, 'button', '전환하고 다시 인증'));
  assert.equal(findByText(root, 'button', '이전'), null, '온보딩 밖에는 이전이 없다');
  cleanup();
});

test('initialView: switch는 계좌 목록 화면으로 바로 들어간다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'ready', expiresInSec: 3600 };
    if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
    return { ok: true };
  };
  const root = new FakeElement('div');
  const cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'account-1',
    embedded: false,
    initialView: 'switch',
  });
  await flushAsync();

  assert.ok(findByText(root, 'button', '전환하고 다시 인증'), '한 번의 클릭도 없이 전환 화면이 선다');
  assert.equal(containsText(root, '등록된 계좌 1'), true);
  // 늦게 오는 상태 응답이 전환 화면을 상태 화면으로 덮어쓰지 않는다.
  assert.equal(findByText(root, 'button', '지금 재발급'), null);
  cleanup();
});

test('온보딩(embedded)은 initialView를 주지 않아 3 / 3 상태 화면으로 연다', async () => {
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
    onContinue: async () => true,
  });
  await flushAsync();
  assert.equal(containsText(root, '3 / 3'), true);
  assert.ok(findByText(root, 'button', '이전'));
  assert.equal(findByText(root, 'button', '닫기'), null, '온보딩은 [이전]으로 나간다');
  assert.equal(findByText(root, 'button', '전환하고 다시 인증'), null);
  cleanup();
});

// 온보딩 밖에서는 [이전]도 [계속]도 없다 — 나가는 문이 화면에 보여야 한다.
// 없으면 사이드바 → 계좌 전환 → 취소 두 클릭으로 사람이 오버레이에 갇힌다.

test('embedded=false 상태 화면에는 오버레이를 닫는 「닫기」가 있다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'ready', expiresInSec: 3600 };
    if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
    return { ok: true };
  };
  const root = new FakeElement('div');
  let closed = 0;
  const cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'account-1',
    embedded: false,
    onClose: () => { closed += 1; },
  });
  await flushAsync();

  const closeBtn = findByText(root, 'button', '닫기');
  assert.ok(closeBtn, '상태 화면에 보이는 출구가 있다');
  closeBtn.click();
  assert.equal(closed, 1);
  cleanup();
});

test('계좌 전환의 「취소」는 상태 화면이 아니라 오버레이를 닫는다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'ready', expiresInSec: 3600 };
    if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
    return { ok: true };
  };
  const root = new FakeElement('div');
  let closed = 0;
  const cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'account-1',
    embedded: false,
    initialView: 'switch',
    onClose: () => { closed += 1; },
  });
  await flushAsync();

  const cancel = findByText(root, 'button', '취소');
  assert.ok(cancel, '전환 화면에 취소가 있다');
  cancel.click();
  await flushAsync();
  assert.equal(closed, 1, '취소는 닫는다 — 상태 화면으로 갈아타지 않는다');
  assert.equal(findByText(root, 'button', '지금 재발급'), null);
  cleanup();
});

test('온보딩(embedded)에서는 onClose를 줘도 취소가 상태 화면으로 돌아간다', async () => {
  invokeImpl = async (channel) => {
    if (channel === 'athena:auth-token-status') return { state: 'ready', expiresInSec: 3600 };
    if (channel === 'athena:account-list') return { accounts: [{ id: 'account-1', alias: '모의-1' }] };
    return { ok: true };
  };
  const root = new FakeElement('div');
  let closed = 0;
  const cleanup = authScreen.renderAuthTokenStatus(root, {
    accountId: 'account-1',
    embedded: true,
    onBack: () => {},
    onContinue: async () => true,
    onClose: () => { closed += 1; },
  });
  await flushAsync();
  const rows = findByClass(root, 'auth-status-rows');
  const accRow = rows.children.find((child) => child.classList.contains('is-clickable'));
  accRow.click();
  await flushAsync();
  findByText(root, 'button', '취소').click();
  await flushAsync();
  assert.equal(closed, 0, '온보딩 오버레이는 이 콜백으로 닫히지 않는다');
  assert.ok(findByText(root, 'button', '이전'), '3 / 3 상태 화면으로 돌아온다');
  cleanup();
});
