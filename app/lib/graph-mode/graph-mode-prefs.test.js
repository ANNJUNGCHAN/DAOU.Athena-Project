'use strict';

// 그래프 모드 설정 — 손상된 값에도 화면이 열려야 한다.
//
// 설정 하나가 깨졌다고 그래프 화면이 통째로 안 열리면 사용자는 되돌릴 방법이 없다.
// 설정 화면도 같은 앱 안에 있기 때문이다.

const test = require('node:test');
const assert = require('node:assert/strict');

const prefs = require('./graph-mode-prefs');

function fakeStorage(initial) {
  const map = new Map(initial ? [[prefs.STORAGE_KEY, initial]] : []);
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    _dump: () => map.get(prefs.STORAGE_KEY),
  };
}

test('저장소가 비어 있으면 기본값', () => {
  assert.deepEqual(prefs.readPrefs(fakeStorage()), prefs.DEFAULTS);
});

test('저장소가 아예 없어도 터지지 않는다', () => {
  assert.deepEqual(prefs.readPrefs(null), { ...prefs.DEFAULTS });
});

test('저장한 값이 돌아온다', () => {
  const storage = fakeStorage();
  prefs.writePrefs({ defaultView: 'graph', labelThreshold: 12 }, storage);
  const read = prefs.readPrefs(storage);
  assert.equal(read.defaultView, 'graph');
  assert.equal(read.labelThreshold, 12);
  assert.equal(read.highlightCrossings, true, '건드리지 않은 값은 유지된다');
});

test('깨진 JSON은 기본값으로 물러선다', () => {
  const storage = fakeStorage('{not json at all');
  assert.deepEqual(prefs.readPrefs(storage), prefs.DEFAULTS);
  // 지우지 않는다 — 사용자가 손으로 고칠 수 있게 남겨둔다.
  assert.equal(storage._dump(), '{not json at all');
});

test('모르는 화면 이름은 거부된다', () => {
  const storage = fakeStorage(JSON.stringify({ defaultView: 'wormhole' }));
  assert.equal(prefs.readPrefs(storage).defaultView, 'summary');
  assert.deepEqual(prefs.VALID_VIEWS, ['summary', 'graph']);
});

test('이름표 임계가 범위 안으로 접힌다', () => {
  for (const [input, expected] of [
    [-10, 0],
    [0, 0],
    [10_000, 500],
    ['25', 25],
    [12.6, 13],
    [NaN, prefs.DEFAULTS.labelThreshold],
    ['많이', prefs.DEFAULTS.labelThreshold],
  ]) {
    assert.equal(prefs.normalize({ labelThreshold: input }).labelThreshold, expected, String(input));
  }
});

test('불리언이 아닌 강조 설정은 기본값', () => {
  assert.equal(prefs.normalize({ highlightCrossings: 'yes' }).highlightCrossings, true);
  assert.equal(prefs.normalize({ highlightCrossings: false }).highlightCrossings, false);
});

test('저장이 실패해도 이번 세션 값은 돌려준다', () => {
  // 사생활 모드·용량 초과에서 setItem이 던진다. 화면을 막을 이유는 아니다.
  const hostile = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  const next = prefs.writePrefs({ defaultView: 'graph' }, hostile);
  assert.equal(next.defaultView, 'graph');
});

test('이름표는 노드가 임계 이하일 때만 붙는다', () => {
  const settings = prefs.normalize({ labelThreshold: 40 });
  assert.equal(prefs.shouldShowLabels(settings, 40), true);
  assert.equal(prefs.shouldShowLabels(settings, 41), false);
  assert.equal(prefs.shouldShowLabels(settings, 0), true);
  // 설정이 손상돼도 판단은 나온다.
  assert.equal(typeof prefs.shouldShowLabels(null, 5), 'boolean');
});
