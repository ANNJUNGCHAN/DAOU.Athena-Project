"""체결 코어(§6.4) 검증 — "죽지 않는다"가 아니라 "체결가·수수료·pnl·equity가 정확히
맞는가"를 본다. 골든 시나리오는 SMA(3)/SMA(5) 교차 1왕복(합성 봉 26개)을 수기 계산과
대조한다. 나머지는 §6.4 체결 규칙 5줄 각각을 독립된 최소 시나리오로 고정한다.
"""

from __future__ import annotations

import pandas as pd
import pytest

from athena_api.backtest import costs as costs_mod
from athena_api.backtest import indicators as ind
from athena_api.backtest.engine import DEFAULT_INITIAL_CASH, run_backtest
from athena_api.backtest.schema import CostsSpec, PositionSpec, RiskSpec, RiskToggle

# 결정층(leaf 9): 체결·비용 계산은 순수 함수다. LLM도 난수도 없다.
pytestmark = pytest.mark.deterministic

_NO_RISK = RiskSpec(
    stop_loss=RiskToggle(enabled=False, percent=0),
    take_profit=RiskToggle(enabled=False, percent=0),
    position=PositionSpec(sizing="all_in"),
)


def _bar_df(
    *,
    open_: list[float],
    high: list[float],
    low: list[float],
    close: list[float],
    volume: list[float],
) -> pd.DataFrame:
    idx = pd.date_range("2024-01-02", periods=len(close), freq="B")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


# ── 골든 시나리오: SMA 교차 1왕복 ───────────────────────────────────────────


@pytest.fixture
def golden_round_trip() -> tuple[pd.DataFrame, pd.DataFrame]:
    """26봉: 하락 8봉 → 상승 10봉(골든크로스 1회 유발) → 하락 8봉(데드크로스 1회 유발).
    SMA(3)/SMA(5) cross_above/cross_below는 각각 정확히 한 번만 True다(인덱스 10·20 —
    `ind.cross_above`/`cross_below`를 직접 돌려 확인한 값, 아래 개별 assert가 다시 고정한다).

    시가는 전일 종가의 1.01배로 둬 "다음 봉 시가"가 "이번 봉 종가"와 절대 같아지지 않게
    했다 — 이 간격이 없으면 같은-봉-종가 체결과 다음-봉-시가 체결을 값으로 구분할 수 없다.
    """
    close = []
    v = 100.0
    for _ in range(8):
        v -= 1.0
        close.append(v)
    for _ in range(10):
        v += 1.5
        close.append(v)
    for _ in range(8):
        v -= 2.0
        close.append(v)
    close = [round(c, 2) for c in close]
    n = len(close)
    open_ = [close[0]] + [round(close[i - 1] * 1.01, 2) for i in range(1, n)]
    high = [round(max(open_[i], close[i]) + 0.5, 2) for i in range(n)]
    low = [round(min(open_[i], close[i]) - 0.5, 2) for i in range(n)]
    volume = [1000] * n
    df = _bar_df(open_=open_, high=high, low=low, close=close, volume=volume)

    fast = ind.get("SMA").fn(df, period=3)
    slow = ind.get("SMA").fn(df, period=5)
    entry = ind.cross_above(fast, slow)
    exit_ = ind.cross_below(fast, slow)
    # 골든 시나리오 전제 — 교차가 정확히 한 번씩만 일어난다는 것부터 고정한다.
    assert [i for i, v in enumerate(entry) if v] == [10]
    assert [i for i, v in enumerate(exit_) if v] == [20]
    signals = pd.DataFrame({"entry": entry, "exit": exit_}, index=df.index)
    return df, signals


