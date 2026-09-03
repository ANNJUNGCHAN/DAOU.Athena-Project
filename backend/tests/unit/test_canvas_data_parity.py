"""REST(api/canvas_push)와 MCP(athena_mcp/canvas_data)의 통합 카드 계약 동형성.

MCP `render_with_plan`은 자기 계약을 `/api/v1/canvas/push`로 밀고, 그 엔드포인트는
같은 `operation_ref`로 파생한 canonical과 필드별로 대조한다(`_INTEGRATED_CARD_FIELDS`).
두 파생이 한 필드라도 갈리면 프로덕션 유일 경로가 422로 죽는다 — 그래서 동형성은
회귀 테스트로 고정해야 하는 계약이다.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.api.canvas_push import _INTEGRATED_CARD_FIELDS, router
from athena_api.api.canvas_push import (
    _integrated_card_contract as rest_integrated_card_contract,
)
from athena_mcp.canvas_data import (
    _integrated_card_contract as mcp_integrated_card_contract,
)

# 6개 카드를 모두 지나는 표본. 전수는 test_canvas_card_registry가 따로 든다.
SAMPLE_OPERATIONS = (
    "base:ka10085",  # CC-01 account
    "base:kt10000",  # CC-02 order
    "base:ka10060",  # CC-03 instrument
    "base:0C",  # CC-04 orderbook
    "base:ka10045",  # CC-05 flow
    "base:ka10099",  # CC-06 explorer
)


@pytest.mark.parametrize("operation_ref", SAMPLE_OPERATIONS)
def test_mcp_contract_agrees_with_rest_on_every_field_it_supplies(
    operation_ref: str,
) -> None:
    mcp = mcp_integrated_card_contract(operation_ref)
    rest = rest_integrated_card_contract(operation_ref)

    assert set(mcp) <= set(rest)
    for key in mcp:
        assert mcp[key] == rest[key], key


@pytest.mark.parametrize("operation_ref", SAMPLE_OPERATIONS)
def test_surface_contract_is_derived_identically_on_both_paths(
    operation_ref: str,
) -> None:
    mcp = mcp_integrated_card_contract(operation_ref)
    rest = rest_integrated_card_contract(operation_ref)

    assert "surface_contract" in mcp
    assert "surface_contract" in rest
    assert mcp["surface_contract"] == rest["surface_contract"]


def test_surface_contract_is_an_envelope_contract_field() -> None:
    """게이트가 대조하는 필드 집합에 들어 있어야 호출자가 위조할 수 없다."""

    assert "surface_contract" in _INTEGRATED_CARD_FIELDS


@pytest.mark.parametrize("operation_ref", SAMPLE_OPERATIONS)
def test_surface_contract_is_none_or_a_board_never_something_else(
    operation_ref: str,
) -> None:
    """보드가 저작되기 전에는 None, 저작되면 보드 계약 — 그 사이 상태는 없다.

    추출이 진행 중이라 값 자체는 시간에 따라 변한다. 고정해야 할 계약은 "모양"이다.
    """

    surface = rest_integrated_card_contract(operation_ref)["surface_contract"]

    if surface is None:
        return
    assert surface["surface_version"] == "card-surface.v1"
    assert isinstance(surface["board_id"], str) and surface["board_id"]
    assert isinstance(surface["state_boards"], list)
    assert isinstance(surface["slot_values"], list)
    assert isinstance(surface["unbound_slots"], list)
    assert isinstance(surface["section_titles_ko"], dict)


# 주문 op는 범용 채널 push 자체가 금지다(GENERIC_ORDER_PUSH_FORBIDDEN, 기존 규칙).
PUSHABLE_OPERATIONS = tuple(op for op in SAMPLE_OPERATIONS if op != "base:kt10000")


@pytest.mark.parametrize("operation_ref", PUSHABLE_OPERATIONS)
def test_the_mcp_envelope_survives_the_push_gate_unchanged(operation_ref: str) -> None:
    """프로덕션 유일 경로 — render_with_plan이 만든 봉투가 그대로 큐에 들어간다.

    MCP가 최상위에 싣는 계약 필드는 게이트가 canonical로 다시 파생해 대조·치환한다.
    한 필드라도 두 파생이 갈리면 여기서 422가 난다.
    """

    app = FastAPI()
    app.include_router(router)
    app.state.local_bearer_token = None
    app.state.canvas_events = asyncio.Queue(8)
    client = TestClient(app)

    envelope = {
        "operation_ref": operation_ref,
        "canvas_type": "facts",
        "data": {},
        "layout": None,
        "drop_types": [],
        **mcp_integrated_card_contract(operation_ref),
    }

    response = client.post("/api/v1/canvas/push", json=envelope)

    assert response.status_code == 200, response.text
    queued = app.state.canvas_events.get_nowait()
    assert queued["card_id"] == envelope["card_id"]
    assert queued["surface_contract"] == envelope["surface_contract"]
