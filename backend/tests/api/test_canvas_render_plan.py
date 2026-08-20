"""캔버스 render-plan 라우트(api/canvas_push.py::canvas_render_plan) — P1b(2026-08-20).

카드 종류는 caller의 canvas_type이 아니라 plan 실행 결과 operation_ref로 조회한
manifest가 결정한다(콜드 경로 canvas_data.py와 같은 정책·같은 공유 함수
`canvas_transform.resolve_render_plan_kind`). 여기서는 두 층을 나눠 검증한다:

- `RenderPlanRequest` 스키마 단위 테스트 — canvas_type 정규식 완화(계획 §Q3
  [r5·Critic 잔여])가 facts/compound를 실제로 통과시키는지.
- 실제 FastAPI 앱 + selector 파이프라인을 태우는 HTTP 왕복 테스트(happy path,
  test_llm_tools_api.py의 _service/_client/_resolve 패턴과 동형) — upstream
  Kiwoom 응답만 FakeClient로 대체해, facts 페이로드가 422 없이 라우트 본문에
  도달하고 manifest가 정한 카드로 큐에 실제로 쌓이는지 증명한다.
- `canvas_render_plan()` 함수를 selector 스텁으로 직접 호출하는 화이트박스
  테스트 — manifest가 이 경로 밖(event/websocket)을 가리킬 때의 free 폴백과
  caller/manifest 불일치 로그를 검증한다(콜드 경로 대응 시나리오와 동형,
  websocket kind를 실제 selector.call로 왕복시키는 건 이 phase 범위 밖이다 —
  판정 로직 자체는 canvas_transform.resolve_render_plan_kind 하나를 콜드
  경로와 공유하므로 test_canvas_data.py의 ka10173/ka10174 케이스가 이미
  전수 검증한다).
"""

from __future__ import annotations

import asyncio
import json
import logging
from types import SimpleNamespace

import pytest
from fastapi import Response
from fastapi.testclient import TestClient
from pydantic import ValidationError

from athena_api.api.canvas_push import RenderPlanRequest, canvas_render_plan
from athena_api.config import Settings
from athena_api.dependencies import get_selector_service, require_kiwoom_client
from athena_api.kiwoom import ResponseEnvelope
from athena_api.main import create_app
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog
from athena_api.selector.schemas import CallResponse, ContinuationOutput

# ---------------------------------------------------------------------------
# RenderPlanRequest 스키마 — 정규식 완화 (계획 §Q3 [r5·Critic 잔여])
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("canvas_type", ["chart", "table", "facts", "compound"])
def test_render_plan_request_accepts_all_four_render_plan_kinds(canvas_type: str) -> None:
    RenderPlanRequest(plan_token="tok", canvas_type=canvas_type, data={})


def test_render_plan_request_still_rejects_unknown_canvas_type() -> None:
    with pytest.raises(ValidationError):
        RenderPlanRequest(plan_token="tok", canvas_type="stream", data={})


# ---------------------------------------------------------------------------
# 실제 HTTP 왕복 — selector.call/PlanSigner까지 그대로 태운다
# (test_llm_tools_api.py::_service/_client/_resolve와 동형)
# ---------------------------------------------------------------------------


class FakeClient:
    is_ready = True

    def __init__(self, body: dict) -> None:
        self._body = body
        self.calls: list[tuple[str, str, dict, object]] = []

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, path, body, options))
        return ResponseEnvelope(body=self._body, cont_yn="N", next_key=None)


def _service() -> SelectorService:
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(
            b"canvas-render-plan-test-secret", ttl_seconds=120, nonce_factory=lambda: "fixed"
        ),
    )


def _client(service: SelectorService, upstream: FakeClient) -> TestClient:
    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[get_selector_service] = lambda: service
    app.dependency_overrides[require_kiwoom_client] = lambda: upstream
    return TestClient(app)


def _resolve(client: TestClient, operation_ref: str, arguments: dict) -> str:
    resolved = client.post(
        "/api/v1/llm/tools/resolve",
        json={"question": operation_ref, "arguments": arguments},
    )
    assert resolved.status_code == 200, resolved.text
    return resolved.json()["plan_token"]


