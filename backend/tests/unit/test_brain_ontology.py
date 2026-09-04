"""온톨로지 계약 — Claim 폐기, confidence·티어 분리, 유도 id."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from athena_api.brain import ontology
from athena_api.brain.ontology import (
    Confidence,
    Entity,
    EntityKind,
    GraphEvent,
    GraphEventOp,
    Relation,
    RelationKind,
    SourceKind,
    SourceRecord,
    SourceTier,
    entity_id,
    normalize_identity,
    relation_id,
)

NOW = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)


# 결정층(leaf 9): LLM도 난수도 타지 않는다. CI가 이 층만 따로 돌릴 수 있어야 한다.
pytestmark = pytest.mark.deterministic

def make_entity(kind: EntityKind, name: str, **kwargs) -> Entity:
    return Entity(
        id=entity_id(kind, name),
        kind=kind,
        name=name,
        created_at=NOW,
        updated_at=NOW,
        **kwargs,
    )


def make_relation(kind: str, source: Entity, target: Entity, **kwargs) -> Relation:
    defaults: dict = {
        "confidence": Confidence.EXTRACTED,
        "tier": SourceTier.CONVERSATIONAL,
        "source_id": "source-1",
        "observed_at": NOW,
        "extracted_at": NOW,
    }
    defaults.update(kwargs)
    return Relation(
        id=relation_id(kind, source.id, target.id),
        kind=kind,
        source_entity_id=source.id,
        target_entity_id=target.id,
        **defaults,
    )


# ── Claim 폐기 ──────────────────────────────────────────────────────────────


def test_claim_is_gone_from_ontology() -> None:
    """`Claim`/`ClaimKind`가 온톨로지에서 완전히 사라졌다.

    "왜"는 이제 `Relation.rationale` 속성이다. 이 테스트가 부재를 주장하므로,
    같은 방식으로 조회했을 때 실제로 존재하는 이름은 찾아진다는 것을 함께 확인해
    조회 자체가 무력하지 않음을 보인다.
    """
    assert hasattr(ontology, "Relation"), "양성 대조 실패 — 조회 방식이 잘못됐다"
    assert not hasattr(ontology, "Claim")
    assert not hasattr(ontology, "ClaimKind")


def test_rationale_lives_on_the_relation() -> None:
    profile = make_entity(EntityKind.INVESTOR_PROFILE, "default")
    theme = make_entity(EntityKind.THEME, "고배당주")
    relation = make_relation(
        RelationKind.PREFERS,
        profile,
        theme,
        rationale="금리가 어디로 가든 현금흐름은 나와야 편하다",
    )
    assert relation.rationale == "금리가 어디로 가든 현금흐름은 나와야 편하다"


def test_blank_rationale_is_rejected() -> None:
    profile = make_entity(EntityKind.INVESTOR_PROFILE, "default")
    theme = make_entity(EntityKind.THEME, "고배당주")
    with pytest.raises(ValidationError):
        make_relation(RelationKind.PREFERS, profile, theme, rationale="   ")


# ── confidence와 티어는 별개 축 ──────────────────────────────────────────────


def test_confidence_is_a_three_step_enum() -> None:
    assert [c.value for c in Confidence] == ["EXTRACTED", "INFERRED", "AMBIGUOUS"]


def test_source_tier_is_separate_from_confidence() -> None:
    """대화에서 온 명시적 발화는 EXTRACTED이면서 CONVERSATIONAL일 수 있다.

    두 축이 한 필드였다면 표현할 수 없는 조합이고, 바로 이것이 축을 나눈 이유다.
    """
    profile = make_entity(EntityKind.INVESTOR_PROFILE, "default")
    security = make_entity(EntityKind.SECURITY, "삼성전자")
    spoken = make_relation(
        RelationKind.PREFERS,
        profile,
        security,
        confidence=Confidence.EXTRACTED,
        tier=SourceTier.CONVERSATIONAL,
    )
    assert spoken.confidence is Confidence.EXTRACTED
    assert spoken.tier is SourceTier.CONVERSATIONAL


def test_source_kind_drops_research_and_adds_holding() -> None:
    values = {k.value for k in SourceKind}
    assert "research" not in values
    assert "holding" in values
    # manual_edit(2026-09-03) — 사람이 그래프 화면에서 직접 고친 것. 추출 대상이
    # 아니다: 캘 텍스트가 없고 이미 결론만 들어 있다(ontology.py 주석).
    assert values == {"chat_message", "conversation", "trade", "holding", "manual_edit"}


# ── 유도 id ─────────────────────────────────────────────────────────────────


def test_entity_id_is_deterministic_and_normalized() -> None:
    assert entity_id(EntityKind.SECURITY, "삼성전자") == entity_id(
        EntityKind.SECURITY, " 삼성전자 "
    )
    assert entity_id(EntityKind.THEME, "High Yield") == entity_id(
        EntityKind.THEME, "high   yield"
    )
    assert entity_id(EntityKind.SECURITY, "삼성전자") != entity_id(EntityKind.COMPANY, "삼성전자")


def test_relation_id_ignores_provenance() -> None:
    """같은 쌍·같은 종류면 어느 소스가 주장했든 **같은 엣지**다.

    이것이 "엣지를 누적하지 않는다"는 결정의 구조적 근거다. 출처가 id에 섞이면
    체결이 만든 `owns`와 대화가 만든 `owns`가 두 행으로 갈라져, 티어 우선순위를
    적용할 대상 자체가 사라진다.
    """
    a, b = "entity:aaa", "entity:bbb"
    assert relation_id("owns", a, b) == relation_id("owns", a, b)
    assert relation_id("owns", a, b) != relation_id("owns", b, a)
    assert relation_id("owns", a, b) != relation_id("prefers", a, b)


def test_entity_rejects_id_that_is_not_derived() -> None:
    with pytest.raises(ValidationError):
        Entity(
            id="entity:hand-written",
            kind=EntityKind.SECURITY,
            name="삼성전자",
            created_at=NOW,
            updated_at=NOW,
        )


def test_relation_rejects_id_that_is_not_derived() -> None:
    profile = make_entity(EntityKind.INVESTOR_PROFILE, "default")
    security = make_entity(EntityKind.SECURITY, "삼성전자")
    with pytest.raises(ValidationError):
        Relation(
            id=relation_id("prefers", profile.id, security.id),
            kind="owns",  # id는 prefers로 유도됐는데 kind가 다르다
            source_entity_id=profile.id,
            target_entity_id=security.id,
            confidence=Confidence.EXTRACTED,
            tier=SourceTier.CONVERSATIONAL,
            source_id="source-1",
            observed_at=NOW,
            extracted_at=NOW,
        )


# ── 불변식 ──────────────────────────────────────────────────────────────────


def test_relation_endpoints_must_differ() -> None:
    security = make_entity(EntityKind.SECURITY, "삼성전자")
    with pytest.raises(ValidationError):
        make_relation(RelationKind.RELATES_TO, security, security)


def test_extracted_at_must_not_precede_observed_at() -> None:
    profile = make_entity(EntityKind.INVESTOR_PROFILE, "default")
    security = make_entity(EntityKind.SECURITY, "삼성전자")
    with pytest.raises(ValidationError):
        make_relation(
            RelationKind.OWNS, profile, security, extracted_at=NOW - timedelta(seconds=1)
        )


def test_naive_timestamps_are_rejected() -> None:
    with pytest.raises(ValidationError):
        Entity(
            id=entity_id(EntityKind.SECURITY, "삼성전자"),
            kind=EntityKind.SECURITY,
            name="삼성전자",
            created_at=datetime(2026, 8, 25, 3, 0),
            updated_at=NOW,
        )


def test_relation_kind_is_lenient_in_storage_but_still_shaped() -> None:
    """저장은 관용하되 형식은 강제한다.

    graphify의 `validate.py`가 `relation`을 값 검증 없이 통과시키는 것과 같은 선택이다 —
    프롬프트가 제시한 어휘를 벗어난 이름 하나 때문에 추출 결과를 통째로 잃지 않는다.
    다만 임의 문자열까지 받으면 나중에 정규화할 수 없으므로 모양은 지킨다.
    """
    profile = make_entity(EntityKind.INVESTOR_PROFILE, "default")
    theme = make_entity(EntityKind.THEME, "반도체")
    outside_vocabulary = make_relation("watches_closely", profile, theme)
    assert outside_vocabulary.kind == "watches_closely"
    assert "watches_closely" not in {k.value for k in RelationKind}

    with pytest.raises(ValidationError):
        make_relation("Watches Closely", profile, theme)


def test_entity_aliases_must_be_unique() -> None:
    with pytest.raises(ValidationError):
        make_entity(EntityKind.SECURITY, "삼성전자", aliases=("삼전", "삼전"))


def test_graph_event_requires_utc_and_positive_sequence() -> None:
    event = GraphEvent(
        seq=1,
        at=NOW,
        revision=1,
        op=GraphEventOp.EDGE_ADDED,
        subject_id="entity:aaa",
        object_id="entity:bbb",
        relation="owns",
        confidence_after=Confidence.EXTRACTED,
    )
    assert event.op is GraphEventOp.EDGE_ADDED
    with pytest.raises(ValidationError):
        GraphEvent(seq=0, at=NOW, revision=1, op=GraphEventOp.EDGE_ADDED, subject_id="e")


def test_source_record_round_trips() -> None:
    source = SourceRecord(
        id="source-1",
        kind=SourceKind.CONVERSATION,
        text="반도체 어때?",
        fingerprint="fp-1",
        occurred_at=NOW,
        ingested_at=NOW,
    )
    assert source.kind is SourceKind.CONVERSATION
    assert source.locator is None


def test_only_raw_chat_sources_use_the_larger_text_bound() -> None:
    raw_chat = SourceRecord(
        id="chat:long",
        kind=SourceKind.CHAT_MESSAGE,
        text="가" * 20_000,
        fingerprint="fp-long-chat",
        occurred_at=NOW,
        ingested_at=NOW,
    )
    assert len(raw_chat.text) == 20_000

    with pytest.raises(ValidationError, match="non-chat source text must not exceed 10000"):
        SourceRecord(
            id="conversation:long",
            kind=SourceKind.CONVERSATION,
            text="가" * 10_001,
            fingerprint="fp-long-conversation",
            occurred_at=NOW,
            ingested_at=NOW,
        )


def test_normalize_identity_folds_case_width_and_space() -> None:
    assert normalize_identity("  Samsung   Electronics ") == "samsung electronics"
    # NFKC — 전각이 반각으로 접힌다.
    assert normalize_identity("ＫＯＳＰＩ") == "kospi"
