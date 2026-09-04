"""그래프가 답하는 네 가지 질문.

2026-08-25 leaf 6.

| 분석 | 질문 | 재료 |
|---|---|---|
| `god_nodes` | 내 투자의 중심은 무엇인가 | 중심성 |
| `surprising_connections` | 내가 못 본 연결은 어디인가 | 군집 사이를 잇는 엣지 |
| `suggest_questions` | 무엇을 되물어야 하는가 | `Confidence.AMBIGUOUS` 관계 |
| `graph_diff` | 그 사이 무엇이 바뀌었나 | `graph_events` |

`suggest_questions`가 AMBIGUOUS를 재료로 쓰는 것이 이 파일의 요점이다. leaf 1이
"불확실하다고 빼지 마라"를 온톨로지에 새기고 leaf 3이 프롬프트에 새긴 이유가 여기서
회수된다 — "이거 괜찮은 것 같기도 하고"는 버릴 신호가 아니라 되물을 대상이었다.
그 값을 떨어뜨렸다면 이 함수는 언제나 빈 목록을 냈을 것이고, 아무도 그 사실을
눈치채지 못했을 것이다.
"""

from __future__ import annotations

from dataclasses import dataclass

from .ontology import Confidence, GraphEvent, GraphEventOp
from .projection import ProjectedGraph, cluster
from .store import RelationRow

# 기본 상한. 화면 하나에 들어갈 만큼만 낸다 — 200개를 돌려주면 읽는 쪽이 다시 자른다.
DEFAULT_LIMIT: int = 10


@dataclass(frozen=True, slots=True)
class GodNode:
    entity_id: str
    name: str
    kind: str
    degree: int


@dataclass(frozen=True, slots=True)
class SurprisingConnection:
    """서로 다른 군집을 잇는 엣지.

    한 군집 안의 연결은 이미 아는 이야기다. 놀라움은 평소 따로 노는 두 덩어리가
    한 곳에서 만날 때 생긴다.
    """

    source_entity_id: str
    source_name: str
    target_entity_id: str
    target_name: str
    kinds: tuple[str, ...]
    source_cluster: int
    target_cluster: int
    surprise_score: float


@dataclass(frozen=True, slots=True)
class SuggestedQuestion:
    relation_id: str
    subject_name: str
    object_name: str
    relation_kind: str
    rationale: str | None
    question: str


@dataclass(frozen=True, slots=True)
class GraphDiff:
    from_revision: int
    to_revision: int
    entities_added: tuple[str, ...]
    entities_merged: tuple[str, ...]
    edges_added: tuple[str, ...]
    edges_removed: tuple[str, ...]
    edges_changed: tuple[str, ...]
    edges_rejected: tuple[str, ...]

    @property
    def is_empty(self) -> bool:
        return not any(
            (
                self.entities_added,
                self.entities_merged,
                self.edges_added,
                self.edges_removed,
                self.edges_changed,
                self.edges_rejected,
            )
        )


def god_nodes(projected: ProjectedGraph, *, limit: int = DEFAULT_LIMIT) -> tuple[GodNode, ...]:
    """투자의 중심에 있는 노드. **차수만 본다.**

    이전 판은 매개 중심성을 함께 쓰면서 주석에 "차수는 많이 언급됐다를, 매개는 따로 놀
    뻔한 것들을 잇고 있다를 말한다 — 후자가 투자자의 실제 축이다"라고 적었다.
    **실측이 그 주석을 반박했다** (`scripts/bench_graph_analysis.py`로 재현 가능):

    | 노드 | betweenness | 차수와 상위10 겹침 |
    |---:|---:|---:|
    | 200 | 0.05s | 9/10 |
    | 600 | 0.35s | 9/10 |
    | 1,000 | 1.58s | — |
    | 1,500 | 4.0s | **10/10** |
    | 3,000 | 14.4s | — |

    투자 성향 그래프는 척도 없는(scale-free) 형태라 허브가 곧 다리다 — 매개가 차수와
    거의 같은 순위를 내면서 비용만 O(N·E)로 든다. 값을 못 하는 지표는 남기는 쪽이
    안전한 것이 아니라, 읽는 사람에게 없는 근거가 있는 것처럼 보이게 한다.

    정렬 동점은 이름으로 끊는다. 끊지 않으면 같은 그래프에서 순서가 흔들린다.
    """
    if limit <= 0:
        raise ValueError("limit must be positive")
    if projected.is_empty:
        return ()
    graph = projected.graph
    ranked = sorted(
        graph.nodes,
        key=lambda node: (-graph.degree(node), str(graph.nodes[node].get("name", ""))),
    )
    return tuple(
        GodNode(
            entity_id=node,
            name=str(graph.nodes[node].get("name", "")),
            kind=str(graph.nodes[node].get("kind", "")),
            degree=graph.degree(node),
        )
        for node in ranked[:limit]
        if graph.degree(node) > 0
    )


