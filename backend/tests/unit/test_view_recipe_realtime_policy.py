"""Task Canvas realtime policy stays operation-scoped and fail closed."""

from __future__ import annotations

from typing import Any

from athena_api.api.canvas_push import _integrated_card_contract
from athena_api.selector.catalog import build_operation_catalog
from athena_api.view_recipe_registry import get_view_recipe_registry


def _keys(value: Any) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in _keys(item)}
    if isinstance(value, list):
        return {key for item in value for key in _keys(item)}
    return set()


def test_selected_realtime_operation_is_the_only_verified_registration_candidate() -> None:
    catalog = build_operation_catalog()
    recipe_registry = get_view_recipe_registry()
    websocket_documents = [
        document for document in catalog.documents if document.kind == "websocket"
    ]

    assert websocket_documents
    for document in websocket_documents:
        contract = _integrated_card_contract(document.operation_ref)
        assert contract["operation_refs"] == [document.operation_ref]
        assert contract["view_recipe"]["recipe_id"] == recipe_registry.for_operation(
            document.operation_ref
        ).recipe_id
        assert "registration" not in contract
        assert "realtime_registration" not in contract


def test_static_operation_never_inherits_another_recipe_operation_or_control_frame() -> None:
    catalog = build_operation_catalog()
    static_documents = [
        document for document in catalog.documents if document.kind != "websocket"
    ]

    assert static_documents
    for document in static_documents:
        contract = _integrated_card_contract(document.operation_ref)
        assert contract["operation_refs"] == [document.operation_ref]
        public_runtime = {
            "view_recipe": contract["view_recipe"],
            "presentation_contract": contract["presentation_contract"],
        }
        assert _keys(public_runtime).isdisjoint(
            {
                "operation_ref",
                "operation_refs",
                "registration",
                "remove",
                "trnm",
            }
        )


def test_realtime_first_is_presentation_precedence_not_implicit_side_effect() -> None:
    recipes = get_view_recipe_registry().recipes
    realtime_first = {
        recipe.recipe_id
        for recipe in recipes
        if recipe.source_precedence[0] == "realtime"
    }
    static_first = {recipe.recipe_id for recipe in recipes} - realtime_first

    assert realtime_first == {
        "gold-market",
        "instrument-chart",
        "live-orderbook",
        "market-vi",
        "sector-theme",
        "watchlist-condition",
    }
    assert static_first == {
        "account-risk",
        "discovery-value",
        "elw-product",
        "etf-product",
        "order-safe-ticket",
        "why-move-flow",
    }
    assert all("registration" not in recipe.serializable() for recipe in recipes)
