"""Incremental raw-history adapters and durable source projection coordinator."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from .history import (
    HistoryStore,
    IngestionJob,
    JobStatus,
    JobTrigger,
    RetryPolicy,
    SourceChange,
    utc_now,
)
from .ontology import SourceKind, SourceRecord

# Extraction over a single chat_message (no prior turns) is structurally low-signal for
# propensity inference -- "응 그거 좋아" means nothing without the message it answers, and
# propensity inference is the whole point. Only these kinds reach `project_source`;
# CHAT_MESSAGE deliberately stays out so nobody re-adds it without a review catching this
# comment. `upsert_source` still runs for every kind below and CHAT_MESSAGE alike, so raw
# provenance (Claim SUPPORTED_BY targets) is unaffected.
EXTRACTABLE_SOURCE_KINDS: frozenset[SourceKind] = frozenset(
    {SourceKind.CONVERSATION, SourceKind.TRADE, SourceKind.RESEARCH}
)


class SourceAdapter(Protocol):
    name: str

    async def fetch_after(self, cursor: int, limit: int) -> tuple[SourceChange, ...]: ...


class SourceProjection(Protocol):
    async def upsert_source(self, source: SourceRecord) -> str: ...

    async def reset_projection(self) -> None: ...


class SourceProjector(Protocol):
    async def project_source(self, source: SourceRecord) -> None: ...


@dataclass(frozen=True, slots=True)
class ChatHistoryAdapter:
    history: HistoryStore
    name: str = "chat_history"

    async def fetch_after(self, cursor: int, limit: int) -> tuple[SourceChange, ...]:
        return await self.history.chat_changes(cursor, limit=limit)


@dataclass(frozen=True, slots=True)
class CompletedTradeHistoryAdapter:
    history: HistoryStore
    name: str = "completed_trade_history"

    async def fetch_after(self, cursor: int, limit: int) -> tuple[SourceChange, ...]:
        return await self.history.trade_changes(cursor, limit=limit)


@dataclass(frozen=True, slots=True)
class ConversationHistoryAdapter:
    history: HistoryStore
    name: str = "conversation_history"

    async def fetch_after(self, cursor: int, limit: int) -> tuple[SourceChange, ...]:
        return await self.history.conversation_changes(cursor, limit=limit)


@dataclass(frozen=True, slots=True)
class AdapterIngestionReport:
    adapter: str
    start_cursor: int
    end_cursor: int
    projected: int


@dataclass(frozen=True, slots=True)
class IngestionReport:
    job_id: str
    status: JobStatus
    adapters: tuple[AdapterIngestionReport, ...]
    total_projected: int


class IngestionCoordinator:
    """Run claimed jobs without any market-order or runtime dependency."""

    def __init__(
        self,
        history: HistoryStore,
        graph: SourceProjection,
        *,
        adapters: tuple[SourceAdapter, ...] | None = None,
        batch_size: int = 100,
        retry_policy: RetryPolicy | None = None,
        clock: Callable[[], datetime] = utc_now,
        queue_capacity: int = 16,
        poll_interval_seconds: float = 0.25,
        source_projector: SourceProjector | None = None,
    ) -> None:
        if not 1 <= batch_size <= 500:
            raise ValueError("batch_size must be between 1 and 500")
        configured_adapters = adapters or (
            ChatHistoryAdapter(history),
            CompletedTradeHistoryAdapter(history),
            ConversationHistoryAdapter(history),
        )
        names = tuple(adapter.name for adapter in configured_adapters)
        if len(set(names)) != len(names):
            raise ValueError("adapter names must be unique")
        if not 1 <= queue_capacity <= 1_000:
            raise ValueError("queue_capacity must be between 1 and 1000")
        if not 0.01 <= poll_interval_seconds <= 60:
            raise ValueError("poll_interval_seconds must be between 0.01 and 60")
        self._history = history
        self._graph = graph
        self._adapters = configured_adapters
        self._batch_size = batch_size
        self._retry_policy = retry_policy or RetryPolicy()
        self._clock = clock
        self._queue: asyncio.Queue[str] = asyncio.Queue(maxsize=queue_capacity)
        self._queued_ids: set[str] = set()
        self._active_job_id: str | None = None
        self._enqueue_lock = asyncio.Lock()
        self._run_lock = asyncio.Lock()
        # Guards start()'s done-check/create_task/refill sequence as one unit -- separate
        # from _run_lock (guards claimed-job execution) and _enqueue_lock (guards queueing)
        # so start() only ever contends with itself.
        self._start_lock = asyncio.Lock()
        self._writer_task: asyncio.Task[None] | None = None
        self._stopping = False
        # ADR investment-brain-architecture.md §4.2 step 3 ("신규 enqueue 차단") must take
        # effect the instant stop() begins, before drain()/checkpoint even runs. `_stopping`
        # cannot double as that flag: the writer loop's `while not self._stopping` would
        # exit mid-drain if it flipped early, so a dedicated flag tracks "a stop() call is
        # in flight" without touching the writer loop's own termination signal.
        self._shutting_down = False
        self._poll_interval_seconds = poll_interval_seconds
        self._stale_after = timedelta(minutes=10)
        self._source_projector = source_projector

    async def enqueue(self, trigger: JobTrigger) -> IngestionJob:
        if self._shutting_down:
            raise RuntimeError("ingestion coordinator is shutting down; new jobs are rejected")
        job = await self._history.create_job(trigger, now=self._clock())
        queued = await self._queue_job(job.id, wait=True)
        if not queued:
            raise RuntimeError("ingestion coordinator is shutting down; new jobs are rejected")
        return job

    async def start(self, *, stale_after: timedelta = timedelta(minutes=10)) -> None:
        # recover_stale_jobs() below awaits, so without this lock two concurrent start()
        # calls could both pass the done-check before either creates a writer task --
        # a TOCTOU that spawns two writers for one coordinator.
        async with self._start_lock:
            if self._writer_task is not None and not self._writer_task.done():
                return
            self._stale_after = stale_after
            await self.recover_stale_jobs(stale_after=stale_after)
            self._stopping = False
            self._shutting_down = False
            writer_task = asyncio.create_task(
                self._writer_loop(), name="athena-ingestion-writer"
            )
            self._writer_task = writer_task
            try:
                await self._refill_due_jobs()
            except BaseException:
                # A failure here (including cancellation) must not leave the writer task
                # referenced by nothing: cancel and await it before start() raises, so the
                # coordinator is left as if start() never ran.
                self._stopping = True
                writer_task.cancel()
                with suppress(asyncio.CancelledError):
                    await writer_task
                self._writer_task = None
                raise

    async def drain(self) -> None:
        while True:
            await self._refill_due_jobs()
            await self._queue.join()
            async with self._run_lock:
                pass
            due = await self._history.due_job_ids(now=self._clock(), limit=1)
            if not due:
                return

    async def stop(self, *, drain: bool = True) -> None:
        task = self._writer_task
        if task is None:
            return
        self._shutting_down = True
        try:
            if drain:
                await self.drain()
            self._stopping = True
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            self._writer_task = None
        finally:
            # A stop() call is only "in flight" for its own duration. Once it returns,
            # enqueue() must work again so a later start() has durable jobs to recover —
            # test_bounded_queue_backpressures_concurrent_producers_and_single_writes
            # enqueues while idle between a stop() and the next start().
            self._shutting_down = False

    async def _queue_job(self, job_id: str, *, wait: bool) -> bool:
        async with self._enqueue_lock:
            # Only the externally-facing enqueue() path (wait=True) is rejected here.
            # _refill_due_jobs() calls this with wait=False from inside drain() itself
            # while _shutting_down is already True — rejecting those would make drain()
            # loop forever waiting for due jobs it can never re-queue.
            if wait and self._shutting_down:
                return False
            if job_id in self._queued_ids or job_id == self._active_job_id:
                return False
            self._queued_ids.add(job_id)
            try:
                if wait:
                    await self._queue.put(job_id)
                else:
                    self._queue.put_nowait(job_id)
            except asyncio.QueueFull:
                self._queued_ids.discard(job_id)
                return False
            except BaseException:
                self._queued_ids.discard(job_id)
                raise
            return True

    async def _refill_due_jobs(self) -> None:
        due = await self._history.due_job_ids(now=self._clock(), limit=max(1, self._queue.maxsize))
        for job_id in due:
            if not await self._queue_job(job_id, wait=False) and self._queue.full():
                break

    async def _writer_loop(self) -> None:
        while not self._stopping:
            try:
                job_id = await asyncio.wait_for(
                    self._queue.get(), timeout=self._poll_interval_seconds
                )
            except TimeoutError:
                await self.recover_stale_jobs(stale_after=self._stale_after)
                await self._refill_due_jobs()
                continue
            self._queued_ids.discard(job_id)
            self._active_job_id = job_id
            try:
                with suppress(Exception):
                    await self._run_job_id(job_id)
            finally:
                self._active_job_id = None
                self._queue.task_done()
            await self._refill_due_jobs()

    async def recover_stale_jobs(self, *, stale_after: timedelta = timedelta(minutes=10)) -> int:
        async with self._run_lock:
            return await self._history.recover_stale_jobs(
                self._retry_policy,
                now=self._clock(),
                stale_after=stale_after,
            )

    async def run_next(self) -> IngestionReport | None:
        async with self._run_lock:
            job = await self._history.claim_due_job(now=self._clock())
            if job is None:
                return None
            return await self._execute_claimed_job(job)

    async def _run_job_id(self, job_id: str) -> IngestionReport | None:
        async with self._run_lock:
            job = await self._history.claim_job(job_id, now=self._clock())
            if job is None:
                return None
            return await self._execute_claimed_job(job)

    async def _execute_claimed_job(self, job: IngestionJob) -> IngestionReport:
        reports: list[AdapterIngestionReport] = []
        try:
            # Roll chat_message turns up into `conversation` sources before any adapter
            # runs, so this job's own rollup output is what conversation_history sees below
            # -- one pass, no separate pipeline. A rollup failure fails the whole job
            # (falls into the except below) rather than letting adapters extract from a
            # stale rollup: extraction quality depends on the rollup having succeeded, so a
            # quiet partial success here is worse than a retried job.
            await self._history.compact_conversations(now=self._clock())
            for adapter in self._adapters:
                reports.append(await self._run_adapter(adapter))
        except asyncio.CancelledError:
            await self._history.fail_job(
                job.id,
                "ingestion cancelled",
                self._retry_policy,
                now=self._clock(),
            )
            raise
        except Exception as exc:
            await self._history.fail_job(
                job.id,
                f"{type(exc).__name__}: {exc}",
                self._retry_policy,
                now=self._clock(),
            )
            raise
        completed = await self._history.succeed_job(job.id, now=self._clock())
        total = sum(report.projected for report in reports)
        return IngestionReport(
            job_id=completed.id,
            status=completed.status,
            adapters=tuple(reports),
            total_projected=total,
        )

    async def rebuild_projection(self) -> IngestionReport:
        """Reset checkpoints first, reset derived data, then durably replay raw history."""
        async with self._run_lock:
            replay_job = await self._history.create_job(JobTrigger.RETRY, now=self._clock())
            await self._history.reset_cursors(tuple(adapter.name for adapter in self._adapters))
            await self._graph.reset_projection()
            claimed = await self._history.claim_job(replay_job.id, now=self._clock())
            if claimed is None:
                raise RuntimeError("rebuild replay job could not be claimed")
            return await self._execute_claimed_job(claimed)

    async def _run_adapter(self, adapter: SourceAdapter) -> AdapterIngestionReport:
        cursor = await self._history.cursor(adapter.name)
        start_cursor = cursor
        projected = 0
        while True:
            changes = await adapter.fetch_after(cursor, self._batch_size)
            if not changes:
                break
            for change in changes:
                await self._graph.upsert_source(change.record)
                if (
                    self._source_projector is not None
                    and change.record.kind in EXTRACTABLE_SOURCE_KINDS
                ):
                    await self._source_projector.project_source(change.record)
                cursor = await self._history.advance_cursor(adapter.name, change.seq)
                projected += 1
            if len(changes) < self._batch_size:
                break
        return AdapterIngestionReport(
            adapter=adapter.name,
            start_cursor=start_cursor,
            end_cursor=cursor,
            projected=projected,
        )
