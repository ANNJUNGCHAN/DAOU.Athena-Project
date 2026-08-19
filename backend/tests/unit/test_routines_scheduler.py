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


# ---------- 큐 포화 시 알림 손실 정책 ----------


@pytest.mark.asyncio
async def test_notify_drops_oldest_when_queue_full(tmp_path):
    from athena_api.routines.runtime import _notify_factory

    q: asyncio.Queue = asyncio.Queue(2)
    notify = await _notify_factory(q)
    for i in range(4):
        await notify({"n": i})
    got = [q.get_nowait()["n"], q.get_nowait()["n"]]
    assert got == [2, 3]  # 최신 우선 — 가장 오래된 것을 버린다
