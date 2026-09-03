"""US-005: representative Korean questions must route to the correct Paper card
and view recipe.

This is an end-to-end routing contract test, not a selector-internals test: for
each question it drives the same public surface production code uses
(``SelectorService.resolve``) and then asserts on the two product-facing
destinations a resolved operation must land on:

- the Canvas card (``athena_api.canvas_card_registry.resolve_canvas_card``)
- the view recipe (``athena_api.view_recipe_registry.get_view_recipe_registry``)

Every question below was verified against the real ``SelectorService`` before
being written down here (see PR discussion) - none of the expectations were
weakened to make a failing case pass. At least three questions are included
per view recipe, covering all twelve recipes and all six cards.
"""

from __future__ import annotations

from typing import Any, NamedTuple

import pytest

from athena_api.canvas_card_registry import resolve_canvas_card
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.instrument_identity import InstrumentIdentityIndex
from athena_api.selector.plans import PlanSigner
from athena_api.selector.schemas import DiscoveryIntent, ResolveRequest
from athena_api.selector.service import SelectorService
from athena_api.view_recipe_registry import get_view_recipe_registry


def _service() -> SelectorService:
    identity = InstrumentIdentityIndex()
    identity.replace(
        {
            "0": [
                {"code": "005930", "name": "삼성전자", "marketCode": "0"},
                {"code": "005380", "name": "현대차", "marketCode": "0"},
            ],
            "10": [{"code": "035720", "name": "카카오", "marketCode": "10"}],
            "8": [
                {"code": "069500", "name": "KODEX 200", "marketCode": "8"},
                {"code": "333333", "name": "ACE 200", "marketCode": "8"},
            ],
        }
    )
    return SelectorService(
        build_operation_catalog(),
        PlanSigner(b"question-to-card-routing-test", nonce_factory=lambda: "route"),
        instrument_identity=identity,
    )


class RoutingCase(NamedTuple):
    question: str
    expected_operation_ref: str
    expected_card_id: str
    expected_recipe_id: str
    intent: DiscoveryIntent = DiscoveryIntent.AUTO
    arguments: dict[str, Any] = {}
    preferred_ref: str | None = None
    expected_mode: str | None = None


