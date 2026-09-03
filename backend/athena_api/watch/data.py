"""감시 함수에 넘길 일봉 프레임 조립 — 계획 §0 「오늘 봉 처리」 규칙의 유일한 구현.

- 캐시(`bt_candle`)의 일봉을 오래된 순으로 읽어 `open high low close volume` 프레임을 만든다.
- 오늘 봉: 캐시에 오늘 일봉이 있으면 현재가(ka10001 모양)로 종가·고가·저가·거래량을 갱신하고,
  없으면 그 시세로 오늘 봉을 **합성**해 마지막 행으로 붙인다.
- 건너뛰기: 마지막 완성 봉이 직전 평일보다 오래됐을 때만(휴장일 추정) 사유를 남기고 건너뛴다.
- 검사(미니 백테스트)는 오늘을 뺀 완성 봉(D-1)만 본다 — `closed_frame`.

부모가 데이터를 받아 프레임으로 넘긴다(자식 샌드박스는 자격증명·DB가 없다). REST 호출은
주기당 예산(`CallBudget`)으로 묶는다 — `RateLimiter.headroom()`은 1초 창이라 예산이 못 된다.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd

FRAME_COLUMNS = ("open", "high", "low", "close", "volume")

QuoteProvider = Callable[[str], Awaitable[dict[str, Any] | None]]


@dataclass
class CallBudget:
    """한 폴링 주기가 쓸 수 있는 REST 호출 수. 0이 되면 이번 주기는 건너뛴다."""

    remaining: int

    def take(self, n: int = 1) -> bool:
        if self.remaining < n:
            return False
        self.remaining -= n
        return True


@dataclass(frozen=True)
class FrameResult:
    df: pd.DataFrame
    skip_reason: str | None
    last_closed_dt: date | None
    today_synthesized: bool = False
    warnings: tuple[str, ...] = field(default_factory=tuple)


def _previous_weekday(day: date) -> date:
    cursor = day - timedelta(days=1)
    while cursor.weekday() >= 5:
        cursor -= timedelta(days=1)
    return cursor


def holiday_skip_reason(last_closed: date | None, today: date) -> str | None:
    """마지막 완성 봉이 직전 평일보다 오래됐으면 휴장일로 추정하고 건너뛴다."""
    if last_closed is None:
        return "완성된 일봉 없음 — 먼저 일봉을 받아야 함"
    if last_closed < _previous_weekday(today):
        return (
            f"마지막 완성 봉 {last_closed.isoformat()} — 직전 평일보다 오래됨"
            " · 휴장일로 보고 건너뜀"
        )
    return None


def frame_from_candles(candles: Sequence[Any]) -> pd.DataFrame:
    """`bt_candle` 행(dt=YYYYMMDD)을 오름차순 OHLCV 프레임으로. 중복 날짜는 마지막 행이 이긴다."""
    if not candles:
        return pd.DataFrame(
            {c: pd.Series(dtype="float64" if c != "volume" else "int64") for c in FRAME_COLUMNS},
            index=pd.DatetimeIndex([], name="date"),
        )
    rows = sorted(candles, key=lambda c: str(c.dt))
    index = pd.to_datetime([str(c.dt) for c in rows], format="%Y%m%d")
    df = pd.DataFrame(
        {
            "open": [float(c.open) for c in rows],
            "high": [float(c.high) for c in rows],
            "low": [float(c.low) for c in rows],
            "close": [float(c.close) for c in rows],
            "volume": [int(c.volume) for c in rows],
        },
        index=index,
    )
    df.index.name = "date"
    df = df[~df.index.duplicated(keep="last")]
    return df.sort_index()


def _quote_number(quote: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        raw = quote.get(key)
        if raw is None or raw == "":
            continue
        try:
            return abs(float(str(raw).replace(",", "")))
        except ValueError:
            continue
    return None


def apply_today_bar(
    df: pd.DataFrame, quote: dict[str, Any] | None, today: date
) -> tuple[pd.DataFrame, bool]:
    """오늘 봉을 시세로 갱신하거나 합성한다. 반환 (프레임, 합성 여부).

    시세는 ka10001 모양(`open_pric/high_pric/low_pric/cur_prc/trde_qty`)이나 짧은 이름
    (`open/high/low/cur/volume`) 둘 다 받는다. 시세가 없으면 프레임을 그대로 돌려준다.
    """
    if not quote:
        return df, False
    cur = _quote_number(quote, "cur", "cur_prc", "close")
    if cur is None:
        return df, False
    open_ = _quote_number(quote, "open", "open_pric") or cur
    high = _quote_number(quote, "high", "high_pric") or cur
    low = _quote_number(quote, "low", "low_pric") or cur
    volume = _quote_number(quote, "volume", "trde_qty") or 0.0
    stamp = pd.Timestamp(today)
    if stamp in df.index:
        out = df.copy()
        out.loc[stamp, "close"] = cur
        out.loc[stamp, "high"] = max(float(out.loc[stamp, "high"]), high, cur)
        out.loc[stamp, "low"] = min(float(out.loc[stamp, "low"]), low, cur)
        out.loc[stamp, "volume"] = int(max(float(out.loc[stamp, "volume"]), volume))
        return out, False
    row = pd.DataFrame(
        {
            "open": [open_],
            "high": [max(high, cur)],
            "low": [min(low, cur)],
            "close": [cur],
            "volume": [int(volume)],
        },
        index=pd.DatetimeIndex([stamp], name="date"),
    )
    out = pd.concat([df, row]).sort_index()
    out.index.name = "date"
    return out, True


def closed_frame(df: pd.DataFrame, today: date) -> pd.DataFrame:
    """오늘(및 그 이후) 행을 뺀 완성 봉만 — 검사(D-1)가 보는 프레임."""
    if df.empty:
        return df
    return df[df.index < pd.Timestamp(today)]


def last_closed_date(df: pd.DataFrame, today: date) -> date | None:
    closed = closed_frame(df, today)
    if closed.empty:
        return None
    return closed.index[-1].date()


async def assemble_frame(
    store: Any,
    symbol: str,
    lookback_days: int,
    *,
    today_quote: dict[str, Any] | None = None,
    quote_provider: QuoteProvider | None = None,
    now: datetime | None = None,
    budget: CallBudget | None = None,
    period: str = "day",
    adjusted: bool = True,
) -> FrameResult:
    """캐시 일봉 + 오늘 시세 → 감시 함수가 받을 프레임.

    `store.candles(stk_cd, period, adjusted, start=, end=)`는 백테스트 캐시의 읽기 API다
    (쓰지 않는다 — 백필은 검사 라우트가 따로 부른다). `today_quote`를 직접 주거나
    `quote_provider`로 받아온다(호출 1건 = 예산 1).
    """
    now = now or datetime.now()
    today = now.date()
    warnings: list[str] = []
    # 워밍업 여유: 지표가 lookback보다 긴 창을 쓸 수 있어 3배를 읽는다(캐시 읽기라 비용 없음).
    start = (today - timedelta(days=lookback_days * 3)).strftime("%Y%m%d")
    candles = await store.candles(symbol, period, adjusted, start=start)
    df = frame_from_candles(candles)
    last_closed = last_closed_date(df, today)
    skip = holiday_skip_reason(last_closed, today)
    if skip:
        return FrameResult(df=df, skip_reason=skip, last_closed_dt=last_closed)

    quote = today_quote
    if quote is None and quote_provider is not None:
        if budget is not None and not budget.take():
            return FrameResult(
                df=df,
                skip_reason="이번 주기 시세 호출 예산 소진 — 다음 주기에 확인",
                last_closed_dt=last_closed,
            )
        quote = await quote_provider(symbol)
        if quote is None:
            warnings.append("오늘 시세 없음 — 완성 봉까지만 사용")
    df, synthesized = apply_today_bar(df, quote, today)
    return FrameResult(
        df=df,
        skip_reason=None,
        last_closed_dt=last_closed,
        today_synthesized=synthesized,
        warnings=tuple(warnings),
    )
