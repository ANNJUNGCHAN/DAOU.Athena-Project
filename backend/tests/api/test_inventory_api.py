from __future__ import annotations

import asyncio
import hashlib
import json
import socket
import subprocess
import sys
import threading
from pathlib import Path
from typing import get_origin

import httpx
import pytest
import uvicorn
from fastapi import HTTPException, Request, Response
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from athena_api.api.stream import kiwoom_real_stream
from athena_api.api.ws_auth import _valid_bearer
from athena_api.config import Settings
from athena_api.dependencies import (
    require_kiwoom_client,
    require_kiwoom_ws_client,
    require_order_kiwoom_client,
    require_token_manager,
)
from athena_api.errors import KiwoomApiError
from athena_api.generated import models
from athena_api.generated.registry import (
    ALL_TR_IDS,
    DETAIL_REGISTRY,
    INVENTORY_COUNTS,
    KA10007_DETAIL_MANIFEST,
    OAUTH_TR_IDS,
    ORDER_TR_IDS,
    OUTPUT_PROFILE,
    OUTPUT_PROFILE_BY_ID,
    QUERY_TR_IDS,
    RESPONSE_PROJECTION_BY_TR_ID,
    SPLIT_BASE_TR_IDS,
    TR_REGISTRY,
    WEBSOCKET_TR_IDS,
)
from athena_api.generated.routes import router as generated_router
from athena_api.generated.runtime import OrderReservation, OrderState, call_order_tr
from athena_api.kiwoom import KiwoomWsError, ResponseEnvelope
from athena_api.main import create_app

BACKEND = Path(__file__).resolve().parents[2]


class FakeClient:
    is_ready = True

    def __init__(self, body: dict[str, str] | None = None) -> None:
        self.body = body if body is not None else {"return_code": "0"}
        self.calls: list[tuple[str, str, dict[str, str], object]] = []

    async def post_with_headers(self, tr_id: str, path: str, body: dict[str, str], options: object):
        self.calls.append((tr_id, path, body, options))
        return ResponseEnvelope(body=self.body, cont_yn="Y", next_key="NEXT-1")


class FakeWsClient:
    is_ready = True

    def __init__(self) -> None:
        self.executed: list[tuple[str, dict[str, object]]] = []
        self.registered: list[tuple[str, list[str]]] = []
        self.removed: list[tuple[str, list[str]]] = []
        self.registered_options: list[tuple[str, str, str]] = []
        self.removed_options: list[tuple[str, str, str]] = []
        self.queues: list[asyncio.Queue[dict[str, object]]] = []
        self.next_event: dict[str, object] | None = None
        self.unsubscribed_event = threading.Event()

    async def execute(self, tr_id: str, payload: dict[str, object]) -> dict[str, object]:
        self.executed.append((tr_id, payload))
        if tr_id == "ka10171":
            return {
                "return_code": "0",
                "trnm": "CNSRLST",
                "data": [{"seq": "1", "name": "condition"}],
            }
        return {"return_code": "0"}

    async def register(
        self, tr_id: str, items: list[str], *, grp_no: str = "1", refresh: str = "1"
    ) -> dict[str, object]:
        self.registered.append((tr_id, items))
        self.registered_options.append((tr_id, grp_no, refresh))
        return {"return_code": "0"}

    async def remove(
        self, tr_id: str, items: list[str], *, grp_no: str = "1", refresh: str = "1"
    ) -> dict[str, object]:
        self.removed.append((tr_id, items))
        self.removed_options.append((tr_id, grp_no, refresh))
        return {"return_code": "0"}

    def subscribe_events(self) -> asyncio.Queue[dict[str, object]]:
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        if self.next_event is not None:
            queue.put_nowait(self.next_event)
        self.queues.append(queue)
        return queue

    def unsubscribe_events(self, queue: asyncio.Queue[dict[str, object]]) -> None:
        self.queues.remove(queue)
        self.unsubscribed_event.set()


