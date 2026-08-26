"""Strict public contracts for the four LLM selector tools."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DiscoveryIntent(StrEnum):
    AUTO = "auto"
    QUERY = "query"
    ORDER = "order"
    WEBSOCKET = "websocket"


class ResponseMode(StrEnum):
    AUTO = "auto"
    COMPACT = "compact"
    FULL = "full"


class OperationKind(StrEnum):
    QUERY = "query"
    ORDER = "order"
    WEBSOCKET = "websocket"


class ReasonCode(StrEnum):
    EXACT_OPERATION_REF = "EXACT_OPERATION_REF"
    EXACT_TR_ID = "EXACT_TR_ID"
    TR_ID_TOKEN_MATCH = "TR_ID_TOKEN_MATCH"
    EXACT_GROUP_ID = "EXACT_GROUP_ID"
    TITLE_PHRASE_MATCH = "TITLE_PHRASE_MATCH"
    TITLE_TOKEN_MATCH = "TITLE_TOKEN_MATCH"
    PROJECTION_TITLE_MATCH = "PROJECTION_TITLE_MATCH"
    OVERVIEW_MATCH = "OVERVIEW_MATCH"
    DOMAIN_MATCH = "DOMAIN_MATCH"
    REQUEST_FIELD_MATCH = "REQUEST_FIELD_MATCH"
    RESPONSE_FIELD_MATCH = "RESPONSE_FIELD_MATCH"
    REALTIME_FIELD_MATCH = "REALTIME_FIELD_MATCH"
    SYNONYM_MATCH = "SYNONYM_MATCH"
    QUERY_COVERAGE = "QUERY_COVERAGE"
    TYPED_ELIGIBLE = "TYPED_ELIGIBLE"
    TYPED_MEASURE_MATCH = "TYPED_MEASURE_MATCH"
    TYPED_BINDING_MATCH = "TYPED_BINDING_MATCH"
    TYPED_DETAIL_MATCH = "TYPED_DETAIL_MATCH"
    TYPED_DOMINANCE = "TYPED_DOMINANCE"
    EQUIVALENCE_CANONICAL = "EQUIVALENCE_CANONICAL"
    UNIQUE_EXACT_PROFILE = "UNIQUE_EXACT_PROFILE"
    EXPLICIT_DETAIL_GROUP = "EXPLICIT_DETAIL_GROUP"
    BASE_DEFAULT = "BASE_DEFAULT"
    PURE_LIST_BASE_REQUIRED = "PURE_LIST_BASE_REQUIRED"
    EXPLICIT_FULL_RESPONSE = "EXPLICIT_FULL_RESPONSE"
    DISCOVERY_ONLY = "DISCOVERY_ONLY"
    DETAIL_GROUP_REQUIRED = "DETAIL_GROUP_REQUIRED"
    GUARDED_EXECUTION = "GUARDED_EXECUTION"
    WEBSOCKET_CONTROL_ONLY = "WEBSOCKET_CONTROL_ONLY"
    INTENT_REQUIRED = "INTENT_REQUIRED"
    AMBIGUOUS_MARGIN = "AMBIGUOUS_MARGIN"
    AMBIGUOUS = "AMBIGUOUS"
    NO_COMPATIBLE_PROFILE = "NO_COMPATIBLE_PROFILE"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    PREFERRED_STRUCTURED_ASSERTION = "PREFERRED_STRUCTURED_ASSERTION"


class SearchRequest(StrictModel):
    query: str = Field(min_length=2, max_length=500)
    intent: DiscoveryIntent = DiscoveryIntent.AUTO
    limit: int = Field(default=5, ge=1, le=10)


class ScoreContribution(StrictModel):
    reason_code: ReasonCode
    points: int
    matched_terms: list[str] = Field(default_factory=list, max_length=10)
    scope: str


class SearchHit(StrictModel):
    operation_ref: str
    kind: OperationKind
    domain: str
    name: str
    group_title: str | None = None
    score: int
    confidence: Literal["high", "medium", "low"] = Field(
        description=(
            "Shared typed-compatibility outcome, never a lexical-score band: high means "
            "one exact profile or exact identity is uniquely proved, medium means typed "
            "dominance or equivalence canonicalization selected it, and low means the "
            "policy abstains, rejects, suggests another intent, or this hit is only a "
            "diagnostic alternative. Resolve always repeats the same typed decision."
        )
    )
    contributions: list[ScoreContribution]
    generic_callable: bool
    discovery_only: bool
    suggested_detail_group: str | None = None
    suggested_operation_ref: str | None = None


class SearchResponse(StrictModel):
    catalog_version: str
    normalized_query: str
    results: list[SearchHit]
    # Set when the question asks for something this intent cannot see. Without it an
    # `auto` search for "실시간 체결" silently returns unrelated query operations.
    suggested_intent: DiscoveryIntent | None = None


class DescribeRequest(StrictModel):
    operation_ref: str
    intent: DiscoveryIntent = DiscoveryIntent.AUTO


class FieldContract(StrictModel):
    alias: str
    description: str | None = None
    required: bool
    json_schema: dict[str, Any]


class DetailGroupSummary(StrictModel):
    """One screen-sized projection of a base TR response.

    A detail projection costs exactly one upstream call - the same call the base
    operation makes - and then narrows the response to ``response_field_count``
    fields. After family selection, the selector may choose it from uniquely strong
    typed compatibility plus authoritative canonical evidence. Otherwise the caller
    supplies its ``group_id`` explicitly.
    """

    group_id: str
    operation_ref: str
    title_ko: str | None = None
    title_en: str | None = None
    layout: Literal["facts", "table"] | None = None
    ui_page_size: int | None = None
    response_field_count: int


class OperationDescription(StrictModel):
    catalog_version: str
    operation_ref: str
    kind: OperationKind
    domain: str
    name: str
    group_id: str | None = None
    group_title_ko: str | None = None
    group_title_en: str | None = None
    layout: Literal["facts", "table"] | None = None
    ui_page_size: int | None = None
    required_arguments: list[FieldContract]
    optional_arguments: list[FieldContract]
    response_fields: list[FieldContract]
    detail_groups: list[DetailGroupSummary] = Field(default_factory=list)
    generic_callable: bool
    execution_policy: Literal[
        "selector_query",
        "selector_detail",
        "selector_detail_required",
        "selector_guarded_order",
        "selector_websocket_control",
    ]
    policy_reasons: list[ReasonCode]


class ContinuationInput(StrictModel):
    cont_yn: Literal["N", "Y"] = "N"
    next_key: str | None = None


class ResolveRequest(StrictModel):
    question: str = Field(min_length=2, max_length=2000)
    intent: DiscoveryIntent = Field(
        default=DiscoveryIntent.AUTO,
        description=(
            "Which surface the question is allowed to land on. `auto` and `query` rank the "
            "read surface only, so no vague question can reach an order or a realtime "
            "subscription. `websocket` ranks the 23 streaming control frames; `order` ranks "
            "the 12 guarded orders. This is the same gate athena_search applies, restated "
            "here because resolve ranks the question a second time."
        ),
    )
    candidate_refs: list[str] = Field(
        default_factory=list,
        max_length=8,
        description=(
            "Validated soft hints from search. They never restrict or reorder the canonical "
            "intent surface; unknown, hidden, or wrong-intent identities fail closed."
        ),
    )
    preferred_ref: str | None = Field(
        default=None,
        description=(
            "Assertion that canonical selection belongs to this family. A detail identity "
            "also implies its group; it never overrides canonical family selection."
        ),
    )
    detail_group: str | None = Field(
        default=None,
        max_length=64,
        description=(
            "Optional detail projection assertion for the canonical family, taken from "
            "describe or the top search hit's suggestion. Omit it to accept a uniquely "
            "supported typed and canonically named family-local detail; ambiguous local "
            "evidence returns DETAIL_GROUP_REQUIRED."
        ),
    )
    arguments: dict[str, Any] = Field(default_factory=dict)
    response_mode: ResponseMode = ResponseMode.AUTO
    continuation: ContinuationInput = Field(default_factory=ContinuationInput)


class ResolveResponse(StrictModel):
    status: Literal["resolved"] = "resolved"
    catalog_version: str
    operation_ref: str
    kind: OperationKind = Field(
        description=(
            "Selected operation's kind. The gateway's auto-execute dual dispatch "
            "(W2b) reads this to restrict itself to `query` — order/websocket plans "
            "always come back as a plan_token only, unexecuted."
        )
    )
    plan_token: str = Field(
        description=(
            "Opaque signed plan. Single-use: athena_call accepts it exactly once, "
            "including on a failed attempt. Resolve again for another plan_token."
        )
    )
    expires_at: datetime
    selection_reasons: list[ReasonCode]
    required_arguments_satisfied: bool
    response_mode: ResponseMode


class CallRequest(StrictModel):
    plan_token: str = Field(
        min_length=1,
        description=(
            "Single-use signed plan from athena_resolve. Consumed by this call whether "
            "or not it then succeeds upstream; a repeat with the same token is rejected "
            "with PLAN_ALREADY_USED. Resolve again for a new plan_token."
        ),
    )


class ContinuationOutput(StrictModel):
    cont_yn: Literal["N", "Y"]
    next_key: str | None = None
    next_plan_token: str | None = None


class CanvasContext(StrictModel):
    """서명된 plan에서 파생한 비민감 캔버스 식별자만 담는 작은 봉투."""

    symbol: str | None = Field(default=None, min_length=1, max_length=32)


class CallResponse(StrictModel):
    operation_ref: str
    data: dict[str, Any]
    continuation: ContinuationOutput
    canvas_context: CanvasContext = Field(default_factory=CanvasContext)
