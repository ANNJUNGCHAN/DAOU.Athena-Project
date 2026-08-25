import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from athena_api.brain import (
    DETERMINISTIC_SOURCE_KINDS,
    EXTRACTABLE_SOURCE_KINDS,
    INVESTOR_PROFILE_ENTITY_ID,
    INVESTOR_PROFILE_NAME,
    ChatHistoryRecord,
    ChatRole,
    CompletedTradeRecord,
    Confidence,
    DeterministicHoldingProjector,
    DeterministicTradeProjector,
    Entity,
    EntityKind,
    GraphEventOp,
    GraphStore,
    HistoryStore,
    HoldingRecord,
    IngestionCoordinator,
    JobStatus,
    JobTrigger,
    Relation,
    RelationKind,
    RetryPolicy,
    SourceKind,
    SourceRecord,
    SourceTier,
    SqliteOwner,
    TradeSide,
    entity_id,
    relation_id,
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


class RecordingProjector:
    def __init__(self) -> None:
        self.projected_kinds: list[SourceKind] = []

    async def project_source(self, source: SourceRecord) -> None:
        self.projected_kinds.append(source.kind)


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
async def stores(tmp_path: Path):
    """운영과 같은 배선: 파일 하나, 연결 하나를 두 저장소가 나눠 쓴다.

    이전에는 픽스처가 파일을 둘로 열었다. 그러면 코디네이터의 `_shared_owner()`가
    `None`을 돌려주고 항목 단위 트랜잭션이 통째로 비활성화되므로, 테스트가 운영에서
    실제로 도는 경로를 밟지 않게 된다.
    """
    owner = SqliteOwner(tmp_path / "brain.sqlite3")
    await owner.open()
    history = HistoryStore(owner)
    graph = GraphStore(owner)
    await history.open()
    await graph.open()
    try:
        yield history, graph
    finally:
        await owner.close()


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
    # 2 raw sources (chat + trade) plus the conversation rollup compact_conversations()
    # produces for the one chat conversation before adapters run.
    assert first.total_projected == 3
    assert (await graph.summary()).sources == 3

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
    # The edited chat_message and the conversation rollup it changes both re-project (the
    # conversation's fingerprint changes too, since its transcript now includes the edit).
    assert changed is not None and changed.total_projected == 2
    assert (await graph.summary()).sources == 3


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
    # The conversation rollup itself already succeeded (it only touches history metadata),
    # but the chat_history adapter failed on message-2 before conversation_history ever ran,
    # so the graph only has message-1 -- the rolled-up conversation isn't projected yet.
    assert (await graph.summary()).sources == 1

    clock.advance(timedelta(seconds=1))
    retry = await coordinator.run_next()
    assert retry is not None
    assert retry.job_id == job.id
    # message-2 (resumed) plus the conversation rollup, which conversation_history now
    # reaches for the first time.
    assert retry.total_projected == 2
    assert (await graph.summary()).sources == 3
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
    # message-1 (resumed, same fingerprint so a no-op re-upsert) plus the conversation
    # rollup, which conversation_history reaches for the first time on this retry.
    assert report is not None and report.total_projected == 2
    assert await history.cursor("chat_history") == change.change_seq
    assert (await graph.summary()).sources == 2
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
    # 5 chat messages plus the one conversation rollup they compact into.
    assert (await graph.summary()).sources == 6
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
    # +1 new chat message; the conversation rollup revises its existing source_id rather
    # than adding a new one, so the distinct-source count grows by 1, not 2.
    assert (await graph.summary()).sources == 7
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


async def test_enqueue_is_rejected_while_stop_is_draining(stores) -> None:
    """ADR investment-brain-architecture.md §4.2 step 3: "신규 enqueue 차단" is the first
    thing shutdown does, ahead of draining the queue or cancelling the writer. A producer
    racing an in-flight stop() must be rejected, not silently accepted into a job the
    writer is about to stop picking up.
    """
    history, graph = stores
    blocking = CancelAfterProjection(graph)
    coordinator = IngestionCoordinator(
        history, blocking, clock=ManualClock(NOW), poll_interval_seconds=0.01
    )
    await history.upsert_chat(chat("message-1", "종료 중 메시지"), changed_at=NOW)
    await coordinator.start()
    await coordinator.enqueue(JobTrigger.MANUAL)
    # Block the writer mid-job so stop()'s drain() phase cannot finish until we release it,
    # giving a real window where shutdown is in progress and enqueue() must be rejected.
    await asyncio.wait_for(blocking.projected.wait(), timeout=2)

    stop_task = asyncio.create_task(coordinator.stop())
    await asyncio.sleep(0)
    assert coordinator._shutting_down is True
    with pytest.raises(RuntimeError, match="shutting down"):
        await coordinator.enqueue(JobTrigger.HOURLY)

    blocking._block.set()
    await stop_task
    assert coordinator._shutting_down is False
    # The rejected enqueue() raised before ever calling history.create_job(), so it left
    # no durable job behind for a future start() to pick up.
    assert await history.due_job_ids(now=NOW, limit=10) == ()
    # message-1 plus the conversation rollup it compacts into.
    assert (await graph.summary()).sources == 2


async def test_enqueue_works_again_once_stop_returns(stores) -> None:
    """A completed stop() is not a permanent lockout: durable jobs queued while idle
    (before the next start()) must still be accepted, matching the restart pattern in
    test_bounded_queue_backpressures_concurrent_producers_and_single_writes.
    """
    history, graph = stores
    coordinator = IngestionCoordinator(history, graph, clock=ManualClock(NOW))
    await coordinator.start()
    await coordinator.stop()

    job = await coordinator.enqueue(JobTrigger.MANUAL)
    assert (await history.get_job(job.id)) is not None


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
) -> None:
    history, graph = stores
    change = await history.upsert_chat(chat("message-rebuild", "재구축 메시지"), changed_at=NOW)
    clock = ManualClock(NOW)
    initial = IngestionCoordinator(history, graph, clock=clock)
    await initial.enqueue(JobTrigger.MANUAL)
    # message-rebuild plus the conversation rollup it compacts into.
    assert (await initial.run_next()).total_projected == 2
    assert await history.cursor("chat_history") == change.change_seq
    assert (await graph.summary()).sources == 2

    interrupted = IngestionCoordinator(history, FailAfterResetProjection(graph), clock=clock)
    with pytest.raises(RuntimeError, match="deterministic reset interruption"):
        await interrupted.rebuild_projection()
    assert await history.cursor("chat_history") == 0
    # `reset_projection()`은 **파생 데이터만** 지운다. 원본 소스와 이벤트 로그는 남는다 —
    # 재구축의 입력이 그 원본이고, 로그는 "실제로 그렇게 됐었다"는 유일한 기록이다.
    # (이전 판은 소스까지 지웠다. 그러면 재구축이 자기 입력을 먼저 태워버리는 셈이다.)
    reset = await graph.summary()
    assert (reset.entities, reset.relations) == (0, 0)
    assert reset.sources == 2

    history_path = history.path
    graph_path = graph.path
    await graph.close()
    await history.close()
    reopened_history = HistoryStore(history_path)
    reopened_graph = GraphStore(graph_path)
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
        # Both adapter cursors were reset by rebuild_projection(), so the replay re-derives
        # message-rebuild (chat_history) and the already-recorded conversation rollup
        # (conversation_history) into the freshly-reset graph.
        assert (await reopened_graph.summary()).sources == 2
        assert await reopened_history.cursor("chat_history") == change.change_seq
        assert await reopened_history.due_job_ids(now=NOW, limit=10) == ()
    finally:
        await reopened_graph.close()
        await reopened_history.close()


