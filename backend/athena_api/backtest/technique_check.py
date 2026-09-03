"""기법 자동 검사 — 문법·계약·시험 실행 셋에 코드 원칙 넷을 더한다(차단 5 · 경고 2).

**왜 사람에게 묻지 않고 전부 자동인가**(사용자 확정 구도). 새 기법 화면에서 사용자가 하는 일은
질문 카드에 답하는 것뿐이다 — "검증을 돌릴까요?"는 그 목록에 없다. 코드가 바뀌면 검사가
알아서 돌고, 차단 항목이 다 통과해야 노드·흐름 창이 열린다.

**왜 앞이 실패하면 뒤를 건너뛰나.** 문법이 깨진 코드를 샌드박스에 넣으면 같은 사실을 두 번,
그것도 역추적이라는 더 어려운 말로 다시 듣는다. 순서대로 하나씩 — 지금 고칠 것 하나만 보인다.

**시험 실행은 결과를 남기지 않는다.** 캐시된 봉 300개로 `signals`만 돌린다 — 실행 이력(bt_run)도
저장된 지표도 만들지 않는다. 이 파일에 store가 없는 것이 그 규율의 표현이다(봉은 라우트가
읽어서 건네준다). 체결·비용·성과는 여기서 계산되지 않는다.

**대상이 없으면 시험 실행은 "모른다"로 남는다.** 봉 캐시가 없는데 진짜로 돌린 척하지 않는다 —
백필은 키움 쿼터를 태우는 행위라 이 경로가 몰래 부를 수 있는 것이 아니다.

**왜 severity가 항목마다 붙나.** 원칙 10의 완성 기준은 "문법·계약·시험 실행에 룩어헤드·워밍업이
통과하고 매직 넘버·구조 경고가 0"이다 — 앞 다섯은 틀리면 결과가 거짓말이 되니 차단이고, 뒤 둘은
코드가 읽히는 방식에 대한 권고다. 경고 하나에 노드 창이 닫히면 사용자는 원칙을 배우는 대신
원칙을 피해 다니게 된다. 그래서 `passed`는 **차단 항목만** 센다 — 화면은 세지 않고 이 값을 쓴다.

**왜 룩어헤드·매직 넘버를 `ast`로 보나.** 문자열 검색은 주석 속 `shift(-1)`을 잡고 진짜
`shift( -1 )`을 놓친다. 노드·흐름과 같은 규율이다 — 코드 그 자체를 읽으면 검사와 코드가
갈라질 수 없다(technique_nodes.py의 같은 문장).
"""

from __future__ import annotations

import ast
import math
from typing import Any

import pandas as pd

from athena_api.backtest.diagnose import diagnose
from athena_api.backtest.flow import _return_columns
from athena_api.backtest.runner import _run_code_signals
from athena_api.backtest.sandbox.guard import BLOCKED_TOP_LEVEL_IMPORTS, resolve_allowlist
from athena_api.backtest.technique_nodes import _columns_in_return, name_role

# 시험 실행에 쓰는 봉 수. "짧은 구간"의 정의는 여기 하나뿐이다 — 화면이 따로 갖고 있으면
# 로그에 적힌 숫자와 실제로 돌린 봉 수가 갈라진다.
DRYRUN_BARS = 300

CHECK_LABELS: tuple[tuple[str, str], ...] = (
    ("syntax", "문법·금지 import"),
    ("contract", "signals(df, p) 계약 · entry/exit 두 열"),
    ("dryrun", "짧은 구간 시험 실행"),
    ("lookahead", "미래를 보지 않음"),
    ("warmup", "워밍업 전 신호 없음"),
    ("magic", "매직 넘버 없음"),
    ("structure", "노드 단위 구조"),
)

# 차단(block)은 틀리면 결과가 거짓말이 되는 것, 경고(warn)는 코드가 읽히는 방식이다.
CHECK_SEVERITY: dict[str, str] = {
    "syntax": "block",
    "contract": "block",
    "dryrun": "block",
    "lookahead": "block",
    "warmup": "block",
    "magic": "warn",
    "structure": "warn",
}

