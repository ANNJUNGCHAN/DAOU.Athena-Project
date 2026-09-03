"""루틴 런타임 — lifespan이 부르는 조립·해체의 단일 지점.

브레인과 같은 best-effort 문법: 루틴 서브시스템의 실패는 강등이지 기동
실패가 아니다. 단 복원 실패는 **조용히 넘기지 않고** 이벤트 큐에 강제
알림을 넣는다(프리모템 1 — 루틴이 조용히 죽어 있으면 안 된다).
"""

from __future__ import annotations

import asyncio
import hashlib
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from athena_api.config import Settings
from athena_api.routines.archive import rollover_jsonl
from athena_api.routines.briefings import BriefingStore
from athena_api.routines.engagement import EngagementStore
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.models import LEGACY_DISABLED_SOURCES, RoutineSpec
from athena_api.routines.read_marks import ReadMarksStore
from athena_api.routines.scheduler import RoutineScheduler
from athena_api.routines.store import RoutineStore
from athena_api.routines.triggers import TriggerEngine

if TYPE_CHECKING:
    from athena_api.kiwoom.ws_client import KiwoomWsClient

# 실시간 루틴이 필요로 하는 REAL 구독 tr 목록 — 소스 카탈로그의 ws transport 근거.
REALTIME_TR_IDS = ("0B", "1h")


@dataclass
class RoutinesRuntime:
    store: RoutineStore
    ledger: RoutineLedger
    engine: TriggerEngine
    scheduler: RoutineScheduler
    events: asyncio.Queue[dict[str, Any]]
    read_marks: ReadMarksStore
    engagement: EngagementStore
    briefings: BriefingStore
    ws_client: KiwoomWsClient | None = None
    # 코드 감시 실행층(athena_api.watch) — 백테스트 샌드박스가 켜져 있을 때만
    # 주입된다. None이면 code-watch 알람은 활성화되지 않는다(R1: routines는
    # 코드를 실행하지 않는다 — 실행은 주입된 러너의 몫이다).
    watch_runner: Any | None = None
    ready: bool = False
    last_error: str | None = None
    _symbol_refcounts: dict[str, int] = field(default_factory=dict)

    async def ensure_realtime_subscription(self, symbol: str) -> None:
        """활성 realtime 루틴의 종목을 REAL로 구독한다(REG는 리미터 소모 — 참조카운트 0→1에서만)."""
        if self.ws_client is None:
            raise RuntimeError("키움 WS 미가용 — 실시간 루틴을 활성화할 수 없다")
        count = self._symbol_refcounts.get(symbol, 0)
        if count == 0:
            for tr_id in REALTIME_TR_IDS:
                await self.ws_client.register(tr_id, [symbol])
        self._symbol_refcounts[symbol] = count + 1

    async def release_realtime_subscription(self, symbol: str) -> None:
        """realtime 루틴 종료(cancel/pause/expire)의 구독 해제 — 참조카운트 1→0에서만 REMOVE."""
        count = self._symbol_refcounts.get(symbol, 0)
        if count <= 0:
            return
        count -= 1
        if count == 0:
            del self._symbol_refcounts[symbol]
            for tr_id in REALTIME_TR_IDS:
                await self.ws_client.remove(tr_id, [symbol])
        else:
            self._symbol_refcounts[symbol] = count

    def can_activate(self, spec: RoutineSpec) -> str | None:
        """활성화 가능성 사전 판정 — 불가 사유 문자열, 가능하면 None.

        조용히 죽은 감시를 만들지 않기 위한 정직 게이트: 평가 경로가 실제로
        살아 있을 때만 활성화를 허용한다.
        """
        if spec.condition.source in LEGACY_DISABLED_SOURCES:
            return "이 외부 데이터 source는 앱 플러그인 전용이라 백엔드에서 활성화할 수 없다"
        if spec.mode == "realtime-ws":
            if self.ws_client is None:
                return "키움 WS 미가용 — 실시간 감시를 켤 수 없다"
            return None
        if spec.mode == "scheduled":
            return None  # 벽시계 루프는 항상 기동 — 별도 가용성 게이트 없음
        if spec.mode == "code-watch":
            return self._code_watch_blocker(spec)
        return "이 source는 백엔드 실행 경로가 없어 활성화할 수 없다"

    def _code_watch_blocker(self, spec: RoutineSpec) -> str | None:
        """코드 감시 알람의 활성화 게이트 — 파일·해시·실행층 순으로 본다.

        검사 때 통과한 그 코드가 지금도 그대로 있어야 켠다. 파일을 여는 것은
        프로젝트 폴더 안으로 푼 경로뿐이다(임의 경로 열기 금지).
        """
        watch = spec.watch
        if watch is None:
            return "감시 코드 파일 없음 — 다시 만들기"
        try:
            target = resolve_watch_file(watch.project_id, watch.path)
            raw = target.read_bytes()
        except Exception:
            return "감시 코드 파일 없음 — 다시 만들기"
        if hashlib.sha256(raw).hexdigest() != watch.version_hash:
            return "검사 뒤 코드가 바뀜 — 다시 검사"
        if self.watch_runner is None:
            return "백엔드 실행층 꺼짐 — 백테스트 모듈 필요"
        return None

    def restore_trigger_state(self) -> int:
        """부팅 복원 — 저장된 마지막 발화 시각을 쿨다운 상태로 되살린다(B-20).

        `TriggerState.last_fired_at`은 monotonic 초라 재시작하면 의미가 없다.
        저장된 벽시계 시각과 지금의 차이를 monotonic 축으로 옮겨 심어야
        재시작 직후에 쿨다운이 사라지지 않는다.
        """
        seeded = 0
        now_wall = datetime.now(UTC)
        now_mono = self.engine.clock()
        for spec in self.store.list_active():
            watch = spec.watch
            if spec.mode != "code-watch" or watch is None or not watch.last_fired_at:
                continue
            try:
                fired_at = datetime.fromisoformat(watch.last_fired_at)
            except ValueError:
                continue
            if fired_at.tzinfo is None:
                fired_at = fired_at.replace(tzinfo=UTC)
            elapsed = (now_wall - fired_at).total_seconds()
            if elapsed < 0 or elapsed >= spec.cooldown_s:
                continue  # 이미 쿨다운이 지났다 — 심을 이유가 없다
            self.engine._state(spec.id).last_fired_at = now_mono - elapsed
            seeded += 1
        return seeded


