import asyncio
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from athena_api.brain import (
    ChatHistoryRecord,
    ChatRole,
    CompletedTradeRecord,
    GraphStore,
    HistoryStore,
    IngestionCoordinator,
    JobStatus,
    JobTrigger,
    RetryPolicy,
    SourceRecord,
    TradeSide,
)

NOW = datetime(2026, 8, 15, 4, 0, tzinfo=UTC)


@dataclass
class ManualClock:
    value: datetime

    def __call__(self) -> datetime:
        return self.value

    def advance(self, delta: timedelta) -> None:
        self.value += delta


class FailOnceProjection:
    def __init__(self, graph: GraphStore, fail_source_id: str) -> None:
        self._graph = graph
        self._fail_source_id = fail_source_id
        self._failed = False

    async def upsert_source(self, source: SourceRecord) -> str:
        if source.id == self._fail_source_id and not self._failed:
            self._failed = True
            raise RuntimeError("deterministic projection failure")
        return await self._graph.upsert_source(source)


class CancelAfterProjection:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph
        self.projected = asyncio.Event()
        self._block = asyncio.Event()

    async def upsert_source(self, source: SourceRecord) -> str:
        result = await self._graph.upsert_source(source)
        self.projected.set()
        await self._block.wait()
        return result


class ConcurrencyTrackingProjection:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph
        self.active = 0
        self.max_active = 0
        self.started = asyncio.Event()

    async def upsert_source(self, source: SourceRecord) -> str:
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.started.set()
        try:
            await asyncio.sleep(0.02)
            return await self._graph.upsert_source(source)
        finally:
            self.active -= 1

    async def reset_projection(self) -> None:
        await self._graph.reset_projection()


class FailAfterResetProjection:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def upsert_source(self, source: SourceRecord) -> str:
        return await self._graph.upsert_source(source)

    async def reset_projection(self) -> None:
        await self._graph.reset_projection()
        raise RuntimeError("deterministic reset interruption")


def chat(message_id: str, text: str) -> ChatHistoryRecord:
    return ChatHistoryRecord(
        message_id=message_id,
        conversation_id="conversation-ingestion",
        role=ChatRole.USER,
        text=text,
        occurred_at=NOW,
    )


def completed_trade() -> CompletedTradeRecord:
    return CompletedTradeRecord(
        trade_id="execution-1",
        security_id="005930",
        side=TradeSide.BUY,
        quantity=2,
        price=Decimal("72000"),
        occurred_at=NOW,
    )


async def wait_for_job_status(
    history: HistoryStore,
    job_id: str,
    status: JobStatus,
    *,
    max_wait_seconds: float = 2,
):
    deadline = asyncio.get_running_loop().time() + max_wait_seconds
    while asyncio.get_running_loop().time() < deadline:
        job = await history.get_job(job_id)
        if job is not None and job.status is status:
            return job
        await asyncio.sleep(0.01)
    raise AssertionError(f"job {job_id} did not reach {status.value}")


@pytest.fixture
def ladybug_dll_dir(monkeypatch: pytest.MonkeyPatch) -> Path | None:
    configured = os.getenv("ATHENA_LADYBUG_DLL_DIR")
    if configured:
        return Path(configured)
    # Test harness fallback only; production code performs no path discovery.
    local_test_runtime = Path(r"C:\Program Files\Git\mingw64\bin")
    runtime = local_test_runtime if os.name == "nt" else None
    if runtime is not None:
        monkeypatch.setenv("ATHENA_LADYBUG_DLL_DIR", str(runtime))
    return runtime


@pytest.fixture
async def stores(tmp_path: Path, ladybug_dll_dir: Path | None):
    history = HistoryStore(tmp_path / "history.sqlite3")
    graph = GraphStore(tmp_path / "brain.lbug", dll_dir=ladybug_dll_dir)
    await history.open()
    await graph.open()
    try:
        yield history, graph
    finally:
        await graph.close()
        await history.close()


async def test_chat_and_completed_trade_incrementally_project_into_real_graph(stores) -> None:
    history, graph = stores
    await history.upsert_chat(chat("message-1", "반도체를 조사해 줘"), changed_at=NOW)
    await history.upsert_completed_trade(completed_trade(), changed_at=NOW)
    clock = ManualClock(NOW)
    coordinator = IngestionCoordinator(history, graph, batch_size=1, clock=clock)

    first_job = await coordinator.enqueue(JobTrigger.MANUAL)
    first = await coordinator.run_next()
    assert first is not None
    assert first.job_id == first_job.id
    assert first.status is JobStatus.SUCCEEDED
    assert first.total_projected == 2
    assert (await graph.summary()).sources == 2

    await coordinator.enqueue(JobTrigger.HOURLY)
    unchanged = await coordinator.run_next()
    assert unchanged is not None and unchanged.total_projected == 0

    await history.upsert_chat(
        chat("message-1", "메모리 반도체를 조사해 줘"),
        changed_at=NOW + timedelta(seconds=1),
    )
    clock.advance(timedelta(seconds=1))
    await coordinator.enqueue(JobTrigger.HOURLY)
    changed = await coordinator.run_next()
    assert changed is not None and changed.total_projected == 1
    assert (await graph.summary()).sources == 2


