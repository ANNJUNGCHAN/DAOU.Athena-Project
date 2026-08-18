import asyncio
import os
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest

from athena_api.brain import (
    Claim,
    ClaimKind,
    Entity,
    EntityKind,
    GraphStore,
    Relation,
    RelationKind,
    SourceKind,
    SourceRecord,
)

NOW = datetime(2026, 8, 15, tzinfo=UTC)


def _test_only_windows_dll_dir() -> Path | None:
    configured = os.getenv("ATHENA_LADYBUG_DLL_DIR")
    if configured:
        return Path(configured)
    # Test harness fallback only. Production code never discovers this path.
    local_test_runtime = Path(r"C:\Program Files\Git\mingw64\bin")
    if os.name == "nt" and local_test_runtime.is_dir():
        return local_test_runtime
    return None


@pytest.fixture
def ladybug_dll_dir(monkeypatch: pytest.MonkeyPatch) -> Path | None:
    runtime_dir = _test_only_windows_dll_dir()
    if runtime_dir is not None:
        monkeypatch.setenv("ATHENA_LADYBUG_DLL_DIR", str(runtime_dir))
    return runtime_dir


def entity(entity_id: str, name: str, *, kind: EntityKind = EntityKind.THEME) -> Entity:
    return Entity(
        id=entity_id,
        kind=kind,
        name=name,
        attributes={"description": f"{name} 관련 관심사"},
        created_at=NOW,
        updated_at=NOW,
    )


def source(source_id: str = "chat:1") -> SourceRecord:
    return SourceRecord(
        id=source_id,
        kind=SourceKind.CHAT_MESSAGE,
        text="반도체 업황을 조사했다.",
        fingerprint=f"fingerprint:{source_id.replace(':', '-')}",
        occurred_at=NOW,
        ingested_at=NOW,
    )


@pytest.fixture
async def store(tmp_path: Path, ladybug_dll_dir: Path | None):
    graph = GraphStore(tmp_path / "brain.lbug", dll_dir=ladybug_dll_dir)
    await graph.open()
    try:
        yield graph
    finally:
        await graph.close()


async def test_schema_open_is_idempotent_and_reopens_same_path(
    tmp_path: Path,
    ladybug_dll_dir: Path | None,
) -> None:
    path = tmp_path / "brain.lbug"
    first = GraphStore(path, dll_dir=ladybug_dll_dir)
    await first.open()
    await first.open()
    assert await first.schema_version() == 1
    await first.upsert_entity(entity("theme:semiconductor", "반도체"))
    await first.close()
    await first.close()

    second = GraphStore(path, dll_dir=ladybug_dll_dir)
    await second.open()
    assert (await second.summary()).entities == 1
    await second.close()


async def test_upserts_are_idempotent_and_parameter_injection_is_data(store: GraphStore) -> None:
    hostile_name = "삼성전자') MATCH (n) DELETE n //"
    record = entity("security:005930", hostile_name, kind=EntityKind.SECURITY)
    await store.upsert_entity(entity("theme:sentinel", "보존 대상"))
    await store.upsert_entity(record)
    await store.upsert_entity(record)
    await store.upsert_source(source())
    await store.upsert_source(source())

    summary = await store.summary()
    assert summary.entities == 2
    assert summary.sources == 1
    assert (await store.search_entities("MATCH"))[0].id == "security:005930"


async def test_korean_search_is_deterministic_across_name_alias_and_attributes(
    store: GraphStore,
) -> None:
    await store.upsert_entity(entity("theme:memory", "메모리 반도체"))
    await store.upsert_entity(entity("theme:foundry", "파운드리"))
    await store.upsert_entity(
        Entity(
            id="security:005930",
            kind=EntityKind.SECURITY,
            name="삼성전자",
            aliases=("삼전",),
            attributes={"sector": "반도체"},
            created_at=NOW,
            updated_at=NOW,
        )
    )

    assert [hit.id for hit in await store.search_entities("반도체")] == [
        "theme:memory",
        "security:005930",
    ]
    assert [hit.id for hit in await store.search_entities("삼전")] == ["security:005930"]


