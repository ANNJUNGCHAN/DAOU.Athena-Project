"""Verify direct QueryFrame extraction without values or lexical expansion."""

from __future__ import annotations

import pytest

from athena_api.routing_contract import (
    BindingRole,
    DataIntent,
    EntityKind,
    ExecutionKind,
    Measure,
    RoutingSubject,
    TemporalScope,
)
from athena_api.selector.query_frame import (
    ENTITY_MARKER_SHA256,
    ENTITY_MARKER_VERSION,
    QUERY_FRAME_VERSION,
    extract_query_frame,
    is_advice_request,
    mask_opaque_instrument_spans,
)


def test_stock_price_question_extracts_direct_typed_evidence() -> None:
    frame = extract_query_frame("삼성전자 오늘 주가 얼마야?")
    assert frame.version == QUERY_FRAME_VERSION
    assert frame.subject is RoutingSubject.INSTRUMENT
    assert frame.entity_kinds == (EntityKind.STOCK,)
    assert frame.execution is None
    assert frame.data_intents == (DataIntent.CURRENT_QUOTE,)
    assert frame.temporal_scopes == (TemporalScope.CURRENT,)
    assert frame.measures == (Measure.PRICE,)


def test_explicit_order_question_extracts_roles_but_never_values() -> None:
    question = "내 계좌에서 종목코드 005930을 75000원에 10주 매수 주문해"
    frame = extract_query_frame(question)
    assert frame.subject is RoutingSubject.ORDER
    assert EntityKind.ACCOUNT in frame.entity_kinds
    assert EntityKind.STOCK in frame.entity_kinds
    assert EntityKind.ORDER in frame.entity_kinds
    assert frame.execution is ExecutionKind.ORDER
    assert DataIntent.ORDER_ACTION in frame.data_intents
    assert BindingRole.ACCOUNT_CONTEXT in frame.bindings
    assert BindingRole.INSTRUMENT_CODE in frame.bindings
    assert BindingRole.SIDE in frame.bindings
    serialized = str(frame.canonical())
    assert "005930" not in serialized
    assert "75000" not in serialized
    assert "10주" not in serialized


def test_neutral_question_stays_empty_instead_of_guessing_other() -> None:
    frame = extract_query_frame("삼성전자 어때?")
    assert frame.subject is None
    assert frame.entity_kinds == ()
    assert frame.execution is None
    assert frame.data_intents == ()
    assert frame.temporal_scopes == ()
    assert frame.measures == ()
    assert frame.result_shapes == ()
    assert frame.bindings == ()


def test_authored_english_terms_use_word_boundaries() -> None:
    assert extract_query_frame("show stock price").measures == (Measure.PRICE,)
    assert extract_query_frame("the enterprise is growing").measures == ()


def test_authored_korean_terms_require_a_left_lexical_boundary() -> None:
    company = extract_query_frame("현대차 오늘 주가 얼마야?")
    lending = extract_query_frame("삼성전자 대차거래 현황 알려줘")
    short_sale = extract_query_frame("삼성전자 공매도 현황 알려줘")

    assert Measure.LENDING not in company.measures
    assert Measure.LENDING in lending.measures
    assert Measure.SHORT_SALE in short_sale.measures
    assert BindingRole.SIDE not in short_sale.bindings


def test_opaque_proper_name_suffix_cannot_emit_ownership_or_quote_intent() -> None:
    templates = (
        "Show POSCO Holdings' annual high, annual low, and 250-day price range",
        "Show Acme Holdings' annual high, annual low, and 250-day price range",
        "Show 123456 annual high, annual low, and 250-day price range",
    )
    frames = tuple(extract_query_frame(question) for question in templates)

    assert all(frame.canonical() == frames[0].canonical() for frame in frames[1:])
    assert DataIntent.PRICE_RANGE in frames[0].data_intents
    assert DataIntent.CURRENT_QUOTE not in frames[0].data_intents
    assert Measure.OWNERSHIP not in frames[0].measures
    assert Measure.PRICE in frames[0].measures

    ownership = extract_query_frame("Show liquidity-provider holdings for this ELW")
    assert Measure.OWNERSHIP in ownership.measures


