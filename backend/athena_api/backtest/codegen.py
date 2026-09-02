"""지도 → 파이썬 — 폼(스펙)으로 그린 지도 뒤에 놓일 전략 코드를 만든다(§7.1 계약).

**왜 코드를 생성하나.** 코드가 아니라 지도가 진실이다 — 사람은 대화로 지도를 고치고,
코드는 그 지도에서 다시 나온다. 그래서 이 파일의 목표는 "예쁜 코드"가 아니라 **지도와
한 줄씩 맞는 코드**다: 지표 하나가 한 줄, 진입·청산이 각각 한 줄. flow.py가 그 코드를
다시 4단계로 읽었을 때 모르는 것이 하나도 없어야 지도와 코드가 갈라지지 않는다.

**왜 compile.py와 같은 열 이름을 쓰나.** 출력이 여럿인 지표는 `별칭_출력명`으로 갈린다
(compile.py `_indicator_columns`). 생성 코드가 다른 이름을 쓰면 같은 스펙이 두 저작
경로(§6.2)에서 다른 신호를 낸다 — 두 경로가 갈라지지 않는다는 약속이 여기서도 지켜져야
한다. 지표 계산도 폼 경로와 같은 레지스트리(`athena_bt`)를 그대로 부른다.

**지키는 선은 여기 없다.** 손절·익절·비중은 signals 뒤에서 앱 엔진(engine.py)이 적용한다.
생성 코드가 그걸 흉내 내면 같은 규칙이 두 번 걸리거나 서로 다른 값이 돌게 된다 — 그래서
생성 파일의 머리말이 그 사실을 사람에게도 먼저 말한다.
"""

from __future__ import annotations

from typing import Any

from athena_api.backtest import indicators
from athena_api.backtest.schema import (
    ConditionGroup,
    ConditionSpec,
    Logic,
    Operator,
    ParamSpec,
    StrategySpec,
)

# 비교 연산자 5종은 파이썬 연산자 그대로다. cross_above/cross_below는 함수라 따로 낸다.
_OPERATOR_CODE: dict[Operator, str] = {
    Operator.GREATER_THAN: ">",
    Operator.LESS_THAN: "<",
    Operator.GREATER_EQUAL: ">=",
    Operator.LESS_EQUAL: "<=",
    Operator.EQUALS: "==",
}

_CROSS_FN: dict[Operator, str] = {
    Operator.CROSS_ABOVE: "cross_above",
    Operator.CROSS_BELOW: "cross_below",
}

_HEADER = (
    "# athena strategy v1 — 이 파일은 흐름 지도에서 생성됐습니다. 지도를 고치면 다시 나옵니다.\n"
    "# 지키는 선(손절·익절·비중)은 이 코드가 아니라 앱 엔진이 겁니다 — 코드는 두 열만 만듭니다."
)


def _literal(value: Any) -> str:
    """스펙에 적힌 값을 코드 리터럴로 옮긴다 — 정수는 정수로 남긴다(20.0이 되면 슬라이더가
    스펙과 어긋난다). 문자열은 이 파일의 따옴표 관례(쌍따옴표)를 따른다."""
    if isinstance(value, str):
        return f'"{value}"'
    return repr(value)


def _params_block(params: dict[str, ParamSpec]) -> str:
    """최상위 `PARAMS` 리터럴. flow.py가 `ast`로 읽는 자리라 리터럴이 아니면 안 된다."""
    if not params:
        return "PARAMS = {}"
    lines = ["PARAMS = {"]
    for name, p in params.items():
        lines.append(
            f'    "{name}": {{"default": {_literal(p.default)}, "min": {_literal(p.min)}, '
            f'"max": {_literal(p.max)}, "step": {_literal(p.step)}, "type": "{p.type}"}},'
        )
    lines.append("}")
    return "\n".join(lines)


def _param_value(value: Any) -> str:
    """지표 파라미터 하나 — `"$fast"`는 `p["fast"]`로, 리터럴은 그대로.

    치환하지 않고 `p[...]`로 남기는 것이 핵심이다. 치환해 넣으면 슬라이더를 움직여도
    코드가 옛 숫자를 그대로 돌린다.
    """
    if isinstance(value, str) and value.startswith("$"):
        return f'p["{value[1:]}"]'
    return _literal(value)


