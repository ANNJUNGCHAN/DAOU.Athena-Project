"""render_canvas의 plan_token 데이터 지름길 — 캔버스 우선, 데이터는 모델을 안 거친다.

2026-08-19 실측 배경: 차트 질의에서 모델이 athena_call로 받은 대형 응답을 컨텍스트에
삼키고(입력), 카드 봉투를 손으로 옮겨 적고(출력 — 가장 느린 구간), 그 봉투가 툴
결과로 또 에코됐다(입력). 같은 데이터가 모델을 세 번 통과한 것이다. 이 모듈은
그 경로를 뒤집는다(사용자 지시 "캔버스를 우선 구성하고, 필요 정보만 뽑아 답한다"):

    athena_resolve → plan_token → athena__render_canvas(plan_token, ...)
      → 게이트웨이가 백엔드에서 데이터를 직접 실행·변환해 봉투를 채운다
      → 봉투는 툴 결과에 실려 앱이 즉시 카드를 그리고(캔버스 먼저),
      → 모델은 payload.summary(최신값·기간·행수)만으로 채팅에 답한다.

변환은 전부 결정적이다(CLAUDE.md §7 — 모델 호출·무작위성 없음). 변환 불가능한
형상이면 조용히 그리지 않고 에러로 안내한다(athena_call 직접 경로가 폴백).

**카드 종류는 모델이 아니라 manifest가 결정한다**(P1b, 2026-08-20 — 계획
`plan/공통화면-템플릿-실행계획-2026-08-20.md`). 모델이 인자로 보낸 `canvas_type`은
더 이상 분기 조건이 아니라 감사용 힌트다 — plan을 실행해 얻은 `operation_ref`로
`athena_api.screen_manifest`(경유 `canvas_transform.resolve_render_plan_kind`)를
조회해 카드 종류를 결정하고, 모델의 힌트와 다르면 manifest가 이기며 불일치를 로그로
남긴다(무음 불일치 금지). manifest가 이 경로에서 지원하지 않는 카드(event/action/
status, 또는 미등록 operation_ref)를 가리키면 에러가 아니라 free 카드로 폴백한다
(크래시 대신 폴백, 사유를 응답에 남긴다 — canvas.py의 기존 폴백 철학과 동형).

안전 성질: 이 경로는 주문 확인 헤더(X-Athena-Confirm 등)를 절대 싣지 않는다 —
주문 계획이 넘어와도 백엔드의 3중 게이트가 헤더 부재로 거부한다(조회 전용).
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from mcp import types

# 순수 변환·manifest 기반 카드 종류 결정은 백엔드 단일 소재지로 이동
# (athena_api/canvas_transform.py) — 캐시 리플레이 라우트와 공용이다. 여기서는
# 재수출만 한다(테스트·호출부 계약 유지 — `as` 동일명 별칭은 의도적 재수출
# 표기라 ruff가 지우지 않는다).
from athena_api.canvas_transform import (
    BARS_MAX as BARS_MAX,
)
from athena_api.canvas_transform import (
    TABLE_ROWS_MAX as TABLE_ROWS_MAX,
)
from athena_api.canvas_transform import (
    build_chart_bars as build_chart_bars,
)
from athena_api.canvas_transform import (
    build_compound_generic as build_compound_generic,
)
from athena_api.canvas_transform import (
    build_facts as build_facts,
)
from athena_api.canvas_transform import (
    build_table as build_table,
)
from athena_api.canvas_transform import (
    describe_unsupported_render_plan_kind as describe_unsupported_render_plan_kind,
)
from athena_api.canvas_transform import (
    resolve_chart_initial_period as resolve_chart_initial_period,
)
from athena_api.canvas_transform import (
    resolve_render_plan_kind as resolve_render_plan_kind,
)
from athena_mcp.canvas import validate_canvas_payload

logger = logging.getLogger(__name__)

# facts/compound는 TR 응답 본문(`call_payload["data"]`)만 보고 top-level 스칼라를
# 뽑는다(canvas_transform.build_facts 계약) — chart/table처럼 전체 응답 트리를
# 재귀 탐색하지 않는다. call_payload 전체를 넘기면 `operation_ref` 같은 봉투
# 필드를 TR 필드로 오인한다(실측 확인) — 반드시 `.get("data")`만 넘긴다.
_BUILD_FROM_TR_DATA = {
    "facts": build_facts,
    "compound": build_compound_generic,
}


def _error(text: str) -> types.CallToolResult:
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=text)],
        isError=True,
    )


async def render_with_plan(
    arguments: dict[str, Any],
    http_client: httpx.AsyncClient,
    *,
    call_timeout_seconds: float,
) -> types.CallToolResult:
    """plan_token을 게이트웨이가 직접 실행해 카드 봉투를 채운다.

    반환 payload는 기존 `_render_canvas`와 같은 형상(앱 호환)에 `summary`가
    더해진다 — 모델은 데이터 대신 summary로 답한다.
    """
    plan_token = arguments["plan_token"]
    try:
        response = await http_client.post(
            "/api/v1/llm/tools/call",
            json={"plan_token": plan_token},
            timeout=call_timeout_seconds,
        )
    except httpx.ConnectError:
        return _error("키움 백엔드(127.0.0.1:8010)가 기동돼 있지 않다 — 사용자에게 안내하라")
    except httpx.HTTPError as exc:
        return _error(f"plan 실행 중 전송 오류: {exc}")
    if response.status_code >= 400:
        return _error(f"plan 실행 실패 (HTTP {response.status_code}): {response.text[:300]}")
    try:
        call_payload = response.json()
    except ValueError:
        return _error("plan 실행 응답이 JSON이 아니다")
    if not isinstance(call_payload, dict):
        call_payload = {}

    operation_ref = call_payload.get("operation_ref")
    model_canvas_type = arguments.get("canvas_type")
    canvas_kind = resolve_render_plan_kind(operation_ref)

    model_data = arguments.get("data") or {}

    if canvas_kind is None:
        reason = describe_unsupported_render_plan_kind(operation_ref)
        logger.warning(
            "render_with_plan free 폴백 — operation_ref=%s model_canvas_type=%s 사유=%s",
            operation_ref,
            model_canvas_type,
            reason,
        )
        result_canvas_type: str = "free"
        result_fell_back = True
        result_fallback_reason: str | None = reason
        result_data: dict[str, Any] = call_payload
        meta: dict[str, Any] = {"fell_back": True, "fallback_reason": reason}
    else:
        if model_canvas_type is not None and model_canvas_type != canvas_kind:
            logger.warning(
                "render_with_plan canvas_type 불일치 — model=%s manifest=%s "
                "operation_ref=%s (manifest가 이긴다)",
                model_canvas_type,
                canvas_kind,
                operation_ref,
            )

        if canvas_kind == "chart":
            built = build_chart_bars(call_payload)
            if isinstance(built, str):
                return _error(f"차트 변환 실패: {built}")
            bars, meta = built
            symbol = model_data.get("symbol")
            if not isinstance(symbol, str) or not symbol:
                return _error(
                    "차트 카드에는 data.symbol(종목코드)이 필요하다 — 인자에 넣어 다시 호출하라"
                )
            data: dict[str, Any] = {"symbol": symbol, "bars": bars}
            if isinstance(model_data.get("name"), str):
                data["name"] = model_data["name"]
            # P2a — 일/주/월/년봉 8TR만 실제 값을 준다(그 외는 None → 카드는
            # chart-card.js 자체 'D' 폴백을 쓴다, canvas_transform.py 함수 docstring).
            initial_period = resolve_chart_initial_period(operation_ref)
            if initial_period is not None:
                data["initial"] = {"period": initial_period}
        elif canvas_kind == "table":
            built = build_table(call_payload)
            if isinstance(built, str):
                return _error(f"테이블 변환 실패: {built}")
            data, meta = built
        else:  # facts / compound — TR 응답 본문만(위 _BUILD_FROM_TR_DATA 주석)
            tr_data = call_payload.get("data")
            if not isinstance(tr_data, dict):
                tr_data = {}
            built = _BUILD_FROM_TR_DATA[canvas_kind](tr_data)
            if isinstance(built, str):
                return _error(f"{canvas_kind} 변환 실패: {built}")
            data, meta = built

        result = validate_canvas_payload(canvas_kind, data)
        result_canvas_type = result.canvas_type
        result_fell_back = result.fell_back
        result_fallback_reason = result.fallback_reason
        result_data = result.data

    payload = {
        "canvas_type": result_canvas_type,
        "fell_back": result_fell_back,
        "fallback_reason": result_fallback_reason,
        "caption": arguments.get("caption"),
        "data": result_data,
        "layout": None,
        "drop_types": [],
    }

    # 봉투는 사이드 채널(POST /canvas/push → 앱 WS)로 민다 — 툴 결과에 실으면
    # claude CLI 잘림 한도에 걸려 카드가 깨진다(2026-08-19 프로브 실측). 모델에게는
    # summary만 돌려준다(사용자 지시 "캔버스 먼저, 채팅은 요약만").
    push_note: str | None = None
    try:
        push_response = await http_client.post(
            "/api/v1/canvas/push", json=payload, timeout=5.0
        )
        pushed = push_response.status_code < 400
        if not pushed:
            push_note = f"HTTP {push_response.status_code}"
    except httpx.HTTPError as exc:
        pushed = False
        push_note = str(exc)

    if pushed:
        small = {
            "canvas_type": result_canvas_type,
            # 파서(stream-json-parser.js)가 이 플래그로 'pushed' 분류를 한다 —
            # 앱은 이 결과로 카드를 그리지 않는다(사이드 채널이 이미 그렸다).
            "pushed": True,
            "fell_back": result_fell_back,
            "fallback_reason": result_fallback_reason,
            "caption": arguments.get("caption"),
            # 모델이 답변에 쓰는 요약 — 데이터 본문은 모델 스트림을 타지 않는다.
            # trimmed면 "최근 N행 기준"을 답변에 밝히는 것이 계약이다(프롬프트 v3d).
            "summary": meta,
        }
        return types.CallToolResult(
            content=[
                types.TextContent(type="text", text=json.dumps(small, ensure_ascii=False))
            ],
            structuredContent=small,
            isError=False,
        )

    # 푸시 실패 — 구식 경로(툴 결과에 봉투)로 후퇴한다. 잘릴 수 있으나 아무것도
    # 안 그리는 것보다 낫고, 실패 사실을 payload에 남긴다(조용한 강등 금지).
    payload["push_failed"] = push_note
    payload["summary"] = meta
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        structuredContent=payload,
        isError=False,
    )
