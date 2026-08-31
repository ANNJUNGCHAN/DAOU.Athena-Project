"""Additive Task Canvas envelope and safety-boundary regressions."""

from __future__ import annotations

import json
import re
from itertools import count
from types import SimpleNamespace

from fastapi.testclient import TestClient

from athena_api.api.canvas_push import (
    RenderPlanRequest,
    _apply_authoritative_public_labels,
    _apply_workspace_reservation,
    _bind_semantic_values,
    _error_state_response,
    _integrated_card_contract,
    _internal_realtime_binding_contract,
    _reserve_workspace,
    _view_instance_id,
)
from athena_api.api.llm_tools import get_kiwoom_ws_client, get_order_kiwoom_client
from athena_api.config import Settings
from athena_api.dependencies import get_kiwoom_client, get_selector_service
from athena_api.kiwoom import ResponseEnvelope
from athena_api.main import create_app
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog
from athena_api.semantic_presentation_registry import get_semantic_presentation_registry


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

    async def register(self, tr_id, items, *, grp_no="1", refresh="1"):
        self.registered.append((tr_id, items, grp_no, refresh))
        return {"return_code": "0", "return_msg": "OK", "trnm": "REG"}


def _service() -> SelectorService:
    nonces = count(1)
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(
            b"task-canvas-envelope-test",
            nonce_factory=lambda: f"task-canvas-nonce-{next(nonces)}",
        ),
    )


def _client(
    service: SelectorService,
    data: DataSpy,
    *,
    order: OrderSpy | None = None,
    websocket: WebSocketSpy | None = None,
    bearer: str | None = None,
) -> TestClient:
    app = create_app(Settings(_env_file=None, local_bearer_token=bearer))
    app.dependency_overrides[get_selector_service] = lambda: service
    app.dependency_overrides[get_kiwoom_client] = lambda: data
    app.dependency_overrides[get_order_kiwoom_client] = lambda: order
    app.dependency_overrides[get_kiwoom_ws_client] = lambda: websocket
    return TestClient(app)


def test_query_response_adds_bound_task_canvas_without_replacing_legacy_contract() -> None:
    data = DataSpy()
    with _client(_service(), data) as client:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "detail:ka10001:current_trading",
                "arguments": {"stk_cd": "005930"},
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["operation_ref"] == "detail:ka10001:current_trading"
    assert body["card_id"] == "CC-03"
    assert body["field_contract"]
    assert body["coverage_receipt"]["lossless"] is True
    assert body["envelope_version"] == "task-canvas.v1"
    assert body["workspace_generation"] == body["view_generation"] == 1
    assert body["update_policy"] == "replace"
    assert body["view_recipe"]["recipe_id"] == "instrument-chart"
    assert body["view_recipe"]["section_policies"] == [
        {
            "section_id": "identity-and-quote",
            "section_order": 1,
            "visibility_policy": "always",
            "required": True,
            "workflow_only": False,
        },
        {
            "section_id": "price-history",
            "section_order": 2,
            "visibility_policy": "always",
            "required": True,
            "workflow_only": False,
        },
        {
            "section_id": "volume-and-period",
            "section_order": 3,
            "visibility_policy": "when-data",
            "required": False,
            "workflow_only": False,
        },
    ]
    assert body["presentation_contract"]["recipe_id"] == "instrument-chart"
    observations = body["semantic_observations"]
    current_price = next(
        item
        for item in get_semantic_presentation_registry().for_operation(
            "detail:ka10001:current_trading"
        )
        if item.alias == "cur_prc"
    )
    assert any(
        item["concept_id"] == current_price.concept_id and item["value"] == "+71000"
        for item in observations
    )
    assert body["envelope"]["semantic_observations"] == observations
    bindings = body["realtime_bindings"]
    assert body["envelope"]["realtime_bindings"] == bindings
    assert body["envelope"]["workspace_generation"] == 1
    assert body["envelope"]["view_generation"] == 1
    assert body["envelope"]["update_policy"] == "replace"
    assert len(bindings) == len(observations)
    assert all(re.fullmatch(r"rtb_[0-9a-f]{20}", item["binding_id"]) for item in bindings)
    assert {
        (item["realtime_binding_id"], item["observation_id"])
        for item in observations
    } == {(item["binding_id"], item["observation_id"]) for item in bindings}
    assert all(
        item["display_tier"] in {"answer", "primary", "support", "detail"}
        and item["display_group"]
        and isinstance(item["display_order"], int)
        and item["visibility_policy"] in {"always", "row-detail", "named-detail"}
        for item in observations
    )
    assert all(
        section["visibility_policy"] in {"always", "when-data", "workflow"}
        and isinstance(section["required"], bool)
        and isinstance(section["workflow_only"], bool)
        and isinstance(section["section_order"], int)
        for section in body["presentation_contract"]["sections"]
    )
    assert all(
        section["visibility_policy"] != "when-data"
        or section["fields"]
        or section.get("rows")
        for section in body["presentation_contract"]["sections"]
    )
    rendered_fields = [
        field
        for section in body["presentation_contract"]["sections"]
        for field in section["fields"]
    ]
    assert rendered_fields
    assert all(
        re.fullmatch(r"rtb_[0-9a-f]{20}", field["realtime_binding_id"])
        for field in rendered_fields
    )
    product_text = json.dumps(
        {
            "presentation_contract": body["presentation_contract"],
            "semantic_observations": observations,
            "realtime_bindings": bindings,
        },
        ensure_ascii=False,
    ).lower()
    assert "응답키" not in product_text
    assert "cur_prc" not in product_text


