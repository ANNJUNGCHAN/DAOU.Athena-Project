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

**왜 그래프 경로가 따로 있나(`generate_from_graph`).** 시각 설계는 노드 하나를 코드 줄
하나로 되짚을 수 있어야 한다(오류 노드 더블클릭 → 코드 줄). 그래서 그래프에서 나온 코드는
노드마다 `# node: <id> · <label>` 표식을 달고, 그 표식 뒤의 문장 위치를 실제 텍스트와 `ast`
양쪽에서 읽어 source map으로 낸다. 폼 경로(`spec_to_python`)는 그 표식이 필요 없으므로
한 글자도 바꾸지 않는다 — 두 경로의 출력이 갈라지지 않도록 지표 호출·조건식 규칙은 같은
헬퍼를 공유한다.

**왜 검증 실패 그래프에도 코드를 내나.** 오류 위치를 코드로 보여주려면 코드가 있어야 한다.
다만 그 코드는 **실행할 수 없는 미리보기**다 — 빠진 입력을 기본값으로 채우지 않고
`__MISSING__` sentinel과 한국어 사유로 남긴다. 안전한 sentinel조차 만들 수 없는 그래프
(중복 id·모르는 종류·순환·이름 충돌·출력 중복)는 코드를 지어내지 않고 None을 돌려준다.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any

from athena_api.backtest import indicators
from athena_api.backtest import visual_registry as vregistry
from athena_api.backtest import visual_schema as vschema
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


# ── 그래프 경로: 노드 표식이 붙은 코드 + source map ──────────────────────────

MISSING = "__MISSING__"

_GRAPH_HEADER = (
    "# athena strategy v1 — 이 파일은 시각 설계(그래프)에서 생성됐습니다. "
    "그래프를 고치면 다시 나옵니다.\n"
    "# 지키는 선(손절·익절·비중)은 이 코드가 아니라 앱 엔진이 겁니다 — 코드는 두 열만 만듭니다.\n"
    "# `# node:` 주석은 그래프 노드 id입니다 — 오류를 그 노드로 되짚는 표식입니다."
)

# 이 코드들이 있으면 노드와 코드 줄이 1:1로 대응하지 않는다 — 비슷한 줄을 추정하느니
# 코드 이동을 끄는 편이 정직하다(평가 문서 §"오류 노드 더블클릭 → 코드 줄" 4항).
PREVIEW_BLOCKING_CODES: frozenset[str] = frozenset(
    {"BTG-ID-001", "BTG-KIND-001", "BTG-CYCLE-001", "BTG-ALIAS-001", "BTG-OUT-003"}
)

_RESERVED_NAMES: frozenset[str] = frozenset(
    {"df", "p", "bt", "pd", "entry", "exit_", "signals", "PARAMS", MISSING}
)


@dataclass
class _Anchor:
    """노드 하나가 차지한 코드 범위. `kind`가 params면 PARAMS 딕셔너리의 항목이다."""

    node_id: str
    role: str
    first_line: int
    last_line: int
    kind: str = "stmt"


@dataclass
class _Missing:
    """문장 하나가 만난 결손들 — 줄 끝에 한국어 사유로 모아 붙인다."""

    reasons: list[str] = field(default_factory=list)

    def sentinel(self, reason: str) -> str:
        self.reasons.append(reason)
        return MISSING

    def comment(self) -> str:
        return f"  # {MISSING}: {' · '.join(self.reasons)}" if self.reasons else ""


class _Names:
    """코드 변수 이름 배급 — 별칭이 겹쳐도(미리보기) 서로 덮어쓰지 않게 한다."""

    def __init__(self) -> None:
        self._used: set[str] = set(_RESERVED_NAMES)

    def take(self, wanted: str) -> str:
        base = _sanitize_name(wanted)
        name = base
        i = 2
        while name in self._used:
            name = f"{base}_{i}"
            i += 1
        self._used.add(name)
        return name


def _sanitize_name(text: str) -> str:
    out = "".join(ch if (ch.isalnum() or ch == "_") and ch.isascii() else "_" for ch in text)
    if not out or out[0].isdigit():
        out = f"n_{out}"
    return out


class _Unrepresentable(RuntimeError):
    """검증을 통과한 그래프에서 결손을 만났다 — 컴파일 경로에서는 있어서는 안 되는 일이다."""


