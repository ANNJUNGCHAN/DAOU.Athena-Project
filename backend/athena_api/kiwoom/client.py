"""Bounded, read-only HTTP client for the Kiwoom mock API."""

from __future__ import annotations

import asyncio
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from athena_api.config import KIWOOM_MOCK_BASE_URL
from athena_api.errors import KiwoomApiError
from athena_api.kiwoom.auth import KiwoomAuth
from athena_api.kiwoom.rate_limiter import RateLimiter
from athena_api.kiwoom.return_codes import normalize_return_code

RATE_LIMIT_RETURN_CODES = frozenset({"5", "1700"})


@dataclass(slots=True)
class RequestOptions:
    cont_yn: str = "N"
    next_key: str | None = None


@dataclass(slots=True)
class ResponseEnvelope:
    body: dict[str, Any]
    cont_yn: str
    next_key: str | None


class KiwoomClient:
    def __init__(
        self,
        auth: KiwoomAuth,
        rate_limiter: RateLimiter,
        *,
        client: httpx.AsyncClient | None = None,
        base_url: str = KIWOOM_MOCK_BASE_URL,
        timeout_seconds: float = 10.0,
        max_rate_limit_retries: int = 1,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        random_value: Callable[[], float] = random.random,
    ) -> None:
        if base_url.rstrip("/") != KIWOOM_MOCK_BASE_URL:
            raise ValueError("KiwoomClient only supports the mock domain")
        if timeout_seconds <= 0 or max_rate_limit_retries < 0:
            raise ValueError("invalid Kiwoom client limits")
        self._auth = auth
        self._rate_limiter = rate_limiter
        self._client = client or httpx.AsyncClient()
        self._owns_client = client is None
        self._timeout = timeout_seconds
        self._max_retries = max_rate_limit_retries
        self._sleep = sleep
        self._random_value = random_value

    @property
    def is_ready(self) -> bool:
        return self._auth.is_ready

    @property
    def configured_max_retry_on_rate_limit(self) -> int:
        return self._max_retries

    def _headers(self, api_id: str, options: RequestOptions) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json;charset=UTF-8",
            "api-id": api_id,
            "authorization": self._auth.authorization,
            "cont-yn": options.cont_yn,
        }
        if options.next_key:
            headers["next-key"] = options.next_key
        return headers

    async def post_with_headers(
        self,
        api_id: str,
        endpoint: str,
        data: dict[str, Any] | None = None,
        options: RequestOptions | None = None,
    ) -> ResponseEnvelope:
        if not endpoint.startswith("/"):
            raise ValueError("endpoint must be an absolute path")
        await self._auth.ensure_token()
        options = options or RequestOptions()
        attempt = 0
        while True:
            await self._rate_limiter.acquire(api_id)
            try:
                response = await self._client.post(
                    f"{KIWOOM_MOCK_BASE_URL}{endpoint}",
                    headers=self._headers(api_id, options),
                    json=data or {},
                    timeout=self._timeout,
                )
            except httpx.HTTPError as exc:
                raise KiwoomApiError(
                    code="transport_error",
                    message="upstream request failed",
                    http_status=502,
                ) from exc
            if response.status_code == 429 and attempt < self._max_retries:
                attempt += 1
                jitter = 0.75 + self._random_value() * 0.5
                await self._sleep(0.2 * (2 ** (attempt - 1)) * jitter)
                continue
            try:
                body = response.json()
            except ValueError as exc:
                if not 200 <= response.status_code < 300:
                    raise KiwoomApiError(
                        code=str(response.status_code),
                        message="upstream request failed",
                        http_status=response.status_code,
                    ) from exc
                raise KiwoomApiError(
                    code="invalid_response",
                    message="upstream response was invalid",
                    http_status=502,
                ) from exc
            if not isinstance(body, dict):
                raise KiwoomApiError(
                    code="invalid_response",
                    message="upstream response was invalid",
                    http_status=502,
                )
            return_code = normalize_return_code(body.get("return_code"))
            is_limited = (
                200 <= response.status_code < 300 and return_code in RATE_LIMIT_RETURN_CODES
            )
            if is_limited and attempt < self._max_retries:
                attempt += 1
                jitter = 0.75 + self._random_value() * 0.5
                await self._sleep(0.2 * (2 ** (attempt - 1)) * jitter)
                continue
            if 200 <= response.status_code < 300 and not body:
                raise KiwoomApiError(
                    code="invalid_response",
                    message="upstream response was invalid",
                    http_status=502,
                )
            if not 200 <= response.status_code < 300 or return_code not in {"", "0"}:
                raise KiwoomApiError(
                    code=return_code or str(response.status_code),
                    message="upstream request failed",
                    http_status=response.status_code,
                )
            return ResponseEnvelope(
                body=body,
                cont_yn=(response.headers.get("cont-yn") or "N").strip() or "N",
                next_key=(response.headers.get("next-key") or "").strip() or None,
            )

    async def post(
        self,
        api_id: str,
        endpoint: str,
        data: dict[str, Any] | None = None,
        options: RequestOptions | None = None,
    ) -> dict[str, Any]:
        return (await self.post_with_headers(api_id, endpoint, data, options)).body

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()
