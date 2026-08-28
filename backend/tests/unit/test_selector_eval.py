from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pytest

from athena_api.generated.registry import SPLIT_BASE_TR_IDS
from athena_api.selector.catalog import OperationCatalog, build_operation_catalog
from athena_api.selector.errors import (
    AmbiguousOperationError,
    InvalidArgumentsError,
    NoConfidentMatchError,
    OperationNotFoundError,
    UnsupportedOperationError,
)
from athena_api.selector.instrument_identity import InstrumentIdentityIndex
from athena_api.selector.normalization import normalize_text
from athena_api.selector.plans import PlanSigner
from athena_api.selector.ranking import rank_documents
from athena_api.selector.schemas import (
    DescribeRequest,
    DiscoveryIntent,
    ReasonCode,
    ResolveRequest,
    ResponseMode,
    SearchRequest,
)
from athena_api.selector.service import SelectorService

BACKEND = Path(__file__).resolve().parents[2]
GOLDEN_PATH = BACKEND / "tests" / "fixtures" / "api_selector_golden.jsonl"
EXPECTED_SLICES = {
    "detail": 22,
    "detail_required": 22,
    "missing_args": 8,
    "safety": 8,
    "forbidden": 4,
    "ambiguity": 4,
    "adversarial": 4,
    "realtime": 12,
}


def _load_golden() -> tuple[dict[str, Any], ...]:
    return tuple(
        json.loads(line)
        for line in GOLDEN_PATH.read_text(encoding="utf-8").splitlines()
        if line.strip()
    )


GOLDEN = _load_golden()
RESOLVE_CASES = tuple(case for case in GOLDEN if case["disposition"] == "resolve")

# These reviewed legacy cases predate the final authority boundaries.  Keeping the
# classification by corpus id makes the migration auditable without rewriting the
# frozen fixture answers.
EMBEDDED_ID_CASE_IDS = frozenset(
    {
        "detail-ka10001-ko",
        "detail-ka10002-en",
        "detail-ka10007-en",
        "detail-ka10040-mixed",
    }
)
TARGETLESS_DETAIL_CASE_IDS = frozenset(
    {
        "detail-ka10004-ko",
        "detail-ka10087-ko",
        "detail-ka30012-en",
        "detail-kt00001-ko",
        "detail-kt00004-en",
        "detail-kt00010-en",
        "detail-kt00011-ko",
        "detail-kt00012-en",
        "detail-kt00016-en",
        "detail-kt00017-ko",
        "detail-kt00018-en",
    }
)
SEMANTIC_AMBIGUITY_CASE_IDS = frozenset({"detail-kt00005-mixed"})
FAIL_CLOSED_RESOLVE_CASE_IDS = (
    EMBEDDED_ID_CASE_IDS | TARGETLESS_DETAIL_CASE_IDS | SEMANTIC_AMBIGUITY_CASE_IDS
)

MISSING_ARGUMENT_CASES = tuple(case for case in GOLDEN if case["disposition"] == "missing_args")
DETAIL_REQUIRED_CASES = tuple(case for case in GOLDEN if case["disposition"] == "detail_required")
SAFETY_CASES = tuple(case for case in GOLDEN if case["slice"] == "safety")
REJECTION_CASES = tuple(
    case for case in GOLDEN if case["slice"] in {"forbidden", "ambiguity", "adversarial"}
)


@pytest.fixture(scope="module")
def catalog() -> OperationCatalog:
    return build_operation_catalog()


@pytest.fixture(scope="module")
def service(catalog: OperationCatalog) -> SelectorService:
    identity = InstrumentIdentityIndex()
    identity.replace(
        {
            "0": [{"code": "005930", "name": "삼성전자", "marketCode": "0"}],
            "10": [{"code": "035720", "name": "카카오", "marketCode": "10"}],
            "8": [{"code": "069500", "name": "KODEX 200", "marketCode": "8"}],
        }
    )
    return SelectorService(
        catalog,
        PlanSigner(b"selector-evaluation-secret"),
        instrument_identity=identity,
    )


