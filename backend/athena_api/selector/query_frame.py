"""Deterministic one-way extraction of typed routing evidence from a question."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import TypeVar

from athena_api.routing_contract import (
    QUERY_FRAME_VERSION,
    BindingRole,
    DataIntent,
    EntityKind,
    ExecutionKind,
    Measure,
    RoutingResultShape,
    RoutingSubject,
    TemporalScope,
)

_EnumT = TypeVar("_EnumT", bound=StrEnum)

_ENTITY_MARKER_PATH = Path(__file__).resolve().parents[2] / "ref" / "selector-entity-markers.json"
_ENTITY_MARKER_SOURCE = json.loads(_ENTITY_MARKER_PATH.read_text(encoding="utf-8"))
if set(_ENTITY_MARKER_SOURCE) != {"version", "source", "markers"}:
    raise ValueError("selector entity marker source has unknown or missing keys")
ENTITY_MARKER_VERSION = str(_ENTITY_MARKER_SOURCE["version"])
if ENTITY_MARKER_VERSION != "selector-entity-markers-v1":
    raise ValueError("unsupported selector entity marker version")
ENTITY_MARKER_SHA256 = hashlib.sha256(_ENTITY_MARKER_PATH.read_bytes()).hexdigest()
_ENTITY_KIND_BY_MARKER_KEY = {"etf": EntityKind.ETF}
if set(_ENTITY_MARKER_SOURCE["markers"]) != set(_ENTITY_KIND_BY_MARKER_KEY):
    raise ValueError("selector entity marker taxonomy is incomplete or unknown")
for marker_key, marker_terms in _ENTITY_MARKER_SOURCE["markers"].items():
    if (
        not isinstance(marker_terms, list)
        or not marker_terms
        or any(not isinstance(term, str) or not term.strip() for term in marker_terms)
        or len(marker_terms) != len(set(marker_terms))
    ):
        raise ValueError(f"selector entity markers are invalid for {marker_key}")
_ENTITY_MARKERS = {
    _ENTITY_KIND_BY_MARKER_KEY[key]: tuple(str(term).casefold() for term in terms)
    for key, terms in _ENTITY_MARKER_SOURCE["markers"].items()
}


@dataclass(frozen=True, slots=True)
class QueryFrame:
    """Observed routing concepts only; argument values are intentionally absent."""

    subject: RoutingSubject | None = None
    entity_kinds: tuple[EntityKind, ...] = ()
    execution: ExecutionKind | None = None
    data_intents: tuple[DataIntent, ...] = ()
    temporal_scopes: tuple[TemporalScope, ...] = ()
    measures: tuple[Measure, ...] = ()
    result_shapes: tuple[RoutingResultShape, ...] = ()
    bindings: tuple[BindingRole, ...] = ()
    version: str = QUERY_FRAME_VERSION

    def canonical(self) -> dict[str, object]:
        return {
            "version": self.version,
            "subject": self.subject.value if self.subject is not None else None,
            "entity_kinds": [item.value for item in self.entity_kinds],
            "execution": self.execution.value if self.execution is not None else None,
            "data_intents": [item.value for item in self.data_intents],
            "temporal_scopes": [item.value for item in self.temporal_scopes],
            "measures": [item.value for item in self.measures],
            "result_shapes": [item.value for item in self.result_shapes],
            "bindings": [item.value for item in self.bindings],
        }


def _direct_match(question: str, phrase: str) -> bool:
    """Match authored phrases only; do not expand synonyms or synthesize n-grams."""
    if phrase.isascii() and phrase.replace("_", "").isalnum():
        return re.search(rf"(?<![0-9a-z_]){re.escape(phrase)}(?![0-9a-z_])", question) is not None
    # Korean particles and inflections attach on the right, so a right boundary would
    # reject valid authored compounds such as ``대차거래``.  The left edge must still be
    # a lexical boundary: without it, ``현대차`` spuriously emits the unrelated ``대차``
    # measure, just as ``공매도`` could emit the order action ``매도``.
    return re.search(rf"(?<![가-힣]){re.escape(phrase)}", question) is not None


def _extract(
    question: str,
    phrases: Mapping[_EnumT, tuple[str, ...]],
) -> tuple[_EnumT, ...]:
    return tuple(
        concept
        for concept, authored_phrases in phrases.items()
        if any(_direct_match(question, phrase) for phrase in authored_phrases)
    )


_ORDER_ACTION_PHRASES = (
    "매수주문",
    "매도주문",
    "정정주문",
    "취소주문",
    "정정해",
    "취소해",
    "매수해",
    "매도해",
    "주문해",
    "place order",
    "buy order",
    "sell order",
    "buy",
    "sell",
)


_SUBJECT_PHRASES: Mapping[RoutingSubject, tuple[str, ...]] = {
    RoutingSubject.AUTHENTICATION: ("인증", "접근토큰", "oauth"),
    RoutingSubject.ORDER: (*_ORDER_ACTION_PHRASES, "주문", "order"),
    RoutingSubject.ACCOUNT: (
        "계좌",
        "잔고",
        "위탁",
        "담보비율",
        "증거금",
        "account",
        "guarantee rate",
        "margin requirement",
    ),
    RoutingSubject.SECTOR: ("업종", "섹터", "sector", "sectors", "industry", "industries"),
    RoutingSubject.MARKET: ("시장", "장 상태", "market status", "stock market"),
    RoutingSubject.PARTICIPANT: (
        "투자자", "외국인", "기관", "거래원", "investor", "institutional", "foreign",
        "broker",
    ),
    RoutingSubject.COLLECTION: (
        "테마", "관심종목", "조건검색", "watchlist", "theme",
        "stock-search condition", "saved condition",
    ),
    RoutingSubject.INSTRUMENT: ("종목", "주식", "주가", "stock"),
}

_ENTITY_PHRASES: Mapping[EntityKind, tuple[str, ...]] = {
    EntityKind.STOCK: ("종목", "주식", "주가", "stock"),
    EntityKind.ETF: ("etf",),
    EntityKind.ELW: ("elw", "elws"),
    EntityKind.GOLD: (
        "금현물", "금 현물", "금 99.99", "미니금", "국제금", "spot gold", "spot-gold",
        "gold spot", "one-kilogram gold", "gold product", "gold"
    ),
    EntityKind.SECTOR_INDEX: (
        "업종",
        "업종지수",
        "sector",
        "sectors",
        "industry",
        "industries",
        "sector index",
        "industry index",
    ),
    EntityKind.ACCOUNT: ("계좌", "잔고", "위탁", "account"),
    EntityKind.ORDER: (*_ORDER_ACTION_PHRASES, "주문", "order"),
    EntityKind.INVESTOR: ("투자자", "외국인", "기관", "investor", "institutional", "foreign"),
    EntityKind.BROKER: ("거래원", "증권사", "창구", "broker"),
    EntityKind.THEME: ("테마", "theme"),
    EntityKind.WATCHLIST: ("관심종목", "watchlist"),
    EntityKind.CONDITION: ("조건검색", "조건식", "condition"),
    EntityKind.MARKET: ("시장", "장 상태", "market status", "stock market"),
}

_EXECUTION_PHRASES: Mapping[ExecutionKind, tuple[str, ...]] = {
    ExecutionKind.ORDER: (*_ORDER_ACTION_PHRASES, "주문", "order"),
    ExecutionKind.WEBSOCKET: (
        "실시간 구독",
        "실시간",
        "구독",
        "websocket",
        "stream",
        "live updates",
        "live feed",
        "keep streaming",
        "as they arrive",
        "as it occurs",
        "live monitoring",
        "때마다",
        "계속 전송",
        "바뀔 때마다",
        "계속 받아",
        "계속 보내",
    ),
    ExecutionKind.OAUTH: ("접근토큰", "oauth"),
    ExecutionKind.QUERY: ("조회", "알려줘", "보여줘", "query"),
}

_INTENT_PHRASES: Mapping[DataIntent, tuple[str, ...]] = {
    DataIntent.IDENTITY: (
        "기본정보", "종목정보", "업종코드", "식별", "identity", "instrument information",
        "instrument facts", "account name", "branch", "계좌번호", "settlement month",
        "capital stock", "listed shares", "target index", "tax type",
    ),
    DataIntent.SNAPSHOT: (
        "현재",
        "지금",
        "방금",
        "최신",
        "스냅샷",
        "latest",
        "right now",
        "snapshot",
    ),
    DataIntent.CURRENT_QUOTE: (
        "현재가",
        "체결가",
        "현재 지수",
        "주가",
        "current price",
        "current index",
        "stock price",
        "trading at",
    ),
    DataIntent.EXPECTED_QUOTE: (
        "예상체결가",
        "예상 체결가",
        "예상가",
        "동시호가 예상",
        "expected price",
        "expected quote",
        "expected opening match price",
    ),
    DataIntent.HISTORY: (
        "일별 주가",
        "날짜별",
        "과거",
        "추이",
        "trend",
        "price trend",
        "흐름",
        "차트",
        "이력",
        "거래 내역",
        "history",
        "trade history",
        "transaction history",
        "movement through",
        "움직",
        "trend",
    ),
    DataIntent.CHART: ("차트", "그려줘", "plot", "chart", "candle", "candles"),
    DataIntent.PRICE_RANGE: (
        "가격 범위",
        "price range",
        "price band",
        "52주 최고가",
        "52주 최저가",
        "250-day high",
        "250 day high",
        "annual high",
        "annual low",
        "52-week high",
        "52-week low",
        "limit-up",
        "limit-down",
    ),
    DataIntent.MARKET_SCALE: (
        "시가총액",
        "상장주식수",
        "유통주식",
        "market cap",
        "shares outstanding",
        "free float",
    ),
    DataIntent.RANKING: (
        "순위", "상위", "하위", "급등", "급락", "rank", "ranking", "movers",
        "high and low",
    ),
    DataIntent.SCREENING: (
        "검색", "조건별로", "조건에 맞는", "훑어", "스크리닝", "screening", "screen",
        "volatility interruption was triggered",
    ),
    DataIntent.ACCOUNT_STATE: (
        "계좌 상태",
        "예수금",
        "위탁",
        "account state",
        "cash settlement",
        "withdrawable",
        "open orders",
        "filled orders",
        "realized profit and loss",
        "foreign currency deposits",
        "receivables",
        "arrears",
        "order and execution status",
    ),
    DataIntent.PORTFOLIO: (
        "내 잔고",
        "잔고",
        "보유종목",
        "보유 중",
        "총평가금액",
        "총매입금액",
        "포트폴리오",
        "i hold",
        "my holdings",
        "total valuation",
        "purchase amount",
        "overall return",
        "portfolio",
        "estimated deposit assets",
    ),
    DataIntent.HOLDINGS: (
        "보유 중인 종목",
        "보유 종목",
        "gold spot holdings",
        "each stock i hold",
        "stock i hold",
        "holdings list",
        "every holding",
    ),
    DataIntent.PERFORMANCE: (
        "수익률",
        "수익율",
        "benchmark return",
        "daily return",
        "performance", "returns",
    ),
    DataIntent.VALUATION_GAP: (
        "괴리율",
        "premium or discount gap",
        "premium discount gap",
        "valuation gap",
    ),
    DataIntent.ORDER_ACTION: (*_ORDER_ACTION_PHRASES, "주문", "order action"),
    DataIntent.SUBSCRIPTION: (
        "구독",
        "실시간",
        "실시간 수신",
        "realtime",
        "stream",
        "subscribe",
        "live updates",
        "live feed",
        "live monitoring",
        "keep streaming",
        "as they arrive",
        "as it occurs",
        "때마다",
        "계속 전송",
        "바뀔 때마다",
        "계속 받아",
        "계속 보내",
        "subscription",
    ),
    DataIntent.UNSUBSCRIPTION: (
        "구독 해지",
        "구독 해제",
        "실시간 등록 해제",
        "조건검색 실시간 해제",
        "unsubscribe",
        "cancel subscription",
    ),
    DataIntent.AUTHENTICATION: ("인증", "접근토큰", "authentication"),
}

_TEMPORAL_PHRASES: Mapping[TemporalScope, tuple[str, ...]] = {
    TemporalScope.CURRENT: (
        "오늘",
        "현재",
        "지금",
        "방금",
        "최신",
        "current",
        "latest",
        "right now",
        "today's",
    ),
    TemporalScope.REALTIME: ("실시간", "realtime"),
    TemporalScope.INTRADAY: (
        "장중", "시간대별", "intraday", "time-by-time", "today's session",
        "within today's session",
    ),
    TemporalScope.TICK: ("틱", "tick chart"),
    TemporalScope.MINUTE: ("분봉", "minute chart", "minute candles"),
    TemporalScope.DAILY: (
        "날짜별",
        "거래일",
        "일별",
        "일봉",
        "어제",
        "daily",
        "by trading date",
    ),
    TemporalScope.WEEKLY: ("주별", "주봉", "weekly", "by week"),
    TemporalScope.MONTHLY: ("월별", "월봉", "monthly", "by month"),
    TemporalScope.ANNUAL: ("연간", "연중", "연봉", "년봉", "annual", "yearly"),
    TemporalScope.RANGE: (
        "기간",
        "부터",
        "사이",
        "chronological",
        "time-ordered",
        "range",
    ),
}

_MEASURE_PHRASES: Mapping[Measure, tuple[str, ...]] = {
    Measure.IDENTITY: (
        "종목명", "종목코드", "업종코드", "identity", "settlement month", "listed shares",
        "instrument information", "instrument facts", "underlying assets", "right type",
        "account name", "branch", "계좌번호", "target index", "tax type",
    ),
    Measure.PRICE: (
        "주가",
        "현재가",
        "체결가",
        "현재 지수",
        "가격",
        "시세",
        "종가",
        "얼마",
        "index level",
        "trading at",
        "시가",
        "고가",
        "저가",
        "price",
        "quote",
        "current index", "open", "high", "low", "limit-up", "limit-down",
    ),
    Measure.CHANGE: ("등락", "상승률", "전일대비", "percentage change", "change"),
    Measure.VOLUME: ("거래량", "volume"),
    Measure.TRADE_VALUE: ("거래대금", "trade value"),
    Measure.ORDERBOOK: (
        "호가", "잔량", "orderbook", "order-book", "order-book depth",
        "bid and ask", "bid", "ask",
    ),
    Measure.TRADE: ("체결", "trade", "execution", "executions", "filled orders"),
    Measure.VALUATION: (
        "per",
        "pbr",
        "평가",
        "총평가금액",
        "지급액",
        "valuation",
        "total valuation",
        "payoff",
    ),
    Measure.FUNDAMENTALS: (
        "자본",
        "주식수",
        "시가총액",
        "상장주식",
        "배리어",
        "fundamentals",
        "barrier",
    ),
    Measure.FINANCIALS: (
        "재무",
        "실적",
        "매출",
        "매출액",
        "영업이익",
        "당기순이익",
        "financials",
        "sales",
        "operating profit",
        "net income",
    ),
    Measure.OWNERSHIP: (
        "보유율",
        "보유비율",
        "지분",
        "유통주식",
        "liquidity-provider holdings",
        "holdings",
        "ownership",
        "외국인 소진율",
        "유통주식 비율",
    ),
    Measure.FLOW: (
        "수급", "순매수", "매매 현황", "매매 동향", "거래원", "창구", "flow",
        "net trading", "net purchases", "supply-demand",
    ),
    Measure.BALANCE: (
        "잔고", "예수금", "현금증거금", "담보금액", "d+1", "d+2",
        "cash settlement", "withdrawable", "주문 가능 현금", "총매입금액",
        "purchase amount", "balance",
        "estimated deposit assets", "추정예탁자산", "총자산", "deposits",
        "foreign currency", "미수금", "연체금액", "receivables", "arrears",
    ),
    Measure.PNL: (
        "손익",
        "수익률",
        "평가손익",
        "unrealized profit or loss",
        "overall return",
        "daily return",
        "realized profit and loss",
        "profit or loss",
        "pnl",
    ),
    Measure.POSITION: (
        "포지션", "보유종목", "보유 중", "every holding", "quantity",
        "purchase price", "i hold", "position", "positions",
    ),
    Measure.ORDER_STATUS: (
        "미체결", "체결된 국내주식 주문", "주문 상태", "open orders",
        "filled orders", "order status", "order and execution status",
    ),
    Measure.CREDIT: ("신용", "융자", "대출", "credit", "loan", "loans", "financing"),
    Measure.SHORT_SALE: ("공매도", "short sale"),
    Measure.LENDING: ("대차", "lending", "stock-lending"),
    Measure.PROGRAM_TRADING: ("프로그램매매", "program trading"),
    Measure.VOLATILITY: ("변동성", "vi", "volatility"),
    Measure.NAV: ("순자산가치", "nav"),
    Measure.SENSITIVITY: (
        "민감도",
        "이론가",
        "패리티",
        "기어링",
        "레버리지",
        "premium",
        "discount",
        "theoretical value",
        "gearing",
        "leverage",
        "sensitivity",
        "delta",
        "gamma",
        "theta",
        "vega",
    ),
    Measure.MARKET_STATUS: ("장 상태", "장시작", "market status"),
}

_SHAPE_PHRASES: Mapping[RoutingResultShape, tuple[str, ...]] = {
    RoutingResultShape.RECORD: ("한 건", "요약", "summary", "record"),
    RoutingResultShape.COLLECTION: (
        "목록",
        "리스트",
        "보유 중인 종목",
        "list each",
        "collection",
        "list",
        "members",
        "every holding",
        "all indexes",
        "전체 업종 지수",
        "stocks and current prices inside",
    ),
    RoutingResultShape.TIME_SERIES: (
        "날짜별",
        "시간대별",
        "추이",
        "trend",
        "price trend",
        "흐름",
        "차트",
        "시계열",
        "time series",
        "시간순",
        "candles",
        "through today's session",
        "time-by-time",
        "time-stamped",
        "by date",
    ),
    RoutingResultShape.RANKING: ("순위", "상위", "하위", "rank", "ranking"),
    RoutingResultShape.STREAM: (
        "스트림",
        "실시간 수신",
        "바뀔 때마다",
        "계속 받아",
        "계속 보내",
        "stream",
        "live feed",
        "as they arrive",
        "as it occurs",
    ),
    RoutingResultShape.ACKNOWLEDGEMENT: ("처리 결과", "접수 결과", "acknowledgement"),
    RoutingResultShape.COMPOUND: ("전체 정보", "compound"),
}

_BINDING_PHRASES: Mapping[BindingRole, tuple[str, ...]] = {
    BindingRole.INSTRUMENT_CODE: ("종목코드", "ticker"),
    BindingRole.SECTOR_CODE: ("업종코드", "sector code"),
    BindingRole.MARKET_CODE: ("시장구분", "거래소", "market code"),
    BindingRole.ACCOUNT_CONTEXT: ("내 계좌", "계좌", "account"),
    BindingRole.DATE: ("날짜", "기준일", "date", "trading date"),
    BindingRole.DATE_RANGE: ("기간", "부터", "date range", "requested period"),
    BindingRole.INTERVAL: ("분봉", "틱", "단위", "간격", "interval"),
    BindingRole.PERIOD: ("주기", "일봉", "주봉", "월봉", "년봉", "period"),
    BindingRole.SIDE: ("매수", "매도", "side"),
    BindingRole.PRICE: ("주문가격", "주문단가", "order price"),
    BindingRole.QUANTITY: ("수량", "quantity"),
    BindingRole.ORDER_ID: ("주문번호", "order id"),
    BindingRole.CONDITION_ID: ("조건식", "조건번호", "condition id"),
    BindingRole.WATCHLIST_ID: ("관심종목 그룹", "watchlist id"),
    BindingRole.PARTICIPANT: ("투자자구분", "거래원", "participant"),
    BindingRole.SUBSCRIPTION_ITEMS: ("구독 종목", "등록 종목", "subscription items"),
}


def _first(values: Iterable[_EnumT]) -> _EnumT | None:
    return next(iter(values), None)


def _is_existing_order_change(question: str) -> bool:
    return (
        any(_direct_match(question, term) for term in ("existing", "기존"))
        and _direct_match(question, "order")
        and any(
            _direct_match(question, term)
            for term in ("change", "modify", "amend", "변경", "정정")
        )
    )


def _subject_from_evidence(
    question: str,
    subjects: tuple[RoutingSubject, ...],
) -> RoutingSubject | None:
    if RoutingSubject.AUTHENTICATION in subjects:
        return RoutingSubject.AUTHENTICATION
    order_action = any(
        _direct_match(question, phrase) for phrase in _ORDER_ACTION_PHRASES
    ) or _is_existing_order_change(question)
    if order_action and RoutingSubject.ORDER in subjects:
        return RoutingSubject.ORDER
    account_state = any(
        phrase in question
        for phrase in (
            "잔고",
            "내역",
            "현황",
            "balance",
            "account fills",
            "account update",
        )
    )
    if account_state and RoutingSubject.ACCOUNT in subjects:
        return RoutingSubject.ACCOUNT
    return _first(subjects)


def _execution_from_evidence(
    question: str,
    executions: tuple[ExecutionKind, ...],
) -> ExecutionKind | None:
    """Prefer explicit control surfaces over generic order/query nouns."""
    if ExecutionKind.OAUTH in executions:
        return ExecutionKind.OAUTH
    if ExecutionKind.WEBSOCKET in executions:
        return ExecutionKind.WEBSOCKET
    existing_order_change = _is_existing_order_change(question)
    order_actions = (*_ORDER_ACTION_PHRASES, "매수", "매도", "주문 넣", "amend", "modify", "cancel")
    if ExecutionKind.ORDER in executions and any(
        _direct_match(question, term) for term in order_actions
    ) or (ExecutionKind.ORDER in executions and existing_order_change):
        return ExecutionKind.ORDER
    if ExecutionKind.QUERY in executions:
        return ExecutionKind.QUERY
    return None


_INSTRUMENT_ANCHOR_STOP_FRAGMENTS = (
    "알려",
    "보여",
    "조회",
    "얼마",
    "기준",
    "현재",
    "지금",
    "오늘",
    "일별",
    "분봉",
    "일봉",
    "주봉",
    "월봉",
    "년봉",
    "주가",
    "가격",
    "차트",
    "추이",
    "정보",
    "종목",
    "주식",
    "업종",
    "섹터",
    "시장",
    "계좌",
    "주문",
    "값",
    "얼마",
    "무엇",
    "뭐",
    "어떤",
    "어떻게",
    "확인",
    "간단",
    "실시간",
    "시세",
    "거래",
    "등락",
    "수익",
    "매매",
    "보유",
    "매수",
    "매도",
    "시장가",
    "바로",
    "현황",
    "내역",
    "흐름",
    "표",
    "되",
    "돼",
    "해줘",
)
_INSTRUMENT_ANCHOR_ENGLISH_STOP = frozenset(
    {
        "a",
        "an",
        "and",
        "candle",
        "chart",
        "current",
        "daily",
        "for",
        "history",
        "now",
        "buy",
        "please",
        "price",
        "show",
        "sell",
        "shares",
        "stock",
        "the",
        "trend",
    }
)

_SEMANTIC_ASCII_TOKENS = frozenset(
    token
    for phrase_map in (
        _SUBJECT_PHRASES,
        _ENTITY_PHRASES,
        _EXECUTION_PHRASES,
        _INTENT_PHRASES,
        _TEMPORAL_PHRASES,
        _MEASURE_PHRASES,
        _SHAPE_PHRASES,
        _BINDING_PHRASES,
    )
    for phrases in phrase_map.values()
    for phrase in phrases
    for token in re.findall(r"[a-z][a-z0-9_-]*", phrase.casefold())
).union(term for terms in _ENTITY_MARKERS.values() for term in terms)
_SEMANTIC_KOREAN_TOKENS = frozenset(
    token
    for phrase_map in (
        _SUBJECT_PHRASES,
        _ENTITY_PHRASES,
        _EXECUTION_PHRASES,
        _INTENT_PHRASES,
        _TEMPORAL_PHRASES,
        _MEASURE_PHRASES,
        _SHAPE_PHRASES,
        _BINDING_PHRASES,
    )
    for phrases in phrase_map.values()
    for phrase in phrases
    for token in re.findall(r"[가-힣]+", phrase)
).union(
    {
        "구성",
        "급증",
        "급등",
        "급락",
        "급등락",
        "일자별",
        "낮은",
        "높은",
        "보합",
        "상승",
        "속한",
        "하락",
    }
)
_KOREAN_GRAMMATICAL_SUFFIXES = frozenset(
    {
        "은",
        "는",
        "이",
        "가",
        "을",
        "를",
        "의",
        "에",
        "에서",
        "으로",
        "로",
        "와",
        "과",
        "도",
        "만",
        "별",
        "마다",
    }
)


def _preserve_korean_control(token: str) -> bool:
    return token in _SEMANTIC_KOREAN_TOKENS or any(
        token == f"{term}{suffix}"
        for term in _SEMANTIC_KOREAN_TOKENS
        for suffix in _KOREAN_GRAMMATICAL_SUFFIXES
    )
_ENTITY_MASK_CONTROL_TOKENS = frozenset(
    {
        "begin",
        "break",
        "compare",
        "find",
        "give",
        "keep",
        "list",
        "plot",
        "retrieve",
        "send",
        "show",
        "what",
    }
)

_ADVICE_MARKERS = (
    "좋은지",
    "합리적인지",
    "의견만",
    "조언",
    "조언만",
    "분석만",
    "장단점",
    "어떻게 생각",
    "do you think",
    "explain whether",
    "would be wise",
    "be appropriate",
    "pros and cons",
    "should i",
    "your opinion",
    "just analyze",
    "advice",
)
_ADVICE_ACTIONS = (
    *_ORDER_ACTION_PHRASES,
    "사는",
    "파는",
    "buy",
    "buying",
    "purchase",
    "purchasing",
    "sell",
    "selling",
    "cancel",
    "cancelling",
    "취소",
    "담는",
    "비중",
    "allocation",
    "allocate",
    "편입",
    "changing",
    "change",
    "amending",
    "amend",
)


def is_advice_request(question: str) -> bool:
    """Return whether an action is mentioned only as an opinion/analysis topic."""
    normalized = " ".join(question.casefold().split())
    return any(_direct_match(normalized, term) for term in _ADVICE_MARKERS) and any(
        _direct_match(normalized, term) for term in _ADVICE_ACTIONS
    )


def is_third_party_account_request(question: str) -> bool:
    """Return whether account ownership is explicitly someone else's or unknown."""
    normalized = " ".join(question.casefold().split())
    return any(
        _direct_match(normalized, phrase)
        for phrase in (
            "그 사람 계좌",
            "타인 계좌",
            "다른 사람 계좌",
            "다른 사람 명의",
            "타인 명의",
            "someone else's account",
            "another person's account",
            "belong to another person",
            "their account",
        )
    )