async def test_mid_batch_failure_retries_from_last_success_without_duplicates(stores) -> None:
    history, graph = stores
    first = await history.upsert_chat(chat("message-1", "첫 메시지"), changed_at=NOW)
    await history.upsert_chat(chat("message-2", "둘째 메시지"), changed_at=NOW)
    clock = ManualClock(NOW)
    policy = RetryPolicy(max_attempts=3, base_delay_seconds=1, max_delay_seconds=2)
    failing = FailOnceProjection(graph, "chat:message-2")
    coordinator = IngestionCoordinator(
        history,
        failing,
        batch_size=2,
        retry_policy=policy,
        clock=clock,
    )
    job = await coordinator.enqueue(JobTrigger.MANUAL)

    with pytest.raises(RuntimeError, match="deterministic projection failure"):
        await coordinator.run_next()
    failed_attempt = await history.get_job(job.id)
    assert failed_attempt is not None
    assert failed_attempt.status is JobStatus.RETRY_WAIT
    assert await history.cursor("chat_history") == first.change_seq
    assert (await graph.summary()).sources == 1

    clock.advance(timedelta(seconds=1))
    retry = await coordinator.run_next()
    assert retry is not None
    assert retry.job_id == job.id
    assert retry.total_projected == 1
    assert (await graph.summary()).sources == 2
    assert (await history.get_job(job.id)).status is JobStatus.SUCCEEDED


async def test_cancellation_persists_retry_and_replays_idempotently(stores) -> None:
    history, graph = stores
    change = await history.upsert_chat(chat("message-1", "취소 메시지"), changed_at=NOW)
    clock = ManualClock(NOW)
    policy = RetryPolicy(max_attempts=2, base_delay_seconds=1, max_delay_seconds=1)
    blocking = CancelAfterProjection(graph)
    coordinator = IngestionCoordinator(history, blocking, retry_policy=policy, clock=clock)
    job = await coordinator.enqueue(JobTrigger.RETRY)
    run = asyncio.create_task(coordinator.run_next())
    await asyncio.wait_for(blocking.projected.wait(), timeout=2)
    run.cancel()
    with pytest.raises(asyncio.CancelledError):
        await run

    retry_wait = await history.get_job(job.id)
    assert retry_wait is not None
    assert retry_wait.status is JobStatus.RETRY_WAIT
    assert await history.cursor("chat_history") == 0
    assert (await graph.summary()).sources == 1

    clock.advance(timedelta(seconds=1))
    recovery = IngestionCoordinator(history, graph, retry_policy=policy, clock=clock)
    report = await recovery.run_next()
    assert report is not None and report.total_projected == 1
    assert await history.cursor("chat_history") == change.change_seq
    assert (await graph.summary()).sources == 1
    assert (await history.get_job(job.id)).status is JobStatus.SUCCEEDED


async def test_bounded_queue_backpressures_concurrent_producers_and_single_writes(
    stores,
) -> None:
    history, graph = stores
    for index in range(5):
        await history.upsert_chat(
            chat(f"message-{index}", f"메시지 {index}"),
            changed_at=NOW + timedelta(seconds=index),
        )
    tracker = ConcurrencyTrackingProjection(graph)
    coordinator = IngestionCoordinator(
        history,
        tracker,
        queue_capacity=1,
        poll_interval_seconds=0.01,
        clock=ManualClock(NOW),
    )

    first = await coordinator.enqueue(JobTrigger.MANUAL)
    blocked_producer = asyncio.create_task(coordinator.enqueue(JobTrigger.HOURLY))
    await asyncio.sleep(0)
    assert coordinator._queue.full()
    assert not blocked_producer.done()

    await coordinator.start()
    await asyncio.wait_for(tracker.started.wait(), timeout=2)
    concurrent_manual = asyncio.create_task(coordinator.run_next())
    second = await asyncio.wait_for(blocked_producer, timeout=2)
    await coordinator.drain()
    await concurrent_manual
    await coordinator.stop()

    assert tracker.max_active == 1
    assert (await graph.summary()).sources == 5
    assert (await history.get_job(first.id)).status is JobStatus.SUCCEEDED
    assert (await history.get_job(second.id)).status is JobStatus.SUCCEEDED

    await history.upsert_chat(
        chat("message-after-restart", "재시작 메시지"),
        changed_at=NOW + timedelta(seconds=10),
    )
    restarted_job = await coordinator.enqueue(JobTrigger.MANUAL)
    await coordinator.start()
    await coordinator.drain()
    await coordinator.stop()
    assert (await graph.summary()).sources == 6
    assert (await history.get_job(restarted_job.id)).status is JobStatus.SUCCEEDED
    assert tracker.max_active == 1


