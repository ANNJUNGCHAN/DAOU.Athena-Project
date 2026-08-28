from __future__ import annotations

import json
import re
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from _selector_facade import select_operation
from fastapi import Request, Response
from pydantic import ValidationError

from athena_api.kiwoom import ResponseEnvelope
from athena_api.routing_contract import EntityKind
from athena_api.selector.catalog import build_operation_catalog, realtime_item_model
from athena_api.selector.errors import (
    AmbiguousOperationError,
    ExpiredPlanError,
    InvalidArgumentsError,
    InvalidPlanError,
    NoConfidentMatchError,
    OperationNotFoundError,
    PlanAlreadyUsedError,
    PreferredOperationError,
    ReplayStateCapacityError,
    StalePlanError,
)
from athena_api.selector.lexicon import synonym_only_tokens
from athena_api.selector.normalization import tokenize
from athena_api.selector.plans import PlanSigner, VerifiedPlan
from athena_api.selector.primitive_evidence import TargetResolution
from athena_api.selector.ranking import (
    _MINIMUM_SURFACE,
    _ZONE_RULES,
    RankedDocument,
    _zone_tokens,
    rank_documents,
    uninformative_zone_tokens,
)
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
from athena_api.selector.service import _NONCE_CACHE_LIMIT, SelectorService

BACKEND = Path(__file__).resolve().parents[2]


def _identity_only_test_target_resolver(question: str) -> TargetResolution | None:
    normalized = " ".join(question.casefold().split())
    for alias, entity_kind in (
        ("삼성전자", EntityKind.STOCK),
        ("kodex 200", EntityKind.ETF),
    ):
        if (
            re.search(
                rf"(?<![0-9a-z가-힣]){re.escape(alias)}(?![0-9a-z가-힣])",
                normalized,
            )
            is not None
        ):
            return TargetResolution(entity_kind)
    return None


def test_multiword_synonym_aliases_match_atomically_without_entity_token_leakage() -> None:
    assert "indicator" not in synonym_only_tokens(("elw",))
    assert "greeks" not in synonym_only_tokens(("elw",))
    assert "nav" not in synonym_only_tokens(("etf",))

    elw_indicator = set(synonym_only_tokens(("show", "elw", "indicator")))
    etf_nav = set(synonym_only_tokens(("show", "etf", "nav")))
    assert {"greeks", "지표"}.issubset(elw_indicator)
    assert "순자산가치" in etf_nav


def test_synonym_expansion_is_not_transitive() -> None:
    # ``bid`` belongs to both the order-book and buy concepts. One authored match may
    # expand its own concept, but the newly emitted token must not activate another.
    expanded = set(synonym_only_tokens(("orderbook",)))
    assert "bid" in expanded
    assert "buy" not in expanded


@pytest.fixture(scope="module")
def catalog():
    return build_operation_catalog()


@pytest.fixture
def service(catalog):
    return SelectorService(
        catalog,
        PlanSigner(b"selector-test-secret", nonce_factory=lambda: "n"),
        target_resolver=_identity_only_test_target_resolver,
    )


def test_catalog_has_exact_domestic_visibility_and_callability_counts(catalog) -> None:
    assert len(catalog.documents) == 299
    # 149 unsplit query bases + 115 projections + 12 orders + 23 websocket controls.
    assert sum(document.generic_callable for document in catalog.documents) == 299
    manifest = json.loads(
        (BACKEND / "ref" / "kiwoom-common-screen-manifest.json").read_text(encoding="utf-8")
    )
    # The read surface is unchanged by opening order and websocket execution.
    assert manifest["counts"]["categories"]["read_display"] == 264
    read_callable = sum(
        document.generic_callable and document.kind == "query" for document in catalog.documents
    )
    assert read_callable == 264
    assert sum(document.visibility == "explicit" for document in catalog.documents) == 35
    assert sum(document.visibility == "hidden" for document in catalog.documents) == 0
    assert len({document.operation_ref for document in catalog.documents}) == 299

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
    websocket = service.search(SearchRequest(query="실시간 체결", intent=DiscoveryIntent.WEBSOCKET))

    assert all(hit.kind.value == "query" for hit in auto.results)
    assert orders.results and all(hit.kind.value == "order" for hit in orders.results)
    assert websocket.results and all(hit.kind.value == "websocket" for hit in websocket.results)
    # Callable, but only reachable once the caller declares the intent.
    assert all(hit.generic_callable for hit in orders.results + websocket.results)
    assert all(hit.discovery_only for hit in orders.results + websocket.results)


