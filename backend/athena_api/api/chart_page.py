"""차트 한 페이지 조회 — 원시 TR 응답을 canonical 봉으로 바꿔 돌려준다.

왜 필요한가(2026-08-25): 차트의 과거 구간을 이어 붙이려면 앱이 "봉"을 받아야
하는데, 원시 TR 응답을 봉으로 바꾸는 별칭 표(container/time/OHLCV 경로)는 주기·
대상마다 다르고 화면 정의(kiwoom-screen-definitions.json)에만 있다. 그 표를 앱에
복제하면 계약이 바뀔 때 두 곳이 어긋난다.

그래서 이미 있는 두 조각을 잇기만 한다:
  ① call_raw_tr과 같은 방식으로 차트 TR 1건 실행
  ② canvas_transform.build_aits_chart_body로 canonical 봉 변환

render-plan과 다른 점은 plan_token·캔버스 배달·수신확인이 없다는 것뿐이다. 이건
화면을 그리는 요청이 아니라 데이터만 가져오는 요청이다 — 그래서 렌더 파이프라인
(실행 취소·패널 권위·사이드 채널)에 엮이지 않는다.

🔒 조회 전용: 화면 정의가 chart로 풀리는 operation_ref만 받는다. 발주·WS TR은
resolve_screen_render_contract에서 chart가 아니므로 여기 도달하지 못한다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from athena_api.api._screen_tr import run_screen_tr
from athena_api.canvas_transform import (
    build_aits_chart_body,
    resolve_screen_render_contract,
)
from athena_api.dependencies import KiwoomClientDep

router = APIRouter(tags=["Chart page"])


class ChartPageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_ref: str = Field(min_length=1)
    # TR 요청 필드 그대로(stk_cd·base_dt·tic_scope·upd_stkpc_tp 등). 어떤 필드가
    # 유효한지는 화면 정의의 reload_targets[period].request_fields가 정한다 —
    # 호출자가 그 목록으로 이미 걸러서 보낸다.
    args: dict[str, Any] = Field(default_factory=dict)


class ChartPageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    period: str
    target: str
    tr_id: str
    # 시간 오름차순. 한 페이지 상한은 화면 정의의 max_rows(현재 240)다 —
    # 그보다 과거는 args의 커서(base_dt)를 옮겨 다시 부른다.
    candles: list[dict[str, Any]]
    rows_total: int
    trimmed: bool


@router.post(
    "/api/v1/canvas/chart-page",
    response_model=ChartPageResponse,
    operation_id="canvas_chart_page",
    summary="Fetch one chart page as canonical candles",
    description=(
        "Runs one chart query TR and returns AITS canonical candles. "
        "Order, WebSocket, and non-chart operations are refused."
    ),
)
async def canvas_chart_page(
    payload: ChartPageRequest,
    request: Request,
    response: Response,
    client: KiwoomClientDep,
) -> ChartPageResponse:
    contract = resolve_screen_render_contract(payload.operation_ref)
    if isinstance(contract, str):
        raise HTTPException(status_code=422, detail=contract)
    if contract[0] != "chart":
        raise HTTPException(status_code=422, detail="차트 화면이 아닌 오퍼레이션이다")

    tr_data = await run_screen_tr(
        payload.operation_ref, payload.args, request, response, client
    )

    built = build_aits_chart_body(payload.operation_ref, tr_data)
    if isinstance(built, str):
        # 변환 실패를 빈 배열로 덮지 않는다 — 봉이 없는 것과 못 만든 것은 다르다.
        raise HTTPException(status_code=502, detail=built)
    body, meta = built
    return ChartPageResponse(
        period=body["period"],
        target=body["target"],
        tr_id=body["trId"],
        candles=body["candles"],
        rows_total=int(meta["rows_total"]),
        trimmed=bool(meta["trimmed"]),
    )
