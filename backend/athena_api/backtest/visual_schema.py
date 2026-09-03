"""시각 저작 소스 — `VisualStrategyGraph v1`과 그 컴파일러(docs/research/backtest-visual-
code-roundtrip-implementation-evaluation.md).

**왜 그래프가 또 하나의 정본이 아닌가.** 실행 의미의 정본은 여전히 `StrategySpec`이다.
그래프는 사람이 편집하는 **시각 소스**이고, 이 파일은 그 둘 사이의 일대일 계약을 서버
한 곳에서만 증명한다. 렌더러가 자체 컴파일러를 갖는 순간 "보이는 전략"과 "도는 전략"이
갈라진다 — 그 갈라짐이 이 계약이 막는 유일한 사고다.

**왜 진단이 노드·포트에 귀속되나.** "전략이 잘못됐습니다"는 초심자에게 아무 정보가 아니다.
모든 오류는 가능한 한 stable node id와 포트 이름을 달고 나가고, 위치를 특정할 수 없을 때만
`node_id=None`이다. 코드(`BTG-…`)는 번역과 무관하게 고정이라 UI 분기와 테스트가 그것을 쓴다.

**왜 표현할 수 없는 것을 조용히 근사하지 않나.** 예를 들어 조건의 오른쪽에 `param` 노드를
잇는 것은 `ConditionSpec.compare_to`가 `$name` 참조를 못 받으므로 표현 불가다. 여기서
기본값으로 치환해 통과시키면 슬라이더를 움직여도 조건은 옛 숫자를 쓴다 — 그래서 거절한다.

**왜 `normalize_spec`이 있나.** 조건이 하나뿐인 묶음의 `logic`은 AND든 OR든 결과가 같다
(rules.evaluate_group). 그래프는 그 자리를 묶음 노드 없이 그리므로 왕복하면 AND로 돌아온다.
의미가 같은 두 표현을 하나로 모아 비교할 자리가 필요해서 이 함수를 둔다.
"""

from __future__ import annotations

import hashlib
import json
import keyword
from dataclasses import dataclass, field
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from athena_api.backtest import indicators
from athena_api.backtest import visual_registry as registry
from athena_api.backtest.schema import (
    ConditionGroup,
    ConditionSpec,
    CostsSpec,
    DataSpec,
    IndicatorSpec,
    Logic,
    Metadata,
    Operator,
    ParamSpec,
    PositionSpec,
    RiskSpec,
    RiskToggle,
    StrategyBlock,
    StrategySpec,
)

# 그래프 → 스펙/코드 변환 규칙의 판본. source map은 이 값에 결박된다 — 규칙이 바뀌면
# 저장된 map으로 코드 줄을 열면 안 된다.
COMPILER_VERSION = "visual-1.0.0"

GRAPH_VERSION = "1"

Severity = Literal["error", "warning", "info"]


# ── 그래프 모델 ──────────────────────────────────────────────────────────────


class NodeUI(BaseModel):
    """캔버스 위치·접힘. 실행 의미와 분리되어 있어 `graph_hash`에서 제외된다."""

    model_config = ConfigDict(extra="allow")

    x: float = 0.0
    y: float = 0.0
    collapsed: bool = False


class GraphNode(BaseModel):
    """노드 하나. `id`는 label·위치·순서에서 만들지 않는 stable id다."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    label: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    ui: NodeUI | None = None


class PortRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=1)
    port: str = Field(min_length=1)


class GraphEdge(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1)
    # "from"은 파이썬 예약어라 별칭으로 받는다(schema.DataSpec.from_과 같은 이유).
    from_: PortRef = Field(alias="from")
    to: PortRef


class Scenario(BaseModel):
    """종목·기간·비용·리스크 — 그래프 밖에 두는 이유는 노드가 아니라 실행 설정이기 때문이다."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    symbol: str | None = None
    period: Literal["day", "week", "month"] = "day"
    adjusted: bool = True
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    costs: CostsSpec | None = None
    risk: RiskSpec | None = None


class GraphMeta(BaseModel):
    """전략 이름표 — 노드로 그릴 것이 아니라서 그래프 머리에 둔다.

    이 블록이 없으면 `StrategySpec.metadata`를 왕복시킬 자리가 없다. 전부 기본값이 있어
    렌더러가 보내지 않아도 그래프는 성립한다.
    """

    model_config = ConfigDict(extra="forbid")

    spec_version: str = "1.0"
    name: str = "시각 전략"
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    strategy_id: str = "visual_strategy"
    category: str | None = None


