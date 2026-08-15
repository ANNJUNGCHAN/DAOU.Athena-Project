from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import Request, Response
from pydantic import ValidationError

from athena_api.kiwoom import ResponseEnvelope
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.errors import (
    ExpiredPlanError,
    InvalidArgumentsError,
    InvalidPlanError,
    OperationNotFoundError,
    StalePlanError,
    UnsupportedOperationError,
)
from athena_api.selector.plans import PlanSigner
from athena_api.selector.policy import select_operation
from athena_api.selector.ranking import RankedDocument, rank_documents
from athena_api.selector.schemas import (
    CallRequest,
    DescribeRequest,
    DiscoveryIntent,
    ReasonCode,
    ResolveRequest,
    ResponseMode,
    ScoreContribution,
    SearchRequest,
)
from athena_api.selector.service import SelectorService

BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def catalog():
    return build_operation_catalog()


@pytest.fixture
def service(catalog):
    return SelectorService(catalog, PlanSigner(b"selector-test-secret", nonce_factory=lambda: "n"))


def test_catalog_has_exact_domestic_visibility_and_callability_counts(catalog) -> None:
    assert len(catalog.documents) == 323
    assert sum(document.generic_callable for document in catalog.documents) == 286
    assert sum(document.visibility == "explicit" for document in catalog.documents) == 35
    assert sum(document.visibility == "hidden" for document in catalog.documents) == 2
    assert len({document.operation_ref for document in catalog.documents}) == 323

    source_profile = json.loads(
        (BACKEND / "ref" / "kiwoom-io-source-profile.json").read_text(encoding="utf-8")
    )
    us_only = set(source_profile["official_github_audit"]["us_only_operation_ids"])
    assert not us_only.intersection(document.tr_id for document in catalog.documents)


def test_search_is_deterministic_independent_of_catalog_order(catalog) -> None:
    forward = rank_documents(
        "portfolio valuation summary", catalog.visible_for(DiscoveryIntent.AUTO)
    )
    reverse = rank_documents(
        "portfolio valuation summary", tuple(reversed(catalog.visible_for(DiscoveryIntent.AUTO)))
    )

    assert [(item.document.operation_ref, item.score) for item in forward] == [
        (item.document.operation_ref, item.score) for item in reverse
    ]
    assert forward[0].document.operation_ref == "detail:kt00018:portfolio_summary"
    assert forward[0].contributions


def test_korean_and_english_finance_queries_use_the_controlled_lexicon(service) -> None:
    korean = service.search(SearchRequest(query="계좌 잔고 평가", limit=10))
    english = service.search(SearchRequest(query="portfolio valuation summary", limit=3))

    assert korean.results
    assert any(hit.operation_ref.startswith("detail:kt00018:") for hit in korean.results)
    assert english.results[0].operation_ref == "detail:kt00018:portfolio_summary"
    assert any(
        contribution.reason_code.value == "SYNONYM_MATCH"
        for hit in korean.results
        for contribution in hit.contributions
    )


def test_auto_is_query_only_and_order_websocket_require_explicit_intent(service) -> None:
    auto = service.search(SearchRequest(query="주문 체결", intent=DiscoveryIntent.AUTO))
    orders = service.search(SearchRequest(query="주문 체결", intent=DiscoveryIntent.ORDER))
    websocket = service.search(
        SearchRequest(query="실시간 체결", intent=DiscoveryIntent.WEBSOCKET)
    )

    assert all(hit.kind.value == "query" for hit in auto.results)
    assert orders.results and all(hit.kind.value == "order" for hit in orders.results)
    assert websocket.results and all(
        hit.kind.value == "websocket" for hit in websocket.results
    )
    assert all(not hit.generic_callable for hit in orders.results + websocket.results)


def test_operation_identity_is_case_sensitive_for_0g_and_0G(service) -> None:
    upper = service.search(
        SearchRequest(query="0G", intent=DiscoveryIntent.WEBSOCKET, limit=2)
    )
    lower = service.search(
        SearchRequest(query="0g", intent=DiscoveryIntent.WEBSOCKET, limit=2)
    )

    assert upper.results[0].operation_ref == "base:0G"
    assert lower.results[0].operation_ref == "base:0g"
    assert service.describe(
        DescribeRequest(operation_ref="base:0G", intent=DiscoveryIntent.WEBSOCKET)
    ).operation_ref == "base:0G"
    assert service.describe(
        DescribeRequest(operation_ref="base:0g", intent=DiscoveryIntent.WEBSOCKET)
    ).operation_ref == "base:0g"


def test_oauth_and_unknown_us_operations_are_indistinguishable_from_missing(service) -> None:
    with pytest.raises(OperationNotFoundError):
        service.describe(DescribeRequest(operation_ref="base:au10001"))
    with pytest.raises(OperationNotFoundError):
        service.describe(DescribeRequest(operation_ref="base:ka90000"))


def test_public_request_models_forbid_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        SearchRequest.model_validate({"query": "현재가", "path": "/api/arbitrary"})


def _ranked(document, points: int) -> RankedDocument:
    return RankedDocument(
        document=document,
        score=points,
        contributions=(
            ScoreContribution(
                reason_code=ReasonCode.TITLE_TOKEN_MATCH,
                points=points,
                matched_terms=["fixture"],
                scope="title",
            ),
        ),
    )


def test_family_policy_selects_one_detail_but_uses_base_for_multiple_groups(catalog) -> None:
    current = catalog.by_ref["detail:ka10001:current_trading"]
    valuation = catalog.by_ref["detail:ka10001:valuation"]

    selected, reasons = select_operation(
        catalog,
        "현재 거래 정보",
        (_ranked(current, 300),),
        ResponseMode.AUTO,
    )
    assert selected is current
    assert reasons == [ReasonCode.SINGLE_GROUP_PREFERRED]

    selected, reasons = select_operation(
        catalog,
        "현재 거래와 가치 평가",
        (_ranked(current, 300), _ranked(valuation, 250)),
        ResponseMode.AUTO,
    )
    assert selected.operation_ref == "base:ka10001"
    assert reasons == [ReasonCode.MULTI_GROUP_BASE_REQUIRED]


