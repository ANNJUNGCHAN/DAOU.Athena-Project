"""루틴 REST(US-007) — 권한 경계·상태 전이·503 fail-closed."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.routines import router
from athena_api.config import Settings
from athena_api.errors import install_exception_handlers
from athena_api.routines.runtime import open_routines, teardown_routines


@pytest.fixture
def app_client(tmp_path):
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)

    settings = Settings(
        _env_file=None,
        routines_enabled=True,
        routines_store_path=tmp_path / "routines.json",
        routines_ledger_path=tmp_path / "ledger.jsonl",
    )

    loop = asyncio.new_event_loop()
    runtime = loop.run_until_complete(open_routines(settings, ws_client=None))
    app.state.routines_runtime = runtime
    yield TestClient(app), runtime
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


DRAFT = {
    "symbol": "005930",
    "condition": {"source": "price.current", "op": "<", "value": 200000},
    "cooldown_s": 1800,
    "expires_days": 7,
}


def test_disabled_deployment_is_503():
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)
    app.state.routines_runtime = None
    client = TestClient(app)
    assert client.get("/api/v1/routines").status_code == 503
    assert client.post("/api/v1/routines/draft", json=DRAFT).status_code == 503


def test_draft_list_view_hides_raw_condition(app_client):
    client, _ = app_client
    res = client.post("/api/v1/routines/draft", json=DRAFT)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "draft"
    assert body["mode"] == "realtime-ws"
    assert "condition" not in body  # 원문 dict 비노출 — 해석문(note)만
    assert "현재가" in body["note"]

    listing = client.get("/api/v1/routines").json()
    assert len(listing["routines"]) == 1
    assert "condition" not in listing["routines"][0]


def test_draft_view_exposes_goal_flag(app_client):
    client, _ = app_client
    res = client.post("/api/v1/routines/draft", json=dict(DRAFT, goal=True))
    assert res.status_code == 200
    assert res.json()["goal"] is True

    default_res = client.post("/api/v1/routines/draft", json=DRAFT)
    assert default_res.json()["goal"] is False


def test_draft_validation_error_is_422_domain(app_client):
    client, _ = app_client
    bad = dict(DRAFT, condition={"source": "evil()", "op": "<", "value": 1})
    res = client.post("/api/v1/routines/draft", json=bad)
    assert res.status_code == 422
    assert res.json()["detail"] == "루틴 조건이 유효하지 않다"


def test_confirm_blocked_without_ws_then_cancel(app_client):
    client, _ = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    # WS 미가용 — 정직 게이트가 활성화를 거부한다(조용히 죽은 감시 금지)
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 409
    assert "실시간" in res.json()["detail"]
    # 취소는 가능
    res = client.post(f"/api/v1/routines/{rid}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    # 종결 상태 재전이는 409
    assert client.post(f"/api/v1/routines/{rid}/cancel").status_code == 409


def test_confirm_activates_with_fake_ws(app_client):
    client, runtime = app_client

    class FakeWs:
        def __init__(self):
            self.registered = []

        async def register(self, tr_id, items, **kw):
            self.registered.append((tr_id, tuple(items)))
            return {}

        def subscribe_events(self):  # scheduler 재시작 없음 — 여기선 미사용
            raise AssertionError

        def unsubscribe_events(self, q):
            raise AssertionError

    runtime.ws_client = FakeWs()
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    assert ("0B", ("005930",)) in runtime.ws_client.registered
    assert ("1h", ("005930",)) in runtime.ws_client.registered


def test_unknown_routine_is_404(app_client):
    client, _ = app_client
    assert client.post("/api/v1/routines/none/confirm").status_code == 404
    assert client.post("/api/v1/routines/none/cancel").status_code == 404
