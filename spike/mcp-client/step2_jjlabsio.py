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
    server_params = StdioServerParameters(
        command="npx", args=["-y", "@iflow-mcp/jjlabsio-korea-stock-mcp"], env=None
    )
    try:
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                init = await session.initialize()
                print("protocolVersion:", init.protocolVersion, file=sys.stderr)
                print("serverInfo:", init.serverInfo, file=sys.stderr)
                tools = await session.list_tools()
                cap = to_jsonable(tools)
                print(f"tools: {[t.name for t in tools.tools]}", file=sys.stderr)
                (CAPTURES / "S2-jjlabsio-tools.json").write_text(
                    json.dumps(cap, indent=2, ensure_ascii=False), encoding="utf-8"
                )
                # 키 없이 첫 툴 호출 시도 - 실패 형태 캡처
                if tools.tools:
                    t0 = tools.tools[0]
                    props = (t0.inputSchema or {}).get("properties", {})
                    args = {}
                    for k, v in props.items():
                        if v.get("type") == "string":
                            args[k] = "005930"
                    r = await session.call_tool(t0.name, args)
                    rcap = to_jsonable(r)
                    print(json.dumps(rcap, indent=2, ensure_ascii=False), file=sys.stderr)
                    (CAPTURES / "S2-jjlabsio-nokey-error.json").write_text(
                        json.dumps({"tool": t0.name, "args": args, "result": rcap}, indent=2, ensure_ascii=False),
                        encoding="utf-8",
                    )
    except Exception as e:
        print("FAILED:", type(e).__name__, e, file=sys.stderr)
        raise

asyncio.run(main())
