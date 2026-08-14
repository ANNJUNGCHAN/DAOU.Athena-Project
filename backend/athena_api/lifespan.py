"""Application resource lifecycle."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from athena_api.config import Settings, get_settings
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


def build_lifespan(settings: Settings | None = None, *, ws_connect=None):
    runtime_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.kiwoom_ready = False
        app.state.settings = runtime_settings
        app.state.local_bearer_token = (
            runtime_settings.local_bearer_token.get_secret_value()
            if runtime_settings.local_bearer_token is not None
            else None
        )
        app.state.kiwoom_client = None
        app.state.kiwoom_order_client = None
        app.state.kiwoom_auth = None
        app.state.kiwoom_ws_client = None
        app.state.token_manager = None
        app.state.kiwoom_rate_limiter = RateLimiter(rate_per_second=5.0)
        app.state.kiwoom_order_rate_limiter = app.state.kiwoom_rate_limiter
        app.state.kiwoom_ws_last_error = None
        http_client: httpx.AsyncClient | None = None
        auth: KiwoomAuth | None = None
        ws_client: KiwoomWsClient | None = None
        process_lock: CredentialProcessLock | None = None
        if runtime_settings.has_credentials:
            process_lock = CredentialProcessLock()
            process_lock.acquire()
            http_client = httpx.AsyncClient()
            auth = KiwoomAuth(
                runtime_settings.kiwoom_app_key.get_secret_value(),
                runtime_settings.kiwoom_secret_key.get_secret_value(),
                client=http_client,
            )
            manager = TokenManager(auth)
            client = KiwoomClient(
                auth,
                app.state.kiwoom_rate_limiter,
                client=http_client,
                timeout_seconds=runtime_settings.request_timeout_seconds,
                max_rate_limit_retries=runtime_settings.max_rate_limit_retries,
                max_pages=runtime_settings.max_pages,
            )
            order_client = KiwoomClient(
                auth,
                app.state.kiwoom_order_rate_limiter,
                client=http_client,
                timeout_seconds=runtime_settings.request_timeout_seconds,
                max_rate_limit_retries=0,
                max_pages=runtime_settings.max_pages,
            )
            app.state.kiwoom_client = client
            app.state.kiwoom_order_client = order_client
            app.state.kiwoom_auth = auth
            app.state.token_manager = manager
            try:
                await manager.issue()
            except KiwoomAuthError:
                pass
            else:
                app.state.kiwoom_ready = True
                ws_client = KiwoomWsClient(
                    lambda: auth.access_token,
                    app.state.kiwoom_rate_limiter,
                    connect=ws_connect,
                    ensure_token=auth.ensure_token,
                )
                try:
                    await ws_client.start()
                except KiwoomWsError:
                    app.state.kiwoom_ws_last_error = ws_client.last_error
                    await ws_client.close()
                    ws_client = None
                else:
                    app.state.kiwoom_ws_client = ws_client
        try:
            yield
        finally:
            app.state.kiwoom_ready = False
            app.state.kiwoom_client = None
            app.state.kiwoom_order_client = None
            app.state.kiwoom_auth = None
            app.state.kiwoom_ws_client = None
            app.state.token_manager = None
            if ws_client is not None:
                await ws_client.close()
            if auth is not None:
                auth.clear()
            if http_client is not None and not http_client.is_closed:
                await http_client.aclose()
            if process_lock is not None:
                process_lock.release()

    return lifespan
