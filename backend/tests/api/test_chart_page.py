"""POST /api/v1/canvas/chart-page — 원시 TR 응답 → canonical 봉.

이 라우트의 존재 이유는 별칭 표(container/time/OHLCV 경로)를 앱에 복제하지 않는
것이다. 그래서 검증의 초점도 "봉이 나온다"가 아니라 **화면 정의의 별칭을 실제로
따랐는가**와 **차트가 아닌 오퍼레이션을 확실히 거부하는가**다.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.dependencies import require_kiwoom_client
from athena_api.kiwoom.client import ResponseEnvelope
from athena_api.main import create_app

PATH = "/api/v1/canvas/chart-page"
DAY_REF = "base:ka10081"


class FakeClient:
    def __init__(self, body: dict) -> None:
        self._body = body
        self.calls: list[tuple[str, str, dict, object]] = []

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, path, body, options))
        return ResponseEnvelope(body=self._body, cont_yn="N", next_key=None)


def _client(upstream: FakeClient) -> TestClient:
    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[require_kiwoom_client] = lambda: upstream
    return TestClient(app)


def _row(dt: str, close: str, volume: str = "100") -> dict:
    # ka10081 일봉 컨테이너의 실제 별칭 그대로. 값은 키움처럼 문자열이다.
    return {
        "dt": dt,
        "open_pric": "1000",
        "high_pric": "1100",
        "low_pric": "900",
        "cur_prc": close,
        "trde_qty": volume,
    }


def _day_body(rows: list[dict]) -> dict:
    return {"stk_dt_pole_chart_qry": rows}


def test_chart_page_maps_aliases_to_canonical_candles() -> None:
    upstream = FakeClient(_day_body([_row("20260825", "257000", "21617407")]))
    with _client(upstream) as client:
        res = client.post(
            PATH,
            json={"operation_ref": DAY_REF, "args": {"stk_cd": "005930", "base_dt": "20260825"}},
        )
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["tr_id"] == "ka10081"
    assert payload["period"] == "day"
    # 별칭이 실제로 풀렸는지 — cur_prc가 close로, trde_qty가 volume으로 간다.
    assert payload["candles"] == [
        {
            "time": "2026-08-25",
            "open": 1000.0,
            "high": 1100.0,
            "low": 900.0,
            "close": 257000.0,
            "volume": 21617407.0,
        }
    ]


def test_chart_page_forwards_args_to_the_upstream_tr() -> None:
    """커서(base_dt)가 그대로 TR에 실려야 과거 페이지가 의미를 갖는다."""
    upstream = FakeClient(_day_body([_row("20250829", "69700")]))
    with _client(upstream) as client:
        res = client.post(
            PATH,
            json={
                "operation_ref": DAY_REF,
                "args": {"stk_cd": "005930", "base_dt": "20250829", "upd_stkpc_tp": "1"},
            },
        )
    assert res.status_code == 200, res.text
    tr_id, _path, body, _options = upstream.calls[0]
    assert tr_id == "ka10081"
    assert body["base_dt"] == "20250829"
    assert body["stk_cd"] == "005930"
    assert body["upd_stkpc_tp"] == "1"


def test_chart_page_sorts_ascending_and_reports_trimming() -> None:
    """봉은 시간 오름차순이어야 하고, 상한을 넘겨 잘랐다면 그 사실을 말해야 한다."""
    rows = [_row(f"2026{month:02d}01", "1000") for month in range(12, 0, -1)]
    upstream = FakeClient(_day_body(rows))
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": DAY_REF, "args": {"stk_cd": "005930"}})
    assert res.status_code == 200, res.text
    payload = res.json()
    times = [candle["time"] for candle in payload["candles"]]
    assert times == sorted(times)
    assert payload["rows_total"] == 12
    assert payload["trimmed"] is False


def test_chart_page_refuses_non_chart_operation() -> None:
    """발주 TR은 화면 정의가 chart로 풀리지 않는다 — 여기 도달해도 거부된다."""
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": "base:kt10000", "args": {}})
    assert res.status_code == 422
    # 업스트림을 부르지도 않는다 — 거부는 호출 전에 끝난다.
    assert upstream.calls == []


def test_chart_page_refuses_unknown_operation_ref() -> None:
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": "base:nope999", "args": {}})
    assert res.status_code == 422
    assert upstream.calls == []


def test_chart_page_surfaces_transform_failure_instead_of_empty_candles() -> None:
    """컨테이너가 비면 빈 배열로 덮지 않는다 — 없는 것과 못 만든 것은 다르다."""
    upstream = FakeClient({"stk_dt_pole_chart_qry": []})
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": DAY_REF, "args": {"stk_cd": "005930"}})
    assert res.status_code == 502
    assert "차트 행" in res.json()["detail"]


def test_chart_page_rejects_unknown_body_fields() -> None:
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(
            PATH, json={"operation_ref": DAY_REF, "args": {}, "plan_token": "x"}
        )
    assert res.status_code == 422
