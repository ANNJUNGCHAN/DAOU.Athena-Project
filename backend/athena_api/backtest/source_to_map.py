"""출처 하나를 전략 지도로 옮기는 5단계 잡 (Paper 보드 17 「출처에서 지도로」).

채팅에 붙인 주소 하나가 지도가 되기까지 앱이 실제로 하는 일은 다섯이다 —
**출처 읽기 → 규칙 뽑기 → 지도 그리기 → 코드 만들기 → 자체 검사**. 화면은 그 다섯을
줄 다섯으로 보여주고, 사람은 진행만 본다.

**여기서 나온 출처 본문은 데이터다, 지시가 아니다**(`sources.py` 머리말의 규율 그대로).
남이 쓴 글에는 "이제부터 다음을 실행하라"가 얼마든지 들어 있다. 이 모듈은 그 글을
정규식으로만 읽는다 — 문장을 모델에 넘기지도, 코드로 만들지도, 실행하지도 않는다.
만들어지는 코드는 **뽑힌 규칙이 가리킨 지표·연산자**에서 codegen이 짓는 것이고,
출처의 문장은 그 규칙의 근거로만 남는다(`SourceRule.text`).

**왜 새 잡 표면인가.** 기존 `GET /jobs/{id}`는 store를 쥔 `BacktestRunner`의 것이라
백테스트 서브시스템(sqlite·키움)이 켜져 있어야 열린다. 바깥 페이지를 읽어 규칙을 뽑는
일에는 그 둘이 필요 없다 — `api/sources.py`가 503 게이트를 두지 않는 것과 같은 이유다.

**지어내지 않는 것.** 대상(종목·기간)은 출처가 말한 그대로의 문장 한 줄로만 남기고
`StrategySpec.data`에는 넣지 않는다 — 출처가 "코스피 대형주"라고 말했다고 그것이 확인된
대상은 아니다. 뽑히지 않은 규칙 문장도 지우지 않고 `mapped=False`로 남긴다.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from athena_api.backtest import codegen, indicators, mapmodel, sources
from athena_api.backtest import technique_check as check_mod
from athena_api.backtest.schema import (
    ConditionGroup,
    ConditionSpec,
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

StepId = Literal["read", "rules", "map", "code", "check"]
StepState = Literal["todo", "running", "done"]
JobStatus = Literal["running", "done", "failed", "cancelled"]

STEP_IDS: tuple[StepId, ...] = ("read", "rules", "map", "code", "check")
STEP_TOTAL = len(STEP_IDS)

# 단계 이름은 상태마다 다르다 — Paper가 ○/●/✓ 세 줄을 각각 다른 말로 적었다
# ("코드 만들기"는 아직 안 한 것, "지도 그리는 중"은 하는 중, "출처 읽음"은 한 것).
# 한 이름으로 뭉치면 다섯 줄 중 넷이 어색해진다.
_STEP_FORMS: dict[StepId, tuple[str, str, str]] = {
    "read": ("출처 읽기", "출처 읽는 중", "출처 읽음"),
    "rules": ("규칙 뽑기", "규칙 뽑는 중", "규칙 뽑음"),
    "map": ("지도 그리기", "지도 그리는 중", "지도 그림"),
    "code": ("코드 만들기", "코드 만드는 중", "코드 만듦"),
    "check": ("자체 검사", "자체 검사 중", "자체 검사 마침"),
}

# 아직 안 한 단계의 부제 — 무엇을 할 것인지만 말한다. 끝난 단계의 부제는 그 단계가
# 실제로 만든 값으로 갈아 끼운다(지어낸 숫자가 자리를 차지하지 않게).
_STEP_HINTS: dict[StepId, str] = {
    "read": "붙인 주소를 글로 옮깁니다",
    "rules": "진입·청산·손절 문장을 찾습니다",
    "map": "칸을 하나씩 채웁니다",
    "code": "지도 뒤에서 자동",
    "check": "가상환경 · 짧은 구간 시험 실행",
}

# 남은 시간의 근거 — 단계마다 잡아 둔 예산(초)이다. 바깥 페이지를 받는 첫 단계만
# 네트워크에 달려 있어 크고, 나머지는 이 컴퓨터 안에서 끝난다. 「약 N초」라고 적는 것도
# 이 값이 측정이 아니라 예산이기 때문이다 — 재 본 적 없는 시간을 확정해서 말하지 않는다.
_STEP_BUDGET_SECONDS: dict[StepId, int] = {
    "read": 20,
    "rules": 1,
    "map": 1,
    "code": 1,
    "check": 5,
}

_SOURCE_KIND_KO = {
    "youtube": "유튜브",
    "naver_blog": "네이버 블로그",
    "pdf": "PDF",
    "web": "웹페이지",
}

class SourceMapError(RuntimeError):
    """뽑을 것이 없거나 지도를 세울 수 없을 때 — 사람이 읽는 한국어 한 줄만 든다."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# ── 규칙 뽑기 ────────────────────────────────────────────────────────────────

