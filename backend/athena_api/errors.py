"""Secret-safe domain errors and FastAPI exception handlers."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class KiwoomError(RuntimeError):
    """Base error safe to translate at the HTTP boundary."""


class KiwoomNotReadyError(KiwoomError):
    """Credentials or an in-memory access token are unavailable."""


class KiwoomAuthError(KiwoomError):
    """Kiwoom token issuance failed without retaining credential material."""


class KiwoomApiError(KiwoomError):
    def __init__(self, code: str, message: str, http_status: int) -> None:
        super().__init__(f"Kiwoom request failed with code {code}")
        self.code = code
        self.message = message
        self.http_status = http_status


def install_exception_handlers(app: FastAPI) -> None:
    from athena_api.kiwoom.ws_client import KiwoomWsError

    @app.exception_handler(KiwoomNotReadyError)
    async def not_ready_handler(_request: Request, _exc: KiwoomNotReadyError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Kiwoom data service is not ready"})

    @app.exception_handler(KiwoomAuthError)
    async def auth_handler(_request: Request, _exc: KiwoomAuthError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Kiwoom authentication failed"})

    @app.exception_handler(KiwoomApiError)
    async def api_handler(_request: Request, exc: KiwoomApiError) -> JSONResponse:
        status_code = 429 if exc.http_status == 429 or exc.code in {"5", "1700"} else 502
        content: dict[str, Any] = {
            "detail": "Kiwoom upstream request failed",
            "code": exc.code,
        }
        return JSONResponse(status_code=status_code, content=content)

    @app.exception_handler(KiwoomWsError)
    async def ws_handler(_request: Request, _exc: KiwoomWsError) -> JSONResponse:
        return JSONResponse(
            status_code=502,
            content={"detail": "Kiwoom WebSocket upstream request failed"},
        )
