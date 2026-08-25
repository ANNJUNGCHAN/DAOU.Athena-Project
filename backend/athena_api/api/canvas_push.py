
from __future__ import annotations

import asyncio
import logging
import time
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Request, Response, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

# OptionalOrderClientDep/OptionalWsClientDep는 llm_tools.py가 정의한다 —
# call과 같은 주입 의미론(부재는 주입이 아니라 dispatch에서 에러)을 그대로 쓴다.
from athena_api.api.llm_tools import OptionalOrderClientDep, OptionalWsClientDep
from athena_api.api.ws_auth import authenticate_downstream_ws
from athena_api.api.ws_pump import pump_queue_to_websocket
from athena_api.canvas_transform import (
    build_aits_chart_envelope_data,
    build_compound_generic,
    build_facts,
    build_table,
    describe_unsupported_render_plan_kind,
    resolve_screen_render_contract,
)
from athena_api.dependencies import (
    AccountAliasDep,
    KiwoomClientDep,
    SelectorServiceDep,
)
from athena_api.errors import KiwoomError
from athena_api.selector.schemas import CallRequest

logger = logging.getLogger(__name__)

_INLINE_SERVER_BUDGET_MS = 2700

router = APIRouter(tags=["canvas side-channel"])

# facts/compound는 TR 응답 본문(`call_payload["data"]`)만 보고 top-level 스칼라를
# 뽑는다 — chart/table처럼 전체 응답 트리를 재귀 탐색하지 않는다. call_payload
# 전체를 넘기면 `operation_ref` 같은 봉투 필드를 TR 필드로 오인한다(canvas_data.py
# 동일 주석 참조, 실측 확인) — 반드시 `.get("data")`만 넘긴다.
_BUILD_FROM_TR_DATA = {
    "facts": build_facts,
    "compound": build_compound_generic,
}


def _enqueue_envelope(queue: asyncio.Queue, envelope: dict[str, Any]) -> None:
    """큐가 가득 차도 최신 카드가 이긴다 — 가장 오래된 것을 버리고 넣는다."""
    while True:
        try:
            queue.put_nowait(envelope)
            return
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass


@router.post("/api/v1/canvas/push", operation_id="canvas_push")
async def canvas_push(request: Request, envelope: dict[str, Any]) -> JSONResponse:
    if not isinstance(envelope.get("canvas_type"), str) or not envelope["canvas_type"]:
        return JSONResponse(
            status_code=422, content={"detail": "envelope에 canvas_type(str)이 필요하다"}
        )
    queue = getattr(request.app.state, "canvas_events", None)
    if queue is None:
        # fail-closed — 조용히 버리면 게이트웨이가 "밀었다"고 믿는다(정직성 위반).
        return JSONResponse(
            status_code=503, content={"detail": "캔버스 채널이 준비되지 않았다"}
        )
    _enqueue_envelope(queue, envelope)  # 최신 우선 — routines notify와 같은 정책
    return JSONResponse(content={"queued": True})


class RenderPlanRequest(BaseModel):

    plan_token: str = Field(min_length=1)
    canvas_type: Annotated[str, Field(pattern="^(chart|table|facts|compound)$")] | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    caption: str | None = None
    delivery: Literal["side_channel", "inline"] = "side_channel"
    dataset_id: str | None = Field(default=None, min_length=1, max_length=64)
    item_id: str | None = Field(default=None, min_length=1, max_length=128)
    ordinal: int | None = Field(default=None, ge=1, le=6)
    deadline_ms: int = Field(default=_INLINE_SERVER_BUDGET_MS, ge=100, le=3000)

    @model_validator(mode="after")
    def validate_correlation(self) -> RenderPlanRequest:
        correlation = (self.dataset_id, self.item_id, self.ordinal)
        if any(value is not None for value in correlation) and not all(
            value is not None for value in correlation
        ):
            raise ValueError("dataset_id, item_id, ordinal must be provided together")
        return self


def _correlation(payload: RenderPlanRequest) -> dict[str, str | int] | None:
    if payload.dataset_id is None:
        return None
    assert payload.item_id is not None and payload.ordinal is not None
    return {
        "dataset_id": payload.dataset_id,
        "item_id": payload.item_id,
        "ordinal": payload.ordinal,
    }


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 3)


def _is_empty_payload(value: Any) -> bool:
    if value is None or value == "":
        return True
    if isinstance(value, dict):
        return all(_is_empty_payload(item) for item in value.values())
    if isinstance(value, list):
        return all(_is_empty_payload(item) for item in value)
    return False


