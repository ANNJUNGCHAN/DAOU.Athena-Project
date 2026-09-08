
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from athena_mcp.consent import ConsentStore
from athena_mcp.onboarding import (
    ProbeReport,
    apply_probe_findings,
    derive_alias,
    probe_server,
    sanitize_alias,
    stage_from_snippet,
    stage_registration,
    unique_alias,
)
from athena_mcp.registry import MAX_ALIAS_LEN, ServerRegistry, validate_alias

# `tests/mcp/`에는 `__init__.py`가 없다(README 참고 — 동명 파일 충돌 회피).
# 그래서 test_server.py에서 import하지 않고 같은 픽스처 경로를 여기서 만든다.
_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "fake_server.py"
FIXTURE_SERVER = (sys.executable, [str(_FIXTURE_PATH)])

LONG_NAME = "user-registered-very-long-server-name-for-korean-market-data"


@pytest.fixture
def stores(tmp_path):
    return (
        ServerRegistry(tmp_path / "registry.json"),
        ConsentStore(tmp_path / "consent.json"),
    )


# -- 별칭 정규화 -------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("@drfirst/korea-stock-mcp", "drfirst-korea-stock-mcp"),
        ("server.everything", "server-everything"),
        ("naver search mcp", "naver-search-mcp"),
        ("--leading-and-trailing--", "leading-and-trailing"),
        ("already_valid-1", "already_valid-1"),
    ],
)
def test_sanitize_alias_rewrites_real_world_names(raw, expected):
    assert sanitize_alias(raw) == expected


def test_sanitize_alias_output_always_passes_registry_validation():
    """정규화 결과는 `registry.validate_alias()`를 **항상** 통과해야 한다 —
    통과 못 하면 스니펫 붙여넣기 등록이 그 자리에서 깨진다."""
    for raw in [
        "@drfirst/korea-stock-mcp",
        "네이버 검색",
        LONG_NAME,
        "!!!",
        "한글만있는이름",
        "a" * 200,
    ]:
        validate_alias(sanitize_alias(raw))  # raise하지 않으면 통과


def test_sanitize_alias_truncates_with_hash_not_bare_prefix():
    """단순 절단은 접두사가 같은 두 이름을 충돌시킨다 — 해시가 그걸 막는다."""
    a = sanitize_alias(LONG_NAME + "-alpha")
    b = sanitize_alias(LONG_NAME + "-beta")
    assert len(a) <= MAX_ALIAS_LEN
    assert len(b) <= MAX_ALIAS_LEN
    assert a != b


def test_sanitize_alias_is_deterministic():
    assert sanitize_alias(LONG_NAME) == sanitize_alias(LONG_NAME)


def test_all_non_ascii_name_falls_back_to_package_name_not_generic_server():
    """한글만으로 된 이름은 문자집합 필터를 통과하지 못한다. 그때 `server`로
    뭉개면 서버가 둘 이상일 때 서로 구분이 안 된다 — 패키지명으로 물러난다."""
    assert sanitize_alias("네이버 검색") == "server"
    assert (
        derive_alias("네이버 검색", "npx", ["-y", "@isnow890/naver-search-mcp"])
        == "isnow890-naver-search-mcp"
    )


def test_derive_alias_prefers_user_given_name_when_it_survives():
    assert derive_alias("my-naver", "npx", ["-y", "@isnow890/naver-search-mcp"]) == "my-naver"


def test_derive_alias_skips_flag_args_when_falling_back():
    assert derive_alias("한글", "uvx", ["--with", "mcp==1.28.*", "pykrx-mcp"]) == "pykrx-mcp"


def test_derive_alias_last_resort_is_command():
    assert derive_alias("한글", "some-server-binary", []) == "some-server-binary"


def test_unique_alias_avoids_collision_within_length_limit():
    taken = {"pykrx"}
    assert unique_alias("pykrx", taken) == "pykrx-2"
    long_alias = "a" * MAX_ALIAS_LEN
    got = unique_alias(long_alias, {long_alias})
    assert len(got) <= MAX_ALIAS_LEN
    assert got != long_alias


# -- 등록/승인 분리 ----------------------------------------------------------


def test_stage_registration_does_not_approve(stores):
    registry, consent = stores
    pending = stage_registration(
        registry, consent, original_name="pykrx", command="uvx", args=["pykrx-mcp"]
    )
    assert pending.alias == "pykrx"
    assert consent.is_server_approved("pykrx") is False
    assert consent.get("pykrx") is not None  # 승인 요청은 만들어졌다


