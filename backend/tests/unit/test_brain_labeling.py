"""군집 LLM 라벨링 서비스(WP-F F3) — 실패는 전부 None, 캐시 히트는 LLM 미호출."""

from __future__ import annotations

import asyncio

import networkx as nx
import pytest

from athena_api.brain import labeling

pytestmark = pytest.mark.deterministic


def _graph(names: dict[str, tuple[str, str]], edges: list[tuple[str, str]]) -> nx.Graph:
    graph = nx.Graph()
    for node, (name, kind) in names.items():
        graph.add_node(node, name=name, kind=kind)
    graph.add_edges_from(edges)
    return graph


class FakeLlm:
    """녹화 응답 주입 — StructuredLlmClient 프로토콜의 테스트 구현."""

    def __init__(self, raw: bytes | Exception) -> None:
        self._raw = raw
        self.calls: list[str] = []

    async def complete(self, prompt: str) -> bytes:
        self.calls.append(prompt)
        if isinstance(self._raw, Exception):
            raise self._raw
        return self._raw


class FakeStore:
    def __init__(self, cached: str | None = None) -> None:
        self._cached = cached
        self.saved: list[tuple[str, str, str]] = []

    async def cluster_label(self, member_hash: str, prompt_fingerprint: str) -> str | None:
        return self._cached

    async def save_cluster_label(
        self, member_hash: str, *, cluster_size: int, label: str, prompt_fingerprint: str
    ) -> None:
        self.saved.append((member_hash, label, prompt_fingerprint))


GRAPH = _graph(
    {
        "e:a": ("삼성전자", "stock"),
        "e:b": ("SK하이닉스", "stock"),
        "e:c": ("HBM", "theme"),
    },
    [("e:a", "e:b"), ("e:a", "e:c")],
)


def test_member_set_hash_is_order_independent() -> None:
    assert labeling.member_set_hash(["e:a", "e:b"]) == labeling.member_set_hash(["e:b", "e:a"])
    assert labeling.member_set_hash(["e:a"]) != labeling.member_set_hash(["e:a", "e:b"])


def test_select_prompt_members_caps_by_degree_then_id() -> None:
    # e:a 차수 2 > e:b/e:c 차수 1(동률이면 최소 id) — 대표 선정 기준과 동일(G-F6).
    assert labeling.select_prompt_members(["e:a", "e:b", "e:c"], GRAPH, cap=2) == ["e:a", "e:b"]


def test_prompt_contains_names_and_kinds_only() -> None:
    prompt = labeling.build_labeling_prompt(["e:a", "e:c"], GRAPH)
    assert "삼성전자" in prompt
    assert "theme" in prompt
    assert "e:a" not in prompt, "해시 id가 아니라 사람이 읽는 이름을 싣는다"


async def test_label_cluster_success() -> None:
    client = FakeLlm('{"label": "반도체 밸류체인"}'.encode())
    label = await labeling.label_cluster(client, ["e:a", "e:b"], GRAPH)
    assert label == "반도체 밸류체인"
    assert len(client.calls) == 1


async def test_label_cluster_absorbs_timeout() -> None:
    client = FakeLlm(asyncio.TimeoutError())
    assert await labeling.label_cluster(client, ["e:a"], GRAPH) is None


async def test_label_cluster_absorbs_unparsable_output() -> None:
    assert await labeling.label_cluster(FakeLlm(b"not json"), ["e:a"], GRAPH) is None
    assert await labeling.label_cluster(FakeLlm(b'["list"]'), ["e:a"], GRAPH) is None
    assert await labeling.label_cluster(FakeLlm(b'{"label": "  "}'), ["e:a"], GRAPH) is None


async def test_label_cluster_dormant_without_client() -> None:
    # G-F1 — 추출 argv 미설정이면 client가 None이고 라벨링은 조용히 휴면한다.
    assert await labeling.label_cluster(None, ["e:a"], GRAPH) is None


async def test_ensure_cluster_label_cache_hit_skips_llm() -> None:
    client = FakeLlm('{"label": "새 라벨"}'.encode())
    store = FakeStore(cached="캐시된 라벨")
    label = await labeling.ensure_cluster_label(store, client, ["e:a"], GRAPH)
    assert label == "캐시된 라벨"
    assert client.calls == [], "캐시 히트면 LLM을 부르지 않는다"


async def test_ensure_cluster_label_miss_labels_and_saves() -> None:
    client = FakeLlm('{"label": "반도체"}'.encode())
    store = FakeStore(cached=None)
    label = await labeling.ensure_cluster_label(store, client, ["e:a", "e:b"], GRAPH)
    assert label == "반도체"
    assert len(store.saved) == 1
    member_hash, saved_label, fingerprint = store.saved[0]
    assert member_hash == labeling.member_set_hash(["e:a", "e:b"])
    assert saved_label == "반도체"
    assert fingerprint == labeling.labeling_prompt_fingerprint()


async def test_ensure_cluster_label_failure_saves_nothing() -> None:
    store = FakeStore(cached=None)
    assert await labeling.ensure_cluster_label(store, FakeLlm(b"bad"), ["e:a"], GRAPH) is None
    assert store.saved == []
