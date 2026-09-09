"""One-shot app-internal Selector dispatch regressions."""

from __future__ import annotations

import json
from unittest.mock import patch

from fastapi.testclient import TestClient

from athena_api.api.llm_tools import get_kiwoom_ws_client, get_order_kiwoom_client
from athena_api.config import Settings
from athena_api.dependencies import get_kiwoom_client, get_selector_service
from athena_api.kiwoom import ResponseEnvelope
from athena_api.main import create_app
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog
from athena_api.selector.errors import AmbiguousOperationError
from athena_api.selector.instrument_identity import InstrumentIdentityIndex


class DataSpy:
    is_ready = True

    def __init__(self, body: dict | None = None) -> None:
        self.body = body or {"cur_prc": "+71000", "pred_pre": "+1200"}
        self.calls: list[tuple] = []

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, path, body, options))
        return ResponseEnvelope(body=self.body, cont_yn="N", next_key=None)


class OrderSpy:
    is_ready = True

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    async def post_with_headers(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return ResponseEnvelope(body={"return_code": "0"}, cont_yn="N", next_key=None)


class WebSocketSpy:
    is_ready = True

    def __init__(self) -> None:
        self.registered: list[tuple[str, list[str], str, str]] = []
        self.removed: list[tuple[str, list[str], str, str]] = []

    async def register(self, tr_id, items, *, grp_no="1", refresh="1"):
        self.registered.append((tr_id, items, grp_no, refresh))
        return {
            "return_code": "0",
            "return_msg": "OK",
            "trnm": "REG",
            "private": "secret",
        }

    async def remove(self, tr_id, items, *, grp_no="1", refresh="1"):
        self.removed.append((tr_id, items, grp_no, refresh))
        return {"return_code": "0", "return_msg": "OK", "trnm": "REMOVE"}


def _service() -> SelectorService:
    index = InstrumentIdentityIndex()
    index.replace(
        {
            "0": [{"code": "005930", "name": "삼성전자", "marketCode": "0"}],
            "10": [],
            "8": [{"code": "069500", "name": "KODEX 200", "marketCode": "8"}],
        }
    )
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(b"selector-dispatch-test", nonce_factory=lambda: "dispatch-nonce"),
        instrument_identity=index,
    )


def _client(
    service: SelectorService,
    data: DataSpy,
    *,
    order: OrderSpy | None = None,
    websocket: WebSocketSpy | None = None,
) -> TestClient:
    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[get_selector_service] = lambda: service
    app.dependency_overrides[get_kiwoom_client] = lambda: data
    app.dependency_overrides[get_order_kiwoom_client] = lambda: order
    app.dependency_overrides[get_kiwoom_ws_client] = lambda: websocket
    return TestClient(app)


def _assert_no_plan_token(value: object) -> None:
    assert "plan_token" not in json.dumps(value, ensure_ascii=False)


def test_query_resolves_once_and_returns_the_inline_card_in_one_request() -> None:
    service = _service()
    data = DataSpy()
    with _client(service, data) as client, patch.object(
        service, "resolve", wraps=service.resolve
    ) as resolve:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "삼성전자 오늘 주가 얼마야?",
                "arguments": {},
                "dataset_id": "chat-1",
                "item_id": "price",
                "ordinal": 1,
            },
        )

    assert response.status_code == 200, response.text
    resolve.assert_called_once()
    assert len(data.calls) == 1
    body = response.json()
    assert body["delivery"] == "inline"
    assert body["status"] == "rendered"
    assert body["operation_ref"] == "detail:ka10001:current_trading"
    assert body["card_id"] == "CC-03"
    assert body["card_kind"] == "instrument"
    assert body["capability_id"] == "stock-info"
    assert body["envelope"]["raw_data"]["cur_prc"] == "+71000"
    assert body["envelope"]["raw_data"]["pred_pre"] == "+1200"
    assert body["envelope"]["source_data"]["operation_ref"] == body["operation_ref"]
    assert body["coverage_receipt"]["lossless"] is True
    assert body["correlation"] == {
        "dataset_id": "chat-1",
        "item_id": "price",
        "ordinal": 1,
    }
    assert body["envelope"]["data"]["fields"][0]["key"] == "cur_prc"
    _assert_no_plan_token(body)