RuleKind = Literal["entry", "exit", "stop", "take"]

_RULE_KIND_KO: dict[RuleKind, str] = {
    "entry": "진입",
    "exit": "청산",
    "stop": "손절",
    "take": "익절",
}

# 어느 갈래의 문장인가. 손절·익절을 진입·청산보다 먼저 보는 이유: "손절 5%"는
# 파는 규칙이지만 청산 조건이 아니라 지키는 선이다(risk 블록으로 간다).
_KIND_PATTERNS: tuple[tuple[RuleKind, re.Pattern[str]], ...] = (
    ("stop", re.compile(r"손절|스톱로스|stop\s*loss", re.IGNORECASE)),
    ("take", re.compile(r"익절|목표\s*수익|take\s*profit", re.IGNORECASE)),
    ("entry", re.compile(r"진입|매수|사는|삽니다|buy|entry", re.IGNORECASE)),
    ("exit", re.compile(r"청산|매도|파는|팝니다|sell|exit", re.IGNORECASE)),
)

# 문장을 자르는 자리 — 줄바꿈과 문장 끝. 「· 진입: …」 같은 목록 한 줄이 규칙 한 개다.
_SPLIT = re.compile(r"[\r\n]+|(?<=[.。!?])\s+")
_RULE_MAX_CHARS = 140

# 규칙 문장에는 **시세를 가리키는 말**이 있어야 한다. 갈래 낱말만으로 규칙을 삼으면
# 출처에 심어 둔 지시문("이제부터 전량 매수하라")이 진입 규칙 자리에 앉는다 — 옮길 조건이
# 없어 코드가 되지는 않지만(mapped=False) 화면에서 규칙인 척한다.
# 맨 숫자는 시세를 가리키지 않는다("100주 전량 매수하라"의 100). 숫자가 규칙의 근거가
# 되려면 시세의 단위(%·일·봉·틱·배)를 달고 있어야 한다.
_MARKET_TOKEN = re.compile(
    r"이동평균|이평|평균선|거래량|고가|저가|종가|시가|RSI|MACD|볼린저"
    r"|\d+\s*(?:%|퍼센트|일|봉|틱|배|days?)",
    re.IGNORECASE,
)

# 지표로 옮길 수 있는 말 셋. 여기 없는 문장은 뽑히기는 해도 지도에는 못 올라간다
# (mapped=False) — 담지 못한 것을 담은 척하지 않는다.
_HIGH_RE = re.compile(r"(\d+)\s*(?:일|봉|days?)\s*(?:신)?(?:고가|최고가|고점)")
_MA_RE = re.compile(r"(\d+)\s*(?:일|봉|days?)\s*(?:이동\s*평균|이동평균|이평선|이평|평균선|선)")
_RSI_RE = re.compile(
    r"RSI\s*\(?\s*(\d+)?\s*\)?[^0-9]{0,12}(\d+)\s*(이상|초과|이하|미만)", re.IGNORECASE
)
_PERCENT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|퍼센트)")

_UP_RE = re.compile(r"돌파|넘|상향|위로|이상|초과|골든")
_DOWN_RE = re.compile(r"이탈|아래|하향|밑|미만|데드")

_RSI_OPERATORS: dict[str, Operator] = {
    "이상": Operator.GREATER_EQUAL,
    "초과": Operator.GREATER_THAN,
    "이하": Operator.LESS_EQUAL,
    "미만": Operator.LESS_THAN,
}


