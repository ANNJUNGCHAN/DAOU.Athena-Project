// 수급 시계열 조회 — 백엔드 /api/v1/canvas/series-page를 부른다.
//
// chart-history-page와 같은 결이다: 화면을 그리는 요청이 아니라 데이터만 가져오는
// 요청이라 렌더 파이프라인(runDirectRestDataset)을 타지 않는다. 그 경로는
// activeRestRun을 공유해 진행 중인 조회를 abort시키고 패널 권위 수명에 엮인다.
'use strict';

const BACKEND_ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

// 한 TR의 여러 열을 **한 번에** 받는다. 개인·기관·외국인을 따로 부르면 같은
// 응답을 세 번 받는 셈이고 리미터도 세 배로 쓴다.
async function fetchChartSeries(opts) {
  const o = opts || {};
  const backendBase = o.backendBase;
  const backendAccountAlias = String(o.backendAccountAlias || '');
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const body = {
    operation_ref: String(o.operationRef || ''),
    args: o.args && typeof o.args === 'object' ? o.args : {},
    fields: Array.isArray(o.fields) ? o.fields.filter(Boolean) : [],
  };
  // 장중 계약(tm 축)만 쓴다. TR 인자가 아니라 응답 해석용 맥락이라 args와 분리돼 있다
  // — ka10064의 input.field_allowlist에는 base_dt가 없다(실측).
  if (o.baseDt) body.base_dt = String(o.baseDt);

  if (!BACKEND_ALIAS_PATTERN.test(backendAccountAlias)) {
    return { ok: false, error: '조회에 사용할 서버 계좌가 연결되지 않았다', series: [] };
  }
  if (!body.operation_ref) return { ok: false, error: 'operationRef가 비었다', series: [] };
  if (!body.fields.length) return { ok: false, error: '그릴 열이 비었다', series: [] };

  let res;
  try {
    res = await fetchImpl(`${backendBase}/api/v1/canvas/series-page`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Athena-Account': backendAccountAlias,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: `수급 조회 실패 — ${String((err && err.message) || err)}`, series: [] };
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    return {
      ok: false,
      error: `수급 조회 거부(HTTP ${res.status})${detail && detail.detail ? ` — ${detail.detail}` : ''}`,
      series: [],
    };
  }
  const payload = await res.json().catch(() => null);
  const series = payload && Array.isArray(payload.series) ? payload.series : [];
  // 빈 응답을 성공으로 넘기지 않는다 — 값이 없는 것과 못 만든 것은 다르지만,
  // 둘 다 pane을 만들면 안 되는 건 같다(§8 빈 pane 금지).
  if (!series.length) return { ok: false, error: '수급 값이 없다', series: [] };
  return { ok: true, series, trId: payload.tr_id || null, trimmed: !!payload.trimmed };
}

module.exports = { fetchChartSeries };