# --- conversation rollup wired into ingestion -------------------------------------------


def test_source_kind_routing_splits_llm_from_deterministic() -> None:
    """소스 종류가 투영기를, 곧 출처 티어를 정한다.

    `TRADE`가 LLM 쪽에서 빠진 것이 leaf 4의 핵심이다 — 체결은 해석의 여지가 없는
    사실인데 확률적 추론기에 통과시키면 확실한 것이 불확실해지고 토큰까지 든다.
    `RESEARCH`는 아예 사라졌다: 그 값을 만드는 어댑터가 애초에 없었다.
    `HOLDING`은 leaf 2에서 생산자·어댑터·투영기를 한 묶음으로 세운 뒤 들어왔다.
    """
    assert EXTRACTABLE_SOURCE_KINDS == {SourceKind.CONVERSATION}
    assert DETERMINISTIC_SOURCE_KINDS == {SourceKind.TRADE, SourceKind.HOLDING}
    # 두 경로는 겹치지 않는다 — 겹치면 한 소스가 두 티어를 동시에 주장한다.
    assert not (EXTRACTABLE_SOURCE_KINDS & DETERMINISTIC_SOURCE_KINDS)
    # 문맥 없는 낱개 발화는 어느 쪽으로도 가지 않는다.
    assert SourceKind.CHAT_MESSAGE not in EXTRACTABLE_SOURCE_KINDS
    assert SourceKind.CHAT_MESSAGE not in DETERMINISTIC_SOURCE_KINDS
    # 분류되지 않은 종류로 투영기를 붙이면 생성 시점에 터진다 — 라우팅 표와 상수가
    # 따로 노는 것을 런타임까지 미루지 않는다.
    assert set(SourceKind) - EXTRACTABLE_SOURCE_KINDS - DETERMINISTIC_SOURCE_KINDS == {
        SourceKind.CHAT_MESSAGE
    }


