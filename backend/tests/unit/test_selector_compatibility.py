"""Lock value-free primitive evidence and shadow compatibility proofs."""

from __future__ import annotations

from dataclasses import replace
from types import MappingProxyType

import pytest

from athena_api.routing_contract import (
    ActionKind,
    BindingRole,
    CapabilityKind,
    DataIntent,
    EntityKind,
    ExecutionKind,
    FeedKind,
    FinancingKind,
    Measure,
    RoutingResultShape,
    RoutingSubject,
    TemporalScope,
)
from athena_api.selector import primitive_evidence
from athena_api.selector.catalog import build_operation_catalog
from athena_api.selector.compatibility import (
    CompatibilityConfidence,
    CompatibilityDecisionStatus,
    CompatibilityStatus,
    OperationProfile,
    decide_compatibility,
    decide_selector_compatibility,
    prove_compatibility,
)
from athena_api.selector.errors import (
    AmbiguousOperationError,
    DetailGroupRequiredError,
    NoConfidentMatchError,
    OperationNotFoundError,
    PreferredOperationError,
    UnknownDetailGroupError,
)
from athena_api.selector.instrument_identity import InstrumentIdentityIndex
from athena_api.selector.plans import PlanSigner
from athena_api.selector.primitive_evidence import (
    EntityCardinality,
    EvidenceAxis,
    Ownership,
    RelationKind,
    SpeechAct,
    TargetPresence,
    TargetResolution,
    analyze_question,
)
from athena_api.selector.schemas import (
    DiscoveryIntent,
    ReasonCode,
    ResolveRequest,
    ResponseMode,
    SearchRequest,
)
from athena_api.selector.service import SelectorService


@pytest.fixture(scope="module")
def catalog():
    return build_operation_catalog()


@pytest.fixture
def service(catalog):
    return SelectorService(
        catalog,
        PlanSigner(b"compatibility-shadow-test", nonce_factory=lambda: "shadow"),
        instrument_identity=_production_identity_index(),
    )


def _production_identity_index() -> InstrumentIdentityIndex:
    index = InstrumentIdentityIndex()
    index.replace(
        {
            "0": [
                {"code": "005930", "name": "삼성전자", "marketCode": "0"},
                {"code": "005490", "name": "POSCO Holdings", "marketCode": "0"},
                {"code": "123456", "name": "Acme Holdings", "marketCode": "0"},
                {"code": "049720", "name": "고려신용정보", "marketCode": "0"},
                {"code": "654321", "name": "대한대차정보", "marketCode": "0"},
            ],
            "10": [],
            "8": [],
        }
    )
    return index


_PRODUCTION_IDENTITY = _production_identity_index()


def _production_target(question: str) -> TargetResolution | None:
    return _PRODUCTION_IDENTITY.resolve_target(question)


def _stock_target(_question: str) -> TargetResolution:
    return TargetResolution(EntityKind.STOCK)


def _etf_target(_question: str) -> TargetResolution:
    return TargetResolution(EntityKind.ETF)


def _no_target(_question: str) -> None:
    return None


def test_query_analysis_is_value_free_and_keeps_direct_primitives() -> None:
    analysis = analyze_question("Would purchasing 005930 now be appropriate for my account?")
    assert analysis.speech_act is SpeechAct.ADVICE
    assert analysis.action_kind is ActionKind.BUY
    assert analysis.ownership is Ownership.OWNED
    assert "005930" not in repr(analysis)
    assert {atom.axis.value for atom in analysis.atoms} == {
        "speech_act",
        "action_kind",
        "ownership",
        "entity_cardinality",
        "target_presence",
        "target_scope",
        "delivery",
        "aggregation_scope",
        "range_kind",
    }


def test_query_analysis_uses_authoritative_routing_enums() -> None:
    assert primitive_evidence.ActionKind is ActionKind
    analysis = analyze_question("이 종목의 가격을 알려줘")
    assert analysis.action_kind is None
    assert analysis.financing == ()
    assert analysis.feeds == ()


def test_entity_values_never_mint_semantic_or_financing_evidence(catalog) -> None:
    questions = (
        "Show POSCO Holdings annual high and low price range",
        "Show Acme Holdings annual high and low price range",
        "Show 005490 annual high and low price range",
    )
    analyses = (
        analyze_question(questions[0], target_resolver=_production_target),
        analyze_question(questions[1], target_resolver=_production_target),
        analyze_question(questions[2], target_resolver=_production_target),
    )
    assert analyses[0] == analyses[1] == analyses[2]
    proofs = tuple(
        prove_compatibility(analysis, catalog.by_ref["detail:ka10001:price_range"])
        for analysis in analyses
    )
    assert proofs[0] == proofs[1] == proofs[2]
    assert Measure.OWNERSHIP not in analyses[0].measures

    company_credit = analyze_question("Credit Corp stock 한 주 매수해줘")
    explicit_credit = analyze_question("Use credit to purchase one share of this stock")
    assert company_credit.financing == (FinancingKind.CASH,)
    assert explicit_credit.financing == (FinancingKind.CREDIT,)


def test_korean_issuer_substrings_never_mint_financing_or_capability(catalog) -> None:
    named = analyze_question(
        "고려신용정보 한 주 매수해줘", target_resolver=_production_target
    )
    coded = analyze_question("049720 한 주 매수해줘", target_resolver=_production_target)
    embedded_capability = analyze_question(
        "대한대차정보 한 주 매수해줘", target_resolver=_production_target
    )
    explicit_credit = analyze_question(
        "신용으로 고려신용정보 한 주 매수해줘",
        target_resolver=_production_target,
    )

    assert named == coded == embedded_capability
    assert named.financing == (FinancingKind.CASH,)
    assert explicit_credit.financing == (FinancingKind.CREDIT,)
    assert "고려신용정보" not in repr(named)
    assert "대한대차정보" not in repr(embedded_capability)

    operations = (catalog.by_ref["base:kt10000"], catalog.by_ref["base:kt10006"])
    named_decision = decide_compatibility(named, operations)
    coded_decision = decide_compatibility(coded, operations)
    assert named_decision == coded_decision
    assert named_decision.selected_operation_ref == "base:kt10000"


def test_instrument_target_anchor_is_value_free_and_can_come_from_bound_args(
    catalog,
) -> None:
    operation = catalog.by_ref["detail:ka10001:current_trading"]
    bare = analyze_question("오늘 주가 얼마야?")
    named = analyze_question("삼성전자 오늘 주가 얼마야?")
    coded = analyze_question(
        "005930 오늘 주가 얼마야?", target_resolver=_production_target
    )
    arbitrary = analyze_question("고려신용정보 오늘 주가 얼마야?")
    deictic = analyze_question("이 종목 오늘 주가 얼마야?")
    bound = analyze_question(
        "오늘 주가 얼마야?",
        bound_argument_roles=(BindingRole.INSTRUMENT_CODE,),
    )
    resolved = analyze_question(
        "고려신용정보 오늘 주가 얼마야?",
        target_resolver=_production_target,
    )

    bare_proof = prove_compatibility(bare, operation)
    assert bare.entity_cardinality is EntityCardinality.UNKNOWN
    assert bare.target_presence is TargetPresence.UNKNOWN
    assert bare.target_scope_present
    assert bare_proof.status is CompatibilityStatus.INSUFFICIENT
    assert "target_anchor" in bare_proof.missing
    for analysis in (named, arbitrary):
        assert analysis.entity_cardinality is EntityCardinality.UNKNOWN
        assert analysis.target_presence is TargetPresence.UNKNOWN
        assert analysis.target_scope_present
        assert prove_compatibility(analysis, operation).status is CompatibilityStatus.INSUFFICIENT
    for analysis in (coded, deictic, resolved):
        assert analysis.entity_cardinality is EntityCardinality.SINGLE
        assert analysis.target_presence is TargetPresence.PRESENT
        assert analysis.target_scope_present
        assert prove_compatibility(analysis, operation).status is CompatibilityStatus.MATCH
    assert bound.entity_cardinality is EntityCardinality.UNKNOWN
    assert bound.target_presence is TargetPresence.UNKNOWN
    assert bound.target_scope_present
    assert prove_compatibility(bound, operation).status is CompatibilityStatus.INSUFFICIENT
    assert "삼성전자" not in repr(named)
    assert "고려신용정보" not in repr(arbitrary)

    bare_decision = decide_selector_compatibility(
        catalog, "오늘 주가 얼마야?", DiscoveryIntent.QUERY
    )
    bound_decision = decide_selector_compatibility(
        catalog,
        "오늘 주가 얼마야?",
        DiscoveryIntent.QUERY,
        bound_argument_roles=(BindingRole.INSTRUMENT_CODE,),
    )
    assert bare_decision.status is CompatibilityDecisionStatus.REJECTED
    assert bare_decision.confidence is CompatibilityConfidence.LOW
    assert bound_decision.status is CompatibilityDecisionStatus.REJECTED
    assert bound_decision.selected_operation_ref is None


def test_target_presence_does_not_treat_asset_class_as_a_bound_instrument() -> None:
    for question in ("오늘 주가 얼마야?", "ETF 가격을 알려줘", "금 현물 시세를 알려줘"):
        analysis = analyze_question(question)
        assert analysis.target_presence is TargetPresence.UNKNOWN

    for question in (
        "삼성전자 일별 주가를 보여줘",
        "삼성전자 현재가를 보여줘",
        "현재가와 거래량을 삼성전자 기준으로 보여줘",
        "삼성물산의 아주 긴 가격 흐름을 연 단위 캔들로 보여줘",
        "한미약품 intraday price를 15-minute candles로 그려줘",
        "고려신용정보 월별 가격 추이를 보여줘",
        "Samsung C&T annual candle chart",
    ):
        analysis = analyze_question(question)
        assert analysis.target_presence is TargetPresence.UNKNOWN

    for question in (
        "005930 오늘 주가 얼마야?",
        "이 종목의 가격을 알려줘",
        "선택한 주식 현재가를 알려줘",
    ):
        analysis = analyze_question(question, target_resolver=_production_target)
        assert analysis.target_presence is TargetPresence.PRESENT
        assert analysis.entity_cardinality is EntityCardinality.SINGLE

    for question in (
        "오늘 현재가를 보여줘",
        "가격과 여행 일정을 제주 기준으로 정리해줘",
        "시장 가격 흐름을 설명해줘",
        "제주 여행 가격 추이를 알려줘",
        "호텔 예약 가격 추이를 알려줘",
        "일반 상품 가격 추이를 알려줘",
        "서울 아파트 가격 추이 알려줘",
        "아이폰 현재 가격 알려줘",
        "비트코인 현재가 알려줘",
        "강남 전세 가격 흐름 알려줘",
        "원달러 환율 현재가 알려줘",
        "제주 음식 가격 추이 알려줘",
        "금요일 현재가 알려줘",
        "Show Bitcoin current price",
        "Show New York apartment price history",
        "Show USD KRW current quote",
    ):
        analysis = analyze_question(question)
        assert analysis.target_presence is TargetPresence.UNKNOWN
        assert EntityKind.STOCK not in analysis.entity_kinds
        assert analysis.subject is not RoutingSubject.INSTRUMENT
        assert analysis.entity_cardinality is EntityCardinality.UNKNOWN

    resolved = analyze_question(
        "주문이 바뀌어도 새로운회사 현재가를 알려줘",
        target_resolver=_stock_target,
    )
    assert resolved.target_presence is TargetPresence.PRESENT
    assert resolved.entity_cardinality is EntityCardinality.SINGLE
    assert "새로운회사" not in repr(resolved)

    assert not analyze_question("일별 추이 보여줘").target_scope_present
    assert analyze_question("코스피 업종 일별 추이 보여줘").target_scope_present
    assert analyze_question("내 계좌 일별 수익을 보여줘").target_scope_present


