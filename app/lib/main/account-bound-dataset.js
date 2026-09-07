'use strict';

function blockedResult(error) {
  const message = String(error || '조회에 사용할 서버 계좌를 확인할 수 없다');
  return {
    ok: false,
    feedbackOk: false,
    source: 'kiwoom-rest',
    rejected: true,
    error: message,
    errorCode: 'backend_account_unavailable',
    answerText: `${message}. 설정의 계좌 화면에서 조회에 사용할 서버 계좌를 연결해 주세요.`,
    answer: {
      delivery: 'separate',
      source: 'rejected-receipt',
      startedBeforeCanvasSettled: true,
      blockedCanvas: false,
      payloadTokensLeaked: false,
      modelCalls: 0,
    },
    canvases: [],
    canvasTypes: [],
    renderedCount: 0,
    dataCanvasCount: 0,
    stateCanvasCount: 0,
    physicalCalls: 0,
    lateCanvases: 0,
    recommendations: [],
    recommendationsExecutedBeforeClick: 0,
    forbiddenCalls: { mcp: 0, claude: 0, ws: 0, order: 0, oauth: 0 },
  };
}

async function runAccountBoundDataset({
  requestedAccountId,
  getActiveAccountId,
  resolveBackendAlias,
  resolveOptions,
  runRestDataset,
  runnerOptions,
} = {}) {
  if (typeof resolveBackendAlias !== 'function') throw new TypeError('resolveBackendAlias가 필요하다');
  if (typeof runRestDataset !== 'function') throw new TypeError('runRestDataset이 필요하다');
  const accountId = requestedAccountId == null
    ? String(typeof getActiveAccountId === 'function' ? getActiveAccountId() || '' : '')
    : String(requestedAccountId || '');
  const binding = await resolveBackendAlias({ ...(resolveOptions || {}), id: accountId });
  if (!binding || !binding.ok) return blockedResult(binding && binding.error);
  return runRestDataset({ ...(runnerOptions || {}), backendAccountAlias: binding.backendAlias });
}

module.exports = { runAccountBoundDataset };
