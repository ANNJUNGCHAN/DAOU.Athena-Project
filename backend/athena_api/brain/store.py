"""Async-safe embedded graph projection backed by one LadybugDB owner.

On Windows, ``dll_dir`` or ``ATHENA_LADYBUG_DLL_DIR`` may point to native
runtime dependencies required by the Ladybug wheel. No machine path is guessed.
"""

from __future__ import annotations

import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import partial
from pathlib import Path
from types import ModuleType
from typing import Any, Final

from .ontology import Claim, Entity, Relation, RelationKind, SourceRecord

# Single fixed investor-profile entity for this single-user local app (ADR §2(c)). No
# discovery, no per-caller id -- this is the only id investor_profile_summary() reads.
INVESTOR_PROFILE_ENTITY_ID: Final = "investor-profile:default"
_PROFILE_RELATION_KINDS: Final = (
    RelationKind.PREFERS,
    RelationKind.AVOIDS,
    RelationKind.INTERESTED_IN,
)

SCHEMA_VERSION: Final = 1
MAX_SEARCH_LIMIT: Final = 100
MAX_NEIGHBORHOOD_DEPTH: Final = 3

_SCHEMA_STATEMENTS: Final = (
    "CREATE NODE TABLE IF NOT EXISTS SchemaVersion(key STRING, version INT64, PRIMARY KEY (key))",
    "CREATE NODE TABLE IF NOT EXISTS Entity("
    "id STRING, kind STRING, name STRING, aliases_json STRING, attributes_json STRING, "
    "created_at STRING, updated_at STRING, PRIMARY KEY (id))",
    "CREATE NODE TABLE IF NOT EXISTS SourceRecord("
    "id STRING, kind STRING, text STRING, locator STRING, fingerprint STRING, "
    "attributes_json STRING, occurred_at STRING, ingested_at STRING, PRIMARY KEY (id))",
    "CREATE NODE TABLE IF NOT EXISTS Claim("
    "id STRING, kind STRING, text STRING, confidence DOUBLE, attributes_json STRING, "
    "observed_at STRING, extracted_at STRING, PRIMARY KEY (id))",
    "CREATE REL TABLE IF NOT EXISTS RELATES_TO("
    "FROM Entity TO Entity, id STRING, kind STRING, confidence DOUBLE, "
    "source_id STRING, target_id STRING, source_ids_json STRING, "
    "attributes_json STRING, observed_at STRING, extracted_at STRING)",
    "CREATE REL TABLE IF NOT EXISTS ABOUT(FROM Claim TO Entity)",
    "CREATE REL TABLE IF NOT EXISTS SUPPORTED_BY(FROM Claim TO SourceRecord)",
)