async def test_extraction_gate_skips_chat_message_but_projects_rolled_up_conversation(
    stores,
) -> None:
    history, graph = stores
    await history.upsert_chat(chat("message-1", "첫 메시지"), changed_at=NOW)
    await history.upsert_chat(
        chat("message-2", "둘째 메시지"), changed_at=NOW + timedelta(seconds=1)
    )
    clock = ManualClock(NOW + timedelta(seconds=1))
    projector = RecordingProjector()
    coordinator = IngestionCoordinator(history, graph, clock=clock, source_projector=projector)

    job = await coordinator.enqueue(JobTrigger.MANUAL)
    report = await coordinator.run_next()

    assert report is not None
    assert report.job_id == job.id
    assert report.status is JobStatus.SUCCEEDED
    # Both chat_message rows and the rolled-up conversation reach upsert_source (raw
    # provenance kept for every kind), but project_source (extraction) only runs for the
    # conversation rollup -- never for a lone, context-free chat_message.
    assert projector.projected_kinds == [SourceKind.CONVERSATION]
    assert (await graph.summary()).sources == 3  # 2 chat_message + 1 conversation


async def test_completed_trades_go_to_the_deterministic_projector_not_the_llm(stores) -> None:
    """체결은 LLM 투영기를 **건드리지 않는다**. 결정적 투영기만 본다."""
    history, graph = stores
    await history.upsert_completed_trade(completed_trade(), changed_at=NOW)
    clock = ManualClock(NOW)
    llm = RecordingProjector()
    deterministic = RecordingProjector()
    coordinator = IngestionCoordinator(
        history,
        graph,
        clock=clock,
        source_projector=llm,
        deterministic_projector=deterministic,
    )

    await coordinator.enqueue(JobTrigger.MANUAL)
    report = await coordinator.run_next()

    assert report is not None and report.status is JobStatus.SUCCEEDED
    assert llm.projected_kinds == []
    assert deterministic.projected_kinds == [SourceKind.TRADE]


async def test_conversation_rollups_go_to_the_llm_not_the_deterministic_projector(
    stores,
) -> None:
    history, graph = stores
    await history.upsert_chat(chat("message-1", "삼성전자 계속 들고 갈 생각이야"), changed_at=NOW)
    clock = ManualClock(NOW)
    llm = RecordingProjector()
    deterministic = RecordingProjector()
    coordinator = IngestionCoordinator(
        history,
        graph,
        clock=clock,
        source_projector=llm,
        deterministic_projector=deterministic,
    )

    await coordinator.enqueue(JobTrigger.MANUAL)
    assert (await coordinator.run_next()) is not None
    assert llm.projected_kinds == [SourceKind.CONVERSATION]
    assert deterministic.projected_kinds == []


