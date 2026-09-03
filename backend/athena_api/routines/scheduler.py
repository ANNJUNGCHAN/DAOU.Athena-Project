"""루틴 스케줄러 — 실시간·예약·코드 감시 세 트랙, 하나의 판정 파이프라인.

- realtime 루프: 키움 WS REAL 팬아웃 큐를 구독해 틱 즉시 평가 (수신은 예산 0).
- schedule 루프: 벽시계 예약을 평가하고 전체 활성 루틴의 만료도 정리한다.
- code 루프: 장중에만 돌며 종목별 일봉 프레임을 한 번 만들고, 주입된 감시 러너
  (`athena_api.watch`)로 감시 함수를 별도 프로세스에서 돌려 마지막 행을 판정한다.
  코드를 여기서 실행하지 않는다 — 실행은 주입된 러너의 몫이다(R1).
발화는 notify 콜백(asyncio 큐 → WS 라우트)으로 나간다. LLM 0.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.models import RoutineSpec, parse_schedule_value
from athena_api.routines.store import RoutineStore
from athena_api.routines.triggers import TriggerEngine

_KST = timezone(timedelta(hours=9))

NotifyFn = Callable[[dict[str, Any]], Awaitable[None]]

# 장중 = KST 평일 09:00–15:30. 휴장일 달력은 저장소에 없어 요일만 본다 —
# 휴장일은 "마지막 완성 일봉이 직전 평일보다 오래됨"으로 데이터 층이 잡는다.
CODE_MARKET_OPEN_MINUTE = 9 * 60
CODE_MARKET_CLOSE_MINUTE = 15 * 60 + 30
# 실행 시 파일이 바뀌었거나 사라졌을 때의 복구 안내(B-21).
CODE_HASH_MISMATCH_REASON = "감시 코드가 바뀌거나 사라짐 — 다시 검사"
CODE_RUN_FAILED_REASON = "감시 함수 실행 실패"


def in_code_market_hours(now: datetime) -> bool:
    """이 시각에 코드 감시가 돌아야 하는가 — KST 평일 09:00~15:30."""
    if now.isoweekday() > 5:
        return False
    minutes = now.hour * 60 + now.minute
    return CODE_MARKET_OPEN_MINUTE <= minutes <= CODE_MARKET_CLOSE_MINUTE


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
    subscribe_ticks: Callable[[], asyncio.Queue[dict[str, Any]]] | None = None
    unsubscribe_ticks: Callable[[asyncio.Queue[dict[str, Any]]], None] | None = None
    on_expire: Callable[[RoutineSpec], Awaitable[None]] | None = None
    schedule_poll_interval_s: float = 20.0
    now_kst: Callable[[], datetime] = lambda: datetime.now(_KST)
    # 90일 아카이브 롤오버(R3) — 일일 주기, 기존 3루프와 동형 패턴.
    run_archive_once: Callable[[], None] | None = None
    archive_poll_interval_s: float = 86400.0
    # 코드 감시 실행층 주입 지점 — `RoutinesRuntime`을 그대로 쥔다(러너·일봉
    # 캐시·시세 통로·마지막 실행 요약이 한 자리에 있고, 부팅 도중 늦게 채워지는
    # 것도 같은 객체를 통해 보인다). None이면 code 루프는 아예 서지 않는다.
    watch_runtime: Any | None = None
    code_poll_interval_s: float = 60.0
    code_rest_calls_per_cycle: int = 20
    last_error: str | None = None
    _tasks: list[asyncio.Task[None]] = field(default_factory=list)
    _stopping: bool = False
    # routine_id → 근접(near) 진행 중 여부. 진입·이탈 각 1회만 notify하기 위한
    # 프로세스 로컬 상태(영속 안 함) — TriggerEngine._states와 같은 성격.
    _near_active: dict[str, bool] = field(default_factory=dict)
    # 프로세스 로컬(영속 안 함, TriggerState와 동일한 트레이드오프) — 재기동하면
    # 이 딕셔너리가 빈 상태로 시작돼 "오늘 이미 발화했다"는 사실을 잊는다.
    # 그래서 재기동 직후 같은 날 한 번 더 발화할 수 있다 — 버그가 아니라 허용된
    # 기존 한계다(계획 문서 Rev.3 "실행 시 참고" 참고).
    _last_fired_date: dict[str, date] = field(default_factory=dict)

    async def start(self) -> None:
        self._stopping = False
        self._tasks.append(asyncio.create_task(self._schedule_loop()))
        if self.run_archive_once is not None:
            self._tasks.append(asyncio.create_task(self._archive_loop()))
        if self.subscribe_ticks is not None:
            self._tasks.append(asyncio.create_task(self._realtime_loop()))
        if getattr(self.watch_runtime, "watch_runner", None) is not None:
            self._tasks.append(asyncio.create_task(self._code_loop()))

    async def stop(self) -> None:
        self._stopping = True
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._tasks.clear()

    # ---------- 공통 ----------

    async def _fire(
        self, spec: RoutineSpec, observed: Any, *, fired_at: str | None = None
    ) -> None:
        """발화 알림 조립 — 조건-감시(_handle_verdict)와 벽시계(_schedule_loop)가 공유.

        fired_at(선택)은 ledger에 실제로 기록된 ts다 — 예약 발화는 이 값이 브리핑
        보고(fired_at)와 /runs 병합의 상관 키가 되므로 별도 now() 재계산으로
        마이크로초가 어긋나면 병합이 조용히 실패한다(캐치업 경로와 동일한
        "서버 authoritative 값 하나" 원칙). 조건-감시 경로는 상관 키가 없어 생략."""
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
                "goal": spec.goal,
                "fired_at": fired_at or datetime.now(UTC).isoformat(),
                # 브리핑 실행 설정(R1) — main이 별도 왕복 없이 즉시 받도록 동봉.
                "briefing_model": spec.briefing_model,
                "briefing_effort": spec.briefing_effort,
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

    def near_snapshot(self) -> list[dict[str, Any]]:
        """현재 near인 루틴들의 routine-near(active:true) 스냅샷(결함6).

        재시작(restartAfterReset)이면 _near_active가 프로세스 로컬이라 소실돼
        빈 목록이 나온다 — 앱은 이를 근거로 watching 리셋을 확정한다. 순단이면
        _near_active가 살아 있어 그대로 재발신되고, 앱은 이를 복원으로 삼는다.
        WS 연결 시(routines_ws.py) 큐 펌프 전에 호출한다.
        """
        events: list[dict[str, Any]] = []
        for routine_id, active in self._near_active.items():
            if not active:
                continue
            spec = self.store.get(routine_id)
            if spec is None:
                continue
            events.append(
                {
                    "type": "routine-near",
                    "routine_id": spec.id,
                    "symbol": spec.symbol,
                    "active": True,
                    "observed": None,
                    "threshold": spec.condition.value,
                }
            )
        return events

    async def clear_near(self, spec: RoutineSpec) -> None:
        """만료·취소 등 평가 루프 밖에서 루틴이 종결될 때 근접 상태를 정리한다.

        정리하지 않으면 마지막 판정이 'near'였던 루틴은 이탈 신호 없이 사라져
        오브가 watch 얼굴에 갇힌다(유령 watch). 종결 사유와 무관하게 진입 1회/
        이탈 1회 규약을 지키기 위해 active:false를 여기서도 발신한다.
        """
        if not self._near_active.pop(spec.id, False):
            return
        await self._notify_near(spec, active=False, observed=None)

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
        await self._fire(spec, observed)

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
        await self._expire_pass()
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
            row = record_scheduled_fire(
                spec,
                self.engine.ledger,
                hhmm,
                reason=f"예약 시각 도달({target_hhmm})",
                threshold=spec.condition.value,
            )
            # ledger에 실제로 쓴 ts를 그대로 이벤트에 싣는다 — 브리핑 보고·/runs
            # 병합의 상관 키(위 _fire 독스트링, 캐치업 경로와 동일 원칙).
            await self._fire(spec, hhmm, fired_at=row["ts"])

    # ---------- code (감시 함수, 장중) ----------

    async def _code_loop(self) -> None:
        while not self._stopping:
            await asyncio.sleep(self.code_poll_interval_s)
            await self.run_code_once()

    async def run_code_once(self) -> None:
        """코드 감시 1주기 — 테스트가 직접 부른다.

        종목별로 프레임을 **한 번만** 만들고(위험 1·2), 그 프레임을 그 종목의 알람
        전부에 나눠 준다. 감시 함수는 주입된 러너가 스레드 풀로 보내므로 이 코루틴이
        실시간 루프를 막지 않는다(B-15).
        """
        runtime = self.watch_runtime
        runner = getattr(runtime, "watch_runner", None)
        store = getattr(runtime, "watch_candle_store", None)
        if runner is None or store is None:
            return
        now = self.now_kst()
        if not in_code_market_hours(now):
            return
        specs = [
            s
            for s in self.store.list_active()
            if s.mode == "code-watch" and s.watch is not None
        ]
        if not specs:
            return

        from athena_api.watch.data import CallBudget, assemble_frame

        budget = CallBudget(self.code_rest_calls_per_cycle)
        by_symbol: dict[str, list[RoutineSpec]] = {}
        for spec in specs:
            by_symbol.setdefault(spec.symbol, []).append(spec)

        for symbol, group in by_symbol.items():
            lookback = max(s.watch.lookback_days for s in group)  # type: ignore[union-attr]
            frame = await assemble_frame(
                store,
                symbol,
                lookback,
                quote_provider=getattr(runtime, "watch_quote_provider", None),
                now=now,
                budget=budget,
            )
            if frame.skip_reason:
                for spec in group:
                    self._record_code_skip(spec, frame.skip_reason)
                continue
            for spec in group:
                await self._run_one_code_watch(spec, frame.df, runner, runtime)

    def _record_code_skip(
        self, spec: RoutineSpec, reason: str, *, duration_ms: float | None = None
    ) -> None:
        """이번 주기를 못 본 사유를 원장에 남긴다 — 조용한 침묵을 만들지 않는다."""
        self.engine.ledger.record(
            "suppressed",
            routine_id=spec.id,
            symbol=spec.symbol,
            source=spec.condition.source,
            observed=None,
            threshold=spec.condition.value,
            reason=reason,
            duration_ms=duration_ms,
        )

    def _watch_source(self, spec: RoutineSpec) -> str | None:
        """감시 파일을 다시 읽고 해시를 대조한다 — 어긋나면 None(B-21).

        코드를 실행하지 않는다. 여는 곳은 프로젝트 폴더 안으로 푼 경로뿐이다.
        """
        from athena_api.routines.runtime import resolve_watch_file

        watch = spec.watch
        if watch is None:
            return None
        try:
            raw = resolve_watch_file(watch.project_id, watch.path).read_bytes()
        except Exception:
            return None
        if hashlib.sha256(raw).hexdigest() != watch.version_hash:
            return None
        try:
            return raw.decode("utf-8")
        except UnicodeDecodeError:
            return None

    async def _fail_code_watch(self, spec: RoutineSpec) -> None:
        """파일이 바뀌거나 사라진 알람을 멈추고 복구 안내를 낸다(B-21)."""
        with suppress(Exception):
            self.store.transition(spec.id, "failed")
        await self.clear_near(spec)
        await self.notify(
            {
                "type": "routine-restore-failed",
                "routine_id": spec.id,
                "reason": CODE_HASH_MISMATCH_REASON,
            }
        )

    async def _run_one_code_watch(
        self, spec: RoutineSpec, df: Any, runner: Any, runtime: Any
    ) -> None:
        source = self._watch_source(spec)
        if source is None:
            await self._fail_code_watch(spec)
            return
        watch = spec.watch
        assert watch is not None
        result = await runner.run(source, df, watch.params)
        if not result.ok:
            self._record_code_skip(
                spec, CODE_RUN_FAILED_REASON, duration_ms=result.duration_ms
            )
            self._remember_run(runtime, spec, result, skip_reason=CODE_RUN_FAILED_REASON)
            return
        verdict = self.engine.evaluate(
            spec, result.observed, duration_ms=result.duration_ms
        )
        await self._handle_verdict(spec, verdict, result.observed)
        if verdict == "fired":
            # 재시작 뒤에도 쿨다운이 살아 있어야 한다(B-20) — 벽시계 시각을 남긴다.
            # WatchSpec은 frozen이라 갈아 끼운다(검증을 거친 값의 불변성 유지).
            spec.watch = replace(watch, last_fired_at=datetime.now(UTC).isoformat())
            self.store.upsert(spec)
        self._remember_run(runtime, spec, result, skip_reason=None)

    def _remember_run(
        self, runtime: Any, spec: RoutineSpec, result: Any, *, skip_reason: str | None
    ) -> None:
        last = getattr(runtime, "watch_last", None)
        if last is None:
            return
        last[f"run:{spec.id}"] = {
            "checked_at": datetime.now(UTC).isoformat(),
            "nodes": [],  # 루프 실행은 계측을 켜지 않는다 — 칸 실값은 검사가 만든다
            "observed": result.observed,
            "duration_ms": result.duration_ms,
            "skip_reason": skip_reason,
        }

    # ---------- archive (90일 롤오버, R3) ----------

    async def _archive_loop(self) -> None:
        assert self.run_archive_once is not None
        while not self._stopping:
            await asyncio.sleep(self.archive_poll_interval_s)
            self.run_archive_once()
