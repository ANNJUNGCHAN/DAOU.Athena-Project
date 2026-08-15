"""Family-first base/detail selection policy."""

from __future__ import annotations

from collections import defaultdict

from .catalog import OperationCatalog, OperationDocument
from .errors import AmbiguousOperationError, NoConfidentMatchError
from .normalization import normalize_text
from .ranking import RankedDocument
from .schemas import ReasonCode, ResponseMode

_FULL_TERMS = ("전체", "전부", "모든", "원문", "raw", "full", "complete", "전체 응답")


def _candidate_details(
    catalog: OperationCatalog, tr_id: str, ranked: tuple[RankedDocument, ...]
) -> list[RankedDocument]:
    scores = {item.document.operation_ref: item for item in ranked}
    return sorted(
        (
            scores[document.operation_ref]
            for document in catalog.documents
            if document.tr_id == tr_id
            and document.group_id is not None
            and document.operation_ref in scores
        ),
        key=lambda item: (-item.semantic_score, item.document.operation_ref),
    )


def select_operation(
    catalog: OperationCatalog,
    question: str,
    ranked: tuple[RankedDocument, ...],
    response_mode: ResponseMode,
) -> tuple[OperationDocument, list[ReasonCode]]:
    if not ranked:
        raise NoConfidentMatchError("No operation matches the question")

    exact_ref = catalog.find_exact(question.strip())
    if exact_ref is not None:
        if not exact_ref.generic_callable:
            return exact_ref, [ReasonCode.DISCOVERY_ONLY]
        return exact_ref, [ReasonCode.EXACT_OPERATION_REF]

    by_family: dict[str, list[RankedDocument]] = defaultdict(list)
    for item in ranked:
        by_family[item.document.family_ref].append(item)
    families = sorted(
        ((max(item.score for item in items), family, items) for family, items in by_family.items()),
        key=lambda item: (-item[0], item[1]),
    )
    top_score, family_ref, family_items = families[0]
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
    if response_mode is ResponseMode.FULL or any(
        term in normalized_question for term in _FULL_TERMS
    ):
        return base, [ReasonCode.EXPLICIT_FULL_RESPONSE]
    if base.shape == "pure_list":
        return base, [ReasonCode.PURE_LIST_BASE_REQUIRED]

    details = _candidate_details(catalog, tr_id, tuple(family_items))
    meaningful = [item for item in details if item.semantic_score >= 180]
    second_score = details[1].semantic_score if len(details) > 1 else 0
    if (
        len(meaningful) == 1
        and meaningful[0].semantic_score - second_score >= 80
        and second_score < 100
    ):
        return meaningful[0].document, [ReasonCode.SINGLE_GROUP_PREFERRED]
    if len(meaningful) >= 2 or (
        len(details) >= 2 and details[0].semantic_score - details[1].semantic_score < 80
    ):
        return base, [ReasonCode.MULTI_GROUP_BASE_REQUIRED]
    return base, []
