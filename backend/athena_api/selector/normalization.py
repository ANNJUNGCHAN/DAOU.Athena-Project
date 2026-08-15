"""Unicode-safe natural-language normalization with exact operation identities."""

from __future__ import annotations

import re
import unicodedata

_TOKEN_RE = re.compile(r"[0-9a-z_]+|[가-힣]+")
_OPERATION_REF_RE = re.compile(
    r"(?:base:[A-Za-z0-9]+|detail:[A-Za-z0-9]+:[a-z0-9_]+)\Z"
)


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


def is_canonical_operation_ref(value: str) -> bool:
    """Validate the case-sensitive identity grammar without normalizing it."""
    return _OPERATION_REF_RE.fullmatch(value) is not None
