"""Exhaustive fixture-only verification for Task Canvas presentation binding.

This suite never creates a Kiwoom client and never executes an order.  The
canonical response models are populated by ``canvas_fixture_factory`` and then
passed through the same server-side Task Canvas binder used by Canvas push.
"""
# ruff: noqa: E402, I001

from __future__ import annotations

import copy
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

TESTS = Path(__file__).resolve().parents[1]
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from athena_api.api.canvas_push import (
    _apply_authoritative_public_labels,
    _bind_semantic_values,
    _integrated_card_contract,
    _json_path_values,
    _observation_id,
)
from athena_api.semantic_presentation_registry import (
    get_semantic_presentation_registry,
)
from athena_api.view_recipe_registry import get_view_recipe_registry
from support.canvas_fixture_factory import build_operation_fixtures


EXPECTED_OPERATION_COUNT = 299
EXPECTED_WIRE_OCCURRENCE_COUNT = 3_705
EXPECTED_UNIQUE_WIRE_PATH_COUNT = 3_703
UNRESOLVED_ALIASES = {"951", "924", "1279"}
OPAQUE_OBSERVATION_ID = re.compile(r"^obs_[0-9a-f]{20}$")
FORBIDDEN_PUBLIC_KEYS = {
    "alias",
    "field_occurrence_id",
    "json_path",
    "mapping_id",
    "next_plan_token",
    "occurrence_id",
    "operation_ref",
    "operation_refs",
    "plan_token",
    "raw",
    "trace_id",
    "wire_occurrence_id",
}
FORBIDDEN_PUBLIC_TEXT = re.compile(
    r"(?:\b(?:fid|raw|alias|json[ _-]?path|mapping[ _-]?id|operation[ _-]?ref|"
    r"plan[ _-]?token|trace[ _-]?id)\b|(?:base|detail):[a-z0-9]|\$\.)",
    re.IGNORECASE,
)
EXPECTED_LEGACY_PROJECTION_DROPS = {
    "base:ka01301": {("table.columns", "bgb_clr", "internal")},
    "detail:ka10040:buy_brokers": {
        ("fields", f"buy_trde_ori_cd_{slot}", "internal")
        for slot in range(1, 6)
    },
    "detail:ka10040:sell_brokers": {
        ("fields", f"sel_trde_ori_cd_{slot}", "internal")
        for slot in range(1, 6)
    },
}


def _safe_fixture_value(value: Any, *, row_marker: str = "0") -> Any:
    """Replace wire sentinels and duplicate list rows with product-safe values."""

    if isinstance(value, dict):
        return {
            key: _safe_fixture_value(item, row_marker=row_marker)
            for key, item in value.items()
        }
    if isinstance(value, list):
        expanded: list[Any] = []
        for index, item in enumerate(value):
            expanded.append(
                _safe_fixture_value(copy.deepcopy(item), row_marker=f"{index}-0")
            )
            expanded.append(
                _safe_fixture_value(copy.deepcopy(item), row_marker=f"{index}-1")
            )
        return expanded
    if isinstance(value, str):
        return f"표시값 {row_marker}"
    return value


def _walk_keys(value: Any) -> list[str]:
    keys: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            keys.append(str(key))
            keys.extend(_walk_keys(item))
    elif isinstance(value, list):
        for item in value:
            keys.extend(_walk_keys(item))
    return keys


