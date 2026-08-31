"""deploy.py — 전략 배포·실전 신호 (Paper 보드 07).

**이 파일이 지키는 규율.** 배포는 신호까지만 만든다. 한도를 넘거나 정지 조건에 걸리면
자동 집행이 아니라 승인 대기·차단으로 내려간다 — 사람이 정한 한도를 코드가 넘어서는
경로가 있으면 이 화면이 약속한 것이 거짓이 된다.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from athena_api.backtest import deploy
from athena_api.backtest.presets import preset_yaml
from athena_api.backtest.schema import from_kis_yaml

LIMITS = deploy.Limits(
    max_order_amount=2_000_000,
    max_orders_per_day=2,
    valid_from="20260101",
    valid_to="20261201",
    stop_on_drawdown_pct=15.0,
    stop_on_consecutive_losses=3,
)


def _spec():
    return from_kis_yaml(preset_yaml("sma_crossover"))


def _wave_df(n: int = 400) -> pd.DataFrame:
    idx = pd.date_range("2026-01-01", periods=n, freq="D")
    close = np.linspace(10_000, 16_000, n) + np.sin(np.arange(n) / 11.0) * 1_200
    return pd.DataFrame(
        {
            "open": close - 10, "high": close + 50, "low": close - 50,
            "close": close, "volume": np.full(n, 1_000),
        },
        index=idx,
    )


def _df_ending_with(kind: str) -> pd.DataFrame:
    """마지막 봉이 진입(또는 청산) 신호가 되도록 잘라낸 프레임.

    **왜 단조 상승으로는 안 되나.** `cross_above`는 *교차한 그 봉*에서만 참이다 —
    쭉 오르는 시세는 fast>slow가 계속 참일 뿐 교차는 한 번뿐이라 마지막 봉에는 신호가 없다.
    실제 교차가 일어난 봉을 찾아 거기서 자르는 것이 유일하게 정직한 픽스처다.
    """
    from athena_api.backtest.compile import compile_signals

    df = _wave_df()
    signals = compile_signals(_spec(), df)
    hits = np.flatnonzero(signals[kind].to_numpy())
    assert len(hits), f"{kind} 신호가 있는 봉을 만들지 못했다 — 픽스처를 고쳐야 한다"
    return df.iloc[: int(hits[-1]) + 1]


def _deployment(**over) -> deploy.Deployment:
    base = {
        "id": "d1", "strategy_version_id": "v1", "run_id": "r1",
        "stk_cd": "005930", "period": "day", "adjusted": True,
        "mode": "approve", "params": {}, "limits": LIMITS, "status": "active",
    }
    base.update(over)
    return deploy.Deployment(**base)


def _evaluate(dep, df=None, **kw):
    args = {
        "today": "20260601", "holding": False, "orders_today": 0, "order_amount": 100_000,
    }
    args.update(kw)
    frame = df if df is not None else _df_ending_with("entry")
    return deploy.evaluate_latest(_spec(), frame, dep, **args)


# ── 신호가 없을 때 ───────────────────────────────────────────────────────────


def test_no_bars_is_skipped_not_invented():
    empty = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    d = _evaluate(_deployment(), empty)
    assert d.stage == "skipped"
    assert d.side is None


def test_no_condition_match_is_skipped():
    flat = _wave_df()
    flat.loc[:, ["open", "high", "low", "close"]] = 10_000.0
    d = _evaluate(_deployment(), flat)
    assert d.stage == "skipped"


def test_exit_is_ignored_when_not_holding():
    """엔진의 "무보유 중 exit 무시"(§6.4 규칙 5)를 실전에서도 지킨다."""
    falling = _wave_df()
    falling.loc[:, "close"] = np.linspace(20_000, 10_000, len(falling))
    d = _evaluate(_deployment(), falling, holding=False)
    assert d.side != "sell"


# ── 모드별 단계 ─────────────────────────────────────────────────────────────


def test_observe_mode_never_reaches_order():
    d = _evaluate(_deployment(mode="observe"))
    assert d.stage == "signal"
    assert "기록만" in d.reason


def test_approve_mode_waits_for_a_person():
    d = _evaluate(_deployment(mode="approve"))
    assert d.stage == "pending_approval"
    assert "사람이" in d.reason


def test_auto_mode_orders_inside_limits():
    d = _evaluate(_deployment(mode="auto"), orders_today=0, order_amount=100_000)
    assert d.stage == "ordered"


# ── 한도 ────────────────────────────────────────────────────────────────────


def test_auto_mode_falls_back_to_approval_when_daily_count_is_spent():
    d = _evaluate(_deployment(mode="auto"), orders_today=2)
    assert d.stage == "pending_approval"
    assert d.blocked_reason == "limit"
    assert "하루 2건" in d.reason


def test_auto_mode_falls_back_to_approval_when_amount_is_over():
    d = _evaluate(_deployment(mode="auto"), order_amount=3_000_000)
    assert d.stage == "pending_approval"
    assert d.blocked_reason == "limit"


def test_approve_mode_is_unaffected_by_amount_limit():
    """승인 모드는 어차피 사람이 누른다 — 한도는 자동 집행을 막는 장치다."""
    d = _evaluate(_deployment(mode="approve"), order_amount=9_000_000)
    assert d.stage == "pending_approval"
    assert d.blocked_reason is None


# ── 자동 정지 ───────────────────────────────────────────────────────────────


def test_drawdown_stop_blocks_before_mode_is_consulted():
    d = _evaluate(_deployment(mode="auto"), drawdown_pct=-20.0)
    assert d.stage == "blocked"
    assert d.blocked_reason == "drawdown"


def test_consecutive_losses_stop_blocks():
    d = _evaluate(_deployment(mode="auto"), consecutive_losses=3)
    assert d.stage == "blocked"
    assert d.blocked_reason == "losses"


@pytest.mark.parametrize("today", ["20251231", "20261202"])
def test_outside_validity_window_blocks(today):
    d = _evaluate(_deployment(mode="auto"), today=today)
    assert d.stage == "blocked"
    assert d.blocked_reason == "expired"


def test_stopped_deployment_blocks():
    d = _evaluate(_deployment(mode="auto", status="stopped"))
    assert d.stage == "blocked"
    assert d.blocked_reason == "stopped"


# ── 근거 문구 ───────────────────────────────────────────────────────────────


def test_basis_quotes_the_actual_conditions():
    d = _evaluate(_deployment())
    assert "ma_fast" in d.basis
    assert "cross_above" in d.basis


# ── 괴리 보고 ───────────────────────────────────────────────────────────────


def test_drift_counts_slippage_and_unfilled():
    report = deploy.compare(
        live_trades=[{"dt": "2026-08-28", "price": 71_400}],
        backtest_trades=[
            {"dt": "2026-08-28", "price": 71_300},
            {"dt": "2026-08-21", "price": 76_800},
        ],
        live_return=0.062,
        backtest_return=0.069,
    )
    assert report.slipped_count == 1
    assert report.unfilled_count == 1
    assert report.drift == pytest.approx(-0.007)


def test_drift_is_none_when_a_side_is_missing_instead_of_zero():
    """비교할 수 없을 때 0을 돌려주면 "괴리 없음"으로 읽힌다 — 그건 거짓말이다."""
    report = deploy.compare([], [], live_return=None, backtest_return=0.1)
    assert report.drift is None
    assert any("비교할 수 없" in n for n in report.notes)
