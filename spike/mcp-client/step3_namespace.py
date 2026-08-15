"""
S2 단계 3 — 네임스페이스 충돌 실험
pykrx-mcp + drfirst/korea-stock-mcp 를 동시에 연결하고
"서버명__툴명" 으로 합쳤을 때 이름 규칙 ^[A-Za-z0-9_-]{1,64}$ 위반 여부를 확인한다.
"""
import asyncio
import json
import re
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

CAPTURES = Path(__file__).resolve().parents[1] / "captures"
VENV_PY = Path(__file__).resolve().parent / ".venv" / "Scripts" / "pykrx-mcp.exe"

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


async def get_tools(server_params, label):
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            result = await session.list_tools()
            return {
                "server_label": label,
                "reported_server_name": init.serverInfo.name,
                "reported_server_version": init.serverInfo.version,
                "tools": [t.name for t in result.tools],
            }


async def main():
    pykrx_params = StdioServerParameters(command=str(VENV_PY), args=[], env=None)
    drfirst_params = StdioServerParameters(command="npx", args=["-y", "@drfirst/korea-stock-mcp"], env=None)

    # 진짜 동시 연결 - asyncio.gather 로 두 stdio 서버를 병렬 spawn
    pykrx_info, drfirst_info = await asyncio.gather(
        get_tools(pykrx_params, "pykrx"),
        get_tools(drfirst_params, "drfirst-korea-stock"),
    )

    print("pykrx reported name:", pykrx_info["reported_server_name"], file=sys.stderr)
    print("drfirst reported name:", drfirst_info["reported_server_name"], file=sys.stderr)

    namespaced = []
    violations = []

    for info, chosen_registry_name in [
        (pykrx_info, "pykrx"),
        (drfirst_info, "drfirst-korea-stock"),
    ]:
        for tool in info["tools"]:
            full = f"{chosen_registry_name}__{tool}"
            ok = bool(NAME_RE.match(full))
            namespaced.append({"namespaced_name": full, "length": len(full), "valid": ok})
            if not ok:
                violations.append(full)

    # 극단 케이스: everything 서버 이름이 길거나 특수한 경우도 확인
    long_case = "user-registered-very-long-server-name-for-korean-market-data" + "__" + "get_market_fundamental_by_date"
    namespaced.append({"namespaced_name": long_case, "length": len(long_case), "valid": bool(NAME_RE.match(long_case))})
    if not NAME_RE.match(long_case):
        violations.append(long_case)

    # 두 서버가 self-report 하는 이름이 실제로 "korea-stock-mcp" 계열로 충돌하는지도 기록
    collision_note = {
        "known_collision": "jjlabsio/korea-stock-mcp vs drfirst/korea-stock-mcp share the package family name 'korea-stock-mcp'",
        "drfirst_self_reported_name": drfirst_info["reported_server_name"],
        "conclusion": "self-reported serverInfo.name is NOT a safe namespace key; registry must key on user-assigned registration name, not serverInfo.name",
    }

    report = {
        "servers": [pykrx_info, drfirst_info],
        "namespaced_tools": namespaced,
        "violations": violations,
        "violation_count": len(violations),
        "collision_note": collision_note,
    }

    print(json.dumps(report, indent=2, ensure_ascii=False), file=sys.stderr)

    (CAPTURES / "S2-namespace-experiment.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("[DONE] step3 namespace ok, violations:", len(violations), file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
