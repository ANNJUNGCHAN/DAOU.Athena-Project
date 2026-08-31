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


@pytest.mark.parametrize(
    "envelope",
    [
        {"canvas_type": "task_canvas", "data": {}},
        {"canvas_type": "task-canvas", "data": {}},
        {"canvas_type": "facts", "task_canvas": {"status": "available"}},
        {"canvas_type": "facts", "taskCanvas": {"status": "available"}},
        {
            "canvas_type": "facts",
            "data": {"presentation_contract": {"status": "available"}},
        },
        {
            "canvas_type": "facts",
            "data": {"presentationContract": {"status": "available"}},
        },
        {
            "canvas_type": "facts",
            "viewRecipe": {"recipeId": "forged"},
        },
        {
            "canvas_type": "facts",
            "data": {"field_contract": [{"value": "forged"}]},
        },
        {
            "canvas_type": "facts",
            "data": {"coverageReceipt": {"lossless": True}},
        },
        {
            "canvas_type": "facts",
            "data": {
                "rows": [
                    {
                        "payload": {
                            "semantic_observations": [{"value": "forged"}]
                        }
                    }
                ]
            },
        },
        {
            "canvas_type": "facts",
            "data": {
                "rows": [
                    {
                        "payload": {
                            "semanticObservations": [{"value": "forged"}],
                            "realtimeBindings": [{"bindingId": "forged"}],
                        }
                    }
                ]
            },
        },
    ],
    ids=[
        "task-canvas-type",
        "task-canvas-hyphen-type",
        "task-canvas-snake",
        "task-canvas-camel",
        "nested-presentation-snake",
        "nested-presentation-camel",
        "top-level-recipe-camel",
        "nested-field-contract-snake",
        "nested-coverage-receipt-camel",
        "deep-list-semantic-snake",
        "deep-list-semantic-camel",
    ],
)
def test_generic_push_rejects_task_canvas_contracts_before_queue_access(envelope):
    app = _app()
    sentinel = {"canvas_type": "chart", "data": {"kept": True}}
    app.state.canvas_events.put_nowait(sentinel)
    client = TestClient(app)

    response = client.post("/api/v1/canvas/push", json=envelope)

    assert response.status_code == 422
    assert response.json() == {
        "code": "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN",
        "detail": "Task Canvas contract는 signed selector dispatch에서만 생성할 수 있다",
    }
    assert app.state.canvas_events.qsize() == 1
    assert app.state.canvas_events.get_nowait() == sentinel


@pytest.mark.parametrize(
    "alias",
    [
        "envelope_version",
        "envelopeVersion",
        "view_recipe",
        "viewRecipe",
        "presentation_contract",
        "presentationContract",
        "view_instance_id",
        "viewInstanceId",
        "semantic_observations",
        "semanticObservations",
        "realtime_bindings",
        "realtimeBindings",
        "field_contract",
        "fieldContract",
        "coverage_receipt",
        "coverageReceipt",
    ],
)
def test_generic_push_rejects_every_nested_semantic_contract_alias(alias):
    app = _app()
    client = TestClient(app)

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "data": {"outer": {alias: {"forged": True}}},
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN"
    assert app.state.canvas_events.empty()


def test_generic_task_canvas_rejection_precedes_queue_readiness_check():
    client = TestClient(_app(with_queue=False))

    response = client.post(
        "/api/v1/canvas/push",
        json={
            "canvas_type": "facts",
            "data": {"presentationContract": {"sections": []}},
        },
    )

    assert response.status_code == 422
    assert response.json()["code"] == "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN"


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