class VisualStrategyGraph(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    graph_version: Literal["1"] = GRAPH_VERSION
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    scenario: Scenario = Field(default_factory=Scenario)
    meta: GraphMeta = Field(default_factory=GraphMeta)


# ── 진단 ─────────────────────────────────────────────────────────────────────


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line: int
    column: int


class SourceSpan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file: str
    start: Position
    end: Position


class Diagnostic(BaseModel):
    """검증 결과 하나. 같은 `code`가 노드·포트·검사기·코드 네 곳에 같이 표시된다."""

    model_config = ConfigDict(extra="forbid")

    code: str
    severity: Severity
    node_id: str | None = None
    port: str | None = None
    json_path: str
    source_span: SourceSpan | None = None
    message_ko: str
    suggested_fix: dict[str, Any] | None = None


def diagnostics_payload(diagnostics: list[Diagnostic]) -> list[dict[str, Any]]:
    return [d.model_dump(mode="json") for d in diagnostics]


def has_errors(diagnostics: list[Diagnostic]) -> bool:
    return any(d.severity == "error" for d in diagnostics)


class VisualGraphError(ValueError):
    """컴파일 거부 — 무엇이 왜 막았는지를 진단 목록 그대로 들고 다닌다."""

    def __init__(self, diagnostics: list[Diagnostic]) -> None:
        self.diagnostics = diagnostics
        codes = ", ".join(sorted({d.code for d in diagnostics}))
        super().__init__(f"그래프를 컴파일할 수 없다: {codes}")


# ── 해시 ─────────────────────────────────────────────────────────────────────


def canonical_json(payload: Any) -> str:
    """해시 대상 정규 JSON — 키 순서·공백이 흔들리면 같은 그래프가 다른 hash를 낸다."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_graph_json(graph: VisualStrategyGraph) -> str:
    """`ui`를 뺀 정규 JSON — 노드를 옮겨도 그래프 hash는 바뀌지 않아야 한다."""
    payload = graph.model_dump(by_alias=True, mode="json")
    for node in payload.get("nodes", []):
        node.pop("ui", None)
    return canonical_json(payload)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def graph_hash(graph: VisualStrategyGraph) -> str:
    return _sha256(canonical_graph_json(graph))


def spec_hash(spec: StrategySpec) -> str:
    return _sha256(canonical_json(spec.model_dump(by_alias=True, mode="json")))


def source_hash(source: str) -> str:
    return _sha256(source)


# ── 색인 ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GraphIndex:
    """검증기·컴파일러·코드 생성기가 같이 읽는 그래프 색인.

    세 곳이 각자 엣지를 다시 훑으면 "연결됐다"의 정의가 셋으로 갈린다 — 한 번만 푼다.
    """

    graph: VisualStrategyGraph
    nodes: dict[str, GraphNode] = field(default_factory=dict)
    order: dict[str, int] = field(default_factory=dict)
    kinds: dict[str, registry.NodeKind] = field(default_factory=dict)
    incoming: dict[str, dict[str, PortRef]] = field(default_factory=dict)
    fanout: dict[str, set[str]] = field(default_factory=dict)

    def source_of(self, node_id: str, port: str) -> PortRef | None:
        return self.incoming.get(node_id, {}).get(port)

    def kind_of(self, node_id: str) -> registry.NodeKind | None:
        return self.kinds.get(node_id)

    def nodes_of(self, category: str) -> list[GraphNode]:
        return [
            node
            for node in self.graph.nodes
            if self.nodes.get(node.id) is node and self.kinds.get(node.id) is not None
            and self.kinds[node.id].category == category
        ]

    def is_used(self, node_id: str, port: str) -> bool:
        return port in self.fanout.get(node_id, set())


def build_index(
    graph: VisualStrategyGraph, diagnostics: list[Diagnostic] | None = None
) -> GraphIndex:
    """노드·엣지를 한 번 훑어 색인을 만들고, 그 과정에서만 알 수 있는 오류를 함께 낸다."""
    index = GraphIndex(graph=graph)
    add = diagnostics.append if diagnostics is not None else (lambda _d: None)

    for i, node in enumerate(graph.nodes):
        if node.id in index.nodes:
            add(
                Diagnostic(
                    code="BTG-ID-001",
                    severity="error",
                    node_id=node.id,
                    json_path=f"$.nodes[{i}].id",
                    message_ko=(
                        f"노드 id가 중복입니다: {node.id}. 노드마다 고유한 id가 있어야 "
                        "어느 노드의 오류인지 말할 수 있습니다."
                    ),
                )
            )
            continue
        index.nodes[node.id] = node
        index.order[node.id] = i
        kind = registry.resolve(node.kind)
        if kind is None:
            add(
                Diagnostic(
                    code="BTG-KIND-001",
                    severity="error",
                    node_id=node.id,
                    json_path=f"$.nodes[{i}].kind",
                    message_ko=(
                        f"모르는 노드 종류입니다: {node.kind}. 팔레트에 있는 종류만 쓸 수 "
                        "있습니다."
                    ),
                )
            )
        else:
            index.kinds[node.id] = kind

    seen_edges: set[str] = set()
    for j, edge in enumerate(graph.edges):
        if edge.id in seen_edges:
            add(
                Diagnostic(
                    code="BTG-ID-001",
                    severity="error",
                    node_id=None,
                    json_path=f"$.edges[{j}].id",
                    message_ko=f"연결 id가 중복입니다: {edge.id}.",
                )
            )
            continue
        seen_edges.add(edge.id)

        src_node = index.nodes.get(edge.from_.node_id)
        dst_node = index.nodes.get(edge.to.node_id)
        if src_node is None or dst_node is None:
            missing = edge.from_.node_id if src_node is None else edge.to.node_id
            add(
                Diagnostic(
                    code="BTG-EDGE-001",
                    severity="error",
                    node_id=dst_node.id if dst_node is not None else None,
                    port=edge.to.port if dst_node is not None else None,
                    json_path=f"$.edges[{j}]",
                    message_ko=(
                        f"연결이 존재하지 않는 노드를 가리킵니다: {missing}. "
                        "지워진 노드로 가는 선이 남아 있습니다."
                    ),
                )
            )
            continue

        src_kind = index.kinds.get(edge.from_.node_id)
        dst_kind = index.kinds.get(edge.to.node_id)
        if src_kind is None or dst_kind is None:
            continue  # 종류를 모르는 노드는 이미 BTG-KIND-001로 보고했다.

        if src_kind.output_port(edge.from_.port) is None:
            add(
                Diagnostic(
                    code="BTG-PORT-001",
                    severity="error",
                    node_id=edge.from_.node_id,
                    port=edge.from_.port,
                    json_path=f"$.edges[{j}].from.port",
                    message_ko=(
                        f"{src_kind.label_ko} 노드에 '{edge.from_.port}' 출력이 없습니다."
                    ),
                )
            )
            continue
        if dst_kind.input_port(edge.to.port) is None:
            add(
                Diagnostic(
                    code="BTG-PORT-001",
                    severity="error",
                    node_id=edge.to.node_id,
                    port=edge.to.port,
                    json_path=f"$.edges[{j}].to.port",
                    message_ko=f"{dst_kind.label_ko} 노드에 '{edge.to.port}' 입력이 없습니다.",
                )
            )
            continue

        slot = index.incoming.setdefault(edge.to.node_id, {})
        if edge.to.port in slot:
            add(
                Diagnostic(
                    code="BTG-EDGE-001",
                    severity="error",
                    node_id=edge.to.node_id,
                    port=edge.to.port,
                    json_path=f"$.edges[{j}]",
                    message_ko=(
                        f"입력 '{edge.to.port}'에 연결이 둘입니다. 한 입력은 하나만 받습니다."
                    ),
                )
            )
            continue
        slot[edge.to.port] = edge.from_
        index.fanout.setdefault(edge.from_.node_id, set()).add(edge.from_.port)

    return index


def column_of(index: GraphIndex, ref: PortRef) -> str | None:
    """출력 포트 하나가 신호 프레임에서 갖는 열 이름(compile.py `_indicator_columns`와 동일).

    캔들 노드의 열은 그 이름 그대로, 지표는 출력이 하나면 `별칭`, 여럿이면 `별칭_출력명`.
    열이 아닌 포트(조절값·신호·캔들 묶음)는 None이다.
    """
    kind = index.kinds.get(ref.node_id)
    node = index.nodes.get(ref.node_id)
    if kind is None or node is None:
        return None
    if kind.category == "data":
        return ref.port if ref.port in registry.OHLCV_COLUMNS else None
    if kind.category == "indicator":
        alias = node.params.get("alias")
        if not isinstance(alias, str) or not alias:
            return None
        return alias if ref.port == "value" else f"{alias}_{ref.port}"
    return None


# ── 검증 ─────────────────────────────────────────────────────────────────────


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_name(value: Any) -> bool:
    return isinstance(value, str) and value.isidentifier() and not keyword.iskeyword(value)


def _check_params(index: GraphIndex, out: list[Diagnostic]) -> None:
    for node_id, kind in index.kinds.items():
        node = index.nodes[node_id]
        i = index.order[node_id]
        known = {f.name for f in kind.params}
        for name in node.params:
            if name not in known:
                out.append(
                    Diagnostic(
                        code="BTG-PARAM-001",
                        severity="error",
                        node_id=node_id,
                        json_path=f"$.nodes[{i}].params.{name}",
                        message_ko=f"{kind.label_ko} 노드가 모르는 설정입니다: {name}.",
                    )
                )
        if kind.category == "indicator":
            alias = node.params.get("alias")
            if not _is_name(alias):
                out.append(
                    Diagnostic(
                        code="BTG-PARAM-001",
                        severity="error",
                        node_id=node_id,
                        json_path=f"$.nodes[{i}].params.alias",
                        message_ko=(
                            "지표 이름(alias)이 없거나 쓸 수 없는 이름입니다. 영문자로 "
                            "시작하는 이름을 지어주세요 — 조건식이 이 이름으로 지표를 부릅니다."
                        ),
                        suggested_fix={
                            "kind": "set_param",
                            "node_id": node_id,
                            "param": "alias",
                            "value": (kind.indicator_id or "ind").lower(),
                        },
                    )
                )
            for f in kind.params:
                if f.name == "alias" or f.name not in node.params:
                    continue
                if not _is_number(node.params[f.name]):
                    out.append(
                        Diagnostic(
                            code="BTG-PARAM-001",
                            severity="error",
                            node_id=node_id,
                            port=f.name,
                            json_path=f"$.nodes[{i}].params.{f.name}",
                            message_ko=f"{f.name}은(는) 숫자여야 합니다.",
                            suggested_fix={
                                "kind": "set_param",
                                "node_id": node_id,
                                "param": f.name,
                                "value": f.default,
                            },
                        )
                    )
        elif kind.category == "param":
            if not _is_name(node.params.get("name")):
                out.append(
                    Diagnostic(
                        code="BTG-PARAM-001",
                        severity="error",
                        node_id=node_id,
                        json_path=f"$.nodes[{i}].params.name",
                        message_ko=(
                            "조절값 이름이 없거나 쓸 수 없는 이름입니다. 이 이름이 그대로 "
                            "슬라이더 이름이 됩니다."
                        ),
                    )
                )
            for required in ("default", "min", "max", "step"):
                if not _is_number(node.params.get(required)):
                    out.append(
                        Diagnostic(
                            code="BTG-PARAM-001",
                            severity="error",
                            node_id=node_id,
                            json_path=f"$.nodes[{i}].params.{required}",
                            message_ko=f"조절값의 {required}가 없거나 숫자가 아닙니다.",
                        )
                    )
            declared = node.params.get("type")
            if declared is not None and declared not in ("int", "float"):
                out.append(
                    Diagnostic(
                        code="BTG-PARAM-001",
                        severity="error",
                        node_id=node_id,
                        json_path=f"$.nodes[{i}].params.type",
                        message_ko="조절값 타입은 int 또는 float입니다.",
                    )
                )
        elif kind.category == "condition":
            compare_to = node.params.get("compare_to")
            if compare_to is not None and not _is_number(compare_to):
                out.append(
                    Diagnostic(
                        code="BTG-PARAM-001",
                        severity="error",
                        node_id=node_id,
                        port="right",
                        json_path=f"$.nodes[{i}].params.compare_to",
                        message_ko="비교값(compare_to)은 숫자여야 합니다.",
                    )
                )


def _check_ports(index: GraphIndex, out: list[Diagnostic]) -> None:
    for node_id, kind in index.kinds.items():
        i = index.order[node_id]
        node = index.nodes[node_id]
        for port in kind.inputs:
            if not port.required:
                continue
            if index.source_of(node_id, port.name) is not None:
                continue
            out.append(
                Diagnostic(
                    code="BTG-PORT-002",
                    severity="error",
                    node_id=node_id,
                    port=port.name,
                    json_path=f"$.nodes[{i}].inputs.{port.name}",
                    message_ko=(
                        f"{kind.label_ko} 노드의 '{port.label_ko}' 입력이 비어 있습니다."
                    ),
                    suggested_fix=_connect_suggestion(index, node_id, port.name),
                )
            )
        if kind.category == "condition":
            # 오른쪽은 연결이 없으면 compare_to를 쓴다 — 둘 다 없으면 비교할 것이 없다.
            if (
                index.source_of(node_id, "right") is None
                and node.params.get("compare_to") is None
            ):
                out.append(
                    Diagnostic(
                        code="BTG-PORT-002",
                        severity="error",
                        node_id=node_id,
                        port="right",
                        json_path=f"$.nodes[{i}].inputs.right",
                        message_ko=(
                            "비교할 대상이 없습니다. 오른쪽에 지표를 연결하거나 비교값을 "
                            "숫자로 적어주세요."
                        ),
                    )
                )


def _connect_suggestion(index: GraphIndex, node_id: str, port: str) -> dict[str, Any] | None:
    """비어 있는 필수 입력에 이을 만한 곳을 하나만 고른다 — 확신할 때만 낸다."""
    kind = index.kinds[node_id]
    data_nodes = [n for n in index.graph.nodes if index.kinds.get(n.id) is not None
                  and index.kinds[n.id].category == "data"]
    if kind.category == "indicator" and port in ("source", "ohlcv") and data_nodes:
        return {
            "kind": "connect_port",
            "from": {
                "node_id": data_nodes[0].id,
                "port": "close" if port == "source" else "ohlcv",
            },
            "to": {"node_id": node_id, "port": port},
        }
    if kind.category == "condition" and port == "left" and data_nodes:
        return {
            "kind": "connect_port",
            "from": {"node_id": data_nodes[0].id, "port": "close"},
            "to": {"node_id": node_id, "port": port},
        }
    return None


def _check_types(index: GraphIndex, out: list[Diagnostic]) -> None:
    for node_id, ports in index.incoming.items():
        kind = index.kinds[node_id]
        i = index.order[node_id]
        for port_name, ref in ports.items():
            in_port = kind.input_port(port_name)
            src_kind = index.kinds[ref.node_id]
            out_port = src_kind.output_port(ref.port)
            if in_port is None or out_port is None:  # pragma: no cover — 색인이 이미 걸렀다
                continue
            json_path = f"$.nodes[{i}].inputs.{port_name}"
            if out_port.type not in in_port.accepts:
                out.append(
                    Diagnostic(
                        code="BTG-TYPE-001",
                        severity="error",
                        node_id=node_id,
                        port=port_name,
                        json_path=json_path,
                        message_ko=(
                            f"'{in_port.label_ko}' 입력에는 {'/'.join(in_port.accepts)}만 "
                            f"연결할 수 있습니다 — 지금 연결된 것은 {out_port.type}입니다."
                        ),
                    )
                )
                continue
            # 지표는 항상 캔들에서 읽는다(compile.py가 레지스트리 함수에 df를 통째로 넘긴다).
            # 다른 지표의 출력을 이으면 화면과 실행이 갈라지므로 여기서 막는다.
            if kind.category == "indicator" and port_name in ("source", "ohlcv"):
                expected = "close" if port_name == "source" else "ohlcv"
                if src_kind.category != "data" or ref.port != expected:
                    out.append(
                        Diagnostic(
                            code="BTG-TYPE-001",
                            severity="error",
                            node_id=node_id,
                            port=port_name,
                            json_path=json_path,
                            message_ko=(
                                f"{kind.label_ko}는 캔들의 "
                                f"{'종가' if expected == 'close' else '전체 열'}만 읽습니다. "
                                "다른 값을 연결해도 계산에 쓰이지 않습니다."
                            ),
                            suggested_fix=_connect_suggestion(index, node_id, port_name),
                        )
                    )
            # 조건의 오른쪽에 조절값을 잇는 것은 표현할 수 없다 — compare_to는 `$name`
            # 참조를 못 받는다(schema.resolve_params는 지표 params만 치환한다).
            if kind.category == "condition" and src_kind.category == "param":
                out.append(
                    Diagnostic(
                        code="BTG-TYPE-001",
                        severity="error",
                        node_id=node_id,
                        port=port_name,
                        json_path=json_path,
                        message_ko=(
                            "조건에는 조절값을 연결할 수 없습니다. 비교할 숫자는 비교값"
                            "(compare_to)에 직접 적고, 조절값은 지표에 연결합니다."
                        ),
                    )
                )


def _check_cardinality(index: GraphIndex, out: list[Diagnostic]) -> None:
    by_category: dict[str, list[str]] = {}
    for node_id, kind in index.kinds.items():
        key = kind.kind if kind.category == "output" else kind.category
        by_category.setdefault(key, []).append(node_id)

    data_nodes = sorted(by_category.get("data", []), key=lambda n: index.order[n])
    if not data_nodes:
        out.append(
            Diagnostic(
                code="BTG-DATA-001",
                severity="error",
                node_id=None,
                json_path="$.nodes",
                message_ko="캔들 노드가 없습니다. 모든 지표와 조건은 캔들에서 시작합니다.",
                suggested_fix={"kind": "add_node", "node_kind": registry.DATA_KIND},
            )
        )
    for extra in data_nodes[1:]:
        out.append(
            Diagnostic(
                code="BTG-DATA-001",
                severity="error",
                node_id=extra,
                json_path=f"$.nodes[{index.order[extra]}]",
                message_ko="캔들 노드는 하나만 둘 수 있습니다.",
                suggested_fix={"kind": "remove_node", "node_id": extra},
            )
        )

    for kind_name, code, label in (
        (registry.ENTRY_KIND, "BTG-OUT-001", "진입"),
        (registry.EXIT_KIND, "BTG-OUT-002", "청산"),
    ):
        found = sorted(by_category.get(kind_name, []), key=lambda n: index.order[n])
        if not found:
            out.append(
                Diagnostic(
                    code=code,
                    severity="error",
                    node_id=None,
                    json_path="$.nodes",
                    message_ko=(
                        f"{label} 출력 노드가 없습니다. 전략은 {label} 신호가 있어야 합니다."
                    ),
                    suggested_fix={"kind": "add_node", "node_kind": kind_name},
                )
            )
        for extra in found[1:]:
            out.append(
                Diagnostic(
                    code="BTG-OUT-003",
                    severity="error",
                    node_id=extra,
                    json_path=f"$.nodes[{index.order[extra]}]",
                    message_ko=f"{label} 출력 노드가 둘 이상입니다. 하나만 둘 수 있습니다.",
                    suggested_fix={"kind": "remove_node", "node_id": extra},
                )
            )


def _check_names(index: GraphIndex, out: list[Diagnostic]) -> None:
    """지표 별칭·조절값 이름·원시 열 이름은 한 이름 공간을 쓴다 — 겹치면 조건식이 흔들린다."""
    taken: dict[str, str] = {c: "캔들 열" for c in registry.OHLCV_COLUMNS}
    for node in index.graph.nodes:
        kind = index.kinds.get(node.id)
        if kind is None or index.nodes.get(node.id) is not node:
            continue
        names: list[str] = []
        if kind.category == "indicator":
            alias = node.params.get("alias")
            if not isinstance(alias, str) or not alias:
                continue
            registry_spec = indicators.get(kind.indicator_id or "")
            if len(registry_spec.outputs) == 1:
                names = [alias]
            else:
                names = [alias, *(f"{alias}_{o}" for o in registry_spec.outputs)]
        elif kind.category == "param":
            name = node.params.get("name")
            if not isinstance(name, str) or not name:
                continue
            names = [name]
        for name in names:
            if name in taken:
                out.append(
                    Diagnostic(
                        code="BTG-ALIAS-001",
                        severity="error",
                        node_id=node.id,
                        json_path=f"$.nodes[{index.order[node.id]}].params",
                        message_ko=(
                            f"이름 '{name}'이(가) 이미 {taken[name]}에서 쓰이고 있습니다. "
                            "이름이 겹치면 조건식이 어느 값을 가리키는지 알 수 없습니다."
                        ),
                    )
                )
                break
            taken[name] = f"{kind.label_ko} 노드"


def _check_cycle(index: GraphIndex, out: list[Diagnostic]) -> None:
    edges: dict[str, set[str]] = {}
    for dst, ports in index.incoming.items():
        for ref in ports.values():
            edges.setdefault(ref.node_id, set()).add(dst)

    state: dict[str, int] = {}
    reported: set[str] = set()

    def walk(node_id: str, stack: list[str]) -> None:
        state[node_id] = 1
        stack.append(node_id)
        for nxt in sorted(edges.get(node_id, set()), key=lambda n: index.order.get(n, 0)):
            if state.get(nxt) == 1:
                cycle = stack[stack.index(nxt):] if nxt in stack else [nxt]
                head = min(cycle, key=lambda n: index.order.get(n, 0))
                if head not in reported:
                    reported.add(head)
                    out.append(
                        Diagnostic(
                            code="BTG-CYCLE-001",
                            severity="error",
                            node_id=head,
                            json_path=f"$.nodes[{index.order.get(head, 0)}]",
                            message_ko=(
                                "연결이 제자리로 돌아옵니다: "
                                f"{' → '.join(cycle)} → {nxt}. 값은 한 방향으로만 흐릅니다."
                            ),
                        )
                    )
            elif state.get(nxt) is None:
                walk(nxt, stack)
        stack.pop()
        state[node_id] = 2

    for node in index.graph.nodes:
        if node.id in index.nodes and state.get(node.id) is None:
            walk(node.id, [])


def _check_logic(index: GraphIndex, out: list[Diagnostic]) -> None:
    for node_id, kind in index.kinds.items():
        if kind.category != "logic":
            continue
        for port in registry.LOGIC_PORTS:
            ref = index.source_of(node_id, port)
            if ref is None:
                continue
            src_kind = index.kinds.get(ref.node_id)
            if src_kind is not None and src_kind.category == "logic":
                out.append(
                    Diagnostic(
                        code="BTG-LOGIC-001",
                        severity="error",
                        node_id=node_id,
                        port=port,
                        json_path=f"$.nodes[{index.order[node_id]}].inputs.{port}",
                        message_ko=(
                            "묶음 안에 묶음을 넣을 수 없습니다. v1의 조건은 AND 하나 또는 "
                            "OR 하나로 된 평면 묶음까지만 표현합니다."
                        ),
                    )
                )


def _check_scenario(graph: VisualStrategyGraph, out: list[Diagnostic]) -> None:
    missing = [
        label
        for value, label in (
            (graph.scenario.symbol, "종목"),
            (graph.scenario.from_, "시작일"),
            (graph.scenario.to, "종료일"),
        )
        if not value
    ]
    if missing:
        out.append(
            Diagnostic(
                code="BTG-DATA-001",
                severity="warning",
                node_id=None,
                json_path="$.scenario",
                message_ko=(
                    f"{'·'.join(missing)}이(가) 비어 있습니다. 전략 자체는 완성됐지만 "
                    "실행하려면 이 값이 필요합니다."
                ),
            )
        )


def validate_graph(graph: VisualStrategyGraph) -> list[Diagnostic]:
    """그래프 하나를 검증한다 — 실행하지 않고, 값을 채워 넣지도 않는다."""
    out: list[Diagnostic] = []
    index = build_index(graph, out)
    _check_params(index, out)
    _check_ports(index, out)
    _check_types(index, out)
    _check_cardinality(index, out)
    _check_names(index, out)
    _check_cycle(index, out)
    _check_logic(index, out)
    _check_scenario(graph, out)
    return out


# ── 컴파일: 그래프 → StrategySpec ────────────────────────────────────────────


def _param_spec(node: GraphNode) -> ParamSpec:
    values = {key: node.params[key] for key in ("default", "min", "max", "step")}
    declared = node.params.get("type")
    if declared not in ("int", "float"):
        # 적혀 있지 않으면 값에서 읽는다 — 지어내지 않고, 전부 정수면 int다.
        declared = "int" if all(isinstance(v, int) for v in values.values()) else "float"
    return ParamSpec(**values, type=declared)


def _indicator_params(index: GraphIndex, node: GraphNode) -> dict[str, Any]:
    kind = index.kinds[node.id]
    registry_spec = indicators.get(kind.indicator_id or "")
    params: dict[str, Any] = {}
    for name in registry_spec.params:
        ref = index.source_of(node.id, name)
        if ref is not None:
            params[name] = f"${index.nodes[ref.node_id].params['name']}"
        elif name in node.params:
            params[name] = node.params[name]
    return params


def _condition_spec(index: GraphIndex, node: GraphNode) -> ConditionSpec:
    kind = index.kinds[node.id]
    left_ref = index.source_of(node.id, "left")
    left = column_of(index, left_ref) if left_ref is not None else None
    if left is None:  # pragma: no cover — 검증이 이미 막았다
        raise VisualGraphError(
            [
                Diagnostic(
                    code="BTG-PORT-002",
                    severity="error",
                    node_id=node.id,
                    port="left",
                    json_path=f"$.nodes[{index.order[node.id]}].inputs.left",
                    message_ko="왼쪽 입력이 없습니다.",
                )
            ]
        )
    right_ref = index.source_of(node.id, "right")
    compare_to: str | float
    if right_ref is not None:
        resolved = column_of(index, right_ref)
        if resolved is None:  # pragma: no cover — 검증이 이미 막았다
            raise VisualGraphError([])
        compare_to = resolved
    else:
        compare_to = float(node.params["compare_to"])
    return ConditionSpec(
        indicator=left, operator=Operator(kind.operator or ""), compare_to=compare_to
    )


def _group_spec(index: GraphIndex, output_node: GraphNode) -> ConditionGroup:
    ref = index.source_of(output_node.id, "signal")
    if ref is None:  # pragma: no cover — 검증이 이미 막았다
        raise VisualGraphError([])
    source = index.nodes[ref.node_id]
    kind = index.kinds[source.id]
    if kind.category == "logic":
        conditions = [
            _condition_spec(index, index.nodes[r.node_id])
            for r in (index.source_of(source.id, p) for p in registry.LOGIC_PORTS)
            if r is not None
        ]
        return ConditionGroup(logic=Logic(kind.logic or ""), conditions=conditions)
    # 조건 하나짜리 묶음은 AND/OR가 같은 결과를 낸다 — 묶음 노드를 요구하지 않고 AND로 적는다.
    return ConditionGroup(logic=Logic.AND, conditions=[_condition_spec(index, source)])


_DEFAULT_RISK = RiskSpec(
    stop_loss=RiskToggle(enabled=False, percent=0.0),
    take_profit=RiskToggle(enabled=False, percent=0.0),
    position=PositionSpec(sizing="all_in"),
)


def compile_graph(graph: VisualStrategyGraph) -> StrategySpec:
    """검증을 통과한 그래프 하나를 정규화 `StrategySpec`으로 옮긴다.

    오류가 하나라도 있으면 `VisualGraphError`로 멈춘다 — 반쯤 맞는 스펙을 만들어 돌려주면
    화면은 성공으로 보이고 실행은 다른 전략을 돈다.
    """
    diagnostics = validate_graph(graph)
    errors = [d for d in diagnostics if d.severity == "error"]
    if errors:
        raise VisualGraphError(errors)

    index = build_index(graph)
    params: dict[str, ParamSpec] = {}
    indicator_specs: list[IndicatorSpec] = []
    entry_node: GraphNode | None = None
    exit_node: GraphNode | None = None
    for node in graph.nodes:
        kind = index.kinds[node.id]
        if kind.category == "param":
            params[str(node.params["name"])] = _param_spec(node)
        elif kind.category == "indicator":
            indicator_specs.append(
                IndicatorSpec(
                    id=kind.indicator_id or "",
                    alias=str(node.params["alias"]),
                    params=_indicator_params(index, node),
                )
            )
        elif kind.kind == registry.ENTRY_KIND:
            entry_node = node
        elif kind.kind == registry.EXIT_KIND:
            exit_node = node

    assert entry_node is not None and exit_node is not None  # 검증이 보장한다  # noqa: S101

    scenario = graph.scenario
    data = None
    if scenario.symbol and scenario.from_ and scenario.to:
        data = DataSpec(
            symbols=[scenario.symbol],
            period=scenario.period,
            adjusted=scenario.adjusted,
            from_=scenario.from_,
            to=scenario.to,
        )

    return StrategySpec(
        version=graph.meta.spec_version,
        metadata=Metadata(
            name=graph.meta.name,
            description=graph.meta.description,
            tags=list(graph.meta.tags),
        ),
        data=data,
        strategy=StrategyBlock(
            id=graph.meta.strategy_id,
            category=graph.meta.category,
            params=params,
            indicators=indicator_specs,
            entry=_group_spec(index, entry_node),
            exit=_group_spec(index, exit_node),
        ),
        risk=scenario.risk or _DEFAULT_RISK.model_copy(deep=True),
        costs=scenario.costs,
    )


def normalize_spec(spec: StrategySpec) -> StrategySpec:
    """의미가 같은 두 표현을 하나로 모은다 — 조건 하나짜리 묶음의 logic은 AND로 적는다."""
    strategy = spec.strategy
    updates: dict[str, Any] = {}
    for name in ("entry", "exit"):
        group: ConditionGroup = getattr(strategy, name)
        if len(group.conditions) == 1 and group.logic is not Logic.AND:
            updates[name] = group.model_copy(update={"logic": Logic.AND})
    if not updates:
        return spec
    return spec.model_copy(update={"strategy": strategy.model_copy(update=updates)})


def spec_to_yaml(spec: StrategySpec) -> str:
    """스펙 하나를 `.athena.yaml` 원문으로 — 폼 경로가 읽는 것과 같은 문서다."""
    payload = spec.model_dump(by_alias=True, mode="json", exclude_none=True)
    return yaml.safe_dump(payload, allow_unicode=True, sort_keys=False)


# ── 역변환: StrategySpec → 그래프 ────────────────────────────────────────────

_COLUMN_X = (0.0, 280.0, 560.0, 840.0, 1120.0)
_ROW_H = 120.0


class _Layout:
    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled
        self.rows = [0, 0, 0, 0, 0]

    def next(self, column: int) -> NodeUI | None:
        if not self.enabled:
            return None
        y = 40.0 + self.rows[column] * _ROW_H
        self.rows[column] += 1
        return NodeUI(x=_COLUMN_X[column], y=y)


def _edge(from_node: str, from_port: str, to_node: str, to_port: str) -> GraphEdge:
    return GraphEdge(
        id=f"e-{from_node}.{from_port}-{to_node}.{to_port}",
        from_=PortRef(node_id=from_node, port=from_port),
        to=PortRef(node_id=to_node, port=to_port),
    )


def spec_to_graph(spec: StrategySpec, *, layout: bool = True) -> VisualStrategyGraph:
    """`StrategySpec` 하나를 편집 가능한 그래프로 되돌린다 — id는 이름에서 결정적으로 짓는다.

    프리셋·폼에서 온 스펙을 시각 탭에서 열려면 이 방향이 필요하다. id가 결정적이라
    같은 스펙은 언제나 같은 그래프(같은 `graph_hash`)가 된다.
    """
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    columns: dict[str, tuple[str, str]] = {}
    place = _Layout(layout)

    data_id = "data-ohlcv"
    nodes.append(
        GraphNode(id=data_id, kind=registry.DATA_KIND, label="캔들", ui=place.next(0))
    )
    for column in registry.OHLCV_COLUMNS:
        columns[column] = (data_id, column)

    for name, param in spec.strategy.params.items():
        nodes.append(
            GraphNode(
                id=f"param-{name}",
                kind=registry.PARAM_KIND,
                label=name,
                params={
                    "name": name,
                    "default": param.default,
                    "min": param.min,
                    "max": param.max,
                    "step": param.step,
                    "type": param.type,
                },
                ui=place.next(0),
            )
        )

    for ind in spec.strategy.indicators:
        registry_spec = indicators.get(ind.id)
        node_id = f"ind-{ind.alias}"
        params: dict[str, Any] = {"alias": ind.alias}
        for name, value in ind.params.items():
            if isinstance(value, str) and value.startswith("$"):
                edges.append(_edge(f"param-{value[1:]}", "value", node_id, name))
            else:
                params[name] = value
        nodes.append(
            GraphNode(
                id=node_id,
                kind=registry.indicator_kind(ind.id),
                label=ind.alias,
                params=params,
                ui=place.next(1),
            )
        )
        if registry_spec.source == "close":
            edges.append(_edge(data_id, "close", node_id, "source"))
        else:
            edges.append(_edge(data_id, "ohlcv", node_id, "ohlcv"))
        if len(registry_spec.outputs) == 1:
            columns[ind.alias] = (node_id, "value")
        else:
            for output in registry_spec.outputs:
                columns[f"{ind.alias}_{output}"] = (node_id, output)

    for role, group, label in (
        ("entry", spec.strategy.entry, "진입"),
        ("exit", spec.strategy.exit, "청산"),
    ):
        if len(group.conditions) > len(registry.LOGIC_PORTS):
            raise ValueError(
                f"{label} 조건이 {len(group.conditions)}개다 — 시각 그래프 v1은 "
                f"{len(registry.LOGIC_PORTS)}개까지 그린다"
            )
        condition_ids: list[str] = []
        for i, condition in enumerate(group.conditions, start=1):
            node_id = f"cond-{role}-{i}"
            params = {}
            if condition.indicator not in columns:
                raise ValueError(
                    f"조건이 가리키는 값을 그래프에서 찾지 못했다: {condition.indicator}"
                )
            src_node, src_port = columns[condition.indicator]
            edges.append(_edge(src_node, src_port, node_id, "left"))
            if isinstance(condition.compare_to, str):
                if condition.compare_to not in columns:
                    raise ValueError(
                        f"조건이 가리키는 값을 그래프에서 찾지 못했다: {condition.compare_to}"
                    )
                right_node, right_port = columns[condition.compare_to]
                edges.append(_edge(right_node, right_port, node_id, "right"))
            else:
                params["compare_to"] = condition.compare_to
            kind = registry.condition_kind(condition.operator)
            nodes.append(
                GraphNode(
                    id=node_id,
                    kind=kind,
                    label=f"{condition.indicator} {registry.resolve(kind).label_ko}",
                    params=params,
                    ui=place.next(2),
                )
            )
            condition_ids.append(node_id)

        output_id = f"out-{role}"
        if len(condition_ids) == 1:
            edges.append(_edge(condition_ids[0], "signal", output_id, "signal"))
        else:
            logic_id = f"logic-{role}"
            logic_kind = registry.logic_kind(group.logic)
            nodes.append(
                GraphNode(
                    id=logic_id,
                    kind=logic_kind,
                    label=registry.resolve(logic_kind).label_ko,
                    ui=place.next(3),
                )
            )
            for i, condition_id in enumerate(condition_ids):
                edges.append(_edge(condition_id, "signal", logic_id, registry.LOGIC_PORTS[i]))
            edges.append(_edge(logic_id, "signal", output_id, "signal"))
        nodes.append(
            GraphNode(
                id=output_id,
                kind=registry.ENTRY_KIND if role == "entry" else registry.EXIT_KIND,
                label=label,
                ui=place.next(4),
            )
        )

    data = spec.data
    if data is not None and len(data.symbols) != 1:
        raise ValueError("시각 그래프 v1은 종목 하나만 그린다")
    scenario = Scenario(
        symbol=data.symbols[0] if data is not None else None,
        period=data.period if data is not None else "day",
        adjusted=data.adjusted if data is not None else True,
        from_=data.from_ if data is not None else None,
        to=data.to if data is not None else None,
        costs=spec.costs.model_copy(deep=True) if spec.costs is not None else None,
        risk=spec.risk.model_copy(deep=True),
    )
    return VisualStrategyGraph(
        nodes=nodes,
        edges=edges,
        scenario=scenario,
        meta=GraphMeta(
            spec_version=spec.version,
            name=spec.metadata.name,
            description=spec.metadata.description,
            tags=list(spec.metadata.tags),
            strategy_id=spec.strategy.id,
            category=spec.strategy.category,
        ),
    )


__all__ = [
    "COMPILER_VERSION",
    "GRAPH_VERSION",
    "Diagnostic",
    "GraphEdge",
    "GraphIndex",
    "GraphMeta",
    "GraphNode",
    "NodeUI",
    "PortRef",
    "Position",
    "Scenario",
    "SourceSpan",
    "VisualGraphError",
    "VisualStrategyGraph",
    "build_index",
    "canonical_graph_json",
    "canonical_json",
    "column_of",
    "compile_graph",
    "diagnostics_payload",
    "graph_hash",
    "has_errors",
    "normalize_spec",
    "source_hash",
    "spec_hash",
    "spec_to_graph",
    "spec_to_yaml",
    "validate_graph",
]