def is_multi_instrument_request(question: str) -> bool:
    """Detect a single-call request that explicitly names multiple instruments."""
    normalized = " ".join(question.casefold().split())
    codes = re.findall(r"(?<!\d)\d{6}(?!\d)", normalized)
    reviewed_markers = {
        marker
        for markers in _ENTITY_MARKERS.values()
        for marker in markers
        if _direct_match(normalized, marker)
    }
    named_count = len(codes) + len(reviewed_markers)
    # A reviewed marker list is deliberately not a full instrument master. Detect
    # two syntactically explicit product names around a conjunction without retaining
    # or classifying their values. The numeric suffix is common to fund/index names
    # and keeps ordinary prose such as "price and volume" out of this guard.
    opaque_named_pair = bool(
        re.search(
            r"\b[A-Z][A-Z0-9.&-]*\s+\d{2,4}\s+"
            r"(?:and|versus|vs)\s+"
            r"[A-Z][A-Z0-9.&-]*\s+\d{2,4}\b",
            question,
        )
    )
    conjunction = bool(re.search(r"\b(?:and|versus|vs)\b", normalized)) or any(
        term in normalized for term in ("와 ", "과 ", "대 ")
    )
    quantified_plural = bool(
        re.search(
            r"\b(?:two|2)\s+(?:(?:selected|domestic|different)\s+){0,3}"
            r"(?:etfs|stocks|instruments)\b",
            normalized,
        )
        or re.search(r"(?<![가-힣])두\s*(?:개|종목|상품)", normalized)
    )
    return (named_count >= 2 and conjunction) or opaque_named_pair or quantified_plural


