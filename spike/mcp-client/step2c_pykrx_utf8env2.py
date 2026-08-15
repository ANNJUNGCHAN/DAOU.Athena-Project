import asyncio, json, os
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CAPTURES = Path(__file__).resolve().parents[1] / "captures"
VENV_PY = Path(__file__).resolve().parent / ".venv" / "Scripts" / "pykrx-mcp.exe"

def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj

async def main():
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8:replace"
    env["PYTHONLEGACYWINDOWSSTDIO"] = "0"
    server_params = StdioServerParameters(command=str(VENV_PY), args=[], env=env)
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            r = await session.call_tool("get_market_ticker_name", {"ticker": "005930"})
            cap = to_jsonable(r)
            print(json.dumps(cap, indent=2, ensure_ascii=False))
            r2 = await session.call_tool("get_stock_ohlcv", {"ticker": "005930", "start_date": "20240102", "end_date": "20240105", "adjusted": True})
            cap2 = to_jsonable(r2)
            print(json.dumps(cap2, indent=2, ensure_ascii=False))

asyncio.run(main())
