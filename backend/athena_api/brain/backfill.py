"""과거 체결을 영업일 단위로 받아 이력에 채운다.

2026-08-26. 잔고 스냅숏은 "지금 무엇을 들고 있나"만 답한다 — 찍기 시작한 이후만 만들고,
스냅숏 사이의 왕복은 흔적이 남지 않는다. 과거의 매매는 체결 조회가 직접 준다.

**왜 하루씩인가.** `kt00007 계좌별주문체결내역상세요청`의 요청 파라미터가 `ord_dt`
(주문일자) 하나다 — 기간 조회가 아니다. 그래서 영업일마다 한 번씩 부른다. 90일이면
약 60영업일이고, 키움 RateLimiter가 API당 초당 1회이므로 대략 60초다. 최초 1회뿐이다.

**왜 앞에서 뒤로인가.** 커서(`adapter_cursors`)가 `MAX(기존, 신규)`로 갱신되는 단조
증가 값이라, 오래된 날부터 최근으로 진행해야 "여기까지 했다"가 성립한다. 뒤에서 앞으로
가면 커서가 첫 반복에서 최댓값이 되어 중단 지점을 잃는다.

**재실행은 안전하다.** 같은 체결을 다시 넣어도 `HistoryStore`가 지문으로 걸러낸다.
그래서 중복 호출이 그래프를 흔들지 않고, 중단 뒤 다시 돌리면 커서 다음 날부터 잇는다.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Protocol

from .history import CompletedTradeRecord, TradeSide

logger = logging.getLogger(__name__)

# 커서 이름. `adapter_cursors`를 쓰지만 어댑터가 아니라 백필 진행도다 — 값은 seq가 아니라
# `YYYYMMDD`다. 같은 표를 쓰는 이유는 그것이 이미 원자적이고 재기동을 견디기 때문이다.
BACKFILL_CURSOR = "trade_backfill"

DEFAULT_BACKFILL_DAYS = 90
MAX_BACKFILL_DAYS = 730


@dataclass(frozen=True, slots=True)
class ExecutedTrade:
    """체결 한 건. 계좌를 알고 있어야 `trade_id`가 계좌 간에 안 겹친다."""

    alias: str
    order_no: str
    security_id: str
    side: TradeSide
    quantity: int
    price: Decimal
    occurred_at: datetime


class TradeHistory(Protocol):
    async def upsert_completed_trade(
        self, record: CompletedTradeRecord, *, changed_at: datetime | None = ...
    ) -> Any: ...

    async def cursor(self, adapter_name: str) -> int: ...

    async def advance_cursor(self, adapter_name: str, seq: int) -> int: ...


class ExecutionSource(Protocol):
    """계좌 하나의 하루치 체결. 브레인은 키움 클라이언트를 직접 알지 않는다."""

    async def fetch_executions(
        self, alias: str, order_date: date
    ) -> Sequence[ExecutedTrade]: ...


def business_days(start: date, end: date) -> tuple[date, ...]:
    """`start`부터 `end`까지의 영업일(주말 제외), 오름차순.

    공휴일은 거르지 않는다. 리포에 영업일 달력이 없고, 공휴일에 부르면 빈 응답이
    돌아올 뿐이라 비용이 호출 몇 번이다. 달력을 들이는 것이 그 비용보다 비싸다.
    """
    if end < start:
        return ()
    days: list[date] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:  # 월(0) ~ 금(4)
            days.append(cursor)
        cursor += timedelta(days=1)
    return tuple(days)


def _cursor_value(day: date) -> int:
    return day.year * 10_000 + day.month * 100 + day.day


@dataclass(frozen=True, slots=True)
class BackfillReport:
    days_scanned: int
    trades_ingested: int
    first_day: date | None
    last_day: date | None


class TradeBackfill:
    """과거 체결을 영업일마다 받아 적재한다."""

    def __init__(
        self,
        history: TradeHistory,
        source: ExecutionSource,
        *,
        aliases: Sequence[str] | Callable[[], Sequence[str]],
        clock: Callable[[], datetime],
        days: int = DEFAULT_BACKFILL_DAYS,
    ) -> None:
        if not 1 <= days <= MAX_BACKFILL_DAYS:
            raise ValueError(f"days must be between 1 and {MAX_BACKFILL_DAYS}")
        if not callable(aliases) and not aliases:
            raise ValueError("aliases must not be empty")
        self._history = history
        self._source = source
        self._aliases = aliases if callable(aliases) else lambda: tuple(aliases)
        self._clock = clock
        self._days = days

    async def run(self) -> BackfillReport:
        today = self._clock().date()
        window_start = today - timedelta(days=self._days)

        # 커서 다음 날부터 잇는다. 커서가 0이면(처음) 창의 시작부터.
        done_through = await self._history.cursor(BACKFILL_CURSOR)
        if done_through:
            resume = _from_cursor(done_through) + timedelta(days=1)
            start = max(window_start, resume)
        else:
            start = window_start

        days = business_days(start, today)
        if not days:
            return BackfillReport(0, 0, None, None)

        ingested = 0
        for index, day in enumerate(days, start=1):
            for alias in self._aliases():
                for trade in await self._source.fetch_executions(alias, day):
                    await self._history.upsert_completed_trade(
                        CompletedTradeRecord(
                            trade_id=f"{trade.alias}:{trade.order_no}",
                            security_id=trade.security_id,
                            side=trade.side,
                            quantity=trade.quantity,
                            price=trade.price,
                            occurred_at=trade.occurred_at,
                        ),
                        changed_at=self._clock(),
                    )
                    ingested += 1
            # 하루를 다 마친 **뒤에** 커서를 옮긴다. 중간에 죽으면 그 날을 다시 하지만,
            # 재적재는 지문으로 걸러지므로 중복이 아니라 낭비 몇 초다. 반대로 먼저
            # 옮기면 반쯤 받은 날을 완료로 표시해 체결이 영영 빠진다.
            await self._history.advance_cursor(BACKFILL_CURSOR, _cursor_value(day))
            if index % 10 == 0 or index == len(days):
                logger.info(
                    "brain trade backfill %d/%d days (%s), %d trades",
                    index,
                    len(days),
                    day.isoformat(),
                    ingested,
                )

        return BackfillReport(len(days), ingested, days[0], days[-1])


def _from_cursor(value: int) -> date:
    return date(value // 10_000, (value // 100) % 100, value % 100)


__all__ = [
    "BACKFILL_CURSOR",
    "DEFAULT_BACKFILL_DAYS",
    "MAX_BACKFILL_DAYS",
    "BackfillReport",
    "ExecutedTrade",
    "ExecutionSource",
    "TradeBackfill",
    "business_days",
]
