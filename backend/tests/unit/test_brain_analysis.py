"""분석 4종 — god_nodes · surprising_connections · suggest_questions · graph_diff.

leaf 6(2026-08-25). 이 스위트에서 가장 중요한 것은 `suggest_questions`가 실제로
`Confidence.AMBIGUOUS`를 먹고 산다는 확인이다. leaf 1이 온톨로지에, leaf 3이 프롬프트에
"불확실하다고 빼지 마라"를 새긴 이유가 여기서 회수된다 — 그 값을 떨어뜨렸다면 이 함수는
언제나 빈 목록을 냈을 것이고, **아무도 그 사실을 눈치채지 못했을 것이다**.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import networkx as nx
import pytest

from athena_api.brain import (
    INVESTOR_PROFILE_ENTITY_ID,
    INVESTOR_PROFILE_NAME,
    Confidence,
    Entity,
    EntityKind,
    GraphEventOp,
    GraphProjector,
    GraphStore,
    ProjectedGraph,
    Relation,
    SourceKind,
    SourceRecord,
    SourceTier,
    god_nodes,
    graph_diff,
    suggest_questions,
    surprising_connections,
)

NOW = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)

PROFILE = Entity(
    id=INVESTOR_PROFILE_ENTITY_ID,
    kind=EntityKind.INVESTOR_PROFILE,
    name=INVESTOR_PROFILE_NAME,
    created_at=NOW,
    updated_at=NOW,
)


def entity(kind: EntityKind, name: str) -> Entity:
    return Entity(
        id=entity_id_for(kind, name), kind=kind, name=name, created_at=NOW, updated_at=NOW
    )


def entity_id_for(kind: EntityKind, name: str) -> str:
    from athena_api.brain import entity_id

    return entity_id(kind, name)


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
    confidence: Confidence = Confidence.EXTRACTED,
    tier: SourceTier = SourceTier.CONVERSATIONAL,
    rationale: str | None = None,
    observed_at: datetime = NOW,
) -> Relation:
    from athena_api.brain import relation_id

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


# ── god_nodes ───────────────────────────────────────────────────────────────


async def test_god_nodes_rank_by_degree(store: GraphStore) -> None:
    """차수만 본다 — 매개 중심성은 실측 뒤 제거됐다(`scripts/bench_graph_analysis.py`)."""
    hub = entity(EntityKind.THEME, "반도체")
    leaves = tuple(entity(EntityKind.COMPANY, f"기업{i}") for i in range(4))
    lonely = entity(EntityKind.THEME, "외딴테마")
    other = entity(EntityKind.COMPANY, "짝기업")
    await seed(
        store,
        (PROFILE, hub, *leaves, lonely, other),
        (
            *[relation("belongs_to", leaf, hub) for leaf in leaves],
            relation("relates_to", lonely, other),
        ),
    )

    ranked = god_nodes(await GraphProjector(store).project())
    assert ranked[0].entity_id == hub.id
    assert ranked[0].degree == 4
    assert ranked[0].name == "반도체"


async def test_god_nodes_break_degree_ties_by_name(store: GraphStore) -> None:
    """동점을 이름으로 끊지 않으면 같은 그래프에서 순서가 흔들린다.

    `graph.nodes` 순회 순서는 삽입 순서에 딸린 것이라, 정렬이 그것에 기대면 적재 순서가
    화면 순서를 바꾼다 — 사용자는 그래프가 바뀐 줄 안다.
    """
    hub = entity(EntityKind.THEME, "반도체")
    # 이름이 사전순으로 뒤섞이도록 일부러 역순에 가깝게 만든다.
    same_degree = tuple(entity(EntityKind.COMPANY, name) for name in ("하기업", "가기업", "나기업"))
    await seed(
        store,
        (PROFILE, hub, *same_degree),
        tuple(relation("belongs_to", node, hub) for node in same_degree),
    )

    ranked = god_nodes(await GraphProjector(store).project())
    tied = [node.name for node in ranked if node.degree == 1]
    assert tied == sorted(tied), f"동점 구간이 이름 오름차순이 아니다: {tied}"
    assert ranked[0].name == "반도체", "차수가 가장 큰 노드가 먼저다"

    # 여러 번 돌려도 같은 순서 — 정렬이 결정적이라는 증거.
    for _ in range(3):
        assert [n.entity_id for n in god_nodes(await GraphProjector(store).project())] == [
            n.entity_id for n in ranked
        ]


async def test_god_nodes_exclude_isolated_nodes(store: GraphStore) -> None:
    """차수 0인 노드는 중심이 아니다 — 언급만 되고 아무것과도 안 엮인 것."""
    connected = entity(EntityKind.THEME, "반도체")
    orphan = entity(EntityKind.THEME, "외톨이")
    await seed(
        store,
        (PROFILE, connected, orphan),
        (relation("interested_in", PROFILE, connected),),
    )

    ids = {node.entity_id for node in god_nodes(await GraphProjector(store).project())}
    assert orphan.id not in ids
    assert connected.id in ids


async def test_god_nodes_are_bounded_and_validate_the_limit(store: GraphStore) -> None:
    nodes = tuple(entity(EntityKind.THEME, f"테마{i}") for i in range(6))
    await seed(
        store,
        (PROFILE, *nodes),
        tuple(relation("interested_in", PROFILE, node) for node in nodes),
    )

    projected = await GraphProjector(store).project()
    assert len(god_nodes(projected, limit=3)) == 3
    with pytest.raises(ValueError, match="limit"):
        god_nodes(projected, limit=0)


async def test_god_nodes_on_an_empty_graph(store: GraphStore) -> None:
    assert god_nodes(await GraphProjector(store).project()) == ()


# ── surprising_connections ──────────────────────────────────────────────────


async def test_surprising_connections_cross_cluster_boundaries(store: GraphStore) -> None:
    """한 군집 안의 연결은 이미 아는 이야기다. 놀라움은 경계를 넘을 때 생긴다."""
    left = tuple(entity(EntityKind.THEME, f"좌{i}") for i in range(4))
    right = tuple(entity(EntityKind.COMPANY, f"우{i}") for i in range(4))
    edges = []
    for group in (left, right):
        for index, node in enumerate(group):
            for other in group[index + 1 :]:
                edges.append(relation("relates_to", node, other))
    bridge = relation("relates_to", left[0], right[0])
    edges.append(bridge)
    await seed(store, (PROFILE, *left, *right), tuple(edges))

    found = surprising_connections(await GraphProjector(store).project())
    pairs = {frozenset((item.source_entity_id, item.target_entity_id)) for item in found}
    assert frozenset((left[0].id, right[0].id)) in pairs
    for item in found:
        assert item.source_cluster != item.target_cluster


async def test_surprising_connections_on_a_single_cluster_is_empty(store: GraphStore) -> None:
    nodes = tuple(entity(EntityKind.THEME, f"테마{i}") for i in range(3))
    edges = []
    for index, node in enumerate(nodes):
        for other in nodes[index + 1 :]:
            edges.append(relation("relates_to", node, other))
    await seed(store, (PROFILE, *nodes), tuple(edges))

    assert surprising_connections(await GraphProjector(store).project()) == ()


async def test_surprising_connections_on_an_empty_graph(store: GraphStore) -> None:
    assert surprising_connections(await GraphProjector(store).project()) == ()


def _hub_leaf_bridge_graph() -> ProjectedGraph:
    """허브-허브 다리(차수 높음)와 잎-잎 다리(차수 낮음)를 둘 다 가진 그래프.

    `assignment`를 직접 넘겨 `surprising_connections()`를 부르므로 실제 군집 알고리즘의
    분할 결과에 기대지 않는다 — 점수 계산 자체(차수 역수 → min-max 정규화)만 잰다.
    """
    graph = nx.Graph()
    for leaf in ("a0", "a1", "a2", "a3"):
        graph.add_edge("hub_a", leaf)
    for leaf in ("b0", "b1", "b2", "b3"):
        graph.add_edge("hub_b", leaf)
    graph.add_edge("hub_a", "hub_b")  # 허브끼리 — 차수 4*4=16, raw=1/16(작다 → 점수도 작다)
    graph.add_edge("a0", "b0")  # 잎끼리 — 이 엣지로 a0/b0 둘 다 차수 2, raw=1/4(크다 → 점수도 크다)
    return ProjectedGraph(revision=1, graph=graph)


def _hub_leaf_assignment() -> dict[str, int]:
    return {
        "hub_a": 0, "a0": 0, "a1": 0, "a2": 0, "a3": 0,
        "hub_b": 1, "b0": 1, "b1": 1, "b2": 1, "b3": 1,
    }


def test_surprising_connections_score_favors_low_degree_bridges() -> None:
    """차수가 낮은 쪽을 잇는 다리가 더 놀랍다 — 항상 이어지는 허브끼리는 덜 놀랍다."""
    found = surprising_connections(_hub_leaf_bridge_graph(), assignment=_hub_leaf_assignment())
    by_pair = {
        frozenset((item.source_entity_id, item.target_entity_id)): item.surprise_score
        for item in found
    }
    hub_bridge_score = by_pair[frozenset(("hub_a", "hub_b"))]
    leaf_bridge_score = by_pair[frozenset(("a0", "b0"))]
    assert leaf_bridge_score > hub_bridge_score, "차수가 낮은 다리가 더 놀라워야 한다"


def test_surprising_connections_are_ordered_by_surprise() -> None:
    """가장 놀라운 것이 맨 앞에 온다 — 이름순이 아니다."""
    found = surprising_connections(_hub_leaf_bridge_graph(), assignment=_hub_leaf_assignment())
    scores = [item.surprise_score for item in found]
    assert scores == sorted(scores, reverse=True), "놀라운 순으로 내려가야 한다"


def test_surprising_connections_limit_keeps_the_most_surprising() -> None:
    """limit이 자르는 것은 덜 놀라운 쪽이다.

    예전에는 놀라움과 무관한 기준(이름, 이 픽스처처럼 name이 없으면 엣지 삽입 순서)으로
    정렬한 뒤 잘라서, 가장 놀라운 연결이 목록 밖으로 밀려났다. 여기서는 잎-잎 다리
    ("a0"↔"b0")가 허브-허브 다리("hub_a"↔"hub_b")보다 놀라운데 뒤에 추가되므로,
    옛 코드는 limit=1에서 허브 쪽을 남겼다.
    """
    found = surprising_connections(
        _hub_leaf_bridge_graph(), assignment=_hub_leaf_assignment(), limit=1
    )
    assert len(found) == 1
    pair = frozenset((found[0].source_entity_id, found[0].target_entity_id))
    assert pair == frozenset(("a0", "b0")), "가장 놀라운 다리가 남아야 한다"


def test_surprising_connections_score_is_within_unit_range() -> None:
    found = surprising_connections(_hub_leaf_bridge_graph(), assignment=_hub_leaf_assignment())
    assert len(found) == 2, "이 픽스처는 다리가 2개 있어야 한다"
    assert all(0.0 <= item.surprise_score <= 1.0 for item in found)


async def test_surprising_connections_score_is_one_for_a_lone_crossing(store: GraphStore) -> None:
    """max==min이면(교차 다리가 하나뿐이면) 정규화 분모가 0이라 1.0으로 둔다."""
    left = tuple(entity(EntityKind.THEME, f"좌{i}") for i in range(4))
    right = tuple(entity(EntityKind.COMPANY, f"우{i}") for i in range(4))
    edges = []
    for group in (left, right):
        for index, node in enumerate(group):
            for other in group[index + 1 :]:
                edges.append(relation("relates_to", node, other))
    edges.append(relation("relates_to", left[0], right[0]))
    await seed(store, (PROFILE, *left, *right), tuple(edges))

    found = surprising_connections(await GraphProjector(store).project())
    assert len(found) == 1
    assert found[0].surprise_score == 1.0


# ── suggest_questions ───────────────────────────────────────────────────────


async def test_suggest_questions_feeds_on_ambiguous_relations(store: GraphStore) -> None:
    """AMBIGUOUS만 재료가 된다.

    확실한 것(EXTRACTED)은 물을 필요가 없고, 유도한 것(INFERRED)은 물어도 사용자가
    "그런 말 한 적 없는데"라고 답한다.
    """
    certain = entity(EntityKind.THEME, "확실테마")
    inferred = entity(EntityKind.THEME, "유도테마")
    unsure = entity(EntityKind.THEME, "애매테마")
    await seed(
        store,
        (PROFILE, certain, inferred, unsure),
        (
            relation("prefers", PROFILE, certain, confidence=Confidence.EXTRACTED),
            relation("prefers", PROFILE, inferred, confidence=Confidence.INFERRED),
            relation(
                "prefers",
                PROFILE,
                unsure,
                confidence=Confidence.AMBIGUOUS,
                rationale="괜찮은 것 같기도 하다고 했다",
            ),
        ),
    )

    projected = await GraphProjector(store).project()
    questions = suggest_questions(projected, await store.relations())

    assert len(questions) == 1
    assert questions[0].object_name == "애매테마"
    assert questions[0].rationale == "괜찮은 것 같기도 하다고 했다"
    assert "애매테마" in questions[0].question


async def test_suggest_questions_puts_the_most_recent_ambiguity_first(store: GraphStore) -> None:
    """오래된 애매함보다 방금 나온 애매함이 되묻기 좋다."""
    old = entity(EntityKind.THEME, "옛애매")
    new = entity(EntityKind.THEME, "새애매")
    await seed(
        store,
        (PROFILE, old, new),
        (
            relation(
                "prefers",
                PROFILE,
                old,
                confidence=Confidence.AMBIGUOUS,
                observed_at=NOW - timedelta(days=30),
            ),
            relation("prefers", PROFILE, new, confidence=Confidence.AMBIGUOUS),
        ),
    )

    questions = suggest_questions(
        await GraphProjector(store).project(), await store.relations()
    )
    assert [q.object_name for q in questions] == ["새애매", "옛애매"]


async def test_suggest_questions_is_empty_without_ambiguity(store: GraphStore) -> None:
    theme = entity(EntityKind.THEME, "확실테마")
    await seed(store, (PROFILE, theme), (relation("prefers", PROFILE, theme),))
    assert suggest_questions(
        await GraphProjector(store).project(), await store.relations()
    ) == ()


async def test_suggest_questions_validates_the_limit(store: GraphStore) -> None:
    with pytest.raises(ValueError, match="limit"):
        suggest_questions(await GraphProjector(store).project(), (), limit=0)


# ── graph_diff ──────────────────────────────────────────────────────────────


async def test_graph_diff_reports_what_changed_between_revisions(store: GraphStore) -> None:
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme), (relation("prefers", PROFILE, theme),))
    checkpoint = await store.graph_revision()

    other = entity(EntityKind.THEME, "반도체")
    await seed(
        store,
        (PROFILE, theme, other),
        (relation("prefers", PROFILE, other, "s2"),),
        source_id="s2",
    )

    diff = graph_diff(await store.events(), from_revision=checkpoint)
    assert other.id in diff.entities_added
    assert diff.edges_added, "새 엣지가 보고돼야 한다"
    # 이전 소스가 더 이상 주장하지 않는 엣지는 사라진다 — 소스 단위 원자 교체.
    assert diff.from_revision == checkpoint
    assert diff.to_revision > checkpoint


async def test_graph_diff_excludes_the_starting_revision(store: GraphStore) -> None:
    """구간은 `(from, to]` — 시작 리비전의 변화는 이미 그 시점에 보고됐다."""
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme), (relation("prefers", PROFILE, theme),))
    current = await store.graph_revision()

    diff = graph_diff(await store.events(), from_revision=current)
    assert diff.is_empty


async def test_graph_diff_reports_merges_and_rejections(store: GraphStore) -> None:
    """병합과 티어에 밀린 주장도 변화다 — 그래프에서 사라진 이유를 답할 수 있어야 한다."""
    canonical = Entity(
        id=entity_id_for(EntityKind.THEME, "이차전지"),
        kind=EntityKind.THEME,
        name="이차전지",
        aliases=("2차전지",),
        created_at=NOW,
        updated_at=NOW,
    )
    duplicate = entity(EntityKind.THEME, "2차전지")
    await seed(store, (PROFILE, canonical, duplicate))
    checkpoint = await store.graph_revision()

    from athena_api.brain import DedupService

    await DedupService(store).run()

    diff = graph_diff(await store.events(), from_revision=checkpoint)
    assert diff.entities_merged, "병합이 보고돼야 한다"
    assert not diff.is_empty


async def test_graph_diff_validates_its_window(store: GraphStore) -> None:
    events = await store.events()
    with pytest.raises(ValueError, match="from_revision"):
        graph_diff(events, from_revision=-1)
    with pytest.raises(ValueError, match="to_revision"):
        graph_diff(events, from_revision=5, to_revision=2)


async def test_graph_diff_on_an_empty_log(store: GraphStore) -> None:
    diff = graph_diff((), from_revision=0)
    assert diff.is_empty
    assert diff.to_revision == 0


def test_graph_diff_labels_edges_with_their_endpoints_and_kind() -> None:
    """엣지 변화를 id가 아니라 읽을 수 있는 모양으로 낸다."""
    from athena_api.brain import GraphEvent

    event = GraphEvent(
        seq=1,
        at=NOW,
        revision=2,
        op=GraphEventOp.EDGE_ADDED,
        subject_id="entity:a",
        object_id="entity:b",
        relation="prefers",
    )
    diff = graph_diff((event,), from_revision=1)
    assert diff.edges_added == ("entity:a-[prefers]->entity:b",)
