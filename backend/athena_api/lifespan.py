"""Application resource lifecycle."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from athena_api.accounts import AccountRuntime
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
from athena_api.process_lock import CredentialProcessLock


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
        http_client: httpx.AsyncClient | None = None
        locks: list[CredentialProcessLock] = []
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
        except BaseException:
            await _teardown(app, runtimes, http_client, locks)
            raise
        try:
            yield
        finally:
            await _teardown(app, runtimes, http_client, locks)

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
