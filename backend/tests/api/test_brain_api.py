
from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from athena_api.brain import IngestionJob, JobStatus, JobTrigger
from athena_api.config import Settings
from athena_api.main import create_app

BEARER = "local-test-bearer"
CHAT_PATH = "/api/v1/brain/chat"
STATUS_PATH = "/api/v1/brain/status"
STARTUP_RETRY_PATH = "/api/v1/brain/startup-ingestion/retry"
INGESTION_JOBS_PATH = "/api/v1/brain/ingestion/jobs"
CHATS_PATH = "/api/v1/brain/chats"
CONVERSATIONS_PATH = "/api/v1/brain/conversations"
PROFILE_SUMMARY_PATH = "/api/v1/brain/profile-summary"
RESET_PATH = "/api/v1/brain/reset-and-restart"
ENTITY_TIMELINE_PATH = "/api/v1/brain/analysis/entity-timeline"
RETRACT_PATH = "/api/v1/brain/relations/retractions"
CONFIRM_PATH = "/api/v1/brain/relations/confirmations"
SECRET_MARKER = "지난주에 삼성전자 100주를 매수하고 싶다는 비밀스러운 계획"


def _disabled_client() -> TestClient:
    app = create_app(Settings(_env_file=None, local_bearer_token=BEARER))
    return TestClient(app)


def _brain_settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        local_bearer_token=BEARER,
        brain_enabled=True,
        brain_db_path=tmp_path / "brain.sqlite3",
        **overrides,
    )


def _ingestion_job(job_id: str, status: JobStatus) -> IngestionJob:
    now = datetime.now(UTC)
    return IngestionJob(
        id=job_id,
        trigger=JobTrigger.STARTUP,
        status=status,
        attempts=1,
        created_at=now,
        started_at=now if status is not JobStatus.PENDING else None,
        completed_at=now if status in {JobStatus.SUCCEEDED, JobStatus.FAILED} else None,
        next_retry_at=(now + timedelta(seconds=1)) if status is JobStatus.RETRY_WAIT else None,
        error=(
            "  startup failed\nwith internal detail  "
            if status in {JobStatus.RETRY_WAIT, JobStatus.FAILED}
            else None
        ),
    )


class _FakeStartupHistory:
    def __init__(self, job: IngestionJob) -> None:
        self.jobs = {job.id: job}

    async def get_job(self, job_id: str) -> IngestionJob | None:
        return self.jobs.get(job_id)


class _FakeStartupCoordinator:
    def __init__(self, history: _FakeStartupHistory) -> None:
        self.history = history
        self.calls = 0

    async def enqueue(self, trigger: JobTrigger) -> IngestionJob:
        assert trigger is JobTrigger.STARTUP
        self.calls += 1
        job = _ingestion_job(f"job:retry-{self.calls}", JobStatus.PENDING)
        self.history.jobs[job.id] = job
        return job


def _install_fake_startup_runtime(client: TestClient, job: IngestionJob) -> SimpleNamespace:
    history = _FakeStartupHistory(job)
    coordinator = _FakeStartupCoordinator(history)
    runtime = SimpleNamespace(
        history=history,
        coordinator=coordinator,
        ingestion_ready=True,
        ingestion_last_error=None,
        startup_ingestion_job_id=job.id,
        startup_ingestion_lock=asyncio.Lock(),
    )
    client.app.state.settings = Settings(_env_file=None, brain_enabled=True)
    client.app.state.brain_runtime = runtime
    client.app.state.brain_ready = True
    client.app.state.brain_ingestion_ready = True
    client.app.state.brain_extraction_enabled = False
    return runtime


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


def test_manual_ingestion_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.post(INGESTION_JOBS_PATH)
    assert response.status_code == 422


def test_manual_ingestion_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.post(
            INGESTION_JOBS_PATH,
            headers={"Authorization": "Bearer nope"},
        )
    assert response.status_code == 401


def test_chats_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.get(CHATS_PATH, params={"conversation_id": "conv:1"})
    assert response.status_code == 422


def test_conversations_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.get(CONVERSATIONS_PATH)
    assert response.status_code == 422


def test_conversations_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.get(CONVERSATIONS_PATH, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


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


def test_manual_ingestion_and_status_503_while_brain_disabled() -> None:
    with _disabled_client() as client:
        headers = {"Authorization": f"Bearer {BEARER}"}
        assert client.post(INGESTION_JOBS_PATH, headers=headers).status_code == 503
        assert client.get(f"{INGESTION_JOBS_PATH}/job:missing", headers=headers).status_code == 503


def test_chats_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            CHATS_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            params={"conversation_id": "conv:1"},
        )
    assert response.status_code == 503


def test_conversations_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            CONVERSATIONS_PATH, headers={"Authorization": f"Bearer {BEARER}"}
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
        "ingest_schedule_owner": "backend",
        "startup_ingestion_job_id": None,
        "startup_ingestion_status": None,
        "startup_ingestion_detail": "brain_disabled",
    }


def test_status_exposes_external_ingestion_schedule_owner(tmp_path: Path) -> None:
    settings = _brain_settings(tmp_path, brain_ingest_schedule_owner="external")
    with TestClient(create_app(settings)) as client:
        response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})

    assert response.status_code == 200
    assert response.json()["ingest_schedule_owner"] == "external"


def test_status_reports_terminal_startup_failure_with_public_detail_code() -> None:
    with _disabled_client() as client:
        failed = _ingestion_job("job:failed", JobStatus.FAILED)
        _install_fake_startup_runtime(client, failed)
        response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})

    assert response.status_code == 200
    body = response.json()
    assert body["startup_ingestion_job_id"] == failed.id
    assert body["startup_ingestion_status"] == "failed"
    assert body["startup_ingestion_detail"] == "startup_ingestion_failed"
    assert "internal detail" not in response.text


def test_status_reports_ingestion_degradation_explicitly() -> None:
    with _disabled_client() as client:
        client.app.state.settings = Settings(_env_file=None, brain_enabled=True)
        client.app.state.brain_runtime = SimpleNamespace(
            history=None,
            coordinator=None,
            ingestion_ready=False,
            ingestion_last_error="  history open failed\ninternal frame  ",
            startup_ingestion_job_id=None,
        )
        response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})

    assert response.status_code == 200
    body = response.json()
    assert body["startup_ingestion_job_id"] is None
    assert body["startup_ingestion_status"] is None
    assert body["startup_ingestion_detail"] == "brain_ingestion_degraded"
    assert "internal frame" not in response.text


@pytest.mark.parametrize(
    "status",
    [
        JobStatus.PENDING,
        JobStatus.RUNNING,
        JobStatus.RETRY_WAIT,
        JobStatus.SUCCEEDED,
    ],
)
def test_status_reports_startup_job_progress(status: JobStatus) -> None:
    with _disabled_client() as client:
        current = _ingestion_job("job:progress", status)
        _install_fake_startup_runtime(client, current)
        response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})

    assert response.status_code == 200
    body = response.json()
    assert body["startup_ingestion_job_id"] == current.id
    assert body["startup_ingestion_status"] == status.value
    if status is JobStatus.RETRY_WAIT:
        assert body["startup_ingestion_detail"] == "startup_ingestion_retry_wait"
    else:
        assert body["startup_ingestion_detail"] is None