def test_legacy_projection_labels_use_operation_scoped_public_authority() -> None:
    data = DataSpy(
        body={
            "cur_prc": "+71000",
            "pre_sig": "2",
            "pred_pre": "+1200",
        }
    )
    with _client(_service(), data) as client:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "detail:ka10001:current_trading",
                "arguments": {"stk_cd": "005930"},
            },
        )

    assert response.status_code == 200, response.text
    fields = response.json()["envelope"]["data"]["fields"]
    labels = {item["key"]: item["label"] for item in fields}
    assert labels["cur_prc"] == "현재가"
    assert labels["pre_sig"] == "전일 대비 기호"
    assert labels["pred_pre"] == "전일대비"
    assert not ({"cur_prc", "pre_sig", "pred_pre"} & set(labels.values()))
    assert all(not re.fullmatch(r"\d+", label) for label in labels.values())


def test_authoritative_labels_cover_fields_columns_and_compound_headers() -> None:
    facts = {"fields": [{"key": "pre_sig", "label": "pre_sig", "value": "2"}]}
    _apply_authoritative_public_labels(
        "detail:ka10001:current_trading", facts
    )
    assert facts["fields"][0]["label"] == "전일 대비 기호"

    table = {"columns": [{"key": "141", "label": "141"}], "rows": [{"141": "A"}]}
    _apply_authoritative_public_labels("base:0F", table)
    assert table["columns"][0]["label"] == "매도 거래원"

    compound = {
        "header": [{"key": "pre_sig", "label": "pre_sig", "value": "2"}],
        "table": {
            "columns": [{"key": "cur_prc", "label": "cur_prc"}],
            "rows": [{"cur_prc": "+71000"}],
        },
    }
    _apply_authoritative_public_labels(
        "detail:ka10001:current_trading", compound
    )
    assert compound["header"][0]["label"] == "전일 대비 기호"
    assert compound["table"]["columns"][0]["label"] == "현재가"

    try:
        _apply_authoritative_public_labels(
            "detail:ka10001:current_trading",
            {
                "fields": [
                    {
                        "key": "unknown_wire_alias",
                        "label": "unknown_wire_alias",
                        "value": "opaque",
                    }
                ]
            },
        )
    except ValueError as exc:
        assert "no unambiguous public label" in str(exc)
    else:
        raise AssertionError("unregistered projection labels must fail closed")

    internal = {
        "columns": [{"key": "bgb_clr", "label": "bgb_clr"}],
        "rows": [{"bgb_clr": "#ffffff"}],
    }
    dropped = _apply_authoritative_public_labels("base:ka01301", internal)
    assert dropped == ()
    assert internal == {
        "columns": [{"key": "bgb_clr", "label": "북마크 컬러"}],
        "rows": [{"bgb_clr": "#ffffff"}],
    }


