from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import replace

import pytest

from athena_api.canvas_field_registry import get_canvas_field_registry
from athena_api.semantic_presentation_registry import (
    _VERIFIED_OPERATION_FIELD_AUTHORITIES,
    FIELD_CLASSES,
    UNRESOLVED_ALIASES,
    WORKFLOW_ONLY_SECTIONS,
    SemanticPresentationRegistry,
    SemanticPresentationRegistryError,
    _canonical_concept_id,
    get_public_operation_presentation,
    get_public_recipe_sections,
    get_semantic_presentation_registry,
    get_semantic_presentation_release_gates,
)


def test_overlay_classifies_all_3705_lossless_wire_occurrences() -> None:
    wire = get_canvas_field_registry()
    registry = get_semantic_presentation_registry()
    summary = registry.summary

    assert len(registry.contracts) == summary.occurrence_count == 3_705
    assert {item.wire_occurrence_id for item in registry.contracts} == {
        item.occurrence_id for item in wire.contracts
    }
    assert {item.field_class for item in registry.contracts} <= FIELD_CLASSES
    assert summary.operation_count == 299
    assert summary.unique_wire_occurrence_count == 3_705
    assert summary.duplicate_wire_path_occurrence_count == 2
    assert summary.wire_lossless is True
    assert summary.fully_classified is True


def test_every_semantic_occurrence_has_stable_named_product_placement() -> None:
    semantic = [
        item
        for item in get_semantic_presentation_registry().contracts
        if item.field_class == "semantic"
    ]

    assert semantic
    assert all(
        item.concept_id
        and item.concept_id.startswith("concept.")
        and len(item.concept_id) == 24
        for item in semantic
    )
    assert all(item.label_ko and item.description for item in semantic)
    assert all(item.unit_or_format and item.time_basis for item in semantic)
    assert all(item.recipe_id and item.section_id and item.component_id for item in semantic)
    assert all(item.visual_role and item.source_precedence for item in semantic)
    assert all(item.placement_rule_id and item.placement_basis for item in semantic)
    assert all(item.semantic_basis and "|" in item.semantic_basis for item in semantic)
    assert all(
        item.display_tier in {"answer", "primary", "support", "detail"}
        for item in semantic
    )
    assert all(item.display_group and item.display_order is not None for item in semantic)
    assert all(item.display_slot is None or item.display_slot >= 0 for item in semantic)
    assert all(
        item.visibility_policy in {"always", "row-detail", "named-detail"}
        for item in semantic
    )
    assert all(item.product_destination for item in semantic)
    assert len(semantic) == len({item.wire_occurrence_id for item in semantic}) == 3_500
    assert all(
        token not in item.product_destination.lower()
        for item in semantic
        for token in ("raw", "detail-sheet", "all-fields", "원본")
    )


def test_transport_internal_and_unresolved_never_receive_product_destination() -> None:
    hidden = [
        item
        for item in get_semantic_presentation_registry().contracts
        if item.field_class in {"transport", "internal", "unresolved"}
    ]

    assert hidden
    assert all(item.product_destination is None for item in hidden)
    assert all(item.recipe_id is None for item in hidden)
    assert all(item.section_id is None and item.component_id is None for item in hidden)
    assert all(item.public_serializable() is None for item in hidden)


def test_technical_presentation_controls_never_enter_public_ui() -> None:
    registry = get_semantic_presentation_registry()
    internal = [item for item in registry.contracts if item.field_class == "internal"]

    assert registry.summary.internal_count == 110
    assert registry.summary.semantic_count == 3_500
    assert any(item.alias == "values" and item.mapping_id == "base:0F" for item in internal)
    assert any(item.label_ko is None and item.alias == "282" for item in internal)
    assert any(item.alias == "buy_trde_ori_cd_2" for item in internal)

    public_text = json.dumps(
        [item.public_serializable() for item in registry.contracts if item.user_visible],
        ensure_ascii=False,
    )
    assert all(
        token not in public_text
        for token in ("거래원색깔", "거래원코드", "실시간 값 리스트", "values")
    )


