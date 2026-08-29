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
  테스트 — manifest가 이 경로 밖(event/websocket)을 가리킬 때의 fail-closed와
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
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Response
from fastapi.testclient import TestClient
from pydantic import ValidationError

from athena_api.api.canvas_push import RenderPlanRequest, canvas_render_plan
from athena_api.config import Settings
from athena_api.dependencies import (
    get_kiwoom_ws_client,
    get_order_kiwoom_client,
    get_selector_service,
    require_kiwoom_client,
)
from athena_api.errors import KiwoomApiError
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


def test_render_plan_request_canvas_type_is_optional() -> None:
    """P5(2026-08-20) — canvas_type은 이제 operation_ref의 순수 함수라 caller가
    안 보내도 된다(app/lib/main/fast-path.js가 더 이상 캐시 판정 객체에 담아두지
    않는다). 필드 부재·명시적 None 둘 다 통과해야 한다."""
    omitted = RenderPlanRequest(plan_token="tok", data={})
    assert omitted.canvas_type is None
    explicit_none = RenderPlanRequest(plan_token="tok", canvas_type=None, data={})
    assert explicit_none.canvas_type is None


def test_render_plan_request_inline_correlation_is_all_or_none_and_bounded() -> None:
    valid = RenderPlanRequest(
        plan_token="tok",
        delivery="inline",
        dataset_id="dataset-1",
        item_id="item-1",
        ordinal=6,
    )
    assert valid.delivery == "inline"
    with pytest.raises(ValidationError):
        RenderPlanRequest(plan_token="tok", delivery="inline", dataset_id="dataset-1")
    with pytest.raises(ValidationError):
        RenderPlanRequest(
            plan_token="tok",
            delivery="inline",
            dataset_id="dataset-1",
            item_id="item-1",
            ordinal=7,
        )
    with pytest.raises(ValidationError):
        RenderPlanRequest(plan_token="tok", delivery="inline", deadline_ms=3001)
    assert RenderPlanRequest(plan_token="tok", delivery="inline").deadline_ms == 2700
    remaining_budget = RenderPlanRequest(
        plan_token="tok", delivery="inline", deadline_ms=2400
    )
    assert remaining_budget.deadline_ms == 2400
    maximum = RenderPlanRequest(plan_token="tok", delivery="inline", deadline_ms=3000)
    assert maximum.deadline_ms == 3000


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


class SlowClient(FakeClient):
    def __init__(self, body: dict, delay_seconds: float) -> None:
        super().__init__(body)
        self.delay_seconds = delay_seconds
        self.cancelled = False
        self.completed = False

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, path, body, options))
        try:
            await asyncio.sleep(self.delay_seconds)
        except asyncio.CancelledError:
            self.cancelled = True
            raise
        self.completed = True
        return ResponseEnvelope(body=self._body, cont_yn="N", next_key=None)


class ErrorClient(FakeClient):
    def __init__(self, error: BaseException) -> None:
        super().__init__({})
        self.error = error

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, path, body, options))
        raise self.error


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
        assert body["delivery"] == "side_channel"
        assert body["status"] == "queued"
        assert body["canvas_type"] == "facts"
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "facts"
        assert envelope["data"]["fields"] == [
            {"key": "acctNo", "label": "acctNo", "value": "1234567890"}
        ]
        assert body["receipt"] == {
            "pushed": True,
            "delivery": "side_channel",
            "canvas_type": "facts",
            "screen_id": "AT-CV-005:F1",
            "fell_back": False,
            "fallback_reason": None,
            "trimmed": False,
            "partial": False,
            "cache_reused": False,
        }
        assert "1234567890" not in json.dumps(body["receipt"])


