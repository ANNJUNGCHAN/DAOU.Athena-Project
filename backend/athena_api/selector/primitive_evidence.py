"""Value-free primitive evidence extracted from a selector question."""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum

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

from .instrument_identity import TargetResolution

TargetResolver = Callable[[str], TargetResolution | None]


class SpeechAct(StrEnum):
    ADVICE = "advice"
    IMPERATIVE = "imperative"
    READ_ONLY = "read_only"


class Ownership(StrEnum):
    UNKNOWN = "unknown"
    OWNED = "owned"
    THIRD_PARTY = "third_party"


class EntityCardinality(StrEnum):
    UNKNOWN = "unknown"
    SINGLE = "single"
    MULTIPLE = "multiple"


class TargetPresence(StrEnum):
    UNKNOWN = "unknown"
    PRESENT = "present"


class Delivery(StrEnum):
    UNSPECIFIED = "unspecified"
    SNAPSHOT = "snapshot"
    STREAM = "stream"


class AggregationScope(StrEnum):
    UNSPECIFIED = "unspecified"
    RECORD = "record"
    COLLECTION = "collection"
    RANKING = "ranking"
    SERIES = "series"
    COMPOUND = "compound"


class RangeKind(StrEnum):
    UNSPECIFIED = "unspecified"
    CURRENT = "current"
    TRADING_DAY = "trading_day"
    INTRADAY = "intraday"
    PERIODIC = "periodic"
    DATE_RANGE = "date_range"
    REALTIME = "realtime"


class EvidenceAxis(StrEnum):
    SPEECH_ACT = "speech_act"
    ACTION_KIND = "action_kind"
    OWNERSHIP = "ownership"
    ENTITY_CARDINALITY = "entity_cardinality"
    TARGET_PRESENCE = "target_presence"
    TARGET_SCOPE = "target_scope"
    DELIVERY = "delivery"
    AGGREGATION_SCOPE = "aggregation_scope"
    RANGE_KIND = "range_kind"
    CAPABILITY = "capability"
    FINANCING = "financing"
    FEED = "feed"


class RelationKind(StrEnum):
    GOVERNS = "governs"
    QUALIFIES = "qualifies"


@dataclass(frozen=True, slots=True)
class EvidenceAtom:
    """One canonical, value-free observation from the authored question."""

    axis: EvidenceAxis
    value: str


@dataclass(frozen=True, slots=True)
class EvidenceRelation:
    """A value-free relation between two canonical primitive observations."""

    left: EvidenceAxis
    relation: RelationKind
    right: EvidenceAxis


@dataclass(frozen=True, slots=True)
class QueryAnalysis:
    """Shadow evidence model used to prove exact operation compatibility."""

    speech_act: SpeechAct
    action_kind: ActionKind | None
    ownership: Ownership
    entity_cardinality: EntityCardinality
    target_presence: TargetPresence
    target_scope_present: bool
    delivery: Delivery
    aggregation_scope: AggregationScope
    range_kind: RangeKind
    capabilities: tuple[CapabilityKind, ...]
    financing: tuple[FinancingKind, ...]
    feeds: tuple[FeedKind, ...]
    subject: RoutingSubject | None
    entity_kinds: tuple[EntityKind, ...]
    execution: ExecutionKind | None
    data_intents: tuple[DataIntent, ...]
    temporal_scopes: tuple[TemporalScope, ...]
    measures: tuple[Measure, ...]
    result_shapes: tuple[RoutingResultShape, ...]
    bindings: tuple[BindingRole, ...]
    atoms: tuple[EvidenceAtom, ...]
    relations: tuple[EvidenceRelation, ...]


def _contains_ascii(text: str, phrase: str) -> bool:
    return re.search(rf"(?<![0-9a-z_]){re.escape(phrase)}(?![0-9a-z_])", text) is not None


def _action_kind(normalized: str) -> ActionKind | None:
    if (
        (
            re.search(r"\border(?![- ]?book)\b", normalized) is not None
            and any(term in normalized for term in ("adjust", "change"))
        )
        or ("주문" in normalized and "변경" in normalized)
    ):
        return ActionKind.AMEND
    authored: tuple[tuple[ActionKind, tuple[str, ...]], ...] = (
        (ActionKind.AMEND, ("amend", "modify order", "revise", "정정")),
        (ActionKind.CANCEL, ("cancel", "취소")),
        (ActionKind.UNSUBSCRIBE, ("unsubscribe", "unregister", "구독 해제", "등록 해제")),
        (ActionKind.SUBSCRIBE, ("subscribe", "stream", "구독", "실시간 등록")),
        (ActionKind.BUY, ("purchase", "purchasing", "buy", "buying", "매수")),
        (ActionKind.SELL, ("sell", "selling", "매도")),
    )
    for action, phrases in authored:
        if any(
            _contains_ascii(normalized, phrase)
            if phrase.isascii()
            else phrase in normalized
            for phrase in phrases
        ):
            return action
    return None


def _is_imperative_action(normalized: str, action: ActionKind | None) -> bool:
    if action is ActionKind.BUY:
        if any(
            term in normalized
            for term in ("purchase amount", "purchase price", "purchase settlement")
        ):
            return False
        return bool(
            re.search(
                r"(?:^|\s)(?:place\s+(?:a\s+)?(?:limit\s+)?purchase|purchase|buy)\b",
                normalized,
            )
            or re.search(r"매수\s*(?:해|하|주문)", normalized)
            or (
                _contains_ascii(normalized, "buy")
                and ("order" in normalized or "주문" in normalized)
            )
        )
    if action is ActionKind.SELL:
        return bool(
            re.search(r"(?:^|\s)(?:place\s+(?:a\s+)?(?:limit\s+)?sale|sell)\b", normalized)
            or re.search(r"매도\s*(?:해|하|주문)", normalized)
            or (
                _contains_ascii(normalized, "sell")
                and ("order" in normalized or "주문" in normalized)
            )
        )
    if action is ActionKind.AMEND:
        return bool(
            re.search(r"(?:^|\s)(?:amend|modify|revise|adjust|change)\b", normalized)
            or re.search(r"(?:정정|변경)\s*(?:해|하)", normalized)
        )
    if action is ActionKind.CANCEL:
        return bool(
            re.search(r"(?:^|\s)cancel\b", normalized)
            or re.search(r"취소\s*(?:해|하)", normalized)
        )
    if action is ActionKind.SUBSCRIBE:
        return bool(
            re.search(r"(?:^|\s)(?:subscribe|begin|start)\b", normalized)
            or re.search(r"(?:구독|등록|시작)\s*(?:해|하)", normalized)
        )
    if action is ActionKind.UNSUBSCRIBE:
        return bool(
            re.search(r"(?:^|\s)(?:unsubscribe|unregister|end|stop)\b", normalized)
            or re.search(r"(?:구독 해제|등록 해제|종료)\s*(?:해|하)", normalized)
        )
    return False


def _is_advice_semantics(normalized: str) -> bool:
    return any(
        phrase in normalized
        for phrase in (
            "advice",
            "appropriate",
            "sensible tactic",
            "would it be sensible",
            "should i",
            "조언",
            "적절할까",
            "괜찮을까",
        )
    )


def _aggregation_scope(shapes: tuple[RoutingResultShape, ...]) -> AggregationScope:
    precedence = (
        (RoutingResultShape.COMPOUND, AggregationScope.COMPOUND),
        (RoutingResultShape.RANKING, AggregationScope.RANKING),
        (RoutingResultShape.TIME_SERIES, AggregationScope.SERIES),
        (RoutingResultShape.COLLECTION, AggregationScope.COLLECTION),
        (RoutingResultShape.RECORD, AggregationScope.RECORD),
    )
    return next(
        (scope for shape, scope in precedence if shape in shapes),
        AggregationScope.UNSPECIFIED,
    )


def _range_kind(scopes: tuple[TemporalScope, ...]) -> RangeKind:
    if TemporalScope.REALTIME in scopes:
        return RangeKind.REALTIME
    if TemporalScope.TICK in scopes or TemporalScope.MINUTE in scopes:
        return RangeKind.INTRADAY
    if set(scopes).intersection(
        {TemporalScope.DAILY, TemporalScope.WEEKLY, TemporalScope.MONTHLY, TemporalScope.ANNUAL}
    ):
        return RangeKind.PERIODIC
    if TemporalScope.RANGE in scopes:
        return RangeKind.DATE_RANGE
    if TemporalScope.INTRADAY in scopes:
        return RangeKind.TRADING_DAY
    if TemporalScope.CURRENT in scopes:
        return RangeKind.CURRENT
    return RangeKind.UNSPECIFIED


