"""Local app-owned Kiwoom runtime registration and lifecycle."""

import asyncio
from datetime import datetime, timedelta
from uuid import UUID

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.account_sync import RuntimeAccountCredentials
from athena_api.config import Settings
from athena_api.kiwoom import KiwoomWsError
from athena_api.lifespan import build_lifespan
from athena_api.main import create_app

pytestmark = pytest.mark.xdist_group(name="kiwoom-runtime-account-sync")

ACCOUNT_ID = UUID("328d9b2d-1bd1-4eca-b748-34b55fe45f39")
OTHER_ACCOUNT_ID = UUID("8ad516d3-9184-4a2b-bef6-bc3f2189dcc9")
AUTH_HEADERS = {"Authorization": "Bearer local-test"}
CREDS = {
    "app_key": "app-owned-key",
    "secret_key": "app-owned-secret",
    "active": True,
    "selection_revision": 1,
    "order_api": False,
}


def _settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, local_bearer_token="local-test", **overrides)


def _local_client(app: FastAPI) -> TestClient:
    return TestClient(app, client=("127.0.0.1", 50000))


def _token_response() -> httpx.Response:
    expires = datetime.now() + timedelta(hours=1)
    return httpx.Response(
        200,
        json={
            "return_code": 0,
            "token": "runtime-memory-token",
            "expires_dt": expires.strftime("%Y%m%d%H%M%S"),
        },
    )


@pytest.fixture(autouse=True)
def _offline_websocket(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail_start(_self) -> None:
        raise KiwoomWsError("offline test")

    monkeypatch.setattr("athena_api.account_sync.KiwoomWsClient.start", fail_start)


def test_put_requires_local_bearer_without_contacting_kiwoom() -> None:
    app = create_app(_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com", assert_all_called=False) as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        with _local_client(app) as client:
            response = client.put(f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS)
    assert response.status_code == 401
    assert token.call_count == 0


def test_put_rejects_remote_client_without_contacting_kiwoom() -> None:
    app = create_app(_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com", assert_all_called=False) as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        with TestClient(app, client=("203.0.113.7", 50000)) as client:
            response = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
    assert response.status_code == 403
    assert token.call_count == 0


def test_invalid_payload_never_echoes_secret_input() -> None:
    app = create_app(_settings())
    leaked = "must-never-appear-in-response"
    with _local_client(app) as client:
        response = client.put(
            f"/runtime/accounts/{ACCOUNT_ID}",
            json={**CREDS, "unexpected": leaked},
            headers=AUTH_HEADERS,
        )
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid runtime account credentials"}
    assert leaked not in response.text
    assert CREDS["secret_key"] not in response.text


def test_empty_startup_registers_exact_app_account_and_becomes_ready() -> None:
    app = create_app(_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        with _local_client(app) as client:
            before = client.get("/ready")
            response = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            ready = client.get("/ready")
            accounts = client.get("/ready/accounts", headers=AUTH_HEADERS).json()
            identity_task = app.state.instrument_identity_task

    alias = ACCOUNT_ID.hex
    assert before.status_code == 503
    assert response.status_code == 200
    assert response.json() == {"ok": True, "backend_alias": alias, "ready": True}
    assert ready.status_code == 200
    assert accounts["default"] == alias
    assert accounts["accounts"][alias]["ready"] is True
    assert identity_task is not None
    assert token.call_count == 1
    assert app.state.kiwoom_accounts == {}


def test_duplicate_put_is_idempotent_and_changed_credentials_conflict() -> None:
    app = create_app(_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        with _local_client(app) as client:
            first = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            duplicate = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            conflict = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}",
                json={**CREDS, "secret_key": "rotated"},
                headers=AUTH_HEADERS,
            )
    assert first.status_code == duplicate.status_code == 200
    assert first.json()["backend_alias"] == duplicate.json()["backend_alias"]
    assert conflict.status_code == 409
    assert token.call_count == 1


def test_same_credentials_share_runtime_until_last_app_binding_is_deleted() -> None:
    app = create_app(_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        with _local_client(app) as client:
            first = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            ).json()
            second = client.put(
                f"/runtime/accounts/{OTHER_ACCOUNT_ID}",
                json={**CREDS, "active": False},
                headers=AUTH_HEADERS,
            ).json()
            retained = client.request(
                "DELETE",
                f"/runtime/accounts/{ACCOUNT_ID}",
                json={"selection_revision": 2},
                headers=AUTH_HEADERS,
            ).json()
            accounts_after_first = client.get(
                "/ready/accounts", headers=AUTH_HEADERS
            ).json()
            removed = client.request(
                "DELETE",
                f"/runtime/accounts/{OTHER_ACCOUNT_ID}",
                json={"selection_revision": 2},
                headers=AUTH_HEADERS,
            ).json()
            ready_after_last = client.get("/ready")

    assert first["backend_alias"] == second["backend_alias"] == ACCOUNT_ID.hex
    assert retained == {"ok": True, "backend_alias": ACCOUNT_ID.hex, "removed": False}
    assert ACCOUNT_ID.hex in accounts_after_first["accounts"]
    assert removed == {"ok": True, "backend_alias": ACCOUNT_ID.hex, "removed": True}
    assert ready_after_last.status_code == 503
    assert token.call_count == 1


def test_failed_registration_cleans_up_and_does_not_change_default() -> None:
    app = create_app(_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(
            side_effect=[
                httpx.Response(200, json={"return_code": 3, "return_msg": "rejected"}),
                _token_response(),
            ]
        )
        with _local_client(app) as client:
            failed = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            after_failure = client.get("/ready/accounts", headers=AUTH_HEADERS).json()
            retried = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )

    assert failed.status_code == 503
    assert after_failure == {"default": None, "accounts": {}}
    assert retried.status_code == 200
    assert token.call_count == 2


def test_failed_newer_active_selection_clears_old_default_fail_closed() -> None:
    app = create_app(_settings())
    second_creds = {
        **CREDS,
        "app_key": "bad-key",
        "secret_key": "bad-secret",
        "selection_revision": 2,
    }
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(
            side_effect=[
                _token_response(),
                httpx.Response(200, json={"return_code": 3, "return_msg": "rejected"}),
            ]
        )
        with _local_client(app) as client:
            first = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            failed_switch = client.put(
                f"/runtime/accounts/{OTHER_ACCOUNT_ID}",
                json=second_creds,
                headers=AUTH_HEADERS,
            )
            readiness = client.get("/ready/accounts", headers=AUTH_HEADERS).json()
            flat_ready = client.get("/ready")

    assert first.status_code == 200
    assert failed_switch.status_code == 503
    assert readiness["default"] is None
    assert ACCOUNT_ID.hex in readiness["accounts"]
    assert flat_ready.status_code == 503
    assert token.call_count == 2


def test_newer_active_selection_wins_over_late_and_inactive_syncs() -> None:
    app = create_app(_settings())
    second_creds = {**CREDS, "app_key": "second-key", "secret_key": "second-secret"}
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        mock.post("/oauth2/token").mock(return_value=_token_response())
        with _local_client(app) as client:
            first = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            second = client.put(
                f"/runtime/accounts/{OTHER_ACCOUNT_ID}",
                json={**second_creds, "selection_revision": 2},
                headers=AUTH_HEADERS,
            )
            late_first = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            inactive = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}",
                json={**CREDS, "active": False, "selection_revision": 3},
                headers=AUTH_HEADERS,
            )
            readiness = client.get("/ready/accounts", headers=AUTH_HEADERS).json()

    assert first.status_code == second.status_code == late_first.status_code == 200
    assert inactive.status_code == 200
    assert readiness["default"] == OTHER_ACCOUNT_ID.hex


def test_order_flag_is_revisioned_and_cannot_widen_configured_scope() -> None:
    configured = (
        '[{"alias":"configured","app_key":"app-owned-key",'
        '"secret_key":"app-owned-secret","order_scopes":["cash"]}]'
    )
    app = create_app(
        _settings(kiwoom_accounts=configured, kiwoom_default_account="configured")
    )
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        with _local_client(app) as client:
            off = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            assert app.state.kiwoom_accounts["configured"].order_scopes == frozenset()
            on = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}",
                json={**CREDS, "selection_revision": 2, "order_api": True},
                headers=AUTH_HEADERS,
            )
            configured_scopes = app.state.kiwoom_accounts["configured"].order_scopes
            assert {scope.value for scope in configured_scopes} == {"cash"}
            stale_off = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}", json=CREDS, headers=AUTH_HEADERS
            )
            scopes_after_stale = app.state.kiwoom_accounts["configured"].order_scopes

    assert off.status_code == on.status_code == stale_off.status_code == 200
    assert {scope.value for scope in scopes_after_stale} == {"cash"}
    assert token.call_count == 1


