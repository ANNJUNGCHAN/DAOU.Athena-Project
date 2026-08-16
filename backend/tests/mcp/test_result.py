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
    # 진짜 upstream 에러다 — 게이트웨이가 만든 게 아니므로 마커가 없다.
    assert parsed.error_origin is None


# ---------------------------------------------------------------------------
# error_origin — 게이트웨이 자신이 만든 에러와 진짜 upstream 에러를 구분하는
# `_meta` 마커. server.py가 채우고 이 모듈은 읽기만 한다
# (plan/paper-specs/02-MCP-응답-형상-전수조사.md §D-7).
# ---------------------------------------------------------------------------


def test_error_origin_read_from_meta_when_gateway_blocked():
    raw = {
        "content": [{"type": "text", "text": "승인되지 않은 툴이라 호출할 수 없다"}],
        "structuredContent": None,
        "isError": True,
        "_meta": {r.ERROR_ORIGIN_META_KEY: "gateway-blocked"},
    }
    parsed = r.parse_call_tool_result(raw)
    assert parsed.status == "error"
    assert parsed.error_origin == "gateway-blocked"


def test_error_origin_read_from_meta_when_upstream_failed():
    raw = {
        "content": [{"type": "text", "text": "upstream 호출 실패: 프로세스가 죽었다"}],
        "structuredContent": None,
        "isError": True,
        "_meta": {r.ERROR_ORIGIN_META_KEY: "upstream-failed"},
    }
    parsed = r.parse_call_tool_result(raw)
    assert parsed.error_origin == "upstream-failed"


def test_error_origin_none_when_meta_absent():
    """마커가 아예 없는 에러(대다수의 실제 upstream 에러) — "구분 불가"를
    임의의 값으로 채우지 않고 정직하게 `None`으로 둔다."""
    raw = {
        "content": [{"type": "text", "text": "There is no DART API KEY"}],
        "structuredContent": None,
        "isError": True,
    }
    parsed = r.parse_call_tool_result(raw)
    assert parsed.error_origin is None


def test_error_origin_none_for_non_error_status():
    """`status != "error"`면 `_meta`에 뭐가 있든 무관하게 항상 `None`이다 —
    발생지점 구분은 에러에만 의미가 있다."""
    raw = {
        "content": [{"type": "text", "text": '{"a": 1}'}],
        "structuredContent": None,
        "isError": False,
        "_meta": {r.ERROR_ORIGIN_META_KEY: "gateway-blocked"},
    }
    parsed = r.parse_call_tool_result(raw)
    assert parsed.status == "json"
    assert parsed.error_origin is None


def test_error_origin_ignores_unknown_values():
    """알려지지 않은 값이 마커 자리에 오면(다른 구현체가 실수로 같은 키를
    다른 뜻으로 썼거나, 데이터 손상) 제3의 값을 지어내지 않고 `None`으로
    떨어뜨린다 — 카드 설계가 값 두 개만 가정하고 있다는 계약을 지킨다."""
    raw = {
        "content": [{"type": "text", "text": "에러"}],
        "structuredContent": None,
        "isError": True,
        "_meta": {r.ERROR_ORIGIN_META_KEY: "something-else"},
    }
    parsed = r.parse_call_tool_result(raw)
    assert parsed.error_origin is None


def test_error_origin_survives_calltoolresult_model_instance_via_by_alias():
    """`CallToolResult` 모델 인스턴스로 들어와도(raw dict가 아니라) 마커를
    읽어야 한다 — `_to_dict()`가 `by_alias=True`로 덤프하지 않으면 `meta`
    필드가 파이썬 필드명(`"meta"`)으로 덤프되어 `_meta` 조회가 빗나간다."""
    from mcp.types import CallToolResult, TextContent

    obj = CallToolResult(
        content=[TextContent(type="text", text="거부됨")],
        isError=True,
        _meta={r.ERROR_ORIGIN_META_KEY: "gateway-blocked"},
    )
    parsed = r.parse_call_tool_result(obj)
    assert parsed.error_origin == "gateway-blocked"


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
