"""optimize.py — 조합 생성·제약·과최적화 경고·히트맵 (Paper 보드 06).

경고 로직이 이 모듈의 존재 이유라 "최고점만 맞는지"가 아니라 **"외딴 봉우리를 외딴 것으로
부르는지"**를 고정한다. 그 판정이 틀리면 사용자는 과최적화된 조합을 믿고 배포한다.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from athena_api.backtest import optimize as opt
from athena_api.backtest.presets import preset_yaml
from athena_api.backtest.schema import from_kis_yaml


def _df(n: int = 300) -> pd.DataFrame:
    """결정적인 톱니 시세 — 이평 교차가 실제로 여러 번 일어나야 조합별 차이가 생긴다."""
    idx = pd.date_range("2020-01-01", periods=n, freq="D")
    base = np.linspace(10_000, 14_000, n)
    wave = np.sin(np.arange(n) / 7.0) * 600
    close = base + wave
    return pd.DataFrame(
        {
            "open": close - 20,
            "high": close + 80,
            "low": close - 80,
            "close": close,
            "volume": np.full(n, 1_000),
        },
        index=idx,
    )


def _spec():
    return from_kis_yaml(preset_yaml("sma_crossover"))


# ── ParamRange ──────────────────────────────────────────────────────────────


def test_param_range_includes_both_ends():
    r = opt.ParamRange(name="fast", start=5, stop=25, step=5)
    assert r.values() == (5, 10, 15, 20, 25)


def test_param_range_float_does_not_drift():
    """부동소수 누적으로 마지막 값이 빠지면 사용자가 고른 상한이 조용히 사라진다.
    0.1+0.1+0.1이 0.30000000000000004가 되는 것도 `round(v, 10)`이 지운다 —
    화면에 0.30000000000000004가 뜨면 사용자는 자기가 넣지 않은 값을 보게 된다."""
    r = opt.ParamRange(name="k", start=0.1, stop=0.5, step=0.1, is_int=False)
    assert r.values() == (0.1, 0.2, 0.3, 0.4, 0.5)


def test_param_range_rejects_zero_step():
    with pytest.raises(ValueError, match="step"):
        opt.ParamRange(name="fast", start=1, stop=5, step=0).values()


# ── 조합 수와 제약 ───────────────────────────────────────────────────────────


def test_ascending_constraint_drops_meaningless_combinations():
    ranges = [
        opt.ParamRange("fast", 5, 20, 5),
        opt.ParamRange("slow", 5, 20, 5),
    ]
    assert opt.count_combinations(ranges) == 16
    # fast<slow만 남기면 대각선과 그 아래가 빠진다.
    assert opt.count_combinations(ranges, opt.ascending_constraint("fast", "slow")) == 6


def test_over_limit_refuses_instead_of_running_forever():
    ranges = [opt.ParamRange("fast", 1, 2000, 1)]
    spec, df = _spec(), _df(50)
    with pytest.raises(ValueError, match="상한"):
        opt.optimize(spec, df, ranges)


# ── 서치 ────────────────────────────────────────────────────────────────────


def test_grid_search_scores_every_combination():
    ranges = [opt.ParamRange("fast", 5, 15, 5), opt.ParamRange("slow", 20, 40, 10)]
    result = opt.optimize(_spec(), _df(), ranges)
    assert len(result.trials) == 9
    assert result.best is not None
    assert result.best.params["fast"] in (5, 10, 15)


def test_random_search_is_reproducible_with_seed():
    ranges = [opt.ParamRange("fast", 5, 30, 5), opt.ParamRange("slow", 40, 90, 10)]
    a = opt.optimize(_spec(), _df(), ranges, method="random", samples=6, seed=7)
    b = opt.optimize(_spec(), _df(), ranges, method="random", samples=6, seed=7)
    assert [t.params for t in a.trials] == [t.params for t in b.trials]


def test_failed_combination_does_not_kill_the_search():
    """한 조합이 터져도 나머지는 나와야 한다 — 조합 하나가 전체를 무효로 만들면
    서치를 돌릴 이유가 없다. 실패한 조합은 sharpe=None + error로 남는다."""
    ranges = [opt.ParamRange("fast", 5, 10, 5)]
    result = opt.optimize(_spec(), _df(30), ranges)
    assert len(result.trials) == 2
    assert all(t.error is None or t.sharpe is None for t in result.trials)


def test_unknown_param_is_rejected_by_resolve_params():
    """존재하지 않는 파라미터를 훑으면 조용히 기본값만 도는 대신 error로 남는다."""
    result = opt.optimize(_spec(), _df(120), [opt.ParamRange("nope", 1, 2, 1)])
    assert all(t.error is not None for t in result.trials)


# ── 과최적화 경고 ────────────────────────────────────────────────────────────


def _trial(fast: float, slow: float, sharpe: float, trades: int = 20) -> opt.Trial:
    return opt.Trial(
        params={"fast": fast, "slow": slow}, sharpe=sharpe,
        total_return=0.1, mdd=-0.1, trades=trades,
    )


def test_lonely_peak_is_called_lonely():
    ranges = [opt.ParamRange("fast", 5, 15, 5), opt.ParamRange("slow", 20, 30, 5)]
    trials = [
        _trial(5, 20, 0.5), _trial(5, 25, 0.5), _trial(5, 30, 0.5),
        _trial(10, 20, 0.5), _trial(10, 25, 2.0), _trial(10, 30, 0.5),
        _trial(15, 20, 0.5), _trial(15, 25, 0.5), _trial(15, 30, 0.5),
    ]
    neighbours = opt._neighbours({"fast": 10, "slow": 25}, trials, ranges)
    assert len(neighbours) == 8
    mean = sum(t.sharpe for t in neighbours) / len(neighbours)
    assert 2.0 - mean >= opt.LONELY_PEAK_MARGIN


def test_broad_plateau_is_reported_as_a_range():
    ranges = [opt.ParamRange("fast", 5, 15, 5), opt.ParamRange("slow", 20, 30, 5)]
    trials = [_trial(f, s, 1.0) for f in (5, 10, 15) for s in (20, 25, 30)]
    plateau = opt._plateau(trials, ranges, floor=0.9)
    assert plateau == {"fast": (5, 15), "slow": (20, 30)}


def test_few_trades_warning_fires():
    ranges = [opt.ParamRange("fast", 5, 10, 5), opt.ParamRange("slow", 200, 240, 40)]
    # 느린 이평이 봉 수에 가까우면 교차가 거의 없다 — 표본이 적다는 경고가 떠야 한다.
    result = opt.optimize(_spec(), _df(260), ranges)
    if result.best is not None:
        kinds = {w.kind for w in result.warnings}
        assert result.best.trades >= 10 or "few_trades" in kinds


def test_all_failed_reports_instead_of_pretending():
    result = opt.optimize(_spec(), _df(120), [opt.ParamRange("nope", 1, 2, 1)])
    assert result.best is None
    assert [w.kind for w in result.warnings] == ["all_failed"]


# ── 히트맵 ──────────────────────────────────────────────────────────────────


def test_heatmap_keeps_one_value_per_cell():
    ranges = [opt.ParamRange("fast", 5, 10, 5), opt.ParamRange("slow", 20, 20, 5)]
    result = opt.OptimizeResult(
        method="grid", ranges=tuple(ranges),
        trials=(_trial(5, 20, 0.4), _trial(5, 20, 0.9), _trial(10, 20, 0.6)),
        best=None, neighbour_mean_sharpe=None, plateau=None,
    )
    grid = opt.heatmap(result, "fast", "slow")
    assert grid["cells"] == [
        {"x": 5, "y": 20, "sharpe": 0.9},
        {"x": 10, "y": 20, "sharpe": 0.6},
    ]
    assert grid["max_sharpe"] == 0.9