# 앞 검사가 실패했을 때 뒤 검사가 다는 사유. 문구를 한 곳에 둔다.
_SKIPPED = "앞 검사가 먼저"
_NO_BARS = "봉 캐시 없음 — 대상을 정하면 시험 실행합니다"
_NO_WARMUP = "워밍업 길이를 추정할 수 없어 건너뜀"

_ALLOWED_HINT = "pandas·numpy·math·statistics·datetime·athena_bt"

# 원칙 7의 예외 — 항등·단위 값. 이것까지 PARAMS로 올리라고 하면 경고가 소음이 된다.
_PLAIN_NUMBERS: frozenset[float] = frozenset({0.0, 1.0, -1.0, 100.0, 0.5})

# `.iloc[i+1]`처럼 봉 번호를 직접 더하는 자리. `.loc`도 같은 사고가 난다.
_OFFSET_ATTRS: frozenset[str] = frozenset({"iloc", "loc", "iat", "at"})


def _check(check_id: str, ok: bool, detail: str) -> dict[str, Any]:
    label = dict(CHECK_LABELS)[check_id]
    return {
        "id": check_id,
        "label_ko": label,
        "ok": ok,
        "detail_ko": detail,
        "severity": CHECK_SEVERITY[check_id],
    }


def _join(items: list[str], limit: int = 4) -> str:
    """다 늘어놓으면 카드가 로그가 된다 — 앞의 몇 개와 나머지 개수만."""
    if len(items) <= limit:
        return " · ".join(items)
    return " · ".join(items[:limit]) + f" 외 {len(items) - limit}개"