async def test_relation_traversal_and_claim_provenance_are_idempotent(store: GraphStore) -> None:
    investor = entity("investor:local", "나", kind=EntityKind.INVESTOR_PROFILE)
    security = entity("security:005930", "삼성전자", kind=EntityKind.SECURITY)
    theme = entity("theme:semiconductor", "반도체")
    for item in (investor, security, theme):
        await store.upsert_entity(item)
    await store.upsert_source(source())
    claim = Claim(
        id="claim:1",
        kind=ClaimKind.INFERRED_PREFERENCE,
        text="반도체 종목에 관심이 있을 가능성이 있다.",
        confidence=0.75,
        entity_ids=(security.id,),
        source_ids=("chat:1",),
        observed_at=NOW,
        extracted_at=NOW,
    )
    await store.upsert_claim(claim)
    await store.upsert_claim(claim)
    first_relation = Relation(
        id="relation:interest",
        kind=RelationKind.INTERESTED_IN,
        source_entity_id=investor.id,
        target_entity_id=security.id,
        confidence=0.8,
        source_ids=("chat:1",),
        observed_at=NOW,
        extracted_at=NOW,
    )
    second_relation = Relation(
        id="relation:theme",
        kind=RelationKind.RELATES_TO,
        source_entity_id=security.id,
        target_entity_id=theme.id,
        confidence=1.0,
        source_ids=("chat:1",),
        observed_at=NOW,
        extracted_at=NOW,
    )
    await store.upsert_relation(first_relation)
    await store.upsert_relation(first_relation)
    await store.upsert_relation(second_relation)

    provenance = await store.claim_provenance(claim.id)
    assert provenance == {
        "claim_id": "claim:1",
        "entity_ids": ("security:005930",),
        "source_ids": ("chat:1",),
    }
    assert {edge.relation_id for edge in await store.neighborhood(investor.id, depth=2)} == {
        "relation:interest",
        "relation:theme",
    }
    assert (await store.summary()).relations == 2


async def test_claim_upsert_replaces_provenance_sets(store: GraphStore) -> None:
    first_entity = entity("theme:first", "첫 테마")
    second_entity = entity("theme:second", "둘째 테마")
    for item in (first_entity, second_entity):
        await store.upsert_entity(item)
    await store.upsert_source(source("chat:1"))
    await store.upsert_source(source("chat:2"))
    claim = Claim(
        id="claim:replace",
        kind=ClaimKind.OBSERVATION,
        text="첫 관찰",
        confidence=0.7,
        entity_ids=(first_entity.id,),
        source_ids=("chat:1",),
        observed_at=NOW,
        extracted_at=NOW,
    )
    await store.upsert_claim(claim)
    await store.upsert_claim(
        claim.model_copy(
            update={
                "text": "수정된 관찰",
                "entity_ids": (second_entity.id,),
                "source_ids": ("chat:2",),
            }
        )
    )

    assert await store.claim_provenance(claim.id) == {
        "claim_id": claim.id,
        "entity_ids": (second_entity.id,),
        "source_ids": ("chat:2",),
    }
    assert (await store.summary()).claims == 1


async def test_claim_missing_target_rolls_back_without_partial_write(
    store: GraphStore,
) -> None:
    valid_entity = entity("theme:valid", "유효 테마")
    await store.upsert_entity(valid_entity)
    await store.upsert_source(source("chat:valid"))
    existing = Claim(
        id="claim:existing",
        kind=ClaimKind.OBSERVATION,
        text="기존 관찰",
        confidence=0.8,
        entity_ids=(valid_entity.id,),
        source_ids=("chat:valid",),
        observed_at=NOW,
        extracted_at=NOW,
    )
    await store.upsert_claim(existing)
    missing = Claim(
        id="claim:missing",
        kind=ClaimKind.OBSERVATION,
        text="저장되면 안 되는 관찰",
        confidence=0.8,
        entity_ids=("theme:missing",),
        source_ids=("chat:missing",),
        observed_at=NOW,
        extracted_at=NOW,
    )

    with pytest.raises(ValueError, match="targets do not exist"):
        await store.upsert_claim(missing)
    with pytest.raises(ValueError, match="targets do not exist"):
        await store.upsert_claim(existing.model_copy(update={"source_ids": ("chat:missing",)}))

    assert await store.claim_provenance(existing.id) == {
        "claim_id": existing.id,
        "entity_ids": (valid_entity.id,),
        "source_ids": ("chat:valid",),
    }
    assert await store.claim_provenance(missing.id) is None
    assert (await store.summary()).claims == 1


