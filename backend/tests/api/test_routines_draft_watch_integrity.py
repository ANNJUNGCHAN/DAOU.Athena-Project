"""Regression seam for code-watch drafts whose project/file no longer exists."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.routines import router
from athena_api.config import Settings
from athena_api.errors import install_exception_handlers
from athena_api.projects import store as projects_store
from athena_api.routines.runtime import open_routines, teardown_routines


@pytest.fixture
def draft_client(tmp_path, monkeypatch):
    missing_project = tmp_path / "deleted-project"
    monkeypatch.setattr(
        projects_store,
        "resolve_project_path",
        lambda project_id: missing_project if project_id == "stale-project" else None,
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
    yield TestClient(app), runtime, missing_project
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


def test_code_watch_draft_is_not_persisted_when_project_file_is_missing(draft_client):
    client, runtime, _ = draft_client
    response = client.post(
        "/api/v1/routines/draft",
        json={
            "symbol": "005930",
            "condition": {"source": "code.watch", "op": "==", "value": True},
            "cooldown_s": 86400,
            "expires_days": 30,
            "watch": {
                "project_id": "stale-project",
                "path": "watch/volume_spike.py",
                "version_hash": "3dddce03193e170981e846241b9d2fff493276db72e7f47e295f4336db807bd7",
                "params": {"days": 3, "ratio": 1.5},
                "poll_interval_s": 60,
                "lookback_days": 30,
            },
        },
    )

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "프로젝트 폴더 없음 — 다시 연결"
    assert runtime.store.list_all() == []


def test_watch_code_does_not_recreate_a_registered_project_folder(draft_client):
    client, _, missing_project = draft_client
    response = client.post(
        "/api/v1/routines/watch/code",
        json={
            "project_id": "stale-project",
            "path": "watch/volume_spike.py",
            "source": "def signals(df, p):\n    return df\n",
        },
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "프로젝트 폴더 없음 — 다시 연결"
    assert not missing_project.exists()


def test_code_watch_draft_is_not_persisted_when_file_is_missing(draft_client):
    client, runtime, project_root = draft_client
    project_root.mkdir()

    response = client.post(
        "/api/v1/routines/draft",
        json={
            "symbol": "005930",
            "condition": {"source": "code.watch", "op": "==", "value": True},
            "cooldown_s": 86400,
            "expires_days": 30,
            "watch": {
                "project_id": "stale-project",
                "path": "watch/volume_spike.py",
                "version_hash": "3dddce03193e170981e846241b9d2fff493276db72e7f47e295f4336db807bd7",
                "poll_interval_s": 60,
                "lookback_days": 30,
            },
        },
    )

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "감시 코드 파일 없음 — 다시 만들기"
    assert runtime.store.list_all() == []


def test_code_watch_draft_is_not_persisted_when_hash_is_unbacked(draft_client):
    client, runtime, project_root = draft_client
    target = project_root / "watch" / "volume_spike.py"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"x = 1\n")

    response = client.post(
        "/api/v1/routines/draft",
        json={
            "symbol": "005930",
            "condition": {"source": "code.watch", "op": "==", "value": True},
            "cooldown_s": 86400,
            "expires_days": 30,
            "watch": {
                "project_id": "stale-project",
                "path": "watch/volume_spike.py",
                "version_hash": "3dddce03193e170981e846241b9d2fff493276db72e7f47e295f4336db807bd7",
                "poll_interval_s": 60,
                "lookback_days": 30,
            },
        },
    )

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "검사 뒤 코드가 바뀜 — 다시 검사"
    assert runtime.store.list_all() == []
