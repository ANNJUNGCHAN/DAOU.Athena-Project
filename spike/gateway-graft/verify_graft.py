"""이식 검증 — `athena-mcp serve`에 **진짜 MCP 클라이언트로** 붙어 왕복한다.

`claude -p`가 하는 것과 정확히 같은 일을 한다: 게이트웨이를 stdio 자식
프로세스로 spawn -> initialize -> tools/list -> tools/call. 게이트웨이는 그
안에서 다시 upstream MCP 서버 N개에 클라이언트로 붙는다(2단 중첩).

산출물은 `spike/captures/GRAFT-*.json`. 지어낸 픽스처가 아니라 실호출 결과다.

실행:
    backend/.venv/Scripts/python.exe spike/gateway-graft/verify_graft.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
CAPTURES = REPO / "spike" / "captures"
STATE_DIR = Path(os.environ.get("ATHENA_HOME", r"C:\Users\ajc22\AppData\Local\Temp\athena-graft"))


def to_jsonable(obj: object) -> object:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    return obj


async def main() -> int:
    params = StdioServerParameters(
        command=str(BACKEND / ".venv" / "Scripts" / "python.exe"),
        args=[
            "-m",
            "athena_mcp",
            "--state-dir",
            str(STATE_DIR),
            "--registry",
            str(STATE_DIR / "mcp_servers.json"),
            "serve",
        ],
        env={**os.environ, "PYTHONPATH": str(BACKEND)},
    )

    report: dict[str, object] = {}
    errlog = (CAPTURES / "GRAFT-gateway-stderr.txt").open("w", encoding="utf-8")
    print("[1] spawning athena-mcp serve as a stdio MCP server...", file=sys.stderr)
    async with stdio_client(params, errlog=errlog) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            report["initialize"] = to_jsonable(init)
            print(
                f"    protocolVersion={init.protocolVersion} "
                f"serverInfo={init.serverInfo.name if init.serverInfo else None}",
                file=sys.stderr,
            )

            print("[2] tools/list ...", file=sys.stderr)
            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            report["tool_names"] = names
            report["tool_count"] = len(names)
            by_prefix: dict[str, int] = {}
            for n in names:
                prefix = n.split("__", 1)[0]
                by_prefix[prefix] = by_prefix.get(prefix, 0) + 1
            report["tools_by_namespace"] = by_prefix
            print(f"    {len(names)} tools: {by_prefix}", file=sys.stderr)

            calls: dict[str, object] = {}

            async def call(label: str, name: str, args: dict) -> None:
                print(f"[3] tools/call {name} ...", file=sys.stderr)
                try:
                    result = await session.call_tool(name, args)
                    calls[label] = {
                        "tool": name,
                        "isError": result.isError,
                        "structuredContent_present": result.structuredContent is not None,
                        "result": to_jsonable(result),
                    }
                except Exception as exc:  # noqa: BLE001 — 캡처가 목적이다
                    calls[label] = {"tool": name, "exception": repr(exc)}

            # upstream 경유 호출 (Node 서버, structuredContent 채움)
            if "server-everything__echo" in names:
                await call("everything_echo", "server-everything__echo", {"message": "삼성전자"})
            # upstream 경유 호출 (Python/FastMCP, structuredContent null)
            if "pykrx__get_market_ticker_name" in names:
                await call(
                    "pykrx_ticker_name",
                    "pykrx__get_market_ticker_name",
                    {"ticker": "005930"},
                )
            # 게이트웨이 자체 툴
            if "athena__render_canvas" in names:
                await call(
                    "render_canvas_table",
                    "athena__render_canvas",
                    {
                        "canvas_type": "table",
                        "data": {"rows": [{"종목": "삼성전자", "종가": 71000}]},
                    },
                )
                # 미지의 canvas_type -> free 폴백이 실제 프로토콜 경로에서 살아있는지
                await call(
                    "render_canvas_unknown_type",
                    "athena__render_canvas",
                    {"canvas_type": "streem", "data": {"anything": 1}},
                )
            # 승인 안 된 툴 직접 호출 -> 거부되어야 한다
            await call(
                "unapproved_tool_direct",
                "server-everything__get-env",
                {},
            )
            report["calls"] = calls

    errlog.close()
    out = CAPTURES / "GRAFT-verify.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] wrote {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