def test_gold_quote_dispatch_excludes_transport_metadata_from_facts() -> None:
    data = DataSpy(
        {
            "return_code": 0,
            "return_msg": "정상적으로 처리되었습니다",
            "pred_pre_sig": "2",
            "pred_pre": "+1370",
            "flu_rt": "+0.72",
            "trde_qty": "4312",
            "open_pric": "+190200",
            "high_pric": "+192500",
            "low_pric": "+189800",
            "pred_rt": "+0.72",
            "upl_pric": "+248400",
            "lst_pric": "+133800",
            "pred_close_pric": "191170",
        }
    )
    with _client(_service(), data) as client:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "금 99.99 1kg 현재가 알려줘",
                "intent": "query",
                "preferred_ref": "base:ka50100",
                "arguments": {"stk_cd": "M04020000"},
                "deadline_ms": 3000,
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "rendered"
    assert body["operation_ref"] == "base:ka50100"
    fields = {field["key"]: field for field in body["envelope"]["data"]["fields"]}
    assert "return_code" not in fields
    assert "return_msg" not in fields
    assert fields["pred_close_pric"]["label"] == "전일종가"
    assert fields["pred_close_pric"]["value"] == "191170"


def test_order_returns_only_a_burned_sanitized_draft_without_execution() -> None:
    service = _service()
    data = DataSpy()
    order = OrderSpy()
    with _client(service, data, order=order) as client, patch.object(
        service, "resolve", wraps=service.resolve
    ) as resolve:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "삼성전자 10주 시장가로 매수해줘",
                "intent": "order",
                "arguments": {
                    "dmst_stex_tp": "KRX",
                    "stk_cd": "005930",
                    "ord_qty": "10",
                    "trde_tp": "3",
                },
            },
        )

    assert response.status_code == 200, response.text
    resolve.assert_called_once()
    body = response.json()
    assert body["status"] == "guarded"
    assert body["operation_ref"] == "base:kt10000"
    assert body["card_title"] == "주문"
    assert body["card_id"] == "CC-02"
    assert body["card_kind"] == "order"
    assert body["capability_id"] == "order"
    assert body["order_draft"] == {
        "dmst_stex_tp": "KRX",
        "stk_cd": "005930",
        "ord_qty": "10",
        "trde_tp": "3",
    }
    assert body["envelope"]["canvas_type"] == "action"
    assert body["envelope"]["card_id"] == "CC-02"
    assert body["envelope"]["data"] == {
        "order_draft": body["order_draft"],
        "state": "draft",
    }
    assert body["coverage_receipt"]["lossless"] is True
    assert len(service._consumed_nonces) == 1
    assert data.calls == []
    assert order.calls == []
    _assert_no_plan_token(response.json())


def test_etf_cash_order_resolves_to_guarded_stock_buy_without_execution() -> None:
    service = _service()
    data = DataSpy()
    order = OrderSpy()
    with _client(service, data, order=order) as client:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "KODEX 200 1주 시장가로 매수해줘",
                "intent": "order",
                "arguments": {
                    "dmst_stex_tp": "KRX",
                    "stk_cd": "069500",
                    "ord_qty": "1",
                    "trde_tp": "3",
                },
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "guarded"
    assert body["operation_ref"] == "base:kt10000"
    assert body["order_draft"] == {
        "dmst_stex_tp": "KRX",
        "stk_cd": "069500",
        "ord_qty": "1",
        "trde_tp": "3",
    }
    assert data.calls == []
    assert order.calls == []
    _assert_no_plan_token(body)


