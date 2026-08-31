"""프리셋 10종(§6.3, D2) — 전부 로드→compile→engine이 예외 없이 도는지 확인한다.

KIS 파리티 표(§2)의 10개 이름 그대로다. 프리셋의 트레이딩 성과가 좋은지는 이 테스트의
관심사가 아니다 — 각 프리셋이 유효한 `.athena.yaml`이고, 그 위에서 두 경로가 만나는
signals 계약(§6.2)이 끝까지 깨지지 않는지만 본다.
"""

from __future__ import annotations

import math

import pandas as pd
import pytest

from athena_api.backtest.compile import compile_signals
from athena_api.backtest.engine import run_backtest
from athena_api.backtest.presets import PRESETS, list_presets, preset_yaml
from athena_api.backtest.schema import from_kis_yaml

# 결정층(leaf 9): 프리셋 로드·컴파일·체결 모두 순수 계산이다. LLM도 난수도 없다.
pytestmark = pytest.mark.deterministic

_PRESET_IDS = (
    "sma_crossover",
    "momentum",
    "week52_high",
    "consecutive_moves",
    "ma_divergence",
    "false_breakout",
    "strong_close",
    "volatility_breakout",
    "short_term_reversal",
    "trend_filter_signal",
)


@pytest.fixture(scope="module")
def synthetic_df() -> pd.DataFrame:
    """300봉 — week52_high(기본 period=240)까지 워밍업을 다 태우고도 봉이 남도록 넉넉히 잡았다."""
    n = 300
    close = [100 + i * 0.05 + 5 * math.sin(i / 7.0) + 3 * math.sin(i / 23.0) for i in range(n)]
    high = [c + abs(math.sin(i / 3.0)) * 1.5 + 0.3 for i, c in enumerate(close)]
    low = [c - abs(math.cos(i / 5.0)) * 1.5 - 0.3 for i, c in enumerate(close)]
    open_ = [close[i - 1] if i > 0 else close[0] for i in range(n)]
    volume = [1000 + 50 * (i % 13) for i in range(n)]
    idx = pd.date_range("2023-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


def test_exactly_10_presets_registered() -> None:
    assert set(list_presets()) == set(_PRESET_IDS)
    assert len(list_presets()) == 10
    assert set(PRESETS) == set(_PRESET_IDS)


def test_unknown_preset_id_raises_key_error() -> None:
    with pytest.raises(KeyError):
        preset_yaml("not_a_real_preset")


@pytest.mark.parametrize("preset_id", _PRESET_IDS)
def test_preset_loads_compiles_and_runs_without_error(
    preset_id: str, synthetic_df: pd.DataFrame
) -> None:
    spec = from_kis_yaml(preset_yaml(preset_id))
    assert spec.strategy.id == preset_id

    signals = compile_signals(spec, synthetic_df)
    assert list(signals.columns) == ["entry", "exit"]
    assert signals["entry"].dtype == bool
    assert signals["exit"].dtype == bool

    result = run_backtest(synthetic_df, signals, spec.risk, spec.costs)
    assert len(result.equity) == len(synthetic_df)
