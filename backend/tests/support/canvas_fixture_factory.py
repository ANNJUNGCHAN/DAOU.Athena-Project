"""Generate type-valid, lossless fixtures for all integrated Canvas cards.

The factory is intentionally fixture-only.  It imports response models and the
generated field registry, but never constructs a Kiwoom client or invokes a
route.  Order operations therefore remain inert synthetic payloads.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from athena_api.canvas_card_registry import get_canvas_card_registry  # noqa: E402
from athena_api.canvas_field_registry import get_operation_field_contract  # noqa: E402
from athena_api.canvas_transform import (  # noqa: E402
    build_compound_generic,
    build_facts,
    build_table,
)

ASSIGNMENT_PATH = BACKEND / "ref" / "kiwoom-capability-assignment.json"
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
AITS_CONTRACTS_PATH = BACKEND / "ref" / "aits-chart-contracts.json"


@dataclass(frozen=True, slots=True)
class FixtureOccurrence:
    occurrence_id: str
    mapping_id: str
    json_path: str
    ordinal: int
    alias: str
    sentinel_id: str
    wire_value: object
    card_id: str
    card_kind: str
    capability_id: str
    mode: str
    section: str
    surface: str
    label: str
    semantic_status: str


@dataclass(frozen=True, slots=True)
class OperationFixture:
    mapping_id: str
    response_model: str
    payload: dict[str, Any]
    validated_payload: dict[str, Any]
    occurrences: tuple[FixtureOccurrence, ...]
    canvas_type: str
    screen_id: str
    renderer_id: str | None
    primary_data: dict[str, Any]


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _load_response_model(import_path: str) -> type[BaseModel]:
    module_name, class_name = import_path.rsplit(".", 1)
    model = getattr(importlib.import_module(module_name), class_name)
    if not isinstance(model, type) or not issubclass(model, BaseModel):
        raise TypeError(f"response contract is not a Pydantic model: {import_path}")
    return model


def _wire_value(mapping_id: str, json_path: str, alias: str) -> object:
    sentinel = f"fixture::{mapping_id}::{json_path}"
    # ka10173's real-time values field is the only manifest scalar path backed
    # by a dict model field.  Keep the wire dict empty so its contract covers
    # exactly $.values rather than inventing an uncontracted child key; the
    # occurrence-specific sentinel is carried by field_contract.value.
    if alias == "values" and mapping_id == "base:ka10173":
        return {}
    return sentinel


def _payload_from_contracts(
    mapping_id: str, contracts: list[dict[str, object]]
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    nested: dict[str, dict[str, object]] = {}
    for contract in contracts:
        json_path = str(contract["json_path"])
        alias = str(contract["alias"])
        value = _wire_value(mapping_id, json_path, alias)
        if "[]" not in json_path:
            # Repeated wire aliases (ka10173 trnm/data) intentionally share one
            # payload slot while retaining distinct occurrence identities.
            payload[alias] = value
            continue
        container = json_path[2:].split("[]", 1)[0]
        nested.setdefault(container, {})[alias] = value
    for container, item in nested.items():
        payload[container] = [item]
    return payload


def _primary_projection(
    mapping: dict[str, Any], payload: dict[str, Any]
) -> tuple[str, str | None, dict[str, Any]]:
    presentation = mapping["presentation"]
    renderer_id = presentation.get("renderer_id")
    canvas_type = "chart" if renderer_id == "aits-chart-v1" else presentation["layout"]
    if canvas_type == "facts":
        built = build_facts(payload)
    elif canvas_type == "table":
        built = build_table({"data": payload})
    elif canvas_type == "compound":
        built = build_compound_generic(payload)
    elif canvas_type == "action":
        return canvas_type, renderer_id, {
            "order_draft": {
                "stk_cd": "005930",
                "qty": "1",
                "price_type": "market",
                "fixture_only": True,
            },
            "state": "draft",
        }
    elif canvas_type == "event":
        return canvas_type, renderer_id, {
            "lifecycle": "connected",
            "state_label": "fixture 실시간 등록됨",
            "records": [{"상태": "fixture 실시간 등록됨"}],
        }
    elif canvas_type == "chart":
        chart_contracts = _read_json(AITS_CONTRACTS_PATH)["contracts"]
        by_tr_id = {item["tr_id"]: item for item in chart_contracts}
        tr_id = mapping["operation"]["tr_id"]
        contract = by_tr_id[tr_id]
        return canvas_type, renderer_id, {
            "symbol": "005930",
            "chart": {
                "period": contract["period"],
                "target": contract["target"],
                "trId": tr_id,
                "candles": [
                    {
                        "time": "2026-08-29",
                        "open": 120000.0,
                        "high": 121000.0,
                        "low": 119000.0,
                        "close": 120500.0,
                        "volume": 1000.0,
                    }
                ],
            },
            "chart_meta": {
                "series_scope": contract["series_scope"],
                "reload_group": contract["reload_group"],
                "reload_targets": {},
            },
        }
    else:
        raise AssertionError(f"unsupported fixture canvas_type: {canvas_type}")
    if isinstance(built, str):
        raise AssertionError(
            f"{mapping['mapping_id']} canonical {canvas_type} projection failed: {built}"
        )
    return canvas_type, renderer_id, built[0]


def build_operation_fixtures() -> tuple[OperationFixture, ...]:
    assignment = _read_json(ASSIGNMENT_PATH)
    manifest = _read_json(MANIFEST_PATH)
    assigned = {
        mapping_id
        for capability in assignment["capabilities"]
        for mapping_id in capability["mapping_ids"]
    }
    mappings = {
        mapping["mapping_id"]: mapping
        for mapping in manifest["mappings"]
        if mapping["mapping_id"] in assigned
    }
    if set(mappings) != assigned:
        raise AssertionError("assigned operations and common-screen manifest drifted")

    fixtures: list[OperationFixture] = []
    for mapping_id in sorted(assigned):
        mapping = mappings[mapping_id]
        contracts = get_operation_field_contract(mapping_id)
        payload = _payload_from_contracts(mapping_id, contracts)
        response_model_path = mapping["contracts"]["response_model"]
        response_model = _load_response_model(response_model_path)
        validated = response_model.model_validate(payload).model_dump(
            by_alias=True, mode="json"
        )
        canvas_type, renderer_id, primary_data = _primary_projection(mapping, validated)
        occurrences = tuple(
            FixtureOccurrence(
                occurrence_id=str(contract["occurrence_id"]),
                mapping_id=mapping_id,
                json_path=str(contract["json_path"]),
                ordinal=int(contract["ordinal"]),
                alias=str(contract["alias"]),
                sentinel_id=f"sentinel::{contract['occurrence_id']}",
                wire_value=_wire_value(
                    mapping_id,
                    str(contract["json_path"]),
                    str(contract["alias"]),
                ),
                card_id=str(contract["card_id"]),
                card_kind=str(contract["card_kind"]),
                capability_id=str(contract["capability_id"]),
                mode=str(contract["mode"]),
                section=str(contract["section"]),
                surface=str(contract["surface"]),
                label=str(contract["label"]),
                semantic_status=str(contract["semantic_status"]),
            )
            for contract in contracts
        )
        fixtures.append(
            OperationFixture(
                mapping_id=mapping_id,
                response_model=response_model_path,
                payload=payload,
                validated_payload=validated,
                occurrences=occurrences,
                canvas_type=canvas_type,
                screen_id=str(mapping["screen_reference"]["screen_id"]),
                renderer_id=renderer_id,
                primary_data=primary_data,
            )
        )
    return tuple(fixtures)


def build_fixture_bundle() -> dict[str, object]:
    fixtures = build_operation_fixtures()
    registry = get_canvas_card_registry()
    operations_by_card: dict[str, list[str]] = {
        card.card_id: [] for card in registry.cards
    }
    fields_by_card: dict[str, list[dict[str, object]]] = {
        card.card_id: [] for card in registry.cards
    }
    for fixture in fixtures:
        card_id = fixture.occurrences[0].card_id
        operations_by_card[card_id].append(fixture.mapping_id)
        fields_by_card[card_id].extend(
            {
                **asdict(occurrence),
                "wire_value": occurrence.wire_value,
            }
            for occurrence in fixture.occurrences
        )

    cards = []
    for card in registry.cards:
        fields = fields_by_card[card.card_id]
        operations = operations_by_card[card.card_id]
        operation_set = set(operations)
        card_fixtures = [
            fixture for fixture in fixtures if fixture.mapping_id in operation_set
        ]
        cards.append(
            {
                "card_id": card.card_id,
                "card_kind": card.card_kind,
                "operation_count": len(operations),
                "field_count": len(fields),
                "operations": operations,
                "fields": fields,
                "operation_fixtures": [
                    {
                        "operation_ref": fixture.mapping_id,
                        "capability_id": fixture.occurrences[0].capability_id,
                        "mode": fixture.occurrences[0].mode,
                        "section": fixture.occurrences[0].section,
                        "canvas_type": fixture.canvas_type,
                        "screen_id": fixture.screen_id,
                        "renderer_id": fixture.renderer_id,
                        "primary_data": fixture.primary_data,
                        "raw_data": fixture.payload,
                        "field_contract": [
                            {
                                **contract,
                                "value": f"sentinel::{contract['occurrence_id']}",
                            }
                            for contract in get_operation_field_contract(
                                fixture.mapping_id
                            )
                        ],
                    }
                    for fixture in card_fixtures
                ],
                "opaque_count": sum(
                    field["semantic_status"] == "official_opaque"
                    for field in fields
                ),
                "realtime_required": any(
                    operation.startswith("base:0")
                    or operation in {
                        "base:ka10171",
                        "base:ka10172",
                        "base:ka10173",
                        "base:ka10174",
                    }
                    for operation in operations
                ),
            }
        )

    path_counts = Counter(
        (occurrence.mapping_id, occurrence.json_path)
        for fixture in fixtures
        for occurrence in fixture.occurrences
    )
    return {
        "fixture_only": True,
        "external_calls_allowed": False,
        "operation_count": len(fixtures),
        "field_occurrence_count": sum(len(item.occurrences) for item in fixtures),
        "unique_field_path_count": len(path_counts),
        "duplicate_paths": [
            {"mapping_id": key[0], "json_path": key[1], "count": count}
            for key, count in sorted(path_counts.items())
            if count > 1
        ],
        "cards": cards,
    }


def _main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    bundle = build_fixture_bundle()
    if args.json:
        # ASCII escapes make the pipe deterministic on Windows code pages;
        # JSON.parse restores the original Korean labels in Electron.
        print(json.dumps(bundle, ensure_ascii=True, separators=(",", ":")))
    else:
        print(json.dumps(bundle, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _main()
