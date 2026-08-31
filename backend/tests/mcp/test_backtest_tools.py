"""athena_backtest — list_presets/list_indicators/validate/plan/run/status/result만,
무재시도, backfill·activate 부재(사람 전용 액션 차단)."""

from __future__ import annotations

import json

import httpx
import pytest

from athena_mcp import backtest_tools
from athena_mcp.result import ERROR_ORIGIN_META_KEY

# `_client` 헬퍼는 tests/mcp/conftest.py의 `mock_http_client` 픽스처로 옮겼다.
# 이 파일은 백엔드 기본값과 다른 base_url(127.0.0.1:8010)을 명시적으로 넘긴다.


def test_tool_schema_lists_seven_actions_only():
    (tool,) = backtest_tools.builtin_tool_defs()
    assert tool.name == "athena_backtest"
    assert tool.inputSchema["properties"]["action"]["enum"] == [
        "list_presets", "list_indicators", "validate", "plan", "run", "status", "result",
    ]
    # backfill·activate는 이 툴에 없다는 것을 설명문이 명시한다.
    assert "backfill" in tool.description or "백필" in tool.description
    assert "사람이" in tool.description or "사용자가" in tool.description


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["backfill", "activate", "propose_code", None, 5])
async def test_state_changing_actions_are_gateway_blocked(action, mock_http_client):
    async def handler(request):  # 호출 자체가 없어야 한다
        raise AssertionError("사람 전용 액션이 백엔드에 도달했다")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch({"action": action}, client)
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"
    assert "사용자가 앱에서 직접" in result.content[0].text


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["status", "result"])
async def test_status_and_result_require_run_id(action, mock_http_client):
    async def handler(request):
        raise AssertionError("run_id 없이 백엔드에 도달했다")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch({"action": action}, client)
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "gateway-blocked"
    assert "run_id" in result.content[0].text


@pytest.mark.asyncio
async def test_list_presets_proxies_get(mock_http_client):
    async def handler(request):
        assert request.method == "GET"
        assert request.url.path == "/api/v1/backtest/presets"
        return httpx.Response(200, json={"presets": []})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch({"action": "list_presets"}, client)
    assert not result.isError
    assert json.loads(result.content[0].text)["presets"] == []


@pytest.mark.asyncio
async def test_list_indicators_proxies_get(mock_http_client):
    async def handler(request):
        assert request.method == "GET"
        assert request.url.path == "/api/v1/backtest/indicators"
        return httpx.Response(200, json={"indicators": []})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch({"action": "list_indicators"}, client)
    assert not result.isError
    assert json.loads(result.content[0].text)["indicators"] == []


@pytest.mark.asyncio
async def test_validate_proxies_post_body(mock_http_client):
    async def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/api/v1/backtest/validate"
        assert json.loads(request.content) == {"kind": "yaml", "source": "..."}
        return httpx.Response(200, json={"ok": True, "errors": []})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch(
            {"action": "validate", "validate": {"kind": "yaml", "source": "..."}}, client
        )
    assert not result.isError
    assert json.loads(result.content[0].text) == {"ok": True, "errors": []}


@pytest.mark.asyncio
async def test_plan_proxies_post_body(mock_http_client):
    async def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/api/v1/backtest/data/plan"
        body = json.loads(request.content)
        assert body["stk_cd"] == "005930"
        return httpx.Response(
            200, json={"cached_rows": 0, "needed_pages": 1, "est_seconds": 1.0, "segments": []}
        )

    plan_input = {
        "stk_cd": "005930", "period": "day", "adjusted": True,
        "from_dt": "20250101", "to_dt": "20250201",
    }
    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch({"action": "plan", "plan": plan_input}, client)
    assert not result.isError
    assert json.loads(result.content[0].text)["needed_pages"] == 1


@pytest.mark.asyncio
async def test_run_proxies_post_and_marks_accepted(mock_http_client):
    async def handler(request):
        assert request.method == "POST"
        assert request.url.path == "/api/v1/backtest/runs"
        return httpx.Response(202, json={"run_id": "run-1"})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch(
            {"action": "run", "run": {"yaml": "..."}}, client
        )
    payload = json.loads(result.content[0].text)
    assert payload["run_id"] == "run-1"
    assert payload["status"] == "accepted"


@pytest.mark.asyncio
async def test_run_409_translates_to_blocked_status_payload(mock_http_client):
    async def handler(request):
        return httpx.Response(
            409, json={"detail": {"needed_pages": 3, "est_seconds": 3.0}}
        )

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch(
            {"action": "run", "run": {"yaml": "..."}}, client
        )
    assert not result.isError  # 정직한 정보 결과다 — 실패가 아니다
    payload = json.loads(result.content[0].text)
    assert payload["status"] == "blocked"
    assert payload["needed_pages"] == 3
    assert payload["est_seconds"] == 3.0


@pytest.mark.asyncio
async def test_status_proxies_get_run_by_id(mock_http_client):
    async def handler(request):
        assert request.method == "GET"
        assert request.url.path == "/api/v1/backtest/runs/run-1"
        return httpx.Response(200, json={"run_id": "run-1", "status": "running"})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch(
            {"action": "status", "run_id": "run-1"}, client
        )
    assert not result.isError
    assert json.loads(result.content[0].text)["status"] == "running"


@pytest.mark.asyncio
async def test_result_proxies_get_run_by_id(mock_http_client):
    async def handler(request):
        assert request.url.path == "/api/v1/backtest/runs/run-1"
        return httpx.Response(200, json={"run_id": "run-1", "status": "done", "metrics": {}})

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch(
            {"action": "result", "run_id": "run-1"}, client
        )
    assert not result.isError
    assert json.loads(result.content[0].text)["status"] == "done"


@pytest.mark.asyncio
async def test_validation_error_is_translated_without_retry(mock_http_client):
    calls = {"n": 0}

    async def handler(request):
        calls["n"] += 1
        return httpx.Response(
            422, json={"detail": "전략 yaml이 유효하지 않다", "message": "data가 없다"}
        )

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch(
            {"action": "run", "run": {"yaml": "bad"}}, client
        )
    assert calls["n"] == 1  # 무재시도
    assert result.isError
    assert "전략 yaml이 유효하지 않다" in result.content[0].text


@pytest.mark.asyncio
async def test_backend_down_says_do_not_pretend(mock_http_client):
    async def handler(request):
        raise httpx.ConnectError("refused")

    async with mock_http_client(handler, base_url="http://127.0.0.1:8010") as client:
        result = await backtest_tools.dispatch({"action": "list_presets"}, client)
    assert result.isError
    assert result.meta[ERROR_ORIGIN_META_KEY] == "upstream-failed"
    assert "기동돼 있지 않다" in result.content[0].text
