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
    server_params = StdioServerParameters(command="npx", args=["-y", "@iflow-mcp/jjlabsio-korea-stock-mcp"], env=None)
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            results = {}
            for t in tools.tools:
                props = (t.inputSchema or {}).get("properties", {})
                args = {}
                for k, v in props.items():
                    tp = v.get("type")
                    if tp == "string":
                        args[k] = "005930" if ("code" in k.lower() or "ticker" in k.lower()) else "test"
                    elif tp in ("number", "integer"):
                        args[k] = 1
                try:
                    r = await session.call_tool(t.name, args)
                    results[t.name] = {"args": args, "isError": r.isError, "result": to_jsonable(r)}
                except Exception as e:
                    results[t.name] = {"args": args, "exception": str(e)}
            print(json.dumps(results, indent=2, ensure_ascii=False), file=sys.stderr)
            (CAPTURES / "S2-jjlabsio-alltools-nokey.json").write_text(
                json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8"
            )

asyncio.run(main())
