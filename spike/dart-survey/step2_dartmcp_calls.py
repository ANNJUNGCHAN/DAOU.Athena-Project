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


async def call_and_capture(session, tool_name, args, capture_name, label, timeout_s=120):
    print(f"--- calling {tool_name}({args}) ---", file=sys.stderr)
    try:
        r = await asyncio.wait_for(session.call_tool(tool_name, args), timeout=timeout_s)
        rcap = to_jsonable(r)
        text0 = r.content[0].text if r.content else None
        entry = {
            "tool": tool_name,
            "args": args,
            "label": label,
            "isError": r.isError,
            "content0_text_len": len(text0) if text0 else None,
            "content0_text_head": text0[:2000] if text0 else None,
            "has_structuredContent": r.structuredContent is not None,
            "structuredContent": r.structuredContent,
            "u_fffd_count": (text0.count("�") if text0 else None),
        }
        (CAPTURES / capture_name).write_text(
            json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        print(f"OK isError={r.isError} len={entry['content0_text_len']}", file=sys.stderr)
        return r
    except asyncio.TimeoutError:
        print(f"TIMEOUT after {timeout_s}s", file=sys.stderr)
        (CAPTURES / capture_name).write_text(
            json.dumps({"tool": tool_name, "args": args, "label": label, "error": f"timeout {timeout_s}s"}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return None
    except Exception as e:
        print(f"EXCEPTION {type(e).__name__}: {e}", file=sys.stderr)
        (CAPTURES / capture_name).write_text(
            json.dumps({"tool": tool_name, "args": args, "label": label, "error": f"{type(e).__name__}: {e}"}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return None


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

            # 1) 직접대조: jjlabsio SMALL 캡처와 같은 rcept_no (자기주식 처분 결정, 주요사항보고서)
            await call_and_capture(
                session, "download_document",
                {"rcept_no": "20260713000395", "format": "markdown"},
                "DARTSURVEY-chrisryugj-download_document-SAME-AS-jjlabsio-SMALL-markdown.json",
                "직접대조용 - jjlabsio SMALL과 동일 rcept_no, format=markdown",
            )
            await call_and_capture(
                session, "download_document",
                {"rcept_no": "20260713000395", "format": "raw"},
                "DARTSURVEY-chrisryugj-download_document-SAME-AS-jjlabsio-SMALL-raw.json",
                "직접대조용 - jjlabsio SMALL과 동일 rcept_no, format=raw(XML)",
            )

            # 2) 첨부파일 목록 (연간 사업보고서 - HWP/PDF 첨부 가능성 높음)
            await call_and_capture(
                session, "get_attachments",
                {"rcept_no": "20260310002820", "mode": "list"},
                "DARTSURVEY-chrisryugj-attachments-list.json",
                "삼성전자 사업보고서(20260310002820) 첨부파일 목록",
            )

asyncio.run(main())
