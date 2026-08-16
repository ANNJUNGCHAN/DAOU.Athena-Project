"""테스트용 stdio MCP 서버 — `client.py` 통합 테스트에서 실제 subprocess로 spawn된다.

npx/node 없이도(§1단계 후보 서버 없이도) 진짜 spawn -> initialize -> list_tools
-> call_tool 왕복을 검증하기 위한 최소 FastMCP 서버. `backend/.venv`의 python으로
직접 실행된다(`sys.executable this_file.py`).

`CRASH_AFTER_N_CALLS` 환경변수를 주면 그 횟수만큼 `flaky` 툴을 호출한 뒤
`os._exit(1)`로 응답 없이 죽는다 — 크래시/재시작 테스트용.
"""

from __future__ import annotations

import asyncio
import os

from mcp.server.fastmcp import Context, FastMCP

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


@mcp.tool()
def datalab_shopping_keyword_by_device_and_gender_breakdown() -> str:
    """긴 툴 이름 — 64자 규칙 2차 방어선(aggregator)을 실제 서버로 재현한다.

    실측된 최장 툴 이름은 `naver-search-mcp`의
    `datalab_shopping_keyword_by_device`(34자)였고, `registry.py`의 별칭 상한
    28자는 그 값을 예약 폭으로 삼아 역산됐다. 그보다 긴 이름이 오면 별칭이
    상한 안이어도 `별칭__툴명`이 64자를 넘는다 — 이 툴이 그 조건을 만든다
    (56자: 28자 별칭 + '__' + 56 = 86자).
    """
    return "ok"


@mcp.tool()
def large_response(size: int) -> str:
    """`size`자 길이의 문자열을 반환한다 — `client.py`의 응답 크기 상한
    (`ResponseTooLargeError`)을 진짜 subprocess 왕복으로 검증하기 위한 픽스처.
    실제 DART 대용량 캡처(1,042,014자, `spike/mcp-client/CAPTURE-S2B-jjlabsio.md`)를
    흉내내되 크기를 인자로 조절해 상한 위/아래 양쪽을 다 재현한다."""
    return "x" * size


@mcp.tool()
async def progress_tool(steps: int, ctx: Context, delay_seconds: float = 0.0) -> str:
    """`steps`번 진행 알림을 보낸 뒤 완료 문자열을 반환한다.

    `delay_seconds`가 0이면 진행 알림 전달 자체만 빠르게 검증한다. 양수를 주면
    스텝 사이에 그만큼 쉬어서, 클라이언트 쪽에서 도중에 태스크를 취소하는
    테스트(취소가 크래시로 오분류되지 않는지)가 끼어들 시간을 벌어준다.
    """
    for i in range(steps):
        if delay_seconds:
            await asyncio.sleep(delay_seconds)
        await ctx.report_progress(i + 1, steps, f"step {i + 1}/{steps}")
    return f"done after {steps} steps"


if __name__ == "__main__":
    mcp.run(transport="stdio")
