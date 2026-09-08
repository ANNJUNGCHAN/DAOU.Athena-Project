"""Process-local registration of Kiwoom credentials owned by the desktop app."""

from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx
from fastapi import HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictBool, ValidationError

from athena_api.accounts import AccountRuntime
from athena_api.config import KiwoomAccount, OrderScope, Settings
from athena_api.errors import KiwoomAuthError
from athena_api.kiwoom import (
    KiwoomAuth,
    KiwoomClient,
    KiwoomWsClient,
    KiwoomWsError,
    RateLimiter,
    TokenManager,
)
from athena_api.process_lock import CredentialProcessLock


class RuntimeAccountCredentials(BaseModel):
    """Credential pair received from the trusted local desktop process."""

    model_config = ConfigDict(extra="forbid")

    app_key: SecretStr = Field(min_length=1)
    secret_key: SecretStr = Field(min_length=1)
    active: StrictBool
    selection_revision: int = Field(ge=0, strict=True)
    order_api: StrictBool


class RuntimeAccountRemoval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection_revision: int = Field(ge=0, strict=True)


class RuntimeAccountConflict(RuntimeError):
    """An app account id was already bound to a different credential identity."""


@dataclass(frozen=True, slots=True)
class RuntimeAccountResult:
    backend_alias: str
    ready: bool


def backend_alias_for(account_id: UUID) -> str:
    """Derive the stable backend selector from the desktop account UUID."""
    return account_id.hex


def _credential_identity(account: KiwoomAccount) -> str:
    """Full secret-safe digest used before sharing an existing in-memory runtime."""
    digest = hashlib.sha256()
    digest.update(account.app_key.get_secret_value().encode("utf-8"))
    digest.update(b"\x00")
    digest.update(account.secret_key.get_secret_value().encode("utf-8"))
    return digest.hexdigest()


def require_loopback(request: Request) -> None:
    """Keep credential mutation unavailable to non-local HTTP clients."""
    host = request.client.host if request.client is not None else ""
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host.lower() == "localhost"
    if not local:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Runtime account registration is local-only",
        )


async def read_runtime_account_credentials(request: Request) -> RuntimeAccountCredentials:
    """Parse credentials without reflecting invalid secret-bearing input in an error."""
    try:
        payload = await request.json()
        return RuntimeAccountCredentials.model_validate(payload)
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Invalid runtime account credentials",
        ) from exc


async def read_runtime_account_removal(request: Request) -> RuntimeAccountRemoval:
    """Parse a revisioned removal without reflecting the submitted body."""
    try:
        payload = await request.json()
        return RuntimeAccountRemoval.model_validate(payload)
    except (json.JSONDecodeError, ValidationError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Invalid runtime account removal",
        ) from exc


