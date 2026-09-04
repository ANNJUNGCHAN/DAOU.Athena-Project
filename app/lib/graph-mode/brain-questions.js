// IIFE 스코프 격리(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
(function () {

// 되물을 것들(2026-09-02) — "확인이 필요한 것 N건"을 채팅 카드로 하나씩 묻는 로직.
//
// **왜 카드인가.** 확인 필요 배너는 "답하시면 그대로 그래프가 갱신됩니다"라고 약속한다.
// 그런데 모델이 산문으로 후보를 늘어놓으면 사용자가 어디에 답해야 하고 그 답이 어떻게
// 그래프로 돌아가는지가 안 보인다. 실제로 모델은 정직하게 "이것이 배너의 그 3건과 같다고는
// 말할 수 없다 — 확인용 후보다"라고 답했다(2026-09-02 실측). 배너의 그 3건은 백엔드가
// 이미 알고 있다(GET /brain/analysis/suggested-questions — AMBIGUOUS로 기록된 관계).
//
// **답이 그래프로 돌아가는 경로는 하나뿐이다.** brain_tools.py가 못박아 뒀다: 모델은
// 그래프에 쓸 수 없고, 쓰기는 사람의 행동에서 시작하는 두 경로(채팅→추출, 체결·잔고)뿐이다.
// 그래서 이 카드의 선택지는 **사람의 답변 문장**이 되어 채팅으로 제출된다 — 티어 설계를
// 우회하지 않고 배너의 약속을 지키는 유일한 방법이다.
//
// 이 파일은 순수 함수만 둔다(DOM 없음) — 문구가 코드에 굳어야 화면을 고칠 때 흔들리지 않고,
// node --test로 잴 수 있다.

// 프로필 뿌리 노드. 백엔드는 이 주체의 이름 대신 id('default')를 그대로 준다.
// 화면의 다른 곳(성향 신호 표)은 이 주체를 **아예 적지 않는다** — "내가 무엇을 어떻게
// 본다"에서 "내가"는 언제나 같아서 적을 이유가 없다. 카드도 같은 규칙을 쓴다.
// 안 그러면 사용자가 "default → 헬스케어"를 읽게 된다(2026-09-02 실측).
const PROFILE_SUBJECTS = new Set(['default', '투자자']);

function isProfileSubject(name) {
  return PROFILE_SUBJECTS.has(String(name || '').trim());
}

// 조사 교정 — 관계명을 영문에서 한글로 바꾸면 백엔드 문장의 조사가 어긋난다.
// 백엔드 템플릿은 "'interested_in'가 맞나요?"인데 '관심'은 받침이 있어 "이"가 맞다
// (2026-09-02 실측: 화면에 "'관심'가 맞나요"가 나왔다). 한글 음절의 받침 유무는
// (코드 − 0xAC00) % 28로 판정한다 — 0이면 받침이 없다.
function hasJongseong(char) {
  const code = String(char || '').charCodeAt(0);
  if (!Number.isFinite(code) || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

// 'X'가 → 'X'이 (X에 받침이 있을 때만). 따옴표 안이 한글이 아니면 건드리지 않는다 —
// 사전에 없는 관계는 원문 그대로 남으므로 영문에 조사를 붙이는 일이 없어야 한다.
function fixSubjectParticle(text) {
  return String(text || '').replace(/'([^']+)'가/g, (whole, inner) => (
    hasJongseong(inner.slice(-1)) ? `'${inner}'이` : whole
  ));
}

// 백엔드 응답을 화면이 쓸 형태로 정리한다.
//
// question은 백엔드가 이미 문장으로 만들어 주므로(analysis.py suggest_questions) 다시
// 짓지 않는다 — 지어내면 화면과 백엔드가 다른 말을 하게 된다. 다만 그 문장에도 원시
// 관계명이 들어 있어(예 "'interested_in'가 맞나요?") 한글 사전으로 바꿔 준다.
//
// relationLabels를 **주입받는** 이유: 그 사전은 공통 패널과 엔티티 타임라인이 이미
// 쓰고 있다(controller.js RELATION_LABELS). 여기 복사하면 한쪽만 고치는 실수가 나고,
// 반대로 이 leaf가 controller를 의존하면 층이 뒤집힌다.
function normalizeQuestions(payload, relationLabels) {
  const dict = relationLabels && typeof relationLabels === 'object' ? relationLabels : {};
  const list = Array.isArray(payload && payload.questions) ? payload.questions : [];
  return list
    .filter((q) => q && q.relation_id)
    .map((q) => {
      const relation = String(q.relation_kind || '');
      const relationText = dict[relation] || relation;
      const subject = String(q.subject_name || '');
      return {
        relationId: String(q.relation_id),
        subject,
        subjectImplicit: isProfileSubject(subject),
        object: String(q.object_name || ''),
        relation,
        relationText,
        rationale: q.rationale ? String(q.rationale) : null,
        // 원시 관계명이 박힌 문장을 한글 라벨로 바꿔 보여준다. 사전에 없으면 원문 그대로다.
        question: relation && relationText !== relation
          ? fixSubjectParticle(String(q.question || '').split(relation).join(relationText))
          : String(q.question || ''),
      };
    });
}

// "1 / 3" — 몇 번째를 묻고 있는지. 사람이 끝을 볼 수 있어야 답을 시작한다.
function progressLabel(index, total) {
  const i = Number.isFinite(index) ? index : 0;
  const n = Number.isFinite(total) ? total : 0;
  if (n <= 0) return '';
  return `${Math.min(i + 1, n)} / ${n}`;
}

// 카드 부제 — 무엇에 대한 질문인지 한 줄로. 근거가 있으면 그것까지 보탠다(§0:
// 근거 없이 "확실하지 않다"고만 하면 사람이 무엇을 판단해야 하는지 알 수 없다).
function contextLine(item) {
  if (!item) return '';
  const head = item.subjectImplicit || !item.subject
    ? [item.object, item.relationText].filter(Boolean).join(' · ')
    : `${item.subject} → ${item.object} · ${item.relationText}`;
  return item.rationale ? `${head} — ${item.rationale}` : head;
}

// 선택지 3종. '맞다'/'아니다'는 그 관계의 참·거짓을 사람이 확정하는 것이고,
// '건너뛰기'는 답하지 않는 것이다 — 답하지 않은 것을 "아니다"로 기록하면 침묵이
// 부정으로 굳는다(§0: 못 읽은 것과 없는 것은 다르다).
const CHOICES = Object.freeze({
  yes: { label: '맞다', hint: 'Ctrl Enter' },
  no: { label: '아니다', hint: null },
  skip: { label: '건너뛰기', hint: 'Esc' },
});

// 선택 → 채팅에 제출할 **사람의 답변 문장**.
//
// 무엇에 대한 답인지를 문장 안에 남긴다 — 추출기는 이 문장만 보고 관계를 다시
// 판단하므로 "맞아"만 보내면 무엇이 맞다는 것인지 알 수 없다.
// 조사(을/를·과/와)를 피해 따옴표와 조사 없는 어미로 쓴다: 이름이 무엇이든 문장이
// 어색해지지 않아야 한다.
function answerSentence(item, choice) {
  if (!item) return null;
  const target = item.subjectImplicit || !item.subject
    ? `"${item.object}"`
    : `"${item.subject}" → "${item.object}"`;
  const rel = item.relationText ? ` · '${item.relationText}'` : '';
  if (choice === 'yes') return `${target}${rel} — 맞아. 확실한 것으로 봐도 돼.`;
  if (choice === 'no') return `${target}${rel} — 아니야. 그 연결은 지워도 돼.`;
  return null; // skip은 아무것도 보내지 않는다.
}

const __exports = {
  normalizeQuestions, progressLabel, contextLine, answerSentence, isProfileSubject,
  hasJongseong, fixSubjectParticle, CHOICES,
};

// UMD 각주(2026-08-18 렌더러 격리) — column-fold.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BrainQuestions = __exports;
}

})();