def mask_opaque_instrument_spans(question: str) -> str:
    """Remove transient code/proper-name spans before semantic and lexical matching.

    The returned text contains no replacement value. Reviewed asset-class markers and
    authored finance vocabulary remain visible, while an issuer suffix such as
    ``Holdings`` cannot masquerade as an ownership request. Korean opaque names are
    protected by the authored left-boundary matcher and reviewed-fragment ranking path.
    """
    masked = re.sub(r"(?<!\d)\d{6}(?!\d)", " ", question)
    masked = re.sub(
        r"(?<![가-힣])([가-힣]{2,})(?=\s+(?:한\s*주|주식|종목|주가|매수|매도)[가-힣]*(?:\s|$))",
        lambda match: match.group(1) if _preserve_korean_control(match.group(1)) else " ",
        masked,
    )
    masked = re.sub(
        r"(?<![가-힣])([가-힣]{2,})(?=\s+(?:(?:오늘|지금|현재|방금)\s+)?"
        r"(?:주가|가격|시세|종목|주식)[가-힣]*(?:\s|$))",
        lambda match: match.group(1) if _preserve_korean_control(match.group(1)) else " ",
        masked,
    )
    masked = re.sub(
        r"(?<![A-Za-z0-9])(?:[A-Z][A-Za-z0-9.&-]*\s+)"
        r"[A-Z][A-Za-z0-9.&-]*(?:'s|')",
        lambda match: " ".join(
            token.rstrip("'s")
            for token in match.group(0).split()
            if token.rstrip("'s").casefold() in _SEMANTIC_ASCII_TOKENS
        ),
        masked,
    )

    # Mask only spans with entity-like syntax. Sentence-initial title casing is not
    # evidence of an issuer: masking every capitalized word destroys authored control
    # terms such as List, Break, What, Show, and period forms such as D+2.
    masked = re.sub(
        r"(?:(?<=for\s)|(?<=For\s))"
        r"(?:[A-Z][A-Za-z0-9.&-]*(?:\s+[A-Z][A-Za-z0-9.&-]*){0,2})",
        lambda match: " ".join(
            token
            for token in match.group(0).split()
            if token.casefold() in _SEMANTIC_ASCII_TOKENS
        ),
        masked,
    )
    # Multi-token proper names before an authored market concept are entity
    # syntax, not semantic evidence. Preserve only reviewed concept tokens.
    masked = re.sub(
        r"(?<![A-Za-z0-9])"
        r"(?:[A-Z][A-Za-z0-9.&-]*\s+){2,3}"
        r"(?=(?:stock|shares?|equity|annual|daily|weekly|monthly|intraday|"
        r"current|latest|price|performance|range)\b)",
        lambda match: (
            " ".join(
                token
                for token in match.group(0).split()
                if token.casefold() in _ENTITY_MASK_CONTROL_TOKENS
            )
            + " "
        ),
        masked,
    )
    return re.sub(
        r"(?<![A-Za-z0-9])[A-Z][A-Z0-9.&-]{1,}(?![A-Za-z0-9])",
        lambda match: match.group(0)
        if match.group(0).casefold() in _SEMANTIC_ASCII_TOKENS
        else " ",
        masked,
    )


