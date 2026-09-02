"""흐름 지도 — 폼(스펙)과 코드를 같은 지도 한 장으로 옮긴다(Paper 보드 11~14).

**왜 지도가 첫 표면인가.** 사람은 대화로 지도를 고치고, 코드는 그 지도 뒤에 있다.
그래서 지도는 코드 조각이 아니라 **한국어 문장**으로만 말한다 — `cross_above(ma_fast,
ma_slow)`는 초심자에게 아무 말도 하지 않지만 "ma_fast가 ma_slow를 위로 뚫는 날"은 한다.

**왜 숫자를 지어내지 않나.** 칸 오른쪽의 "사실"은 마지막 실행이 실제로 만든 값만 싣는다
(runner.py가 결과에 남긴 신호 개수·워밍업·행 수). 그럴듯한 숫자를 채우면 초심자는 그것을
자기 전략의 성질로 믿는다 — 없는 값은 없는 채로 둔다(flow.py의 `unknown` 규율과 같다).

**왜 오류가 줄이 아니라 칸에 붙나.** "23번째 줄에서 KeyError"는 무엇을 고쳐야 하는지
말하지 않는다. 같은 오류를 "지표를 만드는 칸이 멈췄습니다"로 말하면 사람이 지도 위에서
고칠 자리를 안다 — 줄 번호는 코드 서랍을 열었을 때만 뜻이 있다.

**코드 경로는 flow.py를 그대로 재사용한다.** 코드에서 단계를 다시 읽는 규칙을 여기서 새로
짜면 같은 파일이 두 화면에서 다르게 보인다. 이 모듈은 그 4단계를 지도 칸으로 옮길 뿐이다.
"""

from __future__ import annotations

from typing import Any

from athena_api.backtest import codegen, flow, indicators
from athena_api.backtest.schema import (
    ConditionGroup,
    Logic,
    Operator,
    StrategySpec,
    resolve_params,
)

# 칸 번호 — Paper 보드 11의 ①~④ 그대로다. 앱 구간(데이터 준비·체결·비용·성과)은 번호가
# 없다: 사람이 고칠 수 없는 칸이라 "몇 번째로 고칠 것"의 대상이 아니기 때문이다.
NUMERALS: tuple[str, ...] = ("①", "②", "③", "④")

GUARD_TITLE = "지키는 선을 겁니다"
GUARD_CODE_NOTE = "코드 전략의 지키는 선은 앱 설정에서 옵니다"
BOUNDARY_AFTER_NOTE = "entry·exit 두 열만 받습니다"
FREE_CODE_TEXT = "지도가 못 담는 코드"

# 연산자 7종의 한국어 문장. 화면이 따로 갖고 있으면 두 곳이 갈라진다(STAGE_LABELS와 같은 규율).
_OPERATOR_SENTENCES: dict[Operator, str] = {
    Operator.CROSS_ABOVE: "{a}가 {b}를 위로 뚫는 날",
    Operator.CROSS_BELOW: "{a}가 {b}를 아래로 뚫는 날",
    Operator.GREATER_THAN: "{a}가 {b}보다 큰 날",
    Operator.LESS_THAN: "{a}가 {b}보다 작은 날",
    Operator.GREATER_EQUAL: "{a}가 {b} 이상인 날",
    Operator.LESS_EQUAL: "{a}가 {b} 이하인 날",
    Operator.EQUALS: "{a}가 {b}와 같은 날",
}

_LOGIC_JOINERS: dict[Logic, str] = {Logic.AND: " 그리고 ", Logic.OR: " 또는 "}

# 지표가 무엇을 보는가 — 레지스트리의 `source` 힌트를 한국어로만 옮긴다. 레지스트리에
# 한국어 이름 필드가 없으므로 지표 이름은 id를 그대로 쓴다(없는 라벨을 지어내지 않는다).
_SOURCE_LABELS: dict[str, str] = {
    "close": "종가",
    "open": "시가",
    "high": "고가",
    "low": "저가",
    "volume": "거래량",
    "hlc": "고가·저가·종가",
    "ohlcv": "시가·고가·저가·종가·거래량",
}


