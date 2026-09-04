"""검사 = 미니 백테스트 — 지난 N일 완성 봉(D-1)에 감시 함수를 한 번 돌려 몇 번 울렸을지 센다.

- 쿨다운을 그대로 적용한다: 한 번 울리면 `cooldown_s` 안의 다음 참은 억제된다(실전 루프의
  TriggerEngine과 같은 규칙, 일봉이라 하루 단위로 떨어진다).
- 오늘은 세지 않는다(B-9). 실행 루프는 오늘 진행 봉을 보므로 화면은 「어제까지로 세었음 · 오늘은
  진행 중」으로 적는다(P4).
- 문법·실행 오류는 예외가 아니라 `ok=False` + 진단(`backtest.diagnose`)으로 돌려준다(B-12).
- 계측 하한(B-23): 이번 실행에서 **불린** 최상위 함수 전부에 나옴 값이 잡혀야 통과. 안 불린
  함수는 실패가 아니다(칸은 「이번엔 안 쓰임」).
- 마지막 행 판정은 실행 루프와 같은 함수(`verdict_for_last_row`)를 쓴다(B-18).
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from typing import Any

import pandas as pd

from athena_api.backtest import diagnose as diagnose_mod
from athena_api.watch.data import closed_frame
from athena_api.watch.nodes import NodeCard, build_nodes
from athena_api.watch.runner import RunResult, WatchRunner, verdict_for_last_row

MISSING_VALUES_REASON = "칸 {n}개의 값을 못 읽음 — 다시 만들어 볼게"
COUNTED_UNTIL_YESTERDAY = "어제까지로 세었음 · 오늘은 진행 중"


@dataclass
class CheckResult:
    ok: bool
    fires: list[dict[str, Any]] = field(default_factory=list)
    count: int = 0
    lookback_days: int = 0
    last_fire: str | None = None
    code_hash: str = ""
    nodes: list[NodeCard] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: dict[str, Any] | None = None
    diagnosis: dict[str, Any] | None = None
    reason: str | None = None
    last_verdict: bool = False  # D-1 마지막 행 판정 — 루프 판정과 같아야 한다(B-18)
    duration_ms: int = 0
    counted_until: str = COUNTED_UNTIL_YESTERDAY

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["nodes"] = [n.to_dict() for n in self.nodes]
        return out


def code_hash_of(source: str) -> str:
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def simulate_fires(
    signals_df: pd.DataFrame, closes: pd.Series, *, cooldown_s: int
) -> list[dict[str, Any]]:
    """`entry` 열을 시간순으로 훑어 쿨다운을 적용한 발화 날짜 목록."""
    fires: list[dict[str, Any]] = []
    cooldown = timedelta(seconds=max(0, int(cooldown_s)))
    last: pd.Timestamp | None = None
    entry = signals_df["entry"] if "entry" in signals_df.columns else pd.Series(dtype=bool)
    for stamp, value in entry.items():
        if pd.isna(value) or not bool(value):
            continue
        stamp = pd.Timestamp(stamp)
        if last is not None and (stamp - last) < cooldown:
            continue
        last = stamp
        close = closes.get(stamp)
        fires.append(
            {
                "dt": stamp.strftime("%Y-%m-%d"),
                "close": None if close is None or pd.isna(close) else float(close),
            }
        )
    return fires


def _diagnosis_dict(error: dict[str, Any] | None, source: str) -> dict[str, Any] | None:
    if not error:
        return None
    text = error.get("traceback") or error.get("message") or ""
    try:
        diag = diagnose_mod.diagnose(str(text), source)
    except Exception:  # 진단은 보조 — 진단 실패가 검사 결과를 덮지 않는다
        return None
    return {
        "title": diag.title,
        "detail": diag.detail,
        "why": diag.why,
        "line": diag.line,
        "has_suggestion": diag.suggestion is not None,
        "suggestion_summary": diag.suggestion.summary if diag.suggestion else None,
        "tags": list(diag.tags),
    }


def _missing_value_count(cards: list[NodeCard]) -> int:
    missing = 0
    for card in cards:
        if not card.called:
            continue
        if card.error is None and card.output is None:
            missing += 1
    return missing


def run_check(
    source: str,
    labels: dict[str, str] | None,
    df: pd.DataFrame,
    *,
    cooldown_s: int,
    params: dict[str, Any] | None = None,
    lookback_days: int | None = None,
    today: date | None = None,
    runner: WatchRunner | None = None,
) -> CheckResult:
    """감시 함수를 완성 봉(D-1)에 한 번 돌려 검사 결과를 만든다."""
    runner = runner or WatchRunner()
    today = today or date.today()
    closed = closed_frame(df, today)
    if lookback_days:
        closed = closed[closed.index >= pd.Timestamp(today - timedelta(days=lookback_days))]
    result = CheckResult(
        ok=False, lookback_days=lookback_days or len(closed), code_hash=code_hash_of(source)
    )

    if closed.empty:
        result.reason = "완성된 일봉 없음 — 먼저 일봉을 받아야 함"
        return result

    run: RunResult = runner.run_once(source, closed, params, trace=True)
    result.duration_ms = run.duration_ms
    cards, file_warnings = build_nodes(source, run.node_io, labels)
    result.nodes = cards
    result.warnings.extend(file_warnings)
    result.warnings.extend(w for c in cards for w in c.warnings)

    if run.error is not None:
        result.error = run.error
        result.diagnosis = _diagnosis_dict(run.error, source)
        result.reason = "검사 실패 — 코드가 돌지 않음"
        return result

    missing = _missing_value_count(cards)
    if missing:
        result.reason = MISSING_VALUES_REASON.format(n=missing)
        return result

    signals_df = run.signals_df
    assert signals_df is not None
    result.fires = simulate_fires(signals_df, closed["close"], cooldown_s=cooldown_s)
    result.count = len(result.fires)
    result.last_fire = result.fires[-1]["dt"] if result.fires else None
    result.last_verdict = verdict_for_last_row(signals_df)
    result.ok = True
    return result
