# ruff: noqa: E402, I001
from __future__ import annotations

from collections import Counter
import sys
from pathlib import Path

TESTS = Path(__file__).resolve().parents[1]
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from athena_api.canvas_card_registry import get_canvas_card_registry
from athena_api.canvas_field_registry import (
    get_canvas_field_registry,
    get_operation_field_contract,
)
from support.canvas_fixture_factory import (
    build_fixture_bundle,
    build_operation_fixtures,
)


def test_all_299_response_models_accept_lossless_synthetic_fixtures() -> None:
    fixtures = build_operation_fixtures()

    assert len(fixtures) == 299
    assert len({fixture.mapping_id for fixture in fixtures}) == 299
    assert all(fixture.validated_payload for fixture in fixtures)
    assert all(fixture.response_model for fixture in fixtures)
    assert Counter(fixture.canvas_type for fixture in fixtures) == {
        "action": 12,
        "chart": 19,
        "compound": 17,
        "event": 23,
        "facts": 114,
        "table": 114,
    }
    assert all(fixture.screen_id and fixture.primary_data for fixture in fixtures)
    assert all(
        fixture.renderer_id == "aits-chart-v1"
        for fixture in fixtures
        if fixture.canvas_type == "chart"
    )


def test_all_3705_occurrences_have_exact_runtime_destinations_and_sentinels() -> None:
    fixtures = build_operation_fixtures()
    occurrences = [
        occurrence for fixture in fixtures for occurrence in fixture.occurrences
    ]
    registry = get_canvas_card_registry()

    assert len(occurrences) == 3_705
    assert len({occurrence.occurrence_id for occurrence in occurrences}) == 3_705
    assert len({(item.mapping_id, item.json_path) for item in occurrences}) == 3_703
    assert all(item.sentinel_id == f"sentinel::{item.occurrence_id}" for item in occurrences)
    assert all(item.card_id in {card.card_id for card in registry.cards} for item in occurrences)
    assert all(
        item.mode and item.section and item.surface == "detail-sheet"
        for item in occurrences
    )
    assert all(item.semantic_status in {"official", "official_opaque"} for item in occurrences)

    for fixture in fixtures:
        public_contract = get_operation_field_contract(fixture.mapping_id)
        assert [item.occurrence_id for item in fixture.occurrences] == [
            str(item["occurrence_id"]) for item in public_contract
        ]
        assert {
            (
                str(item["card_id"]),
                str(item["mode"]),
                str(item["section"]),
                str(item["surface"]),
            )
            for item in public_contract
        } == {
            (item.card_id, item.mode, item.section, item.surface)
            for item in fixture.occurrences
        }


def test_ka10173_duplicate_wire_paths_keep_both_ordinals() -> None:
    fixtures = {item.mapping_id: item for item in build_operation_fixtures()}
    counts = Counter(
        (item.json_path, item.ordinal)
        for item in fixtures["base:ka10173"].occurrences
    )

    assert counts[("$.trnm", 1)] == 1
    assert counts[("$.trnm", 2)] == 1
    assert counts[("$.data", 1)] == 1
    assert counts[("$.data", 2)] == 1


def test_fixture_bundle_matches_registry_and_has_no_external_side_effect_lane() -> None:
    bundle = build_fixture_bundle()
    field_summary = get_canvas_field_registry().summary

    assert bundle["fixture_only"] is True
    assert bundle["external_calls_allowed"] is False
    assert bundle["operation_count"] == 299
    assert bundle["field_occurrence_count"] == 3_705
    assert bundle["unique_field_path_count"] == 3_703
    assert [card["card_id"] for card in bundle["cards"]] == [
        "CC-01",
        "CC-02",
        "CC-03",
        "CC-04",
        "CC-05",
        "CC-06",
    ]
    assert sum(card["operation_count"] for card in bundle["cards"]) == 299
    assert sum(card["field_count"] for card in bundle["cards"]) == 3_705
    assert field_summary.registry_ready is True
    assert field_summary.review_ready is False
    assert field_summary.unresolved_semantic_count == 0


def test_all_order_fixtures_are_draft_only_and_reach_required_receipt_fields() -> None:
    fixtures = build_operation_fixtures()
    order_ids = {
        *(f"base:kt1000{suffix}" for suffix in (0, 1, 2, 3, 6, 7, 8, 9)),
        *(f"base:kt5000{suffix}" for suffix in (0, 1, 2, 3)),
    }
    order_fixtures = [item for item in fixtures if item.mapping_id in order_ids]
    aliases = {
        occurrence.alias
        for fixture in order_fixtures
        for occurrence in fixture.occurrences
    }

    assert {item.mapping_id for item in order_fixtures} == order_ids
    assert len(order_fixtures) == 12
    assert {"ord_no", "base_orig_ord_no", "mdfy_qty", "cncl_qty", "dmst_stex_tp"} <= aliases
    assert all(
        occurrence.card_id == "CC-02" and occurrence.surface == "detail-sheet"
        for fixture in order_fixtures
        for occurrence in fixture.occurrences
    )
    assert all(item.canvas_type == "action" for item in order_fixtures)
    assert all(item.primary_data["state"] == "draft" for item in order_fixtures)
    # The factory validates response models only: it cannot build a request,
    # call a selector execution endpoint, or reach a broker client.
    assert build_fixture_bundle()["external_calls_allowed"] is False