def _stable_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def test_all_299_operations_bind_lossless_wire_to_safe_semantic_presentations() -> None:
    fixtures = build_operation_fixtures()
    semantic_registry = get_semantic_presentation_registry()
    recipe_registry = get_view_recipe_registry()

    assert len(fixtures) == EXPECTED_OPERATION_COUNT
    assert sum(len(fixture.occurrences) for fixture in fixtures) == EXPECTED_WIRE_OCCURRENCE_COUNT
    unique_wire_paths = {
        (fixture.mapping_id, occurrence.json_path)
        for fixture in fixtures
        for occurrence in fixture.occurrences
    }
    assert len(unique_wire_paths) == EXPECTED_UNIQUE_WIRE_PATH_COUNT
    all_wire_aliases = {
        occurrence.alias
        for fixture in fixtures
        for occurrence in fixture.occurrences
    }

    seen_recipes: set[str] = set()
    total_expected_observations = 0
    total_public_observations = 0
    array_contract_count = 0

    for fixture in fixtures:
        source = _safe_fixture_value(fixture.validated_payload)
        card = _integrated_card_contract(fixture.mapping_id)
        registered_public_field_count = sum(
            len(section["fields"])
            for section in card["presentation_contract"]["sections"]
        )
        _bind_semantic_values(card, fixture.mapping_id, source)

        if fixture.canvas_type in {"facts", "table", "compound"}:
            legacy_projection = copy.deepcopy(fixture.primary_data)
            before_projection = copy.deepcopy(legacy_projection)
            dropped = _apply_authoritative_public_labels(
                fixture.mapping_id, legacy_projection
            )
            actual_drops = {
                (item["location"], item["key"], item["reason"])
                for item in dropped
            }
            assert actual_drops == EXPECTED_LEGACY_PROJECTION_DROPS.get(
                fixture.mapping_id, set()
            )

            before_items = {
                "fields": before_projection.get("fields", []),
                "columns": before_projection.get("columns", []),
                "header": before_projection.get("header", []),
                "table.columns": before_projection.get("table", {}).get(
                    "columns", []
                ),
            }
            after_items = {
                "fields": legacy_projection.get("fields", []),
                "columns": legacy_projection.get("columns", []),
                "header": legacy_projection.get("header", []),
                "table.columns": legacy_projection.get("table", {}).get(
                    "columns", []
                ),
            }
            assert set(legacy_projection) == set(before_projection)
            if "table" in before_projection:
                assert set(legacy_projection["table"]) == set(
                    before_projection["table"]
                )
            assert sum(map(len, after_items.values())) == (
                sum(map(len, before_items.values())) - len(dropped)
            )
            if any(before_items.values()):
                assert any(after_items.values())

            for location, after in after_items.items():
                before_by_key = {
                    item["key"]: item for item in before_items[location]
                }
                for item in after:
                    before = before_by_key[item["key"]]
                    assert item["key"] == before["key"]
                    if "value" in before:
                        assert item["value"] == before["value"]

            for row_key, column_key in (
                ("rows", "columns"),
                ("table.rows", "table.columns"),
            ):
                before_rows = (
                    before_projection.get("rows", [])
                    if row_key == "rows"
                    else before_projection.get("table", {}).get("rows", [])
                )
                after_rows = (
                    legacy_projection.get("rows", [])
                    if row_key == "rows"
                    else legacy_projection.get("table", {}).get("rows", [])
                )
                assert len(after_rows) == len(before_rows)
                retained_keys = {
                    item["key"] for item in after_items[column_key]
                }
                dropped_keys = {
                    item["key"]
                    for item in before_items[column_key]
                    if item["key"] not in retained_keys
                }
                for before_row, after_row in zip(
                    before_rows, after_rows, strict=True
                ):
                    assert all(key not in after_row for key in dropped_keys)
                    assert {
                        key: after_row[key]
                        for key in retained_keys
                        if key in after_row
                    } == {
                        key: before_row[key]
                        for key in retained_keys
                        if key in before_row
                    }

            label_items = [
                item for items in after_items.values() for item in items
            ]
            labels = [item["label"] for item in label_items]
            assert all(label not in all_wire_aliases for label in labels)
            assert all(
                label not in {"cur_prc", "pre_sig", "pred_pre"}
                for label in labels
            )
            assert all(not re.fullmatch(r"\d+", label) for label in labels)
            assert all(
                not re.fullmatch(r"[a-z][a-z0-9_]*", label)
                for label in labels
            )

        recipe = recipe_registry.for_operation(fixture.mapping_id)
        seen_recipes.add(recipe.recipe_id)
        assert card["envelope_version"] == "task-canvas.v1"
        assert card["view_recipe"]["recipe_id"] == recipe.recipe_id
        assert card["presentation_contract"]["recipe_id"] == recipe.recipe_id
        assert card["coverage_receipt"]["field_occurrence_count"] == len(
            fixture.occurrences
        )
        assert card["coverage_receipt"]["reachable_occurrence_count"] == len(
            fixture.occurrences
        )

        semantic_contracts = semantic_registry.for_operation(fixture.mapping_id)
        visible_contracts = [
            contract for contract in semantic_contracts if contract.user_visible
        ]
        hidden_contracts = [
            contract for contract in semantic_contracts if not contract.user_visible
        ]
        public_fields = [
            field
            for section in card["presentation_contract"]["sections"]
            for field in section["fields"]
        ]
        observations = card["semantic_observations"]

        assert registered_public_field_count == len(visible_contracts)
        assert len(public_fields) <= len(visible_contracts)
        assert not any(
            contract.field_class in {"transport", "internal", "unresolved"}
            for contract in visible_contracts
        )
        assert all(contract.product_destination for contract in visible_contracts)
        assert all(contract.product_destination is None for contract in hidden_contracts)
        assert all(
            contract.product_destination
            == f"{contract.recipe_id}/{contract.section_id}/{contract.component_id}"
            for contract in visible_contracts
        )

        expected_values: list[Any] = []
        for contract in visible_contracts:
            values = [
                value
                for value in _json_path_values(source, contract.json_path)
                if not isinstance(value, (dict, list, tuple, set))
            ]
            expected_values.extend(values)
            if len(values) > 1:
                array_contract_count += 1
                expected_observation_ids = {
                    _observation_id(contract.wire_occurrence_id, array_index)
                    for array_index in range(len(values))
                }
                matching = [
                    item
                    for item in observations
                    if item.get("observation_id") in expected_observation_ids
                ]
                assert Counter(
                    item.get("array_index") for item in matching
                ) == Counter(range(len(values)))
                assert Counter(_stable_value(item["value"]) for item in matching) == Counter(
                    _stable_value(value) for value in values
                )

        assert len(observations) == len(expected_values)
        assert Counter(_stable_value(item["value"]) for item in observations) == Counter(
            _stable_value(value) for value in expected_values
        )
        observation_ids = [item["observation_id"] for item in observations]
        assert all(OPAQUE_OBSERVATION_ID.fullmatch(item) for item in observation_ids)
        assert len(observation_ids) == len(set(observation_ids))

        public_subtree = {
            "view_recipe": card["view_recipe"],
            "presentation_contract": card["presentation_contract"],
            "semantic_observations": observations,
        }
        public_keys = {key.lower() for key in _walk_keys(public_subtree)}
        assert public_keys.isdisjoint(FORBIDDEN_PUBLIC_KEYS)
        public_text = json.dumps(public_subtree, ensure_ascii=False, sort_keys=True)
        assert not FORBIDDEN_PUBLIC_TEXT.search(public_text)
        assert not any(
            item.get("concept_id", "").split(".")[-1] in UNRESOLVED_ALIASES
            or item.get("label_ko") in UNRESOLVED_ALIASES
            for item in [*public_fields, *observations]
        )

        total_expected_observations += len(expected_values)
        total_public_observations += len(observations)

    assert array_contract_count > 0
    assert total_public_observations == total_expected_observations
    assert seen_recipes == {recipe.recipe_id for recipe in recipe_registry.recipes}
