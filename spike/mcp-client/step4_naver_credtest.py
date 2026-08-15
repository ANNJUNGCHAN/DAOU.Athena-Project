"""
S2B - naver-search-mcp 크레덴셜 체계 판정 (A/B/C 조건 비교)
조건 A: NCP_APIGW_API_KEY_ID + NCP_APIGW_API_KEY 만
조건 B: NAVER_CLIENT_ID + NAVER_CLIENT_SECRET 만
조건 C: 둘 다
각 조건에서 search_news(query="테스트", display=1) 호출 -> 성공/실패 원문 캡처
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


NAVER_KEYS = ["NCP_APIGW_API_KEY_ID", "NCP_APIGW_API_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"]


def build_env(dotenv: dict, include: list[str]) -> dict:
    env = dict(os.environ)
    # 이전에 상속된 값이 있을 수 있으니 4개 다 지우고 include만 채운다
    for k in NAVER_KEYS:
        env.pop(k, None)
    for k in include:
        env[k] = dotenv[k]
    return env


async def run_condition(label: str, env: dict) -> dict:
    server_params = StdioServerParameters(
        command="npx", args=["-y", "@isnow890/naver-search-mcp"], env=env
    )
    result = {"condition": label, "included_vars": [k for k in NAVER_KEYS if k in env]}
    try:
        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                init = await session.initialize()
                result["initialize_ok"] = True
                result["serverInfo"] = to_jsonable(init.serverInfo)
                r = await session.call_tool(
                    "search_news", {"query": "테스트", "display": 1, "sort": "date"}
                )
                rcap = to_jsonable(r)
                result["call_result"] = rcap
                result["isError"] = rcap.get("isError")
    except Exception as e:
        result["exception"] = f"{type(e).__name__}: {e}"
    return result


async def main():
    dotenv = load_dotenv(ENV_FILE)
    conditions = {
        "A_hub_only": ["NCP_APIGW_API_KEY_ID", "NCP_APIGW_API_KEY"],
        "B_legacy_only": ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"],
        "C_both": ["NCP_APIGW_API_KEY_ID", "NCP_APIGW_API_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"],
    }
    all_results = {}
    for label, include in conditions.items():
        env = build_env(dotenv, include)
        print(f"=== {label} ({include}) ===", file=sys.stderr)
        res = await run_condition(label, env)
        print(json.dumps(res, indent=2, ensure_ascii=False), file=sys.stderr)
        all_results[label] = res
        (CAPTURES / f"S2B-naver-credtest-{label}.json").write_text(
            json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    (CAPTURES / "S2B-naver-credtest-summary.json").write_text(
        json.dumps(all_results, indent=2, ensure_ascii=False), encoding="utf-8"
    )


asyncio.run(main())
