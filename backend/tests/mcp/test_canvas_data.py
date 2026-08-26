
from __future__ import annotations

import json
import logging

import httpx
import pytest

from athena_mcp.canvas_data import (
    TABLE_ROWS_MAX,
    build_table,
    render_with_plan,
)

_AITS_CHART_CASES = [
    ("ka10079", "tick", "stock", "stk_tic_chart_qry", "cntr_tm", "cur_prc", "trde_qty"),
    ("ka10080", "min", "stock", "stk_min_pole_chart_qry", "cntr_tm", "cur_prc", "trde_qty"),
    ("ka10081", "day", "stock", "stk_dt_pole_chart_qry", "dt", "cur_prc", "trde_qty"),
    ("ka10082", "week", "stock", "stk_stk_pole_chart_qry", "dt", "cur_prc", "trde_qty"),
    ("ka10083", "month", "stock", "stk_mth_pole_chart_qry", "dt", "cur_prc", "trde_qty"),
    ("ka10094", "year", "stock", "stk_yr_pole_chart_qry", "dt", "cur_prc", "trde_qty"),
    ("ka20004", "tick", "sector", "inds_tic_chart_qry", "cntr_tm", "cur_prc", "trde_qty"),
    ("ka20005", "min", "sector", "inds_min_pole_qry", "cntr_tm", "cur_prc", "trde_qty"),
    ("ka20006", "day", "sector", "inds_dt_pole_qry", "dt", "cur_prc", "trde_qty"),
    ("ka20007", "week", "sector", "inds_stk_pole_qry", "dt", "cur_prc", "trde_qty"),
    ("ka20008", "month", "sector", "inds_mth_pole_qry", "dt", "cur_prc", "trde_qty"),
    ("ka20019", "year", "sector", "inds_yr_pole_qry", "dt", "cur_prc", "trde_qty"),
    ("ka50079", "tick", "gold", "gds_tic_chart_qry", "cntr_tm", "cur_prc", "trde_qty"),
    ("ka50080", "min", "gold", "gds_min_chart_qry", "cntr_tm", "cur_prc", "trde_qty"),
    ("ka50081", "day", "gold", "gds_day_chart_qry", "dt", "cur_prc", "acc_trde_qty"),
    ("ka50082", "week", "gold", "gds_week_chart_qry", "dt", "cur_prc", "acc_trde_qty"),
    ("ka50083", "month", "gold", "gds_month_chart_qry", "dt", "cur_prc", "acc_trde_qty"),
    ("ka50091", "tick", "gold", "gds_tic_chart_qry", "cntr_tm", "cntr_pric", "trde_qty"),
    ("ka50092", "min", "gold", "gds_min_chart_qry", "cntr_tm", "cntr_pric", "trde_qty"),
]

_AITS_RELOAD_CONTRACTS = {
    "stock": {
        "tick": ("base:ka10079", ["stk_cd", "tic_scope", "upd_stkpc_tp"]),
        "min": ("base:ka10080", ["stk_cd", "tic_scope", "upd_stkpc_tp", "base_dt"]),
        "day": ("base:ka10081", ["stk_cd", "base_dt", "upd_stkpc_tp"]),
        "week": ("base:ka10082", ["stk_cd", "base_dt", "upd_stkpc_tp"]),
        "month": ("base:ka10083", ["stk_cd", "base_dt", "upd_stkpc_tp"]),
        "year": ("base:ka10094", ["stk_cd", "base_dt", "upd_stkpc_tp"]),
    },
    "sector": {
        "tick": ("base:ka20004", ["inds_cd", "tic_scope"]),
        "min": ("base:ka20005", ["inds_cd", "tic_scope", "base_dt"]),
        "day": ("base:ka20006", ["inds_cd", "base_dt"]),
        "week": ("base:ka20007", ["inds_cd", "base_dt"]),
        "month": ("base:ka20008", ["inds_cd", "base_dt"]),
        "year": ("base:ka20019", ["inds_cd", "base_dt"]),
    },
    "gold-generic": {
        "tick": ("base:ka50079", ["stk_cd", "tic_scope", "upd_stkpc_tp"]),
        "min": ("base:ka50080", ["stk_cd", "tic_scope", "upd_stkpc_tp"]),
        "day": ("base:ka50081", ["stk_cd", "base_dt", "upd_stkpc_tp"]),
        "week": ("base:ka50082", ["stk_cd", "base_dt", "upd_stkpc_tp"]),
        "month": ("base:ka50083", ["stk_cd", "base_dt", "upd_stkpc_tp"]),
    },
    "gold-today": {
        "tick": ("base:ka50091", ["stk_cd", "tic_scope"]),
        "min": ("base:ka50092", ["stk_cd", "tic_scope"]),
    },
}


