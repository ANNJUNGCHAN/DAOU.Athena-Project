"""FastAPI application factory."""

import asyncio
from collections import OrderedDict

from fastapi import FastAPI, HTTPException

from athena_api.api import router as api_router
from athena_api.config import Settings, get_settings
from athena_api.errors import install_exception_handlers
from athena_api.lifespan import build_lifespan


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or get_settings()
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

    app.include_router(api_router)
    return app


app = create_app()
