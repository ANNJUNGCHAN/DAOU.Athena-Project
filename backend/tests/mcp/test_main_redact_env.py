
from __future__ import annotations

import pytest

from athena_mcp.__main__ import build_parser
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