def _empty_canvas(kind: str) -> tuple[dict[str, Any], dict[str, Any]]:
    if kind == "facts":
        data: dict[str, Any] = {"fields": [], "empty_state": True}
    elif kind == "table":
        data = {"columns": [], "rows": [], "empty_state": True}
    else:
        data = {
            "header": [],
            "table": {"columns": [], "rows": []},
            "empty_state": True,
        }
    return data, {"empty_state": True}


def _timing(
    *, total_start: float, call_ms: float, transform_ms: float, delivery_ms: float
) -> dict[str, float]:
    return {
        "server_ms": _elapsed_ms(total_start),
        "call_ms": call_ms,
        "transform_ms": transform_ms,
        "delivery_ms": delivery_ms,
    }


def _display_receipt(
    *,
    delivery: Literal["side_channel", "inline"],
    canvas_kind: str,
    screen_id: str,
    meta: dict[str, Any],
    renderer_id: str | None = None,
) -> dict[str, Any]:
    """Return control metadata only; never copy rows, fields, values, or preview data."""
    receipt = {
        "pushed": delivery == "side_channel",
        "delivery": delivery,
        "canvas_type": canvas_kind,
        "screen_id": screen_id,
        "fell_back": False,
        "fallback_reason": None,
        "trimmed": bool(meta.get("trimmed") or meta.get("table_trimmed")),
        "partial": False,
        "cache_reused": False,
    }
    if renderer_id is not None:
        receipt["renderer_id"] = renderer_id
    return receipt


def _screen_contract(operation_ref: str | None) -> tuple[str, str, str | None] | None:
    resolved = resolve_screen_render_contract(operation_ref)
    return None if isinstance(resolved, str) else resolved


def _error_state_response(
    *,
    payload: RenderPlanRequest,
    operation_ref: str,
    canvas_kind: str,
    screen_id: str,
    renderer_id: str | None,
    state: Literal["timeout", "cancelled", "error"],
    code: str,
    retryable: bool,
    total_start: float,
    call_ms: float,
) -> JSONResponse:
    correlation = _correlation(payload)
    envelope: dict[str, Any] = {
        "canvas_type": canvas_kind,
        "screen_id": screen_id,
        "state": state,
        "fell_back": False,
        "fallback_reason": None,
        "caption": None,
        "layout": None,
        "drop_types": [],
        "error": {"code": code, "retryable": retryable},
    }
    if renderer_id is not None:
        envelope["renderer_id"] = renderer_id
    if correlation is not None:
        envelope["correlation"] = correlation
    receipt = _display_receipt(
        delivery="inline",
        canvas_kind=canvas_kind,
        screen_id=screen_id,
        meta={},
        renderer_id=renderer_id,
    )
    receipt.update({"state": state, "error_code": code})
    return JSONResponse(
        content={
            "delivery": "inline",
            "queued": False,
            "status": "error_rendered",
            "code": code,
            "operation_ref": operation_ref,
            "canvas_type": canvas_kind,
            "screen_id": screen_id,
            "correlation": correlation,
            "envelope": envelope,
            "receipt": receipt,
            "timing": _timing(
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=0.0,
                delivery_ms=0.0,
            ),
            "next_actions": ["retry_query"] if retryable else [],
        }
    )


def _render_error(
    *,
    payload: RenderPlanRequest,
    status_code: int,
    code: str,
    detail: str,
    operation_ref: str | None,
    total_start: float,
    call_ms: float = 0.0,
    transform_ms: float = 0.0,
    next_actions: list[str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "delivery": payload.delivery,
            "queued": False,
            "status": "rejected" if call_ms == 0.0 else "transform_error",
            "code": code,
            "detail": detail,
            "operation_ref": operation_ref,
            "canvas_type": None,
            "correlation": _correlation(payload),
            "envelope": None,
            "receipt": None,
            "timing": _timing(
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=transform_ms,
                delivery_ms=0.0,
            ),
            "next_actions": next_actions or [],
        },
    )