def test_render_plan_http_roundtrip_facts_reaches_route_body_without_422():
    """정규식 완화 전이면 canvas_type="facts"가 파싱 단계에서 422로 죽었다
    (계획 §Q3 [r5·Critic 잔여] 수용 기준) — 완화 후 실제로 라우트 본문까지
    도달해 manifest(facts)와 일치하는 카드로 큐에 쌓임을 증명한다."""
    upstream = FakeClient({"acctNo": "1234567890"})
    with _client(_service(), upstream) as client:
        token = _resolve(client, "base:ka00001", {})
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "canvas_type": "facts", "data": {}},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["canvas_type"] == "facts"
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "facts"
        assert envelope["data"]["fields"] == [
            {"key": "acctNo", "label": "acctNo", "value": "1234567890"}
        ]


def test_render_plan_http_roundtrip_chart_domain_promotes_compound_to_chart():
    """base:ka10081은 manifest layout="compound"이지만 domain=="charts"라
    "chart"로 승격돼야 한다 — caller가 보낸 canvas_type과 무관하게(여기선 맞게
    보낸다) 기존 프로덕션 캔들스틱 경로(build_chart_bars)가 실제로 타는지
    HTTP 왕복으로 증명한다(회귀 위험이 가장 큰 지점)."""
    rows = [
        {
            "dt": "20260819",
            "open_pric": "120200",
            "high_pric": "121000",
            "low_pric": "119500",
            "cur_prc": "120800",
            "trde_qty": "1000",
        }
    ]
    upstream = FakeClient({"stk_cd": "005930", "stk_dt_pole_chart_qry": rows})
    with _client(_service(), upstream) as client:
        token = _resolve(
            client,
            "base:ka10081",
            {"stk_cd": "005930", "base_dt": "20260819", "upd_stkpc_tp": "0"},
        )
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "canvas_type": "chart",
                "data": {"symbol": "005930"},
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["canvas_type"] == "chart"
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "chart"
        assert envelope["data"]["symbol"] == "005930"
        assert len(envelope["data"]["bars"]) == 1
        # P2a — ka10081(주식일봉차트조회요청)은 default_period="D".
        assert envelope["data"]["initial"] == {"period": "D"}


def test_render_plan_http_roundtrip_chart_weekly_tr_carries_initial_period_w():
    """P2a 수용 기준의 "주봉 경로 실제 테스트" — base:ka10082(주식주봉차트조회요청)
    로 plan_token을 실행하면 카드 봉투에 initial.period="W"가 실려야 한다(사용자가
    든 예시: 주봉 TR을 부르면 카드가 'W' 탭 선택 상태로 열린다). 실 API 자격증명이
    없어 앱 캡처 대신 이 백엔드 HTTP 왕복으로 배선을 증명한다."""
    rows = [
        {
            "dt": "20260817",
            "open_pric": "120200",
            "high_pric": "121000",
            "low_pric": "119500",
            "cur_prc": "120800",
            "trde_qty": "5000",
        }
    ]
    upstream = FakeClient({"stk_cd": "005930", "stk_stk_pole_chart_qry": rows})
    with _client(_service(), upstream) as client:
        token = _resolve(
            client,
            "base:ka10082",
            {"stk_cd": "005930", "base_dt": "20260817", "upd_stkpc_tp": "0"},
        )
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "canvas_type": "chart",
                "data": {"symbol": "005930"},
            },
        )
        assert response.status_code == 200, response.text
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "chart"
        assert envelope["data"]["initial"] == {"period": "W"}


def test_render_plan_http_roundtrip_chart_tick_tr_omits_initial_period():
    """P2b(분/틱 4TR, 의도적 비배선) — base:ka10079(주식틱차트조회요청)는
    manifest에 default_period=null이 있어도, 카드 봉투에는 "initial" 키 자체가
    없어야 한다(호출부가 None을 생략, chart-card.js가 자체 'D' 폴백을 쓴다).
    틱 응답 실제 필드는 cntr_tm(체결시간)이라 dt가 없다 — build_chart_bars가
    이 실제 형상으로는 실패하므로, 여기서는 initial 배선 자체만 격리해 검증하기
    위해 dt를 포함한 형상을 넣는다(변환 성공 여부는 이 테스트의 관심사가 아니다;
    후속 라운드 필요조건 1이 실제 틱 필드 검증을 다룬다)."""
    rows = [
        {
            "dt": "20260819",
            "open_pric": "120200",
            "high_pric": "121000",
            "low_pric": "119500",
            "cur_prc": "120800",
            "trde_qty": "10",
        }
    ]
    upstream = FakeClient({"stk_cd": "005930", "stk_tic_chart_qry": rows})
    with _client(_service(), upstream) as client:
        token = _resolve(
            client,
            "base:ka10079",
            {"stk_cd": "005930", "tic_scope": "1", "upd_stkpc_tp": "0"},
        )
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "canvas_type": "chart",
                "data": {"symbol": "005930"},
            },
        )
        assert response.status_code == 200, response.text
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "chart"
        assert "initial" not in envelope["data"]


