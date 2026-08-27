"""athena_nudge_guard(F4) — propose/get만, 무재시도, 사람 전용 확정 차단."""

from __future__ import annotations

import json

import httpx
import pytest

from athena_mcp import nudge_guard_tools
from athena_mcp.result import ERROR_ORIGIN_META_KEY

# `mock_http_client` 픽스처는 tests/mcp/conftest.py에서 온다(test_routine_tools.py와 공유).


def test_tool_schema_only_allows_propose_and_get():
    (tool,) = nudge_guard_tools.builtin_tool_defs()
    assert tool.name == "athena_nudge_guard"
    assert tool.inputSchema["properties"]["action"]["enum"] == ["propose", "get"]
    # 설명이 정직성 계약을 담는다 — 확인 전 미반영.
    assert "저장이 아니다" in tool.description


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["post", "confirm", "save", "set", None, 5])
async def test_confirm_actions_are_gateway_blocked(action, mock_http_client):
    async def handler(request):  # 호출 자체가 없어야 한다
        raise AssertionError("사람 전용 확정 액션이 백엔드에 도달했다")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await nudge_guard_tools.dispatch({"action": action}, client)
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"
    assert "사용자가 앱에서 직접" in result.content[0].text


@pytest.mark.asyncio
async def test_get_proxies_get(mock_http_client):
    async def handler(request):
        assert request.method == "GET"
        assert request.url.path == "/api/v1/nudge-guard"
        return httpx.Response(200, json={"max_daily_nudges": 2})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await nudge_guard_tools.dispatch({"action": "get"}, client)
    assert not result.isError
    assert json.loads(result.content[0].text)["max_daily_nudges"] == 2


@pytest.mark.asyncio
async def test_propose_bundles_current_and_proposed_without_ever_writing(mock_http_client):
    """propose는 비영속 게이트다 — GET만 부르고 POST/PUT은 절대 안 부른다."""
    calls: list[str] = []

    async def handler(request):
        calls.append(request.method)
        assert request.method == "GET"
        return httpx.Response(200, json={"max_daily_nudges": 2, "show_rationale": True})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await nudge_guard_tools.dispatch(
            {"action": "propose", "propose": {"max_daily_nudges": 1}}, client
        )
    assert calls == ["GET"]  # POST가 한 번도 안 나갔다
    assert not result.isError
    payload = json.loads(result.content[0].text)
    assert payload["current"]["max_daily_nudges"] == 2
    assert payload["proposed"]["max_daily_nudges"] == 1
    assert "확인" in payload["notice"]


@pytest.mark.asyncio
async def test_backend_error_is_translated_without_retry(mock_http_client):
    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        return httpx.Response(500, json={"detail": "unexpected upstream failure"})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await nudge_guard_tools.dispatch({"action": "get"}, client)
    assert calls["n"] == 1  # 무재시도
    assert result.isError
    assert "unexpected upstream failure" in result.content[0].text


@pytest.mark.asyncio
async def test_backend_down_says_do_not_pretend(mock_http_client):
    async def handler(request):
        raise httpx.ConnectError("refused")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await nudge_guard_tools.dispatch({"action": "get"}, client)
    assert result.isError
    assert "가드 설정이 바뀌었다고 말하지 마라" in result.content[0].text


def test_the_tool_is_registered_in_the_builtin_set():
    """정의만 있고 등록이 빠지면 모델에게는 존재하지 않는 툴이다(server.py 배선)."""
    from athena_mcp import server

    names = {tool.name for tool in server._builtin_tool_defs()}  # noqa: SLF001
    assert nudge_guard_tools.NUDGE_GUARD_TOOL in names
