'use strict';

// 백테스트 REST 프록시 — 렌더러는 백엔드에 직접 붙지 않는다(main.js의 routineHttp와
// 같은 관례). routineHttp는 main.js 안에 갇혀 있어 단위 테스트를 못 붙였는데, 여기는
// 처음부터 순수 함수로 분리해 backtest-bridge.test.js가 fetchImpl 가짜로 직접
// 검증한다(chart-series.js의 주입식 fetchImpl 패턴과 같은 자리).
//
// 계약: 모든 함수가 {ok:true, data} | {ok:false, status, error} 봉투를 돌려준다
// (routineHttp와 동일 — main.js의 IPC 핸들러가 그대로 반환해도 렌더러 쪽 기대와
// 어긋나지 않는다). run()이 캐시 부족(409)을 만나면 실패가 아니라 승인 화면
// 전환 신호다 — backtest-mode-plan.md §9: "run이 캐시 부족을 만나면 실행하지
// 않고 blocked + {needed_pages, est_seconds}를 돌려준다. 캔버스가 그 숫자로
// 승인 카드를 띄운다." 그래서 409 응답의 detail을 봉투에 함께 싣는다 —
// ok:false이지만 캔버스가 detail로 승인 상태를 구성할 수 있어야 한다.

async function backtestHttp(method, path, jsonBody, { backendBase, fetchImpl }) {
  const opts = { method };
  if (jsonBody !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(jsonBody);
  }
  let res;
  try {
    res = await fetchImpl(`${backendBase}${path}`, opts);
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body && body.detail;
    const message = (detail && typeof detail === 'object' && (detail.message || detail.error))
      || (typeof detail === 'string' && detail)
      || `HTTP ${res.status}`;
    const envelope = { ok: false, status: res.status, error: message };
    // 409의 detail({needed_pages, est_seconds})처럼 구조화된 정보는 버리지 않고
    // 그대로 얹는다 — 위 머리말 "run() 예외" 참고.
    if (detail && typeof detail === 'object') envelope.detail = detail;
    return envelope;
  }
  return { ok: true, data: body };
}

function fetchPresets({ backendBase, fetchImpl }) {
  return backtestHttp('GET', '/api/v1/backtest/presets', undefined, { backendBase, fetchImpl });
}

