"""캔버스 사이드 채널 — 게이트웨이가 채운 카드 봉투를 앱으로 직접 민다.

2026-08-19 실측 배경: render_canvas의 plan_token 지름길(athena_mcp/canvas_data.py)이
봉투를 툴 결과에 실었더니 claude CLI의 툴 결과 잘림 한도에 걸려 카드가 깨졌다 —
카드 데이터는 모델 스트림을 타면 안 된다(사용자 지시 "캔버스 먼저, 채팅은 요약만").
POST /api/v1/canvas/push(게이트웨이 → 큐) + /api/v1/ws/canvas(앱 구독)로 루틴
알림(routines_ws.py)과 같은 문법의 전용 채널을 둔다. 인증도 같은 배타 2모드
(ws_auth) — LLM 노출 아님(셀렉터 4툴 계약과 무관한 로컬 배관).
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Request, Response, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# OptionalOrderClientDep/OptionalWsClientDep는 llm_tools.py가 정의한다 —
# call과 같은 주입 의미론(부재는 주입이 아니라 dispatch에서 에러)을 그대로 쓴다.
from athena_api.api.llm_tools import OptionalOrderClientDep, OptionalWsClientDep
from athena_api.api.ws_auth import authenticate_downstream_ws
from athena_api.api.ws_pump import pump_queue_to_websocket
from athena_api.canvas_transform import build_chart_bars, build_table
from athena_api.dependencies import (
    AccountAliasDep,
    KiwoomClientDep,
    SelectorServiceDep,
)
from athena_api.selector.schemas import CallRequest

router = APIRouter(tags=["canvas side-channel"])


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
    """캐시 리플레이(앱 빠른 경로) — 이미 내린 LLM 판정의 재실행 요청.

    모델을 거치지 않는다: 앱이 저장해 둔 판정(오퍼레이션·인자·카드 구성)을
    resolve로 재서명해 얻은 plan_token과 함께 보내면, 이 라우트가 실행·변환·
    사이드 채널 푸시까지 한 번에 한다. 규칙 기반 신규 판단이 아니라 **과거 LLM
    판정의 조회 인덱스**다(AITS L1/L2 캐시의 정당화 논리와 동일). LLM 비노출.
    """

    plan_token: str = Field(min_length=1)
    canvas_type: str = Field(pattern="^(chart|table)$")
    data: dict[str, Any] = Field(default_factory=dict)
    caption: str | None = None


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
    queue = getattr(request.app.state, "canvas_events", None)
    if queue is None:
        return JSONResponse(
            status_code=503, content={"detail": "캔버스 채널이 준비되지 않았다"}
        )

    # 주문 확인 헤더를 아예 받지 않는다 — 조회 plan만 실행 가능(주문 plan은
    # selector.call의 3중 게이트가 헤더 부재로 거부한다).
    call_response = await selector.call(
        CallRequest(plan_token=payload.plan_token),
        request,
        response,
        client,
        account=account,
        order_client=order_client,
        ws_client=ws_client,
    )
    call_payload = call_response.model_dump()

    if payload.canvas_type == "chart":
        built = build_chart_bars(call_payload)
        if isinstance(built, str):
            return JSONResponse(status_code=422, content={"detail": f"차트 변환 실패: {built}"})
        bars, meta = built
        symbol = payload.data.get("symbol")
        if not isinstance(symbol, str) or not symbol:
            return JSONResponse(
                status_code=422, content={"detail": "차트에는 data.symbol이 필요하다"}
            )
        data: dict[str, Any] = {"symbol": symbol, "bars": bars}
        if isinstance(payload.data.get("name"), str):
            data["name"] = payload.data["name"]
    else:
        built = build_table(call_payload)
        if isinstance(built, str):
            return JSONResponse(status_code=422, content={"detail": f"테이블 변환 실패: {built}"})
        data, meta = built

    envelope = {
        "canvas_type": payload.canvas_type,
        "fell_back": False,
        "fallback_reason": None,
        "caption": payload.caption,
        "data": data,
        "layout": None,
        "drop_types": [],
    }
    _enqueue_envelope(queue, envelope)
    return JSONResponse(
        content={"queued": True, "canvas_type": payload.canvas_type, "summary": meta}
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
