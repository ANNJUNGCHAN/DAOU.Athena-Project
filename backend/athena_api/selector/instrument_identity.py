"""Atomic, value-private instrument identity resolution from Kiwoom ka10099."""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from athena_api.generated.models import Ka10099Response
from athena_api.generated.registry import TR_REGISTRY
from athena_api.routing_contract import EntityKind

IDENTITY_MARKETS: tuple[str, ...] = ("0", "10", "8")
IDENTITY_MARKET_KINDS: Mapping[str, EntityKind] = MappingProxyType(
    {
        "0": EntityKind.STOCK,
        "10": EntityKind.STOCK,
        "8": EntityKind.ETF,
    }
)

_AMBIGUOUS_CONTEXT = re.compile(
    r"(?:말고|제외|아닌|비교|(?<![0-9a-z])(?:not|except|excluding|compare|versus|vs)"
    r"(?=$|[^0-9a-z]))",
    re.IGNORECASE,
)
_EXPLICIT_CODE = re.compile(r"(?<!\d)(\d{6})(?!\d)")
_IDENTITY_CHAR = re.compile(r"[0-9a-z가-힣]", re.IGNORECASE)
_PARTICLE = r"(?:'s|의|가|이|은|는|을|를|와|과|에서|으로|에|로)?"


@dataclass(frozen=True, slots=True)
class TargetResolution:
    """The only identity evidence allowed to cross into typed compatibility."""

    entity_kind: EntityKind
    present: bool = True


@dataclass(frozen=True, slots=True)
class _ResolvedInstrument:
    code: str
    target: TargetResolution


@dataclass(frozen=True, slots=True)
class _IdentityRecord:
    code: str
    name: str
    market: str
    kind: EntityKind


@dataclass(frozen=True, slots=True)
class InstrumentIdentitySnapshot:
    """Immutable lookup state replaced with one pointer assignment after refresh."""

    records_by_code: Mapping[str, _IdentityRecord]
    alias_codes: Mapping[str, frozenset[str]]
    alias_patterns: tuple[tuple[re.Pattern[str], frozenset[str]], ...]

    @classmethod
    def empty(cls) -> InstrumentIdentitySnapshot:
        return cls(MappingProxyType({}), MappingProxyType({}), ())


