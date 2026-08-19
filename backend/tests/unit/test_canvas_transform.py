"""canvas_transform.py의 facts/compound 순수 변환 테스트 (P1a).

호출부(콜드/캐시 경로)는 아직 이 함수들을 쓰지 않는다(P1b가 결선한다) — 여기서는
함수 계약만 golden fixture로 검증한다. 네트워크 없음, 무작위성 없음.
"""

from __future__ import annotations

from athena_api.canvas_transform import (
    FACTS_FIELDS_MAX,
    TABLE_ROWS_MAX,
    build_compound_generic,
    build_facts,
)
from athena_mcp.canvas import CANVAS_SCHEMAS, validate_canvas_payload

# ---------------------------------------------------------------------------
# build_facts — ka00001(계좌번호조회) 실측 형상: {"acctNo": "..."} 1필드
# ---------------------------------------------------------------------------


def test_build_facts_single_scalar_field():
    payload = {"acctNo": "1234567890"}
    result = build_facts(payload)
    assert not isinstance(result, str)
    data, meta = result
    assert data == {"fields": [{"key": "acctNo", "label": "acctNo", "value": "1234567890"}]}
    assert meta == {"fields_total": 1, "fields_kept": 1, "trimmed": False}


def test_build_facts_multiple_scalar_fields_preserve_order():
    payload = {"stk_cd": "005930", "stk_nm": "삼성전자", "cur_prc": "71000"}
    result = build_facts(payload)
    assert not isinstance(result, str)
    data, meta = result
    assert [field["key"] for field in data["fields"]] == ["stk_cd", "stk_nm", "cur_prc"]
    assert meta["trimmed"] is False


def test_build_facts_drops_nested_list_and_dict_values():
    """리스트/딕셔너리 값이 섞이면 스칼라가 아니므로 제외한다 — facts는 컨테이너가
    없다(spec §3.1). 남은 스칼라가 있으면 그것만으로 성공한다."""
    payload = {"acctNo": "1234567890", "positions": [{"a": 1}], "meta": {"x": 1}}
    result = build_facts(payload)
    assert not isinstance(result, str)
    data, _ = result
    assert data["fields"] == [{"key": "acctNo", "label": "acctNo", "value": "1234567890"}]


def test_build_facts_caps_at_facts_fields_max():
    payload = {f"field_{i}": i for i in range(FACTS_FIELDS_MAX + 10)}
    result = build_facts(payload)
    assert not isinstance(result, str)
    data, meta = result
    assert len(data["fields"]) == FACTS_FIELDS_MAX
    assert meta == {
        "fields_total": FACTS_FIELDS_MAX + 10,
        "fields_kept": FACTS_FIELDS_MAX,
        "trimmed": True,
    }


def test_build_facts_rejects_non_dict_payload():
    result = build_facts(["not", "a", "dict"])
    assert isinstance(result, str)
    assert "객체가 아니다" in result


def test_build_facts_rejects_all_container_payload():
    result = build_facts({"positions": [{"a": 1}]})
    assert isinstance(result, str)
    assert "스칼라 필드" in result


def test_build_facts_output_validates_against_facts_schema():
    payload = {"stk_cd": "005930", "stk_nm": "삼성전자"}
    data, _ = build_facts(payload)  # type: ignore[misc]
    result = validate_canvas_payload("facts", data)
    assert result.fell_back is False
    assert result.canvas_type == "facts"


# ---------------------------------------------------------------------------
# build_compound_generic — ka01300(관심종목정보요청) 실측 형상:
# {"rtcd": "...", "nofi": [{"gcod": ..., "name": ...}, ...]}
# ---------------------------------------------------------------------------


def test_build_compound_generic_header_and_table():
    payload = {
        "rtcd": "0",
        "nofi": [
            {"gcod": "001", "name": "삼성전자"},
            {"gcod": "002", "name": "SK하이닉스"},
        ],
    }
    result = build_compound_generic(payload)
    assert not isinstance(result, str)
    data, meta = result
    assert data["header"] == [{"key": "rtcd", "label": "rtcd", "value": "0"}]
    assert data["table"]["columns"] == [
        {"key": "gcod", "label": "gcod"},
        {"key": "name", "label": "name"},
    ]
    assert data["table"]["rows"] == payload["nofi"]
    assert meta == {
        "header_fields_total": 1,
        "header_fields_kept": 1,
        "table_rows_total": 2,
        "table_rows_kept": 2,
        "table_trimmed": False,
        "table_columns": ["gcod", "name"],
    }


def test_build_compound_generic_caps_table_rows_at_table_rows_max():
    rows = [{"a": i} for i in range(TABLE_ROWS_MAX + 5)]
    payload = {"header_field": "x", "rows": rows}
    result = build_compound_generic(payload)
    assert not isinstance(result, str)
    data, meta = result
    assert len(data["table"]["rows"]) == TABLE_ROWS_MAX
    assert meta["table_trimmed"] is True


def test_build_compound_generic_requires_scalar_header():
    """스칼라 필드가 하나도 없으면(리스트 컨테이너만 있으면) 실패한다 —
    CompoundCard는 헤더가 항상 있다(spec §3.3)."""
    payload = {"rows": [{"a": 1}]}
    result = build_compound_generic(payload)
    assert isinstance(result, str)
    assert "헤더" in result


def test_build_compound_generic_requires_list_container():
    payload = {"rtcd": "0", "msg": "ok"}
    result = build_compound_generic(payload)
    assert isinstance(result, str)
    assert "행 배열" in result


def test_build_compound_generic_rejects_non_dict_payload():
    result = build_compound_generic([1, 2, 3])
    assert isinstance(result, str)
    assert "객체가 아니다" in result


def test_build_compound_generic_output_validates_against_compound_schema():
    payload = {"rtcd": "0", "nofi": [{"gcod": "001", "name": "삼성전자"}]}
    data, _ = build_compound_generic(payload)  # type: ignore[misc]
    result = validate_canvas_payload("compound", data)
    assert result.fell_back is False
    assert result.canvas_type == "compound"


# ---------------------------------------------------------------------------
# 스키마 등록/파생 회귀 — canvas.py CANVAS_SCHEMAS에 facts/compound가 실제로
# 있는지, server.py의 _KNOWN_CANVAS_TYPES/_data_shape_hint가 이를 놓치지 않고
# 파생하는지 고정한다(수동 목록 드리프트 방지, 계획 P1a 수용 기준).
# ---------------------------------------------------------------------------


def test_canvas_schemas_registers_facts_and_compound():
    assert "facts" in CANVAS_SCHEMAS
    assert "compound" in CANVAS_SCHEMAS


def test_known_canvas_types_derives_facts_and_compound():
    from athena_mcp.server import _KNOWN_CANVAS_TYPES

    assert "facts" in _KNOWN_CANVAS_TYPES
    assert "compound" in _KNOWN_CANVAS_TYPES
    assert "free" in _KNOWN_CANVAS_TYPES


def test_data_shape_hint_covers_facts_and_compound():
    from athena_mcp.server import _RENDER_CANVAS_INPUT_SCHEMA

    desc = _RENDER_CANVAS_INPUT_SCHEMA["properties"]["data"]["description"]
    assert "- facts:" in desc
    assert "- compound:" in desc
    assert "fields" in desc
    assert "header" in desc
    assert "table" in desc
