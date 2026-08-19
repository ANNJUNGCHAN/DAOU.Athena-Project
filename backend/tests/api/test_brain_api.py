"""HTTP surface tests for /api/v1/brain/* (401/503/200, log masking).

Trap ⑫: chat POST must never leak `text` into logs (CLAUDE.md §6, ADR §2(h)).
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.main import create_app

BEARER = "local-test-bearer"
CHAT_PATH = "/api/v1/brain/chat"
STATUS_PATH = "/api/v1/brain/status"
CHATS_PATH = "/api/v1/brain/chats"
PROFILE_SUMMARY_PATH = "/api/v1/brain/profile-summary"
RESET_PATH = "/api/v1/brain/reset-and-restart"
SECRET_MARKER = "지난주에 삼성전자 100주를 매수하고 싶다는 비밀스러운 계획"


def _test_only_windows_dll_dir() -> Path | None:
    configured = os.getenv("ATHENA_LADYBUG_DLL_DIR")
    if configured:
        return Path(configured)
    local_test_runtime = Path(r"C:\Program Files\Git\mingw64\bin")
    if os.name == "nt" and local_test_runtime.is_dir():
        return local_test_runtime
    return None


@pytest.fixture
def ladybug_dll_dir(monkeypatch: pytest.MonkeyPatch) -> Path | None:
    runtime_dir = _test_only_windows_dll_dir()
    if runtime_dir is not None:
        monkeypatch.setenv("ATHENA_LADYBUG_DLL_DIR", str(runtime_dir))
    return runtime_dir


def _disabled_client() -> TestClient:
    app = create_app(Settings(_env_file=None, local_bearer_token=BEARER))
    return TestClient(app)


def _brain_settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        local_bearer_token=BEARER,
        brain_enabled=True,
        brain_db_path=tmp_path / "brain.lbug",
        brain_history_db_path=tmp_path / "brain-history.sqlite3",
        **overrides,
    )


# --- auth: 401/422, independent of brain readiness ------------------------------------


def test_chat_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.post(
            CHAT_PATH,
            json={
                "conversation_id": "conv:1",
                "role": "user",
                "text": "hello",
                "message_id": "msg:1",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )
    assert response.status_code == 422


def test_chat_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.post(
            CHAT_PATH,
            headers={"Authorization": "Bearer nope"},
            json={
                "conversation_id": "conv:1",
                "role": "user",
                "text": "hello",
                "message_id": "msg:1",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )
    assert response.status_code == 401


def test_status_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.get(STATUS_PATH, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_chats_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.get(CHATS_PATH, params={"conversation_id": "conv:1"})
    assert response.status_code == 422


def test_profile_summary_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.get(PROFILE_SUMMARY_PATH)
    assert response.status_code == 422


def test_reset_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.post(RESET_PATH)
    assert response.status_code == 422


def test_reset_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.post(RESET_PATH, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


# --- fail-closed 503 while the brain is not ready --------------------------------------


def test_chat_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:1",
                "role": "user",
                "text": "hello",
                "message_id": "msg:1",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )
    assert response.status_code == 503


def test_chats_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            CHATS_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            params={"conversation_id": "conv:1"},
        )
    assert response.status_code == 503


def test_profile_summary_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            PROFILE_SUMMARY_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 503


def test_reset_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.post(RESET_PATH, headers={"Authorization": f"Bearer {BEARER}"})
    assert response.status_code == 503


def test_status_always_answers_200_even_while_disabled() -> None:
    """Status reports readiness rather than requiring it -- mirrors /ready/accounts."""
    with _disabled_client() as client:
        response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "ready": False,
        "ingestion_ready": False,
        "extraction_enabled": False,
        "fts_ready": False,
    }


# --- happy path: real ladybug runtime available on this machine ------------------------


def test_chat_round_trip_and_status_and_no_body_leak_in_logs(
    tmp_path: Path, ladybug_dll_dir: Path | None, caplog: pytest.LogCaptureFixture
) -> None:
    if ladybug_dll_dir is None:
        pytest.skip("no local ladybug native runtime available on this machine")
    app = create_app(_brain_settings(tmp_path))
    user_occurred_at = datetime.now(UTC)
    assistant_occurred_at = user_occurred_at + timedelta(seconds=1)
    with caplog.at_level(logging.INFO), TestClient(app) as client:
        status_response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert status_response.status_code == 200
        assert status_response.json()["ingestion_ready"] is True

        user_response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:round-trip",
                "role": "user",
                "text": SECRET_MARKER,
                "message_id": "msg:user-1",
                "occurred_at": user_occurred_at.isoformat(),
            },
        )
        assert user_response.status_code == 200
        assert user_response.json()["source_id"] == "chat:msg:user-1"

        assistant_response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:round-trip",
                "role": "assistant",
                "text": "답변 본문",
                "message_id": "msg:assistant-1",
                "occurred_at": assistant_occurred_at.isoformat(),
            },
        )
        assert assistant_response.status_code == 200

        chats_response = client.get(
            CHATS_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            params={"conversation_id": "conv:round-trip"},
        )
        assert chats_response.status_code == 200
        messages = chats_response.json()["messages"]
        assert [message["role"] for message in messages] == ["user", "assistant"]
        assert messages[0]["text"] == SECRET_MARKER

    # Trap ⑫: the chat body must never reach any log record, success or otherwise.
    for record in caplog.records:
        assert SECRET_MARKER not in record.getMessage()


def test_profile_summary_empty_result_is_not_treated_as_not_ready(
    tmp_path: Path, ladybug_dll_dir: Path | None
) -> None:
    if ladybug_dll_dir is None:
        pytest.skip("no local ladybug native runtime available on this machine")
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        response = client.get(
            PROFILE_SUMMARY_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 200
    assert response.json() == {"entries": []}


# --- reset-and-restart: teardown + on-disk delete + shutdown hook + post-reset 503 ------


def test_reset_and_restart_tears_down_deletes_files_and_signals_shutdown(
    tmp_path: Path, ladybug_dll_dir: Path | None
) -> None:
    if ladybug_dll_dir is None:
        pytest.skip("no local ladybug native runtime available on this machine")
    history_path = tmp_path / "brain-history.sqlite3"
    graph_path = tmp_path / "brain.lbug"
    app = create_app(_brain_settings(tmp_path))
    shutdown_calls: list[None] = []
    with TestClient(app) as client:
        app.state.brain_shutdown_hook = lambda: shutdown_calls.append(None)

        status_before = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert status_before.json()["ready"] is True

        response = client.post(RESET_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert response.status_code == 200
        body = response.json()
        assert body["restarting"] is True
        assert history_path.name in "".join(body["deleted_files"]) or any(
            history_path.name in f for f in body["deleted_files"]
        )

        # Teardown happened: the brain runtime is gone, so subsequent brain routes 503.
        status_after = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert status_after.json()["ready"] is False
        chats_after = client.get(
            CHATS_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            params={"conversation_id": "conv:1"},
        )
        assert chats_after.status_code == 503

        # A second reset call also 503s -- brain_runtime was cleared, not left dangling.
        second_reset = client.post(RESET_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert second_reset.status_code == 503

    assert not history_path.exists()
    assert not (Path(str(history_path) + "-wal")).exists()
    assert not (Path(str(history_path) + "-shm")).exists()
    assert not graph_path.exists()
    assert shutdown_calls == [None]
