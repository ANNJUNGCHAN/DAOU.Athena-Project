"""Pin complete, typed selector routing metadata and its derivation order."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pytest

from athena_api.generated.registry import (
    DETAIL_REGISTRY,
    QUERY_FRAME_VERSION,
    RESPONSE_PROJECTION_BY_TR_ID,
    ROUTING_CONTRACT_VERSION,
    ROUTING_EQUIVALENCE_GROUPS,
    ROUTING_REGISTRY,
    ROUTING_SOURCE_VERSION,
    TR_REGISTRY,
)
from athena_api.routing_contract import (
    ActionKind,
    BindingRole,
    CapabilityKind,
    DataIntent,
    EntityKind,
    ExecutionKind,
    FeedKind,
    Measure,
    RoutingResultShape,
    RoutingSubject,
    TemporalScope,
    _field_aliases,
    apply_routing_override,
    build_routing_registry,
    derive_base_routing,
)
from athena_api.selector import catalog as catalog_module
from athena_api.selector.catalog import _catalog_version, build_operation_catalog
from scripts.generate_api import (
    _reject_duplicate_keys,
    build_routing_equivalence_contracts,
    validate_routing_equivalence_groups,
)

BACKEND = Path(__file__).resolve().parents[2]
SECTOR_52W_REFS = (
    "detail:ka20001:fifty_two_week_range",
    "detail:ka20009:fifty_two_week_range",
)


def _source_inputs() -> tuple[
    list[dict[str, object]],
    dict[str, object],
    dict[str, object],
    dict[str, object],
]:
    def load(name: str) -> object:
        return json.loads((BACKEND / "ref" / name).read_text(encoding="utf-8"))

    inventory = load("kiwoom-tr-inventory.json")
    projections = load("response-projections.json")
    output_profile = load("kiwoom-output-profile.json")
    source = load("selector-routing.json")
    assert isinstance(inventory, list)
    assert isinstance(projections, dict)
    assert isinstance(output_profile, dict)
    assert isinstance(source, dict)
    operations: list[dict[str, object]] = []
    for operation in inventory:
        spec = TR_REGISTRY[operation["id"]]
        operations.append({**operation, "kind": spec.kind, "domain": spec.domain})
    return operations, projections, output_profile, source


def _equivalence_inputs() -> tuple[
    dict[str, object],
    dict[str, dict[str, object]],
    list[dict[str, object]],
    dict[str, object],
    dict[str, object],
]:
    operations, projections, _, source = _source_inputs()
    common_screen_manifest = json.loads(
        (BACKEND / "ref" / "kiwoom-common-screen-manifest.json").read_text(encoding="utf-8")
    )
    screen_definitions = json.loads(
        (BACKEND / "ref" / "kiwoom-screen-definitions.json").read_text(encoding="utf-8")
    )
    contracts = build_routing_equivalence_contracts(
        operations,
        projections,
        common_screen_manifest,
        screen_definitions,
    )
    group_source = {
        "equivalence_groups": {
            "sector_52_week_range": source["equivalence_groups"]["sector_52_week_range"]
        }
    }
    return (
        group_source,
        contracts,
        operations,
        common_screen_manifest,
        screen_definitions,
    )


def test_routing_registry_has_exact_323_operation_coverage() -> None:
    expected_refs = {f"base:{tr_id}" for tr_id in TR_REGISTRY} | set(DETAIL_REGISTRY)
    assert len(TR_REGISTRY) == 208
    assert len(DETAIL_REGISTRY) == 115
    assert set(ROUTING_REGISTRY) == expected_refs
    assert len(ROUTING_REGISTRY) == 323
    assert ROUTING_SOURCE_VERSION == 2
    assert ROUTING_CONTRACT_VERSION == "selector-routing-v5"
    assert QUERY_FRAME_VERSION == "query-frame-v7"
    for routing in ROUTING_REGISTRY.values():
        assert routing.entity_kinds
        assert routing.data_intents
        assert routing.temporal_scopes
        assert routing.measures
        assert routing.result_shapes
        assert "other" not in json.dumps(routing.canonical())


def test_representative_base_taxonomy_is_typed_and_subject_safe() -> None:
    stock = ROUTING_REGISTRY["base:ka10001"]
    sector = ROUTING_REGISTRY["base:ka20001"]
    order = ROUTING_REGISTRY["base:kt10000"]
    realtime = ROUTING_REGISTRY["base:0B"]
    oauth = ROUTING_REGISTRY["base:au10001"]

    assert stock.subject is RoutingSubject.INSTRUMENT
    assert EntityKind.STOCK in stock.entity_kinds
    assert sector.subject is RoutingSubject.SECTOR
    assert sector.entity_kinds == (EntityKind.SECTOR_INDEX,)
    assert order.execution is ExecutionKind.ORDER
    assert order.data_intents == (DataIntent.ORDER_ACTION,)
    assert realtime.execution is ExecutionKind.WEBSOCKET
    assert realtime.result_shapes == (RoutingResultShape.STREAM,)
    assert oauth.subject is RoutingSubject.AUTHENTICATION
    assert oauth.execution is ExecutionKind.OAUTH


def test_chart_ranking_and_order_specializations_are_derived_from_canonical_names() -> None:
    minute = ROUTING_REGISTRY["base:ka20005"]
    volume_spike = ROUTING_REGISTRY["base:ka10023"]
    orderbook_top = ROUTING_REGISTRY["base:ka10020"]
    elw_spike = ROUTING_REGISTRY["base:ka30001"]
    amend = ROUTING_REGISTRY["base:kt10002"]
    cancel = ROUTING_REGISTRY["base:kt10003"]

    assert minute.temporal_scopes == (TemporalScope.MINUTE,)
    assert DataIntent.CHART in minute.data_intents
    assert minute.result_shapes == (RoutingResultShape.TIME_SERIES,)
    assert DataIntent.VOLUME_RANKING in volume_spike.data_intents
    assert DataIntent.SPIKE_RANKING in volume_spike.data_intents
    assert DataIntent.ORDERBOOK_RANKING in orderbook_top.data_intents
    assert DataIntent.TOP_RANKING in orderbook_top.data_intents
    assert DataIntent.RANKING in elw_spike.data_intents
    assert DataIntent.SPIKE_RANKING in elw_spike.data_intents
    assert elw_spike.result_shapes == (RoutingResultShape.RANKING,)
    assert DataIntent.ORDER_AMEND in amend.data_intents
    assert DataIntent.ORDER_CANCEL in cancel.data_intents


def test_current_product_quote_gap_ranking_and_holdings_collection_are_semantic() -> None:
    gold_quote = ROUTING_REGISTRY["base:ka50100"]
    elw_gap = ROUTING_REGISTRY["base:ka30004"]
    holdings = ROUTING_REGISTRY["detail:kt00018:holdings"]

    assert gold_quote.data_intents == (DataIntent.CURRENT_QUOTE,)
    assert DataIntent.RANKING in elw_gap.data_intents
    assert elw_gap.result_shapes == (RoutingResultShape.RANKING,)
    assert holdings.data_intents == (DataIntent.PORTFOLIO, DataIntent.HOLDINGS)
    assert holdings.result_shapes == (RoutingResultShape.COLLECTION,)


def test_websocket_event_state_and_unregister_controls_have_distinct_intents() -> None:
    websocket_refs = [
        f"base:{tr_id}" for tr_id, spec in TR_REGISTRY.items() if spec.kind == "websocket"
    ]
    assert len(websocket_refs) == 23
    for operation_ref in websocket_refs:
        routing = ROUTING_REGISTRY[operation_ref]
        if operation_ref == "base:ka10174":
            assert DataIntent.UNSUBSCRIPTION in routing.data_intents
            assert DataIntent.SUBSCRIPTION not in routing.data_intents
        else:
            assert DataIntent.SUBSCRIPTION in routing.data_intents
            assert DataIntent.UNSUBSCRIPTION not in routing.data_intents
    assert Measure.VOLATILITY in ROUTING_REGISTRY["base:1h"].measures


def test_gold_orders_preserve_gold_product_entity() -> None:
    for tr_id in ("kt50000", "kt50001", "kt50002", "kt50003"):
        routing = ROUTING_REGISTRY[f"base:{tr_id}"]
        assert routing.subject is RoutingSubject.ORDER
        assert routing.entity_kinds == (
            EntityKind.ORDER,
            EntityKind.ACCOUNT,
            EntityKind.GOLD,
        )

    for tr_id in ("kt50030", "kt50031", "kt50075"):
        assert ROUTING_REGISTRY[f"base:{tr_id}"].entity_kinds == (
            EntityKind.ACCOUNT,
            EntityKind.GOLD,
        )


def test_cash_stock_orders_allow_etf_without_widening_credit_gold_or_elw() -> None:
    for tr_id in ("kt10000", "kt10001"):
        routing = ROUTING_REGISTRY[f"base:{tr_id}"]
        assert routing.entity_kinds == (
            EntityKind.ORDER,
            EntityKind.ACCOUNT,
            EntityKind.STOCK,
            EntityKind.ETF,
        )
        assert EntityKind.ELW not in routing.entity_kinds
        assert EntityKind.GOLD not in routing.entity_kinds

    assert EntityKind.ETF not in ROUTING_REGISTRY["base:kt10006"].entity_kinds
    assert ROUTING_REGISTRY["base:kt50000"].entity_kinds == (
        EntityKind.ORDER,
        EntityKind.ACCOUNT,
        EntityKind.GOLD,
    )


def test_stock_fill_routing_keeps_stream_identity_without_rest_quote_intent() -> None:
    routing = ROUTING_REGISTRY["base:0B"]
    assert routing.subject is RoutingSubject.INSTRUMENT
    assert routing.entity_kinds == (EntityKind.STOCK,)
    assert routing.data_intents == (DataIntent.SUBSCRIPTION,)


def test_detail_refines_semantics_but_inherits_identity_execution_and_bindings() -> None:
    base = ROUTING_REGISTRY["base:ka10001"]
    detail = ROUTING_REGISTRY["detail:ka10001:current_trading"]
    assert detail.subject == base.subject
    assert detail.entity_kinds == base.entity_kinds
    assert detail.execution == base.execution
    assert detail.bindings == base.bindings
    assert Measure.PRICE in detail.measures
    assert TemporalScope.CURRENT in detail.temporal_scopes
    assert detail.result_shapes == (RoutingResultShape.RECORD,)


def test_split_base_is_the_ordered_union_of_detail_axes() -> None:
    base = ROUTING_REGISTRY["base:ka10001"]
    children = [
        ROUTING_REGISTRY[f"detail:ka10001:{group['id']}"]
        for group in RESPONSE_PROJECTION_BY_TR_ID["ka10001"]["groups"]
    ]
    for axis in ("data_intents", "temporal_scopes", "measures", "result_shapes"):
        expected = tuple(dict.fromkeys(item for child in children for item in getattr(child, axis)))
        assert getattr(base, axis) == expected


def test_derivation_ignores_overview_and_field_descriptions() -> None:
    operations, _, output_profile, _ = _source_inputs()
    operation = next(item for item in operations if item["id"] == "ka10001")
    shape = next(item["shape"] for item in output_profile["operations"] if item["id"] == "ka10001")
    expected = derive_base_routing(operation, shape=shape)
    poisoned = {
        **operation,
        "overview": "업종 현재가 주문 실시간 계좌",
        "req_body": [{**field, "desc": "업종 현재가 주문"} for field in operation["req_body"]],
        "resp_body": [{**field, "desc": "업종 현재가 주문"} for field in operation["resp_body"]],
    }
    assert derive_base_routing(poisoned, shape=shape) == expected


def test_sparse_override_rejects_protected_axes_and_unknown_refs() -> None:
    routing = ROUTING_REGISTRY["base:ka10001"]
    with pytest.raises(ValueError, match="protected"):
        apply_routing_override(routing, {"subject": "sector"})

    operations, projections, output_profile, source = _source_inputs()
    source["overrides"] = {"base:not-real": {"measures": ["price"]}}
    with pytest.raises(ValueError, match="unknown operations"):
        build_routing_registry(operations, projections, output_profile, source)


def test_catalog_document_carries_routing_and_hash_seals_it() -> None:
    catalog = build_operation_catalog()
    operation_ref = "detail:ka10001:current_trading"
    document = catalog.by_ref[operation_ref]
    assert document.routing is ROUTING_REGISTRY[operation_ref]
    changed_routing = replace(document.routing, measures=(Measure.GENERIC,))
    changed_document = replace(document, routing=changed_routing)
    changed_documents = tuple(
        changed_document if item.operation_ref == document.operation_ref else item
        for item in catalog.documents
    )
    assert _catalog_version(changed_documents) != catalog.version


def test_nested_list_aliases_contribute_korean_measures_and_repeated_shape() -> None:
    operation = {
        "id": "synthetic-etf-history",
        "kind": "query",
        "cat": "국내주식",
        "subcat": "ETF",
        "name": "ETF일별추이요청",
        "req_body": [{"element": "stk_cd", "kor": "종목코드"}],
        "resp_body": [
            {"element": "etf_daily", "kor": "ETF일별추이", "type": "LIST"},
            {"element": "- cur_prc", "kor": "현재가", "type": "String"},
            {"element": "- trde_qty", "kor": "거래량", "type": "String"},
            {"element": "- nav", "kor": "NAV", "type": "String"},
        ],
    }
    routing = derive_base_routing(operation, shape="scalar_only")
    assert {Measure.PRICE, Measure.VOLUME, Measure.NAV} <= set(routing.measures)
    assert RoutingResultShape.TIME_SERIES in routing.result_shapes
    assert _field_aliases(operation["resp_body"]) == (
        "etf_daily",
        "ETF일별추이",
        "cur_prc",
        "현재가",
        "trde_qty",
        "거래량",
        "nav",
        "NAV",
    )


def test_compact_canonical_names_ignore_whitespace() -> None:
    operation = {
        "id": "synthetic-account-history",
        "kind": "query",
        "cat": "국내주식",
        "subcat": "계좌",
        "name": "위탁종합거래내역",
        "req_body": [],
        "resp_body": [],
    }
    routing = derive_base_routing(operation, shape="pure_list")
    assert DataIntent.HISTORY in routing.data_intents
    assert DataIntent.ACCOUNT_STATE in routing.data_intents


def test_websocket_group_binding_is_not_watchlist_binding() -> None:
    routing = ROUTING_REGISTRY["base:0B"]
    assert BindingRole.SUBSCRIPTION_GROUP in routing.bindings
    assert BindingRole.WATCHLIST_ID not in routing.bindings


def test_exact_profile_axes_are_typed_and_derived_from_operation_semantics() -> None:
    assert ActionKind.BUY in ROUTING_REGISTRY["base:kt10000"].actions
    assert FeedKind.TRADE in ROUTING_REGISTRY["base:0B"].feeds
    assert FeedKind.ORDERBOOK in ROUTING_REGISTRY["base:0D"].feeds
    assert FeedKind.PRIORITY_ORDERBOOK in ROUTING_REGISTRY["base:0C"].feeds
    assert FeedKind.AFTER_HOURS_ORDERBOOK in ROUTING_REGISTRY["base:0E"].feeds
    assert FeedKind.EXPECTED_TRADE in ROUTING_REGISTRY["base:0H"].feeds
    assert FeedKind.ELW_THEORETICAL_VALUE in ROUTING_REGISTRY["base:0m"].feeds
    assert FeedKind.TRADE in ROUTING_REGISTRY["base:0B"].feeds


def test_date_range_binding_supplies_range_temporal_scope() -> None:
    operation = {
        "id": "synthetic-period",
        "kind": "query",
        "cat": "국내주식",
        "subcat": "계좌",
        "name": "계좌내역조회",
        "req_body": [
            {"element": "strt_dt", "kor": "시작일"},
            {"element": "end_dt", "kor": "종료일"},
        ],
        "resp_body": [],
    }
    routing = derive_base_routing(operation, shape="pure_list")
    assert BindingRole.DATE_RANGE in routing.bindings
    assert routing.temporal_scopes == (TemporalScope.RANGE,)


def test_fifty_two_week_profiles_share_capability_but_keep_source_semantics() -> None:
    sector = ROUTING_REGISTRY["detail:ka20001:fifty_two_week_range"]
    history = ROUTING_REGISTRY["detail:ka20009:fifty_two_week_range"]
    assert CapabilityKind.PRICE_RANGE_52W in sector.capabilities
    assert CapabilityKind.PRICE_RANGE_52W in history.capabilities
    assert DataIntent.CURRENT_QUOTE in sector.data_intents
    assert DataIntent.HISTORY in history.data_intents
    assert TemporalScope.CURRENT in sector.temporal_scopes
    assert TemporalScope.DAILY in history.temporal_scopes
    assert (
        CapabilityKind.PRICE_RANGE_52W
        in ROUTING_REGISTRY["detail:ka10001:price_range"].capabilities
    )


def test_selector_routing_source_rejects_duplicate_keys() -> None:
    with pytest.raises(ValueError, match="duplicate JSON key"):
        json.loads(
            '{"overrides": {"base:x": {}, "base:x": {}}}',
            object_pairs_hook=_reject_duplicate_keys,
        )


def test_equivalence_groups_reject_incompatible_core_axes() -> None:
    source = {
        "equivalence_groups": {
            "bad": {
                "canonical_ref": "base:ka10001",
                "members": ["base:ka10001", "base:ka20001"],
                "qualifier_axes": ["data_intents"],
            }
        }
    }
    with pytest.raises(ValueError, match="routing differences"):
        validate_routing_equivalence_groups(source, ROUTING_REGISTRY)


def test_reviewed_sector_52_week_equivalence_is_fingerprint_sealed() -> None:
    source, contracts, _, _, _ = _equivalence_inputs()
    groups = validate_routing_equivalence_groups(source, ROUTING_REGISTRY, contracts)
    group = groups["sector_52_week_range"]
    assert group == ROUTING_EQUIVALENCE_GROUPS["sector_52_week_range"]
    assert group["canonical_ref"] == SECTOR_52W_REFS[0]
    assert group["members"] == list(SECTOR_52W_REFS)
    assert re.fullmatch(r"sha256:[0-9a-f]{64}", group["contract_fingerprint"])


def test_equivalence_group_changes_catalog_version(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = build_operation_catalog()
    monkeypatch.setattr(catalog_module, "ROUTING_EQUIVALENCE_GROUPS", {})
    assert _catalog_version(catalog.documents) != catalog.version


@pytest.mark.parametrize(
    ("component", "mutate"),
    [
        (
            "request",
            lambda contract: contract["request"]["fields"][0].update(required=False),
        ),
        (
            "response projection",
            lambda contract: contract["response"]["fields"][0].update(nullable=False),
        ),
        (
            "layout",
            lambda contract: contract["presentation"]["manifest"].update(layout="table"),
        ),
        (
            "visibility",
            lambda contract: contract["selector_surface"].update(visibility="explicit"),
        ),
        (
            "safety",
            lambda contract: contract["selector_surface"].update(read_only=False),
        ),
        (
            "upstream",
            lambda contract: contract["upstream"].update(path="/incompatible"),
        ),
    ],
)
def test_equivalence_rejects_same_routing_with_incompatible_contract(
    component: str,
    mutate: object,
) -> None:
    source, contracts, _, _, _ = _equivalence_inputs()
    poisoned = deepcopy(contracts)
    mutate(poisoned[SECTOR_52W_REFS[1]])  # type: ignore[operator]
    with pytest.raises(ValueError, match="normalized contract mismatch"):
        validate_routing_equivalence_groups(source, ROUTING_REGISTRY, poisoned)
    assert component


def test_equivalence_ignores_only_root_pydantic_model_class_titles() -> None:
    source, _, operations, manifest, definitions = _equivalence_inputs()
    renamed_manifest = deepcopy(manifest)
    renamed = next(
        mapping
        for mapping in renamed_manifest["mappings"]
        if mapping["mapping_id"] == SECTOR_52W_REFS[1]
    )
    renamed["contracts"]["request_model"] = "renamed.RequestTitleOnly"
    renamed["contracts"]["response_model"] = "renamed.ResponseTitleOnly"
    contracts = build_routing_equivalence_contracts(
        operations,
        json.loads((BACKEND / "ref" / "response-projections.json").read_text("utf-8")),
        renamed_manifest,
        definitions,
    )
    groups = validate_routing_equivalence_groups(source, ROUTING_REGISTRY, contracts)
    assert groups["sector_52_week_range"]["canonical_ref"] == SECTOR_52W_REFS[0]


def test_equivalence_global_guards_reject_duplicate_membership() -> None:
    source, contracts, _, _, _ = _equivalence_inputs()
    duplicated = deepcopy(source)
    duplicated["equivalence_groups"]["duplicate"] = deepcopy(
        duplicated["equivalence_groups"]["sector_52_week_range"]
    )
    with pytest.raises(ValueError, match="multiple groups"):
        validate_routing_equivalence_groups(duplicated, ROUTING_REGISTRY, contracts)


def test_noncanonical_equivalent_operation_remains_exactly_addressable() -> None:
    catalog = build_operation_catalog()
    document = catalog.find_exact(SECTOR_52W_REFS[1])
    assert document is not None
    assert document.operation_ref == SECTOR_52W_REFS[1]
