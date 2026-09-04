'use strict';

// 그래프 편집 제안 카드의 순수 로직(2026-09-03). 문구를 여기서 굳힌다 — 화면을 고칠 때
// 답변 문장이 조용히 바뀌면 추출기가 다른 관계를 기록하게 된다.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPS, isOp, normalizeProposal, proposalTitle, proposalContext, proposalSentence, CHOICES,
} = require('./graph-edit-proposal');

// 공통 패널·되물을 것들 카드가 쓰는 사전과 같은 것을 주입한다(controller.js RELATION_LABELS).
const LABELS = { interested_in: '관심', relates_to: '연관', avoids: '회피' };

test('normalizeProposal — 주체가 없으면 투자자 프로필이 암묵 주체다', () => {
  const item = normalizeProposal(
    { op: 'add', object: '헬스케어', relation: 'interested_in' }, LABELS,
  );
  assert.equal(item.subjectImplicit, true);
  assert.equal(item.subject, '');
  assert.equal(item.relationText, '관심');
  assert.equal(item.opLabel, '추가');
  assert.equal(item.reason, null);
});

test('normalizeProposal — 주체를 주면 그대로 남긴다', () => {
  const item = normalizeProposal(
    { op: 'change', subject: '한미반도체', object: '배당 방어 바스켓', relation: 'relates_to' },
    LABELS,
  );
  assert.equal(item.subjectImplicit, false);
  assert.equal(item.subject, '한미반도체');
  assert.equal(item.relationText, '연관');
});

test('normalizeProposal — 사전에 없는 관계는 원문 그대로 둔다(지어내지 않는다)', () => {
  const item = normalizeProposal(
    { op: 'add', object: 'x', relation: 'brand_new' }, LABELS,
  );
  assert.equal(item.relationText, 'brand_new');
});

test('normalizeProposal — 사전을 안 주거나 이상해도 던지지 않는다', () => {
  for (const dict of [undefined, null, 'x', 0]) {
    const item = normalizeProposal({ op: 'add', object: 'x', relation: 'avoids' }, dict);
    assert.equal(item.relationText, 'avoids', '사전이 없으면 원문이다');
  }
});

test('normalizeProposal — 못 쓸 제안은 null이다(빈 카드를 띄우지 않는다)', () => {
  const bad = [
    null, undefined, 'remove', 7, [],
    {},
    { op: 'add' },
    { op: '지우기', object: 'x', relation: 'y' },
    { op: 'add', object: '', relation: 'y' },
    { op: 'add', object: 'x', relation: '   ' },
    { op: 'add', object: 'x' },
    { op: 'remove', relation: 'y' },
  ];
  for (const message of bad) {
    assert.equal(normalizeProposal(message, LABELS), null, JSON.stringify(message));
  }
});

test('normalizeProposal — 앞뒤 공백은 접는다', () => {
  const item = normalizeProposal(
    { op: 'remove', subject: '  한미반도체 ', object: ' 배당 ', relation: ' avoids ', reason: '  ' },
    LABELS,
  );
  assert.equal(item.subject, '한미반도체');
  assert.equal(item.object, '배당');
  assert.equal(item.relation, 'avoids');
  assert.equal(item.reason, null, '공백만 있는 근거는 없는 것이다');
});

test('isOp — 백엔드 graph_view_tools._EDIT_OPS와 같은 셋', () => {
  assert.deepEqual(Object.keys(OPS), ['add', 'change', 'remove']);
  assert.equal(isOp('add'), true);
  assert.equal(isOp('write'), false);
  assert.equal(isOp(null), false);
});

test('proposalTitle — op마다 다른 것을 묻는다', () => {
  const base = { object: '헬스케어', relation: 'interested_in' };
  assert.equal(
    proposalTitle(normalizeProposal({ ...base, op: 'add' }, LABELS)),
    '"헬스케어" · \'관심\' 연결을 추가할까요?',
  );
  assert.equal(
    proposalTitle(normalizeProposal({ ...base, op: 'remove' }, LABELS)),
    '"헬스케어" · \'관심\' 연결을 지울까요?',
  );
  assert.equal(
    proposalTitle(normalizeProposal({ ...base, op: 'change' }, LABELS)),
    '"헬스케어" · \'관심\' 연결을 이렇게 고칠까요?',
  );
  assert.equal(proposalTitle(null), '');
});

test('proposalTitle — 주체가 있으면 방향을 적는다', () => {
  const item = normalizeProposal(
    { op: 'remove', subject: '한미반도체', object: '배당 방어 바스켓', relation: 'relates_to' },
    LABELS,
  );
  assert.equal(
    proposalTitle(item),
    '"한미반도체" → "배당 방어 바스켓" · \'연관\' 연결을 지울까요?',
  );
});