def test_operation_identity_is_case_sensitive_for_0g_and_0G(service) -> None:
    upper = service.search(SearchRequest(query="0G", intent=DiscoveryIntent.WEBSOCKET, limit=2))
    lower = service.search(SearchRequest(query="0g", intent=DiscoveryIntent.WEBSOCKET, limit=2))

    assert upper.results[0].operation_ref == "base:0G"
    assert lower.results[0].operation_ref == "base:0g"
    assert (
        service.describe(
            DescribeRequest(operation_ref="base:0G", intent=DiscoveryIntent.WEBSOCKET)
        ).operation_ref
        == "base:0G"
    )
    assert (
        service.describe(
            DescribeRequest(operation_ref="base:0g", intent=DiscoveryIntent.WEBSOCKET)
        ).operation_ref
        == "base:0g"
    )


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


def test_family_policy_uses_unsplit_bases_and_direct_split_details(
    catalog,
) -> None:
    # An unsplit family still answers from its base.
    unsplit = catalog.by_ref["base:ka10006"]
    selected, reasons = select_operation(
        catalog,
        "base:ka10006",
        (_ranked(unsplit, 300),),
        ResponseMode.AUTO,
    )
    assert selected is unsplit
    assert reasons == [ReasonCode.EXACT_OPERATION_REF]

    # A split family has no base document; its detail is directly selectable.
    assert catalog.find_exact("base:ka10001") is None
    detail = catalog.by_ref["detail:ka10001:current_trading"]
    selected, reasons = select_operation(
        catalog,
        detail.operation_ref,
        (_ranked(detail, 300),),
        ResponseMode.AUTO,
    )
    assert selected is detail
    assert reasons == [ReasonCode.EXACT_OPERATION_REF]


def test_unknown_detail_group_is_rejected_with_the_available_groups(catalog) -> None:
    assert catalog.find_exact("detail:ka10001:not_a_group") is None
    assert {item.group_id for item in catalog.details_for("ka10001")} == {
        "identity_and_capital",
        "market_scale_and_ownership",
        "price_range",
        "valuation",
        "financial_performance",
        "daily_price_band",
        "current_trading",
    }


def test_detail_group_of_another_family_cannot_be_borrowed(catalog) -> None:
    """``holdings`` is a real group id - but not one of ka10001's."""
    assert catalog.find_exact("detail:kt00018:holdings") is not None
    assert catalog.find_exact("detail:ka10001:holdings") is None


def test_family_policy_keeps_pure_lists_and_explicit_full_requests_on_base(catalog) -> None:
    pure_list = catalog.by_ref["base:ka10095"]
    selected, reasons = select_operation(
        catalog,
        "base:ka10095",
        (_ranked(pure_list, 400),),
        ResponseMode.AUTO,
    )
    assert selected is pure_list
    assert reasons == [ReasonCode.EXACT_OPERATION_REF]

    # An explicit full-response request still outranks narrowing on an unsplit family.
    unsplit = catalog.by_ref["base:ka10006"]
    selected, reasons = select_operation(
        catalog,
        "base:ka10006",
        (_ranked(unsplit, 400),),
        ResponseMode.FULL,
    )
    assert selected is unsplit
    assert reasons == [ReasonCode.EXPLICIT_FULL_RESPONSE]

    # On a split family there is no base document left to ask for.
    with pytest.raises(NoConfidentMatchError):
        select_operation(
            catalog,
            "base:ka10001",
            (),
            ResponseMode.FULL,
        )


def test_resolve_validates_required_arguments_and_issues_allowlisted_plan(service) -> None:
    detail_ref = "detail:ka10001:current_trading"
    with pytest.raises(InvalidArgumentsError):
        service.resolve(ResolveRequest(question=detail_ref, arguments={}))

    resolved = service.resolve(
        ResolveRequest(
            question=detail_ref,
            arguments={"stk_cd": "005930"},
        )
    )
    verified = service.signer.verify(resolved.plan_token, service.catalog)

    assert resolved.operation_ref == "detail:ka10001:current_trading"
    assert verified.operation_ref == "detail:ka10001:current_trading"
    assert verified.arguments == {"stk_cd": "005930"}


