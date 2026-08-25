
from __future__ import annotations

import io
import json
import logging

import pytest

from athena_api.config import LOG_SUBSYSTEMS, Settings
from athena_api.logging_config import (
    REDACTED,
    SUBSYSTEM_LOGGERS,
    JsonLogFormatter,
    SecretRedactingFilter,
    configure_logging,
)

BEARER = "local-bearer-token-for-tests-0123456789"
APP_KEY = "kiwoom-app-key-abcdefghijklmnop"
SECRET_KEY = "kiwoom-secret-key-qrstuvwxyz0123"


def _settings(**overrides: object) -> Settings:
    # _env_file=None is mandatory in this suite: without it pydantic-settings loads the
    # developer's real backend/.env and the test starts depending on that machine.
    base: dict[str, object] = {"_env_file": None, "local_bearer_token": BEARER}
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def _capture(handler: logging.Handler) -> io.StringIO:
    stream = io.StringIO()
    handler.setStream(stream)  # type: ignore[attr-defined]
    return stream


@pytest.fixture(autouse=True)
def _restore_root_logging():
    root = logging.getLogger()
    before_handlers = list(root.handlers)
    before_level = root.level
    before_subsystem_levels = {
        name: logging.getLogger(name).level for name in SUBSYSTEM_LOGGERS.values()
    }
    yield
    for handler in list(root.handlers):
        if handler not in before_handlers:
            root.removeHandler(handler)
    for handler in before_handlers:
        if handler not in root.handlers:
            root.addHandler(handler)
    root.setLevel(before_level)
    for name, level in before_subsystem_levels.items():
        logging.getLogger(name).setLevel(level)


# --- settings validation ---------------------------------------------------------------


def test_log_defaults_are_text_info_and_no_overrides() -> None:
    settings = _settings()
    assert settings.log_level == "INFO"
    assert settings.log_format == "text"
    assert settings.src_log_levels == {}


def test_log_level_and_format_are_normalized() -> None:
    settings = _settings(log_level="debug", log_format="JSON")
    assert settings.log_level == "DEBUG"
    assert settings.log_format == "json"


@pytest.mark.parametrize(
    ("field", "value"),
    [("log_level", "LOUD"), ("log_format", "xml")],
)
def test_invalid_log_enums_are_rejected(field: str, value: str) -> None:
    with pytest.raises(ValueError):
        _settings(**{field: value})


def test_src_log_levels_accepts_json_string_form() -> None:
    settings = _settings(src_log_levels='{"brain": "debug"}')
    assert settings.src_log_levels == {"brain": "DEBUG"}


def test_unknown_subsystem_is_rejected_rather_than_ignored() -> None:
    """A typo'd key that silently does nothing is worse than a startup failure."""
    with pytest.raises(ValueError, match="unknown log subsystem"):
        _settings(src_log_levels={"brian": "DEBUG"})


def test_invalid_subsystem_level_is_rejected() -> None:
    with pytest.raises(ValueError):
        _settings(src_log_levels={"brain": "CHATTY"})


def test_config_subsystem_keys_match_logging_config_mapping() -> None:
    """config.LOG_SUBSYSTEMS is duplicated to avoid a circular import -- keep them equal."""
    assert LOG_SUBSYSTEMS == frozenset(SUBSYSTEM_LOGGERS)


# --- handler installation ----------------------------------------------------------------


def test_configure_logging_installs_exactly_one_handler_even_when_called_twice() -> None:
    settings = _settings()
    configure_logging(settings)
    configure_logging(settings)
    named = [h for h in logging.getLogger().handlers if getattr(h, "name", None) == "athena-stdout"]
    assert len(named) == 1


def test_global_level_and_subsystem_override_are_applied() -> None:
    configure_logging(_settings(log_level="WARNING", src_log_levels={"brain": "DEBUG"}))
    assert logging.getLogger().level == logging.WARNING
    assert logging.getLogger("athena_api.brain").level == logging.DEBUG


def test_json_format_emits_one_parsable_object_per_line() -> None:
    handler = configure_logging(_settings(log_format="json"))
    stream = _capture(handler)
    logging.getLogger("athena_api.brain").warning("brain chat upsert ok source_id=%s", "chat:1")
    payload = json.loads(stream.getvalue().strip())
    assert payload["level"] == "WARNING"
    assert payload["logger"] == "athena_api.brain"
    assert payload["msg"] == "brain chat upsert ok source_id=chat:1"
    assert "caller" in payload and "ts" in payload


# --- redaction (trap ⑫ / §6) --------------------------------------------------------------


