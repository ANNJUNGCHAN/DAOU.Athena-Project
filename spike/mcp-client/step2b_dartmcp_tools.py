import asyncio, json, os, sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
CAPTURES = ROOT / "spike" / "captures"
VENDOR_DIR = Path(__file__).resolve().parent / "vendor" / "dart-mcp"
VENV_PYTHON = Path(__file__).resolve().parent / ".venv" / "Scripts" / "python.exe"

def load_dart_key():
    env_path = ROOT / ".env"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("DART_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("DART_API_KEY not found in .env")

def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj

async def main():
    dart_key = load_dart_key()
    server_params = StdioServerParameters(
        command=str(VENV_PYTHON),
        args=["dart.py"],
        cwd=str(VENDOR_DIR),
        env={"DART_API_KEY": dart_key, "SystemRoot": os.environ.get("SystemRoot", "")},
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
                out = {
                    "init": {
                        "protocolVersion": init.protocolVersion,
                        "serverInfo": to_jsonable(init.serverInfo),
                    },
                    "tools": cap,
                }
                (CAPTURES / "S2B-dartmcp-tools.json").write_text(
                    json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8"
                )
    except Exception as e:
        print("FAILED:", type(e).__name__, e, file=sys.stderr)
        raise

asyncio.run(main())
