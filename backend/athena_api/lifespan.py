"""Application resource lifecycle."""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Iterator, Mapping
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum

from fastapi import FastAPI

from athena_api.account_sync import RuntimeAccountRegistry
from athena_api.accounts import AccountRuntime
from athena_api.backtest import deploy_runner
from athena_api.backtest.runner import BacktestRunner
from athena_api.backtest.store import BacktestStore
from athena_api.brain import (
    ClaudeCliStructuredLlm,
    DedupService,
    DeterministicHoldingProjector,
    DeterministicTradeProjector,
    ExtractionService,
    GraphProjector,
    GraphStore,
    HistoryStore,
    HoldingSnapshotIngestor,
    IngestionCoordinator,
    JobTrigger,
    LocalCommandStructuredLlm,
    PartialHoldingsError,
    TradeBackfill,
    utc_now,
)
from athena_api.brain.db import SqliteOwner
from athena_api.brain_sources import KiwoomExecutionSource, KiwoomHoldingSource
from athena_api.config import Settings, get_settings
from athena_api.dependencies import build_selector_service
from athena_api.kiwoom import KiwoomClient, RateLimiter
from athena_api.process_lock import BrainProcessLock
from athena_api.routines.guard_settings import GuardSettingsStore
from athena_api.routines.runtime import (
    RoutinesRuntime,
    open_routines,
    teardown_routines,
)
from athena_api.selector.instrument_identity import InstrumentIdentityIndex

logger = logging.getLogger(__name__)


class _ReadyAccountClients(Mapping[str, KiwoomClient]):
    """Live read-only view of ready data clients in the mutable account pool."""

    def __init__(self, runtimes: Mapping[str, AccountRuntime]) -> None:
        self._runtimes = runtimes

    def __getitem__(self, alias: str) -> KiwoomClient:
        runtime = self._runtimes[alias]
        if not runtime.ready:
            raise KeyError(alias)
        return runtime.data_client

    def __iter__(self) -> Iterator[str]:
        return (alias for alias, runtime in self._runtimes.items() if runtime.ready)

    def __len__(self) -> int:
        return sum(runtime.ready for runtime in self._runtimes.values())


class _CurrentDefaultClient:
    """Resolve the app's current default REST client at each adapter call."""

    def __init__(self, app: FastAPI) -> None:
        self._app = app

    def __getattr__(self, name: str):
        client = getattr(self._app.state, "kiwoom_client", None)
        if client is None:
            raise RuntimeError("현재 기본 키움 계좌가 준비되지 않았습니다")
        return getattr(client, name)


@dataclass(slots=True)
class BrainRuntime:
    """Everything bound to the investment-brain graph projection for this process."""

    store: GraphStore
    lock: BrainProcessLock
    history: HistoryStore
    # 두 저장소가 나눠 쓰는 연결의 실제 소유자. 빌려 쓰는 쪽은 close()가 no-op이므로
    # 파일을 닫는 책임이 여기 있다 — 이 필드가 없으면 연결이 새고 다음 기동이 잠긴다.
    owner: SqliteOwner | None = None
    # 앱 수명 동안 살아 있는 NetworkX 투영기. 요청마다 새로 만들면 리비전 캐시가 매번
    # 비어 분석 한 화면에 그래프를 다섯 번 읽는다.
    projector: GraphProjector | None = None
    ready: bool = False
    last_error: str | None = None
    coordinator: IngestionCoordinator | None = None
    ingestion_ready: bool = False
    ingestion_last_error: str | None = None
    extraction_enabled: bool = False
    hourly_task: asyncio.Task[None] | None = None
    # 소스별(대화·체결·잔고) 조회 주기와 실행 시각의 주인(2026-09-08). hourly_task는
    # 이 스케줄러의 루프를 품은 태스크다 — 외부가 주기를 소유하면(external) 루프는
    # 없지만 스케줄러는 있다: 수동 실행과 상태 조회는 그래도 되어야 한다.
    scheduler: "BrainIngestScheduler | None" = None
    # WP-H(2026-09-03) — 기동 직후 한 번 도는 체결 백필 + 잔고 스냅숏. 참조를 들고
    # 있어야 GC에 안 걷히고(hourly_task와 같은 관례), teardown이 취소할 수 있다.
    producer_task: asyncio.Task[None] | None = None
    startup_ingestion_job_id: str | None = None
    startup_ingestion_lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


async def _produce_trade_facts(backfill: TradeBackfill | None) -> str | None:
    """체결을 이력에 적재한다(WP-H). 실패는 다음 주기가 다시 시도하므로 삼키고
    예외 **형 이름**만 돌려준다 — 상류 메시지에 경로·자격증명 조각이 실릴 수 있다.
    취소만 그대로 통과시킨다: teardown이 이 코루틴을 품은 태스크를 cancel-and-await한다.
    """
    if backfill is None:
        return None
    try:
        await backfill.run()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("brain trade backfill failed type=%s", type(exc).__name__)
        return type(exc).__name__
    return None


