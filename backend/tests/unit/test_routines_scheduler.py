"""스케줄러·영속·공시 소스(US-006) — 가짜 시계·픽스처로 고정한다."""

from __future__ import annotations

import asyncio
import io
import zipfile

import pytest

from athena_api.routines.corp_catalog import extract_corp_xml, parse_corp_xml
from athena_api.routines.disclosure_source import (
    DisclosureSourceError,
    parse_list_payload,
)
from athena_api.routines.ledger import RoutineLedger
from athena_api.routines.rules import validate_draft
from athena_api.routines.scheduler import RoutineScheduler, adapt_real_message
from athena_api.routines.store import RoutineStore, RoutineTransitionError
from athena_api.routines.triggers import TriggerEngine


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
    assert fired[0]["goal"] is False  # 기본값 — goal 미지정 루틴


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
    assert fired[0]["goal"] is True


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


# ---------- routine-near 에지 이벤트 (CP3) ----------


def _near_scheduler(store, engine, events):
    async def notify(ev):
        events.append(ev)

    return RoutineScheduler(store=store, engine=engine, notify=notify, poll_interval_s=9999)


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
        poll_interval_s=9999,
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