def test_inventory_partition_and_static_openapi_coverage() -> None:
    assert INVENTORY_COUNTS == {"oauth": 2, "query": 171, "order": 12, "websocket": 23}
    assert len(ALL_TR_IDS) == len(TR_REGISTRY) == 208
    assert QUERY_TR_IDS | ORDER_TR_IDS | WEBSOCKET_TR_IDS | OAUTH_TR_IDS == ALL_TR_IDS
    assert not (QUERY_TR_IDS & ORDER_TR_IDS or QUERY_TR_IDS & WEBSOCKET_TR_IDS)

    schema = create_app(Settings()).openapi()
    operation_ids: list[str] = []
    base_tr_ids: list[str] = []
    llm_exposed: list[str] = []
    for path_item in schema["paths"].values():
        for method, operation in path_item.items():
            if method not in {"get", "post"}:
                continue
            operation_ids.append(operation["operationId"])
            if operation.get("x-athena-llm-exposed") is True:
                llm_exposed.append(operation["operationId"])
            if "x-kiwoom-tr-id" in operation and "x-athena-detail-group" not in operation:
                base_tr_ids.append(operation["x-kiwoom-tr-id"])
            if "x-kiwoom-tr-id" in operation:
                assert operation["x-athena-llm-exposed"] is False
    assert len(operation_ids) == len(set(operation_ids))
    # 이 숫자는 표면이 조용히 늘거나 주는 것을 눈에 띄게 하려고 박아둔 값이므로,
    # 무엇이 왜 늘었는지 적지 않고 숫자만 고치면 이 테스트가 하는 일이 없어진다.
    # 336 = 334 + 그래프 브렌치 병합(2026-08-27)의 2개: get_brain_entity_timeline
    # (§10-4 엔티티 타임라인) · set_expose_to_model(그래프 노출 게이트, settings.py).
    # 347 = 346 + Selector one-shot dispatch 1개 — 앱의 카드 hot path가
    # 모델 왕복 없이 select/validate/call/render를 한 HTTP 요청으로 끝낸다.
    # (pause/resume/ack/catchup_fire/runs)·예약 브리핑(briefing_budget/
    # briefing_result)·계측(engagement)·말걸기 가드(nudge_guard get/post).
    assert len(operation_ids) == 347
    assert "canvas_chart_page" in operation_ids
    assert "canvas_series_page" in operation_ids
    assert "get_internal_oauth_status" in operation_ids
    for added in (
        "get_brain_god_nodes",
        "get_brain_surprising_connections",
        "get_brain_suggested_questions",
        "get_brain_graph_diff",
        "get_brain_cluster_map",
        "get_brain_entity_timeline",
        "set_expose_to_model",
    ):
        assert added in operation_ids, f"{added}가 표면에서 사라졌다"
    manifest = json.loads(
        (BACKEND / "ref" / "kiwoom-common-screen-manifest.json").read_text(encoding="utf-8")
    )
    assert manifest["counts"]["routable"] == 301
    assert len(generated_router.routes) == 301
    assert set(llm_exposed) == {
        "llm_search_operations",
        "llm_describe_operation",
        "llm_resolve_operation",
        "llm_call_operation",
    }
    assert len(base_tr_ids) == 186
    assert set(base_tr_ids) == ALL_TR_IDS - SPLIT_BASE_TR_IDS
    # Every split family is still reachable, through its projections rather than its base.
    assert SPLIT_BASE_TR_IDS <= {DETAIL_REGISTRY[ref].tr_id for ref in DETAIL_REGISTRY}


def test_catalog_exposes_only_callable_generated_operations() -> None:
    client = TestClient(create_app(Settings()))

    profile_response = client.get("/api/v1/catalog/output-profile")
    assert profile_response.status_code == 200
    assert profile_response.json() == OUTPUT_PROFILE

    catalog_response = client.get("/api/v1/catalog")
    assert catalog_response.status_code == 200
    catalog = catalog_response.json()
    assert catalog["counts"] == {
        "query": 264,
        "order": 12,
        "websocket": 23,
        "oauth": 2,
        "base": 186,
        "detail": 115,
        "total": 301,
    }
    assert catalog["output_profile"] == {
        "operation_count": OUTPUT_PROFILE["operation_count"],
        "shape_counts": OUTPUT_PROFILE["shape_counts"],
        "distributions": OUTPUT_PROFILE["distributions"],
        "policy": OUTPUT_PROFILE["policy"],
    }
    operations = {
        operation["operation_ref"]: operation for operation in catalog["operations"]
    }
    assert len(operations) == 301
    assert len({ref for ref in operations if ref.startswith("base:")}) == 186
    assert len({ref for ref in operations if ref.startswith("detail:")}) == 115
    assert not {f"base:{tr_id}" for tr_id in SPLIT_BASE_TR_IDS}.intersection(
        operations
    )

    for operation_ref, metadata in operations.items():
        tr_id = metadata["tr_id"]
        assert metadata["operation_ref"] == operation_ref
        if operation_ref.startswith("base:"):
            assert metadata["output_profile"] == OUTPUT_PROFILE_BY_ID[tr_id]
        else:
            detail = DETAIL_REGISTRY[operation_ref]
            assert "output_profile" not in metadata
            assert metadata["response_field_count"] == len(
                detail.response_model.model_fields
            )
            assert metadata["response_schema"] == detail.response_model.model_json_schema()

    detail_ref = "detail:ka10007:identity"
    assert detail_ref in operations
    assert operations[detail_ref]["group_id"] == "identity"
    for operation_ref in (detail_ref, "base:00"):
        detail_response = client.get(f"/api/v1/catalog/{operation_ref}")
        assert detail_response.status_code == 200
        assert detail_response.json() == operations[operation_ref]
    for tr_id in SPLIT_BASE_TR_IDS:
        assert client.get(f"/api/v1/catalog/{tr_id}").status_code == 404
        assert client.get(f"/api/v1/catalog/base:{tr_id}").status_code == 404
    assert client.get("/api/v1/catalog/not-a-tr").status_code == 404


def _projection_response_body(tr_id: str) -> dict[str, object]:
    body: dict[str, object] = {}
    for name, field in TR_REGISTRY[tr_id].response_model.model_fields.items():
        alias = field.alias or name
        body[alias] = [] if get_origin(field.annotation) is list else f"value-{alias}"
    return body


def _request_body(tr_id: str) -> dict[str, str]:
    return {
        field.alias or name: f"input-{field.alias or name}"
        for name, field in TR_REGISTRY[tr_id].request_model.model_fields.items()
    }