def test_explicit_full_response_cannot_resurrect_a_split_base(service) -> None:
    resolved = service.resolve(
        ResolveRequest(
            question="삼성전자 오늘 주가 얼마야?",
            candidate_refs=["detail:ka10001:current_trading"],
            preferred_ref="detail:ka10001:current_trading",
            arguments={"stk_cd": "005930"},
            response_mode=ResponseMode.FULL,
        )
    )

    assert resolved.operation_ref == "detail:ka10001:current_trading"
    assert resolved.selection_reasons == [
        ReasonCode.UNIQUE_EXACT_PROFILE,
        ReasonCode.EXPLICIT_DETAIL_GROUP,
    ]

    # With no projection named, a full-response request is refused rather than widened.
    with pytest.raises(OperationNotFoundError):
        service.resolve(
            ResolveRequest(
                question="base:ka10001",
                arguments={"stk_cd": "005930"},
                response_mode=ResponseMode.FULL,
            )
        )


@pytest.mark.parametrize(
    ("operation_ref", "intent", "arguments"),
    [
        (
            "base:kt10000",
            DiscoveryIntent.ORDER,
            {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"},
        ),
        (
            "base:0G",
            DiscoveryIntent.WEBSOCKET,
            {"trnm": "REG", "grp_no": "1", "refresh": "1"},
        ),
    ],
)
def test_order_and_websocket_resolve_only_from_an_exact_reference(
    service,
    operation_ref: str,
    intent: DiscoveryIntent,
    arguments: dict[str, object],
) -> None:
    """An exact reference resolves only on its explicitly requested surface."""
    resolved = service.resolve(
        ResolveRequest(question=operation_ref, intent=intent, arguments=arguments)
    )
    assert resolved.operation_ref == operation_ref

    # No natural-language question can rank onto them, whatever it says.
    with pytest.raises((NoConfidentMatchError, AmbiguousOperationError, OperationNotFoundError)):
        service.resolve(ResolveRequest(question="!!!", arguments=arguments))


@pytest.mark.parametrize("operation_ref", ["base:au10001", "base:au10002"])
def test_oauth_stays_indistinguishable_from_missing_even_in_resolve(
    service, operation_ref: str
) -> None:
    """Opening order and websocket execution must not leak the OAuth identities.

    They are hidden rather than merely uncallable, so resolve answers exactly as it does
    for an identity that does not exist.
    """
    with pytest.raises(NoConfidentMatchError):
        service.resolve(ResolveRequest(question=operation_ref))


def test_plan_rejects_tampering_expiry_and_stale_catalog(catalog) -> None:
    now = [1_000.0]
    signer = PlanSigner(
        b"selector-test-secret",
        ttl_seconds=10,
        clock=lambda: now[0],
        nonce_factory=lambda: "fixed",
    )
    document = catalog.by_ref["detail:ka10001:current_trading"]
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
    document = catalog.by_ref["detail:ka10001:current_trading"]
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


@pytest.mark.asyncio
async def test_call_logs_upstream_round_trip_without_payload_or_token(service, caplog) -> None:

    class SlowClient:
        async def post_with_headers(self, tr_id, path, body, options):
            return ResponseEnvelope(body={"cur_prc": "70000"}, cont_yn="N", next_key=None)

    resolved = service.resolve(
        ResolveRequest(
            question="detail:ka10001:current_trading",
            arguments={"stk_cd": "005930"},
        )
    )
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})

    with caplog.at_level("INFO", logger="athena_api.selector.service"):
        result = await service.call(
            CallRequest(plan_token=resolved.plan_token),
            request,
            Response(),
            SlowClient(),
        )

    assert result.data["cur_prc"] == "70000"
    upstream_records = [r for r in caplog.records if "athena_call upstream" in r.message]
    assert len(upstream_records) == 1
    message = upstream_records[0].message
    assert "tr=ka10001" in message
    assert "upstream_ms=" in message
    assert resolved.plan_token not in message
    assert "005930" not in message
    assert "70000" not in message


class _CountingClient:
    """Records how many times the upstream would have been hit."""

    def __init__(self) -> None:
        self.calls = 0

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls += 1
        return ResponseEnvelope(body={"cur_prc": "70000"}, cont_yn="N", next_key=None)


