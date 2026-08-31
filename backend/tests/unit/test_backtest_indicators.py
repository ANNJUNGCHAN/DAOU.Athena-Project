"""지표 레지스트리(§6.3) 검증 — "죽지 않는다"가 아니라 "값이 맞는가"를 본다.

SMA·EMA·RSI·MACD·ATR·Bollinger·Stochastic은 손계산(또는 손계산과 동등한 독립 참조식)으로
고정한 골든 값과 대조한다. 나머지 18종은 워밍업 NaN 개수를 지표별 정의식으로 미리 유도해
정확히 대조한다 — "NaN이 좀 있다"가 아니라 "정확히 몇 개인지"를 확인한다.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from athena_api.backtest import indicators as ind

# ── 픽스처 ────────────────────────────────────────────────────────────────


@pytest.fixture
def small_ohlcv() -> pd.DataFrame:
    """15봉 합성 캔들 — 골든 픽스처용. close는 손으로 대조하기 쉽도록
    +1,+1,-1,+2 패턴을 반복하고, high=close+1/low=close-1로 단순화했다."""
    close = [10, 11, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 17, 19, 20]
    high = [c + 1 for c in close]
    low = [c - 1 for c in close]
    n = len(close)
    idx = pd.date_range("2024-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {
            "open": close,
            "high": high,
            "low": low,
            "close": close,
            "volume": [100 + 10 * i for i in range(n)],
        },
        index=idx,
    )


@pytest.fixture
def long_ohlcv() -> pd.DataFrame:
    """60봉 결정적 합성 캔들 — 기본 파라미터(period 14~26)를 다 태울 만큼 길다.
    난수 대신 사인파+추세로 만들어 numpy 난수 알고리즘 버전에 기대지 않는다."""
    n = 60
    close = [100 + i * 0.4 + 3 * math.sin(i / 4.0) for i in range(n)]
    high = [c + 1.0 for c in close]
    low = [c - 1.0 for c in close]
    open_ = [close[i - 1] if i > 0 else close[0] for i in range(n)]
    volume = [1000 + 20 * (i % 11) for i in range(n)]
    idx = pd.date_range("2023-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


def _default_params(indicator_id: str) -> dict[str, int | float]:
    return {name: spec.default for name, spec in ind.get(indicator_id).params.items()}


# ── 골든 픽스처: SMA ─────────────────────────────────────────────────────


def test_sma_golden(small_ohlcv: pd.DataFrame) -> None:
    result = ind.get("SMA").fn(small_ohlcv, period=5)
    assert result.iloc[:4].isna().all()  # period-1개는 워밍업 NaN
    expected = [11.4, 12.2, 12.6, 13.2, 14.2, 14.6, 15.2, 16.2, 16.6, 17.2, 18.2]
    np.testing.assert_allclose(result.iloc[4:].to_numpy(), expected)


# ── 골든 픽스처: EMA ─────────────────────────────────────────────────────


def test_ema_golden(small_ohlcv: pd.DataFrame) -> None:
    # alpha=2/(3+1)=0.5. 시드=SMA(첫 3개)=11.0, 이후 재귀: EMA[i]=0.5*close[i]+0.5*EMA[i-1].
    result = ind.get("EMA").fn(small_ohlcv, period=3)
    assert result.iloc[:2].isna().all()
    expected = [11.0, 11.0, 12.0, 13.0, 13.0, 14.0, 15.0, 15.0, 16.0, 17.0, 17.0, 18.0, 19.0]
    np.testing.assert_allclose(result.iloc[2:].to_numpy(), expected)


# ── 골든 픽스처: RSI ─────────────────────────────────────────────────────


def test_rsi_golden(small_ohlcv: pd.DataFrame) -> None:
    # period=5 Wilder. 상승분 시드=mean(1,1,0,2,1)=1.0, 하락분 시드=mean(0,0,1,0,0)=0.2 (idx5).
    result = ind.get("RSI").fn(small_ohlcv, period=5)
    assert result.iloc[:5].isna().all()
    expected = {
        5: 83.33333333333333,
        6: 68.9655172413793,
        7: 78.3132530120482,
        8: 81.74904942965779,
        14: 80.62617672102738,
    }
    for i, want in expected.items():
        assert result.iloc[i] == pytest.approx(want)


# ── 골든 픽스처: MACD ────────────────────────────────────────────────────


def test_macd_golden(small_ohlcv: pd.DataFrame) -> None:
    # fast=3/slow=4/signal=2 — 표준 12/26/9 대신 작은 주기를 써서 손계산이 가능하게 했다.
    result = ind.get("MACD").fn(small_ohlcv, fast=3, slow=4, signal=2)
    assert set(result.columns) == {"macd", "signal", "hist"}
    assert result["macd"].iloc[:3].isna().all()
    assert result["signal"].iloc[:4].isna().all()

    expected_macd = {
        3: 0.0,
        4: 0.2,
        5: 0.32,
        14: 0.40727478272000184,
    }
    for i, want in expected_macd.items():
        assert result["macd"].iloc[i] == pytest.approx(want)

    expected_signal = {
        4: 0.1,
        5: 0.24666666666666673,
        14: 0.38014281304086484,
    }
    for i, want in expected_signal.items():
        assert result["signal"].iloc[i] == pytest.approx(want)

    expected_hist = {4: 0.1, 5: 0.07333333333333356}
    for i, want in expected_hist.items():
        assert result["hist"].iloc[i] == pytest.approx(want)


# ── 골든 픽스처: ATR ─────────────────────────────────────────────────────


def test_atr_golden(small_ohlcv: pd.DataFrame) -> None:
    # TR 시드(idx5)=mean(2,2,2,3,2)=2.2, 이후 Wilder 재귀.
    result = ind.get("ATR").fn(small_ohlcv, period=5)
    assert result.iloc[:5].isna().all()
    expected = {5: 2.2, 6: 2.16, 7: 2.328, 14: 2.3107065856}
    for i, want in expected.items():
        assert result.iloc[i] == pytest.approx(want)


# ── 골든 픽스처: Bollinger ───────────────────────────────────────────────


def test_bollinger_golden(small_ohlcv: pd.DataFrame) -> None:
    # 표본표준편차(ddof=1). mid=SMA(5)=11.4, std(10,11,12,11,13)≈1.140175425.
    result = ind.get("BBANDS").fn(small_ohlcv, period=5, k=2.0)
    assert set(result.columns) == {"mid", "upper", "lower"}
    assert result["mid"].iloc[:4].isna().all()
    assert result["mid"].iloc[4] == pytest.approx(11.4)
    assert result["upper"].iloc[4] == pytest.approx(13.680350850198277)
    assert result["lower"].iloc[4] == pytest.approx(9.119649149801724)
    assert result["mid"].iloc[14] == pytest.approx(18.2)
    assert result["upper"].iloc[14] == pytest.approx(20.807680962081058)
    assert result["lower"].iloc[14] == pytest.approx(15.59231903791894)


# ── 골든 픽스처: Stochastic ──────────────────────────────────────────────


def test_stochastic_golden(small_ohlcv: pd.DataFrame) -> None:
    # k_period=5, d_period=3. high=close+1/low=close-1이므로 range=max-min+2.
    result = ind.get("STOCH").fn(small_ohlcv, k_period=5, d_period=3)
    assert set(result.columns) == {"k", "d"}
    assert result["k"].iloc[:4].isna().all()
    expected_k = {4: 80.0, 5: 80.0, 6: 60.0, 7: 83.33333333333333, 14: 80.0}
    for i, want in expected_k.items():
        assert result["k"].iloc[i] == pytest.approx(want)
    assert result["d"].iloc[:6].isna().all()
    expected_d = {6: 73.33333333333333, 7: 74.44444444444444, 14: 74.44444444444444}
    for i, want in expected_d.items():
        assert result["d"].iloc[i] == pytest.approx(want)


# ── 교차 헬퍼 ─────────────────────────────────────────────────────────────


def test_cross_above_detects_upward_cross() -> None:
    a = pd.Series([1.0, 1.0, 2.0, 3.0, 2.0])
    b = pd.Series([2.0, 2.0, 2.0, 2.0, 2.0])
    result = ind.cross_above(a, b)
    assert result.tolist() == [False, False, False, True, False]
    assert result.dtype == bool


def test_cross_below_detects_downward_cross() -> None:
    a = pd.Series([3.0, 3.0, 2.0, 1.0, 2.0])
    b = pd.Series([2.0, 2.0, 2.0, 2.0, 2.0])
    result = ind.cross_below(a, b)
    assert result.tolist() == [False, False, False, True, False]
    assert result.dtype == bool


def test_cross_helpers_are_false_across_nan_boundary() -> None:
    # 워밍업 NaN 구간에서 실제 값으로 넘어가는 경계도 "교차"라고 주장하면 안 된다.
    a = pd.Series([np.nan, np.nan, 5.0, 5.0])
    b = pd.Series([np.nan, 2.0, 2.0, 2.0])
    assert ind.cross_above(a, b).tolist() == [False, False, False, False]
    assert ind.cross_below(a, b).tolist() == [False, False, False, False]


# ── 워밍업 NaN 구조 검증 (25종 전체) ──────────────────────────────────────

# 지표별 정의식에서 유도한 "정확한" 선행 NaN 개수(디폴트 파라미터, long_ohlcv 60봉 기준).
# 근거:
#   - period 롤링 계열(SMA/EMA/WMA/STD/BBANDS/DONCHIAN/VWMA/CCI/WILLR/STOCH.k):     period-1
#   - 시프트 계열(ROC/MOM):                                                      period
#   - Wilder 평활(RSI/ATR/NATR, 시드가 diff/TR의 1개 선행 NaN 때문에 한 칸 밀림):     period
#   - MFI: diff 결측을 0(중립)으로 흡수하므로 롤링 계열과 동일하게                    period-1
#   - STOCH.d: k의 (k_period-1) + d 자체의 (d_period-1)
#   - MACD: signal/hist는 slow의 (slow-1) + signal의 (signal-1)
#   - DEMA/TEMA: EMA를 거듭 씌우므로 (period-1)의 2배/3배
#   - ADX: DI가 period, DX를 다시 Wilder 평활하며 (period-1) 더 밀려 2*period-1
#   - AROON: 창 크기가 period+1이라 선행 NaN은 (창-1)=period
#   - SAR/OBV: 재귀/누적형이라 표에서 별도 처리(각각 1, 0)
EXPECTED_NAN_LEAD: dict[str, dict[str, int]] = {
    "SMA": {"sma": 19},
    "EMA": {"ema": 19},
    "WMA": {"wma": 9},
    "DEMA": {"dema": 38},
    "TEMA": {"tema": 57},
    "RSI": {"rsi": 14},
    "MACD": {"macd": 25, "signal": 33, "hist": 33},
    "STOCH": {"k": 13, "d": 15},
    "CCI": {"cci": 19},
    "WILLR": {"willr": 13},
    "ROC": {"roc": 12},
    "MOM": {"mom": 10},
    "ADX": {"adx": 27, "plus_di": 14, "minus_di": 14},
    "AROON": {"up": 14, "down": 14},
    "SAR": {"sar": 1},
    "ATR": {"atr": 14},
    "NATR": {"natr": 14},
    "BBANDS": {"mid": 19, "upper": 19, "lower": 19},
    "KC": {"mid": 19, "upper": 19, "lower": 19},
    "DONCHIAN": {"upper": 19, "lower": 19, "mid": 19},
    "STD": {"std": 19},
    "OBV": {"obv": 0},
    "MFI": {"mfi": 13},
    "VWMA": {"vwma": 19},
    "CMF": {"cmf": 19},
}


def test_all_25_indicators_are_registered() -> None:
    assert {spec.id for spec in ind.list_all()} == set(EXPECTED_NAN_LEAD)
    assert len(ind.list_all()) == 25


@pytest.mark.parametrize("indicator_id", sorted(EXPECTED_NAN_LEAD))
def test_warmup_is_nan_and_matches_definition(indicator_id: str, long_ohlcv: pd.DataFrame) -> None:
    spec = ind.get(indicator_id)
    result = spec.fn(long_ohlcv, **_default_params(indicator_id))
    columns = {spec.outputs[0]: result} if isinstance(result, pd.Series) else dict(result.items())

    for name, series in columns.items():
        expected_lead = EXPECTED_NAN_LEAD[indicator_id][name]
        nan_mask = series.isna()
        assert int(nan_mask.sum()) == expected_lead, (
            f"{indicator_id}.{name}: NaN count {int(nan_mask.sum())} != {expected_lead}"
        )
        if expected_lead > 0:
            assert nan_mask.iloc[:expected_lead].all(), (
                f"{indicator_id}.{name}: 선행 구간이 NaN이 아니다"
            )
        if expected_lead < len(series):
            assert not nan_mask.iloc[expected_lead:].any(), (
                f"{indicator_id}.{name}: 워밍업 이후 구간에 NaN 구멍이 있다"
            )


# ── 값 범위 불변식 (정의상 유계인 지표) ───────────────────────────────────


def test_rsi_bounded_0_to_100(long_ohlcv: pd.DataFrame) -> None:
    result = ind.get("RSI").fn(long_ohlcv, period=14)
    assert result.dropna().between(0, 100).all()


def test_willr_bounded_minus100_to_0(long_ohlcv: pd.DataFrame) -> None:
    result = ind.get("WILLR").fn(long_ohlcv, period=14)
    assert result.dropna().between(-100, 0).all()


def test_stochastic_k_bounded_0_to_100(long_ohlcv: pd.DataFrame) -> None:
    result = ind.get("STOCH").fn(long_ohlcv, k_period=14, d_period=3)
    assert result["k"].dropna().between(0, 100).all()


def test_bollinger_upper_never_below_lower(long_ohlcv: pd.DataFrame) -> None:
    result = ind.get("BBANDS").fn(long_ohlcv, period=20, k=2.0)
    mask = result["upper"].notna() & result["lower"].notna()
    assert (result["upper"][mask] >= result["lower"][mask]).all()


def test_donchian_upper_never_below_lower(long_ohlcv: pd.DataFrame) -> None:
    result = ind.get("DONCHIAN").fn(long_ohlcv, period=20)
    mask = result["upper"].notna() & result["lower"].notna()
    assert (result["upper"][mask] >= result["lower"][mask]).all()


# ── 레지스트리 계약 ───────────────────────────────────────────────────────


def test_register_rejects_duplicate_id() -> None:
    spec = ind.get("SMA")
    with pytest.raises(ValueError, match="already registered"):
        ind.register(
            "SMA", params=spec.params, source=spec.source, fn=spec.fn, outputs=spec.outputs
        )


def test_get_unknown_indicator_raises_key_error() -> None:
    with pytest.raises(KeyError):
        ind.get("NOT_A_REAL_INDICATOR")


def test_param_spec_carries_type_default_and_range() -> None:
    spec = ind.get("RSI")
    period = spec.params["period"]
    assert period.type == "int"
    assert period.default == 14
    assert period.min is not None
    assert period.max is not None
