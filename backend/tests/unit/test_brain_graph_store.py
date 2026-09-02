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


# ── 엔티티 타임라인(WP-C) ────────────────────────────────────────────────────


async def test_entity_events_include_events_where_the_entity_is_the_subject(
    store: GraphStore,
) -> None:
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)
    )
    found = await store.entity_events(PROFILE.id)
    assert any(e.subject_id == PROFILE.id for e in found)


async def test_entity_events_include_events_where_the_entity_is_the_object(
    store: GraphStore,
) -> None:
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)
    )
    found = await store.entity_events(samsung.id)
    assert any(e.object_id == samsung.id for e in found), "target으로만 등장해도 잡혀야 한다"


async def test_entity_events_exclude_the_projection_marker(store: GraphStore) -> None:
    """`events()`와 같은 계약 — 재투영 표식은 어떤 엔티티 조회에도 안 새어 나온다."""
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, samsung), (relation("owns", PROFILE, samsung, "s1"),)
    )
    await store.reset_projection()
    # 표식 이벤트의 subject_id 문자열 자체를 entity_id로 넣어도(최악의 경우) 안 나온다.
    assert await store.entity_events("projection") == ()


async def test_entity_events_apply_the_limit_ceiling(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    themes = tuple(entity(EntityKind.THEME, f"테마{i}") for i in range(5))
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, *themes),
        tuple(relation("interested_in", PROFILE, theme, "s1") for theme in themes),
    )
    found = await store.entity_events(PROFILE.id, limit=2)
    assert len(found) == 2


async def test_entity_events_are_ordered_newest_first(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    first_theme = entity(EntityKind.THEME, "먼저")
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, first_theme),
        (relation("interested_in", PROFILE, first_theme, "s1"),),
    )
    await store.upsert_source(source("s2"))
    second_theme = entity(EntityKind.THEME, "나중")
    await store.apply_extraction(
        "s2",
        "fp",
        (PROFILE, second_theme),
        (relation("interested_in", PROFILE, second_theme, "s2"),),
    )
    found = await store.entity_events(PROFILE.id)
    seqs = [e.seq for e in found]
    assert seqs == sorted(seqs, reverse=True), "최신(seq가 큰 것)이 먼저 나와야 한다"


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


# ── 군집 LLM 라벨 캐시(WP-F F2) ──────────────────────────────────────────────


async def test_cluster_label_round_trip_and_fingerprint_mismatch(store: GraphStore) -> None:
    assert await store.cluster_label("h1", "fp-a") is None
    await store.save_cluster_label(
        "h1", cluster_size=3, label="반도체 밸류체인", prompt_fingerprint="fp-a"
    )
    assert await store.cluster_label("h1", "fp-a") == "반도체 밸류체인"
    # 프롬프트 지문이 다르면 미스 — 옛 라벨을 조용히 쓰면 틀린 것을 캐시하는 셈이다.
    assert await store.cluster_label("h1", "fp-b") is None


async def test_cluster_label_replace_wins_without_error(store: GraphStore) -> None:
    # 같은 member_hash에 두 백그라운드 태스크가 연속 완료하는 경쟁(F4) — 예외 없이
    # 마지막 쓰기가 이긴다(INSERT OR REPLACE).
    await store.save_cluster_label("h1", cluster_size=3, label="첫 라벨", prompt_fingerprint="fp")
    await store.save_cluster_label("h1", cluster_size=3, label="마지막 라벨", prompt_fingerprint="fp")
    assert await store.cluster_label("h1", "fp") == "마지막 라벨"


async def test_cluster_labels_table_survives_reopen(tmp_path: Path) -> None:
    first = GraphStore(tmp_path / "brain.sqlite3")
    await first.open()
    await first.save_cluster_label("h", cluster_size=2, label="라벨", prompt_fingerprint="fp")
    await first.close()
    second = GraphStore(tmp_path / "brain.sqlite3")
    await second.open()  # 스키마 멱등 재실행 — SCHEMA_VERSION 불변(계획 확인)
    try:
        assert await second.cluster_label("h", "fp") == "라벨"
    finally:
        await second.close()