def test_render_plan_inline_returns_envelope_without_queueing() -> None:
    upstream = FakeClient({"cur_prc": "+71000", "pred_pre": "+1200"})
    with _client(_service(), upstream) as client:
        token = _resolve(client, "detail:ka10001:current_trading", {"stk_cd": "005930"})
        queue = client.app.state.canvas_events
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "delivery": "inline",
                "dataset_id": "rest-001",
                "item_id": "screen-1",
                "ordinal": 1,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["delivery"] == "inline"
        assert body["queued"] is False
        assert body["status"] == "rendered"
        assert body["operation_ref"] == "detail:ka10001:current_trading"
        assert body["canvas_type"] == "facts"
        assert body["screen_id"] == "AT-CV-005:F1"
        assert body["correlation"] == {
            "dataset_id": "rest-001",
            "item_id": "screen-1",
            "ordinal": 1,
        }
        assert body["envelope"]["correlation"] == body["correlation"]
        assert body["envelope"]["card_title"] == "종목정보"
        assert body["envelope"]["data"]["fields"][0]["key"] == "cur_prc"
        receipt_text = json.dumps(body["receipt"], ensure_ascii=False)
        for canvas_token in ("+71000", "+1200", "cur_prc", "pred_pre"):
            assert canvas_token not in receipt_text
        assert body["next_actions"] == []
        assert set(body["timing"]) == {
            "server_ms",
            "call_ms",
            "transform_ms",
            "delivery_ms",
        }
        assert all(value >= 0 for value in body["timing"].values())
        assert queue.empty()


def test_render_plan_inline_timeout_returns_authoritative_error_state_before_deadline() -> None:
    upstream = SlowClient({"cur_prc": "+71000"}, delay_seconds=1.0)
    service = _service()
    with _client(service, upstream) as client:
        token = _resolve(client, "detail:ka10001:current_trading", {"stk_cd": "005930"})
        started = time.perf_counter()
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "delivery": "inline",
                "canvas_type": "table",
                "deadline_ms": 100,
                "dataset_id": "timeout-dataset",
                "item_id": "price-screen",
                "ordinal": 1,
            },
        )
        elapsed_ms = (time.perf_counter() - started) * 1000
        assert response.status_code == 200, response.text
        assert elapsed_ms < 700
        body = response.json()
        assert body["status"] == "error_rendered"
        assert body["code"] == "UPSTREAM_TIMEOUT"
        assert body["operation_ref"] == "detail:ka10001:current_trading"
        assert body["canvas_type"] == "facts"
        assert body["screen_id"] == "AT-CV-005:F1"
        assert body["correlation"] == {
            "dataset_id": "timeout-dataset",
            "item_id": "price-screen",
            "ordinal": 1,
        }
        assert body["envelope"]["state"] == "timeout"
        assert body["envelope"]["screen_id"] == "AT-CV-005:F1"
        assert "data" not in body["envelope"]
        assert body["receipt"]["state"] == "timeout"
        assert "+71000" not in json.dumps(body["receipt"])
        assert upstream.cancelled is True
        assert upstream.completed is False
        assert client.app.state.canvas_events.empty()

        replay = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": "inline", "deadline_ms": 100},
        )
        assert replay.status_code == 409
        assert replay.json()["code"] == "PLAN_ALREADY_USED"
        assert len(upstream.calls) == 1


@pytest.mark.parametrize(
    ("error", "expected_state", "expected_code"),
    [
        (
            KiwoomApiError("BENCH_HTTP_500", "benchmark failure", 500),
            "error",
            "UPSTREAM_ERROR",
        ),
        (asyncio.CancelledError(), "cancelled", "UPSTREAM_CANCELLED"),
    ],
)
def test_render_plan_inline_known_failure_returns_control_only_error_envelope(
    error: BaseException, expected_state: str, expected_code: str
) -> None:
    upstream = ErrorClient(error)
    with _client(_service(), upstream) as client:
        token = _resolve(client, "detail:ka10001:current_trading", {"stk_cd": "005930"})
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": "inline", "deadline_ms": 500},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "error_rendered"
        assert body["code"] == expected_code
        assert body["envelope"]["state"] == expected_state
        assert body["envelope"]["canvas_type"] == "facts"
        assert body["envelope"]["screen_id"] == "AT-CV-005:F1"
        assert "data" not in body["envelope"]
        assert set(body["receipt"]).isdisjoint({"data", "fields", "rows", "columns"})
        assert client.app.state.canvas_events.empty()


def test_render_plan_inline_does_not_require_canvas_side_channel_queue() -> None:
    upstream = FakeClient({"acctNo": "1234567890"})
    with _client(_service(), upstream) as client:
        token = _resolve(client, "base:ka00001", {})
        client.app.state.canvas_events = None
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": "inline"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "rendered"