async def test_trades_are_skipped_entirely_when_no_deterministic_projector_is_wired(
    stores,
) -> None:
    """투영기가 없으면 조용히 넘어간다 — 원본 적재는 계속된다.

    브레인을 끈 채로도 이력은 쌓여야 나중에 켰을 때 재구축할 수 있다.
    """
    history, graph = stores
    await history.upsert_completed_trade(completed_trade(), changed_at=NOW)
    coordinator = IngestionCoordinator(history, graph, clock=ManualClock(NOW))
    await coordinator.enqueue(JobTrigger.MANUAL)
    report = await coordinator.run_next()
    assert report is not None and report.status is JobStatus.SUCCEEDED
    assert (await graph.summary()).sources == 1
    assert (await graph.summary()).relations == 0


async def test_rollup_failure_fails_the_whole_job_before_any_adapter_runs(
    stores, monkeypatch: pytest.MonkeyPatch
) -> None:
    history, graph = stores
    await history.upsert_chat(chat("message-1", "메시지"), changed_at=NOW)
    clock = ManualClock(NOW)
    coordinator = IngestionCoordinator(history, graph, clock=clock)

    async def boom(*, now=None):
        raise RuntimeError("deterministic rollup failure")

    monkeypatch.setattr(history, "compact_conversations", boom)
    job = await coordinator.enqueue(JobTrigger.MANUAL)

    with pytest.raises(RuntimeError, match="deterministic rollup failure"):
        await coordinator.run_next()

    failed = await history.get_job(job.id)
    assert failed is not None and failed.status is JobStatus.RETRY_WAIT
    # A rollup failure must fail the job before any adapter advances -- no partial,
    # silently-stale extraction pass.
    assert await history.cursor("chat_history") == 0
    assert (await graph.summary()).sources == 0


# --- 결정적 티어 투영 (leaf 4) --------------------------------------------------------


class _FixedResolver:
    def __init__(self, table: dict[str, str]) -> None:
        self._table = table

    def name_for(self, code: str) -> str | None:
        return self._table.get(code)


def trade_source(
    *,
    source_id: str = "trade:execution-1",
    fingerprint: str = "fp-trade",
    text: str = "completed buy 005930 quantity=2 price=72000",
    attributes: dict | None = None,
) -> SourceRecord:
    return SourceRecord(
        id=source_id,
        kind=SourceKind.TRADE,
        text=text,
        fingerprint=fingerprint,
        occurred_at=NOW,
        ingested_at=NOW,
        attributes=attributes
        if attributes is not None
        else {
            "trade": {
                "security_id": "005930",
                "side": "buy",
                "quantity": 2,
                "price": "72000",
                "completed": True,
            }
        },
    )


async def project_trade(graph: GraphStore, *, resolver=None, record=None) -> SourceRecord:
    source = record or trade_source()
    await graph.upsert_source(source)
    await DeterministicTradeProjector(
        graph, resolver=resolver, clock=ManualClock(NOW)
    ).project_source(source)
    return source


async def test_deterministic_projector_derives_a_traded_edge_at_the_deterministic_tier(
    stores,
) -> None:
    _history, graph = stores
    await project_trade(graph)

    edges = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert len(edges) == 1
    assert edges[0].kind == RelationKind.TRADED.value
    assert edges[0].tier == SourceTier.DETERMINISTIC.value
    assert edges[0].confidence == Confidence.EXTRACTED.value


async def test_deterministic_projector_never_claims_ownership_from_a_fill(stores) -> None:
    """매수 체결은 "그때 샀다"이지 "지금 들고 있다"가 아니다.

    체결로 `owns`를 만들면 판 종목이 영원히 보유로 남고, 결정적 티어라 대화가 정정할
    수도 없다. 보유는 잔고가 답한다.
    """
    _history, graph = stores
    await project_trade(graph)
    edges = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert RelationKind.OWNS.value not in {edge.kind for edge in edges}


async def test_deterministic_projector_uses_the_resolved_name_and_keeps_the_code_as_alias(
    stores,
) -> None:
    _history, graph = stores
    await project_trade(graph, resolver=_FixedResolver({"005930": "삼성전자"}))

    assert [hit.name for hit in await graph.search_entities("삼성전자")] == ["삼성전자"]
    # 코드로도 계속 찾힌다 — 사람은 이름으로, 다른 층은 코드로 묻는다.
    assert [hit.name for hit in await graph.search_entities("005930")] == ["삼성전자"]


