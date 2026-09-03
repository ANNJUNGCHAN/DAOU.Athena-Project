"""source map — 노드 하나가 코드 어느 줄인지, 그리고 그 대응이 **거짓말이 아닌지** 고정한다.

세 가지를 지킨다.

1. **빠짐없다.** 그래프의 모든 노드가 map에 있다. 하나라도 빠지면 그 노드의 오류는 코드에서
   가리킬 곳이 없고, 화면은 "비슷한 줄"을 열고 싶어진다 — 그것이 평가 문서가 금지한 추정이다.
2. **가리키는 곳이 실재한다.** span은 텍스트로도 `ast`로도 같은 문장을 가리켜야 한다.
3. **미리보기는 실행 산출물이 아니다.** 검증 실패 그래프의 코드는 항상 `executable=false`이고
   빠진 값을 기본값이 아니라 `__MISSING__`으로 남긴다. 안전하게 만들 수 없으면 None이다.
"""

from __future__ import annotations

import ast
import copy
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from athena_api.backtest import codegen, presets
from athena_api.backtest import visual_schema as vs
from athena_api.backtest.compile import compile_signals
from athena_api.backtest.sandbox import api as bt_api
from athena_api.backtest.sandbox import guard
from athena_api.backtest.schema import StrategySpec, from_kis_yaml
from tests.unit.test_backtest_visual_compile import _frame


def _graph(preset_id: str = "sma_crossover") -> vs.VisualStrategyGraph:
    return vs.spec_to_graph(from_kis_yaml(presets.preset_yaml(preset_id)))


def _doc(preset_id: str = "sma_crossover") -> dict[str, Any]:
    return _graph(preset_id).model_dump(by_alias=True, mode="json")


def _model(doc: dict[str, Any]) -> vs.VisualStrategyGraph:
    return vs.VisualStrategyGraph.model_validate(doc)


def _run_generated(source: str, spec: StrategySpec, jobdir: Path) -> pd.DataFrame:
    """샌드박스 자식과 같은 배선 — `athena_bt` 별칭을 걸고 guard를 설치한 뒤 exec한다."""
    sys.modules["athena_bt"] = bt_api
    strategy_globals: dict[str, Any] = {"__name__": "__athena_strategy__"}
    guard.install(strategy_globals, jobdir)
    exec(compile(source, "strategy.py", "exec"), strategy_globals)  # noqa: S102
    params = {name: p.default for name, p in spec.strategy.params.items()}
    return strategy_globals["signals"](_frame(), params)


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_every_node_has_a_map_entry_and_a_marker(preset_id: str) -> None:
    graph = _graph(preset_id)
    artifact = codegen.generate_from_graph(graph)
    source_lines = artifact["source"].splitlines()
    entries = {e["node_id"]: e for e in artifact["source_map"]["entries"]}
    assert set(entries) == {node.id for node in graph.nodes}

    for node in graph.nodes:
        entry = entries[node.id]
        span = entry["source_span"]
        marker = source_lines[span["start"]["line"] - 2]
        assert marker.lstrip().startswith(f"# node: {node.id} ·"), node.id
        assert span["start"]["line"] <= span["end"]["line"]
        body = source_lines[span["start"]["line"] - 1]
        assert body[span["start"]["column"]] not in (" ", "#")


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_spans_agree_with_the_parser(preset_id: str) -> None:
    """텍스트로만 센 위치는 코드 모양이 바뀌면 조용히 어긋난다 — `ast`와 대조한다."""
    artifact = codegen.generate_from_graph(_graph(preset_id))
    tree = ast.parse(artifact["source"])
    positions = {
        (node.lineno, node.col_offset)
        for node in ast.walk(tree)
        if isinstance(node, (ast.stmt, ast.Constant))
    }
    for entry in artifact["source_map"]["entries"]:
        start = entry["source_span"]["start"]
        assert (start["line"], start["column"]) in positions, entry["node_id"]


def test_source_map_states_its_grade_in_one_field() -> None:
    """화면이 executable·preview_only 두 불리언을 조합해 추론하면 한쪽만 보고 오해한다."""
    graph = _graph()
    assert codegen.generate_from_graph(graph)["source_map"]["kind"] == "authoritative"
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    preview = _preview(doc)
    assert preview is not None
    assert preview["source_map"]["kind"] == "preview"


def test_roles_mark_entry_and_exit() -> None:
    entries = {
        e["node_id"]: e for e in codegen.generate_from_graph(_graph())["source_map"]["entries"]
    }
    assert entries["out-entry"]["role"] == "entry"
    assert entries["out-exit"]["role"] == "exit"
    assert entries["ind-ma_fast"]["role"] == "declaration"
    assert entries["cond-entry-1"]["role"] == "expression"
    assert entries["param-fast"]["ast_path"] == "PARAMS['fast']"