class _GraphEmitter:
    """그래프 하나를 코드 한 장으로 옮기면서 노드별 줄 범위를 같이 기록한다."""

    def __init__(self, index: vschema.GraphIndex, *, preview: bool) -> None:
        self.index = index
        self.preview = preview
        self.lines: list[str] = []
        self.anchors: list[_Anchor] = []
        self.names = _Names()
        self.port_var: dict[tuple[str, str], str] = {}
        self.needs_pandas = False

    # 줄 쓰기 --------------------------------------------------------------
    def _write(self, text: str) -> int:
        self.lines.append(text)
        return len(self.lines)

    def _marker(self, node: vschema.GraphNode) -> None:
        kind = self.index.kinds.get(node.id)
        label = node.label or (kind.label_ko if kind is not None else node.kind)
        self._write(f"    # node: {node.id} · {label}")

    def _fail(self, reason: str, miss: _Missing) -> str:
        if not self.preview:
            raise _Unrepresentable(reason)
        return miss.sentinel(reason)

    # 값 참조 --------------------------------------------------------------
    def _ref_var(self, ref: vschema.PortRef | None, reason: str, miss: _Missing) -> str:
        if ref is None:
            return self._fail(reason, miss)
        var = self.port_var.get((ref.node_id, ref.port))
        if var is None:
            return self._fail(reason, miss)
        return var

    # 조각 -----------------------------------------------------------------
    def emit(self) -> str:
        imports_at = self._emit_head()
        self._emit_params()
        self._write("")
        self._write("")
        self._write("def signals(df, p):")
        self._emit_data()
        self._emit_indicators()
        self._emit_conditions()
        self._emit_logic()
        self._emit_outputs()
        self._write('    return df.assign(entry=entry, exit=exit_)[["entry", "exit"]]')
        if self.needs_pandas:
            self.lines.insert(imports_at, "import pandas as pd")
            self._shift_anchors(imports_at)
        return "\n".join(self.lines) + "\n"

    def _shift_anchors(self, inserted_at: int) -> None:
        for anchor in self.anchors:
            if anchor.first_line > inserted_at:
                anchor.first_line += 1
            if anchor.last_line > inserted_at:
                anchor.last_line += 1

    def _emit_head(self) -> int:
        for line in _GRAPH_HEADER.split("\n"):
            self._write(line)
        at = self._write("import athena_bt as bt")
        self._write("")
        return at

    def _emit_params(self) -> None:
        nodes = [n for n in self.index.graph.nodes if self._category(n.id) == "param"]
        if not nodes:
            self._write("PARAMS = {}")
            return
        self._write("PARAMS = {")
        for node in nodes:
            miss = _Missing()
            name = node.params.get("name")
            if not isinstance(name, str) or not name:
                name = self._fail("조절값 이름이 없습니다", miss)
            values = []
            for key, fallback in (("default", 0), ("min", 0), ("max", 0), ("step", 1)):
                value = node.params.get(key)
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    self._fail(f"조절값 {key}가 없습니다", miss)
                    value = fallback
                values.append((key, value))
            declared = node.params.get("type")
            if declared not in ("int", "float"):
                declared = "int" if all(isinstance(v, int) for _k, v in values) else "float"
            body = ", ".join(f'"{key}": {_literal(value)}' for key, value in values)
            label = node.label or name
            self._write(f"    # node: {node.id} · {label}")
            line = self._write(f'    "{name}": {{{body}, "type": "{declared}"}},{miss.comment()}')
            self.anchors.append(_Anchor(node.id, "declaration", line, line, kind="params"))
            self.port_var[(node.id, "value")] = f'p["{name}"]'
        self._write("}")

    def _category(self, node_id: str) -> str | None:
        kind = self.index.kinds.get(node_id)
        return None if kind is None else kind.category

    def _emit_data(self) -> None:
        nodes = [n for n in self.index.graph.nodes if self._category(n.id) == "data"]
        if not nodes:
            return
        node = nodes[0]
        used = self.index.fanout.get(node.id, set())
        columns = [c for c in vregistry.OHLCV_COLUMNS if c in used]
        self._marker(node)
        first = last = 0
        if "ohlcv" in used or not columns:
            name = self.names.take("ohlcv")
            first = last = self._write(f"    {name} = df")
            self.port_var[(node.id, "ohlcv")] = name
        for column in columns:
            name = self.names.take(column)
            last = self._write(f'    {name} = df["{column}"]')
            first = first or last
            self.port_var[(node.id, column)] = name
        self.anchors.append(_Anchor(node.id, "declaration", first, last))

    def _emit_indicators(self) -> None:
        for node in self.index.graph.nodes:
            if self._category(node.id) != "indicator":
                continue
            kind = self.index.kinds[node.id]
            registry_spec = indicators.get(kind.indicator_id or "")
            miss = _Missing()
            alias = node.params.get("alias")
            if not isinstance(alias, str) or not alias:
                self._fail("지표 이름(alias)이 없습니다", miss)
                alias = node.id
            var = self.names.take(alias)

            port = "source" if registry_spec.source == "close" else "ohlcv"
            first_arg = self._ref_var(
                self.index.source_of(node.id, port),
                f"{kind.label_ko}에 캔들이 연결되지 않았습니다",
                miss,
            )
            args = [first_arg]
            for name in registry_spec.params:
                ref = self.index.source_of(node.id, name)
                if ref is not None:
                    args.append(f"{name}={self._ref_var(ref, f'{name} 값이 없습니다', miss)}")
                elif name in node.params:
                    value = node.params[name]
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        args.append(f"{name}={_literal(value)}")
                    else:
                        args.append(f"{name}={self._fail(f'{name}이 숫자가 아닙니다', miss)}")
            call = f"bt.{(kind.indicator_id or '').lower()}({', '.join(args)})"
            self._marker(node)
            first = self._write(f"    {var} = {call}{miss.comment()}")
            last = first
            if len(registry_spec.outputs) == 1:
                self.port_var[(node.id, "value")] = var
            else:
                for output in registry_spec.outputs:
                    out_var = self.names.take(f"{alias}_{output}")
                    last = self._write(f'    {out_var} = {var}["{output}"]')
                    self.port_var[(node.id, output)] = out_var
            self.anchors.append(_Anchor(node.id, "declaration", first, last))

    def _emit_conditions(self) -> None:
        for node in self.index.graph.nodes:
            if self._category(node.id) != "condition":
                continue
            kind = self.index.kinds[node.id]
            operator = Operator(kind.operator or "")
            miss = _Missing()
            cross_fn = _CROSS_FN.get(operator)
            left = self._ref_var(
                self.index.source_of(node.id, "left"), "왼쪽 입력이 없습니다", miss
            )
            right_ref = self.index.source_of(node.id, "right")
            if right_ref is not None:
                right = self._ref_var(right_ref, "오른쪽 입력이 없습니다", miss)
            else:
                value = node.params.get("compare_to")
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    right = self._fail("비교할 값이 없습니다", miss)
                elif cross_fn is not None:
                    # 폼 경로의 rules.py가 하는 브로드캐스트를 코드에서도 한다.
                    right = f"pd.Series({float(value)!r}, index=df.index)"
                    self.needs_pandas = True
                else:
                    right = _literal(value)
            if cross_fn is not None:
                expr = f"bt.{cross_fn}({left}, {right})"
            else:
                expr = f"{left} {_OPERATOR_CODE[operator]} {right}"
            var = self.names.take(node.id)
            self._marker(node)
            line = self._write(f"    {var} = {expr}{miss.comment()}")
            self.port_var[(node.id, "signal")] = var
            self.anchors.append(_Anchor(node.id, "expression", line, line))

    def _emit_logic(self) -> None:
        for node in self.index.graph.nodes:
            if self._category(node.id) != "logic":
                continue
            kind = self.index.kinds[node.id]
            miss = _Missing()
            parts: list[str] = []
            for i, port in enumerate(vregistry.LOGIC_PORTS):
                ref = self.index.source_of(node.id, port)
                if ref is None:
                    if i < 2:
                        parts.append(self._fail(f"조건 {i + 1}이 비어 있습니다", miss))
                    continue
                parts.append(self._ref_var(ref, f"조건 {i + 1}이 비어 있습니다", miss))
            joiner = " & " if Logic(kind.logic or "") is Logic.AND else " | "
            expr = joiner.join(f"({part})" for part in parts) if len(parts) > 1 else parts[0]
            var = self.names.take(node.id)
            self._marker(node)
            line = self._write(f"    {var} = {expr}{miss.comment()}")
            self.port_var[(node.id, "signal")] = var
            self.anchors.append(_Anchor(node.id, "expression", line, line))

    def _emit_outputs(self) -> None:
        for kind_name, var, role, label in (
            (vregistry.ENTRY_KIND, "entry", "entry", "진입"),
            (vregistry.EXIT_KIND, "exit_", "exit", "청산"),
        ):
            nodes = [
                n
                for n in self.index.graph.nodes
                if self.index.kinds.get(n.id) is not None
                and self.index.kinds[n.id].kind == kind_name
            ]
            miss = _Missing()
            if not nodes:
                value = self._fail(f"{label} 출력 노드가 없습니다", miss)
                self._write(f"    {var} = {value}{miss.comment()}")
                continue
            node = nodes[0]
            source = self._ref_var(
                self.index.source_of(node.id, "signal"), f"{label} 신호가 없습니다", miss
            )
            self._marker(node)
            line = self._write(f"    {var} = {source}{miss.comment()}")
            self.anchors.append(_Anchor(node.id, role, line, line))


