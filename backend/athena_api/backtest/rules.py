"""조건식 평가 — 연산자 7종 + AND/OR(§6.2). `compile.py`가 지표 프레임을 만든 뒤 이 모듈로
넘겨 entry/exit 불리언 시리즈를 얻는다.

**cross_above/cross_below를 여기서 다시 짜지 않는다.** `indicators/registry.py`가 이미
갖고 있고(§6.3), 그 함수의 워밍업 NaN 처리("피연산자가 NaN이면 결과가 항상 False")가
바로 여기서 요구하는 "NaN=False" 규칙과 같은 것이다 — 재정의하면 두 자리의 NaN 규칙이
갈라질 위험만 생긴다.

**나머지 4개 비교 연산자(>,<,>=,<=)와 equals는 왜 별도 NaN 처리를 안 하나.** numpy/pandas의
비교 연산은 피연산자에 NaN이 있으면 항상 `False`를 낸다(`!=`만 예외이고 여기 쓰지 않는다) —
"NaN이 그 조건을 만족한다고 주장할 근거가 없다"는 규칙이 pandas 기본 동작과 이미 일치한다.
"""

from __future__ import annotations

import pandas as pd

from athena_api.backtest.indicators import cross_above, cross_below
from athena_api.backtest.schema import ConditionGroup, ConditionSpec, Logic, Operator


def _resolve_operand(name_or_value: str | float, frame: pd.DataFrame) -> pd.Series:
    """`compare_to`(또는 `indicator`)를 시리즈로 푼다. 문자열이면 프레임의 컬럼(지표 별칭 또는
    원시 OHLCV 컬럼) 참조, 숫자면 상수를 프레임 인덱스 길이만큼 브로드캐스트한 시리즈다."""
    if isinstance(name_or_value, str):
        if name_or_value not in frame.columns:
            raise ValueError(f"알 수 없는 지표/컬럼 참조: {name_or_value}")
        return frame[name_or_value]
    return pd.Series(float(name_or_value), index=frame.index)


def evaluate_condition(frame: pd.DataFrame, condition: ConditionSpec) -> pd.Series:
    """조건 하나를 프레임 위에서 평가해 불리언 시리즈를 낸다."""
    a = _resolve_operand(condition.indicator, frame)
    b = _resolve_operand(condition.compare_to, frame)
    op = condition.operator
    if op is Operator.CROSS_ABOVE:
        return cross_above(a, b)
    if op is Operator.CROSS_BELOW:
        return cross_below(a, b)
    if op is Operator.GREATER_THAN:
        return a > b
    if op is Operator.LESS_THAN:
        return a < b
    if op is Operator.GREATER_EQUAL:
        return a >= b
    if op is Operator.LESS_EQUAL:
        return a <= b
    if op is Operator.EQUALS:
        return a == b
    # Operator가 폐쇄형(StrEnum)이라 실제로는 도달 불가 — mypy/사람이 읽을 때를 위한 방어.
    raise ValueError(f"처리하지 않는 연산자: {op}")  # pragma: no cover


def evaluate_group(frame: pd.DataFrame, group: ConditionGroup) -> pd.Series:
    """조건 묶음을 `logic`(AND/OR)으로 합친다. `conditions`는 스키마가 최소 1개를 보장한다."""
    combined = evaluate_condition(frame, group.conditions[0])
    for condition in group.conditions[1:]:
        result = evaluate_condition(frame, condition)
        combined = combined & result if group.logic is Logic.AND else combined | result
    return combined


__all__ = ["evaluate_condition", "evaluate_group"]
