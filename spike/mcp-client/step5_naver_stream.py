"""
S2B - 스트림 캔버스 근거 캡처 (API HUB 조건, 판정 통과 조건으로 실행)
1. search_news(query="삼성전자", sort="date", display=100)
2. search_news(query="삼성전자", sort="sim", display=100)
3. list_tools() 전문
"""
import asyncio, json, os, re, sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
CAPTURES = Path(__file__).resolve().parents[1] / "captures"
ENV_FILE = ROOT / ".env"


def load_dotenv(path: Path) -> dict:
    vals = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            vals[m.group(1)] = m.group(2)
    return vals


def to_jsonable(obj):
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json", exclude_none=False)
    return obj


async def main():
    dotenv = load_dotenv(ENV_FILE)
    env = dict(os.environ)
    for k in ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]:
        env.pop(k, None)
    env["NCP_APIGW_API_KEY_ID"] = dotenv["NCP_APIGW_API_KEY_ID"]
    env["NCP_APIGW_API_KEY"] = dotenv["NCP_APIGW_API_KEY"]

    server_params = StdioServerParameters(
        command="npx", args=["-y", "@isnow890/naver-search-mcp"], env=env
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            print("protocolVersion:", init.protocolVersion, file=sys.stderr)
            print("serverInfo:", init.serverInfo, file=sys.stderr)

            tools = await session.list_tools()
            tcap = to_jsonable(tools)
            (CAPTURES / "S2B-naver-tools.json").write_text(
                json.dumps(tcap, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print("tools:", [t.name for t in tools.tools], file=sys.stderr)

            r_date = await session.call_tool(
                "search_news", {"query": "삼성전자", "sort": "date", "display": 100}
            )
            date_cap = to_jsonable(r_date)
            (CAPTURES / "S2B-naver-news-date.json").write_text(
                json.dumps(date_cap, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print("date call isError:", date_cap.get("isError"), file=sys.stderr)

            r_sim = await session.call_tool(
                "search_news", {"query": "삼성전자", "sort": "sim", "display": 100}
            )
            sim_cap = to_jsonable(r_sim)
            (CAPTURES / "S2B-naver-news-sim.json").write_text(
                json.dumps(sim_cap, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print("sim call isError:", sim_cap.get("isError"), file=sys.stderr)


asyncio.run(main())
