"""기법 저작 라우트 — 코드에서 노드·흐름을 뽑고, 자동 검사 셋을 돌린다(사용자 확정 구도).

**왜 파일을 나눴나.** `backtest.py`에는 실행·백필·활성화·배포가 함께 있다. 기법 저작 경로는
그중 무엇도 부르지 않는다는 것이 계약이라, 그 사실을 파일 경계로 먼저 드러낸다 — 이 파일에는
runner·deploy·키움 클라이언트 import가 없다(`_run_code_signals`는 technique_check 안에서만
쓰이고, 그것도 signals만 돌릴 뿐 실행 이력을 만들지 않는다). 테스트가 그 부재를 고정한다.

**왜 서브시스템 gate(503)가 없나.** `POST /visual/*`과 같다 — 저장하는 것이 없다. 코드를
읽어 노드를 그리고 문법을 보는 일은 ATHENA_BACKTEST_ENABLED와 무관하게 성립해야 한다.
봉 캐시가 필요한 시험 실행만 store에 닿고, store가 없으면 그 검사 하나가 "봉 캐시 없음"으로
남는다 — 라우트 전체를 막지 않는다.

**왜 검사 실패에도 200인가.** 검사 결과는 요청 실패가 아니라 **응답 내용**이다. 422는 몸통에
source가 없을 때만 낸다.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Request

from athena_api.backtest import technique_check as check_mod
from athena_api.backtest import technique_nodes as nodes_mod

router = APIRouter(prefix="/api/v1/backtest/technique", tags=["backtest"])


def _source(body: dict[str, Any]) -> str:
    source = body.get("source")
    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=422, detail="source는 비어 있지 않은 문자열이어야 한다")
    return source


def _frame(rows: Any) -> pd.DataFrame:
    index = pd.to_datetime([c.dt for c in rows], format="%Y%m%d")
    return pd.DataFrame(
        {
            "open": [c.open for c in rows],
            "high": [c.high for c in rows],
            "low": [c.low for c in rows],
            "close": [c.close for c in rows],
            "volume": [c.volume for c in rows],
        },
        index=index,
    )


# 대상이 정해지기 전의 시험 실행에 쓰는 캐시 종목(시드 데이터 005930 일봉).
FALLBACK_SYMBOL = "005930"


async def _cached_bars(
    request: Request, body: dict[str, Any]
) -> tuple[pd.DataFrame | None, str | None]:
    """시험 실행에 쓸 봉을 **캐시에서만** 읽는다 — 없으면 없는 대로 돌려준다.

    여기서 백필을 부르지 않는다: 대량 수집은 키움 쿼터를 태우는 행위라 사람이 앱에서
    승인해야 한다(§9의 backfill 부재와 같은 규율). `adjusted`는 몸통에 없어서 수정주가를
    먼저 보고 없으면 원주가를 본다 — "캐시에 있는 봉"이 이 검사의 대상이기 때문이다.
    """
    store = getattr(request.app.state, "backtest_store", None)
    if store is None:
        return None, None
    symbol = body.get("symbol")
    # 새 기법은 종목을 아직 안 고른 채 시작한다 — 그렇다고 검사가 영영 막히면 노드 창이
    # 열리지 않는다. 대상이 없으면 캐시된 기본 종목으로 시험하고 라벨에 그 사실을 적는다.
    fallback = False
    if not isinstance(symbol, str) or not symbol.strip():
        symbol, fallback = FALLBACK_SYMBOL, True
    period = body.get("period")
    period = period if isinstance(period, str) and period else "day"
    start = body.get("from") if isinstance(body.get("from"), str) else None
    end = body.get("to") if isinstance(body.get("to"), str) else None

    rows: tuple[Any, ...] = ()
    for adjusted in (True, False):
        rows = await store.candles(symbol, period, adjusted, start=start, end=end)
        if rows:
            break
    if not rows:
        return None, f"{symbol} {period}"

    window = rows[-check_mod.DRYRUN_BARS :]
    label = f"{symbol} {period} 최근 {len(window)}봉 · {window[0].dt}~{window[-1].dt}"
    if fallback:
        label = f"대상 미정 — 캐시된 {label}으로 시험"
    return _frame(window), label


@router.post("/nodes")
async def technique_nodes_route(body: dict[str, Any]) -> dict[str, Any]:
    """기법 코드를 노드·흐름 한 장으로 옮긴다. 실행하지 않는다 — `ast`로 읽기만 한다."""
    return nodes_mod.build_nodes(_source(body))


@router.post("/check")
async def technique_check_route(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    """자동 검사 셋. 시험 실행은 캐시된 봉으로 `signals`만 돌리고 아무것도 저장하지 않는다."""
    source = _source(body)
    bars, label = await _cached_bars(request, body)
    return await check_mod.run_checks(source, bars=bars, target_ko=label)


__all__ = ["router"]
