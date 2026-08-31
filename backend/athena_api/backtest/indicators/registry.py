"""지표를 이름으로 등록·조회하는 레지스트리 — 어댑터 경계.

지금은 핵심 25종(P3)을 직접 구현하지만, 나머지 55종(P6)을 나중에 pandas-ta에
위임하든 직접 짜든 교체 비용을 지표 하나 단위로 떨어뜨리는 것이 이 파일의 목적이다
(docs/architecture/backtest-mode-plan.md §6.3). 프런트 파라미터 슬라이더는 여기 등록된
`params` 스펙을 그대로 읽는다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import pandas as pd

# 지표가 먹는 가격열 범주. hlc/ohlcv는 여러 열을 함께 쓰는 지표(예: Stochastic, OBV)를
# 위한 버킷이고, 실제로 어떤 열을 쓰는지는 각 지표의 계산 함수 안에 있다 — 이 값은
# 프런트가 "이 지표는 대략 무엇을 보는가"를 표시하는 용도의 힌트일 뿐이다.
Source = Literal["close", "high", "low", "open", "volume", "hlc", "ohlcv"]


@dataclass(frozen=True)
class ParamSpec:
    """지표 파라미터 하나의 타입·기본값·범위. 프런트 슬라이더가 이 스펙을 그대로 읽는다."""

    type: Literal["int", "float"]
    default: int | float
    min: int | float | None = None
    max: int | float | None = None
    step: int | float | None = None


# 계산 함수 시그니처는 하나로 통일한다: fn(df, **params) -> Series | DataFrame.
# df는 open,high,low,close,volume 열과 오름차순 DatetimeIndex를 갖는다(§6.3).
IndicatorFn = Callable[..., "pd.Series | pd.DataFrame"]


@dataclass(frozen=True)
class IndicatorSpec:
    """등록된 지표 하나: 계산 함수 + 메타데이터."""

    id: str
    params: dict[str, ParamSpec]
    source: Source
    fn: IndicatorFn
    outputs: tuple[str, ...]


_REGISTRY: dict[str, IndicatorSpec] = {}


def register(
    id: str,
    *,
    params: dict[str, ParamSpec],
    source: Source,
    fn: IndicatorFn,
    outputs: tuple[str, ...],
) -> None:
    """지표를 이름으로 등록한다. 같은 id를 두 번 등록하면 이식 실수이므로 막는다."""
    if id in _REGISTRY:
        raise ValueError(f"indicator already registered: {id}")
    _REGISTRY[id] = IndicatorSpec(id=id, params=params, source=source, fn=fn, outputs=outputs)


def get(id: str) -> IndicatorSpec:
    """등록된 지표를 id로 조회한다. 없으면 KeyError — 존재하지 않는 지표를 조용히 넘기지 않는다."""
    try:
        return _REGISTRY[id]
    except KeyError:
        raise KeyError(f"unknown indicator: {id}") from None


def list_all() -> list[IndicatorSpec]:
    """등록 순서 그대로 전체 목록을 돌려준다. `GET /api/v1/backtest/indicators`가 그대로 쓴다."""
    return list(_REGISTRY.values())


def cross_above(a: pd.Series, b: pd.Series) -> pd.Series:
    """a가 b를 아래에서 위로 가로지르는 지점. 전략 코드(§7.1)가 그대로 쓰는 계약이다.

    직전 봉에서 a<=b였다가 이번 봉에서 a>b가 되는 지점만 True. pandas 비교 연산은
    피연산자가 NaN이면 결과가 항상 False이므로(NaN이 교차했다고 주장할 근거가 없다),
    워밍업 구간(지표가 아직 NaN인 구간)은 자연히 False가 된다 — 별도 처리가 필요 없다.
    """
    prev_a, prev_b = a.shift(1), b.shift(1)
    return (prev_a <= prev_b) & (a > b)


def cross_below(a: pd.Series, b: pd.Series) -> pd.Series:
    """a가 b를 위에서 아래로 가로지르는 지점. NaN 구간은 cross_above와 같은 이유로 False."""
    prev_a, prev_b = a.shift(1), b.shift(1)
    return (prev_a >= prev_b) & (a < b)
