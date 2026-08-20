"""캔버스 사이드 채널 — 게이트웨이가 채운 카드 봉투를 앱으로 직접 민다.

2026-08-19 실측 배경: render_canvas의 plan_token 지름길(athena_mcp/canvas_data.py)이
봉투를 툴 결과에 실었더니 claude CLI의 툴 결과 잘림 한도에 걸려 카드가 깨졌다 —
카드 데이터는 모델 스트림을 타면 안 된다(사용자 지시 "캔버스 먼저, 채팅은 요약만").
POST /api/v1/canvas/push(게이트웨이 → 큐) + /api/v1/ws/canvas(앱 구독)로 루틴
알림(routines_ws.py)과 같은 문법의 전용 채널을 둔다. 인증도 같은 배타 2모드
(ws_auth) — LLM 노출 아님(셀렉터 4툴 계약과 무관한 로컬 배관).

**카드 종류는 caller가 아니라 manifest가 결정한다**(P1b, 2026-08-20 — 계획
`plan/공통화면-템플릿-실행계획-2026-08-20.md`). `RenderPlanRequest.canvas_type`은
앱이 캐시에 저장해 둔 과거 LLM 판정의 재생 힌트일 뿐, 실행 결과 `operation_ref`로
`canvas_transform.resolve_render_plan_kind`(경유 `screen_manifest`)를 조회한 값이
다르면 manifest가 이기고 불일치를 로그로 남긴다(무음 불일치 금지). manifest가
지원하지 않는 카드(event/action/status, 미등록 operation_ref)면 422가 아니라
free 카드로 폴백한다(canvas_data.py::render_with_plan과 동일 정책·동일 함수).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Request, Response, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# OptionalOrderClientDep/OptionalWsClientDep는 llm_tools.py가 정의한다 —
# call과 같은 주입 의미론(부재는 주입이 아니라 dispatch에서 에러)을 그대로 쓴다.
from athena_api.api.llm_tools import OptionalOrderClientDep, OptionalWsClientDep
from athena_api.api.ws_auth import authenticate_downstream_ws
from athena_api.api.ws_pump import pump_queue_to_websocket
from athena_api.canvas_transform import (
    build_chart_bars,
    build_compound_generic,
    build_facts,
    build_table,
    describe_unsupported_render_plan_kind,
    resolve_render_plan_kind,
)
from athena_api.dependencies import (
    AccountAliasDep,
    KiwoomClientDep,
    SelectorServiceDep,
)
from athena_api.selector.schemas import CallRequest

logger = logging.getLogger(__name__)

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
    """캐시 리플레이(앱 빠른 경로) — 이미 내린 LLM 판정의 재실행 요청.

    모델을 거치지 않는다: 앱이 저장해 둔 판정(오퍼레이션·인자·카드 구성)을
    resolve로 재서명해 얻은 plan_token과 함께 보내면, 이 라우트가 실행·변환·
    사이드 채널 푸시까지 한 번에 한다. 규칙 기반 신규 판단이 아니라 **과거 LLM
    판정의 조회 인덱스**다(AITS L1/L2 캐시의 정당화 논리와 동일). LLM 비노출.

    `canvas_type`은 P1b(2026-08-20)부터 캐시가 재생하는 과거 힌트일 뿐 카드
    종류를 결정하지 않는다 — 실행 결과 `operation_ref`로 manifest를 조회한
    값이 최종 authority다(모듈 docstring 참조). 패턴은 render-plan이 실제로
    낼 수 있는 4종(facts/table/compound/chart)을 전부 받아야 한다 — 안 그러면
    facts/compound 요청이 manifest 조회에 닿기도 전에 여기서 422로 죽는다
    (계획 §Q3 [r5·Critic 잔여]).
    """

    plan_token: str = Field(min_length=1)
    canvas_type: str = Field(pattern="^(chart|table|facts|compound)$")
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

    operation_ref = call_payload.get("operation_ref")
    canvas_kind = resolve_render_plan_kind(operation_ref)

    if canvas_kind is None:
        reason = describe_unsupported_render_plan_kind(operation_ref)
        logger.warning(
            "canvas_render_plan free 폴백 — operation_ref=%s caller_canvas_type=%s 사유=%s",
            operation_ref,
            payload.canvas_type,
            reason,
        )
        envelope = {
            "canvas_type": "free",
            "fell_back": True,
            "fallback_reason": reason,
            "caption": payload.caption,
            "data": call_payload,
            "layout": None,
            "drop_types": [],
        }
        _enqueue_envelope(queue, envelope)
        return JSONResponse(
            content={
                "queued": True,
                "canvas_type": "free",
                "summary": {"fell_back": True, "fallback_reason": reason},
            }
        )

    if payload.canvas_type != canvas_kind:
        logger.warning(
            "canvas_render_plan canvas_type 불일치 — caller=%s manifest=%s "
            "operation_ref=%s (manifest가 이긴다)",
            payload.canvas_type,
            canvas_kind,
            operation_ref,
        )

    if canvas_kind == "chart":
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
    elif canvas_kind == "table":
        built = build_table(call_payload)
        if isinstance(built, str):
            return JSONResponse(status_code=422, content={"detail": f"테이블 변환 실패: {built}"})
        data, meta = built
    else:  # facts / compound — TR 응답 본문만(위 _BUILD_FROM_TR_DATA 주석)
        tr_data = call_payload.get("data")
        if not isinstance(tr_data, dict):
            tr_data = {}
        built = _BUILD_FROM_TR_DATA[canvas_kind](tr_data)
        if isinstance(built, str):
            return JSONResponse(
                status_code=422, content={"detail": f"{canvas_kind} 변환 실패: {built}"}
            )
        data, meta = built

    envelope = {
        "canvas_type": canvas_kind,
        "fell_back": False,
        "fallback_reason": None,
        "caption": payload.caption,
        "data": data,
        "layout": None,
        "drop_types": [],
    }
    _enqueue_envelope(queue, envelope)
    return JSONResponse(
        content={"queued": True, "canvas_type": canvas_kind, "summary": meta}
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
