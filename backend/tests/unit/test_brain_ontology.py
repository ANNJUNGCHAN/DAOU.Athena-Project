from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from athena_api.brain import (
    Claim,
    ClaimKind,
    Entity,
    EntityKind,
    Relation,
    RelationKind,
    SourceKind,
    SourceRecord,
)

NOW = datetime(2026, 8, 15, tzinfo=UTC)


def test_ontology_accepts_bounded_typed_records() -> None:
    entity = Entity(
        id="security:005930",
        kind=EntityKind.SECURITY,
        name="삼성전자",
        aliases=("005930",),
        attributes={"market": "KOSPI", "watch": True},
        created_at=NOW,
        updated_at=NOW,
    )
    source = SourceRecord(
        id="chat:42",
        kind=SourceKind.CHAT_MESSAGE,
        text="삼성전자의 반도체 회복을 조사해 줘",
        fingerprint="sha256:abc123",
        occurred_at=NOW,
        ingested_at=NOW,
    )
    claim = Claim(
        id="claim:42",
        kind=ClaimKind.OBSERVATION,
        text="사용자가 삼성전자의 반도체 회복에 관심을 보였다.",
        confidence=0.9,
        entity_ids=(entity.id,),
        source_ids=(source.id,),
        observed_at=NOW,
        extracted_at=NOW,
    )
    relation = Relation(
        id="relation:42",
        kind=RelationKind.INTERESTED_IN,
        source_entity_id="investor:local",
        target_entity_id=entity.id,
        confidence=0.8,
        source_ids=(source.id,),
        observed_at=NOW,
        extracted_at=NOW,
    )

    assert entity.kind is EntityKind.SECURITY
    assert source.kind is SourceKind.CHAT_MESSAGE
    assert claim.kind is ClaimKind.OBSERVATION
    assert relation.source_ids == ("chat:42",)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "bad id"),
        ("name", " "),
        ("confidence", 1.01),
        ("observed_at", datetime(2026, 8, 15)),
        ("observed_at", datetime(2026, 8, 15, tzinfo=timezone(timedelta(hours=1)))),
    ],
)
def test_claim_and_entity_validation_is_strict(field: str, value: object) -> None:
    if field in {"id", "name"}:
        payload = {
            "id": "entity:1",
            "kind": EntityKind.THEME,
            "name": "반도체",
            "created_at": NOW,
            "updated_at": NOW,
            field: value,
        }
        model = Entity
    else:
        payload = {
            "id": "claim:1",
            "kind": ClaimKind.INFERRED_PREFERENCE,
            "text": "성장주를 선호할 가능성이 있다.",
            "confidence": 0.5,
            "entity_ids": ("entity:1",),
            "source_ids": ("source:1",),
            "observed_at": NOW,
            "extracted_at": NOW,
            field: value,
        }
        model = Claim

    with pytest.raises(ValidationError):
        model.model_validate(payload)


def test_ontology_forbids_extra_fields_and_non_json_attributes() -> None:
    base = {
        "id": "entity:1",
        "kind": EntityKind.COMPANY,
        "name": "회사",
        "created_at": NOW,
        "updated_at": NOW,
    }
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        Entity.model_validate({**base, "unexpected": "value"})
    with pytest.raises(ValidationError, match="JSON-safe"):
        Entity.model_validate({**base, "attributes": {"bad": {1, 2}}})


def test_relation_rejects_self_link_and_reversed_timestamps() -> None:
    with pytest.raises(ValidationError, match="endpoints must differ"):
        Relation(
            id="relation:1",
            kind=RelationKind.RELATES_TO,
            source_entity_id="entity:1",
            target_entity_id="entity:1",
            confidence=0.5,
            observed_at=NOW,
            extracted_at=NOW,
        )
    with pytest.raises(ValidationError, match="must not precede"):
        Claim(
            id="claim:1",
            kind=ClaimKind.OBSERVATION,
            text="관찰",
            confidence=0.5,
            entity_ids=("entity:1",),
            source_ids=("source:1",),
            observed_at=NOW,
            extracted_at=NOW - timedelta(seconds=1),
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [("entity_ids", ()), ("source_ids", ()), ("entity_ids", ("entity:1", "entity:1"))],
)
def test_claim_requires_non_empty_unique_provenance(field: str, value: tuple[str, ...]) -> None:
    payload = {
        "id": "claim:traceable",
        "kind": ClaimKind.OBSERVATION,
        "text": "근거가 있는 관찰",
        "confidence": 0.8,
        "entity_ids": ("entity:1",),
        "source_ids": ("source:1",),
        "observed_at": NOW,
        "extracted_at": NOW,
        field: value,
    }
    with pytest.raises(ValidationError):
        Claim.model_validate(payload)
