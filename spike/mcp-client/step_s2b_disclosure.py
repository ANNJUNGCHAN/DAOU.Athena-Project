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


async def call_and_capture(session, tool_name, args, capture_name, log):
    entry = {"tool": tool_name, "args": args}
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
    except Exception as e:
        entry["exception"] = f"{type(e).__name__}: {e}"
    (CAPTURES / capture_name).write_text(
        json.dumps(entry, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    log.append({
        "tool": tool_name,
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
    print(f"DART_API_KEY loaded: {bool(dart_key)}, len={len(dart_key) if dart_key else 0}", file=sys.stderr)
    print(f"KRX_API_KEY loaded: {bool(krx_key)}, len={len(krx_key) if krx_key else 0}", file=sys.stderr)

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
            print("serverInfo:", init.serverInfo, file=sys.stderr)

            # 0. get_today_date - to know current date reference
            today_entry = await call_and_capture(session, "get_today_date", {}, "S2B-jjlabsio-today.json", log)
            print("today:", today_entry.get("result"), file=sys.stderr)

            # 1. get_corp_code - Samsung Electronics
            corp_entry = await call_and_capture(
                session, "get_corp_code", {"corp_name": "삼성전자"}, "S2B-jjlabsio-corp-code.json", log
            )
            print("corp_code result isError:", corp_entry.get("isError"), file=sys.stderr)

            corp_code = None
            if not corp_entry.get("isError") and not corp_entry.get("exception"):
                result = corp_entry["result"]
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
                print("corp_code parsed type:", type(parsed), file=sys.stderr)
                print("corp_code parsed sample:", json.dumps(parsed, ensure_ascii=False)[:2000], file=sys.stderr)
                # try to extract corp_code field - could be list or dict
                candidates = parsed
                if isinstance(candidates, dict):
                    # maybe wrapped in a list field
                    for v in candidates.values():
                        if isinstance(v, list):
                            candidates = v
                            break
                if isinstance(candidates, list) and len(candidates) > 0:
                    first = candidates[0]
                    if isinstance(first, dict):
                        corp_code = first.get("corp_code") or first.get("corpCode")
                elif isinstance(candidates, dict):
                    corp_code = candidates.get("corp_code") or candidates.get("corpCode")

            print("extracted corp_code (raw):", corp_code, repr(corp_code), file=sys.stderr)

            if not corp_code:
                # fallback known DART corp_code for Samsung Electronics: 00126380
                corp_code = "00126380"
                print("using fallback known corp_code:", corp_code, file=sys.stderr)
            else:
                # server returns corp_code as a JSON number, losing leading zeros
                # (e.g. 126380 instead of "00126380"). DART corp_code is always 8 digits.
                corp_code = str(corp_code).zfill(8)
                print("normalized corp_code (zero-padded string):", corp_code, file=sys.stderr)

            # 2. get_disclosure_list - recent 1~3 months
            disc_list_entry = await call_and_capture(
                session,
                "get_disclosure_list",
                {
                    "corp_code": corp_code,
                    "bgn_de": "20260501",
                    "end_de": "20260815",
                    "page_no": "00001",
                    "page_count": "020",
                },
                "S2B-jjlabsio-disclosure-list.json",
                log,
            )
            print("disclosure_list isError:", disc_list_entry.get("isError"), file=sys.stderr)

            rcept_nos = []
            if not disc_list_entry.get("isError") and not disc_list_entry.get("exception"):
                result = disc_list_entry["result"]
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
                print("disclosure_list parsed keys:", list(parsed.keys()) if isinstance(parsed, dict) else type(parsed), file=sys.stderr)
                items = None
                if isinstance(parsed, dict):
                    items = parsed.get("list") or parsed.get("items")
                elif isinstance(parsed, list):
                    items = parsed
                if items:
                    for it in items:
                        rn = it.get("rcept_no") or it.get("rceptNo")
                        rpt_nm = it.get("report_nm") or it.get("reportNm")
                        if rn:
                            rcept_nos.append((rn, rpt_nm))
                    print(f"found {len(rcept_nos)} rcept_no candidates", file=sys.stderr)
                    print("sample:", rcept_nos[:10], file=sys.stderr)

            # Save extracted list summary
            (CAPTURES / "S2B-jjlabsio-disclosure-list-extracted.json").write_text(
                json.dumps({"corp_code": corp_code, "rcept_nos": rcept_nos}, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            # 3. get_disclosure for a few candidates - try to find one small and one large
            disclosure_results = []
            # try up to 5 candidates to get variety in size
            for rn, rpt_nm in rcept_nos[:8]:
                entry = await call_and_capture(
                    session, "get_disclosure", {"rcept_no": rn}, f"S2B-jjlabsio-disclosure-{rn}.json", log
                )
                size = entry.get("content0_text_len")
                disclosure_results.append({
                    "rcept_no": rn,
                    "report_nm": rpt_nm,
                    "isError": entry.get("isError"),
                    "exception": entry.get("exception"),
                    "content0_text_len": size,
                    "has_structuredContent": entry.get("has_structuredContent"),
                })
                print(f"get_disclosure({rn}) [{rpt_nm}] -> size={size}, isError={entry.get('isError')}, exc={entry.get('exception')}", file=sys.stderr)

            (CAPTURES / "S2B-jjlabsio-disclosure-survey.json").write_text(
                json.dumps(disclosure_results, indent=2, ensure_ascii=False), encoding="utf-8"
            )

            # 4. get_financial_statement
            fs_entry = await call_and_capture(
                session,
                "get_financial_statement",
                {
                    "corp_code": corp_code,
                    "bsns_year": "2025",
                    "reprt_code": "11011",
                    "fs_div": "CFS",
                },
                "S2B-jjlabsio-financial-statement.json",
                log,
            )
            print("financial_statement isError:", fs_entry.get("isError"), file=sys.stderr)

            # 5. get_market_type
            mt_entry = await call_and_capture(
                session, "get_market_type", {"corp_code": corp_code}, "S2B-jjlabsio-market-type.json", log
            )
            print("market_type isError:", mt_entry.get("isError"), file=sys.stderr)

            # 6. get_stock_base_info (KRX key required)
            sbi_entry = await call_and_capture(
                session,
                "get_stock_base_info",
                {"basDdList": ["20260814"], "market": "KOSPI", "codeList": ["005930"]},
                "S2B-jjlabsio-stock-base-info.json",
                log,
            )
            print("stock_base_info isError:", sbi_entry.get("isError"), file=sys.stderr)

            # 7. get_stock_trade_info (KRX key required)
            sti_entry = await call_and_capture(
                session,
                "get_stock_trade_info",
                {"basDdList": ["20260814"], "market": "KOSPI", "codeList": ["005930"]},
                "S2B-jjlabsio-stock-trade-info.json",
                log,
            )
            print("stock_trade_info isError:", sti_entry.get("isError"), file=sys.stderr)

    (CAPTURES / "S2B-jjlabsio-SUMMARY.json").write_text(
        json.dumps(log, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("=== SUMMARY ===", file=sys.stderr)
    print(json.dumps(log, indent=2, ensure_ascii=False), file=sys.stderr)


asyncio.run(main())