def test_golden_corpus_has_exactly_84_reviewable_cases() -> None:
    assert len(GOLDEN) == 84
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


def test_golden_retrieval_is_exact(service: SelectorService) -> None:
    """Retrieval is scored at family granularity, because that is what it decides.

    Search ranks one document per TR family; a projection is chosen afterwards
    through an explicit ``detail_group``, never by out-ranking its siblings.
    """
    evaluated = [case for case in GOLDEN if case["accepted_refs"]]
    recall_at_five: list[bool] = []
    typed_top_one: list[bool] = []

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
        recalled = bool(accepted.intersection(refs))
        recall_at_five.append(recalled)
        # Lexical ranking is display-only.  The service prepends a family only when
        # shared typed compatibility has actually selected it; LOW diagnostic hits
        # have no semantic top-one contract.
        if result.results and result.results[0].confidence != "low":
            typed_top_one.append(refs[0] in accepted)
    assert all(recall_at_five)
    assert all(typed_top_one)


def test_realtime_resolve_is_exact(service: SelectorService) -> None:
    """Keep autonomous realtime resolution exact as well as retrieval.

    Search and resolve remain separate guarantees because resolve can still abstain or
    reject arguments after retrieval has selected the right family.
    """
    realtime_cases = [case for case in GOLDEN if case["slice"] == "realtime"]
    accurate: list[bool] = []
    for case in realtime_cases:
        try:
            resolved = service.resolve(
                ResolveRequest(
                    question=case["question"],
                    intent=DiscoveryIntent(case["intent"]),
                    arguments=case["arguments"],
                )
            )
        except (
            AmbiguousOperationError,
            InvalidArgumentsError,
            NoConfidentMatchError,
            OperationNotFoundError,
            UnsupportedOperationError,
        ):
            accurate.append(False)
            continue
        accurate.append(resolved.operation_ref in case["accepted_refs"])
    assert all(accurate)


_STRICT_RESOLVE_CASES = tuple(
    case for case in RESOLVE_CASES if case["id"] not in FAIL_CLOSED_RESOLVE_CASE_IDS
)


def _callable_preferred_ref(case: dict[str, Any]) -> str | None:
    """Translate pre-projection fixtures to the callable operation they assert."""
    preferred = case["preferred_ref"]
    if preferred and preferred.removeprefix("base:") in SPLIT_BASE_TR_IDS:
        return next(
            (ref for ref in case["accepted_refs"] if ref.startswith("detail:")),
            None,
        )
    return preferred


@pytest.mark.parametrize("case", _STRICT_RESOLVE_CASES, ids=lambda case: case["id"])
def test_resolve_selects_the_gold_base_or_detail(
    service: SelectorService, case: dict[str, Any]
) -> None:
    result = service.resolve(
        ResolveRequest(
            question=case["question"],
            intent=DiscoveryIntent(case["intent"]),
            preferred_ref=_callable_preferred_ref(case),
            detail_group=(
                None
                if (_callable_preferred_ref(case) or "").startswith("detail:")
                else case["detail_group"]
            ),
            arguments=case["arguments"],
            response_mode=ResponseMode(case["response_mode"]),
        )
    )
    assert result.operation_ref in case["accepted_refs"]
    expected_reasons = set(case["reasons"])
    if expected_reasons == {"BASE_DEFAULT"}:
        # BASE_DEFAULT was the pre-typed policy reason.  Natural-language semantic
        # selection now records the shared seam's unique-profile authority.
        expected_reasons = {"UNIQUE_EXACT_PROFILE"}
    assert {reason.value for reason in result.selection_reasons}.intersection(expected_reasons)


