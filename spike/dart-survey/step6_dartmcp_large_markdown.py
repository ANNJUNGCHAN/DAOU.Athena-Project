import asyncio, json, sys, os, re, time
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

    server_params = StdioServerParameters(command="npx", args=["-y", "korean-dart-mcp@0.10.1"], env=child_env)
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            print("--- calling download_document LARGE annual, markdown, truncate_at=400000 ---", file=sys.stderr)
            t0 = time.time()
            r = await asyncio.wait_for(
                session.call_tool(
                    "download_document",
                    {"rcept_no": "20260310002820", "format": "markdown", "truncate_at": 400000},
                ),
                timeout=180,
            )
            elapsed = time.time() - t0
            text0 = r.content[0].text if r.content else None
            outer = json.loads(text0) if text0 else None
            content = outer.get("content") if outer else None
            # 원시 XML 태그 누출 검사 (jjlabsio에서 발견된 <TE ...> 류 패턴)
            leak_matches = re.findall(r"<[A-Z\-]+[^>]{0,80}>", content) if content else []
            entry = {
                "tool": "download_document",
                "args": {"rcept_no": "20260310002820", "format": "markdown", "truncate_at": 400000},
                "label": "대용량 사업보고서(20260310002820) 마크다운 - 원시 XML 태그 누출 검사",
                "elapsed_s": round(elapsed, 2),
                "isError": r.isError,
                "outer_size_bytes": outer.get("size_bytes") if outer else None,
                "outer_raw_char_count": outer.get("raw_char_count") if outer else None,
                "outer_char_count": outer.get("char_count") if outer else None,
                "outer_truncated": outer.get("truncated") if outer else None,
                "content_len": len(content) if content else None,
                "raw_xml_tag_leak_count": len(leak_matches),
                "raw_xml_tag_leak_samples": leak_matches[:10],
                "content_tail_2000": content[-2000:] if content else None,
            }
            (CAPTURES / "DARTSURVEY-chrisryugj-download_document-LARGE-markdown-leakcheck.json").write_text(
                json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"OK isError={r.isError} content_len={entry['content_len']} leak_count={entry['raw_xml_tag_leak_count']} elapsed={elapsed:.2f}s", file=sys.stderr)

asyncio.run(main())