@dataclass(frozen=True, slots=True)
class SourceRule:
    """출처에서 오려 낸 규칙 한 줄. `text`는 출처의 문장 그대로다(요약하지 않는다)."""

    kind: RuleKind
    text: str
    mapped: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "kind_ko": _RULE_KIND_KO[self.kind],
            "text": self.text,
            "mapped": self.mapped,
        }


def _kind_of(line: str) -> RuleKind | None:
    for kind, pattern in _KIND_PATTERNS:
        if pattern.search(line):
            return kind
    return None


def _condition_of(kind: RuleKind, text: str) -> tuple[IndicatorSpec, ConditionSpec] | None:
    """규칙 한 줄을 지표 하나 + 조건 하나로 옮긴다. 못 옮기면 None.

    방향은 문장이 정한다 — "돌파"는 위로, "이탈"은 아래로. 어느 말도 없으면 갈래의
    기본(진입은 위로, 청산은 아래로)을 쓴다: 진입 규칙이 아래로 뚫는 날일 리 없다.
    """
    up = bool(_UP_RE.search(text)) or (kind == "entry" and not _DOWN_RE.search(text))

    high = _HIGH_RE.search(text)
    if high is not None:
        period = int(high.group(1))
        alias = f"hh{period}"
        return (
            IndicatorSpec(id="DONCHIAN", alias=alias, params={"period": f"${alias}_period"}),
            ConditionSpec(
                indicator="close",
                operator=Operator.CROSS_ABOVE if up else Operator.CROSS_BELOW,
                compare_to=f"{alias}_upper" if up else f"{alias}_lower",
            ),
        )

    rsi = _RSI_RE.search(text)
    if rsi is not None:
        period = int(rsi.group(1) or 14)
        alias = f"rsi{period}"
        return (
            IndicatorSpec(id="RSI", alias=alias, params={"period": f"${alias}_period"}),
            ConditionSpec(
                indicator=alias,
                operator=_RSI_OPERATORS[rsi.group(3)],
                compare_to=float(rsi.group(2)),
            ),
        )

    ma = _MA_RE.search(text)
    if ma is not None:
        period = int(ma.group(1))
        alias = f"ma{period}"
        return (
            IndicatorSpec(id="SMA", alias=alias, params={"period": f"${alias}_period"}),
            ConditionSpec(
                indicator="close",
                operator=Operator.CROSS_ABOVE if up else Operator.CROSS_BELOW,
                compare_to=alias,
            ),
        )
    return None


def extract_rules(text: str) -> list[SourceRule]:
    """출처 본문에서 규칙 문장을 찾는다. 찾은 순서를 지키고 같은 문장을 두 번 넣지 않는다."""
    found: list[SourceRule] = []
    seen: set[str] = set()
    for raw in _SPLIT.split(text or ""):
        line = " ".join(raw.split())
        if not line or len(line) > _RULE_MAX_CHARS or line in seen:
            continue
        kind = _kind_of(line)
        if kind is None or _MARKET_TOKEN.search(line) is None:
            continue
        seen.add(line)
        if kind in ("stop", "take"):
            mapped = _PERCENT_RE.search(line) is not None
        else:
            mapped = _condition_of(kind, line) is not None
        found.append(SourceRule(kind=kind, text=line, mapped=mapped))
    return found


def rule_counts(rules: list[SourceRule]) -> dict[str, int]:
    counts: dict[str, int] = {"entry": 0, "exit": 0, "stop": 0, "take": 0}
    for rule in rules:
        counts[rule.kind] += 1
    return counts


def rules_summary_ko(rules: list[SourceRule]) -> str:
    """Paper의 「진입 2 · 청산 1 · 손절 1」 — 없는 갈래는 아예 적지 않는다."""
    counts = rule_counts(rules)
    parts = [
        f"{_RULE_KIND_KO[kind]} {counts[kind]}"
        for kind in ("entry", "exit", "stop", "take")
        if counts[kind]
    ]
    return " · ".join(parts) if parts else "찾은 규칙 없음"


# ── 출처가 말한 대상 ─────────────────────────────────────────────────────────

