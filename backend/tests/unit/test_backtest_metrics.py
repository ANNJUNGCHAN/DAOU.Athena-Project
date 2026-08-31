"""성과지표(§6.5) 검증 — 원본이 자백한 결함 3건(Sharpe 워밍업·CAGR 거래일 기준·승률
미청산 표기)이 실제로 고쳐졌는가를 값으로 대조한다.
"""

from __future__ import annotations

import math

import pandas as pd
import pytest

from athena_api.backtest import metrics
from athena_api.backtest.engine import EquityPoint, Trade

# 결정층(leaf 9): 순수 산술이다. LLM도 난수도 없다.
pytestmark = pytest.mark.deterministic


def _equity(values: list[float]) -> list[EquityPoint]:
    return [
        EquityPoint(dt=str(i), equity=v, cash=v, position_value=0.0, drawdown=0.0)
        for i, v in enumerate(values)
    ]


# ── 총수익률 / CAGR ─────────────────────────────────────────────────────────


def test_total_return_is_final_over_initial_minus_one() -> None:
    eq = _equity([100.0, 110.0, 121.0])
    assert metrics.total_return(eq, 100.0) == pytest.approx(0.21)


def test_cagr_uses_trading_days_not_calendar_days() -> None:
    """§6.5: 달력일이 아니라 실거래일 수/252로 연환산한다 — 정확히 252봉이면 총수익률과
    같아야 한다(1년 = 252거래일이라는 정의를 그대로 쓴 값이므로)."""
    eq = _equity([100.0] * 251 + [121.0])
    assert len(eq) == 252
    assert metrics.cagr(eq, 100.0) == pytest.approx(0.21)


def test_cagr_over_two_years_of_trading_days_annualizes_down() -> None:
    """504거래일(2년)에 걸쳐 21% 오르면 연 복리는 21%보다 작아야 한다."""
    eq = _equity([100.0] * 503 + [121.0])
    result = metrics.cagr(eq, 100.0)
    assert result < 0.21
    assert result == pytest.approx((1.21) ** (1 / 2) - 1)


# ── Sharpe: 워밍업 제외 효과 ─────────────────────────────────────────────────


def test_sharpe_excludes_warmup_and_changes_the_result() -> None:
    """§6.5: 워밍업 구간(전략이 아직 거래할 수 없어 자산이 그대로 평평한 구간)의 0수익일이
    수익률 계열에 섞이면 표준편차가 달라져 Sharpe가 왜곡된다. `warmup_bars`로 그 구간을
    건너뛴 계산과 포함한 계산의 값이 달라진다는 것을 보여준다(방향이 아니라 "달라진다"가
    이 테스트의 단언 대상이다 — 계획서도 결함의 존재만 지적할 뿐 부풀림 방향을 모든
    시나리오에 대해 증명하지 않는다)."""
    warmup = [1_000_000.0] * 11  # 10개의 0수익일(첫 값은 기준점이라 수익률에 안 잡힌다)
    active = [1_000_000.0]
    v = active[0]
    for r in [0.02, -0.01, 0.015, -0.005, 0.01, -0.02, 0.03, -0.01, 0.005, 0.01]:
        v *= 1 + r
        active.append(v)
    equity = _equity(warmup + active[1:])
    assert len(equity) == 21

    with_warmup = metrics.sharpe_ratio(equity, warmup_bars=0)
    without_warmup = metrics.sharpe_ratio(equity, warmup_bars=10)

    assert with_warmup != pytest.approx(without_warmup)
    assert with_warmup == pytest.approx(3.265037945758923)
    assert without_warmup == pytest.approx(4.597843092659631)


def test_sharpe_returns_zero_when_no_variance() -> None:
    """수익률이 전혀 안 갈리면(표준편차 0) 비율 자체가 정의되지 않는다 — 지어낸 값을
    주지 않고 0을 돌려준다."""
    eq = _equity([1_000_000.0] * 10)
    assert metrics.sharpe_ratio(eq) == 0.0


# ── MDD ─────────────────────────────────────────────────────────────────────


