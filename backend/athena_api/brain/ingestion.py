"""Incremental raw-history adapters and durable source projection coordinator.

2026-08-25 leaf 4. 여기서 바뀐 것은 **소스 종류가 출처 티어를 정한다**는 규칙이다.

이전 판은 체결(`TRADE`)까지 LLM 추출로 보냈다. 체결은 해석의 여지가 없는 사실인데
그것을 확률적 추론기에 통과시키면, 확실한 것을 불확실하게 만들고 토큰까지 쓴다.
이제 종류별로 투영기가 갈린다:

- `CONVERSATION` → `ExtractionService` (LLM) → `SourceTier.CONVERSATIONAL`
- `TRADE`        → `DeterministicTradeProjector` (기계적) → `SourceTier.DETERMINISTIC`

둘이 같은 엣지를 주장하면 저장층이 결정적 티어를 이기게 한다(`GraphStore.apply_extraction`).
말과 행동이 어긋나는 것 자체가 제품의 신호이므로, 진 쪽 주장도 `graph_events`에 남는다.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from .db import SqliteOwner
from .history import (
    HistoryStore,
    IngestionJob,
    JobStatus,
    JobTrigger,
    RetryPolicy,
    SourceChange,
    utc_now,
)
from .ontology import (
    INVESTOR_PROFILE_NAME,
    Confidence,
    Entity,
    EntityKind,
    Relation,
    RelationKind,
    SourceKind,
    SourceRecord,
    SourceTier,
    entity_id,
    relation_id,
)

# Extraction over a single chat_message (no prior turns) is structurally low-signal for
# propensity inference -- "응 그거 좋아" means nothing without the message it answers, and
# propensity inference is the whole point. Only these kinds reach the LLM projector;
# CHAT_MESSAGE deliberately stays out so nobody re-adds it without a review catching this
# comment. `upsert_source` still runs for every kind, so raw provenance is unaffected.
#
# `RESEARCH`가 여기서 사라진 것은 이름만 바꾼 게 아니다 — 그 값을 만들어내는 어댑터가
# 애초에 하나도 없었다. 이 한 줄이 유일한 사용처였고, 그래서 온톨로지에서도 걷어냈다.
EXTRACTABLE_SOURCE_KINDS: frozenset[SourceKind] = frozenset({SourceKind.CONVERSATION})

# 기계적으로 관계를 유도하는 종류. leaf 2에서 `HOLDING`이 들어왔다 — 생산자
# (`HistoryStore.upsert_holding`)·어댑터·투영기를 한 묶음으로 세운 뒤에야 넣은 것이
# 요점이다. 생산자 없이 이 목록에만 존재하던 값이 `RESEARCH`였고, 그건 죽은 값이었다.
DETERMINISTIC_SOURCE_KINDS: frozenset[SourceKind] = frozenset(
    {SourceKind.TRADE, SourceKind.HOLDING}
)

class SourceAdapter(Protocol):
    name: str

    async def fetch_after(self, cursor: int, limit: int) -> tuple[SourceChange, ...]: ...


class SourceProjection(Protocol):
    async def upsert_source(self, source: SourceRecord) -> str: ...

    async def reset_projection(self) -> None: ...


class SourceProjector(Protocol):
    async def project_source(self, source: SourceRecord) -> None: ...


class GraphProjection(Protocol):
    """결정적 투영기가 쓰는 저장층 표면. `ExtractionProjection`과 같은 모양이다."""

    async def apply_extraction(
        self,
        source_id: str,
        source_fingerprint: str,
        entities: tuple[Entity, ...],
        relations: tuple[Relation, ...],
    ) -> None: ...


class DedupRunner(Protocol):
    """적재 뒤 엔티티를 접는 층. `DedupService`가 이 모양이다."""

    async def run(self) -> Any: ...


class InstrumentNameResolver(Protocol):
    """종목코드를 사람이 읽는 이름으로 바꾼다.

    브레인이 `selector.instrument_identity`를 직접 import하지 않는 이유는 방향 때문이다 —
    종목 마스터는 시세 런타임에 딸린 것이고, 브레인은 시세 없이도 서야 한다. 결선은
    `lifespan`이 한다.
    """

    def name_for(self, code: str) -> str | None: ...


def _resolve_security_name(resolver: InstrumentNameResolver | None, code: str) -> str:
    """이름을 못 찾으면 코드를 이름으로 쓴다.

    종목 마스터가 아직 안 떴다고 사실을 버리면 부팅 순서가 그래프 내용을 바꾼다.
    이름은 나중에 dedup이 `instrument_identity`로 정본화한다.
    """
    if resolver is not None:
        resolved = resolver.name_for(code)
        if resolved and resolved.strip():
            return resolved.strip()
    return code


def _investor_entity(now: datetime) -> Entity:
    return Entity(
        id=entity_id(EntityKind.INVESTOR_PROFILE, INVESTOR_PROFILE_NAME),
        kind=EntityKind.INVESTOR_PROFILE,
        name=INVESTOR_PROFILE_NAME,
        created_at=now,
        updated_at=now,
    )


def _security_entity(name: str, code: str, now: datetime) -> Entity:
    return Entity(
        id=entity_id(EntityKind.SECURITY, name),
        kind=EntityKind.SECURITY,
        name=name,
        # 이름이 코드 그대로면 별칭을 중복으로 달지 않는다 — 온톨로지가 중복 별칭을 막고,
        # 같은 값을 두 번 넣으면 FTS 행만 부푼다.
        aliases=() if name == code else (code,),
        attributes={"security_id": code},
        created_at=now,
        updated_at=now,
    )


@dataclass(frozen=True, slots=True)
class _TradeFacts:
    security_id: str
    side: str
    quantity: int
    price: str


def _trade_facts(source: SourceRecord) -> _TradeFacts | None:
    """체결 소스의 구조화된 속성만 읽는다. 본문 텍스트는 파싱하지 않는다.

    `HistoryStore.upsert_completed_trade`가 `attributes["trade"]`에 넣어둔 값이 정본이다.
    사람이 읽으라고 만든 `text`("completed buy 005930 quantity=10 ...")를 정규식으로 되
    파싱하면, 그 문구가 바뀌는 순간 조용히 아무것도 못 뽑게 된다.
    """
    trade: Any = source.attributes.get("trade")
    if not isinstance(trade, Mapping):
        return None
    security_id = trade.get("security_id")
    side = trade.get("side")
    quantity = trade.get("quantity")
    price = trade.get("price")
    if not isinstance(security_id, str) or not security_id.strip():
        return None
    if not isinstance(side, str) or not side.strip():
        return None
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity <= 0:
        return None
    return _TradeFacts(
        security_id=security_id.strip(),
        side=side.strip(),
        quantity=quantity,
        price=str(price) if price is not None else "",
    )


class DeterministicTradeProjector:
    """체결 소스 하나에서 `traded` 엣지를 기계적으로 유도한다.

    **`owns`를 만들지 않는 것이 의도다.** 매수 체결은 "그때 샀다"는 사실이지
    "지금 들고 있다"는 사실이 아니다. 보유는 잔고가 답할 문제이고, 체결로 보유를
    주장하면 판 종목이 영원히 보유로 남는다 — 결정적 티어라 대화가 정정할 수도 없다.

    이 계층이 만드는 관계는 정의상 전부 `SourceTier.DETERMINISTIC`이고
    `Confidence.EXTRACTED`다. 체결에 "얼마나 명시적인가"라는 축은 애초에 없다.
    """

    def __init__(
        self,
        graph: GraphProjection,
        *,
        resolver: InstrumentNameResolver | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._graph = graph
        self._resolver = resolver
        self._clock = clock

    async def project_source(self, source: SourceRecord) -> None:
        facts = _trade_facts(source)
        if facts is None:
            # 체결 속성이 없는 소스는 조용히 넘긴다. 사실이 없는데 관계를 지어내는 것이
            # 결정적 티어에서는 가장 나쁜 실패다 — 대화가 정정할 수 없는 거짓이 된다.
            return

        now = self._clock().astimezone(UTC)
        observed_at = source.occurred_at.astimezone(UTC)
        investor = _investor_entity(now)
        name = _resolve_security_name(self._resolver, facts.security_id)
        security = _security_entity(name, facts.security_id, now)
        traded = Relation(
            id=relation_id(RelationKind.TRADED, investor.id, security.id),
            kind=RelationKind.TRADED,
            source_entity_id=investor.id,
            target_entity_id=security.id,
            confidence=Confidence.EXTRACTED,
            tier=SourceTier.DETERMINISTIC,
            source_id=source.id,
            attributes={
                "side": facts.side,
                "quantity": facts.quantity,
                "price": facts.price,
            },
            observed_at=observed_at,
            extracted_at=max(now, observed_at),
        )
        await self._graph.apply_extraction(
            source.id, source.fingerprint, (investor, security), (traded,)
        )


@dataclass(frozen=True, slots=True)
class _HoldingFacts:
    security_id: str
    quantity: int
    average_price: str
    # 계좌별 내역. 합산은 **이력 층에서 이미 끝난** 상태로 오고, 여기서는 감사용으로
    # 실어 나르기만 한다. 이 필드가 없으면 "왜 15주인가"에 답할 수 없다.
    by_account: Mapping[str, int]


def _holding_facts(source: SourceRecord) -> _HoldingFacts | None:
    """잔고 소스의 구조화된 속성만 읽는다.

    `quantity == 0`도 유효한 사실로 받는다 — "다 팔았다"를 표현하는 값이고, 그래야
    소스 단위 원자 교체가 `owns` 엣지를 걷어낸다. 여기서 `None`을 돌려주면 그래프는
    마지막으로 들고 있던 상태에 영원히 멈춘다.
    """
    holding: Any = source.attributes.get("holding")
    if not isinstance(holding, Mapping):
        return None
    security_id = holding.get("security_id")
    quantity = holding.get("quantity")
    average_price = holding.get("average_price")
    if not isinstance(security_id, str) or not security_id.strip():
        return None
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 0:
        return None
    raw_by_account = holding.get("by_account")
    by_account: dict[str, int] = {}
    if isinstance(raw_by_account, Mapping):
        by_account = {
            str(alias): value
            for alias, value in raw_by_account.items()
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        }
    return _HoldingFacts(
        security_id=security_id.strip(),
        quantity=quantity,
        average_price=str(average_price) if average_price is not None else "",
        by_account=by_account,
    )


class DeterministicHoldingProjector:
    """보유잔고 스냅숏에서 `owns` 엣지를 기계적으로 유도한다.

    **`owns`가 나오는 유일한 곳이다.** 체결 투영기는 `traded`만 만든다 — 매수 체결은
    "그때 샀다"이지 "지금 들고 있다"가 아니기 때문이다. 보유는 잔고만 답할 수 있다.

    수량이 0이면 엔티티는 남기고 관계는 만들지 않는다. 소스 단위 원자 교체가 이 소스의
    옛 `owns`를 지우므로, "다 팔았다"가 그래프에 반영되고 `EDGE_REMOVED`가 남는다.
    종목 노드를 함께 지우지 않는 이유는 과거에 들고 있었다는 사실이 여전히 신호이기
    때문이다 — 대화가 그 종목을 언급하면 붙을 자리가 있어야 한다.
    """

    def __init__(
        self,
        graph: GraphProjection,
        *,
        resolver: InstrumentNameResolver | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._graph = graph
        self._resolver = resolver
        self._clock = clock

    async def project_source(self, source: SourceRecord) -> None:
        facts = _holding_facts(source)
        if facts is None:
            return

        now = self._clock().astimezone(UTC)
        observed_at = source.occurred_at.astimezone(UTC)
        investor = _investor_entity(now)
        name = _resolve_security_name(self._resolver, facts.security_id)
        security = _security_entity(name, facts.security_id, now)

        relations: tuple[Relation, ...] = ()
        if facts.quantity > 0:
            relations = (
                Relation(
                    id=relation_id(RelationKind.OWNS, investor.id, security.id),
                    kind=RelationKind.OWNS,
                    source_entity_id=investor.id,
                    target_entity_id=security.id,
                    confidence=Confidence.EXTRACTED,
                    tier=SourceTier.DETERMINISTIC,
                    source_id=source.id,
                    attributes={
                        "quantity": facts.quantity,
                        "average_price": facts.average_price,
                        # 계좌별 분해. 엣지는 종목당 하나뿐이므로 "왜 이 수량인가"는
                        # 여기서만 답할 수 있다.
                        **({"by_account": dict(facts.by_account)} if facts.by_account else {}),
                    },
                    observed_at=observed_at,
                    extracted_at=max(now, observed_at),
                ),
            )
        await self._graph.apply_extraction(
            source.id, source.fingerprint, (investor, security), relations
        )


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
class HoldingHistoryAdapter:
    history: HistoryStore
    name: str = "holding_history"

    async def fetch_after(self, cursor: int, limit: int) -> tuple[SourceChange, ...]:
        return await self.history.holding_changes(cursor, limit=limit)


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
        deterministic_projector: SourceProjector | None = None,
        holding_projector: SourceProjector | None = None,
        dedup: DedupRunner | None = None,
    ) -> None:
        if not 1 <= batch_size <= 500:
            raise ValueError("batch_size must be between 1 and 500")
        configured_adapters = adapters or (
            ChatHistoryAdapter(history),
            CompletedTradeHistoryAdapter(history),
            HoldingHistoryAdapter(history),
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
        self._dedup = dedup
        # 라우팅 표를 한 곳에 둔다. 종류가 늘 때 분기문 여러 개를 고치는 대신 이 표만
        # 고치면 되고, 티어 상수와 어긋나면 아래 단언이 **생성 시점에** 잡는다.
        self._projectors: dict[SourceKind, SourceProjector] = {}
        if source_projector is not None:
            self._projectors[SourceKind.CONVERSATION] = source_projector
        if deterministic_projector is not None:
            self._projectors[SourceKind.TRADE] = deterministic_projector
        if holding_projector is not None:
            self._projectors[SourceKind.HOLDING] = holding_projector
        unclassified = set(self._projectors) - (
            EXTRACTABLE_SOURCE_KINDS | DETERMINISTIC_SOURCE_KINDS
        )
        if unclassified:
            raise ValueError(
                f"projector kinds are not classified by tier: {sorted(unclassified)}"
            )

    def _shared_owner(self) -> SqliteOwner | None:
        """그래프와 이력이 **같은 연결**을 쓰고 있으면 그 소유자를 돌려준다.

        같은 연결일 때만 둘의 쓰기를 커밋 하나로 묶을 수 있다. 파일이 갈려 있거나
        (구 설정) 목 객체를 쓰는 테스트에서는 `None`이고, 그때는 이전처럼 커밋이 여럿인
        채로 동작한다 — 느슨해질 뿐 틀리지는 않는다.
        """
        graph_owner = getattr(self._graph, "owner", None)
        history_owner = getattr(self._history, "owner", None)
        if isinstance(graph_owner, SqliteOwner) and graph_owner is history_owner:
            return graph_owner
        return None

    @asynccontextmanager
    async def _atomic_item(self) -> AsyncIterator[None]:
        """소스 한 건의 그래프 쓰기 + 커서 전진을 한 단위로 묶는다.

        이것이 leaf 2의 요점이다. 묶지 않으면 "커서는 전진했는데 그래프엔 안 들어간"
        상태가 두 커밋 사이의 종료마다 생기고, 그 소스는 다시는 투영되지 않는다 —
        커서가 이미 지나갔으므로 재시도도 그것을 건너뛴다. 조용히 비는 그래프다.

        잡 전체가 아니라 **항목 단위**인 것도 의도다. 잡 하나가 수천 건일 수 있는데
        그걸 한 트랜잭션으로 잡으면 쓰기 락을 몇 분씩 들고 있게 되고, 실패 시 이미
        끝난 수천 건까지 되감긴다. 중간 실패에서 마지막 성공 지점부터 재개하는 것은
        이미 커서가 보장한다.
        """
        owner = self._shared_owner()
        if owner is None:
            yield
            return
        async with owner.transaction():
            yield

    def _projector_for(self, kind: SourceKind) -> SourceProjector | None:
        """소스 종류가 투영기를, 곧 출처 티어를 정한다."""
        return self._projectors.get(kind)

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
            total = sum(report.projected for report in reports)
            if (total or job.attempts > 1) and self._dedup is not None:
                # 새 투영 직후 중복을 정리한다. 이 단계가 실패한 잡은 성공이 아니다:
                # 그래프에 원본 투영은 남아도 정본화가 끝나지 않았으므로 retry 상태로
                # 기록한다. 재시도에서는 커서가 이미 전진해 total=0일 수 있으므로
                # attempts>1인 잡도 dedup을 다시 실행해야 실패 단계가 실제로 복구된다.
                await self._dedup.run()
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
                async with self._atomic_item():
                    await self._graph.upsert_source(change.record)
                    projector = self._projector_for(change.record.kind)
                    if projector is not None:
                        await projector.project_source(change.record)
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
