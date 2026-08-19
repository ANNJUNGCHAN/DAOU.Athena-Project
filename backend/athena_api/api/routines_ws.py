"""루틴 알림 다운스트림 — /api/v1/ws/routines.

스케줄러가 넣는 발화·만료·복원실패 이벤트를 앱(Electron 메인)에 push한다.
인증은 stream과 같은 배타 2모드(`ws_auth`), 이벤트 펌프도 stream과 공용
(`ws_pump`). 소비자는 단일 앱 인스턴스 전제라 큐를 팬아웃하지 않고 그대로 비운다.
"""

from __future__ import annotations

from fastapi import APIRouter, WebSocket

from athena_api.api.ws_auth import authenticate_downstream_ws
from athena_api.api.ws_pump import pump_queue_to_websocket

router = APIRouter(tags=["routine notifications"])


@router.websocket("/api/v1/ws/routines", name="routine_notifications")
async def routine_notifications(websocket: WebSocket) -> None:
    await websocket.accept()
    if not await authenticate_downstream_ws(websocket):
        return
    queue = getattr(websocket.app.state, "routine_events", None)
    if queue is None:
        # 루틴 비활성 배포 — 조용한 무한대기 대신 정직하게 닫는다(1013 = try later).
        await websocket.close(code=1013)
        return

    await pump_queue_to_websocket(websocket, queue)
