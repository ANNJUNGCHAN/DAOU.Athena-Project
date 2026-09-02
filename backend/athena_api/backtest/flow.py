"""코드 플로우 지도 — 전략 파이썬을 사람이 읽는 단계 목록으로 옮긴다(Paper 보드 08).

**왜 LLM이 아니라 `ast`인가.** 이 지도는 "지금 편집기에 있는 코드가 무슨 순서로 무엇을
하는가"를 말해야 한다. 모델에게 물으면 그럴듯하지만 코드와 어긋난 설명이 나올 수 있고,
어긋났다는 사실을 사용자가 알아챌 방법이 없다 — 초심자에게는 특히 그렇다. `ast`는 코드
그 자체를 읽으므로 지도와 코드가 갈라질 수 없다. 모르는 것은 `unknown`으로 남긴다.

**왜 4단계로 고정하나.** 전략 계약(§7.1)이 이미 그 모양을 강제한다 — `PARAMS`를 정하고,
`signals(df, p)` 안에서 지표를 만들고, 조건을 만들고, 두 열을 돌려준다. 단계를 코드마다
새로 발명하면 지도가 파일마다 달라져 한눈에 읽히지 않는다.

**경계 두 줄이 이 지도의 핵심이다.** 앱이 봉을 건네주는 지점과 앱이 체결·비용·성과를
가져가는 지점 — 초심자가 "내 코드가 수익률을 만든다"고 오해하는 자리가 정확히 여기다.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any, Literal

Stage = Literal["prepare", "indicators", "conditions", "output"]

# 단계 라벨 — 화면 문구의 SSoT다. 프런트가 따로 갖고 있으면 두 곳이 갈라진다.
STAGE_LABELS: dict[Stage, str] = {
    "prepare": "조절할 값을 정합니다",
    "indicators": "가격을 지표로 바꿉니다",
    "conditions": "사고·파는 순간을 찍습니다",
    "output": "두 열만 돌려줍니다",
}

STAGE_ORDER: tuple[Stage, ...] = ("prepare", "indicators", "conditions", "output")

# 앱이 맡는 구간 — 코드가 손댈 수 없다는 사실을 지도가 같이 말한다(보드 08 아래쪽 3칸).
APP_STAGES_BEFORE: tuple[dict[str, str], ...] = (
    {
        "key": "load",
        "title": "봉 데이터를 모읍니다",
        "detail": "캐시에 있는 봉을 날짜순으로 정리해 표 하나로 만듭니다",
    },
)
APP_STAGES_AFTER: tuple[dict[str, str], ...] = (
    {
        "key": "fill",
        "title": "사고·파는 가격을 정합니다",
        "detail": (
            "신호가 난 다음 봉의 시가로 체결합니다 — "
            "같은 봉 종가로 체결하면 미래를 본 것입니다"
        ),
    },
    {
        "key": "cost",
        "title": "비용을 뗍니다",
        "detail": "수수료·거래세·슬리피지를 뺀 다음 손익을 씁니다",
    },
    {
        "key": "metrics",
        "title": "성과를 냅니다",
        "detail": "지표 6장·자산곡선·체결 표를 결과 화면으로 보냅니다",
    },
)


@dataclass(frozen=True, slots=True)
class FlowNode:
    stage: Stage
    title: str
    first_line: int
    last_line: int
    source: str
    # 그 단계가 만들어낸 이름들(지표 별칭, 조건 변수 등). 화면 오른쪽 "데이터 모양"에 쓴다.
    produces: tuple[str, ...] = field(default_factory=tuple)
    # 그 단계가 호출한 지표 함수 이름(`bt.sma` → `sma`).
    calls: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class FlowMap:
    nodes: tuple[FlowNode, ...]
    params: tuple[str, ...]
    signals_first_line: int | None
    returns_columns: tuple[str, ...]
    # 정적으로 확인하지 못한 것들. 빈 튜플이 아니면 화면이 "여기는 확실하지 않습니다"를 붙인다.
    unknown: tuple[str, ...] = field(default_factory=tuple)
    error: str | None = None


def _lines(source: str) -> list[str]:
    return source.splitlines()


def _slice(lines: list[str], first: int, last: int) -> str:
    return "\n".join(lines[first - 1 : last])


def _assigned_names(node: ast.stmt) -> list[str]:
    if not isinstance(node, ast.Assign):
        return []
    out: list[str] = []
    for target in node.targets:
        if isinstance(target, ast.Name):
            out.append(target.id)
    return out


def _called_attrs(node: ast.AST) -> list[str]:
    """`bt.sma(...)` 같은 호출에서 `sma`만 걷는다 — 지표 이름 목록이 된다."""
    out: list[str] = []
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            func = child.func
            if isinstance(func, ast.Attribute):
                out.append(func.attr)
            elif isinstance(func, ast.Name):
                out.append(func.id)
    return out


def _params_names(tree: ast.Module) -> tuple[str, ...]:
    """모듈 최상위 `PARAMS = {...}`의 키. 리터럴이 아니면 읽지 않는다(실행하지 않는다)."""
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign) and "PARAMS" in _assigned_names(stmt):
            if isinstance(stmt.value, ast.Dict):
                return tuple(
                    k.value
                    for k in stmt.value.keys
                    if isinstance(k, ast.Constant) and isinstance(k.value, str)
                )
    return ()


def _literal_default(entry: ast.Dict) -> int | float | None:
    """`{"default": 20, ...}` 한 항목에서 숫자 default만 읽는다. 리터럴이 아니면 None."""
    for key, value in zip(entry.keys, entry.values, strict=False):
        if not (isinstance(key, ast.Constant) and key.value == "default"):
            continue
        if isinstance(value, ast.Constant) and isinstance(value.value, (int, float)):
            return None if isinstance(value.value, bool) else value.value
        return None
    return None


def params_defaults(source: str) -> dict[str, int | float]:
    """최상위 `PARAMS`의 숫자 기본값만 걷는다 — 코드 경로 실행에 넘길 파라미터의 바닥값이다.

    **왜 여기서 채우나.** 자식 프로세스는 `spec.json`이 준 params를 그대로 쓸 뿐
    `PARAMS`를 읽지 않는다(sandbox/__main__.py) — 아무도 병합하지 않으면 `p["fast"]`가
    KeyError로 터진다. `PARAMS`를 이미 `ast`로 읽는 이 모듈이 그 자리다.

    여기서도 코드를 실행하지 않는다(`build_flow`와 같은 규율). 리터럴이 아니면 모른다고
    하고 빈 딕셔너리를 돌려준다 — 지어낸 기본값으로 다른 전략을 돌리는 것보다 낫다.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return {}
    for stmt in tree.body:
        if not (isinstance(stmt, ast.Assign) and "PARAMS" in _assigned_names(stmt)):
            continue
        if not isinstance(stmt.value, ast.Dict):
            return {}
        out: dict[str, int | float] = {}
        for key, entry in zip(stmt.value.keys, stmt.value.values, strict=False):
            if not (isinstance(key, ast.Constant) and isinstance(key.value, str)):
                continue
            if not isinstance(entry, ast.Dict):
                continue
            default = _literal_default(entry)
            if default is not None:
                out[key.value] = default
        return out
    return {}


