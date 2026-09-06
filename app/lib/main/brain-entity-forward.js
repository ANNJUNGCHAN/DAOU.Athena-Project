'use strict';

// 모델이 부른 `athena_brain action=entity`의 응답을 그래프 캔버스로 넘길지 가려내는
// 순수 판정부(Paper 보드 10 3ZAA-1). main.js의 maybeForwardBrainEntity가 이것만
// 부른다 — plugin-proposal-forward.js와 같은 자리·같은 뜻이다.
//
// 왜 넘기는가: 이 조회의 결과는 지금까지 모델에게만 갔다. 사람은 답만 보고 무엇을
// 근거로 한 말인지 확인할 길이 없었는데, 그 자료(관계·근거 원문 발췌·변경 이력)는
// 화면의 공통 패널이 이미 그릴 수 있는 모양이다.

const TOOL_NAME = 'athena_brain';

// 아테나 게이트웨이가 붙이는 접두. 이 둘 말고는 받지 않는다(형제 모듈과 같은 규율 —
// 제3의 등록 서버가 낸 같은 이름의 도구 결과를 우리 화면에 그리지 않는다).
const GATEWAY_NAME = `mcp__athena__${TOOL_NAME}`;

function isEntityCall(step) {
  const name = String((step && step.name) || '');
  if (name !== TOOL_NAME && name !== GATEWAY_NAME) return false;
  return Boolean(step && step.input && step.input.action === 'entity');
}

// 결과 텍스트는 brain_tools.py가 `_success(payload)`로 실은 EntityDetailResponse
// 그대로다. resolved가 아니면 안 넘긴다 — 이름이 여럿에 걸린 조회는 모델이 되물을
// 일이고, 화면이 후보 중 하나를 골라 그리면 그것이 곧 단정이다.
function extractEntityDetail(step, text) {
  if (!isEntityCall(step)) return null;
  let payload;
  try { payload = JSON.parse(text); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.resolved !== true) return null;
  if (typeof payload.name !== 'string' && typeof payload.entity_id !== 'string') return null;
  return payload;
}

// 툴 칩 부제(Paper 「한미반도체 · 관계 7 · 이력 3」) — 무엇을 몇 개 받았는지는
// 결과에만 있다. 없는 절은 뺀다(0을 지어내지 않는다 — 관계가 하나도 없는 노드는
// 실제로 있다).
//
// 관계 수는 실려 온 목록 길이가 아니라 `degree`다. 목록은 백엔드가 limit으로 자르므로
// 연결이 그보다 많은 노드에서는 칩과 패널 머리(「연결 57」)가 한 노드를 두 숫자로
// 부르게 된다 — Paper도 둘을 같은 7로 적었다.
function entityStepNote(payload) {
  if (!payload) return '';
  const parts = [String(payload.name || payload.entity_id || '')];
  const timeline = Array.isArray(payload.timeline) ? payload.timeline.length : 0;
  if (Number.isFinite(payload.degree) && payload.degree > 0) parts.push(`관계 ${payload.degree}`);
  if (timeline > 0) parts.push(`이력 ${timeline}`);
  return parts.filter(Boolean).join(' · ');
}

module.exports = { isEntityCall, extractEntityDetail, entityStepNote };
