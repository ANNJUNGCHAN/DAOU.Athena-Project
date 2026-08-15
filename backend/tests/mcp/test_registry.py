"""registry.py 테스트 — 별칭 64자 상한, serverInfo.name 충돌 분리, 클로드 데스크탑
스니펫 파서, JSON 영속 round-trip."""

from __future__ import annotations

import pytest

from athena_mcp import registry as reg


@pytest.fixture
def store(tmp_path):
    return reg.ServerRegistry(path=tmp_path / "mcp_servers.json")


# ---------------------------------------------------------------------------
# 별칭 검증 — 64자 규칙의 역산
# ---------------------------------------------------------------------------


def test_max_alias_len_leaves_room_for_observed_longest_tool_name():
    # 실측(spike/captures/*tools*.json 전수조사): 최장 툴 이름 34자
    # (naver-search-mcp: datalab_shopping_keyword_by_device)
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
    """spike/mcp-client/RESULT.md L67 실측 재현: 60자 별칭 + 30자 툴명 = 92자,
    64자 규칙 위반. 이 별칭은 등록 단계에서 이미 거부돼야 한다(28자 상한)."""
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
