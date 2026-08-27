"""루틴 REST(US-007) — 권한 경계·상태 전이·503 fail-closed."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.routines import router
from athena_api.config import Settings
from athena_api.errors import install_exception_handlers
from athena_api.routines.archive import rollover_jsonl
from athena_api.routines.guard_settings import GuardSettingsStore
from athena_api.routines.runtime import open_routines, teardown_routines


@pytest.fixture
def app_client(tmp_path):
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)

    settings = Settings(
        _env_file=None,
        routines_enabled=True,
        routines_store_path=tmp_path / "routines.json",
        routines_ledger_path=tmp_path / "ledger.jsonl",
        routines_read_marks_path=tmp_path / "read_marks.json",
        routines_engagement_path=tmp_path / "engagement.jsonl",
        routines_briefings_path=tmp_path / "briefings.jsonl",
        routines_ledger_archive_dir=tmp_path / "archive",
    )

    loop = asyncio.new_event_loop()
    runtime = loop.run_until_complete(open_routines(settings, ws_client=None))
    app.state.routines_runtime = runtime
    # briefing-budget이 읽는 가드 설정 — 실제 lifespan과 동일하게 app.state에 둔다.
    app.state.nudge_guard_store = GuardSettingsStore(tmp_path / "nudge_guard.json")
    app.state.nudge_guard_store.load()
    yield TestClient(app), runtime
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


DRAFT = {
    "symbol": "005930",
    "condition": {"source": "price.current", "op": "<", "value": 200000},
    "cooldown_s": 1800,
    "expires_days": 7,
}


def test_disabled_deployment_is_503():
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)
    app.state.routines_runtime = None
    client = TestClient(app)
    assert client.get("/api/v1/routines").status_code == 503
    assert client.post("/api/v1/routines/draft", json=DRAFT).status_code == 503


def test_draft_list_view_hides_raw_condition(app_client):
    client, _ = app_client
    res = client.post("/api/v1/routines/draft", json=DRAFT)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "draft"
    assert body["mode"] == "realtime-ws"
    assert "condition" not in body  # 원문 dict 비노출 — 해석문(note)만
    assert "현재가" in body["note"]

    listing = client.get("/api/v1/routines").json()
    assert len(listing["routines"]) == 1
    assert "condition" not in listing["routines"][0]


def test_draft_validation_error_is_422_domain(app_client):
    client, _ = app_client
    bad = dict(DRAFT, condition={"source": "evil()", "op": "<", "value": 1})
    res = client.post("/api/v1/routines/draft", json=bad)
    assert res.status_code == 422
    assert res.json()["detail"] == "루틴 조건이 유효하지 않다"


def test_confirm_blocked_without_ws_then_cancel(app_client):
    client, _ = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    # WS 미가용 — 정직 게이트가 활성화를 거부한다(조용히 죽은 감시 금지)
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 409
    assert "실시간" in res.json()["detail"]
    # 취소는 가능
    res = client.post(f"/api/v1/routines/{rid}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    # 종결 상태 재전이는 409
    assert client.post(f"/api/v1/routines/{rid}/cancel").status_code == 409


def test_confirm_activates_with_fake_ws(app_client):
    client, runtime = app_client

    class FakeWs:
        def __init__(self):
            self.registered = []

        async def register(self, tr_id, items, **kw):
            self.registered.append((tr_id, tuple(items)))
            return {}

        def subscribe_events(self):  # scheduler 재시작 없음 — 여기선 미사용
            raise AssertionError

        def unsubscribe_events(self, q):
            raise AssertionError

    runtime.ws_client = FakeWs()
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    assert ("0B", ("005930",)) in runtime.ws_client.registered
    assert ("1h", ("005930",)) in runtime.ws_client.registered


def test_unknown_routine_is_404(app_client):
    client, _ = app_client
    assert client.post("/api/v1/routines/none/confirm").status_code == 404
    assert client.post("/api/v1/routines/none/cancel").status_code == 404
    assert client.post("/api/v1/routines/none/pause").status_code == 404
    assert client.post("/api/v1/routines/none/resume").status_code == 404


class FakeWs:
    def __init__(self):
        self.registered = []
        self.removed = []

    async def register(self, tr_id, items, **kw):
        self.registered.append((tr_id, tuple(items)))
        return {}

    async def remove(self, tr_id, items, **kw):
        self.removed.append((tr_id, tuple(items)))
        return {}


def test_pause_then_resume_routine(app_client):
    client, runtime = app_client
    runtime.ws_client = FakeWs()
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    assert runtime.ws_client.registered.count(("0B", ("005930",))) == 1
    assert runtime.ws_client.registered.count(("1h", ("005930",))) == 1

    res = client.post(f"/api/v1/routines/{rid}/pause")
    assert res.status_code == 200
    assert res.json()["status"] == "paused"
    # pause는 참조카운트를 0으로 만들어 REAL 구독을 실제로 해제한다(F5).
    assert ("0B", ("005930",)) in runtime.ws_client.removed
    assert ("1h", ("005930",)) in runtime.ws_client.removed

    res = client.post(f"/api/v1/routines/{rid}/resume")
    assert res.status_code == 200
    assert res.json()["status"] == "active"
    # resume은 confirm과 대칭으로 재구독한다.
    assert runtime.ws_client.registered.count(("0B", ("005930",))) == 2
    assert runtime.ws_client.registered.count(("1h", ("005930",))) == 2


SCHEDULE_DRAFT = {
    "symbol": "005930",
    "condition": {"source": "schedule.daily", "op": "at", "value": "ALL@07:30"},
    "cooldown_s": 1800,
    "expires_days": 7,
}


def test_schedule_confirm_succeeds_without_dart_key_disclosure_still_blocked(app_client):
    """Rev.3 BLOCKER 회귀 — DART 키 미설정(기본 배포, 이 fixture 상태)에서도
    schedule.daily confirm은 성공해야 하고(사실11④), disclosure.title_keyword는
    여전히 공시 폴러 미가용으로 409여야 한다(scheduled 분기가 periodic 게이트를
    훼손하지 않았음을 대조 확인)."""
    client, runtime = app_client
    assert runtime.disclosure_ready is False  # 이 fixture는 DART 키를 안 준다

    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/confirm")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "active"
    assert body["mode"] == "scheduled"
    assert body["activation_blocker"] is None

    disclosure_draft = dict(
        DRAFT,
        condition={
            "source": "disclosure.title_keyword",
            "op": "contains",
            "value": "유상증자",
        },
    )
    rid2 = client.post("/api/v1/routines/draft", json=disclosure_draft).json()["id"]
    res2 = client.post(f"/api/v1/routines/{rid2}/confirm")
    assert res2.status_code == 409
    assert "공시 폴러" in res2.json()["detail"]


def test_list_routines_includes_fired_today_and_next_fire_at(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    client.post(f"/api/v1/routines/{rid}/confirm")

    listing = client.get("/api/v1/routines").json()
    assert listing["fired_today"] == 0
    row = next(r for r in listing["routines"] if r["id"] == rid)
    assert row["mode"] == "scheduled"
    assert row["next_fire_at"] is not None  # ISO 문자열 — 다음 매치 시각

    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="schedule.daily",
        observed="07:30",
        threshold="ALL@07:30",
        reason="예약 시각 도달(07:30)",
    )
    listing2 = client.get("/api/v1/routines").json()
    assert listing2["fired_today"] == 1


def test_pause_rejects_invalid_transition(app_client):
    client, _ = app_client
    # draft 상태는 ALLOWED_TRANSITIONS 상 "paused"로 전이할 수 없다.
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/pause")
    assert res.status_code == 409


def test_runs_filters_by_routine_id(app_client):
    client, runtime = app_client
    rid_a = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    rid_b = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    runtime.ledger.record(
        "fired",
        routine_id=rid_a,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
    )
    runtime.ledger.record(
        "suppressed",
        routine_id=rid_b,
        symbol="005930",
        source="price.current",
        observed=199500,
        threshold=200000,
        reason="쿨다운 중",
    )

    res = client.get(f"/api/v1/routines/{rid_a}/runs")
    assert res.status_code == 200
    runs = res.json()["runs"]
    assert len(runs) == 1
    assert runs[0]["routine_id"] == rid_a
    assert runs[0]["verdict"] == "fired"


def test_runs_avg_duration_ms_ignores_legacy_rows_without_the_field(app_client):
    """F2 — 옛 jsonl 행(필드 자체가 없음)이 섞여도 평균 계산이 죽지 않고,
    그 행은 평균에서 자연히 제외된다(하위호환)."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    # "옛" 행 — record()를 거치지 않고 duration_ms 키 자체가 없는 과거 포맷을
    # 파일에 직접 기록해 마이그레이션 없는 혼재 상황을 흉내낸다.
    legacy_row = {
        "ts": "2026-01-01T00:00:00+00:00",
        "routine_id": rid,
        "symbol": "005930",
        "source": "price.current",
        "verdict": "fired",
        "observed": 199000,
        "threshold": 200000,
        "reason": "조건 충족",
    }
    with runtime.ledger._path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(legacy_row, ensure_ascii=False) + "\n")

    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=198000,
        threshold=200000,
        reason="조건 충족",
        duration_ms=120.0,
    )

    res = client.get(f"/api/v1/routines/{rid}/runs")
    assert res.status_code == 200
    body = res.json()
    assert len(body["runs"]) == 2
    assert body["avg_duration_ms"] == 120.0  # 옛 행은 평균에서 제외