def surprising_connections(
    projected: ProjectedGraph,
    *,
    limit: int = DEFAULT_LIMIT,
    assignment: dict[str, int] | None = None,
) -> tuple[SurprisingConnection, ...]:
    """군집 경계를 넘는 엣지.

    `assignment`를 받으면 그것을 쓴다 — 호출자가 이미 캐시된 배정을 갖고 있을 때
    같은 군집 계산을 두 번 하지 않게 하려는 것이다(`GraphProjector.clusters()`).
    안 주면 직접 계산한다.
    """
    if limit <= 0:
        raise ValueError("limit must be positive")
    if projected.is_empty:
        return ()
    graph = projected.graph
    if assignment is None:
        assignment = cluster(projected)
    crossings = [
        (source, target)
        for source, target in graph.edges
        if assignment.get(source) != assignment.get(target)
    ]
    # 상대 놀라움 점수 — 차수가 낮은(평소 덜 언급되는) 쪽일수록 놀랍다. limit으로 자르기
    # **전** 전체 crossings에서 정규화해야 "이 목록 안에서의 상대 순위"라는 의미가
    # limit 값에 따라 흔들리지 않는다. 절대 스케일(Paper의 8.5류)은 흉내 내지 않는다.
    raw_by_pair = {
        pair: 1.0 / (graph.degree(pair[0]) * graph.degree(pair[1])) for pair in crossings
    }
    if raw_by_pair:
        lo, hi = min(raw_by_pair.values()), max(raw_by_pair.values())
        score_by_pair = (
            {pair: 1.0 for pair in raw_by_pair}
            if hi == lo
            else {pair: (value - lo) / (hi - lo) for pair, value in raw_by_pair.items()}
        )
    else:
        score_by_pair = {}
    # 놀라운 순으로 정렬한 **뒤에** 자른다(2026-09-03 실사용 제보로 발견).
    #
    # 예전에는 이름순으로 정렬하고 그대로 crossings[:limit]을 잘랐다 — 그러면 "숨은
    # 연관"이라는 이름을 달고 **가나다순으로 앞선 것**을 보여준다. 실제 화면에
    # "반도체 대형주↔KODEX 반도체 · 반도체 대형주↔SK하이닉스 · 배당·인컴↔ACE…"가
    # 뜬 것이 그 증거였다(정확히 가나다순). 점수를 계산해 놓고 순위에 안 쓰면
    # 그 계산은 화면의 배지 하나를 채울 뿐 아무 일도 하지 않는다.
    #
    # 이름은 동점일 때의 결정적 tie-break로 남긴다 — 같은 그래프를 두 번 물으면
    # 같은 목록이 나와야 한다(점수만으로 정렬하면 동점 순서가 dict 순회에 끌려간다).
    crossings.sort(
        key=lambda pair: (
            -score_by_pair[pair],
            str(graph.nodes[pair[0]].get("name", "")),
            str(graph.nodes[pair[1]].get("name", "")),
        )
    )
    return tuple(
        SurprisingConnection(
            source_entity_id=source,
            source_name=str(graph.nodes[source].get("name", "")),
            target_entity_id=target,
            target_name=str(graph.nodes[target].get("name", "")),
            kinds=tuple(graph[source][target].get("kinds", ())),
            source_cluster=assignment.get(source, -1),
            target_cluster=assignment.get(target, -1),
            surprise_score=score_by_pair[(source, target)],
        )
        for source, target in crossings[:limit]
    )