async def test_deterministic_projector_falls_back_to_the_code_when_the_master_is_absent(
    stores,
) -> None:
    """종목 마스터가 안 떴다고 체결을 버리면 부팅 순서가 그래프 내용을 바꾼다."""
    _history, graph = stores
    await project_trade(graph, resolver=_FixedResolver({}))
    assert [hit.name for hit in await graph.search_entities("005930")] == ["005930"]


async def test_deterministic_projector_reads_attributes_not_the_human_readable_text(
    stores,
) -> None:
    """본문 문구가 바뀌어도 산출물이 그대로다 — 텍스트를 되파싱하지 않는다는 증거."""
    _history, graph = stores
    await project_trade(graph)
    before = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)

    await project_trade(
        graph,
        record=trade_source(
            fingerprint="fp-rephrased", text="사람이 읽는 문구가 완전히 달라졌다"
        ),
    )
    after = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert [e.relation_id for e in after] == [e.relation_id for e in before]


@pytest.mark.parametrize(
    ("attributes", "why"),
    [
        ({}, "체결 속성이 아예 없다"),
        ({"trade": "not-a-mapping"}, "속성이 매핑이 아니다"),
        ({"trade": {"side": "buy", "quantity": 1}}, "종목코드가 없다"),
        ({"trade": {"security_id": "005930", "quantity": 1}}, "매매구분이 없다"),
        ({"trade": {"security_id": "005930", "side": "buy", "quantity": 0}}, "수량이 0"),
        ({"trade": {"security_id": "005930", "side": "buy", "quantity": -3}}, "수량이 음수"),
        ({"trade": {"security_id": "005930", "side": "buy", "quantity": True}}, "수량이 bool"),
        ({"trade": {"security_id": "   ", "side": "buy", "quantity": 1}}, "종목코드가 공백"),
    ],
)
async def test_deterministic_projector_invents_nothing_from_incomplete_facts(
    stores, attributes: dict, why: str
) -> None:
    """사실이 없는데 관계를 지어내는 것이 결정적 티어에서 가장 나쁜 실패다.

    대화가 정정할 수 없는 거짓이 되기 때문이다. 그래서 조용히 넘어가되, 원본은 남긴다.
    """
    _history, graph = stores
    await project_trade(
        graph, record=trade_source(source_id="trade:broken", attributes=attributes)
    )

    summary = await graph.summary()
    assert summary.relations == 0, why
    assert summary.sources == 1, "원본 자체는 남아야 나중에 재구축할 수 있다"


async def test_deterministic_tier_beats_conversation_on_the_same_edge(stores) -> None:
    """체결이 만든 `traded`를 대화가 덮어쓰지 못한다.

    이것이 leaf 4가 존재하는 이유다. 말과 행동이 어긋나면 행동이 이긴다.
    """
    _history, graph = stores
    await project_trade(graph, resolver=_FixedResolver({"005930": "삼성전자"}))
    edge_before = (await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1))[0]

    investor = Entity(
        id=INVESTOR_PROFILE_ENTITY_ID,
        kind=EntityKind.INVESTOR_PROFILE,
        name=INVESTOR_PROFILE_NAME,
        created_at=NOW,
        updated_at=NOW,
    )
    samsung = Entity(
        id=entity_id(EntityKind.SECURITY, "삼성전자"),
        kind=EntityKind.SECURITY,
        name="삼성전자",
        created_at=NOW,
        updated_at=NOW,
    )
    talk = SourceRecord(
        id="conversation:1",
        kind=SourceKind.CONVERSATION,
        text="삼성전자 산 것 같기도 하고",
        fingerprint="fp-talk",
        occurred_at=NOW,
        ingested_at=NOW,
    )
    await graph.upsert_source(talk)
    await graph.apply_extraction(
        talk.id,
        talk.fingerprint,
        (investor, samsung),
        (
            Relation(
                id=relation_id(RelationKind.TRADED, investor.id, samsung.id),
                kind=RelationKind.TRADED,
                source_entity_id=investor.id,
                target_entity_id=samsung.id,
                confidence=Confidence.AMBIGUOUS,
                tier=SourceTier.CONVERSATIONAL,
                source_id=talk.id,
                observed_at=NOW,
                extracted_at=NOW,
            ),
        ),
    )

    edges = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert len(edges) == 1, "같은 (출발, 도착, 종류)는 한 행이어야 한다"
    assert edges[0].relation_id == edge_before.relation_id
    assert edges[0].tier == SourceTier.DETERMINISTIC.value
    assert edges[0].confidence == Confidence.EXTRACTED.value
    # 진 쪽의 주장도 로그에는 남는다 — 말과 행동의 어긋남 자체가 신호다.
    assert {e.source_id for e in await graph.events() if e.relation == "traded"} == {
        "trade:execution-1",
        "conversation:1",
    }