@pytest.mark.parametrize(
    "status", [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.RETRY_WAIT]
)
def test_startup_retry_does_not_duplicate_nonterminal_job(status: JobStatus) -> None:
    with _disabled_client() as client:
        current = _ingestion_job("job:current", status)
        runtime = _install_fake_startup_runtime(client, current)
        response = client.post(
            STARTUP_RETRY_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "created": False,
        "job_id": current.id,
        "status": status.value,
    }
    assert runtime.coordinator.calls == 0
    assert runtime.startup_ingestion_job_id == current.id


def test_startup_retry_replaces_only_terminal_failed_job() -> None:
    with _disabled_client() as client:
        failed = _ingestion_job("job:failed", JobStatus.FAILED)
        runtime = _install_fake_startup_runtime(client, failed)
        first = client.post(
            STARTUP_RETRY_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
        )
        second = client.post(
            STARTUP_RETRY_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
        )

    assert first.status_code == 200
    assert first.json() == {
        "created": True,
        "job_id": "job:retry-1",
        "status": "pending",
    }
    assert second.status_code == 200
    assert second.json() == {
        "created": False,
        "job_id": "job:retry-1",
        "status": "pending",
    }
    assert runtime.coordinator.calls == 1
    assert runtime.startup_ingestion_job_id == "job:retry-1"


def test_manual_ingestion_enqueue_and_exact_job_status_lifecycle(tmp_path: Path) -> None:
    app = create_app(_brain_settings(tmp_path))
    headers = {"Authorization": f"Bearer {BEARER}"}
    with TestClient(app) as client:
        queued = client.post(INGESTION_JOBS_PATH, headers=headers)
        assert queued.status_code == 200
        body = queued.json()
        assert body["trigger"] == "manual"
        assert body["status"] == "pending"
        assert body["attempts"] == 0
        assert body["created_at"] is not None
        assert body["started_at"] is None
        assert body["completed_at"] is None
        assert body["next_retry_at"] is None
        assert body["error"] is None

        job_id = body["id"]
        for _ in range(100):
            current = client.get(f"{INGESTION_JOBS_PATH}/{job_id}", headers=headers)
            assert current.status_code == 200
            if current.json()["status"] == "succeeded":
                break
        final = current.json()
        assert final["id"] == job_id
        assert final["trigger"] == "manual"
        assert final["status"] == "succeeded"
        assert final["attempts"] == 1
        assert final["started_at"] is not None
        assert final["completed_at"] is not None
        assert final["error"] is None

        missing = client.get(f"{INGESTION_JOBS_PATH}/job:missing", headers=headers)
        assert missing.status_code == 404
        assert missing.json() == {"detail": "ingestion job not found"}


def test_ingestion_job_error_is_generic_and_does_not_leak_internal_detail() -> None:
    with _disabled_client() as client:
        failed = _ingestion_job("job:failed-manual", JobStatus.FAILED)
        runtime = _install_fake_startup_runtime(client, failed)
        failed = IngestionJob(
            id=failed.id,
            trigger=JobTrigger.MANUAL,
            status=failed.status,
            attempts=failed.attempts,
            created_at=failed.created_at,
            started_at=failed.started_at,
            completed_at=failed.completed_at,
            next_retry_at=failed.next_retry_at,
            error=failed.error,
        )
        runtime.history.jobs[failed.id] = failed
        response = client.get(
            f"{INGESTION_JOBS_PATH}/{failed.id}",
            headers={"Authorization": f"Bearer {BEARER}"},
        )

    assert response.status_code == 200
    assert response.json()["error"] == "ingestion_failed"
    assert "internal detail" not in response.text


# --- happy path -----------------------------------------------------------------------


def test_chat_round_trip_and_status_and_no_body_leak_in_logs(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app(_brain_settings(tmp_path))
    user_occurred_at = datetime.now(UTC)
    assistant_occurred_at = user_occurred_at + timedelta(seconds=1)
    with caplog.at_level(logging.INFO), TestClient(app) as client:
        status_response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert status_response.status_code == 200
        status_body = status_response.json()
        assert status_body["ingestion_ready"] is True
        assert status_body["startup_ingestion_job_id"] is not None
        assert status_body["startup_ingestion_status"] in {
            "pending",
            "running",
            "retry_wait",
            "succeeded",
        }
        assert status_body["startup_ingestion_detail"] is None

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


@pytest.mark.parametrize("length", [12_345, 20_000])
def test_chat_preserves_long_raw_text_and_replay_is_idempotent(
    tmp_path: Path, length: int
) -> None:
    db_path = tmp_path / "brain.sqlite3"
    prefix, suffix = "시작|", "|끝"
    text = prefix + ("가" * (length - len(prefix) - len(suffix))) + suffix
    assert len(text) == length
    payload = {
        "conversation_id": f"conv:long-{length}",
        "role": "user",
        "text": text,
        "message_id": f"msg:long-{length}",
        "occurred_at": datetime.now(UTC).isoformat(),
    }
    app = create_app(_brain_settings(tmp_path))

    with TestClient(app) as client:
        first = client.post(CHAT_PATH, headers={"Authorization": f"Bearer {BEARER}"}, json=payload)
        replay = client.post(CHAT_PATH, headers={"Authorization": f"Bearer {BEARER}"}, json=payload)

    assert first.status_code == 200
    assert replay.status_code == 200
    assert replay.json() == first.json()
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            "SELECT text FROM source_records WHERE source_id = ?",
            (f"chat:msg:long-{length}",),
        ).fetchall()
    assert rows == [(text,)]


def test_chat_rejects_text_above_the_local_raw_history_limit(tmp_path: Path) -> None:
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:too-long",
                "role": "user",
                "text": "가" * 20_001,
                "message_id": "msg:too-long",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )

    assert response.status_code == 422
    with sqlite3.connect(tmp_path / "brain.sqlite3") as connection:
        count = connection.execute(
            "SELECT COUNT(*) FROM source_records WHERE source_id = 'chat:msg:too-long'"
        ).fetchone()
    assert count == (0,)


@pytest.mark.parametrize(
    ("length", "expected_status"),
    [(20_000, 200), (20_001, 422)],
)
def test_chat_raw_history_limit_counts_astral_unicode_code_points(
    tmp_path: Path, length: int, expected_status: int
) -> None:
    text = "😀" * length
    assert len(text) == length
    message_id = f"msg:astral-{length}"
    app = create_app(_brain_settings(tmp_path))

    with TestClient(app) as client:
        response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:astral-boundary",
                "role": "user",
                "text": text,
                "message_id": message_id,
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )

    assert response.status_code == expected_status
    with sqlite3.connect(tmp_path / "brain.sqlite3") as connection:
        rows = connection.execute(
            "SELECT text FROM source_records WHERE source_id = ?",
            (f"chat:{message_id}",),
        ).fetchall()
    assert rows == ([(text,)] if expected_status == 200 else [])