async def test_cancelled_backpressured_producer_keeps_durable_pending_job(stores) -> None:
    history, graph = stores
    coordinator = IngestionCoordinator(
        history,
        graph,
        queue_capacity=1,
        poll_interval_seconds=0.01,
        clock=ManualClock(NOW),
    )
    first = await coordinator.enqueue(JobTrigger.MANUAL)
    blocked = asyncio.create_task(coordinator.enqueue(JobTrigger.HOURLY))
    await asyncio.sleep(0)
    pending_ids = await history.due_job_ids(now=NOW, limit=10)
    assert len(pending_ids) == 2
    second_id = next(job_id for job_id in pending_ids if job_id != first.id)
    blocked.cancel()
    with pytest.raises(asyncio.CancelledError):
        await blocked

    await coordinator.start()
    await coordinator.drain()
    await coordinator.stop()
    assert (await history.get_job(first.id)).status is JobStatus.SUCCEEDED
    assert (await history.get_job(second_id)).status is JobStatus.SUCCEEDED
    assert await history.due_job_ids(now=NOW, limit=10) == ()


async def test_writer_poll_recovers_job_that_becomes_stale_after_start(stores) -> None:
    history, graph = stores
    job = await history.create_job(JobTrigger.MANUAL, now=NOW)
    claimed = await history.claim_due_job(now=NOW)
    assert claimed is not None and claimed.status is JobStatus.RUNNING
    clock = ManualClock(NOW + timedelta(minutes=5))
    policy = RetryPolicy(
        max_attempts=3,
        base_delay_seconds=0.05,
        max_delay_seconds=0.05,
    )
    coordinator = IngestionCoordinator(
        history,
        graph,
        retry_policy=policy,
        poll_interval_seconds=0.01,
        clock=clock,
    )
    await coordinator.start(stale_after=timedelta(minutes=10))
    await asyncio.sleep(0.03)
    assert (await history.get_job(job.id)).status is JobStatus.RUNNING

    clock.advance(timedelta(minutes=6))
    retry_wait = await wait_for_job_status(history, job.id, JobStatus.RETRY_WAIT)
    assert retry_wait.next_retry_at == clock.value + timedelta(seconds=0.05)
    clock.advance(timedelta(seconds=0.05))
    succeeded = await wait_for_job_status(history, job.id, JobStatus.SUCCEEDED)
    assert succeeded.attempts == 2
    await coordinator.stop()


async def test_rebuild_failure_restarts_from_zero_and_replays_authoritative_history(
    stores,
    ladybug_dll_dir: Path | None,
) -> None:
    history, graph = stores
    change = await history.upsert_chat(chat("message-rebuild", "재구축 메시지"), changed_at=NOW)
    clock = ManualClock(NOW)
    initial = IngestionCoordinator(history, graph, clock=clock)
    await initial.enqueue(JobTrigger.MANUAL)
    assert (await initial.run_next()).total_projected == 1
    assert await history.cursor("chat_history") == change.change_seq
    assert (await graph.summary()).sources == 1

    interrupted = IngestionCoordinator(history, FailAfterResetProjection(graph), clock=clock)
    with pytest.raises(RuntimeError, match="deterministic reset interruption"):
        await interrupted.rebuild_projection()
    assert await history.cursor("chat_history") == 0
    assert (await graph.summary()).sources == 0

    history_path = history.path
    graph_path = graph.path
    await graph.close()
    await history.close()
    reopened_history = HistoryStore(history_path)
    reopened_graph = GraphStore(graph_path, dll_dir=ladybug_dll_dir)
    await reopened_history.open()
    await reopened_graph.open()
    try:
        restarted = IngestionCoordinator(
            reopened_history,
            reopened_graph,
            clock=clock,
            poll_interval_seconds=0.01,
        )
        await restarted.start()
        await restarted.drain()
        await restarted.stop()
        assert (await reopened_graph.summary()).sources == 1
        assert await reopened_history.cursor("chat_history") == change.change_seq
        assert await reopened_history.due_job_ids(now=NOW, limit=10) == ()
    finally:
        await reopened_graph.close()
        await reopened_history.close()