def _num(value: Any) -> str:
    """사람이 읽는 숫자 — 8.0은 "8"로 쓴다(문장이지 코드가 아니다)."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _node(
    node_id: str,
    numeral: str,
    title: str,
    *,
    lines: list[dict[str, Any]],
    facts: list[str],
    status: str,
    note: str | None = None,
    first_line: int | None = None,
    last_line: int | None = None,
    editable: bool,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "numeral": numeral,
        "title": title,
        "lines": lines,
        "facts": facts,
        "status": status,
        "note": note,
        "first_line": first_line,
        "last_line": last_line,
        "editable": editable,
    }


def _facts(result: dict[str, Any] | None) -> dict[str, list[str]]:
    """실행 결과(metrics 페이로드)에서 지도가 말할 수 있는 사실만 고른다.

    없는 키는 없는 대로 둔다 — 실행 전 지도에는 오른쪽 사실이 아예 뜨지 않는 것이 맞다.
    """
    if not result:
        return {}
    indicator_facts: list[str] = []
    condition_facts: list[str] = []
    rows = result.get("rows")
    if isinstance(rows, int):
        indicator_facts.append(f"df — {rows}행 × 5열")
    warmup = result.get("warmup_bars")
    if isinstance(warmup, int) and warmup > 0:
        indicator_facts.append(f"앞 {warmup}봉은 빈칸(워밍업)")
    counts = result.get("signal_counts")
    if isinstance(counts, dict) and {"entry", "exit"} <= set(counts):
        condition_facts.append(f"entry {counts['entry']}개 · exit {counts['exit']}개")
    return {"indicators": indicator_facts, "conditions": condition_facts}


def _condition_sentence(group: ConditionGroup) -> str:
    parts = [
        _OPERATOR_SENTENCES[c.operator].format(
            a=c.indicator, b=c.compare_to if isinstance(c.compare_to, str) else _num(c.compare_to)
        )
        for c in group.conditions
    ]
    return _LOGIC_JOINERS[group.logic].join(parts)


def _indicator_sentence(alias: str, indicator_id: str, params: dict[str, Any]) -> str:
    registry_spec = indicators.get(indicator_id)
    values = [_num(params[name]) for name in registry_spec.params if name in params]
    source = _SOURCE_LABELS.get(registry_spec.source, registry_spec.source)
    head = f"{alias} — {indicator_id.upper()}"
    if values:
        head += f"({', '.join(values)})"
    return f"{head} · {source}"


def _spec_nodes(spec: StrategySpec, facts: dict[str, list[str]]) -> list[dict[str, Any]]:
    param_lines = [
        {
            "role": None,
            "text": f"{name} {_num(p.default)} ({_num(p.min)}–{_num(p.max)}, {_num(p.step)}씩)",
        }
        for name, p in spec.strategy.params.items()
    ]
    # 지표 문장은 `$fast` 참조가 아니라 그 참조가 가리키는 값을 보여준다 — 사람이 읽는
    # 문장에 `$`가 남으면 그게 무엇인지 지도가 다시 설명해야 한다. 참조가 깨져 있으면
    # 치환하지 못한 원문 그대로 둔다(지어내지 않는다).
    try:
        resolved = resolve_params(spec)
    except ValueError:
        resolved = spec
    indicator_lines = [
        {"role": None, "text": _indicator_sentence(ind.alias, ind.id, ind.params)}
        for ind in resolved.strategy.indicators
    ]
    condition_lines = [
        {"role": "entry", "text": _condition_sentence(spec.strategy.entry)},
        {"role": "exit", "text": _condition_sentence(spec.strategy.exit)},
    ]
    risk = spec.risk
    stop = (
        f"손절 −{_num(risk.stop_loss.percent)}% 켜짐" if risk.stop_loss.enabled else "손절 꺼짐"
    )
    take = (
        f"익절 +{_num(risk.take_profit.percent)}% 켜짐"
        if risk.take_profit.enabled
        else "익절 꺼짐"
    )
    sizing = (
        "비중 전액 1종목"
        if risk.position.sizing == "all_in"
        else f"비중 {risk.position.sizing}"
    )
    guard_lines = [{"role": None, "text": t} for t in (stop, take, sizing)]
    return [
        _node("params", NUMERALS[0], flow.STAGE_LABELS["prepare"],
              lines=param_lines, facts=[], status="ok", editable=True),
        _node("indicators", NUMERALS[1], flow.STAGE_LABELS["indicators"],
              lines=indicator_lines, facts=facts.get("indicators", []),
              status="ok", editable=True),
        _node("conditions", NUMERALS[2], flow.STAGE_LABELS["conditions"],
              lines=condition_lines, facts=facts.get("conditions", []),
              status="ok", editable=True),
        _node("guard", NUMERALS[3], GUARD_TITLE,
              lines=guard_lines, facts=[], status="ok", editable=True),
    ]


def _code_lines(node: flow.FlowNode) -> list[dict[str, Any]]:
    """코드 칸의 문장 — 코드를 옮겨 적지 않고 "무엇이 나왔는가"만 짧게 말한다."""
    lines: list[dict[str, Any]] = []
    if node.produces:
        unit = "개" if node.stage == "prepare" else "열"
        text = f"{' · '.join(node.produces)} — {len(node.produces)}{unit}"
        lines.append({"role": None, "text": text})
    if node.calls:
        lines.append({"role": None, "text": f"{' · '.join(node.calls)} 호출"})
    return lines


def _code_nodes(flow_map: flow.FlowMap, facts: dict[str, list[str]]) -> list[dict[str, Any]]:
    by_stage = {n.stage: n for n in flow_map.nodes}
    nodes: list[dict[str, Any]] = []
    for numeral, node_id, stage in (
        (NUMERALS[0], "params", "prepare"),
        (NUMERALS[1], "indicators", "indicators"),
        (NUMERALS[2], "conditions", "conditions"),
    ):
        found = by_stage.get(stage)
        if found is None:
            nodes.append(
                _node(node_id, numeral, flow.STAGE_LABELS[stage],  # type: ignore[index]
                      lines=[], facts=[], status="unknown",
                      note="코드에서 이 단계를 찾지 못했습니다", editable=False)
            )
            continue
        nodes.append(
            _node(node_id, numeral, found.title,
                  lines=_code_lines(found), facts=facts.get(node_id, []), status="ok",
                  first_line=found.first_line, last_line=found.last_line, editable=False)
        )
    # 코드 전략의 지키는 선은 코드 안에 없다 — 폼의 risk가 엔진에 그대로 간다(§6.2).
    nodes.append(
        _node("guard", NUMERALS[3], GUARD_TITLE,
              lines=[], facts=[], status="unknown", note=GUARD_CODE_NOTE, editable=False)
    )
    return nodes


def _free_code(source: str, flow_map: flow.FlowMap) -> list[dict[str, Any]]:
    """어느 칸에도 들어가지 않은 줄. 코드가 지도보다 넓다는 사실을 숨기지 않는다."""
    covered: set[int] = set()
    for node in flow_map.nodes:
        covered.update(range(node.first_line, node.last_line + 1))
    # `def signals(df, p):` 줄은 지도의 틀이지 지도가 못 담은 코드가 아니다.
    if flow_map.signals_first_line is not None:
        covered.add(flow_map.signals_first_line)
    blocks: list[list[int]] = []
    current: list[int] = []
    for lineno, text in enumerate(source.splitlines(), start=1):
        stripped = text.strip()
        if lineno in covered or not stripped or stripped.startswith("#"):
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(lineno)
    if current:
        blocks.append(current)
    return [
        {"first_line": b[0], "last_line": b[-1], "text": FREE_CODE_TEXT} for b in blocks
    ]


def _attach_error(nodes: list[dict[str, Any]], error: dict[str, Any] | None) -> str | None:
    """오류를 칸 하나에 붙인다. 붙일 칸을 못 찾으면 붙이지 않고 그 문구를 돌려준다 —
    "아무 칸이나 빨갛게 칠하기"는 지도를 거짓말로 만든다."""
    if not error:
        return None
    message = str(error.get("message") or "").strip()
    if not message:
        return None
    target: dict[str, Any] | None = None
    node_id = error.get("node")
    if isinstance(node_id, str):
        target = next((n for n in nodes if n["id"] == node_id), None)
    lineno = error.get("lineno")
    if target is None and isinstance(lineno, int):
        target = next(
            (
                n
                for n in nodes
                if n["first_line"] is not None and n["first_line"] <= lineno <= n["last_line"]
            ),
            None,
        )
    if target is None:
        return message
    target["status"] = "error"
    target["note"] = message
    return None


def build_map(
    *,
    spec: StrategySpec | None = None,
    source: str | None = None,
    result: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
    version: int | None = None,
) -> dict[str, Any]:
    """지도 한 장을 만든다. `spec`(폼)이나 `source`(코드) 중 정확히 하나를 받는다.

    두 경로가 같은 payload를 내는 것이 이 함수의 존재 이유다 — 화면이 폼과 코드에
    다른 렌더러를 두면 "지도가 첫 표면"이라는 규칙이 경로마다 갈라진다.
    """
    if (spec is None) == (source is None):
        raise ValueError("spec(폼)과 source(코드) 중 정확히 하나만 줘야 한다")

    facts = _facts(result)
    boundary_lines: dict[str, int] | None = None
    if spec is not None:
        nodes = _spec_nodes(spec, facts)
        unknown: list[str] = []
        free_code: list[dict[str, Any]] = []
        flow_error: str | None = None
        # 폼 지도 뒤의 코드는 codegen이 만든다 — 서랍의 "N줄"이 지어낸 숫자가 되지 않게
        # 실제로 만들어 세어본다. 지도에서 나온 코드라 언제나 지도와 일치한다.
        generated = codegen.spec_to_python(spec)
        code: dict[str, Any] | None = {
            "lines": len(generated.splitlines()),
            "matches_map": True,
        }
    else:
        flow_map = flow.build_flow(source or "")
        nodes = _code_nodes(flow_map, facts)
        unknown = list(flow_map.unknown)
        free_code = _free_code(source or "", flow_map) if unknown else []
        flow_error = flow_map.error
        output = next((n for n in flow_map.nodes if n.stage == "output"), None)
        if output is not None:
            boundary_lines = {"first_line": output.first_line, "last_line": output.last_line}
        code = {
            "lines": len((source or "").splitlines()),
            "matches_map": not unknown and not free_code,
        }

    unattached = _attach_error(nodes, error)
    messages = [m for m in (flow_error, unattached) if m]

    target = None
    if spec is not None and spec.data is not None:
        target = {
            "symbol": spec.data.symbols[0],
            "period": spec.data.period,
            "adjusted": spec.data.adjusted,
            "from": spec.data.from_,
            "to": spec.data.to,
        }

    return {
        "version": version,
        "source_kind": "spec" if spec is not None else "code",
        "target": target,
        "app_before": [dict(s) for s in flow.APP_STAGES_BEFORE],
        "app_after": [dict(s) for s in flow.APP_STAGES_AFTER],
        "boundary_after_note": BOUNDARY_AFTER_NOTE,
        "boundary_after_lines": boundary_lines,
        "nodes": nodes,
        "free_code": free_code,
        "unknown": unknown,
        "error": " · ".join(messages) if messages else None,
        "code": code,
    }


__all__ = [
    "BOUNDARY_AFTER_NOTE",
    "GUARD_TITLE",
    "NUMERALS",
    "build_map",
]