def _aits_chart_rows(time_alias: str, close_alias: str, volume_alias: str) -> list[dict[str, str]]:
    times = (
        ["20260821100000", "20260821090000"]
        if time_alias == "cntr_tm"
        else ["20260821", "20260820"]
    )
    return [
        {
            time_alias: time_value,
            "open_pric": "+120200",
            "high_pric": "374500",
            "low_pric": "-119000",
            close_alias: close,
            volume_alias: "1000",
        }
        for time_value, close in zip(times, ("247500", "246000"), strict=True)
    ]


def test_build_table_caps_rows_and_derives_columns():
    rows = [{"a": str(i), "b": "x"} for i in range(80)]
    built = build_table({"data": {"list": rows}})
    assert not isinstance(built, str)
    data, meta = built
    assert len(data["rows"]) == TABLE_ROWS_MAX
    assert [c["key"] for c in data["columns"]] == ["a", "b"]
    assert meta["trimmed"] is True


# `_client` 헬퍼는 tests/mcp/conftest.py의 `mock_http_client` 픽스처로 옮겼다.


@pytest.mark.parametrize(
    (
        "tr_id",
        "period",
        "target",
        "container_alias",
        "time_alias",
        "close_alias",
        "volume_alias",
    ),
    _AITS_CHART_CASES,
)
async def test_render_with_plan_all_generated_chart_contracts_push_aits_envelope_only(
    mock_http_client,
    tr_id: str,
    period: str,
    target: str,
    container_alias: str,
    time_alias: str,
    close_alias: str,
    volume_alias: str,
):
    """19개 generated 차트 계약을 caller 추론 없이 AITS 봉투로 side-channel 전송한다."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            seen["pushed_envelope"] = json.loads(request.content)
            return httpx.Response(200, json={"queued": True})
        seen["call_count"] = seen.get("call_count", 0) + 1
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        seen["headers"] = dict(request.headers)
        return httpx.Response(
            200,
            json={
                "operation_ref": f"base:{tr_id}",
                "data": {container_alias: _aits_chart_rows(time_alias, close_alias, volume_alias)},
                "canvas_context": {"symbol": "SIGNED-SYMBOL"},
            },
        )

    result = await render_with_plan(
        {
            "canvas_type": "chart",
            "plan_token": f"tok-{tr_id}",
            "data": {
                "symbol": "CONFLICTING",
                "chart_meta": {
                    "series_scope": "caller-controlled",
                    "reload_group": "gold-today",
                    "reload_targets": {
                        "tick": {"operation_ref": "base:ka50091", "request_fields": []}
                    },
                },
            },
        },
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is False
    assert seen["path"] == "/api/v1/llm/tools/call"
    assert seen["call_count"] == 1
    assert seen["body"] == {"plan_token": f"tok-{tr_id}"}
    # 조회 전용 — 주문 확인 헤더를 절대 싣지 않는다(3중 게이트가 주문 plan을 거부).
    assert "x-athena-confirm" not in seen["headers"]
    payload = json.loads(result.content[0].text)
    # 모델에게는 값 없는 display receipt만 — 봉투(데이터)는 side-channel로 밀렸다.
    assert payload["pushed"] is True
    assert payload["canvas_type"] == "chart"
    assert set(payload) == {
        "canvas_type",
        "pushed",
        "fell_back",
        "fallback_reason",
        "trimmed",
        "partial",
    }
    receipt_text = result.content[0].text
    for forbidden in (
        f"tok-{tr_id}",
        "SIGNED-SYMBOL",
        "247500",
        "candles",
        "close",
        "rows_total",
        "summary",
    ):
        assert forbidden not in receipt_text
    pushed = seen["pushed_envelope"]
    assert pushed["canvas_type"] == "chart"
    assert pushed["fell_back"] is False
    assert pushed["renderer_id"] == "aits-chart-v1"
    assert set(pushed["data"]) == {"symbol", "chart", "chart_meta"}
    assert pushed["data"]["symbol"] == "SIGNED-SYMBOL"
    chart = pushed["data"]["chart"]
    assert chart["period"] == period
    assert chart["target"] == target
    assert chart["trId"] == tr_id
    assert chart["candles"][0]["time"] < chart["candles"][-1]["time"]
    assert chart["candles"][-1]["close"] == 247500.0
    assert "bars" not in pushed["data"]
    assert "initial" not in pushed["data"]
    chart_meta = pushed["data"]["chart_meta"]
    assert set(chart_meta) == {"series_scope", "reload_group", "reload_targets"}
    if target == "stock":
        expected_scope, expected_group = "standard", "stock"
    elif target == "sector":
        expected_scope, expected_group = "standard", "sector"
    elif tr_id in {"ka50091", "ka50092"}:
        expected_scope, expected_group = "today", "gold-today"
    else:
        expected_scope, expected_group = "generic", "gold-generic"
    assert chart_meta["series_scope"] == expected_scope
    assert chart_meta["reload_group"] == expected_group
    assert chart_meta["reload_targets"] == {
        reload_period: {
            "operation_ref": operation_ref,
            "request_fields": request_fields,
        }
        for reload_period, (operation_ref, request_fields) in _AITS_RELOAD_CONTRACTS[
            expected_group
        ].items()
    }
    # gold generic(50079/80 포함)과 today(50091/92)는 서로의 reload 후보를
    # 절대 포함하지 않는다. caller가 보낸 gold-today 메타도 helper 입력이 아니다.
    reload_refs = {
        target_contract["operation_ref"]
        for target_contract in chart_meta["reload_targets"].values()
    }
    if expected_group == "gold-generic":
        assert reload_refs.isdisjoint({"base:ka50091", "base:ka50092"})
    elif expected_group == "gold-today":
        assert reload_refs.isdisjoint({"base:ka50079", "base:ka50080"})


async def test_render_with_plan_requires_sealed_symbol_for_chart(mock_http_client):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "operation_ref": "base:ka10081",
                "data": {"stk_dt_pole_chart_qry": _aits_chart_rows("dt", "cur_prc", "trde_qty")},
            },
        )

    result = await render_with_plan(
        {"canvas_type": "chart", "plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "display symbol" in result.content[0].text


async def test_render_with_plan_manifest_wins_over_mismatched_model_canvas_type_hint(
    mock_http_client, caplog
):
    """모델이 canvas_type="table"을 보내도 operation_ref=base:ka00001은 manifest상
    facts다 — manifest가 이기고, 불일치는 조용히 넘기지 않고 로그에 남는다."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            seen["pushed_envelope"] = json.loads(request.content)
            return httpx.Response(200, json={"queued": True})
        return httpx.Response(
            200,
            json={
                "operation_ref": "base:ka00001",
                "data": {"stk_cd": "005930", "stk_nm": "삼성전자", "cur_prc": "71000"},
                "continuation": {"cont_yn": "N"},
            },
        )

    with caplog.at_level(logging.WARNING, logger="athena_mcp.canvas_data"):
        result = await render_with_plan(
            {"canvas_type": "table", "plan_token": "tok", "data": {}},
            mock_http_client(handler),
            call_timeout_seconds=5.0,
        )
    assert result.isError is False
    pushed = seen["pushed_envelope"]
    # manifest(facts)가 이겼다 — 모델이 보낸 "table"이 아니다.
    assert pushed["canvas_type"] == "facts"
    # 봉투 필드(operation_ref/continuation)를 TR 필드로 오인하지 않았다 —
    # call_payload["data"]만 넘겼다는 증거(추출된 3필드만 있어야 한다).
    assert [f["key"] for f in pushed["data"]["fields"]] == ["stk_cd", "stk_nm", "cur_prc"]
    assert "operation_ref" not in [f["key"] for f in pushed["data"]["fields"]]
    assert any("불일치" in record.message for record in caplog.records)