def test_render_plan_http_roundtrip_compound_generic_watchlist():
    upstream = FakeClient(
        {"rtcd": "S", "nofi": [{"gcod": "001", "name": "삼성전자"}]}
    )
    with _client(_service(), upstream) as client:
        token = _resolve(client, "base:ka01300", {})
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "canvas_type": "compound", "data": {}},
        )
        assert response.status_code == 200, response.text
        assert response.json()["canvas_type"] == "compound"
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "compound"
        assert envelope["data"]["header"] == [{"key": "rtcd", "label": "rtcd", "value": "S"}]
        assert envelope["data"]["table"]["rows"] == [{"gcod": "001", "name": "삼성전자"}]


# ---------------------------------------------------------------------------
# 화이트박스 — canvas_render_plan()을 selector 스텁으로 직접 호출.
# manifest 판정(resolve_render_plan_kind/describe_unsupported_render_plan_kind)은
# canvas_transform.py의 공유 함수라 test_canvas_data.py가 ka10173/ka10174를
# 포함해 전수 검증한다 — 여기서는 canvas_push.py 고유 로직(봉투 구성·큐 적재·
# 불일치 로그)만 겨냥한다.
# ---------------------------------------------------------------------------


class _StubSelector:
    def __init__(self, operation_ref: str, data: dict) -> None:
        self._response = CallResponse(
            operation_ref=operation_ref, data=data, continuation=ContinuationOutput(cont_yn="N")
        )

    async def call(self, call_request, request, response, client, **kwargs):
        return self._response


def _fake_request(queue: asyncio.Queue) -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(canvas_events=queue)))


async def test_canvas_render_plan_falls_back_to_free_when_manifest_kind_unsupported(caplog):
    """base:ka10173은 websocket TR이라 manifest layout="event" — 이 read/display
    plan_token 경로 범위 밖이다. 크래시(422/500)가 아니라 free 카드로 폴백한다."""
    queue: asyncio.Queue = asyncio.Queue(10)
    selector = _StubSelector("base:ka10173", {"some": "ws-field"})
    payload = RenderPlanRequest(plan_token="tok", canvas_type="table", data={})

    with caplog.at_level(logging.WARNING, logger="athena_api.api.canvas_push"):
        result = await canvas_render_plan(
            payload,
            _fake_request(queue),
            Response(),
            client=None,
            order_client=None,
            ws_client=None,
            selector=selector,
            account="",
        )

    body = json.loads(result.body)
    assert body["canvas_type"] == "free"
    assert body["summary"]["fell_back"] is True
    envelope = queue.get_nowait()
    assert envelope["canvas_type"] == "free"
    assert envelope["fell_back"] is True
    assert envelope["fallback_reason"] is not None
    assert any("free 폴백" in record.message for record in caplog.records)


async def test_canvas_render_plan_logs_mismatch_but_manifest_wins():
    """caller(앱 캐시)가 보낸 canvas_type="table"이 manifest(facts)와 달라도
    manifest가 이긴다 — 무음 불일치가 아니라 로그로 남긴다."""
    queue: asyncio.Queue = asyncio.Queue(10)
    selector = _StubSelector("base:ka00001", {"acctNo": "9999999999"})
    payload = RenderPlanRequest(plan_token="tok", canvas_type="table", data={})

    logger = logging.getLogger("athena_api.api.canvas_push")
    records: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record.getMessage())

    handler = _Capture()
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        result = await canvas_render_plan(
            payload,
            _fake_request(queue),
            Response(),
            client=None,
            order_client=None,
            ws_client=None,
            selector=selector,
            account="",
        )
    finally:
        logger.removeHandler(handler)

    body = json.loads(result.body)
    assert body["canvas_type"] == "facts"
    envelope = queue.get_nowait()
    assert envelope["canvas_type"] == "facts"
    assert any("불일치" in message for message in records)
