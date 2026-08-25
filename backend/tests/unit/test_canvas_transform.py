"""canvas_transform.py의 facts/compound 순수 변환 테스트 (P1a).

호출부(콜드/캐시 경로)는 아직 이 함수들을 쓰지 않는다(P1b가 결선한다) — 여기서는
함수 계약만 golden fixture로 검증한다. 네트워크 없음, 무작위성 없음.
"""

from __future__ import annotations

import json
from copy import deepcopy

import pytest

import athena_api.canvas_transform as canvas_transform
from athena_api.canvas_transform import (
    FACTS_FIELDS_MAX,
    SUMMARY_PREVIEW_BYTES_MAX,
    SUMMARY_PREVIEW_ITEMS_MAX,
    SUMMARY_PREVIEW_STRING_MAX,
    TABLE_ROWS_MAX,
    build_chart_bars,
    build_compound_generic,
    build_facts,
    build_table,
    resolve_chart_initial_period,
    resolve_render_plan_kind,
    resolve_screen_render_contract,
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
    assert meta == {
        "fields_total": 1,
        "fields_kept": 1,
        "trimmed": False,
        "preview": [],  # 계좌번호는 모델 summary로 복제하지 않는다.
        "preview_truncated": False,
    }


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
        "preview": [],
        "preview_truncated": False,
    }


def test_build_facts_current_trading_summary_has_exact_price_and_change():
    payload = {
        "cur_prc": "+71000",
        "pre_sig": "2",
        "pred_pre": "+1200",
        "flu_rt": "+1.72",
        "trde_tm": "153012",
        "trde_qty": "123456",
    }
    result = build_facts(payload)
    assert not isinstance(result, str)
    _, meta = result
    assert meta["preview"] == [
        {"key": "cur_prc", "label": "현재가", "value": "+71000"},
        {"key": "pred_pre", "label": "전일대비", "value": "+1200"},
        {"key": "pre_sig", "label": "등락기호", "value": "2"},
        {"key": "flu_rt", "label": "등락률", "value": "+1.72"},
        {"key": "trde_tm", "label": "거래시각", "value": "153012"},
    ]
    assert meta["preview_truncated"] is False


def test_build_facts_summary_preview_obeys_item_string_and_byte_bounds():
    payload = {key: "가" * 500 for key in (
        "cur_prc",
        "pred_pre",
        "pre_sig",
        "pred_pre_sig",
        "flu_smbol",
        "smbol",
        "flu_rt",
        "cntr_tm",
    )}
    result = build_facts(payload)
    assert not isinstance(result, str)
    _, meta = result
    assert len(meta["preview"]) <= SUMMARY_PREVIEW_ITEMS_MAX
    assert all(len(item["value"]) <= SUMMARY_PREVIEW_STRING_MAX for item in meta["preview"])
    assert len(json.dumps(meta["preview"], ensure_ascii=False).encode("utf-8")) <= (
        SUMMARY_PREVIEW_BYTES_MAX
    )
    assert meta["preview_truncated"] is True


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


def test_table_summary_contract_remains_count_and_columns_only():
    built = build_table({"rows": [{"code": "005930", "price": "71000"}]})
    assert not isinstance(built, str)
    _, meta = built
    assert meta == {
        "rows_total": 1,
        "rows_kept": 1,
        "trimmed": False,
        "columns": ["code", "price"],
    }


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
        "header_keys": ["rtcd"],
        "header_keys_truncated": False,
        "header_preview": [{"key": "rtcd", "label": "응답코드", "value": "0"}],
        "header_preview_truncated": False,
        "table_rows_total": 2,
        "table_rows_kept": 2,
        "table_trimmed": False,
        "table_columns": ["gcod", "name"],
    }


def test_build_compound_generic_summary_has_bounded_headers_not_rows():
    payload = {
        "stk_cd": "005930",
        "stk_nm": "삼성전자",
        "cur_prc": "71000",
        "private_note": "요약에 포함되면 안 됨",
        "rows": [{"name": "row-secret", "value": "full-row-value"}],
    }
    result = build_compound_generic(payload)
    assert not isinstance(result, str)
    _, meta = result
    assert meta["header_keys"] == ["stk_cd", "stk_nm", "cur_prc", "private_note"]
    assert meta["header_preview"] == [
        {"key": "cur_prc", "label": "현재가", "value": "71000"},
        {"key": "stk_cd", "label": "종목코드", "value": "005930"},
        {"key": "stk_nm", "label": "종목명", "value": "삼성전자"},
    ]
    rendered = json.dumps(meta, ensure_ascii=False)
    assert "row-secret" not in rendered
    assert "full-row-value" not in rendered
    assert "요약에 포함되면 안 됨" not in rendered


def test_build_compound_generic_header_summary_obeys_bounds():
    payload = {
        **{f"header_{i}_" + ("가" * 100): i for i in range(10)},
        "rows": [{"value": 1}],
    }
    result = build_compound_generic(payload)
    assert not isinstance(result, str)
    _, meta = result
    assert 0 < len(meta["header_keys"]) <= SUMMARY_PREVIEW_ITEMS_MAX
    assert all(len(key) <= SUMMARY_PREVIEW_STRING_MAX for key in meta["header_keys"])
    assert len(json.dumps(meta["header_keys"], ensure_ascii=False).encode("utf-8")) <= (
        SUMMARY_PREVIEW_BYTES_MAX
    )
    assert meta["header_keys_truncated"] is True


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



