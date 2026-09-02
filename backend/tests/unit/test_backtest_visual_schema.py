"""visual_schema.py — 진단 코드 13종이 각각 **어느 노드·어느 포트**를 가리키는지 고정한다.

이 파일이 지키는 것은 "오류를 낸다"가 아니라 **"오류를 가리킨다"**이다. 코드(`BTG-…`)는
번역과 무관하게 고정이고, node_id·port·json_path가 같은 원인을 가리켜야 화면의 네 자리
(노드·포트·검사기·코드)가 같은 것을 강조할 수 있다. 하나라도 None으로 새면 사용자는
"어딘가 잘못됐습니다"만 보게 된다.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from athena_api.backtest import presets
from athena_api.backtest import visual_schema as vs
from athena_api.backtest.schema import from_kis_yaml


def _doc(preset_id: str = "sma_crossover") -> dict[str, Any]:
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    return vs.spec_to_graph(spec).model_dump(by_alias=True, mode="json")


def _validate(doc: dict[str, Any]) -> list[vs.Diagnostic]:
    return vs.validate_graph(vs.VisualStrategyGraph.model_validate(doc))


def _codes(diagnostics: list[vs.Diagnostic]) -> list[str]:
    return [d.code for d in diagnostics]


def _first(diagnostics: list[vs.Diagnostic], code: str) -> vs.Diagnostic:
    hit = next((d for d in diagnostics if d.code == code), None)
    assert hit is not None, f"{code}이(가) 진단에 없다: {_codes(diagnostics)}"
    return hit


def _drop_edge_into(doc: dict[str, Any], node_id: str, port: str) -> None:
    doc["edges"] = [
        e for e in doc["edges"] if not (e["to"]["node_id"] == node_id and e["to"]["port"] == port)
    ]


def _drop_node(doc: dict[str, Any], node_id: str) -> None:
    doc["nodes"] = [n for n in doc["nodes"] if n["id"] != node_id]
    doc["edges"] = [
        e
        for e in doc["edges"]
        if node_id not in (e["from"]["node_id"], e["to"]["node_id"])
    ]


def test_a_preset_graph_is_valid_but_says_the_scenario_is_empty() -> None:
    """프리셋은 종목·기간을 모르는 순수 전략이다 — 그것은 오류가 아니라 경고여야 한다."""
    diagnostics = _validate(_doc())
    assert not vs.has_errors(diagnostics)
    scenario = _first(diagnostics, "BTG-DATA-001")
    assert scenario.severity == "warning"
    assert scenario.node_id is None and scenario.json_path == "$.scenario"


def test_scenario_warning_disappears_when_symbol_and_range_are_filled() -> None:
    doc = _doc()
    doc["scenario"].update({"symbol": "005930", "from": "20240307", "to": "20260902"})
    assert _validate(doc) == []


def test_duplicate_node_id_is_attributed_to_that_id() -> None:
    doc = _doc()
    doc["nodes"].append(copy.deepcopy(doc["nodes"][3]))
    diagnostic = _first(_validate(doc), "BTG-ID-001")
    assert diagnostic.node_id == "ind-ma_fast"
    assert diagnostic.json_path.endswith(".id")


def test_duplicate_edge_id_is_reported_too() -> None:
    doc = _doc()
    doc["edges"].append(copy.deepcopy(doc["edges"][0]))
    assert "BTG-ID-001" in _codes(_validate(doc))


def test_unknown_kind_names_the_node() -> None:
    doc = _doc()
    doc["nodes"][3]["kind"] = "indicator.nope"
    diagnostic = _first(_validate(doc), "BTG-KIND-001")
    assert diagnostic.node_id == "ind-ma_fast"
    assert "indicator.nope" in diagnostic.message_ko


def test_indicator_kind_is_case_insensitive() -> None:
    """레지스트리 id가 대문자라 렌더러가 `indicator.SMA`로 보낼 수 있다 — 그 한 글자로
    그래프 전체를 거절하지 않는다."""
    doc = _doc()
    doc["nodes"][3]["kind"] = "indicator.SMA"
    assert not vs.has_errors(_validate(doc))


@pytest.mark.parametrize(
    ("node_id", "param", "value"),
    [
        ("ind-ma_fast", "alias", ""),
        ("ind-ma_fast", "period", "스무개"),
        ("ind-ma_fast", "없는설정", 1),
        ("param-fast", "name", 3),
        ("param-fast", "min", None),
        ("param-fast", "type", "decimal"),
        ("cond-entry-1", "compare_to", "열"),
    ],
)
def test_bad_params_are_attributed_to_the_node(node_id: str, param: str, value: Any) -> None:
    doc = _doc()
    node = next(n for n in doc["nodes"] if n["id"] == node_id)
    node["params"][param] = value
    diagnostic = _first(_validate(doc), "BTG-PARAM-001")
    assert diagnostic.node_id == node_id
    assert diagnostic.json_path.startswith(f"$.nodes[{doc['nodes'].index(node)}].params")


def test_dangling_edge_points_at_the_missing_node() -> None:
    doc = _doc()
    doc["edges"][0]["from"]["node_id"] = "ghost-node"
    diagnostic = _first(_validate(doc), "BTG-EDGE-001")
    assert "ghost-node" in diagnostic.message_ko
    assert diagnostic.json_path.startswith("$.edges[")


def test_two_edges_into_one_input_is_refused() -> None:
    doc = _doc()
    doc["edges"].append(
        {
            "id": "e-extra",
            "from": {"node_id": "data-ohlcv", "port": "open"},
            "to": {"node_id": "cond-entry-1", "port": "left"},
        }
    )
    diagnostic = _first(_validate(doc), "BTG-EDGE-001")
    assert (diagnostic.node_id, diagnostic.port) == ("cond-entry-1", "left")


def test_unknown_port_names_the_port() -> None:
    doc = _doc()
    edge = next(e for e in doc["edges"] if e["from"]["node_id"] == "data-ohlcv")
    edge["from"]["port"] = "nope"
    diagnostic = _first(_validate(doc), "BTG-PORT-001")
    assert (diagnostic.node_id, diagnostic.port) == ("data-ohlcv", "nope")


def test_missing_required_input_names_node_and_port_and_offers_a_fix() -> None:
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_slow", "source")
    diagnostic = _first(_validate(doc), "BTG-PORT-002")
    assert (diagnostic.node_id, diagnostic.port) == ("ind-ma_slow", "source")
    assert diagnostic.json_path == "$.nodes[4].inputs.source"
    assert diagnostic.suggested_fix == {
        "kind": "connect_port",
        "from": {"node_id": "data-ohlcv", "port": "close"},
        "to": {"node_id": "ind-ma_slow", "port": "source"},
    }


def test_condition_without_right_side_or_compare_to_is_missing_input() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    diagnostic = _first(_validate(doc), "BTG-PORT-002")
    assert (diagnostic.node_id, diagnostic.port) == ("cond-entry-1", "right")


def test_indicator_source_must_come_from_the_candles() -> None:
    """지표는 언제나 df에서 읽는다 — 다른 지표의 출력을 이으면 화면과 실행이 갈라진다."""
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_fast", "source")
    doc["edges"].append(
        {
            "id": "e-chain",
            "from": {"node_id": "ind-ma_slow", "port": "value"},
            "to": {"node_id": "ind-ma_fast", "port": "source"},
        }
    )
    diagnostic = _first(_validate(doc), "BTG-TYPE-001")
    assert (diagnostic.node_id, diagnostic.port) == ("ind-ma_fast", "source")


def test_param_cannot_be_wired_into_a_condition() -> None:
    """`compare_to`는 `$name` 참조를 못 받는다 — 통과시키면 슬라이더가 조건에 안 먹는다."""
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    doc["edges"].append(
        {
            "id": "e-param-cond",
            "from": {"node_id": "param-fast", "port": "value"},
            "to": {"node_id": "cond-entry-1", "port": "right"},
        }
    )
    diagnostic = _first(_validate(doc), "BTG-TYPE-001")
    assert (diagnostic.node_id, diagnostic.port) == ("cond-entry-1", "right")
    assert "조절값" in diagnostic.message_ko


def test_wrong_port_type_is_refused() -> None:
    doc = _doc()
    _drop_edge_into(doc, "out-entry", "signal")
    doc["edges"].append(
        {
            "id": "e-number-into-signal",
            "from": {"node_id": "ind-ma_fast", "port": "value"},
            "to": {"node_id": "out-entry", "port": "signal"},
        }
    )
    diagnostic = _first(_validate(doc), "BTG-TYPE-001")
    assert (diagnostic.node_id, diagnostic.port) == ("out-entry", "signal")
    assert "Series<Bool>" in diagnostic.message_ko


def test_cycle_is_reported_on_a_node_in_the_loop() -> None:
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_fast", "source")
    _drop_edge_into(doc, "ind-ma_slow", "source")
    doc["edges"] += [
        {
            "id": "e-a",
            "from": {"node_id": "ind-ma_slow", "port": "value"},
            "to": {"node_id": "ind-ma_fast", "port": "source"},
        },
        {
            "id": "e-b",
            "from": {"node_id": "ind-ma_fast", "port": "value"},
            "to": {"node_id": "ind-ma_slow", "port": "source"},
        },
    ]
    diagnostic = _first(_validate(doc), "BTG-CYCLE-001")
    assert diagnostic.node_id in ("ind-ma_fast", "ind-ma_slow")


def test_missing_entry_and_exit_outputs() -> None:
    doc = _doc()
    _drop_node(doc, "out-entry")
    assert "BTG-OUT-001" in _codes(_validate(doc))
    doc2 = _doc()
    _drop_node(doc2, "out-exit")
    assert "BTG-OUT-002" in _codes(_validate(doc2))


def test_duplicate_output_names_the_second_node() -> None:
    doc = _doc()
    doc["nodes"].append(
        {"id": "out-entry-2", "kind": "output.entry", "label": "진입", "params": {}}
    )
    doc["edges"].append(
        {
            "id": "e-dup-out",
            "from": {"node_id": "cond-entry-1", "port": "signal"},
            "to": {"node_id": "out-entry-2", "port": "signal"},
        }
    )
    diagnostic = _first(_validate(doc), "BTG-OUT-003")
    assert diagnostic.node_id == "out-entry-2"


def test_alias_conflict_is_reported() -> None:
    doc = _doc()
    next(n for n in doc["nodes"] if n["id"] == "ind-ma_slow")["params"]["alias"] = "ma_fast"
    diagnostic = _first(_validate(doc), "BTG-ALIAS-001")
    assert diagnostic.node_id == "ind-ma_slow"


def test_alias_cannot_shadow_a_raw_candle_column() -> None:
    doc = _doc()
    next(n for n in doc["nodes"] if n["id"] == "ind-ma_fast")["params"]["alias"] = "close"
    assert "BTG-ALIAS-001" in _codes(_validate(doc))


def test_nested_logic_is_not_expressible_in_v1() -> None:
    doc = _doc("trend_filter_signal")
    doc["nodes"].append(
        {"id": "logic-extra", "kind": "logic.or", "label": "또 다른 묶음", "params": {}}
    )
    doc["edges"] += [
        {
            "id": "e-x1",
            "from": {"node_id": "cond-entry-1", "port": "signal"},
            "to": {"node_id": "logic-extra", "port": "in1"},
        },
        {
            "id": "e-x2",
            "from": {"node_id": "cond-entry-2", "port": "signal"},
            "to": {"node_id": "logic-extra", "port": "in2"},
        },
        {
            "id": "e-x3",
            "from": {"node_id": "logic-extra", "port": "signal"},
            "to": {"node_id": "logic-entry", "port": "in3"},
        },
    ]
    diagnostic = _first(_validate(doc), "BTG-LOGIC-001")
    assert (diagnostic.node_id, diagnostic.port) == ("logic-entry", "in3")


def test_logic_needs_at_least_two_conditions() -> None:
    doc = _doc("trend_filter_signal")
    _drop_edge_into(doc, "logic-entry", "in2")
    diagnostic = _first(_validate(doc), "BTG-PORT-002")
    assert (diagnostic.node_id, diagnostic.port) == ("logic-entry", "in2")


def test_candle_node_must_exist_exactly_once() -> None:
    doc = _doc()
    _drop_node(doc, "data-ohlcv")
    missing = _first(_validate(doc), "BTG-DATA-001")
    assert missing.severity == "error"

    doc2 = _doc()
    doc2["nodes"].append({"id": "data-2", "kind": "data.ohlcv", "label": "캔들", "params": {}})
    extra = [d for d in _validate(doc2) if d.code == "BTG-DATA-001" and d.severity == "error"]
    assert [d.node_id for d in extra] == ["data-2"]


def test_compile_refuses_an_invalid_graph_and_carries_the_reason() -> None:
    doc = _doc()
    _drop_edge_into(doc, "out-exit", "signal")
    with pytest.raises(vs.VisualGraphError) as excinfo:
        vs.compile_graph(vs.VisualStrategyGraph.model_validate(doc))
    assert [d.code for d in excinfo.value.diagnostics] == ["BTG-PORT-002"]


def test_graph_hash_ignores_canvas_position() -> None:
    doc = _doc()
    before = vs.graph_hash(vs.VisualStrategyGraph.model_validate(doc))
    for node in doc["nodes"]:
        node["ui"] = {"x": 999.0, "y": -12.0, "collapsed": True}
    after = vs.graph_hash(vs.VisualStrategyGraph.model_validate(doc))
    assert before == after


def test_graph_hash_changes_when_a_param_changes() -> None:
    doc = _doc()
    before = vs.graph_hash(vs.VisualStrategyGraph.model_validate(doc))
    next(n for n in doc["nodes"] if n["id"] == "param-fast")["params"]["default"] = 21
    assert vs.graph_hash(vs.VisualStrategyGraph.model_validate(doc)) != before