def _return_columns(ret: ast.Return | None) -> tuple[str, ...]:
    """`...[["entry", "exit"]]` 형태의 마지막 첨자에서 열 이름을 읽는다."""
    if ret is None or ret.value is None:
        return ()
    for child in ast.walk(ret.value):
        if isinstance(child, ast.Subscript) and isinstance(child.slice, ast.List):
            names = [
                e.value
                for e in child.slice.elts
                if isinstance(e, ast.Constant) and isinstance(e.value, str)
            ]
            if names:
                return tuple(names)
    return ()


def _is_condition_stmt(stmt: ast.stmt) -> bool:
    """비교·불리언 연산이 들어간 대입이면 "조건 만들기"로 본다.

    지표 계산과 조건 만들기를 가르는 실질적 기준이 이것이다 — 지표는 숫자 열을 만들고,
    조건은 그 열들을 비교해 참/거짓 열을 만든다. `cross_above` 같은 헬퍼도 이름으로 잡는다.
    """
    if not isinstance(stmt, ast.Assign):
        return False
    for child in ast.walk(stmt.value):
        if isinstance(child, (ast.Compare, ast.BoolOp)):
            return True
        if isinstance(child, ast.BinOp) and isinstance(child.op, (ast.BitOr, ast.BitAnd)):
            return True
    return any(name.startswith("cross_") for name in _called_attrs(stmt))


