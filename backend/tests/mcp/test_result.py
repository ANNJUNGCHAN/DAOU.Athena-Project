"""result.py 테스트 — 4단계 우선순위. `spike/captures/`의 실제 캡처를 픽스처로
쓴다(지어낸 JSON 금지, `plan/mcp-실행계획.md` 테스트 요구사항)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from athena_mcp import result as r

CAPTURES = Path(__file__).resolve().parents[3] / "spike" / "captures"


def _load(name: str) -> dict:
    return json.loads((CAPTURES / name).read_text(encoding="utf-8"))


def test_captures_dir_exists():
    assert CAPTURES.is_dir(), f"spike 캡처 디렉토리를 못 찾았다: {CAPTURES}"


# ---------------------------------------------------------------------------
# 1. isError -> content[0].text는 사람이 읽는 에러, 캔버스로 보내지 말 것
# ---------------------------------------------------------------------------


def test_priority1_iserror_from_everything_capture():
    raw = _load("S2-everything-calltoolresult-isError.json")
    parsed = r.parse_call_tool_result(raw)
    assert parsed.status == "error"
    assert parsed.data is None
    assert "Input validation error" in parsed.error_message


def test_priority1_iserror_from_jjlabsio_nokey_capture():
    """실측: DART 키 없이 호출하면 사람이 읽는 에러 문자열이 온다."""
    raw = _load("S2-jjlabsio-nokey-error.json")
    parsed = r.parse_call_tool_result(raw["result"])
    assert parsed.status == "error"
    assert parsed.error_message == "There is no DART API KEY"


# ---------------------------------------------------------------------------
# 2. structuredContent -> 있으면 신뢰
# ---------------------------------------------------------------------------


def test_priority2_structured_content_trusted_when_present():
    raw = _load("S2-everything-calltoolresult-structured.json")
    parsed = r.parse_call_tool_result(raw)
    assert parsed.status == "structured"
    assert parsed.data == {"temperature": 33, "conditions": "Cloudy", "humidity": 82}


def test_priority2_drfirst_structured_content_present():
    """@drfirst는 structuredContent를 채우는 소수 서버 중 하나(실측)."""
    raw = _load("S2-drfirst-response.json")
    call = raw["get_stock_price_by_code__005930"]
    parsed = r.parse_call_tool_result(call)
    assert parsed.status == "structured"
    assert parsed.data["code"] == "005930"


# ---------------------------------------------------------------------------
# 3. content[0].text -> json.loads() — 주경로
# ---------------------------------------------------------------------------


def test_priority3_json_loads_from_jjlabsio_corp_code_capture():
    """structuredContent가 null인 서버(jjlabsio)는 text를 json.loads()해야 한다.
    이 캡처는 quirks.normalize_corp_code()가 고쳐야 할 원본 결함(숫자 corp_code)도
    동시에 보여준다."""
    raw = _load("S2B-jjlabsio-corp-code.json")
    parsed = r.parse_call_tool_result(raw["result"])
    assert parsed.status == "json"
    assert parsed.data[0]["corp_code"] == 126380  # 아직 정규화 전 — 숫자 그대로
    assert parsed.data[0]["corp_name"] == "삼성전자"


def test_priority3_json_loads_from_pykrx_capture():
    """pykrx-mcp(FastMCP)는 outputSchema가 없어 structuredContent가 항상 null —
    §9-① 실측. 전량 3번 경로를 타야 한다."""
    raw = _load("S2-pykrx-response.json")
    call = raw["get_stock_ohlcv__005930"]
    assert call["structuredContent"] is None
    parsed = r.parse_call_tool_result(call)
    assert parsed.status == "json"
    assert parsed.data["ticker"] == "005930"
    assert parsed.data["row_count"] == 9


# ---------------------------------------------------------------------------
# 4. 파싱 실패 -> 순수 텍스트
# ---------------------------------------------------------------------------


def test_priority4_plain_text_fallback_from_echo_capture():
    """"Echo: hello from Athena spike S2"는 유효한 JSON이 아니다 -> 순수 텍스트."""
    raw = _load("S2-everything-calltoolresult.json")
    parsed = r.parse_call_tool_result(raw)
    assert parsed.status == "text"
    assert parsed.data == "Echo: hello from Athena spike S2"
    assert parsed.raw_text == parsed.data


# ---------------------------------------------------------------------------
# 미지원 콘텐츠 블록 — 조용히 무시하지 않고 명시적으로 에러
# ---------------------------------------------------------------------------


def test_unsupported_content_block_raises_explicitly():
    raw = {
        "content": [{"type": "image", "data": "base64...", "mimeType": "image/png"}],
        "structuredContent": None,
        "isError": False,
    }
    with pytest.raises(r.UnsupportedContentBlockError) as exc_info:
        r.parse_call_tool_result(raw)
    assert "image" in exc_info.value.block_types


def test_empty_content_array_returns_empty_status():
    raw = {"content": [], "structuredContent": None, "isError": False}
    parsed = r.parse_call_tool_result(raw)
    assert parsed.status == "empty"


# ---------------------------------------------------------------------------
# CallToolResult 객체(모델) 입력도 동일하게 다뤄야 한다
# ---------------------------------------------------------------------------


def test_accepts_calltoolresult_model_instance():
    from mcp.types import CallToolResult, TextContent

    obj = CallToolResult(
        content=[TextContent(type="text", text='{"a": 1}')],
        structuredContent=None,
        isError=False,
    )
    parsed = r.parse_call_tool_result(obj)
    assert parsed.status == "json"
    assert parsed.data == {"a": 1}
