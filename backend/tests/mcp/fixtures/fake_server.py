"""테스트용 stdio MCP 서버 — `client.py` 통합 테스트에서 실제 subprocess로 spawn된다.

npx/node 없이도(§1단계 후보 서버 없이도) 진짜 spawn -> initialize -> list_tools
-> call_tool 왕복을 검증하기 위한 최소 FastMCP 서버. `backend/.venv`의 python으로
직접 실행된다(`sys.executable this_file.py`).

`CRASH_AFTER_N_CALLS` 환경변수를 주면 그 횟수만큼 `flaky` 툴을 호출한 뒤
`os._exit(1)`로 응답 없이 죽는다 — 크래시/재시작 테스트용.
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("fake-athena-fixture")

_call_count = {"flaky": 0}
_CRASH_AFTER_N = int(os.environ.get("CRASH_AFTER_N_CALLS", "0"))


@mcp.tool()
def echo(message: str) -> str:
    """Echo: <message>"""
    return f"Echo: {message}"


@mcp.tool()
def get_corp_code(corp_name: str) -> dict:
    """실측 캡처(S2B-jjlabsio-corp-code.json)와 동일하게 corp_code를 숫자로 준다."""
    return {"corp_code": 126380, "corp_name": corp_name, "stock_code": 5930}


@mcp.tool()
def boom() -> str:
    """isError=True 를 강제로 발생시킨다."""
    raise ValueError("boom: 의도된 에러")


@mcp.tool()
def flaky() -> str:
    """`CRASH_AFTER_N_CALLS`번째 호출에서 응답 없이 프로세스를 죽인다."""
    _call_count["flaky"] += 1
    if _CRASH_AFTER_N and _call_count["flaky"] >= _CRASH_AFTER_N:
        os._exit(1)  # noqa: SLF001 — 의도된 크래시 시뮬레이션, 정상 종료 경로 우회
    return f"ok call #{_call_count['flaky']}"


if __name__ == "__main__":
    mcp.run(transport="stdio")