_AstIndex = dict[int, tuple[str, ast.AST, ast.AST]]


def _ast_targets(source: str) -> tuple[_AstIndex, _AstIndex]:
    """생성 텍스트를 다시 `ast`로 읽어 줄 번호 → (구조 경로, 시작 노드, 끝 노드) 색인을 만든다.

    텍스트만으로 span을 세면 코드 모양이 조금만 바뀌어도 열 번호가 조용히 어긋난다 —
    실제 파서가 인정한 위치만 map에 싣는다.
    """
    tree = ast.parse(source)
    statements: dict[int, tuple[str, ast.AST, ast.AST]] = {}
    params: dict[int, tuple[str, ast.AST, ast.AST]] = {}
    for i, stmt in enumerate(tree.body):
        statements[stmt.lineno] = (f"module.body[{i}]", stmt, stmt)
        if (
            isinstance(stmt, ast.Assign)
            and isinstance(stmt.value, ast.Dict)
            and any(isinstance(t, ast.Name) and t.id == "PARAMS" for t in stmt.targets)
        ):
            for key, value in zip(stmt.value.keys, stmt.value.values, strict=True):
                if key is None:  # pragma: no cover — 생성기가 `**` 확장을 쓰지 않는다
                    continue
                name = key.value if isinstance(key, ast.Constant) else "?"
                params[key.lineno] = (f"PARAMS['{name}']", key, value)
        if isinstance(stmt, ast.FunctionDef) and stmt.name == "signals":
            for j, inner in enumerate(stmt.body):
                statements[inner.lineno] = (f"signals.body[{j}]", inner, inner)
    return statements, params


