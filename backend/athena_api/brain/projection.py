"""SQLite 그래프를 NetworkX로 투영하고, 리비전으로 캐시를 무효화한다.

2026-08-25 leaf 6. 저장층이 답하지 못하는 질문들이 여기 있다 — 군집, 중심성, 최단경로.
그래프 DB를 버리면서 "그건 NetworkX 투영이 맡는다"고 적어둔 그 계층이다.

**왜 캐시인가.** 투영은 그래프 전체를 읽어 파이썬 객체로 짓는 일이다. 분석 4종이
각자 투영하면 한 화면을 그리는 데 네 번 읽는다. 그런데 캐시는 무효화가 틀리면 조용히
옛 답을 주는 물건이라, 무효화 근거가 확실해야 한다 — `graph_revision`이 그것이다.
저장층은 **모든 쓰기에서** 이 값을 올리므로, 리비전이 같으면 그래프도 같다.

**왜 무향인가.** 군집과 중심성은 "누가 누구와 엮여 있나"를 묻는다. 방향은 관계의
의미(`owns` vs `belongs_to`)에 있지 연결의 존재에 있지 않다. 방향이 필요한 질문
(프로필 요약의 out-edge)은 저장층이 이미 답한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import networkx as nx

from .store import EntityRow


class ProjectionSource(Protocol):
    """투영이 읽는 저장층 표면."""

    async def graph_revision(self) -> int: ...

    async def entities(self, *, kind: Any = ...) -> tuple[EntityRow, ...]: ...

    async def relations(self) -> tuple[Any, ...]: ...


@dataclass(frozen=True, slots=True)
class ProjectedGraph:
    """한 리비전 시점의 무향 그래프.

    `revision`을 함께 들고 다니는 이유는 분석 결과가 어느 시점의 것인지 말할 수 있어야
    하기 때문이다. "이 군집 지도는 지금 그래프의 것인가"에 답하지 못하면 화면이
    거짓말을 한다.
    """

    revision: int
    graph: nx.Graph

    @property
    def is_empty(self) -> bool:
        return self.graph.number_of_nodes() == 0


class GraphProjector:
    """리비전이 바뀔 때만 다시 짓는다."""

    def __init__(self, graph: ProjectionSource) -> None:
        self._graph = graph
        self._cached: ProjectedGraph | None = None
        self._cached_clusters: dict[str, int] | None = None
        # 실제로 몇 번 지었는지. 캐시가 도는지를 추측이 아니라 측정으로 확인하려면
        # 이 값이 필요하다.
        self.builds = 0
        # 군집 계산 횟수. 투영과 따로 세는 이유: 투영은 싸고(그래프 짓기) 군집은
        # 비싸다(1000노드 0.5초). 둘을 한 카운터로 묶으면 어느 쪽이 도는지 모른다.
        self.cluster_builds = 0

    async def project(self) -> ProjectedGraph:
        revision = await self._graph.graph_revision()
        cached = self._cached
        if cached is not None and cached.revision == revision:
            return cached

        rows = await self._graph.entities()
        relations = await self._graph.relations()

        built = nx.Graph()
        for row in rows:
            built.add_node(
                row.id,
                kind=row.kind,
                name=row.name,
                aliases=row.aliases,
                degree_in_store=row.degree,
            )
        for relation in relations:
            source = relation.source_entity_id
            target = relation.target_entity_id
            if source not in built or target not in built:
                # 저장층이 외래키로 막고 있으므로 정상 경로에서는 일어나지 않는다.
                # 그래도 건너뛰는 이유: 투영이 터지면 분석 화면 전체가 죽는데,
                # 원인은 저장층에 있으므로 여기서 죽어봐야 진단만 어려워진다.
                continue
            if built.has_edge(source, target):
                # 같은 쌍에 종류가 다른 엣지가 여럿일 수 있다(예: owns와 traded).
                # 무향 투영에서는 하나의 연결이고, 종류는 모아 둔다.
                built[source][target]["kinds"] = tuple(
                    sorted({*built[source][target]["kinds"], relation.kind})
                )
                built[source][target]["weight"] += 1
                continue
            built.add_edge(
                source,
                target,
                kinds=(relation.kind,),
                weight=1,
                tier=relation.tier,
                confidence=relation.confidence,
            )

        self.builds += 1
        projected = ProjectedGraph(revision=revision, graph=built)
        self._cached = projected
        # 그래프가 바뀌었으니 군집도 무효다. 여기서 안 버리면 새 그래프에 옛 배정을
        # 씌우게 되고, 그건 화면이 조용히 거짓말하는 종류의 실패다.
        self._cached_clusters = None
        return projected

    async def clusters(self) -> dict[str, int]:
        """현재 리비전의 군집 배정. 리비전이 그대로면 다시 계산하지 않는다.

        `cluster()`를 그냥 부르면 **요청마다** `greedy_modularity_communities`가 돈다 —
        1000노드에서 0.5초다. 투영은 캐시하면서 군집은 안 하고 있었고, 분석 화면이
        이걸 여러 번 부르므로 캐시가 실제로 값을 한다.
        """
        projected = await self.project()
        if self._cached_clusters is None:
            self.cluster_builds += 1
            self._cached_clusters = cluster(projected)
        return self._cached_clusters

    def invalidate(self) -> None:
        self._cached = None
        self._cached_clusters = None


def cluster(projected: ProjectedGraph) -> dict[str, int]:
    """노드를 군집에 배정한다. 같은 그래프에 같은 배정이 나온다.

    `greedy_modularity_communities`를 쓰는 이유는 결정성 때문이다. Louvain은 난수
    시드를 받고, 시드를 고정해도 NetworkX 판본이 바뀌면 배정이 달라질 수 있다. 군집
    번호가 이유 없이 흔들리면 사용자는 그래프가 바뀐 줄 안다.

    번호는 **군집 크기 내림 → 가장 작은 노드 id 오름**으로 매긴다. 알고리즘이 돌려주는
    순서에 기대면 같은 군집이 어제는 0, 오늘은 2가 될 수 있다.
    """
    if projected.is_empty:
        return {}
    communities = nx.community.greedy_modularity_communities(projected.graph)
    ordered = sorted(communities, key=lambda members: (-len(members), min(members)))
    return {
        node: index for index, members in enumerate(ordered) for node in sorted(members)
    }


__all__ = ["GraphProjector", "ProjectedGraph", "ProjectionSource", "cluster"]
