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
};
