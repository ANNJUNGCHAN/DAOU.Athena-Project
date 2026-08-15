from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pytest

from athena_api.selector.catalog import OperationCatalog, build_operation_catalog
from athena_api.selector.errors import (
    AmbiguousOperationError,
    InvalidArgumentsError,
    NoConfidentMatchError,
    OperationNotFoundError,
    UnsupportedOperationError,
)
from athena_api.selector.normalization import normalize_text
from athena_api.selector.plans import PlanSigner
from athena_api.selector.ranking import rank_documents
from athena_api.selector.schemas import (
    DescribeRequest,
    DiscoveryIntent,
    ResolveRequest,
    ResponseMode,
    SearchRequest,
)
from athena_api.selector.service import SelectorService

BACKEND = Path(__file__).resolve().parents[2]
GOLDEN_PATH = BACKEND / "tests" / "fixtures" / "api_selector_golden.jsonl"
EXPECTED_SLICES = {
    "detail": 22,
    "base": 22,
    "missing_args": 8,
    "safety": 8,
    "forbidden": 4,
    "ambiguity": 4,
    "adversarial": 4,
}


def _load_golden() -> tuple[dict[str, Any], ...]:
    return tuple(
        json.loads(line)
        for line in GOLDEN_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )


GOLDEN = _load_golden()
RESOLVE_CASES = tuple(case for case in GOLDEN if case["disposition"] == "resolve")
MISSING_ARGUMENT_CASES = tuple(
    case for case in GOLDEN if case["disposition"] == "missing_args"
)
SAFETY_CASES = tuple(case for case in GOLDEN if case["slice"] == "safety")
REJECTION_CASES = tuple(
    case
    for case in GOLDEN
    if case["slice"] in {"forbidden", "ambiguity", "adversarial"}
)


@pytest.fixture(scope="module")
def catalog() -> OperationCatalog:
    return build_operation_catalog()


@pytest.fixture(scope="module")
def service(catalog: OperationCatalog) -> SelectorService:
    return SelectorService(catalog, PlanSigner(b"selector-evaluation-secret"))


def test_golden_corpus_has_exactly_72_reviewable_cases() -> None:
    assert len(GOLDEN) == 72
    assert Counter(case["slice"] for case in GOLDEN) == EXPECTED_SLICES
    assert len({case["id"] for case in GOLDEN}) == len(GOLDEN)
    assert {case["language"] for case in GOLDEN} == {"ko", "en", "mixed"}


def test_golden_corpus_retains_selection_and_safety_expectations() -> None:
    required_keys = {
        "id",
        "slice",
        "language",
        "question",
        "intent",
        "accepted_refs",
        "preferred_ref",
        "detail_group",
        "disposition",
        "arguments",
        "response_mode",
        "missing_args",
        "safety",
        "reasons",
    }
    assert all(set(case) == required_keys for case in GOLDEN)


def _family_of(operation_ref: str) -> str:
    """Map any canonical identity onto its base TR family."""
    parts = operation_ref.split(":")
    return f"base:{parts[1]}"


def test_golden_retrieval_meets_release_thresholds(service: SelectorService) -> None:
    """Retrieval is scored at family granularity, because that is what it decides.

    Search ranks one document per TR family; a projection is chosen afterwards
    through an explicit ``detail_group``, never by out-ranking its siblings.
    """
    evaluated = [case for case in GOLDEN if case["accepted_refs"]]
    per_slice: dict[str, list[bool]] = defaultdict(list)
    recall_at_five: list[bool] = []
    accepted_top_one: list[bool] = []

    for case in evaluated:
        result = service.search(
            SearchRequest(
                query=case["question"],
                intent=DiscoveryIntent(case["intent"]),
                limit=5,
            )
        )
        refs = [_family_of(hit.operation_ref) for hit in result.results]
        accepted = {_family_of(ref) for ref in case["accepted_refs"]}
        recall_at_five.append(bool(accepted.intersection(refs)))
        top_one = bool(refs and refs[0] in accepted)
        accepted_top_one.append(top_one)
        per_slice[case["slice"]].append(top_one)

    detail_and_base = [
        result
        for case, result in zip(evaluated, accepted_top_one, strict=True)
        if case["slice"] in {"detail", "base"}
    ]
    assert sum(recall_at_five) / len(recall_at_five) >= 0.98
    assert sum(accepted_top_one) / len(accepted_top_one) >= 0.95
    assert sum(detail_and_base) / len(detail_and_base) >= 0.97
    assert all(sum(results) / len(results) >= 0.90 for results in per_slice.values())


