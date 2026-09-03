// 플러그인 제안의 순수 계산 — DOM은 만들지 않는다(plugin-canvas.js가 조립하고
// chat.js가 결과 턴을 마운트한다). lib/guard-confirm.js가 diff·병합을 DOM 밖에
// 둔 것과 같은 자리다.
//
// 이 파일이 존재하는 이유는 하나다: **모델 경로와 GUI 버튼 경로가 같은 함수로
// 제안을 만든다.** 두 입구가 물리적으로 합류하므로 검증기도 하나뿐이다.
// 그래서 `source`("model" | "gui")는 필수 필드다 — GUI 버튼이 만든 것을
// "아테나가 제안했다"고 그리면 사용자가 오독한다(화면은 정직하다).
//
// `revision`은 키가 반드시 있고 `null`을 허용한다. GUI 경로는 아직 목록을 못
// 받았으면 `null`을 싣고, 그때 만료 판정은 하지 않는다(승인 직전에 채워진다).
(function () {
'use strict';

const PluginCatalog = typeof module !== 'undefined' && module.exports
  ? require('./plugin-catalog')
  : window.AthenaLib.PluginCatalog;
const { displayNameFor } = PluginCatalog;

// 확정 2 — 사람이 보는 5동작을 감사에서 구분 가능한 6종으로 편다.
const ACTIONS = Object.freeze([
  'install', 'allow_tools', 'revoke_tools', 'set_enabled', 'remove', 'stage_snippet',
]);

const SOURCES = Object.freeze(['model', 'gui']);

function newProposalId() {
  const scope = typeof globalThis !== 'undefined' ? globalThis : null;
  const webCrypto = scope && scope.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 있는 키만 옮긴다 — 없는 필드를 undefined로 채워 스키마를 넓히지 않는다.
// stage_snippet의 target은 항상 null이다(등록 전이라 가리킬 별칭이 없다).
function normalizeAction(spec) {
  const src = spec || {};
  const out = { action: src.action, target: src.action === 'stage_snippet' ? null : src.target };
  if (src.features !== undefined) out.features = Array.isArray(src.features) ? src.features.slice() : src.features;
  if (src.enabled !== undefined) out.enabled = src.enabled;
  if (src.snippet !== undefined) out.snippet = src.snippet;
  return out;
}

function buildBatchProposal(actions, reason, revision, source) {
  return {
    proposal_id: newProposalId(),
    source,
    revision: revision === undefined ? null : revision,
    actions: (Array.isArray(actions) ? actions : []).map(normalizeAction),
    reason: reason === undefined || reason === null ? '' : String(reason),
  };
}

function buildProposal(spec, reason, revision, source) {
  return buildBatchProposal([spec], reason, revision, source);
}

function validateAction(action, index, errors) {
  const at = `actions[${index}]`;
  if (!action || typeof action !== 'object') { errors.push(`${at}이 객체가 아닙니다`); return; }
  if (!ACTIONS.includes(action.action)) { errors.push(`${at}.action이 허용 목록 밖입니다`); return; }
  if (action.action === 'stage_snippet') {
    if (action.target !== null) errors.push(`${at}.target은 null이어야 합니다`);
    if (typeof action.snippet !== 'string' || !action.snippet) errors.push(`${at}.snippet이 없습니다`);
  } else if (typeof action.target !== 'string' || !action.target) {
    errors.push(`${at}.target이 없습니다`);
  }
  if (action.features !== undefined
      && (!Array.isArray(action.features) || action.features.some((f) => typeof f !== 'string'))) {
    errors.push(`${at}.features는 문자열 배열이어야 합니다`);
  }
  if (action.action === 'set_enabled' && typeof action.enabled !== 'boolean') {
    errors.push(`${at}.enabled가 불리언이 아닙니다`);
  }
}

// 렌더 직전 2차 검증용 — 권위는 백엔드 제안 게이트와 메인 승인 게이트에 있다.
function validateProposal(envelope) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, errors: ['제안이 객체가 아닙니다'] };
  const errors = [];
  if (typeof envelope.proposal_id !== 'string' || !envelope.proposal_id) errors.push('proposal_id가 없습니다');
  if (!SOURCES.includes(envelope.source)) errors.push('source는 model 또는 gui여야 합니다');
  if (!Object.prototype.hasOwnProperty.call(envelope, 'revision')) errors.push('revision 키가 없습니다');
  else if (envelope.revision !== null && typeof envelope.revision !== 'number') errors.push('revision은 숫자 또는 null이어야 합니다');
  if (!Array.isArray(envelope.actions) || envelope.actions.length === 0) errors.push('actions가 비어 있습니다');
  else envelope.actions.forEach((action, index) => validateAction(action, index, errors));
  return { ok: errors.length === 0, errors };
}

// 어느 한쪽이라도 revision을 모르면 만료로 몰지 않는다 — 모르는 것을 낡았다고
// 말하는 것도 거짓이다. 승인 직전에 메인이 현재 값으로 채운다.
function isProposalStale(envelope, currentRevision) {
  const revision = envelope ? envelope.revision : null;
  if (revision === null || revision === undefined) return false;
  if (currentRevision === null || currentRevision === undefined) return false;
  return revision !== currentRevision;
}

function nameFor(action) {
  return displayNameFor(action.target) || action.target || '';
}

function titleFor(action) {
  const name = nameFor(action);
  switch (action.action) {
    case 'install': return `${name} 설치`;
    case 'allow_tools':
    case 'revoke_tools': return `${name} · 기능 허용`;
    case 'set_enabled': return action.enabled ? `${name} 켜기` : `${name} 끄기`;
    case 'remove': return `${name} 삭제`;
    case 'stage_snippet': return '직접 등록';
    default: return name;
  }
}

// 카드 본문은 제안 안에 실제로 실린 값만 쓴다 — 카탈로그·레지스트리를 조회해
// 지어내지 않는다(모르는 값을 그리면 화면과 실제가 어긋난다).
function linesFor(action) {
  const features = Array.isArray(action.features) ? action.features : [];
  switch (action.action) {
    case 'install': return features.length ? [`권한 ${features.length}개 요청`] : [];
    case 'allow_tools': return [`허용 ${features.length}개`, ...features];
    case 'revoke_tools': return [`철회 ${features.length}개`, ...features];
    case 'set_enabled': return action.enabled ? [] : ['승인 철회'];
    case 'remove': return ['등록과 승인 기록을 함께 지웁니다'];
    case 'stage_snippet': return ['등록만으로는 실행되지 않습니다'];
    default: return [];
  }
}

// GUI 경로의 근거 줄은 사용자가 방금 누른 버튼을 그대로 되짚는 고정 문구다
// (모델이 넘긴 문장을 GUI 카드에 쓰면 출처가 뒤바뀐다).
function guiReasonFor(action) {
  switch (action.action) {
    case 'install': return '허브에서 [설치]를 눌렀습니다';
    case 'allow_tools':
    case 'revoke_tools': return '권한 화면에서 [저장]을 눌렀습니다';
    case 'set_enabled': return action.enabled ? '관리에서 [켜기]를 눌렀습니다' : '관리에서 [끄기]를 눌렀습니다';
    case 'remove': return '관리에서 [삭제]를 눌렀습니다';
    case 'stage_snippet': return '[+ 서버 추가]에서 [승인]을 눌렀습니다';
    default: return '';
  }
}

function cardCopy(envelope) {
  const actions = envelope && Array.isArray(envelope.actions) ? envelope.actions : [];
  const head = actions[0] || {};
  const fromGui = Boolean(envelope) && envelope.source === 'gui';
  return {
    sourceLabel: fromGui ? '내 요청' : '아테나 제안',
    title: titleFor(head),
    lines: actions.reduce((all, action) => all.concat(linesFor(action)), []),
    reasonLine: fromGui ? guiReasonFor(head) : String((envelope && envelope.reason) || ''),
  };
}

// 승인 뒤 채팅에 남기는 결과 턴 문구. `chip`은 실패 때만 있다.
// 재시작 칸은 런타임이 켜졌을 때만 "반영됐다"고 말한다 — 기본 빌드는 아직
// 낡은 목록을 쥐고 있으므로 그 문장이 거짓이다.
function resultTurnCopy(kind, ctx) {
  const context = ctx || {};
  if (kind === 'success') {
    const found = Number(context.toolCount || 0);
    return { lines: ['등록했습니다', '연결을 확인했습니다', `기능 ${found}개를 찾았습니다`], chip: null };
  }
  if (kind === 'rejected') return { lines: ['그대로 뒀습니다'], chip: null };
  if (kind === 'failed') {
    const reason = String(context.reason || '').trim();
    return { lines: [reason ? `연결 실패 — ${reason}` : '연결 실패'], chip: '다시 시도' };
  }
  if (kind === 'restart') {
    return context.runtimeEnabled
      ? { lines: ['플러그인이 바뀌어 대화를 다시 시작했습니다', '방금 승인한 내용은 반영됐습니다'], chip: null }
      : { lines: ['다음 실행부터 반영됩니다'], chip: null };
  }
  return { lines: [], chip: null };
}

// 모드 밖에서 도착한 제안은 폐기한다 — 보관했다가 나중에 띄우지 않으므로
// "승인할 수 있습니다"라고 말하지 않는다.
function outOfModeCopy() {
  return '플러그인 모드에서 다시 요청합니다';
}

function snippetHash(text) {
  let hash = 5381;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

// 한 턴에 같은 제안이 반복해서 오면 두 번째부터 조용히 버리기 위한 서명.
function proposalSignature(envelope) {
  const actions = envelope && Array.isArray(envelope.actions) ? envelope.actions : [];
  return actions
    .map((action) => (action.action === 'stage_snippet'
      ? `${action.action}:${snippetHash(action.snippet)}`
      : `${action.action}:${action.target}`))
    .join('|');
}

const __exports = {
  ACTIONS, buildProposal, buildBatchProposal, validateProposal, isProposalStale,
  cardCopy, resultTurnCopy, outOfModeCopy, proposalSignature,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.PluginProposal = __exports;
}

})();