def test_golden_round_trip_fills_fees_pnl_and_equity(
    golden_round_trip: tuple[pd.DataFrame, pd.DataFrame],
) -> None:
    df, signals = golden_round_trip
    # 1% / 2% / 0.5% — 손계산이 쉬운 값.
    costs = CostsSpec(fee_bps=100.0, tax_bps=200.0, slippage_bps=50.0)
    result = run_backtest(df, signals, _NO_RISK, costs, initial_cash=1_000_000.0)

    assert len(result.trades) == 2
    buy, sell = result.trades

    # 진입: 신호는 bar10 종가로 확정, 체결은 bar11 시가(97.47)에서. 슬리피지(+0.5%)로 체결가 상승.
    assert buy.side == "buy"
    assert buy.reason == "signal"
    assert buy.dt == "2024-01-17"  # bar11
    assert buy.price == pytest.approx(97.95734999999999)
    assert buy.qty == pytest.approx(10107.44992490089)
    assert buy.fee == pytest.approx(9900.990099009901)
    assert buy.tax == 0.0  # 세금은 매도에만(§6.4)
    assert buy.pnl is None

    # 명시적 검증: 진입가는 "다음 봉 시가"이지 "신호가 뜬 봉(bar10)의 종가"가 아니다.
    assert buy.price != df["close"].iloc[10]
    assert buy.price != df["close"].iloc[11]  # bar11 자신의 종가와도 다르다(같은 봉 종가 체결 아님)

    # 청산: 신호는 bar20 종가로 확정, 체결은 bar21 시가(102.01)에서. 슬리피지(-0.5%)로 체결가 하락.
    assert sell.side == "sell"
    assert sell.reason == "signal"
    assert sell.dt == "2024-01-31"  # bar21
    assert sell.price == pytest.approx(101.49995)
    assert sell.qty == pytest.approx(buy.qty)
    assert sell.fee == pytest.approx(10259.056620049441)
    assert sell.tax == pytest.approx(20518.113240098883)
    assert sell.pnl == pytest.approx(-4871.507855204283)

    eq = result.equity
    assert eq[0].equity == pytest.approx(1_000_000.0)  # 진입 전 — 현금 그대로
    assert eq[10].equity == pytest.approx(1_000_000.0)  # 신호 확정일도 아직 체결 전
    assert eq[11].cash == pytest.approx(0.0, abs=1e-6)  # 전액 매수(all-in)
    assert eq[11].equity == pytest.approx(990530.0926402871)
    assert eq[11].drawdown == pytest.approx(-0.009469907359712874)
    assert eq[17].equity == pytest.approx(1081497.141964395)  # 보유 중 최고점
    assert eq[17].drawdown == pytest.approx(0.0)
    assert eq[20].equity == pytest.approx(1020852.4424149898)
    assert eq[21].cash == pytest.approx(995128.4921447957)  # 청산 후 — 포지션 없음
    assert eq[21].position_value == 0.0
    assert eq[21].equity == pytest.approx(995128.4921447957)
    assert eq[21].drawdown == pytest.approx(-0.0798602663551401)
    assert eq[25].equity == pytest.approx(eq[21].equity)  # 청산 이후로는 변동 없음


# ── 손절 우선(§6.4 규칙 3) ──────────────────────────────────────────────────


def test_stop_loss_wins_when_both_levels_touched_same_bar() -> None:
    """진입가 100, 손절 5%(=95)·익절 5%(=105) 모두 활성. 3번째 봉이 low=90(손절 통과)과
    high=110(익절 통과)을 동시에 찍는다 — 손절이 이겨야 한다(보수적 가정)."""
    df = _bar_df(
        open_=[99.0, 100.0, 100.0, 102.0],
        high=[100.0, 101.0, 110.0, 103.0],
        low=[98.0, 99.0, 90.0, 101.0],
        close=[99.5, 100.5, 101.0, 102.5],
        volume=[1000, 1000, 1000, 1000],
    )
    signals = pd.DataFrame(
        {"entry": [True, False, False, False], "exit": [False, False, False, False]}, index=df.index
    )
    risk = RiskSpec(
        stop_loss=RiskToggle(enabled=True, percent=5),
        take_profit=RiskToggle(enabled=True, percent=5),
        position=PositionSpec(sizing="all_in"),
    )
    result = run_backtest(df, signals, risk, None, initial_cash=1_000_000.0)

    assert len(result.trades) == 2
    buy, sell = result.trades
    assert buy.price == pytest.approx(100.0)  # bar1 시가, 비용 없음(costs=None)
    assert sell.reason == "stop_loss"
    assert sell.price == pytest.approx(95.0)  # 진입가(100)의 5% 손절 레벨
    assert sell.pnl == pytest.approx(-50000.0)  # qty(10000) * (95-100)


# ── 체결 불가 봉 이월(§6.4 규칙 4) ───────────────────────────────────────────


def test_limit_locked_bar_is_skipped_and_order_carries_to_next_bar() -> None:
    """상한가 봉(시가=고가=저가=종가)은 체결 불가 — 그 다음 정상 봉에서 체결돼야 한다."""
    df = _bar_df(
        open_=[99.0, 100.0, 102.0],
        high=[100.0, 100.0, 103.0],
        low=[98.0, 100.0, 101.0],
        close=[99.5, 100.0, 102.5],
        volume=[1000, 500, 1000],  # bar1: o=h=l=c=100(상한가 잠김), 거래량은 있어도 체결 불가
    )
    signals = pd.DataFrame(
        {"entry": [True, False, False], "exit": [False, False, False]}, index=df.index
    )
    result = run_backtest(df, signals, _NO_RISK, None, initial_cash=1_000_000.0)

    assert len(result.trades) == 1
    assert result.trades[0].dt == "2024-01-04"  # bar2, bar1이 아니다
    assert result.trades[0].price == pytest.approx(102.0)  # bar2 시가