# ── 노드 상세(2026-09-03, 채팅의 "이 노드 설명해줘") ────────────────────────────
#
# 이 읽기가 답해야 하는 것은 "지금 어떤 상태인가"가 아니라 **"왜 이렇게 기록됐나"**다.
# 그래서 관계·이력만으로는 부족하고 출처 원문까지 같은 응답에 있어야 한다.


def long_source(source_id: str, text: str, *, fp: str = "fp") -> SourceRecord:
    return SourceRecord(
        id=source_id,
        kind=SourceKind.CHAT_MESSAGE,
        text=text,
        locator="conv-1#3",
        fingerprint=fp,
        occurred_at=NOW,
        ingested_at=NOW,
    )


async def test_entity_detail_returns_none_for_an_unknown_node(store: GraphStore) -> None:
    # 빈 상세를 주면 "연결이 없는 노드"와 "그런 노드가 없다"가 구별되지 않는다.
    assert await store.entity_detail("entity:security:없는것") is None


async def test_entity_detail_carries_both_directions_with_the_other_endpoint_named(
    store: GraphStore,
) -> None:
    """방향을 잃으면 모델이 "삼성전자가 나에게 관심이 있다"처럼 말한다."""
    await store.upsert_source(source("s1"))
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    theme = entity(EntityKind.THEME, "반도체 대형주")
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, samsung, theme),
        (
            relation("interested_in", PROFILE, samsung, "s1"),
            relation("belongs_to", samsung, theme, "s1"),
        ),
    )

    detail = await store.entity_detail(samsung.id)
    assert detail is not None
    assert detail.entity.name == "삼성전자"
    assert detail.entity.degree == 2

    by_kind = {r.relation_kind: r for r in detail.relations}
    assert by_kind["interested_in"].direction == "in"
    assert by_kind["interested_in"].other_entity_name == "default"
    assert by_kind["belongs_to"].direction == "out"
    assert by_kind["belongs_to"].other_entity_name == "반도체 대형주"
    assert by_kind["belongs_to"].other_entity_kind == EntityKind.THEME.value


async def test_entity_detail_carries_the_source_text_that_produced_the_relation(
    store: GraphStore,
) -> None:
    await store.upsert_source(long_source("s1", "HBM 장비주가 궁금해서 한미반도체를 봤어"))
    hanmi = entity(EntityKind.SECURITY, "한미반도체")
    await store.apply_extraction(
        "s1",
        "fp",
        (PROFILE, hanmi),
        (relation("interested_in", PROFILE, hanmi, "s1", rationale="HBM 장비 질문 반복"),),
    )

    detail = await store.entity_detail(hanmi.id)
    assert detail is not None
    (edge,) = detail.relations
    assert edge.rationale == "HBM 장비 질문 반복"
    assert edge.source is not None
    assert edge.source.text == "HBM 장비주가 궁금해서 한미반도체를 봤어"
    assert edge.source.kind == SourceKind.CHAT_MESSAGE.value
    assert edge.source.locator == "conv-1#3"
    assert edge.source.truncated is False
    assert edge.source.full_chars == len("HBM 장비주가 궁금해서 한미반도체를 봤어")


async def test_entity_detail_marks_a_clipped_excerpt_as_clipped(store: GraphStore) -> None:
    """잘린 발췌를 전문처럼 인용하면 "원문에 그렇게 적혀 있다"가 거짓이 된다."""
    body = "가" * 900
    await store.upsert_source(long_source("s1", body))
    kospi = entity(EntityKind.THEME, "코스피")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, kospi), (relation("interested_in", PROFILE, kospi, "s1"),)
    )

    detail = await store.entity_detail(kospi.id, excerpt_chars=100)
    assert detail is not None
    (edge,) = detail.relations
    assert edge.source is not None
    assert edge.source.text == "가" * 100
    assert edge.source.truncated is True
    assert edge.source.full_chars == 900


