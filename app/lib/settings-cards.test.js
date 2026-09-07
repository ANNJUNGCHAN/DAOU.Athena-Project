'use strict';

// 그래프 수집·노출 설정의 로컬 저장 왕복과 계좌 등록 시트의 상태·렌더링을 검증한다.
// 화면의 실제 가시성은 Paper Electron 게이트가 별도로 잰다.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const settingsCards = require('./settings-cards');

function loadPreloadBridge(invoke) {
  let bridge;
  const originalLoad = Module._load;
  Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'athena');
            bridge = value;
          },
        },
        ipcRenderer: {
          invoke,
          send() {},
          on() {},
          removeListener() {},
        },
        webFrame: { getZoomFactor: () => 1 },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const preloadPath = require.resolve('../preload');
    delete require.cache[preloadPath];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
  }
  return bridge;
}

function fakeStorage(initial) {
  const map = new Map(initial ? [['athena.graphSettings.prefs', initial]] : []);
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    _dump: () => map.get('athena.graphSettings.prefs'),
  };
}

// ---- 모델 카드 계정 카드 부제 (Paper 화면 18, 2026-09-05) — 순수 문자열 조합만 잰다 ----
test('accountSubline: 출처 · 추가 시각 · 비활성이면 전환 안내 순으로 잇는다', () => {
  const inactive = settingsCards.accountSubline({ addedAt: '2026-08-08T08:45:00.000Z', active: false }, '이전 CLI 로그인');
  assert.match(inactive, /^이전 CLI 로그인 · \d+월 \d+일 (오전|오후) \d+:\d\d 추가 · 누르면 활성으로 전환$/);
  const active = settingsCards.accountSubline({ addedAt: '2026-08-10T07:49:00.000Z', active: true }, '현재 CLI 로그인');
  assert.match(active, /^현재 CLI 로그인 · \d+월 \d+일 (오전|오후) \d+:\d\d 추가$/);
});

test('accountSubline: addedAt이 없거나 깨졌으면 날짜 조각을 뺀다', () => {
  assert.equal(settingsCards.accountSubline({ addedAt: null, active: true }, 'Athena 전용 로그인'), 'Athena 전용 로그인');
  assert.equal(settingsCards.accountSubline({ addedAt: 'old', active: false }, '이전 CLI 로그인'), '이전 CLI 로그인 · 누르면 활성으로 전환');
  assert.equal(settingsCards.formatAddedAt('old'), null);
  assert.equal(settingsCards.formatAddedAt(undefined), null);
});

test('저장소가 비어 있으면 기본값(전부 켜짐)', () => {
  assert.deepEqual(settingsCards.readGraphSettings(fakeStorage()), settingsCards.GRAPH_SETTINGS_DEFAULTS);
});

test('저장소가 아예 없어도 터지지 않는다', () => {
  assert.deepEqual(settingsCards.readGraphSettings(null), { ...settingsCards.GRAPH_SETTINGS_DEFAULTS });
});

test('저장한 값이 돌아온다 — 건드리지 않은 키는 유지된다', () => {
  const storage = fakeStorage();
  settingsCards.writeGraphSettings({ collectFills: false }, storage);
  const read = settingsCards.readGraphSettings(storage);
  assert.equal(read.collectFills, false);
  assert.equal(read.collectChat, true);
  assert.equal(read.collectHoldings, true);
  assert.equal(read.exposeToModel, true);
});

test('깨진 JSON은 기본값으로 물러선다 — 지우지 않는다', () => {
  const storage = fakeStorage('{not json at all');
  assert.deepEqual(settingsCards.readGraphSettings(storage), settingsCards.GRAPH_SETTINGS_DEFAULTS);
  assert.equal(storage._dump(), '{not json at all');
});

test('불리언이 아닌 값은 기본값으로 대체된다', () => {
  const normalized = settingsCards.normalizeGraphSettings({ exposeToModel: 'yes', collectChat: 0 });
  assert.equal(normalized.exposeToModel, true);
  assert.equal(normalized.collectChat, true);
});

test('저장이 실패해도 이번 세션 값은 돌려준다', () => {
  // 사생활 모드·용량 초과에서 setItem이 던진다. 화면을 막을 이유는 아니다
  // (graph-mode-prefs.js와 같은 판단).
  const hostile = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const next = settingsCards.writeGraphSettings({ exposeToModel: false }, hostile);
  assert.equal(next.exposeToModel, false);
});

