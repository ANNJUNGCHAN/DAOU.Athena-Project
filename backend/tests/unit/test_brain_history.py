import asyncio
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError

from athena_api.brain import (
    ChatHistoryRecord,
    ChatRole,
    CompletedTradeRecord,
    HistoryStore,
    JobStatus,
    JobTrigger,
    RetryPolicy,
    TradeSide,
)

NOW = datetime(2026, 8, 15, 3, 0, tzinfo=UTC)


def chat(message_id: str = "message-1", *, text: str = "반도체를 조사해 줘") -> ChatHistoryRecord:
    return ChatHistoryRecord(
        message_id=message_id,
        conversation_id="conversation-1",
        role=ChatRole.USER,
        text=text,
        occurred_at=NOW,
        metadata={"language": "ko"},
    )


def trade(trade_id: str = "trade-1") -> CompletedTradeRecord:
    return CompletedTradeRecord(
        trade_id=trade_id,
        security_id="005930",
        side=TradeSide.BUY,
        quantity=3,
        price=Decimal("72500"),
        occurred_at=NOW,
        metadata={"account_alias": "local"},
    )


@pytest.fixture
async def history(tmp_path: Path):
    store = HistoryStore(tmp_path / "history.sqlite3")
    await store.open()
    try:
        yield store
    finally:
        await store.close()


async def test_sqlite_schema_settings_and_reopen(tmp_path: Path) -> None:
    path = tmp_path / "history.sqlite3"
    first = HistoryStore(path)
    await first.open()
    await first.open()
    assert await first.schema_version() == 1

    def pragmas() -> tuple[str, int, int]:
        connection = first._db()
        return (
            str(connection.execute("PRAGMA journal_mode").fetchone()[0]),
            int(connection.execute("PRAGMA foreign_keys").fetchone()[0]),
            int(connection.execute("PRAGMA busy_timeout").fetchone()[0]),
        )

    assert await first._call(pragmas) == ("wal", 1, 5_000)
    await first.upsert_chat(chat(), changed_at=NOW)
    await first.close()

    second = HistoryStore(path)
    await second.open()
    assert (await second.chat_changes(0, limit=10))[0].record.id == "chat:message-1"
    await second.close()


async def test_history_close_is_idempotent_and_fails_closed(tmp_path: Path) -> None:
    store = HistoryStore(tmp_path / "history.sqlite3")
    await store.open()
    await store.close()
    await store.close()

    with pytest.raises(RuntimeError, match="closed"):
        await store.open()
    with pytest.raises(RuntimeError, match="not open"):
        await store.schema_version()


def test_raw_history_models_reject_unbounded_or_unsafe_values() -> None:
    with pytest.raises(ValidationError):
        ChatHistoryRecord(
            message_id="message 1",
            conversation_id="conversation-1",
            role=ChatRole.USER,
            text="valid",
            occurred_at=NOW,
        )
    with pytest.raises(ValidationError, match="JSON-safe"):
        ChatHistoryRecord(
            message_id="message-1",
            conversation_id="conversation-1",
            role=ChatRole.USER,
            text="valid",
            occurred_at=NOW,
            metadata={"bad": {1, 2}},
        )
    with pytest.raises(ValidationError, match="UTC-aware"):
        ChatHistoryRecord(
            message_id="message-1",
            conversation_id="conversation-1",
            role=ChatRole.USER,
            text="valid",
            occurred_at=datetime(2026, 8, 15),
        )


async def test_fingerprint_is_stable_and_changes_append_revision(
    history: HistoryStore,
) -> None:
    first = await history.upsert_chat(chat(), changed_at=NOW)
    unchanged = await history.upsert_chat(chat(), changed_at=NOW + timedelta(seconds=1))
    changed = await history.upsert_chat(
        chat(text="메모리 반도체를 조사해 줘"),
        changed_at=NOW + timedelta(seconds=2),
    )

    assert first.changed is True
    assert unchanged == type(unchanged)(
        source_id=first.source_id,
        fingerprint=first.fingerprint,
        revision=1,
        change_seq=first.change_seq,
        changed=False,
    )
    assert changed.revision == 2
    assert changed.change_seq > first.change_seq
    assert changed.fingerprint != first.fingerprint
    revisions = await history.chat_changes(0, limit=10)
    assert [item.revision for item in revisions] == [1, 2]
    assert revisions[1].record.text == "메모리 반도체를 조사해 줘"


async def test_metadata_is_revalidated_after_model_construction(
    history: HistoryStore,
) -> None:
    unsafe = chat()
    unsafe.metadata["mutated"] = {1, 2}
    with pytest.raises(ValueError, match="JSON-safe"):
        await history.upsert_chat(unsafe, changed_at=NOW)

    oversized = chat("message-2")
    oversized.metadata["mutated"] = "x" * 33_000
    with pytest.raises(ValueError, match="32768"):
        await history.upsert_chat(oversized, changed_at=NOW)
    assert await history.chat_changes(0, limit=10) == ()


