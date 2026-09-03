"""athena_routine(US-010) — draft/list/propose만, 무재시도, 사람 전용 액션 차단."""

from __future__ import annotations

import json

import httpx
import pytest

from athena_mcp import routine_tools
from athena_mcp.result import ERROR_ORIGIN_META_KEY

# `_client` 헬퍼는 tests/mcp/conftest.py의 `mock_http_client` 픽스처로 옮겼다.
# 이 파일은 백엔드 기본값과 다른 base_url(127.0.0.1:8010)을 명시적으로 넘긴다.


def test_tool_schema_allows_draft_list_and_propose():
    (tool,) = routine_tools.builtin_tool_defs()
    assert tool.name == "athena_routine"
    assert tool.inputSchema["properties"]["action"]["enum"] == [
        "draft",
        "list",
        "propose",
    ]
    assert tool.inputSchema["properties"]["propose"]["properties"]["control"][
        "enum"
    ] == [
        "confirm",
        "update",
        "pause",
        "resume",
        "cancel",
        "ack",
        "ack_all",
        "adopt",
        "hold",
        "guard",
        "fire",
        "view",
    ]
    # 설명이 정직성 계약을 담는다 — 승인 전 미등록·자동 집행 없음.
    assert "등록이 아니다" in tool.description
    assert "자동 집행되지 않는다" in tool.description
    schema_text = json.dumps(tool.inputSchema, ensure_ascii=False)
    assert "disclosure.title_keyword" not in schema_text
    assert "앱 플러그인" in schema_text


def test_tool_schema_goal_field_is_conservative():
    (tool,) = routine_tools.builtin_tool_defs()
    goal_schema = tool.inputSchema["properties"]["draft"]["properties"]["goal"]
    assert goal_schema["type"] == "boolean"
    # 애매하면 생략하라는 보수적 지침이 스키마 설명에 있어야 한다(오분류 완화).
    assert "명시적으로" in goal_schema["description"]
    assert "애매하면 생략" in goal_schema["description"]


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
        return httpx.Response(200, json={"routines": []})

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


@pytest.mark.asyncio
@pytest.mark.parametrize("control", list(routine_tools._CONTROL_ACTIONS))
async def test_propose_only_reads_list(control, mock_http_client):
    """제안은 실행이 아니다 — 목록 GET 한 번 말고는 어떤 호출도 없어야 한다."""
    seen: set[tuple[str, str]] = set()

    async def handler(request):
        if request.method != "GET" or request.url.path != "/api/v1/routines":
            raise AssertionError(
                f"제안이 실행 경로를 건드렸다: {request.method} {request.url.path}"
            )
        seen.add((request.method, request.url.path))
        return httpx.Response(
            200, json={"routines": [{"id": "r1", "note": "현재 조건"}]}
        )

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch(
            {
                "action": "propose",
                "propose": {
                    "control": control,
                    "routine_id": "r1",
                    "rationale": "근거 1줄",
                },
            },
            client,
        )
    assert seen == {("GET", "/api/v1/routines")}
    assert not result.isError
    payload = json.loads(result.content[0].text)
    assert payload["control"] == control
    assert payload["current"] == {"id": "r1", "note": "현재 조건"}
    assert payload["notice"]


@pytest.mark.asyncio
async def test_propose_rejects_unknown_control(mock_http_client):
    async def handler(request):  # 호출 자체가 없어야 한다
        raise AssertionError("알 수 없는 control이 백엔드에 도달했다")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch(
            {"action": "propose", "propose": {"control": "delete_everything"}},
            client,
        )
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "proposed",
    [
        {"condition": {"op": ">", "value": 100}},  # 중첩 형태
        {"condition.op": ">"},  # 평면 형태
    ],
)
async def test_propose_update_rejects_condition_keys(proposed, mock_http_client):
    """조건 편집은 대화 경로에 없다 — 06 설정 폼에서 사람이 직접 고친다."""

    async def handler(request):
        raise AssertionError("조건 편집 제안이 백엔드에 도달했다")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await routine_tools.dispatch(
            {
                "action": "propose",
                "propose": {
                    "control": "update",
                    "routine_id": "r1",
                    "proposed": proposed,
                },
            },
            client,
        )
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"
