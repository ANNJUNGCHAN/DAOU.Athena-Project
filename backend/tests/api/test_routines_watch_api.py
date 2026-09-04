"""감시 코드 착지(`POST /routines/watch/code`) — B-13(착지 측)·B-24.

이 기능의 진실은 디스크의 파일이다 — 200이라고 말하면 프로젝트 폴더 안
`watch/` 아래에 그 바이트가 실제로 있어야 하고, `code_hash`는 그 바이트의
sha256이어야 한다.

모드 격리(R5)도 같이 못 박는다 — 착지 한 번으로 백테스트 sqlite나 사용자
전략 등록부가 조금도 움직이지 않는다.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
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

SOURCE = """def signals(df, p):
    out = df[[]].copy()
    out["entry"] = df["close"] > 0
    out["exit"] = False
    return out
"""


@pytest.fixture
def watch_client(tmp_path: Path, monkeypatch):
    """루틴 라우터 + 등록된 프로젝트 폴더 하나(`p1`)."""
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


def _unknown(project_id: str) -> Path:
    raise KeyError(project_id)


def _body(**over):
    raw = {"project_id": "p1", "path": "watch/volume_spike.py", "source": SOURCE}
    raw.update(over)
    return raw


def _seed_code_routine(runtime, status: str, *, path: str = "watch/volume_spike.py"):
    spec = validate_draft(
        {
            "symbol": "005930",
            "condition": {"source": "code.watch", "op": "==", "value": True},
            "cooldown_s": 1800,
            "expires_days": 7,
            "watch": {
                "project_id": "p1",
                "path": path,
                "version_hash": "a" * 64,
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


# ── 착지 성공 ────────────────────────────────────────────────────────────────


def test_save_writes_the_file_and_returns_its_hash(watch_client):
    client, _, root = watch_client

    res = client.post(CODE, json=_body())
    assert res.status_code == 200, res.text
    payload = res.json()

    target = root / "watch" / "volume_spike.py"
    raw = target.read_bytes()
    assert payload["path"] == "watch/volume_spike.py"
    assert payload["code_hash"] == hashlib.sha256(raw).hexdigest()
    assert payload["bytes"] == len(raw)
    assert b"\r\n" not in raw  # LF 고정
    assert not list((root / "watch").glob("*.tmp"))


def test_save_overwrites_a_draft_referenced_file(watch_client):
    """초안이 가리키는 파일은 고쳐 쓸 수 있다 — 켜져 있지 않으니까."""
    client, runtime, root = watch_client
    _seed_code_routine(runtime, "draft")

    first = client.post(CODE, json=_body()).json()
    second = client.post(CODE, json=_body(source=SOURCE + "\n# 고침\n"))
    assert second.status_code == 200
    assert second.json()["code_hash"] != first["code_hash"]
    assert "# 고침" in (root / "watch" / "volume_spike.py").read_text("utf-8")


def test_labels_are_appended_when_the_code_has_none(watch_client):
    client, _, root = watch_client

    res = client.post(
        CODE, json=_body(labels={"signals": "거래량 튀는 날 찾기", "load": "일봉 불러오기"})
    )
    assert res.status_code == 200
    text = (root / "watch" / "volume_spike.py").read_text("utf-8")
    assert "NODE_LABELS = {" in text
    assert "거래량 튀는 날 찾기" in text  # ensure_ascii=False로 한국어 그대로
    assert text.count("NODE_LABELS") == 1


def test_labels_are_not_appended_when_the_code_already_has_them(watch_client):
    client, _, root = watch_client
    source = SOURCE + '\n\nNODE_LABELS = {"signals": "내가 적은 제목"}\n'

    res = client.post(CODE, json=_body(source=source, labels={"signals": "덧붙인 제목"}))
    assert res.status_code == 200
    text = (root / "watch" / "volume_spike.py").read_text("utf-8")
    assert text.count("NODE_LABELS") == 1
    assert "덧붙인 제목" not in text


# ── 경로·프로젝트 거부 ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    ["../x.py", "watch/../../x.py", "notwatch/x.py", "watch/x.txt", "watch/", "/watch/x.py"],
)
def test_bad_paths_are_422(watch_client, path):
    client, _, root = watch_client
    res = client.post(CODE, json=_body(path=path))
    assert res.status_code == 422, res.text
    assert "watch/" in res.json()["detail"]
    assert not (root / "watch").exists()


def test_unknown_project_is_404(watch_client):
    client, _, _ = watch_client
    res = client.post(CODE, json=_body(project_id="ghost"))
    assert res.status_code == 404
    assert res.json()["detail"] == "프로젝트 없음"


def test_missing_project_id_is_422(watch_client):
    client, _, _ = watch_client
    assert client.post(CODE, json={"path": "watch/x.py", "source": SOURCE}).status_code == 422


def test_empty_source_is_422(watch_client):
    client, _, _ = watch_client
    res = client.post(CODE, json=_body(source="   "))
    assert res.status_code == 422


# ── B-24 덮어쓰기 금지 ───────────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["active", "paused"])
def test_live_alarm_code_is_409(watch_client, status):
    client, runtime, root = watch_client
    client.post(CODE, json=_body())  # 초안 단계에서 먼저 착지
    before = (root / "watch" / "volume_spike.py").read_bytes()
    _seed_code_routine(runtime, status)

    res = client.post(CODE, json=_body(source=SOURCE + "\n# 몰래 고침\n"))
    assert res.status_code == 409
    assert res.json()["detail"] == (
        "켜져 있는 알람의 코드는 못 바꿈 — 먼저 일시중지하거나 새로 만들기"
    )
    assert (root / "watch" / "volume_spike.py").read_bytes() == before  # 한 바이트도 안 바뀜


def test_a_new_file_is_allowed_while_another_alarm_is_active(watch_client):
    client, runtime, root = watch_client
    _seed_code_routine(runtime, "active")

    res = client.post(CODE, json=_body(path="watch/gap_up.py"))
    assert res.status_code == 200
    assert (root / "watch" / "gap_up.py").exists()


# ── B-13(착지 측) 모드 격리 ──────────────────────────────────────────────────


def test_landing_does_not_touch_backtest_tables_or_the_registry(watch_client, tmp_path):
    """알람 코드 착지로 백테스트 표·등록부에는 아무 일도 일어나지 않는다(R5).

    이 앱에는 백테스트 저장소가 아예 배선돼 있지 않다 — 그래서 sqlite 파일이
    생기지 않는다는 것과 등록부 json이 그대로라는 것을 함께 본다.
    """
    client, _, _ = watch_client
    db = tmp_path / "backtest.sqlite3"
    registry = tmp_path / "user-strategies.json"
    registry.write_text(json.dumps({"strategies": []}), encoding="utf-8")
    before = registry.read_bytes()

    assert client.post(CODE, json=_body()).status_code == 200

    assert not db.exists()  # bt_strategy·bt_strategy_version·bt_run·bt_deployment 부재
    assert registry.read_bytes() == before
    assert not list(tmp_path.glob("*.sqlite3"))


def test_landing_creates_no_routine_rows(watch_client):
    client, runtime, _ = watch_client
    assert client.post(CODE, json=_body()).status_code == 200
    assert runtime.store.list_all() == []  # 착지는 루틴 등록이 아니다


def test_disabled_deployment_is_503():
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)
    app.state.routines_runtime = None
    client = TestClient(app)
    assert client.post(CODE, json=_body()).status_code == 503
