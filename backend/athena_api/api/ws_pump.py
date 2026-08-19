"""다운스트림 WS 이벤트 펌프 — 큐→소켓 전달·종료 감지의 단일 구현.

stream(키움 REAL)·routines(루틴 알림) 두 라우트가 공유한다. 취소 의미론이
미묘해 한 벌만 유지한다: 서버 셧다운이 child task를 취소하면 루프를 끝내고,
클라이언트 disconnect 프레임이 오면 조용히 반환하며, 매 반복 마지막에
pending task를 반드시 회수해 태스크 누수를 막는다.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


async def pump_queue_to_websocket(
    websocket: WebSocket, queue: asyncio.Queue[Any]
) -> None:
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