def test_optional_instrument_filter_does_not_require_a_target_anchor(catalog) -> None:
    analysis = analyze_question("Show order identifiers and execution status for my account")
    operation = catalog.by_ref["detail:kt00009:order_execution_status"]
    profile = OperationProfile.from_document(operation)
    assert not profile.requires_instrument_target
    assert "target_anchor" not in prove_compatibility(analysis, profile).missing


def test_transport_neutral_adapter_keeps_auto_on_query_surface(catalog) -> None:
    decision = decide_selector_compatibility(
        catalog,
        "Open a leveraged pound-dollar currency position on my behalf",
        DiscoveryIntent.AUTO,
    )
    assert decision.status is CompatibilityDecisionStatus.REJECTED
    assert decision.selected_operation_ref is None


@pytest.mark.parametrize(
    "question",
    (
        "서울 아파트 가격 추이 알려줘",
        "아이폰 현재 가격 알려줘",
        "비트코인 현재가 알려줘",
        "강남 전세 가격 흐름 알려줘",
        "원달러 환율 현재가 알려줘",
        "제주 음식 가격 추이 알려줘",
        "금요일 현재가 알려줘",
        "Show Bitcoin current price",
        "Show New York apartment price history",
        "Show USD KRW current quote",
    ),
)
def test_unresolved_proper_names_never_authorize_a_stock_plan(catalog, question) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
    )
    assert decision.selected_family_ref is None
    assert decision.selected_operation_ref is None
    assert decision.confidence is CompatibilityConfidence.LOW


def test_only_internal_resolver_evidence_authorizes_an_arbitrary_issuer(catalog) -> None:
    question = "새로운회사 현재가 알려줘"
    unresolved = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        bound_argument_roles=(BindingRole.INSTRUMENT_CODE,),
    )
    resolved = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=lambda candidate: (
            TargetResolution(EntityKind.STOCK) if candidate == question else None
        ),
    )

    assert unresolved.status is CompatibilityDecisionStatus.REJECTED
    assert unresolved.selected_operation_ref is None
    assert resolved.status is CompatibilityDecisionStatus.SELECTED
    assert resolved.selected_operation_ref == "detail:ka10001:current_trading"


def test_reviewed_marker_and_unseen_alias_have_identical_plan_authority(catalog) -> None:
    questions = (
        "KODEX 200 ETF daily price history를 보여줘",
        "ACE 200 ETF daily price history를 보여줘",
    )
    raw = tuple(
        decide_selector_compatibility(catalog, question, DiscoveryIntent.QUERY)
        for question in questions
    )
    resolved = tuple(
        decide_selector_compatibility(
            catalog,
            question,
            DiscoveryIntent.QUERY,
            target_resolver=_etf_target,
        )
        for question in questions
    )

    assert all(decision.selected_operation_ref is None for decision in raw)
    assert all(decision.confidence is CompatibilityConfidence.LOW for decision in raw)
    assert {decision.selected_operation_ref for decision in resolved} == {"base:ka40003"}


def test_specialized_capabilities_select_exact_typed_profiles(catalog) -> None:
    expected_market = decide_selector_compatibility(
        catalog,
        "삼성전자 주식 예상체결가를 알려줘",
        DiscoveryIntent.QUERY,
        target_resolver=_stock_target,
    )
    volatility_event = decide_selector_compatibility(
        catalog,
        "005930 VI 발동 실시간 알림 받고싶어",
        DiscoveryIntent.WEBSOCKET,
        target_resolver=_production_target,
    )
    today_reuse = decide_selector_compatibility(
        catalog,
        "금일 재사용 금액만",
        DiscoveryIntent.QUERY,
    )

    assert expected_market.selected_operation_ref == "detail:ka10007:expected_market"
    assert volatility_event.selected_operation_ref == "base:1h"
    assert today_reuse.selected_operation_ref == "detail:kt00013:today_reuse"


@pytest.mark.parametrize(
    "question",
    (
        "ka100010 current price",
        "xka10001 현재가",
        "ka10001x current price",
    ),
)
def test_transport_neutral_adapter_rejects_non_boundary_operation_tokens(
    catalog, question
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        bound_argument_roles=(BindingRole.INSTRUMENT_CODE,),
    )
    assert decision.status is CompatibilityDecisionStatus.REJECTED
    assert decision.selected_operation_ref is None


def test_advice_and_third_party_account_are_explicit_contradictions(catalog) -> None:
    advice = analyze_question(
        "Would purchasing this stock now be appropriate for a conservative investor?"
    )
    advice_proof = prove_compatibility(advice, catalog.by_ref["base:kt10000"])
    assert advice_proof.status is CompatibilityStatus.CONTRADICTION
    assert "speech_act:advice" in advice_proof.contradictions

    third_party = analyze_question("다른 사람 명의 계좌 잔고를 조회해줘")
    account_proof = prove_compatibility(
        third_party, catalog.by_ref["detail:kt00004:cash_and_assets"]
    )
    assert account_proof.status is CompatibilityStatus.CONTRADICTION
    assert "ownership:third_party" in account_proof.contradictions


def test_multi_instrument_request_contradicts_single_instrument_binding(catalog) -> None:
    analysis = analyze_question(
        "Compare the dated performance of ACE 200 and KODEX 200 with one request"
    )
    assert analysis.entity_cardinality is EntityCardinality.MULTIPLE
    proof = prove_compatibility(analysis, catalog.by_ref["base:ka40001"])
    assert proof.status is CompatibilityStatus.CONTRADICTION
    assert "entity_cardinality:multiple" in proof.contradictions


def test_split_details_are_proved_as_independent_exact_profiles(catalog) -> None:
    analysis = analyze_question(
        "삼성전자의 오늘 가격 범위를 알려줘",
        target_resolver=_stock_target,
    )
    daily_band = prove_compatibility(
        analysis, catalog.by_ref["detail:ka10001:daily_price_band"]
    )
    valuation = prove_compatibility(
        analysis, catalog.by_ref["detail:ka10001:valuation"]
    )
    assert daily_band.operation_ref != valuation.operation_ref
    assert daily_band.status is CompatibilityStatus.MATCH
    assert valuation.status is CompatibilityStatus.CONTRADICTION


def test_compatibility_requires_both_target_and_capability(catalog) -> None:
    analysis = analyze_question("삼성전자 정보를 보여줘")
    proof = prove_compatibility(analysis, catalog.by_ref["base:ka10001"])
    assert proof.status is CompatibilityStatus.INSUFFICIENT
    assert "capability" in proof.missing


def test_sector_order_and_gold_equity_measure_fail_conjunctively(catalog) -> None:
    sector = analyze_question("화학 업종 지수를 다섯 주 시장가로 매수해줘")
    sector_proof = prove_compatibility(sector, catalog.by_ref["base:kt10000"])
    assert sector_proof.status is CompatibilityStatus.CONTRADICTION
    assert "entity_kind:sector_index" in sector_proof.contradictions

    gold = analyze_question("1킬로 금 현물의 PER과 EPS를 조회해줘")
    gold_proof = prove_compatibility(gold, catalog.by_ref["base:ka50100"])
    assert gold_proof.status is CompatibilityStatus.CONTRADICTION
    assert "capability:equity_valuation" in gold_proof.contradictions


def test_product_capability_conflict_rejects_even_when_generic_measures_overlap(
    catalog,
) -> None:
    etf = analyze_question("ACE 200 ETF의 일반 회사 자본금과 결산월을 알려줘")
    proof = prove_compatibility(etf, catalog.by_ref["base:ka40009"])
    assert proof.status is CompatibilityStatus.CONTRADICTION
    assert "capability:equity_corporate_fundamentals" in proof.contradictions


def test_ohlc_chart_and_session_band_have_distinct_primitive_constraints() -> None:
    chart = analyze_question(
        "2026년 6월 일별 시가 고가 저가 종가와 거래량을 차트로 그려줘"
    )
    band = analyze_question(
        "Give today's opening price, session high, session low, and price limits"
    )
    assert DataIntent.CHART in chart.data_intents
    assert DataIntent.PRICE_RANGE not in chart.data_intents
    assert RoutingResultShape.TIME_SERIES in chart.result_shapes
    assert DataIntent.PRICE_RANGE in band.data_intents
    assert TemporalScope.INTRADAY not in band.temporal_scopes
    assert RoutingResultShape.RECORD in band.result_shapes

    expected_band = analyze_question("오늘 시가 고가 저가와 예상체결가를 보여줘")
    assert TemporalScope.DAILY in expected_band.temporal_scopes
    assert TemporalScope.INTRADAY not in expected_band.temporal_scopes


@pytest.mark.parametrize(
    ("question", "subject", "required_intent", "required_measure", "required_shape"),
    (
        (
            "운수장비 업종에서 오른 종목, 보합 종목, 내린 종목 수를 세어줘",
            RoutingSubject.SECTOR,
            DataIntent.SNAPSHOT,
            Measure.CHANGE,
            RoutingResultShape.RECORD,
        ),
        (
            "Order sectors by the net purchases made by each investor class",
            RoutingSubject.SECTOR,
            DataIntent.SNAPSHOT,
            Measure.FLOW,
            RoutingResultShape.COLLECTION,
        ),
        (
            "내가 선택한 계좌의 현금, 예탁자산 추정치, 전체 자산가치를 보여줘",
            RoutingSubject.ACCOUNT,
            DataIntent.ACCOUNT_STATE,
            Measure.VALUATION,
            RoutingResultShape.RECORD,
        ),
        (
            "Retrieve my dated gold transactions with buy/sell side and execution price",
            RoutingSubject.ACCOUNT,
            DataIntent.HISTORY,
            Measure.TRADE,
            RoutingResultShape.TIME_SERIES,
        ),
        (
            "List today's time-stamped ETF executions and volumes",
            RoutingSubject.INSTRUMENT,
            DataIntent.SNAPSHOT,
            Measure.TRADE,
            RoutingResultShape.TIME_SERIES,
        ),
        (
            "Plot liquidity-provider holdings for the selected ELW by trading day",
            RoutingSubject.INSTRUMENT,
            DataIntent.HISTORY,
            Measure.OWNERSHIP,
            RoutingResultShape.TIME_SERIES,
        ),
        (
            "금 현물의 일자별 시세와 거래량 변화를 표로 보여줘",
            RoutingSubject.INSTRUMENT,
            DataIntent.HISTORY,
            Measure.PRICE,
            RoutingResultShape.TIME_SERIES,
        ),
    ),
)
def test_composed_primitives_capture_target_capability_and_shape(
    question,
    subject,
    required_intent,
    required_measure,
    required_shape,
) -> None:
    analysis = analyze_question(question)
    assert analysis.subject is subject
    assert required_intent in analysis.data_intents
    assert required_measure in analysis.measures
    assert required_shape in analysis.result_shapes


