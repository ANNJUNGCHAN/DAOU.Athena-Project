"""Environment-backed application configuration."""

from functools import lru_cache
from typing import Self

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

KIWOOM_MOCK_BASE_URL = "https://mockapi.kiwoom.com"


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
    kiwoom_app_key: SecretStr | None = None
    kiwoom_secret_key: SecretStr | None = None
    kiwoom_base_url: str = KIWOOM_MOCK_BASE_URL
    enable_order_api: bool = False
    local_bearer_token: SecretStr | None = None
    request_timeout_seconds: float = 10.0
    max_rate_limit_retries: int = 1
    max_pages: int = 100

    @field_validator("local_bearer_token", mode="before")
    @classmethod
    def normalize_local_bearer_token(cls, value: object) -> object:
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if isinstance(raw, str) and not raw.strip():
            return None
        return value

    @model_validator(mode="after")
    def validate_runtime_safety(self) -> Self:
        if self.kiwoom_base_url.rstrip("/") != KIWOOM_MOCK_BASE_URL:
            raise ValueError("kiwoom_base_url must be the Kiwoom mock domain")
        if self.request_timeout_seconds <= 0:
            raise ValueError("request_timeout_seconds must be positive")
        if not 0 <= self.max_rate_limit_retries <= 5:
            raise ValueError("max_rate_limit_retries must be between 0 and 5")
        if not 1 <= self.max_pages <= 1000:
            raise ValueError("max_pages must be between 1 and 1000")
        return self

    @property
    def has_credentials(self) -> bool:
        return bool(self.kiwoom_app_key and self.kiwoom_secret_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
