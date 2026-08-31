"""체결 코어 — signals → 체결·포지션 → trades/equity(§6.4). 발명하지 않고 계획서를 그대로 옮긴다.

체결 규칙 5줄(§6.4, 결과 화면 "가정" 섹션이 그대로 노출한다 — 여기서 숨기지 않는다):

1. 신호 판정은 종가 확정 후 — 미래 정보 없음.
2. 체결은 다음 봉 시가 — 같은 봉 종가 체결은 look-ahead다.
3. 손절/익절은 봉 내부 low/high 터치 시 그 가격 체결. 같은 봉에서 둘 다 닿으면 손절 우선(보수적).
4. 상·하한가 봉(시가=고가=저가=종가)·거래량 0 봉은 체결 불가 — 다음 봉으로 이월.
5. 전액 단일 포지션(all-in). 보유 중 entry 무시, 무보유 중 exit 무시. 마지막 봉 미청산
   포지션은 청산하지 않는다 — equity의 `position_value`가 미실현 손익을 그대로 보여준다.

**왜 신호를 "대기 주문" 상태로 들고 있나.** 4번 규칙(이월)은 "체결 불가한 봉에서는 신호가
사라지지 않고 다음 기회까지 남는다"는 뜻이다. 매 봉마다 `signals`를 다시 들여다보는 방식으로는
표현할 수 없다 — 신호가 뜬 그날 이후 봉이 계속 체결 불가라면 그 봉들에서는 애초에 그날의
신호가 다시 보이지 않기 때문이다. 그래서 `pending_entry`/`pending_exit` 불리언 상태로 주문을
명시적으로 들고 있다가 체결 가능한 첫 봉에서 소진한다.

**수량은 소수를 허용한다.** 정수 로트 단위는 계획서 어디에도 명시되지 않았다 — 근거 없는
세부 규칙을 새로 지어내지 않는다(§10.3과 같은 원칙).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import pandas as pd

from athena_api.backtest import costs as costs_mod
from athena_api.backtest.schema import CostsSpec, RiskSpec

Side = Literal["buy", "sell"]
Reason = Literal["signal", "stop_loss", "take_profit"]

DEFAULT_INITIAL_CASH: float = 10_000_000.0


@dataclass(frozen=True, slots=True)
class Trade:
    side: Side
    dt: str
    price: float
    qty: float
    fee: float
    tax: float
    pnl: float | None  # 매수 체결은 아직 손익이 확정되지 않아 None. 매도 체결만 값을 갖는다.
    reason: Reason


@dataclass(frozen=True, slots=True)
class EquityPoint:
    dt: str
    equity: float
    cash: float
    position_value: float
    drawdown: float  # 그 시점까지의 최고 자산 대비 낙폭. 0 이하 값(무손실=0).


@dataclass(frozen=True, slots=True)
class BacktestResult:
    trades: tuple[Trade, ...]
    equity: tuple[EquityPoint, ...]
    costs_flag: str | None  # `costs=None`이었으면 costs.UNSET_COSTS_FLAG, 아니면 None.


def _format_dt(value: object) -> str:
    strftime = getattr(value, "strftime", None)
    return strftime("%Y-%m-%d") if strftime is not None else str(value)


def _is_fillable(bar: pd.Series) -> bool:
    """상·하한가 봉(o==h==l==c)·거래량 0 봉은 체결 불가(§6.4 규칙 4)."""
    locked = bar["open"] == bar["high"] == bar["low"] == bar["close"]
    return not locked and bar["volume"] > 0


def _check_risk(bar: pd.Series, entry_price: float, risk: RiskSpec) -> tuple[Reason, float] | None:
    """봉 내부 low/high가 손절·익절 레벨에 닿았는지 본다. 손절을 먼저 검사해 같은 봉에서
    둘 다 닿으면 손절이 이긴다(§6.4 규칙 3, 보수적 가정)."""
    if risk.stop_loss.enabled:
        stop_price = entry_price * (1 - risk.stop_loss.percent / 100)
        if bar["low"] <= stop_price:
            return "stop_loss", stop_price
    if risk.take_profit.enabled:
        take_price = entry_price * (1 + risk.take_profit.percent / 100)
        if bar["high"] >= take_price:
            return "take_profit", take_price
    return None


def _sell(
    *,
    raw_price: float,
    qty: float,
    entry_exec_price: float,
    entry_fee: float,
    dt: str,
    reason: Reason,
    cash: float,
    costs: CostsSpec,
) -> tuple[Trade, float]:
    """매도 체결 하나의 손익·비용 계산. 손절/익절/시그널 청산 3곳이 같은 산식을 쓴다 —
    셋 중 하나만 고치고 나머지를 잊는 사고를 막는 것이 이 함수의 유일한 이유다."""
    exec_price = costs_mod.slipped_price(raw_price, "sell", costs)
    proceeds = qty * exec_price
    fee = costs_mod.fee_amount(proceeds, costs)
    tax = costs_mod.tax_amount(proceeds, costs)
    pnl = (proceeds - fee - tax) - (qty * entry_exec_price + entry_fee)
    trade = Trade(
        side="sell", dt=dt, price=exec_price, qty=qty, fee=fee, tax=tax, pnl=pnl, reason=reason
    )
    return trade, cash + proceeds - fee - tax


def run_backtest(
    df: pd.DataFrame,
    signals: pd.DataFrame,
    risk: RiskSpec,
    costs: CostsSpec | None,
    *,
    initial_cash: float = DEFAULT_INITIAL_CASH,
) -> BacktestResult:
    """signals(§6.2 계약) + 캔들 df → 체결·포지션·자산곡선.

    `df`와 `signals`는 같은 오름차순 DatetimeIndex를 공유해야 한다. 인덱스 0번 봉은
    체결 대상이 될 수 없다 — 그 이전 봉(신호의 출처)이 없기 때문이다.
    """
    resolved_costs, costs_flag = costs_mod.resolve_costs(costs)

    cash = initial_cash
    qty = 0.0
    entry_exec_price = 0.0
    entry_fee = 0.0
    holding = False
    pending_entry = False
    pending_exit = False

    trades: list[Trade] = []
    equity_points: list[EquityPoint] = []
    peak_equity = initial_cash

    for i in range(len(df)):
        bar = df.iloc[i]
        dt = _format_dt(df.index[i])
        fillable = _is_fillable(bar)

        if fillable:
            if holding:
                triggered = _check_risk(bar, entry_exec_price, risk)
                if triggered is not None:
                    reason, raw_price = triggered
                    trade, cash = _sell(
                        raw_price=raw_price, qty=qty, entry_exec_price=entry_exec_price,
                        entry_fee=entry_fee, dt=dt, reason=reason, cash=cash, costs=resolved_costs,
                    )
                    trades.append(trade)
                    holding, qty, pending_exit = False, 0.0, False
                elif pending_exit:
                    trade, cash = _sell(
                        raw_price=bar["open"], qty=qty, entry_exec_price=entry_exec_price,
                        entry_fee=entry_fee, dt=dt, reason="signal", cash=cash,
                        costs=resolved_costs,
                    )
                    trades.append(trade)
                    holding, qty, pending_exit = False, 0.0, False
            elif pending_entry:
                exec_price = costs_mod.slipped_price(bar["open"], "buy", resolved_costs)
                qty = cash / (exec_price * (1 + resolved_costs.fee_bps / 10_000))
                fee = costs_mod.fee_amount(qty * exec_price, resolved_costs)
                cash -= qty * exec_price + fee
                trades.append(
                    Trade(
                        side="buy", dt=dt, price=exec_price, qty=qty, fee=fee, tax=0.0, pnl=None,
                        reason="signal",
                    )
                )
                holding, entry_exec_price, entry_fee, pending_entry = True, exec_price, fee, False

                # 진입 직후 같은 봉 안에서도 리스크 레벨에 닿을 수 있다 — 이번 봉 low/high로 재확인.
                triggered = _check_risk(bar, entry_exec_price, risk)
                if triggered is not None:
                    reason, raw_price = triggered
                    trade, cash = _sell(
                        raw_price=raw_price, qty=qty, entry_exec_price=entry_exec_price,
                        entry_fee=entry_fee, dt=dt, reason=reason, cash=cash, costs=resolved_costs,
                    )
                    trades.append(trade)
                    holding, qty, pending_exit = False, 0.0, False

        # 오늘 종가로 확정된 신호를 다음 체결 대기열에 올린다(§6.4 규칙 1·2). 보유 중이면
        # entry를, 무보유면 exit를 무시하는 것은 아래 게이트(`not holding`/`holding`)가 그대로 한다.
        if bool(signals["entry"].iloc[i]) and not holding and not pending_entry:
            pending_entry = True
        if bool(signals["exit"].iloc[i]) and holding and not pending_exit:
            pending_exit = True

        position_value = qty * bar["close"] if holding else 0.0
        equity = cash + position_value
        peak_equity = max(peak_equity, equity)
        drawdown = (equity - peak_equity) / peak_equity if peak_equity > 0 else 0.0
        equity_points.append(
            EquityPoint(
                dt=dt, equity=equity, cash=cash, position_value=position_value, drawdown=drawdown
            )
        )

    return BacktestResult(trades=tuple(trades), equity=tuple(equity_points), costs_flag=costs_flag)


__all__ = ["BacktestResult", "EquityPoint", "Trade", "run_backtest"]
