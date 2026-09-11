"""consent.py 테스트 — 미승인 서버는 spawn 금지, 미승인 툴은 집계 제외,
위험 패턴 경고, 감사 로그에 인자/응답 본문이 안 남는지."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

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


def test_disallow_tool_never_allowed_is_a_silent_success(store):
    """이미 허용 안 된 툴을 또 disallow해도 에러가 아니다 — 목표 상태(허용
    안 됨)는 이미 달성돼 있으므로 멱등하게 성공한다(disallow_tool 독스트링
    참고)."""
    store.request_consent("dart", "npx", ["-y", "x"], {})
    store.approve("dart")  # 툴은 하나도 allow 안 함
    store.disallow_tool("dart", "search_disclosure")  # raise 안 하면 통과
    assert store.is_tool_allowed("dart", "search_disclosure") is False


def test_disallow_tool_on_unapproved_server_does_not_raise(store):
    """`allow_tool()`과 달리 서버 승인 여부를 요구하지 않는다 — 권한 회수는
    전제조건으로 막을 이유가 없다."""
    store.request_consent("dart", "npx", ["-y", "x"], {})  # approve() 호출 안 함
    store.disallow_tool("dart", "search_disclosure")  # raise 안 하면 통과
    assert store.is_tool_allowed("dart", "search_disclosure") is False


def test_disallow_tool_on_never_registered_server_does_not_raise(store):
    store.disallow_tool("never-registered", "search_disclosure")  # raise 안 하면 통과
    assert store.is_tool_allowed("never-registered", "search_disclosure") is False


def test_stale_store_disallow_uses_fresh_disk_state(tmp_path):
    path = tmp_path / "consent.json"
    stale = consent.ConsentStore(path)
    writer = consent.ConsentStore(path)
    writer.request_consent("dart", "npx", [], {})
    writer.approve("dart", approved_tools={"search_disclosure"})

    stale.disallow_tool("dart", "search_disclosure")

    reloaded = consent.ConsentStore(path)
    assert reloaded.is_server_approved("dart") is True
    assert reloaded.is_tool_allowed("dart", "search_disclosure") is False
    assert reloaded.revision == 3


def test_disallowed_tool_rejected_at_dispatch_gate_afterwards(store):
    store.request_consent("dart", "npx", ["-y", "x"], {})
    store.approve("dart", approved_tools={"search_disclosure"})
    assert store.is_tool_allowed("dart", "search_disclosure") is True  # 사전조건

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


def test_consent_revision_is_monotonic_and_reload_observes_external_mutation(tmp_path):
    path = tmp_path / "consent.json"
    first = consent.ConsentStore(path)
    second = consent.ConsentStore(path)
    first.request_consent("one", "npx", [], {})
    second.request_consent("two", "uvx", [], {})

    snapshot = first.reload()
    assert snapshot.revision == 2
    assert {record["alias"] for record in snapshot.records} == {"one", "two"}


def test_concurrent_consent_mutations_do_not_lose_updates(tmp_path):
    path = tmp_path / "consent.json"
    stores = [consent.ConsentStore(path), consent.ConsentStore(path)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(stores[0].request_consent, "one", "npx", [], {}),
            pool.submit(stores[1].request_consent, "two", "uvx", [], {}),
        ]
        for future in futures:
            future.result()

    reloaded = consent.ConsentStore(path)
    assert reloaded.revision == 2
    assert reloaded.get("one") is not None
    assert reloaded.get("two") is not None


def test_failed_atomic_consent_write_preserves_disk_and_memory(tmp_path, monkeypatch):
    path = tmp_path / "consent.json"
    store = consent.ConsentStore(path)
    store.request_consent("one", "npx", [], {})
    before = path.read_bytes()
    before_snapshot = store.snapshot()

    def fail_write(_path, _payload):
        raise OSError("simulated write failure")

    monkeypatch.setattr(consent, "atomic_write_json", fail_write)
    with pytest.raises(OSError, match="simulated"):
        store.request_consent("two", "uvx", [], {})

    assert path.read_bytes() == before
    assert store.snapshot() == before_snapshot
    assert not list(tmp_path.glob("*.tmp"))


def test_consent_fingerprint_is_canonical_and_order_independent(tmp_path):
    first_path = tmp_path / "first.json"
    second_path = tmp_path / "second.json"
    alpha = {
        "alias": "alpha", "full_command_text": "npx a", "risk_warnings": [],
        "approved": True, "approved_at": None, "approved_tools": ["z", "a"],
    }
    beta = {
        "alias": "beta", "full_command_text": "uvx b", "risk_warnings": [],
        "approved": False, "approved_at": None, "approved_tools": [],
    }
    first_path.write_text(json.dumps({"alpha": alpha, "beta": beta}), encoding="utf-8")
    second_path.write_text(json.dumps({"beta": beta, "alpha": alpha}), encoding="utf-8")
    first_fingerprint = consent.ConsentStore(first_path).fingerprint
    second_fingerprint = consent.ConsentStore(second_path).fingerprint
    assert first_fingerprint == second_fingerprint


def test_consent_metadata_keeps_legacy_alias_lookup_shape(tmp_path):
    path = tmp_path / "consent.json"
    store = consent.ConsentStore(path)
    store.request_consent("dart", "npx", [], {})
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["dart"]["alias"] == "dart"
    assert raw["$athena"]["revision"] == 1


def test_stale_store_rename_uses_fresh_disk_state(tmp_path):
    path = tmp_path / "consent.json"
    stale = consent.ConsentStore(path)
    writer = consent.ConsentStore(path)
    writer.request_consent("old", "npx", [], {})
    writer.approve("old", approved_tools={"search"})

    stale.rename("old", "new")

    reloaded = consent.ConsentStore(path)
    assert reloaded.get("old") is None
    renamed = reloaded.get("new")
    assert renamed is not None
    assert renamed.alias == "new"
    assert renamed.approved_tools == {"search"}
    assert reloaded.revision == 3


def test_stale_idempotent_decision_refreshes_memory_without_revision_bump(tmp_path):
    path = tmp_path / "consent.json"
    stale = consent.ConsentStore(path)
    writer = consent.ConsentStore(path)
    writer.request_consent("new", "npx", [], {})

    stale.rename("old", "new")

    assert stale.get("new") is not None
    assert stale.revision == 1


def test_refresh_server_metadata_preserves_approval_and_tools(store):
    store.request_consent("discord", "npx", ["old"], {})
    store.approve("discord", approved_tools={"send_message", "list_guilds"})

    refreshed = store.refresh_server_metadata(
        "discord", "bash", ["-c", "rm -rf /tmp/example"], {}
    )

    assert refreshed is not None
    assert refreshed.approved is True
    assert refreshed.approved_tools == {"send_message", "list_guilds"}
    assert refreshed.full_command_text == "bash -c rm -rf /tmp/example"
    assert refreshed.risk_warnings


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


def test_plugin_audit_log_records_only_the_same_four_fields(tmp_path):
    """플러그인 제안 감사도 같은 4필드다 — 무엇을 제안했는지(대상·기능·스니펫)는
    로그에 닿지 않는다. 실측 경로는 `~/.athena/audit/plugin.jsonl`."""
    log = consent.AuditLog(tmp_path / "plugin.jsonl")
    log.record("plugin", "athena_plugin", success=True)

    (entry,) = log.read_all()
    assert set(entry.keys()) == {"ts", "alias", "tool", "success"}
    assert entry["alias"] == "plugin"
    assert entry["tool"] == "athena_plugin"
    assert entry["success"] is True


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