def test_nontechnical_name_and_named_code_detail_policy_are_preserved() -> None:
    registry = get_semantic_presentation_registry()
    instrument_name = next(
        item for item in registry.for_operation("base:ka10100") if item.alias == "name"
    )
    named_code = next(
        item for item in registry.for_operation("base:ka01690") if item.alias == "stk_cd"
    )

    assert instrument_name.field_class == "semantic"
    assert instrument_name.public_serializable() is not None
    assert (named_code.display_tier, named_code.visibility_policy) == (
        "detail",
        "row-detail",
    )


def test_vi_schema_labels_are_normalized_for_investor_ui() -> None:
    registry = get_semantic_presentation_registry()
    labels = {
        item.alias: item.label_ko
        for mapping_id in ("base:ka10054", "base:1h")
        for item in registry.for_operation(mapping_id)
        if item.user_visible
    }

    assert labels["dynm_dispty_rt"] == "동적 VI 괴리율"
    assert labels["dynm_stdpc"] == "동적 VI 기준가"
    assert labels["1225"] == "VI 적용 방식"
    assert labels["1237"] == "동적 VI 기준가"
    assert labels["1239"] == "동적 VI 괴리율"


def test_current_rest_951_924_and_1279_are_the_only_unresolved_occurrences() -> None:
    contracts = get_semantic_presentation_registry().contracts
    unresolved = [item for item in contracts if item.field_class == "unresolved"]

    assert {item.alias for item in unresolved} == UNRESOLVED_ALIASES == {
        "951",
        "924",
        "1279",
    }
    assert len(unresolved) == 3
    assert all(item.product_destination is None for item in unresolved)
    assert all(item.label_ko is None for item in unresolved)


def test_all_299_operations_are_recipe_reachable_and_public_contract_is_safe() -> None:
    registry = get_semantic_presentation_registry()

    assert registry.summary.recipe_reachable_operation_count == 299
    assert registry.summary.recipe_reachability_complete is True
    public = get_public_operation_presentation("detail:ka10001:valuation")
    assert public
    assert json.loads(json.dumps(public, ensure_ascii=False)) == public
    assert all("json_path" not in item and "alias" not in item for item in public)
    assert all("wire_occurrence_id" not in item and "mapping_id" not in item for item in public)
    assert all(
        "placement_rule_id" not in item and "placement_basis" not in item
        for item in public
    )
    assert all("semantic_basis" not in item for item in public)
    assert all(
        {"display_tier", "display_group", "display_order", "visibility_policy"}
        <= item.keys()
        for item in public
    )
    assert all("display_slot" in item for item in public)


def test_numbered_wire_schema_is_expressed_as_label_family_and_slot() -> None:
    registry = get_semantic_presentation_registry()
    slotted = [
        item for item in registry.contracts if item.user_visible and item.display_slot is not None
    ]

    assert len(slotted) == 264
    assert all(not re.search(r"\d+$", item.label_ko) for item in slotted)
    assert all(item.display_group for item in slotted)

    broker = {
        item.alias: item
        for item in registry.for_operation("base:0F")
        if item.alias in {"141", "172", "177", "173", "179"}
    }
    assert (broker["141"].label_ko, broker["141"].display_slot) == (
        "매도 거래원",
        1,
    )
    assert (broker["172"].label_ko, broker["172"].display_slot) == (
        "매수 거래원 수량",
        2,
    )
    assert (broker["177"].label_ko, broker["177"].display_slot) == (
        "매수 거래원 증감",
        2,
    )
    assert broker["173"].display_slot == 3
    assert broker["179"].display_slot == 4
    assert {
        broker[alias].display_group for alias in ("172", "177", "173", "179")
    } == {"매수 거래원"}