def test_conversations_lists_ids_counts_and_timestamps_without_transcript_body(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app(_brain_settings(tmp_path))
    occurred_at = datetime.now(UTC)
    with caplog.at_level(logging.INFO), TestClient(app) as client:
        client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:list-me",
                "role": "user",
                "text": SECRET_MARKER,
                "message_id": "msg:list-1",
                "occurred_at": occurred_at.isoformat(),
            },
        )

        response = client.get(
            CONVERSATIONS_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 200
    body = response.json()
    assert body["conversations"] == [
        {
            "conversation_id": "conv:list-me",
            "message_count": 1,
            "first_occurred_at": body["conversations"][0]["first_occurred_at"],
            "last_occurred_at": body["conversations"][0]["last_occurred_at"],
        }
    ]
    # Trap 12: the list response and its logs must never carry the transcript body.
    assert SECRET_MARKER not in response.text
    for record in caplog.records:
        assert SECRET_MARKER not in record.getMessage()


def test_profile_summary_empty_result_is_not_treated_as_not_ready(
    tmp_path: Path
) -> None:
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        response = client.get(
            PROFILE_SUMMARY_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 200
    # total/window_days는 항상 실린다 — 비어 있어도 "몇 개 중 0개인지"와
    # "어느 창을 봤는지"는 말할 수 있어야 한다.
    assert response.json() == {
        "entries": [], "total": 0, "window_days": 90, "confidence_counts": {},
    }


# --- reset-and-restart: teardown + on-disk delete + shutdown hook + post-reset 503 ------


def test_reset_and_restart_tears_down_deletes_files_and_signals_shutdown(
    tmp_path: Path
) -> None:
    brain_path = tmp_path / "brain.sqlite3"
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
        # 파일이 하나로 합쳐졌으므로 지워진 목록도 그 하나(+WAL/SHM 사이드카)뿐이다.
        assert any(brain_path.name in name for name in body["deleted_files"])

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

    assert not brain_path.exists()
    assert not (Path(str(brain_path) + "-wal")).exists()
    assert not (Path(str(brain_path) + "-shm")).exists()
    assert shutdown_calls == [None]


# --- 표면이 실제 데이터로 도는가 (leaf 7) ----------------------------------------------
#
# 이전 판 `/profile-summary`는 저장층에 **존재하지 않는 속성**(`claim_count`,
# `average_confidence`)을 읽고 있었다. leaf 1이 `Claim`을 폐기하면서 사라진 이름들이다.
# 그런데 테스트가 빈 결과만 봐서 `AttributeError`가 한 번도 드러나지 않았다 — 성향이
# 하나라도 쌓이는 순간 500이었다. 아래 테스트들은 전부 **비어 있지 않은 그래프**를 만든다.


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {BEARER}"}


async def _seed_graph(app) -> None:
    """대화 하나와 체결 하나를 실제 저장층에 넣는다."""
    from decimal import Decimal

    from athena_api.brain import (
        ChatHistoryRecord,
        ChatRole,
        CompletedTradeRecord,
        DeterministicTradeProjector,
        IngestionCoordinator,
        JobTrigger,
        TradeSide,
    )

    history = app.state.brain_history
    store = app.state.brain_store
    now = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)
    await history.upsert_chat(
        ChatHistoryRecord(
            message_id="msg:1",
            conversation_id="conv:1",
            role=ChatRole.USER,
            text="삼성전자 계속 들고 갈 생각이야",
            occurred_at=now,
        ),
        changed_at=now,
    )
    await history.upsert_completed_trade(
        CompletedTradeRecord(
            trade_id="exec:1",
            security_id="005930",
            side=TradeSide.BUY,
            quantity=2,
            price=Decimal("72000"),
            occurred_at=now,
        ),
        changed_at=now,
    )
    coordinator = IngestionCoordinator(
        history,
        store,
        clock=lambda: now,
        deterministic_projector=DeterministicTradeProjector(store, clock=lambda: now),
    )
    await coordinator.enqueue(JobTrigger.MANUAL)
    await coordinator.run_next()


@pytest.fixture
def seeded_client(tmp_path: Path):
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        client.portal.call(_seed_graph, app)  # type: ignore[attr-defined]
        yield client


def test_profile_summary_survives_a_non_empty_graph(seeded_client: TestClient) -> None:
    """비어 있지 않은 결과에서 500이 나지 않는다 — 이전 판은 여기서 죽었다."""
    response = seeded_client.get(PROFILE_SUMMARY_PATH, headers=_headers())
    assert response.status_code == 200
    entries = response.json()["entries"]
    assert entries, "체결이 성향으로 잡혀야 한다"
    entry = entries[0]
    # 새 온톨로지의 필드들. `tier`가 있어야 말과 행동을 구분해 읽을 수 있다.
    assert set(response.json()) == {"entries", "total", "window_days", "confidence_counts"}
    assert set(entry) == {
        "entity_id",
        "entity_kind",
        "entity_name",
        "relation_kind",
        "confidence",
        "tier",
        "rationale",
        "observed_at",
        "reinforcement",
    }
    assert entry["tier"] == "deterministic"


def test_profile_summary_reports_total_and_window(seeded_client: TestClient) -> None:
    """`entries`가 잘린 상위 N일 때 화면이 "상위 5 / 전체 M개"를 쓸 수 있어야 한다.

    total이 없던 동안 화면은 그 문구를 아예 안 그렸다 — M을 정직하게 채울 방법이
    없었기 때문이다. 여기서 지키는 계약은 둘이다: total은 limit에 안 잘리고,
    window_days는 요청한 창을 그대로 되돌려준다.
    """
    full = seeded_client.get(PROFILE_SUMMARY_PATH, headers=_headers()).json()
    assert full["window_days"] == 90
    assert full["total"] == len(full["entries"]), "자르지 않았으면 둘이 같다"
    assert sum(full["confidence_counts"].values()) == full["total"], (
        "히어로 분포는 잘리기 전 전체를 덮어야 한다"
    )

    limited = seeded_client.get(
        PROFILE_SUMMARY_PATH, headers=_headers(), params={"limit": 1}
    ).json()
    assert len(limited["entries"]) == 1
    assert limited["total"] == full["total"], "total은 limit에 잘리지 않는다"


def test_profile_summary_window_days_narrows_both_entries_and_total(
    seeded_client: TestClient,
) -> None:
    """창을 좁히면 entries와 total이 **함께** 줄어든다.

    둘이 다른 조건을 보면 "상위 5 / 전체 3" 같은 모순이 화면에 뜬다.
    """
    narrow = seeded_client.get(
        PROFILE_SUMMARY_PATH, headers=_headers(), params={"window_days": 1}
    ).json()
    assert narrow["window_days"] == 1
    assert narrow["total"] >= len(narrow["entries"])
    wide = seeded_client.get(
        PROFILE_SUMMARY_PATH, headers=_headers(), params={"window_days": 365}
    ).json()
    assert wide["total"] >= narrow["total"]


def test_cluster_map_edge_details_carry_observed_at(edge_detail_client: TestClient) -> None:
    """엣지마다 마지막 관측 시각이 실린다 — 지도의 기간 필터가 이 값으로 거른다.

    이 필드가 없던 동안 화면은 "최근 90일"이라 써 놓고 전체 기간을 그리고 있었다.
    """
    body = edge_detail_client.get(
        "/api/v1/brain/analysis/cluster-map", headers=_headers()
    ).json()
    assert body["edge_details"], "씨앗에 종목↔테마 엣지가 있어야 이 계약을 잴 수 있다"
    for detail in body["edge_details"]:
        assert detail["observed_at"], "관측 시각이 비어 있으면 기간 필터가 못 건다"
        # ISO-8601이어야 렌더러의 Date.parse가 읽는다.
        datetime.fromisoformat(detail["observed_at"])


def test_no_claim_era_field_survives_on_the_surface(seeded_client: TestClient) -> None:
    """`Claim` 시절 이름이 응답 스키마의 **속성**으로 남아 있지 않다.

    원문 전체를 문자열로 훑으면 안 된다 — 무엇을 왜 걷어냈는지 설명하는 docstring이
    OpenAPI `description`에 실려서, 산문이 사실을 서술한다는 이유로 실패한다.
    (`no-ladybug` 게이트가 정확히 그 실수를 하고 있었고 leaf 6에서 고쳤다.)
    """
    schemas = seeded_client.get("/openapi.json").json()["components"]["schemas"]
    properties = {
        name
        for definition in schemas.values()
        for name in definition.get("properties", {})
    }
    for gone in ("claim_count", "average_confidence", "latest_observed_at"):
        assert gone not in properties, f"{gone}가 표면에 남아 있다"
    # 양성 대조: 스캐너가 실재하는 속성은 찾아낸다.
    assert "reinforcement" in properties
    assert "tier" in properties


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/brain/analysis/god-nodes",
        "/api/v1/brain/analysis/surprising-connections",
        "/api/v1/brain/analysis/suggested-questions",
        "/api/v1/brain/analysis/diff",
        "/api/v1/brain/analysis/cluster-map",
    ],
)
def test_analysis_endpoints_answer_on_a_real_graph(
    seeded_client: TestClient, path: str
) -> None:
    response = seeded_client.get(path, headers=_headers())
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), dict)


