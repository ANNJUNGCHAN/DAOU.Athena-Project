"""전략 SSoT — `.athena.yaml v1` (docs/architecture/backtest-mode-plan.md §4, 구판 기준).

**왜 KIS 구조를 그대로 가져왔나.** `metadata / strategy{params, indicators, entry, exit} / risk`
3단은 브로커 중립적이다. 우리가 더하는 것은 `data:`(키움 축 — 종목·기간·주기)와
`costs:`(키움 축 — 수수료·세금·슬리피지) 두 블록뿐이다. 이 둘을 Optional로 둔 이유가
`from_kis_yaml()`의 존재 이유다 — KIS 원본 `.kis.yaml`은 이 두 블록을 모르는 채로 짜여
있고, 그 파일을 그대로 떨어뜨려도 로드가 돼야 한다. 없는 값을 이 모듈이 지어내지
않는다 — None으로 남기고 캔버스가 사용자에게 물어보게 한다(§4.2, §10.3).

**왜 `resolve_params`가 별도 함수인가.** 지표 `params`는 리터럴이거나 `"$fast"`처럼
`strategy.params`를 가리키는 참조다. 참조를 담은 채로는 엔진이 계산을 못 하고,
치환한 채로 저장하면 그리드 서치가 조합마다 새 스펙을 만들 방법이 없다. 그래서
스펙은 참조를 담은 원본 그대로 두고, 치환은 실행 직전에 한 번 하는 순수 함수로
분리한다.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field


class Operator(StrEnum):
    """조건식 연산자 7종 — KIS 원본과 동일(§0, §2)."""

    CROSS_ABOVE = "cross_above"
    CROSS_BELOW = "cross_below"
    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    GREATER_EQUAL = "greater_equal"
    LESS_EQUAL = "less_equal"
    EQUALS = "equals"


class Logic(StrEnum):
    """조건 묶음을 합치는 방식 — AND/OR, KIS 원본과 동일."""

    AND = "AND"
    OR = "OR"


class Metadata(BaseModel):
    """전략 이름표. 사람이 목록에서 알아보는 용도라 계산에는 관여하지 않는다."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: str | None = None
    tags: list[str] = Field(default_factory=list)


class DataSpec(BaseModel):
    """키움 축 — KIS 원본에는 없는 블록(§4.1). `from_kis_yaml()`은 이 필드가 없어도 받는다."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    symbols: list[str] = Field(min_length=1)
    period: Literal["day", "week", "month"]
    adjusted: bool
    # "from"은 파이썬 예약어라 별칭으로 받는다. YAML 쪽 필드명은 그대로 `from`이다.
    from_: str = Field(alias="from", min_length=1)
    to: str = Field(min_length=1)


class ParamSpec(BaseModel):
    """전략 파라미터 하나의 범위 — 프리셋 슬라이더와 그리드 서치가 그대로 읽는 모양이다.

    값을 `int | float`로 두는 이유: `type: int`인 파라미터의 `default`가 `20`이면
    `20.0`이 아니라 `20`으로 남아야 한다. pydantic v2의 스마트 유니온이 정수 리터럴을
    int로 우선 매칭하므로 `float`로만 선언하면 그 구분이 조용히 사라진다.
    """

    model_config = ConfigDict(extra="forbid")

    default: int | float
    min: int | float
    max: int | float
    step: int | float
    type: Literal["int", "float"] = "float"


class IndicatorSpec(BaseModel):
    """지표 하나의 배선. `id`는 §6.3 레지스트리 키, `alias`는 조건식이 부르는 이름이다.

    `params`의 값은 구조만 여기서 검증한다 — 리터럴인지 `"$fast"` 참조인지는
    `resolve_params()`가 실행 직전에 갈라낸다.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    alias: str = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class ConditionSpec(BaseModel):
    """조건 하나.

    `compare_to`를 `str | float`로 여는 이유: `cross_above`/`cross_below`는 관례상
    지표끼리(`ma_fast` vs `ma_slow`) 쓰지만, `greater_than`/`less_than`/`equals`는
    RSI > 70처럼 **상수와 비교하는 쪽이 실제로 더 흔하다**. 계획서 예시(§4.1)는
    지표-대-지표 경우만 보였지만, 연산자 7종에 상수 비교용 4종을 따로 둔 이유 자체가
    상수 비교를 배제하지 않는다는 뜻으로 읽었다 — compile.py/rules.py 몫으로 남기고
    여기서는 두 형태 다 구조적으로 통과시킨다.
    """

    model_config = ConfigDict(extra="forbid")

    indicator: str = Field(min_length=1)
    operator: Operator
    compare_to: str | float


class ConditionGroup(BaseModel):
    """진입 또는 청산 조건 묶음 — logic으로 묶고 conditions는 최소 1개."""

    model_config = ConfigDict(extra="forbid")

    logic: Logic
    conditions: list[ConditionSpec] = Field(min_length=1)


class StrategyBlock(BaseModel):
    """`strategy:` 블록 전체 — params/indicators/entry/exit."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    category: str | None = None
    params: dict[str, ParamSpec] = Field(default_factory=dict)
    indicators: list[IndicatorSpec] = Field(default_factory=list)
    entry: ConditionGroup
    exit: ConditionGroup


class RiskToggle(BaseModel):
    """손절/익절 하나 — enabled가 false면 percent는 읽히지 않는다(엔진 쪽 계약)."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool
    percent: float