class RuntimeAccountRegistry:
    """Own account runtimes, locks, and their shared HTTP transport for one app lifespan."""

    def __init__(
        self,
        app: Any,
        settings: Settings,
        *,
        ws_connect: Any = None,
        on_ready: Callable[[AccountRuntime], Awaitable[None]] | None = None,
        on_removed: Callable[[str], Awaitable[None]] | None = None,
    ) -> None:
        self.app = app
        self.settings = settings
        self.ws_connect = ws_connect
        self.on_ready = on_ready
        self.on_removed = on_removed
        self.runtimes: dict[str, AccountRuntime] = {}
        self.configured_aliases: set[str] = set()
        self.account_bindings: dict[UUID, str] = {}
        self.fingerprint_aliases: dict[str, str] = {}
        self.runtime_fingerprints: dict[str, str] = {}
        self.runtime_base_scopes: dict[str, frozenset[OrderScope] | None] = {}
        self.binding_order_api: dict[UUID, bool] = {}
        self.binding_revisions: dict[UUID, int] = {}
        self.removal_tombstones: dict[UUID, int] = {}
        self.locks: dict[str, CredentialProcessLock] = {}
        self.latest_selection_revision = -1
        self.selected_account_id: UUID | None = None
        self.http_client: httpx.AsyncClient | None = None
        self._mutation_lock = asyncio.Lock()

    def _client(self) -> httpx.AsyncClient:
        if self.http_client is None or self.http_client.is_closed:
            self.http_client = httpx.AsyncClient()
        return self.http_client

    def _build_runtime(self, account: KiwoomAccount) -> AccountRuntime:
        rate_limiter = RateLimiter(rate_per_second=5.0)
        auth = KiwoomAuth(
            account.app_key.get_secret_value(),
            account.secret_key.get_secret_value(),
            client=self._client(),
        )
        return AccountRuntime(
            alias=account.alias,
            auth=auth,
            token_manager=TokenManager(auth),
            rate_limiter=rate_limiter,
            order_scopes=account.order_scopes,
            data_client=KiwoomClient(
                auth,
                rate_limiter,
                client=self._client(),
                timeout_seconds=self.settings.request_timeout_seconds,
                max_rate_limit_retries=self.settings.max_rate_limit_retries,
            ),
            order_client=KiwoomClient(
                auth,
                rate_limiter,
                client=self._client(),
                timeout_seconds=self.settings.request_timeout_seconds,
                max_rate_limit_retries=0,
            ),
        )

    async def _start_websocket(self, runtime: AccountRuntime) -> None:
        ws_client = KiwoomWsClient(
            lambda: runtime.auth.access_token,
            runtime.rate_limiter,
            connect=self.ws_connect,
            ensure_token=runtime.auth.ensure_token,
        )
        try:
            await ws_client.start()
        except KiwoomWsError:
            await ws_client.close()
        else:
            runtime.ws_client = ws_client

    async def add_configured(self, account: KiwoomAccount) -> AccountRuntime:
        """Open one settings-owned runtime with the historical degraded-auth behavior."""
        identity = _credential_identity(account)
        lock = CredentialProcessLock.for_credentials(
            account.credential_fingerprint, label=account.alias
        )
        lock.acquire()
        self.locks[account.alias] = lock
        runtime = self._build_runtime(account)
        self.runtimes[account.alias] = runtime
        self.configured_aliases.add(account.alias)
        self.fingerprint_aliases[identity] = account.alias
        self.runtime_fingerprints[account.alias] = identity
        self.runtime_base_scopes[account.alias] = account.order_scopes
        try:
            await runtime.token_manager.issue()
        except KiwoomAuthError:
            return runtime
        runtime.ready = True
        await self._start_websocket(runtime)
        return runtime

    async def register(
        self, account_id: UUID, credentials: RuntimeAccountCredentials
    ) -> RuntimeAccountResult:
        """Bind the app account to exactly its submitted credential pair."""
        requested_alias = backend_alias_for(account_id)
        account = KiwoomAccount(
            alias=requested_alias,
            app_key=credentials.app_key,
            secret_key=credentials.secret_key,
            order_scopes=None,
        )
        identity = _credential_identity(account)

        async with self._mutation_lock:
            self._validate_selection(account_id, credentials)
            self._validate_binding_config(account_id, credentials)
            bound_alias = self.account_bindings.get(account_id)
            if bound_alias is not None:
                if self.runtime_fingerprints.get(bound_alias) != identity:
                    raise RuntimeAccountConflict(
                        "app account id is already bound to different credentials"
                    )
                await self._reserve_selection(account_id, credentials)
                runtime = self.runtimes[bound_alias]
                if not runtime.ready:
                    await runtime.token_manager.issue()
                    runtime.ready = True
                    await self._start_websocket(runtime)
                self._apply_binding_config(account_id, bound_alias, credentials)
                await self._apply_selection(account_id, bound_alias, credentials)
                return RuntimeAccountResult(backend_alias=bound_alias, ready=True)

            existing_alias = self.fingerprint_aliases.get(identity)
            if existing_alias is not None:
                await self._reserve_selection(account_id, credentials)
                runtime = self.runtimes[existing_alias]
                if not runtime.ready:
                    await runtime.token_manager.issue()
                    runtime.ready = True
                    await self._start_websocket(runtime)
                self.account_bindings[account_id] = existing_alias
                self._apply_binding_config(account_id, existing_alias, credentials)
                await self._apply_selection(account_id, existing_alias, credentials)
                return RuntimeAccountResult(backend_alias=existing_alias, ready=True)

            if requested_alias in self.runtimes:
                raise RuntimeAccountConflict(
                    "derived backend alias is already bound to different credentials"
                )

            await self._reserve_selection(account_id, credentials)
            lock = CredentialProcessLock.for_credentials(
                account.credential_fingerprint, label=requested_alias
            )
            created_client = self.http_client is None or self.http_client.is_closed
            lock.acquire()
            runtime: AccountRuntime | None = None
            try:
                runtime = self._build_runtime(account)
                await runtime.token_manager.issue()
                runtime.ready = True
                await self._start_websocket(runtime)
            except BaseException:
                if runtime is not None:
                    with suppress(BaseException):
                        await self._close_runtime(runtime)
                lock.release()
                if created_client and not self.runtimes and self.http_client is not None:
                    await self.http_client.aclose()
                    self.http_client = None
                raise

            self.locks[requested_alias] = lock
            self.runtimes[requested_alias] = runtime
            self.fingerprint_aliases[identity] = requested_alias
            self.runtime_fingerprints[requested_alias] = identity
            self.runtime_base_scopes[requested_alias] = None
            self.account_bindings[account_id] = requested_alias
            self._apply_binding_config(account_id, requested_alias, credentials)
            await self._apply_selection(account_id, requested_alias, credentials)
            return RuntimeAccountResult(backend_alias=requested_alias, ready=True)

    def _validate_selection(
        self, account_id: UUID, credentials: RuntimeAccountCredentials
    ) -> None:
        if (
            credentials.active
            and credentials.selection_revision == self.latest_selection_revision
            and self.selected_account_id not in {None, account_id}
        ):
            raise RuntimeAccountConflict(
                "selection revision is already bound to a different app account"
            )

    async def _apply_selection(
        self, account_id: UUID, alias: str, credentials: RuntimeAccountCredentials
    ) -> None:
        if (
            not credentials.active
            or credentials.selection_revision != self.latest_selection_revision
        ):
            return
        if self.selected_account_id != account_id:
            return
        self.app.state.kiwoom_default_account = alias
        if self.on_ready is not None:
            await self.on_ready(self.runtimes[alias])

    async def _reserve_selection(
        self, account_id: UUID, credentials: RuntimeAccountCredentials
    ) -> None:
        if (
            not credentials.active
            or credentials.selection_revision <= self.latest_selection_revision
        ):
            return
        previous_alias = getattr(self.app.state, "kiwoom_default_account", None)
        self.latest_selection_revision = credentials.selection_revision
        self.selected_account_id = account_id
        self.app.state.kiwoom_default_account = None
        if self.on_removed is not None:
            await self.on_removed(previous_alias or "")

    def _validate_binding_config(
        self, account_id: UUID, credentials: RuntimeAccountCredentials
    ) -> None:
        tombstone = self.removal_tombstones.get(account_id)
        if tombstone is not None and credentials.selection_revision <= tombstone:
            raise RuntimeAccountConflict("app account was removed at this revision")
        revision = self.binding_revisions.get(account_id)
        if (
            revision == credentials.selection_revision
            and self.binding_order_api.get(account_id) != credentials.order_api
        ):
            raise RuntimeAccountConflict(
                "configuration revision is already bound to different account settings"
            )

    def _apply_binding_config(
        self, account_id: UUID, alias: str, credentials: RuntimeAccountCredentials
    ) -> None:
        revision = self.binding_revisions.get(account_id, -1)
        if credentials.selection_revision < revision:
            return
        self.binding_revisions[account_id] = credentials.selection_revision
        self.binding_order_api[account_id] = credentials.order_api
        self._apply_order_scope(alias)

    def _apply_order_scope(self, alias: str) -> None:
        runtime = self.runtimes[alias]
        owners = [
            self.binding_order_api[account_id]
            for account_id, bound_alias in self.account_bindings.items()
            if bound_alias == alias
        ]
        base = self.runtime_base_scopes[alias]
        runtime.order_scopes = base if not owners or all(owners) else frozenset()

    async def remove(self, account_id: UUID, selection_revision: int) -> tuple[str | None, bool]:
        """Drop an app binding and its dynamic runtime when no binding still owns it."""
        async with self._mutation_lock:
            binding_revision = self.binding_revisions.get(account_id, -1)
            if selection_revision < binding_revision:
                raise RuntimeAccountConflict(
                    "removal revision is older than the registered account settings"
                )
            self.removal_tombstones[account_id] = max(
                selection_revision, self.removal_tombstones.get(account_id, -1)
            )
            alias = self.account_bindings.pop(account_id, None)
            if alias is None:
                return None, False
            self.binding_order_api.pop(account_id, None)
            self.binding_revisions.pop(account_id, None)
            if self.selected_account_id == account_id:
                self.selected_account_id = None
                if getattr(self.app.state, "kiwoom_default_account", None) == alias:
                    self.app.state.kiwoom_default_account = None
                    if self.on_removed is not None:
                        await self.on_removed(alias)
            if alias in self.configured_aliases or alias in self.account_bindings.values():
                self._apply_order_scope(alias)
                return alias, False

            runtime = self.runtimes.pop(alias)
            fingerprint = self.runtime_fingerprints.pop(alias)
            self.runtime_base_scopes.pop(alias)
            self.fingerprint_aliases.pop(fingerprint, None)
            lock = self.locks.pop(alias)
            try:
                await self._close_runtime(runtime)
            finally:
                lock.release()
            if not self.runtimes and self.http_client is not None:
                await self.http_client.aclose()
                self.http_client = None
            return alias, True

    @staticmethod
    async def _close_runtime(runtime: AccountRuntime) -> None:
        try:
            if runtime.ws_client is not None:
                await runtime.ws_client.close()
                runtime.ws_client = None
        finally:
            runtime.auth.clear()
            runtime.ready = False

    async def close(self) -> None:
        """Symmetrically release every runtime resource acquired in this lifespan."""
        async with self._mutation_lock:
            first_error: BaseException | None = None
            for runtime in tuple(self.runtimes.values()):
                try:
                    await self._close_runtime(runtime)
                except BaseException as exc:
                    if first_error is None:
                        first_error = exc
            self.runtimes.clear()
            self.configured_aliases.clear()
            self.account_bindings.clear()
            self.fingerprint_aliases.clear()
            self.runtime_fingerprints.clear()
            self.runtime_base_scopes.clear()
            self.binding_order_api.clear()
            self.binding_revisions.clear()
            self.removal_tombstones.clear()
            self.selected_account_id = None
            for lock in self.locks.values():
                try:
                    lock.release()
                except BaseException as exc:
                    if first_error is None:
                        first_error = exc
            self.locks.clear()
            if self.http_client is not None and not self.http_client.is_closed:
                try:
                    await self.http_client.aclose()
                except BaseException as exc:
                    if first_error is None:
                        first_error = exc
            self.http_client = None
            if first_error is not None:
                raise first_error
