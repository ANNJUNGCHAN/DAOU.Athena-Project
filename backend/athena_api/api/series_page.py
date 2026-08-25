"""시계열 표 TR 한 페이지 조회 — 원시 응답을 canonical 시계열로 바꿔 돌려준다.

왜 `chart-page`를 넓히지 않았나(2026-08-26): `chart_page.py`의 게이트는
`resolve_screen_render_contract`가 `"chart"`를 돌려줄 때만 통과시킨다. 그 판정은
`data.chart`가 아니라 `presentation.renderer_id`/`layout`에서 파생되므로
(`canvas_transform.py` `resolve_render_plan_kind`), 대상 TR(layout="table")은 분기에
도달조차 못 한다. 게이트를 넓히면 blast radius가 `table`/`facts`/`compound` 전체가 된다.

그래서 라우트를 따로 두고 게이트도 따로 명시한다. TR을 부르는 글루만
`_screen_tr.run_screen_tr`로 공유한다(계획서 Option C).

🔒 조회 전용: `resolve_screen_render_contract`가 `classification.category != "read_display"`를
먼저 막는다 — 발주(kt*)·WebSocket TR은 여기 도달하지 못한다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from athena_api.api._screen_tr import run_screen_tr
from athena_api.canvas_transform import (
    build_series_body,
    resolve_screen_render_contract,
    screen_definition_for,
)
from athena_api.dependencies import KiwoomClientDep

router = APIRouter(tags=["Series page"])


class SeriesPageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_ref: str = Field(min_length=1)
    # TR 요청 필드 그대로.
    args: dict[str, Any] = Field(default_factory=dict)
    # 장중 계약(time_hhmmss)의 거래일. **args가 아니라 여기로 받는다** — ka10064의
    # 입력 허용 필드는 mrkt_tp·amt_qty_tp·trde_tp·stk_cd뿐이라 base_dt를 args에 넣으면
    # TR이 거부한다(2026-08-26 실서버 실측). 이건 TR 인자가 아니라 **응답 해석에
    # 필요한 맥락**이므로 요청 본문에서 분리하는 게 맞다.
    base_dt: str | None = Field(default=None, pattern=r"^\d{8}$")
    # 그릴 열. **비우면 거부한다** — 자동으로 고르지 않는다. 계약의 column_priority
    # 첫 열이 cur_prc(현재가)/pred_pre(전일대비)인 경우가 있어(실측) 자동 선택은
    # 수급이 아닌 값을 그리게 된다.
    fields: list[str] = Field(default_factory=list)


class SeriesPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 일·주·월·년은 'YYYY-MM-DD' 문자열, 장중은 epoch 초(int).
    time: str | int
    value: float


class Series(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    # 계약(fields[].label)에서 온다 — 앱이 지어내지 않는다.
    label: str
    points: list[SeriesPoint]


class SeriesPageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tr_id: str
    series: list[Series]
    rows_total: int
    trimmed: bool


@router.post(
    "/api/v1/canvas/series-page",
    response_model=SeriesPageResponse,
    operation_id="canvas_series_page",
    summary="Fetch one time-series page from a table-contract TR",
    description=(
        "Runs one read/display table TR that declares a time axis and returns canonical "
        "series for the requested columns. Chart, order, and WebSocket operations are refused."
    ),
)
async def canvas_series_page(
    payload: SeriesPageRequest,
    request: Request,
    response: Response,
    client: KiwoomClientDep,
) -> SeriesPageResponse:
    contract = resolve_screen_render_contract(payload.operation_ref)
    if isinstance(contract, str):
        raise HTTPException(status_code=422, detail=contract)
    if contract[0] != "table":
        raise HTTPException(status_code=422, detail="시계열 표 계약이 아니다")

    definition = screen_definition_for(payload.operation_ref)
    if definition is None:
        raise HTTPException(status_code=422, detail="화면 정의가 없다")
    time_meta = (definition.get("data") or {}).get("time") or {}
    if not time_meta.get("field_path"):
        raise HTTPException(status_code=422, detail="시간축 계약이 없다")
    if not payload.fields:
        raise HTTPException(status_code=422, detail="그릴 열을 지정해야 한다")

    tr_id = payload.operation_ref.partition(":")[2]
    tr_data = await run_screen_tr(
        payload.operation_ref,
        payload.args,
        request,
        response,
        client,
        unknown_detail="Unknown series operation_ref",
    )

    built = build_series_body(
        payload.operation_ref,
        tr_data,
        list(payload.fields),
        base_dt=payload.base_dt,
    )
    if isinstance(built, str):
        # 변환 실패를 빈 배열로 덮지 않는다 — 값이 없는 것과 못 만든 것은 다르다.
        raise HTTPException(status_code=502, detail=built)
    body, meta = built
    return SeriesPageResponse(
        tr_id=tr_id,
        series=[Series(**entry) for entry in body["series"]],
        rows_total=int(meta["rows_total"]),
        trimmed=bool(meta["trimmed"]),
    )
