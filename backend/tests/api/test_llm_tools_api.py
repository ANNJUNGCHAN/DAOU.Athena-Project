from __future__ import annotations

import re
from dataclasses import replace

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.dependencies import (
    get_kiwoom_ws_client,
    get_order_kiwoom_client,
    get_selector_service,
    require_kiwoom_client,
)
from athena_api.kiwoom import ResponseEnvelope
from athena_api.main import create_app
from athena_api.routing_contract import EntityKind
from athena_api.selector import (
    PlanSigner,
    SelectorService,
    TargetResolution,
    build_operation_catalog,
)
from athena_api.selector.service import _NONCE_CACHE_LIMIT


class FakeClient:
    is_ready = True

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, str], object]] = []

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, path, body, options))
        return ResponseEnvelope(
            body={"cur_prc": "70000", "ignored": "not projected"},
            cont_yn="Y",
            next_key="NEXT-1",
        )


def _identity_only_test_target_resolver(question: str) -> TargetResolution | None:
    if (
        re.search(
            r"(?<![0-9a-z가-힣])삼성전자(?![0-9a-z가-힣])",
            " ".join(question.casefold().split()),
        )
        is not None
    ):
        return TargetResolution(EntityKind.STOCK)
    return None


def _service(*, clock=None, target_resolver=_identity_only_test_target_resolver) -> SelectorService:
    signer_options = {"nonce_factory": lambda: "fixed"}
    if clock is not None:
        signer_options["clock"] = clock
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(b"api-selector-test-secret", ttl_seconds=120, **signer_options),
        target_resolver=target_resolver,
    )


def _client(
    service: SelectorService,
    upstream: FakeClient | None = None,
    settings: Settings | None = None,
) -> TestClient:
    app = create_app(settings or Settings(_env_file=None))
    app.dependency_overrides[get_selector_service] = lambda: service
    if upstream is not None:
        app.dependency_overrides[require_kiwoom_client] = lambda: upstream
    return TestClient(app)


def _resolve(client: TestClient, operation_ref: str = "detail:ka10001:current_trading"):
    return client.post(
        "/api/v1/llm/tools/resolve",
        json={"question": operation_ref, "arguments": {"stk_cd": "005930"}},
    )


def test_manifest_exposes_only_four_meta_tools_and_exact_catalog_counts() -> None:
    service = _service()
    client = _client(service)

    response = client.get("/api/v1/llm/manifest")
    assert response.status_code == 200
    manifest = response.json()
    assert manifest["catalog_version"] == service.catalog.version
    assert manifest["counts"] == {
        "total": 299,
        "generic_callable": 299,
        "discovery_only": 35,
        "hidden": 0,
    }
    assert manifest["workflow"] == [
        "athena_search",
        "athena_describe",
        "athena_resolve",
        "athena_call",
    ]
    assert [tool["name"] for tool in manifest["tools"]] == manifest["workflow"]
    assert all(tool["input_schema"] and tool["output_schema"] for tool in manifest["tools"])

    schema = client.app.openapi()
    exposed = []
    internal_kiwoom = []
    for path_item in schema["paths"].values():
        for operation in path_item.values():
            if not isinstance(operation, dict) or "operationId" not in operation:
                continue
            if operation.get("x-athena-llm-exposed") is True:
                exposed.append(operation["operationId"])
            if "x-kiwoom-tr-id" in operation:
                internal_kiwoom.append(operation)
    assert exposed == [
        "llm_search_operations",
        "llm_describe_operation",
        "llm_resolve_operation",
        "llm_call_operation",
    ]
    assert len(internal_kiwoom) == 301
    assert all(operation["x-athena-llm-exposed"] is False for operation in internal_kiwoom)


def test_openapi_reason_code_enum_keeps_existing_values_and_adds_typed_reasons() -> None:
    schema = _client(_service()).app.openapi()
    reasons = set(schema["components"]["schemas"]["ReasonCode"]["enum"])
    assert {
        "EXACT_OPERATION_REF",
        "TITLE_TOKEN_MATCH",
        "QUERY_COVERAGE",
        "EXPLICIT_DETAIL_GROUP",
        "BASE_DEFAULT",
        "DETAIL_GROUP_REQUIRED",
        "AMBIGUOUS_MARGIN",
    } < reasons
    assert {
        "TYPED_ELIGIBLE",
        "TYPED_MEASURE_MATCH",
        "TYPED_BINDING_MATCH",
        "TYPED_DETAIL_MATCH",
        "TYPED_DOMINANCE",
        "EQUIVALENCE_CANONICAL",
        "UNIQUE_EXACT_PROFILE",
        "AMBIGUOUS",
        "NO_COMPATIBLE_PROFILE",
    } <= reasons
    search_hit = schema["components"]["schemas"]["SearchHit"]["properties"]
    assert {"suggested_detail_group", "suggested_operation_ref"} <= set(search_hit)
    assert "plan_token" not in search_hit