def test_runs_avg_duration_ms_is_null_when_no_durations_recorded(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
    )
    res = client.get(f"/api/v1/routines/{rid}/runs")
    assert res.json()["avg_duration_ms"] is None


# ---------- 발화→열람·이어진 대화(F2-스트레치, engagement) ----------


def test_engagement_records_opened_and_replied(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    res = client.post(f"/api/v1/routines/{rid}/engagement", json={"event": "opened"})
    assert res.status_code == 200
    assert res.json()["event"] == "opened"
    assert res.json()["routine_id"] == rid

    res2 = client.post(f"/api/v1/routines/{rid}/engagement", json={"event": "replied"})
    assert res2.status_code == 200

    rows = runtime.engagement.read_all()
    assert [r["event"] for r in rows] == ["opened", "replied"]


def test_engagement_rejects_unknown_event(app_client):
    client, _ = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    res = client.post(f"/api/v1/routines/{rid}/engagement", json={"event": "clicked"})
    assert res.status_code == 422


def test_engagement_unknown_routine_is_404(app_client):
    client, _ = app_client
    res = client.post("/api/v1/routines/none/engagement", json={"event": "opened"})
    assert res.status_code == 404


def test_runs_reports_opened_rate_and_replied_count(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    for _ in range(4):
        runtime.ledger.record(
            "fired",
            routine_id=rid,
            symbol="005930",
            source="price.current",
            observed=199000,
            threshold=200000,
            reason="조건 충족",
        )
    client.post(f"/api/v1/routines/{rid}/engagement", json={"event": "opened"})
    client.post(f"/api/v1/routines/{rid}/engagement", json={"event": "opened"})
    client.post(f"/api/v1/routines/{rid}/engagement", json={"event": "replied"})

    res = client.get(f"/api/v1/routines/{rid}/runs")
    body = res.json()
    assert body["opened_rate"] == 0.5  # opened 2건 / fired 4건
    assert body["replied_count"] == 1


def test_runs_opened_rate_is_null_without_fired_rows(app_client):
    """fired 행이 없으면 분모가 0이라 비율을 계산하지 않는다(None, 0.0 아님)."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    client.post(f"/api/v1/routines/{rid}/engagement", json={"event": "opened"})
    res = client.get(f"/api/v1/routines/{rid}/runs")
    body = res.json()
    assert body["opened_rate"] is None
    assert body["replied_count"] == 0


def test_runs_engagement_aggregation_tolerates_corrupt_engagement_file(app_client):
    """engagement.jsonl에 손상 라인이 섞여도 /runs가 죽지 않는다(하위호환)."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
    )
    runtime.engagement.record("opened", routine_id=rid)
    with runtime.engagement._path.open("a", encoding="utf-8") as fh:
        fh.write("{이건 깨진 json\n")

    res = client.get(f"/api/v1/routines/{rid}/runs")
    assert res.status_code == 200
    assert res.json()["opened_rate"] == 1.0  # 손상 라인은 무시하고 나머지만 집계


# ---------- 읽음 상태·최근 발화(F3, read-marks) ----------


def test_list_routines_reports_last_fired_at_and_unread(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    listing = client.get("/api/v1/routines").json()["routines"]
    row = next(r for r in listing if r["id"] == rid)
    assert row["last_fired_at"] is None
    assert row["unread"] is False  # 발화가 없으면 읽지 않았어도 안읽음이 아니다

    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
    )
    listing2 = client.get("/api/v1/routines").json()["routines"]
    row2 = next(r for r in listing2 if r["id"] == rid)
    assert row2["last_fired_at"] is not None
    assert row2["unread"] is True


def test_ack_marks_routine_read_without_affecting_others(app_client):
    """ack 후 재조회 시 해당 routine만 unread:false, 다른 routine 영향 없음."""
    client, runtime = app_client
    rid_a = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    rid_b = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    for rid in (rid_a, rid_b):
        runtime.ledger.record(
            "fired",
            routine_id=rid,
            symbol="005930",
            source="price.current",
            observed=199000,
            threshold=200000,
            reason="조건 충족",
        )

    ack_res = client.post(f"/api/v1/routines/{rid_a}/ack")
    assert ack_res.status_code == 200
    assert ack_res.json()["last_read_fired_at"] is not None

    listing = client.get("/api/v1/routines").json()["routines"]
    row_a = next(r for r in listing if r["id"] == rid_a)
    row_b = next(r for r in listing if r["id"] == rid_b)
    assert row_a["unread"] is False
    assert row_b["unread"] is True


def test_ack_unknown_routine_is_404(app_client):
    client, _ = app_client
    assert client.post("/api/v1/routines/none/ack").status_code == 404


def test_list_routines_reads_ledger_exactly_once(app_client):
    """N+1 회귀 방지(MAJOR) — GET /routines 호출당 ledger.read_all()이
    정확히 1회만 불려야 한다(fired_today·latest_fired 맵을 같은 스캔에서 계산)."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
    )

    calls = {"n": 0}
    original_read_all = runtime.ledger.read_all

    def counting_read_all():
        calls["n"] += 1
        return original_read_all()

    runtime.ledger.read_all = counting_read_all
    res = client.get("/api/v1/routines")

    assert res.status_code == 200
    assert calls["n"] == 1


def test_ack_persists_across_restart(tmp_path):
    """재기동(같은 store/ledger/read-marks 경로로 새 RoutinesRuntime)해도
    읽음 처리가 유지된다."""
    settings = Settings(
        _env_file=None,
        routines_enabled=True,
        routines_store_path=tmp_path / "routines.json",
        routines_ledger_path=tmp_path / "ledger.jsonl",
        routines_read_marks_path=tmp_path / "read_marks.json",
        routines_engagement_path=tmp_path / "engagement.jsonl",
        routines_ledger_archive_dir=tmp_path / "archive",
    )
    loop = asyncio.new_event_loop()
    runtime1 = loop.run_until_complete(open_routines(settings, ws_client=None))
    app1 = FastAPI()
    install_exception_handlers(app1)
    app1.include_router(router)
    app1.state.routines_runtime = runtime1
    client1 = TestClient(app1)

    rid = client1.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    runtime1.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
    )
    ack_res = client1.post(f"/api/v1/routines/{rid}/ack")
    assert ack_res.status_code == 200
    row1 = next(
        r for r in client1.get("/api/v1/routines").json()["routines"] if r["id"] == rid
    )
    assert row1["unread"] is False
    loop.run_until_complete(teardown_routines(runtime1))

    # "재기동" — 같은 경로로 새 RoutinesRuntime을 연다.
    runtime2 = loop.run_until_complete(open_routines(settings, ws_client=None))
    app2 = FastAPI()
    install_exception_handlers(app2)
    app2.include_router(router)
    app2.state.routines_runtime = runtime2
    client2 = TestClient(app2)

    row2 = next(
        r for r in client2.get("/api/v1/routines").json()["routines"] if r["id"] == rid
    )
    assert row2["unread"] is False  # 재기동 후에도 읽음 유지
    loop.run_until_complete(teardown_routines(runtime2))
    loop.close()


# ---------- 90일 아카이브 롤오버(R3)와의 상호작용 ----------


def test_unread_calc_survives_ledger_rollover(app_client):
    """90일 지난 유일한 발화가 아카이브로 옮겨져 원본 ledger에서 사라져도
    list_routines()가 죽지 않는다 — last_fired_at은 None으로, unread는
    안전한 기본값(False)으로 떨어진다(AC2, _view/_is_unread의 기존
    None-safe 처리를 롤오버 시나리오로 확인)."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    old_ts = datetime.now(UTC) - timedelta(days=95)
    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=199000,
        threshold=200000,
        reason="조건 충족",
        ts=old_ts,
    )
    listing_before = client.get("/api/v1/routines").json()["routines"]
    row_before = next(r for r in listing_before if r["id"] == rid)
    assert row_before["unread"] is True  # 롤오버 전에는 정상적으로 안읽음

    rollover_jsonl(
        runtime.ledger._path,
        ts_field="ts",
        archive_dir=runtime.ledger._path.parent / "archive",
        cutoff_days=90,
        lenient=False,
    )

    listing_after = client.get("/api/v1/routines").json()["routines"]
    row_after = next(r for r in listing_after if r["id"] == rid)
    assert row_after["last_fired_at"] is None  # 유일한 발화가 아카이브로 이동
    assert row_after["unread"] is False  # None-safe 기본값 — 죽지 않는다


