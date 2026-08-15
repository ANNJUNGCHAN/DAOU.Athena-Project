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

async def call_and_capture(session, tool_name, args, capture_name, timeout_s=180):
    print(f"--- calling {tool_name}({args}) ---", file=sys.stderr)
    try:
        r = await asyncio.wait_for(session.call_tool(tool_name, args), timeout=timeout_s)
        cap = to_jsonable(r)
        print(f"OK isError={r.isError}", file=sys.stderr)
        out = {"tool": tool_name, "args": args, "result": cap}
        (CAPTURES / capture_name).write_text(
            json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return cap
    except asyncio.TimeoutError:
        print(f"TIMEOUT after {timeout_s}s", file=sys.stderr)
        out = {"tool": tool_name, "args": args, "result": None, "error": f"client-side timeout after {timeout_s}s"}
        (CAPTURES / capture_name).write_text(
            json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return None
    except Exception as e:
        print(f"EXCEPTION {type(e).__name__}: {e}", file=sys.stderr)
        out = {"tool": tool_name, "args": args, "result": None, "error": f"{type(e).__name__}: {e}"}
        (CAPTURES / capture_name).write_text(
            json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return None

async def main():
    dart_key = load_dart_key()
    server_params = StdioServerParameters(
        command=str(VENV_PYTHON),
        args=["dart.py"],
        cwd=str(VENDOR_DIR),
        env={"DART_API_KEY": dart_key, "SystemRoot": os.environ.get("SystemRoot", "")},
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("protocolVersion:", init.protocolVersion, file=sys.stderr)

            # 1) 매출/영업이익 계열 - search_disclosure
            await call_and_capture(
                session, "search_disclosure",
                {
                    "company_name": "삼성전자",
                    "start_date": "20240101",
                    "end_date": "20240401",
                    "requested_items": ["매출액", "영업이익"],
                },
                "S2B-dartmcp-search_disclosure-revenue.json",
            )

            # 2) 세그먼트(사업부별 매출) - search_business_information
            await call_and_capture(
                session, "search_business_information",
                {
                    "company_name": "삼성전자",
                    "start_date": "20240101",
                    "end_date": "20240401",
                    "information_type": "매출 및 수주상황",
                },
                "S2B-dartmcp-search_business_information-segment.json",
            )

            # 3) 재무비율/상세재무 계열 - search_json_financial_data (손익계산서, 연결)
            await call_and_capture(
                session, "search_json_financial_data",
                {
                    "company_name": "삼성전자",
                    "bsns_year": "2023",
                    "reprt_code": "11011",
                    "fs_div": "CFS",
                    "statement_type": "IS",
                },
                "S2B-dartmcp-search_json_financial_data-IS.json",
            )

asyncio.run(main())