def test_known_compound_labels_are_user_facing_without_invented_values() -> None:
    registry = get_semantic_presentation_registry()
    foreign_change = next(
        item for item in registry.for_operation("base:0F") if item.alias == "264"
    )
    elw = {
        item.alias: item
        for item in registry.for_operation("base:ka30005")
        if item.alias in {"lpmmcm_nm_1", "lpmmcm_nm_2", "lpinitlast_suply_dt"}
    }

    assert foreign_change.label_ko == "외국계 매수 추정 합계 변동"
    assert (elw["lpmmcm_nm_1"].label_ko, elw["lpmmcm_nm_1"].display_slot) == (
        "LP 회원사",
        1,
    )
    assert (elw["lpmmcm_nm_2"].label_ko, elw["lpmmcm_nm_2"].display_slot) == (
        "LP 회원사",
        2,
    )
    assert elw["lpinitlast_suply_dt"].label_ko == "LP 최초·최종 공급일"

    public_text = json.dumps(
        [item.public_serializable() for item in registry.contracts if item.user_visible],
        ensure_ascii=False,
    )
    assert all(
        token not in public_text
        for token in (
            "외국계매수추정합변동",
            "매도거래원1",
            "매수거래원별증감2",
            "매수거래원수량3",
            "LP회원사명1",
            "LP초종공급일",
        )
    )


def test_canonical_concepts_dedupe_known_official_label_synonyms() -> None:
    def concept(label: str) -> str:
        return _canonical_concept_id(
            label,
            label,
            "percentage-or-ratio",
            "market-session-realtime",
            "rate-or-ratio",
        )

    assert concept("등락율") == concept("등락률")
    assert _canonical_concept_id(
        "종목번호", "종목번호", "identifier", "query-as-of", "identity"
    ) == _canonical_concept_id(
        "종목코드", "종목코드", "identifier", "query-as-of", "identity"
    )
    assert _canonical_concept_id(
        "대비기호", "대비기호", "source-defined-number-or-text", "query-as-of", "descriptive-value"
    ) == _canonical_concept_id(
        "전일대비기호",
        "전일대비기호",
        "source-defined-number-or-text",
        "query-as-of",
        "descriptive-value",
    )


def test_canonical_concepts_separate_distinct_meanings_and_hide_aliases() -> None:
    price = _canonical_concept_id(
        "현재가", "현재가", "currency-or-price", "market-session-realtime", "price-or-money"
    )
    quantity = _canonical_concept_id(
        "거래량", "거래량", "quantity", "market-session-realtime", "quantity"
    )

    assert price != quantity
    assert all(token not in price.lower() for token in ("cur_prc", "fid", "현재가"))
    assert all(
        item.alias.lower() not in item.concept_id.lower()
        for item in get_semantic_presentation_registry().contracts
        if item.user_visible and len(item.alias) > 3
    )


def test_exact_snapshot_and_realtime_current_price_share_canonical_identity() -> None:
    registry = get_semantic_presentation_registry()
    snapshot = next(
        item for item in registry.for_operation("base:ka10081") if item.alias == "cur_prc"
    )
    realtime = next(
        item for item in registry.for_operation("base:0B") if item.alias == "10"
    )

    assert snapshot.concept_id == realtime.concept_id
    assert snapshot.semantic_basis == realtime.semantic_basis
    assert snapshot.unit_or_format == realtime.unit_or_format == "currency-or-price"
    assert snapshot.semantic_basis.endswith("|price-or-money")


def test_current_price_authority_scope_and_canonical_hash_are_pinned() -> None:
    expected_concept_id = "concept.2904bd513e2c3f3f"

    assert _canonical_concept_id(
        "현재가",
        "현재가",
        "currency-or-price",
        "requested-period",
        "price-or-money",
    ) == expected_concept_id
    assert set(_VERIFIED_OPERATION_FIELD_AUTHORITIES) == {
        ("base:ka10081", "cur_prc"),
        ("base:0B", "10"),
    }
    assert {
        authority.concept_id
        for authority in _VERIFIED_OPERATION_FIELD_AUTHORITIES.values()
    } == {expected_concept_id}


