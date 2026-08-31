"""선언형 경로(§6.2) 검증 — `compile_signals()`가 지표 레지스트리·`resolve_params`를 그대로
재사용해 entry/exit를 낸다는 것을 대조한다. 기준값은 `compile.py`를 거치지 않고 지표
레지스트리를 직접 불러 만든다 — "compile.py가 다른 경로로 계산해도 같은 값이 나오는가"가
핵심이지 "compile.py가 스스로와 일치하는가"가 아니다.
"""

from __future__ import annotations

import math

import pandas as pd
import pytest

from athena_api.backtest import indicators as ind
from athena_api.backtest.compile import compile_signals
from athena_api.backtest.schema import from_kis_yaml

# 결정층(leaf 9): 순수 조립 로직이다. LLM도 난수도 없다.
pytestmark = pytest.mark.deterministic

_SMA_CROSS_YAML = """
version: "1.0"
metadata:
  name: 컴파일 테스트 — SMA 교차
strategy:
  id: t1
  params:
    fast: {default: 3, min: 2, max: 10, step: 1, type: int}
    slow: {default: 5, min: 2, max: 20, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast", source: close}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow"}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}
risk:
  stop_loss:   {enabled: false, percent: 0}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""

_MACD_YAML = """
version: "1.0"
metadata:
  name: 컴파일 테스트 — MACD 다중출력
strategy:
  id: t2
  params: {}
  indicators:
    - {id: MACD, alias: macd1, params: {fast: 3, slow: 4, signal: 2}}
  entry:
    logic: AND
    conditions:
      - {indicator: macd1_macd, operator: greater_than, compare_to: macd1_signal}
  exit:
    logic: AND
    conditions:
      - {indicator: close, operator: less_than, compare_to: 0}
risk:
  stop_loss:   {enabled: false, percent: 0}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""


@pytest.fixture
def synthetic_df() -> pd.DataFrame:
    n = 40
    close = [100 + i * 0.3 + 4 * math.sin(i / 5.0) for i in range(n)]
    high = [c + 1 for c in close]
    low = [c - 1 for c in close]
    open_ = [close[i - 1] if i > 0 else close[0] for i in range(n)]
    volume = [1000 + 10 * i for i in range(n)]
    idx = pd.date_range("2024-01-02", periods=n, freq="B")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


def test_compile_sma_cross_matches_direct_indicator_computation(synthetic_df: pd.DataFrame) -> None:
    spec = from_kis_yaml(_SMA_CROSS_YAML)
    signals = compile_signals(spec, synthetic_df)

    fast = ind.get("SMA").fn(synthetic_df, period=3)
    slow = ind.get("SMA").fn(synthetic_df, period=5)
    assert (signals["entry"] == ind.cross_above(fast, slow)).all()
    assert (signals["exit"] == ind.cross_below(fast, slow)).all()
    assert signals["entry"].dtype == bool
    assert signals["exit"].dtype == bool
    assert list(signals.index) == list(synthetic_df.index)


def test_compile_ignores_extra_indicator_param_keys(synthetic_df: pd.DataFrame) -> None:
    """`{period: "$fast", source: close}`의 `source`는 SMA 레지스트리가 모르는 키다 —
    조용히 무시돼야 계산 함수 호출이 TypeError 없이 성공한다."""
    spec = from_kis_yaml(_SMA_CROSS_YAML)
    signals = compile_signals(spec, synthetic_df)  # source 키 때문에 죽지 않는다
    assert signals["entry"].any() or not signals["entry"].any()  # 예외 없이 끝났다는 것 자체가 단언


def test_compile_resolves_param_overrides(synthetic_df: pd.DataFrame) -> None:
    spec = from_kis_yaml(_SMA_CROSS_YAML)
    signals = compile_signals(spec, synthetic_df, overrides={"fast": 2, "slow": 4})

    fast = ind.get("SMA").fn(synthetic_df, period=2)
    slow = ind.get("SMA").fn(synthetic_df, period=4)
    assert (signals["entry"] == ind.cross_above(fast, slow)).all()


def test_compile_rejects_unknown_alias_reference(synthetic_df: pd.DataFrame) -> None:
    bad_yaml = _SMA_CROSS_YAML.replace("compare_to: ma_slow", "compare_to: does_not_exist")
    spec = from_kis_yaml(bad_yaml)
    with pytest.raises(ValueError, match="does_not_exist"):
        compile_signals(spec, synthetic_df)


def test_compile_exposes_raw_ohlcv_columns_to_conditions(synthetic_df: pd.DataFrame) -> None:
    """조건식이 지표 별칭뿐 아니라 원시 캔들 열(`close` 등)도 직접 참조할 수 있어야 한다
    — 52주 신고가 돌파 같은 프리셋이 "close >= donchian_upper"를 표현하는 전제다."""
    yaml_text = _SMA_CROSS_YAML.replace(
        "- {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}",
        "- {indicator: close, operator: greater_than, compare_to: 0}",
    )
    spec = from_kis_yaml(yaml_text)
    signals = compile_signals(spec, synthetic_df)
    assert signals["exit"].all()  # close는 항상 0보다 크다(합성 데이터 전제)


def test_compile_multi_output_indicator_uses_alias_underscore_output_columns(
    synthetic_df: pd.DataFrame,
) -> None:
    """MACD처럼 출력이 여럿인 지표는 `별칭_출력명`으로 갈라져야 조건식이 개별 참조할 수 있다."""
    spec = from_kis_yaml(_MACD_YAML)
    signals = compile_signals(spec, synthetic_df)

    macd = ind.get("MACD").fn(synthetic_df, fast=3, slow=4, signal=2)
    expected_entry = (macd["macd"] > macd["signal"]).fillna(False)
    assert (signals["entry"].fillna(False) == expected_entry).all()
