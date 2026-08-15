import asyncio, json, sys, os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
CAPTURES = Path(__file__).resolve().parents[1] / "captures"


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
    if env_vars.get("KRX_API_KEY"):
        child_env["KRX_API_KEY"] = env_vars["KRX_API_KEY"]

    server_params = StdioServerParameters(
        command="npx", args=["-y", "@iflow-mcp/jjlabsio-korea-stock-mcp"], env=child_env
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            r = await session.call_tool("get_disclosure", {"rcept_no": "20260713000395"})
            rcap = to_jsonable(r)
            text0 = r.content[0].text if r.content else None
            entry = {
                "tool": "get_disclosure",
                "args": {"rcept_no": "20260713000395"},
                "label": "주요사항보고서(자기주식처분결정) - raw zip 5KB (SMALL)",
                "result": rcap,
                "isError": r.isError,
                "content0_text_len": len(text0) if text0 else None,
                "has_structuredContent": r.structuredContent is not None,
                "u_fffd_count": (text0.count("�") if text0 else None),
            }
            (CAPTURES / "S2B-jjlabsio-disclosure-SMALL.json").write_text(
                json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            (CAPTURES / "S2B-CHECK-small-summary.json").write_text(
                json.dumps({
                    "isError": entry["isError"],
                    "content0_text_len": entry["content0_text_len"],
                    "has_structuredContent": entry["has_structuredContent"],
                    "u_fffd_count": entry["u_fffd_count"],
                }, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

asyncio.run(main())
