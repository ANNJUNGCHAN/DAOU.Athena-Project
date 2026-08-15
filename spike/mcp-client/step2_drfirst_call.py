import asyncio, json, sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CAPTURES = Path(__file__).resolve().parents[1] / "captures"

def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj

async def main():
    server_params = StdioServerParameters(command="npx", args=["-y", "@drfirst/korea-stock-mcp"], env=None)
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("[call] get_stock_price_by_code(005930)", file=sys.stderr)
            r1 = await session.call_tool("get_stock_price_by_code", {"code": "005930"})
            cap1 = to_jsonable(r1)
            print(json.dumps(cap1, indent=2, ensure_ascii=False), file=sys.stderr)

            print("[call] search_stock_code(삼성전자)", file=sys.stderr)
            r2 = await session.call_tool("search_stock_code", {"query": "삼성전자"})
            cap2 = to_jsonable(r2)
            print(json.dumps(cap2, indent=2, ensure_ascii=False), file=sys.stderr)

            combined = {
                "get_stock_price_by_code__005930": cap1,
                "search_stock_code__삼성전자": cap2,
            }
            (CAPTURES / "S2-drfirst-response.json").write_text(
                json.dumps(combined, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print("isError1:", r1.isError, "structuredContent1:", r1.structuredContent is not None, file=sys.stderr)
            print("isError2:", r2.isError, "structuredContent2:", r2.structuredContent is not None, file=sys.stderr)

asyncio.run(main())
