import asyncio, json, sys, os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
CAPTURES = ROOT / "spike" / "captures"


def load_env():
    env_path = ROOT / ".env"
    out = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj


async def main():
    env_vars = load_env()
    child_env = dict(os.environ)
    if env_vars.get("DART_API_KEY"):
        child_env["DART_API_KEY"] = env_vars["DART_API_KEY"]

    server_params = StdioServerParameters(
        command="npx", args=["-y", "korean-dart-mcp@0.10.1"], env=child_env
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("protocolVersion:", init.protocolVersion, file=sys.stderr)
            print("serverInfo:", init.serverInfo, file=sys.stderr)
            tools = await session.list_tools()
            cap = to_jsonable(tools)
            print(f"tools: {[t.name for t in tools.tools]}", file=sys.stderr)
            (CAPTURES / "DARTSURVEY-chrisryugj-tools.json").write_text(
                json.dumps(cap, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            (CAPTURES / "DARTSURVEY-chrisryugj-init.json").write_text(
                json.dumps(to_jsonable(init), indent=2, ensure_ascii=False), encoding="utf-8"
            )

asyncio.run(main())