def test_runs_may_return_fewer_than_30_after_rollover(app_client):
    """30건 미만 반환은 수용된 트레이드오프다(Rev.3 §R3) — /runs는 활성
    ledger 파일만 보고, 아카이브로 옮겨진 옛 행은 조회하지 않는다."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    old_ts = datetime.now(UTC) - timedelta(days=95)
    for _ in range(5):
        runtime.ledger.record(
            "fired",
            routine_id=rid,
            symbol="005930",
            source="price.current",
            observed=199000,
            threshold=200000,
            reason="조건 충족",
            ts=old_ts,
        )
    recent_ts = datetime.now(UTC)
    runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="price.current",
        observed=198000,
        threshold=200000,
        reason="조건 충족",
        ts=recent_ts,
    )

    rollover_jsonl(
        runtime.ledger._path,
        ts_field="ts",
        archive_dir=runtime.ledger._path.parent / "archive",
        cutoff_days=90,
        lenient=False,
    )

    res = client.get(f"/api/v1/routines/{rid}/runs")
    assert res.status_code == 200
    assert len(res.json()["runs"]) == 1  # 30건 미만(여기선 1건) — 죽지 않고 있는 만큼만


# ---------- 브리핑 스키마·캐치업·본문 스토어·예산(R1, 3단계) ----------


def test_draft_briefing_model_and_effort_roundtrip(app_client):
    client, _ = app_client
    draft = dict(
        SCHEDULE_DRAFT, briefing_model="claude-sonnet-5", briefing_effort="low"
    )
    res = client.post("/api/v1/routines/draft", json=draft)
    assert res.status_code == 200
    body = res.json()
    assert body["briefing_model"] == "claude-sonnet-5"
    assert body["briefing_effort"] == "low"

    listing = client.get("/api/v1/routines").json()["routines"]
    row = next(r for r in listing if r["id"] == body["id"])
    assert row["briefing_model"] == "claude-sonnet-5"
    assert row["briefing_effort"] == "low"


@pytest.mark.parametrize(
    "patch",
    [
        {"briefing_model": "-bad"},  # 선두 하이픈 금지(model-prefs.js:21 이식)
        {"briefing_model": "한글모델"},
        {"briefing_model": "a" * 65},
        {"briefing_effort": "extreme"},  # 닫힌 목록 밖
        {"briefing_effort": 3},
    ],
)
def test_draft_rejects_invalid_briefing_settings(app_client, patch):
    client, _ = app_client
    res = client.post("/api/v1/routines/draft", json=dict(SCHEDULE_DRAFT, **patch))
    assert res.status_code == 422


def test_missed_is_true_for_active_schedule_without_fired(app_client):
    """ALL 예약은 직전 발생 시각(늦어도 어제)이 항상 있다 — 발화 기록이 없으면
    missed=true. realtime 루틴과 미승인(draft) 예약은 missed 개념이 없다."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    rid_rt = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]

    listing = client.get("/api/v1/routines").json()["routines"]
    assert next(r for r in listing if r["id"] == rid)["missed"] is False  # draft
    assert next(r for r in listing if r["id"] == rid_rt)["missed"] is False

    client.post(f"/api/v1/routines/{rid}/confirm")
    listing2 = client.get("/api/v1/routines").json()["routines"]
    assert next(r for r in listing2 if r["id"] == rid)["missed"] is True


