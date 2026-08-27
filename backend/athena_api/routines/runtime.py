"""루틴 런타임 — lifespan이 부르는 조립·해체의 단일 지점.

브레인과 같은 best-effort 문법: 루틴 서브시스템의 실패는 강등이지 기동
실패가 아니다. 단 복원 실패는 **조용히 넘기지 않고** 이벤트 큐에 강제
알림을 넣는다(프리모템 1 — 루틴이 조용히 죽어 있으면 안 된다).
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import httpx

from athena_api.config import Settings
from athena_api.routines.archive import rollover_jsonl
from athena_api.routines.corp_catalog import CorpCatalog
from athena_api.routines.disclosure_source import DartDisclosureSource
from athena_api.routines.engagement import EngagementStore
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.models import RoutineSpec
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
    http_client: httpx.AsyncClient | None = None
    ws_client: KiwoomWsClient | None = None
    ready: bool = False
    disclosure_ready: bool = False
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
        if spec.mode == "realtime-ws":
            if self.ws_client is None:
                return "키움 WS 미가용 — 실시간 감시를 켤 수 없다"
            return None
        if spec.mode == "scheduled":
            return None  # 벽시계 루프는 항상 기동 — 별도 가용성 게이트 없음
        if not self.disclosure_ready:
            return "공시 폴러 미가용(DART 키 또는 corp 카탈로그 부재)"
        return None


def _archive_once(settings: Settings) -> None:
    """ledger·engagement를 90일 경계로 분기 보관 파일에 롤오버한다(삭제 없음).
    기동 시 1회(open_routines) + scheduler._archive_loop()가 매일 재사용한다."""
    rollover_jsonl(
        settings.routines_ledger_path,
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
    headroom: Any = None,
) -> RoutinesRuntime:
    events: asyncio.Queue[dict[str, Any]] = asyncio.Queue(200)
    store = RoutineStore(settings.routines_store_path)
    ledger = RoutineLedger(settings.routines_ledger_path)
    read_marks = ReadMarksStore(settings.routines_read_marks_path)
    read_marks.load()
    engagement = EngagementStore(settings.routines_engagement_path)
    engine = TriggerEngine(ledger=ledger)
    notify = _notify_factory(events)
    _archive_once(settings)  # 기동 시 1회 롤오버 — scheduler._archive_loop()가 이후 매일 재사용

    report = store.load()
    http_client: httpx.AsyncClient | None = None
    disclosure: DartDisclosureSource | None = None
    disclosure_ready = False
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

    if settings.dart_api_key is not None:
        http_client = httpx.AsyncClient(timeout=10.0)
        catalog = CorpCatalog(
            api_key=settings.dart_api_key.get_secret_value(),
            cache_path=settings.routines_store_path.parent / "corpcode.xml",
            client=http_client,
        )
        disclosure = DartDisclosureSource(
            api_key=settings.dart_api_key.get_secret_value(),
            resolve_corp_code=catalog.resolve,
            client=http_client,
        )
        disclosure_ready = True
    else:
        if last_error is None:
            last_error = "DART 키 미설정 — 공시(periodic) 루틴 강등"

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
        poll_interval_s=settings.routines_poll_interval_seconds,
        schedule_poll_interval_s=settings.routines_schedule_poll_interval_seconds,
        headroom=headroom or (lambda: 5),
        disclosure=disclosure,
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
        http_client=http_client,
        ws_client=ws_client,
        disclosure_ready=disclosure_ready,
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
        await scheduler.start()
        runtime.ready = True
        return runtime
    except BaseException:
        with suppress(BaseException):
            await scheduler.stop()
        if http_client is not None:
            with suppress(BaseException):
                await http_client.aclose()
        raise


async def teardown_routines(runtime: RoutinesRuntime | None) -> None:
    if runtime is None:
        return
    await runtime.scheduler.stop()
    if runtime.http_client is not None:
        await runtime.http_client.aclose()