_MARKET_RE = re.compile(r"코스피|코스닥|KOSPI|KOSDAQ|나스닥", re.IGNORECASE)
_CAP_RE = re.compile(r"대형주|중소형주|소형주|중형주")
_PERIOD_WORDS = ("일봉", "주봉", "월봉")
_SPAN_RE = re.compile(r"(\d+)\s*(년|개월)")


def extract_target(text: str) -> str | None:
    """출처가 말한 대상 한 줄 — 찾은 조각만 잇는다. 아무것도 못 찾으면 None이다.

    이 문장은 `StrategySpec.data`가 되지 않는다. 출처가 말했다는 사실과 앱이 그 대상으로
    돌리기로 했다는 사실은 다른 것이고, 그 확인은 지도가 끝난 뒤 채팅이 묻는다.
    """
    body = text or ""
    parts: list[str] = []
    market = _MARKET_RE.search(body)
    cap = _CAP_RE.search(body)
    if market is not None and cap is not None:
        parts.append(f"{market.group(0)} {cap.group(0)}")
    elif market is not None:
        parts.append(market.group(0))
    elif cap is not None:
        parts.append(cap.group(0))
    for word in _PERIOD_WORDS:
        if word in body:
            parts.append(word)
            break
    span = _SPAN_RE.search(body)
    if span is not None:
        parts.append(f"{span.group(1)}{span.group(2)}")
    return " · ".join(parts) if parts else None


# ── 규칙 → 스펙 ──────────────────────────────────────────────────────────────


def _param_spec(indicator_id: str, period: int) -> ParamSpec:
    """조절 범위는 지표 레지스트리가 이미 아는 값이다 — 화면용 범위를 새로 지어내지 않는다."""
    registry = indicators.get(indicator_id).params["period"]
    low = registry.min if registry.min is not None else period
    high = registry.max if registry.max is not None else period
    return ParamSpec(
        default=period,
        min=min(low, period),
        max=max(high, period),
        step=registry.step if registry.step is not None else 1,
        type="int",
    )


def spec_from_rules(rules: list[SourceRule], *, name: str) -> StrategySpec:
    """뽑힌 규칙으로 전략 스펙 하나를 세운다. 옮겨진 진입·청산이 없으면 세우지 않는다."""
    params: dict[str, ParamSpec] = {}
    indicator_list: list[IndicatorSpec] = []
    aliases: set[str] = set()
    entry: list[ConditionSpec] = []
    exit_: list[ConditionSpec] = []
    stop_pct: float | None = None
    take_pct: float | None = None

    for rule in rules:
        if rule.kind in ("stop", "take"):
            hit = _PERCENT_RE.search(rule.text)
            if hit is None:
                continue
            value = float(hit.group(1))
            if rule.kind == "stop" and stop_pct is None:
                stop_pct = value
            if rule.kind == "take" and take_pct is None:
                take_pct = value
            continue
        pair = _condition_of(rule.kind, rule.text)
        if pair is None:
            continue
        indicator, condition = pair
        if indicator.alias not in aliases:
            aliases.add(indicator.alias)
            indicator_list.append(indicator)
            period_ref = str(indicator.params["period"])[1:]
            period = int(re.sub(r"\D", "", indicator.alias))
            params[period_ref] = _param_spec(indicator.id, period)
        (entry if rule.kind == "entry" else exit_).append(condition)

    if not entry:
        raise SourceMapError("출처에서 진입 규칙을 찾지 못했습니다")
    if not exit_:
        raise SourceMapError("출처에서 청산 규칙을 찾지 못했습니다")

    return StrategySpec(
        version="1.0",
        metadata=Metadata(name=name),
        strategy=StrategyBlock(
            id="from_source",
            category="source",
            params=params,
            indicators=indicator_list,
            # 진입은 모두 만족(AND), 청산은 하나라도 맞으면(OR) — 출처가 청산을 여럿
            # 말했다면 그중 먼저 오는 것이 판다는 뜻이다.
            entry=ConditionGroup(logic=Logic.AND, conditions=entry),
            exit=ConditionGroup(logic=Logic.OR, conditions=exit_),
        ),
        risk=RiskSpec(
            stop_loss=RiskToggle(enabled=stop_pct is not None, percent=stop_pct or 0.0),
            take_profit=RiskToggle(enabled=take_pct is not None, percent=take_pct or 0.0),
            position=PositionSpec(sizing="all_in"),
        ),
    )


