"""Question-centred Canvas view recipes over the canonical 19 capabilities.

Recipes are presentation contracts, not new API ownership.  The canonical
capability ledger remains the authority for all 299 operations; this module
only gives every operation at least one deterministic user-task destination.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache
from types import MappingProxyType
from typing import Any

from athena_api.canvas_card_registry import get_canvas_card_registry, resolve_canvas_card

EXPECTED_RECIPE_COUNT = 12
EXPECTED_CAPABILITY_COUNT = 19
EXPECTED_OPERATION_COUNT = 299
EXPECTED_SECTION_COUNT = 36

WORKFLOW_ONLY_SECTION_KEYS = frozenset(
    {
        ("discovery-value", "discovery-filters"),
        ("watchlist-condition", "saved-scope"),
        ("order-safe-ticket", "order-draft"),
        ("order-safe-ticket", "cost-and-risk-preview"),
        ("gold-market", "gold-position-and-settlement"),
    }
)
REQUIRED_SECTION_KEYS = frozenset(
    {
        ("instrument-chart", "identity-and-quote"),
        ("instrument-chart", "price-history"),
        ("live-orderbook", "quote-context"),
        ("live-orderbook", "depth-ladder"),
        ("why-move-flow", "move-summary"),
        ("discovery-value", "ranked-results"),
        ("sector-theme", "market-group-summary"),
        ("watchlist-condition", "matching-instruments"),
        ("etf-product", "etf-summary"),
        ("etf-product", "nav-and-performance"),
        ("elw-product", "elw-summary"),
        ("market-vi", "market-state"),
        ("account-risk", "account-summary"),
        ("gold-market", "gold-summary"),
        ("gold-market", "gold-market-data"),
    }
)

# A capability is the broad API ownership boundary, while a recipe is the
# user-facing result shape.  This projection is owned by ``stock-info`` but its
# payload is the current quote (price, change, rate, and volume), so presenting
# it as discovery/valuation is a product-level mismatch.
OPERATION_RECIPE_OVERRIDES = {
    "detail:ka10001:current_trading": "instrument-chart",
}


class ViewRecipeRegistryError(ValueError):
    """Raised when recipe coverage drifts from canonical API ownership."""


@dataclass(frozen=True, slots=True)
class ViewRecipeSectionPolicy:
    section_id: str
    section_order: int
    visibility_policy: str
    required: bool
    workflow_only: bool

    def serializable(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ViewRecipeDefinition:
    recipe_id: str
    title_ko: str
    user_task: str
    capability_ids: tuple[str, ...]
    section_ids: tuple[str, ...]
    section_policies: tuple[ViewRecipeSectionPolicy, ...]
    primary_component_id: str
    source_precedence: tuple[str, ...]
    operation_refs: tuple[str, ...]

    @property
    def operation_count(self) -> int:
        return len(self.operation_refs)

    def serializable(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["capability_ids"] = list(self.capability_ids)
        payload["section_ids"] = list(self.section_ids)
        payload["section_policies"] = [
            policy.serializable() for policy in self.section_policies
        ]
        payload["source_precedence"] = list(self.source_precedence)
        payload["operation_refs"] = list(self.operation_refs)
        payload["operation_count"] = self.operation_count
        return payload

    def public_serializable(self) -> dict[str, Any]:
        """Return the product catalog without internal operation routing refs."""

        payload = self.serializable()
        payload.pop("operation_refs")
        return payload

    def section_policy(self, section_id: str) -> ViewRecipeSectionPolicy:
        try:
            return next(
                policy for policy in self.section_policies if policy.section_id == section_id
            )
        except StopIteration as exc:
            raise ViewRecipeRegistryError(
                f"unknown section {section_id!r} for recipe {self.recipe_id!r}"
            ) from exc


@dataclass(frozen=True, slots=True)
class ViewRecipeRegistrySummary:
    recipe_count: int
    capability_count: int
    operation_count: int
    unreachable_operation_count: int
    multiply_owned_operation_count: int
    section_count: int
    section_policy_count: int

    @property
    def ownership_matches_canonical_ledger(self) -> bool:
        return (
            self.recipe_count == EXPECTED_RECIPE_COUNT
            and self.capability_count == EXPECTED_CAPABILITY_COUNT
            and self.operation_count == EXPECTED_OPERATION_COUNT
            and self.unreachable_operation_count == 0
            and self.multiply_owned_operation_count == 0
            and self.section_count == EXPECTED_SECTION_COUNT
            and self.section_policy_count == EXPECTED_SECTION_COUNT
        )

    @property
    def release_ready(self) -> bool:
        return self.ownership_matches_canonical_ledger

    def serializable(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["ownership_matches_canonical_ledger"] = (
            self.ownership_matches_canonical_ledger
        )
        payload["release_ready"] = self.release_ready
        return payload


# Each capability has one primary question recipe.  A future recipe may reuse a
# capability, but primary ownership stays unique so selector output is stable.
_RECIPE_SPECS: tuple[dict[str, Any], ...] = (
    {
        "recipe_id": "instrument-chart",
        "title_ko": "종목 차트",
        "user_task": "종목의 가격 흐름과 현재 시세를 확인한다",
        "capability_ids": ("chart", "quote"),
        "section_ids": ("identity-and-quote", "price-history", "volume-and-period"),
        "primary_component_id": "athena-chart-workbench",
        "source_precedence": ("realtime", "confirmed-rest", "cached-snapshot"),
    },
    {
        "recipe_id": "live-orderbook",
        "title_ko": "실시간 호가",
        "user_task": "매수·매도 호가와 체결 흐름을 연속적으로 확인한다",
        "capability_ids": ("orderbook",),
        "section_ids": ("quote-context", "depth-ladder", "trade-tape"),
        "primary_component_id": "live-depth-ladder",
        "source_precedence": ("realtime", "confirmed-rest", "cached-snapshot"),
    },
    {
        "recipe_id": "why-move-flow",
        "title_ko": "가격 변동과 수급",
        "user_task": "가격 변화와 투자자·프로그램·거래원 수급 근거를 함께 본다",
        "capability_ids": (
            "program-trading",
            "investor-flow",
            "broker",
            "credit-lending-short",
        ),
        "section_ids": ("move-summary", "participant-flow", "position-and-risk"),
        "primary_component_id": "flow-evidence-workbench",
        "source_precedence": ("confirmed-rest", "realtime", "cached-snapshot"),
    },
    {
        "recipe_id": "discovery-value",
        "title_ko": "종목 탐색과 가치",
        "user_task": "조건에 맞는 종목을 찾고 가치·재무 근거를 비교한다",
        "capability_ids": ("discovery", "stock-info"),
        "section_ids": ("discovery-filters", "ranked-results", "valuation-and-profile"),
        "primary_component_id": "discovery-comparison-table",
        "source_precedence": ("confirmed-rest", "cached-snapshot"),
    },
    {
        "recipe_id": "sector-theme",
        "title_ko": "업종과 테마",
        "user_task": "업종·테마의 흐름과 구성 종목을 탐색한다",
        "capability_ids": ("sector", "theme"),
        "section_ids": ("market-group-summary", "group-performance", "constituents"),
        "primary_component_id": "sector-theme-workbench",
        "source_precedence": ("realtime", "confirmed-rest", "cached-snapshot"),
    },
    {
        "recipe_id": "watchlist-condition",
        "title_ko": "관심종목과 조건검색",
        "user_task": "관심종목과 저장 조건의 결과를 확인하고 추적한다",
        "capability_ids": ("watchlist", "condition-search"),
        "section_ids": ("saved-scope", "matching-instruments", "condition-status"),
        "primary_component_id": "watchlist-condition-table",
        "source_precedence": ("realtime", "confirmed-rest", "cached-snapshot"),
    },
    {
        "recipe_id": "etf-product",
        "title_ko": "ETF 분석",
        "user_task": "ETF의 가격·NAV·구성종목·추적 정보를 분석한다",
        "capability_ids": ("etf",),
        "section_ids": ("etf-summary", "nav-and-performance", "constituents"),
        "primary_component_id": "etf-product-workbench",
        "source_precedence": ("confirmed-rest", "realtime", "cached-snapshot"),
    },
    {
        "recipe_id": "elw-product",
        "title_ko": "ELW 분석",
        "user_task": "ELW의 가격·민감도·잔존기간·LP 정보를 분석한다",
        "capability_ids": ("elw",),
        "section_ids": ("elw-summary", "sensitivity-and-expiry", "liquidity-provider"),
        "primary_component_id": "elw-product-workbench",
        "source_precedence": ("confirmed-rest", "realtime", "cached-snapshot"),
    },
    {
        "recipe_id": "market-vi",
        "title_ko": "시장 상태와 VI",
        "user_task": "시장 운영 상태와 VI 발동·해제 흐름을 확인한다",
        "capability_ids": ("market-status",),
        "section_ids": ("market-state", "vi-events", "affected-instruments"),
        "primary_component_id": "market-vi-monitor",
        "source_precedence": ("realtime", "confirmed-rest", "cached-snapshot"),
    },
    {
        "recipe_id": "account-risk",
        "title_ko": "계좌와 위험",
        "user_task": "내 계좌의 자산·손익·결제·집중 위험을 확인한다",
        "capability_ids": ("account",),
        "section_ids": ("account-summary", "positions-and-performance", "settlement-and-risk"),
        "primary_component_id": "account-risk-workbench",
        "source_precedence": ("confirmed-rest", "realtime-receipt", "cached-snapshot"),
    },
    {
        "recipe_id": "order-safe-ticket",
        "title_ko": "안전 주문",
        "user_task": "주문을 작성하고 예상 결과·확인·접수·체결 상태를 안전하게 관리한다",
        "capability_ids": ("order",),
        "section_ids": ("order-draft", "cost-and-risk-preview", "confirmation-and-receipt"),
        "primary_component_id": "safe-order-ticket",
        "source_precedence": ("broker-receipt", "confirmed-rest", "local-draft"),
    },
    {
        "recipe_id": "gold-market",
        "title_ko": "금현물",
        "user_task": "금현물 시세·차트·호가·계좌 정보를 확인한다",
        "capability_ids": ("gold",),
        "section_ids": ("gold-summary", "gold-market-data", "gold-position-and-settlement"),
        "primary_component_id": "gold-market-workbench",
        "source_precedence": ("realtime", "confirmed-rest", "cached-snapshot"),
    },
)


class ViewRecipeRegistry:
    def __init__(self, recipes: tuple[ViewRecipeDefinition, ...]) -> None:
        by_id: dict[str, ViewRecipeDefinition] = {}
        by_capability: dict[str, ViewRecipeDefinition] = {}
        by_operation: dict[str, ViewRecipeDefinition] = {}
        duplicate_operation_count = 0
        section_count = 0
        section_policy_count = 0

        for recipe in recipes:
            if recipe.recipe_id in by_id:
                raise ViewRecipeRegistryError(f"duplicate recipe_id: {recipe.recipe_id!r}")
            if not recipe.section_ids or not recipe.primary_component_id:
                raise ViewRecipeRegistryError(
                    f"recipe has no named presentation destination: {recipe.recipe_id!r}"
                )
            if tuple(policy.section_id for policy in recipe.section_policies) != (
                recipe.section_ids
            ):
                raise ViewRecipeRegistryError(
                    f"section policies do not match recipe sections: {recipe.recipe_id!r}"
                )
            for policy in recipe.section_policies:
                if policy.visibility_policy not in {"always", "when-data", "workflow"}:
                    raise ViewRecipeRegistryError(
                        f"invalid section visibility policy: {policy.visibility_policy!r}"
                    )
                if policy.workflow_only != (policy.visibility_policy == "workflow"):
                    raise ViewRecipeRegistryError(
                        f"workflow section policy mismatch: {recipe.recipe_id!r}"
                    )
                if policy.required != (policy.visibility_policy == "always"):
                    raise ViewRecipeRegistryError(
                        f"required section policy mismatch: {recipe.recipe_id!r}"
                    )
            section_count += len(recipe.section_ids)
            section_policy_count += len(recipe.section_policies)
            by_id[recipe.recipe_id] = recipe
            for capability_id in recipe.capability_ids:
                if capability_id in by_capability:
                    raise ViewRecipeRegistryError(
                        f"capability has multiple primary recipes: {capability_id!r}"
                    )
                by_capability[capability_id] = recipe
            for operation_ref in recipe.operation_refs:
                if operation_ref in by_operation:
                    duplicate_operation_count += 1
                    continue
                by_operation[operation_ref] = recipe

        canonical = get_canvas_card_registry()
        canonical_operations = {
            operation_ref for card in canonical.cards for operation_ref in card.operation_refs
        }
        unreachable = canonical_operations - by_operation.keys()
        unknown = by_operation.keys() - canonical_operations
        if unknown:
            raise ViewRecipeRegistryError(
                f"recipes contain unknown operations: {sorted(unknown)!r}"
            )
        summary = ViewRecipeRegistrySummary(
            recipe_count=len(recipes),
            capability_count=len(by_capability),
            operation_count=len(by_operation),
            unreachable_operation_count=len(unreachable),
            multiply_owned_operation_count=duplicate_operation_count,
            section_count=section_count,
            section_policy_count=section_policy_count,
        )
        if not summary.release_ready:
            raise ViewRecipeRegistryError(f"view recipe registry is incomplete: {summary!r}")

        self._recipes = recipes
        self._by_id = MappingProxyType(by_id)
        self._by_capability = MappingProxyType(by_capability)
        self._by_operation = MappingProxyType(by_operation)
        self._summary = summary

    @property
    def recipes(self) -> tuple[ViewRecipeDefinition, ...]:
        return self._recipes

    @property
    def summary(self) -> ViewRecipeRegistrySummary:
        return self._summary

    @property
    def operation_ids(self) -> frozenset[str]:
        return frozenset(self._by_operation)

    def get(self, recipe_id: str) -> ViewRecipeDefinition | None:
        return self._by_id.get(recipe_id)

    def for_capability(self, capability_id: str) -> ViewRecipeDefinition:
        try:
            return self._by_capability[capability_id]
        except KeyError as exc:
            raise ViewRecipeRegistryError(
                f"unknown recipe capability: {capability_id!r}"
            ) from exc

    def for_operation(self, operation_ref: str) -> ViewRecipeDefinition:
        try:
            return self._by_operation[operation_ref]
        except KeyError as exc:
            raise ViewRecipeRegistryError(
                f"unknown recipe operation: {operation_ref!r}"
            ) from exc

    def public_catalog(self) -> list[dict[str, Any]]:
        return [recipe.public_serializable() for recipe in self._recipes]


def build_view_recipe_registry() -> ViewRecipeRegistry:
    recipes: list[ViewRecipeDefinition] = []
    for spec in _RECIPE_SPECS:
        recipe_id = str(spec["recipe_id"])
        capability_ids = tuple(spec["capability_ids"])
        operation_refs = tuple(
            operation_ref
            for capability_id in capability_ids
            for operation_ref in resolve_canvas_card(capability_id).operation_refs
            if OPERATION_RECIPE_OVERRIDES.get(operation_ref, recipe_id) == recipe_id
        )
        operation_refs += tuple(
            operation_ref
            for operation_ref, target_recipe_id in OPERATION_RECIPE_OVERRIDES.items()
            if target_recipe_id == recipe_id and operation_ref not in operation_refs
        )
        section_ids = tuple(spec["section_ids"])
        section_policies = tuple(
            ViewRecipeSectionPolicy(
                section_id=section_id,
                section_order=section_order,
                visibility_policy=(
                    "workflow"
                    if (str(spec["recipe_id"]), section_id)
                    in WORKFLOW_ONLY_SECTION_KEYS
                    else (
                        "always"
                        if (str(spec["recipe_id"]), section_id)
                        in REQUIRED_SECTION_KEYS
                        else "when-data"
                    )
                ),
                required=(str(spec["recipe_id"]), section_id)
                in REQUIRED_SECTION_KEYS,
                workflow_only=(str(spec["recipe_id"]), section_id)
                in WORKFLOW_ONLY_SECTION_KEYS,
            )
            for section_order, section_id in enumerate(section_ids, start=1)
        )
        recipes.append(
            ViewRecipeDefinition(
                recipe_id=recipe_id,
                title_ko=str(spec["title_ko"]),
                user_task=str(spec["user_task"]),
                capability_ids=capability_ids,
                section_ids=section_ids,
                section_policies=section_policies,
                primary_component_id=str(spec["primary_component_id"]),
                source_precedence=tuple(spec["source_precedence"]),
                operation_refs=operation_refs,
            )
        )
    return ViewRecipeRegistry(tuple(recipes))


@lru_cache(maxsize=1)
def get_view_recipe_registry() -> ViewRecipeRegistry:
    return build_view_recipe_registry()


def get_view_recipe_catalog() -> list[dict[str, Any]]:
    """Return the deterministic public recipe catalog."""

    return get_view_recipe_registry().public_catalog()
