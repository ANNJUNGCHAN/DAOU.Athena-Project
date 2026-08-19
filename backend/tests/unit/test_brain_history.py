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
    SourceKind,
    TradeSide,
)
from athena_api.brain.history import MAX_TRANSCRIPT_CHARS

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


def chat_turn(
    message_id: str, conversation_id: str, role: ChatRole, text: str, occurred_at: datetime
) -> ChatHistoryRecord:
    return ChatHistoryRecord(
        message_id=message_id,
        conversation_id=conversation_id,
        role=role,
        text=text,
        occurred_at=occurred_at,
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


# --- conversation rollup: conversations() / compact_conversations() --------------------


async def test_conversations_aggregates_and_orders_by_recency(history: HistoryStore) -> None:
    await history.upsert_chat(
        chat_turn("msg-a1", "conv-a", ChatRole.USER, "a1", NOW), changed_at=NOW
    )
    await history.upsert_chat(
        chat_turn("msg-a2", "conv-a", ChatRole.ASSISTANT, "a2", NOW + timedelta(seconds=1)),
        changed_at=NOW + timedelta(seconds=1),
    )
    await history.upsert_chat(
        chat_turn("msg-b1", "conv-b", ChatRole.USER, "b1", NOW + timedelta(seconds=5)),
        changed_at=NOW + timedelta(seconds=5),
    )

    summaries = await history.conversations()
    assert [summary.conversation_id for summary in summaries] == ["conv-b", "conv-a"]
    conv_a = next(summary for summary in summaries if summary.conversation_id == "conv-a")
    assert conv_a.message_count == 2
    assert conv_a.first_occurred_at == NOW
    assert conv_a.last_occurred_at == NOW + timedelta(seconds=1)


async def test_conversations_rejects_out_of_bounds_limit(history: HistoryStore) -> None:
    with pytest.raises(ValueError, match="limit"):
        await history.conversations(limit=0)
    with pytest.raises(ValueError, match="limit"):
        await history.conversations(limit=501)


async def test_compact_conversations_renders_role_labelled_transcript(
    history: HistoryStore,
) -> None:
    await history.upsert_chat(
        chat_turn("msg-1", "conv-transcript", ChatRole.USER, "반도체 어때?", NOW),
        changed_at=NOW,
    )
    await history.upsert_chat(
        chat_turn(
            "msg-2",
            "conv-transcript",
            ChatRole.ASSISTANT,
            "좋아 보입니다",
            NOW + timedelta(seconds=1),
        ),
        changed_at=NOW + timedelta(seconds=1),
    )

    updated = await history.compact_conversations(now=NOW + timedelta(seconds=2))
    assert updated == ("conversation:conv-transcript",)

    changes = await history.conversation_changes(0, limit=10)
    assert len(changes) == 1
    record = changes[0].record
    assert record.kind is SourceKind.CONVERSATION
    assert record.text == "user: 반도체 어때?\nassistant: 좋아 보입니다\n"
    assert record.locator == "conversation:conv-transcript"
    assert record.occurred_at == NOW + timedelta(seconds=1)
    assert record.attributes["conversation"] == {
        "conversation_id": "conv-transcript",
        "message_count": 2,
        "included_message_count": 2,
        "truncated": False,
    }


async def test_transcript_budget_stays_under_the_ontology_bound() -> None:
    """The budget only works if it is actually below what SourceRecord.text accepts."""
    assert MAX_TRANSCRIPT_CHARS < 10_000


async def test_long_conversation_is_windowed_instead_of_wedging_ingestion(
    history: HistoryStore,
) -> None:
    """A conversation past the ontology text bound must still roll up.

    Without the budget the oversized row fails SourceRecord validation on the way back
    out, the rollup raises, and -- since a rollup failure fails the whole job -- one long
    conversation would permanently stop ingestion for every conversation.
    """
    filler = "가" * 500
    total = 40  # 40 * ~500 chars >> MAX_TRANSCRIPT_CHARS
    for index in range(total):
        await history.upsert_chat(
            chat_turn(
                f"long-{index}",
                "conv-long",
                ChatRole.USER if index % 2 == 0 else ChatRole.ASSISTANT,
                f"{index} {filler}",
                NOW + timedelta(seconds=index),
            ),
            changed_at=NOW + timedelta(seconds=index),
        )

    updated = await history.compact_conversations(now=NOW + timedelta(seconds=total))
    assert updated == ("conversation:conv-long",)

    # Deserializing through SourceRecord is the step that used to blow up.
    changes = await history.conversation_changes(0, limit=10)
    record = changes[0].record
    assert len(record.text) <= MAX_TRANSCRIPT_CHARS
    conversation = record.attributes["conversation"]
    assert conversation["message_count"] == total
    assert conversation["truncated"] is True
    assert 0 < conversation["included_message_count"] < total
    # The window keeps the newest turns -- those are what give a follow-up its meaning.
    assert f"{total - 1} " in record.text
    assert not record.text.startswith("user: 0 ")


async def test_single_turn_longer_than_the_budget_still_produces_a_transcript(
    history: HistoryStore,
) -> None:
    """Emitting nothing would silently drop the conversation from extraction entirely.

    Reachability note: `ChatHistoryRecord.text` is itself `LongText` (max 10_000), so a
    single stored turn can never exceed that. The band this branch actually serves is
    `MAX_TRANSCRIPT_CHARS < len(turn) <= 10_000`, which is why the budget sits below the
    ontology bound rather than at it.
    """
    oversized = "나" * (MAX_TRANSCRIPT_CHARS + 500)
    assert len(oversized) <= 10_000
    await history.upsert_chat(
        chat_turn("huge-1", "conv-huge", ChatRole.USER, oversized, NOW),
        changed_at=NOW,
    )

    updated = await history.compact_conversations(now=NOW + timedelta(seconds=1))
    assert updated == ("conversation:conv-huge",)

    changes = await history.conversation_changes(0, limit=10)
    record = changes[0].record
    assert 0 < len(record.text) <= MAX_TRANSCRIPT_CHARS
    assert record.attributes["conversation"]["included_message_count"] == 1


async def test_compact_conversations_is_idempotent_until_new_messages_arrive(
    history: HistoryStore,
) -> None:
    await history.upsert_chat(
        chat_turn("msg-1", "conv-idem", ChatRole.USER, "첫 메시지", NOW), changed_at=NOW
    )

    first = await history.compact_conversations(now=NOW + timedelta(seconds=1))
    assert first == ("conversation:conv-idem",)

    unchanged = await history.compact_conversations(now=NOW + timedelta(seconds=2))
    assert unchanged == ()
    assert len(await history.conversation_changes(0, limit=10)) == 1

    await history.upsert_chat(
        chat_turn(
            "msg-2", "conv-idem", ChatRole.ASSISTANT, "둘째 메시지", NOW + timedelta(seconds=3)
        ),
        changed_at=NOW + timedelta(seconds=3),
    )
    grown = await history.compact_conversations(now=NOW + timedelta(seconds=4))
    assert grown == ("conversation:conv-idem",)
    changes = await history.conversation_changes(0, limit=10)
    assert len(changes) == 2
    assert changes[-1].revision == 2


async def test_compact_conversations_is_noop_with_no_chat_messages(
    history: HistoryStore,
) -> None:
    assert await history.compact_conversations(now=NOW) == ()
    assert await history.conversation_changes(0, limit=10) == ()


async def test_compact_conversations_does_not_reconsume_its_own_output(
    history: HistoryStore,
) -> None:
    await history.upsert_chat(
        chat_turn("msg-1", "conv-loop", ChatRole.USER, "loop check", NOW), changed_at=NOW
    )
    await history.compact_conversations(now=NOW + timedelta(seconds=1))
    # A second pass must still see exactly one chat-derived conversation, not two --
    # `conversation:conv-loop` (the source this just wrote) shares its locator string with
    # the chat_message rows but must not be read back as another chat_message locator.
    again = await history.compact_conversations(now=NOW + timedelta(seconds=2))
    assert again == ()
    assert len(await history.conversation_changes(0, limit=10)) == 1