def test_delete_tombstone_blocks_delayed_put_and_covers_missing_account() -> None:
    app = create_app(_settings())
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        with _local_client(app) as client:
            tombstone = client.request(
                "DELETE",
                f"/runtime/accounts/{ACCOUNT_ID}",
                json={"selection_revision": 4},
                headers=AUTH_HEADERS,
            )
            delayed = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}",
                json={**CREDS, "selection_revision": 4},
                headers=AUTH_HEADERS,
            )
            newer = client.put(
                f"/runtime/accounts/{ACCOUNT_ID}",
                json={**CREDS, "selection_revision": 5},
                headers=AUTH_HEADERS,
            )

    assert tombstone.json() == {"ok": True, "backend_alias": None, "removed": False}
    assert delayed.status_code == 409
    assert newer.status_code == 200
    assert token.call_count == 1


@pytest.mark.asyncio
async def test_concurrent_duplicate_registration_issues_one_token() -> None:
    app = FastAPI()
    credentials = RuntimeAccountCredentials.model_validate(CREDS)
    with respx.mock(base_url="https://mockapi.kiwoom.com") as mock:
        token = mock.post("/oauth2/token").mock(return_value=_token_response())
        async with build_lifespan(_settings(), ws_connect=None)(app):
            registry = app.state.runtime_account_registry
            first, second = await asyncio.gather(
                registry.register(ACCOUNT_ID, credentials),
                registry.register(ACCOUNT_ID, credentials),
            )
            assert first.backend_alias == second.backend_alias == ACCOUNT_ID.hex
            assert len(app.state.kiwoom_accounts) == 1
    assert token.call_count == 1