_CHART_GOLDEN_ROWS = [
    {
        "cur_prc": "71000",
        "trde_qty": "1000",
        "dt": "20260819",
        "open_pric": "70500",
        "high_pric": "71500",
        "low_pric": "70000",
    }
]

_CHART_GOLDEN_CONTAINERS = {
    "base:ka10081": "stk_dt_pole_chart_qry",  # 주식일봉차트조회요청
    "base:ka10082": "stk_stk_pole_chart_qry",  # 주식주봉차트조회요청
    "base:ka10083": "stk_mth_pole_chart_qry",  # 주식월봉차트조회요청
    "base:ka10094": "stk_yr_pole_chart_qry",  # 주식년봉차트조회요청
    "base:ka20006": "inds_dt_pole_qry",  # 업종일봉조회요청
    "base:ka20007": "inds_stk_pole_qry",  # 업종주봉조회요청
    "base:ka20008": "inds_mth_pole_qry",  # 업종월봉조회요청
    "base:ka20019": "inds_yr_pole_qry",  # 업종년봉조회요청
}


@pytest.mark.parametrize("mapping_id", sorted(_CHART_GOLDEN_CONTAINERS))
def test_build_chart_bars_succeeds_for_all_p2a_chart_trs(mapping_id: str) -> None:
    container_alias = _CHART_GOLDEN_CONTAINERS[mapping_id]
    payload = {"data": {container_alias: _CHART_GOLDEN_ROWS}}
    built = build_chart_bars(payload)
    assert not isinstance(built, str), f"{mapping_id} ({container_alias}): {built}"
    bars, meta = built
    assert meta["rows_kept"] == 1
    assert bars[0]["close"] == 71000.0
    assert set(meta) == {
        "rows_total",
        "rows_kept",
        "trimmed",
        "first_time",
        "last_time",
        "latest_close",
    }


# ---------------------------------------------------------------------------
# P2a/P2b — resolve_chart_initial_period (manifest presentation.controls.
# default_period 조회, P2a Deliverable). 8TR은 실제 값, 4TR(P2b)/비차트/미등록/
# 부재는 전부 None으로 수렴한다 — 호출부가 그 경우 data에 "initial"을 아예
# 싣지 않는다(canvas_data.py/canvas_push.py).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("mapping_id", "expected_period"),
    [
        ("base:ka10081", "D"),
        ("base:ka10082", "W"),
        ("base:ka10083", "M"),
        ("base:ka10094", "Y"),
        ("base:ka20006", "D"),
        ("base:ka20007", "W"),
        ("base:ka20008", "M"),
        ("base:ka20019", "Y"),
    ],
)
def test_resolve_chart_initial_period_returns_default_period_for_p2a_trs(
    mapping_id: str, expected_period: str
) -> None:
    assert resolve_chart_initial_period(mapping_id) == expected_period


@pytest.mark.parametrize(
    "mapping_id",
    ["base:ka10079", "base:ka10080", "base:ka20004", "base:ka20005"],
)
def test_resolve_chart_initial_period_is_none_for_p2b_minute_tick_trs(
    mapping_id: str,
) -> None:
    """P2b(분/틱 4TR) 의도적 비배선 — manifest에 default_period=null이 있어도
    이 함수는 None으로 정규화한다(호출부는 None만 보고 initial을 생략한다)."""
    assert resolve_chart_initial_period(mapping_id) is None


def test_resolve_chart_initial_period_is_none_for_non_chart_mapping() -> None:
    assert resolve_chart_initial_period("base:ka00001") is None  # facts, controls 필드 없음


def test_resolve_chart_initial_period_is_none_for_unregistered_or_missing_operation_ref() -> None:
    assert resolve_chart_initial_period("base:does-not-exist") is None
    assert resolve_chart_initial_period(None) is None
    assert resolve_chart_initial_period("") is None


@pytest.mark.parametrize(
    "mapping_id",
    [
        "base:ka10079",
        "base:ka10094",
        "base:ka20004",
        "base:ka20019",
        "base:ka50079",
        "base:ka50083",
        "base:ka50091",
        "base:ka50092",
    ],
)
def test_resolve_render_plan_kind_uses_explicit_aits_renderer(mapping_id: str) -> None:
    assert resolve_render_plan_kind(mapping_id) == "chart"


@pytest.mark.parametrize("mapping_id", ["base:ka10060", "base:ka10064"])
def test_chart_named_table_operations_are_not_promoted(mapping_id: str) -> None:
    assert resolve_render_plan_kind(mapping_id) == "table"


def test_runtime_rejects_ambiguous_gold_reload_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    definitions = deepcopy(canvas_transform._screen_definitions())
    today = definitions["base:ka50091"]["data"]["chart"]
    today["series_scope"] = "generic"
    today["reload_group"] = "gold-generic"
    monkeypatch.setattr(canvas_transform, "_screen_definitions", lambda: definitions)
    resolved = resolve_screen_render_contract("base:ka50079")
    assert resolved == "AITS reload target가 중복되어 모호하다"
