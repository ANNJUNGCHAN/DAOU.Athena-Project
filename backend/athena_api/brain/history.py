"""Authoritative local chat/trade history and durable ingestion state."""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import StrEnum
from functools import partial
from pathlib import Path
from typing import Annotated, Any, Final
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .ontology import GraphId, LongText, SourceKind, SourceRecord

RAW_SCHEMA_VERSION: Final = 1
MAX_BATCH_SIZE: Final = 500
MAX_METADATA_BYTES: Final = 32_768


class ChatRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class TradeSide(StrEnum):
    BUY = "buy"
    SELL = "sell"


class JobTrigger(StrEnum):
    HOURLY = "hourly"
    MANUAL = "manual"
    RETRY = "retry"


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    RETRY_WAIT = "retry_wait"
    FAILED = "failed"


class RawHistoryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    @field_validator("occurred_at", check_fields=False)
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() != timedelta(0):
            raise ValueError("occurred_at must be UTC-aware")
        return value

    @field_validator("metadata", check_fields=False)
    @classmethod
    def validate_metadata(cls, value: dict[str, Any]) -> dict[str, Any]:
        _canonicalize_metadata(value)
        return value


class ChatHistoryRecord(RawHistoryModel):
    message_id: GraphId
    conversation_id: GraphId
    role: ChatRole
    text: LongText
    occurred_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


class CompletedTradeRecord(RawHistoryModel):
    trade_id: GraphId
    security_id: GraphId
    side: TradeSide
    quantity: Annotated[int, Field(strict=True, gt=0, le=10**12)]
    price: Annotated[Decimal, Field(strict=True, ge=0, max_digits=24, decimal_places=8)]
    occurred_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class HistoryUpsertResult:
    source_id: str
    fingerprint: str
    revision: int
    change_seq: int
    changed: bool


@dataclass(frozen=True, slots=True)
class StoredChatMessage:
    message_id: str
    conversation_id: str
    role: ChatRole
    text: str
    occurred_at: datetime


@dataclass(frozen=True, slots=True)
class SourceChange:
    seq: int
    revision: int
    record: SourceRecord


@dataclass(frozen=True, slots=True)
class IngestionJob:
    id: str
    trigger: JobTrigger
    status: JobStatus
    attempts: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    next_retry_at: datetime | None
    error: str | None


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_attempts: int = 3
    base_delay_seconds: float = 1.0
    max_delay_seconds: float = 300.0

    def __post_init__(self) -> None:
        if not 1 <= self.max_attempts <= 20:
            raise ValueError("max_attempts must be between 1 and 20")
        if self.base_delay_seconds <= 0:
            raise ValueError("base_delay_seconds must be positive")
        if self.max_delay_seconds < self.base_delay_seconds:
            raise ValueError("max_delay_seconds must be at least base_delay_seconds")

    def delay_for_attempt(self, attempt: int) -> timedelta:
        exponent = max(0, attempt - 1)
        seconds = min(self.max_delay_seconds, self.base_delay_seconds * (2**exponent))
        return timedelta(seconds=seconds)


_SCHEMA: Final = """
CREATE TABLE IF NOT EXISTS schema_version (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS source_records (
    source_id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    text TEXT NOT NULL,
    locator TEXT,
    occurred_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    text TEXT NOT NULL,
    locator TEXT,
    occurred_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    revision INTEGER NOT NULL,
    changed_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES source_records(source_id)
);
CREATE INDEX IF NOT EXISTS source_changes_kind_seq
    ON source_changes(source_kind, seq);
CREATE TABLE IF NOT EXISTS adapter_cursors (
    adapter_name TEXT PRIMARY KEY,
    last_seq INTEGER NOT NULL CHECK (last_seq >= 0)
);
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    job_id TEXT PRIMARY KEY,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    next_retry_at TEXT,
    error TEXT
);
CREATE INDEX IF NOT EXISTS ingestion_jobs_due
    ON ingestion_jobs(status, next_retry_at, created_at);
CREATE TABLE IF NOT EXISTS ingestion_attempts (
    attempt_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error TEXT,
    FOREIGN KEY (job_id) REFERENCES ingestion_jobs(job_id),
    UNIQUE(job_id, attempt)
);
"""


