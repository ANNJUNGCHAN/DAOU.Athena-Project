"""말걸기 가드 설정 REST(F4) — get/post 왕복·범위 검증·영속."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.nudge_guard import router
from athena_api.errors import install_exception_handlers
from athena_api.routines.guard_settings import GuardSettingsStore


def _app(path):
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)
    app.state.nudge_guard_store = GuardSettingsStore(path)
    app.state.nudge_guard_store.load()
    return app


@pytest.fixture
def client(tmp_path):
    return TestClient(_app(tmp_path / "nudge_guard.json"))


def test_get_returns_defaults(client):
    res = client.get("/api/v1/nudge-guard")
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "max_daily_nudges": 2,
        "quiet_hours": {"start": "22:00", "end": "07:00"},
        "show_rationale": True,
        "learn_from_dismissals": True,
        "max_daily_briefings": 10,
    }


def test_post_replaces_and_get_reflects_it(client):
    res = client.post(
        "/api/v1/nudge-guard",
        json={
            "max_daily_nudges": 1,
            "quiet_hours": {"start": "21:00", "end": "08:00"},
            "show_rationale": False,
            "learn_from_dismissals": True,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["max_daily_nudges"] == 1
    assert body["quiet_hours"] == {"start": "21:00", "end": "08:00"}
    assert body["show_rationale"] is False

    res2 = client.get("/api/v1/nudge-guard")
    assert res2.json() == body  # 재조회해도 유지


@pytest.mark.parametrize(
    "body",
    [
        {"max_daily_nudges": -1},
        {"max_daily_nudges": 11},
        {"max_daily_nudges": "2"},
        {"max_daily_nudges": True},  # bool은 int 서브클래스 — 명시적으로 거부
        {"quiet_hours": {"start": "25:00", "end": "07:00"}},
        {"quiet_hours": {"start": "22:00", "end": "7:00"}},
        {"quiet_hours": "22:00"},
        {"show_rationale": "yes"},
        {"learn_from_dismissals": 1},
        {"max_daily_briefings": -1},
        {"max_daily_briefings": 51},
        {"max_daily_briefings": "10"},
        {"max_daily_briefings": True},  # bool은 int 서브클래스 — 명시적으로 거부
    ],
)
def test_post_rejects_out_of_range_values(client, body):
    res = client.post("/api/v1/nudge-guard", json=body)
    assert res.status_code == 422
    assert res.json()["detail"] == "가드 설정이 유효하지 않다"


def test_post_defaults_unspecified_fields(client):
    res = client.post("/api/v1/nudge-guard", json={"max_daily_nudges": 5})
    assert res.status_code == 200
    body = res.json()
    assert body["max_daily_nudges"] == 5
    assert body["quiet_hours"] == {"start": "22:00", "end": "07:00"}  # 기본값 유지
    assert body["max_daily_briefings"] == 10  # 기존 4필드처럼 미지정 시 기본값


def test_max_daily_briefings_roundtrip(client):
    """R1 — 브리핑 하루 상한 왕복. 기존 4필드는 회귀 없이 기본값 유지."""
    res = client.post("/api/v1/nudge-guard", json={"max_daily_briefings": 3})
    assert res.status_code == 200
    body = res.json()
    assert body["max_daily_briefings"] == 3
    assert body["max_daily_nudges"] == 2  # 별도 축 — 말걸기 상한은 무영향
    assert client.get("/api/v1/nudge-guard").json()["max_daily_briefings"] == 3


def test_settings_persist_across_new_store_instance(tmp_path):
    path = tmp_path / "nudge_guard.json"
    client1 = TestClient(_app(path))
    client1.post("/api/v1/nudge-guard", json={"max_daily_nudges": 7})

    client2 = TestClient(_app(path))  # "재기동" — 같은 경로로 새 스토어
    assert client2.get("/api/v1/nudge-guard").json()["max_daily_nudges"] == 7
