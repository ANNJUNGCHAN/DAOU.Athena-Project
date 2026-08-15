"""Validated, explicitly injected structured extraction for one source record."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import unicodedata
from collections.abc import Callable
from contextlib import suppress
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal, Protocol, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from .history import utc_now
from .ontology import (
    Claim,
    ClaimKind,
    Entity,
    EntityKind,
    Relation,
    RelationKind,
    SourceRecord,
)

MAX_RESPONSE_BYTES = 262_144
MAX_REQUEST_BYTES = 64_000
MAX_ATTRIBUTE_BYTES = 32_768
_LOCAL_REF = Annotated[
    str,
    StringConstraints(
        strict=True, min_length=1, max_length=64, pattern=r"^[A-Za-z][A-Za-z0-9_-]*$"
    ),
]
_NAME = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=256)]
_DESCRIPTION = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=2_000)]
_STATEMENT = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=10_000)]
_CONFIDENCE = Annotated[float, Field(strict=True, ge=0.0, le=1.0)]
_FORBIDDEN_ATTRIBUTE_KEYS = {
    "id",
    "source_id",
    "source_ids",
    "db_id",
    "cypher",
    "sql",
    "query",
    "query_text",
    "table",
    "table_name",
    "command",
    "argv",
}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise ValueError("timestamp must be UTC-aware")
    return value


def _validate_attributes(value: dict[str, Any]) -> dict[str, Any]:
    def inspect(item: Any, *, depth: int = 0) -> None:
        if depth > 8:
            raise ValueError("attributes nesting is too deep")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or not key or len(key) > 128:
                    raise ValueError("attribute keys must be bounded strings")
                if key.casefold() in _FORBIDDEN_ATTRIBUTE_KEYS:
                    raise ValueError("attributes contain a reserved field")
                inspect(child, depth=depth + 1)
        elif isinstance(item, (list, tuple)):
            for child in item:
                inspect(child, depth=depth + 1)
        elif item is not None and not isinstance(item, (str, int, float, bool)):
            raise ValueError("attributes must contain only JSON-safe values")

    inspect(value)
    try:
        encoded = json.dumps(
            value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError("attributes must contain only JSON-safe values") from exc
    if len(encoded) > MAX_ATTRIBUTE_BYTES:
        raise ValueError("attributes exceed the size limit")
    return value


class _OutputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    @field_validator("attributes", check_fields=False)
    @classmethod
    def validate_attributes(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_attributes(value)

    @field_validator("observed_at", check_fields=False)
    @classmethod
    def validate_timestamp(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_validator("name", "description", "statement", check_fields=False)
    @classmethod
    def reject_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("text must not be blank")
        return value


class ExtractedEntity(_OutputModel):
    ref: _LOCAL_REF
    kind: EntityKind
    name: _NAME
    aliases: Annotated[tuple[_NAME, ...], Field(max_length=32)] = ()
    description: _DESCRIPTION | None = None
    confidence: _CONFIDENCE
    attributes: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_aliases(self) -> Self:
        normalized = [_normalize_identity(alias) for alias in self.aliases]
        if len(set(normalized)) != len(normalized):
            raise ValueError("aliases must be unique")
        return self


class ExtractedRelation(_OutputModel):
    ref: _LOCAL_REF
    kind: RelationKind
    source_ref: _LOCAL_REF
    target_ref: _LOCAL_REF
    confidence: _CONFIDENCE
    observed_at: datetime
    attributes: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def different_endpoints(self) -> Self:
        if self.source_ref == self.target_ref:
            raise ValueError("relation endpoints must differ")
        return self


class ExtractedClaim(_OutputModel):
    ref: _LOCAL_REF
    kind: ClaimKind
    statement: _STATEMENT
    confidence: _CONFIDENCE
    observed_at: datetime
    about_refs: Annotated[tuple[_LOCAL_REF, ...], Field(min_length=1, max_length=32)]
    attributes: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def unique_about_refs(self) -> Self:
        if len(set(self.about_refs)) != len(self.about_refs):
            raise ValueError("about_refs must be unique")
        return self


class ExtractionEnvelopeV1(_OutputModel):
    schema_version: Literal[1]
    request_id: Annotated[str, StringConstraints(strict=True, min_length=64, max_length=64)]
    source_fingerprint: Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128)]
    entities: Annotated[tuple[ExtractedEntity, ...], Field(max_length=64)] = ()
    relations: Annotated[tuple[ExtractedRelation, ...], Field(max_length=128)] = ()
    claims: Annotated[tuple[ExtractedClaim, ...], Field(max_length=128)] = ()

    @model_validator(mode="after")
    def validate_refs(self) -> Self:
        entity_refs = [entity.ref for entity in self.entities]
        relation_refs = [relation.ref for relation in self.relations]
        claim_refs = [claim.ref for claim in self.claims]
        all_refs = entity_refs + relation_refs + claim_refs
        if len(set(all_refs)) != len(all_refs):
            raise ValueError("local refs must be globally unique")
        known = set(entity_refs)
        for relation in self.relations:
            if relation.source_ref not in known or relation.target_ref not in known:
                raise ValueError("relation refs must resolve to entities")
        for claim in self.claims:
            if not set(claim.about_refs) <= known:
                raise ValueError("claim refs must resolve to entities")
        return self


class ExtractionRequestV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    schema_version: Literal[1] = 1
    request_id: str
    source_fingerprint: str
    source_kind: str
    text: str
    occurred_at: datetime


class StructuredLlmClient(Protocol):
    async def complete(self, request_json: bytes) -> bytes: ...


class ExtractionError(RuntimeError):
    """Sanitized extraction failure safe for durable job state."""


class ExtractionProjection(Protocol):
    async def apply_extraction(
        self,
        source_id: str,
        source_fingerprint: str,
        entities: tuple[Entity, ...],
        relations: tuple[Relation, ...],
        claims: tuple[Claim, ...],
    ) -> None: ...


class LocalCommandStructuredLlm:
    """Run only an explicitly supplied argv, with JSON over stdin/stdout."""

    def __init__(
        self,
        argv: tuple[str, ...],
        *,
        timeout_seconds: float = 30.0,
        max_response_bytes: int = MAX_RESPONSE_BYTES,
    ) -> None:
        if (
            not isinstance(argv, tuple)
            or not argv
            or any(not isinstance(part, str) or not part for part in argv)
        ):
            raise ValueError("argv must be a non-empty tuple of non-empty strings")
        if not 0.01 <= timeout_seconds <= 600:
            raise ValueError("timeout_seconds must be between 0.01 and 600")
        if not 1 <= max_response_bytes <= MAX_RESPONSE_BYTES:
            raise ValueError("max_response_bytes is out of bounds")
        self._argv = argv
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes

    async def complete(self, request_json: bytes) -> bytes:
        if len(request_json) > MAX_REQUEST_BYTES:
            raise ValueError("structured extraction request exceeds the size limit")
        try:
            process = await asyncio.create_subprocess_exec(
                *self._argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            raise RuntimeError("structured extraction command could not start") from exc

        async def feed_stdin() -> None:
            assert process.stdin is not None
            process.stdin.write(request_json)
            await process.stdin.drain()
            process.stdin.close()

        async def read_stdout() -> bytes:
            assert process.stdout is not None
            chunks: list[bytes] = []
            size = 0
            while chunk := await process.stdout.read(16_384):
                size += len(chunk)
                if size > self._max_response_bytes:
                    raise OverflowError
                chunks.append(chunk)
            return b"".join(chunks)

        async def drain_stderr() -> None:
            assert process.stderr is not None
            while await process.stderr.read(16_384):
                pass

        operation = asyncio.gather(
            feed_stdin(),
            read_stdout(),
            drain_stderr(),
            process.wait(),
        )

        async def terminate() -> None:
            operation.cancel()
            if process.returncode is None:
                process.kill()
            await process.wait()
            with suppress(Exception, asyncio.CancelledError):
                await operation

        try:
            _, stdout, _, _ = await asyncio.wait_for(operation, timeout=self._timeout_seconds)
        except OverflowError as exc:
            await terminate()
            raise RuntimeError("structured extraction response exceeds the size limit") from exc
        except TimeoutError as exc:
            await terminate()
            raise RuntimeError("structured extraction command timed out") from exc
        except asyncio.CancelledError:
            await terminate()
            raise
        except Exception as exc:
            await terminate()
            raise RuntimeError("structured extraction command failed") from exc
        if process.returncode != 0:
            raise RuntimeError("structured extraction command failed")
        return stdout


def _normalize_identity(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"\s+", " ", normalized).strip()


def _stable_id(prefix: str, *parts: str) -> str:
    canonical = json.dumps(parts, ensure_ascii=False, separators=(",", ":"))
    return f"{prefix}:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def extraction_request_id(source: SourceRecord) -> str:
    return hashlib.sha256(f"{source.id}\0{source.fingerprint}".encode()).hexdigest()


def parse_extraction_response(
    payload: bytes,
    *,
    expected_request_id: str,
    expected_source_fingerprint: str,
) -> ExtractionEnvelopeV1:
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("structured extraction response exceeds the size limit")
    try:
        text = payload.decode("utf-8")

        def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate JSON object key")
                result[key] = value
            return result

        raw = json.loads(text, object_pairs_hook=reject_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("structured extraction response must be one JSON object") from exc
    if not isinstance(raw, dict):
        raise ValueError("structured extraction response must be one JSON object")
    envelope = ExtractionEnvelopeV1.model_validate_json(payload)
    if envelope.request_id != expected_request_id:
        raise ValueError("structured extraction response request binding mismatch")
    if envelope.source_fingerprint != expected_source_fingerprint:
        raise ValueError("structured extraction response source binding mismatch")
    return envelope


class ExtractionService:
    def __init__(
        self,
        client: StructuredLlmClient,
        graph: ExtractionProjection,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._client = client
        self._graph = graph
        self._clock = clock

    async def project_source(self, source: SourceRecord) -> None:
        request_id = extraction_request_id(source)
        request = ExtractionRequestV1(
            request_id=request_id,
            source_fingerprint=source.fingerprint,
            source_kind=source.kind.value,
            text=source.text,
            occurred_at=source.occurred_at,
        )
        request_json = request.model_dump_json().encode("utf-8")
        if len(request_json) > MAX_REQUEST_BYTES:
            raise ValueError("structured extraction request exceeds the size limit")
        try:
            response = await self._client.complete(request_json)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise ExtractionError("structured extraction request failed") from exc
        try:
            envelope = parse_extraction_response(
                response,
                expected_request_id=request_id,
                expected_source_fingerprint=source.fingerprint,
            )
        except (ValueError, TypeError) as exc:
            raise ExtractionError("structured extraction response was invalid") from exc
        try:
            entities, relations, claims = self._build_records(source, envelope)
        except (ValueError, TypeError) as exc:
            raise ExtractionError("structured extraction response was invalid") from exc
        await self._graph.apply_extraction(
            source.id,
            source.fingerprint,
            entities,
            relations,
            claims,
        )

    def _build_records(
        self, source: SourceRecord, envelope: ExtractionEnvelopeV1
    ) -> tuple[tuple[Entity, ...], tuple[Relation, ...], tuple[Claim, ...]]:
        extracted_at = _utc(self._clock())
        ref_ids = {
            item.ref: _stable_id("entity", item.kind.value, _normalize_identity(item.name))
            for item in envelope.entities
        }
        entities = tuple(
            Entity(
                id=ref_ids[item.ref],
                kind=item.kind,
                name=item.name,
                aliases=item.aliases,
                attributes={
                    **item.attributes,
                    "extraction_confidence": item.confidence,
                    **({"description": item.description} if item.description else {}),
                },
                created_at=extracted_at,
                updated_at=extracted_at,
            )
            for item in envelope.entities
        )
        relations = tuple(
            Relation(
                id=_stable_id(
                    "relation",
                    source.fingerprint,
                    item.ref,
                    item.kind.value,
                    ref_ids[item.source_ref],
                    ref_ids[item.target_ref],
                ),
                kind=item.kind,
                source_entity_id=ref_ids[item.source_ref],
                target_entity_id=ref_ids[item.target_ref],
                confidence=item.confidence,
                source_ids=(source.id,),
                attributes=item.attributes,
                observed_at=item.observed_at,
                extracted_at=extracted_at,
            )
            for item in envelope.relations
        )
        claims = tuple(
            Claim(
                id=_stable_id(
                    "claim",
                    source.fingerprint,
                    item.ref,
                    item.kind.value,
                    item.statement,
                ),
                kind=item.kind,
                text=item.statement,
                confidence=item.confidence,
                entity_ids=tuple(ref_ids[ref] for ref in item.about_refs),
                source_ids=(source.id,),
                attributes=item.attributes,
                observed_at=item.observed_at,
                extracted_at=extracted_at,
            )
            for item in envelope.claims
        )
        return entities, relations, claims
