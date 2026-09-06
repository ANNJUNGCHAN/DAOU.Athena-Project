"""고침 한 바퀴 — 코드를 덮어쓰면 앞판이 접히고, 되돌리면 그 판이 되살아난다.

이 기능의 진실도 디스크의 파일이다: 되돌리기가 200이라고 말하면 `watch/` 아래
바이트가 실제로 앞판으로 돌아가 있어야 하고, 알람의 해시도 그 바이트와 맞아야
한다(안 맞으면 활성화 게이트가 「검사 뒤 코드가 바뀜」으로 막는다).
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.routines import router
from athena_api.config import Settings
from athena_api.errors import install_exception_handlers
from athena_api.projects import store as projects_store
from athena_api.routines.guard_settings import GuardSettingsStore
from athena_api.routines.models import RoutineSpec
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import open_routines, teardown_routines

CODE = "/api/v1/routines/watch/code"
PATH = "watch/volume_spike.py"
V1 = """def signals(df, p):
    out = df[[]].copy()
    out["entry"] = df["close"] > 0
    out["exit"] = False
    return out
"""
V2 = V1 + "\n# 평균을 5일로\n"


def _unknown(project_id: str):
    raise KeyError(project_id)


@pytest.fixture
def client(tmp_path: Path, monkeypatch):
    project_root = tmp_path / "projects" / "알파"
    project_root.mkdir(parents=True)
    monkeypatch.setattr(
        projects_store,
        "resolve_project_path",
        lambda pid: project_root if pid == "p1" else _unknown(pid),
    )
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
    yield TestClient(app), runtime, project_root
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


def _nodes(days, ratio):
    return [
        {
            "fn": "avg_volume",
            "title_ko": f"{days} 거래량 평균",
            "inputs": [{"name": "평균 일수", "value": days}],
            "output": "1,240만주",
        },
        {
            "fn": "volume_ratio",
            "title_ko": "배수 비교",
            "inputs": [{"name": "배수", "value": ratio}],
            "output": "1.27배",
        },
    ]


def _seed(runtime, status="draft", *, source=V1):
    spec = validate_draft(
        {
            "symbol": "005930",
            "condition": {"source": "code.watch", "op": "==", "value": True},
            "cooldown_s": 86400,
            "expires_days": 7,
            "watch": {
                "project_id": "p1",
                "path": PATH,
                "version_hash": hashlib.sha256(source.encode("utf-8")).hexdigest(),
                "poll_interval_s": 60,
                "lookback_days": 30,
            },
        }
    )
    stored = RoutineSpec(
        condition=spec.condition,
        symbol=spec.symbol,
        cooldown_s=spec.cooldown_s,
        expires_at=datetime.now(UTC) + timedelta(days=7),
        note=spec.note,
        id=spec.id,
        status=status,
        watch=spec.watch,
    )
    runtime.store.upsert(stored)
    return stored


def _record_check(runtime, spec, *, days, ratio, count, fires, ok=True):
    """검사 한 번이 남긴 자국 — 검사 라우트가 watch_last에 쓰는 그 모양이다."""
    runtime.watch_last[f"check:{spec.id}"] = {
        "checked_at": "2026-09-05T06:31:00+00:00",
        "counted_through": "2026-09-04",
        "nodes": _nodes(days, ratio),
        "count": count,
        "fires": [{"dt": d, "close": 71000.0} for d in fires],
        "lookback_days": 30,
        "duration_ms": 9000,
        "ok": ok,
        "skip_reason": None if ok else "검사 실패 — 코드가 돌지 않음",
        "counted_until": "어제까지로 세었음 · 오늘은 진행 중",
    }


def _land(c, source):
    return c.post(CODE, json={"project_id": "p1", "path": PATH, "source": source})


def _detail(c, spec):
    res = c.get(f"/api/v1/routines/{spec.id}")
    assert res.status_code == 200, res.text
    return res.json()


# ── 한 바퀴 ──────────────────────────────────────────────────────────────────


def test_no_fix_cycle_before_the_first_overwrite(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    assert _land(c, V1).status_code == 200
    _record_check(runtime, spec, days="3일", ratio="1.5배", count=4, fires=["2026-08-12"])

    detail = _detail(c, spec)
    assert detail["fix_cycle"] is None
    assert detail["fix_history"] == []
    assert all("changed" not in n for n in detail["last_check"]["nodes"])


def test_overwriting_the_file_folds_the_previous_round_into_the_history(client):
    c, runtime, root = client
    spec = _seed(runtime)
    assert _land(c, V1).status_code == 200
    _record_check(
        runtime, spec, days="3일", ratio="1.5배", count=4,
        fires=["2026-08-12", "2026-08-26", "2026-08-30", "2026-09-01"],
    )

    assert _land(c, V2).status_code == 200
    stored = runtime.store.get(spec.id)
    assert len(stored.revisions) == 1
    assert stored.revisions[0]["source"] == V1
    assert stored.revisions[0]["check"]["count"] == 4

    # 고친 코드로 다시 검사한 뒤라야 앞뒤가 맞대진다.
    _record_check(
        runtime, spec, days="5일", ratio="2.0배", count=2, fires=["2026-08-12", "2026-08-26"]
    )
    cycle = _detail(c, spec)["fix_cycle"]
    assert cycle["fix_count"] == 1
    assert cycle["past_count"] == 0
    assert (cycle["fires_before"], cycle["fires_after"]) == (4, 2)
    assert [r["after"] for r in cycle["changes"]] == ["5일", "2.0배"]
    assert cycle["changed_nodes"] == 2
    assert cycle["lookback_days"] == 30
    assert (root / "watch" / "volume_spike.py").read_text("utf-8") == V2


def test_a_failed_recheck_says_it_did_not_count_instead_of_zero(client):
    """고친 코드가 터진 검사 — 상세는 0번을 세었다고 말하지 않는다."""
    c, runtime, _ = client
    spec = _seed(runtime)
    _land(c, V1)
    _record_check(runtime, spec, days="3일", ratio="1.5배", count=4, fires=["2026-08-12"])
    _land(c, V2)
    _record_check(runtime, spec, days="5일", ratio="2.0배", count=0, fires=[], ok=False)

    cycle = _detail(c, spec)["fix_cycle"]
    assert cycle["ok"] is False
    assert cycle["skip_reason"] == "검사 실패 — 코드가 돌지 않음"
    assert cycle["fires_after"] is None
    assert cycle["fires_after_dates"] == []
    assert cycle["changed_nodes"] == 2  # 바뀐 칸은 그대로 센다


def test_the_rollback_door_is_shut_on_a_running_alarm(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    _land(c, V1)
    _record_check(runtime, spec, days="3일", ratio="1.5배", count=4, fires=["2026-08-12"])
    _land(c, V2)
    _record_check(runtime, spec, days="5일", ratio="2.0배", count=2, fires=["2026-08-12"])

    assert _detail(c, spec)["fix_cycle"]["can_rollback"] is True
    stored = runtime.store.get(spec.id)
    stored.status = "active"
    runtime.store.upsert(stored)
    assert _detail(c, spec)["fix_cycle"]["can_rollback"] is False


def test_detail_overlays_the_arrow_on_the_changed_cells(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    _land(c, V1)
    _record_check(runtime, spec, days="3일", ratio="1.5배", count=4, fires=["2026-08-12"])
    _land(c, V2)
    _record_check(runtime, spec, days="5일", ratio="2.0배", count=2, fires=["2026-08-12"])

    nodes = _detail(c, spec)["last_check"]["nodes"]
    assert [n["changed"] for n in nodes] == [True, True]
    assert nodes[0]["inputs"][0]["value"] == "3일 → 5일"


def test_landing_the_same_bytes_again_is_not_a_fix(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    _land(c, V1)
    _land(c, V1)
    assert runtime.store.get(spec.id).revisions == []


def test_a_second_fix_stacks_and_the_history_names_the_first(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    _land(c, V1)
    _record_check(runtime, spec, days="3일", ratio="1.5배", count=6, fires=["2026-08-12"])
    _land(c, V2)
    _record_check(runtime, spec, days="4일", ratio="1.8배", count=4, fires=["2026-08-12"])
    _land(c, V2 + "# 또\n")
    _record_check(runtime, spec, days="5일", ratio="2.0배", count=2, fires=["2026-08-12"])

    detail = _detail(c, spec)
    assert detail["fix_cycle"]["fix_count"] == 2
    assert detail["fix_cycle"]["past_count"] == 1
    assert detail["fix_cycle"]["fires_before"] == 4
    assert len(detail["fix_history"]) == 1
    assert detail["fix_history"][0]["fire_count"] == 6


# ── 되돌리기 ─────────────────────────────────────────────────────────────────


def _rollback(c, spec):
    return c.post(f"/api/v1/routines/{spec.id}/watch/rollback")


def test_rollback_rewrites_the_file_and_restores_the_hash_and_the_check(client):
    c, runtime, root = client
    spec = _seed(runtime)
    _land(c, V1)
    _record_check(runtime, spec, days="3일", ratio="1.5배", count=4, fires=["2026-08-12"])
    _land(c, V2)
    _record_check(runtime, spec, days="5일", ratio="2.0배", count=2, fires=["2026-08-12"])

    res = _rollback(c, spec)
    assert res.status_code == 200, res.text
    detail = res.json()
    target = root / "watch" / "volume_spike.py"
    assert target.read_text("utf-8") == V1
    stored = runtime.store.get(spec.id)
    assert stored.watch.version_hash == hashlib.sha256(target.read_bytes()).hexdigest()
    assert stored.revisions == []
    assert detail["fix_cycle"] is None
    assert detail["last_check"]["count"] == 4
    assert detail["last_check"]["nodes"][0]["inputs"][0]["value"] == "3일"
    assert not list((root / "watch").glob("*.tmp"))


def test_rollback_hashes_the_source_it_writes_back(client):
    """검사 없이 두 번 착지하면 판에 접힌 해시는 그 원문의 것이 아니다."""
    c, runtime, root = client
    spec = _seed(runtime)
    _land(c, V1)
    _land(c, V2)  # 검사 없이 두 번째 착지 — 판에는 V1이, 알람 해시는 V1의 것
    _land(c, V2 + "# 세 번째\n")

    assert _rollback(c, spec).status_code == 200
    target = root / "watch" / "volume_spike.py"
    assert target.read_text("utf-8") == V2
    stored = runtime.store.get(spec.id)
    assert stored.watch.version_hash == hashlib.sha256(target.read_bytes()).hexdigest()


def test_rollback_without_a_fix_is_409(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    res = _rollback(c, spec)
    assert res.status_code == 409
    assert res.json()["detail"] == "되돌릴 고침이 없음"


def test_rollback_of_a_running_alarm_is_409(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    _land(c, V1)
    _land(c, V2)
    stored = runtime.store.get(spec.id)
    stored.status = "active"
    runtime.store.upsert(stored)

    res = _rollback(c, spec)
    assert res.status_code == 409
    assert "먼저 일시중지" in res.json()["detail"]


def test_rollback_of_an_unknown_routine_is_404(client):
    c, _, _ = client
    assert c.post("/api/v1/routines/ghost/watch/rollback").status_code == 404


def test_the_history_survives_a_restart(client):
    c, runtime, _ = client
    spec = _seed(runtime)
    _land(c, V1)
    _record_check(runtime, spec, days="3일", ratio="1.5배", count=4, fires=["2026-08-12"])
    _land(c, V2)

    from athena_api.routines.store import RoutineStore

    again = RoutineStore(path=runtime.store.path)
    again.load()
    assert again.get(spec.id).revisions[0]["source"] == V1
