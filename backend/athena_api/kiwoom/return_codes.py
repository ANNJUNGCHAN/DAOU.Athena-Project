"""Canonical Kiwoom return-code normalization shared by all transports."""

from __future__ import annotations


def normalize_return_code(value: object) -> str:
    """Canonicalize integer and numeric-string codes without treating bool as int."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return ""
        try:
            return str(int(value, 10))
        except ValueError:
            return value
    return str(value)
