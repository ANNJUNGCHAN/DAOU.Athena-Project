"""athena_routine(US-010) — draft/list만, 무재시도, 사람 전용 액션 차단."""

from __future__ import annotations

import json

import httpx
import pytest

from athena_mcp import routine_tools
from athena_mcp.result import ERROR_ORIGIN_META_KEY

# `_client` 헬퍼는 tests/mcp/conftest.py의 `mock_http_client` 픽스처로 옮겼다
# (2026-08-20 포니테일 감사 — 4파일 중복 제거). 이 파일은 백엔드 기본값과
# 다른 base_url(127.0.0.1:8010)을 명시적으로 넘긴다.


def test_tool_schema_only_allows_draft_and_list():
    (tool,) = routine_tools.builtin_tool_defs()
    assert tool.name == "athena_routine"
    assert tool.inputSchema["properties"]["action"]["enum"] == ["draft", "list"]
    # 설명이 정직성 계약을 담는다 — 승인 전 미등록·자동 집행 없음.
    assert "등록이 아니다" in tool.description
    assert "자동 집행되지 않는다" in tool.description


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["confirm", "cancel", "activate", None, 5])
async def test_state_changing_actions_are_gateway_blocked(action, mock_http_client):
    async def handler(request):  # 호출 자체가 없어야 한다
        raise AssertionError("사람 전용 액션이 백엔드에 도달했다")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch({"action": action}, client)
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"
    assert "사용자가 앱에서 직접" in result.content[0].text


@pytest.mark.asyncio
async def test_list_proxies_get(mock_http_client):
    async def handler(request):
        assert request.method == "GET"
        assert request.url.path == "/api/v1/routines"
        return httpx.Response(200, json={"routines": [], "disclosure_ready": False})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch({"action": "list"}, client)
    assert not result.isError
    assert json.loads(result.content[0].text)["routines"] == []


@pytest.mark.asyncio
async def test_draft_proxies_post_and_appends_notice(mock_http_client):
    async def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/api/v1/routines/draft"
        return httpx.Response(200, json={"id": "r1", "status": "draft"})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch(
            {"action": "draft", "draft": {"symbol": "005930"}}, client
        )
    payload = json.loads(result.content[0].text)
    assert payload["status"] == "draft"
    assert "승인" in payload["notice"]  # 제안일 뿐 등록 아님을 응답이 직접 말한다


@pytest.mark.asyncio
async def test_validation_error_is_translated_without_retry(mock_http_client):
    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        return httpx.Response(
            422, json={"detail": "루틴 조건이 유효하지 않다", "message": "source가 없다"}
        )

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch(
            {"action": "draft", "draft": {}}, client
        )
    assert calls["n"] == 1  # 무재시도
    assert result.isError
    assert "루틴 조건이 유효하지 않다" in result.content[0].text


@pytest.mark.asyncio
async def test_backend_down_says_do_not_pretend(mock_http_client):
    async def handler(request):
        raise httpx.ConnectError("refused")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch({"action": "list"}, client)
    assert result.isError
    assert "등록됐다고 말하지 마라" in result.content[0].text
