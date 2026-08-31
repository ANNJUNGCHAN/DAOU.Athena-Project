"""백테스트 캔들 데이터 층 계약 — 계약 로드·페이지 파싱·백필·권리락 대조·계획.

키움 클라이언트는 실제로 부르지 않는다 — `fetch_page`를 가짜로 주입해 네트워크 없이
결정적으로 검증한다(§5.1의 fetch_page 계약 그대로).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from athena_api.backtest.data import (
    ASSUMED_ROWS_PER_PAGE,
    AdjustmentDetected,
    backfill,
    compute_plan,
    contract_for,
    detect_adjustment,
    parse_page,
)
from athena_api.backtest.store import BacktestStore, Candle, Coverage
from athena_api.brain.db import SqliteOwner

# 결정층(leaf 9): 네트워크도 난수도 타지 않는다 — 파싱·페이지네이션·대조 계약만 검증한다.
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


def ka10081_page(dts_desc: list[str], *, close: float = 100.0) -> dict[str, Any]:
    """ka10081 응답 모양 — stk_dt_pole_chart_qry 리스트, 문자열 숫자. `dts_desc`는
    호출자가 주는 순서 그대로 담는다(최신→과거 관례를 흉내 내되 강제하지 않는다)."""
    return {
        "stk_cd": "005930",
        "stk_dt_pole_chart_qry": [
            {
                "dt": dt,
                "cur_prc": f"+{close:.0f}",
                "trde_qty": "1000",
                "open_pric": f"{close - 1:.0f}",
                "high_pric": f"{close + 1:.0f}",
                "low_pric": f"{close - 2:.0f}",
            }
            for dt in dts_desc
        ],
    }


# ── 계약 로드 ────────────────────────────────────────────────────────────────


def test_contract_for_day_matches_ka10081_alias_table() -> None:
    contract = contract_for("day")
    assert contract.tr_id == "ka10081"
    assert contract.container_alias == "stk_dt_pole_chart_qry"
    assert contract.time_alias == "dt"
    assert contract.open_alias == "open_pric"
    assert contract.high_alias == "high_pric"
    assert contract.low_alias == "low_pric"
    assert contract.close_alias == "cur_prc"
    assert contract.volume_alias == "trde_qty"


def test_contract_for_week_and_month_use_their_own_tr_ids() -> None:
    assert contract_for("week").tr_id == "ka10082"
    assert contract_for("month").tr_id == "ka10083"


def test_contract_for_rejects_unsupported_period() -> None:
    with pytest.raises(ValueError, match="unsupported backtest period"):
        contract_for("tick")


# ── 한 페이지 파싱 ────────────────────────────────────────────────────────────


def test_parse_page_parses_ka10081_shape_with_signed_string_numbers() -> None:
    raw = ka10081_page(["20260102", "20260101"], close=71100.0)
    candles = parse_page(raw, contract_for("day"))
    assert [c.dt for c in candles] == ["20260102", "20260101"]
    assert candles[0].close == 71100.0
    assert candles[0].open == 71099.0
    assert candles[0].volume == 1000


def test_parse_page_skips_rows_missing_required_fields() -> None:
    raw = {
        "stk_dt_pole_chart_qry": [
            {
                "dt": "20260101",
                "open_pric": "100",
                "high_pric": "110",
                "low_pric": "90",
                "cur_prc": "105",
                "trde_qty": "10",
            },
            # cur_prc·trde_qty 없음 — 이 행은 버려진다.
            {"dt": "20260102", "open_pric": "100", "high_pric": "110", "low_pric": "90"},
        ]
    }
    candles = parse_page(raw, contract_for("day"))
    assert [c.dt for c in candles] == ["20260101"]


def test_parse_page_empty_container_is_valid_exhaustion() -> None:
    raw = {"stk_dt_pole_chart_qry": []}
    assert parse_page(raw, contract_for("day")) == []


def test_parse_page_rejects_non_list_container() -> None:
    with pytest.raises(ValueError, match="not a list"):
        parse_page({"stk_dt_pole_chart_qry": "oops"}, contract_for("day"))


# ── 권리락 대조 (§5.4 규칙 2) ─────────────────────────────────────────────────


def test_detect_adjustment_flags_mismatched_overlap_close() -> None:
    existing = (candle("20260101", close=100.0), candle("20260102", close=101.0))
    fetched = [candle("20260102", close=55.0), candle("20260103", close=56.0)]
    mismatches = detect_adjustment(existing, fetched, overlap_n=20)
    assert mismatches == [("20260102", 101.0, 55.0)]


def test_detect_adjustment_empty_when_overlap_matches() -> None:
    existing = (candle("20260101", close=100.0),)
    fetched = [candle("20260101", close=100.0), candle("20260102", close=102.0)]
    assert detect_adjustment(existing, fetched, overlap_n=20) == []


def test_detect_adjustment_empty_when_no_overlap_dt() -> None:
    existing = (candle("20260101", close=100.0),)
    fetched = [candle("20260201", close=999.0)]
    assert detect_adjustment(existing, fetched, overlap_n=20) == []


# ── 백필 루프 ────────────────────────────────────────────────────────────────


async def test_backfill_two_pages_then_exhausted(store: BacktestStore) -> None:
    calls: list[tuple[str, str | None]] = []

    async def fetch_page(
        tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
    ) -> tuple[dict[str, Any], str, str | None]:
        assert tr_id == "ka10081"
        assert body["stk_cd"] == "005930"
        calls.append((cont_yn, next_key))
        if cont_yn == "N":
            return ka10081_page(["20260110", "20260109"]), "Y", "K1"
        if next_key == "K1":
            return ka10081_page(["20260108", "20260107"]), "N", None
        raise AssertionError("unexpected extra call")

    progress: list[tuple[int, int, str]] = []
    pages = await backfill(
        store=store,
        fetch_page=fetch_page,
        stk_cd="005930",
        period="day",
        adjusted=True,
        base_dt="20260110",
        from_dt="20260101",
        on_progress=lambda page, rows, oldest: progress.append((page, rows, oldest)),
        now=lambda: NOW,
    )

    assert pages == 2
    assert calls == [("N", None), ("Y", "K1")]
    assert progress == [(1, 2, "20260109"), (2, 2, "20260107")]

    rows = await store.candles("005930", "day", True)
    assert [r.dt for r in rows] == ["20260107", "20260108", "20260109", "20260110"]

    coverage = await store.coverage("005930", "day", True)
    assert coverage is not None
    assert coverage.first_dt == "20260107"
    assert coverage.last_dt == "20260110"
    assert coverage.pages == 2


async def test_backfill_stops_once_target_from_dt_reached_within_one_page(
    store: BacktestStore,
) -> None:
    calls = 0

    async def fetch_page(
        tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
    ) -> tuple[dict[str, Any], str, str | None]:
        nonlocal calls
        calls += 1
        # 서버는 더 있다고 하지만(cont_yn=Y) from_dt에 이미 닿아서 더 부르면 안 된다.
        return ka10081_page(["20260110", "20260109", "20260108"]), "Y", "K1"

    pages = await backfill(
        store=store,
        fetch_page=fetch_page,
        stk_cd="005930",
        period="day",
        adjusted=True,
        base_dt="20260110",
        from_dt="20260109",
        now=lambda: NOW,
    )

    assert pages == 1
    assert calls == 1
    rows = await store.candles("005930", "day", True)
    assert [r.dt for r in rows] == ["20260108", "20260109", "20260110"]


async def test_backfill_no_new_rows_leaves_coverage_untouched(store: BacktestStore) -> None:
    async def fetch_page(
        tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
    ) -> tuple[dict[str, Any], str, str | None]:
        return {"stk_dt_pole_chart_qry": []}, "N", None

    pages = await backfill(
        store=store,
        fetch_page=fetch_page,
        stk_cd="005930",
        period="day",
        adjusted=True,
        base_dt="20260110",
        from_dt="20260101",
        now=lambda: NOW,
    )

    assert pages == 0
    assert await store.coverage("005930", "day", True) is None


async def test_backfill_raises_adjustment_detected_and_does_not_touch_cache(
    store: BacktestStore,
) -> None:
    await store.upsert_candles(
        "005930", "day", True, [candle("20260109", close=100.0)]
    )
    await store.upsert_coverage(
        "005930",
        "day",
        True,
        first_dt="20260109",
        last_dt="20260109",
        fetched_at=NOW,
        pages=1,
    )

    async def fetch_page(
        tr_id: str, body: dict[str, Any], cont_yn: str, next_key: str | None
    ) -> tuple[dict[str, Any], str, str | None]:
        # 겹치는 20260109의 종가가 캐시(100)와 다르다(55) — 권리락 감지 대상.
        return ka10081_page(["20260110", "20260109"], close=55.0), "N", None

    with pytest.raises(AdjustmentDetected) as excinfo:
        await backfill(
            store=store,
            fetch_page=fetch_page,
            stk_cd="005930",
            period="day",
            adjusted=True,
            base_dt="20260110",
            from_dt="20260101",
            now=lambda: NOW,
        )

    assert excinfo.value.mismatches == [("20260109", 100.0, 55.0)]
    # 조용히 재수집하지 않았다 — 기존 캐시가 그대로 남아 있다.
    rows = await store.candles("005930", "day", True)
    assert [r.dt for r in rows] == ["20260109"]
    assert rows[0].close == 100.0


# ── 수집 계획 ────────────────────────────────────────────────────────────────


def test_plan_no_coverage_needs_full_range() -> None:
    plan = compute_plan(
        stk_cd="005930",
        period="day",
        adjusted=True,
        from_dt="20260101",
        to_dt="20260131",
        coverage=None,
    )
    assert plan.missing_days == 31
    assert plan.estimated_pages == 1
    assert plan.estimated_seconds == 1.0


def test_plan_partial_coverage_only_counts_the_gap() -> None:
    coverage = Coverage(
        stk_cd="005930",
        period="day",
        adjusted=True,
        first_dt="20260115",
        last_dt="20260131",
        fetched_at="2026-08-31T00:00:00+00:00",
        pages=1,
    )
    plan = compute_plan(
        stk_cd="005930",
        period="day",
        adjusted=True,
        from_dt="20260101",
        to_dt="20260131",
        coverage=coverage,
    )
    assert plan.missing_days == 14  # 20260101~20260114


def test_plan_full_coverage_needs_nothing() -> None:
    coverage = Coverage(
        stk_cd="005930",
        period="day",
        adjusted=True,
        first_dt="20260101",
        last_dt="20260131",
        fetched_at="2026-08-31T00:00:00+00:00",
        pages=1,
    )
    plan = compute_plan(
        stk_cd="005930",
        period="day",
        adjusted=True,
        from_dt="20260101",
        to_dt="20260131",
        coverage=coverage,
    )
    assert plan.missing_days == 0
    assert plan.estimated_pages == 0
    assert plan.estimated_seconds == 0.0


def test_plan_large_gap_needs_multiple_pages() -> None:
    """ASSUMED_ROWS_PER_PAGE(§5.2 가정)를 넘어서는 구간은 페이지 수가 늘어야 한다."""
    plan = compute_plan(
        stk_cd="005930",
        period="day",
        adjusted=True,
        from_dt="20160101",
        to_dt="20260101",
        coverage=None,
    )
    assert plan.missing_days > 3000
    assert plan.estimated_pages > 1
    assert plan.estimated_pages == plan.estimated_seconds
    # 페이지당 행 수 가정이 바뀌면 이 값도 같이 움직인다는 것만 확인한다.
    assert ASSUMED_ROWS_PER_PAGE == 600