def test_openapi_call_response_adds_bounded_canvas_context() -> None:
    schema = _client(_service()).app.openapi()
    context_ref = schema["components"]["schemas"]["CallResponse"]["properties"][
        "canvas_context"
    ]["$ref"]
    assert context_ref.endswith("/CanvasContext")
    symbol = schema["components"]["schemas"]["CanvasContext"]["properties"]["symbol"]
    assert symbol["anyOf"][0]["maxLength"] == 32


def test_matching_preferred_detail_preserves_autonomous_plan_semantics() -> None:
    service = _service()
    client = _client(service)
    payload = {
        "question": "삼성전자 오늘 주가 얼마야?",
        "arguments": {"stk_cd": "005930"},
    }
    autonomous = client.post("/api/v1/llm/tools/resolve", json=payload)
    asserted = client.post(
        "/api/v1/llm/tools/resolve",
        json={
            **payload,
            "preferred_ref": "detail:ka10001:current_trading",
            "detail_group": "current_trading",
        },
    )
    assert autonomous.status_code == asserted.status_code == 200
    assert asserted.json()["operation_ref"] == autonomous.json()["operation_ref"]
    autonomous_plan = service.signer.verify(autonomous.json()["plan_token"], service.catalog)
    asserted_plan = service.signer.verify(asserted.json()["plan_token"], service.catalog)
    assert asserted_plan.operation_ref == autonomous_plan.operation_ref
    assert asserted_plan.arguments == autonomous_plan.arguments
    assert asserted_plan.question_hash == autonomous_plan.question_hash
    assert asserted_plan.cont_yn == autonomous_plan.cont_yn
    assert asserted_plan.next_key == autonomous_plan.next_key


def test_http_search_suggestion_and_soft_candidates_share_canonical_selection() -> None:
    service = _service()
    client = _client(service)
    question = "삼성전자 오늘 주가 얼마야?"
    searched = client.post(
        "/api/v1/llm/tools/search",
        json={"query": question, "limit": 5},
    )
    assert searched.status_code == 200
    top = searched.json()["results"][0]
    assert top["operation_ref"] == "detail:ka10001:current_trading"
    assert top["confidence"] == "high"
    assert top["suggested_detail_group"] == "current_trading"
    assert top["suggested_operation_ref"] == "detail:ka10001:current_trading"

    payload = {
        "question": question,
        "arguments": {"stk_cd": "005930"},
        "candidate_refs": [
            "base:ka10019",
            "detail:ka10001:current_trading",
            "base:ka10019",
        ],
        "preferred_ref": top["operation_ref"],
        "detail_group": top["suggested_detail_group"],
    }
    resolved = client.post("/api/v1/llm/tools/resolve", json=payload)
    assert resolved.status_code == 200
    assert resolved.json()["operation_ref"] == top["suggested_operation_ref"]

    conflict = client.post(
        "/api/v1/llm/tools/resolve",
        json={
            **payload,
            "preferred_ref": "detail:ka10001:current_trading",
            "detail_group": "valuation",
        },
    )
    assert conflict.status_code == 409


def test_http_search_confidence_tracks_resolve_abstention_not_raw_score() -> None:
    client = _client(_service())
    for question in ("가격 좀 알려줘", "top ranking 조회해줘"):
        searched = client.post("/api/v1/llm/tools/search", json={"query": question, "limit": 5})
        assert searched.status_code == 200
        assert searched.json()["results"]
        assert {hit["confidence"] for hit in searched.json()["results"]} == {"low"}
        assert all("plan_token" not in hit for hit in searched.json()["results"])
        resolved = client.post("/api/v1/llm/tools/resolve", json={"question": question})
        assert resolved.status_code == 404
        assert resolved.json()["code"] == "NO_CONFIDENT_MATCH"
        assert resolved.json()["details"]["reason_codes"] == [
            "NO_COMPATIBLE_PROFILE"
        ]
        assert "plan_token" not in resolved.json()