// plan/backfill은 계약상 {stk_cd, period, adjusted, from_dt, to_dt}를 몸체로 받는다
// (backtest-mode-plan.md §8.2) — 여기서는 필드명을 하드코딩하지 않고 호출자가 준
// 나머지 필드를 그대로 몸체로 전달한다. 프리셋 자체는 종목·기간을 모르는 순수
// 전략 템플릿이라(presets.py 설계 결정 — bt-api 실측 확인, 2026-08-31) 이 값들은
// backtest-canvas.js의 설계 폼(종목코드·주기·수정주가·시작일·종료일 최소 입력)에서
// 나온다 — run()의 params 필드에도 같은 값을 실어 보낸다(§7.1 계약 그대로).
function planBacktest({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/data/plan', body, { backendBase, fetchImpl });
}

function backfillBacktest({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/data/backfill', body, { backendBase, fetchImpl });
}

function runBacktest({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/runs', body, { backendBase, fetchImpl });
}

function fetchJobStatus({ backendBase, fetchImpl, job_id }) {
  return backtestHttp(
    'GET',
    `/api/v1/backtest/jobs/${encodeURIComponent(job_id)}`,
    undefined,
    { backendBase, fetchImpl },
  );
}

function fetchRunResult({ backendBase, fetchImpl, run_id }) {
  return backtestHttp(
    'GET',
    `/api/v1/backtest/runs/${encodeURIComponent(run_id)}`,
    undefined,
    { backendBase, fetchImpl },
  );
}

function fetchRunTrades({ backendBase, fetchImpl, run_id }) {
  return backtestHttp(
    'GET',
    `/api/v1/backtest/runs/${encodeURIComponent(run_id)}/trades`,
    undefined,
    { backendBase, fetchImpl },
  );
}

function fetchRuns({ backendBase, fetchImpl }) {
  return backtestHttp('GET', '/api/v1/backtest/runs', undefined, { backendBase, fetchImpl });
}

// ── 2026-09-01 확장분 — Paper 보드 02·05·06·07·08·09가 쓰는 라우트 ──────────
// 위 함수들과 같은 봉투 계약을 그대로 따른다. 새 규칙은 하나뿐이다: **사람 클릭 전용
// 라우트(activate·deployments·backfill)도 여기서는 그냥 프록시한다** — 사람 전용이라는
// 규율은 MCP 표면에서 지키는 것이지(모델이 못 부른다), 렌더러가 사람의 클릭을 대신
// 전달하는 이 층에서 막을 것이 아니다.

function validateBacktest({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/validate', body, { backendBase, fetchImpl });
}

function fetchCoverage({ backendBase, fetchImpl, stk_cd, period, adjusted }) {
  const query = new URLSearchParams({
    stk_cd: String(stk_cd), period: String(period), adjusted: String(!!adjusted),
  });
  return backtestHttp(
    'GET', `/api/v1/backtest/data/coverage?${query}`, undefined, { backendBase, fetchImpl },
  );
}

function fetchFlow({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/flow', body, { backendBase, fetchImpl });
}

function diagnoseBacktest({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/diagnose', body, { backendBase, fetchImpl });
}

function optimizeBacktest({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/optimize', body, { backendBase, fetchImpl });
}

function optimizePlan({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/optimize/plan', body, { backendBase, fetchImpl });
}

function fetchStrategies({ backendBase, fetchImpl }) {
  return backtestHttp('GET', '/api/v1/backtest/strategies', undefined, { backendBase, fetchImpl });
}

function createStrategy({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/strategies', body, { backendBase, fetchImpl });
}

function fetchVersions({ backendBase, fetchImpl, strategy_id }) {
  return backtestHttp(
    'GET', `/api/v1/backtest/strategies/${encodeURIComponent(strategy_id)}/versions`,
    undefined, { backendBase, fetchImpl },
  );
}

function addVersion({ backendBase, fetchImpl, strategy_id, ...body }) {
  return backtestHttp(
    'POST', `/api/v1/backtest/strategies/${encodeURIComponent(strategy_id)}/versions`,
    body, { backendBase, fetchImpl },
  );
}

function activateVersion({ backendBase, fetchImpl, strategy_id, ...body }) {
  return backtestHttp(
    'POST', `/api/v1/backtest/strategies/${encodeURIComponent(strategy_id)}/activate`,
    body, { backendBase, fetchImpl },
  );
}

function fetchVersionDiff({ backendBase, fetchImpl, strategy_id, base, head }) {
  const query = new URLSearchParams({ base: String(base), head: String(head) });
  return backtestHttp(
    'GET', `/api/v1/backtest/strategies/${encodeURIComponent(strategy_id)}/diff?${query}`,
    undefined, { backendBase, fetchImpl },
  );
}

function fetchDeployments({ backendBase, fetchImpl }) {
  return backtestHttp('GET', '/api/v1/backtest/deployments', undefined, { backendBase, fetchImpl });
}

function createDeployment({ backendBase, fetchImpl, ...body }) {
  return backtestHttp('POST', '/api/v1/backtest/deployments', body, { backendBase, fetchImpl });
}

function stopDeployment({ backendBase, fetchImpl, deployment_id }) {
  return backtestHttp(
    'DELETE', `/api/v1/backtest/deployments/${encodeURIComponent(deployment_id)}`,
    undefined, { backendBase, fetchImpl },
  );
}

function fetchSignals({ backendBase, fetchImpl, deployment_id }) {
  return backtestHttp(
    'GET', `/api/v1/backtest/deployments/${encodeURIComponent(deployment_id)}/signals`,
    undefined, { backendBase, fetchImpl },
  );
}

function evaluateDeployment({ backendBase, fetchImpl, deployment_id, ...body }) {
  return backtestHttp(
    'POST', `/api/v1/backtest/deployments/${encodeURIComponent(deployment_id)}/evaluate`,
    body, { backendBase, fetchImpl },
  );
}

module.exports = {
  backtestHttp,
  fetchPresets,
  planBacktest,
  backfillBacktest,
  runBacktest,
  fetchJobStatus,
  fetchRunResult,
  fetchRunTrades,
  fetchRuns,
  validateBacktest,
  fetchCoverage,
  fetchFlow,
  diagnoseBacktest,
  optimizeBacktest,
  optimizePlan,
  fetchStrategies,
  createStrategy,
  fetchVersions,
  addVersion,
  activateVersion,
  fetchVersionDiff,
  fetchDeployments,
  createDeployment,
  stopDeployment,
  fetchSignals,
  evaluateDeployment,
};
