"""Strict rolling-window limits for Kiwoom query starts."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable


class RateLimiter:
    def __init__(
        self,
        rate_per_second: float = 5.0,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        per_api_rate: int | None = 1,
    ) -> None:
        if rate_per_second <= 0 or not float(rate_per_second).is_integer():
            raise ValueError("rate_per_second must be a positive integer")
        if per_api_rate is not None and per_api_rate <= 0:
            raise ValueError("per_api_rate must be positive or None")
        self._limit = int(rate_per_second)
        self._per_api_limit = per_api_rate
        self._clock = clock
        self._sleep = sleep
        self._starts: deque[float] = deque()
        self._api_starts: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    @staticmethod
    def _expire(starts: deque[float], now: float) -> None:
        while starts and starts[0] <= now - 1.0:
            starts.popleft()

    async def acquire(self, api_id: str | None = None) -> None:
        while True:
            async with self._lock:
                now = self._clock()
                self._expire(self._starts, now)
                api_starts = (
                    self._api_starts[api_id] if api_id and self._per_api_limit is not None else None
                )
                if api_starts is not None:
                    self._expire(api_starts, now)

                waits = []
                if len(self._starts) >= self._limit:
                    waits.append(self._starts[0] + 1.0 - now)
                if (
                    api_starts is not None
                    and self._per_api_limit is not None
                    and len(api_starts) >= self._per_api_limit
                ):
                    waits.append(api_starts[0] + 1.0 - now)
                if not waits:
                    self._starts.append(now)
                    if api_starts is not None:
                        api_starts.append(now)
                    return
            await self._sleep(max(waits))