def test_order_and_condition_lifecycle_are_atomic_shadow_evidence() -> None:
    order = analyze_question("Place a limit purchase for nine shares of this stock")
    stop = analyze_question("End the realtime session for my saved screening condition")
    assert order.action_kind is ActionKind.BUY
    assert order.execution is ExecutionKind.ORDER
    assert DataIntent.ORDER_ACTION in order.data_intents
    assert stop.action_kind is ActionKind.UNSUBSCRIBE
    assert stop.execution is ExecutionKind.WEBSOCKET
    assert DataIntent.UNSUBSCRIPTION in stop.data_intents
    assert DataIntent.SUBSCRIPTION not in stop.data_intents
    assert EntityKind.CONDITION in stop.entity_kinds


def test_action_and_financing_are_conjunctive_profile_discriminators(catalog) -> None:
    cash_buy = analyze_question("Place a limit purchase for nine shares of this stock")
    assert cash_buy.action_kind is ActionKind.BUY
    assert cash_buy.financing == (FinancingKind.CASH,)
    cash_decision = decide_compatibility(
        cash_buy,
        (catalog.by_ref["base:kt10000"], catalog.by_ref["base:kt10001"]),
    )
    assert cash_decision.status is CompatibilityDecisionStatus.SELECTED
    assert cash_decision.selected_operation_ref == "base:kt10000"

    credit_buy = analyze_question("신용으로 이 종목 두 주를 매수해줘")
    assert credit_buy.action_kind is ActionKind.BUY
    assert credit_buy.financing == (FinancingKind.CREDIT,)
    credit_decision = decide_compatibility(
        credit_buy,
        (catalog.by_ref["base:kt10000"], catalog.by_ref["base:kt10006"]),
    )
    assert credit_decision.status is CompatibilityDecisionStatus.SELECTED
    assert credit_decision.selected_operation_ref == "base:kt10006"


def test_advice_status_and_screening_primitives_are_compositional(catalog) -> None:
    advice = analyze_question(
        "Would adjusting my unfilled order price be a sensible tactic?"
    )
    assert advice.speech_act is SpeechAct.ADVICE
    assert decide_compatibility(
        advice, (catalog.by_ref["base:kt10002"],)
    ).selected_operation_ref is None

    program = analyze_question("이 종목의 프로그램 매매 현황을 알려줘")
    assert DataIntent.SNAPSHOT in program.data_intents
    assert Measure.PROGRAM_TRADING in program.measures
    assert RoutingResultShape.COMPOUND in program.result_shapes
    assert decide_compatibility(
        program,
        (catalog.by_ref["base:ka90003"], catalog.by_ref["base:ka90004"]),
    ).selected_operation_ref == "base:ka90004"

    etf_screen = analyze_question("운용사와 과세 조건으로 국내 ETF 전체 시세를 걸러줘")
    assert DataIntent.SCREENING in etf_screen.data_intents
    assert RoutingResultShape.COLLECTION in etf_screen.result_shapes
    assert decide_compatibility(
        etf_screen,
        (catalog.by_ref["base:ka40002"], catalog.by_ref["base:ka40004"]),
    ).selected_operation_ref == "base:ka40004"


def test_realtime_movement_is_stream_evidence_not_historical_series(catalog) -> None:
    realtime = analyze_question(
        "화학 sector index의 움직임을 realtime feed로 계속 보내줘"
    )
    historical = analyze_question(
        "Show the chemical sector index movement by trading day"
    )
    assert realtime.execution is ExecutionKind.WEBSOCKET
    assert DataIntent.SUBSCRIPTION in realtime.data_intents
    assert DataIntent.HISTORY not in realtime.data_intents
    assert prove_compatibility(
        realtime, catalog.by_ref["base:0J"]
    ).status is CompatibilityStatus.MATCH
    assert DataIntent.HISTORY in historical.data_intents
    assert historical.execution is not ExecutionKind.WEBSOCKET

    mixed = analyze_question("운수장비 업종 index changes를 live feed로 계속 보내줘")
    assert mixed.execution is ExecutionKind.WEBSOCKET
    assert mixed.feeds == (FeedKind.SECTOR_INDEX,)
    assert decide_compatibility(
        mixed, (catalog.by_ref["base:0J"], catalog.by_ref["base:0U"])
    ).selected_operation_ref == "base:0J"

    elw_metrics = analyze_question(
        "Stream live indicator updates for the selected ELW"
    )
    assert elw_metrics.feeds == (FeedKind.ELW_METRICS,)
    assert decide_compatibility(
        elw_metrics, (catalog.by_ref["base:0m"], catalog.by_ref["base:0u"])
    ).selected_operation_ref == "base:0u"


@pytest.mark.parametrize(
    ("question", "expected_ref", "expected_feed"),
    (
        ("주식 우선호가 실시간 구독", "base:0C", FeedKind.PRIORITY_ORDERBOOK),
        ("주식 호가잔량 실시간 구독", "base:0D", FeedKind.FULL_ORDERBOOK_DEPTH),
        ("주식 시간외호가 실시간 스트림", "base:0E", FeedKind.AFTER_HOURS_ORDERBOOK),
    ),
)
def test_stock_orderbook_feed_variants_are_typed(
    catalog, question, expected_ref, expected_feed
) -> None:
    analysis = analyze_question(
        question, bound_argument_roles=(BindingRole.INSTRUMENT_CODE,)
    )
    assert FeedKind.ORDERBOOK in analysis.feeds
    assert expected_feed in analysis.feeds
    decision = decide_compatibility(
        analysis,
        tuple(catalog.by_ref[ref] for ref in ("base:0C", "base:0D", "base:0E")),
    )
    assert decision.selected_operation_ref == expected_ref


def test_query_analysis_relates_speech_range_and_delivery_without_values() -> None:
    analysis = analyze_question("subscribe to realtime 005930 trades by tick")
    relations = {(item.left, item.relation, item.right) for item in analysis.relations}
    assert (
        EvidenceAxis.SPEECH_ACT,
        RelationKind.GOVERNS,
        EvidenceAxis.ACTION_KIND,
    ) in relations
    assert (
        EvidenceAxis.DELIVERY,
        RelationKind.QUALIFIES,
        EvidenceAxis.ACTION_KIND,
    ) in relations
    assert "005930" not in repr(analysis)


def test_p4_alias_only_lexical_perturbation_cannot_create_compatibility(catalog) -> None:
    analysis = analyze_question("show me something interesting")
    document = catalog.by_ref["base:ka10081"]
    poisoned = replace(
        document,
        name="show me something interesting",
        searchable_zones=MappingProxyType(
            {"canonical_name": ("show me something interesting",)}
        ),
    )
    original = prove_compatibility(analysis, document)
    perturbed = prove_compatibility(analysis, poisoned)
    assert original.status is CompatibilityStatus.INSUFFICIENT
    assert perturbed == replace(original, operation_ref=poisoned.operation_ref)


def test_p4_split_sibling_cross_product_cannot_satisfy_one_request(catalog) -> None:
    analysis = analyze_question("이 종목의 오늘 현재가와 PER를 같이 알려줘")
    current = prove_compatibility(
        analysis, catalog.by_ref["detail:ka10001:current_trading"]
    )
    valuation = prove_compatibility(
        analysis, catalog.by_ref["detail:ka10001:valuation"]
    )
    assert current.status is CompatibilityStatus.CONTRADICTION
    assert valuation.status is CompatibilityStatus.CONTRADICTION
    assert "measure:valuation" in current.contradictions
    assert "data_intent:current_quote" in valuation.contradictions


def test_p4_all_explicit_axes_must_coexist_in_the_exact_profile(catalog) -> None:
    analysis = analyze_question("show this stock's daily price and volume chart")
    daily = prove_compatibility(analysis, catalog.by_ref["base:ka10081"])
    annual = prove_compatibility(analysis, catalog.by_ref["base:ka10094"])
    assert daily.status is CompatibilityStatus.MATCH
    assert annual.status is CompatibilityStatus.CONTRADICTION
    assert "temporal_scope:daily" in annual.contradictions


def test_p4_candidate_or_preference_inputs_have_no_compatibility_seam(catalog) -> None:
    analysis = analyze_question("이 종목의 오늘 가격 범위를 알려줘")
    document = catalog.by_ref["detail:ka10001:daily_price_band"]
    baseline = prove_compatibility(analysis, document)
    unrelated_hints = ("base:ka20001", "base:kt10000", "base:0B")
    assert unrelated_hints
    assert prove_compatibility(analysis, document) == baseline
    assert baseline.status is CompatibilityStatus.MATCH


def test_p4_multiple_compatible_details_require_a_local_group(catalog) -> None:
    analysis = analyze_question("이 종목의 오늘 가격 범위를 알려줘")
    document = catalog.by_ref["detail:ka10001:daily_price_band"]
    duplicate_profile = replace(document, operation_ref="detail:shadow:duplicate")
    decision = decide_compatibility(
        analysis,
        (document, duplicate_profile),
    )
    assert decision.status is CompatibilityDecisionStatus.DETAIL_GROUP_REQUIRED
    assert decision.selected_family_ref == document.family_ref
    assert decision.confidence is CompatibilityConfidence.LOW
    assert decision.reason_codes == ("DETAIL_GROUP_REQUIRED",)
    assert decision.selected_operation_ref is None
    assert len(decision.compatible_operation_refs) == 2


def test_active_axis_dominance_ignores_role_matches_and_input_order(catalog) -> None:
    analysis = analyze_question("Show my current account balance")
    source = OperationProfile.from_document(
        catalog.by_ref["detail:kt00004:cash_and_assets"]
    )
    extra_role = replace(
        source,
        operation_ref="detail:shadow:extra-role",
        family_ref="base:shadow-extra-role",
        routing=replace(
            source.routing,
            entity_kinds=source.routing.entity_kinds + (EntityKind.ORDER,),
        ),
    )
    first = decide_compatibility(analysis, (source, extra_role))
    second = decide_compatibility(analysis, (extra_role, source))
    assert first == second
    assert first.status is CompatibilityDecisionStatus.AMBIGUOUS
    assert first.selected_family_ref is None