def _known_columns(spec: StrategySpec) -> set[str]:
    columns = {"open", "high", "low", "close", "volume"}
    for ind in spec.strategy.indicators:
        try:
            registry = indicators.get(ind.id)
        except KeyError:
            continue
        if len(registry.outputs) == 1:
            columns.add(ind.alias)
        else:
            columns.update(f"{ind.alias}_{output}" for output in registry.outputs)
    return columns


def wire_error(spec: StrategySpec, node_id: str) -> str | None:
    """칸 하나의 배선을 실제로 확인한다 — 지도가 그 칸을 그릴 수 있는가.

    「칸이 하나씩 채워집니다」가 진짜이려면 칸마다 할 일이 있어야 한다. 여기서 보는 것은
    그 칸이 가리키는 것이 실재하는지다: 지표 id가 레지스트리에 있는가, 조건의 피연산자가
    지표 별칭이나 원시 열인가, 조절할 값의 기본값이 범위 안인가.
    """
    if node_id == "params":
        for pname, p in spec.strategy.params.items():
            if not p.min <= p.default <= p.max:
                return f"{pname}의 기본값이 범위 밖입니다"
        return None
    if node_id == "indicators":
        for ind in spec.strategy.indicators:
            try:
                indicators.get(ind.id)
            except KeyError:
                return f"{ind.alias}가 쓰는 지표를 앱이 모릅니다"
        return None
    if node_id == "conditions":
        columns = _known_columns(spec)
        for group in (spec.strategy.entry, spec.strategy.exit):
            for condition in group.conditions:
                for operand in (condition.indicator, condition.compare_to):
                    if isinstance(operand, str) and operand not in columns:
                        return f"{operand}를 어디서 가져올지 알 수 없습니다"
        return None
    if node_id == "guard":
        risk = spec.risk
        if risk.stop_loss.enabled and risk.stop_loss.percent <= 0:
            return "손절 폭이 0% 이하입니다"
        if risk.take_profit.enabled and risk.take_profit.percent <= 0:
            return "익절 폭이 0% 이하입니다"
        return None
    return None


# ── 잡 ───────────────────────────────────────────────────────────────────────

_STATE_INDEX: dict[str, int] = {"todo": 0, "running": 1, "done": 2}

# 끝난 잡을 몇 개까지 들고 있을 것인가 — 화면이 마지막 상태를 읽는 데 필요한 만큼만.
_FINISHED_JOB_KEEP = 8


@dataclass(slots=True)
class _Step:
    id: StepId
    state: StepState = "todo"
    meta_ko: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "state": self.state,
            "title_ko": _STEP_FORMS[self.id][_STATE_INDEX[self.state]],
            "meta_ko": self.meta_ko or _STEP_HINTS[self.id],
        }