def test_max_drawdown_is_the_minimum_of_engine_drawdown_points() -> None:
    points = [
        EquityPoint(dt=str(i), equity=0, cash=0, position_value=0, drawdown=d)
        for i, d in enumerate([0.0, -0.05, -0.02, -0.1, 0.0])
    ]
    assert metrics.max_drawdown(points) == pytest.approx(-0.1)


# ── 승률 + 미청산 별도 표기 ───────────────────────────────────────────────────


def test_win_rate_excludes_open_position_and_reports_it_separately() -> None:
    """§6.5: 미청산 포지션은 승률 계산에서 빼되 숫자를 숨기지 않는다."""
    trades = [
        Trade(side="buy", dt="1", price=100, qty=10, fee=0, tax=0, pnl=None, reason="signal"),
        Trade(side="sell", dt="2", price=110, qty=10, fee=0, tax=0, pnl=100.0, reason="signal"),
        Trade(side="buy", dt="3", price=100, qty=10, fee=0, tax=0, pnl=None, reason="signal"),
        Trade(side="sell", dt="4", price=90, qty=10, fee=0, tax=0, pnl=-100.0, reason="stop_loss"),
        # 미청산
        Trade(side="buy", dt="5", price=100, qty=10, fee=0, tax=0, pnl=None, reason="signal"),
    ]
    win, open_positions = metrics.win_rate(trades)
    assert win == pytest.approx(0.5)  # 청산된 2건 중 1승 1패
    assert open_positions == 1


def test_win_rate_with_no_closed_trades_is_zero_not_undefined() -> None:
    trades = [Trade(side="buy", dt="1", price=100, qty=10, fee=0, tax=0, pnl=None, reason="signal")]
    win, open_positions = metrics.win_rate(trades)
    assert win == 0.0
    assert open_positions == 1


# ── Profit Factor ────────────────────────────────────────────────────────────


def test_profit_factor_is_gains_over_absolute_losses() -> None:
    trades = [
        Trade(side="sell", dt="1", price=0, qty=0, fee=0, tax=0, pnl=100.0, reason="signal"),
        Trade(side="sell", dt="2", price=0, qty=0, fee=0, tax=0, pnl=-50.0, reason="signal"),
        Trade(side="sell", dt="3", price=0, qty=0, fee=0, tax=0, pnl=50.0, reason="signal"),
    ]
    assert metrics.profit_factor(trades) == pytest.approx(3.0)  # (100+50)/50


def test_profit_factor_is_infinite_when_no_losses() -> None:
    trades = [Trade(side="sell", dt="1", price=0, qty=0, fee=0, tax=0, pnl=100.0, reason="signal")]
    assert metrics.profit_factor(trades) == math.inf


# ── Buy&Hold 벤치마크 ─────────────────────────────────────────────────────────


def test_buy_and_hold_return_is_last_close_over_first_close() -> None:
    df = pd.DataFrame({"close": [100.0, 105.0, 90.0, 120.0]})
    assert metrics.buy_and_hold_return(df) == pytest.approx(0.2)


# ── 통합 ─────────────────────────────────────────────────────────────────────


def test_compute_metrics_assembles_all_fields() -> None:
    eq = _equity([100.0] * 11 + [105.0, 110.0, 108.0])
    trades = [
        Trade(side="buy", dt="11", price=100, qty=1, fee=0, tax=0, pnl=None, reason="signal"),
        Trade(side="sell", dt="13", price=108, qty=1, fee=0, tax=0, pnl=8.0, reason="signal"),
    ]
    df = pd.DataFrame({"close": [100.0] * 11 + [105.0, 110.0, 108.0]})
    result = metrics.compute_metrics(eq, trades, df, initial_cash=100.0, warmup_bars=11)
    assert result.total_return == pytest.approx(0.08)
    assert result.win_rate == pytest.approx(1.0)
    assert result.open_positions == 0
    assert result.buy_hold_return == pytest.approx(0.08)
    assert result.profit_factor == math.inf
