"""루틴 알림 다운스트림 — /api/v1/ws/routines.

스케줄러가 넣는 발화·만료·복원실패 이벤트를 앱(Electron 메인)에 push한다.
인증은 stream과 같은 배타 2모드(`ws_auth`). 소비자는 단일 앱 인스턴스
전제라 큐를 팬아웃하지 않고 그대로 비운다.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from athena_api.api.ws_auth import authenticate_downstream_ws

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

    try:
        while True:
            event_task = asyncio.create_task(queue.get())
            receive_task = asyncio.create_task(websocket.receive())
            child_tasks = (event_task, receive_task)
            try:
                done, pending = await asyncio.wait(
                    child_tasks, return_when=asyncio.FIRST_COMPLETED
                )
                cancelled_by_shutdown = any(task.cancelled() for task in done)
                for task in pending:
                    task.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)
                if cancelled_by_shutdown:
                    break
                if receive_task in done:
                    message = receive_task.result()
                    if message["type"] == "websocket.disconnect":
                        break
                if event_task in done:
                    await websocket.send_json(event_task.result())
            finally:
                for task in child_tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*child_tasks, return_exceptions=True)
    except WebSocketDisconnect:
        pass
