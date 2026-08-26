
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
    TABLE_ROWS_MAX as TABLE_ROWS_MAX,
)
from athena_api.canvas_transform import (
    build_aits_chart_envelope_data as build_aits_chart_envelope_data,
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
    resolve_fixed_card_title as resolve_fixed_card_title,
)
from athena_api.canvas_transform import (
    resolve_render_plan_kind as resolve_render_plan_kind,
)
from athena_api.screen_manifest import get_mapping
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


_WS_RECEIPTS = {
    "started": "실시간 데이터 수신을 시작했습니다. 캔버스에서 확인하세요.",
    "stopped": "실시간 데이터 수신을 중지했습니다.",
    "reconnecting": "실시간 데이터 연결을 복구하고 있습니다. 캔버스에서 확인하세요.",
    "reconnected": "실시간 데이터 연결을 복구했습니다. 캔버스에서 확인하세요.",
    "error": "실시간 데이터 연결에 실패했습니다. 인증 및 연결 상태를 확인하세요.",
}


def _result_payload(result: types.CallToolResult) -> dict[str, Any] | None:
    """CallToolResult의 JSON 객체만 읽는다. 원문은 새 결과에 복제하지 않는다."""
    if isinstance(result.structuredContent, dict):
        return result.structuredContent
    if not result.content or not isinstance(result.content[0], types.TextContent):
        return None
    try:
        payload = json.loads(result.content[0].text)
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _ws_state(payload: dict[str, Any]) -> str | None:
    data = payload.get("data")
    if not isinstance(data, dict):
        data = {}

    return_code = data.get("return_code", payload.get("return_code"))
    if return_code is not None and str(return_code).strip() not in {"0", "+0", "00"}:
        return "error"

    raw_state = data.get("lifecycle") or data.get("state")
    if not isinstance(raw_state, str):
        raw_state = payload.get("lifecycle") or payload.get("state")
    if isinstance(raw_state, str):
        normalized = raw_state.strip().lower().replace("-", "_")
        aliases = {
            "start": "started",
            "starting": "started",
            "running": "started",
            "stop": "stopped",
            "stopping": "stopped",
            "reconnect": "reconnecting",
            "retrying": "reconnecting",
            "connected": "reconnected",
            "failed": "error",
            "failure": "error",
            "disconnected": "error",
        }
        normalized = aliases.get(normalized, normalized)
        if normalized in _WS_RECEIPTS:
            return normalized

    trnm = data.get("trnm", payload.get("trnm"))
    if trnm == "REG":
        return "started"
    if trnm == "REMOVE":
        return "stopped"
    return None


def websocket_lifecycle_receipt(result: types.CallToolResult) -> types.CallToolResult:
    """키움 WebSocket 응답을 값 없는 수명주기 영수증으로 바꾼다.

    일반 query/order 결과는 그대로 둔다. WebSocket 여부는 문자열 패턴이 아니라
    canonical screen manifest의 ``classification``으로 판정한다. 성공 HTTP 응답이어도
    ACK가 알 수 없는 상태이거나 화면 계약이 없으면 frame/data를 내보내지 않고
    명시적 오류로 닫는다.
    """
    if result.isError:
        return result
    payload = _result_payload(result)
    if payload is None:
        return result
    operation_ref = payload.get("operation_ref")
    if not isinstance(operation_ref, str):
        return result
    mapping = get_mapping(operation_ref)
    if mapping is None:
        return result
    classification = mapping.get("classification")
    if not isinstance(classification, dict) or classification.get("category") != "websocket":
        return result

    screen_reference = mapping.get("screen_reference")
    if not isinstance(screen_reference, dict) or not screen_reference.get("screen_id"):
        return _error(f"키움 화면 계약 누락: {operation_ref}의 screen_reference")

    state = _ws_state(payload)
    if state is None:
        return _error("실시간 데이터 상태를 확인할 수 없습니다. 연결 상태를 다시 확인하세요.")
    receipt = {"lifecycle": state, "receipt": _WS_RECEIPTS[state]}
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(receipt, ensure_ascii=False))],
        structuredContent=receipt,
        isError=state == "error",
    )