@router.post("/api/v1/canvas/render-plan", operation_id="canvas_render_plan")
async def canvas_render_plan(
    payload: RenderPlanRequest,
    request: Request,
    response: Response,
    client: KiwoomClientDep,
    order_client: OptionalOrderClientDep,
    ws_client: OptionalWsClientDep,
    selector: SelectorServiceDep,
    account: AccountAliasDep,
) -> JSONResponse:
    total_start = time.perf_counter()
    correlation = _correlation(payload)
    # Every render-plan delivery is a read-only Kiwoom REST surface. Verify the
    # signed identity before inspecting delivery or dispatching so a default
    # side-channel request cannot register/remove WebSocket state or place an
    # order and only fail later during manifest transformation. Rejected
    # non-query tokens are deliberately burned: verification succeeded and the
    # caller spent this one-use execution attempt, matching selector.call's
    # established failure-after-verification nonce policy.
    verified_plan = selector.signer.verify(
        payload.plan_token, selector.catalog, expected_account=account
    )
    document = selector.catalog.find_exact(verified_plan.operation_ref)
    if document is None or document.kind != "query":
        selector._consume_nonce(verified_plan)
        return _render_error(
            payload=payload,
            status_code=422,
            code="INLINE_QUERY_ONLY",
            detail="canvas render-plan accepts signed query plans only",
            operation_ref=verified_plan.operation_ref,
            total_start=total_start,
            next_actions=["resolve_query_plan"],
        )

    queue = getattr(request.app.state, "canvas_events", None)
    if payload.delivery == "side_channel" and queue is None:
        return JSONResponse(
            status_code=503, content={"detail": "캔버스 채널이 준비되지 않았다"}
        )

    inline_contract: tuple[str, str, str | None] | None = None
    inline_operation_ref: str | None = None
    if payload.delivery == "inline":
        inline_operation_ref = verified_plan.operation_ref
        inline_contract = _screen_contract(inline_operation_ref)
        if inline_contract is None:
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_COVERAGE_MISSING",
                detail="signed query plan has no authoritative read/display screen contract",
                operation_ref=inline_operation_ref,
                total_start=total_start,
                next_actions=["register_manifest_screen"],
            )

    # 주문 확인 헤더를 아예 받지 않는다 — 조회 plan만 실행 가능(주문 plan은
    # selector.call의 3중 게이트가 헤더 부재로 거부한다).
    call_start = time.perf_counter()
    try:
        if inline_contract is None:
            call_response = await selector.call(
                CallRequest(plan_token=payload.plan_token),
                request,
                response,
                client,
                account=account,
                order_client=order_client,
                ws_client=ws_client,
            )
        else:
            budget_ms = min(payload.deadline_ms, _INLINE_SERVER_BUDGET_MS)
            async with asyncio.timeout(budget_ms / 1000):
                call_response = await selector.call(
                    CallRequest(plan_token=payload.plan_token),
                    request,
                    response,
                    client,
                    account=account,
                    order_client=None,
                    ws_client=None,
                )
    except TimeoutError:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="timeout",
            code="UPSTREAM_TIMEOUT",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
        )
    except httpx.TimeoutException:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="timeout",
            code="UPSTREAM_TIMEOUT",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
        )
    except asyncio.CancelledError:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="cancelled",
            code="UPSTREAM_CANCELLED",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
        )
    except KiwoomError:
        if inline_contract is None or inline_operation_ref is None:
            raise
        return _error_state_response(
            payload=payload,
            operation_ref=inline_operation_ref,
            canvas_kind=inline_contract[0],
            screen_id=inline_contract[1],
            renderer_id=inline_contract[2],
            state="error",
            code="UPSTREAM_ERROR",
            retryable=True,
            total_start=total_start,
            call_ms=_elapsed_ms(call_start),
        )
    call_ms = _elapsed_ms(call_start)
    call_payload = call_response.model_dump()

    transform_start = time.perf_counter()
    operation_ref = call_payload.get("operation_ref")
    screen_contract = inline_contract or _screen_contract(operation_ref)

    if screen_contract is None:
        reason = describe_unsupported_render_plan_kind(operation_ref)
        logger.warning(
            "canvas_render_plan coverage 결함 — operation_ref=%s caller_canvas_type=%s 사유=%s",
            operation_ref,
            payload.canvas_type,
            reason,
        )
        transform_ms = _elapsed_ms(transform_start)
        return _render_error(
            payload=payload,
            status_code=422,
            code="CANVAS_COVERAGE_MISSING",
            detail=reason,
            operation_ref=operation_ref,
            total_start=total_start,
            call_ms=call_ms,
            transform_ms=transform_ms,
            next_actions=["register_manifest_screen"],
        )
    canvas_kind, screen_id, renderer_id = screen_contract

    if payload.canvas_type is not None and payload.canvas_type != canvas_kind:
        logger.warning(
            "canvas_render_plan canvas_type 불일치 — caller=%s manifest=%s "
            "operation_ref=%s (manifest가 이긴다)",
            payload.canvas_type,
            canvas_kind,
            operation_ref,
        )

    if canvas_kind == "chart":
        built = build_aits_chart_envelope_data(operation_ref, call_payload)
        if isinstance(built, str):
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_TRANSFORM_FAILED",
                detail=f"chart transform failed: {built}",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["resolve_again"],
            )
        aits_envelope, meta = built
        if aits_envelope["renderer_id"] != renderer_id:
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_COVERAGE_MISSING",
                detail="AITS renderer identity drifted during chart transform",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["register_manifest_screen"],
            )
        data: dict[str, Any] = aits_envelope["data"]
    elif canvas_kind == "table":
        if payload.delivery == "inline" and _is_empty_payload(call_payload.get("data")):
            built = _empty_canvas("table")
        else:
            built = build_table(call_payload)
        if isinstance(built, str):
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_TRANSFORM_FAILED",
                detail=f"table transform failed: {built}",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["resolve_again"],
            )
        data, meta = built
    else:  # facts / compound — TR 응답 본문만(위 _BUILD_FROM_TR_DATA 주석)
        tr_data = call_payload.get("data")
        if not isinstance(tr_data, dict):
            tr_data = {}
        if payload.delivery == "inline" and _is_empty_payload(tr_data):
            built = _empty_canvas(canvas_kind)
        else:
            built = _BUILD_FROM_TR_DATA[canvas_kind](tr_data)
        if isinstance(built, str):
            return _render_error(
                payload=payload,
                status_code=422,
                code="CANVAS_TRANSFORM_FAILED",
                detail=f"{canvas_kind} transform failed: {built}",
                operation_ref=operation_ref,
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=_elapsed_ms(transform_start),
                next_actions=["resolve_again"],
            )
        data, meta = built

    envelope = {
        "canvas_type": canvas_kind,
        "screen_id": screen_id,
        "fell_back": False,
        "fallback_reason": None,
        "caption": payload.caption,
        "data": data,
        "layout": None,
        "drop_types": [],
    }
    if renderer_id is not None:
        envelope["renderer_id"] = renderer_id
    if correlation is not None:
        envelope["correlation"] = correlation
    transform_ms = _elapsed_ms(transform_start)
    if payload.delivery == "inline":
        return JSONResponse(
            content={
                "delivery": "inline",
                "queued": False,
                "status": "rendered",
                "operation_ref": operation_ref,
                "canvas_type": canvas_kind,
                "screen_id": screen_id,
                "correlation": correlation,
                "envelope": envelope,
                "receipt": _display_receipt(
                    delivery="inline",
                    canvas_kind=canvas_kind,
                    screen_id=screen_id,
                    meta=meta,
                    renderer_id=renderer_id,
                ),
                "timing": _timing(
                    total_start=total_start,
                    call_ms=call_ms,
                    transform_ms=transform_ms,
                    delivery_ms=0.0,
                ),
                "next_actions": [],
            }
        )
    delivery_start = time.perf_counter()
    _enqueue_envelope(queue, envelope)
    delivery_ms = _elapsed_ms(delivery_start)
    return JSONResponse(
        content={
            "queued": True,
            "delivery": "side_channel",
            "status": "queued",
            "operation_ref": operation_ref,
            "canvas_type": canvas_kind,
            "screen_id": screen_id,
            "correlation": correlation,
            "envelope": None,
            "receipt": _display_receipt(
                delivery="side_channel",
                canvas_kind=canvas_kind,
                screen_id=screen_id,
                meta=meta,
                renderer_id=renderer_id,
            ),
            "timing": _timing(
                total_start=total_start,
                call_ms=call_ms,
                transform_ms=transform_ms,
                delivery_ms=delivery_ms,
            ),
            "next_actions": [],
        }
    )


@router.websocket("/api/v1/ws/canvas", name="canvas_side_channel")
async def canvas_side_channel(websocket: WebSocket) -> None:
    await websocket.accept()
    if not await authenticate_downstream_ws(websocket):
        return
    queue = getattr(websocket.app.state, "canvas_events", None)
    if queue is None:
        # 준비 안 된 배포 — 조용한 무한대기 대신 정직하게 닫는다(1013 = try later).
        await websocket.close(code=1013)
        return
    await pump_queue_to_websocket(websocket, queue)
