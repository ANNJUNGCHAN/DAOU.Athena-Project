"""`athena_brain` MCP 빌트인 — 읽기 전용 5액션.

leaf 7(2026-08-25). 이 스위트가 고정하는 계약 둘:

1. **쓰기 액션이 없다.** 모델이 그래프에 직접 쓸 수 있으면 대화 티어가 자기 주장을
   결정적 사실처럼 밀어 넣는 길이 생긴다. 쓰기는 사람의 채팅과 실제 체결·잔고에서만.
2. **꺼진 것과 고장난 것을 구분한다.** 브레인은 선택적 기능이라 503이 정상 상태일 수
   있다. 그걸 "성향 데이터가 없다"로 뭉뚱그리면 모델이 없는 사실을 단정한다.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from athena_mcp import brain_tools


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://backend.test"
    )


def _payload(result) -> Any:
    return json.loads(result.content[0].text)


# ── 툴 정의 ─────────────────────────────────────────────────────────────────


def test_exactly_one_tool_with_six_read_only_actions() -> None:
    defs = brain_tools.builtin_tool_defs()
    assert [tool.name for tool in defs] == ["athena_brain"]
    actions = defs[0].inputSchema["properties"]["action"]["enum"]
    # entity가 2026-09-03에 늘었다 — 노드 하나를 짚어 설명하는 읽기다.
    assert actions == ["profile", "god_nodes", "surprising", "questions", "diff", "entity"]
    assert len(actions) == 6


def test_no_write_action_exists() -> None:
    """쓰기처럼 들리는 어떤 이름도 허용목록에 없다."""
    for forbidden in ("write", "upsert", "merge", "delete", "reset", "ingest", "set"):
        assert forbidden not in brain_tools._ALLOWED_ACTIONS
        assert forbidden not in brain_tools._ROUTES


def test_the_description_warns_about_tier_and_ambiguity() -> None:
    """모델이 말과 행동을 뭉뚱그리지 않게 하는 것이 설명의 일이다."""
    description = brain_tools.builtin_tool_defs()[0].description
    assert "deterministic" in description
    assert "conversational" in description
    assert "AMBIGUOUS" in description


# ── 라우팅 ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("action", "expected_path"),
    [
        ("profile", "/api/v1/brain/profile-summary"),
        ("god_nodes", "/api/v1/brain/analysis/god-nodes"),
        ("surprising", "/api/v1/brain/analysis/surprising-connections"),
        ("questions", "/api/v1/brain/analysis/suggested-questions"),
        ("diff", "/api/v1/brain/analysis/diff"),
    ],
)
async def test_each_action_hits_its_endpoint(action: str, expected_path: str) -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json={"ok": True})

    async with _client(handler) as client:
        result = await brain_tools.dispatch({"action": action}, client)

    assert not result.isError
    assert seen == [expected_path]
    assert _payload(result) == {"ok": True}


async def test_only_declared_integer_params_are_forwarded() -> None:
    """모델이 아무 인자나 붙여도 백엔드로 새지 않는다."""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={})

    async with _client(handler) as client:
        await brain_tools.dispatch(
            {
                "action": "profile",
                "window_days": 30,
                "limit": 5,
                "from_revision": 7,  # profile에는 허용되지 않는 인자
                "sql": "DROP TABLE entities",  # 애초에 스키마 밖
                "limit_str": "5",
            },
            client,
        )

    assert seen == {"window_days": "30", "limit": "5"}


async def test_non_integer_values_are_dropped() -> None:
    """문자열 상한이 그대로 전달되면 백엔드가 422를 내고, 모델은 이유를 모른다."""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={})

    async with _client(handler) as client:
        await brain_tools.dispatch({"action": "god_nodes", "limit": "많이"}, client)

    assert seen == {}


# ── 거부와 실패 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("action", [None, "", "write", "merge_entities", 7])
async def test_unknown_actions_are_blocked_without_calling_the_backend(action: Any) -> None:
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    async with _client(handler) as client:
        result = await brain_tools.dispatch({"action": action}, client)

    assert result.isError
    assert not called, "거부는 백엔드를 건드리기 전에 일어나야 한다"
    assert "읽기 전용" in result.content[0].text


async def test_a_disabled_brain_is_distinguished_from_a_failure() -> None:
    """503은 "꺼져 있다"이지 "성향이 없다"가 아니다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "not ready"})

    async with _client(handler) as client:
        result = await brain_tools.dispatch({"action": "profile"}, client)

    assert result.isError
    text = result.content[0].text
    assert "준비되지 않았다" in text
    assert "단정하지 마라" in text


async def test_upstream_errors_are_reported_without_leaking_the_body() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Traceback: secret internal path /home/user/key")

    async with _client(handler) as client:
        result = await brain_tools.dispatch({"action": "profile"}, client)

    assert result.isError
    assert "secret" not in result.content[0].text
    assert "500" in result.content[0].text


async def test_a_transport_failure_does_not_retry() -> None:
    """재시도 없음 — 이 게이트웨이의 규율."""
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ConnectError("backend is down")

    async with _client(handler) as client:
        result = await brain_tools.dispatch({"action": "profile"}, client)

    assert result.isError
    assert attempts == 1


async def test_a_non_json_response_is_an_upstream_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not json</html>")

    async with _client(handler) as client:
        result = await brain_tools.dispatch({"action": "profile"}, client)

    assert result.isError
    assert "JSON" in result.content[0].text


# ── 서버 등록 ───────────────────────────────────────────────────────────────


