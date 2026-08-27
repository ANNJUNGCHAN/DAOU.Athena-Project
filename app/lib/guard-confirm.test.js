// guard-confirm.js 단위 테스트 — 순수 함수라 DOM 스텁이 전혀 필요 없다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  guardValueText, mergeGuardSettings, diffGuardFields, guardConfirmBodyText, guardConfirmRationale,
} = require('./guard-confirm');

function settings(overrides) {
  return {
    max_daily_nudges: 2,
    quiet_hours: { start: '22:00', end: '07:00' },
    show_rationale: true,
    learn_from_dismissals: true,
    ...overrides,
  };
}

test('guardValueText: 4필드 각각 사람이 읽는 문구로 바꾼다', () => {
  const s = settings();
  assert.equal(guardValueText('max_daily_nudges', s), '2회');
  assert.equal(guardValueText('quiet_hours', s), '22:00–07:00');
  assert.equal(guardValueText('show_rationale', s), '항상');
  assert.equal(guardValueText('learn_from_dismissals', s), '켬');
});

test('guardValueText: 꺼진 값은 "끔"으로 정확히 반영한다(지어내지 않는다)', () => {
  const s = settings({ show_rationale: false, learn_from_dismissals: false });
  assert.equal(guardValueText('show_rationale', s), '끔');
  assert.equal(guardValueText('learn_from_dismissals', s), '끔');
});

test('mergeGuardSettings: proposed가 채운 필드만 덮어쓰고 나머지는 current를 유지한다', () => {
  const current = settings();
  const merged = mergeGuardSettings(current, { max_daily_nudges: 1 });
  assert.equal(merged.max_daily_nudges, 1);
  assert.equal(merged.show_rationale, true);
  assert.equal(merged.learn_from_dismissals, true);
});

test('mergeGuardSettings: quiet_hours는 필드별로 병합한다 — start만 바뀌어도 end가 안 날아간다', () => {
  const current = settings();
  const merged = mergeGuardSettings(current, { quiet_hours: { start: '23:00' } });
  assert.equal(merged.quiet_hours.start, '23:00');
  assert.equal(merged.quiet_hours.end, '07:00');
});

test('diffGuardFields: proposed에 없는 필드는 바뀌지 않았으므로 목록에서 빠진다', () => {
  const current = settings();
  const changes = diffGuardFields(current, { max_daily_nudges: 1 });
  assert.deepEqual(changes.map((c) => c.key), ['max_daily_nudges']);
});

test('diffGuardFields: proposed에 있어도 값이 실제로 같으면(재확인) 목록에서 빠진다', () => {
  const current = settings();
  const changes = diffGuardFields(current, { max_daily_nudges: 2 }); // 이미 2회 — 안 바뀜
  assert.deepEqual(changes, []);
});

test('diffGuardFields: 여러 필드가 동시에 바뀌면 전부 담는다', () => {
  const current = settings();
  const changes = diffGuardFields(current, { max_daily_nudges: 1, show_rationale: false });
  assert.deepEqual(changes.map((c) => c.key).sort(), ['max_daily_nudges', 'show_rationale']);
});

test('guardConfirmBodyText: 필드 1개 변경 — "라벨 현재값 → 제안값로 바꿀까요?"', () => {
  const current = settings();
  assert.equal(guardConfirmBodyText(current, { max_daily_nudges: 1 }), '하루 최대 2회 → 1회로 바꿀까요?');
});

test('guardConfirmBodyText: 필드 2개 변경 — " · "로 이어붙인다', () => {
  const current = settings();
  const text = guardConfirmBodyText(current, { max_daily_nudges: 1, show_rationale: false });
  assert.equal(text, '하루 최대 2회 → 1회 · 근거 표시 항상 → 끔로 바꿀까요?');
});

test('guardConfirmBodyText: 실제로 값이 안 바뀌면 정직하게 "바뀌는 게 없다"고 말한다(P3)', () => {
  const current = settings();
  assert.equal(guardConfirmBodyText(current, { max_daily_nudges: 2 }), '지금 값과 같습니다 — 바뀌는 게 없습니다.');
  assert.equal(guardConfirmBodyText(current, {}), '지금 값과 같습니다 — 바뀌는 게 없습니다.');
});

test('guardConfirmRationale: 이 턴을 촉발한 사용자 문구를 그대로 인용한다(지어낸 통계 없음, P3)', () => {
  assert.equal(guardConfirmRationale('이런 말 줄여줘'), '근거: "이런 말 줄여줘"');
});

test('guardConfirmRationale: 40자를 넘으면 잘라서 말줄임표를 붙인다', () => {
  const long = '가'.repeat(50);
  const result = guardConfirmRationale(long);
  assert.equal(result, `근거: "${'가'.repeat(40)}…"`);
});

test('guardConfirmRationale: 문구가 없으면 정직한 대체 문구를 쓴다(빈 인용부호를 보여주지 않는다)', () => {
  assert.equal(guardConfirmRationale(''), '근거: 이 대화에서 방금 나온 제안입니다');
  assert.equal(guardConfirmRationale(null), '근거: 이 대화에서 방금 나온 제안입니다');
  assert.equal(guardConfirmRationale(undefined), '근거: 이 대화에서 방금 나온 제안입니다');
});