def test_all_projection_routes_have_exact_openapi_contract_and_query_only_scope() -> None:
    schema = create_app(Settings()).openapi()
    projection_ids = set(RESPONSE_PROJECTION_BY_TR_ID)
    assert projection_ids == set(OUTPUT_PROFILE["policy"]["detail_candidates"])
    assert projection_ids <= QUERY_TR_IDS
    assert not projection_ids & (ORDER_TR_IDS | WEBSOCKET_TR_IDS | OAUTH_TR_IDS)
    assert len(DETAIL_REGISTRY) == 115

    detail_operations: list[str] = []
    detail_paths: set[str] = set()
    for tr_id, projection in RESPONSE_PROJECTION_BY_TR_ID.items():
        spec = TR_REGISTRY[tr_id]
        assert spec.kind == "query"
        for group in projection["groups"]:
            path = f"/api/v1/tr/{spec.domain}/{tr_id}/detail/{group['id']}"
            operation = schema["paths"][path]["post"]
            detail_paths.add(path)
            detail_operations.append(operation["operationId"])
            assert operation["x-kiwoom-tr-id"] == tr_id
            assert operation["x-athena-detail-group"] == group["id"]

    assert len(detail_paths) == 115
    assert len(detail_operations) == len(set(detail_operations)) == 115
    assert not any(
        "/detail/" in path
        for path in schema["paths"]
        if path.startswith(("/api/v1/order/", "/api/v1/websocket/", "/api/v1/internal/oauth/"))
    )


@pytest.mark.asyncio
async def test_all_candidate_base_and_projection_routes_preserve_runtime_contracts() -> None:
    fake = FakeClient()
    app = create_app(Settings())
    endpoints = {
        route.path: route.endpoint
        for route in generated_router.routes
        if hasattr(route, "endpoint") and hasattr(route, "path")
    }

    for tr_id, projection in RESPONSE_PROJECTION_BY_TR_ID.items():
        spec = TR_REGISTRY[tr_id]
        request_body = _request_body(tr_id)
        response_body = _projection_response_body(tr_id)
        fake.body = response_body
        payload = spec.request_model.model_validate(request_body)
        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/",
                "app": app,
                "headers": [(b"cont-yn", b"Y"), (b"next-key", b"INPUT-NEXT")],
            }
        )

        # The base route is gone: these families are served only through projections.
        assert f"/api/v1/tr/{spec.domain}/{tr_id}" not in endpoints

        for group in projection["groups"]:
            fake.calls.clear()
            detail_path = f"/api/v1/tr/{spec.domain}/{tr_id}/detail/{group['id']}"
            response = await endpoints[detail_path](
                payload, request, Response(), fake
            )
            assert set(response.model_dump(by_alias=True)) == set(group["fields"])
            assert len(fake.calls) == 1
            assert fake.calls[0][:3] == (tr_id, spec.upstream_path, request_body)
            assert (fake.calls[0][3].cont_yn, fake.calls[0][3].next_key) == (
                "Y",
                "INPUT-NEXT",
            )

    numeric_aliases = RESPONSE_PROJECTION_BY_TR_ID["ka10001"]["groups"][2]["fields"]
    assert "250hgst" in numeric_aliases
    fake.body = _projection_response_body("ka10001")
    numeric_payload = TR_REGISTRY["ka10001"].request_model.model_validate(
        {"stk_cd": "005930"}
    )
    numeric_response = await endpoints[
        "/api/v1/tr/stockinfo/ka10001/detail/price_range"
    ](
        numeric_payload,
        Request({"type": "http", "method": "POST", "path": "/", "app": app, "headers": []}),
        Response(),
        fake,
    )
    numeric_body = numeric_response.model_dump(by_alias=True)
    assert set(numeric_body) == set(numeric_aliases)
    assert numeric_body["250hgst"] == "value-250hgst"


def _websocket_payload(tr_id: str, command: str = "REG") -> dict[str, object]:
    if tr_id == "ka10171":
        return {"trnm": "CNSRLST"}
    if tr_id == "ka10172":
        return {"trnm": "CNSRREQ", "seq": "1", "search_type": "0", "stex_tp": "K"}
    if tr_id == "ka10173":
        return {"trnm": "CNSRREQ", "seq": "1", "search_type": "1", "stex_tp": "K"}
    if tr_id == "ka10174":
        return {"trnm": "CNSRCLR", "seq": "1"}
    return {
        "trnm": command,
        "grp_no": "1",
        "refresh": "1",
        "data": [{"item": "005930", "type": tr_id}],
    }


def test_all_websocket_inventory_routes_use_only_ws_dependency() -> None:
    ws_client = FakeWsClient()
    http_client = FakeClient()
    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: ws_client
    app.dependency_overrides[require_kiwoom_client] = lambda: http_client
    client = TestClient(app)

    for tr_id in sorted(WEBSOCKET_TR_IDS):
        response = client.post(f"/api/v1/websocket/{tr_id}", json=_websocket_payload(tr_id))
        assert response.status_code == 200, (tr_id, response.text)

    condition_ids = {tr_id for tr_id, _ in ws_client.executed}
    assert condition_ids == {"ka10171", "ka10172", "ka10173", "ka10174"}
    assert {tr_id for tr_id, _ in ws_client.registered} == WEBSOCKET_TR_IDS - condition_ids
    assert ("0g", ["005930"]) in ws_client.registered
    assert ("0G", ["005930"]) in ws_client.registered
    assert http_client.calls == []

    remove = client.post("/api/v1/websocket/0D", json=_websocket_payload("0D", "REMOVE"))
    assert remove.status_code == 200
    assert ws_client.removed == [("0D", ["005930"])]

    custom = client.post(
        "/api/v1/websocket/0D",
        json={
            "trnm": "REG",
            "grp_no": "7",
            "refresh": "0",
            "data": [{"item": "005930", "type": "0D"}],
        },
    )
    assert custom.status_code == 200
    assert ws_client.registered_options[-1] == ("0D", "7", "0")