def test_stage_from_snippet_registers_all_and_rewrites_aliases(stores):
    registry, consent = stores
    raw = json.dumps(
        {
            "mcpServers": {
                "@drfirst/korea-stock-mcp": {"command": "npx", "args": ["-y", "@drfirst/x"]},
                "네이버 검색": {"command": "npx", "args": ["-y", "@isnow890/naver-search-mcp"]},
                LONG_NAME: {"command": "uvx", "args": ["pykrx-mcp"]},
            }
        }
    )
    staged = stage_from_snippet(registry, consent, raw)

    assert len(staged) == 3
    assert {p.alias for p in staged} == {
        "drfirst-korea-stock-mcp",
        "isnow890-naver-search-mcp",
        sanitize_alias(LONG_NAME),
    }
    assert all(p.alias_was_rewritten for p in staged)
    # 스니펫 파싱만으로 승인되면 §5가 막으려는 구멍이 그대로 재현된다
    assert all(not consent.is_server_approved(p.alias) for p in staged)


def test_stage_from_snippet_two_servers_normalizing_to_same_alias_do_not_collide(stores):
    registry, consent = stores
    raw = json.dumps(
        {
            "mcpServers": {
                "korea stock mcp": {"command": "npx", "args": ["-y", "a"]},
                "korea-stock-mcp": {"command": "npx", "args": ["-y", "b"]},
            }
        }
    )
    staged = stage_from_snippet(registry, consent, raw)
    aliases = [p.alias for p in staged]
    assert len(set(aliases)) == 2, f"별칭이 충돌했다: {aliases}"


def test_risk_warnings_surface_on_staged_registration(stores):
    registry, consent = stores
    pending = stage_registration(
        registry,
        consent,
        original_name="sketchy",
        command="node",
        args=["server.js"],
        env={"NODE_OPTIONS": "--require /tmp/evil.js"},
    )
    assert any("NODE_OPTIONS" in w for w in pending.risk_warnings)


# -- probe -------------------------------------------------------------------


async def test_probe_blocked_without_approval(stores, tmp_path):
    registry, consent = stores
    pending = stage_registration(
        registry,
        consent,
        original_name="fixture",
        command=FIXTURE_SERVER[0],
        args=FIXTURE_SERVER[1],
    )
    report = await probe_server(pending.entry, consent, tmp_path / "logs")
    assert report.ok is False
    assert "Consent" in (report.error or "") or "승인" in (report.error or "")


async def test_probe_discovers_tools_and_records_findings(stores, tmp_path):
    registry, consent = stores
    pending = stage_registration(
        registry,
        consent,
        original_name="fixture",
        command=FIXTURE_SERVER[0],
        args=FIXTURE_SERVER[1],
    )
    consent.approve(pending.alias)

    report = await probe_server(pending.entry, consent, tmp_path / "logs")
    assert report.ok is True
    assert report.protocol_version
    assert {t["name"] for t in report.tools} >= {"echo", "get_corp_code"}
    assert report.mojibake_in_tool_metadata is False


def test_repeated_identical_probe_findings_preserve_revision_but_changed_warning_advances_it(
    stores,
):
    registry, _ = stores
    registry.add("fixture", command=FIXTURE_SERVER[0], args=FIXTURE_SERVER[1])
    report = ProbeReport(
        alias="fixture",
        ok=True,
        protocol_version="2025-11-25",
        reported_name="fixture-server",
        reported_version="1.0.0",
        mojibake_in_tool_metadata=False,
    )

    apply_probe_findings(registry, report)
    after_first_probe = registry.revision
    observed_at = registry.get("fixture").self_reported_server_info.observed_at

    apply_probe_findings(registry, report)
    assert registry.revision == after_first_probe
    assert registry.get("fixture").self_reported_server_info.observed_at == observed_at

    report.mojibake_in_tool_metadata = True
    apply_probe_findings(registry, report)
    assert registry.revision == after_first_probe + 1
    assert registry.get("fixture").encoding_smoke_test_warning is True


async def test_probe_failure_is_reported_not_raised(stores, tmp_path):
    """존재하지 않는 명령을 등록해도 예외가 아니라 리포트로 돌아와야 한다 —
    서버 여러 개를 훑을 때 하나가 죽어서 전체가 멈추면 안 된다."""
    registry, consent = stores
    pending = stage_registration(
        registry,
        consent,
        original_name="ghost",
        command="this-command-does-not-exist-athena",
        args=[],
    )
    consent.approve(pending.alias)
    report = await probe_server(pending.entry, consent, tmp_path / "logs")
    assert report.ok is False
    assert report.error