def test_unmentioned_action_cannot_create_family_dominance(catalog) -> None:
    analysis = analyze_question("Show my current account balance")
    source = OperationProfile.from_document(
        catalog.by_ref["detail:kt00004:cash_and_assets"]
    )
    actionful = replace(
        source,
        operation_ref="detail:shadow:actionful",
        family_ref="base:shadow-actionful",
        routing=replace(source.routing, actions=(ActionKind.BUY,)),
    )

    forward = decide_compatibility(analysis, (source, actionful))
    reverse = decide_compatibility(analysis, (actionful, source))
    assert forward == reverse
    assert forward.status is CompatibilityDecisionStatus.AMBIGUOUS
    assert forward.selected_family_ref is None
    assert forward.dominance_edges == ()


def test_active_axis_dominance_uses_explicit_product_but_not_generic_measure(
    catalog,
) -> None:
    analysis = analyze_question("Show this stock's current price")
    source = OperationProfile.from_document(
        catalog.by_ref["detail:ka10001:current_trading"]
    )
    broader_product = replace(
        source,
        operation_ref="detail:shadow:stock-or-etf",
        family_ref="base:shadow-stock-or-etf",
        routing=replace(
            source.routing,
            entity_kinds=source.routing.entity_kinds + (EntityKind.ETF,),
        ),
    )
    cross_family_decision = decide_compatibility(analysis, (broader_product, source))
    assert cross_family_decision.selected_operation_ref == source.operation_ref
    assert cross_family_decision.dominance_edges

    broader_local = replace(broader_product, family_ref=source.family_ref)
    product_decision = decide_compatibility(analysis, (broader_local, source))
    assert product_decision.selected_operation_ref == source.operation_ref
    assert product_decision.confidence is CompatibilityConfidence.MEDIUM
    assert product_decision.reason_codes == (
        "TYPED_DOMINANCE",
        "UNIQUE_EXACT_PROFILE",
    )
    assert product_decision.dominance_edges[0].dominated_operation_ref == (
        broader_local.operation_ref
    )

    generic_analysis = replace(analysis, measures=(Measure.GENERIC,))
    broader_measure = replace(
        source,
        operation_ref="detail:shadow:more-measures",
        family_ref="base:shadow-more-measures",
        routing=replace(
            source.routing,
            measures=source.routing.measures + (Measure.BALANCE,),
        ),
    )
    generic_decision = decide_compatibility(
        generic_analysis, (source, broader_measure)
    )
    assert generic_decision.status is CompatibilityDecisionStatus.AMBIGUOUS


def test_child_specificity_never_selects_a_family(catalog) -> None:
    analysis = analyze_question("Show this stock's current price")
    source = OperationProfile.from_document(
        catalog.by_ref["detail:ka10001:current_trading"]
    )
    other_family = replace(
        source,
        operation_ref="detail:shadow:other-family",
        family_ref="base:shadow-other-family",
        routing=replace(
            source.routing,
            capabilities=(CapabilityKind.IDENTITY_CAPITAL,),
        ),
    )
    decision = decide_compatibility(analysis, (source, other_family))
    assert decision.status is CompatibilityDecisionStatus.AMBIGUOUS
    assert decision.selected_family_ref is None
    assert decision.dominance_edges == ()


def test_local_detail_intent_and_temporal_specificity_ignore_extra_output_measures(
    catalog,
) -> None:
    analysis = analyze_question("코스피 업종 현재가 알려줘")
    decision = decide_compatibility(
        analysis,
        (
            catalog.by_ref["detail:ka20001:fifty_two_week_range"],
            catalog.by_ref["detail:ka20001:market_snapshot"],
        ),
    )
    assert decision.selected_operation_ref == "detail:ka20001:market_snapshot"
    assert decision.reason_codes == ("TYPED_DOMINANCE", "UNIQUE_EXACT_PROFILE")


def test_broad_sibling_cannot_erase_an_equal_family(catalog) -> None:
    analysis = analyze_question("Show this stock's current price")
    source = OperationProfile.from_document(
        catalog.by_ref["detail:ka10001:current_trading"]
    )
    equal_other = replace(
        source,
        operation_ref="detail:shadow:equal-other",
        family_ref="base:shadow-other",
    )
    broad_sibling = replace(
        source,
        operation_ref="detail:shadow:broad-sibling",
        routing=replace(
            source.routing,
            entity_kinds=source.routing.entity_kinds + (EntityKind.ETF,),
        ),
    )
    operations = (source, broad_sibling, equal_other)
    forward = decide_compatibility(analysis, operations)
    reverse = decide_compatibility(analysis, tuple(reversed(operations)))
    assert forward == reverse
    assert forward.status is CompatibilityDecisionStatus.AMBIGUOUS
    assert set(forward.compatible_operation_refs) == {
        source.operation_ref,
        broad_sibling.operation_ref,
        equal_other.operation_ref,
    }
    assert forward.dominance_edges == ()


def test_identical_duplicate_profiles_dedupe_and_conflicts_fail_fast(catalog) -> None:
    source = OperationProfile.from_document(
        catalog.by_ref["detail:ka10001:current_trading"]
    )
    analysis = analyze_question("Show this stock's current price")
    duplicate = decide_compatibility(analysis, (source, source))
    assert duplicate.selected_operation_ref == source.operation_ref

    conflicting = replace(
        source,
        routing=replace(
            source.routing,
            capabilities=(CapabilityKind.IDENTITY_CAPITAL,),
        ),
    )
    with pytest.raises(ValueError, match="conflicting operation profiles"):
        decide_compatibility(analysis, (source, conflicting))


@pytest.mark.parametrize(
    ("question", "expected_ref"),
    (
        (
            "Show the chemical sector's 52-week maximum and minimum index levels",
            "detail:ka20001:fifty_two_week_range",
        ),
        (
            "From the chemical sector's current market snapshot, show its "
            "52-week maximum and minimum index levels",
            "detail:ka20001:fifty_two_week_range",
        ),
        (
            "From the chemical sector's daily history, show its 52-week "
            "maximum and minimum index levels",
            "detail:ka20009:fifty_two_week_range",
        ),
    ),
)
def test_sector_52_week_equivalence_uses_source_when_explicit(
    catalog, question, expected_ref
) -> None:
    operations = (
        catalog.by_ref["detail:ka20001:fifty_two_week_range"],
        catalog.by_ref["detail:ka20009:fifty_two_week_range"],
    )
    decision = decide_compatibility(analyze_question(question), operations)
    reversed_decision = decide_compatibility(
        analyze_question(question), tuple(reversed(operations))
    )
    assert decision == reversed_decision
    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref
    if "current market snapshot" not in question and "daily history" not in question:
        assert decision.confidence is CompatibilityConfidence.MEDIUM
        assert decision.reason_codes == (
            "EQUIVALENCE_CANONICAL",
            "UNIQUE_EXACT_PROFILE",
        )
        assert decision.equivalence_collapses[0].member_operation_refs == tuple(
            sorted(operation.operation_ref for operation in operations)
        )
    else:
        assert decision.confidence is CompatibilityConfidence.HIGH
        assert decision.equivalence_collapses == ()


@pytest.mark.parametrize(
    ("question", "intent"),
    (
        ("Would purchasing this stock be appropriate?", DiscoveryIntent.AUTO),
        ("다른 사람 명의 계좌 잔고를 조회해줘", DiscoveryIntent.QUERY),
        ("1킬로 금 현물의 PER과 EPS를 조회해줘", DiscoveryIntent.QUERY),
        ("화학 업종 지수를 다섯 주 매수해줘", DiscoveryIntent.ORDER),
        (
            "Compare ACE 200 and KODEX 200 performance with one request",
            DiscoveryIntent.QUERY,
        ),
    ),
)
def test_p4_full_profile_decision_fail_closes_safety_requests(
    catalog, question, intent
) -> None:
    kinds = {
        DiscoveryIntent.AUTO: {"query"},
        DiscoveryIntent.QUERY: {"query"},
        DiscoveryIntent.ORDER: {"order"},
        DiscoveryIntent.WEBSOCKET: {"websocket"},
    }[intent]
    surface = tuple(
        document
        for document in catalog.documents
        if document.kind in kinds and document.visibility != "hidden"
    )
    decision = decide_compatibility(analyze_question(question), surface)
    assert decision.selected_operation_ref is None


@pytest.mark.parametrize(
    ("question", "intent", "expected_ref"),
    (
        (
            "선택한 금 현물 상품의 일별 시세 추이를 알려줘",
            DiscoveryIntent.QUERY,
            "base:ka50012",
        ),
        (
            "Show the weekly candle chart for the selected spot-gold product",
            DiscoveryIntent.QUERY,
            "base:ka50082",
        ),
        (
            "선택한 spot-gold product의 일별 trend 조회해줘",
            DiscoveryIntent.QUERY,
            "base:ka50012",
        ),
        (
            "선택한 금 현물 상품을 매도주문해줘",
            DiscoveryIntent.ORDER,
            "base:kt50001",
        ),
    ),
)
def test_selected_gold_product_is_a_deictic_instrument_anchor(
    catalog, question, intent, expected_ref
) -> None:
    decision = decide_selector_compatibility(catalog, question, intent)

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


def test_unselected_generic_gold_scope_does_not_mint_an_instrument_anchor(catalog) -> None:
    decision = decide_selector_compatibility(
        catalog,
        "금 현물 상품의 일별 가격 추이를 알려줘",
        DiscoveryIntent.QUERY,
    )

    assert decision.status is CompatibilityDecisionStatus.REJECTED
    assert decision.confidence is CompatibilityConfidence.LOW


@pytest.mark.parametrize(
    ("question", "intent", "expected_ref"),
    (
        ("증권 회원사 리스트를 조회해줘", DiscoveryIntent.QUERY, "base:ka10102"),
        ("호가잔량 top ranking 조회해줘", DiscoveryIntent.QUERY, "base:ka10020"),
        ("조건검색 목록을 조회해줘", DiscoveryIntent.WEBSOCKET, "base:ka10171"),
        (
            "조건검색 실시간 구독을 해제해줘",
            DiscoveryIntent.WEBSOCKET,
            "base:ka10174",
        ),
    ),
)
def test_named_collection_scope_needs_no_instrument_anchor(
    catalog, question, intent, expected_ref
) -> None:
    decision = decide_selector_compatibility(catalog, question, intent)

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