@pytest.mark.parametrize("case", RESOLVE_CASES, ids=lambda case: case["id"])
def test_resolve_selects_the_gold_base_or_detail(
    service: SelectorService, case: dict[str, Any]
) -> None:
    result = service.resolve(
        ResolveRequest(
            question=case["question"],
            preferred_ref=case["preferred_ref"],
            detail_group=case["detail_group"],
            arguments=case["arguments"],
            response_mode=ResponseMode(case["response_mode"]),
        )
    )
    assert result.operation_ref in case["accepted_refs"]
    assert {reason.value for reason in result.selection_reasons}.intersection(case["reasons"])


@pytest.mark.parametrize("case", MISSING_ARGUMENT_CASES, ids=lambda case: case["id"])
def test_resolve_reports_every_expected_missing_argument(
    service: SelectorService, case: dict[str, Any]
) -> None:
    with pytest.raises(InvalidArgumentsError) as caught:
        service.resolve(
            ResolveRequest(
                question=case["question"],
                arguments=case["arguments"],
            )
        )
    missing = {
        str(error["loc"][0])
        for error in caught.value.details["errors"]
        if error["type"] == "missing"
    }
    assert missing == set(case["missing_args"])


@pytest.mark.parametrize("case", SAFETY_CASES, ids=lambda case: case["id"])
def test_orders_and_websockets_are_discovery_only(
    service: SelectorService, case: dict[str, Any]
) -> None:
    result = service.search(
        SearchRequest(
            query=case["question"],
            intent=DiscoveryIntent(case["intent"]),
            limit=5,
        )
    )
    assert result.results[0].operation_ref in case["accepted_refs"]
    assert result.results[0].discovery_only is True
    assert result.results[0].generic_callable is False
    with pytest.raises(UnsupportedOperationError):
        service.resolve(ResolveRequest(question=case["accepted_refs"][0]))


@pytest.mark.parametrize("case", REJECTION_CASES, ids=lambda case: case["id"])
def test_forbidden_ambiguous_and_adversarial_questions_issue_no_plan(
    service: SelectorService, case: dict[str, Any]
) -> None:
    with pytest.raises(
        (
            AmbiguousOperationError,
            NoConfidentMatchError,
            OperationNotFoundError,
            UnsupportedOperationError,
        )
    ):
        service.resolve(
            ResolveRequest(question=case["question"], arguments=case["arguments"])
        )


def test_catalog_contains_323_unique_refs_and_208_base_refs(
    catalog: OperationCatalog,
) -> None:
    refs = [document.operation_ref for document in catalog.documents]
    base_refs = [ref for ref in refs if ref.startswith("base:")]
    assert len(refs) == len(set(refs)) == 323
    assert len(base_refs) == 208


def test_all_non_oauth_base_refs_are_exactly_addressable(
    catalog: OperationCatalog,
) -> None:
    bases = [document for document in catalog.documents if document.group_id is None]
    addressed = [catalog.find_exact(document.operation_ref) for document in bases]
    assert sum(document is not None for document in addressed) == 206
    assert {
        document.operation_ref
        for document, found in zip(bases, addressed, strict=True)
        if found is None
    } == {"base:au10001", "base:au10002"}


def test_search_surface_is_one_document_per_family_and_excludes_projections(
    catalog: OperationCatalog,
) -> None:
    surface = catalog.visible_for(DiscoveryIntent.QUERY)
    assert len(surface) == 171
    assert all(document.group_id is None for document in surface)
    assert len({document.tr_id for document in surface}) == len(surface)


