"""기법 노드 — 기법 파이썬을 **그 코드가 실제로 가진 함수**로 노드화한다(사용자 확정 구도).

**왜 범용 팔레트가 없나.** 노드는 기법마다 다르다 — "이 기법 코드의 함수 한 단위"가 노드다.
미리 정한 노드 종류에 코드를 끼워 맞추면 사용자가 보는 그림과 실제 코드가 갈라지고, 갈라졌다는
사실을 초심자는 알아챌 방법이 없다.

**왜 LLM이 아니라 `ast`인가.** flow.py와 같은 이유다 — 모델에게 물으면 그럴듯하지만 코드와
어긋난 노드가 나온다. `ast`는 코드 그 자체를 읽으므로 노드와 코드가 갈라질 수 없다.

**함수가 `signals()` 하나뿐이면** 노드가 하나인 그림이 된다 — 그건 그림이 아니다. 그 경우에만
flow.py의 4단계를 노드로 준다(`granularity="stage"`). 4단계 라벨의 SSoT는 여전히 flow.py다.

**`returns_hint`·`role`은 휴리스틱이다.** 확신하지 못하면 `"unknown"`으로 두고 그 사실을
`unknown[]`에 남긴다 — 틀린 라벨을 확신처럼 보여주는 것보다 낫다(diagnose.py와 같은 규율).
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from typing import Any

from athena_api.backtest.flow import STAGE_LABELS, build_flow

Hint = str  # "Series<Number>" | "Series<Bool>" | "Number" | "DataFrame" | "None" | "unknown"

# 원칙 2의 이름 표(SSoT) — "이름이 역할을 정한다". 자동 검사의 구조 항목
# (technique_check._structure_issues)도 이 표를 그대로 읽는다: 두 곳에 따로 적으면 화면이
# 지표라 부르는 함수를 검사는 진입이라 부르게 된다.
#
# 부분 문자열이 아니라 토큰으로 가른다 — `close_ma`의 "close"가 청산으로 끌려가는 오판을
# 조금이라도 줄인다(`_tokens`가 snake_case·camelCase를 함께 쪼갠다). 위에서부터 먼저 맞는
# 줄이 이긴다: `stop_level`은 손절이지 지표가 아니다.
ROLE_TOKENS: dict[str, frozenset[str]] = {
    "entry": frozenset({"enter", "entry", "buy"}),
    "exit": frozenset({"exit", "sell", "stop", "close", "take"}),
    "indicator": frozenset({"compute", "level", "band", "line"}),
    "sizing": frozenset({"size", "position", "qty"}),
}

# `p["fast"]`는 숫자지 시리즈가 아니다 — signals(df, p) 계약이 두 번째 인자를 파라미터
# 딕셔너리로 못박고 있으니 그 이름들만 예외로 둔다.
_PARAM_ARG_NAMES: frozenset[str] = frozenset({"p", "params", "param", "cfg", "config"})

# `import athena_bt as bt` — 지표 모듈 호출은 수치 시리즈를 만든다(cross_*만 불리언).
_INDICATOR_MODULES: frozenset[str] = frozenset({"bt", "athena_bt", "ta"})

_SCALAR_BUILTINS: frozenset[str] = frozenset(
    {"len", "int", "float", "abs", "round", "sum", "max", "min"}
)
_BOOL_METHODS: frozenset[str] = frozenset(
    {"isna", "notna", "isnull", "notnull", "between", "isin", "any", "all", "duplicated"}
)
_WINDOW_METHODS: frozenset[str] = frozenset({"rolling", "ewm", "expanding"})
# 창(rolling/ewm) 위에서 부르면 시리즈, 시리즈에서 바로 부르면 스칼라다 — 그 둘을 가른다.
_REDUCE_METHODS: frozenset[str] = frozenset(
    {"mean", "std", "sum", "max", "min", "median", "var", "quantile", "count", "corr", "cov"}
)
_NUMERIC_METHODS: frozenset[str] = frozenset(
    {"diff", "pct_change", "cumsum", "cumprod", "cummax", "cummin", "rank"}
)
# 앞의 것을 그대로 물려받는 메서드 — `entry.shift(1)`은 불리언, `close.shift(1)`은 수치다.
_INHERIT_METHODS: frozenset[str] = frozenset(
    {
        "shift", "fillna", "ffill", "bfill", "where", "mask", "copy", "astype",
        "reindex", "dropna", "replace", "clip", "rename", "interpolate", "sort_index",
        "head", "tail",
    }
)


def _tokens(name: str) -> set[str]:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    return {t for t in re.split(r"[^a-zA-Z0-9]+", spaced.lower()) if t}


def _child_statements(node: ast.AST) -> list[ast.stmt]:
    """중첩 함수 안으로는 들어가지 않고 문장을 원문 순서로 편다.

    중첩 함수는 그 자체로 노드가 아니다(최상위 함수만 노드다) — 그 안의 대입까지 바깥
    함수의 환경으로 끌어오면 이름이 뒤섞인다.
    """
    out: list[ast.stmt] = []
    for stmt in ast.iter_child_nodes(node):
        if not isinstance(stmt, ast.stmt):
            continue
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        out.append(stmt)
        out.extend(_child_statements(stmt))
    return out


def _returns_of(fn: ast.FunctionDef) -> list[ast.Return]:
    return [s for s in _child_statements(fn) if isinstance(s, ast.Return)]


# ── 반환값 추정 ──────────────────────────────────────────────────────────────


def _is_window_call(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in _WINDOW_METHODS
    )


def _call_hint(node: ast.Call, env: dict[str, Hint], local: dict[str, Hint]) -> Hint:
    func = node.func
    if isinstance(func, ast.Name):
        if func.id in local:
            return local[func.id]
        if func.id in _SCALAR_BUILTINS:
            return "Number"
        return "unknown"
    if not isinstance(func, ast.Attribute):
        return "unknown"
    attr = func.attr
    if attr.startswith("cross_") or attr in _BOOL_METHODS:
        return "Series<Bool>"
    if attr in {"assign", "DataFrame", "concat"}:
        return "DataFrame"
    if attr == "Series":
        return "Series<Number>"
    if attr in _WINDOW_METHODS:
        return "Series<Number>"
    if attr in _REDUCE_METHODS:
        return "Series<Number>" if _is_window_call(func.value) else "Number"
    if attr in _NUMERIC_METHODS:
        return "Series<Number>"
    if attr in _INHERIT_METHODS:
        return _expr_hint(func.value, env, local)
    if isinstance(func.value, ast.Name) and func.value.id in _INDICATOR_MODULES:
        return "Series<Number>"
    return "unknown"


def _expr_hint(node: ast.expr, env: dict[str, Hint], local: dict[str, Hint]) -> Hint:
    """식 하나가 무엇을 만드는지 추정한다. 모르면 "unknown" — 지어내지 않는다."""
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            return "Series<Bool>"
        if isinstance(node.value, (int, float)):
            return "Number"
        if node.value is None:
            return "None"
        return "unknown"
    if isinstance(node, ast.Name):
        return env.get(node.id, "unknown")
    if isinstance(node, (ast.Compare, ast.BoolOp)):
        return "Series<Bool>"
    if isinstance(node, ast.UnaryOp):
        if isinstance(node.op, (ast.Invert, ast.Not)):
            return "Series<Bool>"
        return _expr_hint(node.operand, env, local)
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, (ast.BitAnd, ast.BitOr, ast.BitXor)):
            return "Series<Bool>"
        left = _expr_hint(node.left, env, local)
        right = _expr_hint(node.right, env, local)
        if "Series<Number>" in (left, right):
            return "Series<Number>"
        if left == right == "Number":
            return "Number"
        if "DataFrame" in (left, right):
            return "DataFrame"
        return "unknown"
    if isinstance(node, ast.IfExp):
        body = _expr_hint(node.body, env, local)
        orelse = _expr_hint(node.orelse, env, local)
        return body if body == orelse else "unknown"
    if isinstance(node, ast.Subscript):
        if isinstance(node.slice, ast.List):
            return "DataFrame"
        if isinstance(node.value, ast.Name) and node.value.id in _PARAM_ARG_NAMES:
            return "Number"
        if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
            return "Series<Number>"
        base = _expr_hint(node.value, env, local)
        return "Series<Number>" if base == "DataFrame" else base
    if isinstance(node, ast.Call):
        return _call_hint(node, env, local)
    if isinstance(node, (ast.Tuple, ast.List)):
        # (entry, exit) — 샌드박스가 DataFrame으로 받아준다(sandbox/__main__._coerce_signals).
        return "DataFrame" if len(node.elts) == 2 else "unknown"
    if isinstance(node, ast.Dict):
        keys = {k.value for k in node.keys if isinstance(k, ast.Constant)}
        return "DataFrame" if {"entry", "exit"} <= keys else "unknown"
    return "unknown"


def _arg_env(fn: ast.FunctionDef) -> dict[str, Hint]:
    """인자 이름으로 바닥 환경을 깐다 — `df`는 표, `p`는 파라미터 딕셔너리라는 §7.1 계약."""
    env: dict[str, Hint] = {}
    args = [*fn.args.posonlyargs, *fn.args.args, *fn.args.kwonlyargs]
    for arg in args:
        if arg.arg in {"df", "frame", "bars", "data", "ohlcv"}:
            env[arg.arg] = "DataFrame"
    return env


def _function_hint(fn: ast.FunctionDef, local: dict[str, Hint]) -> Hint:
    env = _arg_env(fn)
    for stmt in _child_statements(fn):
        if isinstance(stmt, ast.Assign):
            hint = _expr_hint(stmt.value, env, local)
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    env[target.id] = hint
        elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            if isinstance(stmt.target, ast.Name):
                env[stmt.target.id] = _expr_hint(stmt.value, env, local)

    returns = _returns_of(fn)
    if not returns:
        return "None"
    hints = [
        "None" if r.value is None else _expr_hint(r.value, env, local) for r in returns
    ]
    known = {h for h in hints if h != "unknown"}
    if not known:
        return "unknown"
    if len(known) == 1:
        return known.pop()
    # 조기 반환(`return None`)이 섞였을 뿐이면 나머지 하나로 본다.
    rest = known - {"None"}
    return rest.pop() if len(rest) == 1 else "unknown"


def _resolve_hints(functions: dict[str, ast.FunctionDef]) -> dict[str, Hint]:
    """함수끼리 서로를 부르므로 한 번에 못 푼다 — 고정점까지 몇 바퀴 돌린다.

    바퀴 수를 함수 개수로 묶는다(길어야 사슬 길이만큼이면 수렴한다). 순환 호출이면
    수렴하지 않고 "unknown"에 머무르는데, 그게 맞다 — 지어내지 않는다.
    """
    hints: dict[str, Hint] = dict.fromkeys(functions, "unknown")
    for _ in range(min(len(functions), 8) + 1):
        changed = False
        for name, fn in functions.items():
            new = _function_hint(fn, hints)
            if new != hints[name]:
                hints[name] = new
                changed = True
        if not changed:
            break
    return hints


# ── 호출 사슬(flows) ─────────────────────────────────────────────────────────


def _local_calls(node: ast.AST, names: set[str]) -> list[str]:
    """식 안에서 부른 **이 소스의 최상위 함수**만, 안쪽 호출이 먼저 오도록 걷는다.

    `calls`가 곧 노드 사이의 선이므로 노드가 아닌 이름(`bt.sma` 등)은 넣지 않는다 —
    넣으면 어디에도 닿지 않는 선이 생긴다.
    """
    out: list[str] = []

    def rec(n: ast.AST) -> None:
        for child in ast.iter_child_nodes(n):
            rec(child)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in names:
            out.append(n.func.id)

    rec(node)
    return list(dict.fromkeys(out))


def _referenced_names(node: ast.AST) -> set[str]:
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}


def _postorder(name: str, graph: dict[str, list[str]], stack: set[str]) -> list[str]:
    """`name`이 기대는 함수들을 먼저, 자기 자신을 마지막에 — 위상순 한 갈래."""
    if name in stack:
        return []
    stack.add(name)
    out: list[str] = []
    for dep in graph.get(name, []):
        out.extend(_postorder(dep, graph, stack))
    stack.discard(name)
    out.append(name)
    return list(dict.fromkeys(out))


@dataclass(slots=True)
class _SignalsCtx:
    local_fns: set[str]
    call_graph: dict[str, list[str]]
    # 변수 이름 → 그 이름을 마지막으로 만든 문장의 순번
    var_stmt: dict[str, int] = field(default_factory=dict)
    # 순번 → 그 문장이 만든 식
    stmt_value: dict[int, ast.expr] = field(default_factory=dict)


def _signals_ctx(
    signals_fn: ast.FunctionDef, local_fns: set[str], call_graph: dict[str, list[str]]
) -> tuple[_SignalsCtx, dict[str, tuple[int, ast.expr]]]:
    """signals() 본문을 훑어 "무엇이 무엇을 만들었나"와 entry/exit 생산식을 찾는다."""
    ctx = _SignalsCtx(local_fns=local_fns, call_graph=call_graph)
    produced: dict[str, tuple[int, ast.expr]] = {}
    for order, stmt in enumerate(_child_statements(signals_fn)):
        value: ast.expr | None = None
        if isinstance(stmt, ast.Assign):
            value = stmt.value
            targets = stmt.targets
        elif isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            value = stmt.value
            targets = [stmt.target]
        else:
            targets = []
        if value is None:
            continue
        ctx.stmt_value[order] = value
        for target in targets:
            if isinstance(target, ast.Name):
                ctx.var_stmt[target.id] = order
                column = _column_of(target.id)
                if column:
                    produced[column] = (order, value)
            elif isinstance(target, ast.Subscript) and isinstance(target.slice, ast.Constant):
                column = _column_of(str(target.slice.value))
                if column:
                    produced[column] = (order, value)

    # 반환식이 두 열을 그 자리에서 만들 수도 있다(`df.assign(entry=..., exit=...)`).
    last = max(ctx.stmt_value, default=0) + 1
    for ret in _returns_of(signals_fn):
        if ret.value is None:
            continue
        for column, expr in _columns_in_return(ret.value).items():
            produced.setdefault(column, (last, expr))
    return ctx, produced


def _column_of(name: str) -> str | None:
    """`exit_`는 파이썬 예약어를 피한 이름일 뿐 열 이름은 `exit`다(codegen이 그렇게 쓴다)."""
    if name in {"entry", "entry_"}:
        return "entry"
    if name in {"exit", "exit_"}:
        return "exit"
    return None


def _columns_in_return(value: ast.expr) -> dict[str, ast.expr]:
    """`df.assign(entry=X, exit=Y)` · `pd.DataFrame({"entry": X, ...})` · `(X, Y)`에서
    두 열을 만드는 식을 떼낸다 — 샌드박스가 받아주는 모양과 같은 목록이다."""
    out: dict[str, ast.expr] = {}
    for node in ast.walk(value):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                column = _column_of(kw.arg or "")
                if column:
                    out.setdefault(column, kw.value)
        elif isinstance(node, ast.Dict):
            for key, item in zip(node.keys, node.values, strict=False):
                if isinstance(key, ast.Constant) and isinstance(key.value, str):
                    column = _column_of(key.value)
                    if column:
                        out.setdefault(column, item)
    if not out and isinstance(value, (ast.Tuple, ast.List)) and len(value.elts) == 2:
        out["entry"], out["exit"] = value.elts[0], value.elts[1]
    return out


def _chain(order: int, expr: ast.expr, ctx: _SignalsCtx) -> list[str]:
    """한 열을 만드는 데 실제로 쓰인 함수들을, 기대는 것이 앞에 오도록 늘어놓는다."""
    picked: list[tuple[int, str]] = []
    seen_stmts: set[int] = set()

    def visit(node: ast.expr, at: int) -> None:
        for name in _local_calls(node, ctx.local_fns):
            picked.append((at, name))
        for ref in _referenced_names(node):
            index = ctx.var_stmt.get(ref)
            if index is None or index in seen_stmts or index >= at:
                continue
            seen_stmts.add(index)
            visit(ctx.stmt_value[index], index)

    visit(expr, order)
    out: list[str] = []
    for _, name in sorted(picked, key=lambda pair: pair[0]):
        for dep in _postorder(name, ctx.call_graph, set()):
            if dep not in out:
                out.append(dep)
    return out


# ── summary_ko ──────────────────────────────────────────────────────────────


def _summary(fn: ast.FunctionDef, lines: list[str]) -> str:
    """docstring 첫 줄, 없으면 def 바로 위 주석 덩어리의 **첫 줄**.

    덩어리의 마지막 줄이 아니라 첫 줄을 쓴다 — 이 저장소의 주석은 "왜"를 머리말로 쓰고
    아래에 단서를 붙이는 모양이라, 마지막 줄만 떼면 요약이 아니라 각주가 된다.
    """
    doc = ast.get_docstring(fn)
    if doc:
        first = doc.strip().splitlines()[0].strip()
        if first:
            return first
    start = min([d.lineno for d in fn.decorator_list] + [fn.lineno])
    block: list[str] = []
    index = start - 2  # 0-based로 def 바로 윗줄
    while index >= 0:
        text = lines[index].strip()
        if not text.startswith("#"):
            break
        block.append(text.lstrip("#").strip())
        index -= 1
    return block[-1] if block else ""


# ── role ────────────────────────────────────────────────────────────────────


def name_role(name: str) -> str | None:
    """이름만으로 정해지는 역할. 표에 없으면 None — 그때만 무엇을 돌려주는지로 가른다.

    검사(technique_check)가 "진입·청산 판단 함수가 있는가"를 물을 때도 이 함수로 묻는다.
    """
    if name == "signals":
        return "signals"
    tokens = _tokens(name)
    for role, words in ROLE_TOKENS.items():
        if tokens & words:
            return role
    return None


def _role(name: str, hint: Hint) -> str:
    named = name_role(name)
    if named is not None:
        return named
    return "indicator" if hint == "Series<Number>" else "helper"


# ── 조립 ────────────────────────────────────────────────────────────────────


def _stage_payload(source: str) -> dict[str, Any]:
    """함수가 `signals()` 하나뿐일 때 — flow.py의 4단계를 노드로 준다.

    노드 하나짜리 그림은 그림이 아니다. 단계 라벨은 flow.py가 SSoT이므로 여기서 새로
    짓지 않는다.
    """
    flow = build_flow(source)
    nodes: list[dict[str, Any]] = []
    for node in flow.nodes:
        produces = list(node.produces)
        if node.stage == "output":
            summary = f"돌려주는 열: {', '.join(produces)}" if produces else ""
        else:
            summary = f"만드는 값: {', '.join(produces)}" if produces else ""
        nodes.append(
            {
                "id": node.stage,
                "label": STAGE_LABELS[node.stage],
                "summary_ko": summary,
                "first_line": node.first_line,
                "last_line": node.last_line,
                "params": [],
                "returns_hint": "DataFrame" if node.stage == "output" else "unknown",
                "calls": [],
                # 네 칸 모두 signals() 안이다 — 이 그림에서 함수는 그것 하나뿐이다.
                "role": "signals",
                "stage": node.stage,
            }
        )
    return {
        "nodes": nodes,
        # 4단계는 진입·청산으로 갈리지 않는다 — 두 갈래를 비워야 화면이 한 갈래
        # "단계 흐름"으로 접는다(같은 4칸을 두 열에 겹쳐 그리던 실측 버그).
        "flows": {"entry": [], "exit": []},
        "granularity": "stage",
        "unknown": list(flow.unknown),
        "error": flow.error,
    }


def build_nodes(source: str) -> dict[str, Any]:
    """기법 소스를 노드·흐름 한 장으로 옮긴다. 파싱이 안 되면 `error`만 채워 돌려준다."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {
            "nodes": [],
            "flows": {"entry": [], "exit": []},
            "granularity": "function",
            "unknown": [],
            "error": f"{exc.msg} ({exc.lineno}번째 줄)",
        }

    lines = source.splitlines()
    functions: dict[str, ast.FunctionDef] = {}
    for stmt in tree.body:
        if isinstance(stmt, ast.FunctionDef):
            functions[stmt.name] = stmt

    if set(functions) == {"signals"}:
        return _stage_payload(source)

    unknown: list[str] = []
    if not functions:
        unknown.append("최상위 함수가 하나도 없습니다 — 노드로 나눌 것이 없습니다")

    hints = _resolve_hints(functions)
    local_fns = set(functions)
    call_graph = {name: _local_calls(fn, local_fns) for name, fn in functions.items()}

    nodes: list[dict[str, Any]] = []
    for name, fn in sorted(functions.items(), key=lambda item: item[1].lineno):
        hint = hints[name]
        first = min([d.lineno for d in fn.decorator_list] + [fn.lineno])
        args = [*fn.args.posonlyargs, *fn.args.args, *fn.args.kwonlyargs]
        nodes.append(
            {
                "id": name,
                "label": f"{name}()",
                "summary_ko": _summary(fn, lines),
                "first_line": first,
                "last_line": fn.end_lineno or fn.lineno,
                "params": [a.arg for a in args],
                "returns_hint": hint,
                "calls": call_graph[name],
                "role": _role(name, hint),
                "stage": None,
            }
        )
        if hint == "unknown":
            unknown.append(f"{name}()가 무엇을 돌려주는지 확실하지 않습니다")

    flows: dict[str, list[str]] = {"entry": [], "exit": []}
    signals_fn = functions.get("signals")
    if signals_fn is None:
        unknown.append("signals(df, p) 함수를 찾지 못했습니다 — 흐름을 만들 수 없습니다")
    else:
        ctx, produced = _signals_ctx(signals_fn, local_fns, call_graph)
        for column in ("entry", "exit"):
            found = produced.get(column)
            if found is None:
                unknown.append(
                    f"signals()에서 {column} 열을 만드는 자리를 찾지 못했습니다"
                )
                continue
            flows[column] = _chain(found[0], found[1], ctx)

    return {
        "nodes": nodes,
        "flows": flows,
        "granularity": "function",
        "unknown": unknown,
        "error": None,
    }


__all__ = ["ROLE_TOKENS", "build_nodes", "name_role"]