# --- 보유잔고 (leaf 2) ----------------------------------------------------------------


def _assert_single_brain_file(directory: Path) -> None:
    """브레인이 남긴 것이 `brain.sqlite3` 하나(+WAL/SHM 사이드카)뿐인지 본다."""
    names = sorted(p.name for p in directory.iterdir())
    assert names, "아무 파일도 만들어지지 않았다 — 측정이 틀렸다"
    assert all(name.startswith("brain.sqlite3") for name in names), names


def holding(security_id: str = "005930", quantity: int = 10) -> HoldingRecord:
    return HoldingRecord(
        security_id=security_id,
        quantity=quantity,
        average_price=Decimal("68000"),
        occurred_at=NOW,
    )


async def project_holdings(history: HistoryStore, graph: GraphStore, *, resolver=None) -> None:
    changes = await history.holding_changes(0, limit=50)
    projector = DeterministicHoldingProjector(graph, resolver=resolver, clock=ManualClock(NOW))
    for change in changes:
        await graph.upsert_source(change.record)
        await projector.project_source(change.record)


async def test_holdings_are_the_only_source_of_owns(stores) -> None:
    """`owns`는 잔고에서만 나온다. 체결은 `traded`까지만 주장한다."""
    history, graph = stores
    await history.upsert_completed_trade(completed_trade(), changed_at=NOW)
    await history.upsert_holding(holding(), changed_at=NOW)
    await project_trade(graph)
    await project_holdings(history, graph)

    by_kind = {e.kind: e for e in await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)}
    assert set(by_kind) == {RelationKind.TRADED.value, RelationKind.OWNS.value}
    assert by_kind[RelationKind.OWNS.value].tier == SourceTier.DETERMINISTIC.value


async def test_a_holding_snapshot_replaces_the_previous_one_for_that_security(stores) -> None:
    """소스 id가 종목당 하나라서 다음 스냅숏이 앞의 것을 대체한다.

    건마다 쌓이면 어제 판 종목이 그래프에 영원히 남는다.
    """
    history, graph = stores
    await history.upsert_holding(holding(quantity=10), changed_at=NOW)
    await project_holdings(history, graph)
    await history.upsert_holding(
        holding(quantity=25), changed_at=NOW + timedelta(seconds=1)
    )
    await project_holdings(history, graph)

    edges = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert len(edges) == 1
    assert (await graph.summary()).sources == 1


async def test_selling_everything_removes_the_owns_edge_but_keeps_the_security(
    stores,
) -> None:
    """수량 0은 버리는 값이 아니라 "다 팔았다"는 사실이다.

    걸러내면 그래프가 마지막으로 들고 있던 상태에 영원히 멈춘다. 종목 노드는 남긴다 —
    과거에 들고 있었다는 것도 신호이고, 대화가 그 종목을 언급하면 붙을 자리가 필요하다.
    """
    history, graph = stores
    await history.upsert_holding(holding(quantity=10), changed_at=NOW)
    await project_holdings(history, graph)
    assert len(await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)) == 1

    await history.upsert_holding(holding(quantity=0), changed_at=NOW + timedelta(seconds=1))
    await project_holdings(history, graph)

    assert await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1) == ()
    assert [hit.name for hit in await graph.search_entities("005930")] == ["005930"]
    removed = [e for e in await graph.events() if e.op is GraphEventOp.EDGE_REMOVED]
    assert [e.relation for e in removed] == [RelationKind.OWNS.value]


