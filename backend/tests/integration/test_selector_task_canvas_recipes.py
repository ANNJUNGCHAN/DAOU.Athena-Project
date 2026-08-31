"""Typed selector evidence must terminate in the intended Task Canvas recipe.

These tests use only the in-process FastAPI app and deterministic response
fixtures.  They do not start Electron, open a port, or call Kiwoom/order APIs.
"""
# ruff: noqa: E402, I001

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

TESTS = Path(__file__).resolve().parents[1]
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

from athena_api.config import Settings
from athena_api.dependencies import get_kiwoom_client, get_selector_service
from athena_api.kiwoom import ResponseEnvelope
from athena_api.main import create_app
from athena_api.selector import PlanSigner, SelectorService, build_operation_catalog
from athena_api.selector.errors import AmbiguousOperationError, InvalidArgumentsError
from athena_api.selector.instrument_identity import InstrumentIdentityIndex
from athena_api.selector.schemas import (
    DiscoveryIntent,
    ReasonCode,
    ResolveRequest,
    SearchRequest,
)
from athena_api.view_recipe_registry import get_view_recipe_registry
from support.canvas_fixture_factory import build_operation_fixtures


CURRENT_PRICE = "detail:ka10001:current_trading"
DISCOVERY = "base:ka10023"
DAILY_CHART = "base:ka10081"
ORDERBOOK = "detail:ka10004:buy_bid_prices"
ORDER_REVIEW = "base:kt10000"

DISCOVERY_ARGUMENTS = {
    "mrkt_tp": "000",
    "sort_tp": "1",
    "tm_tp": "1",
    "trde_qty_tp": "5",
    "tm": "1",
    "stk_cnd": "0",
    "pric_tp": "0",
    "stex_tp": "1",
}
CHART_ARGUMENTS = {"base_dt": "20260831", "upd_stkpc_tp": "0"}
ORDER_ARGUMENTS = {
    "dmst_stex_tp": "KRX",
    "stk_cd": "005930",
    "ord_qty": "10",
    "trde_tp": "3",
}


class FixtureClient:
    is_ready = True

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body
        self.calls: list[tuple[str, str, dict[str, Any], object]] = []

    async def post_with_headers(self, tr_id, path, body, options):
        self.calls.append((tr_id, path, body, options))
        return ResponseEnvelope(body=self.body, cont_yn="N", next_key=None)


def _service() -> SelectorService:
    identity = InstrumentIdentityIndex()
    identity.replace(
        {
            "0": [{"code": "005930", "name": "삼성전자", "marketCode": "0"}],
            "10": [],
            "8": [],
        }
    )
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(b"selector-task-canvas-recipe-test", nonce_factory=lambda: "recipe"),
        instrument_identity=identity,
    )


def _client(service: SelectorService, upstream: FixtureClient) -> TestClient:
    app = create_app(Settings(_env_file=None))
    app.dependency_overrides[get_selector_service] = lambda: service
    app.dependency_overrides[get_kiwoom_client] = lambda: upstream
    return TestClient(app)


def _fixture_payload(operation_ref: str) -> dict[str, Any]:
    fixtures = {item.mapping_id: item for item in build_operation_fixtures()}
    return fixtures[operation_ref].validated_payload


def _chart_payload() -> dict[str, Any]:
    return {
        "stk_cd": "005930",
        "stk_dt_pole_chart_qry": [
            {
                "dt": "20260829",
                "open_pric": "121000",
                "high_pric": "122000",
                "low_pric": "120500",
                "cur_prc": "121800",
                "trde_qty": "1200",
            }
        ],
    }


@pytest.mark.parametrize(
    ("question", "intent", "arguments", "preferred_ref", "expected_ref"),
    (
        ("삼성전자 오늘 주가 얼마야?", DiscoveryIntent.AUTO, {}, None, CURRENT_PRICE),
        (
            "거래량 급증 종목 순위 보여줘",
            DiscoveryIntent.AUTO,
            DISCOVERY_ARGUMENTS,
            None,
            DISCOVERY,
        ),
        (
            "삼성전자 일봉 차트 보여줘",
            DiscoveryIntent.AUTO,
            CHART_ARGUMENTS,
            None,
            DAILY_CHART,
        ),
        (
            "삼성전자 호가 보여줘",
            DiscoveryIntent.AUTO,
            {},
            ORDERBOOK,
            ORDERBOOK,
        ),
        (
            "삼성전자 10주 시장가로 매수해줘",
            DiscoveryIntent.ORDER,
            ORDER_ARGUMENTS,
            None,
            ORDER_REVIEW,
        ),
    ),
)
def test_representative_questions_resolve_from_typed_evidence(
    question: str,
    intent: DiscoveryIntent,
    arguments: dict[str, Any],
    preferred_ref: str | None,
    expected_ref: str,
) -> None:
    service = _service()

    if preferred_ref is not None:
        searched = service.search(SearchRequest(query=question, limit=1))
        assert searched.results[0].operation_ref == preferred_ref

    resolved = service.resolve(
        ResolveRequest(
            question=question,
            intent=intent,
            arguments=arguments,
            preferred_ref=preferred_ref,
        )
    )
    verified = service.signer.verify(resolved.plan_token, service.catalog)

    assert resolved.operation_ref == expected_ref
    assert verified.operation_ref == expected_ref
    if preferred_ref is None:
        assert resolved.selection_reasons == [ReasonCode.UNIQUE_EXACT_PROFILE]
    else:
        assert resolved.selection_reasons == [ReasonCode.PREFERRED_STRUCTURED_ASSERTION]


