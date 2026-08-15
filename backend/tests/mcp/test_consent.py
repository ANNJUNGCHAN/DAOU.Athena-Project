"""consent.py 테스트 — 미승인 서버는 spawn 금지, 미승인 툴은 집계 제외,
위험 패턴 경고, 감사 로그에 인자/응답 본문이 안 남는지."""

from __future__ import annotations

import pytest

from athena_mcp import consent


@pytest.fixture
def store(tmp_path):
    return consent.ConsentStore(path=tmp_path / "consent.json")


# ---------------------------------------------------------------------------
# 위험 패턴 경고
# ---------------------------------------------------------------------------


def test_scan_risk_patterns_detects_rm_rf():
    warnings = consent.scan_risk_patterns("bash", ["-c", "rm -rf /"], {})
    assert any("rm -rf" in w or "재귀삭제" in w for w in warnings)


def test_scan_risk_patterns_detects_sudo():
    warnings = consent.scan_risk_patterns("sudo", ["npx", "-y", "x"], {})
    assert any("sudo" in w for w in warnings)


def test_scan_risk_patterns_detects_ssh_access():
    warnings = consent.scan_risk_patterns("cat", ["~/.ssh/id_rsa"], {})
    assert any("SSH" in w or "홈" in w for w in warnings)


def test_scan_risk_patterns_detects_network_command():
    warnings = consent.scan_risk_patterns("curl", ["http://evil.example.com"], {})
    assert any("네트워크" in w for w in warnings)


def test_scan_risk_patterns_clean_npx_command_has_no_warnings():
    warnings = consent.scan_risk_patterns(
        "npx", ["-y", "korean-dart-mcp"], {"DART_API_KEY": "secret"}
    )
    assert warnings == []


def test_scan_risk_patterns_does_not_scan_env_values():
    """env 값(비밀값 포함)은 스캔하지 않는다 — 우연히 위험 패턴과 매치돼도
    UI에 그 값이 인용될 일이 없어야 한다."""
    warnings = consent.scan_risk_patterns("npx", ["-y", "x"], {"NOTE": "curl -X POST rm -rf /tmp"})
    assert warnings == []


def test_scan_risk_patterns_detects_dangerous_env_key():
    """W1 보안 리뷰(SECURITY.md §2): `command`/`args`만 봐서는 무해해 보여도
    `NODE_OPTIONS` 같은 env 키는 인터프리터가 암묵적으로 코드를 로드하는
    경로다 — command/args 전문에는 이 경로가 전혀 안 나타난다는 게 핵심이라
    "node"/"server.js" 자체는 위험 패턴에 안 걸리는 값으로 고정한다."""
    warnings = consent.scan_risk_patterns(
        "node", ["server.js"], {"NODE_OPTIONS": "--require /tmp/evil.js"}
    )
    assert any("환경변수" in w and "NODE_OPTIONS" in w for w in warnings)


def test_scan_risk_patterns_dangerous_env_key_does_not_leak_value():
    """위험 env 키를 탐지하되, 그 값이나 무관한 다른(비위험) env 키의 값은
    경고 문자열에 노출하지 않는다."""
    warnings = consent.scan_risk_patterns(
        "node",
        ["server.js"],
        {"NODE_OPTIONS": "--require /tmp/evil.js", "API_KEY": "sk-should-not-leak"},
    )
    joined = " ".join(warnings)
    assert "/tmp/evil.js" not in joined
    assert "sk-should-not-leak" not in joined
    assert "API_KEY" not in joined


# ---------------------------------------------------------------------------
# 승인 게이트 — spawn 금지
# ---------------------------------------------------------------------------


def test_unapproved_server_blocks_spawn(store):
    store.request_consent("dart", "npx", ["-y", "korean-dart-mcp"], {"DART_API_KEY": "k"})
    with pytest.raises(consent.ConsentNotGrantedError):
        store.require_server_approved("dart")


def test_never_requested_server_also_blocks_spawn(store):
    with pytest.raises(consent.ConsentNotGrantedError):
        store.require_server_approved("never-registered")


def test_approved_server_passes_require_check(store):
    store.request_consent("dart", "npx", ["-y", "korean-dart-mcp"], {})
    store.approve("dart")
    store.require_server_approved("dart")  # raise 안 하면 통과


