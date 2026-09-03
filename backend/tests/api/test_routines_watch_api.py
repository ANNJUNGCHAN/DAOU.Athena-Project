"""감시 코드 착지(`POST /routines/watch/code`) — B-13(착지 측)·B-24.

이 기능의 진실은 디스크의 파일이다 — 200이라고 말하면 프로젝트 폴더 안
`watch/` 아래에 그 바이트가 실제로 있어야 하고, `code_hash`는 그 바이트의
sha256이어야 한다.

모드 격리(R5)도 같이 못 박는다 — 착지 한 번으로 백테스트 sqlite나 사용자
전략 등록부가 조금도 움직이지 않는다.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.routines import router
from athena_api.backtest.store import Candle
from athena_api.config import Settings
from athena_api.errors import install_exception_handlers
from athena_api.projects import store as projects_store
from athena_api.routines.guard_settings import GuardSettingsStore
from athena_api.routines.models import RoutineSpec
from athena_api.routines.rules import validate_draft
from athena_api.routines.runtime import open_routines, teardown_routines

CODE = "/api/v1/routines/watch/code"

SOURCE = """def signals(df, p):
    out = df[[]].copy()
    out["entry"] = df["close"] > 0
    out["exit"] = False
    return out
"""


@pytest.fixture
def watch_client(tmp_path: Path, monkeypatch):
    """루틴 라우터 + 등록된 프로젝트 폴더 하나(`p1`)."""
    project_root = tmp_path / "projects" / "알파"
    project_root.mkdir(parents=True)
    monkeypatch.setattr(
        projects_store,
        "resolve_project_path",
        lambda pid: project_root if pid == "p1" else _unknown(pid),
    )

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
    app.state.nudge_guard_store = GuardSettingsStore(tmp_path / "nudge_guard.json")
    app.state.nudge_guard_store.load()
    yield TestClient(app), runtime, project_root
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


def _unknown(project_id: str) -> Path:
    raise KeyError(project_id)


def _body(**over):
    raw = {"project_id": "p1", "path": "watch/volume_spike.py", "source": SOURCE}
    raw.update(over)
    return raw


def _seed_code_routine(runtime, status: str, *, path: str = "watch/volume_spike.py"):
    spec = validate_draft(
        {
            "symbol": "005930",
            "condition": {"source": "code.watch", "op": "==", "value": True},
            "cooldown_s": 1800,
            "expires_days": 7,
            "watch": {
                "project_id": "p1",
                "path": path,
                "version_hash": "a" * 64,
                "poll_interval_s": 60,
                "lookback_days": 30,
            },
        }
    )
    stored = RoutineSpec(
        condition=spec.condition,
        symbol=spec.symbol,
        cooldown_s=spec.cooldown_s,
        expires_at=datetime.now(UTC) + timedelta(days=7),
        note=spec.note,
        id=spec.id,
        status=status,
        watch=spec.watch,
    )
    runtime.store.upsert(stored)
    return stored


# ── 착지 성공 ────────────────────────────────────────────────────────────────


def test_save_writes_the_file_and_returns_its_hash(watch_client):
    client, _, root = watch_client

    res = client.post(CODE, json=_body())
    assert res.status_code == 200, res.text
    payload = res.json()

    target = root / "watch" / "volume_spike.py"
    raw = target.read_bytes()
    assert payload["path"] == "watch/volume_spike.py"
    assert payload["code_hash"] == hashlib.sha256(raw).hexdigest()
    assert payload["bytes"] == len(raw)
    assert b"\r\n" not in raw  # LF 고정
    assert not list((root / "watch").glob("*.tmp"))


def test_save_overwrites_a_draft_referenced_file(watch_client):
    """초안이 가리키는 파일은 고쳐 쓸 수 있다 — 켜져 있지 않으니까."""
    client, runtime, root = watch_client
    _seed_code_routine(runtime, "draft")

    first = client.post(CODE, json=_body()).json()
    second = client.post(CODE, json=_body(source=SOURCE + "\n# 고침\n"))
    assert second.status_code == 200
    assert second.json()["code_hash"] != first["code_hash"]
    assert "# 고침" in (root / "watch" / "volume_spike.py").read_text("utf-8")


def test_labels_are_appended_when_the_code_has_none(watch_client):
    client, _, root = watch_client

    res = client.post(
        CODE, json=_body(labels={"signals": "거래량 튀는 날 찾기", "load": "일봉 불러오기"})
    )
    assert res.status_code == 200
    text = (root / "watch" / "volume_spike.py").read_text("utf-8")
    assert "NODE_LABELS = {" in text
    assert "거래량 튀는 날 찾기" in text  # ensure_ascii=False로 한국어 그대로
    assert text.count("NODE_LABELS") == 1


def test_labels_are_not_appended_when_the_code_already_has_them(watch_client):
    client, _, root = watch_client
    source = SOURCE + '\n\nNODE_LABELS = {"signals": "내가 적은 제목"}\n'

    res = client.post(CODE, json=_body(source=source, labels={"signals": "덧붙인 제목"}))
    assert res.status_code == 200
    text = (root / "watch" / "volume_spike.py").read_text("utf-8")
    assert text.count("NODE_LABELS") == 1
    assert "덧붙인 제목" not in text


# ── 경로·프로젝트 거부 ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    ["../x.py", "watch/../../x.py", "notwatch/x.py", "watch/x.txt", "watch/", "/watch/x.py"],
)
def test_bad_paths_are_422(watch_client, path):
    client, _, root = watch_client
    res = client.post(CODE, json=_body(path=path))
    assert res.status_code == 422, res.text
    assert "watch/" in res.json()["detail"]
    assert not (root / "watch").exists()


def test_unknown_project_is_404(watch_client):
    client, _, _ = watch_client
    res = client.post(CODE, json=_body(project_id="ghost"))
    assert res.status_code == 404
    assert res.json()["detail"] == "프로젝트 없음"


def test_missing_project_id_is_422(watch_client):
    client, _, _ = watch_client
    assert client.post(CODE, json={"path": "watch/x.py", "source": SOURCE}).status_code == 422


def test_empty_source_is_422(watch_client):
    client, _, _ = watch_client
    res = client.post(CODE, json=_body(source="   "))
    assert res.status_code == 422


# ── B-24 덮어쓰기 금지 ───────────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["active", "paused"])
def test_live_alarm_code_is_409(watch_client, status):
    client, runtime, root = watch_client
    client.post(CODE, json=_body())  # 초안 단계에서 먼저 착지
    before = (root / "watch" / "volume_spike.py").read_bytes()
    _seed_code_routine(runtime, status)

    res = client.post(CODE, json=_body(source=SOURCE + "\n# 몰래 고침\n"))
    assert res.status_code == 409
    assert res.json()["detail"] == (
        "켜져 있는 알람의 코드는 못 바꿈 — 먼저 일시중지하거나 새로 만들기"
    )
    assert (root / "watch" / "volume_spike.py").read_bytes() == before  # 한 바이트도 안 바뀜


def test_a_new_file_is_allowed_while_another_alarm_is_active(watch_client):
    client, runtime, root = watch_client
    _seed_code_routine(runtime, "active")

    res = client.post(CODE, json=_body(path="watch/gap_up.py"))
    assert res.status_code == 200
    assert (root / "watch" / "gap_up.py").exists()


# ── B-13(착지 측) 모드 격리 ──────────────────────────────────────────────────


def test_landing_does_not_touch_backtest_tables_or_the_registry(watch_client, tmp_path):
    """알람 코드 착지로 백테스트 표·등록부에는 아무 일도 일어나지 않는다(R5).

    이 앱에는 백테스트 저장소가 아예 배선돼 있지 않다 — 그래서 sqlite 파일이
    생기지 않는다는 것과 등록부 json이 그대로라는 것을 함께 본다.
    """
    client, _, _ = watch_client
    db = tmp_path / "backtest.sqlite3"
    registry = tmp_path / "user-strategies.json"
    registry.write_text(json.dumps({"strategies": []}), encoding="utf-8")
    before = registry.read_bytes()

    assert client.post(CODE, json=_body()).status_code == 200

    assert not db.exists()  # bt_strategy·bt_strategy_version·bt_run·bt_deployment 부재
    assert registry.read_bytes() == before
    assert not list(tmp_path.glob("*.sqlite3"))


def test_landing_creates_no_routine_rows(watch_client):
    client, runtime, _ = watch_client
    assert client.post(CODE, json=_body()).status_code == 200
    assert runtime.store.list_all() == []  # 착지는 루틴 등록이 아니다


def test_disabled_deployment_is_503():
    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)
    app.state.routines_runtime = None
    client = TestClient(app)
    assert client.post(CODE, json=_body()).status_code == 503


# ── 검사(POST /watch/check) — B-12 · B-13 ────────────────────────────────────

CHECK = "/api/v1/routines/watch/check"

CHECK_SOURCE = """NODE_LABELS = {"avg_volume": "거래량 평균", "signals": "알림"}