test('exposeToModel이 그래프 탭 배지의 켜짐/꺼짐을 정한다', () => {
  const storage = fakeStorage();
  settingsCards.writeGraphSettings({ exposeToModel: true }, storage);
  assert.equal(settingsCards.readGraphSettings(storage).exposeToModel, true);
  settingsCards.writeGraphSettings({ exposeToModel: false }, storage);
  assert.equal(settingsCards.readGraphSettings(storage).exposeToModel, false);
});

test('보유잔고 조회 주기 기본값은 60분', () => {
  assert.equal(settingsCards.GRAPH_SETTINGS_DEFAULTS.holdingsIntervalMin, 60);
  assert.deepEqual([...settingsCards.HOLDINGS_INTERVAL_MINUTES], [30, 60, 120]);
});

test('조회 주기를 30분·120분으로 바꿔 저장하고 되읽는다', () => {
  const storage = fakeStorage();
  settingsCards.writeGraphSettings({ holdingsIntervalMin: 30 }, storage);
  assert.equal(settingsCards.readGraphSettings(storage).holdingsIntervalMin, 30);
  settingsCards.writeGraphSettings({ holdingsIntervalMin: 120 }, storage);
  assert.equal(settingsCards.readGraphSettings(storage).holdingsIntervalMin, 120);
});

test('허용되지 않은 조회 주기 값은 기본값(60분)으로 물러선다', () => {
  const normalized = settingsCards.normalizeGraphSettings({ holdingsIntervalMin: 45 });
  assert.equal(normalized.holdingsIntervalMin, 60);
  const missing = settingsCards.normalizeGraphSettings({});
  assert.equal(missing.holdingsIntervalMin, 60);
});

// WP-D1 — collectChat은 main 프로세스(history-sink.js)가 실제로 저장을
// 게이팅하므로 main 성공을 확인한 뒤에만 localStorage를 갱신한다.
test('collectChat 변경은 main 성공 응답 뒤에만 로컬 상태를 저장한다', async () => {
  const storage = fakeStorage();
  const calls = [];
  global.window = { athena: { invoke: (channel, patch) => { calls.push([channel, patch]); return Promise.resolve(); } } };
  try {
    global.window.athena.invoke = (channel, patch) => {
      calls.push([channel, patch]);
      return Promise.resolve({ collectChat: false });
    };
    const next = await settingsCards.setCollectChatPreference(false, storage);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['athena:settings:prefs:set', { collectChat: false }]);
    assert.equal(next.collectChat, false);
    assert.equal(settingsCards.readGraphSettings(storage).collectChat, false);
  } finally {
    delete global.window;
  }
});

test('collectChat이 아닌 패치(collectFills 등)는 main에 미러링하지 않는다', () => {
  const storage = fakeStorage();
  const calls = [];
  global.window = { athena: { invoke: (channel, patch) => { calls.push([channel, patch]); return Promise.resolve(); } } };
  try {
    settingsCards.writeGraphSettings({ collectFills: false }, storage);
    assert.equal(calls.length, 0);
  } finally {
    delete global.window;
  }
});

test('collectChat 재활성화 실패는 로컬 상태를 OFF로 복원하고 사람이 읽을 오류를 낸다', async () => {
  const storage = fakeStorage(JSON.stringify({ ...settingsCards.GRAPH_SETTINGS_DEFAULTS, collectChat: false }));
  global.window = { athena: { invoke: () => Promise.reject(new Error('disk locked')) } };
  try {
    await assert.rejects(
      settingsCards.setCollectChatPreference(true, storage),
      /대화 이력 수집을 켜지 못했습니다.*OFF/,
    );
    assert.equal(settingsCards.readGraphSettings(storage).collectChat, false);
  } finally {
    delete global.window;
  }
});

test('collectChat 비활성화 purge 실패는 메인의 정제 오류를 그대로 던지고 로컬을 OFF로 남긴다', async () => {
  const storage = fakeStorage(JSON.stringify({ ...settingsCards.GRAPH_SETTINGS_DEFAULTS, collectChat: true }));
  const mainError = new Error('대화 이력 수집은 OFF로 유지됐지만 남은 원문을 삭제하지 못했습니다.');
  global.window = { athena: { invoke: () => Promise.reject(mainError) } };
  try {
    await assert.rejects(
      settingsCards.setCollectChatPreference(false, storage),
      (error) => error === mainError,
    );
    assert.equal(settingsCards.readGraphSettings(storage).collectChat, false);
  } finally {
    delete global.window;
  }
});

