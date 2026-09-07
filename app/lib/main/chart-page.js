'use strict';

const BACKEND_ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function fetchChartPage(options = {}) {
  const backendAccountAlias = String(options.backendAccountAlias || '');
  if (!BACKEND_ALIAS_PATTERN.test(backendAccountAlias)) {
    return { ok: false, error: '조회에 사용할 서버 계좌가 연결되지 않았다', candles: [] };
  }
  const operationRef = String(options.operationRef || '');
  if (!operationRef) return { ok: false, error: 'operationRef가 비었다', candles: [] };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(`${options.backendBase}/api/v1/canvas/chart-page`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Athena-Account': backendAccountAlias,
      },
      body: JSON.stringify({
        operation_ref: operationRef,
        args: options.args && typeof options.args === 'object' ? options.args : {},
      }),
    });
  } catch (error) {
    return { ok: false, error: `과거 조회 실패 — ${String((error && error.message) || error)}`, candles: [] };
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    return {
      ok: false,
      error: `과거 조회 거부(HTTP ${response.status})${detail && detail.detail ? ` — ${detail.detail}` : ''}`,
      candles: [],
    };
  }
  const body = await response.json().catch(() => null);
  const candles = body && Array.isArray(body.candles) ? body.candles : [];
  if (!candles.length) return { ok: false, error: '과거 봉이 없다', candles: [] };
  return { ok: true, candles, trId: body.tr_id || null };
}

module.exports = { fetchChartPage };
