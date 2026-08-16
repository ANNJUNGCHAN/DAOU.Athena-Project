from __future__ import annotations

from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.kiwoom.auth import KST, KiwoomAuth, TokenManager
from athena_api.main import create_app

BEARER = "local-test-bearer"
STATUS_PATH = "/api/v1/internal/oauth/status"


def _client(*, manager: TokenManager | None = None) -> TestClient:
    app = create_app(Settings(_env_file=None, local_bearer_token=BEARER))
    app.state.token_manager = manager
    return TestClient(app)


def _manager_with_token(expires: datetime) -> TokenManager:
    auth = KiwoomAuth("app-key", "secret-key")
    auth._token = "never-show-token"  # noqa: SLF001 - seeding memory-only state
    auth._expires_at = expires  # noqa: SLF001
    return TokenManager(auth)


def test_status_requires_bearer() -> None:
    response = _client().get(STATUS_PATH)
    assert response.status_code == 422


def test_status_rejects_wrong_bearer() -> None:
    response = _client().get(STATUS_PATH, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_status_reports_unconfigured_without_credentials() -> None:
    response = _client().get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
    assert response.status_code == 200
    assert response.json() == {"configured": False, "ready": False, "expires_at": None}


def test_status_reports_ready_with_timezone_aware_expiry() -> None:
    expires = datetime.now(KST) + timedelta(hours=5)
    client = _client(manager=_manager_with_token(expires))
    response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
    body = response.json()
    assert response.status_code == 200
    assert body["configured"] is True
    assert body["ready"] is True
    assert body["expires_at"] == expires.isoformat()
    assert body["expires_at"].endswith("+09:00")


def test_status_reports_not_ready_once_expired() -> None:
    expired = datetime.now(KST) - timedelta(seconds=1)
    client = _client(manager=_manager_with_token(expired))
    body = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"}).json()
    assert body["configured"] is True
    assert body["ready"] is False
    assert body["expires_at"].endswith("+09:00")


def test_status_never_returns_the_token() -> None:
    client = _client(manager=_manager_with_token(datetime.now(KST) + timedelta(hours=1)))
    response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
    assert "never-show-token" not in response.text
    assert set(response.json()) == {"configured", "ready", "expires_at"}


def test_status_is_declared_read_only_and_not_llm_exposed() -> None:
    schema = _client().app.openapi()
    operation = schema["paths"][STATUS_PATH]["get"]
    assert operation["operationId"] == "get_internal_oauth_status"
    assert operation["x-athena-side-effect"] == "none"
    assert operation["x-athena-llm-exposed"] is False
    assert "post" not in schema["paths"][STATUS_PATH]
