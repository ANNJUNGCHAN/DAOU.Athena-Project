"""대화형 수리 — 질문 하나와 **적용하지 않는** 패치 초안(평가 문서 §대화형 오류 수정 계약).

**왜 한 번에 하나만 묻나.** 초심자에게 결정 세 개를 한 화면에 주면 답을 고르는 것이 아니라
화면을 닫는다. 지금 진행을 막는 첫 오류 하나만 묻고, 남은 개수(`remaining`)만 알려준다.

**왜 서버가 패치를 만드나.** 모델이 그래프 JSON을 직접 쓰면 registry 밖 노드·표현 불가
연결이 그대로 저장된다. 모델은 "무엇을 고치고 싶다"(intent)까지만 만들고, 실제 편집은
allowlist 연산 6종(connect_port·disconnect_port·set_param·add_node·remove_node·
replace_node)으로만 서버가 만든다.

**왜 적용은 여기서 하지 않나.** diagnose.py가 새 소스를 계산만 하고 저장하지 않는 것과 같은
규율이다(§7.3). 이 모듈은 patch·diff·적용 후 진단까지 계산해서 보여줄 뿐, 화면의 그래프도
저장된 버전도 바꾸지 않는다. 바꾸는 것은 사람이 [적용]을 누른 뒤 버전 라우트다.

**왜 base hash를 요구하나.** 사용자가 질문에 답하는 사이에 그래프를 직접 고쳤다면, 그 답으로
만든 패치는 이미 다른 그래프에 대한 것이다. 그대로 적용하면 사용자의 편집이 조용히
덮인다 — base가 어긋나면 거절하고 다시 묻는다.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from athena_api.backtest import codegen as codegen_mod
from athena_api.backtest import diagnose as diagnose_mod
from athena_api.backtest import visual_registry as registry
from athena_api.backtest import visual_schema as vschema
from athena_api.backtest.visual_schema import (
    Diagnostic,
    VisualGraphError,
    VisualStrategyGraph,
)

# 서버가 만들 수 있는 편집 연산 — 이 여섯 밖은 patch가 되지 않는다.
ALLOWED_OPS: tuple[str, ...] = (
    "connect_port",
    "disconnect_port",
    "set_param",
    "add_node",
    "remove_node",
    "replace_node",
)


class VisualPatchError(ValueError):
    """패치를 만들 수 없다 — 라우트가 422로 옮긴다."""


class StaleBaseHashError(VisualPatchError):
    """패치의 base가 지금 그래프와 다르다 — 라우트가 409로 옮긴다."""


@dataclass
class _Choice:
    """선택지 하나. `ops`는 화면에 내보내지 않는다 — 실제 편집은 서버가 다시 만든다."""

    id: str
    label_ko: str
    recommended: bool
    changes: list[dict[str, str]] = field(default_factory=list)
    ops: list[dict[str, Any]] = field(default_factory=list)

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label_ko": self.label_ko,
            "recommended": self.recommended,
            "changes": self.changes,
        }


def _node_change(node_id: str, what_ko: str) -> dict[str, str]:
    return {"target": "node", "id": node_id, "what_ko": what_ko}


def _edge_change(edge_id: str, what_ko: str) -> dict[str, str]:
    return {"target": "edge", "id": edge_id, "what_ko": what_ko}


def _edge_id(from_node: str, from_port: str, to_node: str, to_port: str) -> str:
    return f"e-{from_node}.{from_port}-{to_node}.{to_port}"


def _data_node_id(graph: VisualStrategyGraph) -> str | None:
    for node in graph.nodes:
        kind = registry.resolve(node.kind)
        if kind is not None and kind.category == "data":
            return node.id
    return None


def _signal_sources(graph: VisualStrategyGraph) -> list[str]:
    out = []
    for node in graph.nodes:
        kind = registry.resolve(node.kind)
        if kind is not None and kind.category in ("condition", "logic"):
            out.append(node.id)
    return out


def _connect_choice(
    from_node: str, from_port: str, to_node: str, to_port: str, label_ko: str, *, recommended: bool
) -> _Choice:
    edge_id = _edge_id(from_node, from_port, to_node, to_port)
    return _Choice(
        id=f"connect:{to_node}:{to_port}",
        label_ko=label_ko,
        recommended=recommended,
        changes=[_edge_change(edge_id, f"{from_node}.{from_port} → {to_node}.{to_port} 연결")],
        ops=[
            {
                "kind": "connect_port",
                "from": {"node_id": from_node, "port": from_port},
                "to": {"node_id": to_node, "port": to_port},
            }
        ],
    )


def _remove_choice(node_id: str, label_ko: str) -> _Choice:
    return _Choice(
        id=f"remove:{node_id}",
        label_ko=label_ko,
        recommended=False,
        changes=[_node_change(node_id, "노드와 그 연결을 지웁니다")],
        ops=[{"kind": "remove_node", "node_id": node_id}],
    )


def _disconnect_choice(node_id: str, port: str, label_ko: str) -> _Choice:
    return _Choice(
        id=f"disconnect:{node_id}:{port}",
        label_ko=label_ko,
        recommended=True,
        changes=[_node_change(node_id, f"'{port}' 입력의 연결을 끊습니다")],
        ops=[{"kind": "disconnect_port", "to": {"node_id": node_id, "port": port}}],
    )


def _set_param_choice(
    node_id: str, param: str, value: Any, label_ko: str, *, recommended: bool
) -> _Choice:
    return _Choice(
        id=f"set:{node_id}:{param}",
        label_ko=label_ko,
        recommended=recommended,
        changes=[_node_change(node_id, f"{param}을(를) {value}(으)로 정합니다")],
        ops=[{"kind": "set_param", "node_id": node_id, "param": param, "value": value}],
    )


def _choices_for(graph: VisualStrategyGraph, diagnostic: Diagnostic) -> list[_Choice]:
    """진단 하나를 해결할 선택지 — 확신하는 것만 낸다(diagnose.py의 규율과 같다)."""
    code = diagnostic.code
    node_id = diagnostic.node_id
    port = diagnostic.port
    data_id = _data_node_id(graph)
    fix = diagnostic.suggested_fix or {}
    choices: list[_Choice] = []

    if code == "BTG-PORT-002" and node_id is not None and port is not None:
        if fix.get("kind") == "connect_port":
            src = fix["from"]
            dst = fix["to"]
            choices.append(
                _connect_choice(
                    src["node_id"],
                    src["port"],
                    dst["node_id"],
                    dst["port"],
                    f"캔들의 {src['port']}을(를) 연결합니다",
                    recommended=True,
                )
            )
        if port == "right" and data_id is not None:
            choices.append(
                _set_param_choice(
                    node_id, "compare_to", 0, "비교값을 숫자 0으로 정합니다", recommended=True
                )
            )
            choices.append(
                _connect_choice(
                    data_id, "close", node_id, "right", "캔들의 종가와 비교합니다",
                    recommended=False,
                )
            )
        choices.append(_remove_choice(node_id, "이 노드를 지웁니다"))
    elif code in ("BTG-OUT-001", "BTG-OUT-002"):
        kind_name = registry.ENTRY_KIND if code == "BTG-OUT-001" else registry.EXIT_KIND
        label = "진입" if code == "BTG-OUT-001" else "청산"
        new_id = "out-entry" if code == "BTG-OUT-001" else "out-exit"
        new_id = _free_node_id(graph, new_id)
        sources = _signal_sources(graph)
        ops: list[dict[str, Any]] = [
            {
                "kind": "add_node",
                "node": {"id": new_id, "kind": kind_name, "label": label, "params": {}},
            }
        ]
        changes = [_node_change(new_id, f"{label} 출력 노드를 만듭니다")]
        if sources:
            ops.append(
                {
                    "kind": "connect_port",
                    "from": {"node_id": sources[-1], "port": "signal"},
                    "to": {"node_id": new_id, "port": "signal"},
                }
            )
            changes.append(
                _edge_change(
                    _edge_id(sources[-1], "signal", new_id, "signal"),
                    f"{sources[-1]}의 신호를 {label}에 잇습니다",
                )
            )
        choices.append(
            _Choice(
                id=f"add:{new_id}",
                label_ko=f"{label} 출력 노드를 추가합니다",
                recommended=True,
                changes=changes,
                ops=ops,
            )
        )
    elif code in ("BTG-OUT-003", "BTG-DATA-001") and node_id is not None:
        choices.append(_remove_choice(node_id, "중복된 노드를 지웁니다"))
    elif code in ("BTG-TYPE-001", "BTG-LOGIC-001") and node_id is not None and port is not None:
        choices.append(_disconnect_choice(node_id, port, "잘못된 연결을 끊습니다"))
        if fix.get("kind") == "connect_port":
            src = fix["from"]
            dst = fix["to"]
            choices.append(
                _connect_choice(
                    src["node_id"],
                    src["port"],
                    dst["node_id"],
                    dst["port"],
                    f"캔들의 {src['port']}을(를) 대신 연결합니다",
                    recommended=False,
                )
            )
    elif code == "BTG-PARAM-001" and node_id is not None and fix.get("kind") == "set_param":
        choices.append(
            _set_param_choice(
                node_id,
                fix["param"],
                fix["value"],
                f"{fix['param']}을(를) {fix['value']}(으)로 정합니다",
                recommended=True,
            )
        )
    elif code == "BTG-EDGE-001" and node_id is not None and port is not None:
        choices.append(_disconnect_choice(node_id, port, "남아 있는 연결을 끊습니다"))
    return choices


_QUESTION_KO: dict[str, str] = {
    "BTG-PORT-002": "비어 있는 입력을 어떻게 채울까요?",
    "BTG-OUT-001": "진입 신호를 어디서 받을까요?",
    "BTG-OUT-002": "청산 신호를 어디서 받을까요?",
    "BTG-OUT-003": "출력 노드가 둘입니다. 어느 쪽을 지울까요?",
    "BTG-TYPE-001": "이을 수 없는 연결이 있습니다. 어떻게 할까요?",
    "BTG-LOGIC-001": "묶음 안의 묶음은 표현할 수 없습니다. 어떻게 할까요?",
    "BTG-PARAM-001": "설정값을 어떻게 정할까요?",
    "BTG-EDGE-001": "연결이 성립하지 않습니다. 어떻게 할까요?",
    "BTG-DATA-001": "캔들 노드를 어떻게 할까요?",
}


def questions_for(
    graph: VisualStrategyGraph, diagnostics: list[Diagnostic] | None = None
) -> dict[str, Any] | None:
    """지금 진행을 막는 **첫 오류 하나**만 묻는다. 막는 오류가 없으면 None."""
    diagnostics = validate_or(diagnostics, graph)
    blocking = [d for d in diagnostics if d.severity == "error"]
    if not blocking:
        return None
    first = blocking[0]
    choices = _choices_for(graph, first)
    return {
        "question": {
            "code": first.code,
            "question_ko": (
                f"{first.message_ko} {_QUESTION_KO.get(first.code, '어떻게 할까요?')}"
            ),
            "node_id": first.node_id,
            "port": first.port,
            "choices": [c.payload() for c in choices],
            "remaining": len(blocking) - 1,
        }
    }


def validate_or(
    diagnostics: list[Diagnostic] | None, graph: VisualStrategyGraph
) -> list[Diagnostic]:
    """호출자가 준 진단을 그대로 쓰되, 없으면 서버가 다시 검증한다 — 클라이언트 값을 믿지
    않으면서도 같은 요청 안에서 두 번 검증하지는 않는다."""
    return vschema.validate_graph(graph) if diagnostics is None else diagnostics


# ── JSON Patch ───────────────────────────────────────────────────────────────


def _escape(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _free_node_id(graph: VisualStrategyGraph, base: str) -> str:
    taken = {node.id for node in graph.nodes}
    if base not in taken:
        return base
    i = 2
    while f"{base}-{i}" in taken:
        i += 1
    return f"{base}-{i}"


def _node_index(doc: dict[str, Any], node_id: str) -> int:
    for i, node in enumerate(doc["nodes"]):
        if node["id"] == node_id:
            return i
    raise VisualPatchError(f"그래프에 없는 노드입니다: {node_id}")


def _edge_index_into(doc: dict[str, Any], node_id: str, port: str) -> int | None:
    for i, edge in enumerate(doc["edges"]):
        if edge["to"]["node_id"] == node_id and edge["to"]["port"] == port:
            return i
    return None


def _apply(doc: dict[str, Any], op: dict[str, Any]) -> None:
    """제한된 JSON Patch 적용기 — 우리가 만드는 경로 모양만 안다."""
    path = op["path"]
    parts = path.split("/")[1:]
    if op["op"] == "add" and parts[-1] == "-":
        doc[parts[0]].append(copy.deepcopy(op["value"]))
        return
    if len(parts) == 2:
        collection, index = parts[0], int(parts[1])
        if op["op"] == "remove":
            doc[collection].pop(index)
        else:
            doc[collection][index] = copy.deepcopy(op["value"])
        return
    if len(parts) == 4 and parts[2] == "params":
        node = doc[parts[0]][int(parts[1])]
        key = parts[3].replace("~1", "/").replace("~0", "~")
        if op["op"] == "remove":
            node["params"].pop(key, None)
        else:
            node["params"][key] = copy.deepcopy(op["value"])
        return
    raise VisualPatchError(f"적용할 수 없는 patch 경로입니다: {path}")  # pragma: no cover


def _ops_to_patch(doc: dict[str, Any], ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """allowlist 연산 → JSON Patch. 연산마다 즉시 적용해 다음 연산의 인덱스를 맞춘다."""
    patch: list[dict[str, Any]] = []

    def emit(op: dict[str, Any]) -> None:
        patch.append(op)
        _apply(doc, op)

    for op in ops:
        kind = op.get("kind")
        if kind not in ALLOWED_OPS:
            raise VisualPatchError(
                f"허용되지 않는 편집입니다: {kind!r}. 가능한 것은 {'/'.join(ALLOWED_OPS)}뿐이다."
            )
        if kind == "connect_port":
            src, dst = op["from"], op["to"]
            _node_index(doc, src["node_id"])
            _node_index(doc, dst["node_id"])
            existing = _edge_index_into(doc, dst["node_id"], dst["port"])
            if existing is not None:
                emit({"op": "remove", "path": f"/edges/{existing}"})
            emit(
                {
                    "op": "add",
                    "path": "/edges/-",
                    "value": {
                        "id": _edge_id(src["node_id"], src["port"], dst["node_id"], dst["port"]),
                        "from": {"node_id": src["node_id"], "port": src["port"]},
                        "to": {"node_id": dst["node_id"], "port": dst["port"]},
                    },
                }
            )
        elif kind == "disconnect_port":
            dst = op["to"]
            _node_index(doc, dst["node_id"])
            existing = _edge_index_into(doc, dst["node_id"], dst["port"])
            if existing is None:
                raise VisualPatchError(
                    f"끊을 연결이 없습니다: {dst['node_id']}.{dst['port']}"
                )
            emit({"op": "remove", "path": f"/edges/{existing}"})
        elif kind == "set_param":
            i = _node_index(doc, op["node_id"])
            key = _escape(str(op["param"]))
            exists = str(op["param"]) in doc["nodes"][i].get("params", {})
            emit(
                {
                    "op": "replace" if exists else "add",
                    "path": f"/nodes/{i}/params/{key}",
                    "value": op["value"],
                }
            )
        elif kind == "add_node":
            node = op["node"]
            if any(n["id"] == node["id"] for n in doc["nodes"]):
                raise VisualPatchError(f"이미 있는 노드 id입니다: {node['id']}")
            emit({"op": "add", "path": "/nodes/-", "value": _node_json(node)})
        elif kind == "remove_node":
            node_id = op["node_id"]
            i = _node_index(doc, node_id)
            for j in range(len(doc["edges"]) - 1, -1, -1):
                edge = doc["edges"][j]
                if node_id in (edge["from"]["node_id"], edge["to"]["node_id"]):
                    emit({"op": "remove", "path": f"/edges/{j}"})
            emit({"op": "remove", "path": f"/nodes/{i}"})
        else:  # replace_node
            i = _node_index(doc, op["node_id"])
            emit({"op": "replace", "path": f"/nodes/{i}", "value": _node_json(op["node"])})
    return patch


def _node_json(node: dict[str, Any]) -> dict[str, Any]:
    """노드 값을 스키마로 한 번 통과시킨다 — patch가 그래프 모델 밖 모양을 심지 못하게."""
    return vschema.GraphNode.model_validate(node).model_dump(mode="json")


# ── diff ─────────────────────────────────────────────────────────────────────


def _flatten(value: Any, prefix: str, out: dict[str, Any]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _flatten(item, f"{prefix}.{key}", out)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            _flatten(item, f"{prefix}[{i}]", out)
    else:
        out[prefix] = value


def _spec_diff(before: Any, after: Any) -> list[dict[str, Any]]:
    left: dict[str, Any] = {}
    right: dict[str, Any] = {}
    if before is not None:
        _flatten(before.model_dump(by_alias=True, mode="json"), "$", left)
    if after is not None:
        _flatten(after.model_dump(by_alias=True, mode="json"), "$", right)
    paths = sorted(set(left) | set(right))
    return [
        {"path": path, "before": left.get(path), "after": right.get(path)}
        for path in paths
        if left.get(path) != right.get(path)
    ]


def _source_and_hash(graph: VisualStrategyGraph) -> tuple[str, str | None]:
    """비교용 소스와 그 artifact hash.

    hash는 **실행 가능한 산출물일 때만** 낸다 — 미리보기 코드의 해시를 artifact_hash라고
    부르면 적용 receipt가 실행되지 않는 코드를 근거로 서게 된다. 그럴 땐 None이다.
    """
    try:
        artifact = codegen_mod.generate_from_graph(graph)
        return artifact["source"], artifact["hashes"]["artifact_hash"]
    except (VisualGraphError, RuntimeError):
        diagnostics = vschema.validate_graph(graph)
        preview = codegen_mod.preview_from_graph(graph, diagnostics)
        return (preview["source"] if preview else ""), None


def _code_diff(before: str, after: str) -> dict[str, Any]:
    # diagnose.py와 같은 diff 규칙을 쓴다 — 화면이 두 자리에서 다른 diff를 그리지 않게.
    fix = diagnose_mod._make_fix("그래프 패치", before, after)
    return {
        "removed": fix.removed,
        "added": fix.added,
        "diff_lines": [{"mark": mark, "text": text} for mark, text in fix.diff_lines],
    }


# ── patch ────────────────────────────────────────────────────────────────────


def build_patch(
    graph: VisualStrategyGraph,
    base_graph_hash: str,
    intent: dict[str, Any],
    *,
    base_version_id: str | None = None,
) -> dict[str, Any]:
    """비활성 수정안 하나 — 그래프·스펙·코드가 어떻게 바뀌는지 보여줄 뿐 적용하지 않는다."""
    current = vschema.graph_hash(graph)
    if base_graph_hash != current:
        raise StaleBaseHashError(
            "그래프가 그 사이에 바뀌었습니다. 지금 화면 기준으로 다시 물어야 합니다."
        )
    if not isinstance(intent, dict):
        raise VisualPatchError("intent는 객체여야 한다")

    ops = intent.get("ops")
    if ops is None:
        code = intent.get("code")
        choice_id = intent.get("choice_id")
        if not isinstance(code, str) or not isinstance(choice_id, str):
            raise VisualPatchError("intent에는 ops 또는 code+choice_id가 필요하다")
        diagnostics = vschema.validate_graph(graph)
        target = next(
            (d for d in diagnostics if d.severity == "error" and d.code == code), None
        )
        if target is None:
            raise VisualPatchError(f"지금 그래프에는 {code} 오류가 없습니다")
        choice = next((c for c in _choices_for(graph, target) if c.id == choice_id), None)
        if choice is None:
            raise VisualPatchError(f"알 수 없는 선택지입니다: {choice_id}")
        ops = choice.ops
    if not isinstance(ops, list) or not ops:
        raise VisualPatchError("적용할 편집이 없다")

    doc = graph.model_dump(by_alias=True, mode="json")
    patch = _ops_to_patch(doc, list(ops))
    try:
        graph_after = VisualStrategyGraph.model_validate(doc)
    except Exception as exc:  # noqa: BLE001 — 모델 검증 실패를 그대로 422로 옮긴다
        raise VisualPatchError(f"패치를 적용한 그래프가 스키마에 맞지 않는다: {exc}") from None

    before_spec = _safe_spec(graph)
    after_spec = _safe_spec(graph_after)
    diagnostics_before = vschema.validate_graph(graph)
    diagnostics_after = vschema.validate_graph(graph_after)
    errors_before = len([d for d in diagnostics_before if d.severity == "error"])
    errors_after = len([d for d in diagnostics_after if d.severity == "error"])
    before_source, base_artifact_hash = _source_and_hash(graph)
    after_source, _after_artifact_hash = _source_and_hash(graph_after)
    patch_hash = vschema.source_hash(
        vschema.canonical_json({"base": base_graph_hash, "patch": patch})
    )
    return {
        "patch_id": f"patch-{patch_hash[:12]}",
        "patch_hash": patch_hash,
        "summary_ko": _summary_ko(
            graph,
            list(ops),
            resolved=max(errors_before - errors_after, 0),
            remaining=errors_after,
        ),
        "base_graph_hash": base_graph_hash,
        # 적용 receipt는 base 코드까지 가리켜야 한다. 실행 가능한 산출물이 아직 없으면
        # (base 그래프가 컴파일되지 않으면) 없는 hash를 지어내지 않고 null이다.
        "base_artifact_hash": base_artifact_hash,
        "base_version_id": base_version_id,
        # 새 버전 id는 사람이 적용한 뒤 버전 라우트가 짓는다 — 여기서는 언제나 null이다.
        "next_version": None,
        "graph_patch": patch,
        "graph_after": graph_after.model_dump(by_alias=True, mode="json"),
        "graph_after_hash": vschema.graph_hash(graph_after),
        "spec_diff": _spec_diff(before_spec, after_spec),
        # base 그래프가 아직 컴파일되지 않으면 diff는 "차이"가 아니라 "처음 생기는 스펙 전체"다.
        # 화면이 그 둘을 같은 목록으로 그리면 사용자는 전부 바뀌는 줄 안다.
        "spec_diff_basis": "delta" if before_spec is not None else "first_compile",
        "code_diff": _code_diff(before_source, after_source),
        "diagnostics_after": vschema.diagnostics_payload(diagnostics_after),
        "graph_compatible": not vschema.has_errors(diagnostics_after),
        "applied": False,
        "notice": (
            "아직 아무것도 저장하지 않았습니다. 사람이 [적용]을 눌러야 그래프가 바뀝니다."
        ),
    }


def _label_of(graph: VisualStrategyGraph, node_id: str) -> str:
    """카드에 쓸 이름 — 사용자가 캔버스에서 본 한국어 label, 없으면 노드 id."""
    for node in graph.nodes:
        if node.id == node_id:
            if node.label:
                return node.label
            kind = registry.resolve(node.kind)
            return kind.label_ko if kind is not None else node.id
    return node_id


def _summary_ko(
    graph: VisualStrategyGraph, ops: list[dict[str, Any]], *, resolved: int, remaining: int
) -> str:
    """수정안 한 줄 요약 — 채팅 카드의 제목이다. diff를 열지 않아도 무엇이 바뀌는지 읽힌다.

    노드 id가 아니라 사용자가 캔버스에서 본 label을 쓴다 — `cond-exit-1`은 사용자가 지은
    이름이 아니라 서버가 지은 이름이라 카드에서 읽히지 않는다.
    """
    parts: list[str] = []
    for op in ops:
        kind = op["kind"]
        if kind == "connect_port":
            src, dst = op["from"], op["to"]
            parts.append(
                f"{_label_of(graph, dst['node_id'])}.{dst['port']} ← "
                f"{_label_of(graph, src['node_id'])}.{src['port']}"
            )
        elif kind == "disconnect_port":
            dst = op["to"]
            parts.append(f"{_label_of(graph, dst['node_id'])}.{dst['port']} 연결 끊기")
        elif kind == "set_param":
            parts.append(f"{_label_of(graph, op['node_id'])}.{op['param']} = {op['value']}")
        elif kind == "add_node":
            node = op["node"]
            parts.append(f"{node.get('label') or node['id']} 노드 추가")
        elif kind == "remove_node":
            parts.append(f"{_label_of(graph, op['node_id'])} 노드 삭제")
        else:
            parts.append(f"{_label_of(graph, op['node_id'])} 노드 교체")
    if resolved > 0:
        tail = f"오류 {resolved}개 해결"
    elif remaining > 0:
        tail = f"오류 {remaining}개 남음"
    else:
        tail = "오류 없음"
    return f"{' · '.join(parts)} · {tail}"


def _safe_spec(graph: VisualStrategyGraph) -> Any:
    try:
        return vschema.compile_graph(graph)
    except VisualGraphError:
        return None


__all__ = [
    "ALLOWED_OPS",
    "StaleBaseHashError",
    "VisualPatchError",
    "build_patch",
    "questions_for",
]