def test_websocket_executes_only_with_explicit_intent_and_uses_only_ws_client() -> None:
    service = _service()
    data = DataSpy()
    order = OrderSpy()
    websocket = WebSocketSpy()
    request = {
        "question": "base:0G",
        "dataset_id": "ws-1",
        "item_id": "connection",
        "ordinal": 1,
        "arguments": {
            "trnm": "REG",
            "grp_no": "1",
            "refresh": "1",
            "data": [{"type": "0G", "item": "005930"}],
        },
    }
    with _client(service, data, order=order, websocket=websocket) as client:
        implicit = client.post("/api/v1/selector/dispatch", json=request)
        explicit = client.post(
            "/api/v1/selector/dispatch",
            json={**request, "intent": "websocket"},
        )

    assert implicit.status_code == 404
    assert implicit.json()["code"] == "OPERATION_NOT_FOUND"
    assert explicit.status_code == 200, explicit.text
    body = explicit.json()
    expected = {
        "status": "acknowledged",
        "operation_ref": "base:0G",
        "card_title": "종목발굴",
        "canvas_type": "event",
        "correlation": {
            "dataset_id": "ws-1",
            "item_id": "connection",
            "ordinal": 1,
        },
        "envelope": {
            "canvas_type": "event",
            "fell_back": False,
            "fallback_reason": None,
            "caption": "실시간 연결 상태",
            "card_title": "종목발굴",
            "data": {
                "lifecycle": "connected",
                "state_label": "실시간 연결됨",
                "records": [{"상태": "실시간 연결됨"}],
            },
            "raw_data": body["envelope"]["raw_data"],
            "source_data": body["envelope"]["source_data"],
            "layout": None,
            "drop_types": [],
            "correlation": {
                "dataset_id": "ws-1",
                "item_id": "connection",
                "ordinal": 1,
            },
        },
        "acknowledgement": {
            "return_code": "0",
            "return_msg": "OK",
            "trnm": "REG",
            "command": "REG",
        },
    }
    for key in (
        "card_id",
        "card_kind",
        "capability_id",
        "mode",
        "section",
        "operation_refs",
        "field_contract",
        "coverage_receipt",
        "envelope_version",
        "view_recipe",
        "presentation_contract",
        "view_instance_id",
        "semantic_observations",
        "realtime_bindings",
        "workspace_generation",
        "view_generation",
        "update_policy",
        "surface_contract",
    ):
        expected[key] = body[key]
        expected["envelope"][key] = body["envelope"][key]
    assert body == expected
    assert body["card_id"] == "CC-03"
    assert body["card_kind"] == "instrument"
    assert body["capability_id"] == "etf"
    assert body["coverage_receipt"]["lossless"] is True
    assert websocket.registered == [("0G", ["005930"], "1", "1")]
    assert websocket.removed == []
    assert data.calls == []
    assert order.calls == []
    _assert_no_plan_token(explicit.json())


def test_ambiguous_resolution_has_zero_external_effects_and_leaks_no_plan() -> None:
    service = _service()
    data = DataSpy()
    order = OrderSpy()
    websocket = WebSocketSpy()
    with _client(service, data, order=order, websocket=websocket) as client, patch.object(
        service,
        "resolve",
        side_effect=AmbiguousOperationError(
            "Several operation profiles are compatible with the question"
        ),
    ) as resolve:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={"question": "이 종목 관련 정보를 비교해서 보여줘"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "needs_inference"
    assert body["code"] == "AMBIGUOUS_OPERATION"
    assert body["catalog_version"] == service.catalog.version
    assert 1 <= len(body["candidates"]) <= 3
    assert set(body["candidates"][0]) == {
        "operation_ref",
        "kind",
        "name",
        "required_arguments",
    }
    assert all(
        set(argument) == {"alias", "description", "json_schema"}
        for candidate in body["candidates"]
        for argument in candidate["required_arguments"]
    )
    resolve.assert_called_once()
    assert service._consumed_nonces == {}
    assert data.calls == []
    assert order.calls == []
    assert websocket.registered == []
    assert websocket.removed == []
    _assert_no_plan_token(body)


def test_auto_order_miss_returns_order_candidates_without_any_effect() -> None:
    service = _service()
    data = DataSpy()
    order = OrderSpy()
    websocket = WebSocketSpy()
    with _client(service, data, order=order, websocket=websocket) as client:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "삼성전자 10주 시장가로 매수해줘",
                "arguments": {},
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "needs_inference"
    assert body["code"] == "NO_CONFIDENT_MATCH"
    assert body["suggested_intent"] == "order"
    assert 1 <= len(body["candidates"]) <= 3
    assert body["candidates"][0]["operation_ref"] == "base:kt10000"
    assert all(candidate["kind"] == "order" for candidate in body["candidates"])
    assert service._consumed_nonces == {}
    assert data.calls == []
    assert order.calls == []
    assert websocket.registered == []
    assert websocket.removed == []
    _assert_no_plan_token(body)


def test_missing_arguments_returns_exact_compact_contract_without_calling_data() -> None:
    service = _service()
    data = DataSpy()
    with _client(service, data) as client:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={"question": "base:ka00198", "arguments": {}},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "needs_inference"
    assert body["code"] == "INVALID_ARGUMENTS"
    assert body["candidates"] == [
        {
            "operation_ref": "base:ka00198",
            "kind": "query",
            "name": "실시간종목조회순위",
            "required_arguments": [
                {
                    "alias": "qry_tp",
                    "description": "구분 — 1:1분, 2:10분, 3:1시간, 4:당일 누적, 5:30초",
                    "json_schema": {"type": "string"},
                }
            ],
        }
    ]
    assert service._consumed_nonces == {}
    assert data.calls == []
    _assert_no_plan_token(body)
