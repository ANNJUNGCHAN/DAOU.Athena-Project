"""코드 감시 프레임 조립 — 계획 B-7 (오늘 봉 처리 · 건너뛰기 · 열·정렬)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime

import pandas as pd
import pytest

from athena_api.watch import data as wd

pytestmark = pytest.mark.deterministic


@dataclass(frozen=True)
class _Candle:
    dt: str
    open: float
    high: float
    low: float
    close: float
    volume: int


def _candles(days: list[str]) -> list[_Candle]:
    return [_Candle(d, 100.0, 101.0, 99.0, 100.5, 1000 + i) for i, d in enumerate(days)]


class _Store:
    def __init__(self, candles):
        self._candles = candles
        self.calls: list[tuple] = []

    async def candles(self, stk_cd, period, adjusted, *, start=None, end=None):
        self.calls.append((stk_cd, period, adjusted, start, end))
        return tuple(self._candles)


def test_frame_from_candles_is_ascending_with_ohlcv_columns():
    df = wd.frame_from_candles(_candles(["20260903", "20260901", "20260902", "20260902"]))
    assert list(df.columns) == list(wd.FRAME_COLUMNS)
    assert [d.strftime("%Y%m%d") for d in df.index] == ["20260901", "20260902", "20260903"]
    assert df.index.is_monotonic_increasing
    # 중복 날짜는 마지막 행이 이긴다
    assert df.loc[pd.Timestamp("2026-09-02"), "volume"] == 1003


def test_today_bar_is_synthesized_from_quote_when_cache_lacks_today():
    df = wd.frame_from_candles(_candles(["20260901", "20260902"]))
    quote = {
        "open_pric": "101",
        "high_pric": "103",
        "low_pric": "99",
        "cur_prc": "-102",
        "trde_qty": "5000",
    }
    out, synthesized = wd.apply_today_bar(df, quote, date(2026, 9, 3))
    assert synthesized is True
    assert out.index[-1] == pd.Timestamp("2026-09-03")
    last = out.iloc[-1]
    assert last["close"] == 102.0 and last["high"] == 103.0 and last["low"] == 99.0
    assert last["volume"] == 5000
    assert out.index.is_monotonic_increasing


def test_today_bar_is_updated_in_place_when_cache_has_today():
    df = wd.frame_from_candles(_candles(["20260902", "20260903"]))
    out, synthesized = wd.apply_today_bar(
        df, {"cur": 110, "high": 105, "low": 98, "volume": 900}, date(2026, 9, 3)
    )
    assert synthesized is False
    assert len(out) == 2
    last = out.loc[pd.Timestamp("2026-09-03")]
    assert last["close"] == 110.0
    assert last["high"] == 110.0  # 현재가가 고가를 넘으면 고가도 따라간다
    assert last["low"] == 98.0
    assert last["volume"] == 1001  # 캐시 거래량이 더 크면 유지


def test_closed_frame_drops_today_and_after():
    df = wd.frame_from_candles(_candles(["20260901", "20260902", "20260903"]))
    closed = wd.closed_frame(df, date(2026, 9, 3))
    assert [d.strftime("%Y%m%d") for d in closed.index] == ["20260901", "20260902"]
    assert wd.last_closed_date(df, date(2026, 9, 3)) == date(2026, 9, 2)


@pytest.mark.parametrize(
    ("last_closed", "today", "skip"),
    [
        (date(2026, 9, 2), date(2026, 9, 3), False),  # 수 → 목: 직전 평일 그대로
        (date(2026, 9, 4), date(2026, 9, 7), False),  # 금 → 월: 주말 건너뜀
        (date(2026, 9, 1), date(2026, 9, 3), True),  # 하루 비면 휴장일 추정
        (None, date(2026, 9, 3), True),
    ],
)
def test_holiday_skip_heuristic(last_closed, today, skip):
    reason = wd.holiday_skip_reason(last_closed, today)
    assert (reason is not None) is skip
    if reason:
        assert not reason.endswith(("습니다", "입니다", "합니다", "됩니다"))


def test_assemble_frame_reads_cache_then_quote_and_respects_budget():
    store = _Store(_candles(["20260901", "20260902"]))
    seen: list[str] = []

    async def provider(symbol: str):
        seen.append(symbol)
        return {"cur": 120, "open": 100, "high": 121, "low": 99, "volume": 7}

    now = datetime(2026, 9, 3, 10, 0)
    budget = wd.CallBudget(remaining=1)
    result = asyncio.run(
        wd.assemble_frame(store, "005930", 30, quote_provider=provider, now=now, budget=budget)
    )
    assert result.skip_reason is None
    assert result.today_synthesized is True
    assert result.df.index[-1].date() == date(2026, 9, 3)
    assert result.df.iloc[-1]["close"] == 120.0
    assert seen == ["005930"]
    assert budget.remaining == 0
    assert store.calls[0][0] == "005930" and store.calls[0][1] == "day"

    # 예산이 없으면 시세를 부르지 않고 건너뛴다
    seen.clear()
    result2 = asyncio.run(
        wd.assemble_frame(
            store, "005930", 30, quote_provider=provider, now=now, budget=wd.CallBudget(0)
        )
    )
    assert result2.skip_reason is not None and "예산" in result2.skip_reason
    assert seen == []


def test_assemble_frame_skips_when_last_closed_bar_is_stale():
    store = _Store(_candles(["20260828", "20260901"]))  # 9/2(화) 봉이 없다 → 9/3 기준 휴장 추정
    result = asyncio.run(
        wd.assemble_frame(
            store, "005930", 30, today_quote={"cur": 1}, now=datetime(2026, 9, 3, 9, 5)
        )
    )
    assert result.skip_reason is not None
    assert result.last_closed_dt == date(2026, 9, 1)