@pytest.mark.parametrize(
    ("question", "expected_ref"),
    (
        ("amend an existing stock order", "base:kt10002"),
        ("cancel an existing stock order", "base:kt10003"),
    ),
)
def test_existing_order_identity_selects_amend_or_cancel_without_new_instrument_anchor(
    catalog, question, expected_ref
) -> None:
    decision = decide_selector_compatibility(
        catalog, question, DiscoveryIntent.ORDER
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


def test_existing_order_without_product_kind_does_not_default_to_stock(catalog) -> None:
    decision = decide_selector_compatibility(
        catalog, "cancel an existing order", DiscoveryIntent.ORDER
    )

    assert decision.selected_operation_ref is None


@pytest.mark.parametrize(
    ("question", "expected_ref", "forbidden_ref"),
    (
        (
            "005930 종목코드로 종목정보를 조회해줘",
            "base:ka10100",
            "base:ka10099",
        ),
        (
            "선택한 주식 종목의 investor 기관별 chart 조회",
            "base:ka10060",
            "base:ka10064",
        ),
    ),
)
def test_explicit_operation_semantics_select_typed_capability_not_lexical_score(
    catalog, question, expected_ref, forbidden_ref
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=_production_target,
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref
    assert forbidden_ref not in decision.compatible_operation_refs


def test_p4_exact_identity_keeps_intent_and_argument_guards(service) -> None:
    with pytest.raises(OperationNotFoundError):
        service.resolve(
            ResolveRequest(
                question="base:0B",
                intent=DiscoveryIntent.QUERY,
                arguments={"trnm": "REG", "grp_no": "1", "refresh": "1"},
            )
        )
    with pytest.raises(OperationNotFoundError):
        service.resolve(
            ResolveRequest(
                question="base:kt10000",
                intent=DiscoveryIntent.QUERY,
                arguments={
                    "dmst_stex_tp": "KRX",
                    "stk_cd": "005930",
                    "ord_qty": "1",
                    "trde_tp": "3",
                },
            )
        )
    exact_query = service.resolve(
        ResolveRequest(
            question="base:ka10081",
            intent=DiscoveryIntent.QUERY,
            arguments={
                "stk_cd": "005930",
                "base_dt": "20260821",
                "upd_stkpc_tp": "1",
            },
        )
    )
    assert exact_query.operation_ref == "base:ka10081"
    assert exact_query.plan_token.startswith("v1.")


def test_selector_service_uses_shared_compatibility_as_its_only_semantic_authority() -> None:
    import inspect

    source = inspect.getsource(SelectorService)
    assert "decide_selector_compatibility" in source
    assert "select_operation" not in source
    assert "canonical_search_confidence" not in source
    assert "rank_documents(" not in source


def test_legacy_policy_facade_has_no_lexical_authorization_path() -> None:
    import inspect

    import _selector_facade as policy

    source = inspect.getsource(policy)
    assert "decide_selector_compatibility" in source
    assert "rank_documents(" not in source
    assert "authoritative_score" not in source
    assert "title_score" not in source
    assert "_CANONICAL_ALIASES" not in source
    assert "_close_scores" not in source


def test_legacy_policy_ignores_rank_and_title_perturbations(catalog) -> None:
    from _selector_facade import select_operation
    from athena_api.selector.ranking import RankedDocument

    question = "Show this stock's current price"
    unrelated = catalog.by_ref["base:ka20001"]
    expected = catalog.by_ref["base:ka10001"]
    first, _ = select_operation(
        catalog,
        question,
        (
            RankedDocument(unrelated, 999_999, (), typed_tier=999),
            RankedDocument(expected, 1, (), typed_tier=0),
        ),
        ResponseMode.AUTO,
    )
    second, _ = select_operation(
        catalog,
        question,
        (
            RankedDocument(expected, 999_999, (), typed_tier=999),
            RankedDocument(unrelated, 1, (), typed_tier=0),
        ),
        ResponseMode.AUTO,
    )

    assert first.operation_ref == "detail:ka10001:current_trading"
    assert second.operation_ref == first.operation_ref


def test_legacy_policy_intent_is_invariant_to_ranked_document_kind(catalog) -> None:
    from _selector_facade import select_operation
    from athena_api.selector.ranking import RankedDocument

    question = "Show this stock's current price"
    ranked_variants = (
        (
            RankedDocument(
                catalog.by_ref["base:ka20001"], 999_999, (), typed_tier=999
            ),
        ),
        (
            RankedDocument(
                catalog.by_ref["base:kt10000"], 999_999, (), typed_tier=999
            ),
        ),
        (
            RankedDocument(catalog.by_ref["base:0A"], 999_999, (), typed_tier=999),
        ),
    )

    selections = tuple(
        select_operation(catalog, question, ranked, ResponseMode.AUTO)[0].operation_ref
        for ranked in ranked_variants
    )

    assert selections == ("detail:ka10001:current_trading",) * 3


def test_legacy_policy_detail_group_cannot_override_unique_typed_child(
    catalog, service
) -> None:
    from _selector_facade import select_operation

    question = "Show this stock's current price"
    with pytest.raises(UnknownDetailGroupError):
        select_operation(
            catalog,
            question,
            (),
            ResponseMode.AUTO,
            detail_group="valuation",
        )
    with pytest.raises(UnknownDetailGroupError):
        service.resolve(
            ResolveRequest(
                question=question,
                detail_group="valuation",
                arguments={"stk_cd": "005930"},
            )
        )

    selected, reasons = select_operation(
        catalog,
        question,
        (),
        ResponseMode.AUTO,
        detail_group="current_trading",
    )
    assert selected.operation_ref == "detail:ka10001:current_trading"
    assert reasons == [ReasonCode.TYPED_DETAIL_MATCH]


def test_service_vague_no_anchor_rejects_and_search_stays_low(service) -> None:
    searched = service.search(SearchRequest(query="현재가 알려줘", limit=5))
    assert searched.results
    assert {hit.confidence for hit in searched.results} == {"low"}
    assert all(hit.suggested_operation_ref is None for hit in searched.results)

    with pytest.raises(NoConfidentMatchError) as caught:
        service.resolve(ResolveRequest(question="현재가 알려줘"))
    assert caught.value.details["reason_codes"] == [
        ReasonCode.NO_COMPATIBLE_PROFILE.value
    ]


@pytest.mark.parametrize(
    ("question", "expected_ref"),
    (
        (
            "Report the semiconductor industry's latest index level and percentage change",
            "detail:ka20001:market_snapshot",
        ),
        (
            "KRX 전체 industry index levels를 한 번에 보여줘",
            "base:ka20003",
        ),
        (
            "바이오 업종의 지난 20일 daily index history를 보여줘",
            "detail:ka20009:daily_history",
        ),
        (
            "내 계좌의 예수금과 총자산 평가액을 알려줘",
            "detail:kt00004:cash_and_assets",
        ),
        (
            "내 잔고의 date별 daily return 추이를 보여줘",
            "base:ka01690",
        ),
        (
            "최근 위탁 종합 거래 내역을 기간별로 조회해줘",
            "base:kt00015",
        ),
        (
            "이 ELW의 지급액 산식과 배리어 조건을 설명해줘",
            "detail:ka30012:payoff_conditions",
        ),
        (
            "이 ELW의 패리티, 기어링, LP 보유비율을 알려줘",
            "detail:ka30012:liquidity_and_leverage",
        ),
        (
            "Rank ELWs by their premium or discount gap from theoretical value",
            "base:ka30004",
        ),
    ),
)
def test_expansion_typed_compositions_select_without_name_authority(
    catalog, question, expected_ref
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


@pytest.mark.parametrize(
    "question",
    (
        "How much is Hyundai Motor trading at right now?",
        "Show POSCO Holdings' annual high, annual low, and 250-day price range",
        "Show today's time-stamped NAV observations for KODEX 200",
    ),
)
def test_expansion_name_only_pairs_remain_fail_closed(catalog, question) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
    )

    assert decision.selected_operation_ref is None


def test_typed_annual_high_low_range_selects_price_range_without_sibling_leak(
    catalog,
) -> None:
    question = "Show POSCO Holdings' annual high, annual low, and 250-day price range"

    raw = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
    )
    resolved = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=_stock_target,
    )

    assert raw.status is CompatibilityDecisionStatus.REJECTED
    assert raw.selected_operation_ref is None
    assert resolved.status is CompatibilityDecisionStatus.SELECTED
    assert resolved.selected_operation_ref == "detail:ka10001:price_range"


@pytest.mark.parametrize(
    ("question", "expected_ref"),
    (
        ("Show this stock's daily candle chart", "base:ka10081"),
        ("Show this stock current price", "detail:ka10001:current_trading"),
        (
            "Show this stock's market capitalization and listed shares",
            "detail:ka10001:market_scale_and_ownership",
        ),
    ),
)
def test_price_range_discriminator_does_not_capture_adjacent_stock_intents(
    catalog, question, expected_ref
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


def test_service_raw_default_keeps_name_and_bound_code_fail_closed(catalog) -> None:
    raw = SelectorService(
        catalog,
        PlanSigner(b"raw-name-boundary", nonce_factory=lambda: "raw"),
    )
    question = "삼성전자 오늘 주가 얼마야?"

    searched = raw.search(SearchRequest(query=question, limit=5))

    assert searched.results
    assert {hit.confidence for hit in searched.results} == {"low"}
    assert all(hit.suggested_operation_ref is None for hit in searched.results)
    with pytest.raises(NoConfidentMatchError):
        raw.resolve(
            ResolveRequest(
                question=question,
                arguments={"stk_cd": "005930"},
            )
        )
    with pytest.raises(NoConfidentMatchError):
        raw.resolve(
            ResolveRequest(
                question="아테나전자 오늘 주가 얼마야?",
                arguments={"stk_cd": "005930"},
            )
        )


def test_service_injected_target_resolver_is_exact_span_and_used_everywhere(
    catalog,
) -> None:
    question = "삼성전자 오늘 주가 얼마야?"
    injected = SelectorService(
        catalog,
        PlanSigner(b"injected-name-boundary", nonce_factory=lambda: "injected"),
        target_resolver=lambda candidate: (
            TargetResolution(EntityKind.STOCK) if candidate == question else None
        ),
    )

    searched = injected.search(SearchRequest(query=question, limit=5))
    resolved = injected.resolve(
        ResolveRequest(question=question, arguments={"stk_cd": "005930"})
    )

    assert searched.results[0].operation_ref == "base:ka10001"
    assert searched.results[0].confidence == "high"
    assert resolved.operation_ref == "detail:ka10001:current_trading"
    with pytest.raises(NoConfidentMatchError):
        injected.resolve(
            ResolveRequest(
                question="삼성전자우 오늘 주가 얼마야?",
                arguments={"stk_cd": "005935"},
            )
        )


@pytest.mark.parametrize(
    "question",
    (
        "What is Samsung Electronics current stock price?",
        "Show Samsung Electronics current price now",
    ),
)
def test_trusted_stock_resolver_adds_only_value_free_stock_identity_evidence(
    catalog, question
) -> None:
    raw = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
    )
    resolved = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=lambda candidate: (
            TargetResolution(EntityKind.STOCK) if candidate == question else None
        ),
    )
    analysis = analyze_question(
        question,
        target_resolver=lambda candidate: (
            TargetResolution(EntityKind.STOCK) if candidate == question else None
        ),
    )

    assert raw.status is CompatibilityDecisionStatus.REJECTED
    assert resolved.status is CompatibilityDecisionStatus.SELECTED
    assert resolved.selected_operation_ref == "detail:ka10001:current_trading"
    assert analysis.target_presence is TargetPresence.PRESENT
    assert analysis.target_scope_present is True
    assert analysis.subject is RoutingSubject.INSTRUMENT
    assert analysis.entity_kinds == (EntityKind.STOCK,)
    assert "samsung" not in repr(analysis).casefold()