def test_zero_volume_bar_is_skipped_and_order_carries_to_next_bar() -> None:
    """거래량 0 봉도 상한가 봉과 같은 이유로 체결 불가 — 다음 봉으로 이월."""
    df = _bar_df(
        open_=[99.0, 100.0, 102.0],
        high=[100.0, 101.0, 103.0],
        low=[98.0, 99.5, 101.0],
        close=[99.5, 100.5, 102.5],
        volume=[1000, 0, 1000],  # bar1: 봉 모양은 정상이지만 거래량 0
    )
    signals = pd.DataFrame(
        {"entry": [True, False, False], "exit": [False, False, False]}, index=df.index
    )
    result = run_backtest(df, signals, _NO_RISK, None, initial_cash=1_000_000.0)

    assert len(result.trades) == 1
    assert result.trades[0].dt == "2024-01-04"  # bar2
    assert result.trades[0].price == pytest.approx(102.0)


# ── 미청산 포지션 처리(§6.4 규칙 5) ──────────────────────────────────────────


def test_open_position_at_last_bar_is_not_force_liquidated() -> None:
    """청산 신호가 끝까지 안 뜨면 마지막 봉에서도 강제 청산하지 않는다 — 미실현으로 남는다."""
    df = _bar_df(
        open_=[99.0, 100.0, 103.0],
        high=[100.0, 101.0, 104.0],
        low=[98.0, 99.0, 102.0],
        close=[99.5, 100.5, 103.5],
        volume=[1000, 1000, 1000],
    )
    signals = pd.DataFrame(
        {"entry": [True, False, False], "exit": [False, False, False]}, index=df.index
    )
    result = run_backtest(df, signals, _NO_RISK, None, initial_cash=1_000_000.0)

    assert len(result.trades) == 1
    assert result.trades[0].side == "buy"
    last = result.equity[-1]
    assert last.position_value == pytest.approx(10_000.0 * 103.5)  # qty * 마지막 종가 — 미실현 평가
    assert last.cash == pytest.approx(0.0, abs=1e-6)


# ── 보유 상태 게이트(§6.4 규칙 5) ────────────────────────────────────────────


def test_holding_ignores_new_entry_and_flat_ignores_exit() -> None:
    """보유 중 추가 entry 신호, 무보유 중 exit 신호는 둘 다 무시돼야 한다 — 신호만 있고
    체결 대상 상태가 아니면 아무 일도 일어나지 않는다."""
    df = _bar_df(
        open_=[99.0, 100.0, 101.0, 103.0],
        high=[100.0, 101.0, 102.0, 104.0],
        low=[98.0, 99.0, 100.0, 102.0],
        close=[99.5, 100.5, 101.5, 103.5],
        volume=[1000, 1000, 1000, 1000],
    )
    # bar0: exit=True인데 아직 무보유 — 무시돼야 한다(대기 주문도 안 생긴다).
    # bar1: entry=True → bar2 시가에서 체결. bar2 자신도 entry=True인데, 그 시점엔 이미
    # 보유 중이라 무시돼야 한다(추가 매수 없음, all-in 단일 포지션).
    signals = pd.DataFrame(
        {"entry": [False, True, True, False], "exit": [True, False, False, False]}, index=df.index
    )
    result = run_backtest(df, signals, _NO_RISK, None, initial_cash=1_000_000.0)

    # bar1 신호의 체결 하나만 — bar0의 무보유 exit, bar2의 보유 중 entry 모두 무시됐다.
    assert len(result.trades) == 1
    assert result.trades[0].dt == "2024-01-04"  # bar2 시가에서 체결(bar1 신호 → bar2 체결)
    assert result.trades[0].price == pytest.approx(101.0)


# ── 비용 미설정(§10.3, costs.py) ─────────────────────────────────────────────


def test_costs_none_flags_unset_and_computes_zero() -> None:
    df = _bar_df(
        open_=[99.0, 100.0, 101.0],
        high=[100.0, 101.0, 102.0],
        low=[98.0, 99.0, 100.0],
        close=[99.5, 100.5, 101.5],
        volume=[1000, 1000, 1000],
    )
    signals = pd.DataFrame(
        {"entry": [True, False, False], "exit": [False, False, False]}, index=df.index
    )
    result = run_backtest(df, signals, _NO_RISK, None, initial_cash=DEFAULT_INITIAL_CASH)

    assert result.costs_flag == costs_mod.UNSET_COSTS_FLAG
    assert result.trades[0].fee == 0.0
    assert result.trades[0].tax == 0.0
    assert result.trades[0].price == pytest.approx(100.0)  # 슬리피지 없음 — 시가 그대로
