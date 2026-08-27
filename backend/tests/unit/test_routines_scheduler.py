"""스케줄러·영속·공시 소스(US-006) — 가짜 시계·픽스처로 고정한다."""

from __future__ import annotations

import asyncio
import io
import zipfile
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

from athena_api.routines.corp_catalog import extract_corp_xml, parse_corp_xml
from athena_api.routines.disclosure_source import (
    DisclosureSourceError,
    parse_list_payload,
)
from athena_api.routines.briefings import BriefingStore
from athena_api.routines.engagement import EngagementStore
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.models import Condition, derive_mode
from athena_api.routines.read_marks import ReadMarksStore
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import RoutinesRuntime
from athena_api.routines.scheduler import (
    RoutineScheduler,
    adapt_real_message,
    record_scheduled_fire,
)
from athena_api.routines.store import RoutineStore, RoutineTransitionError
from athena_api.routines.triggers import TriggerEngine

_KST = timezone(timedelta(hours=9))


def _spec(source="price.change_rate", op=">=", value=5.0, symbol="005930"):
    return validate_draft(
        {
            "symbol": symbol,
            "condition": {"source": source, "op": op, "value": value},
            "cooldown_s": 60,
            "expires_days": 7,
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
        poll_interval_s=9999,
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


@pytest.mark.asyncio
async def test_periodic_once_expires_and_polls_disclosure(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    spec = validate_draft(
        {
            "symbol": "207940",
            "condition": {
                "source": "disclosure.title_keyword",
                "op": "contains",
                "value": "유상증자",
            },
            "cooldown_s": 60,
            "expires_days": 7,
        }
    )
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    class FakeDisclosure:
        async def fetch_new_titles(self, symbol, *, bgn_de, end_de):
            assert symbol == "207940"
            return ["주요사항보고서(유상증자결정)", "반기보고서"]

    sched = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        disclosure=FakeDisclosure(),
        poll_interval_s=9999,
    )
    await sched.run_periodic_once()
    assert [e["type"] for e in events] == ["routine-fired"]
    assert events[0]["mode"] == "periodic"


@pytest.mark.asyncio
async def test_run_periodic_once_measures_disclosure_fetch_duration(tmp_path):
    """F2 — 공시 폴링의 fetch_new_titles 소요시간이 duration_ms로 ledger에 남는다."""
    store = RoutineStore(tmp_path / "r.json")
    spec = validate_draft(
        {
            "symbol": "207940",
            "condition": {
                "source": "disclosure.title_keyword",
                "op": "contains",
                "value": "유상증자",
            },
            "cooldown_s": 60,
            "expires_days": 7,
        }
    )
    store.upsert(spec)
    store.transition(spec.id, "active")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))

    async def notify(ev):
        pass

    class SlowDisclosure:
        async def fetch_new_titles(self, symbol, *, bgn_de, end_de):
            await asyncio.sleep(0.02)
            return ["주요사항보고서(유상증자결정)"]

    sched = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        disclosure=SlowDisclosure(),
        poll_interval_s=9999,
    )
    await sched.run_periodic_once()

    rows = engine.ledger.read_all()
    assert len(rows) == 1
    assert rows[0]["duration_ms"] is not None
    assert rows[0]["duration_ms"] >= 15  # 20ms 슬립보다 관대한 하한(타이밍 노이즈)


@pytest.mark.asyncio
async def test_periodic_once_skipped_when_headroom_low(tmp_path):
    """양보 판정은 루프에서 일어난다 — should_yield는 US-005에서 검증됐고,
    여기서는 낮은 headroom 주입 시 run_periodic_once가 호출되지 않음을 본다."""
    store = RoutineStore(tmp_path / "r.json")
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    calls: list[str] = []

    async def notify(ev):
        calls.append(ev["type"])

    sched = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        poll_interval_s=0.01,
        headroom=lambda: 0,  # 대화 burst 상황
    )
    ran = {"count": 0}
    orig = sched.run_periodic_once

    async def counting():
        ran["count"] += 1
        await orig()

    sched.run_periodic_once = counting  # type: ignore[method-assign]
    await sched.start()
    await asyncio.sleep(0.06)
    await sched.stop()
    assert ran["count"] == 0  # 전 주기 양보


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
    """expire 경로도 refcount 감소·release 호출이 동일하게 걸린다.

    같은 심볼을 쓰는 periodic 스펙이 같이 만료돼도 realtime-ws 몫의
    구독을 잘못 건드리지 않아야 한다(모드 무관 무조건 해제는 다른
    라우틴이 쥔 참조를 잘못 반납시키는 결함이라 게이트가 필요하다).
    """
    ws = FakeWs()

    async def on_expire(spec):
        if spec.mode == "realtime-ws":
            await runtime.release_realtime_subscription(spec.symbol)

    runtime = _runtime(tmp_path, ws=ws, on_expire=on_expire)
    store = runtime.store

    realtime_spec = _spec(symbol="005930")
    store.upsert(realtime_spec)
    store.transition(realtime_spec.id, "active")

    periodic_spec = validate_draft(
        {
            "symbol": "005930",
            "condition": {
                "source": "disclosure.title_keyword",
                "op": "contains",
                "value": "유상증자",
            },
            "cooldown_s": 60,
            "expires_days": 7,
        }
    )
    store.upsert(periodic_spec)
    store.transition(periodic_spec.id, "active")

    await runtime.ensure_realtime_subscription("005930")
    assert ws.registered.count(("0B", ("005930",))) == 1

    # 만료를 강제 — 저장된 객체 참조를 그대로 갖고 있으므로 재조회 없이 반영된다.
    expired = datetime.now(UTC) - timedelta(seconds=1)
    realtime_spec.expires_at = expired
    periodic_spec.expires_at = expired

    await runtime.scheduler._expire_pass()

    assert store.get(realtime_spec.id).status == "expired"
    assert store.get(periodic_spec.id).status == "expired"
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
    """BLOCKER 회귀 방지(사실10) — schedule.daily 도입이 기존 6종 소스 라우팅을
    안 건드리고, schedule.daily 자신은 정확히 scheduled로 라우팅됨을 전수 확인."""
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

    disclosure = validate_draft(
        {
            "symbol": "207940",
            "condition": {
                "source": "disclosure.title_keyword",
                "op": "contains",
                "value": "유상증자",
            },
            "cooldown_s": 60,
            "expires_days": 7,
        }
    ).condition
    assert derive_mode(disclosure) == "periodic"

    scheduled = _schedule_spec().condition
    assert derive_mode(scheduled) == "scheduled"


