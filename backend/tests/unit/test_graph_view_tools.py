"""`athena_graph_view` — 채팅이 그래프 화면을 움직이는 빌트인.

이 도구의 핵심 성질 둘을 여기서 고정한다.
1. **백엔드를 타지 않는다** — `dispatch()`가 http_client를 아예 받지 않는다.
2. **그래프에 쓰지 않는다** — `propose_edit`도 카드를 띄우는 것이 전부다.
"""

from __future__ import annotations

import inspect
import json
from typing import Any

import pytest

from athena_mcp import graph_view_tools

# 결정층(leaf 9) — LLM도 난수도 네트워크도 타지 않는다.
pytestmark = pytest.mark.deterministic


def _payload(result: Any) -> dict[str, Any]:
    block = result.content[0]
    return json.loads(block.text)


# ── 도구 표면 ────────────────────────────────────────────────────────────────


def test_exactly_one_tool_with_five_actions() -> None:
    defs = graph_view_tools.builtin_tool_defs()
    assert [tool.name for tool in defs] == ["athena_graph_view"]
    actions = defs[0].inputSchema["properties"]["action"]["enum"]
    assert actions == ["navigate", "select", "filter", "fit", "propose_edit"]


def test_dispatch_takes_no_http_client() -> None:
    """백엔드를 타지 않는다는 성질을 서명이 증명한다 — 다른 빌트인과 다른 점이다."""
    params = list(inspect.signature(graph_view_tools.dispatch).parameters)
    assert params == ["arguments"]


def test_no_write_action_exists() -> None:
    """쓰기처럼 들리는 어떤 이름도 허용목록에 없다(brain_tools와 같은 계약)."""
    for forbidden in ("write", "upsert", "merge", "delete", "remove", "apply", "commit"):
        assert forbidden not in graph_view_tools._ALLOWED_ACTIONS


def test_the_description_tells_the_model_not_to_claim_it_edited(
) -> None:
    """모델이 "고쳤다"고 말하면 사용자는 누르지 않은 것을 눌렀다고 믿는다."""
    description = graph_view_tools.builtin_tool_defs()[0].description
    assert "제안만" in description
    assert "고쳤다" in description


def test_filter_options_match_the_renderer_contract() -> None:
    """graph-filters.js의 선택지와 어긋나면 걸 수 없는 조건을 건 척하게 된다."""
    assert graph_view_tools._WINDOW_DAYS == (30, 90, 180, 365)
    assert graph_view_tools._MIN_DEGREES == (0, 2, 3, 5)
    assert graph_view_tools._SUMMARY_SORTS == ("reinforcement", "recent")


# ── navigate ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("surface", ["summary", "map", "settings"])
async def test_navigate_delivers_the_surface_to_the_canvas(surface: str) -> None:
    result = await graph_view_tools.dispatch({"action": "navigate", "surface": surface})
    assert not result.isError
    payload = _payload(result)
    assert payload["delivered"] == "canvas"
    assert payload["kind"] == "navigate"
    assert payload["surface"] == surface


@pytest.mark.parametrize("surface", [None, "", "graph", "요약", 3, True])
async def test_navigate_without_a_known_surface_is_blocked(surface: Any) -> None:
    arguments: dict[str, Any] = {"action": "navigate"}
    if surface is not None:
        arguments["surface"] = surface
    result = await graph_view_tools.dispatch(arguments)
    assert result.isError


# ── select ──────────────────────────────────────────────────────────────────


async def test_select_carries_the_entity_id_unchanged() -> None:
    result = await graph_view_tools.dispatch(
        {"action": "select", "entity": "entity:abc123"}
    )
    payload = _payload(result)
    assert payload["kind"] == "select"
    assert payload["entity_id"] == "entity:abc123"


async def test_select_says_nothing_happens_for_an_id_that_is_not_on_screen() -> None:
    """화면에 없는 id면 조용히 아무 일도 안 일어난다 — 모델이 그것을 알아야 한다."""
    payload = _payload(
        await graph_view_tools.dispatch({"action": "select", "entity": "entity:x"})
    )
    assert "아무 일도" in payload["notice"]


@pytest.mark.parametrize("entity", [None, "", "   ", 7, True, [], {}])
async def test_select_without_a_usable_entity_is_blocked(entity: Any) -> None:
    arguments: dict[str, Any] = {"action": "select"}
    if entity is not None:
        arguments["entity"] = entity
    result = await graph_view_tools.dispatch(arguments)
    assert result.isError


# ── filter ──────────────────────────────────────────────────────────────────


async def test_filter_sends_only_what_was_asked_for() -> None:
    payload = _payload(
        await graph_view_tools.dispatch({"action": "filter", "window_days": 365})
    )
    assert payload["kind"] == "filter"
    assert payload["patch"] == {"windowDays": 365}


async def test_filter_can_set_all_three_at_once() -> None:
    payload = _payload(
        await graph_view_tools.dispatch(
            {
                "action": "filter",
                "window_days": 30,
                "min_degree": 2,
                "summary_sort": "recent",
            }
        )
    )
    assert payload["patch"] == {
        "windowDays": 30,
        "minDegree": 2,
        "summarySort": "recent",
    }


async def test_filter_with_nothing_to_set_is_blocked() -> None:
    """빈 필터를 보내면 화면은 그대로인데 모델은 걸었다고 말한다."""
    assert (await graph_view_tools.dispatch({"action": "filter"})).isError


