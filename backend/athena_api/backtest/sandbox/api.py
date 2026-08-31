"""athena_bt — 전략 코드(§7.1)가 볼 수 있는 유일한 계산 표면.

지표 레지스트리(`indicators/registry.py`·`indicators/core.py`)에 이미 등록된 핵심 25종을
평면 함수로 노출한다. 여기서 새 지표를 구현하지 않는다 — 폼 경로(compile.py)와 정확히 같은
구현을 재사용하는 것 자체가 두 저작 경로(§6.2)의 성과 계산이 갈라지지 않는 이유다.

**시그니처 어댑트.** 레지스트리 함수는 `fn(df, **params) -> Series | DataFrame`로 통일돼
있고 내부에서 `df.close`처럼 여러 열을 직접 읽는다. 하지만 §7.1 계약 예시는
`bt.sma(df.close, p["fast"])`처럼 시리즈 하나를 직접 넘기는 걸 기대한다. 그래서 레지스트리가
`source="close"`로 선언한 지표(값 하나만 보는 지표)는 시리즈를 받아 임시 DataFrame의 close
열에 채워 그대로 위임하고, 여러 열이 필요한 지표(`source="hlc"`/`"ohlcv"`)는 df 전체를 받는
시그니처로 노출한다 — 이 하나뿐인 분기가 25종 전부에 그대로 적용된다.

이 모듈 자체는 `sys.modules`에 실제로 등록된 패키지가 아니다 — 자식 진입점(`__main__.py`)이
`sys.modules["athena_bt"] = <이 모듈>`로 별칭을 걸어야 전략 코드의 `import athena_bt as bt`가
동작한다. 여기서는 그 별칭 배선을 하지 않는다(그건 진입점의 책임이다).
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from athena_api.backtest.indicators import registry as _registry
from athena_api.backtest.indicators.registry import cross_above, cross_below

# 평면 노출할 핵심 25종(P3, §6.3). 이름은 레지스트리 id를 소문자화한 것 — bt.sma, bt.rsi 등.
_CORE_INDICATOR_IDS: tuple[str, ...] = (
    "SMA", "EMA", "WMA", "DEMA", "TEMA", "RSI", "MACD", "STOCH", "CCI", "WILLR",
    "ROC", "MOM", "ADX", "AROON", "SAR", "ATR", "NATR", "BBANDS", "KC", "DONCHIAN",
    "STD", "OBV", "MFI", "VWMA", "CMF",
)  # fmt: skip


def _make_wrapper(indicator_id: str):
    """레지스트리 지표 하나를 위 설명대로 직관 시그니처 함수로 감싼다."""
    spec = _registry.get(indicator_id)
    param_names = tuple(spec.params.keys())

    if spec.source == "close":

        def wrapper(series: pd.Series, *args: Any, **kwargs: Any) -> pd.Series | pd.DataFrame:
            params = dict(zip(param_names, args, strict=False))
            params.update(kwargs)
            frame = pd.DataFrame({"close": series})
            return spec.fn(frame, **params)

    else:

        def wrapper(df: pd.DataFrame, *args: Any, **kwargs: Any) -> pd.Series | pd.DataFrame:
            params = dict(zip(param_names, args, strict=False))
            params.update(kwargs)
            return spec.fn(df, **params)

    wrapper.__name__ = indicator_id.lower()
    wrapper.__doc__ = (
        f"레지스트리 지표 {indicator_id} 래퍼. 파라미터: {param_names or '없음'}. "
        f"source={spec.source!r} — {'시리즈' if spec.source == 'close' else 'df 전체'}를 받는다."
    )
    return wrapper


sma = _make_wrapper("SMA")
ema = _make_wrapper("EMA")
wma = _make_wrapper("WMA")
dema = _make_wrapper("DEMA")
tema = _make_wrapper("TEMA")
rsi = _make_wrapper("RSI")
macd = _make_wrapper("MACD")
stoch = _make_wrapper("STOCH")
cci = _make_wrapper("CCI")
willr = _make_wrapper("WILLR")
roc = _make_wrapper("ROC")
mom = _make_wrapper("MOM")
adx = _make_wrapper("ADX")
aroon = _make_wrapper("AROON")
sar = _make_wrapper("SAR")
atr = _make_wrapper("ATR")
natr = _make_wrapper("NATR")
bbands = _make_wrapper("BBANDS")
kc = _make_wrapper("KC")
donchian = _make_wrapper("DONCHIAN")
std = _make_wrapper("STD")
obv = _make_wrapper("OBV")
mfi = _make_wrapper("MFI")
vwma = _make_wrapper("VWMA")
cmf = _make_wrapper("CMF")

__all__ = [
    "adx",
    "aroon",
    "atr",
    "bbands",
    "cci",
    "cmf",
    "cross_above",
    "cross_below",
    "dema",
    "donchian",
    "ema",
    "kc",
    "macd",
    "mfi",
    "mom",
    "natr",
    "obv",
    "roc",
    "rsi",
    "sar",
    "sma",
    "std",
    "stoch",
    "tema",
    "vwma",
    "willr",
    "wma",
]