@pytest.mark.parametrize(
    "case",
    tuple(case for case in RESOLVE_CASES if case["id"] in EMBEDDED_ID_CASE_IDS),
    ids=lambda case: case["id"],
)
def test_embedded_operation_ids_never_gain_exact_control_plane_authority(
    service: SelectorService, case: dict[str, Any]
) -> None:
    # Exact identities are authoritative only when the normalized whole question is
    # the canonical ref/TR/group id.  preferred_ref and detail_group cannot rescue an
    # operation-like token embedded in natural language.
    with pytest.raises(NoConfidentMatchError):
        service.resolve(
            ResolveRequest(
                question=case["question"],
                intent=DiscoveryIntent(case["intent"]),
                preferred_ref=_callable_preferred_ref(case),
                detail_group=None,
                arguments=case["arguments"],
            )
        )


@pytest.mark.parametrize(
    "case",
    tuple(case for case in RESOLVE_CASES if case["id"] in TARGETLESS_DETAIL_CASE_IDS),
    ids=lambda case: case["id"],
)
def test_preferred_detail_cannot_cure_missing_target_evidence(
    service: SelectorService, case: dict[str, Any]
) -> None:
    # Caller arguments are validation data, not semantic authority.  A generic product
    # word or bound stk_cd cannot replace a concrete target/target-anchor in the query.
    with pytest.raises((AmbiguousOperationError, NoConfidentMatchError)):
        service.resolve(
            ResolveRequest(
                question=case["question"],
                intent=DiscoveryIntent(case["intent"]),
                preferred_ref=_callable_preferred_ref(case),
                detail_group=None,
                arguments=case["arguments"],
            )
        )


# ---------------------------------------------------------------------------
# W2c 완화 게이트(2026-08-26, 카드 랜딩 진단) — probe-resolve-raw.js 실측 재현.
#
# 대화체 파라프레이즈는 typed compatibility에서 NO_CONFIDENT_MATCH로 거부돼
# render_canvas를 한 번도 못 부르는 실패를 냈다(실측 문구는 매 라이브 왕복마다
# 달랐다 — "삼성전자 지금 추이가 어때", "삼성전자 현재가 주가 추이", "삼성전자
# 현재 시세 및 거래량" 등. 아래 (a)는 이 테스트 파일의 작은 InstrumentIdentityIndex
# 픽스처에서 실제로 REJECTED를 재현하는 문구를 쓴다 — "삼성전자 현재 시세 및
# 거래량"은 이 좁은 픽스처에서는 구조화 힌트 없이도 이미 typed compatibility를
# 통과해버려 이 게이트를 아예 안 태운다. 승인 조건의 취지(파라프레이즈 + 완전한
# 구조화 단언 + 실제 종목 근거 → 구제)는 (a)로 그대로 검증된다).
#
# 여기 구제 대상은 위 두 fail-closed 테스트가 지키는 경계와 다르다 —
# question 원문 자체에서 실제 종목("삼성전자")이 독립적으로 인식된다는 점이
# "ka10001 가치평가 지표만 알려줘"(오퍼레이션 id가 토큰으로 낄 뿐 종목 근거는
# 없음)나 "D+1 D+2 정산 전망"(종목 근거 자체가 없음)과의 결정적 차이다. (b)(c)는
# 그 두 케이스를 각각 골든 코퍼스(api_selector_golden.jsonl)의 실제 문구·인자
# 그대로 단독 테스트로 다시 고정한다 — 기존 파라미터라이즈 테스트(EMBEDDED_ID_
# CASE_IDS/TARGETLESS_DETAIL_CASE_IDS)는 손대지 않는다.
# ---------------------------------------------------------------------------