class _FailingClient:
    """Simulates an upstream timeout, so the plan is spent before any response exists."""

    async def post_with_headers(self, tr_id, path, body, options):
        raise RuntimeError("upstream timeout")


def _incrementing_signer() -> PlanSigner:
    counter = iter(range(10_000))
    return PlanSigner(b"selector-test-secret", nonce_factory=lambda: f"nonce-{next(counter)}")


def _blank_request() -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "headers": []})


@pytest.mark.asyncio
async def test_call_rejects_a_replayed_plan_token(catalog) -> None:
    """A resolved plan_token is single-use (decision 2026-08-18): a second call() with the
    same token is refused and never reaches the upstream client a second time."""
    service = SelectorService(catalog, _incrementing_signer())
    resolved = service.resolve(
        ResolveRequest(question="detail:ka10001:current_trading", arguments={"stk_cd": "005930"})
    )
    client = _CountingClient()
    request = _blank_request()

    call_request = CallRequest(plan_token=resolved.plan_token)
    first = await service.call(call_request, request, Response(), client)
    assert first.data["cur_prc"] == "70000"
    assert client.calls == 1

    with pytest.raises(PlanAlreadyUsedError):
        await service.call(call_request, request, Response(), client)
    assert client.calls == 1


@pytest.mark.asyncio
async def test_call_burns_the_token_even_when_the_upstream_call_then_fails(catalog) -> None:
    """The nonce is marked spent before dispatch, so a timed-out first call cannot be
    retried with the same token - the caller must resolve again for a new one."""
    service = SelectorService(catalog, _incrementing_signer())
    resolved = service.resolve(
        ResolveRequest(question="detail:ka10001:current_trading", arguments={"stk_cd": "005930"})
    )
    request = _blank_request()

    with pytest.raises(RuntimeError):
        await service.call(
            CallRequest(plan_token=resolved.plan_token), request, Response(), _FailingClient()
        )

    with pytest.raises(PlanAlreadyUsedError):
        await service.call(
            CallRequest(plan_token=resolved.plan_token), request, Response(), _FailingClient()
        )


@pytest.mark.asyncio
async def test_a_fresh_resolve_for_the_same_question_calls_cleanly(catalog) -> None:
    """Asking the same question again is allowed: a new resolve mints a new nonce, so the
    resulting plan_token is unrelated to any previously spent one."""
    service = SelectorService(catalog, _incrementing_signer())
    client = _CountingClient()
    request = _blank_request()

    for _ in range(2):
        resolved = service.resolve(
            ResolveRequest(
                question="detail:ka10001:current_trading", arguments={"stk_cd": "005930"}
            )
        )
        result = await service.call(
            CallRequest(plan_token=resolved.plan_token), request, Response(), client
        )
        assert result.data["cur_prc"] == "70000"

    assert client.calls == 2


def _fixture_plan(nonce: str, *, exp: float) -> VerifiedPlan:
    return VerifiedPlan(
        operation_ref="detail:ka10001:current_trading",
        arguments={},
        cont_yn="N",
        next_key=None,
        question_hash="0" * 64,
        expires_at=datetime.fromtimestamp(exp, tz=UTC),
        account="",
        nonce=nonce,
    )


def test_consume_nonce_rejects_replay_and_sweeps_expired_entries_on_access(catalog) -> None:
    """Pruning only ever drops an entry whose own exp has passed - a token that far gone
    already fails PlanSigner.verify() before this cache is consulted, so nothing is lost
    that could still be replayed."""
    now = [1_000.0]
    signer = PlanSigner(b"selector-test-secret", clock=lambda: now[0])
    service = SelectorService(catalog, signer)

    first = _fixture_plan("a", exp=1_010.0)
    service._consume_nonce(first)
    assert "a" in service._consumed_nonces

    with pytest.raises(PlanAlreadyUsedError):
        service._consume_nonce(first)

    now[0] = 1_020.0  # past "a"'s exp
    second = _fixture_plan("b", exp=1_030.0)
    service._consume_nonce(second)
    assert "a" not in service._consumed_nonces
    assert "b" in service._consumed_nonces