def test_cluster_map_carries_a_revision_and_sorted_nodes(seeded_client: TestClient) -> None:
    """순서가 흔들리면 캔버스가 이유 없이 다시 그려진다."""
    body = seeded_client.get(
        "/api/v1/brain/analysis/cluster-map", headers=_headers()
    ).json()
    assert body["revision"] > 0
    ids = [node["entity_id"] for node in body["nodes"]]
    assert ids == sorted(ids)
    assert ids, "그래프가 비어 있으면 이 테스트가 아무것도 재지 않는다"


def test_cluster_map_includes_representative_labels_for_every_cluster(
    seeded_client: TestClient,
) -> None:
    """A2 배선 확인 — cluster_representative_labels가 모든 군집에 대해 실제로 실린다."""
    body = seeded_client.get(
        "/api/v1/brain/analysis/cluster-map", headers=_headers()
    ).json()
    labels = body["cluster_representative_labels"]
    clusters_present = {node["cluster"] for node in body["nodes"]}
    assert labels, "군집이 있으면 라벨도 있어야 한다"
    assert {int(k) for k in labels} == clusters_present
    for label in labels.values():
        assert " · " in label, f"형식이 '대표멤버 · kind'가 아니다: {label!r}"


def test_god_nodes_limit_is_clamped_instead_of_erroring(seeded_client: TestClient) -> None:
    """잘못된 상한이 500으로 새지 않는다 — 분석 함수는 `limit<=0`에 ValueError를 던진다."""
    for limit in (0, -5, 10_000):
        response = seeded_client.get(
            "/api/v1/brain/analysis/god-nodes",
            headers=_headers(),
            params={"limit": limit},
        )
        assert response.status_code == 200, (limit, response.text)


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/brain/analysis/god-nodes",
        "/api/v1/brain/analysis/cluster-map",
    ],
)
def test_analysis_endpoints_503_while_brain_disabled(path: str) -> None:
    with _disabled_client() as client:
        assert client.get(path, headers=_headers()).status_code == 503


def test_analysis_endpoints_require_the_bearer(seeded_client: TestClient) -> None:
    assert seeded_client.get("/api/v1/brain/analysis/god-nodes").status_code == 422
    assert (
        seeded_client.get(
            "/api/v1/brain/analysis/god-nodes",
            headers={"Authorization": "Bearer wrong"},
        ).status_code
        == 401
    )


def test_the_projector_is_shared_across_requests(seeded_client: TestClient) -> None:
    """요청마다 새로 만들면 리비전 캐시가 매번 비어 캐시를 둔 이유가 사라진다.

    `builds`가 **정확히 1만 는다**를 재는 것이 요점이다. "많아야 1"로 재면 엔드포인트가
    app.state의 그 객체를 아예 안 쓰고 매번 새 투영기를 만들어도(그 객체의 builds는
    0에 머문다) 통과해버린다 — 처음에 그렇게 썼다가 음성 대조가 발화하지 않아 드러났다.
    """
    projector = seeded_client.app.state.brain_projector
    assert projector is not None
    before = projector.builds
    for _ in range(3):
        response = seeded_client.get(
            "/api/v1/brain/analysis/god-nodes", headers=_headers()
        )
        assert response.status_code == 200
    assert projector.builds == before + 1, (
        "공유 투영기가 정확히 한 번만 지어야 한다 "
        f"(before={before}, after={projector.builds})"
    )


def test_cluster_map_does_not_recompute_clusters_per_request(
    seeded_client: TestClient,
) -> None:
    """군집 계산이 요청마다 돌면 1000노드에서 요청당 0.5초를 버린다.

    이전 판은 엔드포인트가 `cluster(projected)`를 직접 불러 **매번** 다시 계산했다.
    투영은 캐시하면서 그 위의 군집은 안 하고 있었던 것이 이 테스트가 잡는 것이다.
    """
    projector = seeded_client.app.state.brain_projector
    before = projector.cluster_builds
    for _ in range(3):
        response = seeded_client.get(
            "/api/v1/brain/analysis/cluster-map", headers=_headers()
        )
        assert response.status_code == 200
    assert projector.cluster_builds == before + 1, (
        f"군집이 요청마다 다시 계산됐다 (before={before}, after={projector.cluster_builds})"
    )


