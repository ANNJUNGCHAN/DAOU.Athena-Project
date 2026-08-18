"""selector_tools.py + server.py 결선 테스트 — athena_search/describe/resolve/call
4툴이 백엔드로 정확히 프록시되는지, 재시도 없이 단일 시도로 끝나는지, 실패가
감사 로그에만(인자·plan_token 없이) 남는지 검증한다."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from mcp import types as mcp_types

from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.result import ERROR_ORIGIN_META_KEY
from athena_mcp.selector_tools import (
    CALL_TOOL,
    DESCRIBE_TOOL,
    RESOLVE_TOOL,
    SEARCH_TOOL,
    SELECTOR_TOOL_NAMES,
)
from athena_mcp.server import AthenaGateway, build_mcp_server


def _gateway(tmp_path: Path, handler) -> AthenaGateway:
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), base_url="http://backend.test"
    )
    return AthenaGateway(
        registry=ServerRegistry(path=tmp_path / "reg.json"),
        consent_store=ConsentStore(path=tmp_path / "consent.json"),
        audit_log_dir=tmp_path / "audit",
        canvas_save_dir=tmp_path / "canvases",
        selector_http_client=client,
    )


# ---------------------------------------------------------------------------
# happy path — 인자 그대로 POST, 응답 JSON 그대로 text에 실린다
# ---------------------------------------------------------------------------


async def test_search_happy_path_proxies_arguments_and_response(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/api/v1/llm/tools/search"
        assert json.loads(request.content) == {"query": "삼성전자 현재가"}
        return httpx.Response(
            200,
            json={"catalog_version": "v1", "normalized_query": "삼성전자 현재가", "results": []},
        )

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(SEARCH_TOOL, {"query": "삼성전자 현재가"})

    assert result.isError is False
    payload = json.loads(result.content[0].text)
    assert payload["catalog_version"] == "v1"
    assert payload["results"] == []


async def test_describe_happy_path(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/llm/tools/describe"
        assert json.loads(request.content) == {"operation_ref": "ka10001"}
        return httpx.Response(200, json={"operation_ref": "ka10001", "kind": "query"})

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(DESCRIBE_TOOL, {"operation_ref": "ka10001"})

    assert result.isError is False
    assert json.loads(result.content[0].text)["operation_ref"] == "ka10001"


async def test_resolve_happy_path(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/llm/tools/resolve"
        return httpx.Response(
            200,
            json={
                "status": "resolved",
                "catalog_version": "v1",
                "operation_ref": "ka10001",
                "plan_token": "tok-abc",
                "expires_at": "2026-08-18T00:00:00+00:00",
                "selection_reasons": [],
                "required_arguments_satisfied": True,
                "response_mode": "auto",
            },
        )

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(RESOLVE_TOOL, {"question": "삼성전자 현재가"})

    assert result.isError is False
    assert json.loads(result.content[0].text)["plan_token"] == "tok-abc"


async def test_call_happy_path(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/llm/tools/call"
        assert json.loads(request.content) == {"plan_token": "tok-abc"}
        return httpx.Response(
            200,
            json={"operation_ref": "ka10001", "data": {}, "continuation": {"cont_yn": "N"}},
        )

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(CALL_TOOL, {"plan_token": "tok-abc"})

    assert result.isError is False


# ---------------------------------------------------------------------------
# 백엔드 미기동 — 별도 안내 문구
# ---------------------------------------------------------------------------


async def test_backend_not_running_gives_clear_actionable_message(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(SEARCH_TOOL, {"query": "x"})

    assert result.isError is True
    text = result.content[0].text
    assert "기동" in text
    assert "127.0.0.1:8010" in text
    assert "대체" in text  # "다른 데이터 소스로 대체하지 마라" 지시가 담겨야 한다
    assert result.meta[ERROR_ORIGIN_META_KEY] == "upstream-failed"


# ---------------------------------------------------------------------------
# 4xx/5xx 전달 — 백엔드 detail을 간결히 통과시킨다
# ---------------------------------------------------------------------------


async def test_4xx_error_detail_is_forwarded(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"detail": "PLAN_ALREADY_USED"})

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(CALL_TOOL, {"plan_token": "used"})

    assert result.isError is True
    assert "PLAN_ALREADY_USED" in result.content[0].text
    assert "409" in result.content[0].text
    assert result.meta[ERROR_ORIGIN_META_KEY] == "upstream-failed"


async def test_5xx_error_detail_is_forwarded(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "credentials unavailable"})

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(SEARCH_TOOL, {"query": "x"})

    assert result.isError is True
    assert "credentials unavailable" in result.content[0].text
    assert result.meta[ERROR_ORIGIN_META_KEY] == "upstream-failed"


# ---------------------------------------------------------------------------
# 단일 시도 보장 — 재시도 절대 없음 (LLM_API_SELECTION.md 어댑터 요구사항 6)
# ---------------------------------------------------------------------------


async def test_timeout_does_not_retry(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise httpx.ReadTimeout("timed out", request=request)

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(RESOLVE_TOOL, {"question": "x"})

    assert result.isError is True
    assert len(calls) == 1
    assert result.meta[ERROR_ORIGIN_META_KEY] == "upstream-failed"


async def test_connect_error_does_not_retry(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise httpx.ConnectError("refused", request=request)

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "x"})

    assert len(calls) == 1


async def test_5xx_failure_does_not_retry(tmp_path):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(500, json={"detail": "boom"})

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "x"})

    assert len(calls) == 1


async def test_call_timeout_does_not_retry_even_though_order_risk_is_higher(tmp_path):
    """athena_call은 실제 키움 upstream(주문 포함)을 트리거할 수 있는 자리라
    재시도 금지가 가장 중요한 지점이다 — 타임아웃이어도 단 한 번만 시도한다."""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise httpx.ReadTimeout("timed out", request=request)

    gw = _gateway(tmp_path, handler)
    result = await gw.dispatch_call(CALL_TOOL, {"plan_token": "tok-1"})

    assert result.isError is True
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# 감사 로그 — 시각/별칭/툴명/성공여부만, plan_token·인자 절대 없음
# ---------------------------------------------------------------------------


async def test_audit_log_records_success(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "x"})

    entries = gw._audit_log("kiwoom-selector").read_all()
    assert len(entries) == 1
    assert entries[0]["tool"] == SEARCH_TOOL
    assert entries[0]["alias"] == "kiwoom-selector"
    assert entries[0]["success"] is True
    assert set(entries[0]) == {"ts", "alias", "tool", "success"}


async def test_audit_log_records_failure(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "x"})

    entries = gw._audit_log("kiwoom-selector").read_all()
    assert len(entries) == 1
    assert entries[0]["success"] is False


async def test_audit_log_never_contains_plan_token_or_arguments(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"operation_ref": "ka10001", "data": {}, "continuation": {"cont_yn": "N"}},
        )

    gw = _gateway(tmp_path, handler)
    secret_token = "super-secret-plan-token-xyz"
    await gw.dispatch_call(CALL_TOOL, {"plan_token": secret_token})

    raw_log_text = gw._audit_log("kiwoom-selector").path.read_text(encoding="utf-8")
    assert secret_token not in raw_log_text


# ---------------------------------------------------------------------------
# 타이밍 로그(W1 계측, plan/plan.md) — 감사 로그와 별도 파일, ts/tool/backend_ms만
# ---------------------------------------------------------------------------


def _timing_log_path(tmp_path: Path) -> Path:
    return tmp_path / "audit" / "kiwoom-selector-timing.jsonl"


async def test_timing_log_records_one_line_per_call(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "삼성전자 현재가"})

    lines = _timing_log_path(tmp_path).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["tool"] == SEARCH_TOOL
    assert set(entry) == {"ts", "tool", "backend_ms"}
    assert isinstance(entry["backend_ms"], int)
    assert entry["backend_ms"] >= 0


async def test_timing_log_never_contains_plan_token_or_arguments(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"operation_ref": "ka10001", "data": {}, "continuation": {"cont_yn": "N"}},
        )

    gw = _gateway(tmp_path, handler)
    secret_token = "super-secret-plan-token-xyz"
    await gw.dispatch_call(CALL_TOOL, {"plan_token": secret_token})

    raw_log_text = _timing_log_path(tmp_path).read_text(encoding="utf-8")
    assert secret_token not in raw_log_text
    assert "data" not in json.loads(raw_log_text.splitlines()[0])


async def test_timing_log_records_even_on_upstream_failure(tmp_path):
    """백엔드 왕복 소요는 실패해도 의미 있는 신호다(재시도가 없으니 "실패까지
    걸린 시간"도 3분해의 일부) — 감사 로그와 달리 success 필드가 없으니 실패
    시에도 그냥 한 줄 남는다."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    gw = _gateway(tmp_path, handler)
    await gw.dispatch_call(SEARCH_TOOL, {"query": "x"})

    lines = _timing_log_path(tmp_path).read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["tool"] == SEARCH_TOOL


# ---------------------------------------------------------------------------
# 노출 — tools/list에 athena__ 이중 프리픽스 없이 계약 이름 그대로 나온다
# ---------------------------------------------------------------------------


async def test_list_tools_includes_selector_tools_with_contract_names(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    gw = _gateway(tmp_path, handler)
    server = build_mcp_server(gw)
    handler_fn = server.request_handlers[mcp_types.ListToolsRequest]

    result = await handler_fn(mcp_types.ListToolsRequest(method="tools/list"))
    names = {t.name for t in result.root.tools}

    assert set(SELECTOR_TOOL_NAMES) <= names
    for name in SELECTOR_TOOL_NAMES:
        assert f"athena__{name}" not in names  # 이중 프리픽스 아님
