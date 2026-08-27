"""NetworkX 투영 — 리비전 기반 캐시와 결정적 군집.

leaf 6(2026-08-25). 캐시는 무효화가 틀리면 **조용히 옛 답을 주는** 물건이라, 무효화가
실제로 도는지를 추측이 아니라 호출 횟수로 잰다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import networkx as nx
import pytest

from athena_api.brain import (
    INVESTOR_PROFILE_ENTITY_ID,
    INVESTOR_PROFILE_NAME,
    Confidence,
    Entity,
    EntityKind,
    GraphProjector,
    GraphStore,
    ProjectedGraph,
    Relation,
    SourceKind,
    SourceRecord,
    SourceTier,
    cluster,
    entity_id,
    relation_id,
)
from athena_api.brain.projection import cluster_cohesion, cluster_representative_labels

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
        id=entity_id(kind, name), kind=kind, name=name, created_at=NOW, updated_at=NOW
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
    confidence: Confidence = Confidence.EXTRACTED,
    tier: SourceTier = SourceTier.CONVERSATIONAL,
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


# ── 캐시 ────────────────────────────────────────────────────────────────────


async def test_an_unchanged_revision_is_not_reprojected(store: GraphStore) -> None:
    """리비전이 그대로면 다시 짓지 않는다 — 분석 4종이 한 화면에 네 번 읽지 않게."""
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme), (relation("interested_in", PROFILE, theme),))

    projector = GraphProjector(store)
    first = await projector.project()
    for _ in range(3):
        again = await projector.project()
        assert again is first, "같은 객체를 돌려줘야 한다"
    assert projector.builds == 1


async def test_a_write_invalidates_the_cache(store: GraphStore) -> None:
    """저장층은 모든 쓰기에서 리비전을 올린다 — 그래서 리비전이 무효화 근거가 된다."""
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme), (relation("interested_in", PROFILE, theme),))

    projector = GraphProjector(store)
    before = await projector.project()
    assert projector.builds == 1

    other = entity(EntityKind.THEME, "반도체")
    await seed(
        store,
        (PROFILE, theme, other),
        (relation("interested_in", PROFILE, theme), relation("interested_in", PROFILE, other)),
    )

    after = await projector.project()
    assert projector.builds == 2
    assert after.revision > before.revision
    assert after.graph.number_of_nodes() > before.graph.number_of_nodes()


async def test_clusters_are_computed_once_per_revision(store: GraphStore) -> None:
    """군집 계산은 비싸다(1000노드 0.5초). 투영만 캐시하고 군집은 안 하면 반쪽이다.

    투영 카운터와 **따로** 세는 이유: 둘을 한 값으로 묶으면 어느 쪽이 도는지 모른다.
    """
    nodes = tuple(entity(EntityKind.THEME, f"테마{i}") for i in range(4))
    await seed(
        store,
        (PROFILE, *nodes),
        tuple(relation("interested_in", PROFILE, node) for node in nodes),
    )

    projector = GraphProjector(store)
    first = await projector.clusters()
    for _ in range(3):
        again = await projector.clusters()
        assert again is first, "같은 dict를 돌려줘야 한다"
    assert projector.cluster_builds == 1
    assert projector.builds == 1


async def test_a_write_invalidates_the_cluster_cache(store: GraphStore) -> None:
    """그래프가 바뀌었는데 옛 배정을 씌우면 화면이 조용히 거짓말한다."""
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme), (relation("interested_in", PROFILE, theme),))

    projector = GraphProjector(store)
    await projector.clusters()
    assert projector.cluster_builds == 1

    other = entity(EntityKind.THEME, "반도체")
    await seed(
        store,
        (PROFILE, theme, other),
        (relation("interested_in", PROFILE, theme), relation("interested_in", PROFILE, other)),
    )

    assignment = await projector.clusters()
    assert projector.cluster_builds == 2
    assert other.id in assignment, "새 노드가 배정에 들어와야 한다"


async def test_invalidate_drops_both_caches(store: GraphStore) -> None:
    await seed(store, (PROFILE, entity(EntityKind.THEME, "고배당주")))
    projector = GraphProjector(store)
    await projector.clusters()
    projector.invalidate()
    await projector.clusters()
    assert projector.builds == 2
    assert projector.cluster_builds == 2


async def test_invalidate_forces_a_rebuild(store: GraphStore) -> None:
    await seed(store, (PROFILE,))
    projector = GraphProjector(store)
    await projector.project()
    projector.invalidate()
    await projector.project()
    assert projector.builds == 2


# ── 투영의 모양 ─────────────────────────────────────────────────────────────


async def test_projection_is_undirected_and_carries_node_labels(store: GraphStore) -> None:
    theme = entity(EntityKind.THEME, "고배당주")
    await seed(store, (PROFILE, theme), (relation("interested_in", PROFILE, theme),))

    projected = await GraphProjector(store).project()
    graph = projected.graph
    assert not graph.is_directed()
    assert graph.nodes[theme.id]["name"] == "고배당주"
    assert graph.nodes[theme.id]["kind"] == EntityKind.THEME.value
    # 무향이므로 어느 방향으로 물어도 같은 엣지다.
    assert graph.has_edge(PROFILE.id, theme.id)
    assert graph.has_edge(theme.id, PROFILE.id)


async def test_two_relations_on_one_pair_collapse_into_one_edge(store: GraphStore) -> None:
    """`owns`와 `traded`가 같은 쌍에 있으면 무향 투영에서는 연결 하나다.

    종류를 잃지 않고 모아 둔다 — 잃으면 "왜 이어져 있나"에 답할 수 없다.
    """
    samsung = entity(EntityKind.SECURITY, "삼성전자")
    await seed(
        store,
        (PROFILE, samsung),
        (relation("owns", PROFILE, samsung), relation("traded", PROFILE, samsung)),
    )

    graph = (await GraphProjector(store).project()).graph
    assert graph.number_of_edges() == 1
    assert graph[PROFILE.id][samsung.id]["kinds"] == ("owns", "traded")
    assert graph[PROFILE.id][samsung.id]["weight"] == 2


async def test_an_empty_graph_projects_without_error(store: GraphStore) -> None:
    projected = await GraphProjector(store).project()
    assert projected.is_empty
    assert cluster(projected) == {}


# ── 군집 ────────────────────────────────────────────────────────────────────


async def test_clustering_is_deterministic(store: GraphStore) -> None:
    """군집 번호가 이유 없이 흔들리면 사용자는 그래프가 바뀐 줄 안다."""
    left = tuple(entity(EntityKind.THEME, f"좌{i}") for i in range(4))
    right = tuple(entity(EntityKind.THEME, f"우{i}") for i in range(4))
    edges = []
    for group in (left, right):
        for index, node in enumerate(group):
            for other in group[index + 1 :]:
                edges.append(relation("relates_to", node, other))
    # 두 덩어리를 가느다란 다리 하나로만 잇는다.
    edges.append(relation("relates_to", left[0], right[0]))
    await seed(store, (PROFILE, *left, *right), tuple(edges))

    projected = await GraphProjector(store).project()
    first = cluster(projected)
    for _ in range(5):
        assert cluster(projected) == first

    # 두 덩어리가 실제로 갈렸다.
    assert first[left[1].id] != first[right[1].id]


async def test_cluster_numbers_run_from_largest_to_smallest(store: GraphStore) -> None:
    """번호는 군집 크기 내림차순으로 매긴다.

    알고리즘이 돌려주는 순서에 기대면 같은 군집이 어제는 0, 오늘은 2가 된다. 어떤
    군집이 나오는지는 알고리즘의 몫이지만, **번호를 매기는 규칙은 우리 것**이므로
    특정 결과가 아니라 규칙을 잰다.
    """
    big = tuple(entity(EntityKind.THEME, f"큰{i}") for i in range(6))
    small = tuple(entity(EntityKind.COMPANY, f"작{i}") for i in range(2))
    edges = []
    for index, node in enumerate(big):
        for other in big[index + 1 :]:
            edges.append(relation("relates_to", node, other))
    edges.append(relation("relates_to", small[0], small[1]))
    await seed(store, (PROFILE, *big, *small), tuple(edges))

    assignment = cluster(await GraphProjector(store).project())
    sizes: dict[int, int] = {}
    for number in assignment.values():
        sizes[number] = sizes.get(number, 0) + 1
    ordered = [sizes[number] for number in sorted(sizes)]
    assert ordered == sorted(ordered, reverse=True), f"크기 내림차순이 아니다: {ordered}"
    assert assignment[big[0].id] == 0, "완전연결 6개가 가장 큰 군집이다"


# ── 응집도 ──────────────────────────────────────────────────────────────────


def test_cohesion_of_a_fully_connected_cluster_is_one() -> None:
    """군집 내부가 완전그래프면 내부 간선 밀도는 1.0이다."""
    graph = nx.Graph()
    graph.add_nodes_from(["a", "b", "c"])
    graph.add_edges_from([("a", "b"), ("b", "c"), ("a", "c")])
    projected = ProjectedGraph(revision=1, graph=graph)

    cohesion = cluster_cohesion(projected, {"a": 0, "b": 0, "c": 0})

    assert cohesion[0] == 1.0


def test_cohesion_of_a_cluster_with_no_internal_edges_is_zero() -> None:
    """군집원끼리 하나도 안 이어져 있으면 밀도는 0.0이다."""
    graph = nx.Graph()
    graph.add_nodes_from(["a", "b", "c"])
    projected = ProjectedGraph(revision=1, graph=graph)

    cohesion = cluster_cohesion(projected, {"a": 0, "b": 0, "c": 0})

    assert cohesion[0] == 0.0


def test_cohesion_of_a_single_node_cluster_is_zero() -> None:
    """군집 크기가 1이면 완전그래프 분모(n*(n-1)/2)가 0이라 밀도가 정의되지 않는다 — 0.0."""
    graph = nx.Graph()
    graph.add_node("a")
    projected = ProjectedGraph(revision=1, graph=graph)

    cohesion = cluster_cohesion(projected, {"a": 0})

    assert cohesion[0] == 0.0


# ── 대표 설명 문자열(WP-A) ──────────────────────────────────────────────────


def test_representative_picks_the_max_degree_member() -> None:
    """최대 차수 멤버가 대표로 뽑히고, 최빈 kind가 문구에 실린다."""
    graph = nx.Graph()
    graph.add_node("high", name="High", kind="theme")
    graph.add_node("mid", name="Mid", kind="theme")
    graph.add_node("low", name="Low", kind="company")
    graph.add_node("out1")
    graph.add_node("out2")
    graph.add_edge("high", "out1")
    graph.add_edge("high", "out2")
    graph.add_edge("mid", "out1")
    projected = ProjectedGraph(revision=1, graph=graph)

    labels = cluster_representative_labels(
        projected, {"high": 0, "mid": 0, "low": 0, "out1": 1, "out2": 1}
    )

    assert labels[0] == "High 외 2종목 · theme", "차수 2인 High가 대표, theme이 2:1로 최빈"


def test_representative_breaks_degree_ties_by_min_node_id() -> None:
    """`cluster()`와 같은 관례 — 동률이면 최소 node id."""
    graph = nx.Graph()
    graph.add_node("zzz", name="Zzz", kind="theme")
    graph.add_node("aaa", name="Aaa", kind="theme")
    graph.add_node("out", name="Out", kind="theme")
    graph.add_edge("zzz", "out")
    graph.add_edge("aaa", "out")
    projected = ProjectedGraph(revision=1, graph=graph)

    labels = cluster_representative_labels(projected, {"zzz": 0, "aaa": 0, "out": 1})

    assert labels[0].startswith("Aaa"), "차수가 같으면(둘 다 1) 최소 id(aaa < zzz)가 대표다"


def test_representative_breaks_kind_ties_alphabetically() -> None:
    """최빈 kind가 동률이면 알파벳순으로 끊는다."""
    graph = nx.Graph()
    graph.add_node("m1", name="M1", kind="zeta")
    graph.add_node("m2", name="M2", kind="alpha")
    projected = ProjectedGraph(revision=1, graph=graph)

    labels = cluster_representative_labels(projected, {"m1": 0, "m2": 0})

    assert labels[0].endswith("· alpha"), "zeta와 alpha가 동률(1:1)이면 alpha가 먼저다"


def test_representative_label_omits_the_count_suffix_for_a_single_member() -> None:
    """멤버가 하나면 "외 N종목"이 없다 — N-1=0을 굳이 "외 0종목"으로 안 보여준다."""
    graph = nx.Graph()
    graph.add_node("solo", name="Solo", kind="theme")
    projected = ProjectedGraph(revision=1, graph=graph)

    labels = cluster_representative_labels(projected, {"solo": 0})

    assert labels[0] == "Solo · theme"
    assert "외" not in labels[0]


def test_representative_labels_are_empty_for_an_empty_assignment() -> None:
    projected = ProjectedGraph(revision=1, graph=nx.Graph())
    assert cluster_representative_labels(projected, {}) == {}
