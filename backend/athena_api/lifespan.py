"""Application resource lifecycle."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import httpx
from fastapi import FastAPI

from athena_api.accounts import AccountRuntime
from athena_api.brain import GraphStore, HistoryStore, IngestionCoordinator
from athena_api.config import KiwoomAccount, Settings, get_settings
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
    app.state.kiwoom_ws_last_error = runtime.ws_last_error if runtime else None


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


async def _open_brain(settings: Settings) -> BrainRuntime:
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
    """
    lock = BrainProcessLock.for_db_path(settings.brain_db_path, label=str(settings.brain_db_path))
    lock.acquire()
    store = GraphStore(settings.brain_db_path)
    history = HistoryStore(settings.brain_history_db_path)
    brain = BrainRuntime(store=store, lock=lock, history=history)
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
        coordinator = IngestionCoordinator(history, store)
        await coordinator.start()
    except Exception as exc:
        brain.ingestion_last_error = str(exc)
        await history.close()
    else:
        brain.coordinator = coordinator
        brain.ingestion_ready = True
    return brain


async def _teardown_brain(app: FastAPI, brain: BrainRuntime | None) -> None:
    if brain is not None:
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
            max_pages=settings.max_pages,
        ),
        order_client=KiwoomClient(
            auth,
            rate_limiter,
            client=http_client,
            timeout_seconds=settings.request_timeout_seconds,
            max_rate_limit_retries=0,
            max_pages=settings.max_pages,
        ),
    )


def build_lifespan(settings: Settings | None = None, *, ws_connect=None):
    runtime_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = runtime_settings
        app.state.local_bearer_token = (
            runtime_settings.local_bearer_token.get_secret_value()
            if runtime_settings.local_bearer_token is not None
            else None
        )
        runtimes: dict[str, AccountRuntime] = {}
        app.state.kiwoom_accounts = runtimes
        app.state.kiwoom_default_account = runtime_settings.kiwoom_default_account
        _publish_default(app, None)
        _publish_brain(app, None)
        http_client: httpx.AsyncClient | None = None
        locks: list[CredentialProcessLock] = []
        brain: BrainRuntime | None = None
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
                        runtime.ws_last_error = ws_client.last_error
                        await ws_client.close()
                    else:
                        runtime.ws_client = ws_client
                _publish_default(app, runtimes.get(runtime_settings.kiwoom_default_account or ""))
            if runtime_settings.brain_enabled:
                brain = await _open_brain(runtime_settings)
                _publish_brain(app, brain)
        except BaseException:
            await _teardown(app, runtimes, http_client, locks)
            await _teardown_brain(app, brain)
            raise
        try:
            yield
        finally:
            await _teardown(app, runtimes, http_client, locks)
            await _teardown_brain(app, brain)

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
