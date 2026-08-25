"""quirks.py 테스트 — corp_code zfill, 인코딩 스모크 테스트, truncate_at 제안값.
실측 캡처를 픽스처로 쓴다."""

from __future__ import annotations

import pytest

from athena_mcp import quirks

# ---------------------------------------------------------------------------
# corp_code zfill
# ---------------------------------------------------------------------------


def test_normalize_corp_code_zfill_basic():
    assert quirks.normalize_corp_code(126380) == "00126380"


def test_normalize_corp_code_idempotent_on_already_padded_string():
    assert quirks.normalize_corp_code("00126380") == "00126380"


def test_normalize_corp_code_rejects_non_numeric():
    with pytest.raises(ValueError):
        quirks.normalize_corp_code("삼성전자")


def test_normalize_known_args_fixes_corp_code_field():
    args = {"corp_code": 126380, "start_date": "20240101"}
    fixed = quirks.normalize_known_args("search_disclosure", args)
    assert fixed["corp_code"] == "00126380"
    assert fixed["start_date"] == "20240101"  # 건드리지 않음


def test_normalize_known_args_does_not_mutate_input():
    args = {"corp_code": 126380}
    quirks.normalize_known_args("x", args)
    assert args["corp_code"] == 126380  # 원본 dict는 그대로


# ---------------------------------------------------------------------------
# 인코딩 스모크 테스트 — drfirst 손상 재현, pykrx 정상 대조군
# ---------------------------------------------------------------------------


def test_contains_mojibake_detects_ufffd():
    assert quirks.contains_mojibake("��기")
    assert not quirks.contains_mojibake("삼성전자")
    assert not quirks.contains_mojibake(None)


# ---------------------------------------------------------------------------
# truncate_at 기본값 상향
# ---------------------------------------------------------------------------


def test_suggested_truncate_at_raises_default_for_korean_dart_mcp():
    suggested = quirks.suggested_truncate_at("npx -y korean-dart-mcp", requested=None)
    assert suggested == quirks.KOREAN_DART_MCP_MIN_TRUNCATE_AT
    # 사업보고서 636,059자를 자르지 않을 만큼 커야 한다
    assert suggested > 636_059


def test_suggested_truncate_at_leaves_explicit_request_untouched():
    assert quirks.suggested_truncate_at("npx -y korean-dart-mcp", requested=50_000) == 50_000


def test_suggested_truncate_at_unrelated_server_uses_documented_default():
    suggested = quirks.suggested_truncate_at("uvx pykrx-mcp", requested=None)
    assert suggested == quirks.KOREAN_DART_MCP_DEFAULT_TRUNCATE_AT
