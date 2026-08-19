"""Authenticated downstream fanout of Kiwoom REAL WebSocket events.

이 엔드포인트는 키움 REAL 이벤트 전용이다 — 루틴 알림은 별도 라우트
(`routines_ws.py`)로 분리한다(의미를 섞으면 클라이언트 파싱 책임이 흐려진다).
인증 의미론은 `ws_auth.authenticate_downstream_ws`로, 이벤트 펌프는
`ws_pump.pump_queue_to_websocket`로 추출됐다(동작 불변 — 기존 테스트 전건이 고정).
"""
from __future__ import annotations

from fastapi import APIRouter, WebSocket

from athena_api.api.ws_auth import authenticate_downstream_ws
from athena_api.api.ws_pump import pump_queue_to_websocket
from athena_api.dependencies import KiwoomWsClientDep

router = APIRouter(tags=["Kiwoom WebSocket stream"])


@router.websocket("/api/v1/ws/stream", name="kiwoom_real_stream")
async def kiwoom_real_stream(websocket: WebSocket, client: KiwoomWsClientDep) -> None:
    await websocket.accept()
    if not await authenticate_downstream_ws(websocket):
        return

    queue = client.subscribe_events()
    try:
        await pump_queue_to_websocket(websocket, queue)
    finally:
        client.unsubscribe_events(queue)