def test_full_command_text_exposed_uncut(store):
    long_args = ["-y", "x", "b" * 500]
    record = store.request_consent("dart", "npx", long_args, {})
    assert "b" * 500 in record.full_command_text


def test_revoke_blocks_spawn_again(store):
    store.request_consent("dart", "npx", ["-y", "x"], {})
    store.approve("dart")
    store.revoke("dart")
    with pytest.raises(consent.ConsentNotGrantedError):
        store.require_server_approved("dart")


# ---------------------------------------------------------------------------
# 툴별 allowlist — 미승인 툴이 집계 목록에서 빠지는지
# ---------------------------------------------------------------------------


def test_unapproved_tool_not_allowed_even_if_server_approved(store):
    store.request_consent("dart", "npx", ["-y", "x"], {})
    store.approve("dart")  # 서버는 승인했지만 툴은 하나도 allow 안 함
    assert store.is_tool_allowed("dart", "search_disclosure") is False


def test_allowed_tool_after_explicit_allow_tool_call(store):
    store.request_consent("dart", "npx", ["-y", "x"], {})
    store.approve("dart")
    store.allow_tool("dart", "search_disclosure")
    assert store.is_tool_allowed("dart", "search_disclosure") is True
    assert store.is_tool_allowed("dart", "download_document") is False


def test_allow_tool_before_server_approval_rejected(store):
    store.request_consent("dart", "npx", ["-y", "x"], {})
    with pytest.raises(consent.ConsentNotGrantedError):
        store.allow_tool("dart", "search_disclosure")


def test_approve_can_seed_approved_tools_directly(store):
    store.request_consent("dart", "npx", ["-y", "x"], {})
    store.approve("dart", approved_tools={"search_disclosure", "get_corp_code"})
    assert store.is_tool_allowed("dart", "search_disclosure") is True
    assert store.is_tool_allowed("dart", "get_corp_code") is True
    assert store.is_tool_allowed("dart", "download_document") is False


def test_disallow_tool_removes_it(store):
    store.request_consent("dart", "npx", ["-y", "x"], {})
    store.approve("dart", approved_tools={"search_disclosure"})
    store.disallow_tool("dart", "search_disclosure")
    assert store.is_tool_allowed("dart", "search_disclosure") is False


def test_consent_persists_across_reload(tmp_path):
    path = tmp_path / "consent.json"
    store1 = consent.ConsentStore(path=path)
    store1.request_consent("dart", "npx", ["-y", "x"], {})
    store1.approve("dart", approved_tools={"search_disclosure"})

    store2 = consent.ConsentStore(path=path)
    assert store2.is_server_approved("dart") is True
    assert store2.is_tool_allowed("dart", "search_disclosure") is True


# ---------------------------------------------------------------------------
# 감사 로그 — 인자/응답 본문 미포함
# ---------------------------------------------------------------------------


def test_audit_log_records_only_ts_alias_tool_success(tmp_path):
    log = consent.AuditLog(tmp_path / "dart.jsonl")
    log.record("dart", "search_disclosure", success=True)
    log.record("dart", "search_disclosure", success=False)

    entries = log.read_all()
    assert len(entries) == 2
    assert set(entries[0].keys()) == {"ts", "alias", "tool", "success"}
    assert entries[0]["success"] is True
    assert entries[1]["success"] is False


def test_audit_log_never_contains_argument_or_response_bodies(tmp_path):
    """계좌 정보 등 민감 데이터가 흐를 수 있으므로 로그 파일 원문에 그런 값이
    등장하지 않는지 직접 확인한다."""
    log_path = tmp_path / "dart.jsonl"
    log = consent.AuditLog(log_path)
    secret_marker = "ACCOUNT-1234567890-SECRET"
    # 의도적으로 record()에 그런 인자를 넘기지 않는다 — 애초에 시그니처에
    # 인자/응답을 받는 파라미터가 없다는 것 자체가 이 테스트의 핵심 검증이다.
    log.record("dart", "search_disclosure", success=True)

    raw_text = log_path.read_text(encoding="utf-8")
    assert secret_marker not in raw_text
    assert "arguments" not in raw_text
    assert "response" not in raw_text