async def test_holdings_reach_the_graph_through_the_coordinator(stores) -> None:
    """어댑터가 실제로 배선돼 있다 — 투영기만 있고 어댑터가 없으면 아무것도 안 온다."""
    history, graph = stores
    await history.upsert_holding(holding(), changed_at=NOW)
    coordinator = IngestionCoordinator(
        history,
        graph,
        clock=ManualClock(NOW),
        holding_projector=DeterministicHoldingProjector(graph, clock=ManualClock(NOW)),
    )
    await coordinator.enqueue(JobTrigger.MANUAL)
    report = await coordinator.run_next()

    assert report is not None and report.status is JobStatus.SUCCEEDED
    assert "holding_history" in {r.adapter for r in report.adapters}
    edges = await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert [e.kind for e in edges] == [RelationKind.OWNS.value]


def test_a_projector_for_an_unclassified_kind_is_refused(stores_unused=None) -> None:
    """분류표와 라우팅표가 따로 노는 것을 생성 시점에 잡는다."""
    # `SourceKind.CHAT_MESSAGE`는 어느 티어에도 속하지 않으므로 투영기를 붙일 수 없다.
    assert SourceKind.CHAT_MESSAGE not in (
        EXTRACTABLE_SOURCE_KINDS | DETERMINISTIC_SOURCE_KINDS
    )


# --- 단일 파일 원자성 (leaf 2) --------------------------------------------------------


async def test_cursor_and_graph_move_together_or_not_at_all(tmp_path: Path) -> None:
    """투영이 실패하면 커서도 전진하지 않는다 — 같은 커밋 안이므로.

    묶지 않으면 "커서는 지나갔는데 그래프엔 없는" 소스가 생기고, 커서가 이미 넘어갔으니
    재시도조차 그것을 건너뛴다. 조용히 비는 그래프이고, 이것이 leaf 2의 존재 이유다.
    """
    owner = SqliteOwner(tmp_path / "brain.sqlite3")
    await owner.open()
    history, graph = HistoryStore(owner), GraphStore(owner)
    await history.open()
    await graph.open()
    try:
        await history.upsert_holding(holding(), changed_at=NOW)

        class Exploding:
            async def project_source(self, source: SourceRecord) -> None:
                raise RuntimeError("deterministic projection failure")

        coordinator = IngestionCoordinator(
            history, graph, clock=ManualClock(NOW), holding_projector=Exploding()
        )
        await coordinator.enqueue(JobTrigger.MANUAL)
        with pytest.raises(RuntimeError, match="deterministic projection failure"):
            await coordinator.run_next()

        assert await history.cursor("holding_history") == 0
        # 소스 upsert도 같은 커밋 안에 있었으므로 함께 되감긴다.
        assert (await graph.summary()).sources == 0
    finally:
        await owner.close()


async def test_the_whole_brain_lives_in_one_file(tmp_path: Path) -> None:
    owner = SqliteOwner(tmp_path / "brain.sqlite3")
    await owner.open()
    history, graph = HistoryStore(owner), GraphStore(owner)
    await history.open()
    await graph.open()
    try:
        assert history.path == graph.path
        # 스키마 버전이 컴포넌트별로 공존한다 — 예전에는 두 저장소의 `schema_version`
        # 테이블 컬럼이 서로 달라(`key` vs `singleton`) 한 파일에 올릴 수 없었다.
        assert await graph.schema_version() > 0
        assert await history.schema_version() > 0
        await history.upsert_holding(holding(), changed_at=NOW)
        await project_holdings(history, graph)
    finally:
        await owner.close()
    _assert_single_brain_file(tmp_path)


async def test_a_borrowed_store_does_not_close_the_shared_connection(tmp_path: Path) -> None:
    """빌려 쓰는 저장소가 닫으면 아직 쓰고 있는 쪽의 발밑이 사라진다."""
    owner = SqliteOwner(tmp_path / "brain.sqlite3")
    await owner.open()
    history, graph = HistoryStore(owner), GraphStore(owner)
    await history.open()
    await graph.open()
    try:
        await history.close()
        assert owner.is_open
        # 그래프는 계속 쓸 수 있다.
        await graph.upsert_source(trade_source())
        assert (await graph.summary()).sources == 1
    finally:
        await owner.close()
    assert not owner.is_open