def _has_instrument_anchor(
    question: str,
    frame_intents: tuple[DataIntent, ...],
    measures: tuple[Measure, ...],
) -> bool:
    """Detect an opaque stock name/code without retaining or matching its value."""
    financial_intents = {
        DataIntent.CURRENT_QUOTE,
        DataIntent.HISTORY,
        DataIntent.CHART,
        DataIntent.IDENTITY,
        DataIntent.PRICE_RANGE,
        DataIntent.MARKET_SCALE,
        DataIntent.RANKING,
    }
    stream_measures = {
        Measure.PRICE,
        Measure.CHANGE,
        Measure.VOLUME,
        Measure.TRADE_VALUE,
        Measure.ORDERBOOK,
        Measure.TRADE,
        Measure.NAV,
        Measure.MARKET_STATUS,
        Measure.FUNDAMENTALS,
        Measure.FINANCIALS,
        Measure.FLOW,
        Measure.VALUATION,
        Measure.VOLATILITY,
    }
    anchored_stream = DataIntent.SUBSCRIPTION in frame_intents and bool(
        stream_measures.intersection(measures)
    )
    instrument_snapshot_measures = {
        Measure.PRICE,
        Measure.VOLUME,
        Measure.TRADE,
        Measure.FUNDAMENTALS,
        Measure.FINANCIALS,
        Measure.VALUATION,
        Measure.VOLATILITY,
    }
    if (
        not financial_intents.intersection(frame_intents)
        and not anchored_stream
        and not instrument_snapshot_measures.intersection(measures)
    ):
        return False
    return _has_opaque_instrument_value(question)


