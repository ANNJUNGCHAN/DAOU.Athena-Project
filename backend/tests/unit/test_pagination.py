from datetime import datetime, timedelta

import httpx
import pytest
import respx

from athena_api.kiwoom import KiwoomAuth, KiwoomClient, RateLimiter


def ready_auth() -> KiwoomAuth:
    auth = KiwoomAuth("app", "secret")
    auth._token = "token"  # noqa: SLF001
    auth._expires_at = datetime.now() + timedelta(hours=1)  # noqa: SLF001
    return auth


@pytest.mark.asyncio
async def test_pagination_forwards_next_key_and_stops() -> None:
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        route = mock.post("/query")
        route.side_effect = [
            httpx.Response(
                200,
                json={"return_code": 0, "rows": [1]},
                headers={"cont-yn": "Y", "next-key": "next"},
            ),
            httpx.Response(200, json={"return_code": 0, "rows": [2]}, headers={"cont-yn": "N"}),
        ]
        client = KiwoomClient(ready_auth(), RateLimiter(1000, per_api_rate=None))
        try:
            items, pages, _ = await client.post_paged("ka10001", "/query", list_key="rows")
        finally:
            await client.aclose()
    assert items == [1, 2]
    assert pages == 2
    assert route.calls[1].request.headers["next-key"] == "next"


@pytest.mark.asyncio
async def test_pagination_obeys_explicit_cap() -> None:
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        route = mock.post("/query").mock(
            return_value=httpx.Response(
                200,
                json={"return_code": 0, "rows": [1]},
                headers={"cont-yn": "Y", "next-key": "same"},
            )
        )
        client = KiwoomClient(
            ready_auth(),
            RateLimiter(1000, per_api_rate=None),
            max_pages=3,
        )
        try:
            items, pages, _ = await client.post_paged("ka10001", "/query", list_key="rows")
        finally:
            await client.aclose()
    assert items == [1, 1, 1]
    assert pages == 3
    assert route.call_count == 3


@pytest.mark.asyncio
async def test_per_call_cap_cannot_exceed_configured_cap() -> None:
    client = KiwoomClient(ready_auth(), RateLimiter(), max_pages=2)
    with pytest.raises(ValueError, match="max_pages"):
        await client.post_paged("ka10001", "/query", max_pages=3)
