"""스케줄러·영속·공시 소스(US-006) — 가짜 시계·픽스처로 고정한다."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from contextlib import suppress
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from athena_api.backtest.store import Candle
from athena_api.projects import store as projects_store
from athena_api.routines.briefings import BriefingStore
from athena_api.routines.engagement import EngagementStore
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.main_card import MainCardDescriptor
from athena_api.routines.models import Condition, derive_mode
from athena_api.routines.read_marks import ReadMarksStore
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import RoutinesRuntime
from athena_api.routines.scheduler import (
    RoutineScheduler,
    adapt_real_message,
    in_code_market_hours,
    record_scheduled_fire,
)
from athena_api.routines.store import RoutineStore, RoutineTransitionError
from athena_api.routines.triggers import TriggerEngine
from athena_api.watch.runner import RunResult

_KST = timezone(timedelta(hours=9))


def _spec(source="price.change_rate", op=">=", value=5.0, symbol="005930", goal=False):
    return validate_draft(
        {
            "symbol": symbol,
            "condition": {"source": source, "op": op, "value": value},
            "cooldown_s": 60,
            "expires_days": 7,
            "goal": goal,
        }
    )


# ---------- store ----------


def test_store_roundtrip_and_restore(tmp_path):
    path = tmp_path / "routines.json"
    store = RoutineStore(path)
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")

    restored = RoutineStore(path)
    report = restored.load()
    assert report.restored == 1 and not report.corrupt
    assert restored.get(spec.id).status == "active"
    assert restored.get(spec.id).approved_at is not None


def test_store_corrupt_file_is_preserved_and_reported(tmp_path):
    path = tmp_path / "routines.json"
    path.write_text("{broken json", encoding="utf-8")
    store = RoutineStore(path)
    report = store.load()
    assert report.corrupt
    assert (tmp_path / "routines.corrupt").exists()
    assert store.list_all() == []


def test_read_marks_roundtrip_across_instances(tmp_path):
    path = tmp_path / "read_marks.json"
    marks = ReadMarksStore(path)
    marks.load()  # 파일 없음 — 빈 상태
    assert marks.last_read_fired_at("r1") is None

    marks.ack("r1", "2026-08-24T07:30:00+00:00")

    restored = ReadMarksStore(path)
    restored.load()
    assert restored.last_read_fired_at("r1") == "2026-08-24T07:30:00+00:00"
    assert restored.last_read_fired_at("r2") is None  # 다른 routine 영향 없음


def test_read_marks_corrupt_file_degrades_to_empty(tmp_path):
    path = tmp_path / "read_marks.json"
    path.write_text("{broken json", encoding="utf-8")
    marks = ReadMarksStore(path)
    marks.load()  # 손상 — 낮은 스테이크라 빈 상태로 조용히 강등(store.py와 다른 정책)
    assert marks.last_read_fired_at("r1") is None


def test_engagement_records_and_reads_back(tmp_path):
    path = tmp_path / "engagement.jsonl"
    store = EngagementStore(path)
    assert store.read_all() == []  # 파일 없음 — 빈 상태

    store.record("opened", routine_id="r1")
    store.record("replied", routine_id="r1")
    store.record("opened", routine_id="r2")

    rows = store.read_all()
    assert [r["event"] for r in rows] == ["opened", "replied", "opened"]
    assert [r["routine_id"] for r in rows] == ["r1", "r1", "r2"]

    restored = EngagementStore(path)  # 새 인스턴스도 같은 파일을 그대로 읽는다
    assert len(restored.read_all()) == 3


def test_engagement_rejects_unknown_event():
    from athena_api.routines.engagement import EngagementError

    store = EngagementStore(Path("unused.jsonl"))
    with pytest.raises(EngagementError):
        store.record("clicked", routine_id="r1")  # type: ignore[arg-type]


def test_engagement_skips_corrupt_lines_and_keeps_reading(tmp_path):
    """read_marks.py와 동형 정책 — 개별 손상 라인은 건너뛰고 나머지는 읽는다."""
    path = tmp_path / "engagement.jsonl"
    store = EngagementStore(path)
    store.record("opened", routine_id="r1")
    with path.open("a", encoding="utf-8") as fh:
        fh.write("{이건 깨진 json\n")
    store.record("replied", routine_id="r1")

    rows = store.read_all()
    assert [r["event"] for r in rows] == ["opened", "replied"]  # 손상 라인만 빠짐


def test_store_rejects_illegal_transitions(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    with pytest.raises(RoutineTransitionError):
        store.transition(spec.id, "expired")  # draft→expired는 표 밖
    store.transition(spec.id, "cancelled")
    with pytest.raises(RoutineTransitionError):
        store.transition(spec.id, "active")  # cancelled는 종결 상태


# ---------- REAL 어댑터 ----------


def test_adapt_real_message_maps_verified_fields():
    message = {
        "trnm": "REAL",
        "data": [
            {
                "type": "0B",
                "item": "005930",
                "values": {"10": "-199400", "12": "+5.30", "228": "142.11"},
            },
            {"type": "1h", "item": "005930", "values": {"9068": "1"}},
            {"type": "1h", "item": "000660", "values": {}},  # 발동구분 부재 — 추측 금지
        ],
    }
    obs = adapt_real_message(message)
    assert ("005930", "price.current", 199400.0) in obs  # 부호는 방향 표기 — 절댓값
    assert ("005930", "price.change_rate", 5.3) in obs
    assert ("005930", "trade.strength", 142.11) in obs
    assert ("005930", "vi.triggered", True) in obs
    assert all(sym != "000660" for sym, _, _ in obs)


def test_adapt_real_message_ignores_garbage():
    assert adapt_real_message({"trnm": "REAL"}) == []
    assert adapt_real_message({"data": [{"item": 5}, "x", {"item": "00593"}]}) == []


# ---------- scheduler — realtime 평가·양보·캐치업 ----------


@pytest.mark.asyncio
async def test_realtime_loop_evaluates_and_notifies(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    spec.main_card = MainCardDescriptor(
        operation_ref="base:ka10005",
        args={"stk_cd": "005930"},
        title="시세",
    )
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    fired: list[dict] = []

    async def notify(ev):
        fired.append(ev)

    queue: asyncio.Queue = asyncio.Queue()

    sched = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        subscribe_ticks=lambda: queue,
    )
    await sched.start()
    await queue.put(
        {
            "trnm": "REAL",
            "data": [{"type": "0B", "item": "005930", "values": {"12": "+6.00"}}],
        }
    )
    await asyncio.sleep(0.05)
    await sched.stop()

    assert len(fired) == 1
    assert fired[0]["type"] == "routine-fired"
    assert fired[0]["mode"] == "realtime-ws"
    assert fired[0]["routine_id"] == spec.id
    assert fired[0]["goal"] is False  # 기본값 — goal 미지정 루틴
    assert fired[0]["main_card"] == spec.main_card.to_dict()


@pytest.mark.asyncio
async def test_fired_notify_carries_goal_flag(tmp_path):
    """CP1a — goal=true 루틴이 발화하면 fired 페이로드에 goal이 실린다."""
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec(goal=True)
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    fired: list[dict] = []

    async def notify(ev):
        fired.append(ev)

    queue: asyncio.Queue = asyncio.Queue()
    sched = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        subscribe_ticks=lambda: queue,
    )
    await sched.start()
    await queue.put(
        {
            "trnm": "REAL",
            "data": [{"type": "0B", "item": "005930", "values": {"12": "+6.00"}}],
        }
    )
    await asyncio.sleep(0.05)
    await sched.stop()

    assert len(fired) == 1
    assert fired[0]["goal"] is True


# ---------- 참조카운트 기반 REAL 구독 해제(F5) ----------


class FakeWs:
    def __init__(self):
        self.registered: list[tuple[str, tuple[str, ...]]] = []
        self.removed: list[tuple[str, tuple[str, ...]]] = []

    async def register(self, tr_id, items, **kw):
        self.registered.append((tr_id, tuple(items)))
        return {}

    async def remove(self, tr_id, items, **kw):
        self.removed.append((tr_id, tuple(items)))
        return {}


def _runtime(tmp_path, ws=None, on_expire=None):
    store = RoutineStore(tmp_path / "r.json")
    ledger = RoutineLedger(tmp_path / "l.jsonl")
    engine = TriggerEngine(ledger=ledger)

    async def noop(_ev):
        pass

    sched = RoutineScheduler(store=store, engine=engine, notify=noop, on_expire=on_expire)
    return RoutinesRuntime(
        store=store,
        ledger=ledger,
        engine=engine,
        scheduler=sched,
        events=asyncio.Queue(200),
        read_marks=ReadMarksStore(tmp_path / "read_marks.json"),
        engagement=EngagementStore(tmp_path / "engagement.jsonl"),
        briefings=BriefingStore(tmp_path / "briefings.jsonl"),
        ws_client=ws,
    )


@pytest.mark.asyncio
async def test_refcount_shared_symbol_removes_only_after_last_release(tmp_path):
    """같은 심볼을 감시하는 라우틴 A·B — A만 해제해선 REMOVE가 안 나가고 B까지 해제해야 나간다."""
    ws = FakeWs()
    runtime = _runtime(tmp_path, ws=ws)

    await runtime.ensure_realtime_subscription("005930")  # 라우틴 A
    await runtime.ensure_realtime_subscription("005930")  # 라우틴 B(같은 심볼)
    assert ws.registered.count(("0B", ("005930",))) == 1  # REG는 0→1 전이에서만 1회
    assert ws.registered.count(("1h", ("005930",))) == 1

    await runtime.release_realtime_subscription("005930")  # A만 cancel
    assert ws.removed == []  # B가 아직 살아 있다

    await runtime.release_realtime_subscription("005930")  # B까지 cancel
    assert ("0B", ("005930",)) in ws.removed
    assert ("1h", ("005930",)) in ws.removed


@pytest.mark.asyncio
async def test_pause_resume_round_trip_resubscribes(tmp_path):
    """pause(해제)→resume(재구독) 왕복 시 REG가 다시 걸린다."""
    ws = FakeWs()
    runtime = _runtime(tmp_path, ws=ws)

    await runtime.ensure_realtime_subscription("005930")  # confirm
    assert ws.registered.count(("0B", ("005930",))) == 1

    await runtime.release_realtime_subscription("005930")  # pause
    assert ("0B", ("005930",)) in ws.removed
    assert ("1h", ("005930",)) in ws.removed

    await runtime.ensure_realtime_subscription("005930")  # resume
    assert ws.registered.count(("0B", ("005930",))) == 2
    assert ws.registered.count(("1h", ("005930",))) == 2


@pytest.mark.asyncio
async def test_expire_releases_subscription_via_scheduler_on_expire(tmp_path):
    """expire 경로도 realtime refcount 감소·release 호출이 동일하게 걸린다."""
    ws = FakeWs()

    async def on_expire(spec):
        if spec.mode == "realtime-ws":
            await runtime.release_realtime_subscription(spec.symbol)

    runtime = _runtime(tmp_path, ws=ws, on_expire=on_expire)
    store = runtime.store

    realtime_spec = _spec(symbol="005930")
    store.upsert(realtime_spec)
    store.transition(realtime_spec.id, "active")

    await runtime.ensure_realtime_subscription("005930")
    assert ws.registered.count(("0B", ("005930",))) == 1

    # 만료를 강제 — 저장된 객체 참조를 그대로 갖고 있으므로 재조회 없이 반영된다.
    expired = datetime.now(UTC) - timedelta(seconds=1)
    realtime_spec.expires_at = expired

    await runtime.scheduler.run_schedule_once()

    assert store.get(realtime_spec.id).status == "expired"
    assert ws.removed.count(("0B", ("005930",))) == 1  # 딱 1회 — 이중 해제 없음
    assert ws.removed.count(("1h", ("005930",))) == 1


# ---------- 예약(schedule.daily) 벽시계 트리거(F1) ----------


def _schedule_spec(value="ALL@07:30", symbol="005930", store=None):
    spec = validate_draft(
        {
            "symbol": symbol,
            "condition": {"source": "schedule.daily", "op": "at", "value": value},
            "cooldown_s": 60,
            "expires_days": 7,
        }
    )
    if store is not None:
        store.upsert(spec)
        store.transition(spec.id, "active")
    return spec


def test_derive_mode_full_regression_after_scheduled_mode_added():
    """활성 source와 읽기 전용 레거시 source의 mode 유도를 고정한다."""
    realtime_cases = [
        ("price.current", "<", 200000),
        ("price.change_rate", ">=", 5.0),
        ("trade.strength", ">=", 100.0),
        ("volume.prev_day_ratio", ">=", 2.0),
        ("vi.triggered", "==", True),
    ]
    for source, op, value in realtime_cases:
        cond = _spec(source=source, op=op, value=value).condition
        assert derive_mode(cond) == "realtime-ws", source

    legacy = Condition(source="disclosure.title_keyword", op="contains", value="유상증자")
    assert derive_mode(legacy) == "periodic"

    scheduled = _schedule_spec().condition
    assert derive_mode(scheduled) == "scheduled"


@pytest.mark.asyncio
async def test_schedule_loop_fires_on_weekday_time_match(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    _schedule_spec(value="1,2,3,4,5@07:30", store=store)
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    monday_0730 = datetime(2026, 8, 24, 7, 30, tzinfo=_KST)  # 2026-08-24 = 월요일
    sched = RoutineScheduler(store=store, engine=engine, notify=notify, now_kst=lambda: monday_0730)
    await sched.run_schedule_once()

    assert [e["type"] for e in events] == ["routine-fired"]
    assert events[0]["mode"] == "scheduled"
    rows = engine.ledger.read_all()
    assert len(rows) == 1
    assert rows[0]["verdict"] == "fired"
    # 이벤트 fired_at은 ledger에 실제로 쓴 ts와 문자열까지 같아야 한다 — 이 값이
    # 브리핑 보고(fired_at)와 /runs 병합의 상관 키다. 별도 now() 재계산으로
    # 마이크로초가 어긋나면 병합이 조용히 실패한다(리뷰 확정 blocker 회귀 방지).
    assert events[0]["fired_at"] == rows[0]["ts"]


@pytest.mark.asyncio
async def test_schedule_loop_skips_non_matching_weekday(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    _schedule_spec(value="1,2,3,4,5@07:30", store=store)  # 평일 전용
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    saturday_0730 = datetime(2026, 8, 22, 7, 30, tzinfo=_KST)  # 2026-08-22 = 토요일
    sched = RoutineScheduler(
        store=store, engine=engine, notify=notify, now_kst=lambda: saturday_0730
    )
    await sched.run_schedule_once()

    assert events == []
    assert engine.ledger.read_all() == []


@pytest.mark.asyncio
async def test_schedule_loop_fires_once_per_day(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    _schedule_spec(store=store)
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    now = datetime(2026, 8, 24, 7, 30, tzinfo=_KST)
    sched = RoutineScheduler(store=store, engine=engine, notify=notify, now_kst=lambda: now)
    await sched.run_schedule_once()
    await sched.run_schedule_once()  # 같은 날 두 번째 틱 — 재발화 안 함

    assert len(events) == 1


@pytest.mark.asyncio
async def test_schedule_loop_restart_resets_local_fired_state(tmp_path):
    """재기동 후 오늘 이미 발화했어도 프로세스 로컬 `_last_fired_date`가 리셋돼
    한 번 더 발화할 수 있다 — TriggerState와 동일한, 문서화된 기존 한계다."""
    store = RoutineStore(tmp_path / "r.json")
    _schedule_spec(store=store)
    ledger_path = tmp_path / "l.jsonl"
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    now = datetime(2026, 8, 24, 7, 30, tzinfo=_KST)

    sched1 = RoutineScheduler(
        store=store,
        engine=TriggerEngine(ledger=RoutineLedger(ledger_path)),
        notify=notify,
        now_kst=lambda: now,
    )
    await sched1.run_schedule_once()
    assert len(events) == 1

    # "재기동" — 새 스케줄러 인스턴스(_last_fired_date가 빈 상태로 리셋)
    sched2 = RoutineScheduler(
        store=store,
        engine=TriggerEngine(ledger=RoutineLedger(ledger_path)),
        notify=notify,
        now_kst=lambda: now,
    )
    await sched2.run_schedule_once()
    assert len(events) == 2  # 새 프로세스는 오늘 이미 발화했음을 모른다(허용된 한계)


@pytest.mark.asyncio
async def test_schedule_loop_records_last_error_on_corrupt_stored_value(tmp_path):
    """rules.py가 draft 시점에 막았어야 하나, 저장값이 손상됐을 때도 조용히
    죽지 않고 last_error에 남긴다(프리모템 1)."""
    store = RoutineStore(tmp_path / "r.json")
    spec = _schedule_spec(store=store)
    spec.condition = Condition(source="schedule.daily", op="at", value="손상된값")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    now = datetime(2026, 8, 24, 7, 30, tzinfo=_KST)
    sched = RoutineScheduler(store=store, engine=engine, notify=notify, now_kst=lambda: now)
    await sched.run_schedule_once()

    assert events == []
    assert spec.id in sched.last_error


# ---------- routine-near 에지 이벤트 (CP3) ----------


def _near_scheduler(store, engine, events):
    async def notify(ev):
        events.append(ev)

    return RoutineScheduler(store=store, engine=engine, notify=notify)


@pytest.mark.asyncio
async def test_near_enters_once_and_dedupes_consecutive_ticks(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []
    sched = _near_scheduler(store, engine, events)

    await sched._handle_verdict(spec, "near", 4.6)
    await sched._handle_verdict(spec, "near", 4.7)  # 연속 틱 — 재알림 없음
    await sched._handle_verdict(spec, "near", 4.8)

    near_events = [e for e in events if e["type"] == "routine-near"]
    assert near_events == [
        {
            "type": "routine-near",
            "routine_id": spec.id,
            "symbol": spec.symbol,
            "active": True,
            "observed": 4.6,
            "threshold": 5.0,
        }
    ]


@pytest.mark.asyncio
async def test_near_exits_once_on_verdict_change(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []
    sched = _near_scheduler(store, engine, events)

    await sched._handle_verdict(spec, "near", 4.6)
    await sched._handle_verdict(spec, None, 1.0)  # 조용 — 이탈
    await sched._handle_verdict(spec, None, 1.0)  # 계속 조용 — 재이탈 없음

    near_events = [e for e in events if e["type"] == "routine-near"]
    assert [e["active"] for e in near_events] == [True, False]


@pytest.mark.asyncio
async def test_near_exits_before_fired_notify(tmp_path):
    """근접에서 바로 발화로 넘어가도 이탈이 fired보다 먼저, 한 번만 나간다."""
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []
    sched = _near_scheduler(store, engine, events)

    await sched._handle_verdict(spec, "near", 4.6)
    await sched._handle_verdict(spec, "fired", 6.0)

    assert [e["type"] for e in events] == [
        "routine-near",
        "routine-near",
        "routine-fired",
    ]
    assert [e["active"] for e in events[:2]] == [True, False]


@pytest.mark.asyncio
async def test_clear_near_on_cancel_sends_exit_once(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []
    sched = _near_scheduler(store, engine, events)

    await sched._handle_verdict(spec, "near", 4.6)
    cancelled = store.transition(spec.id, "cancelled")
    await sched.clear_near(cancelled)
    await sched.clear_near(cancelled)  # 중복 호출에도 이탈 알림은 1회

    near_events = [e for e in events if e["type"] == "routine-near"]
    assert [e["active"] for e in near_events] == [True, False]


@pytest.mark.asyncio
async def test_expire_pass_clears_ghost_near(tmp_path):
    """만료로 평가가 끊겨도 근접 이탈 신호가 나가야 오브가 watch에 갇히지 않는다."""
    from datetime import UTC, datetime, timedelta

    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")
    stored = store.get(spec.id)
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)  # 강제 만료

    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []
    sched = _near_scheduler(store, engine, events)

    await sched._handle_verdict(stored, "near", 4.6)
    await sched._expire_pass()

    assert [e["type"] for e in events] == [
        "routine-near",
        "routine-near",
        "routine-expired",
    ]
    assert [e["active"] for e in events[:2]] == [True, False]


# ---------- near 스냅샷 — 재연결/재시작 복원(결함6) ----------


@pytest.mark.asyncio
async def test_near_snapshot_reflects_current_near_set(tmp_path):
    """근접 중이면 스냅샷에 담기고, 이탈하면 다시 빈 목록이 된다."""
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []
    sched = _near_scheduler(store, engine, events)

    assert sched.near_snapshot() == []  # 근접 전 — 빈 스냅샷

    await sched._handle_verdict(spec, "near", 4.6)
    assert sched.near_snapshot() == [
        {
            "type": "routine-near",
            "routine_id": spec.id,
            "symbol": spec.symbol,
            "active": True,
            "observed": None,
            "threshold": 5.0,
        }
    ]

    await sched._handle_verdict(spec, None, 1.0)  # 이탈
    assert sched.near_snapshot() == []


@pytest.mark.asyncio
async def test_near_snapshot_empty_on_new_scheduler_instance_after_restart(tmp_path):
    """재시작은 새 프로세스=새 스케줄러 인스턴스다. _near_active는 프로세스
    로컬이라 옮겨오지 않으므로 새 인스턴스의 스냅샷은 정직하게 비어 있어야
    한다 — 앱이 이를 근거로 watching 리셋을 확정한다(결함6)."""
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))

    old_events: list[dict] = []
    old_sched = _near_scheduler(store, engine, old_events)
    await old_sched._handle_verdict(spec, "near", 4.6)
    assert old_sched.near_snapshot() != []  # 재시작 전 — near 유지 중

    new_events: list[dict] = []
    new_sched = _near_scheduler(store, engine, new_events)  # 재시작 시뮬레이션
    assert new_sched.near_snapshot() == []


# ---------- 경계 진동 — 데드밴드가 진입/이탈 반복 발신을 막는다(결함7) ----------


@pytest.mark.asyncio
async def test_realtime_loop_deadband_suppresses_repeated_near_toggle(tmp_path):
    """근접 경계 부근을 오가는 틱이 연달아 와도 진입 1회 이후 반복 이탈/재진입
    이벤트가 나가지 않는다."""
    store = RoutineStore(tmp_path / "r.json")
    spec = _spec()  # threshold=5.0, op>=
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    queue: asyncio.Queue = asyncio.Queue()
    sched = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        subscribe_ticks=lambda: queue,
    )
    await sched.start()
    for rate in ("+4.60", "+4.35", "+4.60", "+4.35"):  # 진입경계(0.10) 안팎 교대
        await queue.put(
            {
                "trnm": "REAL",
                "data": [{"type": "0B", "item": "005930", "values": {"12": rate}}],
            }
        )
    await asyncio.sleep(0.05)
    await sched.stop()

    near_events = [e for e in events if e["type"] == "routine-near"]
    assert [e["active"] for e in near_events] == [True]  # 진입 1회, 이탈 없음


# ---------- 큐 포화 시 알림 손실 정책 ----------


@pytest.mark.asyncio
async def test_notify_drops_oldest_when_queue_full(tmp_path):
    from athena_api.routines.runtime import _notify_factory

    q: asyncio.Queue = asyncio.Queue(2)
    notify = _notify_factory(q)
    for i in range(4):
        await notify({"n": i})
    got = [q.get_nowait()["n"], q.get_nowait()["n"]]
    assert got == [2, 3]  # 최신 우선 — 가장 오래된 것을 버린다


# ---------- record_scheduled_fire — 정시·캐치업 경로 대조(R1, 3단계) ----------


def test_record_scheduled_fire_paths_produce_identical_shape(tmp_path):
    """정시 경로(threshold 명시)와 캐치업 경로(생략 → 스펙 조건값 자동 대체)가
    동일한 threshold·필드 집합의 fired 행을 낸다 — 판정 조립 지점 단일화(P4)."""
    spec = validate_draft(
        {
            "symbol": "005930",
            "condition": {"source": "schedule.daily", "op": "at", "value": "ALL@07:30"},
            "cooldown_s": 1800,
            "expires_days": 7,
        }
    )
    ledger = RoutineLedger(tmp_path / "ledger.jsonl")

    row_sched = record_scheduled_fire(
        spec, ledger, "07:30", reason="예약 시각 도달(07:30)", threshold=spec.condition.value
    )
    row_catchup = record_scheduled_fire(
        spec, ledger, "07:31", reason="놓친 예약 캐치업(사용자 승인)"
    )

    assert row_sched["threshold"] == row_catchup["threshold"] == "ALL@07:30"
    assert row_sched["verdict"] == row_catchup["verdict"] == "fired"
    assert set(row_sched) == set(row_catchup)  # 두 경로의 행 모양이 갈라지지 않는다
    assert len(ledger.read_all()) == 2


# ---------- 코드 감시 루프(_code_loop) — B-14 · B-15 · B-20(복원) · B-21 ----------


_WATCH_SOURCE = """NODE_LABELS = {"signals": "알림"}


