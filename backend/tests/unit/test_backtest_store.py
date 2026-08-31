"""백테스트 SQLite 저장층 계약 — 캔들 upsert, 전략 버전 활성 불변식, 실행·체결·자산곡선."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from athena_api.backtest.store import (
    SCHEMA_VERSION,
    BacktestStore,
    Candle,
    EquityPoint,
    Trade,
)
from athena_api.brain.db import SqliteOwner

# 결정층(leaf 9): LLM도 난수도 타지 않는다 — 저장층 계약만 검증한다.
pytestmark = pytest.mark.deterministic

NOW = datetime(2026, 8, 31, 3, 0, tzinfo=UTC)


@pytest.fixture
async def owner(tmp_path: Path):
    instance = SqliteOwner(tmp_path / "athena-backtest.sqlite3")
    await instance.open()
    try:
        yield instance
    finally:
        if instance.is_open:
            await instance.close()


@pytest.fixture
async def store(owner: SqliteOwner) -> BacktestStore:
    instance = BacktestStore(owner)
    await instance.open()
    return instance


def candle(dt: str, *, close: float = 100.0) -> Candle:
    return Candle(dt=dt, open=close - 1, high=close + 1, low=close - 2, close=close, volume=1000)


# ── 기본 ────────────────────────────────────────────────────────────────────


async def test_open_installs_schema_version(store: BacktestStore) -> None:
    assert await store.schema_version() == SCHEMA_VERSION


async def test_open_before_owner_opens_is_refused(tmp_path: Path) -> None:
    owner_instance = SqliteOwner(tmp_path / "athena-backtest.sqlite3")
    store_instance = BacktestStore(owner_instance)
    with pytest.raises(RuntimeError):
        await store_instance.open()


# ── 캔들 ────────────────────────────────────────────────────────────────────


async def test_upsert_candles_and_query_orders_by_dt(store: BacktestStore) -> None:
    await store.upsert_candles(
        "005930",
        "day",
        True,
        [candle("20260103"), candle("20260102"), candle("20260101")],
    )
    rows = await store.candles("005930", "day", True)
    assert [r.dt for r in rows] == ["20260101", "20260102", "20260103"]


async def test_upsert_candles_overwrites_on_conflict(store: BacktestStore) -> None:
    """권리락 재수집(§5.4)이 기존 봉을 덮어써야 한다 — 새 upsert가 마지막 값을 남긴다."""
    await store.upsert_candles("005930", "day", True, [candle("20260101", close=100.0)])
    await store.upsert_candles("005930", "day", True, [candle("20260101", close=55.0)])
    rows = await store.candles("005930", "day", True)
    assert len(rows) == 1
    assert rows[0].close == 55.0


async def test_candles_distinguish_adjusted_flag(store: BacktestStore) -> None:
    """`adjusted`는 캐시 키의 일부다 — 수정/무수정은 서로 다른 시계열(§5.4)."""
    await store.upsert_candles("005930", "day", True, [candle("20260101", close=100.0)])
    await store.upsert_candles("005930", "day", False, [candle("20260101", close=90.0)])
    assert (await store.candles("005930", "day", True))[0].close == 100.0
    assert (await store.candles("005930", "day", False))[0].close == 90.0


async def test_candles_apply_start_and_end_bounds(store: BacktestStore) -> None:
    await store.upsert_candles(
        "005930", "day", True, [candle("20260101"), candle("20260102"), candle("20260103")]
    )
    rows = await store.candles("005930", "day", True, start="20260102", end="20260102")
    assert [r.dt for r in rows] == ["20260102"]


async def test_upsert_candles_with_empty_sequence_is_a_no_op(store: BacktestStore) -> None:
    await store.upsert_candles("005930", "day", True, [])
    assert await store.candles("005930", "day", True) == ()


async def test_coverage_round_trip(store: BacktestStore) -> None:
    assert await store.coverage("005930", "day", True) is None
    await store.upsert_coverage(
        "005930", "day", True, first_dt="20200101", last_dt="20260831", fetched_at=NOW, pages=5
    )
    row = await store.coverage("005930", "day", True)
    assert row is not None
    assert (row.first_dt, row.last_dt, row.pages) == ("20200101", "20260831", 5)


async def test_upsert_coverage_replaces_existing_row(store: BacktestStore) -> None:
    await store.upsert_coverage(
        "005930", "day", True, first_dt="20200101", last_dt="20260101", fetched_at=NOW, pages=3
    )
    await store.upsert_coverage(
        "005930", "day", True, first_dt="20200101", last_dt="20260831", fetched_at=NOW, pages=5
    )
    row = await store.coverage("005930", "day", True)
    assert row is not None
    assert (row.last_dt, row.pages) == ("20260831", 5)


# ── 전략 ────────────────────────────────────────────────────────────────────


async def test_create_and_get_strategy(store: BacktestStore) -> None:
    await store.create_strategy("s1", "20-60 골든크로스", "yaml", created_at=NOW)
    row = await store.strategy("s1")
    assert row is not None
    assert (row.name, row.kind) == ("20-60 골든크로스", "yaml")


async def test_create_strategy_rejects_unknown_kind(store: BacktestStore) -> None:
    with pytest.raises(ValueError):
        await store.create_strategy("s1", "이름", "javascript", created_at=NOW)


async def test_strategy_returns_none_when_missing(store: BacktestStore) -> None:
    assert await store.strategy("no-such-id") is None


async def test_strategies_lists_all_created(store: BacktestStore) -> None:
    await store.create_strategy("s1", "전략 하나", "yaml", created_at=NOW)
    await store.create_strategy("s2", "전략 둘", "python", created_at=NOW)
    ids = {row.id for row in await store.strategies()}
    assert ids == {"s1", "s2"}


# ── 전략 버전 — 활성 불변식 ─────────────────────────────────────────────────


async def test_add_version_defaults_to_inactive(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "version 1 source", origin="llm_draft", created_at=NOW)
    versions = await store.versions("s1")
    assert len(versions) == 1
    assert versions[0].active is False
    assert versions[0].origin == "llm_draft"


async def test_add_version_with_active_deactivates_previous(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source 1", origin="human", created_at=NOW, active=True)
    await store.add_version("v2", "s1", 2, "source 2", origin="human", created_at=NOW, active=True)

    versions = {v.id: v.active for v in await store.versions("s1")}
    assert versions == {"v1": False, "v2": True}


async def test_activate_version_switches_the_active_flag(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source 1", origin="human", created_at=NOW, active=True)
    await store.add_version("v2", "s1", 2, "source 2", origin="llm_draft", created_at=NOW)

    await store.activate_version("s1", "v2")
    versions = {v.id: v.active for v in await store.versions("s1")}
    assert versions == {"v1": False, "v2": True}


async def test_activate_version_rejects_version_from_another_strategy(
    store: BacktestStore,
) -> None:
    await store.create_strategy("s1", "하나", "yaml", created_at=NOW)
    await store.create_strategy("s2", "둘", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source", origin="human", created_at=NOW)

    with pytest.raises(ValueError):
        await store.activate_version("s2", "v1")


async def test_add_version_rejects_unknown_origin(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    with pytest.raises(ValueError):
        await store.add_version("v1", "s1", 1, "source", origin="robot", created_at=NOW)


async def test_versions_are_ordered_by_version_number(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v2", "s1", 2, "source 2", origin="human", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source 1", origin="human", created_at=NOW)
    assert [v.id for v in await store.versions("s1")] == ["v1", "v2"]


async def test_partial_unique_index_blocks_two_active_versions_at_db_level(
    tmp_path: Path,
) -> None:
    """앱 로직을 우회해도 DB가 막는다 — `bt_strategy_version_one_active`가 최후 방어선이다.

    `add_version`/`activate_version`은 항상 먼저 끄고 나중에 켜므로 정상 경로로는
    이 경계에 닿지 않는다. 그래서 저장소 메서드를 거치지 않고 소유자 스레드에서 직접
    두 번째 행을 active=1로 INSERT해 부분 유니크 인덱스 자체가 살아있는지 확인한다.
    """
    owner_instance = SqliteOwner(tmp_path / "athena-backtest.sqlite3")
    await owner_instance.open()
    try:
        store_instance = BacktestStore(owner_instance)
        await store_instance.open()
        await store_instance.create_strategy("s1", "이름", "yaml", created_at=NOW)
        await store_instance.add_version(
            "v1", "s1", 1, "source 1", origin="human", created_at=NOW, active=True
        )

        def insert_second_active() -> None:
            owner_instance.require().execute(
                "INSERT INTO bt_strategy_version"
                "(id, strategy_id, version, source, note, origin, created_at, active)"
                " VALUES('v2', 's1', 2, 'source 2', NULL, 'human', ?, 1)",
                (NOW.isoformat(),),
            )

        with pytest.raises(sqlite3.IntegrityError):
            await owner_instance.run(insert_second_active)
    finally:
        await owner_instance.close()


# ── 실행 ────────────────────────────────────────────────────────────────────


async def test_create_run_update_status_and_read(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source", origin="human", created_at=NOW, active=True)
    await store.create_run(
        "r1", "v1", params_json="{}", spec_hash="hash-1", status="queued", started_at=NOW
    )

    fetched = await store.run("r1")
    assert fetched is not None
    assert (fetched.status, fetched.spec_hash) == ("queued", "hash-1")
    assert fetched.finished_at is None

    await store.update_run_status(
        "r1", "done", finished_at=NOW, metrics_json='{"cagr": 0.1}', stdout="ok"
    )
    fetched = await store.run("r1")
    assert fetched is not None
    assert fetched.status == "done"
    assert fetched.metrics_json == '{"cagr": 0.1}'
    assert fetched.finished_at is not None


async def test_update_run_status_rejects_unknown_run(store: BacktestStore) -> None:
    with pytest.raises(ValueError):
        await store.update_run_status("no-such-run", "done")


async def test_run_returns_none_when_missing(store: BacktestStore) -> None:
    assert await store.run("no-such-run") is None


async def test_runs_lists_all_created(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source", origin="human", created_at=NOW, active=True)
    await store.create_run("r1", "v1", params_json="{}", spec_hash="h1", status="done")
    await store.create_run("r2", "v1", params_json="{}", spec_hash="h2", status="queued")
    ids = {r.id for r in await store.runs()}
    assert ids == {"r1", "r2"}


# ── 체결·자산곡선 ───────────────────────────────────────────────────────────


async def test_save_and_read_trades(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source", origin="human", created_at=NOW, active=True)
    await store.create_run("r1", "v1", params_json="{}", spec_hash="h1", status="done")

    trades = [
        Trade(
            seq=1, side="buy", dt="20260101", price=100.0, qty=10,
            fee=1.0, tax=0.0, pnl=None, reason="entry",
        ),
        Trade(
            seq=2, side="sell", dt="20260201", price=110.0, qty=10,
            fee=1.0, tax=1.8, pnl=90.0, reason="exit",
        ),
    ]
    await store.save_trades("r1", trades)
    rows = await store.trades("r1")
    assert [r.seq for r in rows] == [1, 2]
    assert rows[1].pnl == 90.0


async def test_save_trades_with_empty_sequence_is_a_no_op(store: BacktestStore) -> None:
    await store.save_trades("r1", [])
    assert await store.trades("r1") == ()


async def test_save_and_read_equity(store: BacktestStore) -> None:
    await store.create_strategy("s1", "이름", "yaml", created_at=NOW)
    await store.add_version("v1", "s1", 1, "source", origin="human", created_at=NOW, active=True)
    await store.create_run("r1", "v1", params_json="{}", spec_hash="h1", status="done")

    points = [
        EquityPoint(dt="20260102", equity=1010.0, cash=1010.0, position_value=0.0, drawdown=0.0),
        EquityPoint(dt="20260101", equity=1000.0, cash=1000.0, position_value=0.0, drawdown=0.0),
    ]
    await store.save_equity("r1", points)
    rows = await store.equity("r1")
    assert [r.dt for r in rows] == ["20260101", "20260102"]


# ── 재기동 ──────────────────────────────────────────────────────────────────


async def test_backtest_store_survives_reopen(tmp_path: Path) -> None:
    path = tmp_path / "athena-backtest.sqlite3"
    first_owner = SqliteOwner(path)
    await first_owner.open()
    first_store = BacktestStore(first_owner)
    await first_store.open()
    await first_store.upsert_candles("005930", "day", True, [candle("20260101")])
    await first_owner.close()

    second_owner = SqliteOwner(path)
    await second_owner.open()
    try:
        second_store = BacktestStore(second_owner)
        await second_store.open()
        assert await second_store.schema_version() == SCHEMA_VERSION
        rows = await second_store.candles("005930", "day", True)
        assert len(rows) == 1
    finally:
        await second_owner.close()
