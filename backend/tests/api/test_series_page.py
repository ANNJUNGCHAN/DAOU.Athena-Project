"""POST /api/v1/canvas/series-page — table 계약 시계열 → canonical series.

검증의 초점은 "값이 나온다"가 아니라 **계약을 따랐는가**다:
별칭을 화면 정의에서 풀었는가, 지정하지 않은 열을 멋대로 고르지 않는가,
차트/발주/WS 계약을 확실히 거부하는가, 순매수의 **부호를 살렸는가**.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.dependencies import require_kiwoom_client
from athena_api.kiwoom.client import ResponseEnvelope
from athena_api.main import create_app

PATH = "/api/v1/canvas/series-page"
SHORT_SALE = "base:ka10014"       # 공매도추이 · dt 축
INVESTOR = "base:ka10060"          # 종목별투자자기관별차트 · dt 축 · 분류 다수
INTRADAY = "base:ka10064"          # 장중투자자별매매차트 · tm 축(날짜 필드 없음)
NO_TIME = "base:ka10058"           # 투자자별일별매매종목 · 시간축 미선언
CHART = "base:ka10081"             # 일봉 · chart 계약
ORDER = "base:kt10000"             # 발주


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


def test_series_page_resolves_label_from_contract() -> None:
    upstream = FakeClient({"shrts_trnsn": [{"dt": "20260825", "shrts_qty": "1234"}]})
    with _client(upstream) as client:
        res = client.post(
            PATH,
            json={
                "operation_ref": SHORT_SALE,
                "args": {"stk_cd": "005930"},
                "fields": ["shrts_qty"],
            },
        )
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["tr_id"] == "ka10014"
    assert payload["series"] == [
        {
            "field": "shrts_qty",
            # 앱이 지어낸 이름이 아니라 화면 정의의 label이다.
            "label": "공매도량",
            "points": [{"time": "2026-08-25", "value": 1234.0}],
        }
    ]


def test_series_page_returns_multiple_columns_in_one_call() -> None:
    """개인·기관·외국인을 한 번에 받는다 — 분류마다 왕복하지 않는다."""
    upstream = FakeClient(
        {
            "stk_invsr_orgn_chart": [
                {"dt": "20260825", "ind_invsr": "100", "orgn": "-200", "frgnr_invsr": "+300"}
            ]
        }
    )
    with _client(upstream) as client:
        res = client.post(
            PATH,
            json={
                "operation_ref": INVESTOR,
                "args": {"stk_cd": "005930"},
                "fields": ["ind_invsr", "orgn", "frgnr_invsr"],
            },
        )
    assert res.status_code == 200, res.text
    series = res.json()["series"]
    assert [entry["label"] for entry in series] == ["개인투자자", "기관계", "외국인투자자"]
    assert len(upstream.calls) == 1


def test_series_page_preserves_sign_of_net_buy() -> None:
    """순매수량은 부호가 곧 의미다 — -200은 200주 순매도지 순매수가 아니다."""
    upstream = FakeClient({"stk_invsr_orgn_chart": [{"dt": "20260825", "orgn": "-200"}]})
    with _client(upstream) as client:
        res = client.post(
            PATH, json={"operation_ref": INVESTOR, "args": {}, "fields": ["orgn"]}
        )
    assert res.status_code == 200, res.text
    assert res.json()["series"][0]["points"][0]["value"] == -200.0


def test_series_page_sorts_ascending_and_dedupes() -> None:
    upstream = FakeClient(
        {
            "shrts_trnsn": [
                {"dt": "20260825", "shrts_qty": "3"},
                {"dt": "20260823", "shrts_qty": "1"},
                {"dt": "20260824", "shrts_qty": "2"},
                {"dt": "20260825", "shrts_qty": "9"},  # 같은 날 중복 — 뒤엣것을 쓴다
            ]
        }
    )
    with _client(upstream) as client:
        res = client.post(
            PATH, json={"operation_ref": SHORT_SALE, "args": {}, "fields": ["shrts_qty"]}
        )
    assert res.status_code == 200, res.text
    points = res.json()["series"][0]["points"]
    assert [p["time"] for p in points] == ["2026-08-23", "2026-08-24", "2026-08-25"]
    assert points[-1]["value"] == 9.0


def test_series_page_combines_trading_date_for_intraday() -> None:
    """장중 계약은 컨테이너에 날짜가 없다 — args의 거래일과 결합해야 시각이 선다."""
    upstream = FakeClient({"opmr_invsr_trde_chart": [{"tm": "093000", "orgn": "55"}]})
    with _client(upstream) as client:
        res = client.post(
            PATH,
            json={
                "operation_ref": INTRADAY,
                "args": {"stk_cd": "005930"},
                "base_dt": "20260825",
                "fields": ["orgn"],
            },
        )
    assert res.status_code == 200, res.text
    at = res.json()["series"][0]["points"][0]["time"]
    # 2026-08-25 09:30 KST = 2026-08-25 00:30 UTC
    assert at == 1787617800


def test_series_page_refuses_intraday_without_trading_date() -> None:
    """거래일이 없으면 오늘로 추측하지 않고 사유를 돌려준다."""
    upstream = FakeClient({"opmr_invsr_trde_chart": [{"tm": "093000", "orgn": "55"}]})
    with _client(upstream) as client:
        res = client.post(
            PATH, json={"operation_ref": INTRADAY, "args": {"stk_cd": "005930"}, "fields": ["orgn"]}
        )
    assert res.status_code == 502
    assert "거래일" in res.json()["detail"]


def test_series_page_refuses_chart_contract() -> None:
    """일봉은 chart-page로 가야 한다."""
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": CHART, "args": {}, "fields": ["x"]})
    assert res.status_code == 422
    assert upstream.calls == []


def test_series_page_refuses_contract_without_time_axis() -> None:
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": NO_TIME, "args": {}, "fields": ["x"]})
    assert res.status_code == 422
    # 업스트림을 부르지도 않는다 — 거부는 호출 전에 끝난다.
    assert upstream.calls == []


def test_series_page_refuses_order_tr() -> None:
    """발주 TR은 read_display가 아니라 resolve_screen_render_contract가 먼저 막는다."""
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": ORDER, "args": {}, "fields": ["x"]})
    assert res.status_code == 422
    assert upstream.calls == []


def test_series_page_refuses_empty_fields() -> None:
    """열을 자동으로 고르지 않는다 — column_priority 첫 열이 현재가인 계약이 있다."""
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(PATH, json={"operation_ref": SHORT_SALE, "args": {}, "fields": []})
    assert res.status_code == 422
    assert upstream.calls == []


def test_series_page_refuses_column_outside_allowlist() -> None:
    upstream = FakeClient({"shrts_trnsn": [{"dt": "20260825", "shrts_qty": "1"}]})
    with _client(upstream) as client:
        res = client.post(
            PATH, json={"operation_ref": SHORT_SALE, "args": {}, "fields": ["nope"]}
        )
    assert res.status_code == 502
    assert "계약에 없는 열" in res.json()["detail"]


def test_series_page_rejects_unknown_body_fields() -> None:
    upstream = FakeClient({})
    with _client(upstream) as client:
        res = client.post(
            PATH,
            json={
                "operation_ref": SHORT_SALE,
                "args": {},
                "fields": ["shrts_qty"],
                "plan_token": "x",
            },
        )
    assert res.status_code == 422