@pytest.mark.parametrize(
    ("operation_ref", "kind"),
    [
        ("base:kt10000", "order"),
        ("base:ka10173", "websocket"),
    ],
)
def test_render_plan_inline_rejects_non_query_plan_before_dispatch(
    operation_ref: str, kind: str
) -> None:
    service = _service()
    upstream = FakeClient({"return_code": 0, "return_msg": "unexpected"})
    document = service.catalog.find_exact(operation_ref)
    assert document is not None and document.kind == kind
    token, _ = service.signer.issue(
        catalog=service.catalog,
        document=document,
        arguments={},
        question="non-query operations must not use inline canvas",
    )
    with _client(service, upstream) as client:
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "delivery": "inline",
                "dataset_id": "safety",
                "item_id": "ws-plan",
                "ordinal": 1,
            },
        )
        assert response.status_code == 422, response.text
        body = response.json()
        assert body["status"] == "rejected"
        assert body["code"] == "INLINE_QUERY_ONLY"
        assert body["operation_ref"] == operation_ref
        assert body["envelope"] is None
        assert body["next_actions"] == ["resolve_query_plan"]
        assert not upstream.calls
        assert client.app.state.canvas_events.empty()

        replay = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": "inline"},
        )
        assert replay.status_code == 409, replay.text
        assert replay.json()["code"] == "PLAN_ALREADY_USED"


@pytest.mark.parametrize("delivery", ["inline", "side_channel"])
@pytest.mark.parametrize("command", ["REG", "REMOVE"])
def test_render_plan_all_deliveries_burn_websocket_plan_without_control_frame(
    delivery: str, command: str
) -> None:
    class MutationSpy:
        is_ready = True

        def __init__(self) -> None:
            self.registered: list[tuple] = []
            self.removed: list[tuple] = []

        async def register(self, *args, **kwargs):
            self.registered.append((args, kwargs))
            return {"return_code": "0", "return_msg": "OK", "trnm": "REG"}

        async def remove(self, *args, **kwargs):
            self.removed.append((args, kwargs))
            return {"return_code": "0", "return_msg": "OK", "trnm": "REMOVE"}

    service = _service()
    upstream = FakeClient({"return_code": "0"})
    ws = MutationSpy()
    document = service.catalog.find_exact("base:0G")
    assert document is not None and document.kind == "websocket"
    token, _ = service.signer.issue(
        catalog=service.catalog,
        document=document,
        arguments={
            "trnm": command,
            "grp_no": "1",
            "refresh": "1",
            "data": [{"type": "0G", "item": "005930"}],
        },
        question="render-plan must never mutate WebSocket registration",
    )
    with _client(service, upstream) as client:
        client.app.dependency_overrides[get_kiwoom_ws_client] = lambda: ws
        with patch.object(service, "call", new_callable=AsyncMock) as call_spy:
            response = client.post(
                "/api/v1/canvas/render-plan",
                json={"plan_token": token, "delivery": delivery},
            )
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "INLINE_QUERY_ONLY"
        call_spy.assert_not_awaited()
        assert upstream.calls == []
        assert ws.registered == []
        assert ws.removed == []
        assert client.app.state.canvas_events.empty()

        replay = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": delivery},
        )
        assert replay.status_code == 409, replay.text
        assert replay.json()["code"] == "PLAN_ALREADY_USED"


@pytest.mark.parametrize("delivery", ["inline", "side_channel"])
def test_render_plan_all_deliveries_burn_order_plan_without_any_client_call(
    delivery: str,
) -> None:
    class OrderSpy:
        is_ready = True

        def __init__(self) -> None:
            self.calls: list[tuple] = []

        async def post_with_headers(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            return ResponseEnvelope(body={"return_code": "0"}, cont_yn="N", next_key=None)

    service = _service()
    upstream = FakeClient({"return_code": "0"})
    order = OrderSpy()
    document = service.catalog.find_exact("base:kt10000")
    assert document is not None and document.kind == "order"
    token, _ = service.signer.issue(
        catalog=service.catalog,
        document=document,
        arguments={},
        question="render-plan must never place an order",
    )
    with _client(service, upstream) as client:
        client.app.dependency_overrides[get_order_kiwoom_client] = lambda: order
        with patch.object(service, "call", new_callable=AsyncMock) as call_spy:
            response = client.post(
                "/api/v1/canvas/render-plan",
                json={"plan_token": token, "delivery": delivery},
            )
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "INLINE_QUERY_ONLY"
        call_spy.assert_not_awaited()
        assert upstream.calls == []
        assert order.calls == []
        assert client.app.state.canvas_events.empty()

        replay = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": delivery},
        )
        assert replay.status_code == 409, replay.text
        assert replay.json()["code"] == "PLAN_ALREADY_USED"