def avg_volume(df, days):
    return df.volume.rolling(days).mean()


def signals(df, p):
    avg = avg_volume(df, int(p.get("days", 5)))
    fired = df.volume > avg * float(p.get("ratio", 1.5))
    return df.assign(entry=fired.fillna(False), exit=False)[["entry", "exit"]]
"""

CHECK_KEYS = {
    "ok",
    "fires",
    "count",
    "lookback_days",
    "last_fire",
    "code_hash",
    "nodes",
    "warnings",
    "error",
    "diagnosis",
    "reason",
    "last_verdict",
    "duration_ms",
    "counted_until",
    "symbol",
    "checked_at",
}


def _candles(spike_offsets=(2, 3), *, days: int = 94):
    """어제까지의 완성 일봉 — 지정한 날만 거래량 3배(5일 평균의 1.5배 초과)."""
    today = date.today()
    rows = []
    for offset in range(days, 0, -1):
        day = today - timedelta(days=offset)
        rows.append(
            Candle(
                dt=day.strftime("%Y%m%d"),
                open=100.0,
                high=101.0,
                low=99.0,
                close=100.0,
                volume=3000 if offset in spike_offsets else 1000,
            )
        )
    return rows


class _FakeCandles:
    """일봉 캐시 스텁 — 커버리지는 이미 충분하다고 답한다(백필 불필요)."""

    def __init__(self, candles):
        self._candles = tuple(candles)

    async def coverage(self, stk_cd, period, adjusted):
        return SimpleNamespace(first_dt="20000101", last_dt="29991231")

    async def candles(self, stk_cd, period, adjusted, *, start=None, end=None):
        return self._candles


@pytest.fixture
def check_client(tmp_path: Path, monkeypatch):
    """검사 라우트용 — 백테스트 모듈이 켜져 감시 러너가 서 있는 배치."""
    project_root = tmp_path / "projects" / "알파"
    project_root.mkdir(parents=True)
    monkeypatch.setattr(
        projects_store,
        "resolve_project_path",
        lambda pid: project_root if pid == "p1" else _unknown(pid),
    )

    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(router)
    settings = Settings(
        _env_file=None,
        routines_enabled=True,
        backtest_enabled=True,
        routines_store_path=tmp_path / "routines.json",
        routines_ledger_path=tmp_path / "ledger.jsonl",
        routines_read_marks_path=tmp_path / "read_marks.json",
        routines_engagement_path=tmp_path / "engagement.jsonl",
        routines_briefings_path=tmp_path / "briefings.jsonl",
        routines_ledger_archive_dir=tmp_path / "archive",
    )
    loop = asyncio.new_event_loop()
    runtime = loop.run_until_complete(open_routines(settings, ws_client=None))
    runtime.watch_candle_store = _FakeCandles(_candles())
    app.state.routines_runtime = runtime
    app.state.nudge_guard_store = GuardSettingsStore(tmp_path / "nudge_guard.json")
    app.state.nudge_guard_store.load()
    yield TestClient(app), runtime, project_root
    loop.run_until_complete(teardown_routines(runtime))
    loop.close()


def _write_watch(root: Path, source: str = CHECK_SOURCE, name: str = "volume_spike.py") -> str:
    target = root / "watch" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.encode("utf-8"))
    return hashlib.sha256(target.read_bytes()).hexdigest()


def _check_body(**over):
    raw = {"project_id": "p1", "path": "watch/volume_spike.py", "symbol": "005930"}
    raw.update(over)
    return raw


def test_check_counts_fires_on_closed_bars(check_client):
    """B-12 — 200 + 고정된 응답 모양. 어제까지의 완성 봉으로만 센다."""
    client, _, root = check_client
    digest = _write_watch(root)

    res = client.post(CHECK, json=_check_body())
    assert res.status_code == 200, res.text
    body = res.json()

    assert set(body) == CHECK_KEYS
    assert body["ok"] is True, body["reason"]
    assert body["code_hash"] == digest
    assert body["symbol"] == "005930"
    assert body["count"] >= 1
    assert body["fires"][0]["dt"]
    assert body["last_fire"] == body["fires"][-1]["dt"]
    assert body["counted_until"] == "어제까지로 세었음 · 오늘은 진행 중"
    assert body["error"] is None and body["diagnosis"] is None
    titles = {n["title_ko"] for n in body["nodes"]}
    assert titles == {"거래량 평균", "알림"}  # 칸 = 최상위 함수
    assert all(n["called"] and n["output"] is not None for n in body["nodes"])


def test_check_reports_a_syntax_error_as_a_diagnosis(check_client):
    """B-12 — 문법이 깨진 코드도 500이 아니다. ok:false + 진단이 같이 온다."""
    client, _, root = check_client
    _write_watch(root, "def signals(df, p)\n    return df\n")

    res = client.post(CHECK, json=_check_body())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is False
    assert body["error"] is not None
    assert body["diagnosis"] is not None
    assert body["diagnosis"]["title"]
    assert body["count"] == 0


def test_check_without_the_execution_layer_is_409(check_client):
    client, runtime, root = check_client
    _write_watch(root)
    runtime.watch_runner = None

    res = client.post(CHECK, json=_check_body())
    assert res.status_code == 409
    assert res.json()["detail"] == "백엔드 실행층 꺼짐 — 백테스트 모듈 필요"


def test_check_unknown_project_is_404(check_client):
    client, _, _ = check_client
    assert client.post(CHECK, json=_check_body(project_id="ghost")).status_code == 404


def test_check_missing_file_is_404(check_client):
    client, _, _ = check_client
    res = client.post(CHECK, json=_check_body(path="watch/nothing.py"))
    assert res.status_code == 404
    assert res.json()["detail"] == "감시 코드 파일 없음 — 먼저 만들기"


def test_check_bad_symbol_is_422(check_client):
    client, _, root = check_client
    _write_watch(root)
    res = client.post(CHECK, json=_check_body(symbol="5930"))
    assert res.status_code == 422


def test_check_attaches_the_hash_to_a_draft_and_opens_confirm(check_client):
    """검사에 통과한 그 코드로 확정이 열린다 — 해시를 초안에 심는다."""
    client, runtime, root = check_client
    digest = _write_watch(root)
    spec = _seed_code_routine(runtime, "draft", path="watch/volume_spike.py")
    assert runtime.can_activate(spec) == "검사 뒤 코드가 바뀜 — 다시 검사"

    body = client.post(CHECK, json=_check_body(routine_id=spec.id)).json()
    assert body["ok"] is True

    assert runtime.store.get(spec.id).watch.version_hash == digest
    assert runtime.can_activate(runtime.store.get(spec.id)) is None
    confirmed = client.post(f"/api/v1/routines/{spec.id}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "active"
    assert confirmed.json()["watch"]["path"] == "watch/volume_spike.py"


def test_check_result_shows_up_in_the_detail_view(check_client):
    client, runtime, root = check_client
    _write_watch(root)
    spec = _seed_code_routine(runtime, "draft")

    client.post(CHECK, json=_check_body(routine_id=spec.id))
    detail = client.get(f"/api/v1/routines/{spec.id}").json()

    assert detail["watch"]["path"] == "watch/volume_spike.py"
    assert detail["last_run"] is None
    assert detail["last_check"]["count"] >= 1
    assert detail["last_check"]["counted_until"] == "어제까지로 세었음 · 오늘은 진행 중"
    assert detail["last_check"]["nodes"]


def test_check_without_a_candle_cache_says_so(check_client):
    client, runtime, root = check_client
    _write_watch(root)
    runtime.watch_candle_store = None

    body = client.post(CHECK, json=_check_body()).json()
    assert body["ok"] is False
    assert "일봉 캐시 없음 — 받아 둔 일봉이 없으면 셀 수 없음" in body["warnings"]


# ── B-13 모드 격리 — 검사는 공유 일봉 캐시만 키운다 ──────────────────────────


def _ka10081_page(rows):
    """ka10081 응답 모양(문자열 숫자) — `rows`는 (날짜, 거래량) 짝."""
    return {
        "stk_cd": "005930",
        "stk_dt_pole_chart_qry": [
            {
                "dt": dt,
                "cur_prc": "+100",
                "trde_qty": str(volume),
                "open_pric": "99",
                "high_pric": "101",
                "low_pric": "98",
            }
            for dt, volume in rows
        ],
    }


def _row_counts(owner):
    connection = owner.require()
    return {
        table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in ("bt_run", "bt_strategy", "bt_strategy_version", "bt_deployment")
    }


async def test_check_grows_only_the_shared_candle_cache(tmp_path: Path):
    """B-13 — 검사 1회로 실행·전략·배포 행은 +0, 일봉 캐시만 늘고 커버리지는 넓어진다.

    라우트 본체와 같은 부품을 같은 순서로 부른다(`_ensure_watch_candles` →
    `assemble_frame` → `run_check`) — HTTP 껍데기만 벗긴 것이다.
    """
    from athena_api.api.routines import _ensure_watch_candles
    from athena_api.backtest.store import BacktestStore
    from athena_api.brain.db import SqliteOwner
    from athena_api.watch.check import run_check
    from athena_api.watch.data import assemble_frame

    owner = SqliteOwner(tmp_path / "athena-backtest.sqlite3")
    await owner.open()
    try:
        store = BacktestStore(owner)
        await store.open()
        today = date.today()
        page = _ka10081_page(
            [(c.dt, c.volume) for c in reversed(_candles())]  # 최신→과거
        )
        pages = []

        async def fetch_page(tr_id, body, cont_yn, next_key):
            pages.append(tr_id)
            return page, "N", None

        before = _row_counts(owner)
        assert before == {
            "bt_run": 0,
            "bt_strategy": 0,
            "bt_strategy_version": 0,
            "bt_deployment": 0,
        }

        warnings = await _ensure_watch_candles(store, fetch_page, "005930", 30, today)
        assert warnings == [] and pages == ["ka10081"]
        first = await store.coverage("005930", "day", True)
        assert first is not None

        frame = await assemble_frame(
            store, "005930", 30, today_quote=None, quote_provider=None
        )
        result = await asyncio.to_thread(
            run_check,
            CHECK_SOURCE,
            None,
            frame.df,
            cooldown_s=86400,
            params={},
            lookback_days=30,
            today=today,
        )
        assert result.ok, result.reason
        assert result.count >= 1

        assert _row_counts(owner) == before  # 전략·실행·배포 표는 그대로
        candle_rows = owner.require().execute("SELECT COUNT(*) FROM bt_candle").fetchone()[0]
        assert candle_rows > 0  # 늘어도 되는 것은 공유 일봉 캐시뿐이다

        # 한 번 더 — 커버리지 구간은 넓어지기만 하고 줄지 않는다.
        await _ensure_watch_candles(store, fetch_page, "005930", 30, today)
        second = await store.coverage("005930", "day", True)
        assert second.first_dt <= first.first_dt
        assert second.last_dt >= first.last_dt
        assert _row_counts(owner) == before
    finally:
        if owner.is_open:
            await owner.close()