def test_websocket_condition_mapping_case_safety_metadata_and_missing_credentials() -> None:
    ws_client = FakeWsClient()
    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: ws_client
    client = TestClient(app)

    condition = client.post("/api/v1/websocket/ka10171", json={"trnm": "CNSRLST"})
    assert condition.status_code == 200
    assert condition.json()["data"] == [{"seq": "1", "name": "condition"}]

    wrong_case = client.post(
        "/api/v1/websocket/0g",
        json={
            "trnm": "REG",
            "grp_no": "1",
            "refresh": "1",
            "data": [{"item": "005930", "type": "0G"}],
        },
    )
    assert wrong_case.status_code == 422
    assert "lowercase 0g is distinct from uppercase 0G" in wrong_case.text

    schema = app.openapi()
    operation = schema["paths"]["/api/v1/websocket/0g"]["post"]
    assert operation["x-athena-upstream-transport"] == "wss"
    assert operation["x-athena-case-sensitive-note"] == "0g is lowercase and distinct from 0G"
    for tr_id in WEBSOCKET_TR_IDS:
        metadata = schema["paths"][f"/api/v1/websocket/{tr_id}"]["post"]
        assert metadata["x-athena-upstream-transport"] == "wss"
        assert metadata["x-athena-operation-kind"] == "websocket"
    assert "/api/v1/raw/websocket/{tr_id}" not in schema["paths"]

    unavailable = TestClient(create_app(Settings())).post(
        "/api/v1/websocket/ka10171", json={"trnm": "CNSRLST"}
    )
    assert unavailable.status_code == 503


def test_websocket_numeric_success_is_normalized_before_generated_model() -> None:
    class NumericWsClient(FakeWsClient):
        async def execute(self, tr_id: str, payload: dict[str, object]) -> dict[str, object]:
            self.executed.append((tr_id, payload))
            return {"return_code": 0, "trnm": "CNSRREQ"}

    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: NumericWsClient()
    response = TestClient(app).post(
        "/api/v1/websocket/ka10173",
        json={"trnm": "CNSRREQ", "seq": "1", "search_type": "1", "stex_tp": "K"},
    )
    assert response.status_code == 200
    assert response.json()["return_code"] == "0"


def test_websocket_transport_error_is_mapped_to_secret_safe_502() -> None:
    class FailingWsClient(FakeWsClient):
        async def execute(self, tr_id: str, payload: dict[str, object]) -> dict[str, object]:
            del tr_id, payload
            raise KiwoomWsError("secret-bearing-upstream-detail")

    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: FailingWsClient()
    response = TestClient(app).post(
        "/api/v1/websocket/ka10171", json={"trnm": "CNSRLST"}
    )
    assert response.status_code == 502
    assert response.json() == {"detail": "Kiwoom WebSocket upstream request failed"}
    assert "secret-bearing-upstream-detail" not in response.text


@pytest.mark.parametrize("result", [None, {}, {"return_code": "   ", "trnm": "CNSRREQ"}])
def test_websocket_missing_or_blank_return_code_is_not_success(
    result: dict[str, object] | None,
) -> None:
    class InvalidWsClient(FakeWsClient):
        async def execute(
            self, tr_id: str, payload: dict[str, object]
        ) -> dict[str, object] | None:
            self.executed.append((tr_id, payload))
            return result

    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: InvalidWsClient()
    response = TestClient(app).post(
        "/api/v1/websocket/ka10173",
        json={"trnm": "CNSRREQ", "seq": "1", "search_type": "1", "stex_tp": "K"},
    )
    assert response.status_code == 502
    assert response.json() == {"detail": "Kiwoom WebSocket response was invalid"}


def test_downstream_real_stream_requires_auth_before_fanout() -> None:
    ws_client = FakeWsClient()
    ws_client.next_event = {"trnm": "REAL", "data": [{"item": "005930", "value": "1"}]}
    app = create_app(Settings(local_bearer_token="stream-secret", _env_file=None))
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: ws_client

    with TestClient(app) as client:
        with client.websocket_connect("/api/v1/ws/stream") as stream:
            stream.send_json({"type": "auth", "token": "stream-secret"})
            assert stream.receive_json() == ws_client.next_event
            stream.close()
            assert ws_client.unsubscribed_event.wait(timeout=1)
        assert ws_client.queues == []

        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect("/api/v1/ws/stream") as stream:
                stream.send_json({"type": "auth", "token": "wrong"})
                stream.receive_json()
        assert closed.value.code == 1008
        assert ws_client.queues == []