def test_render_plan_inline_cannot_issue_hidden_oauth_plan() -> None:
    service = _service()
    assert service.catalog.find_exact("base:au10001") is None


@pytest.mark.parametrize(
    ("operation_ref", "arguments", "expected_kind"),
    [
        ("detail:ka30012:market_snapshot", {"stk_cd": "57K123"}, "facts"),
        ("base:ka20003", {"inds_cd": "001"}, "table"),
    ],
)
def test_render_plan_inline_preserves_valid_empty_response_as_empty_canvas(
    operation_ref: str, arguments: dict, expected_kind: str
) -> None:
    upstream = FakeClient({})
    with _client(_service(), upstream) as client:
        token = _resolve(client, operation_ref, arguments)
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": "inline"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "rendered"
        assert body["canvas_type"] == expected_kind
        assert body["receipt"]["canvas_type"] == expected_kind
        assert body["envelope"]["data"]["empty_state"] is True
        assert client.app.state.canvas_events.empty()


def test_render_plan_success_receipt_never_repeats_canvas_market_data():
    upstream = FakeClient(
        {
            "cur_prc": "+71000",
            "pre_sig": "2",
            "pred_pre": "+1200",
            "flu_rt": "+1.72",
            "trde_qty": "123456",
            "trde_pre": "8765432100",
        }
    )
    with _client(_service(), upstream) as client:
        token = _resolve(client, "detail:ka10001:current_trading", {"stk_cd": "005930"})
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "data": {}},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert "summary" not in body
        receipt_text = json.dumps(body["receipt"], ensure_ascii=False)
        for canvas_token in (
            "+71000",
            "+1200",
            "+1.72",
            "123456",
            "8765432100",
            "cur_prc",
            "pred_pre",
            "flu_rt",
            "trde_qty",
        ):
            assert canvas_token not in receipt_text


def test_render_plan_http_roundtrip_plan_token_remains_single_use():
    upstream = FakeClient({"cur_prc": "71000", "pred_pre": "1200"})
    with _client(_service(), upstream) as client:
        token = _resolve(client, "detail:ka10001:current_trading", {"stk_cd": "005930"})
        request = {"plan_token": token, "data": {}}
        first = client.post("/api/v1/canvas/render-plan", json=request)
        second = client.post("/api/v1/canvas/render-plan", json=request)
        assert first.status_code == 200, first.text
        assert second.status_code == 409, second.text
        assert second.json()["code"] == "PLAN_ALREADY_USED"
        assert len(upstream.calls) == 1


def test_render_plan_inline_chart_uses_only_plan_token_context_for_symbol():
    """명시적 renderer/data.chart 계약과 signed symbol만 AITS body를 만든다."""
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
                "delivery": "inline",
                "canvas_type": "chart",
                "renderer_id": "caller-forged-renderer",
                "data": {
                    "symbol": "CONFLICTING",
                    "chart_meta": {"reload_group": "gold-today"},
                },
                "dataset_id": "charts",
                "item_id": "daily-005930",
                "ordinal": 1,
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["canvas_type"] == "chart"
        envelope = response.json()["envelope"]
        assert envelope["canvas_type"] == "chart"
        assert envelope["card_title"] == "차트"
        assert envelope["renderer_id"] == "aits-chart-v1"
        assert envelope["data"]["symbol"] == "005930"
        assert envelope["data"]["chart"] == {
            "period": "day",
            "target": "stock",
            "trId": "ka10081",
            "candles": [
                {
                    "time": "2026-08-19",
                    "open": 120200.0,
                    "high": 121000.0,
                    "low": 119500.0,
                    "close": 120800.0,
                    "volume": 1000.0,
                }
            ],
        }
        assert envelope["data"]["chart_meta"]["series_scope"] == "standard"
        assert envelope["data"]["chart_meta"]["reload_group"] == "stock"
        assert envelope["data"]["chart_meta"]["reload_targets"]["week"] == {
            "operation_ref": "base:ka10082",
            "request_fields": ["stk_cd", "base_dt", "upd_stkpc_tp"],
        }
        assert client.app.state.canvas_events.empty()