def test_http_raw_service_rejects_unresolved_name_and_unrelated_bound_code() -> None:
    client = _client(_service(target_resolver=None))
    for question in (
        "삼성전자 오늘 주가 얼마야?",
        "아테나전자 오늘 주가 얼마야?",
    ):
        searched = client.post(
            "/api/v1/llm/tools/search",
            json={"query": question, "limit": 5},
        )
        resolved = client.post(
            "/api/v1/llm/tools/resolve",
            json={"question": question, "arguments": {"stk_cd": "005930"}},
        )

        assert searched.status_code == 200
        assert {hit["confidence"] for hit in searched.json()["results"]} == {"low"}
        assert resolved.status_code == 404
        assert resolved.json()["code"] == "NO_CONFIDENT_MATCH"
        assert "plan_token" not in resolved.json()


def test_search_describe_resolve_are_local_and_detail_call_is_one_projected_upstream() -> None:
    service = _service()
    upstream = FakeClient()
    client = _client(service, upstream)

    search = client.post(
        "/api/v1/llm/tools/search",
        json={"query": "detail:ka10001:current_trading", "intent": "query"},
    )
    assert search.status_code == 200
    assert search.json()["results"][0]["operation_ref"] == "detail:ka10001:current_trading"

    describe = client.post(
        "/api/v1/llm/tools/describe",
        json={"operation_ref": "detail:ka10001:current_trading", "intent": "query"},
    )
    assert describe.status_code == 200
    assert describe.json()["execution_policy"] == "selector_detail"
    assert upstream.calls == []

    resolved = _resolve(client)
    assert resolved.status_code == 200
    assert resolved.json()["operation_ref"] == "detail:ka10001:current_trading"
    assert upstream.calls == []

    called = client.post(
        "/api/v1/llm/tools/call",
        json={"plan_token": resolved.json()["plan_token"]},
    )
    assert called.status_code == 200
    expected_fields = {
        field.alias or name
        for name, field in service.catalog.by_ref[
            "detail:ka10001:current_trading"
        ].response_model.model_fields.items()
    }
    assert set(called.json()["data"]) == expected_fields
    assert called.json()["data"]["cur_prc"] == "70000"
    assert "ignored" not in called.json()["data"]
    # 2026-08-27 정책 확장: 시장 데이터 3도메인(charts·stockinfo·quotes)은 종목
    # 식별자를 canvas_context에 봉인한다(시세류 실시간 구독용). 등호 단언이라
    # 다른 인자가 새지 않는 것도 함께 증명된다.
    assert called.json()["canvas_context"] == {"symbol": "005930"}
    assert len(upstream.calls) == 1
    assert upstream.calls[0][0] == "ka10001"
    assert upstream.calls[0][2] == {"stk_cd": "005930"}
    assert called.json()["continuation"]["next_key"] == "NEXT-1"
    next_token = called.json()["continuation"]["next_plan_token"]
    next_plan = service.signer.verify(next_token, service.catalog)
    assert next_plan.operation_ref == "detail:ka10001:current_trading"
    assert next_plan.next_key == "NEXT-1"


def test_missing_arguments_and_unknown_fields_fail_before_upstream() -> None:
    upstream = FakeClient()
    client = _client(_service(), upstream)

    missing = client.post(
        "/api/v1/llm/tools/resolve",
        json={"question": "detail:ka10001:current_trading", "arguments": {}},
    )
    assert missing.status_code == 422
    assert missing.json()["code"] == "INVALID_ARGUMENTS"

    arbitrary = client.post(
        "/api/v1/llm/tools/search",
        json={"query": "current price", "path": "/api/v1/order/kt10000"},
    )
    assert arbitrary.status_code == 422
    unknown_candidate = client.post(
        "/api/v1/llm/tools/resolve",
        json={
            "question": "current price",
            "candidate_refs": ["detail:ka10001:not-real"],
            "arguments": {"stk_cd": "005930"},
        },
    )
    assert unknown_candidate.status_code == 404
    assert unknown_candidate.json()["code"] == "OPERATION_NOT_FOUND"
    assert upstream.calls == []


