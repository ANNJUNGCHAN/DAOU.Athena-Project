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

const ACTIONS = Object.freeze([
  'install', 'allow_tools', 'revoke_tools', 'set_enabled', 'remove', 'stage_snippet',
]);

function hasAllowedActions(list) {
  return Array.isArray(list) && list.length > 0
    && list.every((entry) => entry && typeof entry === 'object' && ACTIONS.includes(entry.action));
}

// MCP 툴 이름은 mcp__<server>__<tool>로도 오므로 마지막 조각만 본다(형제 함수와 같다).
function isPluginProposalCall(step) {
  const base = String((step && step.name) || '').split('__').pop();
  if (base !== TOOL_NAME) return false;
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
  if (!hasAllowedActions(envelope.actions)) return null;
  return envelope;
}

module.exports = { TOOL_NAME, ACTIONS, isPluginProposalCall, extractProposal };
