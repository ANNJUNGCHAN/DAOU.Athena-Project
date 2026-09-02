'use strict';

// 되물을 것들 카드의 순수 로직(2026-09-02). 문구를 여기서 굳힌다 — 화면을 고칠 때
// 답변 문장이 조용히 바뀌면 추출기가 다른 관계를 기록하게 된다.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeQuestions, progressLabel, contextLine, answerSentence, isProfileSubject,
  hasJongseong, fixSubjectParticle, CHOICES,
} = require('./brain-questions');

// 공통 패널·타임라인이 쓰는 사전과 같은 것을 주입한다(controller.js RELATION_LABELS).
const LABELS = { interested_in: '관심', relates_to: '연관', avoids: '회피' };

function payload() {
  return {
    revision: 34,
    questions: [
      {
        relation_id: 'r1',
        // 프로필 뿌리 — 백엔드가 이름 대신 id를 준다(실측).
        subject_name: 'default',
        object_name: '헬스케어',
        relation_kind: 'interested_in',
        rationale: '"잘 모르겠다" — 관심 여부 불명확',
        question: "헬스케어에 대해 'interested_in'가 맞나요? 확실하지 않은 것으로 기록해 두었습니다.",
      },
      {
        relation_id: 'r2',
        subject_name: '한미반도체',
        object_name: '배당·인컴',
        relation_kind: 'relates_to',
        rationale: null,
        question: "'relates_to'가 맞나요? 확실하지 않은 것으로 기록해 두었습니다.",
      },
    ],
  };
}

test('normalizeQuestions — 원시 관계명을 주입받은 한글 사전으로 바꾼다', () => {
  const [first, second] = normalizeQuestions(payload(), LABELS);
  assert.equal(first.relation, 'interested_in', '원본은 남긴다');
  assert.equal(first.relationText, '관심');
  // 백엔드 문장 안의 원시 관계명까지 바꿔야 사용자가 'interested_in'을 안 읽는다.
  // 조사는 별도 테스트가 잰다 — 여기서는 관계명이 한글로 바뀌었는지만 본다.
  assert.match(first.question, /'관심'이 맞나요/);
  assert.ok(!first.question.includes('interested_in'));
  assert.equal(second.relationText, '연관');
});

test('조사 교정 — 받침이 있으면 "이", 없으면 "가"다', () => {
  // 영문을 한글로 바꾸면 백엔드 템플릿의 "가"가 어긋난다(실측: "\'관심\'가 맞나요").
  for (const [word, particle] of [['관심', '이'], ['연관', '이'], ['노출', '이'], ['선호', '가'], ['보유', '가'], ['목표', '가'], ['회피', '가']]) {
    assert.equal(fixSubjectParticle(`'${word}'가 맞나요?`), `'${word}'${particle} 맞나요?`, word);
  }
  assert.equal(hasJongseong('관'), true);
  assert.equal(hasJongseong('호'), false);
  assert.equal(hasJongseong('a'), false, '한글이 아니면 판정 대상이 아니다');
  assert.equal(hasJongseong(''), false);
});

test('조사 교정 — 따옴표 안이 한글이 아니면 건드리지 않는다', () => {
  // 사전에 없는 관계는 원문으로 남으므로 영문에 "이"를 붙이면 안 된다.
  assert.equal(fixSubjectParticle("'interested_in'가 맞나요?"), "'interested_in'가 맞나요?");
  assert.equal(fixSubjectParticle(''), '');
  assert.equal(fixSubjectParticle(null), '');
});

test('normalizeQuestions — 한글로 바꾼 뒤 조사까지 맞춘다', () => {
  const [first] = normalizeQuestions(payload(), LABELS);
  assert.match(first.question, /'관심'이 맞나요/);
  assert.ok(!first.question.includes("'관심'가"), '조사가 교정되지 않은 문장이 남으면 안 된다');
});

test('normalizeQuestions — 사전에 없는 관계는 원문 그대로 둔다(지어내지 않는다)', () => {
  const items = normalizeQuestions({
    questions: [{ relation_id: 'r', subject_name: 'a', object_name: 'b', relation_kind: 'brand_new', question: "'brand_new'?" }],
  }, LABELS);
  assert.equal(items[0].relationText, 'brand_new');
  assert.equal(items[0].question, "'brand_new'?");
});