def test_consume_nonce_capacity_fails_closed_without_evicting_unexpired(catalog) -> None:
    signer = PlanSigner(b"selector-test-secret", clock=lambda: 1_000.0)
    service = SelectorService(catalog, signer)
    far_future = 1_000_000.0  # never pruned within this test

    for index in range(_NONCE_CACHE_LIMIT):
        service._consume_nonce(_fixture_plan(f"n{index}", exp=far_future))
    assert len(service._consumed_nonces) == _NONCE_CACHE_LIMIT

    with pytest.raises(ReplayStateCapacityError):
        service._consume_nonce(_fixture_plan("overflow", exp=far_future))
    assert len(service._consumed_nonces) == _NONCE_CACHE_LIMIT
    assert "n0" in service._consumed_nonces
    assert "overflow" not in service._consumed_nonces
    with pytest.raises(PlanAlreadyUsedError):
        service._consume_nonce(_fixture_plan("n0", exp=far_future))


def test_expired_nonce_entries_free_replay_capacity(catalog) -> None:
    now = [1_000.0]
    signer = PlanSigner(b"selector-test-secret", clock=lambda: now[0])
    service = SelectorService(catalog, signer)
    for index in range(_NONCE_CACHE_LIMIT):
        service._consume_nonce(_fixture_plan(f"n{index}", exp=1_010.0))

    now[0] = 1_020.0
    service._consume_nonce(_fixture_plan("fresh", exp=1_030.0))
    assert tuple(service._consumed_nonces) == ("fresh",)


@pytest.mark.parametrize(
    "question",
    [
        "삼성전자 실시간 체결가 tick 스트리밍으로 받고 싶어",
        "subscribe to live NAV ticks for the KODEX 200 ETF",
        "실시간 매수/매도 호가 잔량 알려줘",
    ],
)
def test_a_realtime_question_without_explicit_intent_never_resolves_a_websocket(
    service, catalog, question: str
) -> None:
    """`auto` ranks the read surface only, so a vague realtime question must miss.

    Without this guarantee, ranking.uninformative_zone_tokens or catalog.visible_for
    could regress to leaking websocket documents onto the default surface, and a screen
    builder's ordinary question would silently open a live subscription instead of
    reading a snapshot.
    """
    websocket_refs = {
        document.operation_ref for document in catalog.visible_for(DiscoveryIntent.WEBSOCKET)
    }
    try:
        resolved = service.resolve(ResolveRequest(question=question, arguments={}))
    except (
        AmbiguousOperationError,
        InvalidArgumentsError,
        NoConfidentMatchError,
        OperationNotFoundError,
    ):
        return
    assert resolved.operation_ref not in websocket_refs


def test_a_websocket_ref_handed_to_resolve_under_query_intent_is_refused(service) -> None:
    """The intent gate is a guarantee, not a convenience the caller can route around.

    ``service.resolve`` ranks the question a second time on ``request.intent``'s
    surface, but a caller can also hand the operation directly through
    ``candidate_refs`` or ``preferred_ref``. Both entry points must honour the same
    gate as the ranked path, or a `query`-intent caller could still walk a websocket
    control frame in by naming it explicitly.
    """
    with pytest.raises(OperationNotFoundError):
        service.resolve(
            ResolveRequest(
                question="삼성전자 현재가",
                intent=DiscoveryIntent.QUERY,
                candidate_refs=["base:0B"],
            )
        )
    with pytest.raises(PreferredOperationError):
        service.resolve(
            ResolveRequest(
                question="삼성전자 현재가",
                intent=DiscoveryIntent.QUERY,
                preferred_ref="base:0B",
            )
        )


