"""트리거 판정 — 결정론 3판정(발화/근접/억제)과 원장 기록.

감시에이전트-실행계획 §6의 핵심 규율 구현:
- 관측은 넓게(근접까지 기록), 알림은 좁게(발화만 알림으로 이어진다).
- 조용했던 시간은 안 적는다 — 근접·억제·발화만 원장에 남는다.
- 억제에는 반드시 사유가 붙는다(쿨다운 잔여 등).
LLM 0 — 이 모듈은 산술 비교뿐이다.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field

from athena_api.routines.ledger import RoutineLedger, Verdict
from athena_api.routines.models import RoutineSpec

# 근접 판정: 임계 대비 상대 거리가 (1 - NEAR_RATIO) 이내면 '근접'으로 기록.
NEAR_RATIO = 0.8


def _condition_met(op: str, observed: float | bool | str, threshold: float | bool | str) -> bool:
    if op == "<":
        return observed < threshold  # type: ignore[operator]
    if op == "<=":
        return observed <= threshold  # type: ignore[operator]
    if op == ">":
        return observed > threshold  # type: ignore[operator]
    if op == ">=":
        return observed >= threshold  # type: ignore[operator]
    if op == "==":
        return observed == threshold
    if op == "contains":
        return isinstance(observed, str) and isinstance(threshold, str) and threshold in observed
    raise ValueError(f"unknown op: {op!r}")  # rules가 막았어야 한다 — 호출부 버그


def _is_near(observed: float | bool | str, threshold: float | bool | str) -> bool:
    """숫자 조건만 근접이 정의된다. 불리언·키워드는 이진이라 근접이 없다."""
    if isinstance(observed, bool) or isinstance(threshold, bool):
        return False
    if not isinstance(observed, (int, float)) or not isinstance(threshold, (int, float)):
        return False
    denom = max(abs(float(threshold)), 1e-9)
    return abs(float(observed) - float(threshold)) / denom <= (1.0 - NEAR_RATIO)


@dataclass
class TriggerState:
    """루틴 1건의 평가 누적 상태 — 프로세스 로컬(영속 안 함)."""

    consecutive: int = 0
    last_fired_at: float | None = None  # monotonic 초


@dataclass
class TriggerEngine:
    """RoutineSpec × 관측값 → 판정. 발화/근접/억제를 원장에 기록한다."""

    ledger: RoutineLedger
    clock: Callable[[], float] = time.monotonic
    _states: dict[str, TriggerState] = field(default_factory=dict)

    def _state(self, routine_id: str) -> TriggerState:
        return self._states.setdefault(routine_id, TriggerState())

    def evaluate(
        self, spec: RoutineSpec, observed: float | bool | str
    ) -> Verdict | None:
        """한 관측에 대한 판정. None = 조용(기록 없음)."""
        cond = spec.condition
        state = self._state(spec.id)
        met = _condition_met(cond.op, observed, cond.value)

        if not met:
            state.consecutive = 0
            if _is_near(observed, cond.value):
                self.ledger.record(
                    "near",
                    routine_id=spec.id,
                    symbol=spec.symbol,
                    source=cond.source,
                    observed=observed,
                    threshold=cond.value,
                    reason="임계 미달 — 관측 임계로 기록",
                )
                return "near"
            return None

        state.consecutive += 1
        if state.consecutive < cond.consecutive_ticks:
            self.ledger.record(
                "suppressed",
                routine_id=spec.id,
                symbol=spec.symbol,
                source=cond.source,
                observed=observed,
                threshold=cond.value,
                reason=(
                    f"연속 틱 미충족 ({state.consecutive}/{cond.consecutive_ticks})"
                ),
            )
            return "suppressed"

        now = self.clock()
        if state.last_fired_at is not None:
            remaining = spec.cooldown_s - (now - state.last_fired_at)
            if remaining > 0:
                self.ledger.record(
                    "suppressed",
                    routine_id=spec.id,
                    symbol=spec.symbol,
                    source=cond.source,
                    observed=observed,
                    threshold=cond.value,
                    reason=f"쿨다운 {int(remaining)}초 남음",
                )
                return "suppressed"

        state.last_fired_at = now
        state.consecutive = 0
        self.ledger.record(
            "fired",
            routine_id=spec.id,
            symbol=spec.symbol,
            source=cond.source,
            observed=observed,
            threshold=cond.value,
            reason="조건 도달",
        )
        return "fired"


def should_yield_to_conversation(headroom: int, *, min_headroom: int = 3) -> bool:
    """감시 폴링의 양보 판정 — 대화가 항상 우선(실행계획 P1).

    공유 리미터의 남은 여유가 임계 미만이면 이번 폴링 주기를 건너뛴다.
    리미터를 새로 만들지 않는다 — 호출자가 단일 리미터의 headroom()을 넘긴다.
    """
    return headroom < min_headroom