def test_guarded_fallback_rescues_the_diagnosed_paraphrase(service: SelectorService) -> None:
    """(a) 종목 근거가 실제로 있는 파라프레이즈 + 완전한 구조화 단언 → 구제된다."""
    paraphrase = "삼성전자 현재가 주가 추이"
    rescued = service.resolve(
        ResolveRequest(
            question=paraphrase,
            preferred_ref="detail:ka10001:current_trading",
            arguments={"stk_cd": "005930"},
        )
    )
    assert rescued.operation_ref == "detail:ka10001:current_trading"
    assert rescued.selection_reasons == [ReasonCode.PREFERRED_STRUCTURED_ASSERTION]
    verified = service.signer.verify(rescued.plan_token, service.catalog)
    assert verified.arguments == {"stk_cd": "005930"}


def test_guarded_fallback_refuses_the_same_paraphrase_without_structured_hints(
    service: SelectorService,
) -> None:
    with pytest.raises(NoConfidentMatchError):
        service.resolve(
            ResolveRequest(
                question="삼성전자 현재가 주가 추이",
                arguments={"stk_cd": "005930"},
            )
        )


def test_guarded_fallback_refuses_an_instrument_mismatched_with_the_question(
    service: SelectorService,
) -> None:
    """(3) 승인 조건 — question 원문에서 인식된 종목(삼성전자)과 bound
    arguments의 종목(카카오)이 다르면 구제는커녕 애초에 성립하지 않는다.
    이 검증은 새로 만들지 않는다 — `_bind_trusted_instrument`가 이미
    non-explicit 경로 전체에 강제하는 기존 계약을 그대로 물려받는다."""
    with pytest.raises(InvalidArgumentsError):
        service.resolve(
            ResolveRequest(
                question="삼성전자 현재가 주가 추이",
                preferred_ref="detail:ka10001:current_trading",
                arguments={"stk_cd": "035720"},  # 카카오 — 질문 속 종목과 불일치
            )
        )


def test_guarded_fallback_never_rescues_order_kind_even_with_complete_hints(
    service: SelectorService,
) -> None:
    """주문 오발동 방지가 완화보다 우선한다 — query kind가 아니면 종목 근거와
    구조화 단언이 완전해도 절대 구제하지 않는다(설계 확정)."""
    with pytest.raises(NoConfidentMatchError):
        service.resolve(
            ResolveRequest(
                question="삼성전자 지금 사줘",
                intent=DiscoveryIntent.ORDER,
                preferred_ref="base:kt10000",
                arguments={
                    "dmst_stex_tp": "KRX",
                    "stk_cd": "005930",
                    "ord_qty": "1",
                    "trde_tp": "0",
                },
            )
        )


def test_guarded_fallback_still_refuses_the_embedded_id_golden_case(
    service: SelectorService,
) -> None:
    """(b) 골든 코퍼스 detail-ka10001-ko를 단독 테스트로 다시 고정한다 —
    오퍼레이션 id("ka10001")가 문장에 토큰으로 낄 뿐 종목 근거가 없으면,
    preferred_ref/detail_group/arguments가 전부 실제로 유효해도 여전히
    거부된다(트리거인 파라미터라이즈 테스트와 별개로, 이 완화 게이트를
    막 추가한 뒤 회귀를 바로 알아볼 수 있게 이름으로 고정한다)."""
    with pytest.raises(NoConfidentMatchError):
        service.resolve(
            ResolveRequest(
                question="ka10001 가치평가 지표만 알려줘",
                preferred_ref="detail:ka10001:valuation",
                arguments={"stk_cd": "005930"},
            )
        )


def test_guarded_fallback_still_refuses_the_targetless_golden_case(
    service: SelectorService,
) -> None:
    """(c) 골든 코퍼스 detail-kt00001-ko를 단독 테스트로 다시 고정한다 —
    종목 근거 자체가 문장에 없으면 preferred_ref/detail_group/arguments가
    전부 유효해도 여전히 거부된다."""
    with pytest.raises((AmbiguousOperationError, NoConfidentMatchError)):
        service.resolve(
            ResolveRequest(
                question="D+1 D+2 정산 전망",
                preferred_ref="detail:kt00001:settlement_forecast",
                arguments={"qry_tp": "2"},
            )
        )


