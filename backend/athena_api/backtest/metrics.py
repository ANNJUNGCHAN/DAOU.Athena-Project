"""성과지표 — 원본(KIS)이 README에서 자백한 계산 결함 3건을 고친다(§6.5).

| 지표 | 원본 결함 | 우리 |
|---|---|---|
| Sharpe | 워밍업 구간 0수익일이 표준편차를 낮춘다 | `warmup_bars`만큼 건너뛰고 계산 |
| CAGR | 달력일 전체로 나눈다 | 실거래일 수 / 연 거래일(252) 기준 |
| 승률 | 미청산 포지션을 그냥 제외 | 동일하되 미청산 건수를 `open_positions`로 별도 표기 |

추가로 MDD·Profit Factor·총수익률·Buy&Hold 벤치마크를 낸다.

**"첫 신호 가능일"을 이 모듈이 스스로 추정하지 않는 이유.** 지표 워밍업 길이는 전략마다
다르다(파라미터가 다르면 SMA(20)과 SMA(240)의 워밍업 길이도 다르다) — 그 계산은 이미
`compile.py`/지표 레지스트리의 책임이다. 여기서 다시 추정하면 두 계산이 갈라질 위험만
생긴다. 그래서 호출자가 `warmup_bars`를 명시적으로 건네준다.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

import pandas as pd

from athena_api.backtest.engine import EquityPoint, Trade

TRADING_DAYS_PER_YEAR: int = 252


@dataclass(frozen=True, slots=True)
class Metrics:
    total_return: float
    cagr: float
    sharpe: float
    mdd: float
    win_rate: float
    open_positions: int
    profit_factor: float
    buy_hold_return: float


def _equity_values(equity: Sequence[EquityPoint]) -> pd.Series:
    return pd.Series([p.equity for p in equity], dtype=float)


def total_return(equity: Sequence[EquityPoint], initial_cash: float) -> float:
    """(최종 자산 / 초기 자산) - 1. 봉이 하나도 없으면 판단할 근거가 없어 0."""
    if not equity or initial_cash <= 0:
        return 0.0
    return equity[-1].equity / initial_cash - 1


def cagr(
    equity: Sequence[EquityPoint],
    initial_cash: float,
    trading_days_per_year: int = TRADING_DAYS_PER_YEAR,
) -> float:
    """연 복리 수익률 — 달력일이 아니라 **실거래일 수 / 연 거래일(252)**로 연환산한다(§6.5)."""
    n = len(equity)
    if n == 0 or initial_cash <= 0:
        return 0.0
    years = n / trading_days_per_year
    final = equity[-1].equity
    if final <= 0:
        return -1.0
    return (final / initial_cash) ** (1 / years) - 1


def sharpe_ratio(
    equity: Sequence[EquityPoint],
    *,
    warmup_bars: int = 0,
    trading_days_per_year: int = TRADING_DAYS_PER_YEAR,
) -> float:
    """§6.5 결함 수정 — `warmup_bars`(전략이 아직 신호를 낼 수 없던 구간)를 건너뛴 뒤부터
    일간 수익률을 구해 연환산 Sharpe를 낸다. 표본이 2개 미만이거나 표준편차가 0이면
    (변동이 아예 없어 비율 자체가 정의되지 않는다) 0을 돌려준다 — 지어낸 값을 주지 않는다."""
    values = _equity_values(equity)
    if warmup_bars > 0:
        values = values.iloc[warmup_bars:]
    returns = values.pct_change().dropna()
    std = returns.std(ddof=1) if len(returns) >= 2 else 0.0
    if len(returns) < 2 or std == 0:
        return 0.0
    return float(returns.mean() / std * math.sqrt(trading_days_per_year))


def max_drawdown(equity: Sequence[EquityPoint]) -> float:
    """자산곡선이 이미 시점마다 들고 있는 `drawdown`(그 시점까지의 최고 자산 대비 낙폭,
    engine.py) 중 최솟값 — 낙폭을 다시 계산하지 않고 엔진이 낸 값을 그대로 집계한다."""
    if not equity:
        return 0.0
    return min(p.drawdown for p in equity)


def win_rate(trades: Sequence[Trade]) -> tuple[float, int]:
    """청산(매도) 거래 중 pnl>0 비율과 미청산 건수. §6.5: 미청산은 승률 계산에서 빼되
    숫자를 숨기지 않고 둘째 원소로 별도 표기한다."""
    closes = [t for t in trades if t.side == "sell" and t.pnl is not None]
    opens = sum(1 for t in trades if t.side == "buy")
    open_positions = max(opens - len(closes), 0)
    if not closes:
        return 0.0, open_positions
    wins = sum(1 for t in closes if t.pnl > 0)
    return wins / len(closes), open_positions


def profit_factor(trades: Sequence[Trade]) -> float:
    """총이익/총손실(절댓값). 손실이 0이면 이익이 있는 한 무한대 — 손실 없는 전략을
    임의의 유한값으로 낮잡아 왜곡하지 않는다."""
    closes = [t for t in trades if t.side == "sell" and t.pnl is not None]
    gains = sum(t.pnl for t in closes if t.pnl > 0)
    losses = sum(-t.pnl for t in closes if t.pnl < 0)
    if losses == 0:
        return float("inf") if gains > 0 else 0.0
    return gains / losses


def buy_and_hold_return(df: pd.DataFrame) -> float:
    """벤치마크 — 첫 봉 시작 시점에 사서 마지막 봉까지 들고 있었다면의 수익률(비용 미반영)."""
    if len(df) == 0:
        return 0.0
    return float(df["close"].iloc[-1] / df["close"].iloc[0] - 1)


def compute_metrics(
    equity: Sequence[EquityPoint],
    trades: Sequence[Trade],
    df: pd.DataFrame,
    *,
    initial_cash: float,
    warmup_bars: int = 0,
    trading_days_per_year: int = TRADING_DAYS_PER_YEAR,
) -> Metrics:
    """개별 지표 함수를 한 번씩 불러 묶는다 — 계산 자체는 각 함수가 갖고, 여기는 조립만 한다."""
    win, open_positions = win_rate(trades)
    return Metrics(
        total_return=total_return(equity, initial_cash),
        cagr=cagr(equity, initial_cash, trading_days_per_year),
        sharpe=sharpe_ratio(
            equity, warmup_bars=warmup_bars, trading_days_per_year=trading_days_per_year
        ),
        mdd=max_drawdown(equity),
        win_rate=win,
        open_positions=open_positions,
        profit_factor=profit_factor(trades),
        buy_hold_return=buy_and_hold_return(df),
    )


__all__ = [
    "TRADING_DAYS_PER_YEAR",
    "Metrics",
    "buy_and_hold_return",
    "cagr",
    "compute_metrics",
    "max_drawdown",
    "profit_factor",
    "sharpe_ratio",
    "total_return",
    "win_rate",
]
