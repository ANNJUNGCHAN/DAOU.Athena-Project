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
    ExtractionService,
    GraphStore,
    HistoryStore,
    IngestionCoordinator,
    JobTrigger,
    LocalCommandStructuredLlm,
)
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
    ready: bool = False
    last_error: str | None = None
    fts_ready: bool = False
    fts_last_error: str | None = None
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
    app.state.brain_ready = brain is not None and brain.ready
    app.state.brain_last_error = brain.last_error if brain is not None else None
    app.state.brain_fts_ready = brain is not None and brain.fts_ready
    app.state.brain_fts_last_error = brain.fts_last_error if brain is not None else None
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
    left to raise and abort startup (see the caller). A missing native runtime (e.g. no
    ATHENA_LADYBUG_DLL_DIR configured on this machine) is an environment/packaging gap,
    not a correctness hazard: the brain is optional and independent of Kiwoom, so that
    failure is recorded on the runtime instead of aborting startup.

    ADR §4.2 step 1 also puts "writer queue/scheduler 시작" after schema/fts and before
    readiness is published. The writer queue is IngestionCoordinator (ingestion.py); it is
    started here the same best-effort way fts is — a failure to open the raw-history store
    or start the coordinator degrades ingestion_ready without failing graph read/write,
    which does not depend on ingestion. There is no source adapter wired into the app yet
    (nothing calls HistoryStore.upsert_chat/upsert_completed_trade outside tests), so this
    only satisfies the lifecycle contract (start -> reject-new-enqueue -> drain -> cancel,
    symmetric with the app lifespan); it does not yet move real chat/trade data.

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
    store = GraphStore(settings.brain_db_path)
    history = HistoryStore(settings.brain_history_db_path)
    brain = BrainRuntime(store=store, lock=lock, history=history)
    coordinator: IngestionCoordinator | None = None
    try:
        try:
            settings.brain_db_path.parent.mkdir(parents=True, exist_ok=True)
            await store.open()
        except Exception as exc:
            brain.last_error = str(exc)
            lock.release()
            return brain
        brain.ready = True
        try:
            await store.load_fts_extension()
        except Exception as exc:
            brain.fts_last_error = str(exc)
        else:
            brain.fts_ready = True
        try:
            await history.open()
            source_projector = None
            if settings.brain_extraction_llm_argv:
                client = LocalCommandStructuredLlm(tuple(settings.brain_extraction_llm_argv))
                source_projector = ExtractionService(client, store)
            coordinator = IngestionCoordinator(history, store, source_projector=source_projector)
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
