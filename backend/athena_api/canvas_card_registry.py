"""Canonical six-card Canvas registry backed by the Kiwoom assignment ledger.

The ledger's 19 capabilities remain the routing/intent layer. Canvas rendering
compresses them into six cards; ``mode`` and ``section`` never select a card.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
ASSIGNMENT_PATH = BACKEND / "ref" / "kiwoom-capability-assignment.json"
EXPECTED_CARD_COUNT = 6
EXPECTED_CAPABILITY_COUNT = 19
EXPECTED_OPERATION_COUNT = 299

CARD_CAPABILITIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("CC-01", ("account",)),
    ("CC-02", ("order",)),
    ("CC-03", ("chart", "etf", "elw", "stock-info", "quote", "gold")),
    ("CC-04", ("orderbook",)),
    (
        "CC-05",
        ("program-trading", "investor-flow", "broker", "credit-lending-short"),
    ),
    (
        "CC-06",
        (
            "sector",
            "discovery",
            "watchlist",
            "theme",
            "market-status",
            "condition-search",
        ),
    ),
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

# The selector chooses an operation.  The operation's canonical capability then
# selects the initial mode/section; neither the caller nor the LLM may choose a
# different integrated-card destination after the signed plan is verified.
CAPABILITY_PRESENTATION = MappingProxyType(
    {
        "account": ("overview", "summary"),
        "order": ("cash", "entry"),
        "chart": ("chart", "visualization"),
        "orderbook": ("regular", "depth-ladder"),
        "program-trading": ("program", "net-summary"),
        "etf": ("etf", "product-detail"),
        "elw": ("elw", "product-detail"),
        "sector": ("sector", "result-table"),
        "investor-flow": ("investor", "breakdown"),
        "broker": ("broker", "ranking-table"),
        "discovery": ("ranking", "result-table"),
        "credit-lending-short": ("credit-lending-short", "balance"),
        "stock-info": ("profile", "fundamentals"),
        "watchlist": ("watchlist", "result-table"),
        "quote": ("quote", "quote-strip"),
        "gold": ("gold", "product-detail"),
        "theme": ("theme", "result-table"),
        "market-status": ("market-status", "market-state"),
        "condition-search": ("condition-search", "result-table"),
    }
)


class CanvasCardRegistryError(ValueError):
    """Raised when card ownership or resolution violates the canonical ledger."""


@dataclass(frozen=True, slots=True)
class CanvasCardDefinition:
    card_id: str
    capability_ids: tuple[str, ...]
    ordinal: int
    operation_refs: tuple[str, ...]

    @property
    def operation_count(self) -> int:
        return len(self.operation_refs)

    @property
    def card_kind(self) -> str:
        return CARD_KINDS[self.card_id]


@dataclass(frozen=True, slots=True)
class ResolvedCanvasCard:
    card: CanvasCardDefinition
    capability_id: str
    operation_refs: tuple[str, ...]
    mode: str | None = None
    section: str | None = None

    @property
    def card_id(self) -> str:
        return self.card.card_id

    @property
    def card_kind(self) -> str:
        return self.card.card_kind

    def runtime_metadata(self) -> dict[str, Any]:
        """Return the server-owned integrated-card routing contract."""

        return {
            "card_id": self.card_id,
            "card_kind": self.card_kind,
            "capability_id": self.capability_id,
            "mode": self.mode,
            "section": self.section,
            "operation_refs": list(self.operation_refs),
        }


class CanvasCardRegistry:
    """Immutable ownership guard for 19 capabilities rendered by six cards."""

    def __init__(
        self,
        cards: Iterable[CanvasCardDefinition],
        capability_operations: Mapping[str, tuple[str, ...]],
    ) -> None:
        card_tuple = tuple(cards)
        if len(card_tuple) != EXPECTED_CARD_COUNT:
            raise CanvasCardRegistryError(
                f"expected {EXPECTED_CARD_COUNT} integrated Canvas cards, got {len(card_tuple)}"
            )
        by_card_id = {card.card_id: card for card in card_tuple}
        if len(by_card_id) != len(card_tuple):
            raise CanvasCardRegistryError("duplicate integrated Canvas card_id")

        capability_owner: dict[str, CanvasCardDefinition] = {}
        operation_owner: dict[str, str] = {}
        for card in card_tuple:
            if card.ordinal < 1:
                raise CanvasCardRegistryError("Canvas card ordinal must be positive")
            if not card.capability_ids or not card.operation_refs:
                raise CanvasCardRegistryError(
                    f"integrated Canvas card {card.card_id} has no ownership"
                )
            for capability_id in card.capability_ids:
                if capability_id in capability_owner:
                    raise CanvasCardRegistryError(
                        f"capability {capability_id!r} is assigned to multiple Canvas cards"
                    )
                capability_owner[capability_id] = card
            for operation_ref in card.operation_refs:
                if operation_ref in operation_owner:
                    raise CanvasCardRegistryError(
                        f"operation {operation_ref!r} is assigned to multiple capabilities"
                    )
                owners = [
                    capability_id
                    for capability_id in card.capability_ids
                    if operation_ref in capability_operations[capability_id]
                ]
                if len(owners) != 1:
                    raise CanvasCardRegistryError(
                        f"operation {operation_ref!r} does not have exactly one capability owner"
                    )
                operation_owner[operation_ref] = owners[0]

        if len(capability_owner) != EXPECTED_CAPABILITY_COUNT:
            raise CanvasCardRegistryError(
                f"expected {EXPECTED_CAPABILITY_COUNT} capabilities, got {len(capability_owner)}"
            )
        if set(capability_owner) != set(capability_operations):
            raise CanvasCardRegistryError("Canvas card capability ownership does not match ledger")
        if len(operation_owner) != EXPECTED_OPERATION_COUNT:
            raise CanvasCardRegistryError(
                f"expected {EXPECTED_OPERATION_COUNT} operations, got {len(operation_owner)}"
            )

        self._cards = card_tuple
        self._by_card_id = MappingProxyType(by_card_id)
        self._capability_owner = MappingProxyType(capability_owner)
        self._capability_operations = MappingProxyType(dict(capability_operations))
        self._operation_owner = MappingProxyType(operation_owner)

    @property
    def cards(self) -> tuple[CanvasCardDefinition, ...]:
        return self._cards

    @property
    def capability_count(self) -> int:
        return len(self._capability_owner)

    @property
    def operation_count(self) -> int:
        return len(self._operation_owner)

    def get(self, capability_or_card_id: str) -> CanvasCardDefinition | None:
        return self._capability_owner.get(capability_or_card_id) or self._by_card_id.get(
            capability_or_card_id
        )

    def resolve(
        self,
        operation_or_capability_id: str,
        *,
        mode: str | None = None,
        section: str | None = None,
        operation_refs: Iterable[str] | None = None,
    ) -> ResolvedCanvasCard:
        """Resolve an operation or capability to one deterministic card.

        ``mode`` and ``section`` are capability/intent plan data. Changing them
        cannot change the selected Canvas card.
        """

        capability_id = self._operation_owner.get(operation_or_capability_id)
        if capability_id is None and operation_or_capability_id in self._capability_owner:
            capability_id = operation_or_capability_id
        if capability_id is None:
            raise CanvasCardRegistryError(
                f"unknown Canvas operation/capability id: {operation_or_capability_id!r}"
            )

        card = self._capability_owner[capability_id]
        if operation_refs is None:
            resolved_refs = (
                (operation_or_capability_id,)
                if operation_or_capability_id in self._operation_owner
                else self._capability_operations[capability_id]
            )
        else:
            if isinstance(operation_refs, (str, bytes)):
                raise CanvasCardRegistryError(
                    "operation_refs must be an iterable of operation ids"
                )
            resolved_refs = tuple(operation_refs)
            if not resolved_refs:
                raise CanvasCardRegistryError("at least one operation_ref is required")
        if any(not isinstance(ref, str) or not ref for ref in resolved_refs):
            raise CanvasCardRegistryError("operation_refs must contain non-empty strings")
        if len(resolved_refs) != len(set(resolved_refs)):
            raise CanvasCardRegistryError("duplicate operation_ref in Canvas resolution")
        for operation_ref in resolved_refs:
            owner = self._operation_owner.get(operation_ref)
            if owner is None:
                raise CanvasCardRegistryError(f"unknown operation_ref: {operation_ref!r}")
            if owner != capability_id:
                raise CanvasCardRegistryError(
                    f"operation {operation_ref!r} belongs to {owner!r}, "
                    f"not {capability_id!r}"
                )

        default_mode, default_section = CAPABILITY_PRESENTATION[capability_id]
        return ResolvedCanvasCard(
            card=card,
            capability_id=capability_id,
            operation_refs=resolved_refs,
            mode=_normalize_plan_value("mode", mode) or default_mode,
            section=_normalize_plan_value("section", section) or default_section,
        )


def _normalize_plan_value(name: str, value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise CanvasCardRegistryError(f"Canvas {name} must be a non-empty string")
    return value.strip()


def _read_assignment(path: Path) -> Mapping[str, Any]:
    with path.open(encoding="utf-8") as handle:
        assignment = json.load(handle)
    if not isinstance(assignment, dict):
        raise CanvasCardRegistryError("capability assignment must be a JSON object")
    return assignment


def build_canvas_card_registry(assignment: Mapping[str, Any]) -> CanvasCardRegistry:
    if assignment.get("assignment_key") != "mapping_id":
        raise CanvasCardRegistryError("capability assignment key must be mapping_id")
    if assignment.get("excluded_categories") != ["oauth"]:
        raise CanvasCardRegistryError("capability assignment must exclude only oauth")
    if assignment.get("counts") != {
        "capabilities": EXPECTED_CAPABILITY_COUNT,
        "assigned": EXPECTED_OPERATION_COUNT,
        "unassigned": 0,
        "duplicated": 0,
    }:
        raise CanvasCardRegistryError("capability assignment coverage counts do not match")

    capabilities = assignment.get("capabilities")
    if not isinstance(capabilities, list):
        raise CanvasCardRegistryError("capabilities must be a list")
    capability_operations: dict[str, tuple[str, ...]] = {}
    for capability in capabilities:
        if not isinstance(capability, dict):
            raise CanvasCardRegistryError("each capability must be an object")
        capability_id = capability.get("capability_id")
        mapping_ids = capability.get("mapping_ids")
        operation_count = capability.get("operation_count")
        if not isinstance(capability_id, str) or not capability_id:
            raise CanvasCardRegistryError("capability_id must be a non-empty string")
        if capability_id in capability_operations:
            raise CanvasCardRegistryError(f"duplicate capability_id: {capability_id!r}")
        if not isinstance(mapping_ids, list) or any(
            not isinstance(mapping_id, str) or not mapping_id for mapping_id in mapping_ids
        ):
            raise CanvasCardRegistryError(
                f"mapping_ids for {capability_id!r} must contain non-empty strings"
            )
        if operation_count != len(mapping_ids):
            raise CanvasCardRegistryError(
                f"operation_count for {capability_id!r} does not match mapping_ids"
            )
        capability_operations[capability_id] = tuple(mapping_ids)

    cards = [
        CanvasCardDefinition(
            card_id=card_id,
            capability_ids=capability_ids,
            ordinal=ordinal,
            operation_refs=tuple(
                operation_ref
                for capability_id in capability_ids
                for operation_ref in capability_operations.get(capability_id, ())
            ),
        )
        for ordinal, (card_id, capability_ids) in enumerate(CARD_CAPABILITIES, start=1)
    ]
    return CanvasCardRegistry(cards, capability_operations)


@lru_cache(maxsize=1)
def get_canvas_card_registry() -> CanvasCardRegistry:
    return build_canvas_card_registry(_read_assignment(ASSIGNMENT_PATH))


def resolve_canvas_card(
    operation_or_capability_id: str,
    *,
    mode: str | None = None,
    section: str | None = None,
    operation_refs: Iterable[str] | None = None,
) -> ResolvedCanvasCard:
    return get_canvas_card_registry().resolve(
        operation_or_capability_id,
        mode=mode,
        section=section,
        operation_refs=operation_refs,
    )