def test_exact_product_display_authorities_are_separate_from_semantic_units() -> None:
    registry = get_semantic_presentation_registry()
    expected = {
        ("base:ka10081", "cur_prc"): {
            "formatter_id": "grouped-number",
            "display_unit": "원",
            "sign_policy": "absolute",
        },
        ("base:ka10081", "trde_qty"): {
            "formatter_id": "grouped-number",
            "display_unit": "주",
            "sign_policy": "absolute",
        },
        ("detail:ka10001:current_trading", "flu_rt"): {
            "formatter_id": "decimal-number",
            "display_unit": "%",
            "sign_policy": "always",
        },
        ("base:ka10081", "dt"): {
            "formatter_id": "date-yyyymmdd",
            "display_unit": "",
            "sign_policy": "none",
        },
        ("base:ka10081", "stk_cd"): {
            "formatter_id": "stock-code",
            "display_unit": "",
            "sign_policy": "none",
        },
    }

    for (mapping_id, alias), display_metadata in expected.items():
        contract = next(
            item for item in registry.for_operation(mapping_id) if item.alias == alias
        )
        public = contract.public_serializable()
        assert public is not None
        assert public["unit_or_format"] == contract.unit_or_format
        assert public["display_metadata"] == display_metadata


def test_units_use_exact_schema_tokens_without_substring_false_positives() -> None:
    registry = get_semantic_presentation_registry()

    def field(mapping_id: str, alias: str):
        return next(
            item for item in registry.for_operation(mapping_id) if item.alias == alias
        )

    securities_amount = field(
        "detail:kt00016:asset_balance_change", "scrt_evlt_amt_fr"
    )
    trade_kind = field("base:kt00015", "trde_prtc_tp")
    volume_update = field("base:ka10024", "trde_qty_updt")
    current_price = field("detail:ka10001:current_trading", "cur_prc")

    # Embedded substrings are not schema tokens: ``scrt`` is not ``rt`` and
    # ``updt`` is not ``dt``.  Exact ``amt``, ``qty``, and ``prc`` tokens retain
    # their authoritative financial meanings.
    assert securities_amount.unit_or_format == "currency-or-price"
    assert trade_kind.unit_or_format == "source-defined-number-or-text"
    assert volume_update.unit_or_format == "quantity"
    assert current_price.unit_or_format == "currency-or-price"
    assert securities_amount.semantic_basis.endswith("|price-or-money")
    assert volume_update.semantic_basis.endswith("|quantity")
    assert current_price.semantic_basis.endswith("|price-or-money")

    # Ambiguous source-defined values remain safely described by their official
    # label; the raw wire alias is never part of the public presentation contract.
    public_trade_kind = trade_kind.public_serializable()
    assert public_trade_kind is not None
    assert public_trade_kind["label_ko"] == "거래내역구분"
    assert "alias" not in public_trade_kind


def test_representative_exact_tokens_cover_financial_unit_families() -> None:
    registry = get_semantic_presentation_registry()

    expected = {
        ("base:ka01690", "evlt_amt"): "currency-or-price",
        ("base:ka10079", "trde_qty"): "quantity",
        ("base:ka50101", "flu_rt"): "percentage-or-ratio",
        ("base:ka01690", "dt"): "date",
        ("base:ka01690", "stk_cd"): "identifier",
        ("base:ka10081", "cur_prc"): "currency-or-price",
    }

    for (mapping_id, alias), unit_or_format in expected.items():
        item = next(
            field
            for field in registry.for_operation(mapping_id)
            if field.alias == alias
        )
        assert item.unit_or_format == unit_or_format


def test_current_trading_snapshot_uses_exact_instrument_chart_placement() -> None:
    registry = get_semantic_presentation_registry()
    current_trading = {
        item.alias: item
        for item in registry.for_operation("detail:ka10001:current_trading")
    }

    assert set(current_trading) == {
        "cur_prc",
        "pre_sig",
        "pred_pre",
        "flu_rt",
        "trde_qty",
        "trde_pre",
    }
    assert {
        current_trading[alias].section_id
        for alias in ("cur_prc", "pre_sig", "pred_pre", "flu_rt")
    } == {"identity-and-quote"}
    assert {
        current_trading[alias].section_id
        for alias in ("trde_qty", "trde_pre")
    } == {"volume-and-period"}
    assert {item.recipe_id for item in current_trading.values()} == {
        "instrument-chart"
    }
    assert current_trading["cur_prc"].display_tier == "answer"
    assert current_trading["pre_sig"].label_ko == "전일 대비 기호"
    assert current_trading["pred_pre"].unit_or_format == "currency-or-price"
    assert current_trading["trde_qty"].unit_or_format == "quantity"
    assert current_trading["trde_pre"].unit_or_format == "quantity"

    # The override is operation-specific. Other stock-info projections retain
    # the discovery/value product meaning selected by their verified recipe.
    valuation = registry.for_operation("detail:ka10001:valuation")
    assert valuation
    assert {item.recipe_id for item in valuation if item.user_visible} == {
        "discovery-value"
    }
    assert {item.section_id for item in valuation if item.user_visible} == {
        "valuation-and-profile"
    }

    other_pre_sig = next(
        item
        for item in registry.for_operation("base:ka90008")
        if item.alias == "pre_sig"
    )
    assert other_pre_sig.label_ko == "대비기호"


