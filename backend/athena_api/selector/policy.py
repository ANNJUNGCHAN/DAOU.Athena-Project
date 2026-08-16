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

from athena_api.generated.registry import SPLIT_BASE_TR_IDS

from .catalog import OperationCatalog, OperationDocument
from .errors import (
    AmbiguousOperationError,
    DetailGroupRequiredError,
    NoConfidentMatchError,
    UnknownDetailGroupError,
)
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


def _detail_group_required(catalog: OperationCatalog, tr_id: str) -> DetailGroupRequiredError:
    return DetailGroupRequiredError(
        "Operation family is served through its detail projections",
        details={
            "operation_ref": f"base:{tr_id}",
            "available_groups": [item.group_id for item in catalog.details_for(tr_id)],
        },
    )


def select_operation(
    catalog: OperationCatalog,
    question: str,
    ranked: tuple[RankedDocument, ...],
    response_mode: ResponseMode,
    detail_group: str | None = None,
) -> tuple[OperationDocument, list[ReasonCode]]:
    exact_ref = catalog.find_exact(question.strip())
    if exact_ref is not None:
        # A named projection resolves before the callable gate: a split family is itself
        # not callable, yet naming one of its groups is exactly the supported path.
        if (
            detail_group is not None
            and exact_ref.group_id is None
            and catalog.details_for(exact_ref.tr_id)
        ):
            return (
                _resolve_detail(catalog, exact_ref.tr_id, detail_group),
                [ReasonCode.EXPLICIT_DETAIL_GROUP],
            )
        if not exact_ref.generic_callable:
            if exact_ref.tr_id in SPLIT_BASE_TR_IDS and exact_ref.group_id is None:
                raise _detail_group_required(catalog, exact_ref.tr_id)
            return exact_ref, [ReasonCode.DISCOVERY_ONLY]
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
    top_score, family_ref, top_items = families[0]
    exact_tr = question.strip() == family_ref.removeprefix("base:")
    if not exact_tr:
        if top_score < 240:
            raise NoConfidentMatchError("No operation reached the confidence threshold")
        if len(families) > 1:
            # A total-score margin measures how similarly two families are *supported*, and
            # on a tight surface most of that support is shared boilerplate: the four
            # 조건검색 TRs draw the same points from the same domain and the same field
            # descriptions, so the only zone that separates them - the name - moves the
            # total by a few percent and the question gets refused as ambiguous.
            #
            # So the margin decides only whether the totals are distinguishable. When they
            # are not, the name breaks the tie, because a name is a claim about identity and
            # every other zone is corroboration. "조건검색 ... 해지해줘" puts ka10174
            # 조건검색 실시간 해제 second by total and first by name; answering ka10173 or
            # refusing outright are both worse than answering the one that was named.
            # It stays ambiguous when the tie-break is itself tied.
            second_score = families[1][0]
            if top_score - second_score < 80 or top_score / second_score < 1.15:
                # The totals are indistinguishable, so the name breaks the tie - but only
                # inside the leader's own subcategory, which is the scope where the
                # "mostly shared boilerplate" premise holds. Siblings there draw the same
                # points from the same domain and the same field descriptions, so the name
                # is the only zone separating them and a decisive win on it reads as a few
                # percent of the total.
                #
                # Across subcategories two operations have genuinely different
                # vocabularies, and comparing their names is not a tie-break but a second,
                # worse ranking - "stream the expected opening match price" would hand 0H
                # 주식예상체결's lead to ka10173 조건검색 요청 실시간 purely because
                # "stream" expands to 실시간 and that TR happens to be named 실시간. When
                # the tie is across clusters, or the tie-break is itself tied, the question
                # really is ambiguous and the candidates go back to the caller.
                cluster = catalog.by_ref[family_ref].subcategory
                contenders = [
                    entry
                    for entry in families
                    if top_score - entry[0] < 80 or top_score / entry[0] < 1.15
                ]
                best_title = max(
                    max(item.title_score for item in items) for _, _, items in contenders
                )
                named_best = [
                    entry
                    for entry in contenders
                    if max(item.title_score for item in entry[2]) == best_title
                ]
                same_cluster = all(
                    catalog.by_ref[family].subcategory == cluster
                    for _, family, _ in contenders
                )
                if not (same_cluster and len(named_best) == 1):
                    raise AmbiguousOperationError(
                        "Several operation families match the question",
                        details={
                            "candidates": [family for _, family, _ in families[:3]],
                            "reason": ReasonCode.AMBIGUOUS_MARGIN.value,
                        },
                    )
                top_score, family_ref, top_items = named_best[0]

    tr_id = family_ref.removeprefix("base:")
    base = catalog.by_ref[family_ref]
    normalized_question = normalize_text(question)

    # An explicit full-response request outranks a projection: the caller asked
    # for everything, so narrowing would drop fields they named.
    if (
        response_mode is ResponseMode.FULL
        or any(term in normalized_question for term in _FULL_TERMS)
    ) and tr_id not in SPLIT_BASE_TR_IDS:
        return base, [ReasonCode.EXPLICIT_FULL_RESPONSE]
    if detail_group is not None:
        return (
            _resolve_detail(catalog, tr_id, detail_group),
            [ReasonCode.EXPLICIT_DETAIL_GROUP],
        )
    if base.shape == "pure_list":
        return base, [ReasonCode.PURE_LIST_BASE_REQUIRED]
    # A split family has no response of its own left to serve, not even for an explicit
    # full-response request: the projections are the operation now.
    if tr_id in SPLIT_BASE_TR_IDS:
        raise _detail_group_required(catalog, tr_id)
    return base, [ReasonCode.BASE_DEFAULT]
