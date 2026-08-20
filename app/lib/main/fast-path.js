// 캐시 리플레이 실행기 — 모델 무호출 빠른 경로 (2026-08-19).
//
// 흐름: 저장된 판정 → 백엔드 resolve 재서명(새 plan_token) → /canvas/render-plan
// (실행·변환·사이드 채널 푸시를 백엔드가 한 번에) → 결정론 답변 텍스트.
// 카드는 WS 사이드 채널로 도착한다(캔버스 먼저) — 이 모듈은 채팅 답만 만든다.
// 답변은 결정론 템플릿(routine-turn.js와 같은 문법 — LLM 0)이라 지어낼 수 없고,
// "이전 해석 재사용"을 항상 밝힌다(정직성 — 새 판단인 척하지 않는다).
//
// canvasType은 P5(2026-08-20)부터 캐시 판정 객체(judgment)에 담기지 않는다 —
// 카드 종류는 이제 operation_ref의 순수 함수라 백엔드가 manifest 조회로
// 정하고(canvas_push.py::canvas_render_plan), 판정 시점의 모델 선택은 낡을
// 수 있다(캐시가 재생성 전 값을 들고 있을 수 있다). 그래서 이 모듈은
// render-plan 요청에 canvas_type을 아예 싣지 않고, 응답이 돌려준 실제 값
// (body.canvas_type)으로 답변 문구를 만든다 — 요청값이 아니라 응답값이
// 권위다(app/chat.js의 canvasTypeLabel 주석과 같은 원칙).
'use strict';

function comma(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return String(n);
  return n.toLocaleString('ko-KR');
}

// canvasType(응답이 돌려준 실제 카드 종류) + judgmentData(캐시된 요청 인자 —
// 종목명 라벨용) + summary(backend render-plan 응답) → 결정론 채팅 답변.
function buildReplayAnswer(canvasType, judgmentData, summary) {
  const s = summary || {};
  const suffix = ' (같은 질문의 이전 해석을 재사용했습니다 — 데이터는 방금 새로 조회)';
  if (canvasType === 'chart') {
    const label = (judgmentData && (judgmentData.name || judgmentData.symbol)) || '요청 종목';
    const parts = [`${label} 차트를 캔버스에 띄웠습니다`];
    if (s.rows_kept != null && s.first_time && s.last_time) {
      parts.push(`— 최근 ${s.rows_kept}봉(${s.first_time}~${s.last_time})`);
    }
    if (s.latest_close != null) parts.push(`, 최근 종가 ${comma(s.latest_close)}원`);
    if (s.trimmed) parts.push(`. 전체 ${s.rows_total}봉 중 최근 구간 기준입니다`);
    return parts.join('') + '.' + suffix;
  }
  const cols = Array.isArray(s.columns) ? s.columns.length : null;
  return `표를 캔버스에 띄웠습니다 — ${s.rows_kept ?? '?'}행${cols ? ` · ${cols}열` : ''}.` + suffix;
}

// 반환: { ok, answerText?, summary?, reason?, durationMs }
// 실패는 조용히 삼키지 않고 reason으로 돌려준다 — 호출자가 정상 경로로 폴백하고
// 캐시를 무효화한다(잘못된 판정이 반복 리플레이되지 않게).
async function runCachedReplay({ judgment, backendBase, fetchImpl, clock }) {
  const doFetch = fetchImpl || fetch;
  const now = clock || Date.now;
  const startedAt = now();
  const fail = (reason) => ({ ok: false, reason, durationMs: now() - startedAt });

  let resolveRes;
  try {
    resolveRes = await doFetch(`${backendBase}/api/v1/llm/tools/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: judgment.resolveQuestion,
        intent: 'auto', // 조회 표면만 — 리플레이가 주문·실시간에 닿을 수 없다
        arguments: judgment.resolveArgs || {},
      }),
    });
  } catch (err) {
    return fail(`resolve 전송 오류: ${String((err && err.message) || err)}`);
  }
  if (!resolveRes.ok) return fail(`resolve HTTP ${resolveRes.status}`);
  let planToken;
  try {
    planToken = (await resolveRes.json()).plan_token;
  } catch {
    return fail('resolve 응답이 JSON이 아니다');
  }
  if (!planToken) return fail('plan_token 없음(인자 불충족 등) — 정상 경로로');

  let renderRes;
  try {
    renderRes = await doFetch(`${backendBase}/api/v1/canvas/render-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // canvas_type 필드를 아예 안 싣는다(P5) — RenderPlanRequest.canvas_type은
      // 이제 선택이고(canvas_push.py), 백엔드가 operation_ref로 manifest를
      // 조회해 카드 종류를 정한다. 캐시가 낡은 판정을 들고 있어도 여기서
      // 틀린 힌트를 보낼 일 자체가 없다.
      body: JSON.stringify({
        plan_token: planToken,
        data: judgment.data || {},
        caption: judgment.caption || null,
      }),
    });
  } catch (err) {
    return fail(`render-plan 전송 오류: ${String((err && err.message) || err)}`);
  }
  if (!renderRes.ok) return fail(`render-plan HTTP ${renderRes.status}`);
  let body;
  try {
    body = await renderRes.json();
  } catch {
    return fail('render-plan 응답이 JSON이 아니다');
  }

  return {
    ok: true,
    summary: body.summary,
    canvasType: body.canvas_type,
    answerText: buildReplayAnswer(body.canvas_type, judgment.data, body.summary),
    durationMs: now() - startedAt,
  };
}

module.exports = { runCachedReplay, buildReplayAnswer };