@dataclass(slots=True)
class SourceMapJob:
    """다섯 단계 한 벌의 상태. 화면이 폴링으로 읽는 것이 전부 여기 있다."""

    id: str
    url: str
    status: JobStatus = "running"
    steps: list[_Step] = field(default_factory=lambda: [_Step(sid) for sid in STEP_IDS])
    started_at: float = field(default_factory=time.monotonic)
    title: str | None = None
    source_kind: str | None = None
    target_ko: str | None = None
    rules: list[SourceRule] = field(default_factory=list)
    map: dict[str, Any] | None = None
    filled: int = 0
    node_total: int = 0
    code_lines: int | None = None
    checks: dict[str, Any] | None = None
    error: str | None = None
    task: asyncio.Task[Any] | None = field(default=None, repr=False)

    # ── 진행 ────────────────────────────────────────────────────────────────

    def begin(self, step_id: StepId) -> None:
        self.steps[STEP_IDS.index(step_id)].state = "running"

    def finish(self, step_id: StepId, meta_ko: str) -> None:
        step = self.steps[STEP_IDS.index(step_id)]
        step.state = "done"
        step.meta_ko = meta_ko

    def note(self, step_id: StepId, meta_ko: str) -> None:
        self.steps[STEP_IDS.index(step_id)].meta_ko = meta_ko

    @property
    def step_index(self) -> int:
        """지금 몇 번째 단계인가(1부터). 다 끝났으면 마지막 번호 그대로다."""
        for i, step in enumerate(self.steps):
            if step.state != "done":
                return i + 1
        return STEP_TOTAL

    def eta_seconds(self) -> int | None:
        """남은 예산에서 지금까지 쓴 시간을 뺀 값. 끝났으면 남은 시간이라는 말이 없다."""
        if self.status != "running":
            return None
        remaining = sum(
            _STEP_BUDGET_SECONDS[step.id] for step in self.steps if step.state != "done"
        )
        return max(1, round(remaining - (time.monotonic() - self.started_at)))

    # ── 부분 지도 ───────────────────────────────────────────────────────────

    def partial_map(self) -> dict[str, Any] | None:
        """지금까지 채워진 칸까지만 실은 지도. 다음 칸은 「그리는 중」, 그 뒤는 뼈대다.

        칸을 잘라 보여줄 뿐 없는 칸을 지어내지 않는다 — 아직 안 그린 칸의 제목은
        비어 있고(뼈대), 그 자리에 그럴듯한 문장을 채우지 않는다.
        """
        if self.map is None:
            return None
        drawn: list[dict[str, Any]] = []
        for i, node in enumerate(self.map.get("nodes") or []):
            if i < self.filled:
                drawn.append(node)
            elif i == self.filled:
                drawn.append({**node, "drawing": True})
            else:
                drawn.append(
                    {
                        "id": node.get("id"),
                        "numeral": node.get("numeral"),
                        "title": "",
                        "lines": [],
                        "facts": [],
                        "status": "ok",
                        "note": None,
                        "first_line": None,
                        "last_line": None,
                        "editable": False,
                        "skeleton": True,
                    }
                )
        return {**self.map, "nodes": drawn}

    def to_dict(self) -> dict[str, Any]:
        done = self.status == "done"
        return {
            "job_id": self.id,
            "url": self.url,
            "status": self.status,
            "title": self.title,
            "source_kind": self.source_kind,
            "source_kind_ko": _SOURCE_KIND_KO.get(self.source_kind or "", self.source_kind),
            "step_index": self.step_index,
            "step_total": STEP_TOTAL,
            "eta_seconds": self.eta_seconds(),
            "steps": [s.to_dict() for s in self.steps],
            "target_ko": self.target_ko,
            "target_confirmed": False,
            "rules": [r.to_dict() for r in self.rules],
            "map": self.map if done else self.partial_map(),
            "map_filled": self.filled,
            "map_total": self.node_total,
            "code_lines": self.code_lines,
            "checks": self.checks,
            "error": self.error,
        }


class SourceMapRunner:
    """잡을 asyncio.Task로 돌리고 폴링·취소 표면을 준다(`BacktestRunner`와 같은 모양)."""

    def __init__(self) -> None:
        self._jobs: dict[str, SourceMapJob] = {}

    def get(self, job_id: str) -> SourceMapJob | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if job is None or job.status != "running" or job.task is None:
            return False
        job.task.cancel()
        return True

    def _prune(self) -> None:
        """끝난 잡은 몇 개만 남긴다 — 화면이 마지막 상태를 한 번 더 읽을 자리는 두되,
        프로세스가 사는 동안 무한히 쌓이게 두지 않는다(도는 잡은 건드리지 않는다)."""
        finished = [jid for jid, job in self._jobs.items() if job.status != "running"]
        for jid in finished[: max(0, len(finished) - _FINISHED_JOB_KEEP)]:
            del self._jobs[jid]

    def start(self, url: str) -> SourceMapJob:
        self._prune()
        job = SourceMapJob(id=str(uuid.uuid4()), url=url)
        self._jobs[job.id] = job

        async def run() -> None:
            try:
                await run_job(job)
            except asyncio.CancelledError:
                job.status = "cancelled"
                raise
            except SourceMapError as exc:
                job.status = "failed"
                job.error = exc.message
            except sources.BriefError as exc:
                job.status = "failed"
                job.error = exc.message
            except Exception:  # noqa: BLE001 — 잡 실패를 상태로 옮기는 경계
                # 예상 못 한 예외의 파이썬 메시지는 화면에 그대로 뜬다 — 영어 스택 문장은
                # 사용자에게 할 말이 아니다. 한국어 한 줄로 갈아 끼운다.
                job.status = "failed"
                job.error = "출처를 지도로 만들지 못했습니다"

        job.task = asyncio.create_task(run(), name=f"athena-source-map-{job.id}")
        return job