@pytest.mark.parametrize(
    "arguments",
    [
        {"action": "filter", "window_days": 7},
        {"action": "filter", "min_degree": 4},
        {"action": "filter", "summary_sort": "보강순"},
    ],
)
async def test_filter_rejects_values_the_renderer_cannot_apply(
    arguments: dict[str, Any],
) -> None:
    assert (await graph_view_tools.dispatch(arguments)).isError


@pytest.mark.parametrize("arguments", [
    {"action": "filter", "window_days": "365"},
    {"action": "filter", "min_degree": True},
])
async def test_filter_drops_wrongly_typed_values_instead_of_guessing(
    arguments: dict[str, Any],
) -> None:
    """문자열 "365"를 365로 읽어 주면 모델이 타입을 배우지 못한다 — 걸 것이 없어 막힌다.

    `min_degree=True`는 파이썬에서 `isinstance(True, int)`가 참이라 조용히 1로
    통할 수 있는 값이다. 1은 애초에 선택지에도 없다.
    """
    assert (await graph_view_tools.dispatch(arguments)).isError


async def test_filter_accepts_min_degree_zero_as_a_real_choice() -> None:
    """0은 "전체"라는 뜻이 있는 값이다 — falsy라고 빠뜨리면 필터를 풀 수 없다."""
    payload = _payload(
        await graph_view_tools.dispatch({"action": "filter", "min_degree": 0})
    )
    assert payload["patch"] == {"minDegree": 0}


# ── fit ─────────────────────────────────────────────────────────────────────


async def test_fit_needs_no_arguments() -> None:
    payload = _payload(await graph_view_tools.dispatch({"action": "fit"}))
    assert payload["kind"] == "fit"
    assert payload["delivered"] == "canvas"


# ── propose_edit (쓰기가 아니다) ─────────────────────────────────────────────


async def test_propose_edit_delivers_a_card_and_says_nothing_changed() -> None:
    payload = _payload(
        await graph_view_tools.dispatch(
            {
                "action": "propose_edit",
                "edit": {
                    "op": "remove",
                    "object": "2차전지",
                    "relation": "interested_in",
                    "reason": "3주 전 한 번 언급 후 계속 회피",
                },
            }
        )
    )
    assert payload["kind"] == "edit_proposal"
    assert payload["op"] == "remove"
    assert payload["object"] == "2차전지"
    assert payload["relation"] == "interested_in"
    assert payload["reason"] == "3주 전 한 번 언급 후 계속 회피"
    # 이 문장이 사라지면 모델이 "지웠다"고 말하기 시작한다.
    assert "아직 아무것도 바뀌지 않았다" in payload["notice"]


async def test_propose_edit_leaves_the_subject_implicit_when_omitted() -> None:
    """성향 관계의 주체는 언제나 투자자다 — 성향 신호 표도 "내가"를 적지 않는다."""
    payload = _payload(
        await graph_view_tools.dispatch(
            {
                "action": "propose_edit",
                "edit": {"op": "add", "object": "헬스케어", "relation": "interested_in"},
            }
        )
    )
    assert payload["subject"] is None
    assert payload["reason"] is None


async def test_propose_edit_keeps_an_explicit_subject() -> None:
    payload = _payload(
        await graph_view_tools.dispatch(
            {
                "action": "propose_edit",
                "edit": {
                    "op": "change",
                    "subject": "한미반도체",
                    "object": "배당 방어 바스켓",
                    "relation": "relates_to",
                },
            }
        )
    )
    assert payload["subject"] == "한미반도체"


@pytest.mark.parametrize(
    "edit",
    [
        None,
        "지워줘",
        {},
        {"op": "add"},
        {"op": "지우기", "object": "x", "relation": "y"},
        {"op": "add", "object": "", "relation": "y"},
        {"op": "add", "object": "x", "relation": "   "},
        {"op": "add", "object": "x"},
    ],
)
async def test_propose_edit_refuses_an_incomplete_proposal(edit: Any) -> None:
    """무엇을 어떻게 고칠지 모르는 카드를 띄우면 사람이 답할 수 없다."""
    arguments: dict[str, Any] = {"action": "propose_edit"}
    if edit is not None:
        arguments["edit"] = edit
    result = await graph_view_tools.dispatch(arguments)
    assert result.isError
    # 막을 때는 회복 경로까지 적는다(2026-09-03 실사용으로 발견). 이 막음이
    # isError로 끝나면 셸은 카드를 안 띄우고(main.js maybeForwardGraphChatAction)
    # 사람에게는 "편집 도구가 응답하지 않는다"로만 보인다 — 실제로 확정 카드가
    # 한 번도 뜨지 않았다. 모델이 다음에 무엇을 부를지 알아야 스스로 회복한다.
    text = "".join(getattr(block, "text", "") for block in result.content)
    assert "athena_brain action=entity" in text, text
    assert "클릭하라고 떠넘기지 마라" in text, text


# ── 알 수 없는 액션 ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("action", [None, "", "write", "apply_edit", "zoom", 7, True])
async def test_unknown_actions_are_blocked(action: Any) -> None:
    arguments: dict[str, Any] = {}
    if action is not None:
        arguments["action"] = action
    result = await graph_view_tools.dispatch(arguments)
    assert result.isError


def test_the_tool_is_registered_in_the_builtin_set() -> None:
    from athena_mcp import server

    names = [tool.name for tool in server._builtin_tool_defs()]
    assert "athena_graph_view" in names