def _entries_from_anchors(
    source: str, anchors: list[_Anchor], filename: str
) -> list[dict[str, Any]]:
    statements, params = _ast_targets(source)
    entries: list[dict[str, Any]] = []
    for anchor in anchors:
        table = params if anchor.kind == "params" else statements
        head = table.get(anchor.first_line)
        tail = table.get(anchor.last_line) if anchor.kind != "params" else head
        if head is None or tail is None:
            raise _Unrepresentable(f"{anchor.node_id}: 생성 코드에서 문장을 찾지 못했다")
        path, start_node, _ = head
        _p, _s, end_node = tail
        entries.append(
            {
                "node_id": anchor.node_id,
                "ast_path": path,
                "role": anchor.role,
                "source_span": {
                    "file": filename,
                    "start": {"line": start_node.lineno, "column": start_node.col_offset},
                    "end": {
                        "line": end_node.end_lineno or end_node.lineno,
                        "column": end_node.end_col_offset or 0,
                    },
                },
            }
        )
    return entries


def generate_from_graph(
    graph: vschema.VisualStrategyGraph, *, filename: str = "strategy.py"
) -> dict[str, Any]:
    """검증을 통과한 그래프 → 실행 가능한 코드 + authoritative source map.

    그래프가 유효하지 않으면 `VisualGraphError`로 멈춘다 — 미리보기가 필요하면
    `preview_from_graph()`를 쓴다. 반환한 map의 `entries`는 **모든 노드**를 덮는다:
    노드 하나가 코드에 남지 않으면 그 노드의 오류는 코드에서 가리킬 곳이 없다.
    """
    spec = vschema.compile_graph(graph)
    index = vschema.build_index(graph)
    emitter = _GraphEmitter(index, preview=False)
    source = emitter.emit()
    entries = _entries_from_anchors(source, emitter.anchors, filename)

    covered = {entry["node_id"] for entry in entries}
    expected = {node.id for node in graph.nodes}
    if covered != expected:
        raise _Unrepresentable(f"source map이 덮지 못한 노드: {sorted(expected - covered)}")

    hashes = {
        "graph_hash": vschema.graph_hash(graph),
        "spec_hash": vschema.spec_hash(spec),
        "artifact_hash": vschema.source_hash(source),
        "compiler_version": vschema.COMPILER_VERSION,
    }
    return {
        "source": source,
        "spec": spec,
        "hashes": hashes,
        "source_map": {
            # 등급을 문자열로도 박는다 — 화면이 executable·preview_only 두 불리언을
            # 조합해 추론하면 한쪽만 보고 미리보기를 실행 산출물로 표시할 수 있다.
            "kind": "authoritative",
            "graph_hash": hashes["graph_hash"],
            "spec_hash": hashes["spec_hash"],
            "artifact_hash": hashes["artifact_hash"],
            "compiler_version": vschema.COMPILER_VERSION,
            "executable": True,
            "preview_only": False,
            "entries": entries,
        },
    }


