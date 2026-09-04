"""그래프 ↔ 스펙 왕복 — 프리셋 10종에서 **의미가 하나도 새지 않는지** 고정한다.

두 겹으로 본다. (1) 스펙 → 그래프 → 스펙이 정규화 후 같은 문서인가(구조 동등). (2) 그
그래프가 만든 신호가 폼 경로의 신호와 같은가(의미 동등). 구조만 보면 컴파일러가 조용히
다른 지표를 붙여도 통과할 수 있고, 신호만 보면 이름·범위가 바뀌어도 통과할 수 있다.

`normalize_spec`을 거치는 이유는 하나다 — 조건이 하나뿐인 묶음의 AND/OR는 결과가 같고
(rules.evaluate_group), 그래프는 그 자리를 묶음 노드 없이 그린다. 같은 의미의 두 표현을
하나로 모은 뒤 비교한다.
"""

from __future__ import annotations

import math

import pandas as pd
import pytest

from athena_api.backtest import presets
from athena_api.backtest import visual_schema as vs
from athena_api.backtest.compile import compile_signals
from athena_api.backtest.schema import from_kis_yaml


def _frame(n: int = 400) -> pd.DataFrame:
    """test_backtest_codegen.py와 같은 파형 — 240봉짜리 지표도 유효 구간이 남는다."""
    index = pd.date_range("2020-01-02", periods=n, freq="B")
    closes = [100 + 12 * math.sin(i / 9.0) + i * 0.05 for i in range(n)]
    return pd.DataFrame(
        {
            "open": [closes[0], *closes[:-1]],
            "high": [c + 1.5 for c in closes],
            "low": [c - 1.5 for c in closes],
            "close": closes,
            "volume": [1000.0 + (i % 17) * 13 for i in range(n)],
        },
        index=index,
    )


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_round_trip_keeps_the_same_normalized_spec(preset_id: str) -> None:
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    graph = vs.spec_to_graph(spec)
    assert not vs.has_errors(vs.validate_graph(graph))
    back = vs.compile_graph(graph)
    assert vs.normalize_spec(back).model_dump() == vs.normalize_spec(spec).model_dump()


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_round_trip_keeps_the_same_signals(preset_id: str) -> None:
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    back = vs.compile_graph(vs.spec_to_graph(spec))
    left = compile_signals(back, _frame())
    right = compile_signals(spec, _frame())
    for column in ("entry", "exit"):
        assert left[column].fillna(False).astype(bool).equals(
            right[column].fillna(False).astype(bool)
        ), f"{preset_id}: {column} 열이 폼 경로와 다르다"


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_graph_ids_are_deterministic(preset_id: str) -> None:
    """같은 스펙은 언제나 같은 그래프여야 patch의 base hash가 의미를 갖는다."""
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    assert vs.graph_hash(vs.spec_to_graph(spec)) == vs.graph_hash(vs.spec_to_graph(spec))


def test_params_stay_references_so_sliders_still_move() -> None:
    """`period` 포트가 연결돼 있으면 스펙은 숫자가 아니라 `$fast` 참조를 적어야 한다."""
    spec = from_kis_yaml(presets.preset_yaml("sma_crossover"))
    back = vs.compile_graph(vs.spec_to_graph(spec))
    assert back.strategy.indicators[0].params == {"period": "$fast"}
    assert back.strategy.params["fast"].default == 20


def test_unconnected_indicator_param_stays_a_literal() -> None:
    doc = vs.spec_to_graph(
        from_kis_yaml(presets.preset_yaml("sma_crossover"))
    ).model_dump(by_alias=True, mode="json")
    doc["edges"] = [
        e for e in doc["edges"] if e["to"] != {"node_id": "ind-ma_fast", "port": "period"}
    ]
    next(n for n in doc["nodes"] if n["id"] == "ind-ma_fast")["params"]["period"] = 9
    spec = vs.compile_graph(vs.VisualStrategyGraph.model_validate(doc))
    assert spec.strategy.indicators[0].params == {"period": 9}


def test_scenario_becomes_data_costs_and_risk() -> None:
    graph = vs.spec_to_graph(from_kis_yaml(presets.preset_yaml("sma_crossover")))
    graph.scenario.symbol = "005930"
    graph.scenario.from_ = "20240307"
    graph.scenario.to = "20260902"
    graph.scenario.period = "week"
    graph.scenario.adjusted = False
    spec = vs.compile_graph(graph)
    assert spec.data is not None
    assert spec.data.symbols == ["005930"]
    assert (spec.data.period, spec.data.adjusted) == ("week", False)
    assert (spec.data.from_, spec.data.to) == ("20240307", "20260902")
    assert spec.risk.stop_loss.percent == 8.0
    assert spec.costs is None


def test_multi_output_indicator_columns_match_the_form_path() -> None:
    """`별칭_출력명` 규칙(compile.py `_indicator_columns`)이 그래프에서도 같아야 한다."""
    spec = from_kis_yaml(presets.preset_yaml("trend_filter_signal"))
    back = vs.compile_graph(vs.spec_to_graph(spec))
    assert back.strategy.entry.conditions[0].indicator == "adx1_adx"
    assert back.strategy.entry.conditions[1].compare_to == "adx1_minus_di"
    assert back.strategy.entry.logic.value == "AND"


def test_spec_yaml_reloads_into_the_same_spec() -> None:
    spec = from_kis_yaml(presets.preset_yaml("false_breakout"))
    back = vs.compile_graph(vs.spec_to_graph(spec))
    reloaded = from_kis_yaml(vs.spec_to_yaml(back))
    assert reloaded.model_dump() == back.model_dump()


def test_layout_is_optional_and_never_changes_meaning() -> None:
    spec = from_kis_yaml(presets.preset_yaml("sma_crossover"))
    with_layout = vs.spec_to_graph(spec, layout=True)
    without = vs.spec_to_graph(spec, layout=False)
    assert all(node.ui is not None for node in with_layout.nodes)
    assert all(node.ui is None for node in without.nodes)
    assert vs.graph_hash(with_layout) == vs.graph_hash(without)
    assert vs.compile_graph(with_layout).model_dump() == vs.compile_graph(without).model_dump()


def test_more_than_four_conditions_is_refused_rather_than_truncated() -> None:
    yaml_text = """
version: "1.0"
metadata:
  name: 조건 다섯
strategy:
  id: too_many
  params:
    period: {default: 14, min: 2, max: 60, step: 1, type: int}
  indicators:
    - {id: RSI, alias: rsi, params: {period: "$period"}}
  entry:
    logic: AND
    conditions:
      - {indicator: rsi, operator: greater_than, compare_to: 10}
      - {indicator: rsi, operator: greater_than, compare_to: 20}
      - {indicator: rsi, operator: greater_than, compare_to: 30}
      - {indicator: rsi, operator: greater_than, compare_to: 40}
      - {indicator: rsi, operator: greater_than, compare_to: 50}
  exit:
    logic: AND
    conditions:
      - {indicator: rsi, operator: greater_than, compare_to: 70}
risk:
  stop_loss:   {enabled: false, percent: 0}
  take_profit: {enabled: false, percent: 0}
  position:    {sizing: all_in}
"""
    with pytest.raises(ValueError, match="4개까지"):
        vs.spec_to_graph(from_kis_yaml(yaml_text))