def test_surprising_connections_reuses_the_cached_clusters(
    seeded_client: TestClient,
) -> None:
    """두 엔드포인트가 같은 배정을 공유한다 — 화면 하나에 둘 다 뜨기 때문이다."""
    projector = seeded_client.app.state.brain_projector
    before = projector.cluster_builds
    for path in (
        "/api/v1/brain/analysis/cluster-map",
        "/api/v1/brain/analysis/surprising-connections",
    ):
        assert seeded_client.get(path, headers=_headers()).status_code == 200
    assert projector.cluster_builds == before + 1


# --- surprise_score: additive 상대 놀라움 점수 (WP-B) -----------------------------------


async def _seed_two_cliques_with_a_bridge(app) -> None:
    """완전그래프 둘을 다리 하나로 잇는다 — surprising_connections가 이 다리를 잡아야 한다."""
    from athena_api.brain import (
        Confidence,
        Entity,
        EntityKind,
        Relation,
        SourceKind,
        SourceRecord,
        SourceTier,
        entity_id,
        relation_id,
    )

    store = app.state.brain_store
    now = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)

    def make_entity(kind: object, name: str) -> Entity:
        return Entity(
            id=entity_id(kind, name),
            kind=kind,
            name=name,
            created_at=now,
            updated_at=now,
        )

    def make_relation(kind: str, src: Entity, tgt: Entity) -> Relation:
        return Relation(
            id=relation_id(kind, src.id, tgt.id),
            kind=kind,
            source_entity_id=src.id,
            target_entity_id=tgt.id,
            confidence=Confidence.EXTRACTED,
            tier=SourceTier.CONVERSATIONAL,
            source_id="s1",
            observed_at=now,
            extracted_at=now,
        )

    left = tuple(make_entity(EntityKind.THEME, f"좌{i}") for i in range(4))
    right = tuple(make_entity(EntityKind.COMPANY, f"우{i}") for i in range(4))
    relations: list[Relation] = []
    for group in (left, right):
        for index, node in enumerate(group):
            for other in group[index + 1 :]:
                relations.append(make_relation("relates_to", node, other))
    relations.append(make_relation("relates_to", left[0], right[0]))

    await store.upsert_source(
        SourceRecord(
            id="s1",
            kind=SourceKind.CONVERSATION,
            text="대화 본문",
            fingerprint="fp-s1",
            occurred_at=now,
            ingested_at=now,
        )
    )
    await store.apply_extraction("s1", "fp-s1", (*left, *right), tuple(relations))


@pytest.fixture
def surprising_client(tmp_path: Path):
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        client.portal.call(_seed_two_cliques_with_a_bridge, app)  # type: ignore[attr-defined]
        yield client


def test_surprising_connections_response_includes_surprise_score(
    surprising_client: TestClient,
) -> None:
    """지어낸 값이 아니라 backend가 낸 [0,1] 상대 점수가 응답 JSON에 실린다."""
    body = surprising_client.get(
        "/api/v1/brain/analysis/surprising-connections", headers=_headers()
    ).json()
    connections = body["connections"]
    assert connections, "다리가 하나 있으므로 최소 1건은 나와야 한다"
    for item in connections:
        assert set(item) == {
            "source_entity_id",
            "source_name",
            "target_entity_id",
            "target_name",
            "kinds",
            "source_cluster",
            "target_cluster",
            "surprise_score",
        }
        assert 0.0 <= item["surprise_score"] <= 1.0


# --- edge_details: additive 엣지 메타데이터 (스텝13-보정) -------------------------------


async def _seed_two_distinct_edges(app) -> None:
    """엣지 둘 — 각자 다른 kind/tier/confidence라 값이 relation에서 그대로 나오는지 잰다."""
    from athena_api.brain import (
        INVESTOR_PROFILE_ENTITY_ID,
        INVESTOR_PROFILE_NAME,
        Confidence,
        Entity,
        EntityKind,
        Relation,
        SourceKind,
        SourceRecord,
        SourceTier,
        entity_id,
        relation_id,
    )

    store = app.state.brain_store
    now = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)
    profile = Entity(
        id=INVESTOR_PROFILE_ENTITY_ID,
        kind=EntityKind.INVESTOR_PROFILE,
        name=INVESTOR_PROFILE_NAME,
        created_at=now,
        updated_at=now,
    )
    samsung = Entity(
        id=entity_id(EntityKind.SECURITY, "삼성전자"),
        kind=EntityKind.SECURITY,
        name="삼성전자",
        created_at=now,
        updated_at=now,
    )
    theme = Entity(
        id=entity_id(EntityKind.THEME, "고배당주"),
        kind=EntityKind.THEME,
        name="고배당주",
        created_at=now,
        updated_at=now,
    )
    await store.upsert_source(
        SourceRecord(
            id="s1",
            kind=SourceKind.CONVERSATION,
            text="대화 본문",
            fingerprint="fp-s1",
            occurred_at=now,
            ingested_at=now,
        )
    )
    await store.apply_extraction(
        "s1",
        "fp-s1",
        (profile, samsung, theme),
        (
            Relation(
                id=relation_id("owns", profile.id, samsung.id),
                kind="owns",
                source_entity_id=profile.id,
                target_entity_id=samsung.id,
                confidence=Confidence.EXTRACTED,
                tier=SourceTier.DETERMINISTIC,
                source_id="s1",
                observed_at=now,
                extracted_at=now,
            ),
            Relation(
                id=relation_id("interested_in", profile.id, theme.id),
                kind="interested_in",
                source_entity_id=profile.id,
                target_entity_id=theme.id,
                confidence=Confidence.AMBIGUOUS,
                tier=SourceTier.CONVERSATIONAL,
                source_id="s1",
                observed_at=now,
                extracted_at=now,
            ),
            # 지도에 실제로 남는 유일한 엣지 — 프로필이 빠져도 종목↔테마는 남는다.
            Relation(
                id=relation_id("belongs_to", samsung.id, theme.id),
                kind="belongs_to",
                source_entity_id=samsung.id,
                target_entity_id=theme.id,
                confidence=Confidence.INFERRED,
                tier=SourceTier.CONVERSATIONAL,
                source_id="s1",
                observed_at=now,
                extracted_at=now,
            ),
        ),
    )


@pytest.fixture
def edge_detail_client(tmp_path: Path):
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        client.portal.call(_seed_two_distinct_edges, app)  # type: ignore[attr-defined]
        yield client