def preview_from_graph(
    graph: vschema.VisualStrategyGraph,
    diagnostics: list[vschema.Diagnostic],
    *,
    filename: str = "strategy_preview.py",
    graph_revision: str | None = None,
) -> dict[str, Any] | None:
    """검증 실패 그래프 → **실행하지 않는** 진단 미리보기 코드 + provisional map.

    같은 그래프 바이트는 같은 미리보기 바이트를 낸다(같은 revision·compiler version이면
    같은 코드라는 계약). 빠진 입력은 기본값이 아니라 `__MISSING__`과 한국어 사유로 남는다.
    안전하게 만들 수 없으면 None — 없는 코드 줄을 지어내지 않는다.
    """
    if any(
        d.severity == "error" and d.code in PREVIEW_BLOCKING_CODES for d in diagnostics
    ):
        return None
    index = vschema.build_index(graph)
    emitter = _GraphEmitter(index, preview=True)
    try:
        source = emitter.emit()
        entries = _entries_from_anchors(source, emitter.anchors, filename)
    except (_Unrepresentable, SyntaxError, ValueError):
        return None

    gh = vschema.graph_hash(graph)
    preview_hash = vschema.source_hash(source)
    revision = graph_revision or gh[:12]
    return {
        "source": source,
        "executable": False,
        "preview_only": True,
        "graph_revision": revision,
        "graph_hash": gh,
        "compiler_version": vschema.COMPILER_VERSION,
        "preview_hash": preview_hash,
        "source_map": {
            "kind": "preview",
            "graph_hash": gh,
            "graph_revision": revision,
            "preview_hash": preview_hash,
            "compiler_version": vschema.COMPILER_VERSION,
            "executable": False,
            "preview_only": True,
            "entries": entries,
        },
    }


def attach_spans(
    diagnostics: list[vschema.Diagnostic], source_map: dict[str, Any] | None
) -> list[vschema.Diagnostic]:
    """진단에 코드 위치를 붙인다 — map이 없거나 그 노드가 없으면 `source_span`은 None으로 둔다."""
    if not source_map:
        return diagnostics
    spans = {e["node_id"]: e["source_span"] for e in source_map.get("entries", [])}
    out: list[vschema.Diagnostic] = []
    for diagnostic in diagnostics:
        span = spans.get(diagnostic.node_id) if diagnostic.node_id else None
        if span is None:
            out.append(diagnostic)
            continue
        out.append(diagnostic.model_copy(update={"source_span": vschema.SourceSpan(**span)}))
    return out


__all__ = [
    "MISSING",
    "PREVIEW_BLOCKING_CODES",
    "attach_spans",
    "generate_from_graph",
    "preview_from_graph",
    "spec_to_python",
]
