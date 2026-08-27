"""군집 LLM 의미 라벨링(WP-F) — 짧은 프롬프트, 짧은 타임아웃, 실패는 폴백.

`cluster_representative_labels()`(projection.py)가 내는 기계적 설명과 달리 여기는
LLM이 지은 **추정 이름**이다 — 응답 필드(`cluster_ai_labels`)와 화면 배지("AI 추정")
로 항상 구분해 표기한다(§1 원칙2). 실패·타임아웃·파싱불가는 전부 `None`으로
흡수되어 규칙 기반 대표 설명으로 자동 폴백된다 — 정보 손실도 응답 지연도 없다.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable

import networkx as nx

from athena_api.brain.extraction import StructuredLlmClient

# 프롬프트에 넣을 군집 멤버 상한(G-F6) — 차수 상위, 대표 설명 로직과 동일 기준.
PROMPT_MEMBER_CAP = 12

_LABELING_SYSTEM = (
    "다음은 한 투자자의 관심 그래프에서 함께 묶인 엔티티들이다. "
    "이 군집을 대표하는 짧은 한국어 이름 하나를 지어라(8자 이내 권장). "
    '다른 텍스트 없이 반드시 {"label": "이름"} 형태의 JSON 하나만 출력하라.'
)


def labeling_prompt_fingerprint() -> str:
    """라벨링 프롬프트의 지문 — `extraction.prompt_fingerprint()`와 같은 이유(프롬프트
    변경 시 캐시 자동 무효화)로 두되, 프롬프트가 서로 다르니 지문도 따로 둔다."""
    return hashlib.sha256(_LABELING_SYSTEM.encode("utf-8")).hexdigest()[:16]


def member_set_hash(members: Iterable[str]) -> str:
    """군집 멤버 집합의 안정 해시 — 캐시 키(G-F4).

    군집 번호는 리비전마다 흔들릴 수 있지만 멤버 집합은 내용이 같으면 같다 —
    번호 대신 집합을 키로 쓰는 이유다. 정렬 후 이어붙여 순서 무관하게 만든다.
    """
    canon = "\n".join(sorted(members))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:32]


def select_prompt_members(
    members: Iterable[str], graph: nx.Graph, cap: int = PROMPT_MEMBER_CAP
) -> list[str]:
    """차수 상위 cap명 — `cluster_representative_labels()`의 대표 선정과 동일 기준
    (-차수, 동률이면 최소 id)이라 두 표기가 서로 어긋나지 않는다(G-F6)."""
    return sorted(members, key=lambda n: (-graph.degree(n), n))[:cap]


def build_labeling_prompt(
    members: Iterable[str], graph: nx.Graph, cap: int = PROMPT_MEMBER_CAP
) -> str:
    """엔티티 이름+kind만 싣는다 — 원본 대화 텍스트를 넣지 않아 프롬프트가 짧고
    인젝션 표면도 최소다."""
    chosen = select_prompt_members(members, graph, cap)
    lines = [
        f"- {graph.nodes[n].get('name') or n} ({graph.nodes[n].get('kind', '')})"
        for n in chosen
    ]
    return _LABELING_SYSTEM + "\n\n" + "\n".join(lines)


async def label_cluster(
    client: StructuredLlmClient | None,
    members: Iterable[str],
    graph: nx.Graph,
    *,
    cap: int = PROMPT_MEMBER_CAP,
) -> str | None:
    """LLM에게 군집 이름을 한 번 묻는다 — 재시도 없음.

    client가 없으면(추출 argv 미설정 = 라벨링 휴면, G-F1) 즉시 `None`.
    실패·타임아웃·파싱불가·형식 위반 전부 `None` — 호출자는 규칙 기반 대표
    설명으로 폴백한다.
    """
    member_list = list(members)
    if client is None or not member_list:
        return None
    prompt = build_labeling_prompt(member_list, graph, cap)
    try:
        raw = await client.complete(prompt)
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    label = payload.get("label")
    if not isinstance(label, str) or not label.strip():
        return None
    return label.strip()


async def ensure_cluster_label(
    store,
    client: StructuredLlmClient | None,
    members: Iterable[str],
    graph: nx.Graph,
    *,
    cap: int = PROMPT_MEMBER_CAP,
) -> str | None:
    """캐시 우선 — 히트면 LLM을 부르지 않는다(비용·지연 0).

    미스면 라벨링을 시도하고 성공 시 `cluster_labels`에 저장해 다음 요청부터
    히트가 된다. 저장 실패는 이번 라벨의 유효성과 무관하다 — 다음 요청이 다시
    만든다.
    """
    member_list = list(members)
    if not member_list:
        return None
    key = member_set_hash(member_list)
    fingerprint = labeling_prompt_fingerprint()
    cached = await store.cluster_label(key, fingerprint)
    if cached is not None:
        return cached
    label = await label_cluster(client, member_list, graph, cap=cap)
    if label is None:
        return None
    try:
        await store.save_cluster_label(
            key, cluster_size=len(member_list), label=label, prompt_fingerprint=fingerprint
        )
    except Exception:
        pass
    return label


__all__ = [
    "PROMPT_MEMBER_CAP",
    "build_labeling_prompt",
    "ensure_cluster_label",
    "label_cluster",
    "labeling_prompt_fingerprint",
    "member_set_hash",
    "select_prompt_members",
]