def test_recipe_and_view_identity_are_deterministic_and_server_derived() -> None:
    first = _integrated_card_contract(
        "detail:ka10001:current_trading",
        arguments={"stk_cd": "005930"},
        account="default",
    )
    second = _integrated_card_contract(
        "detail:ka10001:current_trading",
        arguments={"stk_cd": "005930"},
        account="default",
    )
    other = _integrated_card_contract(
        "detail:ka10001:current_trading",
        arguments={"stk_cd": "000660"},
        account="default",
    )

    assert first["view_recipe"] == second["view_recipe"]
    assert first["view_instance_id"] == second["view_instance_id"]
    assert first["view_instance_id"] != other["view_instance_id"]
    assert "operation_refs" not in first["view_recipe"]


def test_view_identity_canonicalizes_signed_scope_task_target_query_and_account() -> None:
    base = {
        "operation_ref": "detail:ka10001:current_trading",
        "recipe_id": "instrument-chart",
        "arguments": {"stk_cd": " ００５９３０ ", "filters": {"to": " 20260831 "}},
        "question_hash": "a" * 64,
        "account": " default ",
        "dataset_id": " chat-1 ",
    }
    canonical = _view_instance_id(**base)
    reordered = _view_instance_id(
        **{
            **base,
            "arguments": {"filters": {"to": "20260831"}, "stk_cd": "005930"},
            "account": "default",
            "dataset_id": "chat-1",
        }
    )
    assert canonical == reordered

    mutations = [
        {"dataset_id": "chat-2"},
        {"recipe_id": "discovery-value"},
        {"operation_ref": "base:ka10081"},
        {"arguments": {"stk_cd": "000660", "filters": {"to": "20260831"}}},
        {"arguments": {**base["arguments"], "signed_unknown": "sealed"}},
        {"account": "secondary"},
    ]
    assert all(_view_instance_id(**{**base, **change}) != canonical for change in mutations)

    no_correlation = {**base, "dataset_id": None}
    assert _view_instance_id(**no_correlation) != _view_instance_id(
        **{**no_correlation, "question_hash": "b" * 64}
    )


def test_dataset_identity_ignores_item_and_ordinal_and_generation_is_latest_wins() -> None:
    app = SimpleNamespace(state=SimpleNamespace())
    first = _integrated_card_contract(
        "detail:ka10001:current_trading",
        arguments={"stk_cd": "005930"},
        question_hash="a" * 64,
        account="default",
        dataset_id="dataset-1",
    )
    same_dataset_other_item = _integrated_card_contract(
        "detail:ka10001:current_trading",
        arguments={"stk_cd": "005930"},
        question_hash="a" * 64,
        account="default",
        dataset_id="dataset-1",
    )
    assert first["view_instance_id"] == same_dataset_other_item["view_instance_id"]

    delayed_first = _reserve_workspace(app, first)
    other_view = _integrated_card_contract(
        "detail:ka10001:current_trading",
        arguments={"stk_cd": "000660"},
        question_hash="b" * 64,
        account="default",
        dataset_id="dataset-2",
    )
    overlapping_other_view = _reserve_workspace(app, other_view)
    fast_second = _reserve_workspace(app, same_dataset_other_item)
    assert delayed_first.generation == 1
    assert overlapping_other_view.generation == 2
    assert fast_second.generation == 3
    assert (
        delayed_first.update_policy
        == overlapping_other_view.update_policy
        == fast_second.update_policy
        == "replace"
    )
    assert _apply_workspace_reservation(app, other_view, overlapping_other_view) is True
    assert other_view["workspace_generation"] == other_view["view_generation"] == 2
    assert other_view["update_policy"] == "replace"
    original_bindings = list(same_dataset_other_item["realtime_bindings"])
    assert _apply_workspace_reservation(app, same_dataset_other_item, fast_second) is True
    assert same_dataset_other_item["workspace_generation"] == 3
    assert same_dataset_other_item["view_generation"] == 3
    assert same_dataset_other_item["realtime_bindings"] == original_bindings
    assert _apply_workspace_reservation(app, first, delayed_first) is False

    subsequent = _integrated_card_contract(
        "detail:ka10001:current_trading",
        arguments={"stk_cd": "005930"},
        question_hash="a" * 64,
        account="default",
        dataset_id="dataset-1",
    )
    reservation = _reserve_workspace(app, subsequent)
    assert reservation.generation == 4
    assert reservation.update_policy == "enrich"
    assert _apply_workspace_reservation(app, subsequent, reservation) is True


