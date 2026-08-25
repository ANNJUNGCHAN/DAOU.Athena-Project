"""SQLite 그래프 저장층 — 소스 단위 원자 교체, 티어 우선순위, 이벤트 로그, FTS5."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena_api.brain.ontology import (
    Confidence,
    Entity,
    EntityKind,
    GraphEventOp,
    Relation,
    RelationKind,
    SourceKind,
    SourceRecord,
    SourceTier,
    entity_id,
    relation_id,
)
from athena_api.brain.store import (
    INVESTOR_PROFILE_ENTITY_ID,
    SCHEMA_VERSION,
    GraphStore,
)

# 결정층(leaf 9): LLM도 난수도 타지 않는다. CI가 이 층만 따로 돌릴 수 있어야 한다.
pytestmark = pytest.mark.deterministic

NOW = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)

PROFILE = Entity(
    id=INVESTOR_PROFILE_ENTITY_ID,
    kind=EntityKind.INVESTOR_PROFILE,
    name="default",
    created_at=NOW,
    updated_at=NOW,
)


def entity(kind: EntityKind, name: str, **kwargs) -> Entity:
    return Entity(
        id=entity_id(kind, name), kind=kind, name=name, created_at=NOW, updated_at=NOW, **kwargs
    )


def source(
    source_id: str, kind: SourceKind = SourceKind.CONVERSATION, *, fp: str = "fp"
) -> SourceRecord:
    return SourceRecord(
        id=source_id,
        kind=kind,
        text="대화 본문",
        fingerprint=fp,
        occurred_at=NOW,
        ingested_at=NOW,
    )


def relation(
    kind: str,
    src: Entity,
    tgt: Entity,
    source_id: str,
    *,
    confidence: Confidence = Confidence.EXTRACTED,
    tier: SourceTier = SourceTier.CONVERSATIONAL,
    observed_at: datetime = NOW,
    rationale: str | None = None,
) -> Relation:
    return Relation(
        id=relation_id(kind, src.id, tgt.id),
        kind=kind,
        source_entity_id=src.id,
        target_entity_id=tgt.id,
        confidence=confidence,
        tier=tier,
        rationale=rationale,
        source_id=source_id,
        observed_at=observed_at,
        extracted_at=observed_at,
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


# ── 기본 ────────────────────────────────────────────────────────────────────


async def test_opens_with_current_schema_and_zero_revision(store: GraphStore) -> None:
    assert await store.schema_version() == SCHEMA_VERSION
    assert await store.graph_revision() == 0
    summary = await store.summary()
    assert (summary.entities, summary.relations, summary.events) == (0, 0, 0)


async def test_reopen_after_close_is_refused(store: GraphStore) -> None:
    await store.close()
    with pytest.raises(RuntimeError):
        await store.open()


async def test_apply_extraction_requires_matching_fingerprint(store: GraphStore) -> None:
    await store.upsert_source(source("s1", fp="fp-a"))
    with pytest.raises(ValueError):
        await store.apply_extraction("s1", "fp-b", (PROFILE,), ())


async def test_relation_endpoints_must_be_supplied_entities(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    with pytest.raises(ValueError):
        # 엔티티 목록에 samsung을 넣지 않았다.
        await store.apply_extraction(
            "s1", "fp", (PROFILE,), (relation("owns", PROFILE, samsung, "s1"),)
        )


# ── 소스 단위 원자 교체 ─────────────────────────────────────────────────────


async def test_reapplying_a_source_replaces_its_relations(store: GraphStore) -> None:
    """한 소스가 더 이상 주장하지 않는 엣지는 사라지고 EDGE_REMOVED가 남는다."""
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    hynix = entity(EntityKind.SECURITY, "SK하이닉스")

    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, samsung, hynix),
        (
            relation("interested_in", PROFILE, samsung, "s1"),
            relation("interested_in", PROFILE, hynix, "s1"),
        ),
    )
    assert (await store.summary()).relations == 2

    await store.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("interested_in", PROFILE, samsung, "s1"),)
    )
    assert (await store.summary()).relations == 1

    ops = [e.op for e in await store.events()]
    assert ops.count(GraphEventOp.EDGE_REMOVED) == 1


async def test_identical_reapply_records_no_event(store: GraphStore) -> None:
    """같은 내용을 두 번 적재해도 로그가 부풀지 않는다.

    `reinforcement`가 "재확인 횟수"라는 의미를 지키려면, 값이 그대로인 재적재는
    사건이 아니어야 한다.
    """
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    payload = (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)

    await store.apply_extraction("s1", "fp", *payload)
    first = len(await store.events())
    await store.apply_extraction("s1", "fp", *payload)
    assert len(await store.events()) == first


async def test_confidence_change_records_edge_changed(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    theme = entity(EntityKind.THEME, "2차전지")

    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, theme),
        (relation("avoids", PROFILE, theme, "s1", confidence=Confidence.AMBIGUOUS),),
    )
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, theme),
        (relation("avoids", PROFILE, theme, "s1", confidence=Confidence.EXTRACTED),),
    )

    changed = [e for e in await store.events() if e.op is GraphEventOp.EDGE_CHANGED]
    assert len(changed) == 1
    assert changed[0].confidence_before is Confidence.AMBIGUOUS
    assert changed[0].confidence_after is Confidence.EXTRACTED


# ── 티어 우선순위 (G4) ──────────────────────────────────────────────────────


async def _write_both_tiers(store: GraphStore, *, deterministic_first: bool) -> str:
    """체결(결정적)과 대화(대화적)가 같은 엣지를 주장하게 만든다."""
    await store.upsert_source(source("trade", SourceKind.TRADE, fp="fp-t"))
    await store.upsert_source(source("talk", SourceKind.CONVERSATION, fp="fp-c"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")

    fact = (
        "trade",
        "fp-t",
        (PROFILE, samsung),
        (
            relation(
                "owns",
                PROFILE,
                samsung,
                "trade",
                confidence=Confidence.EXTRACTED,
                tier=SourceTier.DETERMINISTIC,
            ),
        ),
    )
    talk = (
        "talk",
        "fp-c",
        (PROFILE, samsung),
        (
            relation(
                "owns",
                PROFILE,
                samsung,
                "talk",
                confidence=Confidence.INFERRED,
                tier=SourceTier.CONVERSATIONAL,
            ),
        ),
    )
    order = (fact, talk) if deterministic_first else (talk, fact)
    for args in order:
        await store.apply_extraction(*args)
    return relation_id("owns", PROFILE.id, samsung.id)


@pytest.mark.parametrize("deterministic_first", [True, False])
async def test_tier_precedence_is_independent_of_write_order(
    store: GraphStore, deterministic_first: bool
) -> None:
    """결정적 티어가 쓰기 순서와 무관하게 이긴다.

    두 순서를 모두 돌리지 않으면 이 게이트는 아무것도 증명하지 못한다 — 단순 덮어쓰기도
    "나중에 쓴 쪽이 이긴다"는 이유로 한쪽 순서에서는 통과해버리기 때문이다.
    """
    edge_id = await _write_both_tiers(store, deterministic_first=deterministic_first)

    edges = await store.neighborhood(PROFILE.id, depth=1)
    winner = next(e for e in edges if e.relation_id == edge_id)
    assert winner.tier == SourceTier.DETERMINISTIC.value
    assert winner.confidence == Confidence.EXTRACTED.value
    assert len(edges) == 1, "같은 (출발, 도착, 종류)는 한 행이어야 한다"


@pytest.mark.parametrize("deterministic_first", [True, False])
async def test_tier_precedence_keeps_both_claims_visible_in_the_log(
    store: GraphStore, deterministic_first: bool
) -> None:
    """대화의 주장이 그래프에서 밀려도 로그에는 남는다 — **두 순서 모두에서**.

    말과 행동이 어긋난다는 사실 자체가 제품의 신호이므로, 진 쪽을 흔적 없이 버리면
    안 된다. 한 순서만 보면 이 성질이 성립하는 것처럼 보이는 함정이 있었다: 대화가
    먼저면 EDGE_ADDED로 남지만, 체결이 먼저면 밀린 대화는 아무 기록도 남기지 않았다.
    `EDGE_REJECTED`가 그 비대칭을 닫는다.
    """
    await _write_both_tiers(store, deterministic_first=deterministic_first)
    events = await store.events()
    tiers_seen = {e.source_id for e in events if e.relation == "owns"}
    assert tiers_seen == {"talk", "trade"}


async def test_a_losing_conversational_claim_is_logged_as_rejected(store: GraphStore) -> None:
    """밀린 주장은 무엇이 무엇에게 밀렸는지까지 남긴다."""
    await _write_both_tiers(store, deterministic_first=True)
    rejected = [e for e in await store.events() if e.op is GraphEventOp.EDGE_REJECTED]
    assert len(rejected) == 1
    assert rejected[0].source_id == "talk"
    assert rejected[0].confidence_before is Confidence.EXTRACTED  # 이긴 쪽(체결)
    assert rejected[0].confidence_after is Confidence.INFERRED  # 밀린 쪽(대화)


async def test_nothing_is_rejected_when_the_conversation_writes_first(store: GraphStore) -> None:
    """대화가 먼저면 밀린 것이 없다 — 체결이 정상적으로 덮어쓴다."""
    await _write_both_tiers(store, deterministic_first=False)
    assert [e for e in await store.events() if e.op is GraphEventOp.EDGE_REJECTED] == []


# ── 이벤트 로그와 리비전 ────────────────────────────────────────────────────


async def test_revision_advances_on_every_write(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    before = await store.graph_revision()
    await store.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)
    )
    assert await store.graph_revision() == before + 1


async def test_new_entities_record_entity_added(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)
    )
    added = [e for e in await store.events() if e.op is GraphEventOp.ENTITY_ADDED]
    assert {e.subject_id for e in added} == {PROFILE.id, samsung.id}


async def test_reset_projection_keeps_sources_and_log(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)
    )
    before_events = len(await store.events())

    await store.reset_projection()
    summary = await store.summary()
    assert (summary.entities, summary.relations) == (0, 0)
    assert summary.sources == 1
    # 표식 이벤트는 로그에 남지만 읽기 API는 걸러낸다.
    assert len(await store.events()) == before_events


# ── 재기동 (G5) ─────────────────────────────────────────────────────────────


async def test_graph_survives_reopen_in_a_new_process(tmp_path: Path) -> None:
    """닫힌 뒤 새 인스턴스로 열어도 그래프·리비전·로그가 그대로다.

    `reset-and-restart`가 스스로 SIGTERM을 날리고 다음 부팅이 평범한 열기 경로를 타는
    것이 이 저장소의 정상 흐름이므로, 재기동 내구성은 부가 기능이 아니라 계약이다.
    """
    path = tmp_path / "brain.sqlite3"
    first = GraphStore(path)
    await first.open()
    await first.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자", aliases=("삼전", "005930"))
    await first.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)
    )
    revision = await first.graph_revision()
    events = len(await first.events())
    await first.close()

    second = GraphStore(path)
    await second.open()
    try:
        assert await second.schema_version() == SCHEMA_VERSION
        assert await second.graph_revision() == revision
        assert len(await second.events()) == events
        summary = await second.summary()
        assert (summary.entities, summary.relations) == (2, 1)
        assert [h.name for h in await second.search_entities("삼전")] == ["삼성전자"]
    finally:
        await second.close()


# ── FTS5 검색 ───────────────────────────────────────────────────────────────


async def test_search_matches_name_and_alias(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자", aliases=("삼전", "005930"))
    hynix = entity(EntityKind.SECURITY, "SK하이닉스")
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, samsung, hynix),
        (relation("owns", PROFILE, samsung, "s1"),),
    )

    assert [h.name for h in await store.search_entities("삼성전자")] == ["삼성전자"]
    assert [h.name for h in await store.search_entities("005930")] == ["삼성전자"]
    assert await store.search_entities("존재하지않는종목") == ()
    assert await store.search_entities("   ") == ()


async def test_search_treats_operator_words_as_literals(store: GraphStore) -> None:
    """FTS5 연산자가 섞인 입력이 구문 오류로 터지지 않는다."""
    await store.upsert_source(source("s1"))
    theme = entity(EntityKind.THEME, "반도체")
    await store.apply_extraction("s1", "fp", (PROFILE, theme), ())
    assert await store.search_entities('반도체 AND NEAR "*') is not None


async def test_alias_update_replaces_the_search_row(store: GraphStore) -> None:
    """별칭을 지우면 그 별칭으로는 더 이상 찾히지 않는다 (FTS 행이 갱신된다)."""
    await store.upsert_entity(entity(EntityKind.SECURITY, "삼성전자", aliases=("삼전",)))
    assert len(await store.search_entities("삼전")) == 1
    await store.upsert_entity(entity(EntityKind.SECURITY, "삼성전자"))
    assert await store.search_entities("삼전") == ()


# ── 프로필 요약 ─────────────────────────────────────────────────────────────


async def test_profile_summary_orders_by_reinforcement_and_carries_tier(
    store: GraphStore,
) -> None:
    """보강 횟수는 그래프가 아니라 이벤트 로그에서 나온다."""
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    theme = entity(EntityKind.THEME, "고배당주")

    # 삼성전자 엣지를 세 번 바꿔 이벤트를 쌓는다(추가 1 + 변경 2).
    for conf in (Confidence.AMBIGUOUS, Confidence.INFERRED, Confidence.EXTRACTED):
        await store.apply_extraction(
            "s1",
            "fp",
            (PROFILE, samsung, theme),
            (
                relation("owns", PROFILE, samsung, "s1", confidence=conf),
                relation(
                    "prefers", PROFILE, theme, "s1", rationale="현금흐름이 나와야 편하다"
                ),
            ),
        )

    entries = await store.investor_profile_summary(now=NOW, window_days=90)
    assert [e.entity_name for e in entries] == ["삼성전자", "고배당주"]
    assert entries[0].reinforcement == 3
    assert entries[1].reinforcement == 1
    assert entries[1].rationale == "현금흐름이 나와야 편하다"
    assert entries[0].tier == SourceTier.CONVERSATIONAL.value


async def test_profile_summary_excludes_relations_outside_the_window(
    store: GraphStore,
) -> None:
    await store.upsert_source(source("s1"))
    old_theme = entity(EntityKind.THEME, "2차전지")
    stale = NOW - timedelta(days=200)
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, old_theme),
        (relation("avoids", PROFILE, old_theme, "s1", observed_at=stale),),
    )
    assert await store.investor_profile_summary(now=NOW, window_days=90) == ()
    assert len(await store.investor_profile_summary(now=NOW, window_days=365)) == 1


async def test_profile_summary_rejects_non_positive_window(store: GraphStore) -> None:
    with pytest.raises(ValueError):
        await store.investor_profile_summary(now=NOW, window_days=0)


# ── 이웃 조회 ───────────────────────────────────────────────────────────────


async def test_neighborhood_walks_to_requested_depth(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    theme = entity(EntityKind.THEME, "반도체")
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, theme, samsung),
        (
            relation(RelationKind.INTERESTED_IN, PROFILE, theme, "s1"),
            relation(RelationKind.BELONGS_TO, samsung, theme, "s1"),
        ),
    )

    depth_one = await store.neighborhood(PROFILE.id, depth=1)
    assert {e.kind for e in depth_one} == {"interested_in"}

    depth_two = await store.neighborhood(PROFILE.id, depth=2)
    assert {e.kind for e in depth_two} == {"interested_in", "belongs_to"}
    assert {e.depth for e in depth_two} == {1, 2}
