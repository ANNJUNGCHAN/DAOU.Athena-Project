// IIFE 스코프 격리(2026-08-18 렌더러 격리) — brain-questions.js와 같은 패턴.
(function () {

// 그래프 편집 제안(2026-09-03) — 모델이 "이 관계를 이렇게 고칠까요"를 카드로 묻고,
// **사람이 누르면** 그 답이 그래프에 반영된다.
//
// **왜 모델이 직접 쓰지 않나.** brain_tools.py가 티어 설계를 못박아 뒀다: 모델이
// 그래프에 직접 쓸 수 있으면 대화 티어가 자기 주장을 결정적 사실처럼 밀어 넣는 길이
// 생긴다. 사용자가 2026-09-03에 "모델은 제안, 확정은 사람"을 골랐고, 이 파일이
// 그 경계다 — 모델이 카드를 스스로 누를 방법은 없다.
//
// **누르면 무엇이 도나(같은 날 후속).** 처음에는 답변 문장이 채팅으로 나가 추출
// 경로를 탔다. 그런데 반영이 다음 수집 배치까지 밀려, 누른 직후 아무 일도 안
// 일어나니 사람이 같은 카드를 무한히 눌렀다(실측 제보). 지금은 전용 API가 바로
// 쓴다(`/api/v1/brain/relations/*` — 전부 모델 비노출): remove는 관계를 지우고,
// add·change는 티어 MANUAL로 쓴다. 그래서 쓰기 경로는 셋이다 — 채팅→추출,
// 체결·잔고→투영, 그리고 사람의 직접 편집. 셋 다 사람의 행동에서 시작한다.
//
// **왜 되물을 것들 카드와 같은 모양인가.** 사람이 답해야 하는 일이 화면에 두 종류
// 생기는데(불확실한 관계 확인 / 모델의 편집 제안) 모양이 다르면 "무엇을 누르는
// 것인지"를 매번 새로 배워야 한다. 선택지 문구와 키 힌트까지 brain-questions.js와
// 같은 것을 쓴다 — 그래서 CSS도 .question-card* 그대로다(새 유리 층을 만들지 않는다).
//
// 이 파일은 순수 함수만 둔다(DOM 없음) — 문구가 코드에 굳어야 화면을 고칠 때 흔들리지
// 않고, node --test로 잴 수 있다.

// 관계 이름 한글 라벨은 controller.js RELATION_LABELS가 진실이라 **주입받는다**
// (brain-questions.js가 같은 이유로 주입받는 것과 같다 — 복사하면 한쪽만 고치는
// 실수가 나고, 반대로 이 leaf가 controller를 의존하면 층이 뒤집힌다).

// 백엔드 graph_view_tools._EDIT_OPS와 같은 셋. 어긋나면 화면이 못 그리는 제안이 온다.
const OPS = Object.freeze({
  add: { label: '추가', verb: '맞아' },
  change: { label: '수정', verb: '맞아' },
  remove: { label: '삭제', verb: '아니야' },
});

function isOp(op) {
  return Object.prototype.hasOwnProperty.call(OPS, String(op || ''));
}

// 봉투(main.js가 보낸 athena:graph-chat-action의 edit_proposal)를 화면이 쓸 형태로.
// 못 쓸 제안은 null이다 — 무엇을 어떻게 고칠지 모르는 카드를 띄우면 사람이 답할 수
// 없다. 백엔드도 같은 것을 막지만(graph_view_tools) 여기서 다시 본다: 화면은 봉투가
// 어디서 왔는지 모르는 채로 그려야 한다.
function normalizeProposal(message, relationLabels) {
  if (!message || typeof message !== 'object') return null;
  if (!isOp(message.op)) return null;
  const dict = relationLabels && typeof relationLabels === 'object' ? relationLabels : {};
  const object = String(message.object == null ? '' : message.object).trim();
  const relation = String(message.relation == null ? '' : message.relation).trim();
  if (!object || !relation) return null;
  const subject = String(message.subject == null ? '' : message.subject).trim();
  return {
    op: String(message.op),
    opLabel: OPS[String(message.op)].label,
    // 주체가 없으면 투자자 프로필이 주체다(성향 관계) — 성향 신호 표가 "내가"를
    // 아예 적지 않는 것과 같은 규칙이라, 화면에도 적지 않는다.
    subject,
    subjectImplicit: !subject,
    object,
    relation,
    relationText: dict[relation] || relation,
    // 지울 관계의 id(2026-09-03). 있으면 '적용'이 그래프에서 **바로** 지운다 —
    // 수집(대화를 캐는 일)과 편집(주인이 화면에서 고치는 일)은 다른 일이고, 편집을
    // 배치까지 기다리게 하면 누른 직후 아무 일도 안 일어나 같은 카드를 반복해 누른다
    // (실측). 없으면 예전 경로(답변 문장 제출 → 수집 때 반영)를 그대로 쓴다.
    // op=remove 전용이다. 추가·수정은 아래 subjectId·objectId를 쓴다.
    relationId: message.relationId ? String(message.relationId).trim() || null : null,
    // 추가·수정의 즉시 반영 재료(2026-09-03). 둘 다 있어야 쓴다 — 하나만 있으면
    // 어느 끝을 이을지 모른다. 성향 관계처럼 주체가 본인이면 모델이 subject_id를
    // 생략하므로, 그 경우는 화면이 투자자 프로필 id를 알아야 한다(아직 없다 —
    // 그래서 지금은 두 id가 다 온 경우에만 즉시 반영한다).
    subjectId: message.subjectId ? String(message.subjectId).trim() || null : null,
    objectId: message.objectId ? String(message.objectId).trim() || null : null,
    reason: message.reason ? String(message.reason).trim() || null : null,
  };
}

// 카드 제목 — 무엇을 어떻게 하자는 것인지 한 줄로. 사람이 이것만 읽고 판단한다.
function proposalTitle(item) {
  if (!item) return '';
  const target = item.subjectImplicit
    ? `"${item.object}" · '${item.relationText}'`
    : `"${item.subject}" → "${item.object}" · '${item.relationText}'`;
  if (item.op === 'remove') return `${target} 연결을 지울까요?`;
  if (item.op === 'add') return `${target} 연결을 추가할까요?`;
  return `${target} 연결을 이렇게 고칠까요?`;
}

// 카드 부제 — 왜 그렇게 하자는 것인지. 근거가 없으면 그 절을 붙이지 않는다(§0:
// 근거 없이 "고치자"고만 하면 사람이 무엇을 판단해야 하는지 알 수 없다).
function proposalContext(item) {
  if (!item) return '';
  return item.reason ? `${item.opLabel} 제안 — ${item.reason}` : `${item.opLabel} 제안`;
}

// 선택 → 채팅에 제출할 **사람의 답변 문장**.
//
// brain-questions.js answerSentence와 같은 규범을 따른다: 무엇에 대한 답인지를 문장
// 안에 남긴다(추출기는 이 문장만 보고 관계를 다시 판단하므로 "응"만 보내면 무엇이
// 맞다는 것인지 알 수 없다), 조사를 피해 따옴표와 조사 없는 어미로 쓴다.
//
// **적용 = 제안대로**다. remove 제안에 '적용'을 누르면 "그 연결은 지워도 돼"가 되고,
// add/change 제안에 누르면 "맞아, 확실한 것으로 봐도 돼"가 된다. 거절은 그 반대가
// 아니라 **현재 상태 유지**다 — remove를 거절한 것은 "지우지 마"이지 "더 강하게
// 기록해"가 아니다. 그래서 거절 문장은 관계를 다시 주장하지 않고 그 사실만 말한다.
function proposalSentence(item, choice) {
  if (!item) return null;
  const target = item.subjectImplicit
    ? `"${item.object}"`
    : `"${item.subject}" → "${item.object}"`;
  const rel = ` · '${item.relationText}'`;
  if (choice === 'apply') {
    if (item.op === 'remove') return `${target}${rel} — 아니야. 그 연결은 지워도 돼.`;
    return `${target}${rel} — 맞아. 확실한 것으로 봐도 돼.`;
  }
  if (choice === 'reject') {
    if (item.op === 'remove') return `${target}${rel} — 그 연결은 그대로 둬. 지우지 마.`;
    return `${target}${rel} — 그건 아직 확실하지 않아. 그대로 둬.`;
  }
  return null; // skip은 아무것도 보내지 않는다.
}

// 선택지 3종. 되물을 것들 카드(brain-questions.js CHOICES)와 **같은 키 힌트**를 쓴다 —
// 사람이 두 카드에서 다른 손가락을 쓰게 하면 안 된다. 라벨만 다르다: 여기서는
// 참·거짓을 확정하는 것이 아니라 제안을 받아들이거나 물리는 것이다.
const CHOICES = Object.freeze({
  apply: { label: '적용', hint: 'Ctrl Enter' },
  reject: { label: '아니다', hint: null },
  skip: { label: '건너뛰기', hint: 'Esc' },
});

const __exports = {
  OPS, isOp, normalizeProposal, proposalTitle, proposalContext, proposalSentence, CHOICES,
};

// UMD 각주(2026-08-18 렌더러 격리) — brain-questions.js와 같은 패턴.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.GraphEditProposal = __exports;
}

})();
