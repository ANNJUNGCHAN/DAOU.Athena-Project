"""Authenticated downstream fanout of Kiwoom REAL WebSocket events."""
from __future__ import annotations

import asyncio
import secrets

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from athena_api.dependencies import KiwoomWsClientDep

router = APIRouter(tags=["Kiwoom WebSocket stream"])
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})


def _valid_bearer(value: str | None, expected: str) -> bool:
    if value is None or not expected.strip():
        return False
    scheme, _, token = value.partition(" ")
    return scheme.lower() == "bearer" and secrets.compare_digest(token.strip(), expected)


@router.websocket("/api/v1/ws/stream", name="kiwoom_real_stream")
async def kiwoom_real_stream(websocket: WebSocket, client: KiwoomWsClientDep) -> None:
    expected = getattr(websocket.app.state, "local_bearer_token", None)
    host = websocket.client.host if websocket.client is not None else ""
    authorization = websocket.headers.get("authorization")
    await websocket.accept()

    if expected is not None:
        if authorization is not None:
            if not _valid_bearer(authorization, expected):
                await websocket.close(code=1008)
                return
        else:
            try:
                message = await websocket.receive_json()
            except WebSocketDisconnect:
                return
            except ValueError:
                await websocket.close(code=1008)
                return
            if (
                not isinstance(message, dict)
                or message.get("type") != "auth"
                or not isinstance(message.get("token"), str)
                or not secrets.compare_digest(message["token"], expected)
            ):
                await websocket.close(code=1008)
                return
    elif host not in _LOOPBACK_HOSTS:
        await websocket.close(code=1008)
        return

    queue = client.subscribe_events()
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
    finally:
        client.unsubscribe_events(queue)
