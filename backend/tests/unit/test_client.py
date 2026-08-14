import asyncio
from datetime import datetime, timedelta

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.dependencies import require_kiwoom_client
from athena_api.errors import KiwoomApiError
from athena_api.kiwoom import KiwoomAuth, KiwoomClient, RateLimiter
from athena_api.main import create_app


def ready_auth() -> KiwoomAuth:
    auth = KiwoomAuth("app", "secret")
    auth._token = "token"  # noqa: SLF001 - isolated unit fixture
    auth._expires_at = datetime.now() + timedelta(hours=1)  # noqa: SLF001
    return auth


async def no_sleep(_seconds: float) -> None:
    return None


@pytest.mark.asyncio
async def test_headers_and_bounded_rate_limit_retry() -> None:
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        route = mock.post("/api/dostk/stkinfo")
        route.side_effect = [
            httpx.Response(200, json={"return_code": "01700"}),
            httpx.Response(200, json={"return_code": "0000", "stk_nm": "OK"}),
        ]
        client = KiwoomClient(ready_auth(), limiter, sleep=no_sleep, random_value=lambda: 0.5)
        try:
            body = await client.post("ka10001", "/api/dostk/stkinfo", {"stk_cd": "005930"})
        finally:
            await client.aclose()
    assert body["stk_nm"] == "OK"
    assert route.call_count == 2
    headers = route.calls[0].request.headers
    assert headers["api-id"] == "ka10001"
    assert headers["authorization"] == "Bearer token"
    assert headers["cont-yn"] == "N"


@pytest.mark.asyncio
async def test_http_429_retry_is_bounded() -> None:
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        route = mock.post("/query").mock(return_value=httpx.Response(429, json={}))
        client = KiwoomClient(ready_auth(), limiter, max_rate_limit_retries=1, sleep=no_sleep)
        try:
            with pytest.raises(KiwoomApiError):
                await client.post("ka10001", "/query")
        finally:
            await client.aclose()
    assert route.call_count == 2


@pytest.mark.asyncio
async def test_http_transport_error_is_mapped_without_exposing_details() -> None:
    secret_detail = "never-show-transport-detail"
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        route = mock.post("/query").mock(
            side_effect=httpx.ConnectError(secret_detail, request=httpx.Request("POST", "/query"))
        )
        client = KiwoomClient(ready_auth(), limiter)
        try:
            with pytest.raises(KiwoomApiError) as error:
                await client.post("ka10001", "/query")
        finally:
            await client.aclose()
    assert error.value.code == "transport_error"
    assert error.value.http_status == 502
    assert secret_detail not in str(error.value)
    assert secret_detail not in error.value.message
    assert route.call_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "expected_code"),
    [
        (httpx.Response(200, text="not-json"), "invalid_response"),
        (httpx.Response(200, json=[{"return_code": 0}]), "invalid_response"),
        (httpx.Response(302, headers={"location": "https://example.invalid/secret"}), "302"),
        (httpx.Response(500, json={"return_code": 9, "return_msg": "upstream-secret"}), "9"),
    ],
)
async def test_all_malformed_and_non_success_responses_are_secret_safe(
    response: httpx.Response, expected_code: str
) -> None:
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    secret = "upstream-secret"
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/query").mock(return_value=response)
        client = KiwoomClient(ready_auth(), limiter)
        try:
            with pytest.raises(KiwoomApiError) as error:
                await client.post("ka10001", "/query")
        finally:
            await client.aclose()
    assert error.value.code == expected_code
    assert secret not in str(error.value)
    assert secret not in error.value.message


@pytest.mark.asyncio
async def test_empty_success_object_is_rejected_as_invalid_response() -> None:
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        route = mock.post("/query").mock(return_value=httpx.Response(200, json={}))
        client = KiwoomClient(ready_auth(), limiter)
        try:
            with pytest.raises(KiwoomApiError) as error:
                await client.post("ka10001", "/query")
        finally:
            await client.aclose()
    assert error.value.code == "invalid_response"
    assert error.value.http_status == 502
    assert error.value.message == "upstream response was invalid"
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_nonempty_success_object_without_return_code_remains_valid() -> None:
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/query").mock(return_value=httpx.Response(200, json={"stk_nm": "OK"}))
        client = KiwoomClient(ready_auth(), limiter)
        try:
            body = await client.post("ka10001", "/query")
        finally:
            await client.aclose()
    assert body == {"stk_nm": "OK"}


def test_empty_success_object_is_fail_closed_on_detail_route() -> None:
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    upstream_client = KiwoomClient(ready_auth(), limiter)
    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[require_kiwoom_client] = lambda: upstream_client

    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        route = mock.post("/api/dostk/stkinfo").mock(
            return_value=httpx.Response(200, json={})
        )
        try:
            with TestClient(app) as client:
                response = client.post(
                    "/api/v1/tr/stockinfo/ka10001/detail/price_range",
                    json={"stk_cd": "005930"},
                )
        finally:
            asyncio.run(upstream_client.aclose())

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Kiwoom upstream request failed",
        "code": "invalid_response",
    }
    assert route.call_count == 1


@pytest.mark.asyncio
async def test_zero_padded_error_code_is_canonicalized() -> None:
    limiter = RateLimiter(rate_per_second=1000, per_api_rate=None)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/query").mock(
            return_value=httpx.Response(200, json={"return_code": "0009"})
        )
        client = KiwoomClient(ready_auth(), limiter)
        try:
            with pytest.raises(KiwoomApiError) as error:
                await client.post("ka10001", "/query")
        finally:
            await client.aclose()
    assert error.value.code == "9"


def test_live_domain_is_rejected() -> None:
    with pytest.raises(ValueError, match="mock domain"):
        KiwoomClient(ready_auth(), RateLimiter(), base_url="https://api.kiwoom.com")


def test_health_is_live_without_credentials_and_ready_is_fail_closed() -> None:
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert client.get("/ready").status_code == 503


def test_ready_reports_ready_client() -> None:
    app = create_app(Settings(_env_file=None))
    with TestClient(app) as client:
        app.state.kiwoom_client = type("ReadyClient", (), {"is_ready": True})()
        response = client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
