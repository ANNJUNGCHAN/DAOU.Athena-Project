"""Application resource lifecycle."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass

import httpx
from fastapi import FastAPI

from athena_api.accounts import AccountRuntime
from athena_api.brain import (
    DedupService,
    DeterministicHoldingProjector,
    DeterministicTradeProjector,
    ExtractionService,
    GraphProjector,
    GraphStore,
    HistoryStore,
    IngestionCoordinator,
    JobTrigger,
    LocalCommandStructuredLlm,
)
from athena_api.brain.db import SqliteOwner
from athena_api.config import KiwoomAccount, Settings, get_settings
from athena_api.dependencies import build_selector_service
from athena_api.errors import KiwoomAuthError
from athena_api.kiwoom import (
    KiwoomAuth,
    KiwoomClient,
    KiwoomWsClient,
    KiwoomWsError,
    RateLimiter,
    TokenManager,
)
from athena_api.process_lock import BrainProcessLock, CredentialProcessLock
from athena_api.routines.guard_settings import GuardSettingsStore
from athena_api.routines.runtime import (
    RoutinesRuntime,
    open_routines,
    teardown_routines,
)
from athena_api.selector.instrument_identity import InstrumentIdentityIndex

logger = logging.getLogger(__name__)


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


async def _hourly_ingest_loop(coordinator: IngestionCoordinator, interval_seconds: float) -> None:
    """Self-enqueue JobTrigger.HOURLY on a fixed period (ADR §9 gate G005).

    Manual runs still use the pre-existing enqueue(JobTrigger.MANUAL) path unaffected by
    this. Cancellation must propagate: _teardown_brain cancels and awaits this task
    before stopping the coordinator, so CancelledError here is the ordinary shutdown
    path, not a failure to swallow.
    """
    while True:
        await asyncio.sleep(interval_seconds)
        await coordinator.enqueue(JobTrigger.HOURLY)


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
    settings: Settings, *, hourly_interval_seconds: float | None = None
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
    체결·잔고는 아직 앱 안에 생산자가 없다 — 키움 체결 피드를 잇는 것은 별도 작업이고,
    그때까지는 `HistoryStore.upsert_completed_trade`/`upsert_holding`을 부르는 곳이
    테스트뿐이다.

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
            # 체결은 LLM을 타지 않는다. 추출이 꺼져 있어도(설정에 argv가 없어도) 결정적
            # 티어는 항상 돌아야 한다 — 체결은 사실이고, 사실을 적재하는 데 모델 설정이
            # 필요할 이유가 없다.
            coordinator = IngestionCoordinator(
                history,
                store,
                source_projector=source_projector,
                deterministic_projector=DeterministicTradeProjector(store),
                holding_projector=DeterministicHoldingProjector(store),
                # 새 소스가 들어온 직후가 중복이 생기는 시점이다. 잡이 실제로 뭔가를
                # 투영했을 때만 돌고, 실패해도 잡을 실패시키지 않는다(보정이지 적재가 아님).
                dedup=DedupService(store),
            )
            await coordinator.start()
        except Exception as exc:
            brain.ingestion_last_error = str(exc)
            await history.close()
        else:
            brain.coordinator = coordinator
            brain.ingestion_ready = True
            brain.extraction_enabled = source_projector is not None
            interval_seconds = (
                hourly_interval_seconds
                if hourly_interval_seconds is not None
                else settings.brain_ingest_interval_minutes * 60
            )
            brain.hourly_task = asyncio.create_task(
                _hourly_ingest_loop(coordinator, interval_seconds),
                name="athena-brain-hourly-ingest",
            )
        return brain
    except BaseException:
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


async def _teardown_brain(app: FastAPI, brain: BrainRuntime | None) -> None:
    if brain is not None:
        # The hourly self-enqueue timer must stop before IngestionCoordinator.stop()
        # begins rejecting new enqueue() calls (ADR §4.2 step 3) -- otherwise a tick that
        # fires mid-teardown races enqueue()'s own shutdown check. Symmetric with how the
        # timer is only started once the coordinator itself is up in _open_brain.
        if brain.hourly_task is not None:
            brain.hourly_task.cancel()
            with suppress(asyncio.CancelledError):
                await brain.hourly_task
        # ADR §4.2 step 3: reject new enqueue -> drain/checkpoint -> writer cancel and
        # await -> DB close -> lock release. IngestionCoordinator.stop() implements the
        # first three; it must finish before the stores it writes through are closed.
        if brain.coordinator is not None:
            await brain.coordinator.stop()
        await brain.history.close()
        await brain.store.close()
        # 공유 연결은 빌려 쓰는 저장소가 닫지 않는다. 소유자만 닫을 수 있다.
        if brain.owner is not None:
            await brain.owner.close()
        brain.lock.release()
    _publish_brain(app, None)


def _build_runtime(
    account: KiwoomAccount,
    settings: Settings,
    http_client: httpx.AsyncClient,
) -> AccountRuntime:
    rate_limiter = RateLimiter(rate_per_second=5.0)
    auth = KiwoomAuth(
        account.app_key.get_secret_value(),
        account.secret_key.get_secret_value(),
        client=http_client,
    )
    return AccountRuntime(
        alias=account.alias,
        auth=auth,
        token_manager=TokenManager(auth),
        rate_limiter=rate_limiter,
        order_scopes=account.order_scopes,
        data_client=KiwoomClient(
            auth,
            rate_limiter,
            client=http_client,
            timeout_seconds=settings.request_timeout_seconds,
            max_rate_limit_retries=settings.max_rate_limit_retries,
        ),
        order_client=KiwoomClient(
            auth,
            rate_limiter,
            client=http_client,
            timeout_seconds=settings.request_timeout_seconds,
            max_rate_limit_retries=0,
        ),
    )


def build_lifespan(settings: Settings | None = None, *, ws_connect=None):
    runtime_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        instrument_identity = InstrumentIdentityIndex()
        app.state.instrument_identity = instrument_identity
        app.state.selector_service = build_selector_service(instrument_identity)
        app.state.settings = runtime_settings
        app.state.local_bearer_token = (
            runtime_settings.local_bearer_token.get_secret_value()
            if runtime_settings.local_bearer_token is not None
            else None
        )
        runtimes: dict[str, AccountRuntime] = {}
        app.state.kiwoom_accounts = runtimes
        app.state.kiwoom_default_account = runtime_settings.kiwoom_default_account
        # Injection point for brain.py's reset-and-restart route: None means "send this
        # process a real SIGTERM" (production default, see brain.py's _default_shutdown_hook).
        # Tests overwrite this attribute directly on the TestClient's app instance so the
        # test process never actually gets killed.
        app.state.brain_shutdown_hook = None
        _publish_default(app, None)
        _publish_brain(app, None)
        _publish_routines(app, None)
        # 캔버스 사이드 채널(api/canvas_push.py) — 자격증명·루틴과 무관한 로컬
        # 배관이라 무조건 만든다. 소비자는 단일 앱 인스턴스(routine_events와 동형).
        app.state.canvas_events = asyncio.Queue(50)
        # 말걸기 가드 설정(F4) — routines_enabled와 무관한 전역 설정이라
        # 캔버스 사이드 채널과 같은 이유로 무조건 연다. 외부 자격증명·WS
        # 의존이 없어 teardown도 필요 없다(파일 기반, 프로세스 종료로 충분).
        app.state.nudge_guard_store = GuardSettingsStore(runtime_settings.nudge_guard_path)
        app.state.nudge_guard_store.load()
        http_client: httpx.AsyncClient | None = None
        locks: list[CredentialProcessLock] = []
        brain: BrainRuntime | None = None
        routines: RoutinesRuntime | None = None
        try:
            if runtime_settings.has_credentials:
                http_client = httpx.AsyncClient()
                for account in runtime_settings.kiwoom_accounts:
                    lock = CredentialProcessLock.for_credentials(
                        account.credential_fingerprint, label=account.alias
                    )
                    lock.acquire()
                    locks.append(lock)
                    runtime = _build_runtime(account, runtime_settings, http_client)
                    runtimes[account.alias] = runtime
                    try:
                        await runtime.token_manager.issue()
                    except KiwoomAuthError:
                        continue
                    runtime.ready = True
                    # Bind auth per iteration; a bare closure over the loop variable would
                    # hand every account the last account's token.
                    ws_client = KiwoomWsClient(
                        lambda bound=runtime.auth: bound.access_token,
                        runtime.rate_limiter,
                        connect=ws_connect,
                        ensure_token=runtime.auth.ensure_token,
                    )
                    try:
                        await ws_client.start()
                    except KiwoomWsError:
                        await ws_client.close()
                    else:
                        runtime.ws_client = ws_client
                default_runtime = runtimes.get(runtime_settings.kiwoom_default_account or "")
                _publish_default(app, default_runtime)
                if default_runtime is not None and default_runtime.ready:
                    try:
                        await instrument_identity.refresh(default_runtime.data_client)
                    except Exception as exc:
                        # Identity availability may never weaken startup or leak upstream
                        # contents. The empty prior snapshot makes selector planning fail
                        # closed until a future complete refresh succeeds.
                        logger.warning(
                            "instrument identity refresh failed type=%s",
                            type(exc).__name__,
                        )
            if runtime_settings.brain_enabled:
                brain = await _open_brain(runtime_settings)
                _publish_brain(app, brain)
            if runtime_settings.routines_enabled:
                default_rt = runtimes.get(
                    runtime_settings.kiwoom_default_account or ""
                ) or next(iter(runtimes.values()), None)
                routines = await open_routines(
                    runtime_settings,
                    ws_client=default_rt.ws_client if default_rt is not None else None,
                    headroom=(
                        default_rt.rate_limiter.headroom
                        if default_rt is not None
                        else None
                    ),
                )
                _publish_routines(app, routines)
        except BaseException:
            await _teardown(app, runtimes, http_client, locks)
            await _teardown_brain(app, brain)
            await teardown_routines(routines)
            raise
        try:
            yield
        finally:
            await _teardown(app, runtimes, http_client, locks)
            await _teardown_brain(app, brain)
            await teardown_routines(routines)
            _publish_routines(app, None)

    return lifespan


async def _teardown(
    app: FastAPI,
    runtimes: dict[str, AccountRuntime],
    http_client: httpx.AsyncClient | None,
    locks: list[CredentialProcessLock],
) -> None:
    for runtime in runtimes.values():
        if runtime.ws_client is not None:
            await runtime.ws_client.close()
            runtime.ws_client = None
        runtime.auth.clear()
        runtime.ready = False
    runtimes.clear()
    _publish_default(app, None)
    app.state.kiwoom_accounts = {}
    if http_client is not None and not http_client.is_closed:
        await http_client.aclose()
    for lock in locks:
        lock.release()
    locks.clear()