def resolve_watch_file(project_id: str, path: str) -> Path:
    """감시 코드 파일의 실제 경로 — 등록된 프로젝트 폴더 안으로만 푼다.

    경로 탈출 방어는 projects.store가 이미 지고 있다(심볼릭 링크까지 본다).
    여기서 다시 구현하지 않고 그 한 곳을 부른다.
    """
    from athena_api.projects.store import resolve_in_project, resolve_project_path

    return resolve_in_project(resolve_project_path(project_id), path)


def _archive_once(settings: Settings) -> None:
    """ledger·engagement·briefings를 90일 경계로 분기 보관 파일에 롤오버한다
    (삭제 없음). 기동 시 1회(open_routines) + scheduler._archive_loop()가 매일 재사용한다."""
    rollover_jsonl(
        settings.routines_ledger_path,
        ts_field="ts",
        archive_dir=settings.routines_ledger_archive_dir,
        cutoff_days=settings.routines_ledger_archive_cutoff_days,
        lenient=False,
    )
    # 브리핑 본문은 사용자에게 보이는 유일 데이터 — 손상을 관대하게 건너뛰지 않는다.
    rollover_jsonl(
        settings.routines_briefings_path,
        ts_field="ts",
        archive_dir=settings.routines_ledger_archive_dir,
        cutoff_days=settings.routines_ledger_archive_cutoff_days,
        lenient=False,
    )
    rollover_jsonl(
        settings.routines_engagement_path,
        ts_field="ts",
        archive_dir=settings.routines_ledger_archive_dir,
        cutoff_days=settings.routines_ledger_archive_cutoff_days,
        lenient=True,
    )


