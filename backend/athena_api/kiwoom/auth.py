"""Memory-only Kiwoom OAuth token handling."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from athena_api.config import KIWOOM_MOCK_BASE_URL
from athena_api.errors import KiwoomAuthError, KiwoomNotReadyError
from athena_api.kiwoom.return_codes import normalize_return_code

TOKEN_ENDPOINT = "/oauth2/token"
TOKEN_API_ID = "au10001"
REVOKE_ENDPOINT = "/oauth2/revoke"
REVOKE_API_ID = "au10002"

# Kiwoom reports expiry as a bare local wall clock (``expires_dt``) with no zone.
# It is Korea time, which has no DST, so a fixed offset is exact and avoids a
# tzdata dependency. Attaching it here is what lets a renderer subtract the
# expiry from its own clock without guessing whether the value was UTC.
KST = timezone(timedelta(hours=9))


def parse_kiwoom_datetime(value: str) -> datetime:
    """Parse Kiwoom's zone-less timestamp into an aware KST datetime."""
    return datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=KST)


def as_kst(value: datetime) -> datetime:
    """Interpret a zone-less expiry as KST.

    A naive expiry is never UTC here - it is the wall clock Kiwoom reported. The
    whole point of carrying the zone is that nobody downstream has to guess, so
    normalize on the way out rather than letting a naive value escape.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=KST)


def _json_object(
    response: httpx.Response, *, require_return_code: bool = False
) -> dict[str, Any]:
    if not 200 <= response.status_code < 300:
        raise ValueError("upstream response status was not successful")
    body = response.json()
    if not isinstance(body, dict):
        raise ValueError("upstream response was not a JSON object")
    if require_return_code and "return_code" not in body:
        raise ValueError("upstream response omitted return_code")
    return body


class KiwoomAuth:
    """Issue and retain a Kiwoom mock access token only in this process."""

    def __init__(
        self,
        app_key: str,
        secret_key: str,
        *,
        client: httpx.AsyncClient | None = None,
        base_url: str = KIWOOM_MOCK_BASE_URL,
    ) -> None:
        if base_url.rstrip("/") != KIWOOM_MOCK_BASE_URL:
            raise ValueError("KiwoomAuth only supports the mock domain")
        self._app_key = app_key
        self._secret_key = secret_key
        self._client = client or httpx.AsyncClient()
        self._owns_client = client is None
        self._token: str | None = None
        self._expires_at: datetime | None = None
        self._issue_lock = asyncio.Lock()

    @property
    def access_token(self) -> str:
        if not self._token:
            raise KiwoomNotReadyError("Kiwoom access token is unavailable")
        return self._token

    @property
    def authorization(self) -> str:
        return f"Bearer {self.access_token}"

    @property
    def expires_at(self) -> datetime | None:
        return as_kst(self._expires_at) if self._expires_at else None

    @property
    def is_ready(self) -> bool:
        expires_at = self.expires_at
        return bool(self._token and expires_at and expires_at > datetime.now(KST))

    async def issue_token(self) -> None:
        async with self._issue_lock:
            await self._issue_token_unlocked()

    async def ensure_token(self) -> None:
        if self.is_ready:
            return
        async with self._issue_lock:
            if not self.is_ready:
                await self._issue_token_unlocked()

    async def _issue_token_unlocked(self) -> None:
        try:
            response = await self._client.post(
                f"{KIWOOM_MOCK_BASE_URL}{TOKEN_ENDPOINT}",
                headers={
                    "Content-Type": "application/json;charset=UTF-8",
                    "api-id": TOKEN_API_ID,
                },
                json={
                    "grant_type": "client_credentials",
                    "appkey": self._app_key,
                    "secretkey": self._secret_key,
                },
            )
            body = _json_object(response)
        except (httpx.HTTPError, ValueError) as exc:
            raise KiwoomAuthError("Kiwoom token issuance failed") from exc

        return_code = normalize_return_code(body.get("return_code"))
        if return_code not in {"", "0"}:
            raise KiwoomAuthError("Kiwoom token issuance was rejected")
        try:
            token = body["token"]
            expires_at = parse_kiwoom_datetime(str(body["expires_dt"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise KiwoomAuthError("Kiwoom token response was invalid") from exc
        if not isinstance(token, str) or not token:
            raise KiwoomAuthError("Kiwoom token response was invalid")
        self._token = token
        self._expires_at = expires_at

    async def revoke_token(self) -> None:
        if not self._token:
            return
        try:
            response = await self._client.post(
                f"{KIWOOM_MOCK_BASE_URL}{REVOKE_ENDPOINT}",
                headers={
                    "Content-Type": "application/json;charset=UTF-8",
                    "api-id": REVOKE_API_ID,
                    "authorization": self.authorization,
                },
                json={
                    "appkey": self._app_key,
                    "secretkey": self._secret_key,
                    "token": self._token,
                },
            )
            body = _json_object(response, require_return_code=True)
            return_code = normalize_return_code(body["return_code"])
            if return_code != "0":
                raise KiwoomAuthError("Kiwoom token revocation was rejected")
        except (httpx.HTTPError, ValueError) as exc:
            raise KiwoomAuthError("Kiwoom token revocation failed") from exc
        finally:
            self.clear()

    def clear(self) -> None:
        self._token = None
        self._expires_at = None

    async def aclose(self) -> None:
        self.clear()
        if self._owns_client:
            await self._client.aclose()


class TokenManager:
    """Safe operations and status for the process-local Kiwoom token."""

    def __init__(self, auth: KiwoomAuth) -> None:
        self._auth = auth

    async def issue(self) -> dict[str, str | bool | None]:
        await self._auth.issue_token()
        return self.status()

    async def revoke(self) -> dict[str, str | bool | None]:
        await self._auth.revoke_token()
        return self.status()

    def status(self) -> dict[str, str | bool | None]:
        expires_at = self._auth.expires_at
        return {
            "configured": True,
            "ready": self._auth.is_ready,
            "expires_at": expires_at.isoformat() if expires_at else None,
        }
