"""노드 카드 — 감시 파일의 최상위 함수 하나가 칸 하나다(보드 10·11·12).

`backtest.flow.build_flow`는 4단계(prepare/indicators/conditions/output) 지도만 내고 보조
함수는 prepare 한 칸으로 뭉친다. 그래서 여기서는 함수 단위로 직접 분해하고, 지도는
`unknown[]`·`returns_columns` 경고를 모으는 데만 쓴다.

칸의 재료:
- 제목(한국어): 파일 안 최상위 리터럴 `NODE_LABELS = {함수명: "제목"}` 또는 넘겨받은 labels.
  없으면 영어 함수명으로 대신하고 경고를 남긴다(B-11).
- 영어명: 함수명 그대로(참고 표기).
- 들어감: 계측 기록(`node_io.calls[함수명].args/kwargs`)을 매개변수 이름과 짝지은 값.
- 나옴: 계측 기록의 반환 마지막 행. `signals`는 반환 행의 `entry`(발화 여부).
- 이번 실행에서 안 불린 함수는 `unused=True` — 실패가 아니다(B-23).
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any

from athena_api.backtest import flow as flow_mod

LABEL_MISSING_WARNING = "이름표 없음 — 영어 이름으로 표시"


@dataclass
class NodeCard:
    fn: str
    title_ko: str
    title_en: str
    inputs: list[dict[str, Any]] = field(default_factory=list)
    output: Any = None
    unused: bool = False
    called: bool = False
    changed: bool = False
    error: str | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "fn": self.fn,
            "title_ko": self.title_ko,
            "title_en": self.title_en,
            "inputs": [dict(i) for i in self.inputs],
            "output": self.output,
            "unused": self.unused,
            "called": self.called,
            "changed": self.changed,
            "error": self.error,
            "warnings": list(self.warnings),
        }


def top_level_functions(tree: ast.Module) -> list[ast.FunctionDef]:
    fns = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    # signals는 흐름의 끝 — 항상 마지막 칸.
    fns.sort(key=lambda n: 1 if n.name == "signals" else 0)
    return fns


def node_labels_from_source(tree: ast.Module) -> dict[str, str]:
    """최상위 `NODE_LABELS = {...}` 리터럴만 읽는다(실행 없음)."""
    for node in tree.body:
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
        else:
            continue
        if not any(isinstance(t, ast.Name) and t.id == "NODE_LABELS" for t in targets):
            continue
        value = node.value if isinstance(node, ast.Assign) else node.value
        try:
            raw = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            return {}
        if isinstance(raw, dict):
            return {str(k): str(v) for k, v in raw.items()}
    return {}


def _param_names(fn: ast.FunctionDef) -> list[str]:
    args = fn.args
    names = [a.arg for a in args.posonlyargs] + [a.arg for a in args.args]
    if args.vararg:
        names.append("*" + args.vararg.arg)
    names += [a.arg for a in args.kwonlyargs]
    return names


def _inputs_for(fn: ast.FunctionDef, record: dict[str, Any] | None) -> list[dict[str, Any]]:
    names = _param_names(fn)
    if not record:
        return [{"name": n, "value": None} for n in names]
    args = list(record.get("args") or [])
    kwargs = dict(record.get("kwargs") or {})
    rows: list[dict[str, Any]] = []
    for i, name in enumerate(names):
        if name.startswith("*"):
            rows.append({"name": name, "value": args[i:]})
            break
        if i < len(args):
            rows.append({"name": name, "value": args[i]})
        elif name in kwargs:
            rows.append({"name": name, "value": kwargs.pop(name)})
        else:
            rows.append({"name": name, "value": None})
    for name, value in kwargs.items():
        rows.append({"name": name, "value": value})
    return rows


def _output_for(fn_name: str, record: dict[str, Any] | None) -> Any:
    if not record:
        return None
    returned = record.get("returned")
    if fn_name == "signals" and isinstance(returned, dict) and "entry" in returned:
        return returned["entry"]
    return returned


def build_nodes(
    source: str,
    node_io: dict[str, Any] | None,
    labels: dict[str, str] | None = None,
) -> tuple[list[NodeCard], list[str]]:
    """(카드 목록, 파일 수준 경고). 파싱이 안 되면 카드 0개 + 경고 1개."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [], [f"문법 오류 — {exc.lineno}번째 줄"]
    calls = (node_io or {}).get("calls") or {}
    file_labels = node_labels_from_source(tree)
    merged = {**file_labels, **(labels or {})}
    cards: list[NodeCard] = []
    for fn in top_level_functions(tree):
        record = calls.get(fn.name)
        title = merged.get(fn.name)
        card = NodeCard(
            fn=fn.name,
            title_ko=title or fn.name,
            title_en=fn.name,
            inputs=_inputs_for(fn, record),
            output=_output_for(fn.name, record),
            called=record is not None,
            unused=record is None,
            error=(record or {}).get("error"),
        )
        if not title:
            card.warnings.append(LABEL_MISSING_WARNING)
        cards.append(card)

    warnings: list[str] = []
    fm = flow_mod.build_flow(source)
    if fm.error:
        warnings.append(fm.error)
    warnings.extend(fm.unknown)
    if fm.returns_columns and set(fm.returns_columns) != {"entry", "exit"}:
        warnings.append("반환 열이 entry·exit 두 개가 아님")
    return cards, warnings