def test_dispatch_reuses_workspace_with_strict_generation_and_full_binding_contract() -> None:
    request = {
        "question": "detail:ka10001:current_trading",
        "arguments": {"stk_cd": "005930"},
        "dataset_id": "conversation-1",
        "item_id": "answer-card",
        "ordinal": 1,
    }
    with _client(_service(), DataSpy()) as client:
        first = client.post("/api/v1/selector/dispatch", json=request).json()
        second = client.post(
            "/api/v1/selector/dispatch",
            json={**request, "item_id": "follow-up-card", "ordinal": 2},
        ).json()

    assert first["view_instance_id"] == second["view_instance_id"]
    assert (first["workspace_generation"], second["workspace_generation"]) == (1, 2)
    assert (first["view_generation"], second["view_generation"]) == (1, 2)
    assert (first["update_policy"], second["update_policy"]) == ("replace", "enrich")
    for body in (first, second):
        assert body["envelope"]["realtime_bindings"] == body["realtime_bindings"]
        assert body["envelope"]["workspace_generation"] == body["workspace_generation"]
        assert body["envelope"]["view_generation"] == body["view_generation"]
        assert body["envelope"]["update_policy"] == body["update_policy"]


def test_canvas_push_rejects_a_client_selected_recipe() -> None:
    with _client(_service(), DataSpy()) as client:
        response = client.post(
            "/api/v1/canvas/push",
            json={
                "operation_ref": "base:ka00001",
                "canvas_type": "facts",
                "view_recipe": {"recipe_id": "order-safe-ticket"},
                "data": {},
            },
        )

    assert response.status_code == 422
    assert response.json()["code"] == "GENERIC_TASK_CANVAS_CONTRACT_FORBIDDEN"


def test_generic_canvas_push_rejects_forged_order_receipt_with_canonical_metadata() -> None:
    canonical = _integrated_card_contract("base:kt10000")
    forged = {
        "operation_ref": "base:kt10000",
        "canvas_type": "action",
        "data": {
            "state": "accepted",
            "receipt": {"ord_no": "FORGED-ORDER", "status": "filled"},
        },
        **canonical,
    }
    with _client(_service(), DataSpy()) as client:
        response = client.post("/api/v1/canvas/push", json=forged)

        assert response.status_code == 422
        assert response.json()["code"] == "GENERIC_ORDER_PUSH_FORBIDDEN"
        assert "FORGED-ORDER" not in response.text
        assert client.app.state.canvas_events.empty()

        disguised = client.post(
            "/api/v1/canvas/push",
            json={**forged, "canvas_type": "facts"},
        )
        assert disguised.status_code == 422
        assert disguised.json()["code"] == "GENERIC_ORDER_PUSH_FORBIDDEN"
        assert client.app.state.canvas_events.empty()


