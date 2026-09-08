"""Persistent, fail-closed instrument identity resolution from Kiwoom ka10099."""

from __future__ import annotations

import asyncio
import re
import sqlite3
import threading
import unicodedata
from collections import defaultdict
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any

from athena_api.generated.models import Ka10099Response
from athena_api.generated.registry import TR_REGISTRY
from athena_api.kiwoom import RequestOptions
from athena_api.kiwoom.return_codes import normalize_return_code
from athena_api.routing_contract import EntityKind

IDENTITY_MARKETS: tuple[str, ...] = ("0", "10", "8")
IDENTITY_MARKET_KINDS: Mapping[str, EntityKind] = MappingProxyType(
    {"0": EntityKind.STOCK, "10": EntityKind.STOCK, "8": EntityKind.ETF}
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
    identity_assisted: bool = True
    name: str = ""
    market: str = ""


@dataclass(frozen=True, slots=True)
class _IdentityRecord:
    code: str
    name: str
    market: str
    kind: EntityKind


@dataclass(frozen=True, slots=True)
class InstrumentIdentitySnapshot:
    """Compatibility view for fixtures and offline evaluation tools."""

    records_by_code: Mapping[str, _IdentityRecord]
    alias_codes: Mapping[str, frozenset[str]]
    name_aliases: tuple[str, ...]

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
    """Validate all reviewed markets and build one complete candidate set."""
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
            if kind is None or not re.fullmatch(r"\d{6}", code) or not name:
                continue
            candidates[code].add(_IdentityRecord(code, name, market, kind))

    records: dict[str, _IdentityRecord] = {}
    for code, code_candidates in sorted(candidates.items()):
        if len(code_candidates) != 1:
            continue
        record = next(iter(code_candidates))
        records[code] = record
        aliases[_normalize_identity(code)].add(code)
        aliases[_normalize_identity(record.name)].add(code)
    frozen_aliases = MappingProxyType(
        {alias: frozenset(codes) for alias, codes in sorted(aliases.items()) if alias}
    )
    if any(len(alias) < 2 for alias in frozen_aliases if not alias.isdigit()):
        raise ValueError("instrument aliases must contain at least two identity characters")
    return InstrumentIdentitySnapshot(
        records_by_code=MappingProxyType(dict(sorted(records.items()))),
        alias_codes=frozen_aliases,
        name_aliases=tuple(alias for alias in frozen_aliases if not alias.isdigit()),
    )


FetchMarket = Callable[[str], Awaitable[Iterable[Mapping[str, Any]]]]


class InstrumentIdentityIndex:
    """SQLite-backed identity master with transactional full replacement."""

    def __init__(
        self,
        snapshot: InstrumentIdentitySnapshot | None = None,
        *,
        db_path: Path | str | None = None,
    ) -> None:
        self._db_path = Path(db_path) if db_path is not None else None
        self._memory_connection = (
            sqlite3.connect(":memory:", check_same_thread=False) if db_path is None else None
        )
        self._memory_lock = threading.RLock()
        self._compat_snapshot = InstrumentIdentitySnapshot.empty() if db_path is None else None
        self._initialized = False
        if self._memory_connection is not None:
            self._run(lambda _connection: None)
        if snapshot is not None:
            self._replace_snapshot(snapshot)

    def _connect(self) -> sqlite3.Connection:
        if self._memory_connection is not None:
            return self._memory_connection
        assert self._db_path is not None
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self._db_path, timeout=30)
        connection.execute("PRAGMA busy_timeout=30000")
        return connection

    def _run(self, operation):
        with self._memory_lock:
            connection = self._connect()
            try:
                if not self._initialized:
                    self._initialize_connection(connection)
                    self._initialized = True
                return operation(connection)
            finally:
                if self._memory_connection is None:
                    connection.close()

    def _initialize_connection(self, connection: sqlite3.Connection) -> None:
        if self._memory_connection is None:
            connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(
            """
                CREATE TABLE IF NOT EXISTS instruments (
                    code TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL,
                    market_code TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('stock', 'etf'))
                );
                CREATE INDEX IF NOT EXISTS instruments_normalized_name_idx
                    ON instruments(normalized_name);
                CREATE TABLE IF NOT EXISTS instrument_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
            """
        )

    @property
    def snapshot(self) -> InstrumentIdentitySnapshot:
        if self._compat_snapshot is not None:
            return self._compat_snapshot
        return self._read_snapshot()

    def _read_snapshot(self) -> InstrumentIdentitySnapshot:
        rows = self._run(
            lambda connection: connection.execute(
                "SELECT code, name, market_code FROM instruments ORDER BY code"
            ).fetchall()
        )
        market_records = {market: [] for market in IDENTITY_MARKETS}
        for code, name, market in rows:
            market_records[market].append({"code": code, "name": name, "marketCode": market})
        return build_identity_snapshot(market_records)

    @property
    def size(self) -> int:
        return self._run(
            lambda connection: int(
                connection.execute("SELECT COUNT(*) FROM instruments").fetchone()[0]
            )
        )

    @property
    def refreshed_at(self) -> str | None:
        def read(connection: sqlite3.Connection) -> str | None:
            row = connection.execute(
                "SELECT value FROM instrument_metadata WHERE key = 'refreshed_at'"
            ).fetchone()
            return str(row[0]) if row else None

        return self._run(read)

    @property
    def ready(self) -> bool:
        return self.size > 0

    def status(self) -> tuple[bool, int, str | None]:
        def read(connection: sqlite3.Connection) -> tuple[bool, int, str | None]:
            connection.execute("BEGIN")
            try:
                size = int(connection.execute("SELECT COUNT(*) FROM instruments").fetchone()[0])
                row = connection.execute(
                    "SELECT value FROM instrument_metadata WHERE key = 'refreshed_at'"
                ).fetchone()
                return size > 0, size, str(row[0]) if row else None
            finally:
                connection.rollback()

        return self._run(read)

    def _replace_snapshot(self, snapshot: InstrumentIdentitySnapshot) -> int:
        refreshed_at = datetime.now(UTC).isoformat()
        rows = [
            (
                record.code,
                record.name,
                _normalize_identity(record.name),
                record.market,
                record.kind.value,
            )
            for record in snapshot.records_by_code.values()
        ]
        def replace(connection: sqlite3.Connection) -> None:
            with connection:
                connection.execute("DELETE FROM instruments")
                connection.executemany(
                    "INSERT INTO instruments(code, name, normalized_name, market_code, kind) "
                    "VALUES (?, ?, ?, ?, ?)",
                    rows,
                )
                connection.execute(
                    "INSERT INTO instrument_metadata(key, value) VALUES ('refreshed_at', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (refreshed_at,),
                )

        self._run(replace)
        if self._compat_snapshot is not None:
            self._compat_snapshot = snapshot
        return len(rows)

    def replace(self, market_records: Mapping[str, Iterable[Mapping[str, Any]]]) -> int:
        return self._replace_snapshot(build_identity_snapshot(market_records))

    async def refresh_from(self, fetch_market: FetchMarket) -> int:
        market_records: dict[str, tuple[Mapping[str, Any], ...]] = {}
        for market in IDENTITY_MARKETS:
            market_records[market] = tuple(await fetch_market(market))
            if not market_records[market]:
                raise ValueError(f"instrument identity market {market} returned no records")
        snapshot = await asyncio.to_thread(build_identity_snapshot, market_records)
        accepted_markets = {record.market for record in snapshot.records_by_code.values()}
        if accepted_markets != set(IDENTITY_MARKETS):
            raise ValueError("instrument identity refresh omitted a reviewed market")
        return await asyncio.to_thread(self._replace_snapshot, snapshot)

    async def refresh(self, client: Any) -> int:
        spec = TR_REGISTRY["ka10099"]

        async def fetch_market(market: str) -> Iterable[Mapping[str, Any]]:
            records: list[Mapping[str, Any]] = []
            options = RequestOptions()
            seen_keys: set[str] = set()
            while True:
                envelope = await client.post_with_headers(
                    "ka10099", spec.upstream_path, {"mrkt_tp": market}, options
                )
                return_code = normalize_return_code(envelope.body.get("return_code"))
                if return_code not in {"", "0"}:
                    raise ValueError("ka10099 returned a non-success return_code")
                response = Ka10099Response.model_validate(envelope.body)
                records.extend(item.model_dump(by_alias=True) for item in response.list_)
                if envelope.cont_yn != "Y":
                    return tuple(records)
                if not envelope.next_key or envelope.next_key in seen_keys:
                    raise ValueError("ka10099 continuation metadata is incomplete")
                seen_keys.add(envelope.next_key)
                options = RequestOptions(cont_yn="Y", next_key=envelope.next_key)

        return await self.refresh_from(fetch_market)

    def resolve(self, question: str) -> _ResolvedInstrument | None:
        text = unicodedata.normalize("NFKC", str(question)).casefold()
        if not text or _AMBIGUOUS_CONTEXT.search(text):
            return None
        explicit_codes = set(_EXPLICIT_CODE.findall(text))
        if len(explicit_codes) > 1:
            return None
        normalized_question = _normalize_identity(text)

        def candidates(connection: sqlite3.Connection):
            placeholders = ",".join("?" for _ in explicit_codes) or "NULL"
            connection.execute("BEGIN")
            try:
                rows = connection.execute(
                    "SELECT code, name, normalized_name, market_code, kind FROM instruments "
                    f"WHERE instr(?, normalized_name) > 0 OR code IN ({placeholders})",
                    (normalized_question, *sorted(explicit_codes)),
                ).fetchall()
                known_codes = {
                    row[0]
                    for row in connection.execute(
                        f"SELECT code FROM instruments WHERE code IN ({placeholders})",
                        tuple(sorted(explicit_codes)),
                    )
                }
                return rows, known_codes
            finally:
                connection.rollback()

        rows, known_codes = self._run(candidates)
        if explicit_codes != known_codes:
            return None
        matched_codes = set(explicit_codes)
        alias_matched = False
        by_code: dict[str, tuple[str, str, str]] = {}
        alias_codes: defaultdict[str, set[str]] = defaultdict(set)
        for code, name, normalized_name, market, kind in rows:
            by_code[code] = (name, market, kind)
            if normalized_name and _alias_pattern(normalized_name).search(text) is not None:
                alias_codes[normalized_name].add(code)
        for codes in alias_codes.values():
            if len(codes) != 1:
                return None
            alias_matched = True
            matched_codes.update(codes)
        if len(matched_codes) != 1:
            return None
        code = next(iter(matched_codes))
        record = by_code.get(code)
        if record is None:
            return None
        name, market, kind = record
        return _ResolvedInstrument(
            code=code,
            target=TargetResolution(EntityKind(kind)),
            identity_assisted=alias_matched,
            name=name,
            market=market,
        )

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
