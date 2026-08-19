"""Environment-backed application configuration."""

import hashlib
import json
import re
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

KIWOOM_MOCK_BASE_URL = "https://mockapi.kiwoom.com"
LEGACY_ACCOUNT_ALIAS = "default"
ACCOUNT_ALIAS_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class OrderScope(StrEnum):
    """The three order families Kiwoom's REST surface actually exposes.

    There is no short-sell order operation anywhere in the inventory: credit sell
    (kt10007) accepts only 33:융자 / 99:융자합, i.e. repaying a margin purchase. A
    short-selling account can therefore hold no order scope this API can reach.
    """

    CASH = "cash"
    CREDIT = "credit"
    GOLD = "gold"


class KiwoomAccount(BaseModel):
    """One Kiwoom credential pair.

    Kiwoom's REST protocol carries no account-number field: every request is attributed
    to whichever account issued the bearer token. One account therefore means exactly one
    (app_key, secret_key) pair, and N accounts mean N independent token lifecycles.
    """

    model_config = ConfigDict(frozen=True)

    alias: str
    app_key: SecretStr
    secret_key: SecretStr
    # None means unrestricted. An explicit list is an allowlist, and [] makes the account
    # query-only, which is what a short-selling account needs on this API surface.
    order_scopes: frozenset[OrderScope] | None = None

    @field_validator("alias")
    @classmethod
    def validate_alias(cls, value: str) -> str:
        if not ACCOUNT_ALIAS_PATTERN.fullmatch(value):
            raise ValueError(
                "account alias must be 1-32 chars of [a-z0-9_-] and start with [a-z0-9]"
            )
        return value

    @property
    def credential_fingerprint(self) -> str:
        """Stable identity of the credential pair, not of the caller-chosen alias.

        The pair is what Kiwoom treats as the identity boundary, so ownership locks key
        off this rather than off an alias two operators could pick independently.
        """
        digest = hashlib.sha256()
        digest.update(self.app_key.get_secret_value().encode("utf-8"))
        digest.update(b"\x00")
        digest.update(self.secret_key.get_secret_value().encode("utf-8"))
        return digest.hexdigest()[:16]


class Settings(BaseSettings):
    """Runtime settings with a hard mock-domain safety boundary."""

    model_config = SettingsConfigDict(
        env_prefix="ATHENA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "DAOU Athena API"
    app_version: str = "0.1.0"
    kiwoom_accounts: list[KiwoomAccount] = []
    kiwoom_default_account: str | None = None
    # Single-account shorthand. Synthesized into a one-entry pool aliased "default".
    kiwoom_app_key: SecretStr | None = None
    kiwoom_secret_key: SecretStr | None = None
    kiwoom_base_url: str = KIWOOM_MOCK_BASE_URL
    enable_order_api: bool = False
    local_bearer_token: SecretStr | None = None
    request_timeout_seconds: float = 10.0
    max_rate_limit_retries: int = 1
    # The investment brain (LadybugDB graph projection) is independent of Kiwoom
    # credentials — off by default so the existing test suite and any deployment that
    # never opts in never touches a real database file. See lifespan.py's build_lifespan.
    brain_enabled: bool = False
    brain_db_path: Path = Field(default_factory=lambda: Path.home() / ".athena" / "brain.lbug")
    # Authoritative raw history + durable ingestion job state (ADR §5), kept in a separate
    # sqlite file next to the graph projection — never touched unless brain_enabled=true.
    brain_history_db_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "brain-history.sqlite3"
    )
    # 능동 에이전트 루틴(감시·알림) — 기본 비활성. 켜지 않은 배포·테스트는 루틴
    # 파일을 만들지 않는다. 실행계획 P1 (plan/능동-에이전트-실행계획-2026-08-19.md).
    routines_enabled: bool = False
    routines_poll_interval_seconds: float = 300.0
    routines_store_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "routines.json"
    )
    routines_ledger_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "ledger.jsonl"
    )
    # DART 공시 폴러 키 — 없으면 periodic 공시 루틴만 강등(realtime은 무관).
    dart_api_key: SecretStr | None = None

    @field_validator("local_bearer_token", mode="before")
    @classmethod
    def normalize_local_bearer_token(cls, value: object) -> object:
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if isinstance(raw, str) and not raw.strip():
            return None
        return value

    @field_validator("kiwoom_accounts", mode="before")
    @classmethod
    def parse_kiwoom_accounts(cls, value: object) -> object:
        """Accept the JSON-array form from either an env var or a direct keyword."""
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return []
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("kiwoom_accounts must be a JSON array of account objects") from exc

    @field_validator("kiwoom_default_account", mode="before")
    @classmethod
    def normalize_default_account(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @model_validator(mode="after")
    def resolve_account_pool(self) -> Self:
        legacy_pair = self.kiwoom_app_key is not None and self.kiwoom_secret_key is not None
        if self.kiwoom_accounts and legacy_pair:
            raise ValueError(
                "set either kiwoom_accounts or the kiwoom_app_key/kiwoom_secret_key pair, "
                "not both"
            )
        if not self.kiwoom_accounts and legacy_pair:
            assert self.kiwoom_app_key is not None and self.kiwoom_secret_key is not None
            self.kiwoom_accounts = [
                KiwoomAccount(
                    alias=LEGACY_ACCOUNT_ALIAS,
                    app_key=self.kiwoom_app_key,
                    secret_key=self.kiwoom_secret_key,
                )
            ]

        aliases = [account.alias for account in self.kiwoom_accounts]
        duplicates = sorted({alias for alias in aliases if aliases.count(alias) > 1})
        if duplicates:
            raise ValueError(f"duplicate kiwoom account aliases: {', '.join(duplicates)}")

        if self.kiwoom_default_account is not None:
            if self.kiwoom_default_account not in aliases:
                raise ValueError(
                    f"kiwoom_default_account '{self.kiwoom_default_account}' is not a "
                    "configured account alias"
                )
        elif len(aliases) == 1:
            self.kiwoom_default_account = aliases[0]
        elif len(aliases) > 1:
            # Never guess. Picking "the first one" is how a misconfigured pool silently
            # routes orders to the wrong account.
            raise ValueError(
                "kiwoom_default_account is required when more than one account is configured"
            )
        return self

    @model_validator(mode="after")
    def validate_runtime_safety(self) -> Self:
        if self.kiwoom_base_url.rstrip("/") != KIWOOM_MOCK_BASE_URL:
            raise ValueError("kiwoom_base_url must be the Kiwoom mock domain")
        if self.request_timeout_seconds <= 0:
            raise ValueError("request_timeout_seconds must be positive")
        if not 0 <= self.max_rate_limit_retries <= 5:
            raise ValueError("max_rate_limit_retries must be between 0 and 5")
        return self

    @property
    def has_credentials(self) -> bool:
        return bool(self.kiwoom_accounts)

    @property
    def accounts_by_alias(self) -> dict[str, KiwoomAccount]:
        return {account.alias: account for account in self.kiwoom_accounts}


@lru_cache
def get_settings() -> Settings:
    return Settings()