def analyze_question(
    question: str,
    *,
    bound_argument_roles: tuple[BindingRole, ...] = (),
    target_resolution: TargetResolution | None = None,
    target_resolver: TargetResolver | None = None,
) -> QueryAnalysis:
    """Build value-free evidence without retaining entity or argument values.

    ``target_resolver`` is an internal transport-neutral instrument-master
    boundary. It resolves the whole question to an exact, typed instrument while
    retaining neither its name nor code. Caller-provided argument roles alone are
    deliberately not target identity evidence. Legacy boolean resolver results
    carry no authority because they cannot distinguish stocks from ETFs or ELWs.
    """
    from .query_frame import (  # Local import keeps QueryFrame as the public facade.
        _ENTITY_MARKERS,
        _direct_match,
        extract_query_frame,
        is_advice_request,
        is_multi_instrument_request,
        is_third_party_account_request,
        mask_opaque_instrument_spans,
    )

    masked_question = mask_opaque_instrument_spans(question)
    normalized = " ".join(masked_question.casefold().split())
    # Opaque-name inference is intentionally disabled on the plan-authoritative
    # path.  Proper-name syntax is not a product classifier; exact identity comes
    # from code/deictic/resolver evidence below.
    frame = extract_query_frame(question, infer_opaque_entity=False)
    action = _action_kind(normalized)
    advice = is_advice_request(question) or _is_advice_semantics(normalized)
    imperative = _is_imperative_action(normalized, action)
    speech = (
        SpeechAct.ADVICE
        if advice
        else SpeechAct.IMPERATIVE
        if imperative
        else SpeechAct.READ_ONLY
    )
    ownership = (
        Ownership.THIRD_PARTY
        if is_third_party_account_request(question)
        else Ownership.OWNED
        if re.search(r"(?<![가-힣])내(?:\s|$)", normalized)
        or re.search(r"\bmy\b", normalized)
        or any(term in normalized for term in ("나의", "내 계좌", "my account", "my holdings"))
        else Ownership.UNKNOWN
    )

    subject = frame.subject
    entity_kinds = list(frame.entity_kinds)
    execution = frame.execution
    data_intents = list(frame.data_intents)
    temporal_scopes = list(frame.temporal_scopes)
    measures = list(frame.measures)
    result_shapes = list(frame.result_shapes)
    bindings = list(frame.bindings)

    def stated(*terms: str) -> bool:
        return any(
            _contains_ascii(normalized, term)
            if term.isascii()
            else term in normalized
            for term in terms
        )

    def add(values: list[StrEnum], *items: StrEnum) -> None:
        values.extend(item for item in items if item not in values)

    def discard(values: list[StrEnum], *items: StrEnum) -> None:
        rejected = set(items)
        values[:] = [item for item in values if item not in rejected]

    chart_request = stated("chart", "candle", "차트", "캔들")
    ohlc = stated(
        "opening price", "session high", "session low", "시가", "고가", "저가", "종가"
    ) or (stated("open") and stated("high") and stated("low"))
    if chart_request:
        discard(data_intents, DataIntent.PRICE_RANGE, DataIntent.PRICE_HISTORY)
        add(data_intents, DataIntent.HISTORY, DataIntent.CHART)
        add(result_shapes, RoutingResultShape.TIME_SERIES)
    elif ohlc and stated("today", "오늘", "price limits", "상한가", "하한가"):
        fixed_daily_band = stated(
            "price limits",
            "limit-up",
            "limit-down",
            "상한가",
            "하한가",
            "expected trade",
            "expected fill",
            "예상체결",
            "예상 체결",
        )
        if fixed_daily_band:
            discard(temporal_scopes, TemporalScope.INTRADAY)
        else:
            discard(temporal_scopes, TemporalScope.DAILY)
        add(data_intents, DataIntent.PRICE_RANGE)
        add(
            temporal_scopes,
            TemporalScope.CURRENT,
            TemporalScope.DAILY if fixed_daily_band else TemporalScope.INTRADAY,
            TemporalScope.RANGE,
        )
        add(measures, Measure.PRICE)
        add(result_shapes, RoutingResultShape.RECORD)
    if stated("annual", "yearly", "year unit", "연 단위", "연봉"):
        discard(data_intents, DataIntent.PRICE_HISTORY)
        add(data_intents, DataIntent.HISTORY, DataIntent.CHART)
        add(temporal_scopes, TemporalScope.ANNUAL, TemporalScope.RANGE)
        add(result_shapes, RoutingResultShape.TIME_SERIES)
    if stated("by trading day", "each trading day", "거래일별", "일자별"):
        add(data_intents, DataIntent.HISTORY)
        add(temporal_scopes, TemporalScope.DAILY)
    if (
        subject is RoutingSubject.PARTICIPANT
        and DataIntent.CHART in data_intents
        and stated("by date", "날짜별", "일자별")
    ):
        add(temporal_scopes, TemporalScope.DAILY)
    exact_periods = {
        TemporalScope.TICK,
        TemporalScope.MINUTE,
        TemporalScope.WEEKLY,
        TemporalScope.MONTHLY,
        TemporalScope.ANNUAL,
    }.intersection(temporal_scopes)
    if exact_periods:
        discard(temporal_scopes, TemporalScope.INTRADAY)
        discard(temporal_scopes, TemporalScope.CURRENT)
        if DataIntent.HISTORY in data_intents or DataIntent.CHART in data_intents:
            discard(data_intents, DataIntent.SNAPSHOT)
        if not stated("date range", "from", "between", "기간", "범위"):
            discard(temporal_scopes, TemporalScope.RANGE)

    per_extrema = stated(
        "low per", "high per", "저per", "고per", "per이 높은", "per이 낮은"
    )
    if per_extrema:
        discard(data_intents, DataIntent.SCREENING)
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.VALUATION)
        discard(result_shapes, RoutingResultShape.RECORD)
        add(result_shapes, RoutingResultShape.COLLECTION)
    equity_valuation = EntityKind.STOCK in entity_kinds and stated(
        "per", "pbr", "eps", "book value per share", "주당순자산"
    )
    if equity_valuation and not per_extrema:
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.VALUATION)
        add(result_shapes, RoutingResultShape.RECORD)
    identity_capital = EntityKind.STOCK in entity_kinds and stated(
        "face value", "capital stock", "listed shares", "액면가", "자본금", "상장주식"
    )
    if identity_capital:
        add(data_intents, DataIntent.IDENTITY)
        add(measures, Measure.IDENTITY, Measure.FUNDAMENTALS)
        add(result_shapes, RoutingResultShape.RECORD)
    if stated("52-week", "52 week", "52주", "연중 최고", "연중 최저"):
        discard(data_intents, DataIntent.SNAPSHOT, DataIntent.HISTORY, DataIntent.CHART)
        discard(temporal_scopes, TemporalScope.CURRENT, TemporalScope.DAILY)
        add(data_intents, DataIntent.PRICE_RANGE)
        add(temporal_scopes, TemporalScope.RANGE)
        add(measures, Measure.PRICE)
        add(result_shapes, RoutingResultShape.RECORD)
        if stated("current market snapshot", "current snapshot", "현재 시장 스냅샷"):
            add(data_intents, DataIntent.SNAPSHOT, DataIntent.CURRENT_QUOTE)
            add(temporal_scopes, TemporalScope.CURRENT)
        elif stated("daily history", "daily historical", "일별 이력", "일자별 이력"):
            add(data_intents, DataIntent.HISTORY)
            add(temporal_scopes, TemporalScope.DAILY)
    volatility_request = stated("volatility interruption", "vi 발동", "변동성 완화")
    market_wide_stock_wording = stated(
        "domestic stocks", "domestic equities", "stocks", "equities", "국내주식"
    )
    volatility_screen = volatility_request and (
        EntityKind.STOCK in entity_kinds or market_wide_stock_wording
    )
    if volatility_screen:
        if market_wide_stock_wording:
            add(entity_kinds, EntityKind.STOCK)
        add(data_intents, DataIntent.SNAPSHOT, DataIntent.SCREENING)
        add(measures, Measure.VOLATILITY)
        add(result_shapes, RoutingResultShape.COLLECTION)
    program_snapshot = EntityKind.STOCK in entity_kinds and stated(
        "program trading status", "program trading snapshot", "프로그램 매매 현황"
    )
    if program_snapshot:
        discard(data_intents, DataIntent.HISTORY, DataIntent.RANKING)
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.FLOW, Measure.PROGRAM_TRADING)
        add(result_shapes, RoutingResultShape.COMPOUND)
    breadth = stated(
        "오른 종목",
        "보합 종목",
        "내린 종목",
        "상승·보합·하락",
        "상승 종목",
        "하락 종목",
        "advancers",
        "decliners",
    )
    if EntityKind.SECTOR_INDEX in entity_kinds and breadth:
        discard(entity_kinds, EntityKind.STOCK)
        add(data_intents, DataIntent.SNAPSHOT)
        add(temporal_scopes, TemporalScope.CURRENT)
        add(measures, Measure.CHANGE)
        add(result_shapes, RoutingResultShape.RECORD)
    if EntityKind.SECTOR_INDEX in entity_kinds and stated("program trading", "프로그램 거래"):
        discard(data_intents, DataIntent.HISTORY)
        discard(result_shapes, RoutingResultShape.TIME_SERIES)
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.FLOW)
        add(result_shapes, RoutingResultShape.RECORD)
    sector_sort = EntityKind.SECTOR_INDEX in entity_kinds and stated(
        "order sectors by", "sort sectors by", "업종 순위"
    )
    if sector_sort:
        subject = RoutingSubject.SECTOR
        execution = ExecutionKind.QUERY
        discard(entity_kinds, EntityKind.ORDER)
        discard(data_intents, DataIntent.ORDER_ACTION)
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.FLOW)
        add(result_shapes, RoutingResultShape.COLLECTION)
        action = None
    constituents = EntityKind.SECTOR_INDEX in entity_kinds and (
        stated("constituents", "members", "구성 종목", "속한 종목별", "업종 종목별")
        or (
            stated("stocks", "shares", "종목")
            and stated("inside", "within", "in the sector", "업종 내", "섹터 내")
        )
    )
    if constituents:
        discard(entity_kinds, EntityKind.STOCK)
        add(data_intents, DataIntent.SNAPSHOT, DataIntent.SCREENING)
        add(measures, Measure.IDENTITY, Measure.PRICE)
        add(result_shapes, RoutingResultShape.COLLECTION)
    if EntityKind.SECTOR_INDEX in entity_kinds and stated("업종코드"):
        if DataIntent.CURRENT_QUOTE in data_intents or TemporalScope.CURRENT in temporal_scopes:
            discard(data_intents, DataIntent.IDENTITY)
            discard(measures, Measure.IDENTITY)
        elif stated("list", "리스트", "목록"):
            subject = RoutingSubject.SECTOR
            execution = ExecutionKind.QUERY
            add(data_intents, DataIntent.IDENTITY)
            add(result_shapes, RoutingResultShape.COLLECTION)
    sector_collection = (
        EntityKind.SECTOR_INDEX in entity_kinds
        and stated("all", "entire", "전체")
        and stated("sector", "industry", "업종", "섹터")
        and stated("index", "지수")
    )
    if sector_collection:
        add(data_intents, DataIntent.SNAPSHOT)
        add(result_shapes, RoutingResultShape.COLLECTION)
    if stated("member list", "broker list", "회원사 리스트", "회원사 목록"):
        subject = RoutingSubject.PARTICIPANT
        execution = ExecutionKind.QUERY
        entity_kinds = [EntityKind.BROKER, EntityKind.STOCK]
        data_intents = [DataIntent.SCREENING]
        measures = []
        result_shapes = [RoutingResultShape.COLLECTION]
    if stated("foreign investor", "외국인 투자자", "외국인 매매동향"):
        subject = RoutingSubject.PARTICIPANT
        add(entity_kinds, EntityKind.INVESTOR, EntityKind.STOCK)
        add(measures, Measure.FLOW)
        if not set(data_intents).intersection({DataIntent.HISTORY, DataIntent.CHART}):
            add(data_intents, DataIntent.SNAPSHOT)
            add(result_shapes, RoutingResultShape.COLLECTION)

    account_number = stated("account number", "brokerage account number", "계좌 번호", "계좌번호")
    if account_number:
        subject = RoutingSubject.ACCOUNT
        entity_kinds = [EntityKind.ACCOUNT]
        execution = ExecutionKind.QUERY
        data_intents = [DataIntent.IDENTITY, DataIntent.ACCOUNT_STATE]
        temporal_scopes = []
        measures = [Measure.IDENTITY]
        result_shapes = [RoutingResultShape.RECORD]
    if EntityKind.ACCOUNT in entity_kinds and stated(
        "estimated assets", "asset value", "추정치", "자산가치"
    ):
        add(data_intents, DataIntent.ACCOUNT_STATE)
        add(measures, Measure.VALUATION, Measure.BALANCE)
        add(result_shapes, RoutingResultShape.RECORD)
    if (
        EntityKind.ACCOUNT in entity_kinds
        and Measure.PNL in measures
        and stated("거래일별", "daily")
    ):
        discard(data_intents, DataIntent.PORTFOLIO)
        add(data_intents, DataIntent.PERFORMANCE, DataIntent.HISTORY)
        add(temporal_scopes, TemporalScope.DAILY)
        add(result_shapes, RoutingResultShape.TIME_SERIES)
    read_only_status = stated(
        "execution status",
        "order identifiers",
        "주문 현황",
        "주문체결 현황",
        "체결 상세",
        "미체결 주문",
        "체결되지 않은",
        "이미 체결된",
    )
    if read_only_status and speech is not SpeechAct.IMPERATIVE:
        subject = RoutingSubject.ACCOUNT
        execution = ExecutionKind.QUERY
        discard(entity_kinds, EntityKind.ORDER)
        add(entity_kinds, EntityKind.ACCOUNT, EntityKind.STOCK)
        discard(data_intents, DataIntent.ORDER_ACTION)
        add(data_intents, DataIntent.ACCOUNT_STATE)
        add(measures, Measure.ORDER_STATUS, Measure.TRADE)
        add(result_shapes, RoutingResultShape.COLLECTION)
        action = None
    gold_account = stated("금 계좌", "gold account")
    if gold_account:
        subject = RoutingSubject.ACCOUNT
        add(entity_kinds, EntityKind.ACCOUNT, EntityKind.GOLD)
        discard(data_intents, DataIntent.ACCOUNT_STATE)
        add(data_intents, DataIntent.PORTFOLIO)
        add(measures, Measure.VALUATION)
        add(result_shapes, RoutingResultShape.RECORD)
    dated_transactions = EntityKind.GOLD in entity_kinds and stated(
        "transactions", "transaction history", "거래 내역"
    )
    if dated_transactions:
        subject = RoutingSubject.ACCOUNT
        execution = ExecutionKind.QUERY
        entity_kinds = [EntityKind.ACCOUNT, EntityKind.GOLD]
        data_intents = [DataIntent.HISTORY]
        temporal_scopes = [TemporalScope.RANGE]
        add(measures, Measure.PRICE, Measure.TRADE)
        result_shapes = [RoutingResultShape.TIME_SERIES]
        action = None

    purchase_settlement = stated("purchase settlement", "매수 결제") and stated(
        "margin reduction", "margin decrease", "증거금 감소", "증거금감소"
    )
    if purchase_settlement:
        speech = SpeechAct.READ_ONLY
        subject = RoutingSubject.ACCOUNT
        execution = ExecutionKind.QUERY
        discard(entity_kinds, EntityKind.ORDER)
        add(entity_kinds, EntityKind.ACCOUNT, EntityKind.STOCK)
        discard(data_intents, DataIntent.ORDER_ACTION)
        add(data_intents, DataIntent.SNAPSHOT, DataIntent.PURCHASE_SETTLEMENT)
        add(measures, Measure.BALANCE, Measure.ORDER_STATUS)
        discard(result_shapes, RoutingResultShape.ACKNOWLEDGEMENT)
        add(result_shapes, RoutingResultShape.RECORD)
        action = None

    if (
        EntityKind.ETF in entity_kinds
        and Measure.TRADE in measures
        and stated("time-stamped", "executions", "체결")
    ):
        discard(temporal_scopes, TemporalScope.CURRENT)
        discard(result_shapes, RoutingResultShape.COLLECTION)
        add(data_intents, DataIntent.SNAPSHOT)
        add(temporal_scopes, TemporalScope.INTRADAY)
        add(result_shapes, RoutingResultShape.TIME_SERIES)
    if EntityKind.ETF in entity_kinds and Measure.FLOW in measures:
        add(data_intents, DataIntent.SNAPSHOT)
    if EntityKind.ETF in entity_kinds and stated(
        "by time interval", "time intervals", "시간 구간별", "시간대별"
    ):
        discard(data_intents, DataIntent.SNAPSHOT)
        add(data_intents, DataIntent.HISTORY)
        add(temporal_scopes, TemporalScope.INTRADAY, TemporalScope.RANGE)
        add(result_shapes, RoutingResultShape.TIME_SERIES)
    if (
        EntityKind.ETF in entity_kinds
        and Measure.NAV in measures
        and TemporalScope.INTRADAY in temporal_scopes
        and stated("snapshot", "status", "현황", "한 번")
        and not stated("trend", "history", "추이", "이력")
    ):
        discard(data_intents, DataIntent.HISTORY)
        discard(temporal_scopes, TemporalScope.RANGE)
        add(data_intents, DataIntent.SNAPSHOT)
    if EntityKind.ETF in entity_kinds and stated(
        "etf information", "etf info", "etf 종목 정보", "etf 정보"
    ):
        add(data_intents, DataIntent.IDENTITY)
        add(measures, Measure.IDENTITY)
        add(result_shapes, RoutingResultShape.RECORD)
    if EntityKind.ETF in entity_kinds and stated(
        "filter", "screen", "entire etf", "all etfs", "전체 시세", "걸러"
    ):
        add(data_intents, DataIntent.SCREENING)
        add(result_shapes, RoutingResultShape.COLLECTION)

    lp_members = EntityKind.ELW in entity_kinds and stated(
        "member firms", "members", "회원사", "lp 회원"
    ) and stated(
        "liquidity provider", "liquidity-provider", "유동성을 공급", "유동성 공급", "lp"
    )
    if lp_members:
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.VOLATILITY)
        add(result_shapes, RoutingResultShape.RECORD)
    evaluation_window = EntityKind.ELW in entity_kinds and stated(
        "evaluation interval", "evaluation window", "평가기간", "평가구간"
    )
    if evaluation_window:
        discard(data_intents, DataIntent.PRICE_RANGE)
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.VALUATION)
        add(result_shapes, RoutingResultShape.RECORD)
    if (
        EntityKind.ELW in entity_kinds
        and Measure.OWNERSHIP in measures
        and stated("trading day", "거래일별")
    ):
        discard(data_intents, DataIntent.CHART)
        add(data_intents, DataIntent.HISTORY)
        add(temporal_scopes, TemporalScope.DAILY, TemporalScope.RANGE)
        add(result_shapes, RoutingResultShape.TIME_SERIES)
    if EntityKind.ELW in entity_kinds and stated("proximity", "how close", "근접"):
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.PRICE)
        add(result_shapes, RoutingResultShape.COLLECTION)

    gold_code = stated("gold product code", "금 상품코드", "금 상품 코드")
    if gold_code:
        subject = RoutingSubject.INSTRUMENT
        discard(entity_kinds, EntityKind.STOCK)
        add(entity_kinds, EntityKind.GOLD)
        discard(temporal_scopes, TemporalScope.CURRENT)
        add(data_intents, DataIntent.CURRENT_QUOTE)
        add(measures, Measure.PRICE, Measure.CHANGE)
        add(result_shapes, RoutingResultShape.RECORD)
    indicative = EntityKind.GOLD in entity_kinds and stated(
        "indicative",
        "expected match",
        "expected execution",
        "before matching",
        "예상체결",
        "예상 체결",
    )
    if indicative:
        discard(measures, Measure.POSITION)
        add(data_intents, DataIntent.EXPECTED_QUOTE)
        add(measures, Measure.PRICE, Measure.TRADE)
        add(result_shapes, RoutingResultShape.COLLECTION)
    if (
        EntityKind.GOLD in entity_kinds
        and stated("일자별", "trading day", "daily")
        and Measure.PRICE in measures
    ):
        add(data_intents, DataIntent.HISTORY)
        add(temporal_scopes, TemporalScope.DAILY, TemporalScope.RANGE)
        add(result_shapes, RoutingResultShape.TIME_SERIES)

    gold_execution_trend = EntityKind.GOLD in entity_kinds and stated(
        "execution price", "traded price", "체결가", "체결 가격"
    ) and stated("execution volume", "traded volume", "체결량")
    if gold_execution_trend:
        add(data_intents, DataIntent.HISTORY)
        add(temporal_scopes, TemporalScope.RANGE)
        add(measures, Measure.PRICE, Measure.VOLUME, Measure.TRADE)
        add(result_shapes, RoutingResultShape.TIME_SERIES)

    price_only_execution = stated(
        "execution price",
        "traded price",
        "current fill price",
        "체결가",
        "현재 체결가",
        "체결 가격",
        "체결 시세",
    ) and not stated(
        "transactions",
        "executions",
        "fills",
        "trade history",
        "execution history",
        "execution volume",
        "traded volume",
        "체결 내역",
        "체결 목록",
        "체결량",
    )
    if price_only_execution:
        discard(measures, Measure.TRADE)

    if (
        action
        in {ActionKind.BUY, ActionKind.SELL, ActionKind.AMEND, ActionKind.CANCEL}
        and speech is SpeechAct.IMPERATIVE
    ):
        subject = RoutingSubject.ORDER
        execution = ExecutionKind.ORDER
        add(entity_kinds, EntityKind.ORDER, EntityKind.ACCOUNT)
        if not set(entity_kinds).intersection(
            {EntityKind.STOCK, EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD}
        ):
            add(entity_kinds, EntityKind.STOCK)
        discard(data_intents, DataIntent.ACCOUNT_STATE)
        add(data_intents, DataIntent.ORDER_ACTION)
        if action is ActionKind.AMEND:
            add(data_intents, DataIntent.ORDER_AMEND)
        if action is ActionKind.CANCEL:
            add(data_intents, DataIntent.ORDER_CANCEL)
        measures = [Measure.ORDER_STATUS]
        result_shapes = [RoutingResultShape.ACKNOWLEDGEMENT]
    continuous = stated(
        "continuous",
        "live updates",
        "realtime updates",
        "live feed",
        "stream",
        "계속 보내",
        "계속 push",
        "계속 전송",
        "계속 구독",
        "실시간 업데이트",
    )
    if continuous and set(entity_kinds).intersection(
        {
            EntityKind.STOCK,
            EntityKind.ETF,
            EntityKind.ELW,
            EntityKind.GOLD,
            EntityKind.SECTOR_INDEX,
        }
    ):
        execution = ExecutionKind.WEBSOCKET
        add(data_intents, DataIntent.SUBSCRIPTION)
        add(temporal_scopes, TemporalScope.REALTIME)
        add(result_shapes, RoutingResultShape.STREAM)
    condition_lifecycle = EntityKind.CONDITION in entity_kinds and stated(
        "realtime", "live monitoring", "실시간"
    )
    if condition_lifecycle:
        subject = RoutingSubject.COLLECTION
        execution = ExecutionKind.WEBSOCKET
        add(entity_kinds, EntityKind.STOCK)
        add(temporal_scopes, TemporalScope.REALTIME)
        add(result_shapes, RoutingResultShape.STREAM)
        if stated("end", "stop", "종료", "해제"):
            discard(data_intents, DataIntent.SUBSCRIPTION)
            add(data_intents, DataIntent.UNSUBSCRIPTION, DataIntent.SCREENING)
            action = ActionKind.UNSUBSCRIBE
        elif stated("begin", "start", "시작", "등록"):
            add(data_intents, DataIntent.SUBSCRIPTION, DataIntent.SCREENING)
            action = ActionKind.SUBSCRIBE
    condition_list = EntityKind.CONDITION in entity_kinds and stated(
        "condition list", "saved conditions", "조건검색 목록", "조건 목록"
    )
    if condition_list:
        subject = RoutingSubject.COLLECTION
        execution = ExecutionKind.WEBSOCKET
        add(entity_kinds, EntityKind.STOCK)
        add(data_intents, DataIntent.SUBSCRIPTION, DataIntent.SCREENING)
        add(temporal_scopes, TemporalScope.REALTIME)
        add(result_shapes, RoutingResultShape.COLLECTION, RoutingResultShape.STREAM)

    explicit_historical_period = stated(
        "by trading day",
        "each trading day",
        "historical",
        "over the period",
        "거래일별",
        "일자별",
        "기간 추이",
    ) or bool(
        set(temporal_scopes).intersection(
            {
                TemporalScope.TICK,
                TemporalScope.MINUTE,
                TemporalScope.DAILY,
                TemporalScope.WEEKLY,
                TemporalScope.MONTHLY,
                TemporalScope.ANNUAL,
                TemporalScope.RANGE,
            }
        )
    )
    if (
        execution is ExecutionKind.WEBSOCKET
        and TemporalScope.REALTIME in temporal_scopes
        and not explicit_historical_period
    ):
        discard(data_intents, DataIntent.HISTORY, DataIntent.PRICE_HISTORY)

    explicit_price_range = DataIntent.PRICE_RANGE in data_intents and stated(
        "price range",
        "annual high",
        "annual low",
        "250-day",
        "250 day",
        "250일",
        "52-week",
        "52 week",
        "가격 범위",
    )
    if explicit_price_range and not chart_request:
        discard(data_intents, DataIntent.HISTORY, DataIntent.CHART, DataIntent.RANKING)
        discard(temporal_scopes, TemporalScope.ANNUAL)
        add(temporal_scopes, TemporalScope.RANGE)
        discard(result_shapes, RoutingResultShape.TIME_SERIES, RoutingResultShape.RANKING)
        add(result_shapes, RoutingResultShape.RECORD)

    if execution is ExecutionKind.WEBSOCKET:
        if DataIntent.UNSUBSCRIPTION in data_intents:
            action = ActionKind.UNSUBSCRIBE
        elif action is None and DataIntent.SUBSCRIPTION in data_intents:
            action = ActionKind.SUBSCRIBE

    realtime_order_executions = (
        execution is ExecutionKind.WEBSOCKET
        and EntityKind.ORDER in entity_kinds
        and stated(
            "order execution",
            "order executions",
            "order fills",
            "주문 체결",
            "주문체결",
        )
    )
    if realtime_order_executions:
        subject = RoutingSubject.ORDER
        discard(data_intents, DataIntent.ACCOUNT_STATE)
        add(data_intents, DataIntent.SUBSCRIPTION, DataIntent.ORDER_ACTION)
        add(measures, Measure.TRADE)

    if execution is ExecutionKind.WEBSOCKET:
        discard(temporal_scopes, TemporalScope.CURRENT)
        discard(data_intents, DataIntent.SNAPSHOT)
        discard(result_shapes, RoutingResultShape.RECORD)
        if not condition_list:
            discard(result_shapes, RoutingResultShape.COLLECTION)
        add(result_shapes, RoutingResultShape.STREAM)
        if EntityKind.SECTOR_INDEX in entity_kinds:
            discard(entity_kinds, EntityKind.STOCK)

    account_assets_summary = False
    if subject is RoutingSubject.ACCOUNT:
        account_assets_summary = (
            stated("investment positions")
            and stated("total purchase", "total valuation", "총매입", "총평가")
        ) or (
            stated("cash", "deposit", "deposits", "예수금")
            and stated(
                "total assets",
                "asset valuation",
                "total valuation",
                "총자산",
                "자산 평가",
                "평가액",
            )
        )
        holdings_request = stated(
            "every holding",
            "each holding",
            "each stock i hold",
            "holdings",
            "보유 종목",
            "보유 중인 종목",
            "보유내역",
            "보유 내역",
        ) and stated("quantity", "valuation", "unrealized", "수량", "평가", "손익")
        portfolio_summary = stated(
            "total valuation", "overall return", "portfolio summary", "전체 평가", "총평가"
        )
        settlement_snapshot = stated(
            "settlement forecast",
            "cash settlement",
            "d+1",
            "d+2",
            "withdrawable",
            "withdraw",
            "order capacity",
            "결제 예상",
            "출금 가능",
        )
        position_rows = stated("each position", "position별", "각 position") and stated(
            "valuation", "평가금액", "매입금액"
        )
        credit_summary = stated(
            "credit financing", "stock-lending", "total loans", "신용", "대주"
        ) and stated("summary", "summarize", "요약")
        daily_return = stated("daily return", "return by date", "잔고수익률") and stated(
            "daily", "by date", "날짜별", "일자별"
        )
        trade_ledger = stated(
            "transaction history",
            "trade ledger",
            "trading ledger",
            "거래 내역",
            "거래내역",
        ) and stated("period", "date range", "기간별", "기간")
        if account_assets_summary:
            discard(data_intents, DataIntent.PORTFOLIO, DataIntent.HOLDINGS)
            add(data_intents, DataIntent.ACCOUNT_STATE)
            add(measures, Measure.BALANCE, Measure.VALUATION)
            add(result_shapes, RoutingResultShape.RECORD)
        elif position_rows:
            discard(data_intents, DataIntent.ACCOUNT_STATE)
            add(data_intents, DataIntent.PORTFOLIO)
            add(measures, Measure.POSITION, Measure.VALUATION)
            add(result_shapes, RoutingResultShape.COLLECTION)
        elif credit_summary:
            discard(data_intents, DataIntent.ACCOUNT_STATE)
            add(data_intents, DataIntent.SNAPSHOT, DataIntent.PORTFOLIO)
            add(measures, Measure.CREDIT, Measure.LENDING)
            add(result_shapes, RoutingResultShape.RECORD)
        elif daily_return:
            discard(data_intents, DataIntent.ACCOUNT_STATE, DataIntent.PORTFOLIO)
            add(data_intents, DataIntent.PERFORMANCE, DataIntent.HISTORY)
            add(temporal_scopes, TemporalScope.DAILY)
            add(measures, Measure.PNL)
            add(result_shapes, RoutingResultShape.TIME_SERIES)
        elif trade_ledger:
            add(data_intents, DataIntent.HISTORY, DataIntent.ACCOUNT_STATE)
            add(temporal_scopes, TemporalScope.RANGE)
            add(result_shapes, RoutingResultShape.COLLECTION)
        elif holdings_request:
            discard(data_intents, DataIntent.ACCOUNT_STATE)
            add(data_intents, DataIntent.PORTFOLIO, DataIntent.HOLDINGS)
            discard(measures, Measure.PRICE)
            add(result_shapes, RoutingResultShape.COLLECTION)
        elif portfolio_summary:
            discard(data_intents, DataIntent.ACCOUNT_STATE, DataIntent.ORDER_ACTION)
            add(data_intents, DataIntent.PORTFOLIO)
            discard(result_shapes, RoutingResultShape.ACKNOWLEDGEMENT)
            add(result_shapes, RoutingResultShape.RECORD)
        elif settlement_snapshot:
            discard(data_intents, DataIntent.ACCOUNT_STATE)
            add(data_intents, DataIntent.SNAPSHOT)
            add(result_shapes, RoutingResultShape.RECORD)
        if DataIntent.PERFORMANCE in data_intents and DataIntent.HISTORY in data_intents:
            discard(data_intents, DataIntent.ACCOUNT_STATE, DataIntent.PORTFOLIO)
        if EntityKind.GOLD in entity_kinds and portfolio_summary:
            discard(data_intents, DataIntent.ACCOUNT_STATE)
            add(data_intents, DataIntent.PORTFOLIO)

    if EntityKind.GOLD in entity_kinds:
        discard(entity_kinds, EntityKind.STOCK)
        if execution is ExecutionKind.ORDER:
            discard(data_intents, DataIntent.PORTFOLIO, DataIntent.ACCOUNT_STATE)

    if DataIntent.MARKET_SCALE in data_intents:
        discard(data_intents, DataIntent.IDENTITY)
        discard(measures, Measure.PRICE, Measure.IDENTITY)

    if (
        speech is SpeechAct.READ_ONLY
        and action
        in {ActionKind.BUY, ActionKind.SELL, ActionKind.AMEND, ActionKind.CANCEL}
    ):
        action = None

    resolution = target_resolution
    if resolution is None and target_resolver is not None:
        try:
            resolution = target_resolver(question)
        except Exception:
            resolution = None
    resolved_products = {
        EntityKind.STOCK,
        EntityKind.ETF,
        EntityKind.ELW,
        EntityKind.GOLD,
    }
    if (
        not isinstance(resolution, TargetResolution)
        or not resolution.present
        or resolution.entity_kind not in resolved_products
    ):
        resolution = None
    resolved_target = resolution is not None
    if resolution is not None:
        entity_kinds[:] = [
            item for item in entity_kinds if item not in resolved_products
        ]
        add(entity_kinds, resolution.entity_kind)
        if subject is None:
            subject = RoutingSubject.INSTRUMENT

    cardinality = (
        EntityCardinality.MULTIPLE
        if is_multi_instrument_request(question)
        else EntityCardinality.SINGLE
        if resolved_target
        or stated("this stock", "this security", "이 종목", "해당 종목")
        else EntityCardinality.UNKNOWN
    )
    # Cardinality describes how many targets the question names. Target presence is
    # the independent plan-authority precondition: an asset class such as ``ETF``
    # or ``gold`` is not a bound instrument. Korean issuer names followed by a
    # reviewed market concept are detected syntactically and discarded immediately.
    # A syntactic proper-name span is only discovery scope: without a trusted
    # stock-master resolution it cannot distinguish an issuer from Bitcoin, an
    # apartment, a product, a weekday, or another out-of-domain noun.
    reviewed_asset_target = any(
        _direct_match(question.casefold(), marker.casefold())
        for markers in _ENTITY_MARKERS.values()
        for marker in markers
    )
    concrete_gold_target = (
        EntityKind.GOLD in entity_kinds
        and (
            (
                gold_code
                and re.search(r"(?<![0-9A-Z])M\d{8}(?![0-9A-Z])", question, re.IGNORECASE)
                is not None
            )
            or
            re.search(
                r"(?<!\d)(?:100\s*(?:g|gram|그램)|1\s*kg|1킬로|99\.99)(?!\d)",
                question,
                re.IGNORECASE,
            )
            is not None
            or stated(
                "mini gold",
                "mini-gold",
                "one-kilogram",
                "one kilogram",
                "미니금",
                "미니 금",
            )
        )
    )
    deictic_target = any(
        _direct_match(question.casefold(), phrase)
        for phrase in (
            "this stock",
            "this security",
            "selected stock",
            "selected etf",
            "selected elw",
            "selected gold",
            "selected gold product",
            "selected spot gold product",
            "selected spot-gold product",
            "this etf",
            "this elw",
            "this gold",
            "이 종목",
            "해당 종목",
            "이 etf",
            "이 elw",
            "이 금현물",
            "선택한 종목",
            "선택한 주식",
            "선택한 etf",
            "선택한 elw",
            "선택한 콜 elw",
            "선택한 풋 elw",
            "선택한 금현물",
            "선택한 금 현물",
            "선택한 금 현물 상품",
            "선택한 spot gold product",
            "선택한 spot-gold product",
        )
    ) or bool(
        re.search(
            r"(?<!\w)(?:this|selected|chosen|이|선택한)(?:\s+[\w-]+){0,2}\s+"
            r"(?:stock|security|etf|elw|gold|종목|주식|금\s*현물)"
            r"(?=$|\s|[의을를은는이가])",
            normalized,
        )
    )
    # 질문이 6자리 국내 종목 코드를 직접 적었으면 그 자체가 대상 근거다. 고유명사
    # 스팬과 달리 코드는 종목 마스터 없이도 형식으로 확정되고, 어떤 종목인지는
    # 여기서 보존하지 않는다. 날짜(yymmdd)·수량과 섞이지 않도록 코드 토큰에 붙는
    # 날짜·단위 표현은 제외한다.
    explicit_code_target = any(
        # 코드에 공백 없이 바로 단위가 붙으면(260822일, 5000원) 식별자가 아니다.
        # "005930 일봉"처럼 띄어쓴 뒤의 일/월은 주기 표현이므로 제외하지 않는다.
        not re.match(r"(?:년|월|일|시|분|초|원|주|건|%|퍼센트)(?![가-힣])", question[match.end() :])
        and not re.search(
            r"(?:날짜|일자|기준일|date)\s*$", question[: match.start()], re.IGNORECASE
        )
        for match in re.finditer(r"(?<!\d)\d{6}(?!\d)", question)
    )
    target_presence = (
        TargetPresence.PRESENT
        if resolved_target
        or explicit_code_target
        or concrete_gold_target
        or deictic_target
        else TargetPresence.UNKNOWN
    )
    authored_target = (
        resolved_target
        or reviewed_asset_target
        or explicit_code_target
        or concrete_gold_target
        or deictic_target
    )
    market_wide_stock_screen = (
        DataIntent.SCREENING in data_intents
        and RoutingResultShape.COLLECTION in result_shapes
        and EntityKind.SECTOR_INDEX not in entity_kinds
        and stated("stocks", "equities", "domestic stocks", "국내주식", "종목")
    )
    if market_wide_stock_screen:
        add(entity_kinds, EntityKind.STOCK)
    target_scope_present = authored_target or stated(
        "account",
        "portfolio",
        "holdings",
        "position",
        "positions",
        "market",
        "sector",
        "industry index",
        "equities",
        "investor",
        "broker",
        "order book",
        "orderbook",
        "condition",
        "screening",
        "stock",
        "shares",
        "etf",
        "elw",
        "gold spot",
        "계좌",
        "포트폴리오",
        "보유종목",
        "시장",
        "코스피",
        "코스닥",
        "업종",
        "섹터",
        "투자자",
        "거래원",
        "회원사",
        "조건검색",
        "호가잔량",
        "외국인",
        "기관",
        "주식",
        "주가",
        "종목",
        "금현물",
        "금 현물",
    )
    if (
        EntityKind.SECTOR_INDEX in entity_kinds
        and stated("index", "sector", "industry", "지수", "업종", "섹터")
    ):
        target_scope_present = True
    if subject is RoutingSubject.ACCOUNT and stated(
        "account", "portfolio", "balance", "account ledger", "계좌", "잔고", "위탁"
    ):
        target_scope_present = True
    if subject is RoutingSubject.ACCOUNT and ownership is Ownership.OWNED:
        target_scope_present = True
    if subject is RoutingSubject.ACCOUNT and DataIntent.HOLDINGS in data_intents:
        target_scope_present = True
    if subject is RoutingSubject.ORDER and ownership is Ownership.OWNED:
        target_scope_present = True
    if (
        EntityKind.ELW in entity_kinds
        and RoutingResultShape.RANKING in result_shapes
        and DataIntent.RANKING in data_intents
    ):
        target_scope_present = True
    if market_wide_stock_screen:
        target_scope_present = True
    if (
        target_presence is TargetPresence.PRESENT
        and not set(entity_kinds).intersection(
            {
                EntityKind.ACCOUNT,
                EntityKind.ETF,
                EntityKind.ELW,
                EntityKind.GOLD,
                EntityKind.SECTOR_INDEX,
                EntityKind.ORDER,
                EntityKind.INVESTOR,
                EntityKind.BROKER,
                EntityKind.CONDITION,
            }
        )
    ):
        add(entity_kinds, EntityKind.STOCK)
        subject = RoutingSubject.INSTRUMENT
    if not target_scope_present and entity_kinds == [EntityKind.STOCK]:
        entity_kinds.clear()
        if subject is RoutingSubject.INSTRUMENT:
            subject = None
    if target_presence is TargetPresence.PRESENT and cardinality is EntityCardinality.UNKNOWN:
        cardinality = EntityCardinality.SINGLE
    delivery = (
        Delivery.STREAM
        if execution is ExecutionKind.WEBSOCKET
        or RoutingResultShape.STREAM in result_shapes
        else Delivery.SNAPSHOT
        if execution is ExecutionKind.QUERY
        else Delivery.UNSPECIFIED
    )
    aggregation = _aggregation_scope(tuple(result_shapes))
    range_kind = _range_kind(tuple(temporal_scopes))
    capabilities: list[CapabilityKind] = []
    if sector_collection:
        capabilities.append(CapabilityKind.SECTOR_INDEX_COLLECTION)
    if stated(
        "corporate capital",
        "capital stock",
        "fiscal month",
        "일반 회사 자본금",
        "자본금",
        "결산월",
    ):
        capabilities.append(CapabilityKind.EQUITY_CORPORATE_FUNDAMENTALS)
    if stated("per", "pbr", "eps", "주가수익비율", "주당순이익"):
        capabilities.append(CapabilityKind.EQUITY_VALUATION)
    capability_terms: tuple[tuple[CapabilityKind, tuple[str, ...]], ...] = (
        (
            CapabilityKind.IDENTITY_CAPITAL,
            ("face value", "capital stock", "listed shares", "액면가", "자본금", "상장주식"),
        ),
        (
            CapabilityKind.STOCK_INFORMATION,
            (
                "stock information by code",
                "instrument information by code",
                "종목코드로 종목정보",
                "종목 코드로 종목 정보",
            ),
        ),
        (
            CapabilityKind.VOLATILITY_INDICATOR,
            ("volatility interruption", "vi 발동", "변동성 완화"),
        ),
        (
            CapabilityKind.INVESTOR_FLOW,
            (
                "foreign and institutional",
                "institutional and foreign",
                "외국인과 기관",
                "기관과 외국인",
            ),
        ),
        (
            CapabilityKind.INSTRUMENT_INVESTOR_CHART,
            (
                "instrument investor chart",
                "stock investor chart",
                "종목별 투자자 기관별 차트",
                "종목의 investor 기관별 chart",
            ),
        ),
        (CapabilityKind.PROGRAM_FLOW, ("program trading", "프로그램 매매", "프로그램 거래")),
        (
            CapabilityKind.PRICE_RANGE_52W,
            (
                "52-week",
                "52 week",
                "annual high",
                "annual low",
                "250-day",
                "250 day",
                "52주",
                "250일",
                "연중 최고",
                "연중 최저",
            ),
        ),
        (
            CapabilityKind.DAILY_HISTORY,
            ("by trading day", "each trading day", "dated", "일자별", "거래일별"),
        ),
        (CapabilityKind.CONSTITUENTS, ("constituents", "sector members", "구성 종목")),
        (
            CapabilityKind.ACCOUNT_CURRENCY,
            (
                "by currency",
                "currency breakdown",
                "foreign currency",
                "통화별",
                "외화 예수금",
            ),
        ),
        (
            CapabilityKind.ACCOUNT_RECEIVABLE,
            ("receivable", "unpaid", "overdue", "미수금", "미납금", "연체"),
        ),
        (
            CapabilityKind.ACCOUNT_IDENTITY,
            ("account name", "branch information", "account identifier", "계좌명", "지점 정보"),
        ),
        (
            CapabilityKind.ACCOUNT_ASSETS,
            ("estimated assets", "asset value", "예탁자산", "자산가치"),
        ),
        (
            CapabilityKind.ACCOUNT_CASH_MARGIN,
            ("cash margin", "collateral amount", "현금증거금", "담보금액"),
        ),
        (
            CapabilityKind.ACCOUNT_SETTLEMENT_FORECAST,
            ("settlement forecast", "projected d+1", "projected d+2", "결제 예상"),
        ),
        (
            CapabilityKind.ACCOUNT_WITHDRAWAL_CAPACITY,
            (
                "withdrawable",
                "withdrawal capacity",
                "withdraw 가능한",
                "출금 가능",
                "주문 가능 현금",
            ),
        ),
        (
            CapabilityKind.ACCOUNT_HOLDINGS,
            ("every holding", "each holding", "holding details", "보유 종목 내역"),
        ),
        (
            CapabilityKind.ACCOUNT_TODAY_REUSE,
            (
                "today reusable amount",
                "today's reusable amount",
                "same-day reusable amount",
                "금일 재사용 금액",
                "오늘 재사용 금액",
            ),
        ),
        (CapabilityKind.ETF_NAV, ("nav", "순자산가치")),
        (
            CapabilityKind.ETF_INFORMATION,
            ("fund information", "etf information", "운용사", "과세 조건"),
        ),
        (
            CapabilityKind.ETF_FLOW,
            ("investor flow", "supply and demand", "수급", "투자자별"),
        ),
        (
            CapabilityKind.ELW_PAYOFF,
            (
                "final payoff",
                "payoff formula",
                "confirmed payoff",
                "barrier condition",
                "knock-out barrier",
                "knock out barrier",
                "ko barrier",
                "payoff terms",
                "최종 결제",
                "지급액 산식",
                "배리어 조건",
                "권리 행사",
            ),
        ),
        (
            CapabilityKind.ELW_LIQUIDITY_LEVERAGE,
            (
                "parity",
                "gearing",
                "lp holding ratio",
                "lp holdings ratio",
                "패리티",
                "기어링",
                "lp 보유비율",
            ),
        ),
        (
            CapabilityKind.ELW_UNDERLYING_BASKET,
            (
                "underlying assets",
                "composition ratio",
                "underlying basket",
                "기초자산 구성",
                "구성 비율",
            ),
        ),
        (
            CapabilityKind.ELW_VALUATION_RIGHTS,
            (
                "exercise price",
                "conversion ratio",
                "right type",
                "행사가격",
                "전환비율",
                "권리 유형",
            ),
        ),
        (
            CapabilityKind.ELW_PROXIMITY,
            ("exercise threshold", "how close", "proximity", "행사가 근접"),
        ),
        (
            CapabilityKind.GOLD_ORDERBOOK,
            ("order-book", "order book", "bid and ask", "매수·매도 호가", "호가와 잔량"),
        ),
        (
            CapabilityKind.GOLD_DAILY,
            ("gold daily", "gold by trading day", "금 현물의 일자별", "금 일자별"),
        ),
        (
            CapabilityKind.EQUITY_MULTIPLES,
            ("per", "pbr", "eps", "book value per share", "주당순자산"),
        ),
        (
            CapabilityKind.EQUITY_FINANCIAL_PERFORMANCE,
            ("sales", "operating profit", "net income", "매출액", "영업이익", "당기순이익"),
        ),
        (
            CapabilityKind.ELW_LIQUIDITY_PROVIDERS,
            (
                "liquidity provider",
                "liquidity-provider",
                "lp 회원",
                "유동성을 공급",
                "유동성 공급 회원사",
            ),
        ),
        (
            CapabilityKind.ELW_EVALUATION_WINDOW,
            (
                "evaluation interval",
                "evaluation window",
                "evaluation start",
                "evaluation end",
                "평가기간",
            ),
        ),
        (
            CapabilityKind.ELW_EVALUATION_EXTREMA,
            ("evaluation extrema", "평가기간의 전체", "후반장 고가", "후반장 저가"),
        ),
        (
            CapabilityKind.ELW_KEY_DATES,
            (
                "final trading day",
                "expiry date",
                "expiration date",
                "exercise date",
                "payment date",
                "최종거래일",
                "만기일",
                "권리행사일",
                "지급일",
            ),
        ),
        (
            CapabilityKind.ORDER_UNFILLED,
            (
                "unfilled order",
                "unfilled orders",
                "미체결",
                "미체결 주문",
                "체결되지 않은 주문",
            ),
        ),
        (
            CapabilityKind.ORDER_FILLED,
            (
                "filled order",
                "filled orders",
                "recent executions",
                "executions with trade price",
                "체결된 주문",
                "체결 주문",
                "이미 체결된 주문",
                "체결 상세",
            ),
        ),
        (
            CapabilityKind.COMBINED_ORDER_STATUS,
            (
                "order identifiers and execution status",
                "order and execution status",
                "order numbers",
                "주문 체결 현황",
                "주문체결 현황",
                "주문과 체결 현황",
            ),
        ),
        (
            CapabilityKind.ELW_THEORETICAL_VALUE,
            ("theoretical value", "theoretical price", "이론가"),
        ),
        (
            CapabilityKind.CONDITION_LIST,
            ("condition list", "saved conditions", "조건검색 목록", "조건 목록"),
        ),
        (
            CapabilityKind.CONDITION_REALTIME,
            ("realtime monitoring", "realtime condition", "실시간 조건", "조건 실시간"),
        ),
        (
            CapabilityKind.EXPECTED_TRADE,
            (
                "expected trade",
                "expected fill",
                "expected match",
                "expected execution",
                "before matching",
                "예상체결",
                "예상 체결",
            ),
        ),
    )
    for capability, terms in capability_terms:
        if stated(*terms):
            add(capabilities, capability)
    # "미체결 주문"은 부분 문자열로 "체결 주문"을 품는다. 질문의 모든 '체결'이 부정
    # 접두 '미' 뒤에 있으면 체결된 주문 근거가 아니다 — 그대로 두면 미체결 조회가
    # 체결 조회와 상충해 기권한다(실측: sealed-order-gold-cancel-status-ko).
    fill_matches = tuple(re.finditer("체결", normalized))
    if (
        CapabilityKind.ORDER_FILLED in capabilities
        and fill_matches  # 한국어 '체결'이 하나도 없으면 이 규칙은 관여하지 않는다.
        and all(
            match.start() >= 1 and normalized[match.start() - 1] == "미"
            for match in fill_matches
        )
    ):
        discard(capabilities, CapabilityKind.ORDER_FILLED)
    if evaluation_window and stated(
        "highest price", "lowest price", "high and low", "최고가", "최저가"
    ):
        add(capabilities, CapabilityKind.ELW_EVALUATION_EXTREMA)
    if stated("체결된") and stated("주문"):
        add(capabilities, CapabilityKind.ORDER_FILLED)
    if (
        CapabilityKind.ORDER_FILLED in capabilities
        and subject is RoutingSubject.INSTRUMENT
        and Measure.PRICE in measures
        and Measure.VOLUME in measures
    ):
        add(data_intents, DataIntent.MARKET_EXECUTIONS)
    if (
        subject is RoutingSubject.PARTICIPANT
        and EntityKind.STOCK in entity_kinds
        and stated("by stock", "by instrument", "종목별")
        and not stated("chart", "차트", "ranking", "rank", "순위", "상위")
    ):
        add(data_intents, DataIntent.PARTICIPANT_BREAKDOWN)
    if subject is RoutingSubject.ACCOUNT:
        if CapabilityKind.ORDER_UNFILLED in capabilities:
            add(data_intents, DataIntent.OPEN_ORDERS)
        if CapabilityKind.ORDER_FILLED in capabilities:
            add(data_intents, DataIntent.FILLED_ORDERS)
        if CapabilityKind.ACCOUNT_CURRENCY in capabilities:
            add(data_intents, DataIntent.FOREIGN_CURRENCY_BALANCE)
        if (
            CapabilityKind.COMBINED_ORDER_STATUS in capabilities
            or {
                CapabilityKind.ORDER_UNFILLED,
                CapabilityKind.ORDER_FILLED,
            }.issubset(capabilities)
        ):
            add(data_intents, DataIntent.COMBINED_ORDER_STATUS)
            target_scope_present = True
        if purchase_settlement:
            add(capabilities, CapabilityKind.ACCOUNT_PURCHASE_SETTLEMENT)
    if (
        subject is RoutingSubject.PARTICIPANT
        and EntityKind.INVESTOR in entity_kinds
        and Measure.FLOW in measures
    ):
        add(capabilities, CapabilityKind.INVESTOR_FLOW)
    if gold_execution_trend:
        add(capabilities, CapabilityKind.ORDER_FILLED)
    if CapabilityKind.ACCOUNT_TODAY_REUSE in capabilities:
        subject = RoutingSubject.ACCOUNT
        add(entity_kinds, EntityKind.ACCOUNT)
        execution = ExecutionKind.QUERY
        add(data_intents, DataIntent.SNAPSHOT)
        add(measures, Measure.VALUATION, Measure.BALANCE, Measure.ORDER_STATUS, Measure.CREDIT)
        add(result_shapes, RoutingResultShape.RECORD)
        target_scope_present = True
    if (
        EntityKind.SECTOR_INDEX in entity_kinds
        and DataIntent.HISTORY in data_intents
        and TemporalScope.DAILY in temporal_scopes
        and DataIntent.CHART not in data_intents
    ):
        add(data_intents, DataIntent.PRICE_HISTORY)
        add(temporal_scopes, TemporalScope.RANGE)
        add(measures, Measure.PRICE)
        add(result_shapes, RoutingResultShape.TIME_SERIES)
        add(capabilities, CapabilityKind.DAILY_HISTORY)
    if per_extrema:
        discard(capabilities, CapabilityKind.EQUITY_MULTIPLES)
    if CapabilityKind.ELW_EVALUATION_EXTREMA in capabilities:
        discard(capabilities, CapabilityKind.ELW_EVALUATION_WINDOW)
    if CapabilityKind.ELW_PROXIMITY in capabilities:
        discard(capabilities, CapabilityKind.ELW_VALUATION_RIGHTS)
    if not lp_members:
        discard(capabilities, CapabilityKind.ELW_LIQUIDITY_PROVIDERS)
    if DataIntent.MARKET_SCALE in data_intents:
        discard(capabilities, CapabilityKind.IDENTITY_CAPITAL)
    if execution is not ExecutionKind.WEBSOCKET:
        discard(capabilities, CapabilityKind.ELW_THEORETICAL_VALUE)
    if execution is ExecutionKind.ORDER:
        discard(
            capabilities,
            CapabilityKind.ORDER_UNFILLED,
            CapabilityKind.ORDER_FILLED,
            CapabilityKind.COMBINED_ORDER_STATUS,
        )
    if (
        CapabilityKind.ORDER_UNFILLED in capabilities
        and CapabilityKind.COMBINED_ORDER_STATUS not in capabilities
        and not stated("already filled", "filled and unfilled", "이미 체결된")
    ):
        discard(
            capabilities,
            CapabilityKind.ORDER_FILLED,
            CapabilityKind.COMBINED_ORDER_STATUS,
        )
    if account_assets_summary:
        add(capabilities, CapabilityKind.ACCOUNT_ASSETS)
    if (
        EntityKind.GOLD in entity_kinds
        and stated("today", "오늘")
        and set(temporal_scopes).intersection({TemporalScope.TICK, TemporalScope.MINUTE})
    ):
        add(capabilities, CapabilityKind.GOLD_TODAY_INTRADAY)
    capability_products = {
        CapabilityKind.VOLATILITY_INDICATOR: {EntityKind.STOCK},
        CapabilityKind.STOCK_INFORMATION: {EntityKind.STOCK},
        CapabilityKind.INVESTOR_FLOW: {EntityKind.STOCK},
        CapabilityKind.INSTRUMENT_INVESTOR_CHART: {EntityKind.STOCK},
        CapabilityKind.PROGRAM_FLOW: {EntityKind.STOCK, EntityKind.SECTOR_INDEX},
        CapabilityKind.PRICE_RANGE_52W: {EntityKind.STOCK, EntityKind.SECTOR_INDEX},
        CapabilityKind.CONSTITUENTS: {EntityKind.SECTOR_INDEX},
        CapabilityKind.SECTOR_INDEX_COLLECTION: {EntityKind.SECTOR_INDEX},
        CapabilityKind.ACCOUNT_CURRENCY: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_RECEIVABLE: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_IDENTITY: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_ASSETS: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_CASH_MARGIN: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_SETTLEMENT_FORECAST: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_WITHDRAWAL_CAPACITY: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_HOLDINGS: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_TODAY_REUSE: {EntityKind.ACCOUNT},
        CapabilityKind.ACCOUNT_PURCHASE_SETTLEMENT: {EntityKind.ACCOUNT},
        CapabilityKind.ETF_NAV: {EntityKind.ETF},
        CapabilityKind.ETF_INFORMATION: {EntityKind.ETF},
        CapabilityKind.ETF_FLOW: {EntityKind.ETF},
        CapabilityKind.ELW_PAYOFF: {EntityKind.ELW},
        CapabilityKind.ELW_LIQUIDITY_LEVERAGE: {EntityKind.ELW},
        CapabilityKind.ELW_UNDERLYING_BASKET: {EntityKind.ELW},
        CapabilityKind.ELW_VALUATION_RIGHTS: {EntityKind.ELW},
        CapabilityKind.ELW_PROXIMITY: {EntityKind.ELW},
        CapabilityKind.GOLD_ORDERBOOK: {EntityKind.GOLD},
        CapabilityKind.GOLD_DAILY: {EntityKind.GOLD},
        CapabilityKind.EQUITY_MULTIPLES: {EntityKind.STOCK},
        CapabilityKind.EQUITY_FINANCIAL_PERFORMANCE: {EntityKind.STOCK},
        CapabilityKind.ELW_LIQUIDITY_PROVIDERS: {EntityKind.ELW},
        CapabilityKind.ELW_EVALUATION_WINDOW: {EntityKind.ELW},
        CapabilityKind.ELW_EVALUATION_EXTREMA: {EntityKind.ELW},
        CapabilityKind.ELW_KEY_DATES: {EntityKind.ELW},
        CapabilityKind.ELW_THEORETICAL_VALUE: {EntityKind.ELW},
        CapabilityKind.GOLD_TODAY_INTRADAY: {EntityKind.GOLD},
    }
    observed_entities = set(entity_kinds)
    capabilities = [
        capability
        for capability in capabilities
        if capability not in capability_products
        or bool(observed_entities.intersection(capability_products[capability]))
    ]
    if {
        CapabilityKind.ORDER_UNFILLED,
        CapabilityKind.ORDER_FILLED,
    }.issubset(capabilities):
        add(capabilities, CapabilityKind.COMBINED_ORDER_STATUS)
    if EntityKind.CONDITION in entity_kinds and execution is ExecutionKind.WEBSOCKET:
        if CapabilityKind.CONDITION_LIST not in capabilities:
            if TemporalScope.REALTIME in temporal_scopes:
                add(capabilities, CapabilityKind.CONDITION_REALTIME)
            else:
                add(capabilities, CapabilityKind.CONDITION_GENERAL)

    financing: list[FinancingKind] = []
    if execution is ExecutionKind.ORDER and action is not None:
        financing.append(
            FinancingKind.CREDIT
            if stated("credit", "margin credit", "신용")
            else FinancingKind.CASH
        )

    feeds: list[FeedKind] = []
    if execution is ExecutionKind.WEBSOCKET:
        if EntityKind.CONDITION in entity_kinds:
            feeds.append(FeedKind.CONDITION)
        elif stated("expected trade", "expected fill", "expected match", "예상체결", "예상 체결"):
            feeds.append(FeedKind.EXPECTED_TRADE)
        elif EntityKind.ELW in entity_kinds and stated(
            "theoretical value", "theoretical price", "이론가"
        ):
            feeds.append(FeedKind.ELW_THEORETICAL_VALUE)
        elif EntityKind.ELW in entity_kinds and stated(
            "indicator", "indicators", "metric", "metrics", "민감도"
        ):
            feeds.append(FeedKind.ELW_METRICS)
        elif EntityKind.SECTOR_INDEX in entity_kinds:
            feeds.append(
                FeedKind.SECTOR_INDEX
                if stated("sector index", "업종 index", "업종 지수")
                else FeedKind.SECTOR_INDUSTRY
            )
        elif stated("order-book", "order book", "depth", "호가"):
            feeds.append(FeedKind.ORDERBOOK)
        elif stated("trade", "trades", "execution", "fill", "체결"):
            feeds.append(FeedKind.TRADE)
        if EntityKind.STOCK in entity_kinds:
            if stated("priority quote", "priority orderbook", "우선호가", "우선 호가"):
                add(feeds, FeedKind.ORDERBOOK, FeedKind.PRIORITY_ORDERBOOK)
            elif stated(
                "after-hours quote",
                "after-hours orderbook",
                "after hours quote",
                "시간외호가",
                "시간외 호가",
            ):
                add(feeds, FeedKind.ORDERBOOK, FeedKind.AFTER_HOURS_ORDERBOOK)
            elif stated(
                "order-book depth",
                "order book depth",
                "full orderbook",
                "호가잔량",
                "호가 잔량",
            ):
                add(feeds, FeedKind.ORDERBOOK, FeedKind.FULL_ORDERBOOK_DEPTH)
    primitives = [
        (EvidenceAxis.SPEECH_ACT, speech),
        (EvidenceAxis.OWNERSHIP, ownership),
        (EvidenceAxis.ENTITY_CARDINALITY, cardinality),
        (EvidenceAxis.TARGET_PRESENCE, target_presence),
        (
            EvidenceAxis.TARGET_SCOPE,
            TargetPresence.PRESENT
            if target_scope_present
            else TargetPresence.UNKNOWN,
        ),
        (EvidenceAxis.DELIVERY, delivery),
        (EvidenceAxis.AGGREGATION_SCOPE, aggregation),
        (EvidenceAxis.RANGE_KIND, range_kind),
    ]
    if action is not None:
        primitives.insert(1, (EvidenceAxis.ACTION_KIND, action))
    return QueryAnalysis(
        speech_act=speech,
        action_kind=action,
        ownership=ownership,
        entity_cardinality=cardinality,
        target_presence=target_presence,
        target_scope_present=target_scope_present,
        delivery=delivery,
        aggregation_scope=aggregation,
        range_kind=range_kind,
        capabilities=tuple(capabilities),
        financing=tuple(financing),
        feeds=tuple(feeds),
        subject=subject,
        entity_kinds=tuple(
            sorted(dict.fromkeys(entity_kinds), key=lambda item: item.value)
        ),
        execution=execution,
        data_intents=tuple(dict.fromkeys(data_intents)),
        temporal_scopes=tuple(dict.fromkeys(temporal_scopes)),
        measures=tuple(dict.fromkeys(measures)),
        result_shapes=tuple(dict.fromkeys(result_shapes)),
        bindings=tuple(dict.fromkeys(bindings)),
        atoms=(
            *(EvidenceAtom(axis, value.value) for axis, value in primitives),
            *(
                EvidenceAtom(EvidenceAxis.CAPABILITY, capability.value)
                for capability in capabilities
            ),
            *(EvidenceAtom(EvidenceAxis.FINANCING, item.value) for item in financing),
            *(EvidenceAtom(EvidenceAxis.FEED, item.value) for item in feeds),
        ),
        relations=tuple(
            relation
            for relation in (
                EvidenceRelation(
                    EvidenceAxis.SPEECH_ACT,
                    RelationKind.GOVERNS,
                    EvidenceAxis.ACTION_KIND,
                )
                if action is not None
                else None,
                EvidenceRelation(
                    EvidenceAxis.RANGE_KIND,
                    RelationKind.QUALIFIES,
                    EvidenceAxis.AGGREGATION_SCOPE,
                )
                if range_kind is not RangeKind.UNSPECIFIED
                else None,
                EvidenceRelation(
                    EvidenceAxis.DELIVERY,
                    RelationKind.QUALIFIES,
                    EvidenceAxis.ACTION_KIND,
                )
                if delivery is Delivery.STREAM
                else None,
            )
            if relation is not None
        ),
    )
