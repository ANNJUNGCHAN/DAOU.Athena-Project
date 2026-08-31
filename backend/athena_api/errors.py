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


class UnknownAccountError(KiwoomError):
    """The caller named a Kiwoom account alias that is not configured."""


class OrderScopeError(KiwoomError):
    """The addressed account is not permitted to place this family of order."""


class BrainError(RuntimeError):
    """Base error safe to translate at the investment-brain HTTP boundary."""


class BrainNotReadyError(BrainError):
    """The investment-brain runtime (history store or graph projection) is not ready."""


class KiwoomApiError(KiwoomError):
    def __init__(self, code: str, message: str, http_status: int) -> None:
        super().__init__(f"Kiwoom request failed with code {code}")
        self.code = code
        self.message = message
        self.http_status = http_status


def install_exception_handlers(app: FastAPI) -> None:
    from athena_api.kiwoom.ws_client import KiwoomWsError
    from athena_api.selector.errors import (
        AmbiguousOperationError,
        DetailGroupRequiredError,
        ExpiredPlanError,
        InvalidArgumentsError,
        InvalidPlanError,
        NoConfidentMatchError,
        OperationNotFoundError,
        PlanAlreadyUsedError,
        PreferredOperationError,
        ReplayStateCapacityError,
        SelectorError,
        StalePlanError,
        UnknownDetailGroupError,
        UnsupportedOperationError,
    )

    selector_statuses: tuple[tuple[type[SelectorError], int], ...] = (
        (OperationNotFoundError, 404),
        (ExpiredPlanError, 410),
        (StalePlanError, 409),
        (PlanAlreadyUsedError, 409),
        (ReplayStateCapacityError, 503),
        (InvalidPlanError, 400),
        (InvalidArgumentsError, 422),
        (UnsupportedOperationError, 403),
        (UnknownDetailGroupError, 422),
        (DetailGroupRequiredError, 422),
        (PreferredOperationError, 409),
        (AmbiguousOperationError, 409),
        (NoConfidentMatchError, 404),
    )

    @app.exception_handler(SelectorError)
    async def selector_handler(_request: Request, exc: SelectorError) -> JSONResponse:
        status_code = next(
            (
                mapped_status
                for error_type, mapped_status in selector_statuses
                if isinstance(exc, error_type)
            ),
            400,
        )
        return JSONResponse(
            status_code=status_code,
            content={
                "detail": "Selector request failed",
                "code": exc.code,
                "message": str(exc),
                "details": exc.details,
            },
        )

    @app.exception_handler(UnknownAccountError)
    async def unknown_account_handler(_request: Request, exc: UnknownAccountError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"detail": "Kiwoom account is not configured", "message": str(exc)},
        )

    @app.exception_handler(OrderScopeError)
    async def order_scope_handler(_request: Request, exc: OrderScopeError) -> JSONResponse:
        return JSONResponse(
            status_code=403,
            content={"detail": "Account is not permitted to place this order", "message": str(exc)},
        )

    @app.exception_handler(KiwoomNotReadyError)
    async def not_ready_handler(_request: Request, _exc: KiwoomNotReadyError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Kiwoom data service is not ready"})

    @app.exception_handler(KiwoomAuthError)
    async def auth_handler(_request: Request, _exc: KiwoomAuthError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Kiwoom authentication failed"})

    @app.exception_handler(KiwoomApiError)
    async def api_handler(_request: Request, exc: KiwoomApiError) -> JSONResponse:
        status_code = 429 if exc.http_status == 429 else 502
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

    from athena_api.routines.rules import RoutineValidationError
    from athena_api.routines.store import RoutineTransitionError

    @app.exception_handler(RoutineValidationError)
    async def routine_validation_handler(
        _request: Request, exc: RoutineValidationError
    ) -> JSONResponse:
        # 메시지는 rules.py가 만든 도메인 문장뿐 — upstream 원문이 흐르지 않는다.
        return JSONResponse(
            status_code=422,
            content={"detail": "루틴 조건이 유효하지 않다", "message": str(exc)},
        )

    @app.exception_handler(RoutineTransitionError)
    async def routine_transition_handler(
        _request: Request, exc: RoutineTransitionError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={"detail": "루틴 상태 전이가 허용되지 않는다", "message": str(exc)},
        )

    @app.exception_handler(BrainNotReadyError)
    async def brain_not_ready_handler(_request: Request, _exc: BrainNotReadyError) -> JSONResponse:
        return JSONResponse(status_code=503, content={"detail": "Investment brain is not ready"})

    from athena_api.routines.guard_settings import GuardSettingsError

    @app.exception_handler(GuardSettingsError)
    async def guard_settings_handler(
        _request: Request, exc: GuardSettingsError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"detail": "가드 설정이 유효하지 않다", "message": str(exc)},
        )
