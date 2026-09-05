'use strict';

// 그래프 수집·노출 설정(Paper 보드 22 복원) — 로컬 저장 왕복만 검증한다. DOM을
// 그리는 나머지 settings-cards.js 표면은 verify-settings-cards.js(Electron)가
// 실사용 경로로 검증한다 — 이 파일과 같은 이유로 graph-mode-prefs.test.js도
// 순수 로직만 node --test로 잰다.

const test = require('node:test');
const assert = require('node:assert/strict');

const settingsCards = require('./settings-cards');

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

test('collectChat 비활성화 purge 실패는 메인의 정제 오류를 보존해 삭제 전용 안내를 표시한다', async () => {
  const storage = fakeStorage(JSON.stringify({ ...settingsCards.GRAPH_SETTINGS_DEFAULTS, collectChat: true }));
  const mainError = new Error('대화 이력 수집은 OFF로 유지됐지만 남은 원문을 삭제하지 못했습니다.');
  global.window = { athena: { invoke: () => Promise.reject(mainError) } };
  try {
    let renderedMessage = '';
    await assert.rejects(
      settingsCards.setCollectChatPreference(false, storage).catch((error) => {
        renderedMessage = settingsCards.collectChatPreferenceErrorMessage(error);
        throw error;
      }),
      (error) => error === mainError,
    );
    assert.equal(
      renderedMessage,
      '대화 이력 수집은 OFF지만 남아 있던 원문을 삭제하지 못했습니다. 저장소 상태를 확인해 주세요.',
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
