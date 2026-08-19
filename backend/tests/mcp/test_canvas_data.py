"""canvas_data — render_canvas plan_token 데이터 지름길 (2026-08-19).

계약: 변환은 결정적, 실패는 조용한 폴백이 아니라 에러 안내, 주문 확인 헤더는
절대 싣지 않는다(조회 전용). 봉은 시간 오름차순·최신 BARS_MAX개.
"""

from __future__ import annotations

import json
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
            json={"data": {"stk_dt_pole_chart_qry": _chart_rows(10)}},
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
    assert pushed["data"]["symbol"] == "005930"
    assert len(pushed["data"]["bars"]) == 10
    assert pushed["data"]["bars"][0]["time"] < pushed["data"]["bars"][-1]["time"]


async def test_render_with_plan_requires_symbol_for_chart(mock_http_client):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": {"rows": _chart_rows(3)}})

    result = await render_with_plan(
        {"canvas_type": "chart", "plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "data.symbol" in result.content[0].text


async def test_render_with_plan_rejects_unsupported_canvas_type(mock_http_client):
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("호출되면 안 된다")

    result = await render_with_plan(
        {"canvas_type": "stream", "plan_token": "tok", "data": {}},
        mock_http_client(handler),
        call_timeout_seconds=5.0,
    )
    assert result.isError is True
    assert "chart" in result.content[0].text


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
        return httpx.Response(200, json={"data": {"rows": _chart_rows(3)}})

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