_SET_SCHEMA_VERSION: Final = """
MERGE (v:SchemaVersion {key: $key})
SET v.version = $version
"""
_GET_SCHEMA_VERSION: Final = """
MATCH (v:SchemaVersion {key: $key}) RETURN v.version AS version
"""
_UPSERT_ENTITY: Final = """
MERGE (e:Entity {id: $id})
SET e.kind = $kind, e.name = $name, e.aliases_json = $aliases_json,
    e.attributes_json = $attributes_json, e.created_at = $created_at,
    e.updated_at = $updated_at
RETURN e.id AS id
"""
_UPSERT_SOURCE: Final = """
MERGE (s:SourceRecord {id: $id})
SET s.kind = $kind, s.text = $text, s.locator = $locator,
    s.fingerprint = $fingerprint, s.attributes_json = $attributes_json,
    s.occurred_at = $occurred_at, s.ingested_at = $ingested_at
RETURN s.id AS id
"""
_UPSERT_CLAIM: Final = """
MERGE (c:Claim {id: $id})
SET c.kind = $kind, c.text = $text, c.confidence = $confidence,
    c.attributes_json = $attributes_json, c.observed_at = $observed_at,
    c.extracted_at = $extracted_at
RETURN c.id AS id
"""
_LINK_CLAIM_ENTITY: Final = """
MATCH (c:Claim {id: $claim_id}), (e:Entity {id: $entity_id})
MERGE (c)-[:ABOUT]->(e)
RETURN c.id AS id
"""
_LINK_CLAIM_SOURCE: Final = """
MATCH (c:Claim {id: $claim_id}), (s:SourceRecord {id: $source_id})
MERGE (c)-[:SUPPORTED_BY]->(s)
RETURN c.id AS id
"""
_ENTITY_EXISTS: Final = "MATCH (e:Entity {id: $id}) RETURN e.id AS id"
_SOURCE_EXISTS: Final = "MATCH (s:SourceRecord {id: $id}) RETURN s.id AS id"
_SOURCE_FINGERPRINT: Final = """
MATCH (s:SourceRecord {id: $id}) RETURN s.fingerprint AS fingerprint
"""
_DELETE_CLAIM_ENTITIES: Final = """
MATCH (c:Claim {id: $claim_id})-[r:ABOUT]->() DELETE r
"""
_DELETE_CLAIM_SOURCES: Final = """
MATCH (c:Claim {id: $claim_id})-[r:SUPPORTED_BY]->() DELETE r
"""
_DELETE_RELATION_BY_ID: Final = """
MATCH (:Entity)-[r:RELATES_TO]->(:Entity) WHERE r.id = $id DELETE r
"""
_DELETE_SOURCE_RELATIONS: Final = """
MATCH (:Entity)-[r:RELATES_TO]->(:Entity)
WHERE r.source_ids_json = $source_ids_json
DELETE r
"""
_SOURCE_CLAIM_IDS: Final = """
MATCH (c:Claim)-[r:SUPPORTED_BY]->(s:SourceRecord {id: $source_id})
RETURN c.id AS id
"""
_DELETE_CLAIM: Final = "MATCH (c:Claim {id: $claim_id}) DELETE c"
_UPSERT_RELATION: Final = """
MATCH (source:Entity {id: $source_id}), (target:Entity {id: $target_id})
MERGE (source)-[r:RELATES_TO {id: $id}]->(target)
SET r.kind = $kind, r.confidence = $confidence,
    r.source_id = $source_id, r.target_id = $target_id,
    r.source_ids_json = $source_ids_json, r.attributes_json = $attributes_json,
    r.observed_at = $observed_at, r.extracted_at = $extracted_at
RETURN r.id AS id
"""
_SEARCH_ENTITIES: Final = """
MATCH (e:Entity)
WHERE lower(e.name) CONTAINS lower($query)
   OR lower(e.aliases_json) CONTAINS lower($query)
   OR lower(e.attributes_json) CONTAINS lower($query)
RETURN e.id AS id, e.kind AS kind, e.name AS name
ORDER BY lower(e.name), e.id
LIMIT $limit
"""
_ENTITY_SEARCH_INDEX_NAME: Final = "entity_search_idx"
_SHOW_INDEXES: Final = "CALL SHOW_INDEXES() RETURN index_name AS index_name"
_CREATE_ENTITY_SEARCH_INDEX: Final = f"""
CALL CREATE_FTS_INDEX('Entity', '{_ENTITY_SEARCH_INDEX_NAME}',
    ['name', 'aliases_json', 'attributes_json'], stemmer := 'none')
"""
_SEARCH_ENTITIES_FTS: Final = f"""
CALL QUERY_FTS_INDEX('Entity', '{_ENTITY_SEARCH_INDEX_NAME}', $query)
RETURN node.id AS id, node.kind AS kind, node.name AS name, score
ORDER BY score DESC, node.id
LIMIT $limit
"""
_SUMMARY_QUERIES: Final = {
    "entities": "MATCH (n:Entity) RETURN count(n) AS count",
    "sources": "MATCH (n:SourceRecord) RETURN count(n) AS count",
    "claims": "MATCH (n:Claim) RETURN count(n) AS count",
    "relations": "MATCH (:Entity)-[r:RELATES_TO]->(:Entity) RETURN count(r) AS count",
}
_CLAIM_PROVENANCE: Final = """
MATCH (c:Claim {id: $claim_id})
OPTIONAL MATCH (c)-[:ABOUT]->(e:Entity)
WITH c, collect(DISTINCT e.id) AS entity_ids
OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(s:SourceRecord)
RETURN c.id AS claim_id, entity_ids, collect(DISTINCT s.id) AS source_ids
"""
_RESET_STATEMENTS: Final = (
    "MATCH ()-[r:ABOUT]->() DELETE r",
    "MATCH ()-[r:SUPPORTED_BY]->() DELETE r",
    "MATCH ()-[r:RELATES_TO]->() DELETE r",
    "MATCH (c:Claim) DELETE c",
    "MATCH (s:SourceRecord) DELETE s",
    "MATCH (e:Entity) DELETE e",
    "MATCH (v:SchemaVersion) DELETE v",
)
_BEGIN: Final = "BEGIN TRANSACTION"
_COMMIT: Final = "COMMIT"
_ROLLBACK: Final = "ROLLBACK"
_INSTALL_FTS: Final = "INSTALL fts"
_LOAD_FTS: Final = "LOAD fts"
_NEIGHBORHOOD_QUERIES: Final = {
    depth: f"""
MATCH p=(root:Entity {{id: $entity_id}})-[:RELATES_TO*1..{depth}]-(neighbor:Entity)
RETURN nodes(p) AS path_nodes, relationships(p) AS path_relations
ORDER BY neighbor.id
LIMIT $limit
"""
    for depth in range(1, MAX_NEIGHBORHOOD_DEPTH + 1)
}
# graph.investor_profile_summary (ADR §6.2 allowlist). Deterministic read-time
# aggregation only -- pure count/date-window filter, no model calls and none of the
# similarity machinery ADR §7 bans
# (ADR §7). PREFERS/AVOIDS/INTERESTED_IN out-edges from the single fixed
# investor_profile entity, joined to the Claim(s) that support each target within the
# window, grouped per target. Sort is fully deterministic: latest observation desc,
# then supporting-claim count desc, then id for a stable tiebreak.
_INVESTOR_PROFILE_SUMMARY_QUERY: Final = """
MATCH (owner:Entity {id: $profile_id})-[rel:RELATES_TO]->(target:Entity)<-[:ABOUT]-(c:Claim)
WHERE rel.kind IN $relation_kinds AND c.observed_at >= $window_start
WITH target, rel, count(c) AS claim_count, max(c.observed_at) AS latest_observed_at,
     avg(c.confidence) AS average_confidence
RETURN target.id AS entity_id, target.kind AS entity_kind, target.name AS entity_name,
       rel.kind AS relation_kind, claim_count, latest_observed_at, average_confidence
ORDER BY latest_observed_at DESC, claim_count DESC, target.id
LIMIT $limit
"""


