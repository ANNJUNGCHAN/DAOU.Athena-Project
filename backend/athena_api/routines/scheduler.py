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
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from athena_api.routines.disclosure_source import (
    DartDisclosureSource,
    DisclosureSourceError,
)
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.models import RoutineSpec, parse_schedule_value
from athena_api.routines.store import RoutineStore
from athena_api.routines.triggers import TriggerEngine, should_yield_to_conversation

_KST = timezone(timedelta(hours=9))

NotifyFn = Callable[[dict[str, Any]], Awaitable[None]]

# REAL 필드 → 소스 카탈로그 매핑. 근거: generated/models.py 실측
# ("10" 현재가·부호 포함, "12" 등락율, "228" 체결강도, "851" 전일동시간비).
_REAL_0B_FIELDS: dict[str, str] = {
    "10": "price.current",
    "12": "price.change_rate",
    "228": "trade.strength",
    "851": "volume.prev_day_ratio",
}


def record_scheduled_fire(
    spec: RoutineSpec,
    ledger: RoutineLedger,
    hhmm: str,
    *,
    reason: str = "예약 시각 도달",
    threshold: float | bool | str | None = None,
) -> dict[str, Any]:
    """schedule.daily 발화를 ledger에 기록한다 — 정시 발화(run_schedule_once)와
    캐치업 발화(catchup-fire 엔드포인트) 둘 다 이 헬퍼를 거친다(P4, 판정 조립
    지점 단일화). threshold 기본값 None은 캐치업 경로(스펙의 조건값을 그대로
    쓰면 되는 상황)를 단순화하기 위함 — 정시 경로는 반드시 spec.condition.value를
    명시 전달한다(run_schedule_once 호출부). 반환값은 ledger.record()가 반환하는
    dict(ts 포함, 서버 authoritative)."""
    return ledger.record(
        "fired",
        routine_id=spec.id,
        symbol=spec.symbol,
        source=spec.condition.source,
        observed=hhmm,
        threshold=threshold if threshold is not None else spec.condition.value,
        reason=reason,
    )


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
    on_expire: Callable[[RoutineSpec], Awaitable[None]] | None = None
    clock: Callable[[], float] = time.monotonic
    schedule_poll_interval_s: float = 20.0
    now_kst: Callable[[], datetime] = lambda: datetime.now(_KST)
    # 90일 아카이브 롤오버(R3) — 일일 주기, 기존 3루프와 동형 패턴.
    run_archive_once: Callable[[], None] | None = None
    archive_poll_interval_s: float = 86400.0
    last_error: str | None = None
    _tasks: list[asyncio.Task[None]] = field(default_factory=list)
    _stopping: bool = False
    # 프로세스 로컬(영속 안 함, TriggerState와 동일한 트레이드오프) — 재기동하면
    # 이 딕셔너리가 빈 상태로 시작돼 "오늘 이미 발화했다"는 사실을 잊는다.
    # 그래서 재기동 직후 같은 날 한 번 더 발화할 수 있다 — 버그가 아니라 허용된
    # 기존 한계다(계획 문서 Rev.3 "실행 시 참고" 참고).
    _last_fired_date: dict[str, date] = field(default_factory=dict)

    async def start(self) -> None:
        self._stopping = False
        self._tasks.append(asyncio.create_task(self._periodic_loop()))
        self._tasks.append(asyncio.create_task(self._schedule_loop()))
        if self.run_archive_once is not None:
            self._tasks.append(asyncio.create_task(self._archive_loop()))
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

    async def _fire(self, spec: RoutineSpec, observed: Any) -> None:
        """발화 알림 조립 — 조건-감시(_handle_verdict)와 벽시계(_schedule_loop)가 공유."""
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
                # 브리핑 실행 설정(R1) — main이 별도 왕복 없이 즉시 받도록 동봉.
                "briefing_model": spec.briefing_model,
                "briefing_effort": spec.briefing_effort,
            }
        )

    async def _handle_verdict(
        self, spec: RoutineSpec, verdict: str | None, observed: Any
    ) -> None:
        if verdict != "fired":
            return
        await self._fire(spec, observed)

    async def _expire_pass(self) -> None:
        for spec in self.store.list_active():
            if spec.is_expired():
                self.store.transition(spec.id, "expired")
                await self.notify(
                    {
                        "type": "routine-expired",
                        "routine_id": spec.id,
                        "symbol": spec.symbol,
                        "note": spec.note,
                    }
                )
                if self.on_expire is not None:
                    await self.on_expire(spec)

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
            started = time.monotonic()
            try:
                titles = await self.disclosure.fetch_new_titles(
                    spec.symbol, bgn_de=today, end_de=today
                )
            except DisclosureSourceError as exc:
                self.last_error = str(exc)
                continue
            duration_ms = (time.monotonic() - started) * 1000
            for title in titles:
                verdict = self.engine.evaluate(spec, title, duration_ms=duration_ms)
                await self._handle_verdict(spec, verdict, title)

    # ---------- schedule (벽시계 예약) ----------

    # 경계(AC1) — 이 트랙이 하는 일은 여기까지다: 벽시계 매치 시 발화
    # 알림(_fire, 능동 턴)과 ledger 기록뿐이다. 발화 이후 "브리핑 카드"를
    # 자동으로 만드는 것(스케줄된 claude 턴 실행)은 이번 스코프가 아니다 —
    # F1 확장선으로 별도 계획에 명시적으로 이연됐다(Rev.3 ADR,
    # .omc/plans/agent-mode-followups-plan.md의 "F1 옵션 F1-B"). 예약이
    # 뜨면 능동 턴만 뜨고, 실제 브리핑 내용은 사용자가 이어서 대화해야
    # 만들어진다 — 이 파일이 대화 턴을 스스로 실행하는 일은 없다.
    async def _schedule_loop(self) -> None:
        while not self._stopping:
            await asyncio.sleep(self.schedule_poll_interval_s)
            await self.run_schedule_once()

    async def run_schedule_once(self) -> None:
        """벽시계 매치 1회분 — 테스트가 직접 부른다. TriggerEngine 미경유(§8) —
        벽시계 트리거엔 near/suppressed 개념이 없다, 하루 1회는
        `_last_fired_date`(프로세스 로컬, `TriggerState`와 동일한 트레이드오프)로
        보장한다."""
        now = self.now_kst()
        today = now.date()
        hhmm = now.strftime("%H:%M")
        weekday = now.isoweekday()  # 1=월 .. 7=일
        for spec in self.store.list_active():
            if spec.mode != "scheduled":
                continue
            if self._last_fired_date.get(spec.id) == today:
                continue
            parsed = parse_schedule_value(spec.condition.value)
            if parsed is None:
                # rules.py가 draft 시점에 막았어야 한다 — 여기 도달하면 저장된
                # 값이 손상된 것이다. 조용히 넘기지 않고 사유를 남긴다(프리모템 1).
                self.last_error = (
                    f"루틴 {spec.id}의 예약 형식이 올바르지 않다: "
                    f"{spec.condition.value!r}"
                )
                continue
            days, target_hhmm = parsed
            if target_hhmm != hhmm:
                continue
            if days is not None and weekday not in days:
                continue
            self._last_fired_date[spec.id] = today
            record_scheduled_fire(
                spec,
                self.engine.ledger,
                hhmm,
                reason=f"예약 시각 도달({target_hhmm})",
                threshold=spec.condition.value,
            )
            await self._fire(spec, hhmm)

    # ---------- archive (90일 롤오버, R3) ----------

    async def _archive_loop(self) -> None:
        assert self.run_archive_once is not None
        while not self._stopping:
            await asyncio.sleep(self.archive_poll_interval_s)
            self.run_archive_once()
