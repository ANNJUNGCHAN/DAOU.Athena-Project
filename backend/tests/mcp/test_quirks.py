"""quirks.py 테스트 — corp_code zfill, 인코딩 스모크 테스트, truncate_at 제안값.
실측 캡처를 픽스처로 쓴다."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from athena_mcp import quirks

CAPTURES = Path(__file__).resolve().parents[3] / "spike" / "captures"


def _load(name: str) -> dict:
    return json.loads((CAPTURES / name).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# corp_code zfill
# ---------------------------------------------------------------------------


def test_normalize_corp_code_zfill_basic():
    assert quirks.normalize_corp_code(126380) == "00126380"


def test_normalize_corp_code_from_real_capture():
    """실측(S2B-jjlabsio-corp-code.json): get_corp_code가 126380을 숫자로 준다.
    정상값은 "00126380"이어야 한다 — 정규화 없이 넘기면 하위 호출이
    `MCP error -32602: Expected string, received number`로 실패한다."""
    raw = _load("S2B-jjlabsio-corp-code.json")
    text = raw["result"]["content"][0]["text"]
    parsed = json.loads(text)[0]
    assert parsed["corp_code"] == 126380
    assert quirks.normalize_corp_code(parsed["corp_code"]) == "00126380"


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


def test_encoding_smoke_test_flags_drfirst_real_corruption():
    """실측(S2-drfirst-response.json): get_stock_price_by_code 응답의 name
    필드가 U+FFFD로 손상돼 있다 — 같은 캡처 안에서 search_stock_code 호출은
    정상 "삼성전자"를 준다(툴에 따라 갈림)."""
    raw = _load("S2-drfirst-response.json")
    corrupted = raw["get_stock_price_by_code__005930"]["structuredContent"]["name"]
    clean = raw["search_stock_code__삼성전자"]["structuredContent"]["result"]["name"]

    corrupted_result = quirks.run_encoding_smoke_test("삼성전자", corrupted)
    clean_result = quirks.run_encoding_smoke_test("삼성전자", clean)

    assert corrupted_result.mojibake_detected is True
    assert clean_result.mojibake_detected is False
    assert clean == "삼성전자"


def test_encoding_smoke_test_pykrx_clean_control_group():
    """대조군: pykrx-mcp는 손상 0건(§9-④ 실측, 재현 실패로 정정된 원래 초안과 반대)."""
    raw = _load("S2-pykrx-response.json")
    text = raw["get_stock_ohlcv__005930"]["content"][0]["text"]
    result = quirks.run_encoding_smoke_test("삼성전자", text)
    assert result.mojibake_detected is False


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