def test_cluster_map_edge_details_carry_kind_tier_confidence_from_relations(
    edge_detail_client: TestClient,
) -> None:
    """edge_details는 projection이 이미 싣는 값을 그대로 낸다 — 새로 계산하지 않는다."""
    from athena_api.brain import INVESTOR_PROFILE_ENTITY_ID, EntityKind, entity_id

    body = edge_detail_client.get(
        "/api/v1/brain/analysis/cluster-map", headers=_headers()
    ).json()
    profile_id = INVESTOR_PROFILE_ENTITY_ID
    samsung_id = entity_id(EntityKind.SECURITY, "삼성전자")
    theme_id = entity_id(EntityKind.THEME, "고배당주")

    # 프로필에서 뻗은 두 엣지는 지도에서 빠지고(analysis 투영), 종목↔테마 하나만 남는다.
    details = body["edge_details"]
    assert len(details) == 1
    for detail in details:
        assert set(detail) == {
            "source", "target", "kinds", "tier", "confidence", "observed_at",
        }
    assert profile_id not in {node["entity_id"] for node in body["nodes"]}

    by_pair = {(d["source"], d["target"]): d for d in details}
    belongs_pair = tuple(sorted((samsung_id, theme_id)))
    assert set(by_pair) == {belongs_pair}

    belongs_detail = by_pair[belongs_pair]
    assert belongs_detail["kinds"] == ["belongs_to"]
    assert belongs_detail["tier"] == "conversational"
    assert belongs_detail["confidence"] == "INFERRED"

    # edges와 edge_details가 같은 pair 목록·같은 순서에서 나온다는 계약.
    assert body["edges"] == [list(belongs_pair)]


def test_cluster_map_edge_details_merge_kinds_on_the_same_pair(
    seeded_client: TestClient,
) -> None:
    """무연결이 아니라 실제 데이터를 쓰는 seeded_client에서도 응답 계약이 안 깨진다."""
    body = seeded_client.get(
        "/api/v1/brain/analysis/cluster-map", headers=_headers()
    ).json()
    assert len(body["edge_details"]) == len(body["edges"]), (
        "edge_details와 edges는 같은 엣지 집합이어야 한다"
    )
    for detail in body["edge_details"]:
        assert detail["kinds"], "kind가 최소 1개는 있어야 한다"
        assert detail["tier"] in {"deterministic", "conversational"}
        assert detail["confidence"] in {"EXTRACTED", "INFERRED", "AMBIGUOUS"}


# --- entity-timeline: 소규모 신설 엔드포인트 (WP-C) --------------------------------------


async def _seed_one_owns_relation(app) -> None:
    from athena_api.brain import (
        INVESTOR_PROFILE_ENTITY_ID,
        INVESTOR_PROFILE_NAME,
        Confidence,
        Entity,
        EntityKind,
        Relation,
        SourceKind,
        SourceRecord,
        SourceTier,
        entity_id,
        relation_id,
    )

    store = app.state.brain_store
    now = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)
    profile = Entity(
        id=INVESTOR_PROFILE_ENTITY_ID,
        kind=EntityKind.INVESTOR_PROFILE,
        name=INVESTOR_PROFILE_NAME,
        created_at=now,
        updated_at=now,
    )
    samsung = Entity(
        id=entity_id(EntityKind.SECURITY, "삼성전자"),
        kind=EntityKind.SECURITY,
        name="삼성전자",
        created_at=now,
        updated_at=now,
    )
    await store.upsert_source(
        SourceRecord(
            id="s1",
            kind=SourceKind.CONVERSATION,
            text="대화 본문",
            fingerprint="fp-s1",
            occurred_at=now,
            ingested_at=now,
        )
    )
    await store.apply_extraction(
        "s1",
        "fp-s1",
        (profile, samsung),
        (
            Relation(
                id=relation_id("owns", profile.id, samsung.id),
                kind="owns",
                source_entity_id=profile.id,
                target_entity_id=samsung.id,
                confidence=Confidence.EXTRACTED,
                tier=SourceTier.CONVERSATIONAL,
                source_id="s1",
                observed_at=now,
                extracted_at=now,
            ),
        ),
    )


@pytest.fixture
def entity_timeline_client(tmp_path: Path):
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        client.portal.call(_seed_one_owns_relation, app)  # type: ignore[attr-defined]
        yield client


def test_entity_timeline_returns_events_for_a_known_entity(
    entity_timeline_client: TestClient,
) -> None:
    from athena_api.brain import INVESTOR_PROFILE_ENTITY_ID

    body = entity_timeline_client.get(
        ENTITY_TIMELINE_PATH,
        headers=_headers(),
        params={"entity_id": INVESTOR_PROFILE_ENTITY_ID},
    ).json()
    assert body["entity_id"] == INVESTOR_PROFILE_ENTITY_ID
    assert body["events"], "owns 관계가 하나 있으므로 최소 1건은 나와야 한다"
    event = body["events"][0]
    assert set(event) == {
        "seq",
        "at",
        "revision",
        "op",
        "subject_id",
        "object_id",
        "relation",
        "confidence_before",
        "confidence_after",
        "source_id",
    }


def test_entity_timeline_requires_the_bearer(entity_timeline_client: TestClient) -> None:
    """기존 라우트 관례와 동일 — 헤더 자체가 없으면 422, 틀린 토큰이면 401."""
    assert (
        entity_timeline_client.get(
            ENTITY_TIMELINE_PATH, params={"entity_id": "entity:x"}
        ).status_code
        == 422
    )
    assert (
        entity_timeline_client.get(
            ENTITY_TIMELINE_PATH,
            headers={"Authorization": "Bearer wrong"},
            params={"entity_id": "entity:x"},
        ).status_code
        == 401
    )


def test_entity_timeline_is_empty_for_an_unknown_entity(
    entity_timeline_client: TestClient,
) -> None:
    body = entity_timeline_client.get(
        ENTITY_TIMELINE_PATH,
        headers=_headers(),
        params={"entity_id": "entity:doesnotexist"},
    ).json()
    assert body["events"] == []


def test_entity_timeline_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            ENTITY_TIMELINE_PATH, headers=_headers(), params={"entity_id": "entity:x"}
        )
    assert response.status_code == 503


# --- WP-F F4/F5: cluster_ai_labels — lazy+백그라운드 채움 ------------------------------

CLUSTER_MAP_PATH = "/api/v1/brain/analysis/cluster-map"


class _SlowLlm:
    """지연 주입 fake — in-flight 상한 검증에서 호출 완료를 늦춘다."""

    def __init__(self, delay: float) -> None:
        self.calls = 0
        self._delay = delay

    async def complete(self, prompt: str) -> bytes:
        self.calls += 1
        import asyncio

        await asyncio.sleep(self._delay)
        return '{"label": "AI 라벨"}'.encode()


class _BlockingLlm:
    """완료 장벽 fake — 첫 응답이 LLM 완료보다 먼저인지 인과 순서로 검증한다."""

    def __init__(self) -> None:
        from threading import Event

        self.calls = 0
        self.started = Event()
        self.release = Event()

    async def complete(self, prompt: str) -> bytes:
        self.calls += 1
        self.started.set()
        await asyncio.to_thread(self.release.wait)
        return '{"label": "AI 라벨"}'.encode()