@pytest.mark.parametrize("payload", [[], "scalar", None, 7])
def test_downstream_stream_rejects_non_object_auth_frames(payload: object) -> None:
    ws_client = FakeWsClient()
    app = create_app(Settings(local_bearer_token="stream-secret", _env_file=None))
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: ws_client

    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect("/api/v1/ws/stream") as stream:
                stream.send_json(payload)
                stream.receive_json()
        assert closed.value.code == 1008
    assert ws_client.queues == []


def test_downstream_stream_rejects_malformed_json_auth_frame() -> None:
    ws_client = FakeWsClient()
    app = create_app(Settings(local_bearer_token="stream-secret", _env_file=None))
    app.dependency_overrides[require_kiwoom_ws_client] = lambda: ws_client

    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect("/api/v1/ws/stream") as stream:
                stream.send_text("{")
                stream.receive_json()
        assert closed.value.code == 1008
    assert ws_client.queues == []


@pytest.mark.parametrize("expected", ["", "   "])
@pytest.mark.parametrize("authorization", ["Bearer ", "Bearer    ", "Bearer token"])
def test_stream_bearer_validation_rejects_blank_expected(
    expected: str, authorization: str
) -> None:
    assert _valid_bearer(authorization, expected) is False


@pytest.mark.parametrize(
    ("configured, authorization, first_frame"),
    [
        ("", None, {"type": "auth", "token": ""}),
        ("   ", None, {"type": "auth", "token": "   "}),
        ("\t", "Bearer ", None),
        ("\r\n", "Bearer    ", None),
    ],
)
def test_remote_stream_with_blank_token_configuration_fails_closed_before_subscribe(
    configured: str,
    authorization: str | None,
    first_frame: dict[str, str] | None,
) -> None:
    class RemoteWebSocket:
        def __init__(self) -> None:
            self.app = create_app(Settings(local_bearer_token=configured, _env_file=None))
            self.client = type("ClientAddress", (), {"host": "203.0.113.10"})()
            self.headers = {"authorization": authorization} if authorization is not None else {}
            self.closed_code: int | None = None
            self.received = False

        async def accept(self) -> None:
            return None

        async def receive_json(self) -> dict[str, str] | None:
            self.received = True
            return first_frame

        async def close(self, code: int) -> None:
            self.closed_code = code

    websocket = RemoteWebSocket()
    ws_client = FakeWsClient()
    asyncio.run(kiwoom_real_stream(websocket, ws_client))  # type: ignore[arg-type]
    assert websocket.closed_code == 1008
    assert ws_client.queues == []


def test_blank_configured_token_keeps_http_order_and_oauth_fail_closed() -> None:
    order = FakeClient()

    class Manager:
        async def issue(self):
            return {"configured": True, "ready": True, "expires_at": None}

    app = create_app(
        Settings(enable_order_api=True, local_bearer_token="   ", _env_file=None)
    )
    app.dependency_overrides[require_order_kiwoom_client] = lambda: order
    app.dependency_overrides[require_token_manager] = Manager
    client = TestClient(app)
    order_response = client.post(
        "/api/v1/order/kt10000",
        json={"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"},
        headers={
            "Authorization": "Bearer arbitrary",
            "X-Athena-Confirm": "true",
            "Idempotency-Key": "blank-config",
        },
    )
    oauth_response = client.post(
        "/api/v1/internal/oauth/au10001",
        json={},
        headers={"Authorization": "Bearer arbitrary"},
    )
    assert order_response.status_code == 401
    assert oauth_response.status_code == 401
    assert order.calls == []

def test_downstream_real_stream_treats_cancelled_receive_as_disconnect() -> None:
    class CancelledReceiveWebSocket:
        def __init__(self) -> None:
            self.app = create_app(Settings(_env_file=None))
            self.client = type("ClientAddress", (), {"host": "testclient"})()
            self.headers: dict[str, str] = {}
            self.accepted = False

        async def accept(self) -> None:
            self.accepted = True

        async def receive(self) -> dict[str, object]:
            raise asyncio.CancelledError

        async def send_json(self, _message: dict[str, object]) -> None:
            raise AssertionError("cancelled downstream must not receive fanout")

        async def close(self, *, code: int) -> None:
            raise AssertionError(f"loopback downstream should not close with {code}")

    ws_client = FakeWsClient()
    websocket = CancelledReceiveWebSocket()

    asyncio.run(kiwoom_real_stream(websocket, ws_client))  # type: ignore[arg-type]

    assert websocket.accepted is True
    assert ws_client.queues == []


def test_downstream_real_stream_cleans_children_on_endpoint_cancellation() -> None:
    class HangingReceiveWebSocket:
        def __init__(self) -> None:
            self.app = create_app(Settings(_env_file=None))
            self.client = type("ClientAddress", (), {"host": "testclient"})()
            self.headers: dict[str, str] = {}
            self.receive_started = asyncio.Event()

        async def accept(self) -> None:
            pass

        async def receive(self) -> dict[str, object]:
            self.receive_started.set()
            await asyncio.Future()
            raise AssertionError("unreachable")

        async def send_json(self, _message: dict[str, object]) -> None:
            raise AssertionError("hanging downstream must not receive fanout")

        async def close(self, *, code: int) -> None:
            raise AssertionError(f"loopback downstream should not close with {code}")

    async def cancel_endpoint() -> None:
        ws_client = FakeWsClient()
        websocket = HangingReceiveWebSocket()
        endpoint = asyncio.create_task(
            kiwoom_real_stream(  # type: ignore[arg-type]
                websocket, ws_client
            )
        )
        await websocket.receive_started.wait()

        endpoint.cancel()
        with pytest.raises(asyncio.CancelledError):
            await endpoint

        assert ws_client.queues == []
        current = asyncio.current_task()
        live_children = [
            task
            for task in asyncio.all_tasks()
            if task is not current and not task.done()
        ]
        assert live_children == []

    asyncio.run(cancel_endpoint())