@pytest.mark.parametrize("control", ("List", "Break", "What", "Show", "D+2"))
def test_entity_mask_preserves_capitalized_control_and_period_tokens(control: str) -> None:
    assert control in mask_opaque_instrument_spans(f"{control} the current stock data")


@pytest.mark.parametrize(
    "question",
    (
        "카카오를 지금 사는 선택이 좋은지 의견만 말해줘",
        "Do you think selling LG Electronics today would be wise?",
        "mini gold spot을 지금 buy하는 게 합리적인지 분석만 해줘",
        "미체결 주문을 취소하면 어떤 장단점이 있는지 설명해줘",
    ),
)
def test_action_advice_is_distinct_from_an_execution_instruction(question: str) -> None:
    assert is_advice_request(question)


@pytest.mark.parametrize(
    "question",
    ("삼성전자 3주 매수해줘", "Cancel order 123 now", "미체결 주문 현황을 보여줘"),
)
def test_imperative_and_read_only_requests_are_not_advice(question: str) -> None:
    assert not is_advice_request(question)


@pytest.mark.parametrize(
    "question",
    (
        "Would purchasing this stock now be appropriate for a conservative investor?",
        "portfolio에 금 현물을 어느 정도 편입할지 advice만 해줘",
    ),
)
def test_advice_predicates_cover_suitability_and_allocation_wording(question: str) -> None:
    assert is_advice_request(question)


def test_advice_predicates_preserve_direct_purchase_instruction() -> None:
    assert not is_advice_request("Purchase three shares of this stock at market now")


def test_market_in_temporal_clause_does_not_override_expected_quote_subject() -> None:
    frame = extract_query_frame(
        "stream the expected opening match price for 005930 before the market fixes"
    )
    assert frame.subject is RoutingSubject.INSTRUMENT
    assert frame.entity_kinds == (EntityKind.STOCK,)
    assert frame.execution is ExecutionKind.WEBSOCKET
    assert frame.data_intents == (
        DataIntent.EXPECTED_QUOTE,
        DataIntent.SUBSCRIPTION,
    )
    assert frame.measures == (Measure.PRICE,)
    assert "005930" not in str(frame.canonical())


def test_chart_periods_and_subjects_remain_directional() -> None:
    stock = extract_query_frame("005930 5분봉 차트를 보여줘")
    sector = extract_query_frame("코스피 업종 일봉 차트를 보여줘")
    assert stock.subject is RoutingSubject.INSTRUMENT
    assert stock.entity_kinds == (EntityKind.STOCK,)
    assert stock.temporal_scopes == (TemporalScope.MINUTE,)
    assert DataIntent.CHART in stock.data_intents
    assert sector.subject is RoutingSubject.SECTOR
    assert sector.temporal_scopes == (TemporalScope.DAILY,)


def test_ranking_and_order_specializations_require_direct_action_evidence() -> None:
    ranking = extract_query_frame("오늘 volume 급증 종목 순위 알려줘")
    amend = extract_query_frame("amend an existing stock order")
    cancel = extract_query_frame("cancel an existing stock order")
    assert DataIntent.VOLUME_RANKING in ranking.data_intents
    assert DataIntent.SPIKE_RANKING in ranking.data_intents
    assert DataIntent.ORDER_AMEND in amend.data_intents
    assert DataIntent.ORDER_CANCEL not in amend.data_intents
    assert DataIntent.ORDER_CANCEL in cancel.data_intents


def test_korean_compound_order_nouns_keep_their_authored_action_boundary() -> None:
    buy = extract_query_frame("삼성전자 주식 매수주문")
    sell = extract_query_frame("삼성전자 주식 매도주문")
    cancel = extract_query_frame("주식 취소주문")

    assert buy.subject is RoutingSubject.ORDER
    assert sell.subject is RoutingSubject.ORDER
    assert buy.execution is ExecutionKind.ORDER
    assert sell.execution is ExecutionKind.ORDER
    assert cancel.execution is ExecutionKind.ORDER
    assert DataIntent.ORDER_ACTION in buy.data_intents
    assert DataIntent.ORDER_ACTION in sell.data_intents
    assert DataIntent.ORDER_CANCEL in cancel.data_intents
    assert BindingRole.SIDE in buy.bindings
    assert BindingRole.SIDE in sell.bindings