def test_catchup_fire_records_and_clears_missed(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    client.post(f"/api/v1/routines/{rid}/confirm")

    res = client.post(f"/api/v1/routines/{rid}/catchup-fire")
    assert res.status_code == 200
    fired_at = res.json()["fired_at"]
    assert isinstance(fired_at, str) and fired_at

    rows = [r for r in runtime.ledger.read_all() if r["routine_id"] == rid]
    assert len(rows) == 1
    assert rows[0]["verdict"] == "fired"
    assert "캐치업" in rows[0]["reason"]
    assert rows[0]["ts"] == fired_at  # 서버 authoritative — 기록에 쓴 값 그대로
    assert rows[0]["threshold"] == "ALL@07:30"  # 헬퍼가 스펙 조건값으로 자동 대체

    # 발화 처리 후에는 missed가 꺼지고, 중복 클릭은 409다.
    listing = client.get("/api/v1/routines").json()["routines"]
    assert next(r for r in listing if r["id"] == rid)["missed"] is False
    assert client.post(f"/api/v1/routines/{rid}/catchup-fire").status_code == 409


def test_catchup_fire_rejects_non_scheduled_and_non_active(app_client):
    client, _ = app_client
    rid_rt = client.post("/api/v1/routines/draft", json=DRAFT).json()["id"]
    assert client.post(f"/api/v1/routines/{rid_rt}/catchup-fire").status_code == 409

    rid_draft = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    assert client.post(f"/api/v1/routines/{rid_draft}/catchup-fire").status_code == 409

    assert client.post("/api/v1/routines/none/catchup-fire").status_code == 404


def test_briefing_result_records_engagement_and_content(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]

    res = client.post(
        f"/api/v1/routines/{rid}/briefing-result",
        json={
            "fired_at": "2026-08-27T07:30:00+09:00",
            "status": "ok",
            "duration_ms": 4200,
            "destination": "chat",
            "title": "아침 브리핑",
            "content": "오늘의 요약",
            "model": "claude-sonnet-5",
            "effort": "low",
        },
    )
    assert res.status_code == 200

    briefed = [e for e in runtime.engagement.read_all() if e["event"] == "briefed"]
    assert len(briefed) == 1
    assert briefed[0]["status"] == "ok"
    assert briefed[0]["duration_ms"] == 4200
    assert briefed[0]["destination"] == "chat"

    stored = runtime.briefings.read_all()
    assert len(stored) == 1
    assert stored[0]["title"] == "아침 브리핑"
    assert stored[0]["content"] == "오늘의 요약"
    assert stored[0]["truncated"] is False
    assert stored[0]["fired_at"] == "2026-08-27T07:30:00+09:00"


def test_briefing_result_failed_skips_content_store(app_client):
    """실패한 시도의 빈 본문을 저장하지 않는다 — engagement에만 남긴다."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]

    res = client.post(
        f"/api/v1/routines/{rid}/briefing-result",
        json={"fired_at": "2026-08-27T07:30:00+09:00", "status": "failed"},
    )
    assert res.status_code == 200
    assert res.json()["briefing"] is None
    assert [e["event"] for e in runtime.engagement.read_all()] == ["briefed"]
    assert runtime.briefings.read_all() == []


def test_briefing_result_truncates_over_4000_chars(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]

    res = client.post(
        f"/api/v1/routines/{rid}/briefing-result",
        json={
            "fired_at": "2026-08-27T07:30:00+09:00",
            "status": "ok",
            "title": "긴 브리핑",
            "content": "가" * 4001,
        },
    )
    assert res.status_code == 200
    stored = runtime.briefings.read_all()
    assert len(stored[0]["content"]) == 4000  # 잘라 저장
    assert stored[0]["truncated"] is True  # 잘린 사실은 숨기지 않는다(P3)


def test_briefing_result_validates_body(app_client):
    client, _ = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    url = f"/api/v1/routines/{rid}/briefing-result"
    ok_base = {"fired_at": "2026-08-27T07:30:00+09:00", "status": "ok"}
    assert client.post(url, json={"status": "ok"}).status_code == 422  # fired_at 없음
    assert client.post(url, json={"fired_at": "x"}).status_code == 422  # status 없음
    assert client.post(url, json=ok_base).status_code == 422  # 성공인데 본문 없음
    assert client.post("/api/v1/routines/none/briefing-result", json=ok_base).status_code == 404


def test_runs_merges_briefing_content_by_fired_at(app_client):
    """/runs — ledger fired 행의 ts와 briefings의 fired_at으로 상관해 병합한다."""
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]
    row = runtime.ledger.record(
        "fired",
        routine_id=rid,
        symbol="005930",
        source="schedule.daily",
        observed="07:30",
        threshold="ALL@07:30",
        reason="예약 시각 도달(07:30)",
    )
    client.post(
        f"/api/v1/routines/{rid}/briefing-result",
        json={
            "fired_at": row["ts"],
            "status": "ok",
            "title": "아침 브리핑",
            "content": "오늘의 요약",
        },
    )

    runs = client.get(f"/api/v1/routines/{rid}/runs").json()["runs"]
    merged = next(r for r in runs if r["ts"] == row["ts"])
    assert merged["briefing_title"] == "아침 브리핑"
    assert merged["briefing_content"] == "오늘의 요약"
    assert merged["truncated"] is False


def test_briefing_budget_counts_today_briefed_only(app_client):
    client, runtime = app_client
    rid = client.post("/api/v1/routines/draft", json=SCHEDULE_DRAFT).json()["id"]

    budget = client.get("/api/v1/routines/briefing-budget").json()
    assert budget == {"limit": 10, "used_today": 0, "remaining": 10}

    # 오늘 briefed 1건 + 어제 briefed 1건 + 오늘 opened 1건 — 오늘 briefed만 센다.
    runtime.engagement.record("briefed", routine_id=rid, status="ok")
    runtime.engagement.record(
        "briefed", routine_id=rid, status="ok", ts=datetime.now(UTC) - timedelta(days=1)
    )
    runtime.engagement.record("opened", routine_id=rid)

    budget2 = client.get("/api/v1/routines/briefing-budget").json()
    assert budget2 == {"limit": 10, "used_today": 1, "remaining": 9}
