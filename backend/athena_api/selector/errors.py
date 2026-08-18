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


class UnknownDetailGroupError(SelectorError):
    """An explicit ``detail_group`` does not belong to the selected TR family."""

    code = "UNKNOWN_DETAIL_GROUP"


class DetailGroupRequiredError(SelectorError):
    """The family was replaced by its projections, so a ``detail_group`` is mandatory.

    Distinct from UnknownDetailGroupError: the caller named no group at all, and the
    response carries every group it may choose from.
    """

    code = "DETAIL_GROUP_REQUIRED"


class InvalidArgumentsError(SelectorError):
    code = "INVALID_ARGUMENTS"


class InvalidPlanError(SelectorError):
    code = "INVALID_PLAN"


class ExpiredPlanError(InvalidPlanError):
    code = "EXPIRED_PLAN"


class StalePlanError(InvalidPlanError):
    code = "STALE_PLAN"


class PlanAlreadyUsedError(InvalidPlanError):
    """The plan's nonce was already spent by a prior ``call``.

    A signature-valid, unexpired token can still be unusable: a plan is single-use by
    policy (2026-08-18), not just by cryptographic validity, so a replay of the same
    token — even one that never reached upstream because the first attempt failed —
    is rejected here rather than dispatched a second time.
    """

    code = "PLAN_ALREADY_USED"