async def test_relation_id_replaces_old_endpoints_and_preserves_stored_direction(
    store: GraphStore,
) -> None:
    first = entity("theme:first", "첫 테마")
    second = entity("theme:second", "둘째 테마")
    third = entity("theme:third", "셋째 테마")
    for item in (first, second, third):
        await store.upsert_entity(item)
    relation = Relation(
        id="relation:global",
        kind=RelationKind.RELATES_TO,
        source_entity_id=first.id,
        target_entity_id=second.id,
        confidence=0.6,
        observed_at=NOW,
        extracted_at=NOW,
    )
    await store.upsert_relation(relation)
    await store.upsert_relation(
        relation.model_copy(update={"source_entity_id": third.id, "target_entity_id": first.id})
    )

    assert (await store.summary()).relations == 1
    assert await store.neighborhood(second.id) == ()
    reverse_start = await store.neighborhood(first.id)
    assert reverse_start == (
        type(reverse_start[0])(
            source_id=third.id,
            target_id=first.id,
            relation_id=relation.id,
            kind=relation.kind.value,
            confidence=relation.confidence,
        ),
    )


async def test_load_fts_extension_activates_the_official_package(store: GraphStore) -> None:
    """Regression guard for ADR §4.2's "fts 로드" lifespan step (lifespan.py:_open_brain).

    load_fts_extension() now also (re)creates the entity search index it queries; see
    test_load_fts_extension_creates_a_live_bm25_ranked_index below for the ranked-query
    behavior this unlocks in search_entities.
    """
    await store.load_fts_extension()
    assert store._fts_index_ready is True
    # Idempotent: a second call on an already-loaded store must not raise (index already
    # exists — CREATE_FTS_INDEX errors on a duplicate name, so this exercises the
    # SHOW_INDEXES-guarded skip path).
    await store.load_fts_extension()


async def test_load_fts_extension_creates_a_live_bm25_ranked_index(store: GraphStore) -> None:
    """ADR §4.2 step 4 / §7: once load_fts_extension() succeeds, search_entities() ranks
    by BM25 relevance instead of the lower(x) CONTAINS scan. Verified empirically against
    ladybug 0.19.1 (no fts query syntax precedent existed in this repo before this) — see
    store.py's load_fts_extension docstring for what was checked and how.
    """
    await store.upsert_entity(entity("security:005930", "삼성전자", kind=EntityKind.SECURITY))
    await store.upsert_entity(
        Entity(
            id="theme:semiconductor",
            kind=EntityKind.THEME,
            name="반도체 테마",
            attributes={"note": "삼성전자 관련 테마"},
            created_at=NOW,
            updated_at=NOW,
        )
    )
    await store.load_fts_extension()

    # Exact-name match outranks a secondary mention buried in an attributes note.
    hits = await store.search_entities("삼성전자")
    assert [hit.id for hit in hits] == ["security:005930", "theme:semiconductor"]

    # A whole-term query with no match returns empty, not an error.
    assert await store.search_entities("없는단어") == ()

    # A newly-created entity is picked up by the same live index without a rebuild.
    await store.upsert_entity(entity("theme:foundry", "파운드리"))
    assert [hit.id for hit in await store.search_entities("파운드리")] == ["theme:foundry"]


async def test_search_entities_falls_back_to_contains_scan_when_fts_is_not_loaded(
    store: GraphStore,
) -> None:
    """The CONTAINS scan (pre-fts behavior) stays intact for stores that never call
    load_fts_extension() — e.g. a degraded brain where the fts package failed to load
    (lifespan.py's fts_last_error path). fts/BM25 and CONTAINS are not equivalent (BM25
    matches whole tokens, not substrings — see load_fts_extension's docstring), so this
    is a real behavioral fallback, not a strict superset.
    """
    await store.upsert_entity(
        Entity(
            id="security:005930",
            kind=EntityKind.SECURITY,
            name="SK하이닉스",
            created_at=NOW,
            updated_at=NOW,
        )
    )
    assert store._fts_index_ready is False
    # "하이닉스" is a bare substring of "SK하이닉스", not its own token — CONTAINS matches
    # it; a fts/BM25 query would not (empirically confirmed while building this fallback).
    assert [hit.id for hit in await store.search_entities("하이닉스")] == ["security:005930"]


