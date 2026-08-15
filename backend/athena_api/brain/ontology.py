"""Strict, bounded contracts for the investment-brain graph projection."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

GraphId = Annotated[
    str,
    StringConstraints(
        strict=True, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$"
    ),
]
ShortText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=256)]
LongText = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=10_000)]
Confidence = Annotated[float, Field(strict=True, ge=0.0, le=1.0)]
ProvenanceIds = Annotated[tuple[GraphId, ...], Field(min_length=1, max_length=256)]


class EntityKind(StrEnum):
    INVESTOR_PROFILE = "investor_profile"
    SECURITY = "security"
    COMPANY = "company"
    SECTOR = "sector"
    THEME = "theme"
    GOAL = "goal"
    PREFERENCE = "preference"
    RISK_SIGNAL = "risk_signal"


class RelationKind(StrEnum):
    RELATES_TO = "relates_to"
    INTERESTED_IN = "interested_in"
    PREFERS = "prefers"
    OWNS = "owns"
    TRADED = "traded"
    RESEARCHED = "researched"
    BELONGS_TO = "belongs_to"
    EXPOSED_TO = "exposed_to"
    AVOIDS = "avoids"
    TARGETS = "targets"


class SourceKind(StrEnum):
    CHAT_MESSAGE = "chat_message"
    CONVERSATION = "conversation"
    TRADE = "trade"
    RESEARCH = "research"


class ClaimKind(StrEnum):
    OBSERVATION = "observation"
    INFERRED_PREFERENCE = "inferred_preference"


class StrictGraphModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    @field_validator("attributes", check_fields=False)
    @classmethod
    def validate_json_safe_attributes(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(value, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError("attributes must contain only JSON-safe values") from exc
        return value

    @field_validator("text", check_fields=False)
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value

    @field_validator(
        "created_at",
        "updated_at",
        "occurred_at",
        "ingested_at",
        "observed_at",
        "extracted_at",
        check_fields=False,
    )
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("timestamp must be UTC-aware")
        return value


class Entity(StrictGraphModel):
    id: GraphId
    kind: EntityKind
    name: ShortText
    aliases: tuple[ShortText, ...] = ()
    attributes: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    @field_validator("name", "aliases")
    @classmethod
    def reject_blank_name(cls, value: Any) -> Any:
        values = value if isinstance(value, tuple) else (value,)
        if any(not item.strip() for item in values):
            raise ValueError("text must not be blank")
        return value

    @model_validator(mode="after")
    def validate_time_order(self) -> Self:
        if self.updated_at < self.created_at:
            raise ValueError("updated_at must not precede created_at")
        return self


class SourceRecord(StrictGraphModel):
    id: GraphId
    kind: SourceKind
    text: LongText
    locator: ShortText | None = None
    fingerprint: GraphId
    attributes: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime
    ingested_at: datetime


class Claim(StrictGraphModel):
    id: GraphId
    kind: ClaimKind
    text: LongText
    confidence: Confidence
    entity_ids: ProvenanceIds
    source_ids: ProvenanceIds
    attributes: dict[str, Any] = Field(default_factory=dict)
    observed_at: datetime
    extracted_at: datetime

    @model_validator(mode="after")
    def validate_time_order(self) -> Self:
        if self.extracted_at < self.observed_at:
            raise ValueError("extracted_at must not precede observed_at")
        if len(set(self.entity_ids)) != len(self.entity_ids):
            raise ValueError("entity_ids must be unique")
        if len(set(self.source_ids)) != len(self.source_ids):
            raise ValueError("source_ids must be unique")
        return self


class Relation(StrictGraphModel):
    id: GraphId
    kind: RelationKind
    source_entity_id: GraphId
    target_entity_id: GraphId
    confidence: Confidence
    source_ids: tuple[GraphId, ...] = ()
    attributes: dict[str, Any] = Field(default_factory=dict)
    observed_at: datetime
    extracted_at: datetime

    @model_validator(mode="after")
    def validate_relation(self) -> Self:
        if self.source_entity_id == self.target_entity_id:
            raise ValueError("relation endpoints must differ")
        if self.extracted_at < self.observed_at:
            raise ValueError("extracted_at must not precede observed_at")
        return self