def test_generic_canvas_push_rejects_forged_realtime_lifecycle() -> None:
    forged = {
        "operation_ref": "base:0G",
        "canvas_type": "event",
        "data": {"lifecycle": "connected", "state_label": "실시간 연결됨"},
        **_integrated_card_contract("base:0G"),
    }
    with _client(_service(), DataSpy()) as client:
        response = client.post("/api/v1/canvas/push", json=forged)

        assert response.status_code == 422
        assert response.json()["code"] == "GENERIC_WORKFLOW_PUSH_FORBIDDEN"
        assert "connected" not in response.text
        assert client.app.state.canvas_events.empty()

        status = client.post(
            "/api/v1/canvas/push", json={**forged, "canvas_type": "status"}
        )
        assert status.status_code == 422
        assert status.json()["code"] == "GENERIC_WORKFLOW_PUSH_FORBIDDEN"
        assert client.app.state.canvas_events.empty()


def test_internal_realtime_binding_registry_is_guarded_and_normalizes_raw_tick() -> None:
    bearer = "task-canvas-internal-test-token"
    path = "/api/v1/internal/canvas/realtime-bindings/1h"
    with _client(_service(), DataSpy(), bearer=bearer) as client:
        unauthorized = client.get(path)
        response = client.get(
            path, headers={"Authorization": f"Bearer {bearer}"}
        )

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    registry = response.json()
    assert registry["binding_version"] == "semantic-realtime.v1"
    assert registry["operation_id"] == "1h"
    assert set(registry["source_bindings"]["9001"]) == {"binding_id"}
    assert registry["source_bindings"]["9001"]["binding_id"].startswith("rtb_")
    assert registry["source_bindings"]["1279"]["binding_id"].startswith("rtb_")

    raw_values = {"9001": "005930", "13": "+1200", "1279": "opaque"}
    semantic_updates = [
        {
            "binding_id": registry["source_bindings"][key]["binding_id"],
            "value": value,
        }
        for key, value in raw_values.items()
        if key in registry["source_bindings"]
    ]
    public_tick = {"semantic_updates": semantic_updates}
    public_text = json.dumps(public_tick, ensure_ascii=False)
    assert len(semantic_updates) == 3
    assert "9001" not in public_text
    assert "1279" not in public_text
    assert "opaque" in public_text


def test_internal_realtime_registry_rejects_non_websocket_operations() -> None:
    try:
        _internal_realtime_binding_contract("ka00001")
    except KeyError as exc:
        assert "unknown realtime operation" in str(exc)
    else:
        raise AssertionError("query operation must not receive a realtime registry")


def test_chart_snapshot_and_live_tick_share_an_opaque_price_binding() -> None:
    chart = _integrated_card_contract("base:ka10081")
    snapshot_binding_ids = {
        field["realtime_binding_id"]
        for section in chart["presentation_contract"]["sections"]
        for field in section["fields"]
    }
    live_price = _internal_realtime_binding_contract("0B")["source_bindings"]["10"]

    assert live_price["binding_id"] in snapshot_binding_ids
    assert live_price == {"binding_id": "rtb_38f0cbc28cb09783e9b3"}


def test_display_metadata_is_identical_across_fields_columns_and_observations() -> None:
    chart = _integrated_card_contract("base:ka10081")
    _bind_semantic_values(
        chart,
        "base:ka10081",
        {
            "stk_cd": "005930",
            "stk_dt_pole_chart_qry": [
                {
                    "cur_prc": "150850",
                    "trde_qty": "1234",
                    "dt": "20260831",
                }
            ],
        },
    )
    observations = {
        item["label_ko"]: item for item in chart["semantic_observations"]
    }
    columns = {
        item["label_ko"]: item
        for section in chart["presentation_contract"]["sections"]
        for item in section.get("columns", [])
    }
    fields = {
        item["label_ko"]: item
        for section in chart["presentation_contract"]["sections"]
        for item in section["fields"]
    }

    assert observations["현재가"]["display_metadata"] == columns["현재가"][
        "display_metadata"
    ]
    assert observations["종목코드"]["display_metadata"] == fields["종목코드"][
        "display_metadata"
    ]