def test_cluster_ai_labels_first_miss_is_empty_and_fast_then_cached(
    seeded_client: TestClient,
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    app = seeded_client.app  # type: ignore[attr-defined]
    llm = _BlockingLlm()
    app.state.brain_cluster_labeling_llm_client = llm
    with ThreadPoolExecutor(max_workers=1) as executor:
        first_request = executor.submit(seeded_client.get, CLUSTER_MAP_PATH, headers=_headers())
        assert llm.started.wait(timeout=10), "백그라운드 LLM 태스크가 시작된다"
        try:
            first = first_request.result(timeout=10).json()
            assert first["cluster_ai_labels"] == {}, "첫 미스는 필드를 비운 채 즉시 반환한다"
            assert not llm.release.is_set(), "첫 응답은 LLM 완료 장벽보다 먼저 반환한다"
            # 캐시 미스 직후 in-flight 집합에 태스크가 추가돼 있어야 한다(참조 보관).
            assert app.state.cluster_labeling_tasks, "백그라운드 태스크 참조가 보관된다"
        finally:
            llm.release.set()
    # 완료 대기 — TestClient portal 안에서 태스크를 직접 기다리고 done_callback을 한 tick 진행한다.
    async def wait_for_labels() -> None:
        await asyncio.gather(*tuple(app.state.cluster_labeling_tasks.values()))
        await asyncio.sleep(0)

    assert seeded_client.portal is not None
    seeded_client.portal.call(wait_for_labels)
    assert not app.state.cluster_labeling_tasks, "완료된 태스크는 집합에서 자동 제거된다"
    second = seeded_client.get(CLUSTER_MAP_PATH, headers=_headers()).json()
    assert second["cluster_ai_labels"], "캐시가 채워진 뒤 재요청은 라벨을 싣는다"
    assert all(v == "AI 라벨" for v in second["cluster_ai_labels"].values())


def test_cluster_ai_labels_stay_empty_when_labeling_is_dormant(
    seeded_client: TestClient,
) -> None:
    # G-F1 — LLM 미설정(client None)이면 필드는 항상 빈 dict이고 스폰도 없다.
    app = seeded_client.app  # type: ignore[attr-defined]
    assert app.state.brain_cluster_labeling_llm_client is None
    body = seeded_client.get(CLUSTER_MAP_PATH, headers=_headers()).json()
    assert body["cluster_ai_labels"] == {}
    assert not app.state.cluster_labeling_tasks


def test_cluster_ai_label_spawn_respects_inflight_cap(seeded_client: TestClient) -> None:
    llm = _SlowLlm(delay=30)
    app = seeded_client.app  # type: ignore[attr-defined]
    app.state.brain_cluster_labeling_llm_client = llm
    # 상한이 이미 찬 상태를 흉내낸다 — 새 미스는 스폰을 건너뛰고 폴백만 반환한다.
    app.state.cluster_labeling_tasks = {
        (f"prompt-{index}", f"members-{index}"): object() for index in range(4)
    }
    try:
        body = seeded_client.get(CLUSTER_MAP_PATH, headers=_headers()).json()
        assert body["cluster_ai_labels"] == {}
        assert llm.calls == 0, "상한 도달 시 태스크를 만들지 않는다"
        assert len(app.state.cluster_labeling_tasks) == 4
    finally:
        app.state.cluster_labeling_tasks = {}


def test_identical_inflight_cluster_requests_reuse_labeling_tasks(
    seeded_client: TestClient,
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    app = seeded_client.app  # type: ignore[attr-defined]
    llm = _BlockingLlm()
    app.state.brain_cluster_labeling_llm_client = llm

    with ThreadPoolExecutor(max_workers=2) as executor:
        first_request = executor.submit(
            seeded_client.get, CLUSTER_MAP_PATH, headers=_headers()
        )
        assert llm.started.wait(timeout=10)
        initial_tasks = dict(app.state.cluster_labeling_tasks)
        initial_calls = llm.calls
        second_request = executor.submit(
            seeded_client.get, CLUSTER_MAP_PATH, headers=_headers()
        )
        try:
            first = first_request.result(timeout=10).json()
            second = second_request.result(timeout=10).json()
            assert first["cluster_ai_labels"] == {}
            assert second["cluster_ai_labels"] == {}
            assert app.state.cluster_labeling_tasks == initial_tasks
            assert llm.calls == initial_calls
        finally:
            llm.release.set()

    async def wait_for_labels() -> None:
        await asyncio.gather(*tuple(app.state.cluster_labeling_tasks.values()))
        await asyncio.sleep(0)

    assert seeded_client.portal is not None
    seeded_client.portal.call(wait_for_labels)


# ── 노드 상세(2026-09-03, 채팅의 "이 노드 설명해줘") ────────────────────────────

ENTITY_DETAIL_PATH = "/api/v1/brain/analysis/entity-detail"


def test_entity_detail_resolves_a_plain_name_and_carries_the_source_text(
    seeded_client: TestClient,
) -> None:
    """이름만 알아도 찾아야 한다 — 채팅에서 사람은 entity_id를 말하지 않는다."""
    body = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "005930"}
    ).json()
    assert body["resolved"] is True
    assert body["name"] == "005930"
    assert body["query"] == "005930"
    assert body["degree"] >= 1
    assert body["revision"] > 0
    assert body["relations"], "체결이 성향 관계로 잡혀 있어야 한다"

    edge = body["relations"][0]
    assert edge["direction"] in {"in", "out"}
    assert edge["other_entity_name"]
    assert edge["reinforcement"] >= 1
    # 원문 발췌가 실려야 "왜 이렇게 기록됐나"를 모델이 인용할 수 있다.
    assert edge["source"] is not None
    assert edge["source"]["text"]
    assert edge["source"]["truncated"] is False
    assert edge["source"]["full_chars"] == len(edge["source"]["text"])


def test_entity_detail_accepts_the_entity_id_the_canvas_already_has(
    seeded_client: TestClient,
) -> None:
    by_name = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "005930"}
    ).json()
    by_id = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": by_name["entity_id"]}
    ).json()
    assert by_id["resolved"] is True
    assert by_id["entity_id"] == by_name["entity_id"]


def test_entity_detail_carries_the_timeline_of_that_node(seeded_client: TestClient) -> None:
    body = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "005930"}
    ).json()
    assert body["timeline"], "노드가 생긴 사건이라도 있어야 한다"
    event = body["timeline"][0]
    assert set(event) == {
        "seq",
        "at",
        "revision",
        "op",
        "subject_id",
        "object_id",
        "relation",
        "confidence_before",
        "confidence_after",
        "source",
    }
    seqs = [item["seq"] for item in body["timeline"]]
    assert seqs == sorted(seqs, reverse=True), "최신 먼저여야 화면 타임라인과 같은 순서다"


def test_entity_detail_does_not_invent_a_node_that_is_not_there(
    seeded_client: TestClient,
) -> None:
    body = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "없는회사"}
    ).json()
    assert body["resolved"] is False
    assert body["relations"] == []
    assert body["timeline"] == []
    assert body["entity_id"] is None