CASES: tuple[RoutingCase, ...] = (
    # instrument-chart (CC-03) -----------------------------------------------
    RoutingCase(
        "삼성전자 오늘 주가 얼마야?",
        "detail:ka10001:current_trading",
        "CC-03",
        "instrument-chart",
    ),
    RoutingCase(
        "삼성전자 일봉 차트 보여줘",
        "base:ka10081",
        "CC-03",
        "instrument-chart",
        arguments={"base_dt": "20260831", "upd_stkpc_tp": "0"},
    ),
    RoutingCase(
        "삼성전자 분봉 차트 보여줘",
        "base:ka10080",
        "CC-03",
        "instrument-chart",
        arguments={"tic_scope": "1", "upd_stkpc_tp": "0"},
    ),
    RoutingCase(
        "삼성전자 주봉 차트 그려줘",
        "base:ka10082",
        "CC-03",
        "instrument-chart",
        arguments={"base_dt": "20260831", "upd_stkpc_tp": "0"},
    ),
    # live-orderbook (CC-04) --------------------------------------------------
    RoutingCase(
        "카카오 실시간 매수매도 호가 잔량 10단계 스트리밍 해줘",
        "base:0D",
        "CC-04",
        "live-orderbook",
        intent=DiscoveryIntent.WEBSOCKET,
        arguments={
            "trnm": "REG",
            "grp_no": "1",
            "refresh": "1",
            "data": [{"item": "035720", "type": "0D"}],
        },
    ),
    RoutingCase(
        "삼성전자 호가 보여줘",
        "detail:ka10004:aggregate_totals",
        "CC-04",
        "live-orderbook",
        arguments={"stk_cd": "005930"},
        preferred_ref="detail:ka10004:aggregate_totals",
    ),
    RoutingCase(
        "삼성전자 매도 호가 잔량을 보여줘",
        "detail:ka10004:sell_bid_prices",
        "CC-04",
        "live-orderbook",
        arguments={"stk_cd": "005930"},
        preferred_ref="detail:ka10004:sell_bid_prices",
    ),
    # why-move-flow (CC-05) ---------------------------------------------------
    RoutingCase(
        "삼성전자 공매도 추이 보여줘",
        "base:ka10014",
        "CC-05",
        "why-move-flow",
        arguments={"stk_cd": "005930", "strt_dt": "20260801", "end_dt": "20260831"},
    ),
    RoutingCase(
        "삼성전자를 가장 많이 산 거래원들을 보여줘",
        "detail:ka10002:buy_brokers",
        "CC-05",
        "why-move-flow",
        arguments={"stk_cd": "005930"},
        preferred_ref="detail:ka10002:buy_brokers",
    ),
    RoutingCase(
        "삼성전자 외국인 종목별 매매동향 알려줘",
        "base:ka10059",
        "CC-05",
        "why-move-flow",
        arguments={
            "stk_cd": "005930",
            "dt": "20260831",
            "amt_qty_tp": "1",
            "trde_tp": "0",
            "unit_tp": "1000",
        },
    ),
    # discovery-value (CC-06 discovery / CC-03 stock-info) --------------------
    RoutingCase(
        "거래량 급증 종목 순위 보여줘",
        "base:ka10023",
        "CC-06",
        "discovery-value",
        arguments={
            "mrkt_tp": "000",
            "sort_tp": "1",
            "tm_tp": "1",
            "trde_qty_tp": "5",
            "tm": "1",
            "stk_cnd": "0",
            "pric_tp": "0",
            "stex_tp": "1",
        },
    ),
    RoutingCase(
        "예상체결 등락률 상위 종목 보여줘",
        "base:ka10029",
        "CC-06",
        "discovery-value",
        arguments={
            "mrkt_tp": "000",
            "sort_tp": "1",
            "trde_qty_cnd": "0000",
            "stk_cnd": "0",
            "crd_cnd": "0",
            "pric_cnd": "0",
            "stex_tp": "1",
        },
    ),
    RoutingCase(
        "삼성전자 체결 정보를 보여줘",
        "base:ka10003",
        "CC-03",
        "discovery-value",
        arguments={"stk_cd": "005930"},
        preferred_ref="base:ka10003",
    ),
    # sector-theme (CC-06) ------------------------------------------------------
    RoutingCase(
        "업종 현재가 일별 추이만",
        "detail:ka20009:daily_history",
        "CC-06",
        "sector-theme",
        arguments={"mrkt_tp": "0", "inds_cd": "001"},
        preferred_ref="detail:ka20009:daily_history",
    ),
    RoutingCase(
        "코스피 업종 현재가 알려줘",
        "detail:ka20001:market_snapshot",
        "CC-06",
        "sector-theme",
        arguments={"mrkt_tp": "0", "inds_cd": "001"},
    ),
    RoutingCase(
        "업종코드 001의 현재가 알려줘",
        "detail:ka20001:market_snapshot",
        "CC-06",
        "sector-theme",
        arguments={"mrkt_tp": "0", "inds_cd": "001"},
    ),
    # watchlist-condition (CC-06) ------------------------------------------------
    RoutingCase(
        "내가 만든 조건검색식으로 실시간 종목 편입 이탈 알림 받고 싶어",
        "base:ka10173",
        "CC-06",
        "watchlist-condition",
        intent=DiscoveryIntent.WEBSOCKET,
        arguments={"trnm": "CNSRREQ", "seq": "0", "search_type": "1", "stex_tp": "K"},
    ),
    RoutingCase(
        "저장해둔 조건검색식 목록 좀 불러와줘",
        "base:ka10171",
        "CC-06",
        "watchlist-condition",
        intent=DiscoveryIntent.WEBSOCKET,
        arguments={"trnm": "CNSRLST"},
    ),
    RoutingCase(
        "삼성전자를 관심종목에 담고 정보를 보여줘",
        "base:ka10095",
        "CC-06",
        "watchlist-condition",
        arguments={"stk_cd": "005930"},
        preferred_ref="base:ka10095",
    ),
    # etf-product (CC-03) --------------------------------------------------------
    RoutingCase(
        "KODEX 200 ETF 종목 정보를 조회해줘",
        "base:ka40002",
        "CC-03",
        "etf-product",
        arguments={"stk_cd": "069500"},
    ),
    RoutingCase(
        "KODEX 200 수익률 알려줘",
        "base:ka40001",
        "CC-03",
        "etf-product",
        arguments={"stk_cd": "069500", "etfobjt_idex_cd": "069500", "dt": "20260831"},
        preferred_ref="base:ka40001",
    ),
    RoutingCase(
        "KODEX 200 일별 추이 알려줘",
        "base:ka40003",
        "CC-03",
        "etf-product",
        arguments={"stk_cd": "069500"},
        preferred_ref="base:ka40003",
    ),
    # elw-product (CC-03) --------------------------------------------------------
    RoutingCase(
        "이 ELW의 일별 민감도 지표를 알려줘",
        "base:ka10048",
        "CC-03",
        "elw-product",
        arguments={"stk_cd": "57JBHH"},
    ),
    RoutingCase(
        "이 ELW의 현재 민감도 지표를 알려줘",
        "base:ka10050",
        "CC-03",
        "elw-product",
        arguments={"stk_cd": "57JBHH"},
    ),
    RoutingCase(
        "이 ELW의 괴리율을 알려줘",
        "base:ka30004",
        "CC-03",
        "elw-product",
        arguments={
            "isscomp_cd": "000000000000",
            "bsis_aset_cd": "000000000000",
            "rght_tp": "000000",
            "lpcd": "000000000000",
            "trde_end_elwskip": "0",
        },
    ),
    # market-vi (CC-06) -----------------------------------------------------------
    RoutingCase(
        "005930 VI 발동 실시간 알림 받고싶어",
        "base:1h",
        "CC-06",
        "market-vi",
        intent=DiscoveryIntent.WEBSOCKET,
        arguments={"trnm": "REG", "grp_no": "1", "refresh": "1"},
    ),
    RoutingCase(
        "005930 VI 발동 해제 실시간 알림 받고 싶어",
        "base:1h",
        "CC-06",
        "market-vi",
        intent=DiscoveryIntent.WEBSOCKET,
        arguments={"trnm": "REG", "grp_no": "1", "refresh": "1"},
    ),
    RoutingCase(
        "삼성전자에 VI가 발동됐는지 실시간으로 알려줘",
        "base:1h",
        "CC-06",
        "market-vi",
        intent=DiscoveryIntent.WEBSOCKET,
        arguments={"trnm": "REG", "grp_no": "1", "refresh": "1"},
    ),
    # account-risk (CC-01) ---------------------------------------------------------
    RoutingCase(
        "계좌별 주문체결 현황만",
        "detail:kt00009:order_execution_status",
        "CC-01",
        "account-risk",
        arguments={
            "stk_bond_tp": "0",
            "mrkt_tp": "0",
            "sell_tp": "0",
            "qry_tp": "0",
            "dmst_stex_tp": "KRX",
        },
        preferred_ref="detail:kt00009:order_execution_status",
    ),
    RoutingCase(
        "금일 재사용 금액만",
        "detail:kt00013:today_reuse",
        "CC-01",
        "account-risk",
        preferred_ref="detail:kt00013:today_reuse",
    ),
    RoutingCase(
        "내 계좌 잔고 조회해줘",
        "detail:kt00005:settled_positions",
        "CC-01",
        "account-risk",
        arguments={"dmst_stex_tp": "KRX"},
    ),
    RoutingCase(
        "내 계좌 출금 가능 금액 조회해줘",
        "detail:kt00001:withdrawal_and_order_capacity",
        "CC-01",
        "account-risk",
        arguments={"qry_tp": "3"},
        preferred_ref="detail:kt00001:withdrawal_and_order_capacity",
    ),
    # order-safe-ticket (CC-02) -----------------------------------------------------
    RoutingCase(
        "005930을 다섯 주 시장가로 매수해줘",
        "base:kt10000",
        "CC-02",
        "order-safe-ticket",
        intent=DiscoveryIntent.ORDER,
        arguments={"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "5", "trde_tp": "3"},
    ),
    RoutingCase(
        "삼성전자 5주를 시장가로 매도해줘",
        "base:kt10001",
        "CC-02",
        "order-safe-ticket",
        intent=DiscoveryIntent.ORDER,
        arguments={"dmst_stex_tp": "KRX", "stk_cd": "005930", "ord_qty": "5", "trde_tp": "3"},
    ),
    RoutingCase(
        "삼성전자 미체결 주문을 취소해줘",
        "base:kt10003",
        "CC-02",
        "order-safe-ticket",
        intent=DiscoveryIntent.ORDER,
        arguments={
            "dmst_stex_tp": "KRX",
            "orig_ord_no": "0000001",
            "stk_cd": "005930",
            "cncl_qty": "0",
        },
        preferred_ref="base:kt10003",
    ),
    # gold-market (CC-03) -------------------------------------------------------------
    RoutingCase(
        "이 금현물의 일별 추이를 보여줘",
        "base:ka50012",
        "CC-03",
        "gold-market",
        arguments={"stk_cd": "04", "base_dt": "20260831"},
    ),
    RoutingCase(
        "이 금현물의 현재가를 알려줘",
        "base:ka50100",
        "CC-03",
        "gold-market",
        arguments={"stk_cd": "04"},
    ),
    RoutingCase(
        "이 금현물의 최근 체결 추이를 기간별로 보여줘",
        "base:ka50010",
        "CC-03",
        "gold-market",
        arguments={"stk_cd": "04"},
    ),
    # ranking mode (CC-03 · CC-05 순위 탭 — OPERATION_PRESENTATION_OVERRIDES) ----
    RoutingCase(
        "가격 급등락 종목 보여줘",
        "base:ka10019",
        "CC-03",
        "discovery-value",
        arguments={
            "mrkt_tp": "000",
            "flu_tp": "1",
            "tm_tp": "1",
            "tm": "1",
            "trde_qty_tp": "0000",
            "stk_cnd": "0",
            "crd_cnd": "0",
            "pric_cnd": "0",
            "updown_incls": "1",
            "stex_tp": "1",
        },
        expected_mode="ranking",
    ),
    RoutingCase(
        "ELW 잔량 순위 보여줘",
        "base:ka30010",
        "CC-03",
        "elw-product",
        arguments={"sort_tp": "1", "rght_tp": "000", "trde_end_skip": "0"},
        expected_mode="ranking",
    ),
    RoutingCase(
        "대차거래 상위 10 종목 보여줘",
        "base:ka10069",
        "CC-05",
        "why-move-flow",
        arguments={"strt_dt": "20260825", "mrkt_tp": "000"},
        expected_mode="ranking",
    ),
)


def test_case_table_covers_every_recipe_at_least_three_times() -> None:
    recipe_ids = {recipe.recipe_id for recipe in get_view_recipe_registry().recipes}
    assert len(recipe_ids) == 12

    counts: dict[str, int] = {}
    for case in CASES:
        counts[case.expected_recipe_id] = counts.get(case.expected_recipe_id, 0) + 1

    assert set(counts) == recipe_ids
    assert all(count >= 3 for count in counts.values()), counts
    assert len(CASES) >= 36


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.question)
def test_representative_question_routes_to_expected_card_and_recipe(
    case: RoutingCase,
) -> None:
    service = _service()

    resolved = service.resolve(
        ResolveRequest(
            question=case.question,
            intent=case.intent,
            arguments=case.arguments,
            preferred_ref=case.preferred_ref,
        )
    )

    actual_ref = resolved.operation_ref
    actual_card_id = resolve_canvas_card(actual_ref).card_id
    actual_recipe_id = get_view_recipe_registry().for_operation(actual_ref).recipe_id

    assert actual_ref == case.expected_operation_ref, (
        f"question {case.question!r} was expected to resolve to operation "
        f"{case.expected_operation_ref!r} but actually resolved to {actual_ref!r} "
        f"(card={actual_card_id}, recipe={actual_recipe_id})"
    )
    assert actual_card_id == case.expected_card_id, (
        f"question {case.question!r} (operation {actual_ref}) was expected to land on "
        f"Canvas card {case.expected_card_id!r} but actually landed on "
        f"{actual_card_id!r}"
    )
    assert actual_recipe_id == case.expected_recipe_id, (
        f"question {case.question!r} (operation {actual_ref}) was expected to use "
        f"view recipe {case.expected_recipe_id!r} but actually used "
        f"{actual_recipe_id!r}"
    )
    if case.expected_mode is not None:
        actual_mode = resolve_canvas_card(actual_ref).mode
        assert actual_mode == case.expected_mode, (
            f"question {case.question!r} (operation {actual_ref}) was expected to "
            f"open card mode {case.expected_mode!r} but actually opened "
            f"{actual_mode!r}"
        )
