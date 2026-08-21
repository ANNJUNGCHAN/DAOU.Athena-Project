"""Strict routing metadata contract derived for every selector operation."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any

ROUTING_CONTRACT_VERSION = "selector-routing-v5"
ROUTING_SOURCE_VERSION = 2
QUERY_FRAME_VERSION = "query-frame-v7"


class RoutingSubject(StrEnum):
    INSTRUMENT = "instrument"
    SECTOR = "sector"
    MARKET = "market"
    ACCOUNT = "account"
    ORDER = "order"
    PARTICIPANT = "participant"
    COLLECTION = "collection"
    AUTHENTICATION = "authentication"


class EntityKind(StrEnum):
    STOCK = "stock"
    ETF = "etf"
    ELW = "elw"
    GOLD = "gold"
    SECTOR_INDEX = "sector_index"
    ACCOUNT = "account"
    ORDER = "order"
    INVESTOR = "investor"
    BROKER = "broker"
    THEME = "theme"
    WATCHLIST = "watchlist"
    CONDITION = "condition"
    MARKET = "market"


class ExecutionKind(StrEnum):
    QUERY = "query"
    ORDER = "order"
    WEBSOCKET = "websocket"
    OAUTH = "oauth"


class ActionKind(StrEnum):
    BUY = "buy"
    SELL = "sell"
    AMEND = "amend"
    CANCEL = "cancel"
    SUBSCRIBE = "subscribe"
    UNSUBSCRIBE = "unsubscribe"


class FinancingKind(StrEnum):
    CASH = "cash"
    CREDIT = "credit"


class CapabilityKind(StrEnum):
    EQUITY_CORPORATE_FUNDAMENTALS = "equity_corporate_fundamentals"
    EQUITY_VALUATION = "equity_valuation"
    IDENTITY_CAPITAL = "identity_capital"
    STOCK_INFORMATION = "stock_information"
    VOLATILITY_INDICATOR = "volatility_indicator"
    INVESTOR_FLOW = "investor_flow"
    INSTRUMENT_INVESTOR_CHART = "instrument_investor_chart"
    PROGRAM_FLOW = "program_flow"
    PRICE_RANGE_52W = "price_range_52w"
    DAILY_HISTORY = "daily_history"
    CONSTITUENTS = "constituents"
    SECTOR_INDEX_COLLECTION = "sector_index_collection"
    ACCOUNT_CURRENCY = "account_currency"
    ACCOUNT_RECEIVABLE = "account_receivable"
    ACCOUNT_IDENTITY = "account_identity"
    ACCOUNT_ASSETS = "account_assets"
    ACCOUNT_TODAY_REUSE = "account_today_reuse"
    ETF_NAV = "etf_nav"
    ETF_INFORMATION = "etf_information"
    ETF_FLOW = "etf_flow"
    ELW_PAYOFF = "elw_payoff"
    ELW_LIQUIDITY_LEVERAGE = "elw_liquidity_leverage"
    ELW_PROXIMITY = "elw_proximity"
    GOLD_ORDERBOOK = "gold_orderbook"
    GOLD_DAILY = "gold_daily"
    EQUITY_MULTIPLES = "equity_multiples"
    EQUITY_FINANCIAL_PERFORMANCE = "equity_financial_performance"
    ELW_LIQUIDITY_PROVIDERS = "elw_liquidity_providers"
    ELW_EVALUATION_WINDOW = "elw_evaluation_window"
    ELW_EVALUATION_EXTREMA = "elw_evaluation_extrema"
    ORDER_UNFILLED = "order_unfilled"
    ORDER_FILLED = "order_filled"
    COMBINED_ORDER_STATUS = "combined_order_status"
    ELW_THEORETICAL_VALUE = "elw_theoretical_value"
    CONDITION_LIST = "condition_list"
    CONDITION_GENERAL = "condition_general"
    CONDITION_REALTIME = "condition_realtime"
    EXPECTED_TRADE = "expected_trade"
    GOLD_TODAY_INTRADAY = "gold_today_intraday"
    ELW_KEY_DATES = "elw_key_dates"


class FeedKind(StrEnum):
    TRADE = "trade"
    ORDERBOOK = "orderbook"
    ELW_METRICS = "elw_metrics"
    SECTOR_INDEX = "sector_index"
    SECTOR_INDUSTRY = "sector_industry"
    CONDITION = "condition"
    EXPECTED_TRADE = "expected_trade"
    ELW_THEORETICAL_VALUE = "elw_theoretical_value"
    PRIORITY_ORDERBOOK = "priority_orderbook"
    AFTER_HOURS_ORDERBOOK = "after_hours_orderbook"
    FULL_ORDERBOOK_DEPTH = "full_orderbook_depth"


class DataIntent(StrEnum):
    IDENTITY = "identity"
    SNAPSHOT = "snapshot"
    CURRENT_QUOTE = "current_quote"
    EXPECTED_QUOTE = "expected_quote"
    EXPECTED_MARKET_STATE = "expected_market_state"
    HISTORY = "history"
    PRICE_HISTORY = "price_history"
    CHART = "chart"
    PRICE_RANGE = "price_range"
    MARKET_SCALE = "market_scale"
    RANKING = "ranking"
    VOLUME_RANKING = "volume_ranking"
    ORDERBOOK_RANKING = "orderbook_ranking"
    SPIKE_RANKING = "spike_ranking"
    TOP_RANKING = "top_ranking"
    SCREENING = "screening"
    ACCOUNT_STATE = "account_state"
    PORTFOLIO = "portfolio"
    HOLDINGS = "holdings"
    PERFORMANCE = "performance"
    VALUATION_GAP = "valuation_gap"
    ORDER_ACTION = "order_action"
    ORDER_AMEND = "order_amend"
    ORDER_CANCEL = "order_cancel"
    SUBSCRIPTION = "subscription"
    UNSUBSCRIPTION = "unsubscription"
    AUTHENTICATION = "authentication"


class TemporalScope(StrEnum):
    UNSPECIFIED = "unspecified"
    CURRENT = "current"
    REALTIME = "realtime"
    INTRADAY = "intraday"
    TICK = "tick"
    MINUTE = "minute"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    ANNUAL = "annual"
    RANGE = "range"


class Measure(StrEnum):
    IDENTITY = "identity"
    PRICE = "price"
    CHANGE = "change"
    VOLUME = "volume"
    TRADE_VALUE = "trade_value"
    ORDERBOOK = "orderbook"
    TRADE = "trade"
    VALUATION = "valuation"
    FUNDAMENTALS = "fundamentals"
    FINANCIALS = "financials"
    OWNERSHIP = "ownership"
    FLOW = "flow"
    BALANCE = "balance"
    PNL = "pnl"
    POSITION = "position"
    ORDER_STATUS = "order_status"
    CREDIT = "credit"
    SHORT_SALE = "short_sale"
    LENDING = "lending"
    PROGRAM_TRADING = "program_trading"
    VOLATILITY = "volatility"
    NAV = "nav"
    SENSITIVITY = "sensitivity"
    MARKET_STATUS = "market_status"
    GENERIC = "generic"


class RoutingResultShape(StrEnum):
    RECORD = "record"
    COLLECTION = "collection"
    TIME_SERIES = "time_series"
    RANKING = "ranking"
    STREAM = "stream"
    ACKNOWLEDGEMENT = "acknowledgement"
    COMPOUND = "compound"


class BindingRole(StrEnum):
    INSTRUMENT_CODE = "instrument_code"
    SECTOR_CODE = "sector_code"
    MARKET_CODE = "market_code"
    ACCOUNT_CONTEXT = "account_context"
    DATE = "date"
    DATE_RANGE = "date_range"
    INTERVAL = "interval"
    PERIOD = "period"
    SIDE = "side"
    PRICE = "price"
    QUANTITY = "quantity"
    ORDER_ID = "order_id"
    CONDITION_ID = "condition_id"
    WATCHLIST_ID = "watchlist_id"
    PARTICIPANT = "participant"
    SUBSCRIPTION_ITEMS = "subscription_items"
    SUBSCRIPTION_GROUP = "subscription_group"


def _ordered_unique(values: Iterable[Any]) -> tuple[Any, ...]:
    return tuple(dict.fromkeys(values))


@dataclass(frozen=True, slots=True)
class OperationRouting:
    subject: RoutingSubject
    entity_kinds: tuple[EntityKind, ...]
    execution: ExecutionKind
    data_intents: tuple[DataIntent, ...]
    temporal_scopes: tuple[TemporalScope, ...]
    measures: tuple[Measure, ...]
    result_shapes: tuple[RoutingResultShape, ...]
    bindings: tuple[BindingRole, ...]
    actions: tuple[ActionKind, ...] = ()
    financing: tuple[FinancingKind, ...] = ()
    capabilities: tuple[CapabilityKind, ...] = ()
    feeds: tuple[FeedKind, ...] = ()

    def __post_init__(self) -> None:
        for field_name in (
            "entity_kinds",
            "data_intents",
            "temporal_scopes",
            "measures",
            "result_shapes",
        ):
            values = getattr(self, field_name)
            if not values or values != _ordered_unique(values):
                raise ValueError(f"{field_name} must be a non-empty ordered set")
        if self.bindings != _ordered_unique(self.bindings):
            raise ValueError("bindings must be an ordered set")
        for field_name in ("actions", "financing", "capabilities", "feeds"):
            values = getattr(self, field_name)
            if values != _ordered_unique(values):
                raise ValueError(f"{field_name} must be an ordered set")

    def canonical(self) -> dict[str, Any]:
        return {
            "subject": self.subject.value,
            "entity_kinds": [item.value for item in self.entity_kinds],
            "execution": self.execution.value,
            "data_intents": [item.value for item in self.data_intents],
            "temporal_scopes": [item.value for item in self.temporal_scopes],
            "measures": [item.value for item in self.measures],
            "result_shapes": [item.value for item in self.result_shapes],
            "bindings": [item.value for item in self.bindings],
            "actions": [item.value for item in self.actions],
            "financing": [item.value for item in self.financing],
            "capabilities": [item.value for item in self.capabilities],
            "feeds": [item.value for item in self.feeds],
        }


def _contains(text: str, *needles: str) -> bool:
    lowered = text.casefold()
    compact = "".join(lowered.split())
    return any(
        needle.casefold() in lowered
        or "".join(needle.casefold().split()) in compact
        for needle in needles
    )


def _field_aliases(fields: Iterable[Mapping[str, Any]]) -> tuple[str, ...]:
    aliases: list[str] = []
    for field in fields:
        raw = str(field.get("element", "")).strip()
        if not raw:
            continue
        # Inventory rows flatten nested LIST records as ``- child`` and
        # ``- - grandchild``.  Strip every structural prefix: the alias is
        # still a contract field and must participate in measure/binding
        # derivation regardless of its nesting depth.
        while raw.startswith("-"):
            raw = raw[1:].lstrip()
        if raw:
            aliases.append(raw)
        korean = str(field.get("kor", "")).strip()
        if korean:
            aliases.append(korean)
    return _ordered_unique(aliases)


def _nested_response_shape(
    fields: Iterable[Mapping[str, Any]],
    declared_shape: str,
) -> str:
    """Promote flattened repeated rows to a collection/compound shape.

    The generated output profile is authoritative for ordinary responses, but
    small or synthetic inventories can under-report a nested LIST.  A LIST is
    structural evidence, so retain the declared shape except where it would
    incorrectly claim a scalar-only record.
    """
    rows = tuple(fields)
    has_list = any(str(field.get("type", "")).upper() == "LIST" for field in rows)
    if not has_list or declared_shape in {"pure_list", "compound"}:
        return declared_shape
    has_scalar_siblings = any(
        str(field.get("element", "")).startswith("-")
        for field in rows
        if str(field.get("type", "")).upper() != "LIST"
    )
    return "compound" if has_scalar_siblings else "pure_list"


def _subject(kind: str, subcategory: str, name: str) -> RoutingSubject:
    if kind == "oauth":
        return RoutingSubject.AUTHENTICATION
    if kind == "order":
        return RoutingSubject.ORDER
    if kind == "websocket" and _contains(name, "주문체결", "order fill"):
        return RoutingSubject.ORDER
    if kind == "websocket" and _contains(name, "잔고", "balance"):
        return RoutingSubject.ACCOUNT
    if subcategory == "계좌":
        return RoutingSubject.ACCOUNT
    if subcategory == "업종" or _contains(name, "업종"):
        return RoutingSubject.SECTOR
    if subcategory in {"관심종목", "테마"} or _contains(name, "조건검색"):
        return RoutingSubject.COLLECTION
    if _contains(name, "투자자", "기관", "외인", "외국인", "거래원", "증권사", "회원사"):
        return RoutingSubject.PARTICIPANT
    if _contains(name, "장시작", "시장상태", "전업종", "거래소"):
        return RoutingSubject.MARKET
    return RoutingSubject.INSTRUMENT


def _entities(subject: RoutingSubject, subcategory: str, name: str) -> tuple[EntityKind, ...]:
    if subject is RoutingSubject.AUTHENTICATION:
        return (EntityKind.ACCOUNT,)
    if subject is RoutingSubject.ACCOUNT:
        if _contains(name, "금현물", "gold spot"):
            return (EntityKind.ACCOUNT, EntityKind.GOLD)
        if _contains(name, "종목", "잔고"):
            return (EntityKind.ACCOUNT, EntityKind.STOCK)
        return (EntityKind.ACCOUNT,)
    if subject is RoutingSubject.ORDER:
        product = (
            EntityKind.GOLD
            if _contains(name, "금현물", "국제금", "gold spot")
            else EntityKind.STOCK
        )
        return (EntityKind.ORDER, EntityKind.ACCOUNT, product)
    if subject is RoutingSubject.SECTOR:
        return (EntityKind.SECTOR_INDEX,)
    if subject is RoutingSubject.MARKET:
        return (EntityKind.MARKET,)
    if subcategory == "ETF" or _contains(name, "ETF"):
        return (EntityKind.ETF,)
    if subcategory == "ELW" or _contains(name, "ELW"):
        return (EntityKind.ELW,)
    if _contains(name, "금현물", "국제금"):
        return (EntityKind.GOLD,)
    if subcategory == "테마":
        return (EntityKind.THEME, EntityKind.STOCK)
    if subcategory == "관심종목":
        return (EntityKind.WATCHLIST, EntityKind.STOCK)
    if _contains(name, "조건검색"):
        return (EntityKind.CONDITION, EntityKind.STOCK)
    if subject is RoutingSubject.PARTICIPANT:
        actor = (
            EntityKind.BROKER
            if _contains(name, "거래원", "증권사", "회원사")
            else EntityKind.INVESTOR
        )
        return (actor, EntityKind.STOCK)
    return (EntityKind.STOCK,)


def _data_intents(kind: str, subcategory: str, name: str) -> tuple[DataIntent, ...]:
    if kind == "oauth":
        return (DataIntent.AUTHENTICATION,)
    if kind == "order":
        values = [DataIntent.ORDER_ACTION]
        if _contains(name, "정정", "amend", "modify", "correct order"):
            values.append(DataIntent.ORDER_AMEND)
        if _contains(name, "취소", "cancel order"):
            values.append(DataIntent.ORDER_CANCEL)
        return tuple(values)
    if kind == "websocket":
        is_unregistration_control = _contains(
            name,
            "조건검색 실시간 해제",
            "실시간 등록 해제",
            "unregister",
            "unsubscribe control",
        )
        values = [
            DataIntent.UNSUBSCRIPTION if is_unregistration_control else DataIntent.SUBSCRIPTION
        ]
        if _contains(name, "조건검색", "condition"):
            values.append(DataIntent.SCREENING)
        if _contains(name, "주문체결", "order fill"):
            values.append(DataIntent.ORDER_ACTION)
        if _contains(name, "잔고", "balance"):
            values.append(DataIntent.ACCOUNT_STATE)
        if _contains(name, "예상체결", "예상 체결", "expected price"):
            values.append(DataIntent.EXPECTED_QUOTE)
        return tuple(values)
    if subcategory == "계좌":
        if _contains(name, "수익률", "수익율", "return performance", "performance"):
            values = [DataIntent.PERFORMANCE]
            if _contains(name, "일별", "기간", "daily", "history"):
                values.append(DataIntent.HISTORY)
            return tuple(values)
        if _contains(name, "거래 내역", "trade history", "transaction history"):
            return (DataIntent.HISTORY, DataIntent.ACCOUNT_STATE)
        if _contains(name, "체결잔고", "체결 잔고", "settled positions"):
            return (DataIntent.ACCOUNT_STATE,)
        if _contains(name, "보유", "잔고", "holding"):
            return (DataIntent.PORTFOLIO, DataIntent.HOLDINGS, DataIntent.ACCOUNT_STATE)
        if _contains(name, "평가", "잔고", "보유", "수익률", "자산"):
            return (DataIntent.PORTFOLIO, DataIntent.ACCOUNT_STATE)
        return (DataIntent.ACCOUNT_STATE,)
    if _contains(name, "괴리율", "premium discount gap", "valuation gap"):
        return (DataIntent.RANKING, DataIntent.VALUATION_GAP)
    if _contains(name, "수익률", "수익율", "return performance", "performance"):
        return (DataIntent.PERFORMANCE, DataIntent.SNAPSHOT)
    if _contains(name, "보유 종목", "holding valuation", "gold spot holdings"):
        return (DataIntent.PORTFOLIO, DataIntent.HOLDINGS)
    if _contains(name, "시장 규모", "시가총액", "유통 현황", "market scale"):
        return (DataIntent.MARKET_SCALE,)
    if _contains(name, "가격 범위", "price band", "price range") and not _contains(
        name,
        "예상체결",
        "예상 체결",
        "expected price",
        "expected quote",
    ):
        return (DataIntent.PRICE_RANGE,)
    if subcategory == "순위정보" or _contains(
        name,
        "순위",
        "상위",
        "하위",
        "급등락",
        "괴리율",
        "premium discount gap",
        "spike",
    ):
        values = [DataIntent.RANKING]
        if _contains(name, "거래량", "volume"):
            values.append(DataIntent.VOLUME_RANKING)
        if _contains(name, "호가", "잔량", "orderbook"):
            values.append(DataIntent.ORDERBOOK_RANKING)
        if _contains(name, "급증", "급등락", "spike", "surge"):
            values.append(DataIntent.SPIKE_RANKING)
        if _contains(name, "상위", "하위", "top", "bottom"):
            values.append(DataIntent.TOP_RANKING)
        return tuple(values)
    if _contains(name, "기본정보", "종목정보", "종목코드", "업종코드", "계좌번호", "identity"):
        return (DataIntent.IDENTITY,)
    if _contains(
        name,
        "예상체결",
        "예상 체결",
        "예상가",
        "동시호가",
        "expected market",
        "expected price",
        "expected quote",
        "expected_market",
    ):
        values = [DataIntent.EXPECTED_QUOTE]
        if _contains(name, "expected market", "expected_market"):
            values.append(DataIntent.EXPECTED_MARKET_STATE)
        if _contains(name, "가격 범위", "price band", "price range"):
            values.append(DataIntent.PRICE_RANGE)
        return tuple(values)
    if _contains(
        name,
        "차트",
        "틱조회",
        "분봉조회",
        "일봉조회",
        "주봉조회",
        "월봉조회",
        "년봉조회",
        "추이",
        "일별",
        "기간",
        "월별",
        "연별",
        "년별",
        "history",
    ):
        values = [DataIntent.HISTORY]
        if _contains(name, "주가", "현재가", "시세", "price history"):
            values.append(DataIntent.PRICE_HISTORY)
        if _contains(
            name,
            "차트",
            "틱조회",
            "분봉조회",
            "일봉조회",
            "주봉조회",
            "월봉조회",
            "년봉조회",
            "candle chart",
        ):
            values.append(DataIntent.CHART)
        return tuple(values)
    if _contains(
        name,
        "당일 시세",
        "session prices",
        "trading totals",
    ):
        return (DataIntent.SNAPSHOT,)
    if _contains(
        name,
        "현재가",
        "현재 시세",
        "시세정보",
        "current price",
        "current quote",
        "quote information",
    ):
        return (DataIntent.CURRENT_QUOTE,)
    if _contains(name, "검색", "조회순위", "리스트", "목록", "전체"):
        return (DataIntent.SCREENING,)
    if _contains(
        name,
        "portfolio",
        "보유 자산",
        "보유 종목",
        "계좌 평가",
        "account valuation",
        "holding valuation",
        "gold spot holdings",
    ):
        return (DataIntent.PORTFOLIO,)
    if _contains(name, "주문체결 현황", "order and execution status"):
        return (DataIntent.ACCOUNT_STATE,)
    return (DataIntent.SNAPSHOT,)


def _temporal(name: str, kind: str) -> tuple[TemporalScope, ...]:
    values: list[TemporalScope] = []
    if kind == "websocket" or _contains(name, "실시간", "realtime"):
        values.append(TemporalScope.REALTIME)
    if _contains(name, "현재", "당일", "오늘"):
        values.append(TemporalScope.CURRENT)
    if _contains(name, "틱"):
        values.append(TemporalScope.TICK)
    if _contains(name, "분봉"):
        values.append(TemporalScope.MINUTE)
    if _contains(name, "시간대", "장중", "시분", "intraday"):
        values.append(TemporalScope.INTRADAY)
    if _contains(name, "일봉", "일별", "일자별", "전일", "daily"):
        values.append(TemporalScope.DAILY)
    if _contains(name, "주봉", "주간", "weekly"):
        values.append(TemporalScope.WEEKLY)
    if _contains(name, "월봉", "월별", "monthly"):
        values.append(TemporalScope.MONTHLY)
    if _contains(name, "연중", "년", "연별", "annual", "yearly"):
        values.append(TemporalScope.ANNUAL)
    if _contains(name, "기간", "범위", "추이", "차트", "range"):
        values.append(TemporalScope.RANGE)
    return _ordered_unique(values) or (TemporalScope.UNSPECIFIED,)


_MEASURE_TERMS: tuple[tuple[Measure, tuple[str, ...]], ...] = (
    (Measure.IDENTITY, ("기본정보", "종목정보", "종목명", "계좌번호")),
    (Measure.PRICE, ("가격", "현재가", "주가", "시세", "호가", "체결", "등락")),
    (Measure.CHANGE, ("등락", "전일대비", "수익율", "수익률")),
    (Measure.VOLUME, ("거래량", "체결량")),
    (Measure.TRADE_VALUE, ("거래대금", "거래금액")),
    (Measure.ORDERBOOK, ("호가", "잔량")),
    (Measure.TRADE, ("체결", "매매")),
    (Measure.VALUATION, ("PER", "PBR", "평가", "valuation", "고저PER")),
    (
        Measure.FUNDAMENTALS,
        ("기본정보", "자본", "주식수", "시장 규모", "시가총액", "상장주식"),
    ),
    (Measure.FINANCIALS, ("재무", "실적", "매출", "영업이익")),
    (Measure.OWNERSHIP, ("보유", "소유", "지분", "한도", "유통 현황", "유통주식")),
    (Measure.FLOW, ("수급", "순매수", "매매동향", "투자자", "기관", "외인", "거래원")),
    (Measure.BALANCE, ("잔고", "예수금")),
    (Measure.PNL, ("손익", "수익률", "수익율")),
    (Measure.POSITION, ("보유", "포지션")),
    (Measure.ORDER_STATUS, ("주문", "미체결", "체결조회")),
    (Measure.CREDIT, ("신용", "융자")),
    (Measure.SHORT_SALE, ("공매도",)),
    (Measure.LENDING, ("대차",)),
    (Measure.PROGRAM_TRADING, ("프로그램매매", "프로그램 매매")),
    (Measure.VOLATILITY, ("변동성", "VI", "급등", "급락")),
    (Measure.NAV, ("NAV",)),
    (Measure.SENSITIVITY, ("민감도", "이론가", "괴리율")),
    (Measure.MARKET_STATUS, ("장시작", "시장상태")),
)


def _measures(text: str, aliases: Iterable[str]) -> tuple[Measure, ...]:
    haystack = f"{text} {' '.join(aliases)}"
    found = [measure for measure, terms in _MEASURE_TERMS if _contains(haystack, *terms)]
    return _ordered_unique(found) or (Measure.GENERIC,)


def _result_shapes(
    kind: str,
    subcategory: str,
    name: str,
    shape: str,
) -> tuple[RoutingResultShape, ...]:
    if kind in {"order", "oauth"}:
        return (RoutingResultShape.ACKNOWLEDGEMENT,)
    if kind == "websocket" and _contains(name, "목록조회", "list inquiry"):
        return (RoutingResultShape.COLLECTION, RoutingResultShape.STREAM)
    if kind == "websocket":
        return (RoutingResultShape.STREAM,)
    if subcategory == "순위정보" or _contains(
        name,
        "순위",
        "상위",
        "하위",
        "급등락",
        "괴리율",
        "premium discount gap",
        "spike",
    ):
        return (RoutingResultShape.RANKING,)
    if _contains(
        name,
        "차트",
        "추이",
        "일별",
        "시간대별",
        "틱조회",
        "분봉조회",
        "일봉조회",
        "주봉조회",
        "월봉조회",
        "년봉조회",
    ):
        return (RoutingResultShape.TIME_SERIES,)
    return {
        "pure_list": (RoutingResultShape.COLLECTION,),
        "scalar_only": (RoutingResultShape.RECORD,),
        "compound": (RoutingResultShape.COMPOUND,),
    }[shape]


_BINDING_ALIASES: tuple[tuple[BindingRole, frozenset[str]], ...] = (
    (BindingRole.INSTRUMENT_CODE, frozenset({"stk_cd", "code", "item"})),
    (BindingRole.SECTOR_CODE, frozenset({"inds_cd", "sector_code"})),
    (BindingRole.MARKET_CODE, frozenset({"mrkt_tp", "dmst_stex_tp", "market"})),
    (BindingRole.DATE, frozenset({"base_dt", "qry_dt", "dt", "date"})),
    (BindingRole.DATE_RANGE, frozenset({"strt_dt", "end_dt", "from_dt", "to_dt"})),
    (BindingRole.INTERVAL, frozenset({"tic_scope", "tm_unit", "interval"})),
    (BindingRole.PERIOD, frozenset({"qry_tp", "dt_div", "period"})),
    (BindingRole.SIDE, frozenset({"trde_tp", "buy_sell_tp", "ordr_tp"})),
    (BindingRole.PRICE, frozenset({"ord_uv", "price"})),
    (BindingRole.QUANTITY, frozenset({"ord_qty", "qty", "quantity"})),
    (BindingRole.ORDER_ID, frozenset({"orig_ord_no", "ord_no", "order_id"})),
    (BindingRole.CONDITION_ID, frozenset({"seq", "condition_id"})),
    (BindingRole.WATCHLIST_ID, frozenset({"gcod", "grp_no", "watchlist_id"})),
    (BindingRole.PARTICIPANT, frozenset({"orgn_tp", "trde_ori", "investor_tp"})),
    (BindingRole.SUBSCRIPTION_ITEMS, frozenset({"data", "items", "subscription_items"})),
)


def _bindings(
    kind: str,
    subject: RoutingSubject,
    aliases: Iterable[str],
) -> tuple[BindingRole, ...]:
    alias_set = set(aliases)
    found = [role for role, names in _BINDING_ALIASES if alias_set & names]
    # ``grp_no`` is a websocket registration group, not a watchlist group.
    # Keep the two concepts distinct so an account/watchlist query cannot be
    # treated as an exact match for a realtime subscription contract.
    if kind == "websocket" and BindingRole.WATCHLIST_ID in found:
        found.remove(BindingRole.WATCHLIST_ID)
        found.append(BindingRole.SUBSCRIPTION_GROUP)
    if subject in {RoutingSubject.ACCOUNT, RoutingSubject.ORDER}:
        found.insert(0, BindingRole.ACCOUNT_CONTEXT)
    if kind == "websocket" and BindingRole.SUBSCRIPTION_ITEMS not in found:
        found.append(BindingRole.SUBSCRIPTION_ITEMS)
    return _ordered_unique(found)


def _profile_axes(
    kind: str,
    name: str,
    subcategory: str,
    entity_kinds: tuple[EntityKind, ...],
    aliases: Iterable[str],
) -> tuple[
    tuple[ActionKind, ...],
    tuple[FinancingKind, ...],
    tuple[CapabilityKind, ...],
    tuple[FeedKind, ...],
]:
    actions: list[ActionKind] = []
    if kind == "order":
        if _contains(name, "매수", "buy"):
            actions.append(ActionKind.BUY)
        if _contains(name, "매도", "sell"):
            actions.append(ActionKind.SELL)
        if _contains(name, "정정", "amend"):
            actions.append(ActionKind.AMEND)
        if _contains(name, "취소", "cancel"):
            actions.append(ActionKind.CANCEL)
    if kind == "websocket":
        actions.append(
            ActionKind.UNSUBSCRIBE
            if _contains(name, "해제", "unregister", "unsubscribe")
            else ActionKind.SUBSCRIBE
        )
    financing = []
    if _contains(name, "신용", "융자", "credit"):
        financing.append(FinancingKind.CREDIT)
    elif kind == "order" or _contains(name, "예수금", "현금", "cash"):
        financing.append(FinancingKind.CASH)
    capabilities: list[CapabilityKind] = []
    if EntityKind.STOCK in entity_kinds:
        if _contains(name, "기본정보", "자본금", "재무", "fundamental"):
            capabilities.append(CapabilityKind.EQUITY_CORPORATE_FUNDAMENTALS)
        if _contains(name, "PER", "PBR", "valuation", "평가"):
            capabilities.append(CapabilityKind.EQUITY_VALUATION)
        if _contains(name, "52주", "52-week"):
            capabilities.append(CapabilityKind.PRICE_RANGE_52W)
        if _contains(name, "일별", "일봉", "daily"):
            capabilities.append(CapabilityKind.DAILY_HISTORY)
        if _contains(name, "투자자", "기관", "외인", "investor"):
            capabilities.append(CapabilityKind.INVESTOR_FLOW)
        if _contains(name, "프로그램", "program"):
            capabilities.append(CapabilityKind.PROGRAM_FLOW)
    if EntityKind.ETF in entity_kinds:
        if _contains(name, "NAV"):
            capabilities.append(CapabilityKind.ETF_NAV)
        if _contains(name, "ETF", "정보"):
            capabilities.append(CapabilityKind.ETF_INFORMATION)
    if EntityKind.ELW in entity_kinds:
        if _contains(name, "이론가", "payoff"):
            capabilities.append(CapabilityKind.ELW_PAYOFF)
        if _contains(name, "괴리", "근접", "proximity"):
            capabilities.append(CapabilityKind.ELW_PROXIMITY)
        if _contains(name, "LP", "회원사", "liquidity provider"):
            capabilities.append(CapabilityKind.ELW_LIQUIDITY_PROVIDERS)
        if _contains(name, "평가 구간", "evaluation window"):
            capabilities.append(CapabilityKind.ELW_EVALUATION_WINDOW)
        if _contains(name, "극값", "extrema"):
            capabilities.append(CapabilityKind.ELW_EVALUATION_EXTREMA)
    if _contains(name, "이론가", "theoretical value"):
        capabilities.append(CapabilityKind.ELW_THEORETICAL_VALUE)
    if _contains(name, "조건검색 목록", "condition list"):
        capabilities.append(CapabilityKind.CONDITION_LIST)
    elif _contains(name, "조건검색 실시간", "condition realtime"):
        capabilities.append(CapabilityKind.CONDITION_REALTIME)
    elif _contains(name, "조건검색", "condition"):
        capabilities.append(CapabilityKind.CONDITION_GENERAL)
    if _contains(name, "미체결", "unfilled"):
        capabilities.append(CapabilityKind.ORDER_UNFILLED)
    if _contains(name, "체결", "filled") and not _contains(name, "미체결"):
        capabilities.append(CapabilityKind.ORDER_FILLED)
    if _contains(name, "주문체결현황", "order and execution status"):
        capabilities.append(CapabilityKind.COMBINED_ORDER_STATUS)
    if _contains(name, "예상체결", "expected execution"):
        capabilities.append(CapabilityKind.EXPECTED_TRADE)
    if EntityKind.GOLD in entity_kinds:
        if _contains(name, "호가", "orderbook"):
            capabilities.append(CapabilityKind.GOLD_ORDERBOOK)
        if _contains(name, "일별", "daily"):
            capabilities.append(CapabilityKind.GOLD_DAILY)
    feeds: list[FeedKind] = []
    if kind == "websocket":
        if _contains(name, "체결", "trade"):
            feeds.append(FeedKind.TRADE)
        if _contains(name, "호가", "orderbook"):
            feeds.append(FeedKind.ORDERBOOK)
            if _contains(name, "우선", "priority"):
                feeds.append(FeedKind.PRIORITY_ORDERBOOK)
            if _contains(name, "시간외", "after hours"):
                feeds.append(FeedKind.AFTER_HOURS_ORDERBOOK)
            if _contains(name, "잔량", "depth"):
                feeds.append(FeedKind.FULL_ORDERBOOK_DEPTH)
        if _contains(name, "ELW"):
            feeds.append(FeedKind.ELW_METRICS)
        if _contains(name, "업종지수", "sector index"):
            feeds.append(FeedKind.SECTOR_INDEX)
        elif _contains(name, "업종", "industry", "sector"):
            feeds.append(FeedKind.SECTOR_INDUSTRY)
        if _contains(name, "조건검색", "condition"):
            feeds.append(FeedKind.CONDITION)
    return (
        _ordered_unique(actions),
        _ordered_unique(financing),
        _ordered_unique(capabilities),
        _ordered_unique(feeds),
    )


def derive_base_routing(operation: Mapping[str, Any], *, shape: str) -> OperationRouting:
    """Derive a base contract without reading overview, descriptions, or examples."""
    kind = str(operation["kind"])
    subcategory = str(operation["subcat"])
    name = str(operation["name"])
    request_aliases = _field_aliases(operation.get("req_body", ()))
    response_aliases = _field_aliases(operation.get("resp_body", ()))
    subject = _subject(kind, subcategory, name)
    bindings = _bindings(kind, subject, request_aliases)
    entity_kinds = _entities(subject, subcategory, name)
    if (
        subject is RoutingSubject.ACCOUNT
        and BindingRole.INSTRUMENT_CODE in bindings
        and EntityKind.STOCK not in entity_kinds
        and not set(entity_kinds).intersection(
            {EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD}
        )
    ):
        entity_kinds = (*entity_kinds, EntityKind.STOCK)
    data_intents = _data_intents(kind, subcategory, name)
    if (
        data_intents == (DataIntent.SNAPSHOT,)
        and "cur_prc" in response_aliases
        and _contains(name, "시세", "현재", "price", "quote")
    ):
        data_intents = (DataIntent.CURRENT_QUOTE,)
    derived_shape = _nested_response_shape(operation.get("resp_body", ()), shape)
    actions, financing, capabilities, feeds = _profile_axes(
        kind, name, subcategory, entity_kinds, response_aliases
    )
    temporal_scopes = list(_temporal(name, kind))
    if (
        BindingRole.DATE_RANGE in bindings
        and temporal_scopes == [TemporalScope.UNSPECIFIED]
    ):
        temporal_scopes = [TemporalScope.RANGE]
    return OperationRouting(
        subject=subject,
        entity_kinds=entity_kinds,
        execution=ExecutionKind(kind),
        data_intents=data_intents,
        temporal_scopes=_ordered_unique(temporal_scopes),
        measures=_measures(name, response_aliases),
        result_shapes=_result_shapes(kind, subcategory, name, derived_shape),
        bindings=bindings,
        actions=actions,
        financing=financing,
        capabilities=capabilities,
        feeds=feeds,
    )


def refine_detail_routing(
    base: OperationRouting,
    group: Mapping[str, Any],
) -> OperationRouting:
    title = " ".join(str(group.get(key) or "") for key in ("title_ko", "title_en", "id"))
    fields = tuple(str(field) for field in group["fields"])
    data_intents = _data_intents("query", "", title)
    if base.subject is RoutingSubject.ACCOUNT and data_intents == (DataIntent.SNAPSHOT,):
        if _contains(title, "예수금", "현금", "cash"):
            data_intents = (DataIntent.ACCOUNT_STATE,)
        elif _contains(title, "평가", "보유", "잔고", "portfolio", "holding"):
            data_intents = (DataIntent.PORTFOLIO, DataIntent.ACCOUNT_STATE)
    if data_intents == (DataIntent.SNAPSHOT,) and "cur_prc" in fields:
        data_intents = (DataIntent.CURRENT_QUOTE,)
    child_temporal = _temporal(title, "query")
    temporal = (
        base.temporal_scopes
        if child_temporal == (TemporalScope.UNSPECIFIED,)
        else child_temporal
    )
    child_measures = _measures(title, fields)
    measures = base.measures if child_measures == (Measure.GENERIC,) else child_measures
    _, financing, capabilities, feeds = _profile_axes(
        "query", title, "", base.entity_kinds, fields
    )
    layout = str(group.get("layout") or "facts")
    if _contains(title, "순위", "상위", "하위"):
        result_shapes = (RoutingResultShape.RANKING,)
    elif DataIntent.HISTORY in data_intents or DataIntent.PRICE_HISTORY in data_intents:
        result_shapes = (RoutingResultShape.TIME_SERIES,)
    elif layout == "table":
        result_shapes = (RoutingResultShape.COLLECTION,)
    elif layout == "compound":
        result_shapes = (RoutingResultShape.COMPOUND,)
    else:
        result_shapes = (RoutingResultShape.RECORD,)
    return replace(
        base,
        data_intents=data_intents,
        temporal_scopes=temporal,
        measures=measures,
        result_shapes=result_shapes,
        financing=financing,
        capabilities=capabilities,
        feeds=feeds,
    )


def union_split_routing(
    base: OperationRouting,
    children: Iterable[OperationRouting],
) -> OperationRouting:
    child_list = tuple(children)
    if not child_list:
        raise ValueError("split routing requires at least one detail child")
    if any(
        child.subject != base.subject
        or child.entity_kinds != base.entity_kinds
        or child.execution != base.execution
        or child.bindings != base.bindings
        for child in child_list
    ):
        raise ValueError("detail identity/execution/bindings drifted from its base")
    return replace(
        base,
        data_intents=_ordered_unique(item for child in child_list for item in child.data_intents),
        temporal_scopes=_ordered_unique(
            item for child in child_list for item in child.temporal_scopes
        ),
        measures=_ordered_unique(item for child in child_list for item in child.measures),
        result_shapes=_ordered_unique(item for child in child_list for item in child.result_shapes),
    )


_OVERRIDABLE_AXES: Mapping[str, type[StrEnum]] = {
    "data_intents": DataIntent,
    "temporal_scopes": TemporalScope,
    "measures": Measure,
    "bindings": BindingRole,
    "actions": ActionKind,
    "financing": FinancingKind,
    "capabilities": CapabilityKind,
    "feeds": FeedKind,
}


def apply_routing_override(
    routing: OperationRouting,
    override: Mapping[str, Any],
) -> OperationRouting:
    forbidden = set(override) - set(_OVERRIDABLE_AXES)
    if forbidden:
        raise ValueError(f"routing override changes protected or unknown axes: {sorted(forbidden)}")
    changes: dict[str, tuple[StrEnum, ...]] = {}
    for field_name, enum_type in _OVERRIDABLE_AXES.items():
        if field_name in override:
            raw_values = override[field_name]
            if not isinstance(raw_values, list) or not raw_values:
                raise ValueError(f"override {field_name} must be a non-empty list")
            changes[field_name] = tuple(enum_type(value) for value in raw_values)
    return replace(routing, **changes)


def build_routing_registry(
    operations: Iterable[Mapping[str, Any]],
    projections: Mapping[str, Any],
    output_profile: Mapping[str, Any],
    source: Mapping[str, Any],
) -> dict[str, OperationRouting]:
    """Run derive -> detail refine -> split union -> exact validated override."""
    if source.get("version") != ROUTING_SOURCE_VERSION:
        raise ValueError("selector routing source version mismatch")
    if source.get("contract_version") != ROUTING_CONTRACT_VERSION:
        raise ValueError("selector routing contract version mismatch")
    if source.get("query_frame_version") != QUERY_FRAME_VERSION:
        raise ValueError("selector QueryFrame version mismatch")
    shapes = {str(item["id"]): str(item["shape"]) for item in output_profile["operations"]}
    base_by_id = {
        str(operation["id"]): derive_base_routing(operation, shape=shapes[str(operation["id"])])
        for operation in operations
    }
    registry = {f"base:{tr_id}": routing for tr_id, routing in base_by_id.items()}
    children_by_tr: dict[str, list[OperationRouting]] = {}
    for projection in projections["projections"]:
        tr_id = str(projection["tr_id"])
        for group in projection["groups"]:
            operation_ref = f"detail:{tr_id}:{group['id']}"
            detail = refine_detail_routing(base_by_id[tr_id], group)
            registry[operation_ref] = detail
            children_by_tr.setdefault(tr_id, []).append(detail)
    for tr_id, children in children_by_tr.items():
        registry[f"base:{tr_id}"] = union_split_routing(base_by_id[tr_id], children)
    overrides = source.get("overrides")
    if not isinstance(overrides, dict):
        raise ValueError("selector routing overrides must be an object")
    unknown_refs = set(overrides) - set(registry)
    if unknown_refs:
        raise ValueError(
            f"selector routing overrides reference unknown operations: {sorted(unknown_refs)}"
        )
    for operation_ref, override in overrides.items():
        if not isinstance(override, dict):
            raise ValueError(f"routing override for {operation_ref} must be an object")
        registry[operation_ref] = apply_routing_override(registry[operation_ref], override)
    expected = 208 + sum(len(item["groups"]) for item in projections["projections"])
    if len(registry) != expected:
        raise ValueError(f"routing coverage mismatch: expected={expected}, actual={len(registry)}")
    return dict(sorted(registry.items()))
