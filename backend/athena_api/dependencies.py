"""FastAPI dependencies for Kiwoom data routes and the local LLM selector."""

import secrets
from typing import Annotated

from fastapi import Depends, Request
from starlette.requests import HTTPConnection

from athena_api.errors import KiwoomNotReadyError
from athena_api.kiwoom import KiwoomClient, KiwoomWsClient, TokenManager
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog

# Plans are intentionally process-local and short-lived. Deploy the selector with one
# worker unless a shared signing secret is supplied by a future secret-manager adapter.
_selector_service = SelectorService(
    build_operation_catalog(),
    PlanSigner(secrets.token_bytes(32), ttl_seconds=120),
)


def get_selector_service() -> SelectorService:
    """Return the immutable process-local selector service."""
    return _selector_service


SelectorServiceDep = Annotated[SelectorService, Depends(get_selector_service)]


def get_kiwoom_client(request: Request) -> KiwoomClient | None:
    return getattr(request.app.state, "kiwoom_client", None)


def require_kiwoom_client(request: Request) -> KiwoomClient:
    client = get_kiwoom_client(request)
    if client is None or not client.is_ready:
        raise KiwoomNotReadyError("Kiwoom data service is not ready")
    return client


KiwoomClientDep = Annotated[KiwoomClient, Depends(require_kiwoom_client)]


def require_order_kiwoom_client(request: Request) -> KiwoomClient:
    settings = getattr(request.app.state, "settings", None)
    client = getattr(request.app.state, "kiwoom_order_client", None)
    if (
        settings is None
        or not settings.enable_order_api
        or settings.local_bearer_token is None
        or client is None
        or not client.is_ready
    ):
        raise KiwoomNotReadyError("Kiwoom order service is not ready")
    return client


OrderKiwoomClientDep = Annotated[KiwoomClient, Depends(require_order_kiwoom_client)]


def get_token_manager(request: Request) -> TokenManager | None:
    return getattr(request.app.state, "token_manager", None)


def require_token_manager(request: Request) -> TokenManager:
    manager = get_token_manager(request)
    if manager is None:
        raise KiwoomNotReadyError("Kiwoom credentials are not configured")
    return manager


TokenManagerDep = Annotated[TokenManager, Depends(require_token_manager)]


def get_kiwoom_ws_client(request: HTTPConnection) -> KiwoomWsClient | None:
    return getattr(request.app.state, "kiwoom_ws_client", None)


def require_kiwoom_ws_client(request: HTTPConnection) -> KiwoomWsClient:
    client = get_kiwoom_ws_client(request)
    if client is None or not client.is_ready:
        raise KiwoomNotReadyError("Kiwoom WebSocket service is not ready")
    return client


KiwoomWsClientDep = Annotated[KiwoomWsClient, Depends(require_kiwoom_ws_client)]