def test_realtime_market_measure_with_opaque_entity_is_instrument_scoped() -> None:
    frame = extract_query_frame("삼성전자 실시간 체결가 tick 단위로 받아줘")
    assert frame.subject is RoutingSubject.INSTRUMENT
    assert frame.entity_kinds == (EntityKind.STOCK,)
    assert frame.execution is ExecutionKind.WEBSOCKET
    assert frame.measures == (Measure.PRICE, Measure.TRADE)
    assert "삼성전자" not in str(frame.canonical())


def test_value_free_entity_evidence_generalizes_across_unseen_names_and_codes() -> None:
    named = extract_query_frame("새롬테크의 최신 시세가 얼마인지 알려줘")
    coded = extract_query_frame("123456의 방금 시세와 거래량을 알려줘")

    for frame in (named, coded):
        assert frame.subject is RoutingSubject.INSTRUMENT
        assert frame.entity_kinds == (EntityKind.STOCK,)
        assert DataIntent.CURRENT_QUOTE in frame.data_intents
        assert Measure.PRICE in frame.measures
    assert "새롬테크" not in str(named.canonical())
    assert "123456" not in str(coded.canonical())

    weak = extract_query_frame("지금 값이 얼마나 돼?")
    assert weak.subject is None
    assert weak.entity_kinds == ()


def test_reviewed_asset_markers_classify_products_without_retaining_names() -> None:
    etf = extract_query_frame("KINDEX 미래산업의 장중 가격 흐름")
    ordinary = extract_query_frame("새롬테크의 장중 가격 흐름")

    assert etf.entity_kinds == (EntityKind.ETF,)
    assert ordinary.entity_kinds == (EntityKind.STOCK,)
    assert "kindex" not in str(etf.canonical()).casefold()
    assert "새롬테크" not in str(ordinary.canonical())
    assert ENTITY_MARKER_VERSION == "selector-entity-markers-v1"
    assert len(ENTITY_MARKER_SHA256) == 64


def test_sector_account_and_stream_context_override_generic_instrument_words() -> None:
    sector = extract_query_frame("semiconductor industry's latest index level")
    account = extract_query_frame(
        "List each stock I hold with its valuation amount and unrealized profit or loss"
    )
    stream = extract_query_frame("주가가 바뀔 때마다 계속 받아보고 싶어")

    assert sector.subject is RoutingSubject.SECTOR
    assert sector.entity_kinds == (EntityKind.SECTOR_INDEX,)
    assert DataIntent.CURRENT_QUOTE in sector.data_intents
    assert account.subject is RoutingSubject.ACCOUNT
    assert EntityKind.ACCOUNT in account.entity_kinds
    assert DataIntent.PORTFOLIO in account.data_intents
    assert stream.execution is ExecutionKind.WEBSOCKET
    assert DataIntent.SUBSCRIPTION in stream.data_intents


def test_numeric_periods_market_orders_and_read_only_order_status_are_directional() -> None:
    minute = extract_query_frame("Plot an instrument in ten-minute candles")
    market_buy = extract_query_frame("SK하이닉스 두 주를 시장가로 바로 매수해줘")
    status = extract_query_frame("취소 가능한 금 현물 미체결 주문이 있는지만 확인해줘")

    assert minute.temporal_scopes == (TemporalScope.MINUTE,)
    assert DataIntent.CHART in minute.data_intents
    assert market_buy.subject is RoutingSubject.ORDER
    assert EntityKind.MARKET not in market_buy.entity_kinds
    assert market_buy.execution is ExecutionKind.ORDER
    assert status.subject is RoutingSubject.ACCOUNT
    assert status.execution is ExecutionKind.QUERY
    assert DataIntent.ACCOUNT_STATE in status.data_intents
    assert DataIntent.ORDER_CANCEL not in status.data_intents