@pytest.mark.asyncio
async def test_run_periodic_once_skips_schedule_daily(tmp_path):
    """BLOCKER 회귀 방지 — schedule.daily가 periodic 폴링(fetch_new_titles·
    evaluate)에 전혀 걸리지 않고, disclosure 스펙만 정상 평가됨을 명시 단언."""
    store = RoutineStore(tmp_path / "r.json")
    _schedule_spec(store=store)

    disclosure_spec = validate_draft(
        {
            "symbol": "207940",
            "condition": {
                "source": "disclosure.title_keyword",
                "op": "contains",
                "value": "유상증자",
            },
            "cooldown_s": 60,
            "expires_days": 7,
        }
    )
    store.upsert(disclosure_spec)
    store.transition(disclosure_spec.id, "active")

    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    fetched: list[str] = []

    class FakeDisclosure:
        async def fetch_new_titles(self, symbol, *, bgn_de, end_de):
            fetched.append(symbol)
            return ["주요사항보고서(유상증자결정)"]

    sched = RoutineScheduler(
        store=store,
        engine=engine,
        notify=notify,
        disclosure=FakeDisclosure(),
        poll_interval_s=9999,
    )
    await sched.run_periodic_once()

    assert fetched == ["207940"]  # schedule.daily(005930)은 조회 자체가 없었다
    assert [e["type"] for e in events] == ["routine-fired"]
    assert events[0]["mode"] == "periodic"


@pytest.mark.asyncio
async def test_schedule_loop_fires_on_weekday_time_match(tmp_path):
    store = RoutineStore(tmp_path / "r.json")
    _schedule_spec(value="1,2,3,4,5@07:30", store=store)
    engine = TriggerEngine(ledger=RoutineLedger(tmp_path / "l.jsonl"))
    events: list[dict] = []

    async def notify(ev):
        events.append(ev)

    monday_0730 = datetime(2026, 8, 24, 7, 30, tzinfo=_KST)  # 2026-08-24 = 월요일
    sched = RoutineScheduler(
        store=store, engine=engine, notify=notify, now_kst=lambda: monday_0730
    )
    await sched.run_schedule_once()

    assert [e["type"] for e in events] == ["routine-fired"]
    assert events[0]["mode"] == "scheduled"
    rows = engine.ledger.read_all()
    assert len(rows) == 1
    assert rows[0]["verdict"] == "fired"


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


# ---------- 공시 소스·corp 카탈로그 파싱 (픽스처 — 실호출 없음) ----------


def test_parse_list_payload_states():
    ok = {
        "status": "000",
        "list": [
            {"rcept_no": "1", "report_nm": "유상증자결정", "rcept_dt": "20260819"},
            {"rcept_no": "", "report_nm": "무시"},
        ],
    }
    assert parse_list_payload(ok) == [
        {"rcept_no": "1", "title": "유상증자결정", "date": "20260819"}
    ]
    assert parse_list_payload({"status": "013"}) == []
    with pytest.raises(DisclosureSourceError):
        parse_list_payload({"status": "020"})


def test_corp_catalog_parse_and_zip_extract():
    xml = (
        b"<result>"
        b"<list><corp_code>126380</corp_code><stock_code>005930</stock_code></list>"
        b"<list><corp_code>99999999</corp_code><stock_code></stock_code></list>"
        b"</result>"
    )
    mapping = parse_corp_xml(xml)
    assert mapping == {"005930": "00126380"}  # zfill(8) 함정 고정

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("CORPCODE.xml", xml)
    assert parse_corp_xml(extract_corp_xml(buf.getvalue())) == {"005930": "00126380"}


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