def _import_roots(tree: ast.Module) -> list[tuple[str, int]]:
    """코드 어디에 있든 import를 걷는다 — 함수 안의 import도 샌드박스 가드가 검사한다
    (guard.py: strategy.py에서 정의된 함수의 `__globals__`가 전략 globals이므로)."""
    out: list[tuple[str, int]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out.extend((alias.name.split(".", 1)[0], node.lineno) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                out.append((".", node.lineno))
            elif node.module:
                out.append((node.module.split(".", 1)[0], node.lineno))
    return out


def _syntax_check(source: str) -> tuple[dict[str, Any], ast.Module | None, dict[str, Any] | None]:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        found = diagnose(f"SyntaxError: {exc.msg} (line {exc.lineno})", source)
        return (
            _check("syntax", False, found.title),
            None,
            {"message": found.title, "line": found.line or exc.lineno},
        )

    allowed = resolve_allowlist()
    for root, lineno in _import_roots(tree):
        if root == ".":
            message = "상대 import(`from . import ...`)는 전략 코드에서 쓸 수 없습니다"
        elif root in BLOCKED_TOP_LEVEL_IMPORTS:
            message = (
                f"{root} 모듈은 전략 코드에서 쓸 수 없습니다 — 파일·네트워크·프로세스에 "
                "닿는 모듈은 막혀 있습니다"
            )
        elif root not in allowed:
            message = (
                f"샌드박스가 허용하지 않는 import: {root} — "
                f"쓸 수 있는 것은 {_ALLOWED_HINT}뿐입니다"
            )
        else:
            continue
        return _check("syntax", False, message), tree, {"message": message, "line": lineno}

    return _check("syntax", True, "문법 OK · 금지 import 없음"), tree, None


def _signals_def(tree: ast.Module) -> ast.FunctionDef | None:
    for stmt in tree.body:
        if isinstance(stmt, ast.FunctionDef) and stmt.name == "signals":
            return stmt
    return None


def _declared_columns(fn: ast.FunctionDef) -> tuple[tuple[str, ...], int | None]:
    """`return`이 어떤 열을 돌려주는지 정적으로 읽는다. 못 읽으면 빈 튜플.

    `[["entry", "exit"]]` 모양은 flow.py가 이미 읽는다(`_return_columns`) — 같은 규칙을
    두 번 쓰지 않는다. 그 밖에 샌드박스가 받아주는 모양(`df.assign(entry=…)`·딕셔너리·
    두 시리즈 튜플)은 technique_nodes가 아는 것을 빌려 온다. 여기서 더 좁게 보면 샌드박스가
    잘 돌리는 코드를 검사가 막는다.
    """
    for stmt in ast.walk(fn):
        if not isinstance(stmt, ast.Return) or stmt.value is None:
            continue
        columns = _return_columns(stmt)
        if columns:
            return columns, stmt.lineno
        found = _columns_in_return(stmt.value)
        if found:
            return tuple(found), stmt.lineno
    return (), None


def _contract_check(tree: ast.Module) -> tuple[dict[str, Any], dict[str, Any] | None]:
    fn = _signals_def(tree)
    if fn is None:
        message = "최상위에 def signals(df, p): 함수가 없습니다 — 엔진이 부를 자리가 없습니다"
        return _check("contract", False, message), {"message": message, "line": None}

    positional = [*fn.args.posonlyargs, *fn.args.args]
    if len(positional) != 2:
        message = (
            f"signals()는 인자를 둘 받아야 합니다(df, p) — 지금은 {len(positional)}개입니다"
        )
        return _check("contract", False, message), {"message": message, "line": fn.lineno}

    columns, lineno = _declared_columns(fn)
    if not columns:
        # 정적으로 못 읽었을 뿐 계약을 어겼다는 뜻이 아니다 — 판정은 시험 실행에 맡긴다.
        detail = "signals(df, p) 있음 · 반환 열은 시험 실행에서 확인합니다"
        return _check("contract", True, detail), None

    missing = [name for name in ("entry", "exit") if name not in columns]
    if missing:
        message = (
            f"반환 열에 {'·'.join(missing)}이(가) 없습니다: {list(columns)} — 엔진이 받지 못합니다"
        )
        return _check("contract", False, message), {"message": message, "line": lineno}
    return _check("contract", True, "signals(df, p) 있음 · 반환 열 entry·exit"), None


# ── 코드를 읽는 조각들 ────────────────────────────────────────────────────────


def _number_of(node: ast.AST) -> float | None:
    """숫자 리터럴 하나. `-1`은 상수가 아니라 UnaryOp(USub, 1)이라 부호를 붙여 읽는다."""
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        inner = _number_of(node.operand)
        return None if inner is None else -inner
    if isinstance(node, ast.Constant) and not isinstance(node.value, bool):
        if isinstance(node.value, (int, float)):
            return float(node.value)
    return None


def _int_of(node: ast.AST | None) -> int | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return None if isinstance(node.value, bool) else node.value
    return None


def _arg_of(node: ast.Call, index: int, *names: str) -> ast.expr | None:
    """위치 인자든 이름 인자든 같은 자리로 본다 — `shift(-1)`과 `shift(periods=-1)`."""
    if index >= 0 and len(node.args) > index:
        return node.args[index]
    for keyword in node.keywords:
        if keyword.arg in names:
            return keyword.value
    return None


def _call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    if isinstance(node.func, ast.Name):
        return node.func.id
    return ""


def _top_functions(tree: ast.Module) -> dict[str, ast.FunctionDef]:
    """노드가 되는 것만 — 최상위 함수. 중첩 함수는 노드가 아니다(technique_nodes와 같은 선)."""
    return {s.name: s for s in tree.body if isinstance(s, ast.FunctionDef)}


def _params_dict(tree: ast.Module) -> ast.Dict | None:
    for stmt in tree.body:
        target: ast.expr | None = None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1:
            target = stmt.targets[0]
        elif isinstance(stmt, ast.AnnAssign):
            target = stmt.target
        if isinstance(target, ast.Name) and target.id == "PARAMS":
            if isinstance(stmt.value, ast.Dict):
                return stmt.value
    return None


def _doc_first_line(fn: ast.FunctionDef) -> str:
    doc = ast.get_docstring(fn)
    if not doc:
        return ""
    for line in doc.strip().splitlines():
        if line.strip():
            return line.strip()
    return ""


# ── 원칙 4 — 미래를 보지 않는다 ───────────────────────────────────────────────


def _future_index_step(node: ast.Subscript) -> float | None:
    """`.iloc[i + 1]`의 `+1`. 슬라이스(`[:i+1]`)는 오늘까지 누적이라 미래가 아니다."""
    index = node.slice
    if isinstance(index, ast.Tuple):
        targets = [e for e in index.elts if not isinstance(e, ast.Slice)]
    elif isinstance(index, ast.Slice):
        targets = []
    else:
        targets = [index]
    for target in targets:
        for inner in ast.walk(target):
            if not isinstance(inner, ast.BinOp) or not isinstance(inner.op, ast.Add):
                continue
            step = _number_of(inner.right)
            step = step if step is not None else _number_of(inner.left)
            if step is not None and step > 0:
                return step
    return None


def _lookahead_hits(tree: ast.Module) -> list[str]:
    """뒤 봉의 값을 당겨오는 자리를 줄 번호와 함께 모은다 — 없으면 빈 목록."""
    hits: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            name = _call_name(node)
            if name == "shift":
                amount = _number_of(_arg_of(node, 0, "periods") or ast.Constant(value=None))
                if amount is not None and amount < 0:
                    hits.append((node.lineno, f"shift({amount:g})은 다음 봉의 값을 당겨옵니다"))
            elif name == "roll":
                amount = _number_of(_arg_of(node, 1, "shift") or ast.Constant(value=None))
                if amount is not None and amount < 0:
                    hits.append((node.lineno, f"roll(..., {amount:g})은 뒤 봉을 앞으로 옮깁니다"))
            for keyword in node.keywords:
                if keyword.arg != "center" or not isinstance(keyword.value, ast.Constant):
                    continue
                if keyword.value.value is True:
                    label = name or "창"
                    hits.append((node.lineno, f"{label}(center=True)는 창의 절반이 미래입니다"))
        elif isinstance(node, ast.Subscript):
            base = node.value
            if not isinstance(base, ast.Attribute) or base.attr not in _OFFSET_ATTRS:
                continue
            step = _future_index_step(node)
            if step is not None:
                hits.append((node.lineno, f".{base.attr}[i+{step:g}]는 뒤 봉을 직접 읽습니다"))
    ordered = sorted(dict.fromkeys(hits))
    return [f"{lineno}번째 줄: {message}" for lineno, message in ordered]


# ── 원칙 5 — 워밍업 ──────────────────────────────────────────────────────────


def _param_defaults(tree: ast.Module) -> list[ast.expr]:
    params = _params_dict(tree)
    if params is None:
        return []
    out: list[ast.expr] = []
    for value in params.values:
        if not isinstance(value, ast.Dict):
            continue
        for key, item in zip(value.keys, value.values, strict=False):
            if isinstance(key, ast.Constant) and key.value == "default":
                out.append(item)
    return out


def _param_default_map(tree: ast.Module) -> dict[str, int]:
    """PARAMS 이름 → 정수 기본값. 창 인자에 `p["이름"]`으로 쓰인 것만 워밍업 길이에 쓴다."""
    params = _params_dict(tree)
    if params is None:
        return {}
    out: dict[str, int] = {}
    for name, value in zip(params.keys, params.values, strict=False):
        if not (isinstance(name, ast.Constant) and isinstance(name.value, str)):
            continue
        if not isinstance(value, ast.Dict):
            continue
        for key, item in zip(value.keys, value.values, strict=False):
            if isinstance(key, ast.Constant) and key.value == "default":
                n = _int_of(item)
                if n is not None:
                    out[name.value] = n
    return out


def _param_ref(node: ast.expr | None) -> str | None:
    """`p["lookback"]` / `p.get("lookback")` 이면 그 이름, 아니면 None."""
    is_p_index = (
        isinstance(node, ast.Subscript)
        and isinstance(node.value, ast.Name) and node.value.id == "p"
    )
    if is_p_index and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
        return node.slice.value
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        if (
            isinstance(node.func.value, ast.Name) and node.func.value.id == "p"
            and node.func.attr == "get" and node.args
            and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)
        ):
            return node.args[0].value
    return None


def _warmup_length(tree: ast.Module) -> int:
    """지표가 준비되기까지 필요한 봉 수의 추정치.

    창 리터럴(`rolling(20)`·`ewm(span=20)`·`period=14`)과, 그 자리에 `p["lookback"]`처럼
    쓰인 PARAMS의 기본값 중 가장 큰 것. **PARAMS 전부를 후보로 넣지 않는다** — 문턱값
    (oversold 30·overbought 70)이 창 길이로 오인돼 원칙대로 짠 코드를 막았다(실측).
    추정할 근거가 하나도 없으면 0 — 그때는 검사하지 않고 그 사실을 적는다.
    """
    defaults = _param_default_map(tree)
    lengths: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = _call_name(node)
        candidates: list[ast.expr | None] = [_arg_of(node, -1, "period")]
        if name == "rolling":
            candidates.append(_arg_of(node, 0, "window"))
        elif name == "ewm":
            candidates.append(_arg_of(node, -1, "span"))
        for c in candidates:
            n = _int_of(c)
            if n is None:
                ref = _param_ref(c)
                n = defaults.get(ref) if ref else None
            if n is not None:
                lengths.append(n)
    return max(lengths, default=0)


def _warmup_check(tree: ast.Module, signals: pd.DataFrame) -> dict[str, Any]:
    length = _warmup_length(tree)
    if length <= 1:
        return _check("warmup", True, _NO_WARMUP)
    head = length - 1  # 창이 n봉이면 앞 n-1봉이 NaN이다 — 그 구간에 신호가 있으면 안 된다.
    entry = int(_bool_column(signals, "entry").head(head).sum())
    exit_ = int(_bool_column(signals, "exit").head(head).sum())
    if entry or exit_:
        return _check(
            "warmup",
            False,
            f"앞 {head}봉 안에 entry {entry}개 · exit {exit_}개 — 지표가 준비되기 전 봉입니다",
        )
    return _check("warmup", True, f"워밍업 {length}봉 · 앞 {head}봉에 신호 없음")


# ── 원칙 7 — 매직 넘버 ───────────────────────────────────────────────────────


def _params_numbers(tree: ast.Module) -> set[float]:
    """PARAMS 안의 모든 숫자 — default·min·max·step 어디에 있든 전략이 정한 값이다."""
    params = _params_dict(tree)
    if params is None:
        return set()
    found = {_number_of(node) for node in ast.walk(params)}
    return {value for value in found if value is not None}


def _magic_hits(tree: ast.Module) -> list[str]:
    """함수 본문에 남은 숫자 리터럴. 항등·단위 값과 PARAMS에 적힌 값은 뺀다."""
    allowed = set(_PLAIN_NUMBERS) | _params_numbers(tree)
    hits: list[tuple[int, float]] = []
    for fn in _top_functions(tree).values():
        negated: set[int] = set()
        for node in ast.walk(fn):
            if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
                if _number_of(node) is None:
                    continue
                # `-1`을 두 번 세지 않는다 — 안쪽 상수는 이미 부호까지 읽었다.
                negated.add(id(node.operand))
            elif not isinstance(node, ast.Constant) or id(node) in negated:
                continue
            value = _number_of(node)
            if value is None or value in allowed:
                continue
            hits.append((node.lineno, value))
    return [f"{lineno}번째 줄: {value:g}" for lineno, value in dict.fromkeys(hits)]


# ── 원칙 2·3 — 노드 단위 구조 ─────────────────────────────────────────────────


def _structure_issues(tree: ast.Module) -> list[str]:
    """함수 하나가 노드 하나이고 docstring이 그 설명이라는 원칙을, 이 코드가 지켰는지."""
    functions = _top_functions(tree)
    if not functions:
        return ["최상위 함수가 없습니다 — 노드로 그릴 것이 없습니다"]

    issues: list[str] = []
    others = [name for name in functions if name != "signals"]
    if not others:
        issues.append(
            "함수로 나누면 노드가 생깁니다 — 지표 compute_*, 진입 should_enter, 청산 should_exit"
        )
    else:
        # 역할은 이름이 정한다 — 그 표는 technique_nodes 하나뿐이다(ROLE_TOKENS).
        roles = {name_role(name) for name in others}
        missing = [
            label
            for role, label in (
                ("entry", "진입 판단(should_enter)"),
                ("exit", "청산 판단(should_exit)"),
            )
            if role not in roles
        ]
        if missing:
            issues.append(f"{'·'.join(missing)} 함수가 없습니다 — 이름이 역할을 정합니다")

    undocumented = [f"{name}()" for name, fn in functions.items() if not _doc_first_line(fn)]
    if undocumented:
        issues.append(f"노드 설명이 없습니다: {_join(undocumented, 6)} — 함수 첫 줄에 docstring")
    return issues


def _truthy(value: Any) -> bool:
    """CSV를 거쳐 온 신호 한 칸 — 문자열 "True"·NaN·0/1을 같은 규칙으로 읽는다."""
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1"}
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    return bool(value)


def _bool_column(frame: pd.DataFrame, name: str) -> pd.Series:
    column = frame[name]
    if column.dtype == bool:
        return column
    return column.map(_truthy).astype(bool)


def _stats(bars: pd.DataFrame, signals: pd.DataFrame) -> dict[str, int]:
    """시험 실행이 남긴 사실. 계산하지 않은 것은 넣지 않는다.

    `warmup_bars`는 **선두 무신호 구간**의 길이다 — 코드 경로는 지표 프레임을 사용자
    코드가 만들어서 앞 몇 봉이 NaN이었는지 부모가 알 수 없다(runner.py의 같은 사실).
    그래서 "지표가 덜 찼다"를 추정하지 않고, 실제로 신호가 하나도 없던 앞 구간만 센다.
    """
    entry = _bool_column(signals, "entry")
    exit_ = _bool_column(signals, "exit")
    fired = entry | exit_
    warmup = int(fired.values.argmax()) if bool(fired.any()) else int(len(fired))
    return {
        "warmup_bars": warmup,
        "entry": int(entry.sum()),
        "exit": int(exit_.sum()),
        "rows": int(len(bars)),
    }


async def run_checks(
    source: str,
    *,
    bars: pd.DataFrame | None = None,
    target_ko: str | None = None,
) -> dict[str, Any]:
    """검사 일곱을 순서대로 돌리고 명령창에 그대로 찍을 로그까지 만들어 돌려준다.

    `bars`는 라우트가 캐시에서 읽어 건넨 봉이다 — 이 모듈은 DB를 열지 않는다. 없으면
    시험 실행은 돌지 않고 그 사실을 그대로 말한다(없는 결과를 지어내지 않는다).

    `passed`는 **차단 항목만** 센다 — 경고(매직 넘버·구조)는 노드 창을 닫지 않는다.
    """
    log: list[str] = []
    error: dict[str, Any] | None = None

    log.append("$ ast.parse(technique.py)")
    syntax, tree, syntax_error = _syntax_check(source)
    log.append(syntax["detail_ko"])
    checks = [syntax]
    error = syntax_error

    log.append("$ ast: def signals(df, p) · return entry/exit")
    if not syntax["ok"] or tree is None:
        checks.append(_check("contract", False, _SKIPPED))
        log.append(_SKIPPED)
    else:
        contract, contract_error = _contract_check(tree)
        checks.append(contract)
        log.append(contract["detail_ko"])
        error = error or contract_error

    target_note = f"  # {target_ko}" if target_ko else ""
    log.append(f"$ python -m athena_api.backtest.sandbox{target_note}")
    stats: dict[str, int] | None = None
    fired: pd.DataFrame | None = None
    if not all(c["ok"] for c in checks):
        checks.append(_check("dryrun", False, _SKIPPED))
        log.append(_SKIPPED)
    elif bars is None or len(bars) == 0:
        checks.append(_check("dryrun", False, _NO_BARS))
        log.append(_NO_BARS)
    else:
        window = bars.tail(DRYRUN_BARS)
        outcome = await _run_code_signals(source, window, None)
        stdout = str(outcome.get("stdout") or "").strip()
        if stdout:
            log.extend(stdout.splitlines()[-20:])
        if outcome["ok"] and isinstance(outcome["signals_df"], pd.DataFrame):
            signals = outcome["signals_df"]
            missing = [name for name in ("entry", "exit") if name not in signals.columns]
            if missing:
                message = f"시험 실행 결과에 {'·'.join(missing)} 열이 없습니다"
                checks.append(_check("dryrun", False, message))
                log.append(message)
                error = error or {"message": message, "line": None}
            else:
                fired = signals
                stats = _stats(window, signals)
                detail = (
                    f"워밍업 {stats['warmup_bars']}봉 · "
                    f"entry {stats['entry']} · exit {stats['exit']}"
                )
                checks.append(_check("dryrun", True, detail))
                log.append(f"신호 계산 완료 · {stats['rows']}행 · {detail}")
        else:
            failure = outcome.get("error") or {}
            raw = (
                f"{failure.get('type', 'Error')}: {failure.get('message', '')}\n"
                f"{failure.get('traceback', '')}"
            )
            found = diagnose(raw, source)
            checks.append(_check("dryrun", False, found.title))
            log.append(found.title)
            log.append(found.why)
            error = error or {"message": found.title, "line": found.line}

    # ── 원칙 검사 넷. 문법이 깨졌으면 넷 다 읽을 코드가 없다. ─────────────────
    log.append("$ ast: shift(-n) · center=True · iloc[i+1]")
    if tree is None:
        checks.append(_check("lookahead", False, _SKIPPED))
        log.append(_SKIPPED)
    else:
        future = _lookahead_hits(tree)
        detail = _join(future) if future else "미래를 보는 참조 없음 — 오늘 종가로 오늘 판단합니다"
        checks.append(_check("lookahead", not future, detail))
        log.append(detail)
        if future and error is None:
            error = {"message": future[0], "line": int(future[0].split("번째", 1)[0])}

    log.append("$ 워밍업 구간 신호 확인")
    if tree is None or fired is None:
        checks.append(_check("warmup", False, _SKIPPED))
        log.append(_SKIPPED)
    else:
        warmup = _warmup_check(tree, fired)
        checks.append(warmup)
        log.append(warmup["detail_ko"])

    log.append("$ ast: 함수 안 숫자 리터럴")
    if tree is None:
        checks.append(_check("magic", False, _SKIPPED))
        log.append(_SKIPPED)
    else:
        numbers = _magic_hits(tree)
        detail = (
            f"기간·배수·문턱은 PARAMS로: {_join(numbers)}"
            if numbers
            else "함수 안에 남은 매직 넘버 없음"
        )
        checks.append(_check("magic", not numbers, detail))
        log.append(detail)

    log.append("$ ast: 최상위 함수 · docstring")
    if tree is None:
        checks.append(_check("structure", False, _SKIPPED))
        log.append(_SKIPPED)
    else:
        issues = _structure_issues(tree)
        detail = (
            " · ".join(issues)
            if issues
            else (
                f"최상위 함수 {len(_top_functions(tree))}개 · "
                "진입·청산 판단과 노드 설명이 모두 있습니다"
            )
        )
        checks.append(_check("structure", not issues, detail))
        log.append(detail)

    blocking = [c for c in checks if c["severity"] == "block"]
    passed = all(c["ok"] for c in blocking)
    ok_count = sum(1 for c in blocking if c["ok"])
    warned = sum(1 for c in checks if c["severity"] == "warn" and not c["ok"])
    summary = (
        f"검사 {ok_count}/{len(blocking)} 통과 — 노드·흐름을 그릴 수 있습니다"
        if passed
        else f"검사 {ok_count}/{len(blocking)} 통과 — 통과하지 못한 항목을 먼저 고칩니다"
    )
    if warned:
        # 경고는 통과를 막지 않는다 — 그 사실을 로그에도 적어야 사용자가 항목을 세지 않는다.
        summary += f" · 권고 {warned}건(통과를 막지 않습니다)"
    log.append(summary)
    return {
        "passed": passed,
        "checks": checks,
        "stats": stats,
        "log": log,
        "error": error,
    }


__all__ = ["CHECK_LABELS", "CHECK_SEVERITY", "DRYRUN_BARS", "run_checks"]
