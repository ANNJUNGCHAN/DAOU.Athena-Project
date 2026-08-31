"""Lossless response-field registry for the six integrated Canvas cards.

The registry is derived from the canonical capability assignment, common screen
manifest, and TR inventory on every cache fill.  It never treats a unique JSON
path as a substitute for a wire occurrence: repeated paths keep an ordinal in
their ``occurrence_id``.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

from athena_api.canvas_card_registry import resolve_canvas_card

BACKEND = Path(__file__).resolve().parents[1]
ASSIGNMENT_PATH = BACKEND / "ref" / "kiwoom-capability-assignment.json"
MANIFEST_PATH = BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
INVENTORY_PATH = BACKEND / "ref" / "kiwoom-tr-inventory.json"

EXPECTED_OPERATION_COUNT = 299
EXPECTED_FIELD_OCCURRENCE_COUNT = 3_705
EXPECTED_UNIQUE_FIELD_PATH_COUNT = 3_703
EXPECTED_DUPLICATE_PATHS = frozenset(
    {
        ("base:ka10173", "$.trnm"),
        ("base:ka10173", "$.data"),
    }
)

CARD_KINDS = MappingProxyType(
    {
        "CC-01": "account",
        "CC-02": "order",
        "CC-03": "instrument",
        "CC-04": "orderbook",
        "CC-05": "flow",
        "CC-06": "explorer",
    }
)

# The current REST/WebSocket inventory exposes these fields only as Extra Item.
# Legacy OpenAPI+ OCX FID meanings are not safe aliases for this contract, so
# overrides are scoped to the exact mapping and JSON path rather than alias-only.
SEMANTIC_OVERRIDES = MappingProxyType(
    {
        ("base:04", "$.data[].951"): {
            "label": "기타 항목 (FID 951)",
            "description": "현재 Kiwoom REST 명세가 Extra Item으로 공개한 원본 값",
            "semantic_status": "official_opaque",
            "semantic_source": "current Kiwoom REST inventory",
        },
        ("base:04", "$.data[].924"): {
            "label": "기타 항목 (FID 924)",
            "description": "현재 Kiwoom REST 명세가 Extra Item으로 공개한 원본 값",
            "semantic_status": "official_opaque",
            "semantic_source": "current Kiwoom REST inventory",
        },
        ("base:1h", "$.data[].1279"): {
            "label": "기타 항목 (FID 1279)",
            "description": "현재 Kiwoom REST 명세가 Extra Item으로 공개한 원본 값",
            "semantic_status": "official_opaque",
            "semantic_source": "current Kiwoom REST inventory",
        },
    }
)


class CanvasFieldRegistryError(ValueError):
    """Raised when the canonical sources cannot form a lossless registry."""


@dataclass(frozen=True, slots=True)
class CanvasFieldContract:
    occurrence_id: str
    mapping_id: str
    json_path: str
    ordinal: int
    alias: str
    card_id: str
    card_kind: str
    capability_id: str
    mode: str
    section: str
    surface: str
    label: str
    description: str
    provenance: dict[str, object]
    semantic_status: str

    def serializable(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class CanvasFieldRegistrySummary:
    operation_count: int
    field_occurrence_count: int
    unique_field_path_count: int
    duplicate_occurrence_count: int
    label_count: int
    official_semantic_count: int
    official_opaque_count: int
    unresolved_semantic_count: int

    @property
    def wire_complete(self) -> bool:
        return (
            self.operation_count == EXPECTED_OPERATION_COUNT
            and self.field_occurrence_count == EXPECTED_FIELD_OCCURRENCE_COUNT
            and self.unique_field_path_count == EXPECTED_UNIQUE_FIELD_PATH_COUNT
            and self.duplicate_occurrence_count
            == EXPECTED_FIELD_OCCURRENCE_COUNT - EXPECTED_UNIQUE_FIELD_PATH_COUNT
        )

    @property
    def label_complete(self) -> bool:
        return self.label_count == self.field_occurrence_count

    @property
    def semantic_complete(self) -> bool:
        """Every field has an officially known meaning, with no opaque fields."""

        return (
            self.unresolved_semantic_count == 0
            and self.official_opaque_count == 0
            and self.official_semantic_count == self.field_occurrence_count
        )

    @property
    def semantic_accounted(self) -> bool:
        """Every field is officially named or explicitly officially opaque."""

        return (
            self.unresolved_semantic_count == 0
            and self.official_semantic_count + self.official_opaque_count
            == self.field_occurrence_count
        )

    @property
    def fully_named_semantic_complete(self) -> bool:
        return self.semantic_complete

    @property
    def registry_ready(self) -> bool:
        return self.wire_complete and self.label_complete and self.semantic_accounted

    @property
    def review_ready(self) -> bool:
        # Global review requires the separate Canvas runtime/render/E2E gate.
        return False

    @property
    def release_ready(self) -> bool:
        # Global release requires the separate Canvas runtime/render/E2E gate.
        return False


class CanvasFieldRegistry:
    def __init__(self, contracts: tuple[CanvasFieldContract, ...]) -> None:
        by_operation: dict[str, list[CanvasFieldContract]] = {}
        occurrence_ids: set[str] = set()
        path_counts: Counter[tuple[str, str]] = Counter()
        for contract in contracts:
            if contract.occurrence_id in occurrence_ids:
                raise CanvasFieldRegistryError(
                    f"duplicate occurrence_id: {contract.occurrence_id!r}"
                )
            occurrence_ids.add(contract.occurrence_id)
            path_counts[(contract.mapping_id, contract.json_path)] += 1
            by_operation.setdefault(contract.mapping_id, []).append(contract)
            if not contract.label.strip() or not contract.description.strip():
                raise CanvasFieldRegistryError(
                    f"field metadata is empty for {contract.occurrence_id!r}"
                )
            if contract.surface != "detail-sheet":
                raise CanvasFieldRegistryError(
                    f"field surface must be detail-sheet: {contract.occurrence_id!r}"
                )
            if contract.semantic_status not in {"official", "official_opaque"}:
                raise CanvasFieldRegistryError(
                    f"unresolved field semantics: {contract.occurrence_id!r}"
                )

        duplicate_paths = frozenset(key for key, count in path_counts.items() if count > 1)
        if duplicate_paths != EXPECTED_DUPLICATE_PATHS:
            raise CanvasFieldRegistryError(
                "duplicate field paths do not match the audited ka10173 occurrences"
            )

        summary = CanvasFieldRegistrySummary(
            operation_count=len(by_operation),
            field_occurrence_count=len(contracts),
            unique_field_path_count=len(path_counts),
            duplicate_occurrence_count=sum(count - 1 for count in path_counts.values()),
            label_count=sum(bool(contract.label.strip()) for contract in contracts),
            official_semantic_count=sum(
                contract.semantic_status == "official" for contract in contracts
            ),
            official_opaque_count=sum(
                contract.semantic_status == "official_opaque" for contract in contracts
            ),
            unresolved_semantic_count=sum(
                contract.semantic_status not in {"official", "official_opaque"}
                for contract in contracts
            ),
        )
        if not summary.registry_ready:
            raise CanvasFieldRegistryError(
                f"Canvas field registry is incomplete: {summary!r}"
            )

        self._contracts = contracts
        self._by_operation = MappingProxyType(
            {mapping_id: tuple(items) for mapping_id, items in by_operation.items()}
        )
        self._summary = summary

    @property
    def contracts(self) -> tuple[CanvasFieldContract, ...]:
        return self._contracts

    @property
    def summary(self) -> CanvasFieldRegistrySummary:
        return self._summary

    @property
    def operation_ids(self) -> frozenset[str]:
        return frozenset(self._by_operation)

    def for_operation(self, mapping_id: str) -> tuple[CanvasFieldContract, ...]:
        try:
            return self._by_operation[mapping_id]
        except KeyError as exc:
            raise CanvasFieldRegistryError(
                f"unknown Canvas operation mapping_id: {mapping_id!r}"
            ) from exc


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _normalized_element(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.lstrip("- ").strip()


def _inventory_metadata(operation: Mapping[str, Any]) -> dict[str, dict[str, str]]:
    response = operation.get("resp_body")
    if not isinstance(response, list):
        raise CanvasFieldRegistryError(
            f"inventory response body is invalid for {operation.get('id')!r}"
        )
    metadata: dict[str, dict[str, str]] = {}
    for field in response:
        if not isinstance(field, dict):
            raise CanvasFieldRegistryError("inventory response field must be an object")
        alias = _normalized_element(field.get("element"))
        if not alias:
            raise CanvasFieldRegistryError("inventory response field has no element")
        label = field.get("kor")
        description = field.get("desc")
        metadata.setdefault(
            alias,
            {
                "label": label.strip() if isinstance(label, str) and label.strip() else alias,
                "description": (
                    description.strip()
                    if isinstance(description, str) and description.strip()
                    else (
                        label.strip()
                        if isinstance(label, str) and label.strip()
                        else alias
                    )
                ),
            },
        )
    return metadata


def _assignment_owners(assignment: Mapping[str, Any]) -> dict[str, str]:
    if assignment.get("assignment_key") != "mapping_id":
        raise CanvasFieldRegistryError("assignment key must be mapping_id")
    if assignment.get("counts") != {
        "capabilities": 19,
        "assigned": EXPECTED_OPERATION_COUNT,
        "unassigned": 0,
        "duplicated": 0,
    }:
        raise CanvasFieldRegistryError("capability assignment counts drifted")
    owners: dict[str, str] = {}
    capabilities = assignment.get("capabilities")
    if not isinstance(capabilities, list):
        raise CanvasFieldRegistryError("assignment capabilities must be a list")
    for capability in capabilities:
        if not isinstance(capability, dict):
            raise CanvasFieldRegistryError("assignment capability must be an object")
        capability_id = capability.get("capability_id")
        mapping_ids = capability.get("mapping_ids")
        if not isinstance(capability_id, str) or not isinstance(mapping_ids, list):
            raise CanvasFieldRegistryError("invalid capability assignment entry")
        for mapping_id in mapping_ids:
            if not isinstance(mapping_id, str) or not mapping_id:
                raise CanvasFieldRegistryError("invalid assigned mapping_id")
            if mapping_id in owners:
                raise CanvasFieldRegistryError(
                    f"mapping_id has multiple capability owners: {mapping_id!r}"
                )
            owners[mapping_id] = capability_id
    if len(owners) != EXPECTED_OPERATION_COUNT:
        raise CanvasFieldRegistryError(
            f"expected {EXPECTED_OPERATION_COUNT} assigned operations, got {len(owners)}"
        )
    return owners


def _response_occurrences(mapping: Mapping[str, Any]) -> list[tuple[str, str, str]]:
    fields = mapping.get("fields")
    response = fields.get("response") if isinstance(fields, dict) else None
    if not isinstance(response, dict):
        raise CanvasFieldRegistryError(
            f"manifest response fields are invalid for {mapping.get('mapping_id')!r}"
        )
    occurrences: list[tuple[str, str, str]] = []
    top_level = response.get("top_level")
    data_sections = response.get("data")
    if not isinstance(top_level, list) or not isinstance(data_sections, list):
        raise CanvasFieldRegistryError("manifest response field lists are invalid")
    for alias in top_level:
        if not isinstance(alias, str) or not alias:
            raise CanvasFieldRegistryError("manifest top-level alias is invalid")
        occurrences.append((f"$.{alias}", alias, "top-level"))
    for data_section in data_sections:
        if not isinstance(data_section, dict):
            raise CanvasFieldRegistryError("manifest data section must be an object")
        container = data_section.get("container_alias")
        aliases = data_section.get("field_aliases")
        if not isinstance(container, str) or not container or not isinstance(aliases, list):
            raise CanvasFieldRegistryError("manifest data section is invalid")
        for alias in aliases:
            if not isinstance(alias, str) or not alias:
                raise CanvasFieldRegistryError("manifest data alias is invalid")
            occurrences.append((f"$.{container}[].{alias}", alias, container))
    return occurrences


def build_canvas_field_registry(
    assignment: Mapping[str, Any],
    manifest: Mapping[str, Any],
    inventory: list[Mapping[str, Any]],
) -> CanvasFieldRegistry:
    owners = _assignment_owners(assignment)
    mappings = manifest.get("mappings")
    if not isinstance(mappings, list):
        raise CanvasFieldRegistryError("common screen manifest mappings must be a list")
    manifest_by_id: dict[str, Mapping[str, Any]] = {}
    for mapping in mappings:
        if not isinstance(mapping, dict):
            raise CanvasFieldRegistryError("manifest mapping must be an object")
        mapping_id = mapping.get("mapping_id")
        if not isinstance(mapping_id, str) or not mapping_id:
            raise CanvasFieldRegistryError("manifest mapping_id is invalid")
        if mapping_id in manifest_by_id:
            raise CanvasFieldRegistryError(f"duplicate manifest mapping_id: {mapping_id!r}")
        manifest_by_id[mapping_id] = mapping
    if not set(owners).issubset(manifest_by_id):
        missing = sorted(set(owners) - manifest_by_id.keys())
        raise CanvasFieldRegistryError(f"assigned operations missing from manifest: {missing}")

    inventory_by_id: dict[str, Mapping[str, Any]] = {}
    for operation in inventory:
        if not isinstance(operation, dict):
            raise CanvasFieldRegistryError("inventory operation must be an object")
        operation_id = operation.get("id")
        if not isinstance(operation_id, str) or not operation_id:
            raise CanvasFieldRegistryError("inventory operation id is invalid")
        if operation_id in inventory_by_id:
            raise CanvasFieldRegistryError(f"duplicate inventory operation: {operation_id!r}")
        inventory_by_id[operation_id] = operation

    contracts: list[CanvasFieldContract] = []
    path_ordinals: Counter[tuple[str, str]] = Counter()
    for mapping_id in owners:
        mapping = manifest_by_id[mapping_id]
        operation = mapping.get("operation")
        tr_id = operation.get("tr_id") if isinstance(operation, dict) else None
        if not isinstance(tr_id, str) or tr_id not in inventory_by_id:
            raise CanvasFieldRegistryError(
                f"manifest operation has no inventory source: {mapping_id!r}"
            )
        metadata = _inventory_metadata(inventory_by_id[tr_id])
        resolved = resolve_canvas_card(mapping_id)
        capability_id = owners[mapping_id]
        if resolved.capability_id != capability_id:
            raise CanvasFieldRegistryError(
                f"card registry capability mismatch for {mapping_id!r}"
            )
        card_kind = CARD_KINDS.get(resolved.card_id)
        if card_kind is None:
            raise CanvasFieldRegistryError(f"unknown six-card id: {resolved.card_id!r}")
        for json_path, alias, section in _response_occurrences(mapping):
            source_metadata = metadata.get(alias)
            if source_metadata is None:
                raise CanvasFieldRegistryError(
                    f"inventory metadata missing for {mapping_id!r} field {alias!r}"
                )
            key = (mapping_id, json_path)
            path_ordinals[key] += 1
            ordinal = path_ordinals[key]
            override = SEMANTIC_OVERRIDES.get((mapping_id, json_path))
            label = str(override["label"]) if override else source_metadata["label"]
            description = (
                str(override["description"])
                if override
                else source_metadata["description"]
            )
            semantic_status = (
                str(override["semantic_status"]) if override else "official"
            )
            provenance: dict[str, object] = {
                "assignment": "ref/kiwoom-capability-assignment.json",
                "manifest": "ref/kiwoom-common-screen-manifest.json",
                "inventory": "ref/kiwoom-tr-inventory.json",
                "inventory_operation_id": tr_id,
            }
            if override:
                provenance["semantic_source"] = override["semantic_source"]
            contracts.append(
                CanvasFieldContract(
                    occurrence_id=f"{mapping_id}|{json_path}|{ordinal}",
                    mapping_id=mapping_id,
                    json_path=json_path,
                    ordinal=ordinal,
                    alias=alias,
                    card_id=resolved.card_id,
                    card_kind=card_kind,
                    capability_id=capability_id,
                    mode=capability_id,
                    section=section,
                    surface="detail-sheet",
                    label=label,
                    description=description,
                    provenance=provenance,
                    semantic_status=semantic_status,
                )
            )
    return CanvasFieldRegistry(tuple(contracts))


@lru_cache(maxsize=1)
def get_canvas_field_registry() -> CanvasFieldRegistry:
    assignment = _read_json(ASSIGNMENT_PATH)
    manifest = _read_json(MANIFEST_PATH)
    inventory = _read_json(INVENTORY_PATH)
    if not isinstance(assignment, dict) or not isinstance(manifest, dict):
        raise CanvasFieldRegistryError("canonical field sources must be JSON objects")
    if not isinstance(inventory, list):
        raise CanvasFieldRegistryError("TR inventory must be a JSON list")
    return build_canvas_field_registry(assignment, manifest, inventory)


def get_operation_field_contract(mapping_id: str) -> list[dict[str, object]]:
    """Return a JSON-serializable, lossless response contract for one operation."""

    return [
        contract.serializable()
        for contract in get_canvas_field_registry().for_operation(mapping_id)
    ]