@pytest.mark.parametrize("preset_id", presets.list_presets())
def test_generated_code_runs_and_matches_the_form_path(preset_id: str, tmp_path: Path) -> None:
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    graph = vs.spec_to_graph(spec)
    generated = _run_generated(codegen.generate_from_graph(graph)["source"], spec, tmp_path)
    expected = compile_signals(spec, _frame())
    for column in ("entry", "exit"):
        assert generated[column].fillna(False).astype(bool).equals(
            expected[column].fillna(False).astype(bool)
        ), f"{preset_id}: {column} 열이 폼 경로와 다르다"


def test_generation_is_deterministic() -> None:
    graph = _graph()
    first = codegen.generate_from_graph(graph)
    second = codegen.generate_from_graph(graph)
    assert first["source"] == second["source"]
    assert first["hashes"] == second["hashes"]


def test_canvas_position_does_not_change_the_artifact() -> None:
    doc = _doc()
    before = codegen.generate_from_graph(_model(doc))
    for node in doc["nodes"]:
        node["ui"] = {"x": 12.0, "y": 34.0, "collapsed": True}
    after = codegen.generate_from_graph(_model(doc))
    assert before["source"] == after["source"]
    assert before["hashes"] == after["hashes"]


# ── 미리보기 ─────────────────────────────────────────────────────────────────


def _preview(doc: dict[str, Any]) -> dict[str, Any] | None:
    graph = _model(doc)
    return codegen.preview_from_graph(graph, vs.validate_graph(graph))


def _drop_edge_into(doc: dict[str, Any], node_id: str, port: str) -> None:
    doc["edges"] = [
        e for e in doc["edges"] if not (e["to"]["node_id"] == node_id and e["to"]["port"] == port)
    ]


def test_missing_input_becomes_a_sentinel_not_a_default() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    preview = _preview(doc)
    assert preview is not None
    assert codegen.MISSING in preview["source"]
    line = next(
        ln for ln in preview["source"].splitlines() if ln.strip().startswith("cond_entry_1 =")
    )
    assert codegen.MISSING in line
    assert "비교할 값이 없습니다" in line


def test_preview_is_never_executable() -> None:
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_slow", "source")
    preview = _preview(doc)
    assert preview is not None
    assert preview["executable"] is False
    assert preview["preview_only"] is True
    assert preview["source_map"]["executable"] is False
    assert preview["source_map"]["preview_only"] is True
    assert preview["compiler_version"] == vs.COMPILER_VERSION
    assert preview["graph_hash"] == vs.graph_hash(_model(doc))


def test_preview_is_deterministic_for_the_same_graph_bytes() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-exit-1", "left")
    first, second = _preview(doc), _preview(doc)
    assert first is not None and second is not None
    assert first["source"] == second["source"]
    assert first["preview_hash"] == second["preview_hash"]
    assert first["graph_revision"] == second["graph_revision"]


def test_preview_still_maps_every_remaining_node() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    preview = _preview(doc)
    assert preview is not None
    covered = {e["node_id"] for e in preview["source_map"]["entries"]}
    assert covered == {node["id"] for node in doc["nodes"]}


def test_preview_survives_a_missing_output_node() -> None:
    doc = _doc()
    doc["nodes"] = [n for n in doc["nodes"] if n["id"] != "out-entry"]
    doc["edges"] = [e for e in doc["edges"] if e["to"]["node_id"] != "out-entry"]
    preview = _preview(doc)
    assert preview is not None
    assert "entry = __MISSING__" in preview["source"]


@pytest.mark.parametrize("kind", ["duplicate-id", "unknown-kind", "cycle", "alias", "dup-output"])
def test_preview_is_none_when_no_safe_sentinel_exists(kind: str) -> None:
    """노드와 코드 줄이 1:1이 아닐 때는 코드를 지어내지 않는다 — exact 코드 이동이 꺼진다."""
    doc = _doc()
    if kind == "duplicate-id":
        doc["nodes"].append(copy.deepcopy(doc["nodes"][3]))
    elif kind == "unknown-kind":
        doc["nodes"][3]["kind"] = "indicator.nope"
    elif kind == "cycle":
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
    elif kind == "alias":
        next(n for n in doc["nodes"] if n["id"] == "ind-ma_slow")["params"]["alias"] = "ma_fast"
    else:
        doc["nodes"].append(
            {"id": "out-entry-2", "kind": "output.entry", "label": "진입", "params": {}}
        )
    assert _preview(doc) is None


def test_diagnostics_get_spans_only_when_a_map_exists() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    graph = _model(doc)
    diagnostics = vs.validate_graph(graph)
    preview = codegen.preview_from_graph(graph, diagnostics)
    assert preview is not None
    with_spans = codegen.attach_spans(diagnostics, preview["source_map"])
    port_diagnostic = next(d for d in with_spans if d.code == "BTG-PORT-002")
    assert port_diagnostic.source_span is not None
    assert port_diagnostic.source_span.file == "strategy_preview.py"
    scenario = next(d for d in with_spans if d.code == "BTG-DATA-001")
    assert scenario.source_span is None
    assert codegen.attach_spans(diagnostics, None) == diagnostics
