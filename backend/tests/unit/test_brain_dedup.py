"""dedup 3·4·5단 — 무엇을 접고, 무엇을 절대 접지 않는가.

leaf 5(2026-08-25). 이 스위트가 지키는 것 셋:

1. **종목은 어떤 근거로도 접히지 않는다.** 문자열이 아무리 닮아도. 잘못된 병합은
   결정적 티어의 사실을 엉뚱한 종목에 붙이고, 대화가 정정할 수 없다.
2. **결정적이다.** 같은 그래프에 두 번 돌리면 같은 승자·같은 형태가 나온다.
3. **접어도 잃지 않는다.** 진 쪽 이름은 별칭으로 남고, 관계는 승자로 옮겨가고,
   `ENTITY_MERGED`가 로그에 남는다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena_api.brain import (
    INVESTOR_PROFILE_ENTITY_ID,
    INVESTOR_PROFILE_NAME,
    Confidence,
    DedupService,
    Entity,
    EntityKind,
    GraphEventOp,
    GraphStore,
    Relation,
    SourceKind,
    SourceRecord,
    SourceTier,
    entity_id,
    relation_id,
)
from athena_api.brain.dedup import MIN_STRUCTURAL_DEGREE, NEVER_MERGED

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


def entity(
    kind: EntityKind, name: str, *, aliases: tuple[str, ...] = (), created_at: datetime = NOW
) -> Entity:
    return Entity(
        id=entity_id(kind, name),
        kind=kind,
        name=name,
        aliases=aliases,
        created_at=created_at,
        updated_at=created_at,
    )


def source(source_id: str = "s1") -> SourceRecord:
    return SourceRecord(
        id=source_id,
        kind=SourceKind.CONVERSATION,
        text="대화 본문",
        fingerprint=f"fp-{source_id}",
        occurred_at=NOW,
        ingested_at=NOW,
    )


def relation(
    kind: str,
    src: Entity,
    tgt: Entity,
    source_id: str = "s1",
    *,
    tier: SourceTier = SourceTier.CONVERSATIONAL,
    confidence: Confidence = Confidence.EXTRACTED,
) -> Relation:
    return Relation(
        id=relation_id(kind, src.id, tgt.id),
        kind=kind,
        source_entity_id=src.id,
        target_entity_id=tgt.id,
        confidence=confidence,
        tier=tier,
        source_id=source_id,
        observed_at=NOW,
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


async def seed(
    graph: GraphStore,
    entities: tuple[Entity, ...],
    relations: tuple[Relation, ...] = (),
    *,
    source_id: str = "s1",
) -> None:
    await graph.upsert_source(source(source_id))
    await graph.apply_extraction(source_id, f"fp-{source_id}", entities, relations)


async def names(graph: GraphStore) -> list[str]:
    return sorted(row.name for row in await graph.entities())


# ── 3단: 별칭 일치 ──────────────────────────────────────────────────────────


async def test_stage3_merges_on_a_shared_alias(store: GraphStore) -> None:
    """한쪽의 별칭이 다른 쪽의 이름과 같으면 접는다."""
    canonical = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    duplicate = entity(EntityKind.THEME, "2차전지")
    await seed(store, (PROFILE, canonical, duplicate))

    report = await DedupService(store).run()

    assert report.merged == 1
    assert report.decisions[0].stage == 3
    assert await names(store) == sorted([INVESTOR_PROFILE_NAME, "이차전지"])


async def test_stage3_keeps_the_loser_name_findable_as_an_alias(store: GraphStore) -> None:
    """접혔다고 그 이름으로 검색이 안 되면, 사용자가 아는 이름이 사라진 것처럼 보인다."""
    canonical = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    duplicate = entity(EntityKind.THEME, "2차전지")
    await seed(store, (PROFILE, canonical, duplicate))
    await DedupService(store).run()

    assert [hit.name for hit in await store.search_entities("2차전지")] == ["이차전지"]


# ── 4단: 문자열 근접 ────────────────────────────────────────────────────────


async def test_stage4_merges_names_that_share_most_tokens(store: GraphStore) -> None:
    """토큰 대부분이 겹치는 표기는 접힌다.

    "고배당 주식"↔"고배당 우량 주식"은 2/3 = 0.67로 임계(0.6)를 넘는다.
    (`normalize_identity`는 공백을 **접을 뿐 지우지 않으므로** "고배당주식"처럼 붙여
    쓴 표기는 토큰이 하나가 되어 겹치지 않는다 — 4단이 아니라 3단 별칭이 잡을 몫이다.)
    """
    short = entity(EntityKind.THEME, "고배당 주식")
    long = entity(EntityKind.THEME, "고배당 우량 주식")
    await seed(store, (PROFILE, short, long))

    report = await DedupService(store).run()
    assert report.merged == 1
    assert report.decisions[0].stage == 4


async def test_stage4_leaves_merely_related_names_alone(store: GraphStore) -> None:
    """앞머리가 같을 뿐인 다른 테마는 접지 않는다.

    "반도체 장비"와 "반도체 소재"는 토큰 하나만 겹친다(자카드 1/3). 이걸 접으면
    투자 테마가 뭉개져서 군집 지도가 의미를 잃는다.
    """
    equipment = entity(EntityKind.THEME, "반도체 장비")
    materials = entity(EntityKind.THEME, "반도체 소재")
    await seed(store, (PROFILE, equipment, materials))

    assert (await DedupService(store).run()).merged == 0
    assert await names(store) == sorted([INVESTOR_PROFILE_NAME, "반도체 장비", "반도체 소재"])


async def test_stage4_threshold_is_configurable_and_validated(store: GraphStore) -> None:
    equipment = entity(EntityKind.THEME, "반도체 장비")
    materials = entity(EntityKind.THEME, "반도체 소재")
    await seed(store, (PROFILE, equipment, materials))

    # 임계를 1/3까지 낮추면 위 쌍도 접힌다 — 임계가 실제로 판단을 바꾸고 있다는 증거.
    assert (await DedupService(store, name_similarity=0.33).run()).merged == 1

    for bad in (0.0, -1.0, 1.5):
        with pytest.raises(ValueError, match="name_similarity"):
            DedupService(store, name_similarity=bad)


# ── 5단: 구조적 근접 ────────────────────────────────────────────────────────


async def test_stage5_merges_nodes_with_the_same_neighbours(store: GraphStore) -> None:
    """이름이 전혀 안 닮았어도 이웃이 같으면 접는다."""
    alpha = entity(EntityKind.THEME, "알파")
    beta = entity(EntityKind.THEME, "베타")
    left = entity(EntityKind.COMPANY, "가나기업")
    right = entity(EntityKind.COMPANY, "다라기업")
    await seed(
        store,
        (PROFILE, alpha, beta, left, right),
        (
            relation("belongs_to", left, alpha),
            relation("belongs_to", right, alpha),
            relation("relates_to", alpha, left),
            relation("relates_to", beta, left),
            relation("relates_to", beta, right),
        ),
    )

    report = await DedupService(store).run()
    stages = {decision.stage for decision in report.decisions}
    assert 5 in stages
    remaining = await names(store)
    assert ("알파" in remaining) != ("베타" in remaining), "둘 중 하나만 남아야 한다"


async def test_stage5_ignores_nodes_with_too_few_neighbours(store: GraphStore) -> None:
    """이웃이 하나뿐인 두 노드는 그 하나가 같기만 하면 자카드 1.0이 된다 — 우연이다."""
    assert MIN_STRUCTURAL_DEGREE == 2
    alpha = entity(EntityKind.THEME, "알파")
    beta = entity(EntityKind.THEME, "베타")
    shared = entity(EntityKind.COMPANY, "가나기업")
    await seed(
        store,
        (PROFILE, alpha, beta, shared),
        (relation("relates_to", alpha, shared), relation("relates_to", beta, shared)),
    )

    assert (await DedupService(store).run()).merged == 0


# ── 절대 접지 않는 것 ───────────────────────────────────────────────────────


async def test_securities_are_never_merged_however_similar(store: GraphStore) -> None:
    """"삼성전자"와 "삼성전기"는 4단 임계를 넘지만 완전히 다른 회사다.

    접히는 순간 체결·잔고가 만든 사실이 엉뚱한 종목에 붙고, 결정적 티어라 대화가
    정정할 수도 없다. 종목의 동일성은 문자열이 아니라 종목코드가 정한다.
    """
    assert EntityKind.SECURITY in NEVER_MERGED
    electronics = entity(EntityKind.SECURITY, "삼성전자", aliases=("005930",))
    # 별칭까지 완전히 겹치게 만들어 3단·4단 모두 걸리게 해놓는다.
    electro_mech = entity(EntityKind.SECURITY, "삼성전자", aliases=("005930",))
    await seed(store, (PROFILE, electronics))
    await store.upsert_entity(entity(EntityKind.SECURITY, "삼성전기", aliases=("005930",)))
    assert electro_mech is not None

    assert (await DedupService(store).run()).merged == 0
    assert "삼성전자" in await names(store)
    assert "삼성전기" in await names(store)


async def test_the_investor_profile_is_never_merged(store: GraphStore) -> None:
    """접히면 아무것도 안 터지고 프로필만 조용히 빈다."""
    assert EntityKind.INVESTOR_PROFILE in NEVER_MERGED
    theme = entity(EntityKind.THEME, INVESTOR_PROFILE_NAME)
    await seed(store, (PROFILE, theme))

    assert (await DedupService(store).run()).merged == 0
    assert INVESTOR_PROFILE_NAME in await names(store)


async def test_the_store_refuses_a_profile_merge_even_if_asked_directly(
    store: GraphStore,
) -> None:
    """정책은 dedup이 정하지만 이 하나는 저장층의 구조적 불변식이다."""
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme))
    with pytest.raises(ValueError, match="investor profile"):
        await store.merge_entities(theme.id, INVESTOR_PROFILE_ENTITY_ID)
    with pytest.raises(ValueError, match="investor profile"):
        await store.merge_entities(INVESTOR_PROFILE_ENTITY_ID, theme.id)


async def test_different_kinds_are_never_merged(store: GraphStore) -> None:
    """이름이 같아도 종류가 다르면 다른 것이다."""
    theme = entity(EntityKind.THEME, "배당")
    goal = entity(EntityKind.GOAL, "배당")
    await seed(store, (PROFILE, theme, goal))

    assert (await DedupService(store).run()).merged == 0
    with pytest.raises(ValueError, match="different kinds"):
        await store.merge_entities(theme.id, goal.id)


# ── 결정성 ──────────────────────────────────────────────────────────────────


async def test_the_winner_does_not_depend_on_insertion_order(tmp_path: Path) -> None:
    """같은 그래프를 다른 순서로 지어도 같은 승자가 나온다."""
    winners: set[str] = set()
    for order in (0, 1):
        graph = GraphStore(tmp_path / f"brain-{order}.sqlite3")
        await graph.open()
        try:
            first = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
            second = entity(EntityKind.THEME, "2차전지")
            pair = (first, second) if order == 0 else (second, first)
            await seed(graph, (PROFILE, *pair))
            report = await DedupService(graph).run()
            assert report.merged == 1
            winners.add(report.decisions[0].winner_id)
        finally:
            await graph.close()
    assert len(winners) == 1, "삽입 순서가 승자를 바꿨다"


async def test_running_twice_is_a_no_op_the_second_time(store: GraphStore) -> None:
    canonical = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    duplicate = entity(EntityKind.THEME, "2차전지")
    await seed(store, (PROFILE, canonical, duplicate))

    assert (await DedupService(store).run()).merged == 1
    after_first = await names(store)
    assert (await DedupService(store).run()).merged == 0
    assert await names(store) == after_first


async def test_a_three_way_group_collapses_to_one_winner(store: GraphStore) -> None:
    """A-B, B-C가 이어지면 셋이 한 무리다 — 쌍을 만나는 대로 접으면 순서가 결과를 바꾼다."""
    a = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    b = entity(EntityKind.THEME, "2차전지", aliases=("배터리",))
    c = entity(EntityKind.THEME, "배터리")
    await seed(store, (PROFILE, a, b, c))

    report = await DedupService(store).run()
    assert report.merged == 2
    assert len({decision.winner_id for decision in report.decisions}) == 1
    assert len(await names(store)) == 2  # 투자자 + 승자 하나


async def test_the_higher_degree_entity_wins(store: GraphStore) -> None:
    """관계가 많은 쪽을 남겨야 옮길 엣지가 적다."""
    busy = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    lonely = entity(EntityKind.THEME, "2차전지")
    company = entity(EntityKind.COMPANY, "가나기업")
    await seed(
        store,
        (PROFILE, busy, lonely, company),
        (
            relation("relates_to", busy, company),
            relation("interested_in", PROFILE, busy),
        ),
    )

    report = await DedupService(store).run()
    assert report.decisions[0].winner_id == busy.id


# ── 접어도 잃지 않는다 ──────────────────────────────────────────────────────


async def test_relations_move_to_the_winner_and_the_merge_is_logged(store: GraphStore) -> None:
    canonical = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    duplicate = entity(EntityKind.THEME, "2차전지")
    company = entity(EntityKind.COMPANY, "가나기업")
    await seed(
        store,
        (PROFILE, canonical, duplicate, company),
        (
            relation("interested_in", PROFILE, canonical),
            relation("relates_to", duplicate, company),
        ),
    )

    report = await DedupService(store).run()
    winner_id = report.decisions[0].winner_id

    edges = await store.neighborhood(winner_id, depth=1)
    assert {edge.kind for edge in edges} == {"interested_in", "relates_to"}
    merged = [event for event in await store.events() if event.op is GraphEventOp.ENTITY_MERGED]
    assert len(merged) == 1
    assert merged[0].subject_id == report.decisions[0].loser_id
    assert merged[0].object_id == winner_id


async def test_merging_the_two_ends_of_an_edge_drops_it_instead_of_self_looping(
    store: GraphStore,
) -> None:
    """`A -> B`에서 A와 B가 접히면 자기 자신으로 향하는 엣지가 된다 — 온톨로지가 금지한다.

    버리지 않으면 병합이 저장층 제약을 위반해 통째로 실패하고, 그래프가 영원히
    중복인 채로 남는다.
    """
    left = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    right = entity(EntityKind.THEME, "2차전지")
    await seed(store, (PROFILE, left, right), (relation("relates_to", left, right),))

    report = await DedupService(store).run()
    assert report.merged == 1
    winner_id = report.decisions[0].winner_id
    assert await store.neighborhood(winner_id, depth=1) == ()
    removed = [e for e in await store.events() if e.op is GraphEventOp.EDGE_REMOVED]
    assert [e.relation for e in removed] == ["relates_to"]


async def test_a_deterministic_edge_survives_a_merge_collision(store: GraphStore) -> None:
    """옮긴 자리에 이미 같은 엣지가 있으면 티어 우선순위로 정한다.

    적재와 같은 규칙을 쓰지 않으면 병합이 결정적 티어를 조용히 덮어쓴다.
    """
    canonical = entity(EntityKind.THEME, "이차전지", aliases=("2차전지",))
    duplicate = entity(EntityKind.THEME, "2차전지")
    await seed(
        store,
        (PROFILE, canonical, duplicate),
        (
            relation(
                "interested_in", PROFILE, canonical, tier=SourceTier.DETERMINISTIC
            ),
        ),
    )
    await store.upsert_source(source("s2"))
    await store.apply_extraction(
        "s2",
        "fp-s2",
        (PROFILE, canonical, duplicate),
        (relation("interested_in", PROFILE, duplicate, "s2", confidence=Confidence.AMBIGUOUS),),
    )

    report = await DedupService(store).run()
    assert report.merged == 1
    edges = await store.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)
    assert len(edges) == 1
    assert edges[0].tier == SourceTier.DETERMINISTIC.value
    rejected = [e for e in await store.events() if e.op is GraphEventOp.EDGE_REJECTED]
    assert rejected, "밀린 주장이 로그에 남아야 한다"


# ── 경계 ────────────────────────────────────────────────────────────────────


async def test_an_empty_graph_is_not_an_error(store: GraphStore) -> None:
    assert (await DedupService(store).run()).merged == 0


async def test_a_single_entity_of_a_kind_is_left_alone(store: GraphStore) -> None:
    await seed(store, (PROFILE, entity(EntityKind.THEME, "고배당주")))
    assert (await DedupService(store).run()).merged == 0


async def test_merge_refuses_a_missing_participant(store: GraphStore) -> None:
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme))
    with pytest.raises(ValueError, match="must exist"):
        await store.merge_entities(theme.id, "entity:does-not-exist")
    with pytest.raises(ValueError, match="itself"):
        await store.merge_entities(theme.id, theme.id)


async def test_entities_listing_carries_degree_and_is_ordered(store: GraphStore) -> None:
    """차수를 한 번에 세는 것이 승자 선택의 결정성을 받친다."""
    theme = entity(EntityKind.THEME, "고배당주", created_at=NOW - timedelta(days=1))
    await seed(store, (PROFILE, theme), (relation("interested_in", PROFILE, theme),))

    rows = await store.entities()
    assert [row.id for row in rows] == sorted(row.id for row in rows)
    by_id = {row.id: row for row in rows}
    assert by_id[theme.id].degree == 1
    assert by_id[theme.id].normalized_name == "고배당주"

    only_themes = await store.entities(kind=EntityKind.THEME)
    assert [row.name for row in only_themes] == ["고배당주"]
