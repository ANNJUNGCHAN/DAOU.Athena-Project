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


async def call_and_capture(session, tool_name, args, capture_name, label, timeout_s=120):
    print(f"--- calling {tool_name}({args}) ---", file=sys.stderr)
    t0 = time.time()
    try:
        r = await asyncio.wait_for(session.call_tool(tool_name, args), timeout=timeout_s)
        elapsed = time.time() - t0
        text0 = r.content[0].text if r.content else None
        entry = {
            "tool": tool_name, "args": args, "label": label, "elapsed_s": round(elapsed, 2),
            "isError": r.isError,
            "content0_text_len": len(text0) if text0 else None,
            "content0_text_full": text0 if (text0 and len(text0) < 8000) else (text0[:8000] if text0 else None),
        }
        (CAPTURES / capture_name).write_text(json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"OK isError={r.isError} len={entry['content0_text_len']} elapsed={elapsed:.2f}s", file=sys.stderr)
        return r
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

    server_params = StdioServerParameters(command="npx", args=["-y", "korean-dart-mcp@0.10.1"], env=child_env)
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # 반기보고서(20250814003156) 첨부 목록 확인
            await call_and_capture(
                session, "get_attachments", {"rcept_no": "20250814003156", "mode": "list"},
                "DARTSURVEY-chrisryugj-attachments-list-semiannual.json",
                "삼성전자 반기보고서(20250814003156) 첨부파일 목록",
            )
            # 소용량 공시(20260713000395, 자기주식 처분결정) 첨부 목록 확인 - 보통 첨부 없음이 정상
            await call_and_capture(
                session, "get_attachments", {"rcept_no": "20260713000395", "mode": "list"},
                "DARTSURVEY-chrisryugj-attachments-list-SMALL.json",
                "자기주식 처분결정(20260713000395) 첨부파일 목록",
            )
            # 재시도: 반기보고서 PDF 첨부 추출 (있으면 index 0)
            r = await call_and_capture(
                session, "get_attachments", {"rcept_no": "20250814003156", "mode": "extract", "index": 0, "truncate_at": 3000},
                "DARTSURVEY-chrisryugj-attachment-extract-semiannual-idx0.json",
                "반기보고서 첨부 index 0 추출 시도",
                timeout_s=180,
            )

asyncio.run(main())
