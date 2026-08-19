"""Process-wide logging setup.

Modelled on how Open WebUI manages logs (`backend/open_webui/env.py`,
`backend/open_webui/utils/logger.py`), adapted to this repository's constraints. What was
taken and what was deliberately left behind:

**Taken**
- One global level plus per-subsystem overrides, both env-driven. Open WebUI's
  ``GLOBAL_LOG_LEVEL`` + (historically) ``SRC_LOG_LEVELS`` maps onto ``ATHENA_LOG_LEVEL``
  + ``ATHENA_SRC_LOG_LEVELS`` here. Note their ``SRC_LOG_LEVELS`` is now an empty
  ``# Legacy variable, do not remove`` dict upstream; the *idea* is still right for us
  because a desktop operator debugging one subsystem should not have to drown in all of
  them, so this module implements it for real rather than copying the deprecated husk.
- A ``LOG_FORMAT=json`` switch emitting one object per line to stdout.
- stdout as the only sink.

**Deliberately not taken**
- **Loguru.** Upstream routes stdlib records through an ``InterceptHandler`` into loguru.
  That is a new runtime dependency for a repo that pins dependencies deliberately, and it
  buys nothing here: our own code holds exactly two ``getLogger`` call sites, and the
  records we actually care about come from uvicorn/FastAPI, which speak stdlib logging
  natively.
- **Body-capturing audit logs.** Upstream's ``AUDIT_LOG_LEVEL=REQUEST_RESPONSE`` writes
  ``request_object`` / ``response_object`` into a rotating ``audit.log`` on disk with no
  redaction whatsoever. Telling here: upstream's own ``AUDIT_EXCLUDED_PATHS`` defaults to
  ``/chats,/chat,/folders`` -- i.e. they exclude the chat surface by default precisely
  because those bodies are sensitive. This repo's CLAUDE.md §1 trap ⑫ ("감사 로그에
  인자·응답 본문을 남기지 마라. 계좌 정보가 흐른다") makes that a hard rule rather than a
  default, so no request/response body ever reaches a log record and there is no audit
  file to leak. The existing audit surface (``athena_mcp/consent.py`` ``AuditLog``) already
  works this way: its ``record()`` signature has no body parameter at all.
- **Disk sinks / rotation.** Single-user local desktop app, not a Docker service. Writing
  logs to disk would create exactly the artifact trap ⑫ warns about, with no operator to
  rotate or scrub it.

``SecretRedactingFilter`` is the belt to the code rule's braces: even if some future call
site interpolates a credential, the value never reaches stdout. It cannot detect chat
bodies (they are arbitrary user text with no stable shape), so bodies stay a code-level
rule enforced by test -- see ``tests/api/test_brain_api.py`` and
``tests/unit/test_logging_config.py``.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

from athena_api.config import Settings

__all__ = [
    "REDACTED",
    "SUBSYSTEM_LOGGERS",
    "JsonLogFormatter",
    "SecretRedactingFilter",
    "configure_logging",
]

REDACTED = "***"

# Subsystem key -> logger name prefix. Keys are what an operator writes in
# ATHENA_SRC_LOG_LEVELS; prefixes are the real package paths (verified against the tree).
SUBSYSTEM_LOGGERS: dict[str, str] = {
    "api": "athena_api.api",
    "brain": "athena_api.brain",
    "kiwoom": "athena_api.kiwoom",
    "selector": "athena_api.selector",
    "mcp": "athena_mcp",
    "uvicorn": "uvicorn",
}

_TEXT_FORMAT = "%(asctime)s %(levelname)-8s %(name)s | %(message)s"

# Set once per process so repeated configure_logging() calls (tests build many apps) do
# not stack duplicate handlers on the root logger.
_HANDLER_NAME = "athena-stdout"


class SecretRedactingFilter(logging.Filter):
    """Replace known credential values anywhere in a record before it is emitted.

    Operates on the *formatted* message and on ``record.args`` so both
    ``logger.info("token=%s", tok)`` and ``logger.info(f"token={tok}")`` are covered.
    Only exact-value matching: this filter knows the secrets this process holds
    (bearer token, Kiwoom app/secret keys) and nothing else. It is not a heuristic
    scrubber and must not be relied on to catch chat bodies -- see module docstring.
    """

    def __init__(self, secrets: tuple[str, ...] = ()) -> None:
        super().__init__()
        # Short values would redact half the log (e.g. a 2-char token matching "ok"), so
        # ignore anything too short to be a real credential.
        self._secrets = tuple(sorted({s for s in secrets if len(s) >= 8}, key=len, reverse=True))

    @property
    def secret_count(self) -> int:
        return len(self._secrets)

    def _scrub(self, text: str) -> str:
        for secret in self._secrets:
            if secret in text:
                text = text.replace(secret, REDACTED)
        return text

    def filter(self, record: logging.LogRecord) -> bool:
        if not self._secrets:
            return True
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - broken %-args should not kill logging
            return True
        if any(secret in message for secret in self._secrets):
            # Collapse to the already-formatted, scrubbed text: args are consumed here so
            # the handler's own formatting cannot re-introduce the raw value.
            record.msg = self._scrub(message)
            record.args = ()
        return True


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line on stdout.

    Mirrors the shape of Open WebUI's ``_json_sink`` (ts / level / msg / caller) so the
    output is familiar to anyone who has operated that stack.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "caller": f"{record.module}:{record.funcName}:{record.lineno}",
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _collect_secrets(settings: Settings) -> tuple[str, ...]:
    secrets: list[str] = []
    if settings.local_bearer_token is not None:
        secrets.append(settings.local_bearer_token.get_secret_value())
    for account in settings.kiwoom_accounts:
        secrets.append(account.app_key.get_secret_value())
        secrets.append(account.secret_key.get_secret_value())
    return tuple(s for s in secrets if s)


def configure_logging(settings: Settings) -> logging.Handler:
    """Install the single stdout handler and apply global + per-subsystem levels.

    Idempotent: a second call replaces the previous handler rather than adding another.
    Returns the installed handler so tests can inspect it.
    """
    root = logging.getLogger()
    for existing in list(root.handlers):
        if getattr(existing, "name", None) == _HANDLER_NAME:
            root.removeHandler(existing)
            existing.close()

    handler = logging.StreamHandler(sys.stdout)
    handler.name = _HANDLER_NAME
    if settings.log_format == "json":
        handler.setFormatter(JsonLogFormatter())
    else:
        handler.setFormatter(logging.Formatter(_TEXT_FORMAT))
    handler.addFilter(SecretRedactingFilter(_collect_secrets(settings)))

    global_level = logging.getLevelNamesMapping()[settings.log_level]
    root.addHandler(handler)
    root.setLevel(global_level)

    # Per-subsystem overrides. Unknown keys are rejected at settings validation time, so
    # anything here is a known prefix.
    for key, level_name in settings.src_log_levels.items():
        logging.getLogger(SUBSYSTEM_LOGGERS[key]).setLevel(
            logging.getLevelNamesMapping()[level_name]
        )
    return handler
