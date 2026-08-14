import asyncio

import pytest

from athena_api.kiwoom.rate_limiter import RateLimiter


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.mark.asyncio
async def test_five_distinct_trs_start_immediately_and_sixth_waits_to_boundary() -> None:
    fake = FakeTime()
    limiter = RateLimiter(5.0, clock=fake.clock, sleep=fake.sleep)
    await asyncio.gather(
        *(limiter.acquire(api_id) for api_id in ("ka1", "ka2", "ka3", "ka4", "ka5"))
    )
    assert fake.sleeps == []

    await limiter.acquire("ka6")
    assert fake.sleeps == pytest.approx([1.0])
    assert fake.now == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_repeated_tr_waits_one_second_even_with_global_capacity() -> None:
    fake = FakeTime()
    limiter = RateLimiter(5.0, clock=fake.clock, sleep=fake.sleep)
    await limiter.acquire("ka1")
    await limiter.acquire("ka1")
    assert fake.sleeps == pytest.approx([1.0])


def test_invalid_limits_are_rejected() -> None:
    with pytest.raises(ValueError):
        RateLimiter(0)
