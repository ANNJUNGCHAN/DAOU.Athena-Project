"""`.athena.yaml v1` 스펙 계약 — KIS 호환, 연산자·논리 폐쇄형, `$name` 파라미터 치환."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from athena_api.backtest.schema import (
    Logic,
    Operator,
    StrategySpec,
    from_kis_yaml,
    resolve_params,
)

# 결정층(leaf 9): 순수 파싱·검증 로직이다. LLM도 난수도 없다.
pytestmark = pytest.mark.deterministic

ATHENA_YAML = """
version: "1.0"
metadata:
  name: 20-60 골든크로스
  description: 단기 이평이 장기 이평을 상향 돌파할 때 진입
  tags: [trend, ma]

data:
  symbols: ["005930"]
  period: day
  adjusted: true
  from: "20200101"
  to: "20260831"

strategy:
  id: sma_crossover
  category: trend
  params:
    fast: {default: 20, min: 5, max: 60, step: 1, type: int}
    slow: {default: 60, min: 20, max: 240, step: 1, type: int}
  indicators:
    - {id: SMA, alias: ma_fast, params: {period: "$fast", source: close}}
    - {id: SMA, alias: ma_slow, params: {period: "$slow", source: close}}
  entry:
    logic: AND
    conditions:
      - {indicator: ma_fast, operator: cross_above, compare_to: ma_slow}
  exit:
    logic: OR
    conditions:
      - {indicator: ma_fast, operator: cross_below, compare_to: ma_slow}

risk:
  stop_loss:   {enabled: true,  percent: 8}
  take_profit: {enabled: false, percent: 20}
  position:    {sizing: all_in}

costs:
  fee_bps: 1.5
  tax_bps: 18.0
  slippage_bps: 5.0
"""

# KIS 원본 — data:/costs: 블록이 아예 없다(§4.2).
KIS_YAML = """
version: "1.0"
metadata:
  name: RSI 과매도 반등
strategy:
  id: rsi_oversold
  params:
    period: {default: 14, min: 5, max: 30, step: 1, type: int}
    threshold: {default: 30, min: 10, max: 40, step: 1, type: int}
  indicators:
    - {id: RSI, alias: rsi, params: {period: "$period", source: close}}
  entry:
    logic: AND
    conditions:
      - {indicator: rsi, operator: less_than, compare_to: 30}
  exit:
    logic: AND
    conditions:
      - {indicator: rsi, operator: greater_than, compare_to: 70}
risk:
  stop_loss:   {enabled: true, percent: 5}
  take_profit: {enabled: true, percent: 10}
  position:    {sizing: all_in}