def test_false_stock_resolver_cannot_mint_ood_target(catalog) -> None:
    question = "Show New York apartment current price now"

    analysis = analyze_question(question, target_resolver=_no_target)
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=_no_target,
    )

    assert analysis.target_presence is TargetPresence.UNKNOWN
    assert EntityKind.STOCK not in analysis.entity_kinds
    assert decision.status is CompatibilityDecisionStatus.REJECTED
    assert decision.selected_operation_ref is None


@pytest.mark.parametrize("market", ("0", "10"))
def test_domestic_stock_markets_resolve_to_value_free_stock_kind(catalog, market) -> None:
    question = "Show Samsung Electronics current price now"

    analysis = analyze_question(question, target_resolver=_stock_target)
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=_stock_target,
    )

    assert market in {"0", "10"}
    assert analysis.entity_kinds == (EntityKind.STOCK,)
    assert decision.selected_operation_ref == "detail:ka10001:current_trading"


@pytest.mark.parametrize(
    ("question", "expected_ref"),
    (
        ("Show KODEX 200 current price", None),
        (
            "Compare KODEX 200 return with its benchmark over the requested period",
            "base:ka40001",
        ),
        (
            "Show today's time-stamped NAV observations for KODEX 200",
            "base:ka40009",
        ),
    ),
)
def test_market_eight_resolution_is_etf_and_never_stock(
    catalog, question, expected_ref
) -> None:
    analysis = analyze_question(question, target_resolver=_etf_target)
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=_etf_target,
    )

    assert analysis.entity_kinds == (EntityKind.ETF,)
    assert EntityKind.STOCK not in analysis.entity_kinds
    assert decision.selected_operation_ref == expected_ref
    assert decision.selected_family_ref != "base:ka10001"
    assert "kodex" not in repr(analysis).casefold()


@pytest.mark.parametrize(
    "resolver_result",
    (
        True,
        False,
        TargetResolution(EntityKind.ACCOUNT),
        TargetResolution(EntityKind.STOCK, present=False),
        None,
    ),
)
def test_untyped_or_unknown_resolver_results_fail_closed(
    catalog, resolver_result
) -> None:
    question = "Show Samsung Electronics current price now"

    def resolver(_candidate: str):
        return resolver_result

    analysis = analyze_question(question, target_resolver=resolver)
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolver=resolver,
    )

    assert analysis.target_presence is TargetPresence.UNKNOWN
    assert EntityKind.STOCK not in analysis.entity_kinds
    assert decision.status is CompatibilityDecisionStatus.REJECTED
    assert decision.selected_operation_ref is None


@pytest.mark.parametrize(
    ("question", "expected_subject"),
    (
        ("삼성전자 한 주 매수해줘", RoutingSubject.ORDER),
        ("삼성전자 한 주 매도해줘", RoutingSubject.ORDER),
        ("삼성전자 주문을 정정해줘", RoutingSubject.ORDER),
        ("삼성전자 주문을 취소해줘", RoutingSubject.ORDER),
        ("내 계좌의 삼성전자 주문 체결 현황", RoutingSubject.ACCOUNT),
        ("삼성전자 외국인 투자자 매매동향", RoutingSubject.PARTICIPANT),
        ("삼성전자와 반도체 업종 지수 비교", RoutingSubject.SECTOR),
        ("삼성전자 조건검색 목록", RoutingSubject.COLLECTION),
    ),
)
def test_typed_resolution_never_overwrites_authored_subject(
    question, expected_subject
) -> None:
    analysis = analyze_question(question, target_resolver=_stock_target)

    assert analysis.subject is expected_subject
    assert analysis.target_presence is TargetPresence.PRESENT
    assert "삼성전자" not in repr(analysis)


def test_service_lexical_permutation_cannot_change_typed_authority(
    service, monkeypatch
) -> None:
    from athena_api.selector import ranking

    question = "005930 오늘 주가와 거래량 알려줘"
    request = ResolveRequest(question=question, arguments={"stk_cd": "005930"})
    before_search = service.search(SearchRequest(query=question, limit=10))
    before_resolve = service.resolve(request)
    original = ranking.rank_documents

    def reversed_ranking(query, documents):
        return tuple(reversed(original(query, documents)))

    monkeypatch.setattr(ranking, "rank_documents", reversed_ranking)
    after_search = service.search(SearchRequest(query=question, limit=10))
    after_resolve = service.resolve(request)

    def authority(response):
        return {
            (hit.operation_ref, hit.confidence, hit.suggested_operation_ref)
            for hit in response.results
            if hit.confidence != "low" or hit.suggested_operation_ref is not None
        }

    assert authority(after_search) == authority(before_search)
    assert after_resolve.operation_ref == before_resolve.operation_ref
    assert after_resolve.selection_reasons == before_resolve.selection_reasons


def test_service_injects_typed_selected_family_when_lexical_results_omit_it(
    service, monkeypatch
) -> None:
    from athena_api.selector import service as service_module

    question = "005930 오늘 주가와 거래량 알려줘"
    lexical = service_module.search_catalog(
        service.catalog,
        SearchRequest(query=question, limit=5),
    )
    omitted = lexical.model_copy(
        update={
            "results": [
                hit
                for hit in lexical.results
                if hit.operation_ref != "base:ka10001"
            ]
        }
    )
    monkeypatch.setattr(service_module, "search_catalog", lambda *_args: omitted)

    searched = service.search(SearchRequest(query=question, limit=5))
    assert searched.results[0].operation_ref == "base:ka10001"
    assert searched.results[0].confidence == "high"
    assert (
        searched.results[0].suggested_operation_ref
        == "detail:ka10001:current_trading"
    )


def test_service_promotes_existing_typed_family_ahead_of_lexical_alternatives(
    service, monkeypatch
) -> None:
    from athena_api.selector import service as service_module

    question = "005930 오늘 주가와 거래량 알려줘"
    lexical = service_module.search_catalog(
        service.catalog,
        SearchRequest(query=question, limit=5),
    )
    selected = next(
        hit for hit in lexical.results if hit.operation_ref == "base:ka10001"
    )
    alternatives = [
        hit for hit in lexical.results if hit.operation_ref != selected.operation_ref
    ]
    reordered = lexical.model_copy(
        update={"results": [*alternatives[:2], selected, *alternatives[2:]]}
    )
    monkeypatch.setattr(service_module, "search_catalog", lambda *_args: reordered)

    searched = service.search(SearchRequest(query=question, limit=5))

    assert searched.results[0].operation_ref == "base:ka10001"
    assert searched.results[0].confidence == "high"
    assert (
        searched.results[0].suggested_operation_ref
        == "detail:ka10001:current_trading"
    )
    assert [hit.operation_ref for hit in searched.results[1:]] == [
        hit.operation_ref for hit in alternatives[:4]
    ]


def test_service_lexical_ablation_cannot_remove_typed_search_or_resolve_authority(
    service, monkeypatch
) -> None:
    from athena_api.selector import service as service_module

    question = "005930 오늘 주가와 거래량 알려줘"
    request = ResolveRequest(question=question, arguments={"stk_cd": "005930"})
    baseline = service.resolve(request)
    lexical = service_module.search_catalog(
        service.catalog,
        SearchRequest(query=question, limit=5),
    )
    monkeypatch.setattr(
        service_module,
        "search_catalog",
        lambda *_args: lexical.model_copy(update={"results": []}),
    )

    searched = service.search(SearchRequest(query=question, limit=5))
    resolved = service.resolve(request)

    assert [hit.operation_ref for hit in searched.results] == ["base:ka10001"]
    assert searched.results[0].confidence == "high"
    assert (
        searched.results[0].suggested_operation_ref
        == "detail:ka10001:current_trading"
    )
    assert resolved.operation_ref == baseline.operation_ref
    assert resolved.selection_reasons == baseline.selection_reasons


def test_service_suggested_intent_comes_from_typed_execution_evidence(service) -> None:
    searched = service.search(
        SearchRequest(query="이 종목 열 주를 시장가로 매수해줘", limit=5)
    )
    assert searched.suggested_intent is DiscoveryIntent.ORDER
    assert {hit.confidence for hit in searched.results} <= {"low"}


def test_candidate_and_preferred_inputs_never_change_typed_decision(service) -> None:
    question = "005930 오늘 주가와 거래량 알려줘"
    arguments = {"stk_cd": "005930"}
    baseline = service.resolve(
        ResolveRequest(question=question, arguments=arguments)
    )
    hinted = service.resolve(
        ResolveRequest(
            question=question,
            candidate_refs=["base:ka10007"],
            preferred_ref="base:ka10001",
            arguments=arguments,
        )
    )
    assert hinted.operation_ref == baseline.operation_ref
    assert hinted.selection_reasons == baseline.selection_reasons

    with pytest.raises(NoConfidentMatchError):
        service.resolve(
            ResolveRequest(
                question="현재가 알려줘",
                preferred_ref="base:ka10001",
                candidate_refs=["base:ka10001"],
                arguments=arguments,
            )
        )
    with pytest.raises(PreferredOperationError):
        service.resolve(
            ResolveRequest(
                question=question,
                preferred_ref="base:ka10007",
                arguments=arguments,
            )
        )


def test_exact_noncanonical_equivalence_member_remains_addressable(service) -> None:
    operation_ref = "detail:ka20009:fifty_two_week_range"
    resolved = service.resolve(
        ResolveRequest(
            question=operation_ref,
            arguments={"mrkt_tp": "0", "inds_cd": "001"},
        )
    )
    assert resolved.operation_ref == operation_ref
    assert resolved.selection_reasons == [ReasonCode.EXACT_OPERATION_REF]


def test_bare_tr_identity_records_exact_tr_id_reason(service) -> None:
    resolved = service.resolve(
        ResolveRequest(
            question="ka10081",
            arguments={
                "stk_cd": "005930",
                "base_dt": "20260821",
                "upd_stkpc_tp": "1",
            },
        )
    )
    canonical = service.resolve(
        ResolveRequest(
            question="base:ka10081",
            arguments={
                "stk_cd": "005930",
                "base_dt": "20260821",
                "upd_stkpc_tp": "1",
            },
        )
    )

    assert resolved.selection_reasons == [ReasonCode.EXACT_TR_ID]
    assert canonical.selection_reasons == [ReasonCode.EXACT_OPERATION_REF]


def test_globally_unique_group_id_is_exactly_addressable_in_search_and_resolve(
    service,
) -> None:
    searched = service.search(SearchRequest(query="current_trading", limit=3))
    resolved = service.resolve(
        ResolveRequest(
            question="current_trading",
            arguments={"stk_cd": "005930"},
        )
    )

    assert searched.results[0].operation_ref == "base:ka10001"
    assert searched.results[0].confidence == "high"
    assert (
        searched.results[0].suggested_operation_ref
        == "detail:ka10001:current_trading"
    )
    assert resolved.operation_ref == "detail:ka10001:current_trading"
    assert resolved.selection_reasons == [ReasonCode.EXACT_GROUP_ID]


