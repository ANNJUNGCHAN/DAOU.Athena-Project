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

from fastapi import APIRouter, Request, WebSocket
from fastapi.responses import JSONResponse

from athena_api.api.ws_auth import authenticate_downstream_ws
from athena_api.api.ws_pump import pump_queue_to_websocket

router = APIRouter(tags=["canvas side-channel"])


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
    # 큐가 가득 차도 최신 카드가 이긴다 — 가장 오래된 것을 버리고 넣는다
    # (routines runtime의 notify와 같은 정책).
    while True:
        try:
            queue.put_nowait(envelope)
            break
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
    return JSONResponse(content={"queued": True})


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
