"""시각 그래프의 노드 종류 표 — 팔레트가 그대로 읽는 `VisualStrategyGraph v1` 레지스트리.

**왜 지표 목록을 손으로 적지 않나.** 여기에 지표 이름을 한 번 베껴 적으면 그 순간
`indicators/` 레지스트리와 이 파일이 두 개의 진실이 된다 — 지표 하나를 등록해도 팔레트에는
안 뜨고, 파라미터 범위가 갈리고, 출력 이름이 어긋난다. 그래서 지표 노드는 전부
`indicators.list_all()`에서 **파생**한다. 이 파일이 직접 적는 것은 지표가 아닌 것들
(캔들·조절값·조건·묶음·출력)과 포트 타입 이름뿐이다.

**왜 포트에 타입을 붙이나.** 화면이 아무 선이나 이을 수 있으면 서버가 컴파일할 수 없는
그래프가 만들어지고, 사용자는 "그렸는데 안 된다"만 본다. 타입 4종(`Series<Number>`,
`Series<Bool>`, `Number`, `OHLCV`)은 렌더러가 **연결 전에** 거절할 수 있는 최소한의 계약이다.

**왜 지표 파라미터가 포트이면서 params이기도 한가.** 같은 값이 두 가지 방식으로 정해진다 —
숫자를 직접 적거나(`params`), `param` 노드를 이어 슬라이더로 만들거나(`$name` 참조).
포트가 연결되면 스펙은 참조를 쓰고, 비어 있으면 리터럴을 쓴다. 이 둘을 한 자리에 두면
"슬라이더로 만들기"가 노드 하나 연결로 끝난다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from athena_api.backtest import indicators
from athena_api.backtest.schema import Logic, Operator

REGISTRY_VERSION = "1"

# 포트 타입 4종 — 이 문자열이 렌더러와의 계약이다.
SERIES_NUMBER = "Series<Number>"
SERIES_BOOL = "Series<Bool>"
NUMBER = "Number"
OHLCV = "OHLCV"
PORT_TYPES: tuple[str, ...] = (SERIES_NUMBER, SERIES_BOOL, NUMBER, OHLCV)

# compile.py `_RAW_COLUMNS`와 같은 열 — 캔들 노드가 그대로 내보낸다.
OHLCV_COLUMNS: tuple[str, ...] = ("open", "high", "low", "close", "volume")

DATA_KIND = "data.ohlcv"
PARAM_KIND = "param"
ENTRY_KIND = "output.entry"
EXIT_KIND = "output.exit"
LOGIC_AND_KIND = "logic.and"
LOGIC_OR_KIND = "logic.or"
LOGIC_PORTS: tuple[str, ...] = ("in1", "in2", "in3", "in4")

_COLUMN_LABEL: dict[str, str] = {
    "open": "시가",
    "high": "고가",
    "low": "저가",
    "close": "종가",
    "volume": "거래량",
}

_OPERATOR_LABEL: dict[Operator, str] = {
    Operator.CROSS_ABOVE: "상향 돌파",
    Operator.CROSS_BELOW: "하향 돌파",
    Operator.GREATER_THAN: "보다 큼",
    Operator.LESS_THAN: "보다 작음",
    Operator.GREATER_EQUAL: "보다 크거나 같음",
    Operator.LESS_EQUAL: "보다 작거나 같음",
    Operator.EQUALS: "같음",
}

_LOGIC_LABEL: dict[Logic, str] = {
    Logic.AND: "모두 만족(AND)",
    Logic.OR: "하나라도 만족(OR)",
}


@dataclass(frozen=True)
class PortSpec:
    """포트 하나. `accepts`가 비어 있지 않으면 입력 포트다(출력은 타입 하나만 낸다)."""

    name: str
    type: str
    label_ko: str
    accepts: tuple[str, ...] = ()
    required: bool = False

    def payload(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name, "type": self.type, "label_ko": self.label_ko}
        if self.accepts:
            out["accepts"] = list(self.accepts)
            out["required"] = self.required
        return out


@dataclass(frozen=True)
class ParamField:
    """검사기(inspector)가 그리는 입력칸 하나. 지표 파라미터는 레지스트리 범위를 그대로 옮긴다."""

    name: str
    type: str  # "str" | "int" | "float" | "number" | "enum"
    label_ko: str
    required: bool = False
    default: Any = None
    min: Any = None
    max: Any = None
    step: Any = None
    choices: tuple[str, ...] = ()
    nullable: bool = False

    def payload(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "name": self.name,
            "type": self.type,
            "label_ko": self.label_ko,
            "required": self.required,
            "default": self.default,
        }
        for key in ("min", "max", "step"):
            value = getattr(self, key)
            if value is not None:
                out[key] = value
        if self.choices:
            out["choices"] = list(self.choices)
        if self.nullable:
            out["nullable"] = True
        return out


@dataclass(frozen=True)
class NodeKind:
    """노드 종류 하나 — 팔레트 항목이자 검증기의 계약."""

    kind: str
    category: str  # data | param | indicator | condition | logic | output
    label_ko: str
    inputs: tuple[PortSpec, ...] = ()
    outputs: tuple[PortSpec, ...] = ()
    params: tuple[ParamField, ...] = ()
    indicator_id: str | None = None
    operator: str | None = None
    logic: str | None = None
    max_per_graph: int | None = None

    def input_port(self, name: str) -> PortSpec | None:
        for port in self.inputs:
            if port.name == name:
                return port
        return None

    def output_port(self, name: str) -> PortSpec | None:
        for port in self.outputs:
            if port.name == name:
                return port
        return None

    def param_field(self, name: str) -> ParamField | None:
        for field in self.params:
            if field.name == name:
                return field
        return None

    def payload(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "kind": self.kind,
            "category": self.category,
            "label_ko": self.label_ko,
            "inputs": [p.payload() for p in self.inputs],
            "outputs": [p.payload() for p in self.outputs],
            "params": [p.payload() for p in self.params],
            "max_per_graph": self.max_per_graph,
        }
        if self.indicator_id is not None:
            out["indicator_id"] = self.indicator_id
        if self.operator is not None:
            out["operator"] = self.operator
        if self.logic is not None:
            out["logic"] = self.logic
        return out


def indicator_kind(indicator_id: str) -> str:
    """지표 레지스트리 id(`SMA`) → 노드 kind(`indicator.sma`)."""
    return f"indicator.{indicator_id.lower()}"


def condition_kind(operator: Operator | str) -> str:
    return f"condition.{Operator(operator).value}"


def logic_kind(logic: Logic | str) -> str:
    return LOGIC_AND_KIND if Logic(logic) is Logic.AND else LOGIC_OR_KIND


def _build() -> dict[str, NodeKind]:
    kinds: dict[str, NodeKind] = {}

    kinds[DATA_KIND] = NodeKind(
        kind=DATA_KIND,
        category="data",
        label_ko="캔들",
        outputs=(
            *(PortSpec(c, SERIES_NUMBER, _COLUMN_LABEL[c]) for c in OHLCV_COLUMNS),
            PortSpec("ohlcv", OHLCV, "캔들 묶음"),
        ),
        max_per_graph=1,
    )

    kinds[PARAM_KIND] = NodeKind(
        kind=PARAM_KIND,
        category="param",
        label_ko="조절값",
        outputs=(PortSpec("value", NUMBER, "값"),),
        params=(
            ParamField("name", "str", "이름", required=True),
            ParamField("default", "number", "기본값", required=True, default=20),
            ParamField("min", "number", "최소", required=True, default=2),
            ParamField("max", "number", "최대", required=True, default=240),
            ParamField("step", "number", "간격", required=True, default=1),
            ParamField("type", "enum", "타입", default="int", choices=("int", "float")),
        ),
    )

    for spec in indicators.list_all():
        # source가 close면 종가 시리즈 하나를 먹고, 그 외(hlc·ohlcv)는 캔들 묶음을 먹는다 —
        # codegen이 `df["close"]` / `df` 중 무엇을 넘길지 고르는 것과 같은 갈림이다.
        if spec.source == "close":
            source_port = PortSpec(
                "source", SERIES_NUMBER, "가격", accepts=(SERIES_NUMBER,), required=True
            )
        else:
            source_port = PortSpec("ohlcv", OHLCV, "캔들", accepts=(OHLCV,), required=True)
        inputs = [source_port]
        params = [
            ParamField("alias", "str", "이름", required=True, default=spec.id.lower()),
        ]
        for name, p in spec.params.items():
            inputs.append(PortSpec(name, NUMBER, name, accepts=(NUMBER,), required=False))
            params.append(
                ParamField(
                    name,
                    p.type,
                    name,
                    default=p.default,
                    min=p.min,
                    max=p.max,
                    step=p.step,
                )
            )
        if len(spec.outputs) == 1:
            outputs: tuple[PortSpec, ...] = (PortSpec("value", SERIES_NUMBER, "값"),)
        else:
            outputs = tuple(PortSpec(name, SERIES_NUMBER, name) for name in spec.outputs)
        kind = indicator_kind(spec.id)
        kinds[kind] = NodeKind(
            kind=kind,
            category="indicator",
            label_ko=spec.id,
            inputs=tuple(inputs),
            outputs=outputs,
            params=tuple(params),
            indicator_id=spec.id,
        )

    for operator in Operator:
        kind = condition_kind(operator)
        kinds[kind] = NodeKind(
            kind=kind,
            category="condition",
            label_ko=_OPERATOR_LABEL[operator],
            inputs=(
                PortSpec("left", SERIES_NUMBER, "왼쪽", accepts=(SERIES_NUMBER,), required=True),
                PortSpec(
                    "right",
                    SERIES_NUMBER,
                    "오른쪽",
                    accepts=(SERIES_NUMBER, NUMBER),
                    required=False,
                ),
            ),
            outputs=(PortSpec("signal", SERIES_BOOL, "신호"),),
            params=(
                ParamField(
                    "compare_to",
                    "number",
                    "비교값",
                    nullable=True,
                ),
            ),
            operator=operator.value,
        )

    for logic in Logic:
        kind = logic_kind(logic)
        kinds[kind] = NodeKind(
            kind=kind,
            category="logic",
            label_ko=_LOGIC_LABEL[logic],
            # in1·in2는 필수다 — 조건 하나를 묶는 묶음은 묶음이 아니라 그 조건 자체다.
            inputs=tuple(
                PortSpec(
                    port,
                    SERIES_BOOL,
                    f"조건 {i + 1}",
                    accepts=(SERIES_BOOL,),
                    required=i < 2,
                )
                for i, port in enumerate(LOGIC_PORTS)
            ),
            outputs=(PortSpec("signal", SERIES_BOOL, "신호"),),
            logic=logic.value,
        )

    for kind, label in ((ENTRY_KIND, "진입"), (EXIT_KIND, "청산")):
        kinds[kind] = NodeKind(
            kind=kind,
            category="output",
            label_ko=label,
            inputs=(
                PortSpec("signal", SERIES_BOOL, "신호", accepts=(SERIES_BOOL,), required=True),
            ),
            max_per_graph=1,
        )

    return kinds


_KINDS: dict[str, NodeKind] = _build()


def all_kinds() -> dict[str, NodeKind]:
    """등록 순서 그대로 전체 노드 종류."""
    return dict(_KINDS)


def resolve(kind: str) -> NodeKind | None:
    """kind 문자열 → 노드 종류. 모르는 kind면 None(부르는 쪽이 BTG-KIND-001로 옮긴다).

    지표 kind만 대소문자를 가리지 않는다 — 레지스트리 id가 대문자(`SMA`)라 렌더러가
    `indicator.SMA`로 보낼 여지가 있고, 그 한 글자 때문에 그래프 전체가 거절되면
    사용자는 원인을 알 수 없다. 정본 표기는 소문자다.
    """
    hit = _KINDS.get(kind)
    if hit is not None:
        return hit
    if kind.startswith("indicator."):
        return _KINDS.get(indicator_kind(kind.split(".", 1)[1]))
    return None


def registry_payload() -> dict[str, Any]:
    """`GET /api/v1/backtest/visual/registry` 본문 — 팔레트가 이 JSON만 읽고 그린다."""
    return {
        "registry_version": REGISTRY_VERSION,
        "graph_version": "1",
        "port_types": list(PORT_TYPES),
        "ohlcv_columns": list(OHLCV_COLUMNS),
        "logic_ports": list(LOGIC_PORTS),
        "kinds": [kind.payload() for kind in _KINDS.values()],
    }


__all__ = [
    "DATA_KIND",
    "ENTRY_KIND",
    "EXIT_KIND",
    "LOGIC_AND_KIND",
    "LOGIC_OR_KIND",
    "LOGIC_PORTS",
    "NUMBER",
    "OHLCV",
    "OHLCV_COLUMNS",
    "PARAM_KIND",
    "PORT_TYPES",
    "REGISTRY_VERSION",
    "SERIES_BOOL",
    "SERIES_NUMBER",
    "NodeKind",
    "ParamField",
    "PortSpec",
    "all_kinds",
    "condition_kind",
    "indicator_kind",
    "logic_kind",
    "registry_payload",
    "resolve",
]