def utc_now() -> datetime:
    return datetime.now(UTC)


def _timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _parse_timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _canonicalize_metadata(value: dict[str, Any]) -> dict[str, Any]:
    try:
        encoded = _canonical_json(value).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("metadata must contain only JSON-safe values") from exc
    if len(encoded) > MAX_METADATA_BYTES:
        raise ValueError(f"metadata must not exceed {MAX_METADATA_BYTES} bytes")
    return json.loads(encoded)


def _fingerprint(payload: dict[str, Any]) -> str:
    digest = hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


class HistoryStore:
    """Serialize one sqlite3 connection on a dedicated worker thread."""

    def __init__(self, path: Path, *, busy_timeout_ms: int = 5_000) -> None:
        if busy_timeout_ms <= 0:
            raise ValueError("busy_timeout_ms must be positive")
        self.path = Path(path)
        self._busy_timeout_ms = busy_timeout_ms
        self._connection: sqlite3.Connection | None = None
        self._lock = asyncio.Lock()
        self._owner = ThreadPoolExecutor(max_workers=1, thread_name_prefix="athena-history")
        self._open_future: asyncio.Future[Any] | None = None
        self._close_future: asyncio.Future[Any] | None = None
        self._closed = False

    @property
    def is_open(self) -> bool:
        return self._connection is not None and not self._closed

    def _submit(self, function: Any, *args: Any) -> asyncio.Future[Any]:
        return asyncio.get_running_loop().run_in_executor(self._owner, partial(function, *args))

    async def open(self) -> None:
        async with self._lock:
            if self._closed:
                raise RuntimeError("history store is closed")
            if self._connection is not None:
                return
            if self._open_future is None:
                self._open_future = self._submit(self._open_sync)
            try:
                await asyncio.shield(self._open_future)
            except asyncio.CancelledError:
                raise
            except Exception:
                self._open_future = None
                raise

    def _open_sync(self) -> None:
        if self._connection is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, isolation_level=None)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute(f"PRAGMA busy_timeout = {self._busy_timeout_ms:d}")
            connection.executescript(_SCHEMA)
            row = connection.execute(
                "SELECT version FROM schema_version WHERE singleton = ?", (1,)
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO schema_version(singleton, version) VALUES (?, ?)",
                    (1, RAW_SCHEMA_VERSION),
                )
            elif int(row["version"]) != RAW_SCHEMA_VERSION:
                raise RuntimeError(f"unsupported raw schema version: {row['version']}")
        except Exception:
            connection.close()
            raise
        self._connection = connection

    async def close(self) -> None:
        async with self._lock:
            if self._close_future is None:
                self._closed = True
                self._close_future = self._submit(self._close_sync)
            future = self._close_future
        try:
            await asyncio.shield(future)
        finally:
            self._owner.shutdown(wait=False, cancel_futures=False)

    def _close_sync(self) -> None:
        try:
            if self._connection is not None:
                self._connection.close()
        finally:
            self._connection = None

    async def _call(self, function: Any, *args: Any) -> Any:
        async with self._lock:
            if not self.is_open:
                raise RuntimeError("history store is not open")
            return await asyncio.shield(self._submit(function, *args))

    def _db(self) -> sqlite3.Connection:
        if self._connection is None or self._closed:
            raise RuntimeError("history store is not open")
        return self._connection

    async def schema_version(self) -> int:
        return await self._call(self._schema_version_sync)

    def _schema_version_sync(self) -> int:
        row = (
            self._db()
            .execute("SELECT version FROM schema_version WHERE singleton = ?", (1,))
            .fetchone()
        )
        if row is None:
            raise RuntimeError("raw schema metadata is missing")
        return int(row["version"])

    async def upsert_chat(
        self, record: ChatHistoryRecord, *, changed_at: datetime | None = None
    ) -> HistoryUpsertResult:
        metadata = _canonicalize_metadata(record.metadata)
        attributes = {
            "chat": {
                "conversation_id": record.conversation_id,
                "role": record.role.value,
            },
            "metadata": metadata,
        }
        return await self._upsert_source(
            source_id=f"chat:{record.message_id}",
            source_kind=SourceKind.CHAT_MESSAGE,
            text=record.text,
            locator=f"conversation:{record.conversation_id}",
            occurred_at=record.occurred_at,
            attributes=attributes,
            changed_at=changed_at or utc_now(),
        )

    async def upsert_completed_trade(
        self, record: CompletedTradeRecord, *, changed_at: datetime | None = None
    ) -> HistoryUpsertResult:
        metadata = _canonicalize_metadata(record.metadata)
        attributes = {
            "trade": {
                "security_id": record.security_id,
                "side": record.side.value,
                "quantity": record.quantity,
                "price": str(record.price),
                "completed": True,
            },
            "metadata": metadata,
        }
        text = (
            f"completed {record.side.value} {record.security_id} "
            f"quantity={record.quantity} price={record.price}"
        )
        return await self._upsert_source(
            source_id=f"trade:{record.trade_id}",
            source_kind=SourceKind.TRADE,
            text=text,
            locator=f"completed-trade:{record.trade_id}",
            occurred_at=record.occurred_at,
            attributes=attributes,
            changed_at=changed_at or utc_now(),
        )

    async def _upsert_source(
        self,
        *,
        source_id: str,
        source_kind: SourceKind,
        text: str,
        locator: str,
        occurred_at: datetime,
        attributes: dict[str, Any],
        changed_at: datetime,
    ) -> HistoryUpsertResult:
        if changed_at.tzinfo is None or changed_at.utcoffset() != timedelta(0):
            raise ValueError("changed_at must be UTC-aware")
        metadata_json = _canonical_json(attributes)
        fingerprint = _fingerprint(
            {
                "source_id": source_id,
                "source_kind": source_kind.value,
                "text": text,
                "locator": locator,
                "occurred_at": _timestamp(occurred_at),
                "attributes": attributes,
            }
        )
        return await self._call(
            self._upsert_source_sync,
            source_id,
            source_kind.value,
            text,
            locator,
            _timestamp(occurred_at),
            metadata_json,
            fingerprint,
            _timestamp(changed_at),
        )

    def _upsert_source_sync(
        self,
        source_id: str,
        source_kind: str,
        text: str,
        locator: str,
        occurred_at: str,
        metadata_json: str,
        fingerprint: str,
        changed_at: str,
    ) -> HistoryUpsertResult:
        connection = self._db()
        connection.execute("BEGIN IMMEDIATE")
        try:
            current = connection.execute(
                "SELECT fingerprint, revision FROM source_records WHERE source_id = ?",
                (source_id,),
            ).fetchone()
            if current is not None and current["fingerprint"] == fingerprint:
                latest = connection.execute(
                    "SELECT seq FROM source_changes WHERE source_id = ? ORDER BY seq DESC LIMIT ?",
                    (source_id, 1),
                ).fetchone()
                connection.execute("COMMIT")
                return HistoryUpsertResult(
                    source_id=source_id,
                    fingerprint=fingerprint,
                    revision=int(current["revision"]),
                    change_seq=int(latest["seq"]),
                    changed=False,
                )
            revision = 1 if current is None else int(current["revision"]) + 1
            connection.execute(
                "INSERT INTO source_records("
                "source_id, source_kind, text, locator, occurred_at, metadata_json, "
                "fingerprint, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(source_id) DO UPDATE SET "
                "source_kind=excluded.source_kind, text=excluded.text, "
                "locator=excluded.locator, occurred_at=excluded.occurred_at, "
                "metadata_json=excluded.metadata_json, fingerprint=excluded.fingerprint, "
                "revision=excluded.revision, updated_at=excluded.updated_at",
                (
                    source_id,
                    source_kind,
                    text,
                    locator,
                    occurred_at,
                    metadata_json,
                    fingerprint,
                    revision,
                    changed_at,
                ),
            )
            cursor = connection.execute(
                "INSERT INTO source_changes("
                "source_id, source_kind, text, locator, occurred_at, metadata_json, "
                "fingerprint, revision, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    source_id,
                    source_kind,
                    text,
                    locator,
                    occurred_at,
                    metadata_json,
                    fingerprint,
                    revision,
                    changed_at,
                ),
            )
            connection.execute("COMMIT")
            return HistoryUpsertResult(
                source_id=source_id,
                fingerprint=fingerprint,
                revision=revision,
                change_seq=int(cursor.lastrowid),
                changed=True,
            )
        except BaseException:
            connection.execute("ROLLBACK")
            raise

    async def chat_changes(self, after_seq: int, *, limit: int) -> tuple[SourceChange, ...]:
        return await self._changes(SourceKind.CHAT_MESSAGE, after_seq, limit)

    async def trade_changes(self, after_seq: int, *, limit: int) -> tuple[SourceChange, ...]:
        return await self._changes(SourceKind.TRADE, after_seq, limit)

    async def _changes(
        self, source_kind: SourceKind, after_seq: int, limit: int
    ) -> tuple[SourceChange, ...]:
        if after_seq < 0:
            raise ValueError("after_seq must not be negative")
        if not 1 <= limit <= MAX_BATCH_SIZE:
            raise ValueError(f"limit must be between 1 and {MAX_BATCH_SIZE}")
        return await self._call(self._changes_sync, source_kind.value, after_seq, limit)

    def _changes_sync(
        self, source_kind: str, after_seq: int, limit: int
    ) -> tuple[SourceChange, ...]:
        rows = (
            self._db()
            .execute(
                "SELECT seq, source_id, source_kind, text, locator, occurred_at, "
                "metadata_json, fingerprint, revision, changed_at FROM source_changes "
                "WHERE source_kind = ? AND seq > ? ORDER BY seq LIMIT ?",
                (source_kind, after_seq, limit),
            )
            .fetchall()
        )
        return tuple(self._row_to_change(row) for row in rows)

    @staticmethod
    def _row_to_change(row: sqlite3.Row) -> SourceChange:
        return SourceChange(
            seq=int(row["seq"]),
            revision=int(row["revision"]),
            record=SourceRecord(
                id=row["source_id"],
                kind=SourceKind(row["source_kind"]),
                text=row["text"],
                locator=row["locator"],
                fingerprint=row["fingerprint"],
                attributes=json.loads(row["metadata_json"]),
                occurred_at=_parse_timestamp(row["occurred_at"]),
                ingested_at=_parse_timestamp(row["changed_at"]),
            ),
        )

    async def chats_for_conversation(
        self, conversation_id: str, *, limit: int = 100
    ) -> tuple[StoredChatMessage, ...]:
        """Read back stored chat turns for one conversation, oldest first.

        Reads ``source_records`` (current revision only, not the append-only change
        log) filtered by the same ``locator`` upsert_chat writes -- no separate chat
        table, no duplicate write path.
        """
        if not conversation_id.strip():
            raise ValueError("conversation_id must not be blank")
        if not 1 <= limit <= MAX_BATCH_SIZE:
            raise ValueError(f"limit must be between 1 and {MAX_BATCH_SIZE}")
        return await self._call(self._chats_for_conversation_sync, conversation_id, limit)

    def _chats_for_conversation_sync(
        self, conversation_id: str, limit: int
    ) -> tuple[StoredChatMessage, ...]:
        rows = (
            self._db()
            .execute(
                "SELECT source_id, text, occurred_at, metadata_json FROM source_records "
                "WHERE source_kind = ? AND locator = ? ORDER BY occurred_at, source_id LIMIT ?",
                (SourceKind.CHAT_MESSAGE.value, f"conversation:{conversation_id}", limit),
            )
            .fetchall()
        )
        return tuple(self._row_to_chat_message(conversation_id, row) for row in rows)

    @staticmethod
    def _row_to_chat_message(conversation_id: str, row: sqlite3.Row) -> StoredChatMessage:
        source_id = str(row["source_id"])
        message_id = source_id.removeprefix("chat:")
        attributes = json.loads(row["metadata_json"])
        chat = attributes["chat"]
        return StoredChatMessage(
            message_id=message_id,
            conversation_id=conversation_id,
            role=ChatRole(chat["role"]),
            text=str(row["text"]),
            occurred_at=_parse_timestamp(row["occurred_at"]),
        )

    async def cursor(self, adapter_name: str) -> int:
        _validate_adapter_name(adapter_name)
        return await self._call(self._cursor_sync, adapter_name)

    def _cursor_sync(self, adapter_name: str) -> int:
        row = (
            self._db()
            .execute(
                "SELECT last_seq FROM adapter_cursors WHERE adapter_name = ?",
                (adapter_name,),
            )
            .fetchone()
        )
        return 0 if row is None else int(row["last_seq"])

    async def advance_cursor(self, adapter_name: str, seq: int) -> int:
        _validate_adapter_name(adapter_name)
        if seq <= 0:
            raise ValueError("seq must be positive")
        return await self._call(self._advance_cursor_sync, adapter_name, seq)

    def _advance_cursor_sync(self, adapter_name: str, seq: int) -> int:
        connection = self._db()
        connection.execute(
            "INSERT INTO adapter_cursors(adapter_name, last_seq) VALUES (?, ?) "
            "ON CONFLICT(adapter_name) DO UPDATE SET "
            "last_seq = MAX(adapter_cursors.last_seq, excluded.last_seq)",
            (adapter_name, seq),
        )
        return self._cursor_sync(adapter_name)

    async def reset_cursor(self, adapter_name: str) -> None:
        """Reset derived projection progress without deleting raw history."""
        _validate_adapter_name(adapter_name)
        await self._call(self._reset_cursor_sync, adapter_name)

    def _reset_cursor_sync(self, adapter_name: str) -> None:
        self._db().execute("DELETE FROM adapter_cursors WHERE adapter_name = ?", (adapter_name,))

    async def reset_cursors(self, adapter_names: tuple[str, ...]) -> None:
        if not adapter_names:
            raise ValueError("adapter_names must not be empty")
        for adapter_name in adapter_names:
            _validate_adapter_name(adapter_name)
        await self._call(self._reset_cursors_sync, tuple(sorted(set(adapter_names))))

    def _reset_cursors_sync(self, adapter_names: tuple[str, ...]) -> None:
        connection = self._db()
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.executemany(
                "DELETE FROM adapter_cursors WHERE adapter_name = ?",
                ((adapter_name,) for adapter_name in adapter_names),
            )
            connection.execute("COMMIT")
        except BaseException:
            connection.execute("ROLLBACK")
            raise

    async def create_job(self, trigger: JobTrigger, *, now: datetime | None = None) -> IngestionJob:
        created_at = now or utc_now()
        _require_utc(created_at, "now")
        job_id = f"job:{uuid4().hex}"
        return await self._call(
            self._create_job_sync, job_id, trigger.value, _timestamp(created_at)
        )

    def _create_job_sync(self, job_id: str, trigger: str, created_at: str) -> IngestionJob:
        self._db().execute(
            "INSERT INTO ingestion_jobs("
            "job_id, trigger, status, attempts, created_at) VALUES (?, ?, ?, ?, ?)",
            (job_id, trigger, JobStatus.PENDING.value, 0, created_at),
        )
        return self._get_job_sync(job_id)

    async def get_job(self, job_id: str) -> IngestionJob | None:
        return await self._call(self._get_job_optional_sync, job_id)

    def _get_job_optional_sync(self, job_id: str) -> IngestionJob | None:
        row = (
            self._db()
            .execute("SELECT * FROM ingestion_jobs WHERE job_id = ?", (job_id,))
            .fetchone()
        )
        return None if row is None else _row_to_job(row)

    def _get_job_sync(self, job_id: str) -> IngestionJob:
        job = self._get_job_optional_sync(job_id)
        if job is None:
            raise ValueError(f"unknown ingestion job: {job_id}")
        return job

    async def claim_due_job(self, *, now: datetime | None = None) -> IngestionJob | None:
        claimed_at = now or utc_now()
        _require_utc(claimed_at, "now")
        return await self._call(self._claim_due_job_sync, _timestamp(claimed_at))

    async def due_job_ids(
        self, *, now: datetime | None = None, limit: int = 100
    ) -> tuple[str, ...]:
        due_at = now or utc_now()
        _require_utc(due_at, "now")
        if not 1 <= limit <= 1_000:
            raise ValueError("limit must be between 1 and 1000")
        return await self._call(self._due_job_ids_sync, _timestamp(due_at), limit)

    def _due_job_ids_sync(self, due_at: str, limit: int) -> tuple[str, ...]:
        rows = (
            self._db()
            .execute(
                "SELECT job_id FROM ingestion_jobs "
                "WHERE status = ? OR (status = ? AND next_retry_at <= ?) "
                "ORDER BY created_at, job_id LIMIT ?",
                (JobStatus.PENDING.value, JobStatus.RETRY_WAIT.value, due_at, limit),
            )
            .fetchall()
        )
        return tuple(str(row["job_id"]) for row in rows)

    async def claim_job(self, job_id: str, *, now: datetime | None = None) -> IngestionJob | None:
        claimed_at = now or utc_now()
        _require_utc(claimed_at, "now")
        return await self._call(self._claim_job_sync, job_id, _timestamp(claimed_at))

    def _claim_job_sync(self, job_id: str, claimed_at: str) -> IngestionJob | None:
        connection = self._db()
        connection.execute("BEGIN IMMEDIATE")
        try:
            row = connection.execute(
                "SELECT job_id, attempts FROM ingestion_jobs WHERE job_id = ? "
                "AND (status = ? OR (status = ? AND next_retry_at <= ?))",
                (
                    job_id,
                    JobStatus.PENDING.value,
                    JobStatus.RETRY_WAIT.value,
                    claimed_at,
                ),
            ).fetchone()
            if row is None:
                connection.execute("COMMIT")
                return None
            result = self._mark_job_running_sync(connection, row, claimed_at)
            connection.execute("COMMIT")
            return result
        except BaseException:
            connection.execute("ROLLBACK")
            raise

    def _claim_due_job_sync(self, claimed_at: str) -> IngestionJob | None:
        connection = self._db()
        connection.execute("BEGIN IMMEDIATE")
        try:
            row = connection.execute(
                "SELECT job_id, attempts FROM ingestion_jobs "
                "WHERE status = ? OR (status = ? AND next_retry_at <= ?) "
                "ORDER BY created_at, job_id LIMIT ?",
                (
                    JobStatus.PENDING.value,
                    JobStatus.RETRY_WAIT.value,
                    claimed_at,
                    1,
                ),
            ).fetchone()
            if row is None:
                connection.execute("COMMIT")
                return None
            result = self._mark_job_running_sync(connection, row, claimed_at)
            connection.execute("COMMIT")
            return result
        except BaseException:
            connection.execute("ROLLBACK")
            raise

    def _mark_job_running_sync(
        self, connection: sqlite3.Connection, row: sqlite3.Row, claimed_at: str
    ) -> IngestionJob:
        attempt = int(row["attempts"]) + 1
        connection.execute(
            "UPDATE ingestion_jobs SET status = ?, attempts = ?, started_at = ?, "
            "completed_at = NULL, next_retry_at = NULL, error = NULL WHERE job_id = ?",
            (JobStatus.RUNNING.value, attempt, claimed_at, row["job_id"]),
        )
        connection.execute(
            "INSERT INTO ingestion_attempts("
            "job_id, attempt, status, started_at) VALUES (?, ?, ?, ?)",
            (row["job_id"], attempt, JobStatus.RUNNING.value, claimed_at),
        )
        return self._get_job_sync(row["job_id"])

    async def succeed_job(self, job_id: str, *, now: datetime | None = None) -> IngestionJob:
        completed_at = now or utc_now()
        _require_utc(completed_at, "now")
        return await self._call(
            self._finish_job_sync,
            job_id,
            JobStatus.SUCCEEDED.value,
            _timestamp(completed_at),
            None,
            None,
        )

    async def fail_job(
        self,
        job_id: str,
        error: str,
        policy: RetryPolicy,
        *,
        now: datetime | None = None,
    ) -> IngestionJob:
        failed_at = now or utc_now()
        _require_utc(failed_at, "now")
        current = await self.get_job(job_id)
        if current is None or current.status is not JobStatus.RUNNING:
            raise ValueError("only a running job can fail")
        if current.attempts < policy.max_attempts:
            status = JobStatus.RETRY_WAIT
            next_retry = failed_at + policy.delay_for_attempt(current.attempts)
            completed_at = None
        else:
            status = JobStatus.FAILED
            next_retry = None
            completed_at = failed_at
        return await self._call(
            self._finish_job_sync,
            job_id,
            status.value,
            _timestamp(failed_at),
            _timestamp(next_retry) if next_retry else None,
            error[:2_000],
            _timestamp(completed_at) if completed_at else None,
        )

    def _finish_job_sync(
        self,
        job_id: str,
        status: str,
        attempt_completed_at: str,
        next_retry_at: str | None,
        error: str | None,
        job_completed_at: str | None = None,
    ) -> IngestionJob:
        connection = self._db()
        connection.execute("BEGIN IMMEDIATE")
        try:
            job = self._get_job_sync(job_id)
            if job.status is not JobStatus.RUNNING:
                raise ValueError("only a running job can be completed")
            completed_at = (
                attempt_completed_at if status == JobStatus.SUCCEEDED.value else job_completed_at
            )
            connection.execute(
                "UPDATE ingestion_jobs SET status = ?, completed_at = ?, "
                "next_retry_at = ?, error = ? WHERE job_id = ?",
                (status, completed_at, next_retry_at, error, job_id),
            )
            connection.execute(
                "UPDATE ingestion_attempts SET status = ?, completed_at = ?, error = ? "
                "WHERE job_id = ? AND attempt = ?",
                (status, attempt_completed_at, error, job_id, job.attempts),
            )
            connection.execute("COMMIT")
            return self._get_job_sync(job_id)
        except BaseException:
            connection.execute("ROLLBACK")
            raise

    async def recover_stale_jobs(
        self,
        policy: RetryPolicy,
        *,
        now: datetime | None = None,
        stale_after: timedelta = timedelta(minutes=10),
    ) -> int:
        recovered_at = now or utc_now()
        _require_utc(recovered_at, "now")
        if stale_after <= timedelta(0):
            raise ValueError("stale_after must be positive")
        threshold = recovered_at - stale_after
        return await self._call(
            self._recover_stale_jobs_sync,
            _timestamp(threshold),
            recovered_at,
            policy,
        )

    def _recover_stale_jobs_sync(
        self, threshold: str, recovered_at: datetime, policy: RetryPolicy
    ) -> int:
        connection = self._db()
        connection.execute("BEGIN IMMEDIATE")
        try:
            rows = connection.execute(
                "SELECT job_id, attempts FROM ingestion_jobs "
                "WHERE status = ? AND started_at <= ? ORDER BY job_id",
                (JobStatus.RUNNING.value, threshold),
            ).fetchall()
            for row in rows:
                error = "recovered stale running job after restart"
                terminal = int(row["attempts"]) >= policy.max_attempts
                status = JobStatus.FAILED if terminal else JobStatus.RETRY_WAIT
                next_retry_at = (
                    None
                    if terminal
                    else _timestamp(recovered_at + policy.delay_for_attempt(int(row["attempts"])))
                )
                completed_at = _timestamp(recovered_at) if terminal else None
                connection.execute(
                    "UPDATE ingestion_jobs SET status = ?, completed_at = ?, "
                    "next_retry_at = ?, error = ? WHERE job_id = ?",
                    (
                        status.value,
                        completed_at,
                        next_retry_at,
                        error,
                        row["job_id"],
                    ),
                )
                connection.execute(
                    "UPDATE ingestion_attempts SET status = ?, completed_at = ?, error = ? "
                    "WHERE job_id = ? AND attempt = ?",
                    (
                        status.value,
                        _timestamp(recovered_at),
                        error,
                        row["job_id"],
                        row["attempts"],
                    ),
                )
            connection.execute("COMMIT")
            return len(rows)
        except BaseException:
            connection.execute("ROLLBACK")
            raise


def _validate_adapter_name(value: str) -> None:
    if (
        not value
        or len(value) > 64
        or not all(
            character.isascii() and (character.isalnum() or character in "_-")
            for character in value
        )
    ):
        raise ValueError("adapter_name must be a bounded ASCII identifier")


def _require_utc(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise ValueError(f"{name} must be UTC-aware")


def _row_to_job(row: sqlite3.Row) -> IngestionJob:
    return IngestionJob(
        id=row["job_id"],
        trigger=JobTrigger(row["trigger"]),
        status=JobStatus(row["status"]),
        attempts=int(row["attempts"]),
        created_at=_parse_timestamp(row["created_at"]),
        started_at=_parse_timestamp(row["started_at"]),
        completed_at=_parse_timestamp(row["completed_at"]),
        next_retry_at=_parse_timestamp(row["next_retry_at"]),
        error=row["error"],
    )
