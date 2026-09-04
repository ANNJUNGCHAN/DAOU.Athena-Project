"""visual_repair.py — 질문은 하나, 패치는 allowlist, 적용은 사람.

이 파일이 고정하는 규율은 세 줄이다.

1. 오류가 셋이어도 화면에는 질문이 하나만 간다(`remaining`으로 남은 개수만 알린다).
2. 서버는 여섯 연산 밖의 편집을 만들지 않는다 — 모델이 무엇을 보내든 patch가 되지 않는다.
3. patch를 만들었다는 사실만으로 그래프는 바뀌지 않는다. base hash가 어긋나면 아예 거절한다.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from athena_api.backtest import presets
from athena_api.backtest import visual_repair as repair
from athena_api.backtest import visual_schema as vs
from athena_api.backtest.schema import from_kis_yaml


def _doc(preset_id: str = "sma_crossover") -> dict[str, Any]:
    spec = from_kis_yaml(presets.preset_yaml(preset_id))
    return vs.spec_to_graph(spec).model_dump(by_alias=True, mode="json")


def _model(doc: dict[str, Any]) -> vs.VisualStrategyGraph:
    return vs.VisualStrategyGraph.model_validate(doc)


def _drop_edge_into(doc: dict[str, Any], node_id: str, port: str) -> None:
    doc["edges"] = [
        e for e in doc["edges"] if not (e["to"]["node_id"] == node_id and e["to"]["port"] == port)
    ]


def test_no_question_when_nothing_blocks() -> None:
    """종목이 비어 있다는 경고는 진행을 막지 않는다 — 그것으로 대화를 시작하지 않는다."""
    assert repair.questions_for(_model(_doc())) is None


def test_only_one_question_even_with_several_errors() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    _drop_edge_into(doc, "ind-ma_slow", "source")
    _drop_edge_into(doc, "out-exit", "signal")
    graph = _model(doc)
    result = repair.questions_for(graph)
    assert result is not None
    question = result["question"]
    assert set(question) >= {"code", "question_ko", "choices", "remaining"}
    assert question["remaining"] == 2
    assert question["node_id"] is not None
    assert len([d for d in vs.validate_graph(graph) if d.severity == "error"]) == 3


def test_choices_carry_ids_labels_and_the_changes_they_make() -> None:
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_slow", "source")
    result = repair.questions_for(_model(doc))
    assert result is not None
    choices = result["question"]["choices"]
    assert choices and sum(1 for c in choices if c["recommended"]) == 1
    for choice in choices:
        assert set(choice) == {"id", "label_ko", "recommended", "changes"}
        assert choice["changes"]
        for change in choice["changes"]:
            assert change["target"] in ("node", "edge")
            assert change["id"] and change["what_ko"]


def test_recommended_choice_resolves_the_error() -> None:
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_slow", "source")
    graph = _model(doc)
    result = repair.questions_for(graph)
    assert result is not None
    question = result["question"]
    choice = next(c for c in question["choices"] if c["recommended"])
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {"code": question["code"], "choice_id": choice["id"]},
    )
    assert patch["graph_compatible"] is True
    assert [d["code"] for d in patch["diagnostics_after"]] == ["BTG-DATA-001"]
    assert patch["applied"] is False


def test_patch_is_json_patch_and_reproduces_graph_after() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    graph = _model(doc)
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {
            "ops": [
                {
                    "kind": "connect_port",
                    "from": {"node_id": "ind-ma_slow", "port": "value"},
                    "to": {"node_id": "cond-entry-1", "port": "right"},
                }
            ]
        },
    )
    assert patch["graph_patch"] == [
        {
            "op": "add",
            "path": "/edges/-",
            "value": {
                "id": "e-ind-ma_slow.value-cond-entry-1.right",
                "from": {"node_id": "ind-ma_slow", "port": "value"},
                "to": {"node_id": "cond-entry-1", "port": "right"},
            },
        }
    ]
    after = _model(patch["graph_after"])
    assert vs.graph_hash(after) == patch["graph_after_hash"]
    # 원래 프리셋과 같은 전략으로 돌아온다 — 패치가 그래프를 다른 곳에 데려다 놓지 않는다.
    # (그래프 hash까지 같지는 않다: 다시 이은 엣지는 목록 끝에 붙으므로 순서가 다르다.)
    assert (
        vs.normalize_spec(vs.compile_graph(after)).model_dump()
        == vs.normalize_spec(from_kis_yaml(presets.preset_yaml("sma_crossover"))).model_dump()
    )


def test_patch_does_not_touch_the_graph_it_was_given() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    graph = _model(doc)
    before = vs.graph_hash(graph)
    repair.build_patch(
        graph,
        before,
        {
            "ops": [
                {"kind": "set_param", "node_id": "cond-entry-1", "param": "compare_to",
                 "value": 0}
            ]
        },
    )
    assert vs.graph_hash(graph) == before


def test_patch_hash_is_deterministic() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    graph = _model(doc)
    ops = {
        "ops": [
            {"kind": "set_param", "node_id": "cond-entry-1", "param": "compare_to",
             "value": 0}
        ]
    }
    first = repair.build_patch(graph, vs.graph_hash(graph), copy.deepcopy(ops))
    second = repair.build_patch(graph, vs.graph_hash(graph), copy.deepcopy(ops))
    assert first["patch_hash"] == second["patch_hash"]
    assert first["patch_id"] == f"patch-{first['patch_hash'][:12]}"


def test_removing_a_node_removes_its_edges_in_the_same_patch() -> None:
    graph = _model(_doc())
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {"ops": [{"kind": "remove_node", "node_id": "ind-ma_slow"}]},
    )
    ops = patch["graph_patch"]
    assert all(op["op"] in ("add", "remove", "replace") for op in ops)
    assert ops[-1]["path"].startswith("/nodes/")
    after = _model(patch["graph_after"])
    assert all(node.id != "ind-ma_slow" for node in after.nodes)
    assert all(
        "ind-ma_slow" not in (e.from_.node_id, e.to.node_id) for e in after.edges
    )
    assert patch["graph_compatible"] is False


def test_connecting_an_already_used_port_replaces_the_old_edge() -> None:
    graph = _model(_doc())
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {
            "ops": [
                {
                    "kind": "connect_port",
                    "from": {"node_id": "data-ohlcv", "port": "close"},
                    "to": {"node_id": "cond-entry-1", "port": "right"},
                }
            ]
        },
    )
    assert [op["op"] for op in patch["graph_patch"]] == ["remove", "add"]
    after = _model(patch["graph_after"])
    into_right = [e for e in after.edges if (e.to.node_id, e.to.port) == ("cond-entry-1", "right")]
    assert len(into_right) == 1


def test_diff_shapes_are_what_the_canvas_draws() -> None:
    doc = _doc()
    _drop_edge_into(doc, "cond-entry-1", "right")
    graph = _model(doc)
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {
            "ops": [
                {"kind": "set_param", "node_id": "cond-entry-1", "param": "compare_to",
                 "value": 0}
            ]
        },
    )
    code_diff = patch["code_diff"]
    assert set(code_diff) == {"removed", "added", "diff_lines"}
    assert code_diff["added"] >= 1 and code_diff["removed"] >= 1
    assert all(line["mark"] in (" ", "+", "-") for line in code_diff["diff_lines"])
    assert any("__MISSING__" in line["text"] for line in code_diff["diff_lines"])
    # base 그래프가 컴파일되지 않으므로 diff는 "차이"가 아니라 처음 생기는 스펙이다.
    assert patch["spec_diff_basis"] == "first_compile"
    assert all(set(row) == {"path", "before", "after"} for row in patch["spec_diff"])


def test_spec_diff_of_two_valid_graphs_is_a_delta() -> None:
    graph = _model(_doc())
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {"ops": [{"kind": "set_param", "node_id": "param-fast", "param": "default", "value": 25}]},
    )
    assert patch["spec_diff_basis"] == "delta"
    assert patch["spec_diff"] == [
        {"path": "$.strategy.params.fast.default", "before": 20, "after": 25}
    ]


def test_stale_base_hash_is_refused() -> None:
    graph = _model(_doc())
    with pytest.raises(repair.StaleBaseHashError):
        repair.build_patch(
            graph,
            "0" * 64,
            {"ops": [{"kind": "remove_node", "node_id": "ind-ma_slow"}]},
        )


@pytest.mark.parametrize(
    "ops",
    [
        [{"kind": "exec", "source": "import os"}],
        [{"kind": "set_scenario", "symbol": "005930"}],
        [],
    ],
)
def test_operations_outside_the_allowlist_are_refused(ops: list[dict[str, Any]]) -> None:
    graph = _model(_doc())
    with pytest.raises(repair.VisualPatchError):
        repair.build_patch(graph, vs.graph_hash(graph), {"ops": ops})


def test_editing_a_node_that_is_not_there_is_refused() -> None:
    graph = _model(_doc())
    with pytest.raises(repair.VisualPatchError, match="없는 노드"):
        repair.build_patch(
            graph,
            vs.graph_hash(graph),
            {"ops": [{"kind": "set_param", "node_id": "ghost", "param": "alias", "value": "x"}]},
        )


def test_unknown_choice_is_refused() -> None:
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_slow", "source")
    graph = _model(doc)
    with pytest.raises(repair.VisualPatchError, match="선택지"):
        repair.build_patch(
            graph, vs.graph_hash(graph), {"code": "BTG-PORT-002", "choice_id": "nope"}
        )


def test_answering_a_code_that_is_no_longer_broken_is_refused() -> None:
    graph = _model(_doc())
    with pytest.raises(repair.VisualPatchError, match="오류가 없습니다"):
        repair.build_patch(
            graph, vs.graph_hash(graph), {"code": "BTG-PORT-002", "choice_id": "whatever"}
        )


def test_missing_output_question_offers_to_add_the_node() -> None:
    doc = _doc()
    doc["nodes"] = [n for n in doc["nodes"] if n["id"] != "out-entry"]
    doc["edges"] = [e for e in doc["edges"] if e["to"]["node_id"] != "out-entry"]
    graph = _model(doc)
    result = repair.questions_for(graph)
    assert result is not None
    question = result["question"]
    assert question["code"] == "BTG-OUT-001"
    choice = next(c for c in question["choices"] if c["recommended"])
    patch = repair.build_patch(
        graph, vs.graph_hash(graph), {"code": "BTG-OUT-001", "choice_id": choice["id"]}
    )
    after = _model(patch["graph_after"])
    assert any(node.kind == "output.entry" for node in after.nodes)
    assert patch["graph_compatible"] is True


def test_patch_carries_a_one_line_korean_summary_with_labels() -> None:
    """채팅 카드의 제목 — 노드 id가 아니라 사용자가 캔버스에서 본 이름으로 읽혀야 한다."""
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_slow", "source")
    graph = _model(doc)
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {
            "ops": [
                {
                    "kind": "connect_port",
                    "from": {"node_id": "data-ohlcv", "port": "close"},
                    "to": {"node_id": "ind-ma_slow", "port": "source"},
                }
            ]
        },
    )
    assert patch["summary_ko"] == "ma_slow.source ← 캔들.close · 오류 1개 해결"


def test_summary_says_how_many_errors_are_left_when_one_patch_is_not_enough() -> None:
    doc = _doc()
    _drop_edge_into(doc, "ind-ma_slow", "source")
    _drop_edge_into(doc, "out-exit", "signal")
    graph = _model(doc)
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {"ops": [{"kind": "set_param", "node_id": "param-fast", "param": "default", "value": 25}]},
    )
    assert patch["summary_ko"] == "fast.default = 25 · 오류 2개 남음"


def test_base_artifact_hash_exists_only_when_the_base_graph_compiles() -> None:
    """적용 receipt는 base 코드까지 가리켜야 한다 — 없는 코드의 해시를 지어내지는 않는다."""
    graph = _model(_doc())
    patch = repair.build_patch(
        graph,
        vs.graph_hash(graph),
        {"ops": [{"kind": "set_param", "node_id": "param-fast", "param": "default", "value": 25}]},
    )
    from athena_api.backtest import codegen

    assert patch["base_artifact_hash"] == (
        codegen.generate_from_graph(graph)["hashes"]["artifact_hash"]
    )
    assert patch["next_version"] is None

    broken = _doc()
    _drop_edge_into(broken, "ind-ma_slow", "source")
    broken_graph = _model(broken)
    broken_patch = repair.build_patch(
        broken_graph,
        vs.graph_hash(broken_graph),
        {"ops": [{"kind": "set_param", "node_id": "param-fast", "param": "default", "value": 25}]},
    )
    assert broken_patch["base_artifact_hash"] is None
