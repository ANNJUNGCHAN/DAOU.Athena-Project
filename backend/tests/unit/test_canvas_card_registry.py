from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from athena_api.canvas_card_registry import (
    CanvasCardRegistryError,
    build_canvas_card_registry,
    get_canvas_card_registry,
    resolve_canvas_card,
)
from athena_api.canvas_field_registry import get_operation_field_contract

BACKEND = Path(__file__).resolve().parents[2]
ASSIGNMENT_PATH = BACKEND / "ref" / "kiwoom-capability-assignment.json"

EXPECTED_CARDS = {
    "CC-01": ({"account"}, 76),
    "CC-02": ({"order"}, 12),
    "CC-03": ({"chart", "etf", "elw", "stock-info", "quote", "gold"}, 88),
    "CC-04": ({"orderbook"}, 31),
    "CC-05": (
        {"program-trading", "investor-flow", "broker", "credit-lending-short"},
        50,
    ),
    "CC-06": (
        {"sector", "discovery", "watchlist", "theme", "market-status", "condition-search"},
        42,
    ),
}


@pytest.fixture(scope="module")
def assignment() -> dict:
    return json.loads(ASSIGNMENT_PATH.read_text(encoding="utf-8"))


def test_registry_compresses_19_capabilities_and_299_operations_into_six_cards() -> None:
    registry = get_canvas_card_registry()

    assert len(registry.cards) == 6
    assert registry.capability_count == 19
    assert registry.operation_count == 299
    assert sum(card.operation_count for card in registry.cards) == 299
    assert {
        card.card_id: (set(card.capability_ids), card.operation_count)
        for card in registry.cards
    } == EXPECTED_CARDS


@pytest.mark.parametrize(
    ("identifier", "expected_card", "expected_capability"),
    [
        ("account", "CC-01", "account"),
        ("order", "CC-02", "order"),
        ("chart", "CC-03", "chart"),
        ("base:ka10079", "CC-03", "chart"),
        ("base:0C", "CC-04", "orderbook"),
        ("investor-flow", "CC-05", "investor-flow"),
        ("condition-search", "CC-06", "condition-search"),
    ],
)
def test_operation_or_capability_resolves_to_one_deterministic_card(
    identifier: str,
    expected_card: str,
    expected_capability: str,
) -> None:
    resolved = resolve_canvas_card(identifier)

    assert resolved.card_id == expected_card
    assert resolved.capability_id == expected_capability


def test_mode_and_section_are_plan_data_and_cannot_change_card_selection() -> None:
    default = resolve_canvas_card("orderbook")
    planned = resolve_canvas_card(
        "orderbook",
        mode=" regular ",
        section=" depth ",
        operation_refs=["base:0C", "detail:ka10004:sell_bid_prices"],
    )

    assert default.card_id == planned.card_id == "CC-04"
    assert planned.mode == "regular"
    assert planned.section == "depth"
    assert planned.operation_refs == (
        "base:0C",
        "detail:ka10004:sell_bid_prices",
    )


def test_runtime_metadata_is_derived_from_operation_ownership() -> None:
    metadata = resolve_canvas_card("base:0C").runtime_metadata()

    assert metadata == {
        "card_id": "CC-04",
        "card_kind": "orderbook",
        "capability_id": "orderbook",
        "mode": "regular",
        "section": "depth-ladder",
        "operation_refs": ["base:0C"],
    }


def test_all_299_operations_have_matching_runtime_field_contracts() -> None:
    registry = get_canvas_card_registry()

    checked = 0
    order_checked = 0
    for card in registry.cards:
        for operation_ref in card.operation_refs:
            resolved = resolve_canvas_card(operation_ref)
            field_contract = get_operation_field_contract(operation_ref)
            assert field_contract
            assert {field["card_id"] for field in field_contract} == {resolved.card_id}
            assert {field["card_kind"] for field in field_contract} == {
                resolved.card_kind
            }
            assert {field["capability_id"] for field in field_contract} == {
                resolved.capability_id
            }
            checked += 1
            if resolved.card_id == "CC-02":
                order_checked += 1

    assert checked == 299
    assert order_checked == 12


@pytest.mark.parametrize("identifier", ["unknown", "CC-07", "IC-04", "cc-04"])
def test_resolve_rejects_unknown_or_legacy_card_ids(identifier: str) -> None:
    with pytest.raises(CanvasCardRegistryError, match="unknown Canvas operation/capability id"):
        resolve_canvas_card(identifier)


def test_resolve_fail_closes_unknown_and_cross_capability_operations() -> None:
    with pytest.raises(CanvasCardRegistryError, match="unknown operation_ref"):
        resolve_canvas_card("orderbook", operation_refs=["base:not-real"])

    with pytest.raises(
        CanvasCardRegistryError,
        match="belongs to 'chart', not 'orderbook'",
    ):
        resolve_canvas_card("orderbook", operation_refs=["base:ka10079"])


@pytest.mark.parametrize(
    ("mode", "section", "operation_refs", "message"),
    [
        ("", "depth", ["base:0C"], "mode must be a non-empty string"),
        ("regular", " ", ["base:0C"], "section must be a non-empty string"),
        ("regular", "depth", [], "at least one operation_ref is required"),
        ("regular", "depth", ["base:0C", "base:0C"], "duplicate operation_ref"),
    ],
)
def test_resolve_rejects_invalid_plan_or_operation_subset(
    mode: str,
    section: str,
    operation_refs: list[str],
    message: str,
) -> None:
    with pytest.raises(CanvasCardRegistryError, match=message):
        resolve_canvas_card(
            "orderbook",
            mode=mode,
            section=section,
            operation_refs=operation_refs,
        )


def test_registry_rejects_assignment_coverage_drift(assignment: dict) -> None:
    drifted = copy.deepcopy(assignment)
    removed = drifted["capabilities"][0]["mapping_ids"].pop()
    drifted["capabilities"][0]["operation_count"] -= 1

    with pytest.raises(CanvasCardRegistryError, match="expected 299 operations, got 298"):
        build_canvas_card_registry(drifted)

    assert removed


def test_registry_rejects_duplicate_operation_ownership(assignment: dict) -> None:
    duplicated = copy.deepcopy(assignment)
    operation_ref = duplicated["capabilities"][0]["mapping_ids"][0]
    duplicated["capabilities"][1]["mapping_ids"].append(operation_ref)
    duplicated["capabilities"][1]["operation_count"] += 1

    with pytest.raises(CanvasCardRegistryError, match="assigned to multiple capabilities"):
        build_canvas_card_registry(duplicated)