"""


# ── 파싱 ────────────────────────────────────────────────────────────────────


def test_parses_full_athena_yaml_with_data_and_costs() -> None:
    spec = from_kis_yaml(ATHENA_YAML)
    assert spec.metadata.name == "20-60 골든크로스"
    assert spec.data is not None
    assert spec.data.symbols == ["005930"]
    assert spec.data.from_ == "20200101"
    assert spec.costs is not None
    assert spec.costs.tax_bps == 18.0


def test_from_kis_yaml_allows_missing_data_and_costs() -> None:
    """KIS 원본을 그대로 떨어뜨려도 로드된다 — 없는 필드는 기본값을 지어내지 않고 None."""
    spec = from_kis_yaml(KIS_YAML)
    assert spec.data is None
    assert spec.costs is None
    assert spec.strategy.id == "rsi_oversold"
    assert spec.risk.stop_loss.percent == 5


def test_from_kis_yaml_rejects_non_mapping_document() -> None:
    with pytest.raises(ValueError):
        from_kis_yaml("- just\n- a\n- list\n")


def test_extra_fields_are_rejected() -> None:
    """`ConfigDict(extra='forbid')` — 이 저장소의 기존 Pydantic 모델과 같은 규율."""
    condition = {"indicator": "a", "operator": "equals", "compare_to": 1}
    with pytest.raises(ValidationError):
        StrategySpec.model_validate(
            {
                "version": "1.0",
                "metadata": {"name": "x"},
                "strategy": {
                    "id": "s",
                    "params": {},
                    "indicators": [],
                    "entry": {"logic": "AND", "conditions": [condition]},
                    "exit": {"logic": "AND", "conditions": [condition]},
                },
                "risk": {
                    "stop_loss": {"enabled": False, "percent": 0},
                    "take_profit": {"enabled": False, "percent": 0},
                    "position": {"sizing": "all_in"},
                },
                "unexpected_field": "boom",
            }
        )


def test_condition_group_requires_at_least_one_condition() -> None:
    entry_condition_line = "      - {indicator: rsi, operator: less_than, compare_to: 30}\n"
    with pytest.raises(ValidationError):
        from_kis_yaml(KIS_YAML.replace(entry_condition_line, ""))


def test_operator_covers_exactly_seven_kinds() -> None:
    assert {op.value for op in Operator} == {
        "cross_above",
        "cross_below",
        "greater_than",
        "less_than",
        "greater_equal",
        "less_equal",
        "equals",
    }


def test_logic_covers_and_or() -> None:
    assert {v.value for v in Logic} == {"AND", "OR"}


def test_condition_accepts_indicator_alias_or_numeric_literal() -> None:
    """`compare_to`는 다른 지표 alias(문자열)이거나 상수(숫자) 둘 다 받는다."""
    spec = from_kis_yaml(KIS_YAML)
    assert spec.strategy.entry.conditions[0].compare_to == 30
    spec2 = from_kis_yaml(ATHENA_YAML)
    assert spec2.strategy.entry.conditions[0].compare_to == "ma_slow"


# ── 파라미터 치환 ────────────────────────────────────────────────────────────


def test_resolve_params_substitutes_dollar_refs_with_defaults() -> None:
    spec = from_kis_yaml(ATHENA_YAML)
    resolved = resolve_params(spec)
    params_by_alias = {i.alias: i.params for i in resolved.strategy.indicators}
    assert params_by_alias["ma_fast"]["period"] == 20
    assert params_by_alias["ma_slow"]["period"] == 60
    # source처럼 "$"로 시작하지 않는 값은 그대로 남는다.
    assert params_by_alias["ma_fast"]["source"] == "close"


def test_resolve_params_overrides_take_precedence_over_defaults() -> None:
    spec = from_kis_yaml(ATHENA_YAML)
    resolved = resolve_params(spec, {"fast": 5, "slow": 120})
    params_by_alias = {i.alias: i.params for i in resolved.strategy.indicators}
    assert params_by_alias["ma_fast"]["period"] == 5
    assert params_by_alias["ma_slow"]["period"] == 120


def test_resolve_params_does_not_mutate_the_original_spec() -> None:
    spec = from_kis_yaml(ATHENA_YAML)
    resolve_params(spec, {"fast": 5})
    still_referenced = {i.alias: i.params for i in spec.strategy.indicators}
    assert still_referenced["ma_fast"]["period"] == "$fast"


def test_resolve_params_rejects_unknown_override() -> None:
    spec = from_kis_yaml(ATHENA_YAML)
    with pytest.raises(ValueError):
        resolve_params(spec, {"nonexistent": 1})


def test_resolve_params_rejects_unknown_dollar_reference() -> None:
    spec = from_kis_yaml(ATHENA_YAML)
    tampered = spec.model_copy(deep=True)
    tampered.strategy.indicators[0].params["period"] = "$typo"
    with pytest.raises(ValueError):
        resolve_params(tampered)


def test_param_spec_preserves_int_type_for_int_params() -> None:
    spec = from_kis_yaml(ATHENA_YAML)
    fast = spec.strategy.params["fast"]
    assert fast.default == 20
    assert isinstance(fast.default, int)