def _normalize_identity(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(character for character in normalized if _IDENTITY_CHAR.fullmatch(character))


def _alias_pattern(alias: str) -> re.Pattern[str]:
    characters = tuple(_normalize_identity(alias))
    if len(characters) < 2:
        raise ValueError("instrument aliases must contain at least two identity characters")
    body = r"[^0-9a-z가-힣]*".join(re.escape(character) for character in characters)
    return re.compile(
        rf"(?<![0-9a-z가-힣]){body}{_PARTICLE}(?=$|[^0-9a-z가-힣])",
        re.IGNORECASE,
    )


def build_identity_snapshot(
    market_records: Mapping[str, Iterable[Mapping[str, Any]]],
) -> InstrumentIdentitySnapshot:
    """Validate all reviewed markets and build a complete immutable snapshot."""
    if set(market_records) != set(IDENTITY_MARKETS):
        raise ValueError("instrument identity refresh requires markets 0, 10, and 8")
    candidates: defaultdict[str, set[_IdentityRecord]] = defaultdict(set)
    aliases: defaultdict[str, set[str]] = defaultdict(set)
    for requested_market in IDENTITY_MARKETS:
        for item in market_records[requested_market]:
            code = str(item.get("code") or "").strip()
            name = str(item.get("name") or "").strip()
            market = str(item.get("marketCode") or item.get("market_code") or "").strip()
            kind = IDENTITY_MARKET_KINDS.get(market)
            # ka10099 market 0 is an aggregate response containing funds, ETNs, and
            # alphanumeric product identifiers. Only the reviewed returned market and
            # six-digit domestic numeric identity contract may enter this index.
            if kind is None or not re.fullmatch(r"\d{6}", code) or not name:
                continue
            record = _IdentityRecord(code=code, name=name, market=market, kind=kind)
            candidates[code].add(record)

    records: dict[str, _IdentityRecord] = {}
    for code, code_candidates in sorted(candidates.items()):
        # Overlap between the aggregate market-0 response and the dedicated ETF
        # response is expected. Identical returned identity metadata is one entity;
        # conflicting metadata is ambiguous and therefore excluded in full.
        if len(code_candidates) != 1:
            continue
        record = next(iter(code_candidates))
        records[code] = record
        name = record.name
        aliases[_normalize_identity(code)].add(code)
        aliases[_normalize_identity(name)].add(code)
    frozen_aliases = MappingProxyType(
        {alias: frozenset(codes) for alias, codes in sorted(aliases.items()) if alias}
    )
    patterns = tuple(
        (_alias_pattern(alias), codes)
        for alias, codes in frozen_aliases.items()
        if not alias.isdigit()
    )
    return InstrumentIdentitySnapshot(
        records_by_code=MappingProxyType(dict(sorted(records.items()))),
        alias_codes=frozen_aliases,
        alias_patterns=patterns,
    )


FetchMarket = Callable[[str], Awaitable[Iterable[Mapping[str, Any]]]]


class InstrumentIdentityIndex:
    """Process-local identity index with fail-closed, all-or-nothing refresh."""

    def __init__(self, snapshot: InstrumentIdentitySnapshot | None = None) -> None:
        self._snapshot = snapshot or InstrumentIdentitySnapshot.empty()

    @property
    def snapshot(self) -> InstrumentIdentitySnapshot:
        return self._snapshot

    @property
    def size(self) -> int:
        return len(self._snapshot.records_by_code)

    def replace(self, market_records: Mapping[str, Iterable[Mapping[str, Any]]]) -> int:
        next_snapshot = build_identity_snapshot(market_records)
        self._snapshot = next_snapshot
        return len(next_snapshot.records_by_code)

    async def refresh_from(self, fetch_market: FetchMarket) -> int:
        """Fetch every reviewed market before atomically publishing any result."""
        market_records: dict[str, tuple[Mapping[str, Any], ...]] = {}
        for market in IDENTITY_MARKETS:
            market_records[market] = tuple(await fetch_market(market))
        return self.replace(market_records)

    async def refresh(self, client: Any) -> int:
        spec = TR_REGISTRY["ka10099"]

        async def fetch_market(market: str) -> Iterable[Mapping[str, Any]]:
            envelope = await client.post_with_headers(
                "ka10099",
                spec.upstream_path,
                {"mrkt_tp": market},
            )
            response = Ka10099Response.model_validate(envelope.body)
            return tuple(item.model_dump(by_alias=True) for item in response.list_)

        return await self.refresh_from(fetch_market)

    def resolve(self, question: str) -> _ResolvedInstrument | None:
        """Resolve one exact indexed name/code without exposing aliases downstream."""
        text = unicodedata.normalize("NFKC", str(question)).casefold()
        if not text or _AMBIGUOUS_CONTEXT.search(text):
            return None
        snapshot = self._snapshot
        explicit_codes = set(_EXPLICIT_CODE.findall(text))
        if len(explicit_codes) > 1 or any(
            code not in snapshot.records_by_code for code in explicit_codes
        ):
            return None
        matched_codes = set(explicit_codes)
        for pattern, codes in snapshot.alias_patterns:
            if pattern.search(text) is None:
                continue
            if len(codes) != 1:
                return None
            matched_codes.update(codes)
        if len(matched_codes) != 1:
            return None
        code = next(iter(matched_codes))
        record = snapshot.records_by_code.get(code)
        if record is None:
            return None
        return _ResolvedInstrument(code, TargetResolution(record.kind))

    def resolve_target(self, question: str) -> TargetResolution | None:
        resolved = self.resolve(question)
        return resolved.target if resolved is not None else None


__all__ = [
    "IDENTITY_MARKETS",
    "IDENTITY_MARKET_KINDS",
    "InstrumentIdentityIndex",
    "InstrumentIdentitySnapshot",
    "TargetResolution",
    "build_identity_snapshot",
]