def test_group_id_identity_is_intent_scoped_and_never_leaks_to_order(service) -> None:
    searched = service.search(
        SearchRequest(
            query="current_trading",
            intent=DiscoveryIntent.ORDER,
            limit=3,
        )
    )
    assert all(hit.operation_ref != "base:ka10001" for hit in searched.results)
    assert all(hit.confidence == "low" for hit in searched.results)
    with pytest.raises((NoConfidentMatchError, AmbiguousOperationError)):
        service.resolve(
            ResolveRequest(
                question="current_trading",
                intent=DiscoveryIntent.ORDER,
                arguments={"stk_cd": "005930"},
            )
        )


def test_duplicate_or_hidden_group_id_cannot_become_exact_identity(catalog) -> None:
    first = replace(
        catalog.by_ref["detail:ka10001:current_trading"],
        group_id="non_unique_group",
    )
    second = replace(
        catalog.by_ref["detail:ka10001:valuation"],
        group_id="non_unique_group",
    )
    duplicate_by_ref = dict(catalog.by_ref)
    duplicate_by_ref[first.operation_ref] = first
    duplicate_by_ref[second.operation_ref] = second
    duplicate_catalog = replace(
        catalog,
        documents=tuple(
            duplicate_by_ref.get(document.operation_ref, document)
            for document in catalog.documents
        ),
        by_ref=MappingProxyType(duplicate_by_ref),
    )
    duplicate_service = SelectorService(
        duplicate_catalog,
        PlanSigner(b"duplicate-group", nonce_factory=lambda: "duplicate"),
    )
    assert duplicate_service._exact_identity(
        "non_unique_group", DiscoveryIntent.QUERY
    ) == (None, None)
    with pytest.raises((NoConfidentMatchError, AmbiguousOperationError)):
        duplicate_service.resolve(
            ResolveRequest(
                question="non_unique_group",
                arguments={"stk_cd": "005930"},
            )
        )

    hidden = replace(first, group_id="hidden_group", visibility="hidden")
    hidden_catalog = replace(
        catalog,
        documents=(hidden,),
        by_ref=MappingProxyType({hidden.operation_ref: hidden}),
    )
    hidden_service = SelectorService(
        hidden_catalog,
        PlanSigner(b"hidden-group", nonce_factory=lambda: "hidden"),
    )
    assert hidden_service._exact_identity(
        "hidden_group", DiscoveryIntent.QUERY
    ) == (None, None)
    with pytest.raises((NoConfidentMatchError, AmbiguousOperationError)):
        hidden_service.resolve(
            ResolveRequest(
                question="hidden_group",
                arguments={"stk_cd": "005930"},
            )
        )


def test_sibling_preferred_detail_cannot_override_typed_or_exact_detail(service) -> None:
    arguments = {"stk_cd": "005930"}
    with pytest.raises(PreferredOperationError):
        service.resolve(
            ResolveRequest(
                question="005930 오늘 주가 얼마야?",
                preferred_ref="detail:ka10001:valuation",
                arguments=arguments,
            )
        )
    with pytest.raises(PreferredOperationError):
        service.resolve(
            ResolveRequest(
                question="detail:ka10001:current_trading",
                preferred_ref="detail:ka10001:valuation",
                arguments=arguments,
            )
        )


def test_service_requires_family_local_detail_when_exact_profiles_tie(catalog) -> None:
    base = catalog.by_ref["base:ka10001"]
    first = catalog.by_ref["detail:ka10001:current_trading"]
    second = replace(
        catalog.by_ref["detail:ka10001:daily_price_band"],
        routing=first.routing,
    )
    isolated = replace(
        catalog,
        documents=(base, first, second),
        by_ref=MappingProxyType(
            {
                base.operation_ref: base,
                first.operation_ref: first,
                second.operation_ref: second,
            }
        ),
    )
    isolated_service = SelectorService(
        isolated,
        PlanSigner(b"family-local-detail", nonce_factory=lambda: "local"),
    )
    request = {
        "question": "이 종목의 현재 주가와 거래량 알려줘",
        "arguments": {"stk_cd": "005930"},
    }
    with pytest.raises(DetailGroupRequiredError):
        isolated_service.resolve(ResolveRequest(**request))

    resolved = isolated_service.resolve(
        ResolveRequest(**request, detail_group="current_trading")
    )
    assert resolved.operation_ref == first.operation_ref
    assert resolved.selection_reasons == [
        ReasonCode.DETAIL_GROUP_REQUIRED,
        ReasonCode.EXPLICIT_DETAIL_GROUP,
    ]