@pytest.mark.parametrize(
    "screen_contract",
    [
        {},
        {
            "base:ka10081": {
                "mapping_id": "base:ka10081",
                "operation_ref": "base:ka10081",
                "screen_id": "AT-CV-005:C1",
                "category": "read_display",
                "presentation": {"renderer_id": "wrong-renderer"},
                "data": {"chart": {}},
            }
        },
        {
            "base:ka10081": {
                "mapping_id": "base:ka10081",
                "operation_ref": "base:ka10081",
                "screen_id": "AT-CV-005:C1",
                "category": "read_display",
                "presentation": {"renderer_id": "aits-chart-v1"},
                "data": {"chart": None},
            }
        },
        {
            "base:ka10081": {
                "mapping_id": "base:ka10081",
                "operation_ref": "base:ka10081",
                "screen_id": "AT-CV-005:C1",
                "category": "read_display",
                "presentation": {"renderer_id": "aits-chart-v1"},
                "data": {"chart": {}},
            }
        },
    ],
)
def test_render_plan_inline_chart_fails_closed_on_missing_or_mismatched_contract(
    screen_contract: dict,
) -> None:
    upstream = FakeClient({"stk_dt_pole_chart_qry": []})
    with _client(_service(), upstream) as client:
        token = _resolve(
            client,
            "base:ka10081",
            {"stk_cd": "005930", "base_dt": "20260819", "upd_stkpc_tp": "0"},
        )
        with patch(
            "athena_api.canvas_transform._screen_definitions",
            return_value=screen_contract,
        ):
            response = client.post(
                "/api/v1/canvas/render-plan",
                json={"plan_token": token, "delivery": "inline"},
            )
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "CANVAS_COVERAGE_MISSING"
        assert response.json()["envelope"] is None
        assert upstream.calls == []


@pytest.mark.parametrize(
    ("operation_ref", "arguments", "container_alias", "symbol"),
    [
        (
            "base:ka10079",
            {"stk_cd": "005930", "tic_scope": "1", "upd_stkpc_tp": "0"},
            "stk_tic_chart_qry",
            "005930",
        ),
        (
            "base:ka10080",
            {
                "stk_cd": "005930",
                "tic_scope": "5",
                "upd_stkpc_tp": "0",
                "base_dt": "20260821",
            },
            "stk_min_pole_chart_qry",
            "005930",
        ),
        (
            "base:ka20004",
            {"inds_cd": "001", "tic_scope": "1"},
            "inds_tic_chart_qry",
            "001",
        ),
        (
            "base:ka20005",
            {"inds_cd": "101", "tic_scope": "5", "base_dt": "20260821"},
            "inds_min_pole_qry",
            "101",
        ),
    ],
)
def test_render_plan_inline_intraday_chart_uses_authoritative_screen_definition(
    operation_ref: str,
    arguments: dict,
    container_alias: str,
    symbol: str,
) -> None:
    rows = [
        {
            "cntr_tm": "20260821101500",
            "open_pric": "+71000",
            "high_pric": "+71200",
            "low_pric": "+70900",
            "cur_prc": "+71100",
            "trde_qty": "100",
        },
        {
            "cntr_tm": "20260821101000",
            "open_pric": "+70800",
            "high_pric": "+71100",
            "low_pric": "+70700",
            "cur_prc": "+71000",
            "trde_qty": "90",
        },
    ]
    upstream = FakeClient({container_alias: rows})
    with _client(_service(), upstream) as client:
        token = _resolve(client, operation_ref, arguments)
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "delivery": "inline",
                "deadline_ms": 2400,
                "data": {
                    "symbol": "CALLER-CONFLICT",
                    "container": [{"dt": "19990101", "cur_prc": "1"}],
                },
                "dataset_id": "cold-intraday",
                "item_id": operation_ref,
                "ordinal": 1,
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "rendered"
        assert body["screen_id"] == "AT-CV-005:C1"
        assert body["canvas_type"] == "chart"
        assert body["envelope"]["data"]["symbol"] == symbol
        assert body["envelope"]["renderer_id"] == "aits-chart-v1"
        chart = body["envelope"]["data"]["chart"]
        assert chart["period"] in {"tick", "min"}
        assert chart["target"] in {"stock", "sector"}
        assert chart["trId"] == operation_ref.removeprefix("base:")
        candles = chart["candles"]
        assert len(candles) == 2
        assert all(isinstance(candle["time"], int) for candle in candles)
        assert candles[0]["time"] < candles[1]["time"]
        assert candles[0]["close"] == 71000.0
        assert candles[1]["close"] == 71100.0
        assert "CALLER-CONFLICT" not in json.dumps(body["receipt"])
        assert client.app.state.canvas_events.empty()