async def test_entity_detail_counts_reinforcement_over_all_time(store: GraphStore) -> None:
    """창을 걸지 않는다 — 같은 응답의 이력이 전 기간이라 횟수도 전 기간이어야 한다."""
    theme = entity(EntityKind.THEME, "배당")
    for index, (source_id, confidence) in enumerate(
        (("s1", Confidence.AMBIGUOUS), ("s2", Confidence.EXTRACTED)), start=1
    ):
        await store.upsert_source(source(source_id, fp=f"fp{index}"))
        await store.apply_extraction(
            source_id,
            f"fp{index}",
            (PROFILE, theme),
            (
                relation(
                    "interested_in",
                    PROFILE,
                    theme,
                    source_id,
                    confidence=confidence,
                    observed_at=NOW + timedelta(days=index),
                ),
            ),
        )

    detail = await store.entity_detail(theme.id)
    assert detail is not None
    (edge,) = detail.relations
    # EDGE_ADDED 한 번 + EDGE_CHANGED 한 번 = 두 번 확인됐다.
    assert edge.reinforcement == 2
    assert edge.confidence == Confidence.EXTRACTED.value


async def test_entity_detail_timeline_is_newest_first(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    theme = entity(EntityKind.THEME, "고배당")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, theme), (relation("interested_in", PROFILE, theme, "s1"),)
    )

    detail = await store.entity_detail(theme.id)
    assert detail is not None
    assert [event.op for event in detail.events] == [
        GraphEventOp.EDGE_ADDED.value,
        GraphEventOp.ENTITY_ADDED.value,
    ]
    assert detail.events[0].seq > detail.events[1].seq


async def test_entity_detail_timeline_excludes_the_projection_marker(
    store: GraphStore,
) -> None:
    """`entity_events()`와 같은 계약 — 재투영 표식은 어떤 노드의 이력에도 안 새어 나온다.

    재투영은 엔티티를 지우므로 다시 적재해 노드를 되살린 뒤 본다. 그 사이 로그에는
    표식 이벤트가 남아 있다(`test_reset_projection_keeps_sources_and_log`).
    """
    await store.upsert_source(source("s1"))
    theme = entity(EntityKind.THEME, "고배당")
    payload = (PROFILE, theme), (relation("interested_in", PROFILE, theme, "s1"),)
    await store.apply_extraction("s1", "fp", *payload)
    await store.reset_projection()
    await store.apply_extraction("s1", "fp", *payload)

    detail = await store.entity_detail(theme.id)
    assert detail is not None
    assert detail.events, "재적재로 노드가 되살아났으니 이력이 있어야 한다"
    assert all(event.subject_id != "projection" for event in detail.events)
    # 표식 문자열 자체를 노드로 넣어도 없는 노드다 — 엔티티가 아니라 표식이므로.
    assert await store.entity_detail("projection") is None


async def test_entity_detail_bounds_are_clamped_not_trusted(store: GraphStore) -> None:
    await store.upsert_source(source("s1"))
    theme = entity(EntityKind.THEME, "리츠")
    await store.apply_extraction(
        "s1", "fp", (PROFILE, theme), (relation("interested_in", PROFILE, theme, "s1"),)
    )

    # 0·음수·거대값을 그대로 SQL LIMIT에 넣으면 빈 답이나 전체 덤프가 된다.
    for relation_limit, event_limit, excerpt in ((0, 0, 0), (-5, -5, -5), (10**9, 10**9, 10**9)):
        detail = await store.entity_detail(
            theme.id,
            relation_limit=relation_limit,
            event_limit=event_limit,
            excerpt_chars=excerpt,
        )
        assert detail is not None
        assert len(detail.relations) == 1
        assert detail.events
