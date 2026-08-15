import asyncio, json
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CAPTURES = Path(__file__).resolve().parents[1] / "captures"

def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj

async def main():
    server_params = StdioServerParameters(
        command="npx", args=["-y", "@modelcontextprotocol/server-everything", "stdio"], env=None,
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            r = await session.call_tool("get-structured-content", {})
            cap = to_jsonable(r)
            print(json.dumps(cap, indent=2, ensure_ascii=False))
            (CAPTURES / "S2-everything-calltoolresult-isError.json").write_text(
                json.dumps(cap, indent=2, ensure_ascii=False), encoding="utf-8"
            )

asyncio.run(main())
