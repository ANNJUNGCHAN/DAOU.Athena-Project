"""Domain errors for selector adapters to translate at their transport boundary."""

from __future__ import annotations

from typing import Any


class SelectorError(RuntimeError):
    code = "SELECTOR_ERROR"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = details or {}


class OperationNotFoundError(SelectorError):
    code = "OPERATION_NOT_FOUND"


class NoConfidentMatchError(SelectorError):
    code = "NO_CONFIDENT_MATCH"


class AmbiguousOperationError(SelectorError):
    code = "AMBIGUOUS_OPERATION"


class PreferredOperationError(SelectorError):
    code = "PREFERRED_REF_NOT_SUPPORTED_BY_QUERY"


class UnsupportedOperationError(SelectorError):
    code = "OPERATION_NOT_GENERIC_CALLABLE"


class InvalidArgumentsError(SelectorError):
    code = "INVALID_ARGUMENTS"


class InvalidPlanError(SelectorError):
    code = "INVALID_PLAN"


class ExpiredPlanError(InvalidPlanError):
    code = "EXPIRED_PLAN"


class StalePlanError(InvalidPlanError):
    code = "STALE_PLAN"
