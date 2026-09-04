"""루틴 상세(GET /{id})·소스 카탈로그 — 조건 원문은 여기서만 나간다.

목록(_view)은 사람이 읽는 해석문만 노출한다는 규율을 유지해야 하므로,
상세가 늘었다고 목록에 조건이 새지 않았는지도 같이 고정한다.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.routines import router
from athena_api.config import Settings
from athena_api.errors import install_exception_handlers
from athena_api.routines.guard_settings import GuardSettingsStore
from athena_api.routines.models import LEGACY_DISABLED_SOURCES, SOURCES
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
        routines_read_marks_path=tmp_path / "read_marks.json",
        routines_engagement_path=tmp_path / "engagement.jsonl",
        routines_briefings_path=tmp_path / "briefings.jsonl",
        routines_ledger_archive_dir=tmp_path / "archive",
    )

    loop = asyncio.new_event_loop()
    runtime = loop.run_until_complete(open_routines(settings, ws_client=None))
    app.state.routines_runtime = runtime
    app.state.nudge_guard_store = GuardSettingsStore(tmp_path / "nudge_guard.json")
    app.state.nudge_guard_store.load()
    yield TestClient(app), runtime
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


DRAFT = {
    "symbol": "005930",
    "condition": {"source": "price.current", "op": "<", "value": 200000},
    "cooldown_s": 1800,
    "expires_days": 7,
}

DETAIL_KEYS = {
    "id",
    "symbol",
    "status",
    "mode",
    "source_label",
    "cooldown_s",
    "expires_at",
    "note",
    "briefing_model",
    "briefing_effort",
    "activation_blocker",
    "experimental_source",
    "goal",
    "condition",
    "source_spec",
}


def test_detail_returns_exactly_the_form_contract(app_client):
    client, _ = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    body = client.get(f"/api/v1/routines/{rid}").json()
    # 등식이다 — 운영 지표(last_fired_at·unread·missed·next_fire_at)가 상세로
    # 새면 편집 폼이 목록의 책임까지 지게 된다.
    assert set(body) == DETAIL_KEYS
    assert body["condition"] == {
        "source": "price.current",
        "op": "<",
        "value": 200000,
        "consecutive_ticks": 1,
    }
    assert body["source_spec"] == {
        "ops": list(SOURCES["price.current"].ops),
        "value_type": "number",
        "transport": "ws",
        "label": "현재가",
    }


def test_detail_unknown_routine_is_404(app_client):
    client, _ = app_client
    assert client.get("/api/v1/routines/none").status_code == 404


def test_list_rows_still_hide_raw_condition(app_client):
    client, _ = app_client
    client.post("/api/v1/routines/draft", json=DRAFT)
    (row,) = client.get("/api/v1/routines").json()["routines"]
    assert "condition" not in row
    assert "source_spec" not in row


def test_briefing_budget_is_not_shadowed_by_detail_route(app_client):
    client, _ = app_client
    res = client.get("/api/v1/routines/briefing-budget")
    assert res.status_code == 200
    assert set(res.json()) == {"limit", "used_today", "remaining"}


def test_source_catalog_lists_active_sources_only(app_client):
    client, _ = app_client
    res = client.get("/api/v1/routines/source-catalog")
    assert res.status_code == 200  # /{routine_id}에 먹히지 않는다(선언 순서 계약)
    body = res.json()
    assert set(body) == set(SOURCES)
    assert len(body) == 7
    for source in LEGACY_DISABLED_SOURCES:
        assert source not in body
    for source, entry in body.items():
        assert set(entry) == {"ops", "value_type", "transport", "label", "experimental"}
        assert entry["ops"] == list(SOURCES[source].ops)
        assert entry["transport"] == SOURCES[source].transport
