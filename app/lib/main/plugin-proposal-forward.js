'use strict';

// 모델이 낸 플러그인 제안을 채팅 스트림에서 골라내는 순수 판정부.
// main.js의 maybeForwardPluginProposal이 이것만 부른다 — electron도 파일도
// 만지지 않으므로 그대로 테스트한다(maybeForwardNudgeGuardProposal의 판정부를
// 분리해 둔 자리와 같은 뜻이다).
//
// 형제 툴들과 달리 `action: 'propose'` 같은 분기 인자가 없다. athena_plugin은
// 제안 외의 액션이 없으므로, 가려내는 열쇠는 **호출 입력의 actions 배열이
// 여섯 액션 안에 있는가** 하나다(plugin_tools.py `_ALLOWED_ACTIONS`와 같은 6종).

const TOOL_NAME = 'athena_plugin';

// 아테나 게이트웨이가 붙이는 접두. 이 둘 말고는 받지 않는다.
const GATEWAY_NAME = `mcp__athena__${TOOL_NAME}`;

const ACTIONS = Object.freeze([
  'install', 'allow_tools', 'revoke_tools', 'set_enabled', 'remove', 'stage_snippet',
]);

function hasAllowedActions(list) {
  return Array.isArray(list) && list.length > 0
    && list.every((entry) => entry && typeof entry === 'object' && ACTIONS.includes(entry.action));
}

// 이름은 정확히 대조한다 — 마지막 `__` 조각만 보면 제3의 등록 서버가 낸
// `<별칭>__athena_plugin`이 아테나 제안으로 통과한다(그 봉투는 우리 게이트를
// 거치지 않았으므로 승인 카드로 올려서는 안 된다).
function isPluginProposalCall(step) {
  const name = String((step && step.name) || '');
  if (name !== TOOL_NAME && name !== GATEWAY_NAME) return false;
  return hasAllowedActions(step && step.input && step.input.actions);
}

// 결과 텍스트는 plugin_tools.py가 `_success(envelope)`로 실은 봉투 JSON 그대로다.
// 모양이 어긋나면 조용히 버린다 — 반쪽 봉투를 렌더러로 보내면 카드가 거짓을 그린다.
function extractProposal(step, text) {
  if (!isPluginProposalCall(step)) return null;
  let envelope;
  try { envelope = JSON.parse(text); } catch { return null; }
  if (!envelope || typeof envelope !== 'object') return null;
  if (typeof envelope.proposal_id !== 'string' || !envelope.proposal_id) return null;
  // 모델 경로의 봉투는 백엔드가 source='model'을 찍는다 — 다른 값이면 우리가
  // 만든 봉투가 아니다(GUI 봉투는 렌더러 안에서만 돌고 이 경로로 오지 않는다).
  if (envelope.source !== 'model') return null;
  if (!hasAllowedActions(envelope.actions)) return null;
  return envelope;
}

module.exports = { isPluginProposalCall, extractProposal };