def test_public_labels_never_fall_back_to_raw_financial_aliases_or_numeric_fids() -> None:
    registry = get_semantic_presentation_registry()
    forbidden_aliases = {"cur_prc", "pre_sig", "pred_pre"}

    public = [item for item in registry.contracts if item.user_visible]
    assert public
    assert all(item.label_ko not in forbidden_aliases for item in public)
    assert all(not re.fullmatch(r"\d+", item.label_ko or "") for item in public)
    assert all(
        not re.fullmatch(r"[a-z][a-z0-9_]*", item.label_ko or "")
        for item in public
    )
    trade_sign = next(
        item
        for item in registry.for_operation("base:ka10003")
        if item.alias == "sign"
    )
    assert trade_sign.label_ko == "전일 대비 기호"


def test_canonical_concept_collision_fails_closed() -> None:
    registry = get_semantic_presentation_registry()
    first = next(item for item in registry.contracts if item.user_visible)
    second = next(
        item
        for item in registry.contracts
        if item.user_visible and item.semantic_basis != first.semantic_basis
    )
    conflicting = tuple(
        replace(item, concept_id=first.concept_id)
        if item.wire_occurrence_id == second.wire_occurrence_id
        else item
        for item in registry.contracts
    )

    with pytest.raises(SemanticPresentationRegistryError, match="canonical concept collision"):
        SemanticPresentationRegistry(conflicting)


def test_display_priority_promotes_investor_answers_and_defers_long_tail() -> None:
    registry = get_semantic_presentation_registry()

    current = next(
        item for item in registry.for_operation("base:ka10081") if item.alias == "cur_prc"
    )
    identity = next(
        item for item in registry.for_operation("base:ka10081") if item.alias == "stk_cd"
    )
    long_tail = next(
        item
        for item in registry.for_operation("base:ka10081")
        if item.alias == "trde_tern_rt"
    )
    receipt = next(
        item for item in registry.for_operation("base:kt10000") if item.alias == "ord_no"
    )

    assert (current.display_tier, current.visibility_policy) == ("answer", "always")
    assert (receipt.display_tier, receipt.visibility_policy) == ("answer", "always")
    assert (identity.display_tier, identity.visibility_policy) == ("support", "always")
    assert (long_tail.display_tier, long_tail.visibility_policy) == (
        "detail",
        "row-detail",
    )
    assert current.display_order < identity.display_order < long_tail.display_order


def test_public_recipe_sections_expose_order_and_honest_population_policy() -> None:
    order_sections = get_public_recipe_sections("order-safe-ticket")

    assert [item["section_order"] for item in order_sections] == [1, 2, 3]
    assert [item["section_policy"] for item in order_sections] == [
        "workflow",
        "workflow",
        "when-data",
    ]
    assert [item["workflow_only"] for item in order_sections] == [True, True, False]
    assert [item["required"] for item in order_sections] == [False, False, False]
    assert [item["field_count"] for item in order_sections[:2]] == [0, 0]
    assert order_sections[2]["field_count"] == 30


def test_every_non_workflow_recipe_section_has_real_response_fields() -> None:
    registry = get_semantic_presentation_registry()
    from athena_api.view_recipe_registry import get_view_recipe_registry

    recipes = get_view_recipe_registry().recipes
    expected = {
        (recipe.recipe_id, section_id)
        for recipe in recipes
        for section_id in recipe.section_ids
        if section_id not in WORKFLOW_ONLY_SECTIONS.get(recipe.recipe_id, ())
    }

    assert set(registry.section_population) == expected
    assert all(registry.section_population[key] > 0 for key in expected)
    assert registry.summary.unpopulated_non_workflow_section_count == 0
    assert registry.summary.recipe_sections_populated is True


