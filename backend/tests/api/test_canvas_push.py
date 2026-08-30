"""캔버스 사이드 채널(api/canvas_push.py) — push 큐잉·WS 전달·fail-closed."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from athena_api.api.canvas_push import router


def _app(with_queue: bool = True, maxsize: int = 50, token: str | None = None):
    app = FastAPI()
    app.include_router(router)
    app.state.local_bearer_token = token
    app.state.canvas_events = asyncio.Queue(maxsize) if with_queue else None
    return app


def test_push_enqueues_envelope():
    app = _app()
    client = TestClient(app)
    envelope = {"canvas_type": "chart", "data": {"symbol": "005930", "bars": []}}
    response = client.post("/api/v1/canvas/push", json=envelope)
    assert response.status_code == 200
    assert app.state.canvas_events.get_nowait() == envelope


def test_push_requires_canvas_type():
    client = TestClient(_app())
    response = client.post("/api/v1/canvas/push", json={"data": {}})
    assert response.status_code == 422


def test_push_fail_closed_without_queue():
    client = TestClient(_app(with_queue=False))
    response = client.post("/api/v1/canvas/push", json={"canvas_type": "chart"})
    assert response.status_code == 503


def test_push_drops_oldest_when_full():
    app = _app(maxsize=2)
    client = TestClient(app)
    for i in range(3):
        client.post("/api/v1/canvas/push", json={"canvas_type": "chart", "n": i})
    first = app.state.canvas_events.get_nowait()
    second = app.state.canvas_events.get_nowait()
    assert [first["n"], second["n"]] == [1, 2]  # 최신이 이긴다 — 0이 버려졌다


def test_ws_loopback_receives_pushed_envelope():
    app = _app()
    app.state.canvas_events.put_nowait({"canvas_type": "table", "data": {"rows": []}})
    client = TestClient(app)
    with client.websocket_connect("/api/v1/ws/canvas") as ws:
        assert ws.receive_json() == {"type": "feed-ready", "feed": "canvas"}
        message = ws.receive_json()
    assert message["canvas_type"] == "table"


def test_ws_without_queue_closes_1013():
    client = TestClient(_app(with_queue=False))
    try:
        with client.websocket_connect("/api/v1/ws/canvas") as ws:
            ws.receive_json()
        raise AssertionError("1013으로 닫혀야 한다")
    except WebSocketDisconnect as exc:
        assert exc.code == 1013


def test_ws_auth_reject_closes_before_feed_ready():
    client = TestClient(_app(token="sekrit"))
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/v1/ws/canvas") as ws:
            ws.send_json({"type": "auth", "token": "wrong"})
            ws.receive_json()
    assert exc_info.value.code == 1008