test('normalizeQuestions — 사전을 안 주거나 이상해도 던지지 않는다', () => {
  for (const dict of [undefined, null, 'x', 0]) {
    const items = normalizeQuestions(payload(), dict);
    assert.equal(items[0].relationText, 'interested_in', '사전이 없으면 원문이다');
  }
});

test('normalizeQuestions — 프로필 뿌리 주체를 암묵으로 표시한다', () => {
  const [first, second] = normalizeQuestions(payload(), LABELS);
  assert.equal(first.subjectImplicit, true, "'default'는 프로필 뿌리다");
  assert.equal(second.subjectImplicit, false);
  assert.equal(isProfileSubject('투자자'), true);
  assert.equal(isProfileSubject('헬스케어'), false);
  assert.equal(isProfileSubject(null), false);
});

test('normalizeQuestions — relation_id 없는 항목은 버린다(무엇에 답하는지 모르면 물을 수 없다)', () => {
  const items = normalizeQuestions({ questions: [{ subject_name: '가', question: '?' }, ...payload().questions] }, LABELS);
  assert.equal(items.length, 2);
});

test('normalizeQuestions — 응답이 비었거나 이상하면 빈 배열이다(던지지 않는다)', () => {
  for (const bad of [null, undefined, {}, { questions: null }, { questions: 'x' }]) {
    assert.deepEqual(normalizeQuestions(bad, LABELS), []);
  }
});

test('progressLabel — 몇 번째를 묻는지 보인다(끝을 볼 수 있어야 답을 시작한다)', () => {
  assert.equal(progressLabel(0, 3), '1 / 3');
  assert.equal(progressLabel(2, 3), '3 / 3');
  assert.equal(progressLabel(5, 3), '3 / 3', '범위를 넘겨도 총계를 넘지 않는다');
  assert.equal(progressLabel(0, 0), '', '물을 것이 없으면 진행 표시도 없다');
});

test('contextLine — 프로필 뿌리 주체는 적지 않는다("default →"를 사용자가 읽으면 안 된다)', () => {
  const [first, second] = normalizeQuestions(payload(), LABELS);
  assert.equal(contextLine(first), '헬스케어 · 관심 — "잘 모르겠다" — 관심 여부 불명확');
  assert.ok(!contextLine(first).includes('default'));
  assert.equal(contextLine(second), '한미반도체 → 배당·인컴 · 연관', '근거가 없으면 그 절을 안 붙인다');
  assert.equal(contextLine(null), '');
});

test('answerSentence — 무엇에 대한 답인지를 문장 안에 남긴다', () => {
  const [first, second] = normalizeQuestions(payload(), LABELS);
  assert.equal(answerSentence(first, 'yes'), '"헬스케어" · \'관심\' — 맞아. 확실한 것으로 봐도 돼.');
  assert.equal(answerSentence(first, 'no'), '"헬스케어" · \'관심\' — 아니야. 그 연결은 지워도 돼.');
  assert.equal(answerSentence(second, 'yes'), '"한미반도체" → "배당·인컴" · \'연관\' — 맞아. 확실한 것으로 봐도 돼.');
});

test('answerSentence — 건너뛰기는 아무것도 보내지 않는다(침묵을 부정으로 굳히지 않는다)', () => {
  const [first] = normalizeQuestions(payload(), LABELS);
  assert.equal(answerSentence(first, 'skip'), null);
  assert.equal(answerSentence(null, 'yes'), null);
});

test('CHOICES — 레퍼런스 화면과 같은 키 힌트를 갖는다', () => {
  assert.equal(CHOICES.yes.label, '맞다');
  assert.equal(CHOICES.yes.hint, 'Ctrl Enter');
  assert.equal(CHOICES.skip.label, '건너뛰기');
  assert.equal(CHOICES.skip.hint, 'Esc');
  assert.equal(CHOICES.no.hint, null, '"아니다"는 오타로 눌리면 안 되므로 단축키가 없다');
});
