"""Family selection policy.

The selector chooses a **TR family** from the question. It never guesses which
projection of that family the user wanted.

A detail projection is not a cheaper call: ``generated/runtime.call_typed_tr``
issues the same single upstream request as the base operation and then filters
the response by the projection's field aliases. So base is always a correct,
complete answer - a projection only narrows it. Because sibling projections of
one TR share that TR's entire vocabulary, ranking them against each other is
unreliable by construction. The model therefore names the projection explicitly
through ``ResolveRequest.detail_group``, and the server validates that the group
belongs to the selected family.
"""

from __future__ import annotations

from collections import defaultdict

from .catalog import OperationCatalog, OperationDocument
from .errors import AmbiguousOperationError, NoConfidentMatchError, UnknownDetailGroupError
from .normalization import normalize_text
from .ranking import RankedDocument
from .schemas import ReasonCode, ResponseMode

_FULL_TERMS = ("전체", "전부", "모든", "원문", "raw", "full", "complete", "전체 응답")


def _resolve_detail(
    catalog: OperationCatalog, tr_id: str, detail_group: str
) -> OperationDocument:
    document = catalog.find_exact(f"detail:{tr_id}:{detail_group}")
    if document is None:
        available = [item.group_id for item in catalog.details_for(tr_id)]
        raise UnknownDetailGroupError(
            "Detail group does not belong to the selected operation family",
            details={
                "operation_ref": f"base:{tr_id}",
                "detail_group": detail_group,
                "available_groups": available,
            },
        )
    return document


def select_operation(
    catalog: OperationCatalog,
    question: str,
    ranked: tuple[RankedDocument, ...],
    response_mode: ResponseMode,
    detail_group: str | None = None,
) -> tuple[OperationDocument, list[ReasonCode]]:
    exact_ref = catalog.find_exact(question.strip())
    if exact_ref is not None:
        if not exact_ref.generic_callable:
            return exact_ref, [ReasonCode.DISCOVERY_ONLY]
        if detail_group is not None and exact_ref.group_id is None:
            return (
                _resolve_detail(catalog, exact_ref.tr_id, detail_group),
                [ReasonCode.EXPLICIT_DETAIL_GROUP],
            )
        return exact_ref, [ReasonCode.EXACT_OPERATION_REF]

    if not ranked:
        raise NoConfidentMatchError("No operation matches the question")

    by_family: dict[str, list[RankedDocument]] = defaultdict(list)
    for item in ranked:
        by_family[item.document.family_ref].append(item)
    families = sorted(
        ((max(item.score for item in items), family, items) for family, items in by_family.items()),
        key=lambda item: (-item[0], item[1]),
    )
    top_score, family_ref, _ = families[0]
    exact_tr = question.strip() == family_ref.removeprefix("base:")
    if not exact_tr:
        if top_score < 240:
            raise NoConfidentMatchError("No operation reached the confidence threshold")
        if len(families) > 1:
            second_score = families[1][0]
            if top_score - second_score < 80 or top_score / second_score < 1.15:
                raise AmbiguousOperationError(
                    "Several operation families match the question",
                    details={
                        "candidates": [family for _, family, _ in families[:3]],
                        "reason": ReasonCode.AMBIGUOUS_MARGIN.value,
                    },
                )

    tr_id = family_ref.removeprefix("base:")
    base = catalog.by_ref[family_ref]
    normalized_question = normalize_text(question)

    # An explicit full-response request outranks a projection: the caller asked
    # for everything, so narrowing would drop fields they named.
    if response_mode is ResponseMode.FULL or any(
        term in normalized_question for term in _FULL_TERMS
    ):
        return base, [ReasonCode.EXPLICIT_FULL_RESPONSE]
    if detail_group is not None:
        return (
            _resolve_detail(catalog, tr_id, detail_group),
            [ReasonCode.EXPLICIT_DETAIL_GROUP],
        )
    if base.shape == "pure_list":
        return base, [ReasonCode.PURE_LIST_BASE_REQUIRED]
    return base, [ReasonCode.BASE_DEFAULT]
