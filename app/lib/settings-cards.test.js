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
// 게이팅하는 유일한 그래프 설정이라 localStorage 왕복 외에 athena:settings:prefs:set
// IPC로도 미러링된다. 이 파일은 순수 node --test라 window가 없다 — 여기서만 흉내낸다.
test('collectChat 패치는 window.athena.invoke로 main 프로세스에도 미러링된다', () => {
  const storage = fakeStorage();
  const calls = [];
  global.window = { athena: { invoke: (channel, patch) => { calls.push([channel, patch]); return Promise.resolve(); } } };
  try {
    settingsCards.writeGraphSettings({ collectChat: false }, storage);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['athena:settings:prefs:set', { collectChat: false }]);
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

test('window.athena가 없어도(핸들러 부재) collectChat 저장 자체는 안 터진다', () => {
  const storage = fakeStorage();
  const next = settingsCards.writeGraphSettings({ collectChat: false }, storage);
  assert.equal(next.collectChat, false);
});