def _has_opaque_instrument_value(question: str) -> bool:
    """Detect a transient name/code span without requiring a particular task intent."""
    if re.search(r"(?<!\d)\d{6}(?!\d)", question):
        return True
    for raw in re.findall(r"[A-Za-z][A-Za-z0-9.&-]*|[가-힣]{2,}", question):
        token = raw.casefold()
        if not raw.isascii():
            for suffix in ("에서", "으로", "에게", "의", "를", "을", "은", "는", "이", "가", "로"):
                if token.endswith(suffix) and len(token) > len(suffix):
                    token = token[: -len(suffix)]
                    break
        if raw.isascii():
            if token not in _INSTRUMENT_ANCHOR_ENGLISH_STOP and (
                raw.isupper() or raw[:1].isupper()
            ):
                return True
        elif not any(fragment in token for fragment in _INSTRUMENT_ANCHOR_STOP_FRAGMENTS):
            return True
    return False


def extract_query_frame(
    question: str,
    *,
    infer_opaque_entity: bool = True,
) -> QueryFrame:
    """Extract only authored direct evidence and never retain sensitive values."""
    normalized = " ".join(mask_opaque_instrument_spans(question).casefold().split())
    subjects = _extract(normalized, _SUBJECT_PHRASES)
    executions = _extract(normalized, _EXECUTION_PHRASES)
    execution = _execution_from_evidence(normalized, executions)
    data_intents = _extract(normalized, _INTENT_PHRASES)
    measures = _extract(normalized, _MEASURE_PHRASES)
    temporal_scopes = _extract(normalized, _TEMPORAL_PHRASES)
    result_shapes = _extract(normalized, _SHAPE_PHRASES)
    aggregate_portfolio = any(
        _direct_match(normalized, term)
        for term in (
            "총평가금액",
            "총매입금액",
            "total valuation",
            "purchase amount",
        )
    )
    if DataIntent.PORTFOLIO in data_intents and aggregate_portfolio:
        data_intents = tuple(
            item
            for item in data_intents
            if item not in {DataIntent.PERFORMANCE, DataIntent.SNAPSHOT}
        )
        if RoutingResultShape.RECORD not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.RECORD)
    if (
        re.search(r"(?<![0-9a-z])\d+\s*(?:-|\s)?minute\b", normalized)
        or re.search(
            r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|fifteen|thirty)"
            r"(?:-|\s)minute\b",
            normalized,
        )
        or re.search(r"(?<!\d)\d+\s*분(?:봉|\b)", normalized)
    ) and TemporalScope.MINUTE not in temporal_scopes:
        temporal_scopes = (*temporal_scopes, TemporalScope.MINUTE)
    if (
        re.search(r"(?<!\d)\d+\s*거래일", normalized)
        and TemporalScope.DAILY not in temporal_scopes
    ):
        temporal_scopes = (*temporal_scopes, TemporalScope.DAILY)
    explicit_chart_periods = {
        TemporalScope.TICK,
        TemporalScope.MINUTE,
        TemporalScope.WEEKLY,
        TemporalScope.MONTHLY,
        TemporalScope.ANNUAL,
    }
    if explicit_chart_periods.intersection(temporal_scopes) and any(
        _direct_match(normalized, term)
        for term in ("틱", "분봉", "주봉", "월봉", "연봉", "년봉", "candle", "chart", "흐름")
    ):
        if DataIntent.HISTORY not in data_intents:
            data_intents = (*data_intents, DataIntent.HISTORY)
        if DataIntent.CHART not in data_intents:
            data_intents = (*data_intents, DataIntent.CHART)
        if RoutingResultShape.TIME_SERIES not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.TIME_SERIES)
    current_markers = (
        "현재",
        "지금",
        "방금",
        "최신",
        "latest",
        "right now",
    )
    if (
        Measure.PRICE in measures
        and any(_direct_match(normalized, term) for term in current_markers)
        and DataIntent.CURRENT_QUOTE not in data_intents
    ):
        data_intents = (*data_intents, DataIntent.CURRENT_QUOTE)
    unsubscribe_action = any(
        _direct_match(normalized, term)
        for term in ("해지", "해제", "그만", "unsubscribe", "cancel", "stop")
    )
    subscription_context = any(
        _direct_match(normalized, term)
        for term in (
            "구독", "등록", "수신", "조건검색", "subscription",
            "subscribe", "condition", "monitoring",
        )
    )
    if (
        unsubscribe_action
        and subscription_context
        and DataIntent.UNSUBSCRIPTION not in data_intents
    ):
        data_intents = (*data_intents, DataIntent.UNSUBSCRIPTION)
    korean_price_band_terms = sum(
        _direct_match(normalized, term) for term in ("시가", "고가", "저가")
    )
    english_price_band_terms = sum(
        _direct_match(normalized, term) for term in ("open", "high", "low")
    )
    price_band_terms = max(korean_price_band_terms, english_price_band_terms)
    if price_band_terms >= 2 and DataIntent.PRICE_RANGE not in data_intents:
        data_intents = (*data_intents, DataIntent.PRICE_RANGE)
    if (
        price_band_terms >= 2
        and TemporalScope.CURRENT in temporal_scopes
        and TemporalScope.INTRADAY not in temporal_scopes
    ):
        temporal_scopes = tuple(
            scope for scope in temporal_scopes if scope is not TemporalScope.CURRENT
        ) + (TemporalScope.INTRADAY, TemporalScope.RANGE)
    if (
        any(_direct_match(normalized, term) for term in ("52-week high", "52-week low"))
        and DataIntent.PRICE_RANGE not in data_intents
    ):
        data_intents = (*data_intents, DataIntent.PRICE_RANGE)
        if TemporalScope.RANGE not in temporal_scopes:
            temporal_scopes = (*temporal_scopes, TemporalScope.RANGE)
    if _direct_match(normalized, "by date") and DataIntent.HISTORY not in data_intents:
        data_intents = (*data_intents, DataIntent.HISTORY)
        if RoutingResultShape.TIME_SERIES not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.TIME_SERIES)
    if Measure.VOLATILITY in measures and RoutingResultShape.COLLECTION in result_shapes:
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
    if (
        Measure.VALUATION in measures
        and any(_direct_match(normalized, term) for term in ("높은", "낮은", "high", "low"))
    ):
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
        if RoutingResultShape.COLLECTION not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.COLLECTION)
    breadth_terms = sum(
        _direct_match(normalized, term)
        for term in ("상승", "보합", "하락", "rising", "unchanged", "falling")
    )
    if breadth_terms >= 2:
        if Measure.CHANGE not in measures:
            measures = (*measures, Measure.CHANGE)
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
        if RoutingResultShape.RECORD not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.RECORD)
    if (
        DataIntent.ACCOUNT_STATE in data_intents
        and any(
            _direct_match(normalized, term)
            for term in ("d+1", "d+2", "settlement forecast")
        )
    ):
        if (
            DataIntent.IDENTITY not in data_intents
            and DataIntent.SNAPSHOT not in data_intents
        ):
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
    if DataIntent.UNSUBSCRIPTION in data_intents:
        data_intents = tuple(item for item in data_intents if item is not DataIntent.SUBSCRIPTION)
    if (
        DataIntent.SUBSCRIPTION in data_intents
        and any(
            _direct_match(normalized, term)
            for term in ("subscribe", "live", "monitoring", "때마다", "계속 전송")
        )
    ):
        execution = ExecutionKind.WEBSOCKET
    read_only_order_status = (
        Measure.ORDER_STATUS in measures
        and any(
            _direct_match(normalized, term)
            for term in ("확인", "있는지", "조회", "status", "whether")
        )
        and not any(
            _direct_match(normalized, term)
            for term in ("취소해", "취소해줘", "cancel it", "cancel the order")
        )
    )
    if read_only_order_status:
        execution = ExecutionKind.QUERY
        data_intents = tuple(
            item
            for item in data_intents
            if item
            not in {
                DataIntent.ORDER_ACTION,
                DataIntent.ORDER_AMEND,
                DataIntent.ORDER_CANCEL,
            }
        )
        if DataIntent.ACCOUNT_STATE not in data_intents:
            data_intents = (*data_intents, DataIntent.ACCOUNT_STATE)
    if (
        RoutingSubject.ACCOUNT in subjects
        and DataIntent.ORDER_ACTION in data_intents
        and any(term in normalized for term in ("내역", "현황", "status", "history"))
    ):
        data_intents = tuple(item for item in data_intents if item is not DataIntent.ORDER_ACTION)
        data_intents = (*data_intents, DataIntent.ACCOUNT_STATE)
    if DataIntent.EXPECTED_QUOTE in data_intents:
        data_intents = tuple(
            item
            for item in data_intents
            if item not in {DataIntent.CURRENT_QUOTE, DataIntent.SNAPSHOT}
        )
    elif DataIntent.CURRENT_QUOTE in data_intents:
        data_intents = tuple(item for item in data_intents if item is not DataIntent.SNAPSHOT)
    if DataIntent.PRICE_RANGE in data_intents or DataIntent.HISTORY in data_intents:
        data_intents = tuple(item for item in data_intents if item is not DataIntent.CURRENT_QUOTE)
    if Measure.ORDERBOOK in measures and DataIntent.HISTORY not in data_intents:
        temporal_scopes = tuple(
            scope for scope in temporal_scopes if scope is not TemporalScope.CURRENT
        )
    if execution is ExecutionKind.WEBSOCKET:
        # On the streaming surface, ordinary price/체결가 wording is a measure of a
        # subscription rather than the REST current-quote task. EXPECTED_QUOTE stays
        # explicit because it distinguishes the expected-match stream (0H).
        data_intents = tuple(item for item in data_intents if item is not DataIntent.CURRENT_QUOTE)
    elif execution is ExecutionKind.ORDER:
        data_intents = tuple(
            item
            for item in data_intents
            if item not in {DataIntent.CURRENT_QUOTE, DataIntent.SNAPSHOT}
        )
    if DataIntent.RANKING in data_intents:
        data_intents = tuple(
            item
            for item in data_intents
            if item not in {DataIntent.CURRENT_QUOTE, DataIntent.SNAPSHOT}
        )
        if Measure.VOLUME in measures:
            data_intents = (*data_intents, DataIntent.VOLUME_RANKING)
        if Measure.ORDERBOOK in measures:
            data_intents = (*data_intents, DataIntent.ORDERBOOK_RANKING)
        if any(
            _direct_match(normalized, term)
            for term in ("급증", "급등", "급락", "급등락", "spike", "surge")
        ):
            data_intents = (*data_intents, DataIntent.SPIKE_RANKING)
        if any(_direct_match(normalized, term) for term in ("상위", "하위", "top", "bottom")):
            data_intents = (*data_intents, DataIntent.TOP_RANKING)
    if (
        Measure.SENSITIVITY in measures
        and all(_direct_match(normalized, term) for term in ("premium", "discount"))
        and DataIntent.VALUATION_GAP not in data_intents
    ):
        data_intents = (*data_intents, DataIntent.VALUATION_GAP)
    if (
        EntityKind.ELW in _extract(normalized, _ENTITY_PHRASES)
        and _direct_match(normalized, "theoretical price")
        and Measure.SENSITIVITY not in measures
    ):
        measures = (*measures, Measure.SENSITIVITY)
    if (
        DataIntent.EXPECTED_QUOTE in data_intents
        and DataIntent.PRICE_RANGE not in data_intents
        and ExecutionKind.WEBSOCKET not in executions
    ):
        data_intents = (*data_intents, DataIntent.EXPECTED_MARKET_STATE)
    if (
        not read_only_order_status
        and
        ExecutionKind.ORDER in executions
        and any(
            _direct_match(normalized, term)
            for term in ("정정", "amend", "modify", "correct", "취소", "cancel")
        )
        and DataIntent.ORDER_ACTION not in data_intents
    ):
        data_intents = (*data_intents, DataIntent.ORDER_ACTION)
    if not read_only_order_status and DataIntent.ORDER_ACTION in data_intents:
        if any(_direct_match(normalized, term) for term in ("정정", "amend", "modify", "correct")):
            data_intents = (*data_intents, DataIntent.ORDER_AMEND)
        if any(_direct_match(normalized, term) for term in ("취소", "cancel")):
            data_intents = (*data_intents, DataIntent.ORDER_CANCEL)
    existing_order_change = _is_existing_order_change(normalized)
    if existing_order_change:
        execution = ExecutionKind.ORDER
        for intent in (DataIntent.ORDER_ACTION, DataIntent.ORDER_AMEND):
            if intent not in data_intents:
                data_intents = (*data_intents, intent)
    if DataIntent.HISTORY in data_intents and any(
        scope
        in {
            TemporalScope.INTRADAY,
            TemporalScope.DAILY,
            TemporalScope.WEEKLY,
            TemporalScope.MONTHLY,
            TemporalScope.ANNUAL,
            TemporalScope.RANGE,
        }
        for scope in temporal_scopes
    ):
        data_intents = tuple(item for item in data_intents if item is not DataIntent.CURRENT_QUOTE)
    if (
        DataIntent.HISTORY in data_intents
        and RoutingResultShape.TIME_SERIES in result_shapes
        and temporal_scopes == (TemporalScope.CURRENT,)
    ):
        temporal_scopes = (TemporalScope.RANGE,)
    subject = _subject_from_evidence(normalized, subjects)
    entity_kinds = _extract(normalized, _ENTITY_PHRASES)
    marker_kinds = tuple(
        kind
        for kind, markers in _ENTITY_MARKERS.items()
        if any(_direct_match(normalized, marker) for marker in markers)
    )
    entity_kinds = tuple(dict.fromkeys((*entity_kinds, *marker_kinds)))
    if (
        Measure.ORDERBOOK in measures
        and _direct_match(normalized, "order-book")
        and not any(
            _direct_match(normalized, term)
            for term in _ORDER_ACTION_PHRASES
        )
    ):
        if subject is RoutingSubject.ORDER:
            subject = None
        entity_kinds = tuple(
            item for item in entity_kinds if item is not EntityKind.ORDER
        )
    broker_direction = EntityKind.BROKER in entity_kinds and any(
        _direct_match(normalized, term)
        for term in ("매수", "매도", "많이 산", "buy", "sell")
    )
    if broker_direction:
        subject = RoutingSubject.PARTICIPANT
        if EntityKind.STOCK not in entity_kinds and _has_opaque_instrument_value(question):
            entity_kinds = (*entity_kinds, EntityKind.STOCK)
        for intent in (DataIntent.RANKING, DataIntent.TOP_RANKING):
            if intent not in data_intents:
                data_intents = (*data_intents, intent)
        if RoutingResultShape.RANKING not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.RANKING)
    if (
        subject is RoutingSubject.PARTICIPANT
        and set(entity_kinds).intersection({EntityKind.INVESTOR, EntityKind.BROKER})
        and EntityKind.STOCK not in entity_kinds
        and _has_opaque_instrument_value(question)
    ):
        entity_kinds = (*entity_kinds, EntityKind.STOCK)
    if re.search(r"(?<![가-힣])[가-힣]+업\s*지수", normalized):
        subject = RoutingSubject.SECTOR
        if EntityKind.SECTOR_INDEX not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.SECTOR_INDEX)
    if (
        EntityKind.SECTOR_INDEX in entity_kinds
        and any(_direct_match(normalized, term) for term in ("지수", "index", "sector"))
    ):
        subject = RoutingSubject.SECTOR
        entity_kinds = tuple(
            item
            for item in entity_kinds
            if item not in {EntityKind.STOCK, EntityKind.INVESTOR}
        )
    if (
        EntityKind.INVESTOR in entity_kinds
        and EntityKind.SECTOR_INDEX in entity_kinds
        and DataIntent.RANKING in data_intents
    ):
        subject = RoutingSubject.SECTOR
        data_intents = tuple(
            item for item in data_intents if item is not DataIntent.RANKING
        )
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
        result_shapes = tuple(
            item for item in result_shapes if item is not RoutingResultShape.RANKING
        )
        if RoutingResultShape.COLLECTION not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.COLLECTION)
        if Measure.FLOW not in measures:
            measures = (*measures, Measure.FLOW)
    sector_collection = (
        subject is RoutingSubject.SECTOR
        and RoutingResultShape.COLLECTION in result_shapes
    )
    if sector_collection:
        data_intents = tuple(
            item for item in data_intents if item is not DataIntent.CURRENT_QUOTE
        )
        if (
            DataIntent.IDENTITY not in data_intents
            and DataIntent.SNAPSHOT not in data_intents
        ):
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
        temporal_scopes = tuple(
            scope for scope in temporal_scopes if scope is not TemporalScope.CURRENT
        )
    if (
        (subject is RoutingSubject.ACCOUNT or RoutingSubject.ACCOUNT in subjects)
        and DataIntent.HISTORY in data_intents
        and _direct_match(normalized, "위탁")
        and EntityKind.STOCK not in entity_kinds
    ):
        entity_kinds = (*entity_kinds, EntityKind.STOCK)
    account_ledger = any(
        _direct_match(normalized, term)
        for term in ("거래 내역", "trade history", "transaction history")
    )
    if DataIntent.PORTFOLIO in data_intents or DataIntent.HOLDINGS in data_intents:
        subject = RoutingSubject.ACCOUNT
        if EntityKind.ACCOUNT not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.ACCOUNT)
        if (
            _direct_match(normalized, "보유")
            and _direct_match(normalized, "portfolio")
            and EntityKind.STOCK not in entity_kinds
        ):
            entity_kinds = (*entity_kinds, EntityKind.STOCK)
        if (
            DataIntent.HOLDINGS in data_intents
            and not set(entity_kinds).intersection(
                {EntityKind.STOCK, EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD}
            )
        ):
            entity_kinds = (*entity_kinds, EntityKind.STOCK)
    if account_ledger:
        subject = RoutingSubject.ACCOUNT
        if EntityKind.ACCOUNT not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.ACCOUNT)
        if DataIntent.ACCOUNT_STATE not in data_intents:
            data_intents = (*data_intents, DataIntent.ACCOUNT_STATE)
        if DataIntent.HISTORY in data_intents and EntityKind.GOLD in entity_kinds:
            result_shapes = tuple(
                item for item in result_shapes if item is not RoutingResultShape.COLLECTION
            )
            if RoutingResultShape.TIME_SERIES not in result_shapes:
                result_shapes = (*result_shapes, RoutingResultShape.TIME_SERIES)
    if (
        subject is RoutingSubject.SECTOR
        and any(_direct_match(normalized, term) for term in ("지수", "index", "level"))
        and any(_direct_match(normalized, term) for term in current_markers)
        and not sector_collection
    ):
        if Measure.PRICE not in measures:
            measures = (*measures, Measure.PRICE)
        data_intents = tuple(
            item for item in data_intents if item is not DataIntent.SNAPSHOT
        )
        if DataIntent.CURRENT_QUOTE not in data_intents:
            data_intents = (*data_intents, DataIntent.CURRENT_QUOTE)
    etf_return_comparison = (
        EntityKind.ETF in entity_kinds
        and any(_direct_match(normalized, term) for term in ("compare", "비교", "benchmark"))
        and any(_direct_match(normalized, term) for term in ("return", "returns", "수익률"))
    )
    if etf_return_comparison:
        if Measure.PNL not in measures:
            measures = (*measures, Measure.PNL)
        if DataIntent.PERFORMANCE not in data_intents:
            data_intents = (*data_intents, DataIntent.PERFORMANCE)
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
        if RoutingResultShape.COLLECTION not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.COLLECTION)
    if (
        EntityKind.ETF in entity_kinds
        and Measure.NAV in measures
        and _direct_match(normalized, "time-stamped")
    ):
        temporal_scopes = tuple(
            item for item in temporal_scopes if item is not TemporalScope.CURRENT
        )
        if TemporalScope.INTRADAY not in temporal_scopes:
            temporal_scopes = (*temporal_scopes, TemporalScope.INTRADAY)
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
    if EntityKind.ETF in entity_kinds and Measure.FLOW in measures:
        subject = RoutingSubject.INSTRUMENT
        entity_kinds = tuple(
            item for item in entity_kinds if item is not EntityKind.INVESTOR
        )
        if (
            RoutingResultShape.TIME_SERIES not in result_shapes
            and TemporalScope.INTRADAY in temporal_scopes
        ):
            result_shapes = (*result_shapes, RoutingResultShape.TIME_SERIES)
    if (
        EntityKind.ETF in entity_kinds
        and Measure.TRADE in measures
        and TemporalScope.INTRADAY in temporal_scopes
    ):
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
        if RoutingResultShape.TIME_SERIES not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.TIME_SERIES)
    if Measure.NAV in measures or (
        Measure.PNL in measures and _direct_match(normalized, "benchmark")
    ):
        entity_kinds = tuple(
            item for item in entity_kinds if item is not EntityKind.STOCK
        )
        if EntityKind.ETF not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.ETF)
        if subject in {None, RoutingSubject.INSTRUMENT}:
            subject = RoutingSubject.INSTRUMENT
    if (
        EntityKind.ELW in entity_kinds
        and _direct_match(normalized, "proximity to")
    ):
        data_intents = tuple(
            item for item in data_intents if item is not DataIntent.RANKING
        )
        if DataIntent.SNAPSHOT not in data_intents:
            data_intents = (*data_intents, DataIntent.SNAPSHOT)
        result_shapes = tuple(
            item for item in result_shapes if item is not RoutingResultShape.RANKING
        )
        if RoutingResultShape.COLLECTION not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.COLLECTION)
    if (
        EntityKind.GOLD in entity_kinds
        and EntityKind.INVESTOR in entity_kinds
        and Measure.FLOW in measures
    ):
        subject = RoutingSubject.PARTICIPANT
    if read_only_order_status:
        subject = RoutingSubject.ACCOUNT
        entity_kinds = tuple(
            item for item in entity_kinds if item is not EntityKind.ORDER
        )
        if EntityKind.ACCOUNT not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.ACCOUNT)
        if not set(entity_kinds).intersection(
            {EntityKind.STOCK, EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD}
        ):
            entity_kinds = (*entity_kinds, EntityKind.STOCK)
    account_identity = any(
        _direct_match(normalized, term)
        for term in ("계좌번호", "account name", "branch")
    )
    if account_identity and EntityKind.ACCOUNT in entity_kinds:
        subject = RoutingSubject.ACCOUNT
        if DataIntent.IDENTITY not in data_intents:
            data_intents = (*data_intents, DataIntent.IDENTITY)
        if Measure.IDENTITY not in measures:
            measures = (*measures, Measure.IDENTITY)
    if (
        EntityKind.ACCOUNT in entity_kinds
        and any(
            _direct_match(normalized, term)
            for term in (
                "foreign currency deposits", "receivables", "arrears", "미수금",
                "연체금액", "추정예탁자산", "총자산",
            )
        )
    ):
        subject = RoutingSubject.ACCOUNT
        if DataIntent.ACCOUNT_STATE not in data_intents:
            data_intents = (*data_intents, DataIntent.ACCOUNT_STATE)
    if (
        EntityKind.ACCOUNT in entity_kinds
        and Measure.ORDER_STATUS in measures
        and any(_direct_match(normalized, term) for term in ("status", "현황"))
    ):
        subject = RoutingSubject.ACCOUNT
        if DataIntent.ACCOUNT_STATE not in data_intents:
            data_intents = (*data_intents, DataIntent.ACCOUNT_STATE)
        if RoutingResultShape.COLLECTION not in result_shapes:
            result_shapes = (*result_shapes, RoutingResultShape.COLLECTION)
    account_owner = bool(re.search(r"(?<![가-힣])내(?:\s|$)", normalized)) or any(
        _direct_match(normalized, term)
        for term in ("나의", "내 계좌", "내 잔고", "my", "i hold", "my holdings")
    )
    if (
        DataIntent.ACCOUNT_STATE in data_intents
        and Measure.PNL in measures
        and any(_direct_match(normalized, term) for term in ("realized", "실현손익"))
    ):
        subject = RoutingSubject.ACCOUNT
        entity_kinds = tuple(
            dict.fromkeys((*entity_kinds, EntityKind.ACCOUNT, EntityKind.STOCK))
        )
    account_measures = {
        Measure.BALANCE,
        Measure.PNL,
        Measure.POSITION,
        Measure.ORDER_STATUS,
    }
    if account_owner and (
        DataIntent.PORTFOLIO in data_intents
        or DataIntent.ACCOUNT_STATE in data_intents
        or account_measures.intersection(measures)
    ):
        subject = RoutingSubject.ACCOUNT
        if EntityKind.ACCOUNT not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.ACCOUNT)
        if DataIntent.ACCOUNT_STATE not in data_intents:
            data_intents = (*data_intents, DataIntent.ACCOUNT_STATE)
    if (
        subject is RoutingSubject.ACCOUNT
        and DataIntent.ACCOUNT_STATE in data_intents
        and DataIntent.HISTORY not in data_intents
        and RoutingResultShape.TIME_SERIES not in result_shapes
    ):
        # Conversational "now" does not identify a dedicated intraday account
        # family. Explicit daily/history wording remains authoritative.
        temporal_scopes = tuple(
            scope for scope in temporal_scopes if scope is not TemporalScope.CURRENT
        )
    if (
        subject is RoutingSubject.ACCOUNT
        and DataIntent.ORDER_ACTION in data_intents
        and any(
            _direct_match(normalized, term)
            for term in ("주문 가능", "order capacity", "buying power")
        )
        and not any(
            _direct_match(normalized, term)
            for term in ("매수해", "매도해", "정정해", "취소해", "buy", "sell", "amend", "cancel")
        )
    ):
        data_intents = tuple(
            item for item in data_intents if item is not DataIntent.ORDER_ACTION
        )
        entity_kinds = tuple(item for item in entity_kinds if item is not EntityKind.ORDER)
    if (
        _has_opaque_instrument_value(question)
        and subject is RoutingSubject.PARTICIPANT
        and (
            DataIntent.MARKET_SCALE in data_intents
            or Measure.OWNERSHIP in measures
        )
    ):
        subject = RoutingSubject.INSTRUMENT
        if EntityKind.STOCK not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.STOCK)
    market_order = any(
        _direct_match(normalized, term)
        for term in ("시장가", "market order", "at market")
    )
    if execution is ExecutionKind.ORDER and market_order:
        subject = RoutingSubject.ORDER
        entity_kinds = tuple(
            item for item in entity_kinds if item is not EntityKind.MARKET
        )
        if EntityKind.ORDER not in entity_kinds:
            entity_kinds = (*entity_kinds, EntityKind.ORDER)
    if (
        execution is ExecutionKind.ORDER
        and not {EntityKind.STOCK, EntityKind.ETF, EntityKind.ELW, EntityKind.GOLD}.intersection(
            entity_kinds
        )
        and _has_opaque_instrument_value(question)
    ):
        entity_kinds = (*entity_kinds, EntityKind.STOCK)
    specific_instruments = {
        EntityKind.ETF,
        EntityKind.ELW,
        EntityKind.GOLD,
    }
    if specific_instruments.intersection(entity_kinds):
        # Korean product phrases commonly retain the generic classifier "종목"
        # (for example "ETF 종목 정보"). The explicit product kind is stronger
        # evidence; retaining STOCK creates a false mixed-entity tie.
        entity_kinds = tuple(item for item in entity_kinds if item is not EntityKind.STOCK)
    if subject is None:
        if EntityKind.SECTOR_INDEX in entity_kinds:
            subject = RoutingSubject.SECTOR
        elif EntityKind.ACCOUNT in entity_kinds:
            subject = RoutingSubject.ACCOUNT
        elif {
            EntityKind.STOCK,
            EntityKind.ETF,
            EntityKind.ELW,
            EntityKind.GOLD,
        }.intersection(entity_kinds):
            subject = RoutingSubject.INSTRUMENT
    chart_periods = {
        TemporalScope.TICK,
        TemporalScope.MINUTE,
        TemporalScope.DAILY,
        TemporalScope.WEEKLY,
        TemporalScope.MONTHLY,
        TemporalScope.ANNUAL,
    }
    if (
        subject is None
        and not entity_kinds
        and (
            (
                RoutingResultShape.TIME_SERIES in result_shapes
                and chart_periods.intersection(temporal_scopes)
            )
            or (
                infer_opaque_entity
                and _has_instrument_anchor(question, data_intents, measures)
            )
        )
    ):
        subject = RoutingSubject.INSTRUMENT
        entity_kinds = (EntityKind.STOCK,)
    if (
        DataIntent.HISTORY in data_intents
        and DataIntent.CHART not in data_intents
        and Measure.PRICE in measures
        and EntityKind.STOCK in entity_kinds
        and DataIntent.PRICE_HISTORY not in data_intents
    ):
        data_intents = (*data_intents, DataIntent.PRICE_HISTORY)
    bindings = _extract(normalized, _BINDING_PHRASES)
    if (
        BindingRole.SIDE in bindings
        and not broker_direction
        and execution is not ExecutionKind.ORDER
        and DataIntent.RANKING not in data_intents
    ):
        bindings = tuple(item for item in bindings if item is not BindingRole.SIDE)
    if broker_direction and BindingRole.SIDE not in bindings:
        bindings = (*bindings, BindingRole.SIDE)
    if execution is ExecutionKind.ORDER and Measure.PRICE in measures:
        if BindingRole.PRICE not in bindings:
            bindings = (*bindings, BindingRole.PRICE)
    return QueryFrame(
        subject=subject,
        entity_kinds=entity_kinds,
        execution=execution,
        data_intents=data_intents,
        temporal_scopes=temporal_scopes,
        measures=measures,
        result_shapes=result_shapes,
        bindings=bindings,
    )