@pytest.mark.parametrize(
    ("question", "intent", "arguments"),
    [
        ("base:0B", DiscoveryIntent.QUERY, {"trnm": "REG", "grp_no": "1", "refresh": "1"}),
        ("0B", DiscoveryIntent.QUERY, {"trnm": "REG", "grp_no": "1", "refresh": "1"}),
        (
            "base:kt10000",
            DiscoveryIntent.QUERY,
            {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"},
        ),
        (
            "kt10000",
            DiscoveryIntent.WEBSOCKET,
            {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"},
        ),
        ("base:ka10001", DiscoveryIntent.WEBSOCKET, {"stk_cd": "005930"}),
        ("detail:ka10001:current_trading", DiscoveryIntent.WEBSOCKET, {"stk_cd": "005930"}),
    ],
)
def test_exact_identity_cannot_cross_the_requested_intent_surface(
    service, question: str, intent: DiscoveryIntent, arguments: dict[str, str]
) -> None:
    with pytest.raises(OperationNotFoundError):
        service.resolve(ResolveRequest(question=question, intent=intent, arguments=arguments))


@pytest.mark.parametrize(
    ("question", "intent", "arguments", "expected_ref"),
    [
        (
            "detail:ka10001:current_trading",
            DiscoveryIntent.QUERY,
            {"stk_cd": "005930"},
            "detail:ka10001:current_trading",
        ),
        (
            "kt10000",
            DiscoveryIntent.ORDER,
            {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"},
            "base:kt10000",
        ),
        (
            "0B",
            DiscoveryIntent.WEBSOCKET,
            {"trnm": "REG", "grp_no": "1", "refresh": "1"},
            "base:0B",
        ),
    ],
)
def test_exact_identity_still_resolves_inside_its_requested_intent_surface(
    service,
    question: str,
    intent: DiscoveryIntent,
    arguments: dict[str, str],
    expected_ref: str,
) -> None:
    resolved = service.resolve(
        ResolveRequest(question=question, intent=intent, arguments=arguments)
    )
    assert resolved.operation_ref == expected_ref
    assert service.signer.verify(resolved.plan_token, service.catalog).operation_ref == expected_ref


def test_describe_reports_a_renderable_fid_contract_for_every_websocket_type(
    service, catalog
) -> None:
    """A screen is built from ``response_fields``, so the FID contract must be real.

    The four-field acknowledgement envelope (``return_code``/``return_msg``/``trnm``/
    ``data``) is identical across all 23 realtime types and describes the transport,
    not the stream. If ``describe`` ever fell back to it, every websocket type would
    look the same to whatever renders a screen from the response.
    """
    envelope_aliases = {"return_code", "return_msg", "trnm", "data"}
    websocket_docs = catalog.visible_for(DiscoveryIntent.WEBSOCKET)
    assert len(websocket_docs) == 23
    for document in websocket_docs:
        description = service.describe(
            DescribeRequest(operation_ref=document.operation_ref, intent=DiscoveryIntent.WEBSOCKET)
        )
        aliases = {field.alias for field in description.response_fields}
        assert aliases, f"{document.operation_ref} advertises no realtime fields"
        assert all(field.description for field in description.response_fields)
        # Every type that streams events (all but ka10174, the condition-search
        # unregister control, whose real response *is* an acknowledgement) must not
        # be answered with the shared four-field envelope.
        if realtime_item_model(document.response_model) is not None:
            assert aliases.isdisjoint(envelope_aliases)

    current_price = service.describe(
        DescribeRequest(operation_ref="base:0B", intent=DiscoveryIntent.WEBSOCKET)
    )
    price_field = next(field for field in current_price.response_fields if field.alias == "10")
    assert price_field.description is not None
    assert price_field.description.startswith("현재가")


def test_uninformative_zone_tokens_suppresses_redundant_zones_not_discriminators(
    catalog,
) -> None:
    """The filter has to earn its name: silence shared noise, keep real signal.

    "서비스명" ("service name") is shared boilerplate on this surface: 22 of 23 types
    carry it in ``request_description`` and 23 of 23 in ``response_description``. Scored
    in both, it hands every candidate near-identical points twice over for saying
    nothing. The filter drops the redundant repetition (``response_description``, the
    lower-weighted of the two per ``_ZONE_RULES``) and keeps the other, rather than
    dropping both - see the never-empties-a-token property below for why dropping both
    is the actual regression this filter must not cause.

    "체결" is the opposite case: only base:00/0B/0H are *named* 체결 in ``title``, so it
    is exactly the token that should decide between them. Suppressing it there too would
    collapse 주문체결, 주식체결, and 주식예상체결 onto one score.
    """
    documents = catalog.visible_for(DiscoveryIntent.WEBSOCKET)
    suppressed = uninformative_zone_tokens("서비스명 체결 정보", documents)
    assert ("response_description", "서비스명") not in suppressed
    assert ("request_description", "서비스명") not in suppressed
    assert ("title", "체결") not in suppressed


def test_uninformative_zone_tokens_never_suppresses_every_zone_a_token_appears_in(
    catalog,
) -> None:
    """Suppression removes redundant *repetitions* of evidence, never the evidence itself.

    A token can be ubiquitous in every zone it occurs in at once - "websocket" is, in
    ``domain``, which is the only zone it ever appears in on this surface. Suppressing
    its one occurrence there would leave a websocket-intent question about "실시간"
    (which expands to the "websocket" synonym) matching nothing at all: this is exactly
    what emptied ``athena_search(query="주문 체결", intent=websocket)`` before this guard
    existed. This is asserted as a property over the whole surface and several queries,
    not one hand-picked example, because the failure mode is "some token, some query"
    - not one the docstring's own example would necessarily still reproduce as the
    surface's vocabulary keeps changing.
    """
    documents = catalog.visible_for(DiscoveryIntent.WEBSOCKET)
    queries = ["실시간 체결 정보 알려줘", "주문 체결", "서비스명", "국내주식 실시간 스트리밍"]
    for query in queries:
        tokens = set(tokenize(query))
        tokens.update(synonym_only_tokens(tuple(tokenize(query, korean_bigrams=False))))
        suppressed = uninformative_zone_tokens(query, documents)
        for token in tokens:
            zones_with_token = {
                zone
                for zone in _ZONE_RULES
                if any(token in _zone_tokens(document, zone) for document in documents)
            }
            if not zones_with_token:
                continue
            surviving = zones_with_token - {zone for zone, name in suppressed if name == token}
            assert surviving, f"{token!r} lost every zone for query {query!r}"

    # The single-zone case named above, pinned concretely: "websocket" only ever
    # appears in ``domain`` on this surface, so it must never be suppressed there.
    assert ("domain", "websocket") not in uninformative_zone_tokens(
        "실시간 체결 정보 알려줘", documents
    )


def test_uninformative_zone_tokens_suppresses_nothing_below_the_minimum_surface(
    catalog,
) -> None:
    """A document frequency below the minimum surface is not evidence of anything.

    Ratios computed from a handful of candidates are noise: three of five documents
    sharing a token says nothing about whether that token discriminates, so the filter
    must stay a no-op until there is enough surface to measure against.
    """
    documents = catalog.visible_for(DiscoveryIntent.WEBSOCKET)[: _MINIMUM_SURFACE - 1]
    assert len(documents) < _MINIMUM_SURFACE
    assert uninformative_zone_tokens("실시간 체결", documents) == frozenset()


def test_search_survives_suppression_for_a_two_word_realtime_question(service) -> None:
    """Regression: suppressing a token in every zone at once emptied the result set.

    ``athena_search(query="주문 체결", intent=websocket)`` returned zero results before
    the never-empties-a-token guard existed, because 주문 and 체결 each cleared the
    uninformative threshold in every zone they occurred in, leaving nothing left to
    score either candidate on. The unit-level assertions above would not have caught
    this by themselves - only the end-to-end call surfaces an empty response.
    """
    result = service.search(
        SearchRequest(query="주문 체결", intent=DiscoveryIntent.WEBSOCKET, limit=5)
    )
    assert result.results
    assert result.results[0].operation_ref == "base:00"


def test_realtime_round_trip_from_search_through_resolve_names_a_websocket_control(
    service, catalog
) -> None:
    """search -> describe -> resolve must agree on one identity for a screen to build on.

    A TR id is an identity signal (``ranking.rank_document`` awards it 3,000 points),
    so searching by id is the deterministic way to prove the three tools compose,
    independent of how the lexical scoring of a natural-language question happens to
    land. What matters here is that the same operation comes back out at every step,
    and that resolve records it as a websocket control frame rather than a read.
    """
    found = service.search(SearchRequest(query="0D", intent=DiscoveryIntent.WEBSOCKET, limit=3))
    assert found.results[0].operation_ref == "base:0D"
    assert found.results[0].kind.value == "websocket"

    description = service.describe(
        DescribeRequest(operation_ref="base:0D", intent=DiscoveryIntent.WEBSOCKET)
    )
    assert description.execution_policy == "selector_websocket_control"
    assert description.response_fields

    resolved = service.resolve(
        ResolveRequest(
            question="base:0D",
            intent=DiscoveryIntent.WEBSOCKET,
            arguments={
                "trnm": "REG",
                "grp_no": "1",
                "refresh": "1",
                "data": [{"item": "005930", "type": "0D"}],
            },
        )
    )
    assert resolved.operation_ref == "base:0D"
    plan = service.signer.verify(resolved.plan_token, service.catalog)
    assert plan.operation_ref == "base:0D"
    assert catalog.by_ref["base:0D"].kind == "websocket"
