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
# Paper board-32 '임계 90% 근접' 캡션이 규범(CP3 승인 2026-08-27).
NEAR_RATIO = 0.9
# 이탈 경계 — 진입(NEAR_RATIO)보다 낮춰 데드밴드를 만든다(Schmitt trigger).
# 단일 경계면 경계 부근 교대 입력마다 진입/이탈이 반복 발신된다(결함7, 반증
# 재현: 99.9/100.1 교대 입력). was_near일 때만 이 완화된 경계를 쓴다.
NEAR_EXIT_RATIO = 0.85


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


def _is_near(
    observed: float | bool | str,
    threshold: float | bool | str,
    *,
    was_near: bool = False,
) -> bool:
    """숫자 조건만 근접이 정의된다. 불리언·키워드는 이진이라 근접이 없다.

    was_near=True(이미 근접 중)면 이탈 경계(NEAR_EXIT_RATIO)를, 아니면 진입
    경계(NEAR_RATIO)를 쓴다 — 데드밴드로 경계 진동을 흡수한다(결함7).
    """
    if isinstance(observed, bool) or isinstance(threshold, bool):
        return False
    if not isinstance(observed, (int, float)) or not isinstance(threshold, (int, float)):
        return False
    ratio = NEAR_EXIT_RATIO if was_near else NEAR_RATIO
    denom = max(abs(float(threshold)), 1e-9)
    return abs(float(observed) - float(threshold)) / denom <= (1.0 - ratio)


@dataclass
class TriggerState:
    """루틴 1건의 평가 누적 상태 — 프로세스 로컬(영속 안 함)."""

    consecutive: int = 0
    last_fired_at: float | None = None  # monotonic 초
    near_active: bool = False  # 데드밴드 판정을 위한 이전 근접 여부(결함7)


@dataclass
class TriggerEngine:
    """RoutineSpec × 관측값 → 판정. 발화/근접/억제를 원장에 기록한다."""

    ledger: RoutineLedger
    clock: Callable[[], float] = time.monotonic
    _states: dict[str, TriggerState] = field(default_factory=dict)

    def _state(self, routine_id: str) -> TriggerState:
        return self._states.setdefault(routine_id, TriggerState())

    def evaluate(
        self,
        spec: RoutineSpec,
        observed: float | bool | str,
        *,
        duration_ms: float | None = None,
    ) -> Verdict | None:
        """한 관측에 대한 판정. None = 조용(기록 없음).

        duration_ms(선택)는 이 관측을 얻는 데 걸린 시간(예: 공시 폴링의
        fetch_new_titles 호출)이다 — 판정 로직과는 무관하고, 기록되는
        ledger 행에만 실린다(§8 F2)."""
        cond = spec.condition
        state = self._state(spec.id)
        met = _condition_met(cond.op, observed, cond.value)

        if not met:
            state.consecutive = 0
            if _is_near(observed, cond.value, was_near=state.near_active):
                state.near_active = True
                self.ledger.record(
                    "near",
                    routine_id=spec.id,
                    symbol=spec.symbol,
                    source=cond.source,
                    observed=observed,
                    threshold=cond.value,
                    reason="임계 미달 — 관측 임계로 기록",
                    duration_ms=duration_ms,
                )
                return "near"
            state.near_active = False
            return None

        state.near_active = False
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
                duration_ms=duration_ms,
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
                    duration_ms=duration_ms,
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
            duration_ms=duration_ms,
        )
        return "fired"
