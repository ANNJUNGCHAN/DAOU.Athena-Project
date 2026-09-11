"""registry.py 테스트 — 별칭 64자 상한, serverInfo.name 충돌 분리, 클로드 데스크탑
스니펫 파서, JSON 영속 round-trip."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from athena_mcp import registry as reg


@pytest.fixture
def store(tmp_path):
    return reg.ServerRegistry(path=tmp_path / "mcp_servers.json")


# ---------------------------------------------------------------------------
# 별칭 검증 — 64자 규칙의 역산
# ---------------------------------------------------------------------------


def test_max_alias_len_leaves_room_for_observed_longest_tool_name():
    assert reg.MAX_ALIAS_LEN == 64 - 2 - 34
    alias = "a" * reg.MAX_ALIAS_LEN
    qname = alias + "__" + "datalab_shopping_keyword_by_device"
    assert len(qname) == 64


def test_validate_alias_rejects_too_long():
    too_long = "a" * (reg.MAX_ALIAS_LEN + 1)
    with pytest.raises(reg.AliasValidationError):
        reg.validate_alias(too_long)


def test_validate_alias_rejects_bad_charset():
    with pytest.raises(reg.AliasValidationError):
        reg.validate_alias("has space")
    with pytest.raises(reg.AliasValidationError):
        reg.validate_alias("has.dot")


def test_validate_alias_accepts_valid():
    reg.validate_alias("dart")
    reg.validate_alias("naver-search")
    reg.validate_alias("pykrx_v2")


def test_92_char_violation_reproduced_from_spike_result():
    alias = "user-registered-very-long-server-name-for-korean-market-data"
    assert len(alias) == 60
    with pytest.raises(reg.AliasValidationError):
        reg.validate_alias(alias)


# ---------------------------------------------------------------------------
# CRUD + 영속
# ---------------------------------------------------------------------------


def test_add_get_list_remove_roundtrip(store):
    store.add("dart", command="npx", args=["-y", "korean-dart-mcp"], env={"DART_API_KEY": "x"})
    entry = store.get("dart")
    assert entry.alias == "dart"
    assert entry.command == "npx"
    assert [e.alias for e in store.list()] == ["dart"]

    store.remove("dart")
    with pytest.raises(reg.UnknownAliasError):
        store.get("dart")


def test_add_duplicate_alias_rejected(store):
    store.add("dart", command="npx", args=[])
    with pytest.raises(reg.DuplicateAliasError):
        store.add("dart", command="npx", args=[])


def test_persistence_survives_reload(tmp_path):
    path = tmp_path / "mcp_servers.json"
    store1 = reg.ServerRegistry(path=path)
    store1.add(
        "naver", command="npx", args=["-y", "naver-search-mcp"], env={"NCP_APIGW_API_KEY_ID": "id"}
    )

    store2 = reg.ServerRegistry(path=path)
    entry = store2.get("naver")
    assert entry.command == "npx"
    assert entry.env == {"NCP_APIGW_API_KEY_ID": "id"}


def test_full_command_text_not_truncated(store):
    long_args = ["-y", "korean-dart-mcp", "--flag", "a" * 300]
    entry = store.add("dart", command="npx", args=long_args)
    text = entry.full_command_text()
    assert "a" * 300 in text
    assert text == "npx " + " ".join(long_args)


# ---------------------------------------------------------------------------
# serverInfo.name 충돌 — 별칭이 분리해준다
# ---------------------------------------------------------------------------


def test_serverinfo_name_collision_separated_by_alias(store):
    """실측(§8): pykrx-mcp / @drfirst/korea-stock-mcp / jjlabsio 전부
    serverInfo.name이 `korea-stock-mcp`류로 겹친다. registry는 alias만 키로
    쓰므로 세 서버 모두 등록 가능해야 한다."""
    store.add("pykrx", command="uvx", args=["pykrx-mcp"])
    store.add("drfirst", command="npx", args=["-y", "@drfirst/korea-stock-mcp"])
    store.add("jjlabsio", command="npx", args=["-y", "korea-stock-mcp"])

    # 셋 다 연결 후 같은 serverInfo.name을 보고했다고 시뮬레이션해도 충돌 없음
    store.record_self_reported_info(
        "pykrx", reported_name="korea-stock-mcp", reported_version="1.28.1",
        protocol_version="2025-11-25",
    )
    store.record_self_reported_info(
        "drfirst", reported_name="korea-stock-mcp", reported_version="0.1.0",
        protocol_version="2025-11-25",
    )
    store.record_self_reported_info(
        "jjlabsio", reported_name="korea-stock-mcp", reported_version="1.0.0",
        protocol_version="2025-06-18",
    )

    assert {e.alias for e in store.list()} == {"pykrx", "drfirst", "jjlabsio"}
    assert store.get("pykrx").self_reported_server_info.reported_name == "korea-stock-mcp"
    # self_reported_server_info는 "믿지 말라"는 신호를 필드명으로 담고 있을 뿐
    # 값 자체는 그대로 저장/노출한다 — 그래서 세 서버 모두 같은 문자열을 갖는다.


def test_self_reported_version_not_trusted_field_name_signals_it(store):
    """실측: pykrx-mcp가 자기 버전이 아니라 mcp SDK 버전(1.28.1)을 보고했다.
    registry는 이걸 검증하거나 고치지 않고 self_reported_*로만 저장한다."""
    store.add("pykrx", command="uvx", args=["pykrx-mcp"])
    store.record_self_reported_info(
        "pykrx", reported_name="pykrx-mcp", reported_version="1.28.1",
        protocol_version="2025-11-25",
    )
    info = store.get("pykrx").self_reported_server_info
    assert info.reported_version == "1.28.1"  # 그대로 저장 — 검증하지 않음


def test_identical_self_reported_metadata_reconnect_preserves_revision_and_timestamp(store):
    store.add("dart", command="uvx", args=["dart-mcp"])
    store.record_self_reported_info(
        "dart",
        reported_name="dart-mcp",
        reported_version="1.0.0",
        protocol_version="2025-11-25",
    )
    revision = store.revision
    observed_at = store.get("dart").self_reported_server_info.observed_at

    store.record_self_reported_info(
        "dart",
        reported_name="dart-mcp",
        reported_version="1.0.0",
        protocol_version="2025-11-25",
    )

    assert store.revision == revision
    assert store.get("dart").self_reported_server_info.observed_at == observed_at


def test_changed_self_reported_identity_and_real_config_mutation_still_advance_revision(store):
    store.add("dart", command="uvx", args=["dart-mcp"])
    store.record_self_reported_info(
        "dart",
        reported_name="dart-mcp",
        reported_version="1.0.0",
        protocol_version="2025-11-25",
    )
    before_changed_identity = store.revision

    store.record_self_reported_info(
        "dart",
        reported_name="dart-mcp",
        reported_version="1.1.0",
        protocol_version="2025-11-25",
    )
    assert store.revision == before_changed_identity + 1

    before_config_change = store.revision
    store.add("time", command="uvx", args=["mcp-server-time"])
    assert store.revision == before_config_change + 1


# ---------------------------------------------------------------------------
# 클로드 데스크탑 스니펫 파서
# ---------------------------------------------------------------------------


def test_parse_claude_desktop_snippet_basic():
    snippet = """
    {"mcpServers": {"pykrx": {"command": "uvx", "args": ["pykrx-mcp"], "env": {}}}}
    """
    parsed = reg.parse_claude_desktop_snippet(snippet)
    assert len(parsed) == 1
    assert parsed[0].suggested_alias == "pykrx"
    assert parsed[0].command == "uvx"
    assert parsed[0].args == ["pykrx-mcp"]


def test_parse_claude_desktop_snippet_multiple_servers():
    snippet = """
    {"mcpServers": {
        "dart": {"command": "npx", "args": ["-y", "korean-dart-mcp"], "env": {"DART_API_KEY": "k"}},
        "naver": {"command": "npx", "args": ["-y", "naver-search-mcp"]}
    }}
    """
    parsed = reg.parse_claude_desktop_snippet(snippet)
    aliases = {p.suggested_alias for p in parsed}
    assert aliases == {"dart", "naver"}
    dart = next(p for p in parsed if p.suggested_alias == "dart")
    assert dart.env == {"DART_API_KEY": "k"}


def test_parse_claude_desktop_snippet_missing_top_level_key_rejected():
    with pytest.raises(reg.SnippetParseError):
        reg.parse_claude_desktop_snippet('{"servers": {}}')


def test_parse_claude_desktop_snippet_not_json_rejected():
    with pytest.raises(reg.SnippetParseError):
        reg.parse_claude_desktop_snippet("not json at all")


def test_parse_claude_desktop_snippet_missing_command_rejected():
    with pytest.raises(reg.SnippetParseError):
        reg.parse_claude_desktop_snippet('{"mcpServers": {"x": {"args": []}}}')


def test_parsed_snippet_does_not_auto_register(store):
    """파서는 등록 후보만 만든다 — add()를 명시 호출하지 않으면 registry에
    안 들어간다(자동 승인 구멍을 막기 위한 §5 원칙과 일치)."""
    snippet = '{"mcpServers": {"pykrx": {"command": "uvx", "args": ["pykrx-mcp"]}}}'
    reg.parse_claude_desktop_snippet(snippet)
    assert store.list() == []


def test_rename_keeps_entry_data(store):
    store.add("old-name", command="npx", args=["-y", "x"])
    renamed = store.rename("old-name", "new-name")
    assert renamed.alias == "new-name"
    assert renamed.command == "npx"
    with pytest.raises(reg.UnknownAliasError):
        store.get("old-name")
    assert store.get("new-name").command == "npx"




def test_set_env_sentinel_replaces_value_and_persists(store):
    store.add("dart", command="npx", args=[], env={"DART_API_KEY": "실제-키-값"})
    store.set_env_sentinel("dart", "DART_API_KEY")
    assert store.get("dart").env["DART_API_KEY"] == reg.SECRET_SENTINEL

    reloaded = reg.ServerRegistry(path=store.path)
    assert reloaded.get("dart").env["DART_API_KEY"] == reg.SECRET_SENTINEL
    # 평문이 디스크 어디에도 남지 않는다 — round-trip 후에도 센티널만 있다.
    assert "실제-키-값" not in store.path.read_text(encoding="utf-8")


def test_set_env_sentinel_unknown_key_rejected(store):
    store.add("dart", command="npx", args=[], env={"DART_API_KEY": "x"})
    with pytest.raises(KeyError):
        store.set_env_sentinel("dart", "NOT_A_REAL_KEY")


def test_set_env_sentinel_unknown_alias_rejected(store):
    with pytest.raises(reg.UnknownAliasError):
        store.set_env_sentinel("no-such-alias", "KEY")


def test_resolve_secret_env_passes_through_plaintext_values(monkeypatch):
    """마이그레이션 전(또는 CLI로 직접 등록한) 평문 값은 그대로 통과한다 —
    센티널이 아닌 값을 재해석하지 않는다."""
    env = {"DART_API_KEY": "평문-그대로"}
    resolved = reg.resolve_secret_env("dart", env)
    assert resolved == {"DART_API_KEY": "평문-그대로"}


def test_resolve_secret_env_substitutes_sentinel_from_process_env(monkeypatch):
    monkeypatch.setenv("ATHENA_MCP_ENV__dart__DART_API_KEY", "복호화된-실값")
    env = {"DART_API_KEY": reg.SECRET_SENTINEL, "OTHER": "안-건드림"}
    resolved = reg.resolve_secret_env("dart", env)
    assert resolved == {"DART_API_KEY": "복호화된-실값", "OTHER": "안-건드림"}


def test_resolve_secret_env_missing_injection_fails_closed(monkeypatch):
    monkeypatch.delenv("ATHENA_MCP_ENV__dart__DART_API_KEY", raising=False)
    env = {"DART_API_KEY": reg.SECRET_SENTINEL}
    with pytest.raises(reg.MissingSecretEnvError):
        reg.resolve_secret_env("dart", env)


def test_resolve_secret_env_does_not_mutate_original_dict(monkeypatch):
    monkeypatch.setenv("ATHENA_MCP_ENV__dart__DART_API_KEY", "x")
    env = {"DART_API_KEY": reg.SECRET_SENTINEL}
    reg.resolve_secret_env("dart", env)
    assert env["DART_API_KEY"] == reg.SECRET_SENTINEL  # 원본은 그대로


def test_revision_is_monotonic_and_reload_observes_external_mutation(tmp_path):
    path = tmp_path / "mcp_servers.json"
    first = reg.ServerRegistry(path)
    second = reg.ServerRegistry(path)
    first.add("one", "npx")
    assert first.revision == 1
    second.add("two", "uvx")
    assert second.revision == 2

    snapshot = first.reload()
    assert snapshot.revision == 2
    assert {entry["alias"] for entry in snapshot.servers} == {"one", "two"}


def test_concurrent_registry_mutations_do_not_lose_updates(tmp_path):
    path = tmp_path / "mcp_servers.json"
    stores = [reg.ServerRegistry(path), reg.ServerRegistry(path)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(stores[0].add, "one", "npx"),
            pool.submit(stores[1].add, "two", "uvx"),
        ]
        for future in futures:
            future.result()

    reloaded = reg.ServerRegistry(path)
    assert reloaded.revision == 2
    assert {entry.alias for entry in reloaded.list()} == {"one", "two"}


def test_failed_atomic_registry_write_preserves_disk_and_memory(tmp_path, monkeypatch):
    path = tmp_path / "mcp_servers.json"
    store = reg.ServerRegistry(path)
    store.add("one", "npx")
    before = path.read_bytes()
    before_snapshot = store.snapshot()

    def fail_write(_path, _payload):
        raise OSError("simulated write failure")

    monkeypatch.setattr(reg, "atomic_write_json", fail_write)
    with pytest.raises(OSError, match="simulated"):
        store.add("two", "uvx")

    assert path.read_bytes() == before
    assert store.snapshot() == before_snapshot
    assert not list(tmp_path.glob("*.tmp"))


def test_registry_fingerprint_is_canonical_and_order_independent(tmp_path):
    first_path = tmp_path / "first.json"
    second_path = tmp_path / "second.json"
    created_at = "2026-08-31T00:00:00+00:00"
    one = {
        "servers": {
            "alpha": {
                "alias": "alpha", "command": "npx", "args": ["a"],
                "env": {"B": "2", "A": "1"}, "created_at": created_at,
            },
            "beta": {
                "alias": "beta", "command": "uvx", "args": [],
                "env": {}, "created_at": created_at,
            },
        }
    }
    two = {
        "servers": {
            "beta": {
                "created_at": created_at, "env": {}, "args": [],
                "command": "uvx", "alias": "beta",
            },
            "alpha": {
                "created_at": created_at, "env": {"A": "1", "B": "2"},
                "args": ["a"], "command": "npx", "alias": "alpha",
            },
        }
    }
    first_path.write_text(json.dumps(one), encoding="utf-8")
    second_path.write_text(json.dumps(two), encoding="utf-8")
    assert reg.ServerRegistry(first_path).fingerprint == reg.ServerRegistry(second_path).fingerprint


def test_registry_snapshot_redacts_plaintext_env_and_preserves_sentinel_metadata(tmp_path):
    store = reg.ServerRegistry(tmp_path / "registry.json")
    store.add(
        "dart",
        "npx",
        env={"PLAIN": "do-not-serialize", "SAFE": reg.SECRET_SENTINEL},
    )
    snapshot = store.snapshot()
    raw = repr(snapshot)
    assert "do-not-serialize" not in raw
    assert snapshot.servers[0]["env"] == {
        "PLAIN": "__ATHENA_REDACTED__",
        "SAFE": reg.SECRET_SENTINEL,
    }


def test_update_replaces_config_in_place_and_clears_probe_metadata(store):
    entry = store.add("discord", "npx", ["old"], {"TOKEN": reg.SECRET_SENTINEL})
    store.record_self_reported_info("discord", "reported", "1", "2025-03-26")
    store.record_encoding_smoke_test("discord", True)

    updated = store.update("discord", "uvx", ["new"], {"AUTH": reg.SECRET_SENTINEL})

    assert updated.alias == "discord"
    assert updated.created_at == entry.created_at
    assert updated.command == "uvx"
    assert updated.args == ["new"]
    assert updated.env == {"AUTH": reg.SECRET_SENTINEL}
    assert updated.self_reported_server_info is None
    assert updated.encoding_smoke_test_warning is False


def test_parse_update_snippet_requires_exact_existing_alias_shape():
    parsed = reg.parse_update_snippet(
        json.dumps({"mcpServers": {"discord": {"command": "npx", "args": ["pkg"], "env": {}}}}),
        "discord",
    )
    assert parsed.suggested_alias == "discord"
    with pytest.raises(reg.SnippetParseError):
        reg.parse_update_snippet(
            json.dumps({"mcpServers": {"renamed": {"command": "npx"}}}),
            "discord",
        )