def suggest_questions(
    projected: ProjectedGraph,
    relations: tuple[RelationRow, ...],
    *,
    limit: int = DEFAULT_LIMIT,
) -> tuple[SuggestedQuestion, ...]:
    """되물을 것들. `AMBIGUOUS` 관계가 재료다.

    확실한 것(EXTRACTED)은 물을 필요가 없고, 유도한 것(INFERRED)은 물어도 사용자가
    "그런 말 한 적 없는데"라고 답한다. 애매하다고 표시된 것만이 되물을 가치가 있다 —
    그래서 추출이 그것을 버리지 않고 남겼다.
    """
    if limit <= 0:
        raise ValueError("limit must be positive")
    graph = projected.graph

    def label(entity_id: str) -> str:
        if entity_id in graph.nodes:
            return str(graph.nodes[entity_id].get("name", entity_id))
        return entity_id

    ambiguous = [
        relation for relation in relations if relation.confidence == Confidence.AMBIGUOUS.value
    ]
    # 최근 관측 우선 — 오래된 애매함보다 방금 나온 애매함이 되묻기 좋다.
    ambiguous.sort(key=lambda relation: (relation.observed_at, relation.id), reverse=True)
    return tuple(
        SuggestedQuestion(
            relation_id=relation.id,
            subject_name=label(relation.source_entity_id),
            object_name=label(relation.target_entity_id),
            relation_kind=relation.kind,
            rationale=relation.rationale,
            question=(
                f"{label(relation.target_entity_id)}에 대해 "
                f"'{relation.kind}'가 맞나요? 확실하지 않은 것으로 기록해 두었습니다."
            ),
        )
        for relation in ambiguous[:limit]
    )


def graph_diff(
    events: tuple[GraphEvent, ...], *, from_revision: int, to_revision: int | None = None
) -> GraphDiff:
    """두 리비전 사이에 무엇이 바뀌었는가.

    그래프 자체가 아니라 `graph_events`로 답한다. 그래프는 "지금 어떤 상태인가"만 알고,
    "언제 무엇이 바뀌었나"는 로그만 안다 — 원본에서 다시 지어도 과거의 그래프가 그대로
    재현되지는 않으므로(프롬프트·dedup 규칙·LLM 비결정성이 그 사이에 바뀐다) 이 로그가
    *실제로 그렇게 됐었다*는 유일한 기록이다.

    구간은 `(from_revision, to_revision]` — 시작 리비전의 변화는 이미 그 시점에 보고됐다.
    """
    if from_revision < 0:
        raise ValueError("from_revision must not be negative")
    ceiling = to_revision if to_revision is not None else max(
        (event.revision for event in events), default=from_revision
    )
    if ceiling < from_revision:
        raise ValueError("to_revision must not precede from_revision")

    window = [
        event for event in events if from_revision < event.revision <= ceiling
    ]

    def subjects(op: GraphEventOp) -> tuple[str, ...]:
        seen: list[str] = []
        for event in window:
            if event.op is op and event.subject_id not in seen:
                seen.append(event.subject_id)
        return tuple(seen)

    def edges(op: GraphEventOp) -> tuple[str, ...]:
        seen: list[str] = []
        for event in window:
            if event.op is not op:
                continue
            label = f"{event.subject_id}-[{event.relation}]->{event.object_id}"
            if label not in seen:
                seen.append(label)
        return tuple(seen)

    return GraphDiff(
        from_revision=from_revision,
        to_revision=ceiling,
        entities_added=subjects(GraphEventOp.ENTITY_ADDED),
        entities_merged=subjects(GraphEventOp.ENTITY_MERGED),
        edges_added=edges(GraphEventOp.EDGE_ADDED),
        edges_removed=edges(GraphEventOp.EDGE_REMOVED),
        edges_changed=edges(GraphEventOp.EDGE_CHANGED),
        edges_rejected=edges(GraphEventOp.EDGE_REJECTED),
    )


__all__ = [
    "DEFAULT_LIMIT",
    "GodNode",
    "GraphDiff",
    "SuggestedQuestion",
    "SurprisingConnection",
    "god_nodes",
    "graph_diff",
    "suggest_questions",
    "surprising_connections",
]