test('proposalContext — 근거가 없으면 그 절을 안 붙인다', () => {
  const withReason = normalizeProposal(
    { op: 'remove', object: '2차전지', relation: 'avoids', reason: '3주 전 한 번 언급 후 회피' },
    LABELS,
  );
  assert.equal(proposalContext(withReason), '삭제 제안 — 3주 전 한 번 언급 후 회피');
  const without = normalizeProposal({ op: 'add', object: 'x', relation: 'avoids' }, LABELS);
  assert.equal(proposalContext(without), '추가 제안');
  assert.equal(proposalContext(null), '');
});

test('proposalSentence — 적용은 제안대로 간다', () => {
  const remove = normalizeProposal({ op: 'remove', object: '2차전지', relation: 'avoids' }, LABELS);
  assert.equal(
    proposalSentence(remove, 'apply'),
    '"2차전지" · \'회피\' — 아니야. 그 연결은 지워도 돼.',
  );
  const add = normalizeProposal({ op: 'add', object: '헬스케어', relation: 'interested_in' }, LABELS);
  assert.equal(
    proposalSentence(add, 'apply'),
    '"헬스케어" · \'관심\' — 맞아. 확실한 것으로 봐도 돼.',
  );
});

test('proposalSentence — 거절은 반대 주장이 아니라 현재 상태 유지다', () => {
  // remove를 거절한 것은 "지우지 마"이지 "더 강하게 기록해"가 아니다. 여기서 반대
  // 주장을 보내면 사람이 물린 것을 추출기가 강화로 읽는다.
  const remove = normalizeProposal({ op: 'remove', object: '2차전지', relation: 'avoids' }, LABELS);
  assert.equal(
    proposalSentence(remove, 'reject'),
    '"2차전지" · \'회피\' — 그 연결은 그대로 둬. 지우지 마.',
  );
  const add = normalizeProposal({ op: 'add', object: '헬스케어', relation: 'interested_in' }, LABELS);
  assert.equal(
    proposalSentence(add, 'reject'),
    '"헬스케어" · \'관심\' — 그건 아직 확실하지 않아. 그대로 둬.',
  );
});

test('proposalSentence — 건너뛰기는 아무것도 보내지 않는다(침묵을 답으로 굳히지 않는다)', () => {
  const item = normalizeProposal({ op: 'add', object: 'x', relation: 'avoids' }, LABELS);
  assert.equal(proposalSentence(item, 'skip'), null);
  assert.equal(proposalSentence(item, undefined), null);
  assert.equal(proposalSentence(null, 'apply'), null);
});

test('CHOICES — 되물을 것들 카드와 같은 키 힌트를 쓴다', () => {
  const brainQuestions = require('./brain-questions');
  assert.equal(CHOICES.apply.hint, brainQuestions.CHOICES.yes.hint);
  assert.equal(CHOICES.skip.hint, brainQuestions.CHOICES.skip.hint);
  assert.equal(CHOICES.reject.hint, null, '"아니다"는 오타로 눌리면 안 되므로 단축키가 없다');
  assert.equal(CHOICES.apply.label, '적용');
});

// 즉시 지우기(2026-09-03) — 카드가 relationId를 알면 '적용'이 그래프에서 바로 지운다.
// 모르면 예전 경로(답변 문장 제출 → 수집 때 반영)를 쓴다. 그 갈림을 카드가 스스로
// 판단하므로 이 값이 정규화에서 살아남아야 한다.
test('normalizeProposal — relationId를 싣는다', () => {
  const item = normalizeProposal({
    op: 'remove', object: '삼성화재', relation: 'belongs_to', relationId: 'relation:abc',
  }, { belongs_to: '소속' });
  assert.equal(item.relationId, 'relation:abc');
  assert.equal(item.relationText, '소속');
});

test('normalizeProposal — relationId가 없거나 비면 null이다(예전 경로로 떨어진다)', () => {
  const without = normalizeProposal({ op: 'remove', object: 'x', relation: 'y' });
  assert.equal(without.relationId, null);
  const blank = normalizeProposal({ op: 'remove', object: 'x', relation: 'y', relationId: '   ' });
  assert.equal(blank.relationId, null, '공백만 있는 id를 진짜 id로 쓰면 취소가 조용히 실패한다');
});

// 추가·수정의 즉시 반영(2026-09-03) — 두 끝 id가 다 와야 쓴다. 이름으로 쓰면 오타가
// 새 노드가 되므로 화면이 이름으로 쓰지 않는다.
test('normalizeProposal — subjectId·objectId를 싣는다', () => {
  const item = normalizeProposal({
    op: 'add', object: '반도체', relation: 'belongs_to',
    subjectId: 'entity:a', objectId: 'entity:b',
  });
  assert.equal(item.subjectId, 'entity:a');
  assert.equal(item.objectId, 'entity:b');
});

test('normalizeProposal — id가 하나만 오면 그것만 남고 다른 쪽은 null이다', () => {
  const item = normalizeProposal({
    op: 'add', object: '반도체', relation: 'belongs_to', objectId: 'entity:b',
  });
  assert.equal(item.subjectId, null, '한쪽만 있으면 카드가 즉시 반영을 안 쓴다');
  assert.equal(item.objectId, 'entity:b');
});
