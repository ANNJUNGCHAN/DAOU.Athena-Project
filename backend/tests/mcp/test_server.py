"""server.py 통합 테스트 — AthenaGateway가 진짜 fixture 서버를 연결해 집계하고,
승인 게이트로 필터링하고, `athena__render_canvas`/`athena__save_canvas`를
정상적으로 라우팅하는지 end-to-end로 검증한다."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from mcp import types

from athena_mcp.aggregator import ToolAggregator
from athena_mcp.consent import ConsentStore
from athena_mcp.registry import ServerRegistry
from athena_mcp.server import RENDER_CANVAS_TOOL, SAVE_CANVAS_TOOL, AthenaGateway, build_mcp_server

FIXTURE_SERVER = Path(__file__).resolve().parent / "fixtures" / "fake_server.py"


def _bare_gateway(tmp_path: Path) -> AthenaGateway:
    """레지스트리/승인 없이도 되는 테스트(render_canvas 등)용 최소 게이트웨이."""
    return AthenaGateway(
        registry=ServerRegistry(path=tmp_path / "reg.json"),
        consent_store=ConsentStore(path=tmp_path / "consent.json"),
    )


@pytest.fixture
def gateway(tmp_path) -> AthenaGateway:
    registry = ServerRegistry(path=tmp_path / "mcp_servers.json")
    registry.add("fixture", command=sys.executable, args=[str(FIXTURE_SERVER)], env={})
    consent_store = ConsentStore(path=tmp_path / "consent.json")
    consent_store.request_consent("fixture", sys.executable, [str(FIXTURE_SERVER)], {})
    consent_store.approve("fixture", approved_tools={"echo", "get_corp_code", "boom"})
    return AthenaGateway(
        registry=registry,
        consent_store=consent_store,
        aggregator=ToolAggregator(),
        audit_log_dir=tmp_path / "audit",
        canvas_save_dir=tmp_path / "canvases",
    )


async def _connected(gateway: AthenaGateway, tmp_path) -> AthenaGateway:
    await gateway.connect("fixture", log_dir=tmp_path / "logs")
    return gateway


async def test_list_tools_only_exposes_approved_tools_plus_builtins(gateway, tmp_path):
    await _connected(gateway, tmp_path)
    server = build_mcp_server(gateway)
    handler = server.request_handlers[types.ListToolsRequest]

    result = await handler(types.ListToolsRequest(method="tools/list"))
    names = {t.name for t in result.root.tools}

    # 승인된 3개만 노출 — `flaky`는 approved_tools에 없으므로 빠져야 한다
    assert "fixture__echo" in names
    assert "fixture__get_corp_code" in names
    assert "fixture__boom" in names
    assert "fixture__flaky" not in names
    assert RENDER_CANVAS_TOOL in names
    assert SAVE_CANVAS_TOOL in names


async def test_dispatch_call_routes_to_upstream_and_audits(gateway, tmp_path):
    await _connected(gateway, tmp_path)
    result = await gateway.dispatch_call("fixture__echo", {"message": "hi"})
    assert result.isError is False
    assert result.content[0].text == "Echo: hi"

    audit_entries = gateway._audit_log("fixture").read_all()
    assert any(e["tool"] == "echo" and e["success"] is True for e in audit_entries)


async def test_dispatch_call_unapproved_tool_rejected(gateway, tmp_path):
    """`flaky`는 승인 목록에 없다 — 집계에서 빠질 뿐 아니라 직접 호출도 막혀야 한다."""
    await _connected(gateway, tmp_path)
    result = await gateway.dispatch_call("fixture__flaky", {})
    assert result.isError is True
    assert "승인" in result.content[0].text


async def test_dispatch_call_unknown_qualified_name(tmp_path):
    gw = _bare_gateway(tmp_path)
    result = await gw.dispatch_call("nope__nope", {})
    assert result.isError is True


async def test_render_canvas_valid_stream(tmp_path):
    gw = _bare_gateway(tmp_path)
    data = {
        "records": [
            {
                "ts": "2026-08-15T00:00:00+09:00",
                "ts_precision": "second",
                "source": "naver.com",
                "title": "제목",
                "url": "https://example.com",
            }
        ]
    }
    args = {"canvas_type": "stream", "data": data, "caption": "테스트"}
    result = await gw.dispatch_call(RENDER_CANVAS_TOOL, args)
    assert result.isError is False
    payload = json.loads(result.content[0].text)
    assert payload["canvas_type"] == "stream"
    assert payload["fell_back"] is False


async def test_render_canvas_schema_mismatch_falls_back_to_free_and_reports_it(tmp_path):
    gw = _bare_gateway(tmp_path)
    bad_data = {"records": [{"source": "x"}]}  # ts/title/url 없음
    args = {"canvas_type": "stream", "data": bad_data}
    result = await gw.dispatch_call(RENDER_CANVAS_TOOL, args)
    payload = json.loads(result.content[0].text)
    assert payload["canvas_type"] == "free"
    assert payload["fell_back"] is True
    assert payload["fallback_reason"] is not None


async def test_save_canvas_writes_file(tmp_path):
    save_dir = tmp_path / "canvases"
    gw = AthenaGateway(
        registry=ServerRegistry(path=tmp_path / "reg.json"),
        consent_store=ConsentStore(path=tmp_path / "consent.json"),
        canvas_save_dir=save_dir,
    )
    args = {
        "canvas_type": "table",
        "data": {"rows": [{"a": 1}]},
        "name": "내-첫-테이블",
        "caption": None,
    }
    result = await gw.dispatch_call(SAVE_CANVAS_TOOL, args)
    assert result.isError is False
    saved_path = save_dir / "내-첫-테이블.json"
    assert saved_path.exists()
    on_disk = json.loads(saved_path.read_text(encoding="utf-8"))
    assert on_disk["canvas_type"] == "table"
    assert on_disk["data"]["rows"] == [{"a": 1}]


async def test_save_canvas_rejects_relative_path_traversal(tmp_path):
    """W1 보안 리뷰(SECURITY.md §1): `name="../evil"` 류가 save_dir 밖에
    파일을 쓰지 못하게 막는다 — 조용히 자르지 않고 isError로 명시 거부한다."""
    save_dir = tmp_path / "canvases"
    outside_target = tmp_path / "evil.json"
    gw = AthenaGateway(
        registry=ServerRegistry(path=tmp_path / "reg.json"),
        consent_store=ConsentStore(path=tmp_path / "consent.json"),
        canvas_save_dir=save_dir,
    )
    args = {"canvas_type": "free", "data": {}, "name": "../evil"}
    result = await gw.dispatch_call(SAVE_CANVAS_TOOL, args)
    assert result.isError is True
    assert not outside_target.exists()


async def test_save_canvas_rejects_absolute_path_override(tmp_path):
    """W1 보안 리뷰(SECURITY.md §1): 절대경로 `name`이 `save_dir`를 완전히
    건너뛰고 임의 위치에 쓰는 pathlib `/` 연산자 함정을 막는다."""
    save_dir = tmp_path / "canvases"
    abs_target = tmp_path / "abs_evil"
    gw = AthenaGateway(
        registry=ServerRegistry(path=tmp_path / "reg.json"),
        consent_store=ConsentStore(path=tmp_path / "consent.json"),
        canvas_save_dir=save_dir,
    )
    args = {"canvas_type": "free", "data": {}, "name": str(abs_target)}
    result = await gw.dispatch_call(SAVE_CANVAS_TOOL, args)
    assert result.isError is True
    abs_target_json = abs_target.with_name(abs_target.name + ".json")
    assert not abs_target_json.exists()
