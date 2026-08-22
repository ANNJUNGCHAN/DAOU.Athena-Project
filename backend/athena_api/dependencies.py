"""FastAPI dependencies for Kiwoom data routes and the local LLM selector."""

import secrets
from typing import Annotated, Any

from fastapi import Depends, Request
from starlette.requests import HTTPConnection

from athena_api.accounts import (
    ACCOUNT_HEADER,
    ACCOUNT_QUERY_PARAM,
    AccountRuntime,
    account_runtimes,
    default_account_alias,
)
from athena_api.errors import KiwoomNotReadyError, UnknownAccountError
from athena_api.kiwoom import KiwoomClient, KiwoomWsClient, TokenManager
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog
from athena_api.selector.instrument_identity import InstrumentIdentityIndex

# Plans are intentionally process-local and short-lived. Deploy the selector with one
# worker unless a shared signing secret is supplied by a future secret-manager adapter.
_selector_catalog = build_operation_catalog()
_selector_signing_secret = secrets.token_bytes(32)


def build_selector_service(
    instrument_identity: InstrumentIdentityIndex | None = None,
) -> SelectorService:
    """Build one process-local selector around an app-owned identity snapshot."""
    return SelectorService(
        _selector_catalog,
        PlanSigner(_selector_signing_secret, ttl_seconds=120),
        instrument_identity=instrument_identity,
    )


_selector_service = build_selector_service()


def get_selector_service(request: Request) -> SelectorService:
    """Return the app-local selector, with a credential-free fallback for test apps."""
    return getattr(request.app.state, "selector_service", _selector_service)


SelectorServiceDep = Annotated[SelectorService, Depends(get_selector_service)]


def _requested_alias(request: Any) -> str | None:
    """Read the caller's account choice, tolerating connection-less call sites."""
    headers = getattr(request, "headers", None)
    if headers is not None:
        header_value = headers.get(ACCOUNT_HEADER)
        if header_value and header_value.strip():
            return header_value.strip()
    # Browsers cannot set custom headers on a native WebSocket handshake, so the two
    # websocket routes need a query-string channel as well.
    query_params = getattr(request, "query_params", None)
    if query_params is not None:
        query_value = query_params.get(ACCOUNT_QUERY_PARAM)
        if query_value and query_value.strip():
            return query_value.strip()
    return None


def resolve_account_alias(request: HTTPConnection) -> str:
    """Resolve which configured Kiwoom account this request addresses.

    Returns the empty alias when no account pool is configured. Credential-free routes
    (catalog, search, describe) stay usable, and routes that need a client still fail
    closed through their own client dependency.
    """
    requested = _requested_alias(request)
    if requested is not None:
        if requested not in account_runtimes(request.app):
            raise UnknownAccountError(f"account '{requested}' is not configured")
        return requested
    return default_account_alias(request.app) or ""


AccountAliasDep = Annotated[str, Depends(resolve_account_alias)]


def get_account_runtime(request: Any) -> AccountRuntime | None:
    """Return the addressed account's stack, or None when no pool is configured.

    Returning None lets every dependency below fall back to the flat app.state attributes,
    which is what keeps credential-less apps and hand-built test doubles working.
    """
    pool = account_runtimes(request.app)
    if not pool:
        return None
    requested = _requested_alias(request)
    if requested is None:
        alias = default_account_alias(request.app)
        return pool.get(alias) if alias is not None else None
    if requested not in pool:
        raise UnknownAccountError(f"account '{requested}' is not configured")
    return pool[requested]


def get_kiwoom_client(request: Request) -> KiwoomClient | None:
    runtime = get_account_runtime(request)
    if runtime is not None:
        return runtime.data_client
    return getattr(request.app.state, "kiwoom_client", None)


def require_kiwoom_client(request: Request) -> KiwoomClient:
    client = get_kiwoom_client(request)
    if client is None or not client.is_ready:
        raise KiwoomNotReadyError("Kiwoom data service is not ready")
    return client


KiwoomClientDep = Annotated[KiwoomClient, Depends(require_kiwoom_client)]


def get_order_kiwoom_client(request: Request) -> KiwoomClient | None:
    settings = getattr(request.app.state, "settings", None)
    if settings is None or not settings.enable_order_api or settings.local_bearer_token is None:
        return None
    runtime = get_account_runtime(request)
    client = (
        runtime.order_client
        if runtime is not None
        else getattr(request.app.state, "kiwoom_order_client", None)
    )
    if client is None or not client.is_ready:
        return None
    return client


def require_order_kiwoom_client(request: Request) -> KiwoomClient:
    client = get_order_kiwoom_client(request)
    if client is None:
        raise KiwoomNotReadyError("Kiwoom order service is not ready")
    return client


OrderKiwoomClientDep = Annotated[KiwoomClient, Depends(require_order_kiwoom_client)]


def get_token_manager(request: Request) -> TokenManager | None:
    runtime = get_account_runtime(request)
    if runtime is not None:
        return runtime.token_manager
    return getattr(request.app.state, "token_manager", None)


def require_token_manager(request: Request) -> TokenManager:
    manager = get_token_manager(request)
    if manager is None:
        raise KiwoomNotReadyError("Kiwoom credentials are not configured")
    return manager


TokenManagerDep = Annotated[TokenManager, Depends(require_token_manager)]


def get_kiwoom_ws_client(request: HTTPConnection) -> KiwoomWsClient | None:
    runtime = get_account_runtime(request)
    if runtime is not None:
        return runtime.ws_client
    return getattr(request.app.state, "kiwoom_ws_client", None)


def require_kiwoom_ws_client(request: HTTPConnection) -> KiwoomWsClient:
    client = get_kiwoom_ws_client(request)
    if client is None or not client.is_ready:
        raise KiwoomNotReadyError("Kiwoom WebSocket service is not ready")
    return client


KiwoomWsClientDep = Annotated[KiwoomWsClient, Depends(require_kiwoom_ws_client)]
