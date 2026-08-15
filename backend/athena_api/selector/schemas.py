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
    EXACT_GROUP_ID = "EXACT_GROUP_ID"
    TITLE_PHRASE_MATCH = "TITLE_PHRASE_MATCH"
    TITLE_TOKEN_MATCH = "TITLE_TOKEN_MATCH"
    DOMAIN_MATCH = "DOMAIN_MATCH"
    REQUEST_FIELD_MATCH = "REQUEST_FIELD_MATCH"
    RESPONSE_FIELD_MATCH = "RESPONSE_FIELD_MATCH"
    SYNONYM_MATCH = "SYNONYM_MATCH"
    SINGLE_GROUP_PREFERRED = "SINGLE_GROUP_PREFERRED"
    MULTI_GROUP_BASE_REQUIRED = "MULTI_GROUP_BASE_REQUIRED"
    PURE_LIST_BASE_REQUIRED = "PURE_LIST_BASE_REQUIRED"
    EXPLICIT_FULL_RESPONSE = "EXPLICIT_FULL_RESPONSE"
    DISCOVERY_ONLY = "DISCOVERY_ONLY"
    AMBIGUOUS_MARGIN = "AMBIGUOUS_MARGIN"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"


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
    confidence: Literal["high", "medium", "low"]
    contributions: list[ScoreContribution]
    generic_callable: bool
    discovery_only: bool


class SearchResponse(StrictModel):
    catalog_version: str
    normalized_query: str
    results: list[SearchHit]


class DescribeRequest(StrictModel):
    operation_ref: str
    intent: DiscoveryIntent = DiscoveryIntent.AUTO


class FieldContract(StrictModel):
    alias: str
    description: str | None = None
    required: bool
    json_schema: dict[str, Any]


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
    generic_callable: bool
    execution_policy: Literal[
        "selector_query",
        "selector_detail",
        "direct_guarded_order_only",
        "direct_websocket_control_only",
    ]
    policy_reasons: list[ReasonCode]


class ContinuationInput(StrictModel):
    cont_yn: Literal["N", "Y"] = "N"
    next_key: str | None = None


class ResolveRequest(StrictModel):
    question: str = Field(min_length=2, max_length=2000)
    candidate_refs: list[str] = Field(default_factory=list, max_length=8)
    preferred_ref: str | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)
    response_mode: ResponseMode = ResponseMode.AUTO
    continuation: ContinuationInput = Field(default_factory=ContinuationInput)


class ResolveResponse(StrictModel):
    status: Literal["resolved"] = "resolved"
    catalog_version: str
    operation_ref: str
    plan_token: str
    expires_at: datetime
    selection_reasons: list[ReasonCode]
    required_arguments_satisfied: bool
    response_mode: ResponseMode


class CallRequest(StrictModel):
    plan_token: str = Field(min_length=1)


class ContinuationOutput(StrictModel):
    cont_yn: Literal["N", "Y"]
    next_key: str | None = None
    next_plan_token: str | None = None


class CallResponse(StrictModel):
    operation_ref: str
    data: dict[str, Any]
    continuation: ContinuationOutput