def test_entity_detail_refuses_to_guess_between_similar_names(
    seeded_client: TestClient,
) -> None:
    """이름이 여럿에 걸리면 하나를 골라 설명하면 안 된다 — 후보를 주고 되묻게 한다.

    FTS5 `unicode61`은 한국어를 공백 토큰으로 자른다 — "반도체 대형주"와 "반도체 장비"는
    `반도체` 토큰을 공유하므로 "반도체"가 둘에 걸린다. 반대로 "삼성전자"·"삼성화재"는
    각각 한 토큰이라 "삼성"으로는 아예 안 걸린다(그건 이 저장층의 성질이고, 여기서
    고치지 않는다 — 다만 이 테스트가 그 성질에 기대지 않게 이름을 골랐다).
    """
    store = seeded_client.app.state.brain_store

    async def add_two_more(app) -> None:
        from athena_api.brain.ontology import (
            Confidence,
            Entity,
            EntityKind,
            Relation,
            SourceKind,
            SourceRecord,
            SourceTier,
            entity_id,
            relation_id,
        )
        from athena_api.brain.store import INVESTOR_PROFILE_ENTITY_ID

        now = datetime(2026, 8, 26, 3, 0, tzinfo=UTC)
        await store.upsert_source(
            SourceRecord(
                id="src:extra",
                kind=SourceKind.CHAT_MESSAGE,
                text="반도체 대형주랑 반도체 장비 둘 다 봤어",
                fingerprint="fp-extra",
                occurred_at=now,
                ingested_at=now,
            )
        )
        profile = Entity(
            id=INVESTOR_PROFILE_ENTITY_ID,
            kind=EntityKind.INVESTOR_PROFILE,
            name="default",
            created_at=now,
            updated_at=now,
        )
        made = [
            Entity(
                id=entity_id(EntityKind.THEME, name),
                kind=EntityKind.THEME,
                name=name,
                created_at=now,
                updated_at=now,
            )
            for name in ("반도체 대형주", "반도체 장비")
        ]
        await store.apply_extraction(
            "src:extra",
            "fp-extra",
            (profile, *made),
            tuple(
                Relation(
                    id=relation_id("interested_in", profile.id, item.id),
                    kind="interested_in",
                    source_entity_id=profile.id,
                    target_entity_id=item.id,
                    confidence=Confidence.EXTRACTED,
                    tier=SourceTier.CONVERSATIONAL,
                    rationale=None,
                    source_id="src:extra",
                    observed_at=now,
                    extracted_at=now,
                )
                for item in made
            ),
        )

    seeded_client.portal.call(add_two_more, seeded_client.app)  # type: ignore[attr-defined]

    ambiguous = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "반도체"}
    ).json()
    assert ambiguous["resolved"] is False
    names = {candidate["name"] for candidate in ambiguous["candidates"]}
    assert names == {"반도체 대형주", "반도체 장비"}, names
    assert ambiguous["relations"] == []

    # 반대로 이름을 온전히 대면 후보가 여럿 걸려도 정확히 일치하는 하나를 고른다.
    exact = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "반도체 장비"}
    ).json()
    assert exact["resolved"] is True
    assert exact["name"] == "반도체 장비"


def test_entity_detail_treats_a_blank_query_as_unresolved(seeded_client: TestClient) -> None:
    body = seeded_client.get(
        ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "   "}
    ).json()
    assert body["resolved"] is False
    assert body["candidates"] == []


def test_entity_detail_clamps_the_limit_instead_of_erroring(seeded_client: TestClient) -> None:
    for limit in (0, -5, 10_000):
        response = seeded_client.get(
            ENTITY_DETAIL_PATH,
            headers=_headers(),
            params={"entity": "005930", "limit": limit},
        )
        assert response.status_code == 200, (limit, response.text)
        assert response.json()["resolved"] is True


def test_entity_detail_requires_the_bearer_and_the_entity(seeded_client: TestClient) -> None:
    assert seeded_client.get(ENTITY_DETAIL_PATH).status_code == 422
    # entity 없이 부르면 무엇을 설명할지 모른다 — 422다, 빈 답이 아니다.
    assert seeded_client.get(ENTITY_DETAIL_PATH, headers=_headers()).status_code == 422
    assert (
        seeded_client.get(
            ENTITY_DETAIL_PATH,
            headers={"Authorization": "Bearer wrong"},
            params={"entity": "005930"},
        ).status_code
        == 401
    )


def test_entity_detail_503s_while_the_brain_is_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            ENTITY_DETAIL_PATH, headers=_headers(), params={"entity": "005930"}
        )
        assert response.status_code == 503


def test_entity_detail_is_closed_to_the_model_when_exposure_is_off(
    seeded_client: TestClient,
) -> None:
    """노드 원문이 나가는 경로라 노출 토글을 반드시 탄다 — entity-timeline과 다른 점이다."""
    seeded_client.app.state.expose_to_model = False
    denied = seeded_client.get(
        ENTITY_DETAIL_PATH,
        headers={**_headers(), "X-Athena-Caller": "model"},
        params={"entity": "005930"},
    )
    assert denied.status_code == 503
    # brain_tools.dispatch()가 "토글 꺼짐"과 "브레인 미기동"을 이 문자열로 구분한다.
    assert denied.json()["detail"] == "expose-to-model-disabled"

    seeded_client.app.state.expose_to_model = True
    allowed = seeded_client.get(
        ENTITY_DETAIL_PATH,
        headers={**_headers(), "X-Athena-Caller": "model"},
        params={"entity": "005930"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["resolved"] is True


# ── 사람의 직접 취소 입구(2026-09-03) ────────────────────────────────────────


def test_relation_retraction_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.post(RETRACT_PATH, json={"relation_id": "relation:x"})
    assert response.status_code == 422


def test_relation_retraction_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.post(
            RETRACT_PATH,
            json={"relation_id": "relation:x"},
            headers={"Authorization": "Bearer nope"},
        )
    assert response.status_code == 401


def test_relation_retraction_is_not_exposed_to_the_model() -> None:
    """그래프 쓰기가 사람의 행동에서 시작한다는 규칙을 이 입구가 깨지 않는다.

    모델은 athena_brain으로만 브레인에 닿고 거기엔 쓰기 액션이 없다
    (test_no_write_action_exists). 이 입구는 사람이 카드를 누른 결과로만 불린다 —
    OpenAPI에 그 사실이 적혀 있어야 게이트웨이가 실수로 노출하지 않는다.
    """
    with _disabled_client() as client:
        schema = client.get("/openapi.json").json()
    operation = schema["paths"]["/api/v1/brain/relations/retractions"]["post"]
    assert operation["x-athena-llm-exposed"] is False
    assert operation["x-athena-side-effect"] == "write"


def test_relation_confirmation_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.post(CONFIRM_PATH, json={"relation_id": "relation:x"})
    assert response.status_code == 422


def test_relation_confirmation_is_not_exposed_to_the_model() -> None:
    """확인도 쓰기다 — 취소 입구와 같은 규칙을 따른다."""
    with _disabled_client() as client:
        schema = client.get("/openapi.json").json()
    operation = schema["paths"]["/api/v1/brain/relations/confirmations"]["post"]
    assert operation["x-athena-llm-exposed"] is False
    assert operation["x-athena-side-effect"] == "write"
