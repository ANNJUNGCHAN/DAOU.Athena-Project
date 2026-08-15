"""
S2 단계 2-2 — @drfirst/korea-stock-mcp (Node, 키 불필요, 네이버금융 크롤링)
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


def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj


async def main():
    server_params = StdioServerParameters(
        command="npx",
        args=["-y", "@drfirst/korea-stock-mcp"],
        env=None,
    )

    print("[1] spawning npx @drfirst/korea-stock-mcp (stdio)...", file=sys.stderr)

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            print("[2] initialize()...", file=sys.stderr)
            init_result = await session.initialize()
            print("protocolVersion:", init_result.protocolVersion, file=sys.stderr)
            print("serverInfo:", init_result.serverInfo, file=sys.stderr)

            print("[3] list_tools()...", file=sys.stderr)
            tools_result = await session.list_tools()
            tools_capture = to_jsonable(tools_result)
            (CAPTURES / "S2-drfirst-tools.json").write_text(
                json.dumps(tools_capture, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            names = [t.name for t in tools_result.tools]
            print(f"tools: {names}", file=sys.stderr)
            for t in tools_result.tools:
                print(f"  - {t.name}: schema={json.dumps(t.inputSchema, ensure_ascii=False)}", file=sys.stderr)

            # 삼성전자 005930 관련 툴 호출 시도 - 이름 규칙 추정, 실패하면 첫 번째 툴로 폴백
            candidates = [n for n in names if "quote" in n.lower() or "price" in n.lower() or "ohlcv" in n.lower() or "stock" in n.lower()]
            target_name = candidates[0] if candidates else names[0]
            target_tool = next(t for t in tools_result.tools if t.name == target_name)
            props = (target_tool.inputSchema or {}).get("properties", {})
            args = {}
            for k in props:
                if "code" in k.lower() or "ticker" in k.lower() or "symbol" in k.lower():
                    args[k] = "005930"
            if not args and props:
                # 첫 필드에 005930 채우기
                first_key = list(props.keys())[0]
                args[first_key] = "005930"

            print(f"[4] call_tool({target_name!r}, {args})...", file=sys.stderr)
            call_result = await session.call_tool(target_name, args)
            call_capture = to_jsonable(call_result)
            print(json.dumps(call_capture, indent=2, ensure_ascii=False), file=sys.stderr)
            print("isError:", call_result.isError, file=sys.stderr)
            print("structuredContent present:", call_result.structuredContent is not None, file=sys.stderr)

            (CAPTURES / "S2-drfirst-response.json").write_text(
                json.dumps({"tool": target_name, "args": args, "result": call_capture}, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            print("[DONE] step2 drfirst ok", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
