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

안전 성질: 이 경로는 주문 확인 헤더(X-Athena-Confirm 등)를 절대 싣지 않는다 —
주문 계획이 넘어와도 백엔드의 3중 게이트가 헤더 부재로 거부한다(조회 전용).
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from mcp import types

# 순수 변환은 백엔드 단일 소재지로 이동(athena_api/canvas_transform.py) —
# 캐시 리플레이 라우트와 공용이다. 여기서는 재수출만 한다(테스트·호출부 계약 유지 —
# `as` 동일명 별칭은 의도적 재수출 표기라 ruff가 지우지 않는다).
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
    build_table as build_table,
)
from athena_mcp.canvas import validate_canvas_payload


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
    canvas_type = arguments.get("canvas_type")
    if canvas_type not in ("chart", "table"):
        return _error(
            "plan_token 데이터 지름길은 canvas_type 'chart'/'table'만 지원한다 — "
            "다른 카드는 athena_call로 데이터를 받아 직접 구성하라"
        )

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

    model_data = arguments.get("data") or {}
    if canvas_type == "chart":
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
    else:
        built = build_table(call_payload)
        if isinstance(built, str):
            return _error(f"테이블 변환 실패: {built}")
        data, meta = built

    result = validate_canvas_payload(canvas_type, data)
    payload = {
        "canvas_type": result.canvas_type,
        "fell_back": result.fell_back,
        "fallback_reason": result.fallback_reason,
        "caption": arguments.get("caption"),
        "data": result.data,
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
            "canvas_type": result.canvas_type,
            # 파서(stream-json-parser.js)가 이 플래그로 'pushed' 분류를 한다 —
            # 앱은 이 결과로 카드를 그리지 않는다(사이드 채널이 이미 그렸다).
            "pushed": True,
            "fell_back": result.fell_back,
            "fallback_reason": result.fallback_reason,
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