async def _produce_holding_facts(holdings: HoldingSnapshotIngestor | None) -> str | None:
    """잔고 스냅숏을 이력에 적재한다(WP-H). 계약은 _produce_trade_facts와 같다."""
    if holdings is None:
        return None
    try:
        await holdings.ingest()
    except asyncio.CancelledError:
        raise
    except PartialHoldingsError:
        # 계좌 일부만 조회된 주기 — 반쪽을 적재하면 실패한 계좌의 보유가
        # "매도"로 보인다(holdings.py). 이번 주기를 통째로 건너뛴다.
        logger.warning("brain holding snapshot skipped: partial account failure")
        return PartialHoldingsError.__name__
    except Exception as exc:
        logger.warning("brain holding snapshot failed type=%s", type(exc).__name__)
        return type(exc).__name__
    return None


async def _produce_trade_and_holding_facts(
    backfill: TradeBackfill | None, holdings: HoldingSnapshotIngestor | None
) -> None:
    """체결·잔고를 이력에 적재한다(WP-H).

    체결이 먼저다 — 백필 커서는 단조 증가라 실패한 날부터 다시 하고, 잔고 실패가
    체결을 막을 이유가 없다(서로 다른 사실이다).
    """
    await _produce_trade_facts(backfill)
    await _produce_holding_facts(holdings)


async def _startup_produce(
    backfill: TradeBackfill,
    holdings: HoldingSnapshotIngestor,
    coordinator: IngestionCoordinator,
) -> None:
    """기동 직후 한 번(WP-H) — 첫 백필은 영업일 수십 개 × 초당 1회 rate limit이라
    분 단위로 걸린다. 기동을 막지 않고 뒤에서 돌고, 끝나면 잡 하나를 넣어 새 사실이
    한 시간을 기다리지 않고 투영되게 한다(STARTUP 잡은 이 적재보다 먼저 돌았다)."""
    await _produce_trade_and_holding_facts(backfill, holdings)
    try:
        await coordinator.enqueue(JobTrigger.MANUAL)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("brain produce enqueue failed type=%s", type(exc).__name__)


class BrainSource(StrEnum):
    """화면(보드 05 수집·노출)의 세 칸과 1:1 — 대화 · 체결내역 · 보유잔고."""

    CHAT = "chat"
    FILLS = "fills"
    HOLDINGS = "holdings"


@dataclass(slots=True)
class SourceSchedule:
    """소스 하나의 조회 주기와 실행 시각. 상태 API가 그대로 내보낸다."""

    interval_seconds: float
    # 체결·잔고는 키움 계정이 결선돼 있어야 실제로 적재된다. 안 돼 있으면 "돌긴 돌지만
    # 새 사실은 없다"는 뜻이라 화면이 그 사실을 숨기지 않게 따로 든다(§0 정직성).
    producer_wired: bool
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    running: bool = False
    # 마지막 실행에서 난 예외의 형 이름만 — 메시지는 남기지 않는다(로그 관례와 같다).
    last_error: str | None = None