@dataclass(frozen=True, slots=True)
class GraphSummary:
    entities: int
    sources: int
    claims: int
    relations: int


@dataclass(frozen=True, slots=True)
class EntitySearchHit:
    id: str
    kind: str
    name: str


@dataclass(frozen=True, slots=True)
class NeighborhoodEdge:
    source_id: str
    target_id: str
    relation_id: str
    kind: str
    confidence: float


@dataclass(frozen=True, slots=True)
class InvestorProfileSummaryEntry:
    entity_id: str
    entity_kind: str
    entity_name: str
    relation_kind: str
    claim_count: int
    latest_observed_at: str
    average_confidence: float


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _timestamp(value: Any) -> str:
    return value.isoformat().replace("+00:00", "Z")


class GraphStore:
    """Own one database/connection pair and serialize all blocking access."""

    def __init__(self, path: Path, *, dll_dir: Path | None = None) -> None:
        self.path = Path(path)
        configured_dir = dll_dir or (
            Path(value) if (value := os.getenv("ATHENA_LADYBUG_DLL_DIR")) else None
        )
        self._dll_dir = configured_dir
        self._dll_handle: Any | None = None
        self._lb: ModuleType | None = None
        self._database: Any | None = None
        self._connection: Any | None = None
        self._lock = asyncio.Lock()
        self._owner = ThreadPoolExecutor(max_workers=1, thread_name_prefix="athena-brain")
        self._open_future: asyncio.Future[Any] | None = None
        self._close_future: asyncio.Future[Any] | None = None
        self._closed = False
        # Set only once load_fts_extension() has both loaded the package and confirmed
        # (or created) the entity search index — search_entities() reads this to pick
        # the FTS/BM25 query path over the CONTAINS fallback, per ADR §7.
        self._fts_index_ready = False

    @property
    def is_open(self) -> bool:
        return self._connection is not None and not self._closed

    async def open(self) -> None:
        async with self._lock:
            if self._closed:
                raise RuntimeError("graph store is closed")
            if self._connection is not None:
                return
            if self._open_future is None:
                self._open_future = self._submit_owner(self._open_sync)
            try:
                await asyncio.shield(self._open_future)
            except asyncio.CancelledError:
                raise
            except Exception:
                self._open_future = None
                raise

    def _submit_owner(self, function: Any, *args: Any) -> asyncio.Future[Any]:
        loop = asyncio.get_running_loop()
        return loop.run_in_executor(self._owner, partial(function, *args))

    def _open_sync(self) -> None:
        if self._connection is not None:
            return
        if os.name == "nt" and self._dll_dir is not None:
            if not self._dll_dir.is_dir():
                raise RuntimeError(f"LadybugDB DLL directory does not exist: {self._dll_dir}")
            self._dll_handle = os.add_dll_directory(str(self._dll_dir))
        try:
            import ladybug as lb

            database = lb.Database(str(self.path))
            connection = lb.Connection(database)
        except Exception as exc:
            if self._dll_handle is not None:
                self._dll_handle.close()
                self._dll_handle = None
            raise RuntimeError(
                "LadybugDB could not start; on Windows set ATHENA_LADYBUG_DLL_DIR "
                "to the directory containing its native runtime dependencies"
            ) from exc
        self._lb = lb
        self._database = database
        self._connection = connection
        try:
            for statement in _SCHEMA_STATEMENTS:
                self._execute_sync(statement)
            rows = self._execute_sync(_GET_SCHEMA_VERSION, {"key": "projection"})
            if rows and int(rows[0]["version"]) != SCHEMA_VERSION:
                raise RuntimeError(f"unsupported graph schema version: {rows[0]['version']}")
            if not rows:
                self._execute_sync(
                    _SET_SCHEMA_VERSION,
                    {"key": "projection", "version": SCHEMA_VERSION},
                )
        except Exception:
            self._close_sync()
            raise

    async def close(self) -> None:
        async with self._lock:
            if self._close_future is None:
                self._closed = True
                self._close_future = self._submit_owner(self._close_sync)
            close_future = self._close_future
        try:
            await asyncio.shield(close_future)
        finally:
            self._owner.shutdown(wait=False, cancel_futures=False)

    def _close_sync(self) -> None:
        try:
            if self._connection is not None:
                self._connection.close()
        finally:
            self._connection = None
            try:
                if self._database is not None:
                    self._database.close()
            finally:
                self._database = None
                if self._dll_handle is not None:
                    self._dll_handle.close()
                    self._dll_handle = None
                self._lb = None

    def _execute_sync(
        self, query: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        if self._connection is None or self._closed:
            raise RuntimeError("graph store is not open")
        result = self._connection.execute(query, parameters=parameters or {})
        return result.rows_as_dict().get_all()

    async def _execute(
        self, query: str, parameters: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        async with self._lock:
            if not self.is_open:
                raise RuntimeError("graph store is not open")
            return await asyncio.shield(self._submit_owner(self._execute_sync, query, parameters))

    async def schema_version(self) -> int:
        rows = await self._execute(_GET_SCHEMA_VERSION, {"key": "projection"})
        if len(rows) != 1:
            raise RuntimeError("graph schema metadata is missing")
        return int(rows[0]["version"])

    async def load_fts_extension(self) -> None:
        """Fetch/activate the fts package and ensure the entity search index (ADR §4.2 step 4).

        Best-effort by design: ADR investment-brain-architecture.md §7 requires the graph
        core to start safely even when this package is unavailable (no bundled offline
        artifact, no network) and to surface that as degraded readiness rather than a
        startup failure, so callers should catch failures here rather than propagate them.

        Verified empirically against ladybug 0.19.1 (no syntax precedent existed in this
        repo or the ADR before this): ``CREATE_FTS_INDEX`` builds a live, auto-maintained
        index over the named node properties — new/updated rows are picked up without a
        rebuild, and the index itself persists across process restarts, so this only
        (re)creates it when ``SHOW_INDEXES`` doesn't already list it (``CREATE_FTS_INDEX``
        raises if called twice for the same name). It does *not* do substring/CONTAINS
        matching — it tokenizes on whitespace/punctuation and only matches whole terms
        (e.g. a query for "하이닉스" will not match a stored "SK하이닉스" token unless that
        exact substring appears as its own token, such as in an alias). Once this method
        succeeds, ``search_entities`` switches from the CONTAINS scan to this ranked
        index; recall-quality gating against a fixed corpus (ADR §7) is unaddressed
        follow-up work, not covered here.
        """
        await self._execute(_INSTALL_FTS)
        await self._execute(_LOAD_FTS)
        rows = await self._execute(_SHOW_INDEXES)
        if not any(row["index_name"] == _ENTITY_SEARCH_INDEX_NAME for row in rows):
            await self._execute(_CREATE_ENTITY_SEARCH_INDEX)
        self._fts_index_ready = True

    async def upsert_entity(self, entity: Entity) -> str:
        rows = await self._execute(
            _UPSERT_ENTITY,
            {
                "id": entity.id,
                "kind": entity.kind.value,
                "name": entity.name,
                "aliases_json": _json(entity.aliases),
                "attributes_json": _json(entity.attributes),
                "created_at": _timestamp(entity.created_at),
                "updated_at": _timestamp(entity.updated_at),
            },
        )
        return str(rows[0]["id"])

    async def upsert_source(self, source: SourceRecord) -> str:
        rows = await self._execute(
            _UPSERT_SOURCE,
            {
                "id": source.id,
                "kind": source.kind.value,
                "text": source.text,
                "locator": source.locator,
                "fingerprint": source.fingerprint,
                "attributes_json": _json(source.attributes),
                "occurred_at": _timestamp(source.occurred_at),
                "ingested_at": _timestamp(source.ingested_at),
            },
        )
        return str(rows[0]["id"])

    async def upsert_claim(self, claim: Claim) -> str:
        async with self._lock:
            if not self.is_open:
                raise RuntimeError("graph store is not open")

            def write() -> str:
                self._execute_sync(_BEGIN)
                try:
                    missing_entities = [
                        entity_id
                        for entity_id in claim.entity_ids
                        if not self._execute_sync(_ENTITY_EXISTS, {"id": entity_id})
                    ]
                    missing_sources = [
                        source_id
                        for source_id in claim.source_ids
                        if not self._execute_sync(_SOURCE_EXISTS, {"id": source_id})
                    ]
                    if missing_entities or missing_sources:
                        raise ValueError(
                            "claim provenance targets do not exist: "
                            f"entities={missing_entities}, sources={missing_sources}"
                        )
                    rows = self._execute_sync(
                        _UPSERT_CLAIM,
                        {
                            "id": claim.id,
                            "kind": claim.kind.value,
                            "text": claim.text,
                            "confidence": claim.confidence,
                            "attributes_json": _json(claim.attributes),
                            "observed_at": _timestamp(claim.observed_at),
                            "extracted_at": _timestamp(claim.extracted_at),
                        },
                    )
                    self._execute_sync(_DELETE_CLAIM_ENTITIES, {"claim_id": claim.id})
                    self._execute_sync(_DELETE_CLAIM_SOURCES, {"claim_id": claim.id})
                    for entity_id in sorted(claim.entity_ids):
                        linked = self._execute_sync(
                            _LINK_CLAIM_ENTITY,
                            {"claim_id": claim.id, "entity_id": entity_id},
                        )
                        if not linked:
                            raise RuntimeError("claim entity link was not created")
                    for source_id in sorted(claim.source_ids):
                        linked = self._execute_sync(
                            _LINK_CLAIM_SOURCE,
                            {"claim_id": claim.id, "source_id": source_id},
                        )
                        if not linked:
                            raise RuntimeError("claim source link was not created")
                    self._execute_sync(_COMMIT)
                    return str(rows[0]["id"])
                except Exception:
                    self._execute_sync(_ROLLBACK)
                    raise

            return await asyncio.shield(self._submit_owner(write))

    async def upsert_relation(self, relation: Relation) -> str:
        async with self._lock:
            if not self.is_open:
                raise RuntimeError("graph store is not open")

            def write() -> str:
                self._execute_sync(_BEGIN)
                try:
                    source_exists = self._execute_sync(
                        _ENTITY_EXISTS, {"id": relation.source_entity_id}
                    )
                    target_exists = self._execute_sync(
                        _ENTITY_EXISTS, {"id": relation.target_entity_id}
                    )
                    if not source_exists or not target_exists:
                        raise ValueError("relation endpoints must exist")
                    self._execute_sync(_DELETE_RELATION_BY_ID, {"id": relation.id})
                    rows = self._execute_sync(
                        _UPSERT_RELATION,
                        {
                            "id": relation.id,
                            "kind": relation.kind.value,
                            "source_id": relation.source_entity_id,
                            "target_id": relation.target_entity_id,
                            "confidence": relation.confidence,
                            "source_ids_json": _json(relation.source_ids),
                            "attributes_json": _json(relation.attributes),
                            "observed_at": _timestamp(relation.observed_at),
                            "extracted_at": _timestamp(relation.extracted_at),
                        },
                    )
                    if not rows:
                        raise RuntimeError("relation was not created")
                    self._execute_sync(_COMMIT)
                    return str(rows[0]["id"])
                except Exception:
                    self._execute_sync(_ROLLBACK)
                    raise

            return await asyncio.shield(self._submit_owner(write))

    async def apply_extraction(
        self,
        source_id: str,
        source_fingerprint: str,
        entities: tuple[Entity, ...],
        relations: tuple[Relation, ...],
        claims: tuple[Claim, ...],
    ) -> None:
        """Atomically replace all derived claims and relations for one source."""
        if not 1 <= len(source_id) <= 128 or not 1 <= len(source_fingerprint) <= 128:
            raise ValueError("source binding is out of bounds")
        if len(entities) > 64 or len(relations) > 128 or len(claims) > 128:
            raise ValueError("extraction exceeds projection count limits")
        entity_ids = {entity.id for entity in entities}
        if len(entity_ids) != len(entities):
            raise ValueError("extraction entity ids must be unique")
        if len({relation.id for relation in relations}) != len(relations):
            raise ValueError("extraction relation ids must be unique")
        if len({claim.id for claim in claims}) != len(claims):
            raise ValueError("extraction claim ids must be unique")
        for relation in relations:
            if relation.source_ids != (source_id,):
                raise ValueError("extraction relation provenance must match its source")
            if not {relation.source_entity_id, relation.target_entity_id} <= entity_ids:
                raise ValueError("extraction relation endpoints must be supplied entities")
        for claim in claims:
            if claim.source_ids != (source_id,):
                raise ValueError("extraction claim provenance must match its source")
            if not set(claim.entity_ids) <= entity_ids:
                raise ValueError("extraction claim targets must be supplied entities")

        async with self._lock:
            if not self.is_open:
                raise RuntimeError("graph store is not open")

            def write() -> None:
                self._execute_sync(_BEGIN)
                try:
                    rows = self._execute_sync(_SOURCE_FINGERPRINT, {"id": source_id})
                    if len(rows) != 1 or str(rows[0]["fingerprint"]) != source_fingerprint:
                        raise ValueError("source does not exist or fingerprint does not match")
                    old_claim_ids = [
                        str(row["id"])
                        for row in self._execute_sync(_SOURCE_CLAIM_IDS, {"source_id": source_id})
                    ]
                    for claim_id in old_claim_ids:
                        self._execute_sync(_DELETE_CLAIM_ENTITIES, {"claim_id": claim_id})
                        self._execute_sync(_DELETE_CLAIM_SOURCES, {"claim_id": claim_id})
                        self._execute_sync(_DELETE_CLAIM, {"claim_id": claim_id})
                    self._execute_sync(
                        _DELETE_SOURCE_RELATIONS,
                        {"source_ids_json": _json((source_id,))},
                    )
                    for entity in entities:
                        self._execute_sync(
                            _UPSERT_ENTITY,
                            {
                                "id": entity.id,
                                "kind": entity.kind.value,
                                "name": entity.name,
                                "aliases_json": _json(entity.aliases),
                                "attributes_json": _json(entity.attributes),
                                "created_at": _timestamp(entity.created_at),
                                "updated_at": _timestamp(entity.updated_at),
                            },
                        )
                    self._after_extraction_entities_sync()
                    for relation in relations:
                        rows = self._execute_sync(
                            _UPSERT_RELATION,
                            {
                                "id": relation.id,
                                "kind": relation.kind.value,
                                "source_id": relation.source_entity_id,
                                "target_id": relation.target_entity_id,
                                "confidence": relation.confidence,
                                "source_ids_json": _json(relation.source_ids),
                                "attributes_json": _json(relation.attributes),
                                "observed_at": _timestamp(relation.observed_at),
                                "extracted_at": _timestamp(relation.extracted_at),
                            },
                        )
                        if not rows:
                            raise RuntimeError("extraction relation was not created")
                    for claim in claims:
                        self._execute_sync(
                            _UPSERT_CLAIM,
                            {
                                "id": claim.id,
                                "kind": claim.kind.value,
                                "text": claim.text,
                                "confidence": claim.confidence,
                                "attributes_json": _json(claim.attributes),
                                "observed_at": _timestamp(claim.observed_at),
                                "extracted_at": _timestamp(claim.extracted_at),
                            },
                        )
                        for entity_id in sorted(claim.entity_ids):
                            if not self._execute_sync(
                                _LINK_CLAIM_ENTITY,
                                {"claim_id": claim.id, "entity_id": entity_id},
                            ):
                                raise RuntimeError("extraction claim target was not created")
                        if not self._execute_sync(
                            _LINK_CLAIM_SOURCE,
                            {"claim_id": claim.id, "source_id": source_id},
                        ):
                            raise RuntimeError("extraction claim provenance was not created")
                    self._execute_sync(_COMMIT)
                except Exception:
                    self._execute_sync(_ROLLBACK)
                    raise

            await asyncio.shield(self._submit_owner(write))

    def _after_extraction_entities_sync(self) -> None:
        """Internal fault-injection seam used to verify transaction rollback."""

    async def search_entities(self, query: str, *, limit: int = 20) -> tuple[EntitySearchHit, ...]:
        """Rank by fts/BM25 once load_fts_extension() has built the index; else CONTAINS.

        The two are not equivalent: BM25 matches whole terms, not substrings (see
        load_fts_extension's docstring). This falls back to the CONTAINS scan only when
        the index isn't ready — not as a secondary pass merged with fts results — matching
        the pre-fts behavior exactly for stores that never call load_fts_extension().
        """
        if not query.strip() or len(query) > 256:
            raise ValueError("query must contain 1 to 256 non-blank characters")
        if not 1 <= limit <= MAX_SEARCH_LIMIT:
            raise ValueError(f"limit must be between 1 and {MAX_SEARCH_LIMIT}")
        template = _SEARCH_ENTITIES_FTS if self._fts_index_ready else _SEARCH_ENTITIES
        rows = await self._execute(template, {"query": query, "limit": limit})
        return tuple(
            EntitySearchHit(id=row["id"], kind=row["kind"], name=row["name"]) for row in rows
        )

    async def summary(self) -> GraphSummary:
        async with self._lock:
            if not self.is_open:
                raise RuntimeError("graph store is not open")

            def read_counts() -> GraphSummary:
                counts = {
                    name: int(self._execute_sync(query)[0]["count"])
                    for name, query in _SUMMARY_QUERIES.items()
                }
                return GraphSummary(**counts)

            return await asyncio.shield(self._submit_owner(read_counts))

    async def claim_provenance(self, claim_id: str) -> dict[str, Any] | None:
        rows = await self._execute(_CLAIM_PROVENANCE, {"claim_id": claim_id})
        if not rows:
            return None
        row = rows[0]
        entity_ids = tuple(sorted(value for value in row["entity_ids"] if value is not None))
        source_ids = tuple(sorted(value for value in row["source_ids"] if value is not None))
        if not entity_ids or not source_ids:
            raise RuntimeError("claim provenance is incomplete")
        return {
            "claim_id": str(row["claim_id"]),
            "entity_ids": entity_ids,
            "source_ids": source_ids,
        }

    async def neighborhood(
        self,
        entity_id: str,
        *,
        depth: int = 1,
        limit: int = 100,
    ) -> tuple[NeighborhoodEdge, ...]:
        if depth not in _NEIGHBORHOOD_QUERIES:
            raise ValueError(f"depth must be between 1 and {MAX_NEIGHBORHOOD_DEPTH}")
        if not 1 <= limit <= 500:
            raise ValueError("limit must be between 1 and 500")
        rows = await self._execute(
            _NEIGHBORHOOD_QUERIES[depth],
            {"entity_id": entity_id, "limit": limit},
        )
        edges: dict[str, NeighborhoodEdge] = {}
        for row in rows:
            for relation in row["path_relations"]:
                relation_id = str(relation["id"])
                edges[relation_id] = NeighborhoodEdge(
                    source_id=str(relation["source_id"]),
                    target_id=str(relation["target_id"]),
                    relation_id=relation_id,
                    kind=str(relation["kind"]),
                    confidence=float(relation["confidence"]),
                )
        return tuple(edges[key] for key in sorted(edges))

    async def investor_profile_summary(
        self, *, now: datetime, window_days: int = 90, limit: int = 50
    ) -> tuple[InvestorProfileSummaryEntry, ...]:
        """Read-time aggregation over the fixed investor_profile entity (ADR §2(c)).

        ``now`` is caller-supplied so the window boundary is deterministic and
        reproducible in tests -- this method never reads the wall clock itself.
        """
        if now.tzinfo is None or now.utcoffset() != timedelta(0):
            raise ValueError("now must be UTC-aware")
        if not 1 <= window_days <= 3650:
            raise ValueError("window_days must be between 1 and 3650")
        if not 1 <= limit <= 500:
            raise ValueError("limit must be between 1 and 500")
        window_start = now - timedelta(days=window_days)
        rows = await self._execute(
            _INVESTOR_PROFILE_SUMMARY_QUERY,
            {
                "profile_id": INVESTOR_PROFILE_ENTITY_ID,
                "relation_kinds": [kind.value for kind in _PROFILE_RELATION_KINDS],
                "window_start": _timestamp(window_start),
                "limit": limit,
            },
        )
        return tuple(
            InvestorProfileSummaryEntry(
                entity_id=str(row["entity_id"]),
                entity_kind=str(row["entity_kind"]),
                entity_name=str(row["entity_name"]),
                relation_kind=str(row["relation_kind"]),
                claim_count=int(row["claim_count"]),
                latest_observed_at=str(row["latest_observed_at"]),
                average_confidence=float(row["average_confidence"]),
            )
            for row in rows
        )

    async def reset_projection(self) -> None:
        async with self._lock:
            if not self.is_open:
                raise RuntimeError("graph store is not open")

            def reset() -> None:
                for statement in _RESET_STATEMENTS:
                    self._execute_sync(statement)
                self._execute_sync(
                    _SET_SCHEMA_VERSION,
                    {"key": "projection", "version": SCHEMA_VERSION},
                )

            await asyncio.shield(self._submit_owner(reset))