def test_render_plan_inline_intraday_chart_rejects_time_without_declared_date() -> None:
    upstream = FakeClient(
        {
            "stk_tic_chart_qry": [
                {
                    "cntr_tm": "101500",
                    "open_pric": "71000",
                    "high_pric": "71200",
                    "low_pric": "70900",
                    "cur_prc": "71100",
                }
            ]
        }
    )
    with _client(_service(), upstream) as client:
        token = _resolve(
            client,
            "base:ka10079",
            {"stk_cd": "005930", "tic_scope": "1", "upd_stkpc_tp": "0"},
        )
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "delivery": "inline"},
        )
        assert response.status_code == 422, response.text
        body = response.json()
        assert body["code"] == "CANVAS_TRANSFORM_FAILED"
        assert body["envelope"] is None
        assert body["receipt"] is None


def test_render_plan_http_roundtrip_chart_weekly_tr_carries_exact_aits_period():
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
            json={"plan_token": token},
        )
        assert response.status_code == 200, response.text
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "chart"
        assert envelope["renderer_id"] == "aits-chart-v1"
        assert envelope["data"]["chart"]["period"] == "week"


def test_render_plan_http_roundtrip_sector_chart_seals_inds_code_as_symbol():
    rows = [
        {
            "dt": "20260819",
            "open_pric": "420.1",
            "high_pric": "425.0",
            "low_pric": "418.0",
            "cur_prc": "423.7",
            "trde_qty": "9000",
        }
    ]
    upstream = FakeClient({"inds_cd": "001", "inds_dt_pole_qry": rows})
    with _client(_service(), upstream) as client:
        token = _resolve(
            client,
            "base:ka20006",
            {"inds_cd": "001", "base_dt": "20260819"},
        )
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={"plan_token": token, "data": {"symbol": "CONFLICTING"}},
        )
        assert response.status_code == 200, response.text
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["data"]["symbol"] == "001"
        assert envelope["data"]["chart"]["target"] == "sector"
        assert envelope["data"]["chart"]["period"] == "day"


@pytest.mark.parametrize(
    ("operation_ref", "arguments", "container", "period", "time_key", "close_key", "volume_key"),
    [
        (
            "base:ka50079",
            {"stk_cd": "M04020000", "tic_scope": "1", "upd_stkpc_tp": "0"},
            "gds_tic_chart_qry", "tick", "cntr_tm", "cur_prc", "trde_qty",
        ),
        (
            "base:ka50080",
            {"stk_cd": "M04020000", "tic_scope": "5", "upd_stkpc_tp": "0"},
            "gds_min_chart_qry", "min", "cntr_tm", "cur_prc", "trde_qty",
        ),
        (
            "base:ka50081",
            {"stk_cd": "M04020000", "base_dt": "20260819", "upd_stkpc_tp": "0"},
            "gds_day_chart_qry", "day", "dt", "cur_prc", "acc_trde_qty",
        ),
        (
            "base:ka50082",
            {"stk_cd": "M04020000", "base_dt": "20260819", "upd_stkpc_tp": "0"},
            "gds_week_chart_qry", "week", "dt", "cur_prc", "acc_trde_qty",
        ),
        (
            "base:ka50083",
            {"stk_cd": "M04020000", "base_dt": "20260819", "upd_stkpc_tp": "0"},
            "gds_month_chart_qry", "month", "dt", "cur_prc", "acc_trde_qty",
        ),
        (
            "base:ka50091",
            {"stk_cd": "M04020000", "tic_scope": "1"},
            "gds_tic_chart_qry", "tick", "cntr_tm", "cntr_pric", "trde_qty",
        ),
        (
            "base:ka50092",
            {"stk_cd": "M04020000", "tic_scope": "5"},
            "gds_min_chart_qry", "min", "cntr_tm", "cntr_pric", "trde_qty",
        ),
    ],
)
def test_render_plan_gold_chart_uses_explicit_aits_projection(
    operation_ref: str,
    arguments: dict,
    container: str,
    period: str,
    time_key: str,
    close_key: str,
    volume_key: str,
) -> None:
    row = {
        time_key: "20260819101500" if time_key == "cntr_tm" else "20260819",
        "open_pric": "100000",
        "high_pric": "101000",
        "low_pric": "99000",
        close_key: "100500",
        volume_key: "77",
    }
    upstream = FakeClient({container: [row]})
    with _client(_service(), upstream) as client:
        token = _resolve(client, operation_ref, arguments)
        response = client.post(
            "/api/v1/canvas/render-plan",
            json={
                "plan_token": token,
                "delivery": "inline",
                "data": {"chart": {"period": "year", "target": "stock"}},
            },
        )
        assert response.status_code == 200, response.text
        envelope = response.json()["envelope"]
        assert envelope["renderer_id"] == "aits-chart-v1"
        assert envelope["data"]["symbol"] == "M04020000"
        chart = envelope["data"]["chart"]
        assert chart["period"] == period
        assert chart["target"] == "gold"
        assert chart["trId"] == operation_ref.removeprefix("base:")
        assert chart["candles"][0]["close"] == 100500.0
        assert chart["candles"][0]["volume"] == 77.0
        chart_meta = envelope["data"]["chart_meta"]
        expected_scope = "today" if operation_ref in {"base:ka50091", "base:ka50092"} else "generic"
        expected_group = "gold-today" if expected_scope == "today" else "gold-generic"
        assert chart_meta["series_scope"] == expected_scope
        assert chart_meta["reload_group"] == expected_group
        assert chart_meta["reload_targets"][period]["operation_ref"] == operation_ref


