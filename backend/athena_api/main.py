"""FastAPI application factory."""

import asyncio
from collections import OrderedDict
from typing import Any

from fastapi import FastAPI, HTTPException

from athena_api.accounts import account_runtimes, default_account_alias
from athena_api.api import router as api_router
from athena_api.config import Settings, get_settings
from athena_api.errors import install_exception_handlers
from athena_api.lifespan import build_lifespan
from athena_api.logging_config import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
    # Before anything else can log: this installs the only stdout handler and the
    # credential-redacting filter, so no startup line can predate the redaction.
    configure_logging(runtime_settings)
    app = FastAPI(
        title=runtime_settings.app_name,
        version=runtime_settings.app_version,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=build_lifespan(runtime_settings),
    )
    app.state.order_idempotency_lock = asyncio.Lock()
    app.state.order_idempotency_cache = OrderedDict()
    app.state.settings = runtime_settings
    app.state.local_bearer_token = (
        runtime_settings.local_bearer_token.get_secret_value()
        if runtime_settings.local_bearer_token is not None
        else None
    )
    install_exception_handlers(app)

    @app.get("/health", tags=["Service"], summary="Liveness")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready", tags=["Service"], summary="Kiwoom data readiness")
    async def ready() -> dict[str, str]:
        client = getattr(app.state, "kiwoom_client", None)
        if client is None or not client.is_ready:
            raise HTTPException(status_code=503, detail="Kiwoom data service is not ready")
        return {"status": "ready"}

    @app.get(
        "/ready/accounts",
        tags=["Service"],
        summary="Per-account Kiwoom readiness",
        openapi_extra={"x-athena-llm-exposed": False},
    )
    async def ready_accounts() -> dict[str, Any]:
        """Report each account separately so a 1-of-N auth failure is visible.

        Always 200: /ready already answers the process-level question, and collapsing N
        accounts into one boolean is what hides the degraded one.
        """
        runtimes = account_runtimes(app)
        return {
            "default": default_account_alias(app),
            "accounts": {
                alias: {
                    "ready": runtime.ready,
                    "websocket": runtime.ws_client is not None and runtime.ws_client.is_ready,
                    "order_scopes": (
                        None
                        if runtime.order_scopes is None
                        else sorted(scope.value for scope in runtime.order_scopes)
                    ),
                }
                for alias, runtime in runtimes.items()
            },
        }

    app.include_router(api_router)
    return app


app = create_app()