// WP-I I4 — exposeToModel은 전용 채널로 미러링된다(main이 prefs 영속과 backend
// 게이트 POST를 한 번에 처리한다).
test('exposeToModel 패치는 전용 채널로 main에 미러링된다', () => {
  const storage = fakeStorage();
  const calls = [];
  global.window = { athena: { invoke: (channel, patch) => { calls.push([channel, patch]); return Promise.resolve(); } } };
  try {
    settingsCards.writeGraphSettings({ exposeToModel: false }, storage);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['athena:settings:expose-to-model:set', { enabled: false }]);
  } finally {
    delete global.window;
  }
});

// ---- Paper 보드 32 「설정 — 성향·이력」 (화면 P1 항목 1) ----
// 카드가 그릴 행만 순수 함수로 잰다 — DOM은 verify-settings-cards.js가 본다.
// 보드가 그린 수치(128건 · 42MB · 90일)는 목업이다. 백엔드가 주지 않는 행은
// 만들지 않는다 — 빈 자리는 정직하고, 지어낸 숫자는 거짓말이다.
test('성향·이력 카드는 백엔드가 준 값만 행으로 만든다 — 없는 값은 행이 없다', () => {
  const model = settingsCards.buildHistoryCardModel({});
  assert.deepEqual(model.profileRows, []);
  assert.deepEqual(model.storageRows, []);
});

test('학습된 관심 대상이 오면 Paper 라벨 그대로 한 행이 된다 — 중복은 접는다', () => {
  const model = settingsCards.buildHistoryCardModel({
    profileEntries: [
      { entity_name: '지수 ETF' },
      { entity_name: '반도체' },
      { entity_name: '지수 ETF' },
      { entity_name: '  ' },
      {},
    ],
  });
  assert.deepEqual(model.profileRows, [['주요 관심', '지수 ETF · 반도체']]);
});

// 「성향 반영」은 학습값이 아니라 사람이 켜고 끈 설정이다 — 성향이 아직 없어도
// 이 행은 사실이고, 같은 값을 설정 nav 배지가 읽는다. Paper가 적은 「답변 어조에만
// 사용」은 실제로 넘기는 것(보유 종목·수량·대화 원문)을 축소해 말하므로 안 쓴다.
test('노출 설정이 오면 Paper 32 「성향 반영」 행이 사실대로 선다', () => {
  assert.deepEqual(
    settingsCards.buildHistoryCardModel({ exposeToModel: true }).preferenceRows,
    [['성향 반영', '켜짐 · 보유 종목·수량과 대화 원문 전달']],
  );
  assert.deepEqual(
    settingsCards.buildHistoryCardModel({ exposeToModel: false }).preferenceRows,
    [['성향 반영', '꺼짐']],
  );
  assert.deepEqual(settingsCards.buildHistoryCardModel({}).preferenceRows, []);
});

test('보관 건수가 오면 「보관 중」 행이 선다 — 용량·보존 기간은 출처가 없어 안 그린다', () => {
  const model = settingsCards.buildHistoryCardModel({ conversationCount: 12 });
  assert.deepEqual(model.storageRows, [['보관 중', '대화 12건']]);
});

test('건수를 못 읽으면 「보관 중」 행 자체가 없다 — 0건이라고 말하지 않는다', () => {
  assert.deepEqual(settingsCards.buildHistoryCardModel({ conversationCount: null }).storageRows, []);
  assert.deepEqual(settingsCards.buildHistoryCardModel({ conversationCount: '12' }).storageRows, []);
  assert.deepEqual(settingsCards.buildHistoryCardModel({ conversationCount: -1 }).storageRows, []);
});

// ---- 화면 P1 항목 11 (Paper 11D-0/11Q-0) — 흰 시트 위의 다크 잔재 색 ----
// settings-cards.js가 그리는 DOM은 Electron 게이트가 보고, 여기서는 CSS 파일을
// 읽어 색 토큰만 못박는다(controller.test.js가 쓰는 것과 같은 문법).
test('열리지 않는 것 제목은 토큰 색을 쓴다 — 다크 잔재 하드코딩이 없다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'settings-cards.css'), 'utf8');
  const rule = css.slice(css.indexOf('.uk-closed-title'), css.indexOf('.uk-closed-desc'));
  assert.doesNotMatch(rule, /#F2F4F8/i);
  assert.match(rule, /color: var\(--color-k-text\)/);
});

