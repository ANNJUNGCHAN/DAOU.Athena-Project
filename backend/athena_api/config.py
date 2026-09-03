"""Environment-backed application configuration."""

import hashlib
import json
import re
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

KIWOOM_MOCK_BASE_URL = "https://mockapi.kiwoom.com"
LEGACY_ACCOUNT_ALIAS = "default"
ACCOUNT_ALIAS_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# 로그 서브시스템 키. 실제 로거 이름 매핑은 logging_config.SUBSYSTEM_LOGGERS에 있다 —
# 여기 두는 이유는 설정 검증이 logging_config를 import하면 순환이 되기 때문이다.
# 두 곳이 어긋나지 않는 것은 test_logging_config.py가 강제한다.
LOG_SUBSYSTEMS = frozenset({"api", "brain", "kiwoom", "selector", "mcp", "uvicorn"})
_LOG_LEVEL_NAMES = frozenset({"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"})


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
    # 투자의 뇌는 키움 자격증명과 무관하다 — 기본 off라서 옵트인하지 않은 배포와 기존
    # 테스트는 실제 DB 파일을 건드리지 않는다. lifespan.py의 build_lifespan 참고.
    brain_enabled: bool = False
    # 그래프 투영 + 원본 이력 + 잡 상태가 **한 파일**에 있다. 이전에는 `brain.lbug`와
    # `brain-history.sqlite3` 둘이었고, 적재 1회가 커밋 2개라 그 사이에서 죽으면
    # "커서는 전진했는데 그래프엔 안 들어간" 상태가 남았다(leaf 2에서 통합).
    # 확장자도 바로잡았다: `.lbug`는 LadybugDB 시절 이름인데 내용은 이미 SQLite였다.
    brain_db_path: Path = Field(default_factory=lambda: Path.home() / ".athena" / "brain.sqlite3")
    routines_enabled: bool = False
    routines_schedule_poll_interval_seconds: float = 20.0
    routines_store_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "routines.json"
    )
    routines_ledger_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "ledger.jsonl"
    )
    routines_read_marks_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "read_marks.json"
    )
    # UI 텔레메트리(F2-스트레치) — ledger.jsonl과 별개 파일, ledger는 무수정(P4).
    routines_engagement_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "engagement.jsonl"
    )
    # 브리핑 본문 스토어(R1) — engagement와 분리 소유(P4), briefings.py 참고.
    routines_briefings_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "briefings.jsonl"
    )
    routines_briefing_content_max_chars: int = 4000
    # ledger·engagement·briefings 90일 롤오버 보관 디렉터리 — 삭제 없음(archive.py).
    routines_ledger_archive_dir: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "archive"
    )
    routines_ledger_archive_cutoff_days: int = 90
    # 라우틴별이 아닌 전역 설정 — routines_enabled와 무관하게 항상 로드된다.
    nudge_guard_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "routines" / "nudge_guard.json"
    )
    # 백테스트도 브레인과 같은 이유로 기본 off다(brain_enabled 주석 참고) — 옵트인하지
    # 않은 배포와 기존 테스트는 캔들 캐시 파일을 건드리지 않는다. 파일은 브레인과
    # 분리한다 — brain의 reset-and-restart가 캔들 캐시까지 날리면 안 된다(§5.3).
    backtest_enabled: bool = False
    backtest_db_path: Path = Field(
        default_factory=lambda: Path.home() / ".athena" / "backtest.sqlite3"
    )
    # 프로젝트 = 내 컴퓨터의 폴더 하나(코드 탭 IDE 계약 D1). 관리형 프로젝트가 이 아래
    # 만들어지고, 사용자가 디스크 아무 데나 열어둔 외부 폴더는 경로만 등록된다. import
    # 시점에 만들지 않는다 — 처음 프로젝트를 만들거나 열 때 생긴다(projects/store.py).
    projects_root: Path = Field(default_factory=lambda: Path.home() / ".athena" / "projects")
    # Explicit argv for the local structured-extraction command (e.g. a local claude CLI
    # invocation). Empty delegates to the explicit Claude opt-in below; with both unset,
    # IngestionCoordinator still projects raw SourceRecords but derives no graph facts.
    # Custom argv has highest priority. The Claude CLI path below is a separate explicit
    # opt-in; neither setting causes implicit executable discovery or probing by default.
    brain_extraction_llm_argv: list[str] = []
    brain_use_claude_cli_extraction: bool = False
    # Hourly self-enqueue period for IngestionCoordinator (ADR §9 gate G005). Manual runs
    # still go through the existing enqueue(JobTrigger.MANUAL) path unaffected by this.
    brain_ingest_interval_minutes: int = 60
    # Exactly one process owns the periodic ingestion schedule. Standalone backend
    # deployments keep the historical self-timer; Electron-spawned backends explicitly
    # delegate the one-hour cadence to the app process.
    brain_ingest_schedule_owner: Literal["backend", "external"] = "backend"

    @field_validator("brain_extraction_llm_argv", mode="before")
    @classmethod
    def parse_brain_extraction_llm_argv(cls, value: object) -> object:
        """Accept the JSON-array form from either an env var or a direct keyword."""
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return []
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "brain_extraction_llm_argv must be a JSON array of strings"
            ) from exc

    @field_validator("brain_ingest_interval_minutes")
    @classmethod
    def validate_brain_ingest_interval_minutes(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("brain_ingest_interval_minutes must be positive")
        return value

    log_level: str = "INFO"
    log_format: str = "text"
    # 서브시스템별 레벨 오버라이드. JSON 객체 문자열 또는 dict.
    # 예: ATHENA_SRC_LOG_LEVELS='{"brain":"DEBUG"}'
    src_log_levels: dict[str, str] = {}

    @field_validator("log_level", "log_format", mode="before")
    @classmethod
    def normalize_log_enum(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        level = value.upper()
        if level not in _LOG_LEVEL_NAMES:
            raise ValueError(f"log_level must be one of {sorted(_LOG_LEVEL_NAMES)}")
        return level

    @field_validator("log_format")
    @classmethod
    def validate_log_format(cls, value: str) -> str:
        fmt = value.lower()
        if fmt not in {"text", "json"}:
            raise ValueError("log_format must be 'text' or 'json'")
        return fmt

    @field_validator("src_log_levels", mode="before")
    @classmethod
    def parse_src_log_levels(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return {}
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "src_log_levels must be a JSON object of subsystem -> level"
            ) from exc

    @field_validator("src_log_levels")
    @classmethod
    def validate_src_log_levels(cls, value: dict[str, str]) -> dict[str, str]:
        # Unknown keys are rejected rather than ignored: a typo'd subsystem that silently
        # does nothing is how "why is my debug logging not working" afternoons happen.
        normalized: dict[str, str] = {}
        for key, level in value.items():
            if key not in LOG_SUBSYSTEMS:
                raise ValueError(
                    f"unknown log subsystem '{key}'; known: {sorted(LOG_SUBSYSTEMS)}"
                )
            upper = str(level).upper()
            if upper not in _LOG_LEVEL_NAMES:
                raise ValueError(f"log level for '{key}' must be one of {sorted(_LOG_LEVEL_NAMES)}")
            normalized[key] = upper
        return normalized

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