def test_the_tool_is_registered_in_the_builtin_set() -> None:
    """정의만 있고 등록이 빠지면 모델에게는 존재하지 않는 툴이다."""
    from athena_mcp import server

    names = {tool.name for tool in server._builtin_tool_defs()}  # noqa: SLF001
    assert brain_tools.BRAIN_TOOL in names
    # 양성 대조: 이미 등록돼 있던 툴도 같은 조회로 잡힌다.
    from athena_mcp import routine_tools

    assert routine_tools.ROUTINE_TOOL in names


async def test_an_expose_gate_denial_is_distinguished_from_not_ready() -> None:
    """같은 503이라도 "사용자가 노출을 꺼 뒀다"(WP-I 게이트)와 "미기동"은 다르다."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "expose-to-model-disabled"})

    async with _client(handler) as client:
        result = await brain_tools.dispatch({"action": "profile"}, client)

    assert result.isError
    text = result.content[0].text
    assert "exposeToModel" in text
    assert "단정하지 마라" in text
    assert "준비되지 않았다" not in text, "게이트 차단을 기동 문제처럼 말하면 안 된다"


# ── WP-I 헤더 주입(selector_tools.default_http_client_factory) ────────────────


def test_default_http_client_declares_model_caller_and_bearer(monkeypatch) -> None:
    """G-I1 — 모델 경로의 모든 백엔드 호출은 X-Athena-Caller: model 자기신고와
    로컬 베어러를 싣는다(이 헤더가 없으면 브레인 라우트의 require_local_bearer를
    못 지나 MCP가 브레인을 우연히 못 부르던 상태가 유지된다)."""
    from athena_mcp import selector_tools

    monkeypatch.setenv("ATHENA_LOCAL_BEARER_TOKEN", "unit-test-token")
    client = selector_tools.default_http_client_factory()
    try:
        assert client.headers["X-Athena-Caller"] == "model"
        assert client.headers["Authorization"] == "Bearer unit-test-token"
    finally:
        del client


def test_default_http_client_omits_bearer_when_unconfigured(monkeypatch) -> None:
    """토큰 미설정 배포(루프백 게이트)에서는 Authorization을 아예 싣지 않는다 —
    빈 Bearer를 지어내지 않는다."""
    from athena_mcp import selector_tools

    monkeypatch.setenv("ATHENA_LOCAL_BEARER_TOKEN", "")
    monkeypatch.setattr(
        selector_tools, "read_local_bearer_token", lambda: None
    )
    client = selector_tools.default_http_client_factory()
    try:
        assert client.headers["X-Athena-Caller"] == "model"
        assert "Authorization" not in client.headers
    finally:
        del client


# ── action=entity (2026-09-03, "이 노드 설명해줘") ───────────────────────────────


async def test_entity_action_hits_the_detail_endpoint_with_the_name() -> None:
    seen: list[tuple[str, dict[str, str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.path, dict(request.url.params)))
        return httpx.Response(200, json={"resolved": True})

    async with _client(handler) as client:
        result = await brain_tools.dispatch(
            {"action": "entity", "entity": "한미반도체", "limit": 20}, client
        )

    assert not result.isError
    assert seen == [
        ("/api/v1/brain/analysis/entity-detail", {"entity": "한미반도체", "limit": "20"})
    ]


async def test_entity_action_forwards_an_entity_id_unchanged() -> None:
    """화면이 고른 노드는 id로 온다 — 이름으로 되돌리려 하면 안 된다."""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={})

    async with _client(handler) as client:
        await brain_tools.dispatch({"action": "entity", "entity": "entity:abc123"}, client)

    assert seen == {"entity": "entity:abc123"}


@pytest.mark.parametrize("bad", [None, "", "   ", 7, True, [], {"name": "x"}])
async def test_entity_action_without_a_usable_entity_is_blocked_before_the_backend(
    bad: Any,
) -> None:
    """무엇을 설명할지 모르는 채로 백엔드를 부르면 422가 오고 모델은 이유를 모른다."""
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={})

    async with _client(handler) as client:
        arguments: dict[str, Any] = {"action": "entity"}
        if bad is not None:
            arguments["entity"] = bad
        result = await brain_tools.dispatch(arguments, client)

    assert result.isError
    assert not called


async def test_entity_is_not_forwarded_to_actions_that_do_not_take_it() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={})

    async with _client(handler) as client:
        await brain_tools.dispatch(
            {"action": "god_nodes", "entity": "한미반도체", "limit": 3}, client
        )

    assert seen == {"limit": "3"}


async def test_booleans_are_not_smuggled_in_as_integers() -> None:
    """파이썬에서 isinstance(True, int)는 참이다 — limit=True가 limit=1로 통하면 안 된다."""
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json={})

    async with _client(handler) as client:
        await brain_tools.dispatch({"action": "god_nodes", "limit": True}, client)

    assert seen == {}


def test_the_description_tells_the_model_to_quote_the_source_excerpt() -> None:
    """근거를 인용하라고 적지 않으면 모델이 rationale 요약만 되풀이한다."""
    description = brain_tools.builtin_tool_defs()[0].description
    assert "source.text" in description
    assert "truncated" in description


def test_the_new_action_is_still_a_read() -> None:
    """entity가 늘어도 쓰기 부재 계약은 그대로다."""
    for forbidden in ("write", "upsert", "merge", "delete", "reset", "ingest", "set"):
        assert forbidden not in brain_tools._ALLOWED_ACTIONS
        assert forbidden not in brain_tools._ROUTES
    for path, _ in brain_tools._ROUTES.values():
        assert "analysis" in path or "profile-summary" in path