def build_flow(source: str) -> FlowMap:
    """전략 소스를 4단계 지도로 옮긴다. 파싱이 안 되면 `error`만 채워 돌려준다."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return FlowMap(
            nodes=(), params=(), signals_first_line=None, returns_columns=(),
            unknown=(), error=f"{exc.msg} ({exc.lineno}번째 줄)",
        )

    lines = _lines(source)
    params = _params_names(tree)
    unknown: list[str] = []

    signals_fn: ast.FunctionDef | None = None
    for stmt in tree.body:
        if isinstance(stmt, ast.FunctionDef) and stmt.name == "signals":
            signals_fn = stmt
            break

    nodes: list[FlowNode] = []

    # ① 준비 — signals() 앞의 모든 최상위 문장.
    prepare_stmts = [
        s for s in tree.body if not (isinstance(s, ast.FunctionDef) and s.name == "signals")
    ]
    if prepare_stmts:
        first = min(s.lineno for s in prepare_stmts)
        last = max(s.end_lineno or s.lineno for s in prepare_stmts)
        nodes.append(
            FlowNode(
                stage="prepare", title=STAGE_LABELS["prepare"],
                first_line=first, last_line=last, source=_slice(lines, first, last),
                produces=params,
            )
        )
    if not params:
        unknown.append("PARAMS를 리터럴 딕셔너리로 찾지 못했습니다 — 슬라이더를 만들 수 없습니다")

    if signals_fn is None:
        unknown.append("signals(df, p) 함수를 찾지 못했습니다")
        return FlowMap(
            nodes=tuple(nodes), params=params, signals_first_line=None,
            returns_columns=(), unknown=tuple(unknown),
        )

    body = [s for s in signals_fn.body if not isinstance(s, ast.Expr)]
    ret = next((s for s in body if isinstance(s, ast.Return)), None)
    computed = [s for s in body if not isinstance(s, ast.Return)]

    # **왜 문장별이 아니라 "첫 조건 이후 전부"로 가르나.** 문장마다 지표/조건을 판정하면
    # `stop = (close - atr*k).where(entry)` 같은 줄(숫자 열이지만 조건 계산의 일부)이
    # 지표 쪽으로 끌려가면서 두 단계의 줄 범위가 서로 겹친다. 겹치면 "칸을 누르면 그 줄이
    # 켜진다"는 화면 계약이 성립하지 않는다 — 한 줄이 두 칸에 속하게 된다.
    # 사람이 코드를 읽는 순서도 같다: 지표를 다 만든 다음부터 조건을 만든다.
    first_condition = next(
        (i for i, s in enumerate(computed) if _is_condition_stmt(s)), len(computed)
    )
    indicator_stmts = computed[:first_condition]
    condition_stmts = computed[first_condition:]

    for stage, stmts in (("indicators", indicator_stmts), ("conditions", condition_stmts)):
        if not stmts:
            continue
        first = min(s.lineno for s in stmts)
        last = max(s.end_lineno or s.lineno for s in stmts)
        produces: list[str] = []
        calls: list[str] = []
        for s in stmts:
            produces.extend(_assigned_names(s))
            calls.extend(_called_attrs(s))
        nodes.append(
            FlowNode(
                stage=stage,  # type: ignore[arg-type]
                title=STAGE_LABELS[stage],  # type: ignore[index]
                first_line=first, last_line=last, source=_slice(lines, first, last),
                produces=tuple(dict.fromkeys(produces)),
                calls=tuple(dict.fromkeys(calls)),
            )
        )

    columns = _return_columns(ret)
    if ret is not None:
        first = ret.lineno
        last = ret.end_lineno or ret.lineno
        nodes.append(
            FlowNode(
                stage="output", title=STAGE_LABELS["output"],
                first_line=first, last_line=last, source=_slice(lines, first, last),
                produces=columns,
            )
        )
    else:
        unknown.append("signals()에 return이 없습니다 — 신호를 돌려주지 않습니다")

    if columns and set(columns) != {"entry", "exit"}:
        unknown.append(
            f"반환 열이 entry·exit가 아닙니다: {list(columns)} — 엔진이 받지 못합니다"
        )

    return FlowMap(
        nodes=tuple(nodes),
        params=params,
        signals_first_line=signals_fn.lineno,
        returns_columns=columns,
        unknown=tuple(unknown),
    )


def to_payload(flow: FlowMap) -> dict[str, Any]:
    """라우트가 그대로 돌려줄 JSON 모양. 앱 구간 3칸도 여기서 같이 실어 보낸다 —
    화면이 문구를 따로 갖고 있으면 계약이 두 곳으로 갈라진다."""
    return {
        "error": flow.error,
        "params": list(flow.params),
        "returns_columns": list(flow.returns_columns),
        "unknown": list(flow.unknown),
        "app_before": [dict(s) for s in APP_STAGES_BEFORE],
        "app_after": [dict(s) for s in APP_STAGES_AFTER],
        "nodes": [
            {
                "stage": n.stage,
                "title": n.title,
                "first_line": n.first_line,
                "last_line": n.last_line,
                "source": n.source,
                "produces": list(n.produces),
                "calls": list(n.calls),
            }
            for n in flow.nodes
        ],
    }


__all__ = [
    "APP_STAGES_AFTER",
    "APP_STAGES_BEFORE",
    "STAGE_LABELS",
    "STAGE_ORDER",
    "FlowMap",
    "FlowNode",
    "Stage",
    "build_flow",
    "params_defaults",
    "to_payload",
]
