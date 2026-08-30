"""Fail-closed capability epoch for long-lived Athena MCP gateways.

Persistent provider generations receive an opaque token plus the expected epoch
revision through their private child environment. The gateway never persists or
logs that token; it hashes it locally and re-reads the app-owned epoch file before
every tool dispatch. Replacing the epoch file therefore revokes an old process
even when the operating system has not finished terminating it yet.

Legacy cold runners intentionally omit every epoch variable. That all-absent
shape keeps the historical gateway behavior. A partially configured environment
is considered enabled-but-invalid and denies every call.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

EPOCH_PATH_ENV = "ATHENA_MCP_SECURITY_EPOCH_PATH"
CAPABILITY_TOKEN_ENV = "ATHENA_MCP_GATEWAY_CAPABILITY_TOKEN"
SECURITY_GENERATION_ENV = "ATHENA_MCP_SECURITY_GENERATION"
EPOCH_REVISION_ENV = "ATHENA_MCP_GATEWAY_EPOCH_REVISION"
_MAX_EPOCH_BYTES = 16 * 1024


def capability_token_hash(token: str) -> str:
    """Return the lowercase SHA-256 digest used in the public epoch document."""

    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class GatewayCapabilityGuard:
    """Validate one provider generation against the current app-owned epoch."""

    enabled: bool = False
    valid_configuration: bool = True
    epoch_path: Path | None = None
    token_hash: str = ""
    security_generation: int = 0
    epoch_revision: int = 0

    @classmethod
    def from_env(
        cls, env: Mapping[str, str] | None = None
    ) -> GatewayCapabilityGuard:
        values = os.environ if env is None else env
        raw_path = values.get(EPOCH_PATH_ENV)
        token = values.get(CAPABILITY_TOKEN_ENV)
        raw_generation = values.get(SECURITY_GENERATION_ENV)
        raw_revision = values.get(EPOCH_REVISION_ENV)
        supplied = (raw_path, token, raw_generation, raw_revision)

        if all(value in (None, "") for value in supplied):
            return cls()
        if any(value in (None, "") for value in supplied):
            return cls(enabled=True, valid_configuration=False)

        try:
            generation = int(str(raw_generation))
            revision = int(str(raw_revision))
        except (TypeError, ValueError):
            return cls(enabled=True, valid_configuration=False)
        if generation < 1 or revision < 1:
            return cls(enabled=True, valid_configuration=False)

        return cls(
            enabled=True,
            valid_configuration=True,
            epoch_path=Path(str(raw_path)),
            token_hash=capability_token_hash(str(token)),
            security_generation=generation,
            epoch_revision=revision,
        )

    def is_current(self) -> bool:
        if not self.enabled:
            return True
        if not self.valid_configuration or self.epoch_path is None:
            return False

        try:
            raw = self.epoch_path.read_bytes()
            if len(raw) > _MAX_EPOCH_BYTES:
                return False
            document = json.loads(raw.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return False

        if not isinstance(document, dict):
            return False
        if document.get("version") != 1:
            return False
        if document.get("securityGeneration") != self.security_generation:
            return False
        if document.get("revision") != self.epoch_revision:
            return False
        stored_hash = document.get("tokenHash")
        if not isinstance(stored_hash, str) or len(stored_hash) != 64:
            return False
        return hmac.compare_digest(stored_hash.lower(), self.token_hash)