class PositionSpec(BaseModel):
    """포지션 사이징. 1차는 `all_in`(전액 1종목) 하나만 쓴다 — 분할은 2차(§4.1)."""

    model_config = ConfigDict(extra="forbid")

    sizing: str = Field(min_length=1)


class RiskSpec(BaseModel):
    """`risk:` 블록 — KIS 원본에 있던 블록이라 Optional이 아니다."""

    model_config = ConfigDict(extra="forbid")

    stop_loss: RiskToggle
    take_profit: RiskToggle
    position: PositionSpec


class CostsSpec(BaseModel):
    """키움 축 — KIS 원본에는 없는 블록. 기본값이지 사실 주장이 아니다(§10.3) —

    세율은 시점에 따라 바뀌고, 우리가 그 시점의 정답을 안다고 주장할 근거가 없다.
    화면에서 사용자가 바꾼다.
    """

    model_config = ConfigDict(extra="forbid")

    fee_bps: float
    tax_bps: float
    slippage_bps: float


class StrategySpec(BaseModel):
    """`.athena.yaml v1` 최상위 계약.

    `data`/`costs`가 `None`이면 그 전략은 아직 키움 축이 채워지지 않은 것이다 —
    실행 전에 캔버스가 반드시 물어봐야 한다(엔진의 책임이지 이 모델의 책임은 아니다).
    """

    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1)
    metadata: Metadata
    data: DataSpec | None = None
    strategy: StrategyBlock
    risk: RiskSpec
    costs: CostsSpec | None = None


class _RelaxedConditionGroup(ConditionGroup):
    """조건 개수 규칙 하나만 푼 파생 — 코드 경로 전용이다(§6.2).

    코드 전략은 signals를 자기가 만든다. 그래서 폼의 진입/청산 조건은 애초에 읽히지
    않는데도 "최소 1개" 규칙에 걸려 실행이 거부됐다(2026-09-02 실측). 파생으로 두는
    이유는 기본 경로를 한 글자도 건드리지 않기 위해서다 — data/costs/risk/params/
    indicators는 위와 똑같은 클래스가 그대로 검증한다.
    """

    conditions: list[ConditionSpec] = Field(default_factory=list)


class _RelaxedStrategyBlock(StrategyBlock):
    entry: _RelaxedConditionGroup
    exit: _RelaxedConditionGroup


class _RelaxedStrategySpec(StrategySpec):
    strategy: _RelaxedStrategyBlock


def from_kis_yaml(text: str, *, require_conditions: bool = True) -> StrategySpec:
    """KIS 원본 `.kis.yaml`(또는 우리 `.athena.yaml`) 텍스트를 `StrategySpec`으로 읽는다.

    두 포맷이 같은 함수로 읽히는 이유: `.athena.yaml`은 `.kis.yaml`의 상위집합이고
    차이는 Optional 블록(`data`/`costs`) 유무뿐이다. KIS 원본이 그 블록을 안 주면
    `None`으로 남는다 — 여기서 기본값을 지어내지 않는다(§4.2, D3 규율과 같은 이유:
    사람이 검토 없이 값이 채워지는 경로를 만들지 않는다).

    `require_conditions=False`는 코드 경로가 부르는 완화판이다 — 진입/청산 조건이
    비어 있어도 읽는다. 그 외 블록은 기본 경로와 똑같이 검증한다.
    """
    payload = yaml.safe_load(text)
    if not isinstance(payload, dict):
        raise ValueError("전략 yaml 문서는 매핑(딕셔너리)이어야 한다")
    if require_conditions:
        return StrategySpec.model_validate(payload)
    return _RelaxedStrategySpec.model_validate(payload)


def resolve_params(
    spec: StrategySpec, overrides: dict[str, int | float] | None = None
) -> StrategySpec:
    """지표 `params` 안의 `"$name"` 참조를 실제 값으로 치환한 새 스펙을 돌려준다.

    치환표는 두 겹이다 — `overrides`가 최우선이고, 없으면 `strategy.params`의
    `default`를 쓴다. `strategy.params`에 없는 이름을 넘기거나 참조하면 오타이므로
    조용히 넘기지 않고 예외로 멈춘다 — 그리드 서치가 존재하지 않는 파라미터를
    돌리며 조용히 기본값만 쓰는 사고를 막는다.
    """
    known = spec.strategy.params
    values: dict[str, int | float] = {name: p.default for name, p in known.items()}
    if overrides:
        unknown_overrides = set(overrides) - set(known)
        if unknown_overrides:
            raise ValueError(f"알 수 없는 전략 파라미터: {sorted(unknown_overrides)}")
        values.update(overrides)

    def resolve_value(value: Any) -> Any:
        if isinstance(value, str) and value.startswith("$"):
            name = value[1:]
            if name not in values:
                raise ValueError(f"정의되지 않은 파라미터를 참조한다: {value}")
            return values[name]
        return value

    resolved_indicators = [
        indicator.model_copy(
            update={"params": {k: resolve_value(v) for k, v in indicator.params.items()}}
        )
        for indicator in spec.strategy.indicators
    ]
    resolved_strategy = spec.strategy.model_copy(update={"indicators": resolved_indicators})
    return spec.model_copy(update={"strategy": resolved_strategy})


__all__ = [
    "ConditionGroup",
    "ConditionSpec",
    "CostsSpec",
    "DataSpec",
    "IndicatorSpec",
    "Logic",
    "Metadata",
    "Operator",
    "ParamSpec",
    "PositionSpec",
    "RiskSpec",
    "RiskToggle",
    "StrategyBlock",
    "StrategySpec",
    "from_kis_yaml",
    "resolve_params",
]
