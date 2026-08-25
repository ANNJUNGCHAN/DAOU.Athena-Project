"""화면 정의 기반 TR 실행 글루 — chart-page와 series-page가 공유한다.

왜 따로 두는가(2026-08-26): 두 라우트는 **게이트와 응답이 서로 다르지만**(chart 계약 vs
table+시계열 계약) TR을 실제로 부르는 절차는 같다 — operation_ref에서 tr_id를 꺼내
레지스트리로 검증하고 `call_raw_tr`로 실행한다. 이 부분만 공유하고 게이트·응답 모델은
각 라우트가 자기 것을 갖는다.

한 라우트가 두 응답 모양을 갖게 하지 않는 이유는 `chart_page.py` 상단 주석과 계획서
(.omc/plans/chart-first-supply-indicators.md, Option C)에 있다.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, Response

from athena_api.generated.registry import READ_TR_IDS, TR_REGISTRY
from athena_api.generated.runtime import call_raw_tr


def tr_id_of(operation_ref: str, *, detail: str = "Unknown chart operation_ref") -> str:
    """화면 정의 키('base:ka10081')에서 tr_id를 꺼내 조회 TR 목록으로 검증한다.

    문자열을 신뢰하지 않고 레지스트리에 있는지 본다 — 발주/WS TR은 READ_TR_IDS에 없다.
    """
    _, _, tr_id = operation_ref.partition(":")
    if not tr_id or tr_id not in READ_TR_IDS or tr_id not in TR_REGISTRY:
        raise HTTPException(status_code=404, detail=detail)
    return tr_id


async def run_screen_tr(
    operation_ref: str,
    args: dict[str, Any],
    request: Request,
    response: Response,
    client: Any,
    *,
    unknown_detail: str = "Unknown chart operation_ref",
) -> dict[str, Any]:
    """조회 TR 1건을 실행하고 원시 응답 본문을 돌려준다.

    게이트(계약 종류 판정)는 **호출자가 이미 통과시킨 상태여야 한다** — 여기서는
    tr_id 검증만 하고 실행한다.
    """
    tr_id = tr_id_of(operation_ref, detail=unknown_detail)
    return await call_raw_tr(tr_id, dict(args), request, response, client)