def test_docs_and_openapi_are_accessible_without_upstream_credentials() -> None:
    client = TestClient(create_app(Settings()))
    assert client.get("/docs").status_code == 200
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert response.json()["paths"]["/api/v1/batch"]["post"]["operationId"] == "post_tr_batch"


def test_batch_is_bounded_ordered_isolated_and_preserves_continuation() -> None:
    class BatchClient:
        is_ready = True

        def __init__(self) -> None:
            self.active = 0
            self.peak = 0
            self.calls: list[str] = []
            self.options: list[object] = []

        async def post_with_headers(self, tr_id, _path, body, options):
            self.active += 1
            self.peak = max(self.peak, self.active)
            self.calls.append(tr_id)
            self.options.append(options)
            try:
                await asyncio.sleep(body["delay"])
                if body.get("fail"):
                    raise KiwoomApiError("900", "secret upstream detail", 500)
                return ResponseEnvelope(
                    body={"marker": body["marker"]},
                    cont_yn="Y" if body["marker"] == 0 else "N",
                    next_key="NEXT" if body["marker"] == 0 else None,
                )
            finally:
                self.active -= 1

    fake = BatchClient()
    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_client] = lambda: fake
    items = [
        {
            "tr_id": "ka10006",
            "body": {"marker": index, "delay": (9 - index) / 1000, "fail": index == 4},
            "cont_yn": "Y" if index == 0 else "N",
            "next_key": "INPUT" if index == 0 else None,
        }
        for index in range(10)
    ]
    response = TestClient(app).post("/api/v1/batch", json={"items": items})
    assert response.status_code == 200
    results = response.json()["results"]
    assert fake.peak == 5
    assert [result.get("body", {}).get("marker") for result in results if result["ok"]] == [
        0,
        1,
        2,
        3,
        5,
        6,
        7,
        8,
        9,
    ]
    assert results[0]["cont_yn"] == "Y" and results[0]["next_key"] == "NEXT"
    assert (fake.options[0].cont_yn, fake.options[0].next_key) == ("Y", "INPUT")
    assert results[4] == {
        "tr_id": "ka10006",
        "ok": False,
        "body": None,
        "cont_yn": "N",
        "next_key": None,
        "error": {"detail": "Kiwoom upstream request failed", "code": "900"},
    }
    assert "secret upstream detail" not in response.text

    rejected_order = TestClient(app).post(
        "/api/v1/batch", json={"items": [{"tr_id": "kt10000", "body": {}}]}
    )
    rejected_websocket = TestClient(app).post(
        "/api/v1/batch", json={"items": [{"tr_id": "0D", "body": {}}]}
    )
    assert rejected_order.status_code == 422
    assert rejected_websocket.status_code == 422
    assert len(fake.calls) == 10


def test_batch_does_not_mask_unexpected_programming_errors() -> None:
    class BrokenClient:
        is_ready = True

        async def post_with_headers(self, *_args, **_kwargs):
            raise RuntimeError("unexpected programming error")

    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_client] = BrokenClient
    response = TestClient(app, raise_server_exceptions=False).post(
        "/api/v1/batch",
        json={"items": [{"tr_id": "ka10006", "body": {}}]},
    )
    assert response.status_code == 500


def test_raw_query_preserves_body_and_continuation_headers() -> None:
    fake = FakeClient({"return_code": "0", "opaque": "unchanged"})
    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_client] = lambda: fake
    response = TestClient(app).post(
        "/api/v1/raw/tr/ka10006",
        json={"stk_cd": "005930"},
        headers={"cont-yn": "Y", "next-key": "PREVIOUS"},
    )
    assert response.status_code == 200
    assert response.json() == {"return_code": "0", "opaque": "unchanged"}
    assert response.headers["cont-yn"] == "Y"
    assert response.headers["next-key"] == "NEXT-1"
    assert fake.calls[0][:3] == (
        "ka10006",
        TR_REGISTRY["ka10006"].upstream_path,
        {"stk_cd": "005930"},
    )
    options = fake.calls[0][3]
    assert (options.cont_yn, options.next_key) == ("Y", "PREVIOUS")


def test_generic_raw_route_cannot_reach_order_or_websocket_operations() -> None:
    fake = FakeClient()
    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_client] = lambda: fake
    client = TestClient(app)
    assert client.post("/api/v1/raw/tr/kt10000", json={}).status_code == 404
    assert client.post("/api/v1/raw/tr/0D", json={}).status_code == 404
    assert fake.calls == []


