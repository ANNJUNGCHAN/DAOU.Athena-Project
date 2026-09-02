"""전략 배포 — 검증한 버전을 실전 신호로 잇는다(Paper 보드 07).

**이 모듈은 주문을 내지 않는다.** 신호를 만들고 사람이 미리 정한 한도에 걸리는지 판정할
뿐이다. 실제 주문은 앱의 기존 주문 게이트(보호 워크플로 · 주문 티켓)를 통과한다 — 백테스트
쪽에 두 번째 주문 경로를 만들면 게이트 하나가 지키던 규율이 둘로 갈라진다.

**왜 배포가 `strategy_version_id`에 묶이나.** `bt_run`이 재현성의 축으로 그 필드를 갖는
것과 같은 이유다(store.py). "지금 실전에서 도는 코드가 어느 백테스트의 그 코드인가"를
되짚을 수 없으면 실전 성과와 백테스트 성과를 비교하는 일 자체가 성립하지 않는다.

**왜 한도를 코드가 아니라 배포 행에 두나.** 한도는 사람이 정하는 값이고 모델이 못 바꾸는
값이다(§10.3과 같은 태도 — 값을 코드에 박으면 화면에서 바꿀 수 없고, 바꿀 수 없으면
사람이 정한 값이 아니게 된다). MCP 표면에 배포 생성·수정 액션을 두지 않는 이유이기도 하다.

**신호 시각 규율은 백테스트와 같다.** 신호는 종가 확정 후 판정하고 체결은 다음 봉 시가다
(§6.4 규칙 1·2). 실전에서 이 규율을 바꾸면 백테스트 성과는 더 이상 그 전략의 성과가 아니다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

import pandas as pd

from athena_api.backtest.compile import compile_signals
from athena_api.backtest.schema import StrategySpec

# 신호가 나온 뒤 주문까지 밟는 단계. 화면(보드 07)의 칩 4개와 1:1이다.
Stage = Literal["signal", "pending_approval", "ordered", "filled", "blocked", "skipped"]
Mode = Literal["observe", "approve", "auto"]
Side = Literal["buy", "sell"]

MODE_LABELS: dict[Mode, str] = {
    "observe": "기록만 합니다",
    "approve": "승인을 받고 주문합니다",
    "auto": "한도 안에서 자동으로 주문합니다",
}

# 코드 전략에는 옮겨 적을 조건 스펙이 없다 — 조건을 지어내는 대신 그 사실을 그대로 적는다.
CODE_BASIS = "코드 전략 — 조건은 코드 안에 있습니다"


@dataclass(frozen=True, slots=True)
class Limits:
    """사람이 미리 정하는 한도. 모두 선택이 아니라 필수다 — 비워두면 한도가 없는 것이 되고,
    한도 없는 자동 주문은 이 화면이 약속한 것이 아니다."""

    max_order_amount: float
    max_orders_per_day: int
    valid_from: str  # YYYYMMDD
    valid_to: str  # YYYYMMDD
    stop_on_drawdown_pct: float  # 예: 15.0 → 누적 -15%에서 자동 정지
    stop_on_consecutive_losses: int


@dataclass(frozen=True, slots=True)
class Deployment:
    id: str
    strategy_version_id: str
    run_id: str | None  # 이 배포의 근거가 된 백테스트 실행
    stk_cd: str
    period: str
    adjusted: bool
    mode: Mode
    params: dict[str, float]
    limits: Limits
    status: Literal["active", "stopped", "expired"] = "active"


@dataclass(frozen=True, slots=True)
class Decision:
    """오늘 이 배포가 낸 판정 한 건."""

    dt: str
    side: Side | None
    stage: Stage
    reason: str
    # 사람이 읽는 근거 — 어떤 조건이 참이 되어 신호가 났는지.
    basis: str
    blocked_reason: str | None = None


@dataclass(frozen=True, slots=True)
class DriftReport:
    """실전 대 백테스트 괴리(보드 07 아래 3칸). 값이 없으면 지어내지 않고 None으로 둔다."""

    live_return: float | None
    backtest_return: float | None
    drift: float | None
    filled_count: int
    slipped_count: int
    unfilled_count: int
    notes: tuple[str, ...] = field(default_factory=tuple)


def _basis_text(spec: StrategySpec | None, side: Side) -> str:
    """진입·청산 조건을 사람이 읽는 한 줄로. 조건 스펙 자체를 옮길 뿐 새로 지어내지 않는다."""
    if spec is None:
        return CODE_BASIS
    group = spec.strategy.entry if side == "buy" else spec.strategy.exit
    joiner = " 그리고 " if group.logic == "AND" else " 또는 "
    return joiner.join(
        f"{c.indicator} {c.operator.value} {c.compare_to}" for c in group.conditions
    )


def is_expired(deployment: Deployment, today: str) -> bool:
    return today > deployment.limits.valid_to or today < deployment.limits.valid_from


def evaluate_latest(
    spec: StrategySpec | None,
    df: pd.DataFrame,
    deployment: Deployment,
    *,
    today: str,
    holding: bool,
    orders_today: int,
    order_amount: float,
    consecutive_losses: int = 0,
    drawdown_pct: float = 0.0,
    signals: pd.DataFrame | None = None,
) -> Decision:
    """마지막 봉의 신호를 판정하고 한도를 적용한다.

    `holding`은 지금 그 종목을 들고 있는지다 — 백테스트 엔진의 "보유 중 entry 무시,
    무보유 중 exit 무시"(§6.4 규칙 5)를 실전에서도 그대로 지키기 위해 호출자가 넘긴다.
    이 모듈이 계좌를 직접 조회하지 않는 이유는, 계좌 조회는 이 모듈의 책임이 아니고
    자격증명이 닿는 경로를 여기로 끌어오지 않기 위해서다.

    `signals`는 이미 만들어진 신호 프레임이다 — 코드 전략(kind=python)은 조건이 폼 스펙이
    아니라 파이썬에 있어 이 모듈이 컴파일할 수 없다. 그 경우 호출자가 샌드박스로 만든
    신호를 넘기고 `spec`은 None이 된다(근거 문구는 그래서 CODE_BASIS다). 판정·한도·정지
    규칙은 두 경로가 정확히 같은 코드를 지난다 — 여기서 갈라지면 실전 규율이 둘이 된다.
    """
    if len(df) == 0:
        return Decision(dt=today, side=None, stage="skipped",
                        reason="봉 데이터가 없습니다", basis="")

    if signals is None:
        if spec is None:
            raise ValueError("spec이 없으면 signals를 넘겨야 한다 — 둘 다 없으면 판정할 수 없다")
        signals = compile_signals(spec, df, deployment.params or None)
    last = signals.iloc[-1]
    dt = str(df.index[-1].date()) if hasattr(df.index[-1], "date") else str(df.index[-1])

    entry = bool(last.get("entry", False))
    exit_ = bool(last.get("exit", False))

    # 같은 봉에서 둘 다 참이면 청산 우선 — 엔진의 보수적 규칙(§6.4 규칙 3)과 같은 쪽을 고른다.
    if holding and exit_:
        side: Side | None = "sell"
    elif not holding and entry:
        side = "buy"
    else:
        return Decision(
            dt=dt, side=None, stage="skipped",
            reason="오늘은 조건이 맞지 않았습니다", basis="",
        )

    basis = _basis_text(spec, side)

    if deployment.status != "active":
        return Decision(dt=dt, side=side, stage="blocked", reason="배포가 멈춰 있습니다",
                        basis=basis, blocked_reason="stopped")
    if is_expired(deployment, today):
        return Decision(dt=dt, side=side, stage="blocked", reason="배포 유효기간이 지났습니다",
                        basis=basis, blocked_reason="expired")
    if drawdown_pct <= -abs(deployment.limits.stop_on_drawdown_pct):
        return Decision(
            dt=dt, side=side, stage="blocked",
            reason=(
                f"누적 낙폭이 {deployment.limits.stop_on_drawdown_pct}%를 넘어 "
                "자동 정지했습니다"
            ),
            basis=basis, blocked_reason="drawdown",
        )
    if consecutive_losses >= deployment.limits.stop_on_consecutive_losses:
        return Decision(
            dt=dt, side=side, stage="blocked",
            reason=f"연속 손절 {consecutive_losses}회로 자동 정지했습니다",
            basis=basis, blocked_reason="losses",
        )

    if deployment.mode == "observe":
        return Decision(dt=dt, side=side, stage="signal",
                        reason="기록만 하는 배포입니다", basis=basis)

    # 한도 판정 — 넘으면 자동 집행을 막고 승인 대기로 내린다(보드 07 4행).
    over_count = orders_today >= deployment.limits.max_orders_per_day
    over_amount = order_amount > deployment.limits.max_order_amount
    if deployment.mode == "auto" and (over_count or over_amount):
        reason = (
            f"하루 {deployment.limits.max_orders_per_day}건 소진"
            if over_count
            else f"1회 한도 {deployment.limits.max_order_amount:,.0f}원 초과"
        )
        return Decision(dt=dt, side=side, stage="pending_approval", reason=reason,
                        basis=basis, blocked_reason="limit")

    if deployment.mode == "approve":
        return Decision(dt=dt, side=side, stage="pending_approval",
                        reason="사람이 주문 티켓을 눌러야 나갑니다", basis=basis)

    return Decision(dt=dt, side=side, stage="ordered",
                    reason="한도 안이라 자동으로 주문을 냅니다", basis=basis)


def compare(
    live_trades: list[dict[str, Any]],
    backtest_trades: list[dict[str, Any]],
    *,
    live_return: float | None,
    backtest_return: float | None,
) -> DriftReport:
    """실전 체결과 같은 구간 백테스트 체결을 맞대어 괴리를 낸다.

    체결가가 다른 건(슬리피지)과 백테스트에는 있는데 실전에는 없는 건(미체결)을 센다.
    괴리가 0이 되지 않는다는 사실 자체가 이 보고서의 요점이라 숫자를 반올림해 감추지 않는다.
    """
    live_by_dt = {t["dt"]: t for t in live_trades}
    slipped = 0
    for bt in backtest_trades:
        live = live_by_dt.get(bt["dt"])
        if live is not None and live.get("price") != bt.get("price"):
            slipped += 1
    unfilled = sum(1 for bt in backtest_trades if bt["dt"] not in live_by_dt)

    drift = None
    if live_return is not None and backtest_return is not None:
        drift = live_return - backtest_return

    notes: list[str] = []
    if unfilled:
        notes.append(f"백테스트에는 있고 실전에는 없는 체결 {unfilled}건")
    if slipped:
        notes.append(f"체결가가 다른 건 {slipped}건 — 시가 슬리피지")
    if not backtest_trades:
        notes.append("같은 구간 백테스트 체결이 없어 비교할 수 없습니다")

    return DriftReport(
        live_return=live_return,
        backtest_return=backtest_return,
        drift=drift,
        filled_count=len(live_trades),
        slipped_count=slipped,
        unfilled_count=unfilled,
        notes=tuple(notes),
    )


def today_str(today: date | None = None) -> str:
    return (today or date.today()).strftime("%Y%m%d")


__all__ = [
    "CODE_BASIS",
    "MODE_LABELS",
    "Decision",
    "Deployment",
    "DriftReport",
    "Limits",
    "Mode",
    "Side",
    "Stage",
    "compare",
    "evaluate_latest",
    "is_expired",
    "today_str",
]
