"""`GraphStore.investor_profile_summary` — 창·정렬·상한·인자 검증.

leaf 4 재작성(2026-08-25). 이전 판은 `Claim`과 LadybugDB 위에 서 있었고, **관계 종류
허용목록**(PREFERS/AVOIDS/INTERESTED_IN)을 계약으로 못박고 있었다. 재설계가 그 허용목록을
없앴다. 의도적이다:

- 프로필은 "무엇을 말했나"가 아니라 "이 사람이 무엇과 어떻게 엮여 있나"를 답한다.
  체결에서 온 `traded`는 성향의 **가장 강한** 신호인데 허용목록이 그걸 잘라내고 있었다.
- 말과 행동을 대조하는 것이 이 제품의 요점이고, 그 대조는 둘이 같은 표에 있어야 가능하다.
  구분은 잘라내기가 아니라 `tier` 축이 한다.

leaf 1의 `test_brain_graph_store.py`가 보강 순 정렬과 창 밖 제외를 이미 잰다. 여기서는
그쪽이 다루지 않는 것만 본다 — 정렬 동점 처리, 상한, 인자 검증, 그리고 두 티어가 한
프로필에 함께 보이는가.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena_api.brain import (
    INVESTOR_PROFILE_ENTITY_ID,
    INVESTOR_PROFILE_NAME,
    Confidence,
    Entity,
    EntityKind,
    GraphStore,
    Relation,
    RelationKind,
    SourceKind,
    SourceRecord,
    SourceTier,
    entity_id,
    relation_id,
)

# 결정층(leaf 9): LLM도 난수도 타지 않는다. CI가 이 층만 따로 돌릴 수 있어야 한다.
pytestmark = pytest.mark.deterministic

NOW = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)

PROFILE = Entity(
    id=INVESTOR_PROFILE_ENTITY_ID,
    kind=EntityKind.INVESTOR_PROFILE,
    name=INVESTOR_PROFILE_NAME,
    created_at=NOW,
    updated_at=NOW,
)


def entity(kind: EntityKind, name: str) -> Entity:
    return Entity(id=entity_id(kind, name), kind=kind, name=name, created_at=NOW, updated_at=NOW)


def source(source_id: str, *, kind: SourceKind = SourceKind.CONVERSATION) -> SourceRecord:
    return SourceRecord(
        id=source_id,
        kind=kind,
        text="원본 본문",
        fingerprint=f"fp-{source_id}",
        occurred_at=NOW,
        ingested_at=NOW,
    )


def relation(
    kind: str,
    target: Entity,
    source_id: str,
    *,
    tier: SourceTier = SourceTier.CONVERSATIONAL,
    confidence: Confidence = Confidence.EXTRACTED,
    observed_at: datetime = NOW,
) -> Relation:
    return Relation(
        id=relation_id(kind, PROFILE.id, target.id),
        kind=kind,
        source_entity_id=PROFILE.id,
        target_entity_id=target.id,
        confidence=confidence,
        tier=tier,
        source_id=source_id,
        observed_at=observed_at,
        extracted_at=NOW,
    )


@pytest.fixture
async def store(tmp_path: Path):
    graph = GraphStore(tmp_path / "brain.sqlite3")
    await graph.open()
    try:
        yield graph
    finally:
        if graph.is_open:
            await graph.close()


# ── 허용목록이 없다는 것이 계약이다 ────────────────────────────────────────


async def test_every_out_edge_kind_appears_not_just_an_allowlist(store: GraphStore) -> None:
    """`traded`·`owns`처럼 예전 허용목록 밖이던 종류도 프로필에 보인다.

    잘라내면 "말로는 배당주가 좋다면서 실제로는 성장주만 샀다"를 한 화면에서 볼 수 없다.
    """
    await store.upsert_source(source("talk"))
    theme = entity(EntityKind.THEME, "고배당주")
    growth = entity(EntityKind.SECURITY, "성장주식회사")
    await store.apply_extraction(
        "talk",
        "fp-talk",
        (PROFILE, theme, growth),
        (
            relation(RelationKind.PREFERS, theme, "talk"),
            relation(RelationKind.TRADED, growth, "talk"),
        ),
    )

    entries = await store.investor_profile_summary(now=NOW, window_days=90)
    assert {entry.relation_kind for entry in entries} == {"prefers", "traded"}


async def test_both_tiers_share_one_profile_and_stay_distinguishable(store: GraphStore) -> None:
    """대화와 체결이 한 표에 있고, 어느 쪽에서 왔는지는 `tier`가 답한다."""
    await store.upsert_source(source("talk"))
    await store.upsert_source(source("trade", kind=SourceKind.TRADE))
    theme = entity(EntityKind.THEME, "고배당주")
    samsung = entity(EntityKind.SECURITY, "삼성전자")

    await store.apply_extraction(
        "talk", "fp-talk", (PROFILE, theme), (relation(RelationKind.PREFERS, theme, "talk"),)
    )
    await store.apply_extraction(
        "trade",
        "fp-trade",
        (PROFILE, samsung),
        (relation(RelationKind.TRADED, samsung, "trade", tier=SourceTier.DETERMINISTIC),),
    )

    by_name = {entry.entity_name: entry for entry in await store.investor_profile_summary(now=NOW)}
    assert by_name["고배당주"].tier == SourceTier.CONVERSATIONAL.value
    assert by_name["삼성전자"].tier == SourceTier.DETERMINISTIC.value


# ── 정렬 ────────────────────────────────────────────────────────────────────


async def test_ties_on_reinforcement_break_by_recency_then_name(store: GraphStore) -> None:
    """보강 횟수가 같으면 최근 관측이 먼저, 그마저 같으면 이름 오름차순.

    동점을 남겨두면 SQLite가 돌려주는 순서가 그날그날 달라지고, 그 화면을 보는 사람은
    이유 없이 순서가 바뀌는 목록을 보게 된다.
    """
    await store.upsert_source(source("s1"))
    older = entity(EntityKind.THEME, "가나다")
    newer = entity(EntityKind.THEME, "하마단")
    same_a = entity(EntityKind.THEME, "AAA")
    same_b = entity(EntityKind.THEME, "BBB")
    await store.apply_extraction(
        "s1",
        "fp-s1",
        (PROFILE, older, newer, same_a, same_b),
        (
            relation("prefers", older, "s1", observed_at=NOW - timedelta(days=10)),
            relation("prefers", newer, "s1", observed_at=NOW - timedelta(days=1)),
            relation("prefers", same_a, "s1", observed_at=NOW - timedelta(days=5)),
            relation("prefers", same_b, "s1", observed_at=NOW - timedelta(days=5)),
        ),
    )

    names = [entry.entity_name for entry in await store.investor_profile_summary(now=NOW)]
    # 보강은 넷 다 1이므로 관측 시각 내림차순이 먼저 적용된다.
    assert names.index("하마단") < names.index("AAA")
    assert names.index("AAA") < names.index("가나다")
    # 같은 시각인 둘은 이름 오름차순.
    assert names.index("AAA") < names.index("BBB")


async def test_ordering_is_stable_across_repeated_reads(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    targets = tuple(entity(EntityKind.THEME, f"테마{i}") for i in range(6))
    await store.apply_extraction(
        "s1",
        "fp-s1",
        (PROFILE, *targets),
        tuple(relation("prefers", t, "s1") for t in targets),
    )
    first = [e.entity_id for e in await store.investor_profile_summary(now=NOW)]
    for _ in range(3):
        assert [e.entity_id for e in await store.investor_profile_summary(now=NOW)] == first


# ── 상한 ────────────────────────────────────────────────────────────────────


async def test_limit_truncates_and_is_capped_at_the_store_maximum(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    targets = tuple(entity(EntityKind.THEME, f"테마{i}") for i in range(5))
    await store.apply_extraction(
        "s1",
        "fp-s1",
        (PROFILE, *targets),
        tuple(relation("prefers", t, "s1") for t in targets),
    )

    assert len(await store.investor_profile_summary(now=NOW, limit=2)) == 2
    # 상한을 넘겨도 터지지 않고 저장층 최대치로 잘린다 — 여기서는 있는 만큼 전부.
    assert len(await store.investor_profile_summary(now=NOW, limit=10_000)) == 5


# ── 인자 검증: 조용히 틀리느니 터진다 ──────────────────────────────────────


async def test_naive_now_is_refused_instead_of_silently_shifting_the_window(
    store: GraphStore,
) -> None:
    """naive를 `astimezone(UTC)`에 넘기면 파이썬이 로컬 시간대로 가정한다.

    KST에서는 창이 9시간 밀려 경계의 관계가 이유 없이 들어오거나 빠진다. 터지지 않기
    때문에 아무도 눈치채지 못하는 종류의 실패다.
    """
    with pytest.raises(ValueError, match="UTC-aware"):
        await store.investor_profile_summary(now=datetime(2026, 8, 25, 3, 0))


@pytest.mark.parametrize("window_days", [0, -1])
async def test_non_positive_window_is_refused(store: GraphStore, window_days: int) -> None:
    with pytest.raises(ValueError, match="window_days"):
        await store.investor_profile_summary(now=NOW, window_days=window_days)


@pytest.mark.parametrize("limit", [0, -3])
async def test_non_positive_limit_is_refused(store: GraphStore, limit: int) -> None:
    """0을 1로 조용히 접으면 호출자는 "한 건뿐"이라는 잘못된 답을 받는다."""
    with pytest.raises(ValueError, match="limit"):
        await store.investor_profile_summary(now=NOW, limit=limit)


async def test_empty_graph_returns_empty_not_an_error(store: GraphStore) -> None:
    assert await store.investor_profile_summary(now=NOW) == ()