def _notify_factory(queue: asyncio.Queue[dict[str, Any]]):
    async def notify(event: dict[str, Any]) -> None:
        # 큐가 가득 차도 감시 루프를 막지 않는다 — 가장 오래된 것을 버리고 넣는다.
        while True:
            try:
                queue.put_nowait(event)
                return
            except asyncio.QueueFull:
                with suppress(asyncio.QueueEmpty):
                    queue.get_nowait()

    return notify


async def open_routines(
    settings: Settings,
    *,
    ws_client: KiwoomWsClient | None,
) -> RoutinesRuntime:
    events: asyncio.Queue[dict[str, Any]] = asyncio.Queue(200)
    store = RoutineStore(settings.routines_store_path)
    ledger = RoutineLedger(settings.routines_ledger_path)
    read_marks = ReadMarksStore(settings.routines_read_marks_path)
    read_marks.load()
    engagement = EngagementStore(settings.routines_engagement_path)
    briefings = BriefingStore(
        settings.routines_briefings_path,
        max_content_chars=settings.routines_briefing_content_max_chars,
    )
    engine = TriggerEngine(ledger=ledger)
    notify = _notify_factory(events)
    _archive_once(settings)  # 기동 시 1회 롤오버 — scheduler._archive_loop()가 이후 매일 재사용

    report = store.load()
    last_error: str | None = None

    if report.corrupt:
        last_error = f"루틴 복원 실패: {report.detail}"
        await notify(
            {
                "type": "routine-restore-failed",
                "detail": report.detail,
                "note": "저장된 루틴을 복원하지 못했다 — 감시가 비어 있다. 다시 등록이 필요하다.",
            }
        )

    for spec in store.migrate_disabled_sources(LEGACY_DISABLED_SOURCES):
        await notify(
            {
                "type": "routine-source-disabled",
                "routine_id": spec.id,
                "source": spec.condition.source,
                "note": (
                    "외부 사업자 데이터 source의 백엔드 실행 경로가 제거되어 "
                    "이 루틴을 failed로 전환했다."
                ),
            }
        )

    async def _release_on_expire(spec: RoutineSpec) -> None:
        # pause/cancel과 동일한 게이트 — realtime-ws 모드만 REAL 구독을 쥔다.
        # runtime은 정의 시점(아래)이 아니라 호출 시점(expire 발생 시)에 자유
        # 변수로 조회되므로, scheduler 생성이 runtime 대입보다 앞서도 안전하다.
        if spec.mode == "realtime-ws":
            await runtime.release_realtime_subscription(spec.symbol)

    scheduler = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        schedule_poll_interval_s=settings.routines_schedule_poll_interval_seconds,
        subscribe_ticks=(ws_client.subscribe_events if ws_client is not None else None),
        unsubscribe_ticks=(
            ws_client.unsubscribe_events if ws_client is not None else None
        ),
        on_expire=_release_on_expire,
        run_archive_once=lambda: _archive_once(settings),
    )

    runtime = RoutinesRuntime(
        store=store,
        ledger=ledger,
        engine=engine,
        scheduler=scheduler,
        events=events,
        read_marks=read_marks,
        engagement=engagement,
        briefings=briefings,
        ws_client=ws_client,
        last_error=last_error,
    )

    try:
        # 복원된 활성 realtime 루틴의 REAL 구독 재수립 — 실패는 강등+알림.
        for spec in store.list_active():
            if spec.mode != "realtime-ws":
                continue
            try:
                await runtime.ensure_realtime_subscription(spec.symbol)
            except Exception as exc:
                store.transition(spec.id, "failed")
                await notify(
                    {
                        "type": "routine-restore-failed",
                        "routine_id": spec.id,
                        "detail": type(exc).__name__,
                        "note": f"'{spec.note}' 재구독 실패 — 감시가 멈춰 있다.",
                    }
                )
        runtime.restore_trigger_state()
        await scheduler.start()
        runtime.ready = True
        return runtime
    except BaseException:
        with suppress(BaseException):
            await scheduler.stop()
        raise


async def teardown_routines(runtime: RoutinesRuntime | None) -> None:
    if runtime is None:
        return
    await runtime.scheduler.stop()