class BrainIngestScheduler:
    """소스별 조회 주기로 체결·잔고를 적재하고 수집 잡을 넣는다(ADR §9 gate G005의 후신).

    예전 `_hourly_ingest_loop`는 주기 하나로 셋을 한꺼번에 돌렸다. 이제 소스마다
    주기가 다르되 **같은 틱에 만기된 소스는 한 번에 처리한다** — 생산(체결→잔고)을
    먼저 하고 잡은 하나만 넣는다. 그래야 그 잡이 방금 생긴 사실을 투영하고, 기본값
    (셋 다 60분)에서는 예전과 완전히 같은 순서·같은 잡 수가 된다.

    대화 소스의 "실행"은 잡 하나를 넣는 것이다 — 원문은 앱이 이미 /brain/chat으로
    밀어 넣어 두었고, 잡이 그것을 그래프에 투영한다.

    수동 실행(run_now)은 예전 enqueue(JobTrigger.MANUAL) 경로 그대로다. 취소는
    그대로 통과시킨다: _teardown_brain이 루프 태스크를 cancel-and-await한다.
    """

    def __init__(
        self,
        coordinator: IngestionCoordinator,
        interval_seconds: float,
        *,
        backfill: TradeBackfill | None = None,
        holdings: HoldingSnapshotIngestor | None = None,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._coordinator = coordinator
        self._backfill = backfill
        self._holdings = holdings
        self._clock = clock
        self._wakeup = asyncio.Event()
        first = clock() + timedelta(seconds=interval_seconds)
        self.schedules: dict[BrainSource, SourceSchedule] = {
            BrainSource.CHAT: SourceSchedule(interval_seconds, True, next_run_at=first),
            BrainSource.FILLS: SourceSchedule(
                interval_seconds, backfill is not None, next_run_at=first
            ),
            BrainSource.HOLDINGS: SourceSchedule(
                interval_seconds, holdings is not None, next_run_at=first
            ),
        }

    def set_interval(self, source: BrainSource, interval_seconds: float) -> SourceSchedule:
        """주기를 바꾸고 다음 실행 시각을 마지막 실행 기준으로 다시 잰다.

        마지막 실행이 없으면 지금 기준이다. 줄인 주기가 이미 지났으면 루프가 곧바로
        돈다 — 사용자가 "더 자주"를 골랐는데 옛 주기의 남은 시간을 기다리게 하지 않는다.
        """
        if interval_seconds <= 0:
            raise ValueError("interval_seconds must be positive")
        schedule = self.schedules[source]
        schedule.interval_seconds = interval_seconds
        base = schedule.last_run_at or self._clock()
        schedule.next_run_at = base + timedelta(seconds=interval_seconds)
        self._wakeup.set()
        return schedule

    async def run_now(self, source: BrainSource) -> SourceSchedule:
        await self._run_sources([source], JobTrigger.MANUAL)
        return self.schedules[source]

    async def _run_sources(self, sources: list[BrainSource], trigger: JobTrigger) -> None:
        for source in sources:
            self.schedules[source].running = True
            self.schedules[source].last_error = None
        try:
            if BrainSource.FILLS in sources:
                self.schedules[BrainSource.FILLS].last_error = await _produce_trade_facts(
                    self._backfill
                )
            if BrainSource.HOLDINGS in sources:
                self.schedules[BrainSource.HOLDINGS].last_error = await _produce_holding_facts(
                    self._holdings
                )
            try:
                await self._coordinator.enqueue(trigger)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # A transient scheduler/coordinator failure must not permanently disable
                # later refreshes. Log only the exception type: upstream messages can
                # contain paths, command arguments, or provider response fragments.
                logger.warning(
                    "brain ingestion tick failed type=%s; retrying next interval",
                    type(exc).__name__,
                )
                for source in sources:
                    self.schedules[source].last_error = type(exc).__name__
        finally:
            done = self._clock()
            for source in sources:
                schedule = self.schedules[source]
                schedule.running = False
                schedule.last_run_at = done
                schedule.next_run_at = done + timedelta(seconds=schedule.interval_seconds)

    async def run_loop(self) -> None:
        """만기된 소스를 모아 돌리고, 가장 이른 다음 시각까지 잔다(주기 변경이면 깨어난다)."""
        while True:
            now = self._clock()
            due = [
                source
                for source, schedule in self.schedules.items()
                if schedule.next_run_at is not None and schedule.next_run_at <= now
            ]
            if due:
                await self._run_sources(due, JobTrigger.HOURLY)
                continue
            soonest = min(
                schedule.next_run_at
                for schedule in self.schedules.values()
                if schedule.next_run_at is not None
            )
            delay = max(0.0, (soonest - now).total_seconds())
            self._wakeup.clear()
            with suppress(TimeoutError):
                await asyncio.wait_for(self._wakeup.wait(), timeout=delay)


async def _hourly_ingest_loop(
    coordinator: IngestionCoordinator,
    interval_seconds: float,
    *,
    backfill: TradeBackfill | None = None,
    holdings: HoldingSnapshotIngestor | None = None,
) -> None:
    """주기 하나로 셋을 도는 옛 진입점 — BrainIngestScheduler의 기본 상태와 같다."""
    await BrainIngestScheduler(
        coordinator, interval_seconds, backfill=backfill, holdings=holdings
    ).run_loop()


async def _refresh_instrument_identity(
    index: InstrumentIdentityIndex, client: KiwoomClient
) -> None:
    """기동 뒤 백그라운드 1회 — 실패해도 기동을 약화시키지 않는다(빈 스냅숏 = fail-closed)."""
    try:
        await index.refresh(client)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # Identity availability may never weaken startup or leak upstream contents. The
        # empty prior snapshot makes selector planning fail closed until a future complete
        # refresh succeeds.
        logger.warning("instrument identity refresh failed type=%s", type(exc).__name__)


async def _teardown_instrument_identity(app: FastAPI) -> None:
    task: asyncio.Task[None] | None = getattr(app.state, "instrument_identity_task", None)
    app.state.instrument_identity_task = None
    if task is None or task.done():
        return
    task.cancel()
    with suppress(BaseException):
        await task


def _publish_default(app: FastAPI, runtime: AccountRuntime | None) -> None:
    """Mirror the default account's stack onto the flat app.state attributes.

    These are the same objects, not copies, so a token refresh on the pooled runtime is
    visible through both views. They exist so single-account callers and the readiness
    probe keep working unchanged once a pool is configured.
    """
    app.state.kiwoom_ready = runtime is not None and runtime.ready
    app.state.kiwoom_client = runtime.data_client if runtime else None
    app.state.kiwoom_order_client = runtime.order_client if runtime else None
    app.state.kiwoom_auth = runtime.auth if runtime else None
    app.state.kiwoom_ws_client = runtime.ws_client if runtime else None
    app.state.token_manager = runtime.token_manager if runtime else None
    app.state.kiwoom_rate_limiter = runtime.rate_limiter if runtime else RateLimiter(
        rate_per_second=5.0
    )
    app.state.kiwoom_order_rate_limiter = app.state.kiwoom_rate_limiter


def _publish_brain(app: FastAPI, brain: BrainRuntime | None) -> None:
    app.state.brain_store = brain.store if brain is not None and brain.ready else None
    app.state.brain_projector = brain.projector if brain is not None and brain.ready else None
    app.state.brain_ready = brain is not None and brain.ready
    app.state.brain_last_error = brain.last_error if brain is not None else None
    app.state.brain_ingestion_ready = brain is not None and brain.ingestion_ready
    app.state.brain_ingestion_last_error = (
        brain.ingestion_last_error if brain is not None else None
    )
    app.state.brain_extraction_enabled = brain is not None and brain.extraction_enabled
    # ingestion_ready is only ever True while history.open() succeeded and stayed open
    # (see _open_brain: the except branch that sets ingestion_last_error always closes
    # history again) -- so gating this the same way brain_store is gated on brain.ready
    # guarantees a non-None value here is actually open.
    app.state.brain_history = (
        brain.history if brain is not None and brain.ingestion_ready else None
    )
    # Raw runtime handle for the reset-and-restart route (brain.py): it needs the actual
    # BrainRuntime object to call _teardown_brain, not the flattened read-only views above.
    # None whenever the runtime itself is None, independent of brain.ready/ingestion_ready
    # -- a degraded-but-open runtime must still be reachable for teardown.
    app.state.brain_runtime = brain


async def _open_brain(
    settings: Settings,
    *,
    kiwoom_clients: Mapping[str, KiwoomClient] | None = None,
    hourly_interval_seconds: float | None = None,
) -> BrainRuntime:
    """Best-effort brain startup: a missing native runtime degrades, lock contention does not.

    ADR investment-brain-architecture.md §4.1 makes this process the graph projection's
    sole READ_WRITE owner, so a held process lock is a correctness hazard — §11's
    acceptance list requires a second backend to fail to start, so lock contention is
    left to raise and abort startup (see the caller). 저장층을 열지 못하는 것은 브레인이
    선택적 기능이라는 점 때문에 기동을 중단시키지 않고 런타임에 기록만 한다.

    FTS 강등 플래그(`fts_ready`/`fts_last_error`)는 사라졌다. FTS5가 SQLite 내장이라
    확장 로딩이라는 단계 자체가 없어졌고, 항상 True인 플래그를 남겨두면 그것을 읽는
    쪽이 존재하지 않는 실패 모드를 계속 다루게 된다.

    ADR §4.2 step 1 also puts "writer queue/scheduler 시작" after schema and before
    readiness is published. The writer queue is IngestionCoordinator (ingestion.py); it is
    started best-effort — a failure to open the raw-history store
    or start the coordinator degrades ingestion_ready without failing graph read/write,
    which does not depend on ingestion.

    채팅은 `POST /api/v1/brain/chat`이 `HistoryStore.upsert_chat`으로 넣는다 — 앱 안에
    실제 생산자가 있다. (이 자리에 "there is no source adapter wired into the app yet"
    이라고 적혀 있었는데, 그 라우트가 생긴 뒤로 거짓이었다. leaf 7에서 바로잡는다.)
    체결·잔고는 ``kiwoom_clients``가 오면 이 함수가 생산자를 결선한다(WP-H, 2026-09-03) —
    기동 직후 한 번(백필 + 잔고 스냅숏, `producer_task`) 돌고 이후 시간당 주기 앞에서
    돈다. 브레인이 키움을 직접 알지 않는다는 방향(holdings.py)은 그대로다: 여기서
    `brain_sources`의 구현체를 프로토콜 자리에 꽂을 뿐이다. 안 오면(시세 자격증명이
    없는 기동) 생산자 없이 예전과 같다.

    Every `except Exception` above is a deliberate demotion to a degraded runtime; none of
    them catch cancellation (`CancelledError` is a `BaseException`), and startup being
    aborted can cancel this coroutine at any of the awaits below. If that happened
    uncaught, it would propagate past the caller's `brain = await _open_brain(...)`
    assignment, leaving that local `None` -- so `build_lifespan`'s abort path calls
    `_teardown_brain(app, None)` and cleans up nothing, leaking the process lock and any
    opened store/history and stalling the next startup in this process. The outer
    `except BaseException` below is only for that escape path: it does not change the
    demotion semantics above, it just unwinds whatever was acquired so far before
    re-raising so the caller's abort path still fires.

    ``hourly_interval_seconds`` overrides ``settings.brain_ingest_interval_minutes`` for
    tests that need a fast self-enqueue tick without waiting real minutes; production
    callers leave it unset.
    """
    lock = BrainProcessLock.for_db_path(settings.brain_db_path, label=str(settings.brain_db_path))
    lock.acquire()
    # 연결 하나를 두 저장소가 나눠 쓴다. 그래야 코디네이터가 커서 전진과 그래프 쓰기를
    # 커밋 하나로 묶을 수 있다 — 파일만 같고 연결이 둘이면 커밋도 둘이다.
    owner = SqliteOwner(settings.brain_db_path)
    store = GraphStore(owner)
    history = HistoryStore(owner)
    brain = BrainRuntime(store=store, lock=lock, history=history, owner=owner)
    coordinator: IngestionCoordinator | None = None
    try:
        try:
            settings.brain_db_path.parent.mkdir(parents=True, exist_ok=True)
            await owner.open()
            await store.open()
        except Exception as exc:
            brain.last_error = str(exc)
            lock.release()
            return brain
        brain.ready = True
        brain.projector = GraphProjector(store)
        try:
            await history.open()
            source_projector = None
            if settings.brain_extraction_llm_argv:
                client = LocalCommandStructuredLlm(tuple(settings.brain_extraction_llm_argv))
                source_projector = ExtractionService(client, store)
            elif settings.brain_use_claude_cli_extraction:
                source_projector = ExtractionService(ClaudeCliStructuredLlm(), store)
            # 체결은 LLM을 타지 않는다. 추출이 꺼져 있어도(설정에 argv가 없어도) 결정적
            # 티어는 항상 돌아야 한다 — 체결은 사실이고, 사실을 적재하는 데 모델 설정이
            # 필요할 이유가 없다.
            coordinator = IngestionCoordinator(
                history,
                store,
                source_projector=source_projector,
                deterministic_projector=DeterministicTradeProjector(store),
                holding_projector=DeterministicHoldingProjector(store),
                # 새 소스가 들어온 직후가 중복이 생기는 시점이다. 실패하면 정본화가
                # 끝나지 않은 것이므로 잡도 retry 상태가 되어 같은 단계를 다시 수행한다.
                dedup=DedupService(store),
            )
            await coordinator.start()
            startup_job = await coordinator.enqueue(JobTrigger.STARTUP)
        except Exception as exc:
            brain.ingestion_last_error = str(exc)
            if coordinator is not None:
                with suppress(BaseException):
                    await coordinator.stop()
            await history.close()
        else:
            brain.coordinator = coordinator
            brain.ingestion_ready = True
            brain.extraction_enabled = source_projector is not None
            brain.startup_ingestion_job_id = startup_job.id
            # WP-H — 체결·잔고 생산자. 이 결선이 생기기 전에는 upsert_completed_trade/
            # upsert_holding을 부르는 곳이 테스트뿐이었다(위 docstring).
            backfill: TradeBackfill | None = None
            holdings_ingestor: HoldingSnapshotIngestor | None = None
            if kiwoom_clients is not None:
                def current_aliases() -> tuple[str, ...]:
                    return tuple(kiwoom_clients)

                backfill = TradeBackfill(
                    history,
                    KiwoomExecutionSource(kiwoom_clients),
                    aliases=current_aliases,
                    clock=utc_now,
                )
                holdings_ingestor = HoldingSnapshotIngestor(
                    history,
                    KiwoomHoldingSource(kiwoom_clients),
                    aliases=current_aliases,
                    clock=utc_now,
                )
                brain.producer_task = asyncio.create_task(
                    _startup_produce(backfill, holdings_ingestor, coordinator),
                    name="athena-brain-produce-startup",
                )
            interval_seconds = (
                hourly_interval_seconds
                if hourly_interval_seconds is not None
                else settings.brain_ingest_interval_minutes * 60
            )
            brain.scheduler = BrainIngestScheduler(
                coordinator,
                interval_seconds,
                backfill=backfill,
                holdings=holdings_ingestor,
            )
            if settings.brain_ingest_schedule_owner == "backend":
                brain.hourly_task = asyncio.create_task(
                    brain.scheduler.run_loop(),
                    name="athena-brain-hourly-ingest",
                )
        return brain
    except BaseException:
        if brain.producer_task is not None:
            brain.producer_task.cancel()
            with suppress(BaseException):
                await brain.producer_task
        if brain.hourly_task is not None:
            brain.hourly_task.cancel()
            with suppress(BaseException):
                await brain.hourly_task
        if coordinator is not None:
            with suppress(BaseException):
                await coordinator.stop()
        with suppress(BaseException):
            await history.close()
        with suppress(BaseException):
            await store.close()
        with suppress(BaseException):
            await owner.close()
        with suppress(BaseException):
            lock.release()
        raise


def _publish_routines(app: FastAPI, routines: "RoutinesRuntime | None") -> None:
    # ready/last_error는 API가 runtime에서 직접 읽는다 — app.state 미러를 두지 않는다.
    app.state.routines_runtime = routines
    app.state.routine_events = routines.events if routines is not None else None


@dataclass(slots=True)
class BacktestRuntime:
    """캔들 캐시 · 실행 이력 SqliteOwner + 잡 러너 — 브레인과 같은 자리, 다른 파일(§5.3:
    브레인의 reset-and-restart가 캔들 캐시까지 날리면 안 된다)."""

    store: BacktestStore
    runner: BacktestRunner
    owner: SqliteOwner
    ready: bool = False
    last_error: str | None = None


def _publish_backtest(app: FastAPI, backtest: "BacktestRuntime | None") -> None:
    app.state.backtest_store = backtest.store if backtest is not None and backtest.ready else None
    app.state.backtest_runner = backtest.runner if backtest is not None and backtest.ready else None
    app.state.backtest_last_error = backtest.last_error if backtest is not None else None


async def _open_backtest(settings: Settings) -> BacktestRuntime:
    """브레인(_open_brain)과 같은 best-effort 원칙 — 저장층을 못 열어도 기동을 중단시키지
    않고 런타임에 기록만 한다(백테스트도 선택적 기능이다)."""
    settings.backtest_db_path.parent.mkdir(parents=True, exist_ok=True)
    owner = SqliteOwner(settings.backtest_db_path)
    store = BacktestStore(owner)
    runner = BacktestRunner(store)
    backtest = BacktestRuntime(store=store, runner=runner, owner=owner)
    try:
        await owner.open()
        await store.open()
    except Exception as exc:
        backtest.last_error = str(exc)
        with suppress(BaseException):
            await owner.close()
        return backtest
    backtest.ready = True
    return backtest


async def _teardown_backtest(app: FastAPI, backtest: BacktestRuntime | None) -> None:
    if backtest is not None and backtest.ready:
        # 살아있는 잡부터 취소 — owner를 먼저 닫으면 진행 중인 store 쓰기가 닫힌
        # 연결을 만난다.
        await backtest.runner.shutdown()
        await backtest.owner.close()
    _publish_backtest(app, None)


async def _teardown_brain(app: FastAPI, brain: BrainRuntime | None) -> None:
    primary_error: BaseException | None = None
    if brain is not None:
        # The hourly self-enqueue timer must stop before IngestionCoordinator.stop()
        # begins rejecting new enqueue() calls (ADR §4.2 step 3) -- otherwise a tick that
        # fires mid-teardown races enqueue()'s own shutdown check. Symmetric with how the
        # timer is only started once the coordinator itself is up in _open_brain.
        # 생산자도 coordinator.enqueue()를 부른다 — 타이머와 같은 이유로 stop() 전에
        # 멈춘다(WP-H).
        if brain.producer_task is not None:
            brain.producer_task.cancel()
            try:
                await brain.producer_task
            except asyncio.CancelledError:
                pass
            except BaseException as exc:
                primary_error = exc
        if brain.hourly_task is not None:
            brain.hourly_task.cancel()
            try:
                await brain.hourly_task
            except asyncio.CancelledError:
                pass
            except BaseException as exc:
                primary_error = exc
        # ADR §4.2 step 3: reject new enqueue -> drain/checkpoint -> writer cancel and
        # await -> DB close -> lock release. IngestionCoordinator.stop() implements the
        # first three; it must finish before the stores it writes through are closed.
        if brain.coordinator is not None:
            try:
                await brain.coordinator.stop()
            except BaseException as exc:
                if primary_error is None:
                    primary_error = exc
        try:
            await brain.history.close()
        except BaseException as exc:
            if primary_error is None:
                primary_error = exc
        try:
            await brain.store.close()
        except BaseException as exc:
            if primary_error is None:
                primary_error = exc
        # 공유 연결은 빌려 쓰는 저장소가 닫지 않는다. 소유자만 닫을 수 있다.
        if brain.owner is not None:
            try:
                await brain.owner.close()
            except BaseException as exc:
                if primary_error is None:
                    primary_error = exc
        try:
            brain.lock.release()
        except BaseException as exc:
            if primary_error is None:
                primary_error = exc
    _publish_brain(app, None)
    if primary_error is not None:
        raise primary_error


async def _teardown_cluster_labeling_tasks(app: FastAPI) -> None:
    tasks: dict[tuple[str, str], asyncio.Task[None]] = getattr(
        app.state, "cluster_labeling_tasks", {}
    )
    pending = tuple(tasks.values())
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    tasks.clear()


async def _cleanup_lifespan_resources(
    app: FastAPI,
    account_registry: RuntimeAccountRegistry,
    brain: BrainRuntime | None,
    routines: RoutinesRuntime | None,
    backtest: BacktestRuntime | None,
    *,
    primary_error: BaseException | None = None,
) -> None:
    first_error = primary_error
    phases = (
        ("instrument-identity", lambda: _teardown_instrument_identity(app)),
        ("accounts", lambda: _teardown(app, account_registry)),
        ("cluster-labeling", lambda: _teardown_cluster_labeling_tasks(app)),
        ("brain", lambda: _teardown_brain(app, brain)),
        ("routines", lambda: teardown_routines(routines)),
        ("backtest", lambda: _teardown_backtest(app, backtest)),
    )
    for phase, cleanup in phases:
        try:
            await cleanup()
        except BaseException as exc:
            logger.warning(
                "lifespan cleanup phase failed phase=%s type=%s",
                phase,
                type(exc).__name__,
            )
            if first_error is None:
                first_error = exc
    _publish_routines(app, None)
    _publish_default(app, None)
    if first_error is not None:
        raise first_error


def build_lifespan(settings: Settings | None = None, *, ws_connect=None):
    runtime_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        instrument_identity = InstrumentIdentityIndex()
        app.state.instrument_identity = instrument_identity
        app.state.instrument_identity_task = None
        app.state.selector_service = build_selector_service(instrument_identity)
        app.state.settings = runtime_settings
        app.state.local_bearer_token = (
            runtime_settings.local_bearer_token.get_secret_value()
            if runtime_settings.local_bearer_token is not None
            else None
        )
        async def publish_runtime_ready(runtime: AccountRuntime) -> None:
            default_alias = getattr(app.state, "kiwoom_default_account", None)
            if runtime.alias == default_alias:
                _publish_default(app, runtime)
                current_routines = getattr(app.state, "routines_runtime", None)
                if current_routines is not None:
                    await current_routines.rebind_ws_client(runtime.ws_client)
            task: asyncio.Task[None] | None = getattr(
                app.state, "instrument_identity_task", None
            )
            if task is None or task.done():
                app.state.instrument_identity_task = asyncio.create_task(
                    _refresh_instrument_identity(instrument_identity, runtime.data_client),
                    name="athena-instrument-identity-refresh",
                )

        async def publish_runtime_removed(alias: str) -> None:
            if getattr(app.state, "kiwoom_default_account", None) is None:
                _publish_default(app, None)
                current_routines = getattr(app.state, "routines_runtime", None)
                if current_routines is not None:
                    await current_routines.rebind_ws_client(None)

        account_registry = RuntimeAccountRegistry(
            app,
            runtime_settings,
            ws_connect=ws_connect,
            on_ready=publish_runtime_ready,
            on_removed=publish_runtime_removed,
        )
        runtimes = account_registry.runtimes
        app.state.kiwoom_accounts = runtimes
        app.state.runtime_account_registry = account_registry
        app.state.kiwoom_default_account = runtime_settings.kiwoom_default_account
        # Injection point for brain.py's reset-and-restart route: None means "send this
        # process a real SIGTERM" (production default, see brain.py's _default_shutdown_hook).
        # Tests overwrite this attribute directly on the TestClient's app instance so the
        # test process never actually gets killed.
        app.state.brain_shutdown_hook = None
        # WP-F(G-F1/G-F2) — 군집 라벨링 전용 LLM 클라이언트. 추출과 같은 설정을
        # 공유한다("추출 켜짐 = 라벨링도 켜짐"). custom argv가 Claude opt-in보다
        # 우선하고, 둘 다 없을 때만 None으로 두어 라벨링이 자동 휴면한다.
        # 추출용 client(_open_brain 지역변수)와 별개
        # 인스턴스인 이유: StructuredLlmClient.complete()는 호출별 타임아웃 인자를
        # 받지 않아, 라벨링의 20초 상한은 생성 시점에만 고정할 수 있다.
        if runtime_settings.brain_extraction_llm_argv:
            app.state.brain_cluster_labeling_llm_client = LocalCommandStructuredLlm(
                tuple(runtime_settings.brain_extraction_llm_argv), timeout_seconds=20
            )
        elif runtime_settings.brain_use_claude_cli_extraction:
            app.state.brain_cluster_labeling_llm_client = ClaudeCliStructuredLlm(
                timeout_seconds=20
            )
        else:
            app.state.brain_cluster_labeling_llm_client = None
        # F4의 fire-and-forget 백그라운드 라벨링 태스크 참조 보관(in-flight 맵) —
        # 참조 없는 태스크는 GC 회수 대상이라는 asyncio 문서 경고 대응(아래
        # brain.hourly_task 저장 관례와 동일 원칙). 동시 스폰 상한 검사도 이
        # 맵의 크기로 한다. 키는 (프롬프트 지문, 멤버 집합 해시)라 동일 요청을 합친다.
        app.state.cluster_labeling_tasks = {}
        # exposeToModel 게이트(WP-I, G-I5) — 기동 초기값은 안전측 False다. 프런트
        # 기본값(True)과 어긋나 보이지만, Electron이 브레인 준비 폴링 자리에서
        # 저장된 값을 재동기화(push)하므로(history-sink.js) 정상 경로에서는 곧
        # 실제 설정값으로 수렴한다 — 동기화가 안 온 동안 닫혀 있는 쪽이 옳다.
        app.state.expose_to_model = False
        _publish_default(app, None)
        _publish_brain(app, None)
        _publish_routines(app, None)
        _publish_backtest(app, None)
        # 캔버스 사이드 채널(api/canvas_push.py) — 자격증명·루틴과 무관한 로컬
        # 배관이라 무조건 만든다. 소비자는 단일 앱 인스턴스(routine_events와 동형).
        app.state.canvas_events = asyncio.Queue(50)
        # 말걸기 가드 설정(F4) — routines_enabled와 무관한 전역 설정이라
        # 캔버스 사이드 채널과 같은 이유로 무조건 연다. 외부 자격증명·WS
        # 의존이 없어 teardown도 필요 없다(파일 기반, 프로세스 종료로 충분).
        app.state.nudge_guard_store = GuardSettingsStore(runtime_settings.nudge_guard_path)
        app.state.nudge_guard_store.load()
        brain: BrainRuntime | None = None
        routines: RoutinesRuntime | None = None
        backtest: BacktestRuntime | None = None
        try:
            if runtime_settings.has_credentials:
                for account in runtime_settings.kiwoom_accounts:
                    await account_registry.add_configured(account)
                default_runtime = runtimes.get(runtime_settings.kiwoom_default_account or "")
                _publish_default(app, default_runtime)
                if default_runtime is not None and default_runtime.ready:
                    # 식별 인덱스 구성(ka10099 3개 시장 → 별칭 정규식 3,500여 개 컴파일)은
                    # CPU로 30초 안팎이 걸린다(2026-09-07 실측: 앱 부팅과 겹치면 60초 이상).
                    # 기동 앞에 두면 앱 launcher의 60초 준비 한도를 넘겨 부팅이 degraded로
                    # 끝나므로 뒤에서 돌린다 — 끝나기 전에는 빈 스냅숏이라 셀렉터가
                    # fail-closed로 동작한다(refresh 실패 때와 같은 상태). 참조는 teardown이
                    # 취소할 수 있게 app.state에 둔다(brain.hourly_task와 같은 관례).
                    app.state.instrument_identity_task = asyncio.create_task(
                        _refresh_instrument_identity(
                            instrument_identity, default_runtime.data_client
                        ),
                        name="athena-instrument-identity-refresh",
                    )
            if runtime_settings.brain_enabled:
                # 준비된 계좌의 data_client만 넘긴다 — 토큰 발급에 실패한 계좌로
                # 생산하면 매 주기 인증 오류만 쌓인다. 하나도 없으면 생산자 없이 선다.
                brain = await _open_brain(
                    runtime_settings,
                    kiwoom_clients=_ReadyAccountClients(runtimes),
                )
                _publish_brain(app, brain)
            # 백테스트를 루틴보다 먼저 연다 — 코드 감시 알람이 백테스트의 일봉
            # 캐시를 빌려 쓴다(정리 순서는 아래 phases 표가 따로 정한다).
            if runtime_settings.backtest_enabled:
                backtest = await _open_backtest(runtime_settings)
                _publish_backtest(app, backtest)
            if runtime_settings.routines_enabled:
                default_rt = runtimes.get(
                    runtime_settings.kiwoom_default_account or ""
                ) or next(iter(runtimes.values()), None)
                routines = await open_routines(
                    runtime_settings,
                    ws_client=default_rt.ws_client if default_rt is not None else None,
                    candle_store=app.state.backtest_store,
                    # Runtime accounts can be registered or selected after startup.
                    # The watch adapters keep this proxy and resolve the current default
                    # on every call, including when startup had no account at all.
                    kiwoom_client=_CurrentDefaultClient(app),
                    # 러너는 부를 때 app.state를 읽는다 — 백테스트는 위에서 이미 열렸다.
                    run_deployments_once=(
                        deploy_runner.make_runner(app)
                        if runtime_settings.backtest_enabled
                        else None
                    ),
                )
                _publish_routines(app, routines)
        except BaseException as primary_error:
            await _cleanup_lifespan_resources(
                app,
                account_registry,
                brain,
                routines,
                backtest,
                primary_error=primary_error,
            )
        try:
            yield
        except BaseException as primary_error:
            await _cleanup_lifespan_resources(
                app,
                account_registry,
                brain,
                routines,
                backtest,
                primary_error=primary_error,
            )
        else:
            await _cleanup_lifespan_resources(
                app, account_registry, brain, routines, backtest
            )

    return lifespan


async def _teardown(app: FastAPI, account_registry: RuntimeAccountRegistry) -> None:
    """Account cleanup seam retained for lifecycle failure-isolation tests."""
    await account_registry.close()
    _publish_default(app, None)
    app.state.kiwoom_accounts = {}