def test_bearer_token_is_redacted_from_interpolated_args() -> None:
    handler = configure_logging(_settings())
    stream = _capture(handler)
    logging.getLogger("athena_api.api").error("upstream rejected token=%s", BEARER)
    output = stream.getvalue()
    assert BEARER not in output
    assert REDACTED in output


def test_bearer_token_is_redacted_from_preformatted_message() -> None:
    """f-string call sites are the realistic leak, so cover them explicitly."""
    handler = configure_logging(_settings())
    stream = _capture(handler)
    logging.getLogger("athena_api.api").error(f"auth header was Bearer {BEARER}")
    assert BEARER not in stream.getvalue()


def test_kiwoom_credentials_are_redacted() -> None:
    handler = configure_logging(
        _settings(kiwoom_app_key=APP_KEY, kiwoom_secret_key=SECRET_KEY)
    )
    stream = _capture(handler)
    logging.getLogger("athena_api.kiwoom").error("creds %s / %s", APP_KEY, SECRET_KEY)
    output = stream.getvalue()
    assert APP_KEY not in output
    assert SECRET_KEY not in output


def test_redaction_leaves_ordinary_messages_untouched() -> None:
    handler = configure_logging(_settings())
    stream = _capture(handler)
    logging.getLogger("athena_api.brain").error("brain reset-and-restart ok deleted_count=%d", 3)
    assert "brain reset-and-restart ok deleted_count=3" in stream.getvalue()
    assert REDACTED not in stream.getvalue()


def test_short_values_are_not_treated_as_secrets() -> None:
    """An 8-char floor keeps a short token from redacting half of every line."""
    filt = SecretRedactingFilter(("ok", "short"))
    assert filt.secret_count == 0


def test_runtime_issued_kiwoom_token_is_redacted_by_shape() -> None:
    """The gap value-matching alone leaves open.

    TokenManager issues the Kiwoom access token after startup and KiwoomAuth renders it as
    "Bearer <token>" (kiwoom/auth.py:84). It is never in Settings, so the exact-value layer
    cannot know it -- only the shape layer catches this one.
    """
    handler = configure_logging(_settings())  # no Kiwoom creds configured at all
    stream = _capture(handler)
    runtime_token = "eyJhbGciOiJIUzI1NiJ9.issued-after-startup.9f3c1a"
    logging.getLogger("athena_api.kiwoom").error("upstream call with Bearer %s", runtime_token)
    output = stream.getvalue()
    assert runtime_token not in output
    assert REDACTED in output


def test_token_shaped_key_values_are_redacted() -> None:
    handler = configure_logging(_settings())
    stream = _capture(handler)
    logging.getLogger("athena_api.kiwoom").error(
        "payload app_key=AKIA-not-a-real-key access_token: tok-9f3c1a2b"
    )
    output = stream.getvalue()
    assert "AKIA-not-a-real-key" not in output
    assert "tok-9f3c1a2b" not in output


def test_shape_redaction_keeps_the_surrounding_line_readable() -> None:
    """Redaction must not blank the whole line -- an unreadable log is its own outage."""
    handler = configure_logging(_settings())
    stream = _capture(handler)
    logging.getLogger("athena_api.kiwoom").error("ka10081 failed with Bearer abc.def.ghi")
    output = stream.getvalue()
    assert "ka10081 failed with" in output
    assert "abc.def.ghi" not in output


def test_json_formatter_output_is_also_redacted() -> None:
    """Redaction is a filter on the handler, so it must apply to both formatters."""
    handler = configure_logging(_settings(log_format="json"))
    stream = _capture(handler)
    logging.getLogger("athena_api.api").error("token=%s", BEARER)
    payload = json.loads(stream.getvalue().strip())
    assert BEARER not in payload["msg"]
    assert REDACTED in payload["msg"]


def test_no_audit_body_settings_exist() -> None:
    """Open WebUI ships AUDIT_LOG_LEVEL=REQUEST_RESPONSE which writes request/response
    bodies to disk unredacted. Trap ⑫ forbids that shape outright, so the settings that
    would enable it must not exist here -- this test is what keeps someone from adding
    them back by copying upstream.
    """
    fields = set(Settings.model_fields)
    assert not {f for f in fields if "audit" in f.lower()}


def test_redaction_survives_a_formatting_error_without_killing_logging() -> None:
    filt = SecretRedactingFilter((BEARER,))
    record = logging.LogRecord(
        name="athena_api.api",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="bad %s %s",
        args=("only-one",),
        exc_info=None,
    )
    assert filt.filter(record) is True


def test_json_formatter_preserves_non_ascii() -> None:
    formatter = JsonLogFormatter()
    record = logging.LogRecord(
        name="athena_api.brain",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="브레인 준비됨",
        args=(),
        exc_info=None,
    )
    assert "브레인 준비됨" in formatter.format(record)