def test_plan_tamper_expiry_and_stale_catalog_are_structured_and_do_not_call() -> None:
    now = [1_000.0]
    service = _service(clock=lambda: now[0])
    upstream = FakeClient()
    client = _client(service, upstream)
    token = _resolve(client).json()["plan_token"]

    version, payload, signature = token.split(".")
    changed = ("A" if payload[0] != "A" else "B") + payload[1:]
    tampered = client.post(
        "/api/v1/llm/tools/call",
        json={"plan_token": f"{version}.{changed}.{signature}"},
    )
    assert tampered.status_code == 400
    assert tampered.json()["code"] == "INVALID_PLAN"

    stale_service = SelectorService(
        replace(service.catalog, version="sha256:stale"), service.signer
    )
    client.app.dependency_overrides[get_selector_service] = lambda: stale_service
    stale = client.post("/api/v1/llm/tools/call", json={"plan_token": token})
    assert stale.status_code == 409
    assert stale.json()["code"] == "STALE_PLAN"

    client.app.dependency_overrides[get_selector_service] = lambda: service
    now[0] = 1_121.0
    expired = client.post("/api/v1/llm/tools/call", json={"plan_token": token})
    assert expired.status_code == 410
    assert expired.json()["code"] == "EXPIRED_PLAN"
    assert upstream.calls == []


def test_replay_state_capacity_fails_closed_before_upstream_dispatch() -> None:
    service = _service()
    upstream = FakeClient()
    client = _client(service, upstream)
    token = _resolve(client).json()["plan_token"]
    service._consumed_nonces.update(
        (f"occupied-{index}", 4_000_000_000) for index in range(_NONCE_CACHE_LIMIT)
    )

    response = client.post("/api/v1/llm/tools/call", json={"plan_token": token})
    assert response.status_code == 503
    assert response.json()["code"] == "REPLAY_STATE_CAPACITY_EXCEEDED"
    assert upstream.calls == []
    assert len(service._consumed_nonces) == _NONCE_CACHE_LIMIT


