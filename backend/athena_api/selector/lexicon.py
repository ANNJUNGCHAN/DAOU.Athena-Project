"""Versioned, controlled Korean/English finance vocabulary for lexical retrieval."""

from __future__ import annotations

import re

from .normalization import tokenize

LEXICON_VERSION = "ko-en-finance-v7"

# Concept groups are deliberately small and reviewed. Expansion is symmetric.
_CONCEPTS: tuple[tuple[str, ...], ...] = (
    ("현재가", "주가", "price", "current_price", "cur_prc"),
    ("시세", "quote", "quotes", "market_price"),
    ("잔고", "보유", "보유종목", "balance", "holding", "holdings", "position"),
    ("계좌", "account", "acnt"),
    ("평가", "valuation", "evaluation", "evlt"),
    ("손익", "수익", "profit", "loss", "pnl", "lspft", "pl"),
    # 0C 주식우선호가, 0D 주식호가잔량, 0E 주식시간외호가 are quote variants that already
    # reach this group for free - "호가" is a bigram of all three - so no member was added
    # for them here. This group already bridges into 매수/매도 through the shared bid/ask
    # (pre-existing), and every extra member added widened that bridge's score on an
    # adversarial "매수" question that must be refused, not resolved; kept minimal.
    ("호가", "매수잔량", "매도잔량", "orderbook", "bid", "ask"),
    ("체결", "execution", "fill", "contract", "cntr", "tick"),
    ("주문", "order", "ord"),
    ("거래량", "volume", "trde_qty"),
    # Extended for 0U 업종등락: advance/decline is the same change-rate concept, and
    # "등락" is already a bigram of "등락률".
    ("등락률", "변동률", "change_rate", "flu_rt", "등락", "advance decline", "advancers decliners"),
    ("차트", "봉", "chart", "candle", "ohlcv"),
    ("투자자", "기관", "외국인", "investor", "institution", "foreign"),
    ("예수금", "현금", "deposit", "cash", "entr"),
    ("lp", "liquidity provider", "liquidity-provider"),
    ("매수", "buy", "bid"),
    ("매도", "sell", "ask"),
    ("종목", "주식", "stock", "ticker", "stk"),
    ("금현물", "금", "gold"),
    # Extended so the 23 realtime types are reachable by the verb a trader uses for
    # "turn this feed on": subscribe. "live" and "feed" dropped - too generic, they
    # fire on unrelated questions.
    ("실시간", "websocket", "stream", "realtime", "구독", "subscribe"),
    # 0H 주식예상체결: anchored on 예상/예상가 only. The whole compound "예상체결"
    # bigrams to "체결", which would silently re-join this group to plain 체결 (00/0B)
    # and make every 체결 question resolve here too.
    ("예상", "예상가", "expected", "anticipated"),
    # 0A 주식기세: indicative price movement ahead of a confirmed quote. "quote" left
    # out - it is already claimed by the 시세 group.
    ("기세", "indicative"),
    # 0F 주식당일거래원: the broker/member-firm identity behind a trade. "거래원"
    # bigrams to "거래", shared with 거래량 - a narrower, real overlap (both are about
    # a trade) accepted deliberately, unlike the 체결/실시간 cascade this was pulled
    # out of.
    ("거래원", "broker", "brokers", "member firm", "trading member"),
    # 0J 업종지수: sector/industry index level.
    ("업종", "지수", "sector", "industry index", "sector index"),
    # 0w 종목프로그램매매: no lexicon group. "program trading"/"trading" would hand it every
    # one of its own title bigrams on the word "trading" alone, outscoring 0F 주식당일거래원
    # on a question that names the broker, not the program-trading flow. Its own Korean name
    # already reaches it directly without a group.
    # 1h VI발동/해제: the volatility-interruption trigger itself.
    ("vi", "발동", "volatility interruption", "trigger"),
    # 0m ELW 이론가: theoretical fair value, distinct from 0u's greeks.
    ("이론가", "theoretical value", "theo value"),
    # 0u ELW 지표: the greeks/indicator set for an ELW.
    ("지표", "indicator", "greeks", "elw indicator"),
    # 0G ETF NAV: net asset value.
    ("nav", "순자산가치", "etf nav"),
    # 0s 장시작시간: exchange session open/close timing. "market open"/"opening bell"
    # dropped - "open"/"opening" are exactly the generic tokens that fire elsewhere.
    ("장시작", "session start"),
    # ka10171-ka10174: saved condition-search formulas, run once or streamed.
    ("조건검색", "conditional search", "screener", "condition formula", "conditional formula"),
    # ka10174 조건검색 실시간 해제: 해지 and 해제 are the same act in this API.
    ("해지", "해제", "unsubscribe", "cancel", "remove"),
)

_REVIEWED_CONCEPT_TOKENS = frozenset(
    token
    for concept in _CONCEPTS
    for term in concept
    for token in tokenize(term, korean_bigrams=False)
)
_REVIEWED_CANONICAL_FRAGMENTS = frozenset(
    {"현재", "자본", "코드", "동향", "실적", "조회", "번호", "미수", "연체", "자산"}
)
_REVIEWED_CANONICAL_TERMS = frozenset({"미체결", "종목코드", "현재가"})


def reviewed_query_fragments(tokens: set[str]) -> set[str]:
    """Keep only reviewed concept or canonical query fragments."""
    return tokens.intersection(
        _REVIEWED_CONCEPT_TOKENS | _REVIEWED_CANONICAL_FRAGMENTS
    )


def reviewed_canonical_terms(value: str) -> set[str]:
    """Return reviewed Korean terms embedded at a lexical boundary in catalog text."""
    normalized = " ".join(value.casefold().split())
    return {
        term
        for term in _REVIEWED_CANONICAL_TERMS
        if re.search(rf"(?<![가-힣]){re.escape(term)}", normalized) is not None
    }


def _contains_sequence(tokens: tuple[str, ...], phrase: tuple[str, ...]) -> bool:
    if len(phrase) == 1:
        return phrase[0] in tokens
    width = len(phrase)
    return any(tokens[index : index + width] == phrase for index in range(len(tokens) - width + 1))


def expand_tokens(tokens: tuple[str, ...]) -> tuple[str, ...]:
    """Return one-hop synonyms for authored tokens and atomic multiword aliases.

    A multiword alias such as ``ELW indicator`` or ``ETF NAV`` is evidence only when
    the complete normalized sequence occurs. Its entity token alone must not emit the
    capability vocabulary. Matching is evaluated against the original input once, so a
    synonym emitted by one concept cannot activate a second concept transitively.
    """
    expanded = set(tokens)
    for concept in _CONCEPTS:
        aliases = tuple(tokenize(term, korean_bigrams=False) for term in concept)
        if any(_contains_sequence(tokens, alias) for alias in aliases):
            expanded.update(token for alias in aliases for token in alias)
    return tuple(sorted(expanded))


def synonym_only_tokens(tokens: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted(set(expand_tokens(tokens)).difference(tokens)))
