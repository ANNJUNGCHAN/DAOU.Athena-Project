"""같은 것을 가리키는 엔티티를 접는다.

2026-08-25 leaf 5. 3단계를 순서대로 돌린다. 뒤로 갈수록 근거가 약해지므로 앞 단계가
잡은 것은 뒤 단계가 다시 보지 않는다.

| 단 | 근거 | 예 |
|---|---|---|
| 3 | 별칭 일치 — 별칭이 상대의 이름·별칭과 같다 | "이차전지"(별칭 "2차전지") ↔ "2차전지" |
| 4 | 문자열 근접 — 이름 토큰의 자카드가 임계 이상 | "고배당 주식" ↔ "고배당 우량 주식" (0.67) |
| 5 | 구조적 근접 — 이웃 집합이 충분히 겹친다 | 같은 기업들에 붙은 두 테마 |

**종목은 어떤 단계로도 병합하지 않는다.** 종목의 동일성은 문자열이 아니라
`instrument_identity`의 종목코드가 정한다. "삼성전자"와 "삼성전기"는 4단 임계를 넘길
만큼 닮았지만 완전히 다른 회사이고, 한 번 접히면 결정적 티어(체결·잔고)가 만든 사실이
엉뚱한 종목에 붙는다. 대화가 정정할 수도 없다 — 잘못된 병합은 그 자체로 결정적이다.
투자자 노드도 같은 이유로 제외한다(고정 id 하나뿐이고, 접히면 프로필이 조용히 빈다).

**결정성**이 이 모듈의 다른 축이다. 같은 그래프에 두 번 돌리면 같은 결과가 나와야 한다.
그래서 (1) 후보 쌍을 정렬된 순서로 만들고, (2) 승자를 `_pick_winner`의 고정 규칙으로
고르고, (3) 유니온-파인드로 한 무리를 한 승자에 모으고, (4) 이웃 집합을 **어떤 병합보다
먼저** 한 번에 읽는다. 쌍을 만나는 대로 병합하면 A-B와 B-C가 순서에 따라 다른 최종
형태가 되고, 이웃을 그때그때 읽으면 앞 종류의 병합이 뒤 종류의 근거를 지운다.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final, Protocol

from .ontology import EntityKind, GraphId, normalize_identity
from .store import EntityRow

# 4단 임계. 토큰 자카드가 이 값 이상이면 같은 것으로 본다.
#
# 0.6은 "고배당 주식"↔"고배당 우량 주식"(2/3 = 0.67, 접어야 한다)과 "반도체 장비"↔
# "반도체 소재"(1/3 = 0.33, 접으면 안 된다)를 가르는 자리에서 고른 값이다.
#
# `normalize_identity`는 공백을 **접을 뿐 지우지 않는다**. 그래서 "고배당주식"처럼 붙여
# 쓴 표기는 토큰이 하나가 되어 자카드가 0이 된다 — 그건 4단이 아니라 3단 별칭이 잡을
# 몫이다. (처음에 이걸 4단 예시로 적었다가 실측에서 틀린 것을 확인했다.)
DEFAULT_NAME_SIMILARITY: Final = 0.6

# 5단 임계. 이웃 집합의 자카드.
#
# 문자열이 전혀 안 닮았는데 구조만으로 접는 것이므로 4단보다 높게 잡는다. 이웃이 적은
# 노드(차수 1~2)는 우연히 겹치기 쉬워서 아래 `MIN_STRUCTURAL_DEGREE`로 따로 막는다.
DEFAULT_NEIGHBOUR_SIMILARITY: Final = 0.8

# 5단이 볼 최소 차수. 이웃이 하나뿐인 두 노드는 그 하나가 같기만 하면 자카드가 1.0이 된다 —
# 근거가 아니라 우연이다.
MIN_STRUCTURAL_DEGREE: Final = 2

# 병합에서 제외되는 종류.
NEVER_MERGED: Final[frozenset[EntityKind]] = frozenset(
    {EntityKind.SECURITY, EntityKind.INVESTOR_PROFILE}
)


class MergeTarget(Protocol):
    """dedup이 쓰는 저장층 표면."""

    async def entities(self, *, kind: EntityKind | None = ...) -> tuple[EntityRow, ...]: ...

    async def merge_entities(self, winner_id: str, loser_id: str) -> None: ...

    async def neighborhood(self, entity_id: str, *, depth: int = ...) -> tuple: ...


@dataclass(frozen=True, slots=True)
class MergeDecision:
    """무엇을 무엇에 접었고, 어느 단이 그렇게 판단했는가."""

    winner_id: str
    loser_id: str
    stage: int
    reason: str


@dataclass(frozen=True, slots=True)
class DedupReport:
    decisions: tuple[MergeDecision, ...]

    @property
    def merged(self) -> int:
        return len(self.decisions)


def _tokens(value: str) -> frozenset[str]:
    return frozenset(part for part in normalize_identity(value).split(" ") if part)


def _jaccard(left: Iterable[str], right: Iterable[str]) -> float:
    a, b = frozenset(left), frozenset(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _labels(row: EntityRow) -> frozenset[str]:
    """이름과 별칭을 정규화한 집합. 3단이 이것끼리 비교한다."""
    return frozenset(
        normalize_identity(value) for value in (row.name, *row.aliases) if value.strip()
    )


class _Union:
    """유니온-파인드. 한 무리가 한 승자에 모이게 한다.

    쌍을 만나는 대로 병합하면 A-B, B-C를 어느 순서로 보느냐에 따라 최종 형태가 달라진다.
    무리를 먼저 짓고 나중에 승자를 한 번 고르면 순서가 결과를 바꾸지 못한다.
    """

    def __init__(self) -> None:
        self._parent: dict[str, str] = {}

    def find(self, item: str) -> str:
        self._parent.setdefault(item, item)
        root = item
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[item] != root:
            self._parent[item], item = root, self._parent[item]
        return root

    def union(self, left: str, right: str) -> None:
        left_root, right_root = self.find(left), self.find(right)
        if left_root != right_root:
            # 항상 사전순 작은 쪽을 뿌리로 — 뿌리 선택 자체가 결정적이어야 한다.
            # (실제 승자는 뿌리가 아니라 `_pick_winner`가 고른다.)
            low, high = sorted((left_root, right_root))
            self._parent[high] = low

    def groups(self) -> list[list[str]]:
        clusters: dict[str, list[str]] = {}
        for item in sorted(self._parent):
            clusters.setdefault(self.find(item), []).append(item)
        return [sorted(members) for _, members in sorted(clusters.items()) if len(members) > 1]


def _pick_winner(members: Sequence[EntityRow]) -> EntityRow:
    """차수 내림 → 별칭 수 내림 → 생성 오름 → id 오름.

    차수가 먼저인 이유: 관계가 많은 쪽이 그래프에서 더 많이 쓰이는 이름이고, 그쪽을
    남겨야 옮길 엣지가 적다.

    별칭 수가 두 번째인 이유는 실측으로 드러났다. 둘 다 차수 0이면 id 순으로 갈렸는데,
    id는 이름의 sha256이라 **사실상 무작위**였다 — "이차전지"(별칭 "2차전지"를 가진
    정본)가 별칭 없는 "2차전지"에게 지는 일이 생겼다. 상대의 이름을 이미 별칭으로 알고
    있는 쪽이 더 정리된 기록이므로 그쪽을 남긴다.

    뒤의 둘은 순수한 결정성 장치다 — 어떤 값이든 상관없지만 같은 입력에 같은 답이
    나와야 한다.
    """
    return min(
        members, key=lambda row: (-row.degree, -len(row.aliases), row.created_at, row.id)
    )


def _stage3_alias_pairs(rows: Sequence[EntityRow]) -> list[tuple[str, str, str]]:
    """별칭이 상대의 이름·별칭과 정확히 겹치는 쌍."""
    pairs: list[tuple[str, str, str]] = []
    for index, left in enumerate(rows):
        for right in rows[index + 1 :]:
            shared = _labels(left) & _labels(right)
            if shared:
                pairs.append((left.id, right.id, f"별칭 일치: {sorted(shared)[0]}"))
    return pairs


def _stage4_name_pairs(
    rows: Sequence[EntityRow], *, threshold: float
) -> list[tuple[str, str, str]]:
    """정규화 이름의 토큰 자카드가 임계 이상인 쌍."""
    pairs: list[tuple[str, str, str]] = []
    for index, left in enumerate(rows):
        for right in rows[index + 1 :]:
            score = _jaccard(_tokens(left.name), _tokens(right.name))
            if score >= threshold:
                pairs.append((left.id, right.id, f"이름 근접: {score:.2f}"))
    return pairs


def _stage5_structural_pairs(
    rows: Sequence[EntityRow],
    neighbours: dict[str, frozenset[str]],
    *,
    threshold: float,
) -> list[tuple[str, str, str]]:
    """이웃 집합이 충분히 겹치는 쌍. 이웃이 적은 노드는 보지 않는다."""
    pairs: list[tuple[str, str, str]] = []
    eligible = [
        row
        for row in rows
        if len(neighbours.get(row.id, frozenset())) >= MIN_STRUCTURAL_DEGREE
    ]
    for index, left in enumerate(eligible):
        for right in eligible[index + 1 :]:
            score = _jaccard(neighbours[left.id], neighbours[right.id])
            if score >= threshold:
                pairs.append((left.id, right.id, f"이웃 근접: {score:.2f}"))
    return pairs


class DedupService:
    """3·4·5단을 순서대로 돌려 엔티티를 접는다."""

    def __init__(
        self,
        graph: MergeTarget,
        *,
        name_similarity: float = DEFAULT_NAME_SIMILARITY,
        neighbour_similarity: float = DEFAULT_NEIGHBOUR_SIMILARITY,
    ) -> None:
        if not 0 < name_similarity <= 1:
            raise ValueError("name_similarity must be in (0, 1]")
        if not 0 < neighbour_similarity <= 1:
            raise ValueError("neighbour_similarity must be in (0, 1]")
        self._graph = graph
        self._name_similarity = name_similarity
        self._neighbour_similarity = neighbour_similarity

    async def run(self) -> DedupReport:
        rows = [row for row in await self._graph.entities() if self._is_mergeable(row)]

        # 이웃 집합은 **어떤 병합보다 먼저** 한 번에 읽는다.
        #
        # 종류별로 그때그때 읽으면 앞 종류의 병합이 뒤 종류의 구조적 근거를 지운다.
        # 실측한 예: 두 테마가 같은 두 기업을 이웃으로 갖는데, 기업 쪽이 먼저 접히면
        # 두 테마의 이웃이 하나로 줄어 `MIN_STRUCTURAL_DEGREE` 아래가 되고 5단이
        # 아예 보지 않게 된다. 결정적이긴 하지만 "company"가 "theme"보다 사전순으로
        # 앞선다는 이유로 결과가 달라지는 것은 근거가 아니다.
        neighbours = await self._neighbour_sets([row.id for row in rows])

        by_kind: dict[str, list[EntityRow]] = {}
        for row in rows:
            by_kind.setdefault(row.kind, []).append(row)

        decisions: list[MergeDecision] = []
        # 종류를 정렬해 도는 것도 결정성의 일부다 — 딕셔너리 순서에 기대지 않는다.
        for kind in sorted(by_kind):
            decisions.extend(
                await self._dedupe_one_kind(
                    sorted(by_kind[kind], key=lambda row: row.id), neighbours
                )
            )
        return DedupReport(decisions=tuple(decisions))

    @staticmethod
    def _is_mergeable(row: EntityRow) -> bool:
        """종목과 투자자 노드는 어떤 단계로도 접지 않는다.

        종목의 동일성은 문자열이 아니라 종목코드가 정한다. "삼성전자"와 "삼성전기"는
        4단 임계를 넘길 만큼 닮았지만 다른 회사이고, 접히는 순간 체결·잔고가 만든 사실이
        엉뚱한 종목에 붙는다 — 결정적 티어라 대화가 정정할 수도 없다.
        """
        try:
            kind = EntityKind(row.kind)
        except ValueError:
            # 온톨로지 밖 종류는 판단 근거가 없으므로 건드리지 않는다.
            return False
        return kind not in NEVER_MERGED

    async def _dedupe_one_kind(
        self, rows: list[EntityRow], neighbours: dict[str, frozenset[str]]
    ) -> list[MergeDecision]:
        if len(rows) < 2:
            return []

        union = _Union()
        reasons: dict[tuple[str, str], tuple[int, str]] = {}

        def absorb(stage: int, pairs: list[tuple[str, str, str]]) -> None:
            for left, right, why in pairs:
                key = (min(left, right), max(left, right))
                # 앞 단계가 이미 잡은 쌍은 다시 기록하지 않는다 — 근거가 더 센 쪽을 남긴다.
                if key not in reasons:
                    reasons[key] = (stage, why)
                union.union(left, right)

        absorb(3, _stage3_alias_pairs(rows))
        absorb(4, _stage4_name_pairs(rows, threshold=self._name_similarity))
        absorb(
            5,
            _stage5_structural_pairs(rows, neighbours, threshold=self._neighbour_similarity),
        )

        index = {row.id: row for row in rows}
        decisions: list[MergeDecision] = []
        for group in union.groups():
            members = [index[item] for item in group if item in index]
            if len(members) < 2:
                continue
            winner = _pick_winner(members)
            for loser in sorted(members, key=lambda row: row.id):
                if loser.id == winner.id:
                    continue
                key = (min(winner.id, loser.id), max(winner.id, loser.id))
                # 무리 안의 간접 연결(A-B, B-C에서 A-C)은 직접 근거가 없다. 그 경우
                # 무리를 이어준 가장 약한 단을 이유로 적는다 — 없는 근거를 지어내지 않는다.
                stage, why = reasons.get(key, (5, "무리 전이"))
                await self._graph.merge_entities(winner.id, loser.id)
                decisions.append(
                    MergeDecision(
                        winner_id=winner.id, loser_id=loser.id, stage=stage, reason=why
                    )
                )
        return decisions

    async def _neighbour_sets(self, ids: Sequence[GraphId]) -> dict[str, frozenset[str]]:
        result: dict[str, frozenset[str]] = {}
        for item in ids:
            edges = await self._graph.neighborhood(item, depth=1)
            result[item] = frozenset(
                edge.target_entity_id if edge.source_entity_id == item else edge.source_entity_id
                for edge in edges
            )
        return result


__all__ = [
    "DEFAULT_NAME_SIMILARITY",
    "DEFAULT_NEIGHBOUR_SIMILARITY",
    "MIN_STRUCTURAL_DEGREE",
    "NEVER_MERGED",
    "DedupReport",
    "DedupService",
    "MergeDecision",
    "MergeTarget",
]