def test_workflow_only_sections_are_explicit_and_never_fake_field_destinations() -> None:
    registry = get_semantic_presentation_registry()

    assert dict(registry.workflow_only_sections) == {
        "discovery-value": ("discovery-filters",),
        "watchlist-condition": ("saved-scope",),
        "order-safe-ticket": ("order-draft", "cost-and-risk-preview"),
        "gold-market": ("gold-position-and-settlement",),
    }
    destinations = {
        (item.recipe_id, item.section_id) for item in registry.contracts if item.user_visible
    }
    assert all(
        (recipe_id, section_id) not in destinations
        for recipe_id, sections in WORKFLOW_ONLY_SECTIONS.items()
        for section_id in sections
    )


def _field_section(mapping_id: str, alias: str) -> str | None:
    fields = get_semantic_presentation_registry().for_operation(mapping_id)
    return next(item.section_id for item in fields if item.alias == alias)


def test_representative_financial_field_groups_land_in_semantic_sections() -> None:
    assert _field_section("base:ka10081", "stk_cd") == "identity-and-quote"
    assert _field_section("base:ka10081", "open_pric") == "price-history"
    assert _field_section("base:ka10081", "trde_qty") == "volume-and-period"

    assert _field_section("detail:ka10004:snapshot_time", "bid_req_base_tm") == (
        "quote-context"
    )
    assert _field_section("detail:ka10004:sell_bid_prices", "sel_fpr_bid") == (
        "depth-ladder"
    )
    assert _field_section("base:ka50101", "cntr_pric") == "trade-tape"

    assert _field_section("base:ka01690", "tot_buy_amt") == "account-summary"
    assert _field_section("base:ka01690", "stk_cd") == "positions-and-performance"
    assert _field_section("detail:kt00001:settlement_forecast", "d1_entra") == (
        "settlement-and-risk"
    )

    assert _field_section("base:ka40002", "stk_nm") == "etf-summary"
    assert _field_section("base:ka40009", "nav") == "nav-and-performance"
    assert _field_section("base:ka40009", "stkcnt") == "constituents"

    assert _field_section("base:ka30004", "stk_cd") == "elw-summary"
    assert _field_section("base:ka10048", "delta") == "sensitivity-and-expiry"
    assert _field_section("base:ka30003", "lprmnd_qty") == "liquidity-provider"

    assert _field_section("base:kt10000", "ord_no") == "confirmation-and-receipt"


def test_multi_section_capabilities_are_not_single_section_dumps() -> None:
    registry = get_semantic_presentation_registry()
    expected_multi_section = {
        "account",
        "chart",
        "quote",
        "orderbook",
        "program-trading",
        "investor-flow",
        "broker",
        "etf",
        "elw",
        "sector",
        "theme",
        "market-status",
        "gold",
    }

    for capability_id in expected_multi_section:
        sections = {
            item.section_id
            for item in registry.contracts
            if item.user_visible and item.capability_id == capability_id
        }
        assert len(sections) > 1, capability_id


def test_duplicate_wire_paths_keep_both_occurrences_in_overlay() -> None:
    contracts = get_semantic_presentation_registry().for_operation("base:ka10173")
    repeated = [item for item in contracts if item.json_path in {"$.trnm", "$.data"}]

    assert Counter(item.json_path for item in repeated) == {"$.trnm": 2, "$.data": 2}
    assert len({item.wire_occurrence_id for item in repeated}) == 4


def test_release_gates_distinguish_structural_review_from_unresolved_release() -> None:
    gates = get_semantic_presentation_release_gates()

    assert gates["review_ready"] is True
    assert gates["semantic_placement_complete"] is True
    assert gates["product_destination_safe"] is True
    assert gates["release_ready"] is False
    assert gates["unresolved_count"] == 3
    assert gates["release_blockers"] == ["unresolved-field-semantics"]