async def run_job(job: SourceMapJob, *, brief: dict[str, Any] | None = None) -> None:
    """다섯 단계를 순서대로 돈다. 각 단계는 끝나는 즉시 잡에 적힌다(폴링이 그것을 본다).

    `brief`는 테스트가 바깥 왕복 없이 나머지 넷을 돌리는 자리다 — 안 주면 주소를 읽는다.
    """
    # ① 출처 읽기 — 바깥 페이지 한 번. 여기서 나온 글은 데이터다(모듈 머리말).
    job.begin("read")
    payload = brief if brief is not None else await sources.brief_from_url(job.url)
    text = str(payload.get("text") or "")
    job.title = payload.get("title") or None
    job.source_kind = payload.get("source_kind") or None
    kind_ko = _SOURCE_KIND_KO.get(job.source_kind or "", job.source_kind or "출처")
    job.finish("read", f"{kind_ko} · {len(text):,}자")

    # ② 규칙 뽑기 — 정규식만 쓴다. 못 옮긴 문장도 지우지 않는다.
    job.begin("rules")
    job.rules = extract_rules(text)
    job.target_ko = extract_target(text)
    if not job.rules:
        raise SourceMapError("출처에서 진입·청산 규칙을 찾지 못했습니다")
    job.finish("rules", rules_summary_ko(job.rules))

    # ③ 지도 그리기 — 칸마다 배선을 확인하고 하나씩 올린다.
    job.begin("map")
    spec = spec_from_rules(job.rules, name=job.title or "출처에서 만든 전략")
    full = mapmodel.build_map(spec=spec, version=0)
    job.map = full
    nodes = full.get("nodes") or []
    job.node_total = len(nodes)
    job.filled = 0
    for node in nodes:
        problem = wire_error(spec, str(node.get("id") or ""))
        if problem is not None:
            node["status"] = "suspect"
            node["note"] = problem
        numeral = node.get("numeral") or ""
        title = node.get("title") or ""
        job.note("map", f"칸 {job.filled + 1}/{job.node_total} · 지금 {numeral} {title}".strip())
        # 이 칸을 올리기 **전에** 한 번 양보한다 — 기다리는 것이 아니라 다른 코루틴에
        # 자리를 내주는 것뿐이다. 순서가 뒤집히면 줄은 "지금 ②"라고 말하는데 지도는
        # ③에 「그리는 중」을 세운다(partial_map의 그리는 칸은 filled 그 자리다).
        await asyncio.sleep(0)
        job.filled += 1
    job.finish("map", f"칸 {job.node_total}개")

    # ④ 코드 만들기 — 지도가 가리킨 것에서 짓는다(출처 문장이 코드가 되지 않는다).
    job.begin("code")
    source = codegen.spec_to_python(spec)
    job.code_lines = len(source.splitlines())
    job.finish("code", f"{job.code_lines}줄")

    # ⑤ 자체 검사 — 만든 코드를 그대로 검사기에 건다. 봉 캐시는 쓰지 않는다(시험 실행은
    # 그 사실을 스스로 말한다) — 이 잡은 store에 닿지 않는다는 것이 계약이다.
    job.begin("check")
    job.checks = await check_mod.run_checks(source)
    blocking = [c for c in job.checks["checks"] if c["severity"] == "block"]
    ok_count = sum(1 for c in blocking if c["ok"])
    job.finish("check", f"검사 {ok_count}/{len(blocking)} 통과")

    # 끝났다고 말하는 것은 잡 자신이다 — 러너는 실패·취소만 옮겨 적는다. 부르는 쪽이
    # 러너일 때만 done이 되면 이 함수를 직접 부른 자리에서는 영영 도는 중으로 남는다.
    job.status = "done"


__all__ = [
    "STEP_IDS",
    "STEP_TOTAL",
    "SourceMapError",
    "SourceMapJob",
    "SourceMapRunner",
    "SourceRule",
    "extract_rules",
    "extract_target",
    "rule_counts",
    "rules_summary_ko",
    "run_job",
    "spec_from_rules",
    "wire_error",
]
