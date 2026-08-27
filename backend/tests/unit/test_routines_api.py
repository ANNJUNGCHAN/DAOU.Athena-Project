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
    assert client.post("/api/v1/routines/none/pause").status_code == 404
    assert client.post("/api/v1/routines/none/resume").status_code == 404


class FakeWs:
    def __init__(self):
        self.registered = []
        self.removed = []

    async def register(self, tr_id, items, **kw):
        self.registered.append((tr_id, tuple(items)))
        return {}

    async def remove(self, tr_id, items, **kw):
        self.removed.append((tr_id, tuple(items)))
        return {}


def test_pause_then_resume_routine(app_client):
    client, runtime = app_client
    runtime.ws_client = FakeWs()
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    assert runtime.ws_client.registered.count(("0B", ("005930",))) == 1
    assert runtime.ws_client.registered.count(("1h", ("005930",))) == 1

    res = client.post(f"/api/v1/routines/{rid}/pause")
    assert res.status_code == 200
    assert res.json()["status"] == "paused"
    # pause는 참조카운트를 0으로 만들어 REAL 구독을 실제로 해제한다(F5).
    assert ("0B", ("005930",)) in runtime.ws_client.removed
    assert ("1h", ("005930",)) in runtime.ws_client.removed

    res = client.post(f"/api/v1/routines/{rid}/resume")
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    # resume은 confirm과 대칭으로 재구독한다.
    assert runtime.ws_client.registered.count(("0B", ("005930",))) == 2
    assert runtime.ws_client.registered.count(("1h", ("005930",))) == 2


SCHEDULE_DRAFT = {
    "symbol": "005930",
    "condition": {"source": "schedule.daily", "op": "at", "value": "ALL@07:30"},
    "cooldown_s": 1800,
    "expires_days": 7,
}


def test_schedule_confirm_succeeds_without_dart_key_disclosure_still_blocked(app_client):
    """Rev.3 BLOCKER 회귀 — DART 키 미설정(기본 배포, 이 fixture 상태)에서도
    schedule.daily confirm은 성공해야 하고(사실11④), disclosure.title_keyword는
    여전히 공시 폴러 미가용으로 409여야 한다(scheduled 분기가 periodic 게이트를
    훼손하지 않았음을 대조 확인)."""
    client, runtime = app_client
    assert runtime.disclosure_ready is False  # 이 fixture는 DART 키를 안 준다

    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "active"
    assert body["mode"] == "scheduled"
    assert body["activation_blocker"] is None

    disclosure_draft = dict(
        DRAFT,
        condition={
            "source": "disclosure.title_keyword",
            "op": "contains",
            "value": "유상증자",
        },
    )
    rid2 = client.post("/api/v1/routines/draft", json=disclosure_draft).json()["id"]
    res2 = client.post(f"/api/v1/routines/{rid2}/confirm")
    assert res2.status_code == 409
    assert "공시 폴러" in res2.json()["detail"]


def test_list_routines_includes_fired_today_and_next_fire_at(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    client.post(f"/api/v1/routines/{rid}/confirm")

    listing = client.get("/api/v1/routines").json()
    assert listing["fired_today"] == 0
    row = next(r for r in listing["routines"] if r["id"] == rid)
    assert row["mode"] == "scheduled"
    assert row["next_fire_at"] is not None  # ISO 문자열 — 다음 매치 시각

    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="schedule.daily",
        observed="07:30",
        threshold="ALL@07:30",
        reason="예약 시각 도달(07:30)",
    )
    listing2 = client.get("/api/v1/routines").json()
    assert listing2["fired_today"] == 1


def test_pause_rejects_invalid_transition(app_client):
    client, _ = app_client
    # draft 상태는 ALLOWED_TRANSITIONS 상 "paused"로 전이할 수 없다.
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/pause")
    assert res.status_code == 409


def test_runs_filters_by_routine_id(app_client):
    client, runtime = app_client
    rid_a = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    rid_b = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    runtime.ledger.record(
        "fired",
        routine_id=rid_a,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
    )
    runtime.ledger.record(
        "suppressed",
        routine_id=rid_b,
        symbol="005930",
        source="price.current",
        observed=199500,
        threshold=200000,
        reason="쿨다운 중",
    )

    res = client.get(f"/api/v1/routines/{rid_a}/runs")
    assert res.status_code == 200
    runs = res.json()["runs"]
    assert len(runs) == 1
    assert runs[0]["routine_id"] == rid_a
    assert runs[0]["verdict"] == "fired"