def test_error_state_keeps_all_authoritative_sections_with_explicit_state() -> None:
    contract = _integrated_card_contract("detail:ka10001:current_trading")
    app = SimpleNamespace(state=SimpleNamespace())
    reservation = _reserve_workspace(app, contract)
    response = _error_state_response(
        app=app,
        payload=RenderPlanRequest(plan_token="signed"),
        operation_ref="detail:ka10001:current_trading",
        canvas_kind="facts",
        screen_id="AT-CV-005:F1",
        renderer_id=None,
        state="error",
        code="UPSTREAM_ERROR",
        retryable=True,
        total_start=0.0,
        call_ms=1.0,
        card_contract=contract,
        reservation=reservation,
    )
    body = json.loads(response.body)

    presentation = body["presentation_contract"]
    assert presentation["status"] == "error"
    assert len(presentation["sections"]) == 3
    assert all(section["status"] == "error" for section in presentation["sections"])
    assert body["envelope"]["presentation_contract"] == presentation
    assert body["workspace_generation"] == body["view_generation"] == 1
    assert body["envelope"]["workspace_generation"] == 1
    assert body["envelope"]["update_policy"] == "replace"


def test_official_opaque_values_enter_named_detail_while_transport_stays_hidden() -> None:
    contract = _integrated_card_contract("base:1h")
    _bind_semantic_values(
        contract,
        "base:1h",
        {
            "return_code": "0",
            "data": [
                {
                    "9001": "005930",
                    "1279": "opaque-a",
                    "values": {"1279": "nested-opaque"},
                },
                {"9001": "000660", "1279": "opaque-b"},
            ],
        },
    )

    product_json = json.dumps(
        {
            "presentation_contract": contract["presentation_contract"],
            "semantic_observations": contract["semantic_observations"],
            "realtime_bindings": contract["realtime_bindings"],
        },
        ensure_ascii=False,
    )
    assert "opaque-a" in product_json
    assert "opaque-b" in product_json
    assert "nested-opaque" not in product_json
    assert "명세 추가 항목" in product_json
    assert '"label_ko": "1279"' not in product_json
    assert "return_code" not in product_json
    stock_code_contract = next(
        item
        for item in get_semantic_presentation_registry().for_operation("base:1h")
        if item.alias == "9001"
    )
    stock_codes = [
        item
        for item in contract["semantic_observations"]
        if item["concept_id"] == stock_code_contract.concept_id
    ]
    assert [item["value"] for item in stock_codes] == ["005930", "000660"]
    assert [item["array_index"] for item in stock_codes] == [0, 1]
    assert len({item["observation_id"] for item in stock_codes}) == 2
    vi_section = next(
        section
        for section in contract["presentation_contract"]["sections"]
        if section["section_id"] == stock_code_contract.section_id
    )
    stock_column = next(
        column
        for column in vi_section["columns"]
        if column["label_ko"] == stock_codes[0]["label_ko"]
    )
    assert [row[stock_column["key"]] for row in vi_section["rows"]] == [
        "005930",
        "000660",
    ]
    assert stock_column["display_tier"] in {
        "answer",
        "primary",
        "support",
        "detail",
    }
    assert stock_column["display_group"] == stock_code_contract.display_group
    assert isinstance(stock_column["display_order"], int)
    assert stock_column["visibility_policy"] in {
        "always",
        "row-detail",
        "named-detail",
    }
    assert re.fullmatch(r"rtb_[0-9a-f]{20}", stock_column["realtime_binding_id"])
    stock_bindings = [
        binding
        for binding in contract["realtime_bindings"]
        if binding["binding_id"] == stock_column["realtime_binding_id"]
    ]
    assert [binding["array_index"] for binding in stock_bindings] == [0, 1]
    assert all(key.startswith("col_") for row in vi_section["rows"] for key in row)
    section_ids = {
        section["section_id"] for section in contract["presentation_contract"]["sections"]
    }
    assert "market-state" in section_ids
    assert stock_code_contract.section_id in section_ids
    assert "vi-events" in section_ids
    public_subtree = {
        "presentation_contract": contract["presentation_contract"],
        "semantic_observations": contract["semantic_observations"],
    }
    public_text = json.dumps(public_subtree, ensure_ascii=False).lower()
    for forbidden in (
        "base:",
        "$.",
        "mapping_id",
        "json_path",
        "occurrence_id",
        "operation_ref",
        "placement_rule_id",
        "placement_basis",
        "semantic_basis",
        "source_key",
        "realtime_merge_key",
        '"alias"',
        "fid ",
        "raw ",
    ):
        assert forbidden not in public_text

    balance_contract = _integrated_card_contract("base:04")
    _bind_semantic_values(
        balance_contract,
        "base:04",
        {
            "return_code": "0",
            "data": [{"9001": "005930", "951": "opaque-951", "924": "opaque-924"}],
        },
    )
    balance_product_text = json.dumps(
        {
            "presentation_contract": balance_contract["presentation_contract"],
            "semantic_observations": balance_contract["semantic_observations"],
        },
        ensure_ascii=False,
    )
    assert "opaque-951" in balance_product_text
    assert "opaque-924" in balance_product_text
    assert "명세 추가 항목 1" in balance_product_text
    assert "명세 추가 항목 2" in balance_product_text
    assert '"label_ko": "951"' not in balance_product_text
    assert '"label_ko": "924"' not in balance_product_text


