import asyncio, json, sys, os, time
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
            await session.initialize()
            print("--- extracting PDF attachment (삼성전자 사업보고서 2026.03.10) ---", file=sys.stderr)
            t0 = time.time()
            try:
                r = await asyncio.wait_for(
                    session.call_tool(
                        "get_attachments",
                        {"rcept_no": "20260310002820", "mode": "extract", "index": 0, "truncate_at": 5000},
                    ),
                    timeout=300,
                )
                elapsed = time.time() - t0
                text0 = r.content[0].text if r.content else None
                entry = {
                    "tool": "get_attachments",
                    "args": {"rcept_no": "20260310002820", "mode": "extract", "index": 0, "truncate_at": 5000},
                    "label": "삼성전자 사업보고서 PDF 첨부 -> 마크다운 추출 (kordoc 엔진)",
                    "elapsed_s": round(elapsed, 2),
                    "isError": r.isError,
                    "content0_text_len": len(text0) if text0 else None,
                    "content0_text_full": text0,
                    "u_fffd_count": (text0.count("�") if text0 else None),
                }
                (CAPTURES / "DARTSURVEY-chrisryugj-attachment-extract-PDF.json").write_text(
                    json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8"
                )
                print(f"OK isError={r.isError} len={entry['content0_text_len']} elapsed={elapsed:.2f}s", file=sys.stderr)
            except asyncio.TimeoutError:
                print("TIMEOUT after 300s", file=sys.stderr)
                (CAPTURES / "DARTSURVEY-chrisryugj-attachment-extract-PDF.json").write_text(
                    json.dumps({"error": "timeout 300s"}, indent=2, ensure_ascii=False), encoding="utf-8"
                )
            except Exception as e:
                print(f"EXCEPTION {type(e).__name__}: {e}", file=sys.stderr)
                (CAPTURES / "DARTSURVEY-chrisryugj-attachment-extract-PDF.json").write_text(
                    json.dumps({"error": f"{type(e).__name__}: {e}"}, indent=2, ensure_ascii=False), encoding="utf-8"
                )

asyncio.run(main())