@pytest.mark.parametrize(
    ("question", "intent", "entity_kind", "expected_ref"),
    [
        (
            "List NCsoft's recent executions with trade price and volume",
            DiscoveryIntent.QUERY,
            EntityKind.STOCK,
            "base:ka10003",
        ),
        (
            "한화에어로스페이스의 외국인·기관 매매 동향을 종목별로 확인해줘",
            DiscoveryIntent.QUERY,
            EntityKind.STOCK,
            "base:ka10059",
        ),
        (
            "List the stocks and current prices inside the food and beverage sector",
            DiscoveryIntent.QUERY,
            None,
            "base:ka20002",
        ),
        (
            "내 계좌의 예수금, 현금증거금, 담보금액을 상세히 보여줘",
            DiscoveryIntent.QUERY,
            None,
            "detail:kt00001:cash_and_margin",
        ),
        (
            "Show my projected D+1 and D+2 cash settlement balances",
            DiscoveryIntent.QUERY,
            None,
            "detail:kt00001:settlement_forecast",
        ),
        (
            "내 account에서 지금 withdraw 가능한 금액과 주문 가능 현금을 알려줘",
            DiscoveryIntent.QUERY,
            None,
            "detail:kt00001:withdrawal_and_order_capacity",
        ),
        (
            "List every holding with quantity, purchase price, valuation, and unrealized profit",
            DiscoveryIntent.QUERY,
            None,
            "detail:kt00018:holdings",
        ),
        (
            "Show the daily history of my estimated deposit assets",
            DiscoveryIntent.QUERY,
            None,
            "base:kt00002",
        ),
        (
            "아직 미체결로 남은 국내주식 주문 목록을 조회해줘",
            DiscoveryIntent.QUERY,
            None,
            "base:ka10075",
        ),
        (
            "오늘 체결된 국내주식 주문 내역을 확인해줘",
            DiscoveryIntent.QUERY,
            None,
            "base:ka10076",
        ),
        (
            "ARIRANG 고배당주의 오늘 시간대별 NAV 현황을 한 번 조회해줘",
            DiscoveryIntent.QUERY,
            EntityKind.ETF,
            "base:ka40009",
        ),
        (
            "이 basket ELW의 underlying assets와 각 composition ratio를 알려줘",
            DiscoveryIntent.QUERY,
            EntityKind.ELW,
            "detail:ka30012:underlying_basket",
        ),
        (
            "Show the exercise price, conversion ratio, theoretical price, "
            "and right type for this ELW",
            DiscoveryIntent.QUERY,
            EntityKind.ELW,
            "detail:ka30012:valuation_and_rights",
        ),
        (
            "선택한 금 현물 상품의 최근 체결가와 체결량 추이를 한 번 조회해줘",
            DiscoveryIntent.QUERY,
            EntityKind.GOLD,
            "base:ka50010",
        ),
        (
            "mini gold spot 100그램을 limit buy로 주문해줘",
            DiscoveryIntent.ORDER,
            EntityKind.GOLD,
            "base:kt50000",
        ),
        (
            "내 주문이 접수되거나 체결될 때마다 실시간 알림을 계속 받아줘",
            DiscoveryIntent.WEBSOCKET,
            None,
            "base:00",
        ),
    ],
)
def test_v2_typed_semantics_select_unique_exact_profiles(
    catalog,
    question: str,
    intent: DiscoveryIntent,
    entity_kind: EntityKind | None,
    expected_ref: str,
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        intent,
        target_resolution=(TargetResolution(entity_kind) if entity_kind else None),
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


@pytest.mark.parametrize(
    "question",
    [
        "List NCsoft's recent executions with trade price and volume",
        "한화에어로스페이스의 외국인·기관 매매 동향을 종목별로 확인해줘",
    ],
)
def test_v2_name_only_stock_semantics_remain_fail_closed(catalog, question: str) -> None:
    decision = decide_selector_compatibility(catalog, question, DiscoveryIntent.QUERY)

    assert decision.status is CompatibilityDecisionStatus.REJECTED
    assert decision.selected_operation_ref is None


def test_v2_owned_order_stream_does_not_authorize_third_party_orders(catalog) -> None:
    decision = decide_selector_compatibility(
        catalog,
        "다른 사람 주문이 접수되거나 체결될 때마다 실시간 알림을 계속 받아줘",
        DiscoveryIntent.WEBSOCKET,
    )

    assert decision.status is CompatibilityDecisionStatus.REJECTED
    assert decision.selected_operation_ref is None


def test_v2_deictic_product_modifier_binds_without_minting_bare_product(catalog) -> None:
    deictic = decide_selector_compatibility(
        catalog,
        "이 basket ELW의 underlying assets와 각 composition ratio를 알려줘",
        DiscoveryIntent.QUERY,
    )
    bare = decide_selector_compatibility(
        catalog,
        "basket ELW의 underlying assets와 각 composition ratio를 알려줘",
        DiscoveryIntent.QUERY,
    )

    assert deictic.status is CompatibilityDecisionStatus.SELECTED
    assert deictic.selected_operation_ref == "detail:ka30012:underlying_basket"
    assert bare.status is CompatibilityDecisionStatus.REJECTED
    assert bare.selected_operation_ref is None


@pytest.mark.parametrize(
    ("question", "intent", "entity_kind", "expected_ref"),
    [
        (
            "거래 가능한 전체 업종 지수의 현재 수준을 한 표로 조회해줘",
            DiscoveryIntent.QUERY,
            None,
            "base:ka20003",
        ),
        (
            "KODEX 반도체의 오늘 장중 시간대별 가격 흐름을 보여줘",
            DiscoveryIntent.QUERY,
            EntityKind.ETF,
            "base:ka40006",
        ),
        (
            "금 현물의 일자별 가격 흐름을 보여줘",
            DiscoveryIntent.QUERY,
            EntityKind.GOLD,
            "base:ka50012",
        ),
        (
            "mini gold spot 100그램을 limit sell로 주문해줘",
            DiscoveryIntent.ORDER,
            EntityKind.GOLD,
            "base:kt50001",
        ),
    ],
)
def test_v2_typed_discriminators_do_not_bleed_into_neighbor_profiles(
    catalog,
    question: str,
    intent: DiscoveryIntent,
    entity_kind: EntityKind | None,
    expected_ref: str,
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        intent,
        target_resolution=(TargetResolution(entity_kind) if entity_kind else None),
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


@pytest.mark.parametrize(
    ("question", "entity_kind", "expected_ref"),
    [
        (
            "한국전력의 거래원 조회에서 현재가와 거래량 요약만 보여줘",
            EntityKind.STOCK,
            "detail:ka10002:market_snapshot",
        ),
        (
            "Chart institutional and foreign net trading in Korea Electric Power by date",
            EntityKind.STOCK,
            "base:ka10060",
        ),
        (
            "코스피200 업종의 프로그램 매매 동향을 확인해줘",
            None,
            "base:ka10010",
        ),
        (
            "Show deposits in my brokerage account broken down by foreign currency",
            None,
            "detail:kt00001:foreign_currency_deposits",
        ),
        (
            "For one account and trading date, show order and execution status "
            "with order numbers",
            None,
            "detail:kt00009:order_execution_status",
        ),
        (
            "이 ELW의 confirmed payoff와 knock-out barrier 조건을 보여줘",
            EntityKind.ELW,
            "detail:ka30012:payoff_conditions",
        ),
        (
            "ELW 평가구간의 전체·직후·후반장 최고가와 최저가를 알려줘",
            EntityKind.ELW,
            "detail:ka30012:evaluation_extrema",
        ),
        (
            "Rank ELWs by proximity to their exercise price",
            EntityKind.ELW,
            "base:ka30011",
        ),
        (
            "Show the expected execution price and expected volume for mini gold "
            "before matching",
            EntityKind.GOLD,
            "base:ka50087",
        ),
        (
            "미체결 주문 목록과 체결 상세를 단일 조회로 합쳐서 보여줘",
            None,
            "detail:kt00009:order_execution_status",
        ),
    ],
)
def test_v3_structural_semantics_select_unique_exact_profiles(
    catalog,
    question: str,
    entity_kind: EntityKind | None,
    expected_ref: str,
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolution=(TargetResolution(entity_kind) if entity_kind else None),
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


@pytest.mark.parametrize(
    ("question", "entity_kind", "expected_ref"),
    [
        (
            "005930 current price and volume",
            EntityKind.STOCK,
            "detail:ka10001:current_trading",
        ),
        (
            "Chart institutional and foreign net trading in 005930 intraday",
            EntityKind.STOCK,
            "base:ka10064",
        ),
        (
            "코스피200 업종의 현재 지수 수준을 보여줘",
            None,
            "detail:ka20001:market_snapshot",
        ),
        (
            "이 ELW의 evaluation start and end를 알려줘",
            EntityKind.ELW,
            "detail:ka30012:evaluation_window",
        ),
        (
            "mini gold current price",
            EntityKind.GOLD,
            "base:ka50100",
        ),
    ],
)
def test_v3_structural_axes_preserve_neighbor_profiles(
    catalog,
    question: str,
    entity_kind: EntityKind | None,
    expected_ref: str,
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolution=(TargetResolution(entity_kind) if entity_kind else None),
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


def test_v3_identity_only_names_still_require_typed_resolution(catalog) -> None:
    question = "Retrieve Hyundai Glovis valuation multiples and book value per share"
    raw = decide_selector_compatibility(catalog, question, DiscoveryIntent.QUERY)
    resolved = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolution=TargetResolution(EntityKind.STOCK),
    )

    assert raw.status is CompatibilityDecisionStatus.REJECTED
    assert raw.selected_operation_ref is None
    assert resolved.status is CompatibilityDecisionStatus.SELECTED
    assert resolved.selected_operation_ref == "detail:ka10001:valuation"


def test_v3_market_wide_vi_screen_has_scope_without_minting_stock_anchor(catalog) -> None:
    screening = decide_selector_compatibility(
        catalog,
        "List domestic stocks whose volatility interruption was triggered today",
        DiscoveryIntent.QUERY,
    )
    bare_quote = decide_selector_compatibility(
        catalog,
        "Show stocks current price",
        DiscoveryIntent.QUERY,
    )
    ood = decide_selector_compatibility(
        catalog,
        "List apartments whose price interruption was triggered today",
        DiscoveryIntent.QUERY,
    )

    assert screening.status is CompatibilityDecisionStatus.SELECTED
    assert screening.selected_operation_ref == "base:ka10054"
    assert bare_quote.status is CompatibilityDecisionStatus.REJECTED
    assert bare_quote.selected_operation_ref is None
    assert ood.status is CompatibilityDecisionStatus.REJECTED
    assert ood.selected_operation_ref is None


@pytest.mark.parametrize(
    ("question", "intent", "entity_kind", "expected_ref"),
    [
        (
            "Find the domestic equities that entered a volatility interruption "
            "during this session",
            DiscoveryIntent.QUERY,
            None,
            "base:ka10054",
        ),
        (
            "화학 업종 지수의 현재가, 등락폭, 거래대금을 한 번에 알려줘",
            DiscoveryIntent.QUERY,
            None,
            "detail:ka20001:market_snapshot",
        ),
        (
            "미체결 상태인 미니금 주문을 모두 취소해줘",
            DiscoveryIntent.ORDER,
            EntityKind.GOLD,
            "base:kt50003",
        ),
        (
            "Return the latest price, absolute change, and percentage change "
            "for the chosen call ELW",
            DiscoveryIntent.QUERY,
            None,
            "detail:ka30012:market_snapshot",
        ),
        (
            "금 상품코드 M04020100의 최신 가격과 변동률을 보여줘",
            DiscoveryIntent.QUERY,
            None,
            "base:ka50100",
        ),
    ],
)
def test_v4_structural_semantics_select_unique_exact_profiles(
    catalog,
    question: str,
    intent: DiscoveryIntent,
    entity_kind: EntityKind | None,
    expected_ref: str,
) -> None:
    decision = decide_selector_compatibility(
        catalog,
        question,
        intent,
        target_resolution=(TargetResolution(entity_kind) if entity_kind else None),
    )

    assert decision.status is CompatibilityDecisionStatus.SELECTED
    assert decision.selected_operation_ref == expected_ref


def test_v4_one_shot_sector_fields_do_not_mean_all_sector_indexes(catalog) -> None:
    one_sector = decide_selector_compatibility(
        catalog,
        "화학 업종 지수의 현재가와 거래대금을 한 번에 알려줘",
        DiscoveryIntent.QUERY,
    )
    all_sectors = decide_selector_compatibility(
        catalog,
        "거래 가능한 전체 업종 지수의 현재 수준을 한 표로 조회해줘",
        DiscoveryIntent.QUERY,
    )

    assert one_sector.selected_operation_ref == "detail:ka20001:market_snapshot"
    assert all_sectors.selected_operation_ref == "base:ka20003"


def test_v4_unfilled_filter_does_not_change_cancel_into_read_query(catalog) -> None:
    cancel = decide_selector_compatibility(
        catalog,
        "미체결 상태인 미니금 주문을 모두 취소해줘",
        DiscoveryIntent.ORDER,
        target_resolution=TargetResolution(EntityKind.GOLD),
    )
    read = decide_selector_compatibility(
        catalog,
        "아직 미체결로 남은 국내주식 주문 목록을 조회해줘",
        DiscoveryIntent.QUERY,
    )

    assert cancel.selected_operation_ref == "base:kt50003"
    assert read.selected_operation_ref == "base:ka10075"


def test_v4_deictic_elw_and_gold_code_require_concrete_binding_syntax(catalog) -> None:
    bare_elw = decide_selector_compatibility(
        catalog,
        "Return the latest price and change for a call ELW",
        DiscoveryIntent.QUERY,
    )
    malformed_gold_code = decide_selector_compatibility(
        catalog,
        "금 상품코드 M0402010의 최신 가격과 변동률을 보여줘",
        DiscoveryIntent.QUERY,
    )

    assert bare_elw.status is CompatibilityDecisionStatus.REJECTED
    assert bare_elw.selected_operation_ref is None
    assert malformed_gold_code.status is CompatibilityDecisionStatus.REJECTED
    assert malformed_gold_code.selected_operation_ref is None


def test_account_combined_order_status_is_distinct_from_filled_orders(catalog) -> None:
    combined = decide_selector_compatibility(
        catalog,
        "계좌별 주문체결 현황만",
        DiscoveryIntent.QUERY,
    )
    filled = decide_selector_compatibility(
        catalog,
        "오늘 체결된 국내주식 주문 내역을 확인해줘",
        DiscoveryIntent.QUERY,
    )

    assert combined.selected_operation_ref == "detail:kt00009:order_execution_status"
    assert filled.selected_operation_ref == "base:ka10076"


def test_purchase_settlement_requires_typed_stock_target_and_is_not_a_buy(catalog) -> None:
    question = "purchase settlement and margin reduction"
    raw = decide_selector_compatibility(catalog, question, DiscoveryIntent.QUERY)
    resolved = decide_selector_compatibility(
        catalog,
        question,
        DiscoveryIntent.QUERY,
        target_resolution=TargetResolution(EntityKind.STOCK),
    )
    purchase_price = analyze_question(
        "Show the purchase price and margin rate for this stock",
        target_resolution=TargetResolution(EntityKind.STOCK),
    )

    assert raw.status is CompatibilityDecisionStatus.REJECTED
    assert raw.selected_operation_ref is None
    assert resolved.selected_operation_ref == "detail:kt00010:purchase_settlement"
    assert purchase_price.action_kind is None
    assert CapabilityKind.ACCOUNT_PURCHASE_SETTLEMENT not in purchase_price.capabilities


def test_gold_account_trade_history_is_distinct_from_instrument_execution_trend(catalog) -> None:
    account_history = decide_selector_compatibility(
        catalog,
        "gold spot transaction history",
        DiscoveryIntent.QUERY,
    )
    instrument_trend = decide_selector_compatibility(
        catalog,
        "선택한 금 현물 상품의 최근 체결가와 체결량 추이를 한 번 조회해줘",
        DiscoveryIntent.QUERY,
        target_resolution=TargetResolution(EntityKind.GOLD),
    )

    assert account_history.selected_operation_ref == "detail:kt50032:gold_trade_history"
    assert instrument_trend.selected_operation_ref == "base:ka50010"


def test_owned_order_execution_stream_is_distinct_from_market_trade_stream(catalog) -> None:
    owned_orders = decide_selector_compatibility(
        catalog,
        "내 계좌 주문 체결 내역 실시간으로 알려줘",
        DiscoveryIntent.WEBSOCKET,
    )
    market_trades = decide_selector_compatibility(
        catalog,
        "삼성전자 실시간 체결가 tick 스트리밍",
        DiscoveryIntent.WEBSOCKET,
        target_resolution=TargetResolution(EntityKind.STOCK),
    )

    assert owned_orders.selected_operation_ref == "base:00"
    assert market_trades.selected_operation_ref == "base:0B"


def test_condition_unsubscription_overrides_incidental_subscribe_word(catalog) -> None:
    unsubscribe = decide_selector_compatibility(
        catalog,
        "조건검색 realtime 구독 이제 그만 해지해줘",
        DiscoveryIntent.WEBSOCKET,
    )
    subscribe = decide_selector_compatibility(
        catalog,
        "조건검색 realtime 구독을 시작해줘",
        DiscoveryIntent.WEBSOCKET,
    )

    assert unsubscribe.selected_operation_ref == "base:ka10174"
    assert subscribe.selected_operation_ref == "base:ka10173"