async def test_render_with_plan_facts_golden_path(mock_http_client):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            seen["pushed_envelope"] = json.loads(request.content)
            return httpx.Response(200, json={"queued": True})
        return httpx.Response(
            200,
            json={"operation_ref": "base:ka00001", "data": {"acctNo": "1234567890"}},
        )

    result = await render_with_plan(
        {"plan_token": "tok", "data": {}},  # canvas_type 생략 — 힌트 없이도 동작
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is False
    payload = json.loads(result.content[0].text)
    assert payload["canvas_type"] == "facts"
    assert payload["fell_back"] is False
    assert "summary" not in payload
    assert "1234567890" not in result.content[0].text
    pushed = seen["pushed_envelope"]
    assert "renderer_id" not in pushed
    assert pushed["data"]["fields"] == [{"key": "acctNo", "label": "acctNo", "value": "1234567890"}]


async def test_render_with_plan_compound_generic_golden_path(mock_http_client):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            seen["pushed_envelope"] = json.loads(request.content)
            return httpx.Response(200, json={"queued": True})
        return httpx.Response(
            200,
            json={
                "operation_ref": "base:ka01300",
                "data": {
                    "rtcd": "0",
                    "nofi": [
                        {"gcod": "001", "name": "삼성전자"},
                        {"gcod": "002", "name": "SK하이닉스"},
                    ],
                },
            },
        )

    result = await render_with_plan(
        {"plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is False
    payload = json.loads(result.content[0].text)
    assert payload["canvas_type"] == "compound"
    pushed = seen["pushed_envelope"]
    assert pushed["data"]["header"] == [{"key": "rtcd", "label": "rtcd", "value": "0"}]
    assert pushed["data"]["table"]["rows"] == [
        {"gcod": "001", "name": "삼성전자"},
        {"gcod": "002", "name": "SK하이닉스"},
    ]


async def test_render_with_plan_fails_closed_when_manifest_kind_is_not_read_display(
    mock_http_client, caplog
):
    """키움 guarded workflow는 legacy free 카드로 강등하지 않는다."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            seen["pushed_envelope"] = json.loads(request.content)
            return httpx.Response(200, json={"queued": True})
        return httpx.Response(
            200, json={"operation_ref": "base:ka10173", "data": {"some": "ws-field"}}
        )

    with caplog.at_level(logging.WARNING, logger="athena_mcp.canvas_data"):
        result = await render_with_plan(
            {"canvas_type": "stream", "plan_token": "tok", "data": {}},
            mock_http_client(handler),
            call_timeout_seconds=5.0,
        )
    assert result.isError is True
    assert "화면 계약 오류" in result.content[0].text
    assert "ws-field" not in result.content[0].text
    assert "pushed_envelope" not in seen
    assert any("coverage 결함" in record.message for record in caplog.records)


async def test_render_with_plan_ka10174_fails_closed(mock_http_client):
    """ka10173과 별개로 ka10174(layout="event", shape="scalar_only")도 명시 검증한다
    — 계획 §P1b 수용 기준이 두 TR을 각각 이름으로 지정한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            return httpx.Response(200, json={"queued": True})
        return httpx.Response(200, json={"operation_ref": "base:ka10174", "data": {}})

    result = await render_with_plan(
        {"plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "화면 계약 오류" in result.content[0].text


async def test_render_with_plan_fails_closed_when_operation_ref_missing(mock_http_client):
    """plan 실행 응답에 operation_ref가 없으면 coverage 오류로 닫는다."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            return httpx.Response(200, json={"queued": True})
        return httpx.Response(200, json={"data": {"foo": "bar"}})

    result = await render_with_plan(
        {"plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "mapping" in result.content[0].text
    assert "foo" not in result.content[0].text


async def test_render_with_plan_fails_closed_when_screen_reference_missing(
    mock_http_client, monkeypatch
):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"operation_ref": "base:ka00001", "data": {"cur_prc": "73500"}},
        )

    monkeypatch.setattr(
        "athena_mcp.canvas_data.get_mapping",
        lambda _operation_ref: {"screen_reference": {}},
    )
    result = await render_with_plan(
        {"plan_token": "screen-gap-secret"},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "screen_reference" in result.content[0].text
    assert "73500" not in result.content[0].text
    assert "screen-gap-secret" not in result.content[0].text


async def test_render_with_plan_surfaces_backend_error(mock_http_client):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"detail": "PLAN_ALREADY_USED"})

    result = await render_with_plan(
        {"canvas_type": "table", "plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "409" in result.content[0].text


async def test_render_with_plan_push_failure_is_truthful_without_inline_data(mock_http_client):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            return httpx.Response(503, json={"detail": "채널 미준비"})
        return httpx.Response(
            200,
            json={
                "operation_ref": "base:ka10081",
                "data": {"stk_dt_pole_chart_qry": _aits_chart_rows("dt", "cur_prc", "trde_qty")},
                "canvas_context": {"symbol": "005930"},
            },
        )

    result = await render_with_plan(
        {"plan_token": "tok"},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert result.content[0].text == "캔버스 push 실패: HTTP 503"
    for forbidden in ("005930", "247500", "bars", "close", "summary"):
        assert forbidden not in result.content[0].text
