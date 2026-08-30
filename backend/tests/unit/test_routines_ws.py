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
        assert ws.receive_json() == {"type": "feed-ready", "feed": "routines"}
        event = ws.receive_json()
        assert event["type"] == "routine-fired"
        assert event["mode"] == "realtime-ws"


def test_mode_a_header_auth_receives_event():
    client = TestClient(_app(token="sekrit"))
    with client.websocket_connect(
        "/api/v1/ws/routines", headers={"Authorization": "Bearer sekrit"}
    ) as ws:
        assert ws.receive_json() == {"type": "feed-ready", "feed": "routines"}
        assert ws.receive_json()["type"] == "routine-fired"


def test_mode_a_envelope_auth_receives_event():
    client = TestClient(_app(token="sekrit"))
    with client.websocket_connect("/api/v1/ws/routines") as ws:
        ws.send_json({"type": "auth", "token": "sekrit"})
        assert ws.receive_json() == {"type": "feed-ready", "feed": "routines"}
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


# ---------- 재연결 시 near 스냅샷 복원(결함6) ----------


class _FakeScheduler:
    def __init__(self, snapshot: list[dict]) -> None:
        self._snapshot = snapshot

    def near_snapshot(self) -> list[dict]:
        return self._snapshot


class _FakeRuntime:
    def __init__(self, snapshot: list[dict]) -> None:
        self.scheduler = _FakeScheduler(snapshot)


def test_reconnect_sends_near_snapshot_before_queued_events():
    app = _app(token=None)
    app.state.routines_runtime = _FakeRuntime(
        [
            {
                "type": "routine-near",
                "routine_id": "r9",
                "symbol": "005930",
                "active": True,
                "observed": None,
                "threshold": 5.0,
            }
        ]
    )
    client = TestClient(app)
    with client.websocket_connect("/api/v1/ws/routines") as ws:
        first = ws.receive_json()
        assert first == {
            "type": "feed-ready",
            "feed": "routines",
        }
        second = ws.receive_json()
        assert second == {
            "type": "routine-near",
            "routine_id": "r9",
            "symbol": "005930",
            "active": True,
            "observed": None,
            "threshold": 5.0,
        }
        third = ws.receive_json()
        assert third["type"] == "routine-fired"  # 큐 이벤트는 스냅샷 다음


def test_reconnect_without_near_state_skips_snapshot():
    app = _app(token=None)
    app.state.routines_runtime = _FakeRuntime([])  # 재시작 직후 — near 소실
    client = TestClient(app)
    with client.websocket_connect("/api/v1/ws/routines") as ws:
        assert ws.receive_json() == {"type": "feed-ready", "feed": "routines"}
        event = ws.receive_json()
        assert event["type"] == "routine-fired"  # 스냅샷 없이 바로 큐 이벤트
