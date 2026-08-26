"""Unicode-safe natural-language normalization with exact operation identities."""

from __future__ import annotations

import re
import unicodedata

_TOKEN_RE = re.compile(r"[0-9a-z_]+|[가-힣]+")
_IDENTITY_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def normalize_text(value: str) -> str:
    """Normalize natural language only; never use this for identity lookup."""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def tokenize(value: str, *, korean_bigrams: bool = True) -> tuple[str, ...]:
    normalized = normalize_text(value)
    tokens: set[str] = set(_TOKEN_RE.findall(normalized))
    if korean_bigrams:
        for token in tuple(tokens):
            if re.fullmatch(r"[가-힣]+", token) and len(token) >= 2:
                tokens.update(token[index : index + 2] for index in range(len(token) - 1))
    return tuple(sorted(tokens))


def identity_tokens(value: str) -> frozenset[str]:
    """Split on identity boundaries without case-folding or NFKC.

    Used to spot a TR id embedded in a longer question. Casing must survive so
    that the distinct WebSocket identities ``0G`` and ``0g`` stay distinct, and
    boundaries must be respected so ``ka100010`` never matches ``ka10001``.
    """
    return frozenset(_IDENTITY_TOKEN_RE.findall(value))

