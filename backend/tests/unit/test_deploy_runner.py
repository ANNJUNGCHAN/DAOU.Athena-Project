"""자동 매매를 굴리는 바퀴 — 누구를 보고 누구를 건너뛰는가.

`deploy_runner`는 판정 규칙을 갖지 않는다(그건 deploy·deploy_orders의 몫). 여기가 정하는
것은 **이번 바퀴에 볼 배포**뿐이고, 그래서 이 파일은 "안 봐야 할 배포를 봤는가"를 본다.
스케줄러 쪽은 이음새 하나를 확인한다: 주입하지 않으면 자동 주문 루프가 아예 서지 않는다.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

from athena_api.backtest import deploy_runner
from athena_api.routines.scheduler import RoutineScheduler

_LIMITS = json.dumps(
    {
        "max_order_amount": 3_000_000,
        "max_orders_per_day": 3,
        "valid_from": "20250101",
        "valid_to": "20991231",
        "stop_on_drawdown_pct": 15.0,
        "stop_on_consecutive_losses": 3,
    }
)


@dataclass
class _Row:
    id: str
    mode: str = "auto"
    armed: bool = True
    status: str = "active"
    limits_json: str = _LIMITS
    strategy_version_id: str = "v1"
    run_id: str | None = None
    stk_cd: str = "005930"
    period: str = "day"
    adjusted: bool = True


def test_only_auto_armed_and_live_deployments_are_picked() -> None:
    rows = (
        _Row("keep"),
        _Row("not-armed", armed=False),
        _Row("approve-mode", mode="approve"),
        _Row("observe-mode", mode="observe"),
        _Row("stopped", status="stopped"),
    )
    assert [r.id for r in deploy_runner.armed_rows(rows)] == ["keep"]


def test_a_row_with_broken_limits_is_skipped_not_guessed() -> None:
    # 한도를 못 읽는 행을 "한도 없음"으로 읽으면 한도 없는 자동 주문이 된다.
    rows = (_Row("broken", limits_json="{}"), _Row("fine"))
    assert [r.id for r in deploy_runner.armed_rows(rows)] == ["fine"]


def test_a_row_missing_the_armed_column_reads_as_unarmed() -> None:
    @dataclass
    class _Old:
        id: str = "old"
        mode: str = "auto"
        status: str = "active"
        limits_json: str = _LIMITS
        strategy_version_id: str = "v1"
        run_id: str | None = None
        stk_cd: str = "005930"
        period: str = "day"
        adjusted: bool = True

    assert deploy_runner.armed_rows((_Old(),)) == []


def test_runner_does_nothing_without_a_backtest_store() -> None:
    class _State:
        pass

    class _App:
        state = _State()

    # 백테스트가 안 열린 앱에서 조용히 아무 일도 하지 않아야 한다(예외도 안 된다).
    asyncio.run(deploy_runner.make_runner(_App())())


def test_runner_skips_the_evaluate_call_when_nothing_is_armed() -> None:
    calls: list[str] = []

    class _Store:
        async def deployments(self) -> tuple[Any, ...]:
            calls.append("listed")
            return (_Row("a", armed=False), _Row("b", mode="approve"))

    class _State:
        backtest_store = _Store()

    class _App:
        state = _State()

    asyncio.run(deploy_runner.make_runner(_App())())
    # 목록은 읽되 판정 함수까지 가지 않는다 — 임포트조차 하지 않는 빠른 경로다.
    assert calls == ["listed"]


def test_scheduler_has_no_deployment_loop_unless_the_runner_is_injected() -> None:
    async def scenario() -> None:
        bare = RoutineScheduler(store=object(), engine=object(), notify=_noop)
        await bare.start()
        try:
            # 주입하지 않으면 배포 루프는 아예 서지 않는다.
            assert len(bare._tasks) == 1  # schedule 루프 하나뿐
        finally:
            await bare.stop()

        ticks: list[int] = []

        async def runner() -> None:
            ticks.append(1)

        wired = RoutineScheduler(
            store=object(),
            engine=object(),
            notify=_noop,
            run_deployments_once=runner,
            deployment_poll_interval_s=0.01,
        )
        await wired.start()
        try:
            assert len(wired._tasks) == 2
            await asyncio.sleep(0.05)
            assert ticks, "주입한 러너가 한 번도 불리지 않았다"
        finally:
            await wired.stop()

    asyncio.run(scenario())


def test_a_failing_tick_does_not_kill_the_loop_and_is_recorded() -> None:
    async def scenario() -> None:
        ticks: list[int] = []

        async def runner() -> None:
            ticks.append(1)
            raise RuntimeError("한 배포가 터졌다")

        scheduler = RoutineScheduler(
            store=object(),
            engine=object(),
            notify=_noop,
            run_deployments_once=runner,
            deployment_poll_interval_s=0.01,
        )
        await scheduler.start()
        try:
            await asyncio.sleep(0.08)
            # 자동 매매가 조용히 죽으면 사람은 여전히 켜져 있다고 믿는다.
            assert len(ticks) >= 2, "한 번 터지고 루프가 멈췄다"
            assert scheduler.last_error and "배포 판정 실패" in scheduler.last_error
        finally:
            await scheduler.stop()

    asyncio.run(scenario())


async def _noop(_event: dict[str, Any]) -> None:
    return None