def test_raw_and_batch_cannot_reach_a_split_base_behind_the_typed_route() -> None:
    """Removing the typed base route is only real if the passthroughs close too.

    Both allowlists are built from READ_TR_IDS, so a split family is unreachable by
    every HTTP door rather than just the one that was deleted.
    """
    fake = FakeClient()
    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_client] = lambda: fake
    client = TestClient(app)

    for tr_id in sorted(SPLIT_BASE_TR_IDS):
        raw = client.post(f"/api/v1/raw/tr/{tr_id}", json={})
        assert raw.status_code == 404, tr_id
        assert raw.json()["detail"] == "Query TR is served through its detail projections"

        batch = client.post("/api/v1/batch", json={"items": [{"tr_id": tr_id, "body": {}}]})
        assert batch.status_code == 422, tr_id

    assert fake.calls == []

    # An unsplit family still passes through both doors untouched.
    assert client.post("/api/v1/raw/tr/ka10006", json={}).status_code == 200
    assert (
        client.post(
            "/api/v1/batch", json={"items": [{"tr_id": "ka10006", "body": {}}]}
        ).status_code
        == 200
    )


def test_order_requires_guards_and_idempotency_prevents_duplicate_submission() -> None:
    fake = FakeClient()
    app = create_app(Settings(enable_order_api=True, local_bearer_token="local-test"))
    app.dependency_overrides[require_order_kiwoom_client] = lambda: fake
    client = TestClient(app)
    payload = {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}

    assert client.post("/api/v1/order/kt10000", json=payload).status_code == 422
    assert fake.calls == []
    headers = {
        "Authorization": "Bearer local-test",
        "X-Athena-Confirm": "true",
        "Idempotency-Key": "one-order",
    }
    disabled = TestClient(create_app(Settings())).post(
        "/api/v1/order/kt10000", json=payload, headers=headers
    )
    assert disabled.status_code == 503
    assert client.post("/api/v1/order/kt10000", json=payload, headers=headers).status_code == 200
    assert client.post("/api/v1/order/kt10000", json=payload, headers=headers).status_code == 200
    conflicting = {**payload, "ord_qty": "2"}
    conflict_response = client.post(
        "/api/v1/order/kt10000", json=conflicting, headers=headers
    )
    assert conflict_response.status_code == 409
    assert len(fake.calls) == 1


