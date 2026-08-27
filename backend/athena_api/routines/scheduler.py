"""루틴 스케줄러 — 두 트랙(§8), 하나의 판정 파이프라인.

- realtime 루프: 키움 WS REAL 팬아웃 큐를 구독해 틱 즉시 평가 (수신은 예산 0).
- periodic 루프: 주기 타이머 — 공유 리미터 headroom이 임계 미만이면 이번
  주기를 양보한다(대화가 항상 우선). 놓친 주기는 1회만 캐치업한다(§12).
발화는 notify 콜백(asyncio 큐 → WS 라우트)으로 나간다. LLM 0.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from athena_api.routines.disclosure_source import (
    DartDisclosureSource,
    DisclosureSourceError,
)
from athena_api.routines.models import RoutineSpec
from athena_api.routines.store import RoutineStore
from athena_api.routines.triggers import TriggerEngine, should_yield_to_conversation

NotifyFn = Callable[[dict[str, Any]], Awaitable[None]]

# REAL 필드 → 소스 카탈로그 매핑. 근거: generated/models.py 실측
# ("10" 현재가·부호 포함, "12" 등락율, "228" 체결강도, "851" 전일동시간비).
_REAL_0B_FIELDS: dict[str, str] = {
    "10": "price.current",
    "12": "price.change_rate",
    "228": "trade.strength",
    "851": "volume.prev_day_ratio",
}


def _to_float(raw: Any) -> float | None:
    if raw is None:
        return None
    try:
        return float(str(raw).replace("+", "").strip())
    except ValueError:
        return None


def adapt_real_message(message: dict[str, Any]) -> list[tuple[str, str, float | bool]]:
    """REAL 팬아웃 메시지 → (종목, 소스, 값) 목록. 해석 불가는 조용히 건너뛴다."""
    out: list[tuple[str, str, float | bool]] = []
    data = message.get("data")
    if not isinstance(data, list):
        return out
    for row in data:
        if not isinstance(row, dict):
            continue
        symbol = row.get("item")
        if not isinstance(symbol, str) or len(symbol) != 6:
            continue
        tr = str(row.get("type", ""))
        values = row.get("values")
        fields = values if isinstance(values, dict) else row
        if tr == "0B":
            for key, source in _REAL_0B_FIELDS.items():
                num = _to_float(fields.get(key))
                if num is None:
                    continue
                if source == "price.current":
                    num = abs(num)  # 부호는 대비 방향 표기 — 가격은 절댓값
                out.append((symbol, source, num))
        elif tr == "1h":
            # 9068 발동구분 — '1'만 발동으로 본다. 값 부재 시 추측하지 않는다.
            if str(fields.get("9068", "")) == "1":
                out.append((symbol, "vi.triggered", True))
    return out


@dataclass
class RoutineScheduler:
    store: RoutineStore
    engine: TriggerEngine
    notify: NotifyFn
    poll_interval_s: float = 300.0
    headroom: Callable[[], int] = lambda: 5
    min_headroom: int = 3
    disclosure: DartDisclosureSource | None = None
    subscribe_ticks: Callable[[], asyncio.Queue[dict[str, Any]]] | None = None
    unsubscribe_ticks: Callable[[asyncio.Queue[dict[str, Any]]], None] | None = None
    clock: Callable[[], float] = time.monotonic
    last_error: str | None = None
    _tasks: list[asyncio.Task[None]] = field(default_factory=list)
    _stopping: bool = False
    # routine_id → 근접(near) 진행 중 여부. 진입·이탈 각 1회만 notify하기 위한
    # 프로세스 로컬 상태(영속 안 함) — TriggerEngine._states와 같은 성격.
    _near_active: dict[str, bool] = field(default_factory=dict)

    async def start(self) -> None:
        self._stopping = False
        self._tasks.append(asyncio.create_task(self._periodic_loop()))
        if self.subscribe_ticks is not None:
            self._tasks.append(asyncio.create_task(self._realtime_loop()))

    async def stop(self) -> None:
        self._stopping = True
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()

    # ---------- 공통 ----------

    async def _handle_verdict(
        self, spec: RoutineSpec, verdict: str | None, observed: Any
    ) -> None:
        was_near = self._near_active.get(spec.id, False)
        if verdict == "near":
            if not was_near:  # 진입 — 연속 근접 틱마다 다시 알리지 않는다
                self._near_active[spec.id] = True
                await self._notify_near(spec, active=True, observed=observed)
            return
        if was_near:  # 다른 판정(quiet·suppressed·fired)으로 넘어감 — 이탈 1회
            self._near_active[spec.id] = False
            await self._notify_near(spec, active=False, observed=observed)
        if verdict != "fired":
            return
        await self.notify(
            {
                "type": "routine-fired",
                "routine_id": spec.id,
                "symbol": spec.symbol,
                "source": spec.condition.source,
                "mode": spec.mode,
                "observed": observed,
                "threshold": spec.condition.value,
                "note": spec.note,
                "fired_at": datetime.now(UTC).isoformat(),
            }
        )

    async def _notify_near(
        self, spec: RoutineSpec, *, active: bool, observed: Any
    ) -> None:
        await self.notify(
            {
                "type": "routine-near",
                "routine_id": spec.id,
                "symbol": spec.symbol,
                "active": active,
                "observed": observed,
                "threshold": spec.condition.value,
            }
        )

    async def clear_near(self, spec: RoutineSpec) -> None:
        """만료·취소 등 평가 루프 밖에서 루틴이 종결될 때 근접 상태를 정리한다.

        정리하지 않으면 마지막 판정이 'near'였던 루틴은 이탈 신호 없이 사라져
        오브가 watch 얼굴에 갇힌다(유령 watch). 종결 사유와 무관하게 진입 1회/
        이탈 1회 규약을 지키기 위해 active:false를 여기서도 발신한다.
        """
        if not self._near_active.pop(spec.id, False):
            return
        await self._notify_near(spec, active=False, observed=None)

    async def _expire_pass(self) -> None:
        for spec in self.store.list_active():
            if spec.is_expired():
                self.store.transition(spec.id, "expired")
                await self.clear_near(spec)
                await self.notify(
                    {
                        "type": "routine-expired",
                        "routine_id": spec.id,
                        "symbol": spec.symbol,
                        "note": spec.note,
                    }
                )

    # ---------- realtime (WS 팬아웃) ----------

    async def _realtime_loop(self) -> None:
        assert self.subscribe_ticks is not None
        queue = self.subscribe_ticks()
        try:
            while not self._stopping:
                message = await queue.get()
                observations = adapt_real_message(message)
                if not observations:
                    continue
                active = [
                    s for s in self.store.list_active() if s.mode == "realtime-ws"
                ]
                for symbol, source, value in observations:
                    for spec in active:
                        if spec.symbol != symbol or spec.condition.source != source:
                            continue
                        verdict = self.engine.evaluate(spec, value)
                        await self._handle_verdict(spec, verdict, value)
        finally:
            if self.unsubscribe_ticks is not None:
                self.unsubscribe_ticks(queue)

    # ---------- periodic ----------

    async def _periodic_loop(self) -> None:
        last_run = self.clock()
        while not self._stopping:
            await asyncio.sleep(self.poll_interval_s)
            now = self.clock()
            missed = int((now - last_run) / self.poll_interval_s)
            last_run = now  # 놓친 주기는 1회만 캐치업 — 몰아 실행하지 않는다(§12)
            if missed > 1:
                self.last_error = f"{missed - 1}개 주기 건너뜀(캐치업 1회)"
            if should_yield_to_conversation(
                self.headroom(), min_headroom=self.min_headroom
            ):
                continue  # 대화가 우선 — 이번 주기 양보
            await self.run_periodic_once()

    async def run_periodic_once(self) -> None:
        """한 주기 실행 — 테스트와 캐치업이 직접 부른다."""
        await self._expire_pass()
        if self.disclosure is None:
            return
        today = datetime.now(UTC).strftime("%Y%m%d")
        for spec in self.store.list_active():
            if spec.mode != "periodic":
                continue
            try:
                titles = await self.disclosure.fetch_new_titles(
                    spec.symbol, bgn_de=today, end_de=today
                )
            except DisclosureSourceError as exc:
                self.last_error = str(exc)
                continue
            for title in titles:
                verdict = self.engine.evaluate(spec, title)
                await self._handle_verdict(spec, verdict, title)
