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

const { sanitizeCacheValue } = require('./query-cache');

// 성공 채팅은 데이터 요약이 아니라 표시 영수증이다. 가격·행·열·봉·기간은
// renderer-only envelope에 남기고, 캐시 무결성 사실만 고지한다.
function buildReplayAnswer() {
  return '캔버스에 표시했습니다. 이전 해석을 재사용했고 데이터는 새로 조회했습니다.';
}

// 반환: { ok, answerText?, summary?, reason?, durationMs }
// 실패는 조용히 삼키지 않고 reason으로 돌려준다 — 호출자가 정상 경로로 폴백하고
// 캐시를 무효화한다(잘못된 판정이 반복 리플레이되지 않게).
async function runCachedReplay({ judgment, backendBase, fetchImpl, clock }) {
  const safeJudgment = sanitizeCacheValue(judgment || {});
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
        question: safeJudgment.resolveQuestion,
        intent: safeJudgment.resolveIntent,
        // candidate_refs는 검색 힌트라 캐시하지 않는다. 반대로 아래 셋은
        // describe 뒤 확정한 canonical assertion이므로 매번 resolve에 다시 보내
        // 카탈로그 변경/소유권 불일치를 백엔드가 거부하게 한다.
        preferred_ref: safeJudgment.preferredRef,
        detail_group: safeJudgment.detailGroup,
        response_mode: safeJudgment.responseMode,
        arguments: safeJudgment.resolveArgs || {},
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
        caption: safeJudgment.caption || null,
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
    receipt: body.receipt,
    canvasType: body.canvas_type,
    answerText: buildReplayAnswer(),
    durationMs: now() - startedAt,
  };
}

module.exports = { runCachedReplay, buildReplayAnswer };
