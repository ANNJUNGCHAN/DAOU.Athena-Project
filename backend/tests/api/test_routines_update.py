"""루틴 설정 편집(POST /{id}/update) — 허용 필드·재검증·상태 보존.

편집은 draft와 같은 rules를 다시 통과한다 — 소스별 연산자·값 타입·연속 틱
규칙이 편집 경로에서도 똑같이 서는지를 표로 고정한다.
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.routines import router
from athena_api.config import Settings
from athena_api.errors import install_exception_handlers
from athena_api.projects import store as projects_store
from athena_api.routines.guard_settings import GuardSettingsStore
from athena_api.routines.models import (
    MAX_COOLDOWN_S,
    MIN_COOLDOWN_S,
    SOURCES,
    Condition,
    RoutineSpec,
)
from athena_api.routines.runtime import open_routines, teardown_routines
from athena_api.routines.triggers import TriggerState

WATCH_SOURCE = "x = 1\n"
WATCH_HASH = hashlib.sha256(WATCH_SOURCE.encode("utf-8")).hexdigest()


@pytest.fixture
def app_client(tmp_path, monkeypatch):
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
    project_root = tmp_path / "project"
    (project_root / "watch").mkdir(parents=True)
    (project_root / "watch" / "volume_spike.py").write_bytes(WATCH_SOURCE.encode("utf-8"))
    monkeypatch.setattr(
        projects_store,
        "resolve_project_path",
        lambda project_id: project_root if project_id == "p1" else _missing_project(project_id),
    )
    yield TestClient(app), runtime
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


DRAFT = {
    "symbol": "005930",
    "condition": {"source": "price.current", "op": "<", "value": 200000},
    "cooldown_s": 1800,
    "expires_days": 7,
}


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


def _draft(client, **over):
    return client.post("/api/v1/routines/draft", json=dict(DRAFT, **over)).json()["id"]


def test_update_reflects_allowed_fields(app_client):
    client, _ = app_client
    rid = _draft(client)
    res = client.post(
        f"/api/v1/routines/{rid}/update",
        json={
            "note": "손절선 감시",
            "cooldown_s": 600,
            "briefing_model": "claude-sonnet-5",
            "briefing_effort": "high",
            "condition": {"op": "<=", "value": 190000},
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["note"] == "손절선 감시"
    assert body["cooldown_s"] == 600
    assert body["briefing_model"] == "claude-sonnet-5"
    assert body["briefing_effort"] == "high"
    assert body["condition"] == {
        "source": "price.current",
        "op": "<=",
        "value": 190000,
        "consecutive_ticks": 1,
    }
    # 저장까지 갔는지 — 다시 읽어도 같아야 한다.
    assert client.get(f"/api/v1/routines/{rid}").json()["condition"]["op"] == "<="


@pytest.mark.parametrize(
    "body",
    [
        {"symbol": "000660"},
        {"condition": {"source": "price.change_rate"}},
    ],
)
def test_update_rejects_identity_fields(app_client, body):
    client, _ = app_client
    rid = _draft(client)
    assert client.post(f"/api/v1/routines/{rid}/update", json=body).status_code == 422


@pytest.mark.parametrize("cooldown", [MIN_COOLDOWN_S - 1, MAX_COOLDOWN_S + 1])
def test_update_rejects_out_of_range_cooldown(app_client, cooldown):
    client, _ = app_client
    rid = _draft(client)
    res = client.post(f"/api/v1/routines/{rid}/update", json={"cooldown_s": cooldown})
    assert res.status_code == 422


def test_update_unknown_routine_is_404(app_client):
    client, _ = app_client
    res = client.post("/api/v1/routines/none/update", json={"note": "x"})
    assert res.status_code == 404


def test_update_cancelled_routine_is_409(app_client):
    client, _ = app_client
    rid = _draft(client)
    assert client.post(f"/api/v1/routines/{rid}/cancel").status_code == 200
    res = client.post(f"/api/v1/routines/{rid}/update", json={"note": "x"})
    assert res.status_code == 409


def test_update_of_active_realtime_is_visible_to_evaluator(app_client):
    client, runtime = app_client
    runtime.ws_client = FakeWs()
    rid = _draft(client)
    assert client.post(f"/api/v1/routines/{rid}/confirm").status_code == 200

    res = client.post(
        f"/api/v1/routines/{rid}/update", json={"condition": {"value": 150000}}
    )
    assert res.status_code == 200
    (active,) = runtime.store.list_active()
    assert active.id == rid
    assert active.condition.value == 150000
    assert active.status == "active"


def test_condition_edit_resets_trigger_state(app_client):
    client, runtime = app_client
    rid = _draft(client)
    runtime.engine._states[rid] = TriggerState(consecutive=2)

    res = client.post(
        f"/api/v1/routines/{rid}/update", json={"condition": {"value": 150000}}
    )
    assert res.status_code == 200
    # 옛 조건의 누적이 새 조건으로 새면 안 된다.
    assert runtime.engine._state(rid).consecutive == 0


def test_update_without_expires_days_preserves_expiry(app_client):
    client, _ = app_client
    rid = _draft(client)
    before = client.get(f"/api/v1/routines/{rid}").json()["expires_at"]
    res = client.post(f"/api/v1/routines/{rid}/update", json={"note": "그대로"})
    assert res.status_code == 200
    assert res.json()["expires_at"] == before


def test_update_with_expires_days_recomputes_expiry(app_client):
    client, _ = app_client
    rid = _draft(client)
    before = client.get(f"/api/v1/routines/{rid}").json()["expires_at"]
    res = client.post(f"/api/v1/routines/{rid}/update", json={"expires_days": 3})
    assert res.status_code == 200
    after = datetime.fromisoformat(res.json()["expires_at"])
    assert after != datetime.fromisoformat(before)
    assert abs(after - (datetime.now(UTC) + timedelta(days=3))) < timedelta(minutes=5)


def test_update_of_legacy_source_is_409_with_recreate_guidance(app_client):
    client, runtime = app_client
    spec = RoutineSpec(
        condition=Condition(
            source="disclosure.title_keyword", op="contains", value="유상증자"
        ),
        symbol="005930",
        cooldown_s=1800,
        expires_at=datetime.now(UTC) + timedelta(days=7),
        note="옛 공시 감시",
    )
    runtime.store.upsert(spec)
    res = client.post(f"/api/v1/routines/{spec.id}/update", json={"cooldown_s": 600})
    assert res.status_code == 409
    assert res.json()["detail"] == "지원하지 않는 조건 — 취소 후 새로 만들기"


def test_note_freshness_regenerates_only_auto_notes(app_client):
    client, _ = app_client
    # (1) 자동 생성 note는 조건이 바뀌면 새 해석문으로 갱신된다.
    auto_id = _draft(client)
    assert "200000" in client.get(f"/api/v1/routines/{auto_id}").json()["note"]
    res = client.post(
        f"/api/v1/routines/{auto_id}/update", json={"condition": {"value": 150000}}
    )
    assert res.status_code == 200
    assert "150000" in res.json()["note"]

    # (2) 사람이 쓴 note는 조건이 바뀌어도 덮어쓰지 않는다.
    mine_id = _draft(client, note="내가 쓴 메모")
    res = client.post(
        f"/api/v1/routines/{mine_id}/update", json={"condition": {"value": 150000}}
    )
    assert res.status_code == 200
    assert res.json()["note"] == "내가 쓴 메모"


_VALID_VALUE = {
    "price.current": 200000,
    "price.change_rate": 5,
    "trade.strength": 120,
    "volume.prev_day_ratio": 2,
    "vi.triggered": True,
    "schedule.daily": "ALL@07:30",
}
_OP_POOL = ("<", "==", "contains", "at")


# code.watch는 조건 편집 자체가 막히는 소스라 이 표에서 뺀다(B-17에서 따로 고정).
@pytest.mark.parametrize("source", sorted(set(SOURCES) - {"code.watch"}))
def test_update_revalidates_every_source_rule(app_client, source):
    """편집도 draft와 같은 규칙 표를 통과한다 — 소스마다 전수로 고정한다."""
    client, _ = app_client
    spec = SOURCES[source]
    rid = _draft(
        client,
        condition={
            "source": source,
            "op": spec.ops[0],
            "value": _VALID_VALUE[source],
        },
    )

    wrong_op = next(op for op in _OP_POOL if op not in spec.ops)
    res = client.post(
        f"/api/v1/routines/{rid}/update", json={"condition": {"op": wrong_op}}
    )
    assert res.status_code == 422, f"{source}: {wrong_op} 연산자가 통과했다"

    wrong_value = "문자열" if spec.value_type != "string" else 1
    res = client.post(
        f"/api/v1/routines/{rid}/update", json={"condition": {"value": wrong_value}}
    )
    assert res.status_code == 422, f"{source}: 잘못된 값 타입이 통과했다"

    res = client.post(
        f"/api/v1/routines/{rid}/update", json={"condition": {"consecutive_ticks": 3}}
    )
    if spec.transport == "ws":
        assert res.status_code == 200
        assert res.json()["condition"]["consecutive_ticks"] == 3
    else:
        assert res.status_code == 422, f"{source}: 연속 틱이 비실시간에서 통과했다"


# ── 코드 감시 알람의 편집 경계 — B-17 ───────────────────────────────────────

CODE_WATCH_DRAFT = {
    "symbol": "005930",
    "condition": {"source": "code.watch", "op": "==", "value": True},
    "cooldown_s": 1800,
    "expires_days": 7,
    "watch": {
        "project_id": "p1",
        "path": "watch/volume_spike.py",
        "version_hash": WATCH_HASH,
        "poll_interval_s": 60,
        "lookback_days": 30,
    },
}


def _missing_project(project_id):
    raise KeyError(project_id)


def _code_draft(client) -> str:
    res = client.post("/api/v1/routines/draft", json=CODE_WATCH_DRAFT)
    assert res.status_code == 200, res.text
    assert res.json()["watch"]["path"] == "watch/volume_spike.py"  # 초안 응답에 watch가 실린다
    return res.json()["id"]


@pytest.mark.parametrize(
    "condition",
    [{"value": False}, {"op": ">="}, {"consecutive_ticks": 3}, {"source": "code.watch"}],
)
def test_code_watch_condition_edit_is_422(app_client, condition):
    """코드 감시의 조건은 폼에서 못 바꾼다 — 고치기는 코드를 다시 쓰는 길로만."""
    client, _ = app_client
    rid = _code_draft(client)

    res = client.post(f"/api/v1/routines/{rid}/update", json={"condition": condition})
    assert res.status_code == 422
    assert res.json()["detail"] == "코드 감시 조건은 폼에서 못 바꿈 — 고치기는 말로"


def test_code_watch_poll_interval_is_updatable(app_client):
    client, runtime = app_client
    rid = _code_draft(client)

    res = client.post(f"/api/v1/routines/{rid}/update", json={"poll_interval_s": 300})
    assert res.status_code == 200, res.text
    assert res.json()["watch"]["poll_interval_s"] == 300
    assert runtime.store.get(rid).watch.poll_interval_s == 300
    # 나머지 watch 값은 그대로다 — 편집이 감시 파일을 바꾸지 않는다.
    assert runtime.store.get(rid).watch.version_hash == WATCH_HASH
    assert runtime.store.get(rid).watch.path == "watch/volume_spike.py"


@pytest.mark.parametrize("value", [30, 601, 60.0, True, "300"])
def test_code_watch_poll_interval_out_of_range_is_422(app_client, value):
    client, runtime = app_client
    rid = _code_draft(client)

    res = client.post(f"/api/v1/routines/{rid}/update", json={"poll_interval_s": value})
    assert res.status_code == 422
    assert runtime.store.get(rid).watch.poll_interval_s == 60  # 저장은 그대로


def test_poll_interval_on_other_modes_is_422(app_client):
    client, _ = app_client
    rid = _draft(client)
    res = client.post(f"/api/v1/routines/{rid}/update", json={"poll_interval_s": 120})
    assert res.status_code == 422
    assert res.json()["detail"] == "확인 주기는 코드 감시 알람에서만 바꿀 수 있음"


def test_code_watch_still_allows_the_shared_fields(app_client):
    client, runtime = app_client
    rid = _code_draft(client)

    res = client.post(
        f"/api/v1/routines/{rid}/update",
        json={"note": "거래량 튀면 알려줘", "cooldown_s": 3600, "expires_days": 30},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["note"] == "거래량 튀면 알려줘"
    assert body["cooldown_s"] == 3600
    assert runtime.store.get(rid).watch.poll_interval_s == 60  # 안 건드린 값은 보존