def test_family_policy_keeps_pure_lists_and_explicit_full_requests_on_base(catalog) -> None:
    pure_list = catalog.by_ref["base:ka10095"]
    selected, reasons = select_operation(
        catalog,
        "관심종목 정보",
        (_ranked(pure_list, 400),),
        ResponseMode.AUTO,
    )
    assert selected is pure_list
    assert reasons == [ReasonCode.PURE_LIST_BASE_REQUIRED]

    detail = catalog.by_ref["detail:ka10001:current_trading"]
    selected, reasons = select_operation(
        catalog,
        "전체 원문 응답",
        (_ranked(detail, 400),),
        ResponseMode.FULL,
    )
    assert selected.operation_ref == "base:ka10001"
    assert reasons == [ReasonCode.EXPLICIT_FULL_RESPONSE]


def test_resolve_validates_required_arguments_and_issues_allowlisted_plan(service) -> None:
    with pytest.raises(InvalidArgumentsError):
        service.resolve(ResolveRequest(question="base:ka10001", arguments={}))

    resolved = service.resolve(
        ResolveRequest(question="base:ka10001", arguments={"stk_cd": "005930"})
    )
    verified = service.signer.verify(resolved.plan_token, service.catalog)

    assert resolved.operation_ref == "base:ka10001"
    assert verified.operation_ref == "base:ka10001"
    assert verified.arguments == {"stk_cd": "005930"}


def test_preferred_detail_cannot_bypass_explicit_full_response_policy(service) -> None:
    resolved = service.resolve(
        ResolveRequest(
            question="current trading",
            candidate_refs=["detail:ka10001:current_trading"],
            preferred_ref="detail:ka10001:current_trading",
            arguments={"stk_cd": "005930"},
            response_mode=ResponseMode.FULL,
        )
    )

    assert resolved.operation_ref == "base:ka10001"
    assert resolved.selection_reasons == [ReasonCode.EXPLICIT_FULL_RESPONSE]


@pytest.mark.parametrize("operation_ref", ["base:kt10000", "base:0G"])
def test_order_and_websocket_are_rejected_by_generic_resolve(
    service, operation_ref: str
) -> None:
    with pytest.raises(UnsupportedOperationError):
        service.resolve(ResolveRequest(question=operation_ref))


def test_plan_rejects_tampering_expiry_and_stale_catalog(catalog) -> None:
    now = [1_000.0]
    signer = PlanSigner(
        b"selector-test-secret",
        ttl_seconds=10,
        clock=lambda: now[0],
        nonce_factory=lambda: "fixed",
    )
    document = catalog.by_ref["base:ka10001"]
    token, _ = signer.issue(
        catalog=catalog,
        document=document,
        arguments={"stk_cd": "005930"},
        question="삼성전자 현재가",
    )
    version, payload, signature = token.split(".")
    changed = ("A" if payload[0] != "A" else "B") + payload[1:]
    with pytest.raises(InvalidPlanError):
        signer.verify(f"{version}.{changed}.{signature}", catalog)

    with pytest.raises(StalePlanError):
        signer.verify(token, replace(catalog, version="sha256:stale"))

    now[0] = 1_011.0
    with pytest.raises(ExpiredPlanError):
        signer.verify(token, catalog)


def test_continuation_refresh_preserves_operation_arguments_and_question(catalog) -> None:
    signer = PlanSigner(b"selector-test-secret", nonce_factory=lambda: "fixed")
    document = catalog.by_ref["base:ka10001"]
    token, _ = signer.issue(
        catalog=catalog,
        document=document,
        arguments={"stk_cd": "005930"},
        question="현재가",
    )
    original = signer.verify(token, catalog)
    refreshed_token, _ = signer.refresh(
        original,
        catalog=catalog,
        document=document,
        cont_yn="Y",
        next_key="next-page",
    )
    refreshed = signer.verify(refreshed_token, catalog)

    assert refreshed.operation_ref == original.operation_ref
    assert refreshed.arguments == original.arguments
    assert refreshed.question_hash == original.question_hash
    assert refreshed.cont_yn == "Y"
    assert refreshed.next_key == "next-page"


@pytest.mark.asyncio
async def test_call_executes_only_the_signed_operation_and_returns_next_plan(service) -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.calls = []

        async def post_with_headers(self, tr_id, path, body, options):
            self.calls.append((tr_id, path, body, options))
            return ResponseEnvelope(
                body={"cur_prc": "70000", "ignored": "not projected"},
                cont_yn="Y",
                next_key="NEXT-1",
            )

    resolved = service.resolve(
        ResolveRequest(
            question="detail:ka10001:current_trading",
            arguments={"stk_cd": "005930"},
        )
    )
    client = FakeClient()
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    response = Response()

    result = await service.call(
        CallRequest(plan_token=resolved.plan_token),
        request,
        response,
        client,
    )

    assert result.operation_ref == "detail:ka10001:current_trading"
    assert result.data["cur_prc"] == "70000"
    assert "ignored" not in result.data
    assert len(client.calls) == 1
    assert client.calls[0][0] == "ka10001"
    assert client.calls[0][2] == {"stk_cd": "005930"}
    assert result.continuation.next_plan_token
    next_plan = service.signer.verify(result.continuation.next_plan_token, service.catalog)
    assert next_plan.cont_yn == "Y"
    assert next_plan.next_key == "NEXT-1"