test('settings-cards.css 어디에도 #F2F4F8 하드코딩이 없다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'settings-cards.css'), 'utf8');
  assert.doesNotMatch(css, /#F2F4F8/i);
});

// ---- 화면 P1 항목 4 (Paper XI-0 · FLM-0 · FPE-0) — 계좌 등록 3상태 ----
// 상태 머신과 실제 계좌 카드의 등록 클릭 → IPC 대기 → 결과 전환을 함께 잰다.
const { accountSheetState } = settingsCards;
const verifying = () => accountSheetState(accountSheetState(null, { type: 'open' }), { type: 'verify' });

test('확인 중에는 입력 셋이 잠기고 버튼 라벨이 확인 중…이다', () => {
  const state = verifying();
  assert.equal(state.inputsDisabled, true);
  assert.equal(state.submitLabel, '확인 중…');
  assert.equal(state.submitDisabled, true);
  assert.equal(state.hint, '토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다');
  assert.equal(state.verificationNote, 'APP KEY와 SECRET KEY로 계좌 연결 권한을 확인하고 있습니다');
  assert.equal(state.wipeInputs, false);
  assert.equal(state.closeSheet, false);
});

// 이 파일의 시트 렌더링에 필요한 DOM만 제공한다. ui-kit과 계좌 카드/시트는
// 실구현을 쓰고, 외부 IPC 응답만 테스트가 결정한다(실계좌 키나 백엔드 불필요).
function sheetNode(tag) {
  let text = '';
  const node = {
    tag, className: '', children: [], parentNode: null, value: '', hidden: false, disabled: false,
    listeners: {},
    get textContent() { return text + this.children.map((child) => child.textContent).join(''); },
    set textContent(value) { this.replaceChildren(); text = String(value); },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    replaceChildren() { text = ''; this.children.forEach((child) => { child.parentNode = null; }); this.children = []; },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
    setAttribute() {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    click() { if (!this.disabled) return this.listeners.click?.(); },
    focus() {},
    querySelector(selector) {
      return sheetDescendants(this).find((child) => selector.split('.').filter(Boolean)
        .every((name) => child.className.split(/\s+/).includes(name))) || null;
    },
  };
  node.classList = {
    add(name) { this.toggle(name, true); },
    remove(name) { this.toggle(name, false); },
    toggle(name, on) {
      const classes = new Set(node.className.split(/\s+/).filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      node.className = [...classes].join(' ');
    },
  };
  return node;
}

function sheetDescendants(node) {
  return node.children.flatMap((child) => [child, ...sheetDescendants(child)]);
}

async function renderRegisterSheet(t) {
  let resolveRegister;
  const registrations = [];
  let lists = 0;
  const priorDocument = global.document;
  const priorWindow = global.window;
  global.document = { createElement: sheetNode };
  global.window = { athena: { invoke(channel, payload) {
    if (channel === 'athena:account-list') { lists += 1; return Promise.resolve({ accounts: [] }); }
    if (channel === 'athena:account-runtime-options') return Promise.resolve({ ok: true, aliases: ['server-a'] });
    assert.equal(channel, 'athena:account-register');
    registrations.push(payload);
    return new Promise((resolve) => { resolveRegister = resolve; });
  } } };
  t.after(() => {
    if (priorDocument === undefined) delete global.document; else global.document = priorDocument;
    if (priorWindow === undefined) delete global.window; else global.window = priorWindow;
  });
  const grid = sheetNode('div');
  await settingsCards.renderAccounts(grid);
  grid.querySelector('.uk-btn-ghost').click();
  const sheet = grid.querySelector('.uk-sheet');
  const inputs = sheetDescendants(sheet).filter((node) => node.tag === 'input');
  inputs.forEach((input, index) => { input.value = ['모의-검증', 'TEST_APP_KEY', 'TEST_SECRET_KEY'][index]; });
  return {
    grid, sheet, inputs, registrations,
    submit: sheet.querySelector('.uk-btn-primary'),
    resolve: (result) => resolveRegister(result),
    listCount: () => lists,
  };
}

test('등록 시트는 검증 IPC 대기 중 Paper의 상태 줄과 설명 줄을 별도로 표시한다', async (t) => {
  const { sheet, inputs, submit, resolve, registrations } = await renderRegisterSheet(t);
  const explanation = 'APP KEY와 SECRET KEY로 계좌 연결 권한을 확인하고 있습니다';
  assert.equal(sheet.textContent.includes(explanation), false, '입력 단계에는 확인 중 설명이 없어야 한다');
  const pending = submit.click();
  const status = sheet.querySelector('.uk-status-text');
  assert.equal(status.textContent, '토큰 발급 확인 중… 입력과 저장이 잠시 잠깁니다');
  const detail = sheetDescendants(sheet).find((node) => node.children.length === 0 && node.textContent === explanation);
  assert.ok(detail, 'Paper XI-0 114-0의 설명 줄이 실제 시트에 표시되어야 한다');
  assert.notEqual(detail.parentNode, status.parentNode, '설명은 상태 행 아래의 별도 줄이다');
  assert.ok(sheetDescendants(sheet).indexOf(detail) > sheetDescendants(sheet).indexOf(status));
  assert.deepEqual(inputs.map((input) => input.disabled), [true, true, true]);
  assert.equal(submit.disabled, true);
  assert.equal(submit.textContent, '확인 중…');
  assert.equal(registrations[0].verifyOnly, true);
  resolve({ ok: false, error: 'auth' });
  await pending;
  assert.equal(sheet.textContent.includes(explanation), false, '실패 후에는 확인 중 설명을 제거한다');
  assert.equal(submit.textContent, '다시 검증');
  assert.deepEqual(inputs.map((input) => input.disabled), [false, false, false]);
  assert.deepEqual(inputs.map((input) => input.value), ['모의-검증', 'TEST_APP_KEY', 'TEST_SECRET_KEY']);
});

test('확인 중 시트를 취소하면 실제 입력을 비우고 시트를 닫는다', async (t) => {
  const cancelled = await renderRegisterSheet(t);
  const pendingCancel = cancelled.submit.click();
  cancelled.sheet.querySelector('.uk-btn-ghost').click();
  assert.equal(cancelled.grid.querySelector('.uk-sheet'), null);
  assert.deepEqual(cancelled.inputs.map((input) => input.value), ['', '', '']);
  cancelled.resolve({ ok: false, error: 'auth' });
  await pendingCancel;
});

test('등록 시트의 저장 완료는 실제 입력을 비우고 시트를 닫는다', async (t) => {
  const saved = await renderRegisterSheet(t);
  const pendingVerify = saved.submit.click();
  saved.resolve({ ok: true, verified: true });
  await pendingVerify;
  assert.equal(saved.submit.textContent, '계좌 저장');
  assert.equal(saved.sheet.textContent.includes('APP KEY와 SECRET KEY로 계좌 연결 권한을 확인하고 있습니다'), false);
  assert.equal(saved.listCount(), 1, '검증 성공만으로 목록을 새로고침하지 않는다');
  const pendingSave = saved.submit.click();
  assert.equal(saved.submit.disabled, true);
  assert.equal(Object.hasOwn(saved.registrations[1], 'verifyOnly'), false);
  saved.resolve({ ok: true, id: 'test-account' });
  await pendingSave;
  assert.equal(saved.grid.querySelector('.uk-sheet'), null);
  assert.deepEqual(saved.inputs.map((input) => input.value), ['', '', '']);
  assert.equal(saved.listCount(), 2);
});

test('기존 계좌는 서버 계좌를 자동 선택하지 않고 사용자가 고른 alias를 저장·재표시한다', async (t) => {
  const priorDocument = global.document;
  const priorWindow = global.window;
  let backendAlias = '';
  const calls = [];
  global.document = { createElement: sheetNode };
  global.window = { athena: loadPreloadBridge(async (channel, payload) => {
    calls.push([channel, payload]);
    if (channel === 'athena:account-list') {
      return { accounts: [{ id: 'local-a', alias: '내 계좌', backendAlias, active: true }] };
    }
    if (channel === 'athena:account-runtime-options') return { ok: true, aliases: ['server-a', 'server-b'] };
    if (channel === 'athena:account-set-backend-alias') {
      backendAlias = payload.backendAlias;
      return { ok: true, backendAlias };
    }
    throw new Error(`unexpected channel: ${channel}`);
  }) };
  t.after(() => {
    if (priorDocument === undefined) delete global.document; else global.document = priorDocument;
    if (priorWindow === undefined) delete global.window; else global.window = priorWindow;
  });

  const grid = sheetNode('div');
  await settingsCards.renderAccounts(grid);
  const connect = grid.querySelector('.uk-account-backend-button');
  assert.equal(connect.textContent, '서버 계좌 연결');
  connect.click();
  const select = grid.querySelector('.uk-account-backend-select');
  assert.equal(select.value, '', 'backend 기본값이나 첫 option을 자동 선택하지 않는다');
  select.value = 'server-b';
  await grid.querySelector('.uk-account-backend-save').click();
  assert.deepEqual(calls.find(([channel]) => channel === 'athena:account-set-backend-alias'), [
    'athena:account-set-backend-alias',
    { id: 'local-a', backendAlias: 'server-b' },
  ]);
  assert.equal(grid.querySelector('.uk-account-backend-button').textContent, '서버: server-b');
});

test('preload는 계좌 연결 IPC 둘만 main으로 전달하고 미허용 채널은 차단한다', async () => {
  const calls = [];
  const bridge = loadPreloadBridge(async (channel, payload) => {
    calls.push([channel, payload]);
    return { ok: true };
  });
  await bridge.invoke('athena:account-runtime-options');
  await bridge.invoke('athena:account-set-backend-alias', { id: 'local-a', backendAlias: 'server-a' });
  assert.deepEqual(calls, [
    ['athena:account-runtime-options', undefined],
    ['athena:account-set-backend-alias', { id: 'local-a', backendAlias: 'server-a' }],
  ]);
  await assert.rejects(
    bridge.invoke('athena:account-unknown', {}),
    /허용되지 않은 invoke 채널/,
  );
  assert.equal(calls.length, 2);
});

test('서버 계좌 metadata를 읽지 못하면 연결 control은 비활성이고 저장 IPC를 호출하지 않는다', async (t) => {
  const priorDocument = global.document;
  const priorWindow = global.window;
  const calls = [];
  global.document = { createElement: sheetNode };
  global.window = { athena: { async invoke(channel, payload) {
    calls.push([channel, payload]);
    if (channel === 'athena:account-list') {
      return { accounts: [{ id: 'local-a', alias: '내 계좌', backendAlias: '', active: true }] };
    }
    if (channel === 'athena:account-runtime-options') {
      return { ok: false, aliases: [], error: '서버 계좌 정보를 확인할 수 없다' };
    }
    throw new Error(`unexpected channel: ${channel}`);
  } } };
  t.after(() => {
    if (priorDocument === undefined) delete global.document; else global.document = priorDocument;
    if (priorWindow === undefined) delete global.window; else global.window = priorWindow;
  });

  const grid = sheetNode('div');
  await settingsCards.renderAccounts(grid);
  const connect = grid.querySelector('.uk-account-backend-button');
  assert.equal(connect.disabled, true);
  assert.match(connect.title, /확인할 수 없다/);
  connect.click();
  assert.equal(grid.querySelector('.uk-sheet'), null);
  assert.equal(calls.some(([channel]) => channel === 'athena:account-set-backend-alias'), false);
});

test('인증 실패는 입력을 비우지 않는다 — 다시 검증이 가능하다', () => {
  const state = accountSheetState(verifying(), { type: 'verify-failed', error: 'auth' });
  assert.equal(state.wipeInputs, false);
  assert.equal(state.closeSheet, false);
  assert.equal(state.inputsDisabled, false);
  assert.equal(state.submitDisabled, false);
  assert.equal(state.submitLabel, '다시 검증');
  assert.ok(state.hint.startsWith('검증에 실패해 저장하지 않았습니다'));
});

test('실패 코드가 auth면 SECRET KEY에 오류 테두리가 붙는다', () => {
  const state = accountSheetState(verifying(), { type: 'verify-failed', error: 'auth' });
  assert.ok(state.errorFields.includes('secretKey'));
  assert.ok(state.errorFields.includes('appKey'));
  assert.equal(state.errorMessage, '인증 실패 — APP KEY 또는 SECRET KEY를 확인해 주세요');
  const network = accountSheetState(verifying(), { type: 'verify-failed', error: 'network' });
  assert.deepEqual(network.errorFields, []);
  assert.equal(network.errorMessage, '네트워크 오류 — 잠시 후 다시 시도한다');
});

test('검증 성공은 시트를 닫지 않고 확인 완료 상태로 간다', () => {
  const state = accountSheetState(verifying(), { type: 'verified' });
  assert.equal(state.closeSheet, false);
  assert.equal(state.wipeInputs, false);
  assert.equal(state.successBox, '확인 완료 — 모의투자 계좌 연결 권한을 확인했습니다');
  assert.equal(state.submitLabel, '계좌 저장');
  assert.equal(state.submitDisabled, false);
  assert.equal(state.inputsDisabled, false);
  assert.equal(state.hint, '확인이 완료되었습니다. 저장하면 OS 자격증명 저장소에 암호화됩니다');
});

test('계좌 저장을 눌러야 시트가 닫히고 그때 입력을 비운다', () => {
  const verified = accountSheetState(verifying(), { type: 'verified' });
  const saving = accountSheetState(verified, { type: 'save' });
  assert.equal(saving.closeSheet, false);
  assert.equal(saving.wipeInputs, false);
  assert.equal(saving.submitDisabled, true);
  assert.equal(saving.inputsDisabled, true);
  assert.equal(saving.successBox, '확인 완료 — 모의투자 계좌 연결 권한을 확인했습니다');
  const saved = accountSheetState(saving, { type: 'saved' });
  assert.equal(saved.closeSheet, true);
  assert.equal(saved.wipeInputs, true);
});

test('취소는 어느 상태에서든 시트를 닫고 값을 비운다', () => {
  for (const prev of [accountSheetState(null, { type: 'open' }), verifying(), accountSheetState(verifying(), { type: 'verified' })]) {
    const state = accountSheetState(prev, { type: 'cancel' });
    assert.equal(state.closeSheet, true);
    assert.equal(state.wipeInputs, true);
  }
});

test('저장 실패는 시트를 닫지 않고 다시 검증으로 되돌린다 — 값은 남는다', () => {
  const verified = accountSheetState(verifying(), { type: 'verified' });
  const state = accountSheetState(accountSheetState(verified, { type: 'save' }), { type: 'save-failed', error: 'network' });
  assert.equal(state.closeSheet, false);
  assert.equal(state.wipeInputs, false);
  assert.equal(state.successBox, null);
  assert.equal(state.submitLabel, '다시 검증');
});

test('여는 상태 문구에 내부용어가 없다', () => {
  const idle = accountSheetState(null, { type: 'open' });
  assert.equal(idle.submitLabel, '검증 후 저장');
  assert.equal(idle.hint, '모의투자 계좌의 APP KEY / SECRET KEY로 연결 권한을 확인합니다');
  assert.equal(idle.successBox, null);
  assert.deepEqual(idle.errorFields, []);
});

// 시트 DOM은 Electron 게이트가 보지만, 비밀값 규율 두 가지는 소스로 못박는다 —
// 게이트는 실계좌 키가 없어 실패 경로를 밟지 못한다.
test('검증은 verifyOnly로, 저장은 그 없이 같은 채널을 부른다', () => {
  const src = fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8');
  const sheet = src.slice(src.indexOf('function openAccountRegisterSheet'), src.indexOf('function openOrderApiSheet'));
  assert.match(sheet, /callRegister\(\{ \.\.\.input, verifyOnly: true \}\)/);
  assert.match(sheet, /const \{ res, missingHandler \} = await callRegister\(input\);/);
  assert.equal(sheet.match(/window\.athena\.invoke\('athena:account-register'/g).length, 1);
});

test('입력을 비우는 곳은 applyState 하나뿐이다 — 닫히는 길은 전부 거기를 지난다', () => {
  const src = fs.readFileSync(path.join(__dirname, 'settings-cards.js'), 'utf8');
  const sheet = src.slice(src.indexOf('function openAccountRegisterSheet'), src.indexOf('function openOrderApiSheet'));
  assert.equal(sheet.match(/wipeSecretInputs\(\)/g).length, 2); // 정의 1 + applyState 호출 1
  assert.match(sheet, /if \(next\.wipeInputs\) wipeSecretInputs\(\);\n\s*if \(next\.closeSheet\) detachSheet\(card, root\);/);
  assert.equal(sheet.match(/detachSheet\(card, root\)/g).length, 1);
});
