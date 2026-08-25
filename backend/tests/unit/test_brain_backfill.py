"""체결 백필 — 영업일 루프와 이어받기.

2026-08-26. `kt00007`이 `ord_dt`(주문일자) 하루 단위라 기간 조회가 아니다. 그래서
영업일마다 한 번씩 부르고, 중단되면 커서 다음 날부터 잇는다.

CI는 키 없이 돈다 — `ExecutionSource`를 합성 픽스처로 갈아끼운다.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from athena_api.brain import (
    BACKFILL_CURSOR,
    INVESTOR_PROFILE_ENTITY_ID,
    MAX_BACKFILL_DAYS,
    DeterministicTradeProjector,
    ExecutedTrade,
    GraphStore,
    HistoryStore,
    RelationKind,
    SqliteOwner,
    TradeBackfill,
    TradeSide,
    business_days,
)

# 2026-08-26은 수요일.
NOW = datetime(2026, 8, 26, 15, 0, tzinfo=UTC)


def execution(day: date, order_no: str, *, alias: str = "acct-A", code: str = "005930"):
    return ExecutedTrade(
        alias=alias,
        order_no=order_no,
        security_id=code,
        side=TradeSide.BUY,
        quantity=10,
        price=Decimal("70000"),
        occurred_at=datetime(day.year, day.month, day.day, 5, 0, tzinfo=UTC),
    )


class FakeExecutions:
    """날짜별 체결을 돌려준다. 어느 날을 물었는지 붙잡아 둔다."""

    def __init__(self, per_day: dict[date, list[ExecutedTrade]] | None = None) -> None:
        self._per_day = per_day or {}
        self.asked: list[tuple[str, date]] = []
        self.fail_on: date | None = None

    async def fetch_executions(self, alias: str, order_date: date):
        self.asked.append((alias, order_date))
        if self.fail_on is not None and order_date == self.fail_on:
            raise RuntimeError("키움 응답 없음")
        return self._per_day.get(order_date, [])


@pytest.fixture
async def stores(tmp_path: Path):
    owner = SqliteOwner(tmp_path / "brain.sqlite3")
    await owner.open()
    history, graph = HistoryStore(owner), GraphStore(owner)
    await history.open()
    await graph.open()
    try:
        yield history, graph
    finally:
        await owner.close()


# ── 영업일 계산 ─────────────────────────────────────────────────────────────


def test_business_days_skip_weekends() -> None:
    # 2026-08-21(금) ~ 2026-08-25(화)
    days = business_days(date(2026, 8, 21), date(2026, 8, 25))
    assert days == (date(2026, 8, 21), date(2026, 8, 24), date(2026, 8, 25))
    assert all(d.weekday() < 5 for d in days)


def test_business_days_handle_empty_and_reversed_ranges() -> None:
    assert business_days(date(2026, 8, 25), date(2026, 8, 24)) == ()
    # 토·일만 있는 구간
    assert business_days(date(2026, 8, 22), date(2026, 8, 23)) == ()


def test_business_days_are_ascending() -> None:
    """오름차순이어야 커서(MAX 갱신)가 진행도를 뜻한다."""
    days = business_days(date(2026, 8, 1), date(2026, 8, 26))
    assert list(days) == sorted(days)


# ── 백필 ────────────────────────────────────────────────────────────────────


async def test_backfill_ingests_trades_across_business_days(stores) -> None:
    history, _graph = stores
    source = FakeExecutions(
        {
            date(2026, 8, 24): [execution(date(2026, 8, 24), "ord-1")],
            date(2026, 8, 25): [execution(date(2026, 8, 25), "ord-2")],
        }
    )
    report = await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
    ).run()

    assert report.trades_ingested == 2
    asked_days = {day for _alias, day in source.asked}
    assert date(2026, 8, 22) not in asked_days, "토요일은 묻지 않는다"
    assert date(2026, 8, 23) not in asked_days, "일요일은 묻지 않는다"

    changes = await history.trade_changes(0, limit=50)
    assert len(changes) == 2


async def test_backfill_resumes_from_the_cursor(stores) -> None:
    """중간에 끊겨도 다시 돌리면 이어진다 — 같은 날을 처음부터 다시 하지 않는다."""
    history, _graph = stores
    source = FakeExecutions()
    await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
    ).run()
    first_pass = list(source.asked)
    assert first_pass, "첫 회차가 아무 날도 안 물었다면 이 테스트는 아무것도 재지 않는다"

    source.asked.clear()
    await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
    ).run()
    assert source.asked == [], "이미 끝낸 날을 다시 묻지 않는다"


async def test_the_cursor_only_advances_after_a_day_completes(stores) -> None:
    """반쯤 받은 날을 완료로 표시하면 그 날의 체결이 영영 빠진다."""
    history, _graph = stores
    source = FakeExecutions({date(2026, 8, 24): [execution(date(2026, 8, 24), "ord-1")]})
    source.fail_on = date(2026, 8, 25)

    with pytest.raises(RuntimeError, match="키움 응답 없음"):
        await TradeBackfill(
            history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
        ).run()

    cursor = await history.cursor(BACKFILL_CURSOR)
    assert cursor == 20260824, "실패한 날(25일)은 완료로 표시되지 않는다"

    # 고쳐서 다시 돌리면 25일부터 잇는다.
    source.fail_on = None
    source.asked.clear()
    await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
    ).run()
    assert date(2026, 8, 25) in {day for _a, day in source.asked}
    assert date(2026, 8, 24) not in {day for _a, day in source.asked}


async def test_rerunning_the_same_trade_is_a_no_op(stores) -> None:
    """재적재는 지문으로 걸러진다 — 중복 호출이 그래프를 흔들지 않는다."""
    history, _graph = stores
    trade = execution(date(2026, 8, 24), "ord-1")
    source = FakeExecutions({date(2026, 8, 24): [trade]})

    await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
    ).run()
    first = len(await history.trade_changes(0, limit=50))

    await history.reset_cursor(BACKFILL_CURSOR)
    await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
    ).run()
    assert len(await history.trade_changes(0, limit=50)) == first


async def test_trade_ids_do_not_collide_across_accounts(stores) -> None:
    """계좌가 다르면 주문번호가 같아도 다른 체결이다."""
    history, _graph = stores
    day = date(2026, 8, 24)
    source = FakeExecutions(
        {
            day: [
                execution(day, "ord-1", alias="acct-A"),
                execution(day, "ord-1", alias="acct-B"),
            ]
        }
    )
    # 두 계좌가 각각 같은 목록을 돌려주는 상황을 만들기 위해 alias 두 개로 돈다.
    await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=3
    ).run()

    changes = await history.trade_changes(0, limit=50)
    ids = {c.record.id for c in changes}
    assert len(ids) == 2, f"계좌별로 다른 소스여야 한다: {ids}"


async def test_backfilled_trades_make_traded_not_owns(stores) -> None:
    """체결은 "그때 샀다"이지 "지금 들고 있다"가 아니다 (leaf 4 G19 재확인)."""
    history, graph = stores
    day = date(2026, 8, 24)
    source = FakeExecutions({day: [execution(day, "ord-1")]})
    await TradeBackfill(
        history, source, aliases=("acct-A",), clock=lambda: NOW, days=5
    ).run()

    projector = DeterministicTradeProjector(graph, clock=lambda: NOW)
    for change in await history.trade_changes(0, limit=50):
        await graph.upsert_source(change.record)
        await projector.project_source(change.record)

    kinds = {e.kind for e in await graph.neighborhood(INVESTOR_PROFILE_ENTITY_ID, depth=1)}
    assert kinds == {RelationKind.TRADED.value}
    assert RelationKind.OWNS.value not in kinds


# ── 인자 검증 ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize("days", [0, -1, MAX_BACKFILL_DAYS + 1])
async def test_out_of_range_windows_are_refused(stores, days: int) -> None:
    history, _graph = stores
    with pytest.raises(ValueError, match="days"):
        TradeBackfill(history, FakeExecutions(), aliases=("a",), clock=lambda: NOW, days=days)


async def test_an_empty_alias_list_is_refused(stores) -> None:
    history, _graph = stores
    with pytest.raises(ValueError, match="aliases"):
        TradeBackfill(history, FakeExecutions(), aliases=(), clock=lambda: NOW)