def test_numbered_field_families_keep_public_slots_without_numeric_labels() -> None:
    contract = _integrated_card_contract("base:0F")
    _bind_semantic_values(
        contract,
        "base:0F",
        {"data": [{"141": "매도사", "172": "100", "173": "200"}]},
    )

    slotted_observations = [
        item
        for item in contract["semantic_observations"]
        if item["display_slot"] is not None
    ]
    assert slotted_observations
    assert all(not re.search(r"\d+$", item["label_ko"]) for item in slotted_observations)
    assert all(item["display_group"] for item in slotted_observations)
    assert all(
        not re.search(r"\d+$", item["display_group"])
        for item in slotted_observations
    )

    participant_section = next(
        section
        for section in contract["presentation_contract"]["sections"]
        if section["section_id"] == "participant-flow"
    )
    slotted_columns = [
        column
        for column in participant_section["columns"]
        if column["display_slot"] is not None
    ]
    assert all(not re.search(r"\d+$", column["label_ko"]) for column in slotted_columns)
    quantity_columns = [
        column for column in slotted_columns if column["label_ko"] == "매수 거래원 수량"
    ]
    assert [column["display_slot"] for column in quantity_columns] == [2, 3]
    row = participant_section["rows"][0]
    assert [row[column["key"]] for column in quantity_columns] == ["100", "200"]


def test_order_recipe_remains_draft_only_and_never_calls_order_client() -> None:
    data = DataSpy()
    order = OrderSpy()
    with _client(_service(), data, order=order) as client:
        response = client.post(
            "/api/v1/selector/dispatch",
            json={
                "question": "base:kt10000",
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
    body = response.json()
    assert body["status"] == "guarded"
    assert body["view_recipe"]["recipe_id"] == "order-safe-ticket"
    assert body["envelope"]["data"]["state"] == "draft"
    assert order.calls == []
    assert data.calls == []


def test_websocket_recipe_requires_explicit_intent_before_registration() -> None:
    request = {
        "question": "base:0G",
        "arguments": {
            "trnm": "REG",
            "grp_no": "1",
            "refresh": "1",
            "data": [{"type": "0G", "item": "005930"}],
        },
    }
    websocket = WebSocketSpy()
    with _client(_service(), DataSpy(), websocket=websocket) as client:
        implicit = client.post("/api/v1/selector/dispatch", json=request)
    assert implicit.status_code != 200
    assert websocket.registered == []

    websocket = WebSocketSpy()
    with _client(_service(), DataSpy(), websocket=websocket) as client:
        explicit = client.post(
            "/api/v1/selector/dispatch",
            json={**request, "intent": "websocket"},
        )
    assert explicit.status_code == 200, explicit.text
    body = explicit.json()
    assert body["view_recipe"]["recipe_id"] == "etf-product"
    assert websocket.registered == [("0G", ["005930"], "1", "1")]