async def test_chat_and_trade_cursor_state_is_isolated(history: HistoryStore) -> None:
    chat_result = await history.upsert_chat(chat(), changed_at=NOW)
    trade_result = await history.upsert_completed_trade(trade(), changed_at=NOW)

    assert await history.cursor("chat_history") == 0
    assert await history.cursor("completed_trade_history") == 0
    assert await history.advance_cursor("chat_history", chat_result.change_seq) == 1
    assert await history.cursor("completed_trade_history") == 0
    assert await history.advance_cursor("completed_trade_history", trade_result.change_seq) == 2
    assert await history.cursor("chat_history") == 1
    await history.reset_cursor("chat_history")
    assert await history.cursor("chat_history") == 0
    assert await history.cursor("completed_trade_history") == 2


async def test_durable_job_transitions_and_bounded_backoff(history: HistoryStore) -> None:
    policy = RetryPolicy(max_attempts=3, base_delay_seconds=2, max_delay_seconds=3)
    created = await history.create_job(JobTrigger.HOURLY, now=NOW)
    running = await history.claim_due_job(now=NOW)
    assert running is not None
    assert running.id == created.id
    assert running.status is JobStatus.RUNNING
    assert running.attempts == 1

    first_failure = await history.fail_job(running.id, "temporary", policy, now=NOW)
    assert first_failure.status is JobStatus.RETRY_WAIT
    assert first_failure.next_retry_at == NOW + timedelta(seconds=2)
    assert await history.claim_due_job(now=NOW + timedelta(seconds=1)) is None

    second = await history.claim_due_job(now=NOW + timedelta(seconds=2))
    assert second is not None and second.attempts == 2
    second_failure = await history.fail_job(
        second.id, "temporary again", policy, now=NOW + timedelta(seconds=2)
    )
    assert second_failure.next_retry_at == NOW + timedelta(seconds=5)

    third = await history.claim_due_job(now=NOW + timedelta(seconds=5))
    assert third is not None and third.attempts == 3
    terminal = await history.fail_job(third.id, "terminal", policy, now=NOW + timedelta(seconds=5))
    assert terminal.status is JobStatus.FAILED
    assert terminal.completed_at == NOW + timedelta(seconds=5)
    assert terminal.next_retry_at is None


async def test_due_job_claim_is_atomic_under_concurrent_callers(
    history: HistoryStore,
) -> None:
    job = await history.create_job(JobTrigger.MANUAL, now=NOW)
    claims = await asyncio.gather(
        history.claim_due_job(now=NOW),
        history.claim_due_job(now=NOW),
    )

    claimed = [item for item in claims if item is not None]
    assert len(claimed) == 1
    assert claimed[0].id == job.id
    assert claimed[0].attempts == 1


async def test_restart_recovers_stale_running_job(tmp_path: Path) -> None:
    path = tmp_path / "history.sqlite3"
    first = HistoryStore(path)
    await first.open()
    job = await first.create_job(JobTrigger.MANUAL, now=NOW)
    claimed = await first.claim_due_job(now=NOW)
    assert claimed is not None and claimed.id == job.id
    await first.close()

    second = HistoryStore(path)
    await second.open()
    policy = RetryPolicy(max_attempts=3, base_delay_seconds=30, max_delay_seconds=60)
    assert (
        await second.recover_stale_jobs(
            policy,
            now=NOW + timedelta(minutes=11),
            stale_after=timedelta(minutes=10),
        )
        == 1
    )
    recovered = await second.get_job(job.id)
    assert recovered is not None
    assert recovered.status is JobStatus.RETRY_WAIT
    assert recovered.next_retry_at == NOW + timedelta(minutes=11, seconds=30)
    assert await second.claim_due_job(now=NOW + timedelta(minutes=11)) is None
    reclaimed = await second.claim_due_job(now=NOW + timedelta(minutes=11, seconds=30))
    assert reclaimed is not None and reclaimed.attempts == 2
    await second.close()


async def test_restart_recovery_fails_stale_last_attempt(tmp_path: Path) -> None:
    path = tmp_path / "history.sqlite3"
    first = HistoryStore(path)
    await first.open()
    job = await first.create_job(JobTrigger.MANUAL, now=NOW)
    claimed = await first.claim_due_job(now=NOW)
    assert claimed is not None and claimed.attempts == 1
    await first.close()

    second = HistoryStore(path)
    await second.open()
    policy = RetryPolicy(max_attempts=1, base_delay_seconds=1, max_delay_seconds=1)
    assert (
        await second.recover_stale_jobs(
            policy,
            now=NOW + timedelta(minutes=11),
            stale_after=timedelta(minutes=10),
        )
        == 1
    )
    recovered = await second.get_job(job.id)
    assert recovered is not None
    assert recovered.status is JobStatus.FAILED
    assert recovered.completed_at == NOW + timedelta(minutes=11)
    assert recovered.next_retry_at is None
    await second.close()


async def test_sqlite_work_does_not_block_event_loop(
    history: HistoryStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = history._upsert_source_sync

    def slow_upsert(*args):
        time.sleep(0.08)
        return original(*args)

    monkeypatch.setattr(history, "_upsert_source_sync", slow_upsert)
    write = asyncio.create_task(history.upsert_chat(chat(), changed_at=NOW))
    await asyncio.sleep(0.01)
    assert not write.done()
    heartbeat = time.perf_counter()
    await asyncio.sleep(0)
    assert time.perf_counter() - heartbeat < 0.03
    await write
