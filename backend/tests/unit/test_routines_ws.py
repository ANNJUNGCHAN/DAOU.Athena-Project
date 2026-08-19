"""루틴 WS 알림(US-008) — 배타 2모드 인증·발화 push·회귀."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from athena_api.api.routines_ws import router


def _app(token: str | None, with_queue: bool = True):
    app = FastAPI()
    app.include_router(router)
    app.state.local_bearer_token = token
    if with_queue:
        queue: asyncio.Queue = asyncio.Queue()
        queue.put_nowait({"type": "routine-fired", "routine_id": "r1", "mode": "realtime-ws"})
        app.state.routine_events = queue
    else:
        app.state.routine_events = None
    return app


def test_mode_b_loopback_receives_event():
    client = TestClient(_app(token=None))
    with client.websocket_connect("/api/v1/ws/routines") as ws:
        event = ws.receive_json()
        assert event["type"] == "routine-fired"
        assert event["mode"] == "realtime-ws"


def test_mode_a_header_auth_receives_event():
    client = TestClient(_app(token="sekrit"))
    with client.websocket_connect(
        "/api/v1/ws/routines", headers={"Authorization": "Bearer sekrit"}
    ) as ws:
        assert ws.receive_json()["type"] == "routine-fired"


def test_mode_a_envelope_auth_receives_event():
    client = TestClient(_app(token="sekrit"))
    with client.websocket_connect("/api/v1/ws/routines") as ws:
        ws.send_json({"type": "auth", "token": "sekrit"})
        assert ws.receive_json()["type"] == "routine-fired"


def test_regression_token_set_loopback_without_auth_closes_1008():
    """프리모템 4 — 토큰 설정 배포에서 루프백은 결코 우회 경로가 아니다."""
    client = TestClient(_app(token="sekrit"))
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/v1/ws/routines") as ws:
            ws.send_json({"type": "auth", "token": "wrong"})
            ws.receive_json()
    assert exc_info.value.code == 1008


def test_disabled_routines_closes_1013():
    client = TestClient(_app(token=None, with_queue=False))
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/v1/ws/routines") as ws:
            ws.receive_json()
    assert exc_info.value.code == 1013