def test_order_and_oauth_bearer_fail_closed_without_configuration() -> None:
    order = FakeClient()
    app = create_app(Settings(enable_order_api=True, _env_file=None))
    app.dependency_overrides[require_order_kiwoom_client] = lambda: order
    payload = {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    headers = {
        "Authorization": "Bearer arbitrary",
        "X-Athena-Confirm": "true",
        "Idempotency-Key": "fail-closed",
    }
    response = TestClient(app).post("/api/v1/order/kt10000", json=payload, headers=headers)
    assert response.status_code == 401
    assert order.calls == []


@pytest.mark.asyncio
async def test_failed_order_reservation_is_never_submitted_again() -> None:
    class FailingOrderClient:
        is_ready = True

        def __init__(self) -> None:
            self.calls = 0

        async def post_with_headers(self, *_args, **_kwargs):
            self.calls += 1
            raise httpx.ReadTimeout("ambiguous timeout")

    fake = FailingOrderClient()
    app = create_app(
        Settings(enable_order_api=True, local_bearer_token="local-test", _env_file=None)
    )
    app.dependency_overrides[require_order_kiwoom_client] = lambda: fake
    payload = {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    headers = {
        "Authorization": "Bearer local-test",
        "X-Athena-Confirm": "true",
        "Idempotency-Key": "ambiguous-order",
    }
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post("/api/v1/order/kt10000", json=payload, headers=headers)
            second = await client.post("/api/v1/order/kt10000", json=payload, headers=headers)
            assert first.status_code == 500
            assert second.status_code == 409
    assert fake.calls == 1


@pytest.mark.asyncio
async def test_cancelled_order_owner_during_finalization_marks_reservation_in_doubt() -> None:
    class SuccessfulOrderClient:
        def __init__(self) -> None:
            self.calls = 0
            self.started = asyncio.Event()
            self.allow_return = asyncio.Event()
            self.returned = asyncio.Event()

        async def post_with_headers(self, *_args, **_kwargs) -> ResponseEnvelope:
            self.calls += 1
            self.started.set()
            await self.allow_return.wait()
            self.returned.set()
            return ResponseEnvelope(body={"return_code": "0"}, cont_yn="N", next_key=None)

    client = SuccessfulOrderClient()
    app = create_app(
        Settings(enable_order_api=True, local_bearer_token="local-test", _env_file=None)
    )
    request = Request({"type": "http", "method": "POST", "path": "/", "app": app, "headers": []})
    payload = models.Kt10000Request.model_validate(
        {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    )
    arguments = (
        "kt10000",
        payload,
        request,
        Response(),
        client,
        "Bearer local-test",
        "true",
        "cancel-finalize",
    )

    for index in range(1023):
        completed = asyncio.Event()
        completed.set()
        app.state.order_idempotency_cache[("", "kt10000", f"blocked-{index}")] = (
            OrderReservation("blocked", OrderState.IN_DOUBT, completed)
        )

    owner = asyncio.create_task(call_order_tr(*arguments))
    await client.started.wait()
    waiter = asyncio.create_task(call_order_tr(*arguments))
    await asyncio.sleep(0)
    lock = app.state.order_idempotency_lock
    await lock.acquire()
    try:
        client.allow_return.set()
        await client.returned.wait()
        owner.cancel()
        with pytest.raises(asyncio.CancelledError):
            await owner
    finally:
        lock.release()

    reservation = app.state.order_idempotency_cache[("", "kt10000", "cancel-finalize")]
    assert reservation.state == "in_doubt"
    assert reservation.completed.is_set()
    with pytest.raises(HTTPException) as waiting_retry:
        await asyncio.wait_for(waiter, timeout=0.1)
    assert waiting_retry.value.status_code == 409
    with pytest.raises(HTTPException) as later_retry:
        await asyncio.wait_for(call_order_tr(*arguments), timeout=0.1)
    assert later_retry.value.status_code == 409
    assert len(app.state.order_idempotency_cache) == 1024
    assert client.calls == 1


@pytest.mark.asyncio
async def test_concurrent_first_order_requests_share_idempotency_state() -> None:
    class ConcurrentOrderClient:
        is_ready = True

        def __init__(self) -> None:
            self.calls = 0
            self.started = asyncio.Event()
            self.release = asyncio.Event()

        async def post_with_headers(self, *_args, **_kwargs) -> ResponseEnvelope:
            self.calls += 1
            self.started.set()
            await self.release.wait()
            return ResponseEnvelope(body={"return_code": "0"}, cont_yn="N", next_key=None)

    fake = ConcurrentOrderClient()
    app = create_app(
        Settings(enable_order_api=True, local_bearer_token="local-test", _env_file=None)
    )
    app.dependency_overrides[require_order_kiwoom_client] = lambda: fake
    payload = {"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "1", "trde_tp": "0"}
    headers = {
        "Authorization": "Bearer local-test",
        "X-Athena-Confirm": "true",
        "Idempotency-Key": "concurrent-order",
    }

    async with app.router.lifespan_context(app):
        assert app.state.order_idempotency_lock is not None
        assert app.state.order_idempotency_cache == {}
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            first = asyncio.create_task(
                client.post("/api/v1/order/kt10000", json=payload, headers=headers)
            )
            await fake.started.wait()
            second = asyncio.create_task(
                client.post("/api/v1/order/kt10000", json=payload, headers=headers)
            )
            await asyncio.sleep(0)
            assert fake.calls == 1
            fake.release.set()
            responses = await asyncio.gather(first, second)

    assert [response.status_code for response in responses] == [200, 200]
    assert fake.calls == 1


def test_ka10007_detail_manifest_is_exact_and_endpoint_projects_one_group() -> None:
    full_fields = set(models.Ka10007Response.model_fields)
    groups = [set(group["fields"]) for group in KA10007_DETAIL_MANIFEST["groups"]]
    assert len(full_fields) == 124
    assert set().union(*groups) == full_fields
    assert sum(map(len, groups)) == len(full_fields)

    full_body = {field: str(index) for index, field in enumerate(sorted(full_fields))}
    fake = FakeClient(full_body)
    app = create_app(Settings())
    app.dependency_overrides[require_kiwoom_client] = lambda: fake
    response = TestClient(app).post(
        "/api/v1/tr/quotes/ka10007/detail/identity", json={"stk_cd": "005930"}
    )
    assert response.status_code == 200
    assert set(response.json()) == set(KA10007_DETAIL_MANIFEST["groups"][0]["fields"])
    assert len(fake.calls) == 1
    assert fake.calls[0][0] == "ka10007"


def test_oauth_openapi_never_exposes_credentials_or_tokens() -> None:
    schema = create_app(Settings()).openapi()
    oauth_text = str(
        {
            path: schema["paths"][path]
            for path in schema["paths"]
            if path.startswith("/api/v1/internal/oauth/")
        }
    ).lower()
    assert "appkey" not in oauth_text
    assert "secretkey" not in oauth_text
    assert "\"token\"" not in oauth_text


def test_oauth_lifecycle_requires_configured_matching_local_bearer() -> None:
    class Manager:
        async def issue(self):
            return {"configured": True, "ready": True, "expires_at": None}

    for configured, token, expected in [
        (None, "anything", 401),
        ("local-secret", "wrong", 401),
        ("local-secret", "local-secret", 200),
    ]:
        app = create_app(Settings(local_bearer_token=configured, _env_file=None))
        app.dependency_overrides[require_token_manager] = Manager
        response = TestClient(app).post(
            "/api/v1/internal/oauth/au10001",
            json={},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == expected


@pytest.mark.xdist_group(name="real-uvicorn-socket")
async def test_real_uvicorn_loopback_smoke_uses_os_assigned_port() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(create_app(Settings()), log_level="critical", lifespan="off")
    )
    task = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        for _ in range(100):
            if server.started:
                break
            await asyncio.sleep(0.01)
        assert server.started
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as client:
            docs_response, schema_response = await asyncio.gather(
                client.get("/docs"), client.get("/openapi.json")
            )
        assert docs_response.status_code == 200
        assert "swagger" in docs_response.text.lower()
        assert schema_response.status_code == 200
        assert "/api/v1/batch" in schema_response.json()["paths"]
    finally:
        server.should_exit = True
        await asyncio.wait_for(task, timeout=5)


def test_generator_is_deterministic() -> None:
    generated = BACKEND / "athena_api" / "generated"

    def hashes() -> dict[str, str]:
        return {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(generated.glob("*.py"))
        }

    before = hashes()
    subprocess.run([sys.executable, str(BACKEND / "scripts" / "generate_api.py")], check=True)
    assert hashes() == before