def _operand(value: str | float, columns: dict[str, str], *, as_series: bool) -> tuple[str, bool]:
    """조건식 피연산자 하나를 코드 조각으로 옮긴다. 두 번째 값은 pandas가 필요한지 여부다.

    지표 별칭이면 그 지역 변수, 아니면 df의 원시 열(close 등)이다 — compile.py가 지표
    프레임에 원시 OHLCV를 같이 얹는 것과 같은 규칙이다.

    상수는 보통 그냥 숫자로 두지만 `cross_above`/`cross_below`만은 시리즈여야 한다
    (registry.cross_above가 두 인자에 `.shift(1)`을 건다) — 폼 경로에서 rules.py가 하는
    브로드캐스트를 여기서는 코드로 적는다.
    """
    if isinstance(value, str):
        return columns.get(value, f'df["{value}"]'), False
    if as_series:
        return f"pd.Series({float(value)!r}, index=df.index)", True
    return _literal(value), False


def _condition_expr(condition: ConditionSpec, columns: dict[str, str]) -> tuple[str, bool]:
    cross_fn = _CROSS_FN.get(condition.operator)
    a, need_a = _operand(condition.indicator, columns, as_series=cross_fn is not None)
    b, need_b = _operand(condition.compare_to, columns, as_series=cross_fn is not None)
    if cross_fn is not None:
        return f"bt.{cross_fn}({a}, {b})", need_a or need_b
    return f"{a} {_OPERATOR_CODE[condition.operator]} {b}", False


def _group_expr(group: ConditionGroup, columns: dict[str, str]) -> tuple[str, bool]:
    parts: list[str] = []
    needs_pandas = False
    for condition in group.conditions:
        expr, needs = _condition_expr(condition, columns)
        parts.append(expr)
        needs_pandas = needs_pandas or needs
    if len(parts) == 1:
        return parts[0], needs_pandas
    joiner = " & " if group.logic is Logic.AND else " | "
    return joiner.join(f"({p})" for p in parts), needs_pandas


def spec_to_python(spec: StrategySpec) -> str:
    """폼 스펙 하나를 §7.1 계약을 만족하는 전략 파이썬 한 장으로 옮긴다."""
    columns: dict[str, str] = {}
    indicator_lines: list[str] = []
    for ind in spec.strategy.indicators:
        registry_spec = indicators.get(ind.id)
        # 레지스트리가 모르는 키는 버린다 — compile.py가 실행 직전에 하는 것과 같은 여과다.
        args = [
            f"{name}={_param_value(ind.params[name])}"
            for name in registry_spec.params
            if name in ind.params
        ]
        first = 'df["close"]' if registry_spec.source == "close" else "df"
        call = f"bt.{ind.id.lower()}({', '.join([first, *args])})"
        indicator_lines.append(f"    {ind.alias} = {call}")
        if len(registry_spec.outputs) == 1:
            columns[ind.alias] = ind.alias
        else:
            for output in registry_spec.outputs:
                name = f"{ind.alias}_{output}"
                indicator_lines.append(f'    {name} = {ind.alias}["{output}"]')
                columns[name] = name

    entry_expr, entry_needs_pandas = _group_expr(spec.strategy.entry, columns)
    exit_expr, exit_needs_pandas = _group_expr(spec.strategy.exit, columns)

    imports = ["import athena_bt as bt"]
    if entry_needs_pandas or exit_needs_pandas:
        imports.append("import pandas as pd")

    parts = [
        _HEADER,
        "\n".join(imports),
        "",
        _params_block(spec.strategy.params),
        "",
        "",
        "def signals(df, p):",
        *indicator_lines,
        "",
        f"    entry = {entry_expr}",
        f"    exit_ = {exit_expr}",
        '    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]',
    ]
    return "\n".join(parts) + "\n"


__all__ = ["spec_to_python"]