# ---------------------------------------------------------------------------
# P3 완화 게이트(2026-08-27, 호가 카드 진단) — QA-ORDERBOOK 실측 재현.
#
# "SK하이닉스 호가 보여줘"류 질문은 typed compatibility에서 measure:orderbook
# 축 하나로만 매칭돼 ka10004/ka10007/ka10087은 물론 무관한 스크리너(ka10011,
# ka10016 등)까지 한 티어로 묶여 family 단위 AMBIGUOUS로 떨어졌다(athena_resolve
# 3연속 실패, 카드 0장 — 2026-08-27 실측). 위 W2c 게이트는 REJECTED만 구제했으므로
# AMBIGUOUS는 그대로 막혀 있었다. resolve()의 AMBIGUOUS 분기도 같은 preferred_ref
# 단언 통로(같은 trusted_code/INSTRUMENT_CODE 안전 조건)를 재사용하되, 이미 typed로
# compatible한(즉 이 tie에 실제로 낀) family에만 적용한다 — 아래 두 번째 테스트가
# 그 경계를 고정한다.
# ---------------------------------------------------------------------------


def test_ambiguous_orderbook_question_resolves_with_asserted_family(
    service: SelectorService,
) -> None:
    """ "호가" 대표 발화가 ka10004로 수렴한다 — search 1위 후보를 그대로
    preferred_ref로 넘기는 정상적인 search→resolve 흐름을 재현한다."""
    resolved = service.resolve(
        ResolveRequest(
            question="삼성전자 호가 보여줘",
            preferred_ref="detail:ka10004:aggregate_totals",
            arguments={"stk_cd": "005930"},
        )
    )
    assert resolved.operation_ref == "detail:ka10004:aggregate_totals"
    assert resolved.selection_reasons == [ReasonCode.PREFERRED_STRUCTURED_ASSERTION]


def test_ambiguous_orderbook_question_without_an_assertion_still_asks(
    service: SelectorService,
) -> None:
    """가드 확인 — 단언이 없으면 여전히 AMBIGUOUS다(회귀 없음)."""
    with pytest.raises(AmbiguousOperationError):
        service.resolve(
            ResolveRequest(
                question="삼성전자 호가 보여줘",
                arguments={"stk_cd": "005930"},
            )
        )


@pytest.mark.parametrize(
    "case",
    tuple(case for case in RESOLVE_CASES if case["id"] in SEMANTIC_AMBIGUITY_CASE_IDS),
    ids=lambda case: case["id"],
)
def test_preferred_detail_cannot_cure_true_family_ambiguity(
    service: SelectorService, case: dict[str, Any]
) -> None:
    with pytest.raises(AmbiguousOperationError):
        service.resolve(
            ResolveRequest(
                question=case["question"],
                intent=DiscoveryIntent(case["intent"]),
                preferred_ref=_callable_preferred_ref(case),
                detail_group=None,
                arguments=case["arguments"],
            )
        )


@pytest.mark.parametrize("case", DETAIL_REQUIRED_CASES, ids=lambda case: case["id"])
def test_split_base_legacy_aliases_fail_closed(
    service: SelectorService, case: dict[str, Any]
) -> None:
    """Removed split bases cannot be rediscovered or revived as legacy aliases."""
    tr_id = case["accepted_refs"][0].removeprefix("base:")
    assert service.catalog.find_exact(f"base:{tr_id}") is None
    with pytest.raises((NoConfidentMatchError, OperationNotFoundError)):
        service.resolve(
            ResolveRequest(
                question=f"base:{tr_id}",
                intent=DiscoveryIntent(case["intent"]),
                arguments=case["arguments"],
                response_mode=ResponseMode(case["response_mode"]),
            )
        )