def signals(df, p):
    out = df[[]].copy()
    out["entry"] = df["close"] > 0
    out["exit"] = False
    return out
"""

_MONDAY_1000 = datetime(2026, 8, 24, 10, 0, tzinfo=_KST)  # 2026-08-24 = 월요일 장중
_SATURDAY_1000 = datetime(2026, 8, 22, 10, 0, tzinfo=_KST)


class _StubRunner:
    """감시 러너 스텁 — 샌드박스를 띄우지 않고 판정만 돌려준다."""

    def __init__(self, observed=True, *, error=None, blocking_s: float = 0.0):
        self.observed = observed
        self.error = error
        self.blocking_s = blocking_s
        self.calls: list[tuple[str, int, dict]] = []

    async def run(self, source, df, params=None, *, trace=False):
        self.calls.append((source, len(df), dict(params or {})))
        if self.blocking_s:
            # 진짜 러너와 같은 모양 — 무거운 일은 스레드 풀에서 돈다(B-15).
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, time.sleep, self.blocking_s)
        return RunResult(
            observed=None if self.error else self.observed,
            duration_ms=7,
            error=self.error,
        )


class _CountingStore:
    """일봉 캐시 스텁 — 종목별 조회 횟수를 센다(종목당 1회 계약)."""

    def __init__(self, candles):
        self._candles = tuple(candles)
        self.calls: list[str] = []

    async def candles(self, stk_cd, period, adjusted, *, start=None, end=None):
        self.calls.append(stk_cd)
        return self._candles


def _bars(last="20260821", n=40):
    end = datetime.strptime(last, "%Y%m%d").date()
    out = []
    for i in range(n):
        day = end - timedelta(days=n - 1 - i)
        out.append(
            Candle(
                dt=day.strftime("%Y%m%d"),
                open=100.0,
                high=101.0,
                low=99.0,
                close=100.0 + i,
                volume=1000,
            )
        )
    return out


def _watch_project(tmp_path, monkeypatch, *, source=_WATCH_SOURCE, name="volume_spike.py"):
    root = tmp_path / "proj"
    (root / "watch").mkdir(parents=True, exist_ok=True)
    target = root / "watch" / name
    target.write_bytes(source.encode("utf-8"))
    monkeypatch.setattr(projects_store, "resolve_project_path", lambda pid: root)
    return target, hashlib.sha256(target.read_bytes()).hexdigest()


def _code_spec(
    store,
    version_hash,
    *,
    symbol="005930",
    path="watch/volume_spike.py",
    cooldown_s=1800,
    status="active",
    lookback_days=30,
    poll_interval_s=60,
):
    spec = validate_draft(
        {
            "symbol": symbol,
            "condition": {"source": "code.watch", "op": "==", "value": True},
            "cooldown_s": cooldown_s,
            "expires_days": 7,
            "watch": {
                "project_id": "p1",
                "path": path,
                "version_hash": version_hash,
                "poll_interval_s": poll_interval_s,
                "lookback_days": lookback_days,
            },
        }
    )
    store.upsert(spec)
    if status == "active":
        store.transition(spec.id, "active")
    return spec


def _code_scheduler(tmp_path, *, runner, candle_store, now=_MONDAY_1000):
    store = RoutineStore(tmp_path / "r.json")
    ledger = RoutineLedger(tmp_path / "l.jsonl")
    engine = TriggerEngine(ledger=ledger)
    sink: list[dict] = []

    async def notify(ev):
        sink.append(ev)

    sched = RoutineScheduler(store=store, engine=engine, notify=notify, now_kst=lambda: now)
    sched.watch_runtime = SimpleNamespace(
        watch_runner=runner,
        watch_candle_store=candle_store,
        watch_quote_provider=None,
        watch_last={},
    )
    return sched, store, ledger, sink


async def test_code_loop_runs_only_active_code_watch_once_per_symbol(tmp_path, monkeypatch):
    """B-14 — 한 주기: 활성 code-watch만, 종목별 프레임 1회, fired 원장에 코드 원문 부재."""
    _, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner(observed=True)
    candles = _CountingStore(_bars())
    sched, store, ledger, events = _code_scheduler(tmp_path, runner=runner, candle_store=candles)
    first = _code_spec(store, digest)
    second = _code_spec(store, digest)  # 같은 종목 두 번째 알람
    _code_spec(store, digest, status="draft")  # 초안 — 돌지 않는다
    other = _spec()  # 실시간 알람 — 이 루프의 대상이 아니다
    store.upsert(other)
    store.transition(other.id, "active")

    await sched.run_code_once()

    assert candles.calls == ["005930"]  # 종목당 프레임 1회
    assert len(runner.calls) == 2  # 그 프레임을 알람 둘이 나눠 쓴다
    rows = ledger.read_all()
    assert {r["routine_id"] for r in rows} == {first.id, second.id}
    assert [r["verdict"] for r in rows] == ["fired", "fired"]
    assert set(rows[0]) == {
        "ts",
        "routine_id",
        "symbol",
        "source",
        "verdict",
        "observed",
        "threshold",
        "reason",
        "duration_ms",
    }
    assert rows[0]["duration_ms"] == 7
    assert "signals" not in json.dumps(rows, ensure_ascii=False)  # 코드 원문 없음
    assert [e["type"] for e in events] == ["routine-fired", "routine-fired"]
    assert sched.watch_runtime.watch_last["run:" + first.id]["observed"] is True


async def test_code_loop_skips_outside_market_hours(tmp_path, monkeypatch):
    """장중(KST 평일 09:00~15:30) 밖에서는 프레임도 만들지 않는다."""
    _, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner()
    candles = _CountingStore(_bars())
    sched, store, ledger, _ = _code_scheduler(
        tmp_path, runner=runner, candle_store=candles, now=_SATURDAY_1000
    )
    _code_spec(store, digest)

    await sched.run_code_once()

    assert candles.calls == []
    assert runner.calls == []
    assert ledger.read_all() == []


def test_market_hours_boundaries():
    assert not in_code_market_hours(datetime(2026, 8, 24, 8, 59, tzinfo=_KST))
    assert in_code_market_hours(datetime(2026, 8, 24, 9, 0, tzinfo=_KST))
    assert in_code_market_hours(datetime(2026, 8, 24, 15, 30, tzinfo=_KST))
    assert not in_code_market_hours(datetime(2026, 8, 24, 15, 31, tzinfo=_KST))
    assert not in_code_market_hours(datetime(2026, 8, 23, 10, 0, tzinfo=_KST))  # 일요일


def test_market_hours_window_is_configurable():
    """시연용으로 창을 넓히고 요일 잠금을 풀 수 있다 — 기본값은 그대로다."""
    sunday_evening = datetime(2026, 8, 23, 20, 0, tzinfo=_KST)
    assert not in_code_market_hours(sunday_evening)
    assert in_code_market_hours(
        sunday_evening,
        open_hhmm="00:00",
        close_hhmm="23:59",
        weekdays_only=False,
    )
    # 요일 잠금만 풀면 저녁 8시는 여전히 창 밖이다.
    assert not in_code_market_hours(sunday_evening, weekdays_only=False)


async def test_code_loop_runs_on_a_sunday_when_the_window_is_opened(tmp_path, monkeypatch):
    """시연 설정이 열리면 일요일 저녁에도 한 주기가 돈다 — 기본값에서는 막힌다."""
    _, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner(observed=False)
    candles = _CountingStore(_bars())
    sched, store, ledger, _ = _code_scheduler(
        tmp_path,
        runner=runner,
        candle_store=candles,
        now=datetime(2026, 8, 23, 20, 0, tzinfo=_KST),
    )
    _code_spec(store, digest)

    await sched.run_code_once()
    assert candles.calls == []  # 기본 창 — 일요일 저녁은 돌지 않는다
    assert ledger.read_all() == []

    sched.code_market_open = "00:00"
    sched.code_market_close = "23:59"
    sched.code_market_weekdays_only = False
    await sched.run_code_once()

    assert candles.calls == ["005930"]


async def test_code_loop_honors_each_alarms_poll_interval(tmp_path, monkeypatch):
    """전역 tick은 60초 그대로, 알람은 제 확인 주기가 찰 때만 본다."""
    _, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner(observed=False)
    sched, store, ledger, _ = _code_scheduler(
        tmp_path, runner=runner, candle_store=_CountingStore(_bars())
    )
    clock = {"t": 0.0}
    sched.monotonic = lambda: clock["t"]
    fast = _code_spec(store, digest, poll_interval_s=60)
    slow = _code_spec(store, digest, poll_interval_s=300)

    seen: list[tuple[float, str]] = []
    original = sched._run_one_code_watch

    async def spy(spec, df, run, runtime):
        seen.append((clock["t"], spec.id))
        await original(spec, df, run, runtime)

    sched._run_one_code_watch = spy

    for tick in range(6):  # 0·60·120·180·240·300초
        clock["t"] = tick * 60.0
        await sched.run_code_once()

    assert [t for t, rid in seen if rid == fast.id] == [0.0, 60.0, 120.0, 180.0, 240.0, 300.0]
    assert [t for t, rid in seen if rid == slow.id] == [0.0, 300.0]
    # 아직 볼 때가 아닌 주기는 원장에 사유를 남기지 않는다 — 못 본 게 아니다.
    assert [r["routine_id"] for r in ledger.read_all() if r["verdict"] == "suppressed"] == []


async def test_code_loop_records_stale_frame_as_suppressed(tmp_path, monkeypatch):
    """휴장일 추정(마지막 완성 봉이 직전 평일보다 오래됨)은 사유와 함께 기록된다."""
    _, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner()
    candles = _CountingStore(_bars(last="20260814"))
    sched, store, ledger, _ = _code_scheduler(tmp_path, runner=runner, candle_store=candles)
    spec = _code_spec(store, digest)

    await sched.run_code_once()

    (row,) = ledger.read_all()
    assert row["verdict"] == "suppressed"
    assert row["routine_id"] == spec.id
    assert "휴장일" in row["reason"]
    assert runner.calls == []


async def test_code_loop_records_run_failure_as_suppressed(tmp_path, monkeypatch):
    _, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner(error={"type": "ValueError", "message": "터짐"})
    sched, store, ledger, _ = _code_scheduler(
        tmp_path, runner=runner, candle_store=_CountingStore(_bars())
    )
    spec = _code_spec(store, digest)

    await sched.run_code_once()

    (row,) = ledger.read_all()
    assert row["verdict"] == "suppressed"
    assert row["reason"] == "감시 함수 실행 실패"
    assert row["duration_ms"] == 7
    assert store.get(spec.id).status == "active"  # 실행 실패는 알람을 끄지 않는다


async def test_code_loop_does_not_block_the_event_loop(tmp_path, monkeypatch):
    """B-15 — 감시 함수가 도는 동안 다른 태스크가 계속 진행한다."""
    _, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner(blocking_s=0.3)
    sched, store, _, _ = _code_scheduler(
        tmp_path, runner=runner, candle_store=_CountingStore(_bars())
    )
    _code_spec(store, digest)
    ticks = 0

    async def other():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.create_task(other())
    await sched.run_code_once()
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task

    assert ticks >= 5  # 0.3초 동안 다른 태스크가 여러 번 돌았다
    assert len(runner.calls) == 1


async def test_code_loop_fails_the_routine_when_the_file_changed(tmp_path, monkeypatch):
    """B-21 — 파일이 바뀌면 그 주기는 돌지 않고 알람을 failed로 옮기며 안내를 낸다."""
    target, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner()
    sched, store, ledger, events = _code_scheduler(
        tmp_path, runner=runner, candle_store=_CountingStore(_bars())
    )
    spec = _code_spec(store, digest)
    target.write_bytes((_WATCH_SOURCE + "\n# 몰래 고침\n").encode("utf-8"))

    await sched.run_code_once()

    assert runner.calls == []
    assert store.get(spec.id).status == "failed"
    assert events == [
        {
            "type": "routine-restore-failed",
            "routine_id": spec.id,
            "reason": "감시 코드가 바뀌거나 사라짐 — 다시 검사",
        }
    ]
    assert ledger.read_all() == []


async def test_code_loop_fails_the_routine_when_the_file_is_gone(tmp_path, monkeypatch):
    target, digest = _watch_project(tmp_path, monkeypatch)
    runner = _StubRunner()
    sched, store, _, events = _code_scheduler(
        tmp_path, runner=runner, candle_store=_CountingStore(_bars())
    )
    spec = _code_spec(store, digest)
    target.unlink()

    await sched.run_code_once()

    assert store.get(spec.id).status == "failed"
    assert events[0]["reason"] == "감시 코드가 바뀌거나 사라짐 — 다시 검사"


async def test_fire_persists_last_fired_at_and_survives_restart(tmp_path, monkeypatch):
    """B-20(복원) — 발화 시각을 저장하고, 재기동 직후 쿨다운 안에서는 다시 안 울린다."""
    _, digest = _watch_project(tmp_path, monkeypatch)
    sched, store, _, _ = _code_scheduler(
        tmp_path, runner=_StubRunner(), candle_store=_CountingStore(_bars())
    )
    spec = _code_spec(store, digest, cooldown_s=1800)

    await sched.run_code_once()

    saved = json.loads((tmp_path / "r.json").read_text(encoding="utf-8"))
    (row,) = [r for r in saved["routines"] if r["id"] == spec.id]
    assert row["watch"]["last_fired_at"]  # 벽시계 시각이 남았다

    # 재기동 — 새 저장소·새 엔진에 저장된 발화 시각을 되살린다.
    store2 = RoutineStore(tmp_path / "r.json")
    store2.load()
    ledger2 = RoutineLedger(tmp_path / "l2.jsonl")
    engine2 = TriggerEngine(ledger=ledger2)

    async def noop(_ev):
        pass

    sched2 = RoutineScheduler(
        store=store2, engine=engine2, notify=noop, now_kst=lambda: _MONDAY_1000
    )
    sched2.watch_runtime = SimpleNamespace(
        watch_runner=_StubRunner(),
        watch_candle_store=_CountingStore(_bars()),
        watch_quote_provider=None,
        watch_last={},
    )
    runtime2 = RoutinesRuntime(
        store=store2,
        ledger=ledger2,
        engine=engine2,
        scheduler=sched2,
        events=asyncio.Queue(200),
        read_marks=ReadMarksStore(tmp_path / "read_marks2.json"),
        engagement=EngagementStore(tmp_path / "engagement2.jsonl"),
        briefings=BriefingStore(tmp_path / "briefings2.jsonl"),
    )
    assert runtime2.restore_trigger_state() == 1

    await sched2.run_code_once()

    (suppressed,) = ledger2.read_all()
    assert suppressed["verdict"] == "suppressed"
    assert "쿨다운" in suppressed["reason"]


async def test_code_loop_is_not_started_without_a_runner(tmp_path):
    """러너가 없으면 code 루프는 아예 서지 않는다 — 조용히 도는 빈 루프를 만들지 않는다."""
    store = RoutineStore(tmp_path / "r.json")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))

    async def noop(_ev):
        pass

    sched = RoutineScheduler(store=store, engine=engine, notify=noop)
    await sched.start()
    started = len(sched._tasks)
    await sched.stop()

    sched.watch_runtime = SimpleNamespace(
        watch_runner=_StubRunner(),
        watch_candle_store=None,
        watch_quote_provider=None,
        watch_last={},
    )
    await sched.start()
    assert len(sched._tasks) == started + 1
    await sched.stop()