async def render_with_plan(
    arguments: dict[str, Any],
    http_client: httpx.AsyncClient,
    *,
    call_timeout_seconds: float,
) -> types.CallToolResult:
    """plan_token을 게이트웨이가 직접 실행해 카드 봉투를 채운다.

    전체 카드 봉투는 side-channel로만 전달한다. 성공한 tool result에는 값이나
    요약 없이 display receipt만 반환한다.
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
    mapping = get_mapping(operation_ref) if isinstance(operation_ref, str) else None
    if mapping is None:
        return _error(f"키움 화면 계약 누락: {operation_ref!r}의 mapping")
    screen_reference = mapping.get("screen_reference")
    if not isinstance(screen_reference, dict) or not screen_reference.get("screen_id"):
        return _error(f"키움 화면 계약 누락: {operation_ref}의 screen_reference")
    canvas_kind = resolve_render_plan_kind(operation_ref)

    if canvas_kind is None:
        reason = describe_unsupported_render_plan_kind(operation_ref)
        logger.error(
            "render_with_plan coverage 결함 — operation_ref=%s model_canvas_type=%s 사유=%s",
            operation_ref,
            model_canvas_type,
            reason,
        )
        return _error(
            f"키움 화면 계약 오류: {operation_ref}의 presentation은 plan 렌더 대상이 아니다"
        )

    if model_canvas_type is not None and model_canvas_type != canvas_kind:
        logger.warning(
            "render_with_plan canvas_type 불일치 — model=%s manifest=%s "
            "operation_ref=%s (manifest가 이긴다)",
            model_canvas_type,
            canvas_kind,
            operation_ref,
        )

    if canvas_kind == "chart":
        built = build_aits_chart_envelope_data(operation_ref, call_payload)
        if isinstance(built, str):
            return _error(f"차트 변환 실패: {built}")
        chart_envelope, meta = built
        renderer_id = chart_envelope["renderer_id"]
        data = chart_envelope["data"]
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

    if canvas_kind == "chart":
        # AITS 차트는 generated manifest/screen definition의 renderer·JSONPath
        # 계약으로 이미 검증됐다. legacy MCP chart schema(bars)를 통과시키거나
        # caller data로 재검증하면 계약이 다시 낡은 형상으로 퇴행한다.
        result_canvas_type = "chart"
        result_fell_back = False
        result_fallback_reason = None
        result_data = data
    else:
        renderer_id = None
        result = validate_canvas_payload(canvas_kind, data)
        if result.fell_back:
            return _error(
                f"키움 화면 계약 오류: {operation_ref}의 {canvas_kind} payload가 "
                "manifest와 맞지 않는다"
            )
        result_canvas_type = result.canvas_type
        result_fell_back = result.fell_back
        result_fallback_reason = result.fallback_reason
        result_data = result.data

    payload = {
        "canvas_type": result_canvas_type,
        "fell_back": result_fell_back,
        "fallback_reason": result_fallback_reason,
        "caption": arguments.get("caption"),
        # TR이 Paper 보드 12d 카드 16종 중 하나로 확정되면 카드 헤드는 이
        # 고정 이름을 타이틀로 쓰고, 위 caption(종목명·주기 등 가변 정보)은
        # 서브타이틀로 내려간다(app/canvas.js makeCard). 16종 밖이면 None —
        # 렌더러가 기존처럼 caption을 타이틀로 쓴다(정보 손실 없음).
        "card_title": resolve_fixed_card_title(operation_ref),
        "data": result_data,
        "layout": None,
        "drop_types": [],
    }
    if renderer_id is not None:
        payload["renderer_id"] = renderer_id

    # 봉투는 사이드 채널(POST /canvas/push → 앱 WS)로만 민다. tool result에는
    # 데이터 요약도 싣지 않는다 — 성공한 캔버스 자체가 기본 답이다.
    push_note: str | None = None
    try:
        push_response = await http_client.post("/api/v1/canvas/push", json=payload, timeout=5.0)
        pushed = push_response.status_code < 400
        if not pushed:
            push_note = f"HTTP {push_response.status_code}"
    except httpx.HTTPError as exc:
        pushed = False
        push_note = str(exc)

    if pushed:
        receipt = {
            "canvas_type": result_canvas_type,
            # 파서(stream-json-parser.js)가 이 플래그로 'pushed' 분류를 한다 —
            # 앱은 이 결과로 카드를 그리지 않는다(사이드 채널이 이미 그렸다).
            "pushed": True,
            "fell_back": result_fell_back,
            "fallback_reason": result_fallback_reason,
            "trimmed": bool(meta.get("trimmed")),
            "partial": bool(meta.get("partial")),
        }
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=json.dumps(receipt, ensure_ascii=False))],
            structuredContent=receipt,
            isError=False,
        )

    # 키움 plan 경로에서는 full payload를 MCP tool result로 되돌리지 않는다.
    # push 실패는 성공으로 위장하거나 legacy free 카드로 강등하지 않고 명시 오류다.
    return _error(f"캔버스 push 실패: {push_note or '알 수 없는 오류'}")