def test_render_plan_http_roundtrip_chart_tick_preserves_tick_period():
    rows = [
        {
            "cntr_tm": "20260819101500",
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
            json={"plan_token": token},
        )
        assert response.status_code == 200, response.text
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "chart"
        assert envelope["data"]["chart"]["period"] == "tick"
        assert "initial" not in envelope["data"]


def test_render_plan_http_roundtrip_omits_canvas_type_and_still_resolves(caplog):
    """P5 — 앱 캐시 리플레이가 canvas_type 필드 자체를 안 보내도(judgment에서
    제거됐으므로) manifest 조회만으로 정상 라우팅된다. caplog로 "불일치" 로그가
    찍히지 않음도 함께 증명한다 — 비교 대상이 없으니 불일치도 없다."""
    upstream = FakeClient({"acctNo": "1234567890"})
    with _client(_service(), upstream) as client:
        token = _resolve(client, "base:ka00001", {})
        with caplog.at_level(logging.WARNING, logger="athena_api.api.canvas_push"):
            response = client.post(
                "/api/v1/canvas/render-plan",
                json={"plan_token": token, "data": {}},  # canvas_type 생략
            )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["canvas_type"] == "facts"
        envelope = client.app.state.canvas_events.get_nowait()
        assert envelope["canvas_type"] == "facts"
        assert not any("불일치" in record.message for record in caplog.records)


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
        self.signer = SimpleNamespace(
            verify=lambda *args, **kwargs: SimpleNamespace(operation_ref="base:ka00001")
        )
        self.catalog = SimpleNamespace(
            find_exact=lambda operation_ref: SimpleNamespace(kind="query")
        )
        self._response = CallResponse(
            operation_ref=operation_ref, data=data, continuation=ContinuationOutput(cont_yn="N")
        )

    async def call(self, call_request, request, response, client, **kwargs):
        return self._response


def _fake_request(queue: asyncio.Queue) -> SimpleNamespace:
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(canvas_events=queue)))


async def test_canvas_render_plan_fails_closed_when_manifest_kind_unsupported(caplog):
    """base:ka10173은 websocket TR이라 manifest layout="event" — 이 read/display
    plan_token 경로 범위 밖이다. free 카드로 강등하지 않고 coverage 오류로 닫는다."""
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
    assert result.status_code == 422
    assert body["code"] == "CANVAS_COVERAGE_MISSING"
    assert body["canvas_type"] is None
    assert body["envelope"] is None
    assert body["receipt"] is None
    assert queue.empty()
    assert any("coverage 결함" in record.message for record in caplog.records)


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
