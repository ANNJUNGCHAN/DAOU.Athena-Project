from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from athena_api.canvas_field_registry import (
    SEMANTIC_OVERRIDES,
    CanvasFieldRegistryError,
    build_canvas_field_registry,
    get_canvas_field_registry,
    get_operation_field_contract,
)

BACKEND = Path(__file__).resolve().parents[2]
ASSIGNMENT_PATH = BACKEND / "ref" / "kiwoom-capability-assignment.json"
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
INVENTORY_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"


def _sources() -> tuple[dict, dict, list[dict]]:
    return (
        json.loads(ASSIGNMENT_PATH.read_text(encoding="utf-8")),
        json.loads(MANIFEST_PATH.read_text(encoding="utf-8")),
        json.loads(INVENTORY_PATH.read_text(encoding="utf-8")),
    )


def test_registry_derives_all_299_operations_and_3705_wire_occurrences() -> None:
    registry = get_canvas_field_registry()
    summary = registry.summary

    assert len(registry.operation_ids) == summary.operation_count == 299
    assert len(registry.contracts) == summary.field_occurrence_count == 3_705
    assert summary.unique_field_path_count == 3_703
    assert summary.duplicate_occurrence_count == 2
    assert summary.label_count == 3_705
    assert summary.wire_complete is True
    assert summary.semantic_accounted is True
    assert summary.semantic_complete is False
    assert summary.fully_named_semantic_complete is False
    assert summary.registry_ready is True
    assert summary.review_ready is False
    assert summary.release_ready is False


def test_every_occurrence_has_one_six_card_detail_sheet_destination() -> None:
    contracts = get_canvas_field_registry().contracts

    assert {contract.card_id for contract in contracts} == {
        "CC-01",
        "CC-02",
        "CC-03",
        "CC-04",
        "CC-05",
        "CC-06",
    }
    assert {contract.card_kind for contract in contracts} == {
        "account",
        "order",
        "instrument",
        "orderbook",
        "flow",
        "explorer",
    }
    assert all(contract.mode == contract.capability_id for contract in contracts)
    assert all(contract.section for contract in contracts)
    assert all(contract.surface == "detail-sheet" for contract in contracts)
    assert all(contract.label and contract.description for contract in contracts)
    assert all(contract.provenance for contract in contracts)


def test_occurrence_id_preserves_ka10173_repeated_wire_paths() -> None:
    contracts = get_operation_field_contract("base:ka10173")

    repeated = [
        item
        for item in contracts
        if item["json_path"] in {"$.trnm", "$.data"}
    ]
    assert {(item["json_path"], item["ordinal"]) for item in repeated} == {
        ("$.trnm", 1),
        ("$.trnm", 2),
        ("$.data", 1),
        ("$.data", 2),
    }
    assert len({item["occurrence_id"] for item in repeated}) == 4


def test_current_rest_extra_items_remain_source_scoped_and_opaque() -> None:
    by_alias = {
        item["alias"]: item
        for operation in ("base:04", "base:1h")
        for item in get_operation_field_contract(operation)
        if item["alias"] in {"951", "924", "1279"}
    }

    for alias in ("951", "924", "1279"):
        assert by_alias[alias]["label"] == f"기타 항목 (FID {alias})"
        assert by_alias[alias]["semantic_status"] == "official_opaque"
        assert by_alias[alias]["json_path"].endswith(f".{alias}")
        assert by_alias[alias]["provenance"]["semantic_source"] == (
            "current Kiwoom REST inventory"
        )
    assert set(SEMANTIC_OVERRIDES) == {
        ("base:04", "$.data[].951"),
        ("base:04", "$.data[].924"),
        ("base:1h", "$.data[].1279"),
    }


def test_public_operation_contract_is_json_serializable() -> None:
    contract = get_operation_field_contract("detail:ka10001:valuation")

    assert contract
    assert json.loads(json.dumps(contract, ensure_ascii=False)) == contract


def test_registry_fail_closes_assignment_manifest_and_inventory_drift() -> None:
    assignment, manifest, inventory = _sources()

    missing_mapping = copy.deepcopy(manifest)
    missing_mapping["mappings"] = [
        mapping
        for mapping in missing_mapping["mappings"]
        if mapping["mapping_id"] != "base:00"
    ]
    with pytest.raises(CanvasFieldRegistryError, match="missing from manifest"):
        build_canvas_field_registry(assignment, missing_mapping, inventory)

    missing_inventory = [item for item in inventory if item["id"] != "00"]
    with pytest.raises(CanvasFieldRegistryError, match="no inventory source"):
        build_canvas_field_registry(assignment, manifest, missing_inventory)

    duplicated_owner = copy.deepcopy(assignment)
    duplicated_owner["capabilities"][1]["mapping_ids"].append("base:00")
    with pytest.raises(CanvasFieldRegistryError, match="multiple capability owners"):
        build_canvas_field_registry(duplicated_owner, manifest, inventory)


def test_unknown_operation_contract_fails_closed() -> None:
    with pytest.raises(CanvasFieldRegistryError, match="unknown Canvas operation"):
        get_operation_field_contract("base:not-real")
