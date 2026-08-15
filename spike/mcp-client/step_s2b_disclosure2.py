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


def has_replacement_char(obj):
    s = json.dumps(obj, ensure_ascii=False)
    return "�" in s


async def call_and_capture(session, tool_name, args, capture_name, log, label=None):
    entry = {"tool": tool_name, "args": args, "label": label}
    try:
        r = await session.call_tool(tool_name, args)
        rcap = to_jsonable(r)
        entry["result"] = rcap
        entry["isError"] = r.isError
        text0 = None
        if r.content and len(r.content) > 0 and hasattr(r.content[0], "text"):
            text0 = r.content[0].text
        entry["content0_text_len"] = len(text0) if text0 is not None else None
        entry["has_structuredContent"] = r.structuredContent is not None
        entry["has_ufffd"] = has_replacement_char(rcap)
        entry["content0_text_head500"] = text0[:500] if text0 else None
    except Exception as e:
        entry["exception"] = f"{type(e).__name__}: {e}"
    (CAPTURES / capture_name).write_text(
        json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    log.append({
        "label": label,
        "tool": tool_name,
        "args": args,
        "capture_file": capture_name,
        "isError": entry.get("isError"),
        "exception": entry.get("exception"),
        "content0_text_len": entry.get("content0_text_len"),
        "has_structuredContent": entry.get("has_structuredContent"),
        "has_ufffd": entry.get("has_ufffd"),
    })
    return entry


async def main():
    env_vars = load_env()
    dart_key = env_vars.get("DART_API_KEY")
    krx_key = env_vars.get("KRX_API_KEY")

    child_env = dict(os.environ)
    if dart_key:
        child_env["DART_API_KEY"] = dart_key
    if krx_key:
        child_env["KRX_API_KEY"] = krx_key

    server_params = StdioServerParameters(
        command="npx", args=["-y", "@iflow-mcp/jjlabsio-korea-stock-mcp"], env=child_env
    )

    log = []

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("protocolVersion:", init.protocolVersion, file=sys.stderr)

            # Known-good periodic report rcept_nos (verified via raw DART document.xml -> real zip)
            # 1. 사업보고서 (annual report, 2025.12) - raw zip 780KB - "large" candidate
            large_entry = await call_and_capture(
                session, "get_disclosure", {"rcept_no": "20260310002820"},
                "S2B-jjlabsio-disclosure-LARGE-annual.json", log,
                label="사업보고서(2025.12) 780KB raw zip",
            )
            print("LARGE annual isError:", large_entry.get("isError"), "len:", large_entry.get("content0_text_len"), file=sys.stderr)

            # 2. 반기보고서 (semiannual report, 2025.06) - raw zip 474KB
            semi_entry = await call_and_capture(
                session, "get_disclosure", {"rcept_no": "20250814003156"},
                "S2B-jjlabsio-disclosure-SEMI-annual.json", log,
                label="반기보고서(2025.06) 474KB raw zip",
            )
            print("SEMI isError:", semi_entry.get("isError"), "len:", semi_entry.get("content0_text_len"), file=sys.stderr)

            # 3. 1분기보고서 (Q1 report, 2025.03) - likely smaller
            q1_entry = await call_and_capture(
                session, "get_disclosure", {"rcept_no": "20250515001922"},
                "S2B-jjlabsio-disclosure-Q1.json", log,
                label="1분기보고서(2025.03)",
            )
            print("Q1 isError:", q1_entry.get("isError"), "len:", q1_entry.get("content0_text_len"), file=sys.stderr)

            # If LARGE succeeded and looks like TOC w/ section_id, try fetching a section
            def extract_parsed(entry):
                if entry.get("isError") or entry.get("exception"):
                    return None
                result = entry["result"]
                sc = result.get("structuredContent")
                text0 = None
                if result.get("content") and len(result["content"]) > 0:
                    text0 = result["content"][0].get("text")
                parsed = sc
                if parsed is None and text0:
                    try:
                        parsed = json.loads(text0)
                    except Exception:
                        parsed = None
                return parsed, text0

            large_parsed, large_text0 = extract_parsed(large_entry) or (None, None)
            print("LARGE parsed type:", type(large_parsed), file=sys.stderr)
            if isinstance(large_parsed, dict):
                print("LARGE parsed keys:", list(large_parsed.keys()), file=sys.stderr)

            section_id = None
            if isinstance(large_parsed, dict):
                # look for TOC-like structure
                for key in ("toc", "sections", "table_of_contents"):
                    if key in large_parsed:
                        toc = large_parsed[key]
                        print(f"found TOC-like key '{key}':", json.dumps(toc, ensure_ascii=False)[:1000], file=sys.stderr)
                        if isinstance(toc, list) and len(toc) > 0:
                            first = toc[0]
                            if isinstance(first, dict):
                                section_id = first.get("section_id") or first.get("sectionId") or first.get("id")
                        break

            if section_id:
                sec_entry = await call_and_capture(
                    session, "get_disclosure",
                    {"rcept_no": "20260310002820", "section_id": section_id},
                    "S2B-jjlabsio-disclosure-LARGE-section.json", log,
                    label=f"사업보고서 section_id={section_id}",
                )
                print("SECTION fetch isError:", sec_entry.get("isError"), "len:", sec_entry.get("content0_text_len"), file=sys.stderr)
            else:
                print("No section_id found in LARGE parsed response - trying section_id param blind guess", file=sys.stderr)
                # try a blind guess with section_id=1 or "1"
                for guess in ["1", 1]:
                    sec_entry = await call_and_capture(
                        session, "get_disclosure",
                        {"rcept_no": "20260310002820", "section_id": guess},
                        f"S2B-jjlabsio-disclosure-LARGE-section-guess-{guess}.json", log,
                        label=f"사업보고서 section_id guess={guess}",
                    )
                    print(f"SECTION guess={guess} isError:", sec_entry.get("isError"), "exc:", sec_entry.get("exception"), file=sys.stderr)

            # Also re-confirm the ownership-report failure mode (ADM-ZIP error, not real "small disclosure")
            own_entry = await call_and_capture(
                session, "get_disclosure", {"rcept_no": "20260814003973"},
                "S2B-jjlabsio-disclosure-OWNERSHIP-fail.json", log,
                label="임원ㆍ주요주주특정증권등소유상황보고서 (문서저장소 미존재 확인용)",
            )
            print("OWNERSHIP isError:", own_entry.get("isError"), file=sys.stderr)

    (CAPTURES / "S2B-jjlabsio-disclosure2-SUMMARY.json").write_text(
        json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("=== SUMMARY ===", file=sys.stderr)
    for e in log:
        print(json.dumps(e, ensure_ascii=False), file=sys.stderr)


asyncio.run(main())