def test_every_detail_group_is_addressable_from_its_base_description(
    service: SelectorService, catalog: OperationCatalog
) -> None:
    """Projections are reached by naming them, not by out-ranking siblings.

    ``describe(base)`` must advertise every projection of that family, each
    group id must be unique inside the family, and each advertised id must
    resolve back to exactly one catalog document.
    """
    details = [document for document in catalog.documents if document.group_id is not None]
    advertised: set[str] = set()
    for tr_id in sorted({document.tr_id for document in details}):
        description = service.describe(
            DescribeRequest(operation_ref=f"base:{tr_id}", intent=DiscoveryIntent.QUERY)
        )
        group_ids = [group.group_id for group in description.detail_groups]
        assert group_ids, f"base:{tr_id} advertises no detail groups"
        assert len(group_ids) == len(set(group_ids))
        for group in description.detail_groups:
            document = catalog.find_exact(group.operation_ref)
            assert document is not None
            assert document.tr_id == tr_id
            assert document.group_id == group.group_id
            assert group.response_field_count == len(document.response_model.model_fields)
            advertised.add(group.operation_ref)
    assert len(details) == 115
    assert advertised == {document.operation_ref for document in details}


@pytest.mark.parametrize("language", ["ko", "en"])
def test_every_detail_title_is_unique_within_its_family(
    catalog: OperationCatalog, language: str
) -> None:
    """Sibling titles must at least be distinguishable to a human reader.

    They are no longer ranked against each other, so a collision across
    families is harmless; a collision *inside* one family would make the
    describe listing ambiguous for the model choosing a group.
    """
    by_family: dict[str, list[str | None]] = defaultdict(list)
    details = [document for document in catalog.documents if document.group_id is not None]
    for document in details:
        title = document.group_title_ko if language == "ko" else document.group_title_en
        by_family[document.tr_id].append(normalize_text(title) if title else None)
    collisions = {
        tr_id: titles for tr_id, titles in by_family.items() if len(titles) != len(set(titles))
    }
    assert len(details) == 115
    assert not collisions


def test_ranking_is_deterministic_for_all_golden_questions(
    catalog: OperationCatalog,
) -> None:
    for case in GOLDEN:
        documents = catalog.visible_for(DiscoveryIntent(case["intent"]))
        forward = rank_documents(case["question"], documents)
        reverse = rank_documents(case["question"], tuple(reversed(documents)))
        assert [
            (item.document.operation_ref, item.score) for item in forward
        ] == [(item.document.operation_ref, item.score) for item in reverse]


def test_oauth_and_all_129_us_only_ids_are_excluded(
    catalog: OperationCatalog,
) -> None:
    source_profile = json.loads(
        (BACKEND / "ref" / "kiwoom-io-source-profile.json").read_text(encoding="utf-8")
    )
    us_only = set(source_profile["official_github_audit"]["us_only_operation_ids"])
    catalog_tr_ids = {document.tr_id for document in catalog.documents}
    assert len(us_only) == 129
    assert not us_only.intersection(catalog_tr_ids)
    assert catalog.find_exact("base:au10001") is None
    assert catalog.find_exact("base:au10002") is None


def test_websocket_0G_and_0g_remain_distinct_identities(
    service: SelectorService,
) -> None:
    upper = service.describe(
        DescribeRequest(operation_ref="base:0G", intent=DiscoveryIntent.WEBSOCKET)
    )
    lower = service.describe(
        DescribeRequest(operation_ref="base:0g", intent=DiscoveryIntent.WEBSOCKET)
    )
    assert upper.operation_ref == "base:0G"
    assert lower.operation_ref == "base:0g"
    assert upper.name != lower.name
    with pytest.raises(OperationNotFoundError):
        service.describe(
            DescribeRequest(operation_ref="base:0Ｇ", intent=DiscoveryIntent.WEBSOCKET)
        )
    assert normalize_text("0G") == normalize_text("0g")
