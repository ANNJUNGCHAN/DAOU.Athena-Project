"""Legacy selector facade backed only by shared typed compatibility authority."""

from __future__ import annotations

from athena_api.generated.registry import SPLIT_BASE_TR_IDS

from .catalog import OperationCatalog, OperationDocument
from .compatibility import CompatibilityDecisionStatus, decide_selector_compatibility
from .errors import (
    AmbiguousOperationError,
    DetailGroupRequiredError,
    NoConfidentMatchError,
    UnknownDetailGroupError,
)
from .ranking import RankedDocument
from .schemas import DiscoveryIntent, ReasonCode, ResponseMode


def _resolve_detail(
    catalog: OperationCatalog, tr_id: str, detail_group: str
) -> OperationDocument:
    document = catalog.find_exact(f"detail:{tr_id}:{detail_group}")
    if document is None:
        raise UnknownDetailGroupError(
            "Detail group does not belong to the selected operation family",
            details={
                "operation_ref": f"base:{tr_id}",
                "detail_group": detail_group,
                "available_groups": [
                    item.group_id for item in catalog.details_for(tr_id)
                ],
            },
        )
    return document


def _detail_group_required(
    catalog: OperationCatalog, tr_id: str
) -> DetailGroupRequiredError:
    return DetailGroupRequiredError(
        "Operation family is served through its detail projections",
        details={
            "operation_ref": f"base:{tr_id}",
            "available_groups": [item.group_id for item in catalog.details_for(tr_id)],
        },
    )


def _exact_selection(
    catalog: OperationCatalog,
    question: str,
    response_mode: ResponseMode,
    detail_group: str | None,
) -> tuple[OperationDocument, list[ReasonCode]] | None:
    exact = catalog.find_exact(question.strip())
    if exact is None:
        return None
    if detail_group is not None:
        if exact.group_id is not None:
            if detail_group != exact.group_id:
                raise UnknownDetailGroupError(
                    "Detail group conflicts with the exact detail operation",
                    details={
                        "operation_ref": exact.operation_ref,
                        "detail_group": detail_group,
                        "available_groups": [
                            item.group_id for item in catalog.details_for(exact.tr_id)
                        ],
                    },
                )
            return exact, [ReasonCode.EXACT_OPERATION_REF]
        if catalog.details_for(exact.tr_id):
            return (
                _resolve_detail(catalog, exact.tr_id, detail_group),
                [ReasonCode.EXPLICIT_DETAIL_GROUP],
            )
    if exact.tr_id in SPLIT_BASE_TR_IDS and exact.group_id is None:
        raise _detail_group_required(catalog, exact.tr_id)
    if not exact.generic_callable:
        return exact, [ReasonCode.DISCOVERY_ONLY]
    if response_mode is ResponseMode.FULL:
        return exact, [ReasonCode.EXPLICIT_FULL_RESPONSE]
    return exact, [ReasonCode.EXACT_OPERATION_REF]


def select_operation(
    catalog: OperationCatalog,
    question: str,
    ranked: tuple[RankedDocument, ...],
    response_mode: ResponseMode,
    detail_group: str | None = None,
) -> tuple[OperationDocument, list[ReasonCode]]:
    """Compatibility wrapper; ranking is display-only and never authorizes selection."""
    exact = _exact_selection(catalog, question, response_mode, detail_group)
    if exact is not None:
        return exact

    from .primitive_evidence import analyze_question

    execution = analyze_question(question).execution
    intent = (
        DiscoveryIntent.ORDER
        if execution is not None and execution.value == "order"
        else DiscoveryIntent.WEBSOCKET
        if execution is not None and execution.value == "websocket"
        else DiscoveryIntent.QUERY
    )

    decision = decide_selector_compatibility(catalog, question, intent)
    if decision.status is CompatibilityDecisionStatus.AMBIGUOUS:
        raise AmbiguousOperationError(
            "Several operation families match the question",
            details={
                "candidates": list(decision.compatible_operation_refs),
                "reason": ReasonCode.AMBIGUOUS_MARGIN.value,
            },
        )
    if decision.status is CompatibilityDecisionStatus.DETAIL_GROUP_REQUIRED:
        family_ref = decision.selected_family_ref
        if family_ref is None:
            raise NoConfidentMatchError("No compatible operation profile")
        tr_id = family_ref.removeprefix("base:")
        if detail_group is not None:
            return (
                _resolve_detail(catalog, tr_id, detail_group),
                [ReasonCode.EXPLICIT_DETAIL_GROUP],
            )
        raise _detail_group_required(catalog, tr_id)
    if decision.status is not CompatibilityDecisionStatus.SELECTED:
        raise NoConfidentMatchError(
            "No compatible operation profile",
            details={"reason_codes": list(decision.reason_codes)},
        )

    selected_ref = decision.selected_operation_ref
    if selected_ref is None:
        raise NoConfidentMatchError("No compatible operation profile")
    selected = catalog.by_ref[selected_ref]
    if detail_group is not None:
        if selected.group_id is not None:
            if detail_group != selected.group_id:
                raise UnknownDetailGroupError(
                    "Detail group conflicts with the typed compatible operation",
                    details={
                        "operation_ref": selected.operation_ref,
                        "detail_group": detail_group,
                        "available_groups": [
                            item.group_id
                            for item in catalog.details_for(selected.tr_id)
                        ],
                    },
                )
            return selected, [ReasonCode.TYPED_DETAIL_MATCH]
        return (
            _resolve_detail(catalog, selected.tr_id, detail_group),
            [ReasonCode.EXPLICIT_DETAIL_GROUP],
        )
    if response_mode is ResponseMode.FULL:
        if selected.tr_id in SPLIT_BASE_TR_IDS:
            raise _detail_group_required(catalog, selected.tr_id)
        return catalog.by_ref[selected.family_ref], [ReasonCode.EXPLICIT_FULL_RESPONSE]
    if selected.group_id is not None:
        return selected, [ReasonCode.TYPED_DETAIL_MATCH]
    if selected.shape == "pure_list":
        return selected, [ReasonCode.PURE_LIST_BASE_REQUIRED]
    return selected, [ReasonCode.BASE_DEFAULT]