ORDER_ARGS = {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
WS_ARGS = {"trnm": "REG", "grp_no": "1", "refresh": "1"}


def test_order_and_websocket_need_explicit_intent_but_are_now_resolvable() -> None:
    upstream = FakeClient()
    client = _client(_service(), upstream)

    for operation_ref, intent, arguments in (
        ("base:kt10000", "order", ORDER_ARGS),
        ("base:0G", "websocket", WS_ARGS),
    ):
        search = client.post(
            "/api/v1/llm/tools/search",
            json={"query": operation_ref.removeprefix("base:"), "intent": intent},
        )
        assert search.status_code == 200
        assert search.json()["results"][0]["operation_ref"] == operation_ref
        # Still gated behind an explicit intent, now callable once found.
        assert search.json()["results"][0]["discovery_only"] is True
        assert search.json()["results"][0]["generic_callable"] is True

        described = client.post(
            "/api/v1/llm/tools/describe",
            json={"operation_ref": operation_ref, "intent": intent},
        )
        assert described.status_code == 200
        assert described.json()["generic_callable"] is True
        assert described.json()["execution_policy"] in {
            "selector_guarded_order",
            "selector_websocket_control",
        }

        resolved = client.post(
            "/api/v1/llm/tools/resolve",
            json={"question": operation_ref, "intent": intent, "arguments": arguments},
        )
        assert resolved.status_code == 200
        assert resolved.json()["operation_ref"] == operation_ref

    # Resolving is not executing: no query client was ever touched.
    assert upstream.calls == []


def test_http_exact_identity_cannot_cross_intent_or_issue_a_plan() -> None:
    client = _client(_service())
    cases = (
        ("base:0B", "query", WS_ARGS),
        ("0B", "query", WS_ARGS),
        ("base:kt10000", "query", ORDER_ARGS),
        ("base:ka10001", "websocket", {"stk_cd": "005930"}),
        ("detail:ka10001:current_trading", "websocket", {"stk_cd": "005930"}),
    )
    for question, intent, arguments in cases:
        response = client.post(
            "/api/v1/llm/tools/resolve",
            json={"question": question, "intent": intent, "arguments": arguments},
        )
        assert response.status_code == 404
        assert response.json()["code"] == "OPERATION_NOT_FOUND"
        assert "plan_token" not in response.json()


def test_an_order_plan_still_cannot_execute_without_the_order_guards() -> None:
    """A signed plan settles which operation. The order route's guards still decide."""
    upstream = FakeClient()
    client = _client(_service(), upstream)
    token = client.post(
        "/api/v1/llm/tools/resolve",
        json={"question": "base:kt10000", "intent": "order", "arguments": ORDER_ARGS},
    ).json()["plan_token"]

    # Order API disabled for this app: the plan buys nothing.
    blocked = client.post("/api/v1/llm/tools/call", json={"plan_token": token})
    assert blocked.status_code == 503
    assert upstream.calls == []


def test_a_websocket_plan_dispatches_to_the_socket_and_returns_its_ack() -> None:
    """The control frame goes to the websocket client; events never come back here."""

    class FakeWsClient:
        is_ready = True

        def __init__(self) -> None:
            self.registered: list[tuple[str, list[str], str, str]] = []

        async def register(self, tr_id, items, *, grp_no="1", refresh="1"):
            self.registered.append((tr_id, items, grp_no, refresh))
            return {"return_code": "0", "return_msg": "OK", "trnm": "REG"}

    upstream = FakeClient()
    ws = FakeWsClient()
    client = _client(_service(), upstream)
    client.app.dependency_overrides[get_kiwoom_ws_client] = lambda: ws

    token = client.post(
        "/api/v1/llm/tools/resolve",
        json={
            "question": "base:0G",
            "intent": "websocket",
            "arguments": {"trnm": "REG", "grp_no": "1", "refresh": "1", "data": [{"type": "0G"}]},
        },
    ).json()["plan_token"]
    called = client.post("/api/v1/llm/tools/call", json={"plan_token": token})

    assert called.status_code == 200
    assert called.json()["data"]["return_code"] == "0"
    assert ws.registered == [("0G", [], "1", "1")]
    # A subscription has nothing to continue, so no follow-up plan is minted.
    assert called.json()["continuation"]["next_plan_token"] is None
    assert upstream.calls == []


def test_an_order_plan_never_mints_a_continuation_token() -> None:
    """A refreshed order plan would be a second order. Only reads continue."""

    class FakeOrderClient:
        is_ready = True

        def __init__(self) -> None:
            self.calls: list[str] = []

        async def post_with_headers(self, tr_id, path, body, options):
            self.calls.append(tr_id)
            return ResponseEnvelope(body={"return_code": "0"}, cont_yn="Y", next_key="NEXT-1")

    order = FakeOrderClient()
    client = _client(
        _service(),
        FakeClient(),
        Settings(_env_file=None, enable_order_api=True, local_bearer_token="local-test"),
    )
    client.app.dependency_overrides[get_order_kiwoom_client] = lambda: order

    token = client.post(
        "/api/v1/llm/tools/resolve",
        json={"question": "base:kt10000", "intent": "order", "arguments": ORDER_ARGS},
    ).json()["plan_token"]
    called = client.post(
        "/api/v1/llm/tools/call",
        json={"plan_token": token},
        headers={
            "Authorization": "Bearer local-test",
            "X-Athena-Confirm": "true",
            "Idempotency-Key": "llm-order-1",
        },
    )

    assert called.status_code == 200
    assert order.calls == ["kt10000"]
    # cont-yn came back "Y", and it is still refused a next plan token.
    assert called.json()["continuation"]["cont_yn"] == "Y"
    assert called.json()["continuation"]["next_plan_token"] is None


def test_a_websocket_plan_reports_a_missing_socket_rather_than_using_the_query_client() -> None:
    upstream = FakeClient()
    client = _client(_service(), upstream)
    token = client.post(
        "/api/v1/llm/tools/resolve",
        json={"question": "base:0G", "intent": "websocket", "arguments": WS_ARGS},
    ).json()["plan_token"]

    blocked = client.post("/api/v1/llm/tools/call", json={"plan_token": token})
    assert blocked.status_code == 503
    # The control frame must never be smuggled onto the HTTP query client.
    assert upstream.calls == []


def test_oauth_unknown_us_and_arbitrary_identity_are_indistinguishable() -> None:
    client = _client(_service())
    responses = [
        client.post(
            "/api/v1/llm/tools/describe",
            json={"operation_ref": operation_ref, "intent": "query"},
        )
        for operation_ref in (
            "base:au10001",
            "base:not-a-real-operation",
            "base:HHDFS00000300",
            "/api/v1/tr/stockinfo/ka10001",
        )
    ]
    assert {response.status_code for response in responses} == {404}
    assert len({response.text for response in responses}) == 1
    assert responses[0].json()["code"] == "OPERATION_NOT_FOUND"


def test_call_without_query_credentials_is_503_after_local_resolution() -> None:
    client = _client(_service())
    resolved = _resolve(client)
    assert resolved.status_code == 200

    response = client.post(
        "/api/v1/llm/tools/call",
        json={"plan_token": resolved.json()["plan_token"]},
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "Kiwoom data service is not ready"}
