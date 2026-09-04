"""무장된 배포를 주기적으로 판정한다 — 자동 매매를 실제로 굴리는 바퀴(보드 23).

**왜 루틴 스케줄러에 얹었나.** 이 앱에는 이미 승인·원장·정지·가드를 갖춘 주기 실행
엔진이 하나 있다(`routines/scheduler.py`). 자동 주문 전용 루프를 새로 만들면 "무엇이
지금 도는가"를 두 곳에서 봐야 하고, 멈추는 법도 둘이 된다. 그래서 스케줄러에는
`run_deployments_once`라는 이음새 하나만 더했고(아카이브 루프와 같은 모양), 배포가
무엇인지는 이 모듈만 안다.

**이 모듈은 판정 규칙을 갖지 않는다.** 한도·기간·정지 조건은 `deploy.evaluate_latest`가,
집행 조건은 `deploy_orders.is_armed_for_auto`가 쥔다. 여기가 하는 일은 "누구를 볼 것인가"
뿐이다 — 규칙을 여기에 한 줄이라도 베끼면 화면이 본 규칙과 자동이 쓴 규칙이 갈라진다.

**한 배포의 실패가 다른 배포를 멈추지 않는다.** 한 종목의 봉이 없다고 나머지 배포가
서면, 사람은 여전히 자동 매매가 도는 줄 안다.
"""

from __future__ import annotations

import logging
from typing import Any

from athena_api.backtest import deploy as deploy_mod
from athena_api.backtest import deploy_orders
from athena_api.backtest.store import BacktestStore

logger = logging.getLogger(__name__)


def _deployment_of(row: Any) -> deploy_mod.Deployment | None:
    """저장 행을 판정용 값으로 옮긴다. 한도가 깨진 행은 건너뛴다(해석하지 않는다)."""
    import json

    try:
        limits = deploy_mod.Limits(**json.loads(row.limits_json))
    except (TypeError, ValueError):
        return None
    return deploy_mod.Deployment(
        id=row.id,
        strategy_version_id=row.strategy_version_id,
        run_id=row.run_id,
        stk_cd=row.stk_cd,
        period=row.period,
        adjusted=row.adjusted,
        mode=row.mode,
        params={},
        limits=limits,
        status=row.status,
    )


def armed_rows(rows: tuple[Any, ...]) -> list[Any]:
    """이번 바퀴에 볼 배포만 고른다 — auto · 무장 · 살아 있음.

    순수 함수다. 무엇이 걸러지는지가 테스트로 고정돼야 "안 나가야 할 주문이 나갔다"는
    회귀를 잡을 수 있다.
    """
    picked: list[Any] = []
    for row in rows:
        deployment = _deployment_of(row)
        if deployment is None:
            continue
        if deploy_orders.is_armed_for_auto(deployment, armed=bool(getattr(row, "armed", False))):
            picked.append(row)
    return picked


def make_runner(app: Any) -> Any:
    """스케줄러에 주입할 `run_deployments_once`를 만든다.

    앱을 늦게 읽는 이유는 스토어·주문 클라이언트가 lifespan 도중에 세워지기 때문이다 —
    시작 시점에 값을 붙잡아두면 아직 없는 것을 붙잡는다.
    """

    async def run_once() -> None:
        store: BacktestStore | None = getattr(app.state, "backtest_store", None)
        if store is None:
            return
        rows = await store.deployments()
        targets = armed_rows(rows)
        if not targets:
            return
        # 라우트와 같은 함수를 지난다 — 판정·집행 경로는 하나뿐이다.
        from athena_api.api.backtest import evaluate_deployment_once

        order_client = getattr(app.state, "kiwoom_order_client", None)
        for row in targets:
            try:
                await evaluate_deployment_once(
                    app, store, row, order_client=order_client, params={}
                )
            except Exception:  # noqa: BLE001 — 한 배포의 실패가 나머지를 멈추면 안 된다
                logger.exception("배포 판정 실패 deployment_id=%s", row.id)

    return run_once