async def test_reset_deletes_projection_and_restores_schema_metadata(store: GraphStore) -> None:
    await store.upsert_entity(entity("theme:semiconductor", "반도체"))
    await store.upsert_source(source())
    await store.reset_projection()

    assert await store.schema_version() == 1
    assert await store.summary() == type(await store.summary())(
        entities=0,
        sources=0,
        claims=0,
        relations=0,
    )


async def test_close_is_idempotent_and_fails_closed(
    tmp_path: Path,
    ladybug_dll_dir: Path | None,
) -> None:
    graph = GraphStore(tmp_path / "brain.lbug", dll_dir=ladybug_dll_dir)
    await graph.open()
    await graph.close()
    await graph.close()

    with pytest.raises(RuntimeError, match="closed"):
        await graph.open()
    with pytest.raises(RuntimeError, match="not open"):
        await graph.summary()


async def test_failed_schema_open_releases_database_and_dll_handle(
    tmp_path: Path,
    ladybug_dll_dir: Path | None,
) -> None:
    path = tmp_path / "future-schema.lbug"
    seed = GraphStore(path, dll_dir=ladybug_dll_dir)
    await seed.open()
    await seed._execute(
        "MATCH (v:SchemaVersion {key: $key}) SET v.version = $version",
        {"key": "projection", "version": 999},
    )
    await seed.close()

    graph = GraphStore(path, dll_dir=ladybug_dll_dir)
    with pytest.raises(RuntimeError, match="unsupported graph schema version"):
        await graph.open()
    assert graph._connection is None
    assert graph._database is None
    assert graph._dll_handle is None
    assert graph._lb is None
    await graph.close()


async def test_cancelled_write_finishes_on_owner_before_next_read(
    store: GraphStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = threading.Event()
    release = threading.Event()
    original_execute = store._execute_sync
    blocked = False

    def slow_execute(query: str, parameters: dict[str, object] | None = None):
        nonlocal blocked
        if not blocked and "MERGE (e:Entity" in query:
            blocked = True
            started.set()
            assert release.wait(timeout=5)
        return original_execute(query, parameters)

    monkeypatch.setattr(store, "_execute_sync", slow_execute)
    write_task = asyncio.create_task(store.upsert_entity(entity("theme:cancelled", "취소 후 완료")))
    assert await asyncio.to_thread(started.wait, 2)
    write_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await write_task
    release.set()

    assert (await store.summary()).entities == 1


async def test_cancelled_close_finishes_before_idempotent_close_returns(
    store: GraphStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = threading.Event()
    release = threading.Event()
    original_close = store._close_sync

    def slow_close() -> None:
        started.set()
        assert release.wait(timeout=5)
        original_close()

    monkeypatch.setattr(store, "_close_sync", slow_close)
    close_task = asyncio.create_task(store.close())
    assert await asyncio.to_thread(started.wait, 2)
    close_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await close_task
    release.set()
    await store.close()

    assert store._connection is None
    assert store._database is None
    assert store._dll_handle is None


async def test_concurrent_writes_are_serialized_without_duplicates(store: GraphStore) -> None:
    records = [entity(f"theme:{index % 8}", f"테마 {index % 8}") for index in range(64)]
    await asyncio.gather(*(store.upsert_entity(record) for record in records))

    assert (await store.summary()).entities == 8


def test_runtime_has_no_prohibited_dependency_or_extension_statements() -> None:
    backend_root = Path(__file__).parents[2]
    project = (backend_root / "pyproject.toml").read_text(encoding="utf-8").lower()
    runtime = "\n".join(
        path.read_text(encoding="utf-8").lower()
        for path in (backend_root / "athena_api" / "brain").glob("*.py")
    )
    prohibited_dependencies = (
        "chro" + "ma",
        "embed" + "ding",
        "vec" + "tor",
    )
    prohibited_runtime = ("install " + "extension", "load " + "extension")

    assert project.count('"ladybug==0.19.1"') == 1
    assert all(token not in project for token in prohibited_dependencies)
    assert all(token not in runtime for token in prohibited_dependencies)
    assert all(token not in runtime for token in prohibited_runtime)
