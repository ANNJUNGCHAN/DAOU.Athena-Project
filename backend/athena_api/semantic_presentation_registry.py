"""Semantic presentation overlay for every canonical Canvas wire occurrence.

The lossless :mod:`canvas_field_registry` remains the wire contract.  This
module uses its immutable ``occurrence_id`` as a foreign key and decides which
values may enter product UI.  Protocol and structural envelope values remain
diagnostic-only.  Official opaque values stay user-accessible with neutral
labels so the product never discards a field present in the Kiwoom contract.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

from athena_api.canvas_field_registry import (
    EXPECTED_FIELD_OCCURRENCE_COUNT,
    EXPECTED_OPERATION_COUNT,
    CanvasFieldContract,
    get_canvas_field_registry,
)
from athena_api.view_recipe_registry import (
    WORKFLOW_ONLY_SECTION_KEYS,
    get_view_recipe_registry,
)

FIELD_CLASSES = frozenset({"semantic", "transport", "internal", "unresolved", "derived"})
UNRESOLVED_ALIASES = frozenset({"951", "924", "1279"})
UNRESOLVED_OCCURRENCES = frozenset(
    {
        ("base:04", "$.data[].951"),
        ("base:04", "$.data[].924"),
        ("base:1h", "$.data[].1279"),
    }
)
GENERIC_DESTINATION_TERMS = ("raw", "detail-sheet", "all-fields", "전체-필드", "원본")

_BACKEND = Path(__file__).resolve().parents[1]
_HIDDEN_OCCURRENCE_AUTHORITY_PATH = (
    _BACKEND / "ref" / "kiwoom-presentation-hidden-occurrences.json"
)
_HIDDEN_OCCURRENCE_SOURCE_PATHS = MappingProxyType(
    {
        "ref/kiwoom-capability-assignment.json": (
            _BACKEND / "ref" / "kiwoom-capability-assignment.json"
        ),
        "ref/kiwoom-common-screen-manifest.json": (
            _BACKEND / "ref" / "kiwoom-common-screen-manifest.json"
        ),
        "ref/kiwoom-tr-inventory.json": (
            _BACKEND / "ref" / "kiwoom-tr-inventory.json"
        ),
    }
)
_EXPECTED_HIDDEN_OCCURRENCE_COUNTS = MappingProxyType(
    {"transport": 92, "internal": 79}
)
_PUBLIC_LABEL_OVERRIDES = {
    "VI적용구분": "VI 적용 방식",
    "동적괴리율": "동적 VI 괴리율",
    "괴리율 동적": "동적 VI 괴리율",
    "동적기준가격": "동적 VI 기준가",
    "기준가격 동적": "동적 VI 기준가",
    "외국계매수추정합변동": "외국계 매수 추정 합계 변동",
    "LP초종공급일": "LP 최초·최종 공급일",
}
_OPERATION_FIELD_PUBLIC_LABEL_OVERRIDES = {
    ("detail:ka10001:current_trading", "pre_sig"): "전일 대비 기호",
    ("base:ka10003", "sign"): "전일 대비 기호",
    ("base:04", "951"): "명세 추가 항목 1",
    ("base:04", "924"): "명세 추가 항목 2",
    ("base:1h", "1279"): "명세 추가 항목",
}
_FAMILY_LABEL_OVERRIDES = {
    "매도거래원": "매도 거래원",
    "매도거래원수량": "매도 거래원 수량",
    "매도거래원별증감": "매도 거래원 증감",
    "매수거래원": "매수 거래원",
    "매수거래원수량": "매수 거래원 수량",
    "매수거래원별증감": "매수 거래원 증감",
    "매도거래원명": "매도 거래원",
    "매도거래량": "매도 거래량",
    "매수거래원명": "매수 거래원",
    "매수거래량": "매수 거래량",
    "LP회원사명": "LP 회원사",
}
_NUMBERED_SCHEMA_LABEL = re.compile(r"^(.*?)(\d+)$")


class SemanticPresentationRegistryError(ValueError):
    """Raised when the semantic overlay loses or misroutes a wire occurrence."""


@dataclass(frozen=True, slots=True)
class DisplayMetadataContract:
    formatter_id: str
    display_unit: str
    sign_policy: str

    def serializable(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class SemanticPresentationContract:
    wire_occurrence_id: str
    mapping_id: str
    json_path: str
    ordinal: int
    alias: str
    capability_id: str
    field_class: str
    concept_id: str | None
    label_ko: str | None
    description: str | None
    unit_or_format: str | None
    display_metadata: DisplayMetadataContract | None
    time_basis: str | None
    recipe_id: str | None
    section_id: str | None
    component_id: str | None
    visual_role: str | None
    placement_rule_id: str | None
    placement_basis: str | None
    semantic_basis: str | None
    display_tier: str | None
    display_group: str | None
    display_slot: int | None
    display_order: int | None
    visibility_policy: str | None
    source_precedence: tuple[str, ...]
    product_destination: str | None

    @property
    def user_visible(self) -> bool:
        return self.field_class in {"semantic", "unresolved", "derived"}

    def serializable(self) -> dict[str, Any]:
        """Return the lossless engineering contract, including its wire FK."""

        payload = asdict(self)
        payload["source_precedence"] = list(self.source_precedence)
        payload["user_visible"] = self.user_visible
        return payload

    def public_serializable(self) -> dict[str, Any] | None:
        """Return product-safe metadata without raw wire identifiers."""

        if not self.user_visible:
            return None
        return {
            "concept_id": self.concept_id,
            "label_ko": self.label_ko,
            "description": self.description,
            "unit_or_format": self.unit_or_format,
            "display_metadata": (
                self.display_metadata.serializable() if self.display_metadata else None
            ),
            "time_basis": self.time_basis,
            "recipe_id": self.recipe_id,
            "section_id": self.section_id,
            "component_id": self.component_id,
            "visual_role": self.visual_role,
            "display_tier": self.display_tier,
            "display_group": self.display_group,
            "display_slot": self.display_slot,
            "display_order": self.display_order,
            "visibility_policy": self.visibility_policy,
            "source_precedence": list(self.source_precedence),
        }


@dataclass(frozen=True, slots=True)
class SemanticPresentationRegistrySummary:
    operation_count: int
    occurrence_count: int
    unique_wire_occurrence_count: int
    duplicate_wire_path_occurrence_count: int
    semantic_count: int
    transport_count: int
    internal_count: int
    unresolved_count: int
    derived_count: int
    placed_user_field_count: int
    unsafe_product_destination_count: int
    recipe_reachable_operation_count: int
    unpopulated_non_workflow_section_count: int

    @property
    def wire_lossless(self) -> bool:
        return (
            self.operation_count == EXPECTED_OPERATION_COUNT
            and self.occurrence_count == EXPECTED_FIELD_OCCURRENCE_COUNT
            and self.unique_wire_occurrence_count == EXPECTED_FIELD_OCCURRENCE_COUNT
            and self.duplicate_wire_path_occurrence_count == 2
        )

    @property
    def fully_classified(self) -> bool:
        return (
            self.semantic_count
            + self.transport_count
            + self.internal_count
            + self.unresolved_count
            + self.derived_count
            == self.occurrence_count
        )

    @property
    def semantic_placement_complete(self) -> bool:
        return self.placed_user_field_count == (
            self.semantic_count + self.unresolved_count + self.derived_count
        )

    @property
    def product_destination_safe(self) -> bool:
        return self.unsafe_product_destination_count == 0

    @property
    def recipe_reachability_complete(self) -> bool:
        return self.recipe_reachable_operation_count == EXPECTED_OPERATION_COUNT

    @property
    def recipe_sections_populated(self) -> bool:
        return self.unpopulated_non_workflow_section_count == 0

    @property
    def review_ready(self) -> bool:
        return (
            self.wire_lossless
            and self.fully_classified
            and self.semantic_placement_complete
            and self.product_destination_safe
            and self.recipe_reachability_complete
            and self.recipe_sections_populated
        )

    @property
    def release_ready(self) -> bool:
        return self.review_ready and self.unresolved_count == 0

    @property
    def release_blockers(self) -> tuple[str, ...]:
        blockers: list[str] = []
        if not self.wire_lossless:
            blockers.append("wire-occurrence-coverage")
        if not self.fully_classified:
            blockers.append("field-classification")
        if not self.semantic_placement_complete:
            blockers.append("semantic-placement")
        if not self.product_destination_safe:
            blockers.append("unsafe-product-destination")
        if not self.recipe_reachability_complete:
            blockers.append("operation-recipe-reachability")
        if not self.recipe_sections_populated:
            blockers.append("recipe-section-population")
        if self.unresolved_count:
            blockers.append("unresolved-field-semantics")
        return tuple(blockers)

    def serializable(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.update(
            {
                "wire_lossless": self.wire_lossless,
                "fully_classified": self.fully_classified,
                "semantic_placement_complete": self.semantic_placement_complete,
                "product_destination_safe": self.product_destination_safe,
                "recipe_reachability_complete": self.recipe_reachability_complete,
                "recipe_sections_populated": self.recipe_sections_populated,
                "review_ready": self.review_ready,
                "release_ready": self.release_ready,
                "release_blockers": list(self.release_blockers),
            }
        )
        return payload


@dataclass(frozen=True, slots=True)
class _PlacementDecision:
    section_id: str
    component_id: str
    visual_role: str
    time_basis: str
    rule_id: str
    basis: str


@dataclass(frozen=True, slots=True)
class _CanonicalSemanticAuthority:
    label: str
    description: str
    unit_or_format: str
    time_basis: str
    semantic_role: str

    @property
    def semantic_basis(self) -> str:
        return _canonical_semantic_basis(
            self.label,
            self.description,
            self.unit_or_format,
            self.time_basis,
            self.semantic_role,
        )

    @property
    def concept_id(self) -> str:
        return _canonical_concept_id(
            self.label,
            self.description,
            self.unit_or_format,
            self.time_basis,
            self.semantic_role,
        )


# These sections are interaction surfaces, not response-field sinks.  They are
# intentionally excluded from field-population gates instead of being filled
# with unrelated API values.
WORKFLOW_ONLY_SECTIONS = MappingProxyType(
    {
        recipe.recipe_id: tuple(
            section_id
            for section_id in recipe.section_ids
            if (recipe.recipe_id, section_id) in WORKFLOW_ONLY_SECTION_KEYS
        )
        for recipe in get_view_recipe_registry().recipes
        if any(
            (recipe.recipe_id, section_id) in WORKFLOW_ONLY_SECTION_KEYS
            for section_id in recipe.section_ids
        )
    }
)

_WORKFLOW_COMPONENTS = MappingProxyType(
    {
        ("discovery-value", "discovery-filters"): "discovery-filter-controls",
        ("watchlist-condition", "saved-scope"): "saved-scope-selector",
        ("order-safe-ticket", "order-draft"): "safe-order-draft-form",
        ("order-safe-ticket", "cost-and-risk-preview"): "order-cost-risk-preview",
        ("gold-market", "gold-position-and-settlement"): "gold-account-navigation",
    }
)


_SECTION_PRESENTATION = MappingProxyType(
    {
        ("instrument-chart", "identity-and-quote"): (
            "instrument-identity-strip",
            "identity-or-quote-metric",
            "market-session-realtime",
        ),
        ("instrument-chart", "price-history"): (
            "athena-chart-workbench",
            "ohlc-or-price-series",
            "requested-period",
        ),
        ("instrument-chart", "volume-and-period"): (
            "chart-volume-track",
            "volume-or-period-control-value",
            "requested-period",
        ),
        ("live-orderbook", "quote-context"): (
            "orderbook-context-strip",
            "instrument-session-or-snapshot",
            "market-session-realtime",
        ),
        ("live-orderbook", "depth-ladder"): (
            "live-depth-ladder",
            "bid-ask-price-quantity-or-change",
            "market-session-realtime",
        ),
        ("live-orderbook", "trade-tape"): (
            "orderbook-trade-tape",
            "trade-price-quantity-or-strength",
            "market-session-realtime",
        ),
        ("why-move-flow", "move-summary"): (
            "move-summary-strip",
            "price-change-or-market-summary",
            "trading-date-or-period",
        ),
        ("why-move-flow", "participant-flow"): (
            "participant-flow-matrix",
            "participant-flow-metric-or-series",
            "trading-date-or-period",
        ),
        ("why-move-flow", "position-and-risk"): (
            "credit-short-risk-panel",
            "credit-lending-short-position-or-risk",
            "trading-date-or-period",
        ),
        ("discovery-value", "ranked-results"): (
            "discovery-comparison-table",
            "ranking-column-or-result-field",
            "query-as-of",
        ),
        ("discovery-value", "valuation-and-profile"): (
            "valuation-profile-panel",
            "profile-valuation-or-financial-metric",
            "statement-or-market-as-of",
        ),
        ("sector-theme", "market-group-summary"): (
            "market-group-summary-strip",
            "group-identity-or-summary",
            "market-session-or-period",
        ),
        ("sector-theme", "group-performance"): (
            "sector-performance-workbench",
            "group-performance-metric-or-series",
            "market-session-or-period",
        ),
        ("sector-theme", "constituents"): (
            "theme-constituent-table",
            "constituent-identity-or-metric",
            "query-as-of",
        ),
        ("watchlist-condition", "matching-instruments"): (
            "watchlist-condition-result-table",
            "matching-instrument-field",
            "market-session-realtime",
        ),
        ("watchlist-condition", "condition-status"): (
            "condition-lifecycle-panel",
            "condition-definition-or-status",
            "subscription-or-query-as-of",
        ),
        ("etf-product", "etf-summary"): (
            "etf-summary-strip",
            "product-identity-or-market-metric",
            "market-session-realtime",
        ),
        ("etf-product", "nav-and-performance"): (
            "etf-nav-performance-workbench",
            "nav-tracking-or-performance-metric",
            "market-session-or-period",
        ),
        ("etf-product", "constituents"): (
            "etf-constituent-summary",
            "constituent-count-or-composition-metric",
            "query-as-of",
        ),
        ("elw-product", "elw-summary"): (
            "elw-summary-strip",
            "product-identity-or-market-metric",
            "market-session-realtime",
        ),
        ("elw-product", "sensitivity-and-expiry"): (
            "elw-greeks-expiry-panel",
            "greek-expiry-valuation-or-leverage-metric",
            "market-session-or-contract-date",
        ),
        ("elw-product", "liquidity-provider"): (
            "elw-lp-liquidity-panel",
            "lp-identity-quote-or-inventory-metric",
            "market-session-realtime",
        ),
        ("market-vi", "market-state"): (
            "market-state-strip",
            "market-operation-state",
            "market-session-realtime",
        ),
        ("market-vi", "vi-events"): (
            "vi-event-timeline",
            "vi-trigger-release-or-event-time",
            "market-session-realtime",
        ),
        ("market-vi", "affected-instruments"): (
            "vi-affected-instrument-table",
            "affected-instrument-identity-or-market-metric",
            "market-session-realtime",
        ),
        ("account-risk", "account-summary"): (
            "account-summary-strip",
            "account-asset-cash-or-performance-summary",
            "account-as-of",
        ),
        ("account-risk", "positions-and-performance"): (
            "account-position-table",
            "position-identity-valuation-or-profit-field",
            "account-as-of",
        ),
        ("account-risk", "settlement-and-risk"): (
            "account-settlement-risk-panel",
            "settlement-margin-loan-capacity-or-liability",
            "account-as-of-or-settlement-date",
        ),
        ("order-safe-ticket", "confirmation-and-receipt"): (
            "safe-order-receipt-timeline",
            "broker-order-receipt-or-status",
            "order-lifecycle",
        ),
        ("gold-market", "gold-summary"): (
            "gold-summary-strip",
            "gold-identity-or-quote-summary",
            "market-session-realtime",
        ),
        ("gold-market", "gold-market-data"): (
            "gold-market-workbench",
            "gold-price-volume-trade-or-chart-field",
            "market-session-or-period",
        ),
    }
)


_IDENTITY_ALIASES = frozenset(
    {
        "stk_cd",
        "stk_nm",
        "inds_cd",
        "inds_nm",
        "acctNo",
        "acnt_no",
        "9001",
        "302",
        "stex_tp",
        "dmst_stex_tp",
    }
)
_PRICE_ALIASES = frozenset(
    {
        "cur_prc",
        "open_pric",
        "high_pric",
        "low_pric",
        "close_pric",
        "pred_pre",
        "pred_pre_sig",
        "flu_rt",
        "pre_rt",
        "10",
        "11",
        "12",
        "16",
        "17",
        "18",
        "25",
    }
)
_VOLUME_TOKENS = frozenset({"qty", "vol", "prica", "turn"})
_RATE_TOKENS = frozenset({"rt", "rate", "ratio", "per"})
_DATE_TOKENS = frozenset({"dt", "date", "ymd"})
_TIME_TOKENS = frozenset({"tm", "time"})
_MONEY_TOKENS = frozenset(
    {"prc", "pric", "price", "amt", "cash", "dpst", "aset"}
)
_QUANTITY_TOKENS = frozenset({"qty", "vol", "remn", "cnt"})
_IDENTIFIER_TOKENS = frozenset({"cd", "code", "no", "seq"})

_ELW_LP_OPERATION_IDS = frozenset(
    {
        "base:ka30003",
        "detail:ka30012:liquidity_providers",
    }
)
_ORDERBOOK_CONTEXT_OPERATION_IDS = frozenset(
    {
        "base:0c",
        "detail:ka10004:snapshot_time",
        "detail:ka10007:expected_market",
        "detail:ka10007:identity",
        "detail:ka10007:session",
        "detail:ka10087:snapshot_time",
    }
)
_CURRENT_TRADING_OPERATION_ID = "detail:ka10001:current_trading"
_CURRENT_TRADING_QUOTE_ALIASES = frozenset(
    {"cur_prc", "pre_sig", "pred_pre", "flu_rt"}
)
_CURRENT_TRADING_VOLUME_ALIASES = frozenset({"trde_qty", "trde_pre"})
_INSTRUMENT_CURRENT_PRICE_AUTHORITY = _CanonicalSemanticAuthority(
    label="현재가",
    description="현재가",
    unit_or_format="currency-or-price",
    time_basis="requested-period",
    semantic_role="price-or-money",
)
_VERIFIED_OPERATION_FIELD_AUTHORITIES = MappingProxyType(
    {
        ("base:ka10081", "cur_prc"): _INSTRUMENT_CURRENT_PRICE_AUTHORITY,
        ("base:0B", "10"): _INSTRUMENT_CURRENT_PRICE_AUTHORITY,
    }
)
_VERIFIED_OPERATION_FIELD_DISPLAY = MappingProxyType(
    {
        ("base:ka10081", "cur_prc"): DisplayMetadataContract(
            formatter_id="grouped-number",
            display_unit="원",
            sign_policy="absolute",
        ),
        ("base:ka10081", "trde_qty"): DisplayMetadataContract(
            formatter_id="grouped-number",
            display_unit="주",
            sign_policy="absolute",
        ),
        ("detail:ka10001:current_trading", "flu_rt"): DisplayMetadataContract(
            formatter_id="decimal-number",
            display_unit="%",
            sign_policy="always",
        ),
        ("base:ka10081", "dt"): DisplayMetadataContract(
            formatter_id="date-yyyymmdd",
            display_unit="",
            sign_policy="none",
        ),
        ("base:ka10081", "stk_cd"): DisplayMetadataContract(
            formatter_id="stock-code",
            display_unit="",
            sign_policy="none",
        ),
    }
)
_VERIFIED_OPERATION_FIELD_UNITS = MappingProxyType(
    {
        (_CURRENT_TRADING_OPERATION_ID, "pred_pre"): "currency-or-price",
        (_CURRENT_TRADING_OPERATION_ID, "trde_pre"): "quantity",
    }
)
_ELW_VALUATION_OPERATION_IDS = frozenset(
    {
        "detail:ka30012:valuation_and_rights",
        "detail:ka30012:liquidity_and_leverage",
        "detail:ka30012:key_dates",
        "detail:ka30012:payoff_conditions",
        "detail:ka30012:evaluation_window",
        "detail:ka30012:evaluation_extrema",
    }
)
_ACCOUNT_RISK_OPERATION_GROUPS = frozenset(
    {
        "settlement_forecast",
        "cash_and_withdrawal_capacity",
        "purchase_settlement",
        "substitute_valuation_and_limits",
    }
)
_ACCOUNT_POSITION_OPERATION_GROUPS = frozenset(
    {
        "position_valuation",
        "gold_trade_history",
    }
)


def _decision(
    recipe_id: str,
    section_id: str,
    rule_id: str,
    basis: str,
) -> _PlacementDecision:
    component_id, visual_role, time_basis = _SECTION_PRESENTATION[(recipe_id, section_id)]
    return _PlacementDecision(
        section_id,
        component_id,
        visual_role,
        time_basis,
        rule_id,
        basis,
    )


def _alias_tokens(alias: str) -> frozenset[str]:
    """Return exact schema tokens; never infer semantics from substrings."""

    return frozenset(token for token in alias.lower().split("_") if token)


def _has_alias_token(alias: str, *tokens: str) -> bool:
    return bool(_alias_tokens(alias).intersection(tokens))


def _has_official_term(field: CanvasFieldContract, *terms: str) -> bool:
    """Match presentation hints only against authoritative field metadata."""

    official_text = f"{field.label} {field.description}".replace(" ", "")
    return any(term.replace(" ", "") in official_text for term in terms)


def _placement_for(field: CanvasFieldContract, recipe_id: str) -> _PlacementDecision:
    alias = field.alias.lower()
    mapping = field.mapping_id.lower()
    capability = field.capability_id

    if mapping == _CURRENT_TRADING_OPERATION_ID:
        if recipe_id != "instrument-chart":
            raise SemanticPresentationRegistryError(
                "current trading snapshot requires the instrument-chart recipe"
            )
        if alias in _CURRENT_TRADING_QUOTE_ALIASES:
            return _decision(
                recipe_id,
                "identity-and-quote",
                "chart.current-trading-quote",
                "verified current-trading quote field",
            )
        if alias in _CURRENT_TRADING_VOLUME_ALIASES:
            return _decision(
                recipe_id,
                "volume-and-period",
                "chart.current-trading-volume",
                "verified current-trading volume field",
            )
        raise SemanticPresentationRegistryError(
            f"unverified current trading field alias: {field.alias!r}"
        )

    if capability in {"chart", "quote"}:
        if alias in _IDENTITY_ALIASES:
            return _decision(recipe_id, "identity-and-quote", "chart.identity", "identity alias")
        if _alias_tokens(alias).intersection(_VOLUME_TOKENS):
            return _decision(recipe_id, "volume-and-period", "chart.volume", "volume alias")
        if (
            capability == "chart"
            or alias in _PRICE_ALIASES
            or mapping in {"base:ka10005", "base:ka10006"}
        ):
            return _decision(
                recipe_id, "price-history", "chart.price-series", "chart or OHLC context"
            )
        return _decision(recipe_id, "identity-and-quote", "chart.quote-context", "quote context")

    if capability == "orderbook":
        if mapping in {"base:ka50101", "detail:ka10087:trading_summary"}:
            return _decision(recipe_id, "trade-tape", "orderbook.trade", "trade operation")
        if mapping in _ORDERBOOK_CONTEXT_OPERATION_IDS:
            return _decision(
                recipe_id,
                "quote-context",
                "orderbook.context",
                "snapshot or session context",
            )
        return _decision(recipe_id, "depth-ladder", "orderbook.depth", "bid/ask depth operation")

    if capability in {"program-trading", "investor-flow", "broker", "credit-lending-short"}:
        if capability == "credit-lending-short":
            return _decision(
                recipe_id,
                "position-and-risk",
                "flow.position-risk",
                "credit/lending/short capability",
            )
        if alias in _PRICE_ALIASES or alias in _IDENTITY_ALIASES:
            return _decision(
                recipe_id,
                "move-summary",
                "flow.move-summary",
                "market or instrument context",
            )
        return _decision(
            recipe_id,
            "participant-flow",
            "flow.participant",
            "participant flow field",
        )

    if capability == "discovery":
        return _decision(recipe_id, "ranked-results", "discovery.result", "discovery response")
    if capability == "stock-info":
        return _decision(
            recipe_id,
            "valuation-and-profile",
            "discovery.profile",
            "stock information response",
        )

    if capability in {"sector", "theme"}:
        if capability == "theme" and field.section != "top-level":
            return _decision(
                recipe_id,
                "constituents",
                "sector.constituent",
                "theme constituent array",
            )
        if alias in _IDENTITY_ALIASES or field.section == "top-level":
            return _decision(
                recipe_id,
                "market-group-summary",
                "sector.summary",
                "group identity or summary",
            )
        return _decision(
            recipe_id,
            "group-performance",
            "sector.performance",
            "group performance series",
        )

    if capability == "watchlist":
        return _decision(
            recipe_id,
            "matching-instruments",
            "watchlist.result",
            "watchlist response",
        )
    if capability == "condition-search":
        return _decision(
            recipe_id,
            "condition-status",
            "condition.status",
            "condition definition or lifecycle response",
        )

    if capability == "etf":
        if alias in {"stkcnt", "drstk"} or _has_official_term(
            field, "구성종목", "구성주식", "편입종목"
        ):
            return _decision(
                recipe_id,
                "constituents",
                "etf.constituent-summary",
                "composition field",
            )
        if _has_alias_token(alias, "nav", "trace", "txbs", "dvid") or _has_official_term(
            field, "순자산가치", "추적", "분배", "대용가격", "전환가격", "수익률"
        ):
            return _decision(
                recipe_id,
                "nav-and-performance",
                "etf.nav-performance",
                "NAV/tracking/performance field",
            )
        return _decision(recipe_id, "etf-summary", "etf.summary", "ETF identity or market field")

    if capability == "elw":
        if mapping in _ELW_LP_OPERATION_IDS or _has_alias_token(alias, "lp"):
            return _decision(
                recipe_id,
                "liquidity-provider",
                "elw.lp",
                "LP identity/liquidity field",
            )
        if mapping in _ELW_VALUATION_OPERATION_IDS or _has_alias_token(
            alias,
            "iv",
            "delta",
            "gam",
            "theta",
            "vega",
            "law",
            "gearing",
            "premium",
            "basis",
            "srvive",
            "expiry",
        ) or _has_official_term(
            field, "델타", "감마", "세타", "베가", "레버리지", "프리미엄", "만기", "행사가"
        ):
            return _decision(
                recipe_id,
                "sensitivity-and-expiry",
                "elw.greeks-expiry",
                "Greek/valuation/expiry field",
            )
        return _decision(recipe_id, "elw-summary", "elw.summary", "ELW identity or market field")

    if capability == "market-status":
        if mapping == "base:0s":
            return _decision(recipe_id, "market-state", "market.state", "market operation feed")
        if alias in _IDENTITY_ALIASES or alias in {"13", "14"}:
            return _decision(
                recipe_id,
                "affected-instruments",
                "market.affected",
                "VI instrument field",
            )
        return _decision(recipe_id, "vi-events", "market.vi-event", "VI event field")

    if capability == "account":
        risk_tokens = frozenset(
            {
            "setl",
            "settlement",
            "margin",
            "loan",
            "collateral",
            "receivable",
            "arrear",
            "capacity",
            "funding",
            "guarantee",
            "financing",
            "liability",
            "cash_and_withdrawal",
            "crd",
            "wthd",
            }
        )
        operation_group = mapping.rsplit(":", 1)[-1]
        if operation_group in _ACCOUNT_RISK_OPERATION_GROUPS or _alias_tokens(
            alias
        ).intersection(risk_tokens):
            return _decision(
                recipe_id,
                "settlement-and-risk",
                "account.risk",
                "settlement/risk context",
            )
        if operation_group in _ACCOUNT_POSITION_OPERATION_GROUPS or field.section != "top-level":
            return _decision(
                recipe_id,
                "positions-and-performance",
                "account.position",
                "position/performance context",
            )
        return _decision(
            recipe_id,
            "account-summary",
            "account.summary",
            "top-level account aggregate",
        )

    if capability == "order":
        return _decision(
            recipe_id,
            "confirmation-and-receipt",
            "order.receipt",
            "broker response field",
        )

    if capability == "gold":
        if alias in _IDENTITY_ALIASES or (field.section == "top-level" and mapping == "base:0i"):
            return _decision(recipe_id, "gold-summary", "gold.summary", "gold quote context")
        return _decision(
            recipe_id,
            "gold-market-data",
            "gold.market-data",
            "gold price/trade/chart response",
        )

    raise SemanticPresentationRegistryError(
        f"no field-level placement rules for capability: {capability!r}"
    )


@lru_cache(maxsize=1)
def _hidden_occurrence_authority() -> MappingProxyType[str, str]:
    payload = json.loads(_HIDDEN_OCCURRENCE_AUTHORITY_PATH.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise SemanticPresentationRegistryError(
            "unsupported hidden occurrence authority schema version"
        )
    source_contract = payload.get("source_contract", {})
    if source_contract.get("operation_count") != EXPECTED_OPERATION_COUNT:
        raise SemanticPresentationRegistryError(
            "hidden occurrence authority operation count does not match the wire registry"
        )
    if source_contract.get("field_occurrence_count") != EXPECTED_FIELD_OCCURRENCE_COUNT:
        raise SemanticPresentationRegistryError(
            "hidden occurrence authority field count does not match the wire registry"
        )

    expected_hashes = source_contract.get("source_hashes", {})
    if set(expected_hashes) != set(_HIDDEN_OCCURRENCE_SOURCE_PATHS):
        raise SemanticPresentationRegistryError(
            "hidden occurrence authority source set does not match the wire registry"
        )
    for relative_path, source_path in _HIDDEN_OCCURRENCE_SOURCE_PATHS.items():
        actual_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if expected_hashes.get(relative_path) != actual_hash:
            raise SemanticPresentationRegistryError(
                f"hidden occurrence authority source hash mismatch: {relative_path}"
            )

    classified = payload.get("occurrence_ids", {})
    authority: dict[str, str] = {}
    for field_class, expected_count in _EXPECTED_HIDDEN_OCCURRENCE_COUNTS.items():
        occurrence_ids = classified.get(field_class)
        if not isinstance(occurrence_ids, list) or len(occurrence_ids) != expected_count:
            raise SemanticPresentationRegistryError(
                f"hidden occurrence authority count mismatch: {field_class}"
            )
        for occurrence_id in occurrence_ids:
            if not isinstance(occurrence_id, str) or occurrence_id in authority:
                raise SemanticPresentationRegistryError(
                    f"invalid hidden occurrence authority identity: {occurrence_id!r}"
                )
            authority[occurrence_id] = field_class

    counts = payload.get("classification_counts", {})
    if counts != {
        **_EXPECTED_HIDDEN_OCCURRENCE_COUNTS,
        "hidden_total": sum(_EXPECTED_HIDDEN_OCCURRENCE_COUNTS.values()),
    }:
        raise SemanticPresentationRegistryError(
            "hidden occurrence authority summary does not match its frozen contract"
        )

    wire_occurrence_ids = {
        field.occurrence_id for field in get_canvas_field_registry().contracts
    }
    unknown = set(authority).difference(wire_occurrence_ids)
    if unknown:
        raise SemanticPresentationRegistryError(
            f"hidden occurrence authority references unknown wire identities: {sorted(unknown)!r}"
        )
    unresolved_ids = {
        field.occurrence_id
        for field in get_canvas_field_registry().contracts
        if (field.mapping_id, field.json_path) in UNRESOLVED_OCCURRENCES
    }
    if unresolved_ids.intersection(authority):
        raise SemanticPresentationRegistryError(
            "official opaque occurrences cannot be hidden by presentation authority"
        )
    return MappingProxyType(authority)


def _classify(field: CanvasFieldContract) -> str:
    if (field.mapping_id, field.json_path) in UNRESOLVED_OCCURRENCES:
        return "unresolved"
    return _hidden_occurrence_authority().get(field.occurrence_id, "semantic")


def _public_label(field: CanvasFieldContract) -> str:
    operation_field_label = _OPERATION_FIELD_PUBLIC_LABEL_OVERRIDES.get(
        (field.mapping_id, field.alias)
    )
    if operation_field_label is not None:
        return operation_field_label
    return _PUBLIC_LABEL_OVERRIDES.get(field.label, field.label)


def _humanize_family_label(label: str) -> str:
    if label in _FAMILY_LABEL_OVERRIDES:
        return _FAMILY_LABEL_OVERRIDES[label]
    humanized = label.replace("_", " ")
    for source, replacement in (
        ("시간외단일가", "시간외 단일가"),
        ("매도호가", "매도 호가"),
        ("매수호가", "매수 호가"),
        ("직전대비", "직전 대비"),
        ("기초자산구성비율", "기초자산 구성 비율"),
    ):
        humanized = humanized.replace(source, replacement)
    return " ".join(humanized.split())


def _family_display_group(family_label: str, display_label: str) -> str:
    normalized = family_label.replace("_", "")
    for raw_prefix, group in (
        ("매도거래원", "매도 거래원"),
        ("매수거래원", "매수 거래원"),
        ("시간외단일가매도호가", "시간외 단일가 매도 호가"),
        ("시간외단일가매수호가", "시간외 단일가 매수 호가"),
        ("LP매도호가", "LP 매도 호가"),
        ("LP매수호가", "LP 매수 호가"),
        ("KRX매도호가", "KRX 매도 호가"),
        ("KRX매수호가", "KRX 매수 호가"),
        ("NXT매도호가", "NXT 매도 호가"),
        ("NXT매수호가", "NXT 매수 호가"),
        ("매도호가", "매도 호가"),
        ("매수호가", "매수 호가"),
        ("기초자산", "기초자산 구성"),
        ("LP회원사명", "LP 회원사"),
    ):
        if normalized.startswith(raw_prefix):
            return group
    return display_label


def _slot_family(
    field: CanvasFieldContract,
    operation_fields: tuple[CanvasFieldContract, ...],
) -> tuple[str, str, int] | None:
    match = _NUMBERED_SCHEMA_LABEL.fullmatch(field.label)
    if match:
        family_label, slot_text = match.groups()
        if family_label.endswith(("D+", "D-")):
            return None
        family_members = [
            peer
            for peer in operation_fields
            if peer.label == family_label
            or re.fullmatch(rf"{re.escape(family_label)}\d+", peer.label)
        ]
        if len(family_members) >= 2:
            display_label = _humanize_family_label(family_label)
            return (
                display_label,
                _family_display_group(family_label, display_label),
                int(slot_text),
            )
        return None

    numbered_members = [
        peer
        for peer in operation_fields
        if re.fullmatch(rf"{re.escape(field.label)}\d+", peer.label)
    ]
    if numbered_members:
        display_label = _humanize_family_label(field.label)
        return (
            display_label,
            _family_display_group(field.label, display_label),
            0,
        )
    return None


def _public_description(field: CanvasFieldContract, label: str) -> str:
    if (field.mapping_id, field.json_path) in UNRESOLVED_OCCURRENCES:
        return "키움 공식 명세 표기: Extra Item"
    if field.description == field.label:
        return label
    if field.label == "VI적용구분":
        return "적용되는 VI 기준의 종류"
    return field.description


def _normalize_official_meaning(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().lower()
    normalized = re.sub(r"[\s_\-·./(),]+", "", normalized)
    normalized = normalized.replace("등락율", "등락률")
    if normalized == "종목번호":
        normalized = "종목코드"
    if normalized == "대비기호":
        normalized = "전일대비기호"
    return normalized


def _semantic_role(unit_or_format: str) -> str:
    return {
        "currency-or-price": "price-or-money",
        "quantity": "quantity",
        "percentage-or-ratio": "rate-or-ratio",
        "date": "date",
        "time": "time",
        "identifier": "identity",
    }.get(unit_or_format, "descriptive-value")


def _canonical_concept_id(
    label: str,
    description: str,
    unit_or_format: str,
    time_basis: str,
    semantic_role: str,
) -> str:
    semantic_basis = _canonical_semantic_basis(
        label,
        description,
        unit_or_format,
        time_basis,
        semantic_role,
    )
    digest = hashlib.sha256(semantic_basis.encode("utf-8")).hexdigest()[:16]
    return f"concept.{digest}"


def _canonical_semantic_basis(
    label: str,
    description: str,
    unit_or_format: str,
    time_basis: str,
    semantic_role: str,
) -> str:
    meaning = _normalize_official_meaning(label) or _normalize_official_meaning(
        description
    )
    return "|".join((meaning, unit_or_format, time_basis, semantic_role))


_ANSWER_ALIASES = frozenset(
    {
        "cur_prc",
        "close_pric",
        "10",
        "nav",
        "tot_evlt_amt",
        "tot_prft_rt",
        "ord_no",
    }
)
_PRIMARY_ALIASES = _ANSWER_ALIASES | frozenset(
    {
        "open_pric",
        "high_pric",
        "low_pric",
        "trde_qty",
        "pred_pre",
        "flu_rt",
        "evlt_amt",
        "evltv_prft",
        "prft_rt",
        "sel_bid",
        "buy_bid",
        "27",
        "28",
    }
)


def _display_metadata(
    field: CanvasFieldContract,
    placement: _PlacementDecision,
    concept_id: str,
    *,
    has_named_counterpart: bool = False,
    display_group_override: str | None = None,
) -> tuple[str, str, int, str]:
    alias = field.alias.lower()
    if has_named_counterpart:
        tier = "detail"
    elif alias in _ANSWER_ALIASES:
        tier = "answer"
    elif alias in _PRIMARY_ALIASES or placement.section_id == "depth-ladder":
        tier = "primary"
    elif alias in _IDENTITY_ALIASES or field.section == "top-level":
        tier = "support"
    else:
        tier = "detail"

    visibility = (
        "row-detail"
        if tier == "detail" and field.section != "top-level"
        else ("named-detail" if tier == "detail" else "always")
    )
    tier_base = {"answer": 0, "primary": 100, "support": 200, "detail": 300}[tier]
    array_offset = 20 if field.section != "top-level" else 0
    stable_offset = int(concept_id.rsplit(".", 1)[1][:4], 16) % 20
    display_order = tier_base + array_offset + stable_offset
    return tier, display_group_override or placement.section_id, display_order, visibility


def _has_named_counterpart(
    field: CanvasFieldContract,
    operation_fields: tuple[CanvasFieldContract, ...],
) -> bool:
    normalized_label = field.label.replace(" ", "")
    if "코드" not in normalized_label:
        return False
    candidate_labels = {
        normalized_label.replace("코드", "", 1),
        normalized_label.replace("코드", "명", 1),
    }
    return any(
        peer.occurrence_id != field.occurrence_id
        and peer.label.replace(" ", "") in candidate_labels
        for peer in operation_fields
    )


def _unit_or_format(field: CanvasFieldContract) -> str:
    authority = _VERIFIED_OPERATION_FIELD_AUTHORITIES.get(
        (field.mapping_id, field.alias)
    )
    if authority is not None:
        return authority.unit_or_format
    verified_unit = _VERIFIED_OPERATION_FIELD_UNITS.get(
        (field.mapping_id.lower(), field.alias.lower())
    )
    if verified_unit:
        return verified_unit
    tokens = _alias_tokens(field.alias)
    label = field.label
    if tokens.intersection(_RATE_TOKENS) or "%" in label:
        return "percentage-or-ratio"
    if tokens.intersection(_DATE_TOKENS):
        return "date"
    if tokens.intersection(_TIME_TOKENS):
        return "time"
    if tokens.intersection(_MONEY_TOKENS):
        return "currency-or-price"
    if tokens.intersection(_QUANTITY_TOKENS):
        return "quantity"
    if tokens.intersection(_IDENTIFIER_TOKENS):
        return "identifier"
    return "source-defined-number-or-text"


class SemanticPresentationRegistry:
    def __init__(self, contracts: tuple[SemanticPresentationContract, ...]) -> None:
        wire_registry = get_canvas_field_registry()
        expected_wire_ids = {field.occurrence_id for field in wire_registry.contracts}
        by_occurrence: dict[str, SemanticPresentationContract] = {}
        by_operation: dict[str, list[SemanticPresentationContract]] = {}
        path_counts: Counter[tuple[str, str]] = Counter()
        class_counts: Counter[str] = Counter()
        concept_bases: dict[str, str] = {}
        unsafe_count = 0

        for contract in contracts:
            if contract.wire_occurrence_id in by_occurrence:
                raise SemanticPresentationRegistryError(
                    f"duplicate wire occurrence overlay: {contract.wire_occurrence_id!r}"
                )
            if contract.field_class not in FIELD_CLASSES:
                raise SemanticPresentationRegistryError(
                    f"unknown field class: {contract.field_class!r}"
                )
            by_occurrence[contract.wire_occurrence_id] = contract
            by_operation.setdefault(contract.mapping_id, []).append(contract)
            path_counts[(contract.mapping_id, contract.json_path)] += 1
            class_counts[contract.field_class] += 1

            if contract.user_visible:
                required = (
                    contract.concept_id,
                    contract.label_ko,
                    contract.description,
                    contract.unit_or_format,
                    contract.time_basis,
                    contract.recipe_id,
                    contract.section_id,
                    contract.component_id,
                    contract.visual_role,
                    contract.placement_rule_id,
                    contract.placement_basis,
                    contract.semantic_basis,
                    contract.display_tier,
                    contract.display_group,
                    contract.visibility_policy,
                    contract.product_destination,
                )
                if (
                    any(not value for value in required)
                    or contract.display_order is None
                    or not contract.source_precedence
                ):
                    raise SemanticPresentationRegistryError(
                        f"user field has incomplete placement: {contract.wire_occurrence_id!r}"
                    )
                prior_basis = concept_bases.setdefault(
                    contract.concept_id, contract.semantic_basis
                )
                if prior_basis != contract.semantic_basis:
                    raise SemanticPresentationRegistryError(
                        "canonical concept collision: "
                        f"{contract.concept_id!r} maps to multiple semantic bases"
                    )
                destination = contract.product_destination.lower()
                if any(term in destination for term in GENERIC_DESTINATION_TERMS):
                    unsafe_count += 1
            elif any(
                value is not None
                for value in (
                    contract.recipe_id,
                    contract.section_id,
                    contract.component_id,
                    contract.visual_role,
                    contract.placement_rule_id,
                    contract.placement_basis,
                    contract.semantic_basis,
                    contract.display_tier,
                    contract.display_group,
                    contract.display_slot,
                    contract.display_order,
                    contract.visibility_policy,
                    contract.product_destination,
                )
            ):
                unsafe_count += 1

        if set(by_occurrence) != expected_wire_ids:
            missing = expected_wire_ids - by_occurrence.keys()
            extra = by_occurrence.keys() - expected_wire_ids
            raise SemanticPresentationRegistryError(
                "semantic overlay does not match wire registry; "
                f"missing={len(missing)}, extra={len(extra)}"
            )

        recipe_registry = get_view_recipe_registry()
        reachable_operations = set(by_operation) & recipe_registry.operation_ids
        section_population = Counter(
            (contract.recipe_id, contract.section_id)
            for contract in contracts
            if contract.user_visible
        )
        expected_populated_sections = {
            (recipe.recipe_id, section_id)
            for recipe in recipe_registry.recipes
            for section_id in recipe.section_ids
            if section_id not in WORKFLOW_ONLY_SECTIONS.get(recipe.recipe_id, ())
        }
        unpopulated_sections = expected_populated_sections - section_population.keys()
        summary = SemanticPresentationRegistrySummary(
            operation_count=len(by_operation),
            occurrence_count=len(contracts),
            unique_wire_occurrence_count=len(by_occurrence),
            duplicate_wire_path_occurrence_count=sum(
                count - 1 for count in path_counts.values()
            ),
            semantic_count=class_counts["semantic"],
            transport_count=class_counts["transport"],
            internal_count=class_counts["internal"],
            unresolved_count=class_counts["unresolved"],
            derived_count=class_counts["derived"],
            placed_user_field_count=sum(contract.user_visible for contract in contracts),
            unsafe_product_destination_count=unsafe_count,
            recipe_reachable_operation_count=len(reachable_operations),
            unpopulated_non_workflow_section_count=len(unpopulated_sections),
        )
        if not summary.review_ready:
            raise SemanticPresentationRegistryError(
                f"semantic presentation registry is structurally incomplete: {summary!r}"
            )

        self._contracts = contracts
        self._by_occurrence = MappingProxyType(by_occurrence)
        self._by_operation = MappingProxyType(
            {mapping_id: tuple(items) for mapping_id, items in by_operation.items()}
        )
        self._summary = summary
        self._section_population = MappingProxyType(dict(section_population))

    @property
    def contracts(self) -> tuple[SemanticPresentationContract, ...]:
        return self._contracts

    @property
    def summary(self) -> SemanticPresentationRegistrySummary:
        return self._summary

    @property
    def section_population(self) -> MappingProxyType:
        return self._section_population

    @property
    def workflow_only_sections(self) -> MappingProxyType:
        return WORKFLOW_ONLY_SECTIONS

    def get(self, wire_occurrence_id: str) -> SemanticPresentationContract | None:
        return self._by_occurrence.get(wire_occurrence_id)

    def for_operation(self, mapping_id: str) -> tuple[SemanticPresentationContract, ...]:
        try:
            return self._by_operation[mapping_id]
        except KeyError as exc:
            raise SemanticPresentationRegistryError(
                f"unknown semantic presentation operation: {mapping_id!r}"
            ) from exc

    def public_for_operation(self, mapping_id: str) -> list[dict[str, Any]]:
        public_items = (
            contract.public_serializable() for contract in self.for_operation(mapping_id)
        )
        return [item for item in public_items if item is not None]

    def public_sections_for_recipe(self, recipe_id: str) -> list[dict[str, Any]]:
        recipe = get_view_recipe_registry().get(recipe_id)
        if recipe is None:
            raise SemanticPresentationRegistryError(
                f"unknown semantic presentation recipe: {recipe_id!r}"
            )
        workflow_sections = WORKFLOW_ONLY_SECTIONS.get(recipe_id, ())
        sections: list[dict[str, Any]] = []
        for order, section_id in enumerate(recipe.section_ids, start=1):
            key = (recipe_id, section_id)
            policy = recipe.section_policy(section_id)
            if section_id in workflow_sections:
                component_id = _WORKFLOW_COMPONENTS[key]
            else:
                component_id = _SECTION_PRESENTATION[key][0]
            sections.append(
                {
                    "section_id": section_id,
                    "section_order": order,
                    "section_policy": policy.visibility_policy,
                    "required": policy.required,
                    "workflow_only": policy.workflow_only,
                    "component_id": component_id,
                    "field_count": self._section_population.get(key, 0),
                }
            )
        return sections

    def release_gates(self) -> dict[str, Any]:
        return self._summary.serializable()


def build_semantic_presentation_registry() -> SemanticPresentationRegistry:
    wire_registry = get_canvas_field_registry()
    recipe_registry = get_view_recipe_registry()
    contracts: list[SemanticPresentationContract] = []
    fields_by_operation: dict[str, tuple[CanvasFieldContract, ...]] = {}
    for mapping_id in wire_registry.operation_ids:
        fields_by_operation[mapping_id] = wire_registry.for_operation(mapping_id)

    for field in wire_registry.contracts:
        field_class = _classify(field)
        user_visible = field_class in {"semantic", "unresolved", "derived"}
        recipe = recipe_registry.for_operation(field.mapping_id) if user_visible else None
        placement = _placement_for(field, recipe.recipe_id) if recipe else None
        section_id = placement.section_id if placement else None
        component_id = placement.component_id if placement else None
        authority = (
            _VERIFIED_OPERATION_FIELD_AUTHORITIES.get((field.mapping_id, field.alias))
            if user_visible
            else None
        )
        field_display_metadata = (
            _VERIFIED_OPERATION_FIELD_DISPLAY.get((field.mapping_id, field.alias))
            if user_visible
            else None
        )
        unit_or_format = _unit_or_format(field) if user_visible else None
        semantic_role = (
            authority.semantic_role
            if authority is not None
            else (_semantic_role(unit_or_format) if unit_or_format else None)
        )
        slot_family = (
            _slot_family(field, fields_by_operation[field.mapping_id])
            if user_visible
            else None
        )
        display_slot = slot_family[2] if slot_family else None
        public_label = (
            slot_family[0] if slot_family else _public_label(field)
        ) if user_visible else None
        public_description = (
            _public_description(field, public_label)
            if user_visible and public_label
            else None
        )
        concept_id = (
            authority.concept_id
            if authority is not None
            else (
                _canonical_concept_id(
                    public_label,
                    public_description,
                    unit_or_format,
                    placement.time_basis,
                    semantic_role,
                )
                if placement and unit_or_format and semantic_role
                else None
            )
        )
        display_metadata = (
            _display_metadata(
                field,
                placement,
                concept_id,
                has_named_counterpart=_has_named_counterpart(
                    field, fields_by_operation[field.mapping_id]
                ),
                display_group_override=slot_family[1] if slot_family else None,
            )
            if placement and concept_id
            else (None, None, None, None)
        )
        display_tier, display_group, display_order, visibility_policy = display_metadata
        if field_class == "unresolved":
            display_tier = "detail"
            display_group = "명세 추가 항목"
            visibility_policy = "named-detail"
        product_destination = (
            f"{recipe.recipe_id}/{section_id}/{component_id}"
            if recipe and section_id and component_id
            else None
        )
        contracts.append(
            SemanticPresentationContract(
                wire_occurrence_id=field.occurrence_id,
                mapping_id=field.mapping_id,
                json_path=field.json_path,
                ordinal=field.ordinal,
                alias=field.alias,
                capability_id=field.capability_id,
                field_class=field_class,
                concept_id=concept_id,
                label_ko=public_label,
                description=public_description,
                unit_or_format=unit_or_format,
                display_metadata=field_display_metadata,
                time_basis=placement.time_basis if placement else None,
                recipe_id=recipe.recipe_id if recipe else None,
                section_id=section_id,
                component_id=component_id,
                visual_role=placement.visual_role if placement else None,
                placement_rule_id=placement.rule_id if placement else None,
                placement_basis=placement.basis if placement else None,
                semantic_basis=(
                    authority.semantic_basis
                    if authority is not None
                    else (
                        _canonical_semantic_basis(
                            public_label,
                            public_description,
                            unit_or_format,
                            placement.time_basis,
                            semantic_role,
                        )
                        if user_visible
                        and public_label
                        and public_description
                        and unit_or_format
                        and placement
                        and semantic_role
                        else None
                    )
                ),
                display_tier=display_tier,
                display_group=display_group,
                display_slot=display_slot,
                display_order=display_order,
                visibility_policy=visibility_policy,
                source_precedence=recipe.source_precedence if recipe else (),
                product_destination=product_destination,
            )
        )
    return SemanticPresentationRegistry(tuple(contracts))


@lru_cache(maxsize=1)
def get_semantic_presentation_registry() -> SemanticPresentationRegistry:
    return build_semantic_presentation_registry()


def get_public_operation_presentation(mapping_id: str) -> list[dict[str, Any]]:
    """Return user-safe semantic presentation metadata for one operation."""

    return get_semantic_presentation_registry().public_for_operation(mapping_id)


def get_semantic_presentation_release_gates() -> dict[str, Any]:
    """Expose explicit structural and unresolved-semantic release gates."""

    return get_semantic_presentation_registry().release_gates()


def get_public_recipe_sections(recipe_id: str) -> list[dict[str, Any]]:
    """Return ordered, product-safe section metadata for one recipe."""

    return get_semantic_presentation_registry().public_sections_for_recipe(recipe_id)
