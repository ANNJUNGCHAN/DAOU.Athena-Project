from __future__ import annotations

from dataclasses import replace

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.dependencies import get_selector_service, require_kiwoom_client
from athena_api.kiwoom import ResponseEnvelope
from athena_api.main import create_app
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog


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


def _service(*, clock=None) -> SelectorService:
    signer_options = {"nonce_factory": lambda: "fixed"}
    if clock is not None:
        signer_options["clock"] = clock
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(b"api-selector-test-secret", ttl_seconds=120, **signer_options),
    )


def _client(service: SelectorService, upstream: FakeClient | None = None) -> TestClient:
    app = create_app(Settings(_env_file=None))
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
        "total": 323,
        "generic_callable": 286,
        "discovery_only": 35,
        "hidden": 2,
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
    assert len(internal_kiwoom) == 323
    assert all(operation["x-athena-llm-exposed"] is False for operation in internal_kiwoom)


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
        json={"question": "base:ka10001", "arguments": {}},
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


def test_order_and_websocket_are_discovery_only_and_generic_call_is_forbidden() -> None:
    upstream = FakeClient()
    client = _client(_service(), upstream)

    for operation_ref, intent in (("base:kt10000", "order"), ("base:0G", "websocket")):
        search = client.post(
            "/api/v1/llm/tools/search",
            json={"query": operation_ref.removeprefix("base:"), "intent": intent},
        )
        assert search.status_code == 200
        assert search.json()["results"][0]["operation_ref"] == operation_ref
        assert search.json()["results"][0]["discovery_only"] is True
        described = client.post(
            "/api/v1/llm/tools/describe",
            json={"operation_ref": operation_ref, "intent": intent},
        )
        assert described.status_code == 200
        assert described.json()["generic_callable"] is False
        forbidden = client.post(
            "/api/v1/llm/tools/resolve", json={"question": operation_ref}
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["code"] == "OPERATION_NOT_GENERIC_CALLABLE"
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
