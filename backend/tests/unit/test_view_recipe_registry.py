from __future__ import annotations

import json

import pytest

from athena_api.canvas_card_registry import get_canvas_card_registry
from athena_api.view_recipe_registry import (
    EXPECTED_SECTION_COUNT,
    WORKFLOW_ONLY_SECTION_KEYS,
    ViewRecipeRegistryError,
    get_view_recipe_catalog,
    get_view_recipe_registry,
)

EXPECTED_RECIPE_IDS = {
    "instrument-chart",
    "live-orderbook",
    "why-move-flow",
    "discovery-value",
    "sector-theme",
    "watchlist-condition",
    "etf-product",
    "elw-product",
    "market-vi",
    "account-risk",
    "order-safe-ticket",
    "gold-market",
}


def test_twelve_question_recipes_cover_canonical_19_capabilities_and_299_operations() -> None:
    registry = get_view_recipe_registry()
    canonical = get_canvas_card_registry()

    assert {recipe.recipe_id for recipe in registry.recipes} == EXPECTED_RECIPE_IDS
    assert registry.summary.recipe_count == 12
    assert registry.summary.capability_count == canonical.capability_count == 19
    assert registry.summary.operation_count == canonical.operation_count == 299
    assert registry.summary.unreachable_operation_count == 0
    assert registry.summary.multiply_owned_operation_count == 0
    assert registry.summary.section_count == EXPECTED_SECTION_COUNT == 36
    assert registry.summary.section_policy_count == 36
    assert registry.summary.ownership_matches_canonical_ledger is True
    assert registry.summary.release_ready is True


def test_every_operation_resolves_to_one_named_question_recipe() -> None:
    registry = get_view_recipe_registry()
    canonical_operations = {
        operation_ref
        for card in get_canvas_card_registry().cards
        for operation_ref in card.operation_refs
    }

    assert registry.operation_ids == canonical_operations
    for operation_ref in canonical_operations:
        recipe = registry.for_operation(operation_ref)
        assert recipe.recipe_id in EXPECTED_RECIPE_IDS
        assert recipe.title_ko and recipe.user_task
        assert recipe.section_ids and recipe.primary_component_id
        assert recipe.source_precedence


def test_public_recipe_catalog_is_deterministic_and_json_serializable() -> None:
    catalog = get_view_recipe_catalog()

    assert [item["recipe_id"] for item in catalog] == [
        recipe.recipe_id for recipe in get_view_recipe_registry().recipes
    ]
    assert sum(item["operation_count"] for item in catalog) == 299
    assert all("operation_refs" not in item for item in catalog)
    assert json.loads(json.dumps(catalog, ensure_ascii=False)) == catalog


def test_all_36_sections_have_one_authoritative_visibility_policy() -> None:
    registry = get_view_recipe_registry()
    policies = [
        (recipe.recipe_id, policy)
        for recipe in registry.recipes
        for policy in recipe.section_policies
    ]

    assert len(policies) == 36
    assert len({(recipe_id, policy.section_id) for recipe_id, policy in policies}) == 36
    assert {
        (recipe_id, policy.section_id)
        for recipe_id, policy in policies
        if policy.workflow_only
    } == WORKFLOW_ONLY_SECTION_KEYS
    assert all(
        policy.visibility_policy in {"always", "when-data", "workflow"}
        for _, policy in policies
    )
    assert all(
        policy.required == (policy.visibility_policy == "always")
        and policy.workflow_only == (policy.visibility_policy == "workflow")
        for _, policy in policies
    )


def test_unknown_recipe_operation_and_capability_fail_closed() -> None:
    registry = get_view_recipe_registry()

    with pytest.raises(ViewRecipeRegistryError, match="unknown recipe operation"):
        registry.for_operation("base:not-real")
    with pytest.raises(ViewRecipeRegistryError, match="unknown recipe capability"):
        registry.for_capability("not-real")