@pytest.mark.parametrize("case", MISSING_ARGUMENT_CASES, ids=lambda case: case["id"])
def test_resolve_reports_every_expected_missing_argument(
    service: SelectorService, case: dict[str, Any]
) -> None:
    detail_ref = service.catalog.details_for(case["accepted_refs"][0].removeprefix("base:"))[
        0
    ].operation_ref
    with pytest.raises(InvalidArgumentsError) as caught:
        service.resolve(
            ResolveRequest(
                question=detail_ref,
                intent=DiscoveryIntent(case["intent"]),
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
def test_orders_and_websockets_need_explicit_intent_and_stay_guarded(
    service: SelectorService, case: dict[str, Any]
) -> None:
    """Callable, but never by accident.

    Explicit intent is the discovery gate and an exact operation_ref is the resolve gate:
    resolve ranks only the query surface, so no vague question can land on an order.
    """
    operation_ref = case["accepted_refs"][0]

    result = service.search(
        SearchRequest(
            query=case["question"],
            intent=DiscoveryIntent(case["intent"]),
            limit=5,
        )
    )
    assert result.results[0].operation_ref == operation_ref
    assert result.results[0].discovery_only is True
    assert result.results[0].generic_callable is True

    # The same question without the intent never reaches it.
    vague = service.search(SearchRequest(query=case["question"], intent=DiscoveryIntent.AUTO))
    assert all(hit.operation_ref != operation_ref for hit in vague.results)

    resolved = service.resolve(
        ResolveRequest(
            question=operation_ref,
            intent=DiscoveryIntent(case["intent"]),
            arguments=case["arguments"],
        )
    )
    assert resolved.operation_ref == operation_ref
    # The plan names the operation; it does not authorise placing it.
    plan = service.signer.verify(resolved.plan_token, service.catalog)
    assert plan.operation_ref == operation_ref


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
            ResolveRequest(
                question=case["question"],
                intent=DiscoveryIntent(case["intent"]),
                arguments=case["arguments"],
            )
        )


def test_catalog_contains_only_299_callable_selector_documents(
    catalog: OperationCatalog,
) -> None:
    refs = [document.operation_ref for document in catalog.documents]
    base_refs = [ref for ref in refs if ref.startswith("base:")]
    assert len(refs) == len(set(refs)) == 299
    assert len(base_refs) == 184
    assert len([ref for ref in refs if ref.startswith("detail:")]) == 115
    assert all(document.generic_callable for document in catalog.documents)


def test_split_bases_and_oauth_are_absent_from_selector_catalog(
    catalog: OperationCatalog,
) -> None:
    assert catalog.find_exact("base:au10001") is None
    assert catalog.find_exact("base:au10002") is None
    for tr_id in SPLIT_BASE_TR_IDS:
        assert catalog.find_exact(f"base:{tr_id}") is None
        assert catalog.find_exact(tr_id) is None


def test_query_search_surface_contains_149_bases_and_115_projections(
    catalog: OperationCatalog,
) -> None:
    surface = catalog.visible_for(DiscoveryIntent.QUERY)
    assert len(surface) == 264
    assert len([document for document in surface if document.group_id is None]) == 149
    assert len([document for document in surface if document.group_id is not None]) == 115
    assert all(document.generic_callable for document in surface)


def test_every_detail_projection_is_directly_describable_without_a_base_document(
    service: SelectorService, catalog: OperationCatalog
) -> None:
    """Each projection is a first-class selector document and split bases are absent."""
    details = [document for document in catalog.documents if document.group_id is not None]
    assert len(details) == 115
    for document in details:
        description = service.describe(
            DescribeRequest(operation_ref=document.operation_ref, intent=DiscoveryIntent.QUERY)
        )
        assert description.operation_ref == document.operation_ref
        assert description.group_id == document.group_id
        assert description.detail_groups == []
        assert catalog.find_exact(f"base:{document.tr_id}") is None


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
        assert [(item.document.operation_ref, item.score) for item in forward] == [
            (item.document.operation_ref, item.score) for item in reverse
        ]


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
