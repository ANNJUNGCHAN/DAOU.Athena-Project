import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
import respx
from fastapi import FastAPI

from athena_api.config import Settings
from athena_api.dependencies import require_order_kiwoom_client
from athena_api.errors import KiwoomAuthError, KiwoomNotReadyError
from athena_api.kiwoom.auth import KiwoomAuth, TokenManager, parse_kiwoom_datetime
from athena_api.lifespan import build_lifespan


def test_parse_kiwoom_datetime() -> None:
    assert parse_kiwoom_datetime("20260814213045") == datetime(2026, 8, 14, 21, 30, 45)


def test_token_is_unavailable_before_issue() -> None:
    auth = KiwoomAuth("app", "secret")
    with pytest.raises(KiwoomNotReadyError):
        _ = auth.authorization


@pytest.mark.asyncio
async def test_issue_token_keeps_token_in_memory() -> None:
    expires = datetime.now() + timedelta(hours=1)
    async with httpx.AsyncClient() as http_client:
        with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
            route = mock.post("/oauth2/token").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "return_code": "0000",
                        "token": "memory-token",
                        "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
                    },
                )
            )
            auth = KiwoomAuth("app-key", "secret-key", client=http_client)
            await auth.issue_token()
    assert auth.authorization == "Bearer memory-token"
    assert route.calls[0].request.headers["api-id"] == "au10001"


@pytest.mark.asyncio
async def test_concurrent_ensure_token_issues_once() -> None:
    started = asyncio.Event()
    release = asyncio.Event()
    call_count = 0
    expires = datetime.now() + timedelta(hours=1)

    async def issue_response(_request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        started.set()
        await release.wait()
        return httpx.Response(
            200,
            json={
                "return_code": 0,
                "token": "memory-token",
                "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
            },
        )

    transport = httpx.MockTransport(issue_response)
    async with httpx.AsyncClient(transport=transport) as http_client:
        auth = KiwoomAuth("app-key", "secret-key", client=http_client)
        first = asyncio.create_task(auth.ensure_token())
        await started.wait()
        second = asyncio.create_task(auth.ensure_token())
        await asyncio.sleep(0)
        release.set()
        await asyncio.gather(first, second)

    assert call_count == 1
    assert auth.authorization == "Bearer memory-token"


@pytest.mark.asyncio
async def test_auth_error_does_not_expose_secrets() -> None:
    app_key = "never-show-app-key"
    secret_key = "never-show-secret-key"
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/oauth2/token").mock(
            return_value=httpx.Response(200, json={"return_code": 3, "return_msg": secret_key})
        )
        auth = KiwoomAuth(app_key, secret_key)
        try:
            with pytest.raises(KiwoomAuthError) as error:
                await auth.issue_token()
        finally:
            await auth.aclose()
    assert app_key not in str(error.value)
    assert secret_key not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(
            302,
            json={"return_code": 0, "token": "redirect-token", "expires_dt": "20990101000000"},
        ),
        httpx.Response(200, text="malformed-secret"),
        httpx.Response(200, json=[{"return_code": 0}]),
    ],
)
async def test_issue_rejects_redirect_and_invalid_json_object_secret_safely(
    response: httpx.Response,
) -> None:
    transport = httpx.MockTransport(lambda _request: response)
    async with httpx.AsyncClient(transport=transport) as client:
        auth = KiwoomAuth("app-secret", "key-secret", client=client)
        with pytest.raises(KiwoomAuthError) as error:
            await auth.issue_token()
    rendered = str(error.value)
    assert "app-secret" not in rendered
    assert "key-secret" not in rendered
    assert "malformed-secret" not in rendered


@pytest.mark.asyncio
async def test_revoke_calls_upstream_then_clears_memory() -> None:
    expires = datetime.now() + timedelta(hours=1)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/oauth2/token").mock(
            return_value=httpx.Response(
                200,
                json={
                    "return_code": 0,
                    "token": "memory-token",
                    "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
                },
            )
        )
        revoke = mock.post("/oauth2/revoke").mock(
            return_value=httpx.Response(200, json={"return_code": 0})
        )
        auth = KiwoomAuth("app-key", "secret-key")
        manager = TokenManager(auth)
        try:
            await manager.issue()
            status = await manager.revoke()
        finally:
            await auth.aclose()
    assert revoke.call_count == 1
    assert status == {"configured": True, "ready": False, "expires_at": None}
    assert "token" not in status


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "revoke_response",
    [
        httpx.Response(302, json={"return_code": 0}),
        httpx.Response(200, text="malformed-secret"),
        httpx.Response(200, json=[{"return_code": 0}]),
        httpx.Response(200, json={}),
    ],
)
async def test_revoke_rejects_redirect_invalid_body_and_missing_code_then_clears_token(
    revoke_response: httpx.Response,
) -> None:
    expires = datetime.now() + timedelta(hours=1)
    calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(
                200,
                json={
                    "return_code": 0,
                    "token": "memory-token",
                    "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
                },
            )
        return revoke_response

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        auth = KiwoomAuth("app-secret", "key-secret", client=client)
        await auth.issue_token()
        with pytest.raises(KiwoomAuthError) as error:
            await auth.revoke_token()
        assert auth.is_ready is False
        with pytest.raises(KiwoomNotReadyError):
            _ = auth.access_token
    rendered = str(error.value)
    assert "app-secret" not in rendered
    assert "key-secret" not in rendered
    assert "malformed-secret" not in rendered


@pytest.mark.asyncio
async def test_revoke_accepts_string_zero_return_code() -> None:
    expires = datetime.now() + timedelta(hours=1)
    calls = 0

    async def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(
                200,
                json={
                    "return_code": "0",
                    "token": "memory-token",
                    "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
                },
            )
        return httpx.Response(200, json={"return_code": "0000"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        auth = KiwoomAuth("app", "secret", client=client)
        await auth.issue_token()
        await auth.revoke_token()
    assert auth.is_ready is False


@pytest.mark.asyncio
async def test_order_client_is_retry_zero_and_disabled_by_default() -> None:
    expires = datetime.now() + timedelta(hours=1)
    settings = Settings(
        _env_file=None,
        kiwoom_app_key="app-key",
        kiwoom_secret_key="secret-key",
    )
    app = FastAPI()

    async def no_websocket(_url: str):
        raise ConnectionError("offline test")

    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/oauth2/token").mock(
            return_value=httpx.Response(
                200,
                json={
                    "return_code": 0,
                    "token": "memory-token",
                    "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
                },
            )
        )
        async with build_lifespan(settings, ws_connect=no_websocket)(app):
            assert app.state.kiwoom_order_client.configured_max_retry_on_rate_limit == 0
            assert app.state.kiwoom_order_rate_limiter is app.state.kiwoom_rate_limiter
            request = SimpleNamespace(app=app)
            with pytest.raises(KiwoomNotReadyError):
                require_order_kiwoom_client(request)


def test_settings_repr_never_exposes_credentials() -> None:
    settings = Settings(
        _env_file=None,
        kiwoom_app_key="never-show-app-key",
        kiwoom_secret_key="never-show-secret-key",
        local_bearer_token="never-show-local-token",
    )
    rendered = repr(settings)
    assert "never-show-app-key" not in rendered
    assert "never-show-secret-key" not in rendered
    assert "never-show-local-token" not in rendered


@pytest.mark.parametrize("value", ["", "   ", "\t\r\n"])
def test_blank_local_bearer_token_canonicalizes_to_none(value: str) -> None:
    settings = Settings(local_bearer_token=value, _env_file=None)
    assert settings.local_bearer_token is None