def test_generic_orderbook_question_without_structured_family_evidence_fails_closed() -> None:
    with pytest.raises(AmbiguousOperationError):
        _service().resolve(
            ResolveRequest(question="삼성전자 호가 보여줘", arguments={})
        )


@pytest.mark.parametrize(
    ("question", "expected_missing"),
    (
        (
            "거래량 급증 종목 순위 보여줘",
            {
                "mrkt_tp",
                "sort_tp",
                "tm_tp",
                "trde_qty_tp",
                "stk_cnd",
                "pric_tp",
                "stex_tp",
            },
        ),
        ("삼성전자 일봉 차트 보여줘", {"base_dt", "upd_stkpc_tp"}),
    ),
)
def test_selected_data_family_without_required_axes_fails_closed(
    question: str, expected_missing: set[str]
) -> None:
    with pytest.raises(InvalidArgumentsError) as exc_info:
        _service().resolve(ResolveRequest(question=question, arguments={}))

    assert {
        str(error["loc"][0]) for error in exc_info.value.details["errors"]
    } == expected_missing


@pytest.mark.parametrize(
    (
        "question",
        "intent",
        "arguments",
        "preferred_ref",
        "operation_ref",
        "recipe_id",
        "response_body",
    ),
    (
        (
            "삼성전자 오늘 주가 얼마야?",
            DiscoveryIntent.AUTO,
            {},
            None,
            CURRENT_PRICE,
            "instrument-chart",
            _fixture_payload(CURRENT_PRICE),
        ),
        (
            "거래량 급증 종목 순위 보여줘",
            DiscoveryIntent.AUTO,
            DISCOVERY_ARGUMENTS,
            None,
            DISCOVERY,
            "discovery-value",
            _fixture_payload(DISCOVERY),
        ),
        (
            "삼성전자 일봉 차트 보여줘",
            DiscoveryIntent.AUTO,
            CHART_ARGUMENTS,
            None,
            DAILY_CHART,
            "instrument-chart",
            _chart_payload(),
        ),
        (
            "삼성전자 호가 보여줘",
            DiscoveryIntent.AUTO,
            {},
            ORDERBOOK,
            ORDERBOOK,
            "live-orderbook",
            _fixture_payload(ORDERBOOK),
        ),
        (
            "삼성전자 10주 시장가로 매수해줘",
            DiscoveryIntent.ORDER,
            ORDER_ARGUMENTS,
            None,
            ORDER_REVIEW,
            "order-safe-ticket",
            {},
        ),
    ),
)
def test_selected_operation_terminates_in_expected_task_canvas_recipe(
    question: str,
    intent: DiscoveryIntent,
    arguments: dict[str, Any],
    preferred_ref: str | None,
    operation_ref: str,
    recipe_id: str,
    response_body: dict[str, Any],
) -> None:
    service = _service()
    upstream = FixtureClient(response_body)
    request = {
        "question": question,
        "intent": intent.value,
        "arguments": arguments,
    }
    if preferred_ref is not None:
        request["preferred_ref"] = preferred_ref

    with _client(service, upstream) as client:
        response = client.post("/api/v1/selector/dispatch", json=request)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["operation_ref"] == operation_ref
    assert body["view_recipe"]["recipe_id"] == recipe_id
    assert body["envelope"]["view_recipe"]["recipe_id"] == recipe_id
    assert get_view_recipe_registry().for_operation(operation_ref).recipe_id == recipe_id
    if intent is DiscoveryIntent.ORDER:
        assert body["status"] == "guarded"
        assert upstream.calls == []
    else:
        assert body["status"] == "rendered"
        assert len(upstream.calls) == 1
