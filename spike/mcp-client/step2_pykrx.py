"""
S2 단계 2-1 — sharebook-kr/pykrx-mcp (Python, 키 불필요)
삼성전자(005930) 실제 호출.
"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CAPTURES = Path(__file__).resolve().parents[1] / "captures"
CAPTURES.mkdir(parents=True, exist_ok=True)
VENV_PY = Path(__file__).resolve().parent / ".venv" / "Scripts" / "pykrx-mcp.exe"


def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj


async def main():
    server_params = StdioServerParameters(
        command=str(VENV_PY),
        args=[],
        env=None,
    )

    print("[1] spawning pykrx-mcp (stdio, venv console script)...", file=sys.stderr)

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            print("[2] initialize()...", file=sys.stderr)
            init_result = await session.initialize()
            print("protocolVersion:", init_result.protocolVersion, file=sys.stderr)
            print("serverInfo:", init_result.serverInfo, file=sys.stderr)

            print("[3] list_tools()...", file=sys.stderr)
            tools_result = await session.list_tools()
            tools_capture = to_jsonable(tools_result)
            (CAPTURES / "S2-pykrx-tools.json").write_text(
                json.dumps(tools_capture, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"tools: {[t.name for t in tools_result.tools]}", file=sys.stderr)

            # 삼성전자 005930, 2024-01-02 ~ 2024-01-12 OHLCV
            print("[4] call_tool(get_stock_ohlcv, 005930)...", file=sys.stderr)
            call_result = await session.call_tool(
                "get_stock_ohlcv",
                {
                    "ticker": "005930",
                    "start_date": "20240102",
                    "end_date": "20240112",
                    "adjusted": True,
                },
            )
            call_capture = to_jsonable(call_result)
            print(json.dumps(call_capture, indent=2, ensure_ascii=False), file=sys.stderr)
            print("isError:", call_result.isError, file=sys.stderr)
            print("structuredContent present:", call_result.structuredContent is not None, file=sys.stderr)

            # get_market_ticker_name 도 같이 캡처 (짧은 룩업 형상)
            name_result = await session.call_tool(
                "get_market_ticker_name", {"ticker": "005930"}
            )
            name_capture = to_jsonable(name_result)

            combined = {
                "get_stock_ohlcv__005930": call_capture,
                "get_market_ticker_name__005930": name_capture,
            }
            (CAPTURES / "S2-pykrx-response.json").write_text(
                json.dumps(combined, indent=2, ensure_ascii=False), encoding="utf-8"
            )

            print("[DONE] step2 pykrx ok", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
