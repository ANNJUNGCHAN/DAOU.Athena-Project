"""Versioned, controlled Korean/English finance vocabulary for lexical retrieval."""

from __future__ import annotations

from .normalization import tokenize

LEXICON_VERSION = "ko-en-finance-v1"

# Concept groups are deliberately small and reviewed. Expansion is symmetric.
_CONCEPTS: tuple[tuple[str, ...], ...] = (
    ("현재가", "주가", "price", "current_price", "cur_prc"),
    ("시세", "quote", "quotes", "market_price"),
    ("잔고", "보유", "보유종목", "balance", "holding", "holdings", "position"),
    ("계좌", "account", "acnt"),
    ("평가", "valuation", "evaluation", "evlt"),
    ("손익", "수익", "profit", "loss", "pnl", "lspft", "pl"),
    ("호가", "매수잔량", "매도잔량", "orderbook", "bid", "ask"),
    ("체결", "execution", "fill", "contract", "cntr"),
    ("주문", "order", "ord"),
    ("거래량", "volume", "trde_qty"),
    ("등락률", "변동률", "change_rate", "flu_rt"),
    ("차트", "봉", "chart", "candle", "ohlcv"),
    ("투자자", "기관", "외국인", "investor", "institution", "foreign"),
    ("예수금", "현금", "deposit", "cash", "entr"),
    ("매수", "buy", "bid"),
    ("매도", "sell", "ask"),
    ("종목", "주식", "stock", "ticker", "stk"),
    ("금현물", "금", "gold"),
    ("실시간", "websocket", "stream", "realtime"),
)


def expand_tokens(tokens: tuple[str, ...]) -> tuple[str, ...]:
    """Return deterministic original plus synonym tokens."""
    expanded = set(tokens)
    for concept in _CONCEPTS:
        concept_tokens = {token for term in concept for token in tokenize(term)}
        if expanded.intersection(concept_tokens):
            expanded.update(concept_tokens)
    return tuple(sorted(expanded))


def synonym_only_tokens(tokens: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted(set(expand_tokens(tokens)).difference(tokens)))
