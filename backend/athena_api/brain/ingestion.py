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
from .ontology import SourceRecord


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
        self._writer_task: asyncio.Task[None] | None = None
        self._stopping = False
        self._poll_interval_seconds = poll_interval_seconds
        self._stale_after = timedelta(minutes=10)
        self._source_projector = source_projector

    async def enqueue(self, trigger: JobTrigger) -> IngestionJob:
        job = await self._history.create_job(trigger, now=self._clock())
        await self._queue_job(job.id, wait=True)
        return job

    async def start(self, *, stale_after: timedelta = timedelta(minutes=10)) -> None:
        if self._writer_task is not None and not self._writer_task.done():
            return
        self._stale_after = stale_after
        await self.recover_stale_jobs(stale_after=stale_after)
        self._stopping = False
        self._writer_task = asyncio.create_task(self._writer_loop(), name="athena-ingestion-writer")
        await self._refill_due_jobs()

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
        if drain:
            await self.drain()
        self._stopping = True
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        self._writer_task = None

    async def _queue_job(self, job_id: str, *, wait: bool) -> bool:
        async with self._enqueue_lock:
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
                if self._source_projector is not None:
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
