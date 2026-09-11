
from __future__ import annotations

import pytest

from athena_mcp.__main__ import build_parser
from athena_mcp.consent import ConsentStore
from athena_mcp.registry import SECRET_SENTINEL, ServerRegistry, UnknownAliasError


def _parse(tmp_path, *cli_args: str):
    parser = build_parser()
    return parser.parse_args(
        [
            "--registry", str(tmp_path / "mcp_servers.json"),
            "--state-dir", str(tmp_path / "state"),
            *cli_args,
        ]
    )


def test_redact_env_replaces_plaintext_with_sentinel(tmp_path):
    registry_path = tmp_path / "mcp_servers.json"
    registry = ServerRegistry(path=registry_path)
    registry.add(
        "dart", command="npx", args=["-y", "korean-dart-mcp"], env={"DART_API_KEY": "실제-키-값"}
    )

    args = _parse(tmp_path, "redact-env", "dart", "DART_API_KEY")
    assert args.func(args) == 0

    reloaded = ServerRegistry(path=registry_path)
    assert reloaded.get("dart").env["DART_API_KEY"] == SECRET_SENTINEL
    assert "실제-키-값" not in registry_path.read_text(encoding="utf-8")


def test_redact_env_multiple_keys_in_one_call(tmp_path):
    registry_path = tmp_path / "mcp_servers.json"
    registry = ServerRegistry(path=registry_path)
    registry.add(
        "multi", command="npx", args=[], env={"KEY_A": "a-값", "KEY_B": "b-값", "KEEP": "안-건드림"}
    )

    args = _parse(tmp_path, "redact-env", "multi", "KEY_A", "KEY_B")
    assert args.func(args) == 0

    reloaded = ServerRegistry(path=registry_path).get("multi")
    assert reloaded.env["KEY_A"] == SECRET_SENTINEL
    assert reloaded.env["KEY_B"] == SECRET_SENTINEL
    assert reloaded.env["KEEP"] == "안-건드림"  # 지정 안 한 키는 손대지 않는다


def test_redact_env_unknown_key_raises(tmp_path):
    registry_path = tmp_path / "mcp_servers.json"
    registry = ServerRegistry(path=registry_path)
    registry.add("dart", command="npx", args=[], env={"DART_API_KEY": "x"})

    args = _parse(tmp_path, "redact-env", "dart", "NOT_A_REAL_KEY")
    with pytest.raises(KeyError):
        args.func(args)


def test_redact_env_unknown_alias_raises(tmp_path):
    ServerRegistry(path=tmp_path / "mcp_servers.json")  # 빈 레지스트리 생성만

    args = _parse(tmp_path, "redact-env", "no-such-alias", "KEY")
    with pytest.raises(UnknownAliasError):
        args.func(args)


def test_redact_env_is_idempotent(tmp_path):
    """이미 센티널인 값에 다시 걸어도 에러 없이 그대로다 — 마이그레이션이
    두 번 돌아도(부팅 시 + mcp-list 시) 안전해야 한다."""
    registry_path = tmp_path / "mcp_servers.json"
    registry = ServerRegistry(path=registry_path)
    registry.add("dart", command="npx", args=[], env={"DART_API_KEY": "x"})

    args1 = _parse(tmp_path, "redact-env", "dart", "DART_API_KEY")
    assert args1.func(args1) == 0
    args2 = _parse(tmp_path, "redact-env", "dart", "DART_API_KEY")
    assert args2.func(args2) == 0  # 두 번째 호출도 정상 — 이미 센티널이어도 거부하지 않는다

    assert ServerRegistry(path=registry_path).get("dart").env["DART_API_KEY"] == SECRET_SENTINEL


def test_update_command_preserves_approval_and_tools_and_updates_metadata(tmp_path):
    registry_path = tmp_path / "mcp_servers.json"
    state_dir = tmp_path / "state"
    registry = ServerRegistry(registry_path)
    registry.add("discord", "npx", ["old"], {"TOKEN": SECRET_SENTINEL})
    consent = ConsentStore(state_dir / "consent.json")
    consent.request_consent("discord", "npx", ["old"], {"TOKEN": SECRET_SENTINEL})
    consent.approve("discord", approved_tools={"list_guilds"})
    snippet = tmp_path / "update.json"
    snippet.write_text(
        '{"mcpServers":{"discord":{"command":"npx","args":["new"],'
        '"env":{"DISCORD_TOKEN":"__ATHENA_SAFESTORAGE__"}}}}',
        encoding="utf-8",
    )

    args = _parse(tmp_path, "update", "discord", "--snippet-file", str(snippet))
    assert args.func(args) == 0

    entry = ServerRegistry(registry_path).get("discord")
    record = ConsentStore(state_dir / "consent.json").get("discord")
    assert entry.args == ["new"]
    assert entry.env == {"DISCORD_TOKEN": SECRET_SENTINEL}
    assert record is not None and record.approved is True
    assert record.approved_tools == {"list_guilds"}
    assert record.full_command_text == "npx new"


def test_update_command_restores_entire_registry_entry_when_consent_write_fails(
    tmp_path, monkeypatch
):
    registry_path = tmp_path / "mcp_servers.json"
    state_dir = tmp_path / "state"
    registry = ServerRegistry(registry_path)
    registry.add("discord", "npx", ["old"], {"TOKEN": SECRET_SENTINEL})
    registry.record_self_reported_info("discord", "discord", "1", "2025-03-26")
    registry.record_encoding_smoke_test("discord", True)
    consent = ConsentStore(state_dir / "consent.json")
    consent.request_consent("discord", "npx", ["old"], {"TOKEN": SECRET_SENTINEL})
    snippet = tmp_path / "update.json"
    snippet.write_text(
        '{"mcpServers":{"discord":{"command":"uvx","args":["new"],"env":{}}}}',
        encoding="utf-8",
    )
    def fail_metadata_write(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(ConsentStore, "refresh_server_metadata", fail_metadata_write)

    args = _parse(tmp_path, "update", "discord", "--snippet-file", str(snippet))
    with pytest.raises(OSError, match="disk full"):
        args.func(args)

    restored = ServerRegistry(registry_path).get("discord")
    assert restored.command == "npx"
    assert restored.args == ["old"]
    assert restored.env == {"TOKEN": SECRET_SENTINEL}
    assert restored.self_reported_server_info is not None
    assert restored.encoding_smoke_test_warning is True


def test_update_command_restores_registry_when_consent_record_is_missing(tmp_path):
    registry_path = tmp_path / "mcp_servers.json"
    registry = ServerRegistry(registry_path)
    registry.add("discord", "npx", ["old"], {"TOKEN": SECRET_SENTINEL})
    registry.record_self_reported_info("discord", "discord", "1", "2025-03-26")
    registry.record_encoding_smoke_test("discord", True)
    before = registry.get("discord")
    snippet = tmp_path / "update.json"
    snippet.write_text(
        '{"mcpServers":{"discord":{"command":"uvx","args":["new"],"env":{}}}}',
        encoding="utf-8",
    )

    args = _parse(tmp_path, "update", "discord", "--snippet-file", str(snippet))
    with pytest.raises(KeyError, match="승인 요청이 먼저 필요하다"):
        args.func(args)

    assert ServerRegistry(registry_path).get("discord") == before
    assert ConsentStore(tmp_path / "state" / "consent.json").get("discord") is None
