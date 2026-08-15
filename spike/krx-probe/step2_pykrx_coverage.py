"""
조사 4 — pykrx-mcp 가 KRX 오픈API(종목기본정보/일별매매정보)를 대체 가능한가?
8개 툴 전부를 실제로 호출해 필드 형상을 캡처한다. 키 불필요.
"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CAPTURES = Path(__file__).resolve().parents[2] / "spike" / "captures"
CAPTURES.mkdir(parents=True, exist_ok=True)
VENV_PY = Path(__file__).resolve().parents[1] / "mcp-client" / ".venv" / "Scripts" / "pykrx-mcp.exe"

TICKER = "005930"  # 삼성전자
START = "20240102"
END = "20240112"
DATE = "20240102"


def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj


async def call(session, name, args, results, errors):
    try:
        r = await session.call_tool(name, args)
        cap = to_jsonable(r)
        results[name] = {"args": args, "result": cap, "isError": r.isError}
        print(f"  {name}: isError={r.isError}", file=sys.stderr)
    except Exception as e:
        errors[name] = {"args": args, "exception": repr(e)}
        print(f"  {name}: EXCEPTION {e!r}", file=sys.stderr)


async def main():
    server_params = StdioServerParameters(command=str(VENV_PY), args=[], env=None)
    results = {}
    errors = {}

    print("[1] spawning pykrx-mcp...", file=sys.stderr)
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            init_result = await session.initialize()
            print("protocolVersion:", init_result.protocolVersion, file=sys.stderr)

            print("[2] calling all 8 tools...", file=sys.stderr)
            await call(session, "get_stock_ohlcv", {"ticker": TICKER, "start_date": START, "end_date": END, "adjusted": True}, results, errors)
            await call(session, "get_market_ticker_list", {"date": DATE, "market": "KOSPI"}, results, errors)
            await call(session, "get_market_ticker_name", {"ticker": TICKER}, results, errors)
            await call(session, "get_market_fundamental_by_date", {"ticker": TICKER, "start_date": START, "end_date": END}, results, errors)
            await call(session, "get_market_cap_by_date", {"ticker": TICKER, "start_date": START, "end_date": END}, results, errors)
            await call(session, "get_market_trading_value_by_date", {"ticker": TICKER, "start_date": START, "end_date": END}, results, errors)
            await call(session, "get_etf_ohlcv_by_date", {"ticker": "069500", "start_date": START, "end_date": END}, results, errors)
            await call(session, "get_etf_ticker_list", {"date": DATE}, results, errors)

    out = {"results": results, "errors": errors}
    out_path = CAPTURES / "KRX-pykrx-coverage.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"WROTE {out_path}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
