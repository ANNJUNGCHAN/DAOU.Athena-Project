"""canvas_data — render_canvas plan_token 데이터 지름길 (2026-08-19).

계약: 변환은 결정적, 실패는 조용한 폴백이 아니라 에러 안내, 주문 확인 헤더는
절대 싣지 않는다(조회 전용). 봉은 시간 오름차순·최신 BARS_MAX개.

P1b(2026-08-20, `plan/공통화면-템플릿-실행계획-2026-08-20.md`) 갱신: 카드 종류는
모델의 canvas_type이 아니라 plan 실행 결과 operation_ref로 조회한 manifest가
결정한다. 아래 테스트는 실제 manifest(`backend/ref/kiwoom-common-screen-manifest.json`)
의 실측 operation_ref를 그대로 쓴다(추측 픽스처가 아니다) — base:ka10081(차트,
domain=="charts" compound → "chart"로 승격), base:ka00001(facts), base:ka01300
(compound 제네릭), base:ka10173/ka10174(websocket → layout="event", 이 경로 밖).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

from athena_mcp.canvas_data import (
    BARS_MAX,
    TABLE_ROWS_MAX,
    build_chart_bars,
    build_table,
    render_with_plan,
)


def _chart_rows(n: int) -> list[dict[str, str]]:
    # 키움 실측 형상(ka10081): 최신이 앞, 가격은 문자열(때로 부호 접두).
    return [
        {
            "dt": str(20260819 - i),
            "open_pric": "+120200",
            "high_pric": "374500",
            "low_pric": "-119000",
            "cur_prc": "247500",
            "trde_qty": "1000",
        }
        for i in range(n)
    ]


def test_build_chart_bars_maps_sorts_and_trims():
    payload = {"operation_ref": "op", "data": {"stk_dt_pole_chart_qry": _chart_rows(300)}}
    built = build_chart_bars(payload)
    assert not isinstance(built, str)
    bars, meta = built
    assert len(bars) == BARS_MAX
    # 오름차순 + 최신 유지(최신 = 가장 큰 dt)
    assert bars[0]["time"] < bars[-1]["time"]
    assert bars[-1]["time"] == "2026-08-19"  # YYYYMMDD → 대시 변환(렌더러 파싱 계약)
    # 부호 접두는 값이 아니다
    assert bars[-1]["open"] == 120200.0
    assert bars[-1]["low"] == 119000.0
    assert bars[-1]["volume"] == 1000.0
    assert meta["rows_total"] == 300
    assert meta["rows_kept"] == BARS_MAX
    assert meta["trimmed"] is True
    assert meta["latest_close"] == 247500.0


def test_build_chart_bars_rejects_non_chart_payload():
    built = build_chart_bars({"data": {"rows": [{"foo": "1"}]}})
    assert isinstance(built, str)
    assert "매핑 실패" in built


def test_build_table_caps_rows_and_derives_columns():
    rows = [{"a": str(i), "b": "x"} for i in range(80)]
    built = build_table({"data": {"list": rows}})
    assert not isinstance(built, str)
    data, meta = built
    assert len(data["rows"]) == TABLE_ROWS_MAX
    assert [c["key"] for c in data["columns"]] == ["a", "b"]
    assert meta["trimmed"] is True


# `_client` 헬퍼는 tests/mcp/conftest.py의 `mock_http_client` 픽스처로 옮겼다
# (2026-08-20 포니테일 감사 — 4파일 중복 제거).


async def test_render_with_plan_chart_fills_envelope_and_summary(tmp_path: Path, mock_http_client):
    """operation_ref=base:ka10081(manifest layout=compound, domain=charts)이
    "chart"로 승격되고 실제로 build_chart_bars 경로를 탄다 — 모델이 canvas_type=
    "chart"를 맞게 보내도(불일치 로그 없이) 카드 종류는 manifest가 정한다."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            seen["pushed_envelope"] = json.loads(request.content)
            return httpx.Response(200, json={"queued": True})
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        seen["headers"] = dict(request.headers)
        return httpx.Response(
            200,
            json={
                "operation_ref": "base:ka10081",
                "data": {"stk_dt_pole_chart_qry": _chart_rows(10)},
            },
        )

    result = await render_with_plan(
        {
            "canvas_type": "chart",
            "plan_token": "tok-1",
            "data": {"symbol": "005930", "name": "삼성전자"},
        },
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is False
    assert seen["path"] == "/api/v1/llm/tools/call"
    assert seen["body"] == {"plan_token": "tok-1"}
    # 조회 전용 — 주문 확인 헤더를 절대 싣지 않는다(3중 게이트가 주문 plan을 거부).
    assert "x-athena-confirm" not in seen["headers"]
    payload = json.loads(result.content[0].text)
    # 모델에게는 요약만 — 봉투(데이터)는 사이드 채널로 밀렸다.
    assert payload["pushed"] is True
    assert payload["canvas_type"] == "chart"
    assert "data" not in payload
    assert payload["summary"]["rows_total"] == 10
    assert payload["summary"]["latest_close"] == 247500.0
    pushed = seen["pushed_envelope"]
    assert pushed["canvas_type"] == "chart"
    assert pushed["fell_back"] is False
    assert pushed["data"]["symbol"] == "005930"
    assert len(pushed["data"]["bars"]) == 10
    assert pushed["data"]["bars"][0]["time"] < pushed["data"]["bars"][-1]["time"]


async def test_render_with_plan_requires_symbol_for_chart(mock_http_client):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"operation_ref": "base:ka10081", "data": {"rows": _chart_rows(3)}},
        )

    result = await render_with_plan(
        {"canvas_type": "chart", "plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "data.symbol" in result.content[0].text


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
    assert payload["summary"]["fields_total"] == 1
    pushed = seen["pushed_envelope"]
    assert pushed["data"]["fields"] == [
        {"key": "acctNo", "label": "acctNo", "value": "1234567890"}
    ]


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


async def test_render_with_plan_falls_back_to_free_when_manifest_kind_unsupported(
    mock_http_client, caplog
):
    """구 `test_render_with_plan_rejects_unsupported_canvas_type` 자리 —
    의미가 바뀌었다(P1b): 모델이 선언한 canvas_type이 아니라 manifest가 가리키는
    카드 종류가 이 경로의 지원 목록(chart/table/facts/compound) 밖일 때, 크래시
    (isError)가 아니라 free 카드로 폴백하고 사유를 로그·응답에 남긴다.
    base:ka10173은 websocket TR이라 manifest layout="event" — 이 read/display
    plan_token 경로 범위 밖이다(§11 미해결 3, "이종 메시지 사각지대" 방어)."""
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
    assert result.isError is False
    payload = json.loads(result.content[0].text)
    assert payload["canvas_type"] == "free"
    assert payload["fell_back"] is True
    assert payload["fallback_reason"] is not None
    pushed = seen["pushed_envelope"]
    assert pushed["canvas_type"] == "free"
    assert pushed["fell_back"] is True
    assert any("free 폴백" in record.message for record in caplog.records)


async def test_render_with_plan_ka10174_falls_back_to_free(mock_http_client):
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
    assert result.isError is False
    payload = json.loads(result.content[0].text)
    assert payload["canvas_type"] == "free"
    assert payload["fell_back"] is True


async def test_render_with_plan_falls_back_to_free_when_operation_ref_missing(mock_http_client):
    """plan 실행 응답에 operation_ref 자체가 없는 방어적 경우 — 크래시하지 않는다."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            return httpx.Response(200, json={"queued": True})
        return httpx.Response(200, json={"data": {"foo": "bar"}})

    result = await render_with_plan(
        {"plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is False
    payload = json.loads(result.content[0].text)
    assert payload["canvas_type"] == "free"
    assert payload["fell_back"] is True
    assert "operation_ref가 없다" in payload["fallback_reason"]


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


async def test_render_with_plan_falls_back_to_inline_when_push_fails(mock_http_client):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/canvas/push":
            return httpx.Response(503, json={"detail": "채널 미준비"})
        return httpx.Response(
            200,
            json={"operation_ref": "base:ka10081", "data": {"rows": _chart_rows(3)}},
        )

    result = await render_with_plan(
        {"canvas_type": "chart", "plan_token": "tok", "data": {"symbol": "005930"}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is False
    payload = json.loads(result.content[0].text)
    # 후퇴 경로 — 봉투를 툴 결과에 실었고, 실패 사실을 숨기지 않는다.
    assert "pushed" not in payload
    assert payload["push_failed"] == "HTTP 503"
    assert len(payload["data"]["bars"]) == 3
