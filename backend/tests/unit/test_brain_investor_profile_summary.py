"""graph.investor_profile_summary (ADR §6.2 allowlist, plan §2(c)).

Read-time, deterministic time-window aggregation over PREFERS/AVOIDS/INTERESTED_IN
out-edges from the single fixed investor_profile entity -- no embeddings, no model
calls (ADR §7). These tests pin the contract directly against GraphStore rather than
through the HTTP surface, since seeding entities/claims/relations is far more direct at
this layer.
"""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from athena_api.brain import (
    INVESTOR_PROFILE_ENTITY_ID,
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


@pytest.fixture
async def store(tmp_path: Path, ladybug_dll_dir: Path | None):
    if ladybug_dll_dir is None:
        pytest.skip("no local ladybug native runtime available on this machine")
    graph = GraphStore(tmp_path / "profile.lbug", dll_dir=ladybug_dll_dir)
    await graph.open()
    try:
        yield graph
    finally:
        await graph.close()


def _entity(entity_id: str, name: str, kind: EntityKind) -> Entity:
    return Entity(id=entity_id, kind=kind, name=name, created_at=NOW, updated_at=NOW)


def _source(source_id: str) -> SourceRecord:
    return SourceRecord(
        id=source_id,
        kind=SourceKind.CHAT_MESSAGE,
        text="관찰 근거",
        fingerprint=f"fingerprint:{source_id.replace(':', '-')}",
        occurred_at=NOW,
        ingested_at=NOW,
    )


def _claim(claim_id: str, entity_id: str, source_id: str, *, confidence: float, observed_at):
    return Claim(
        id=claim_id,
        kind=ClaimKind.OBSERVATION,
        text="관찰",
        confidence=confidence,
        entity_ids=(entity_id,),
        source_ids=(source_id,),
        observed_at=observed_at,
        extracted_at=observed_at,
    )


def _relation(relation_id: str, kind: RelationKind, target_id: str) -> Relation:
    return Relation(
        id=relation_id,
        kind=kind,
        source_entity_id=INVESTOR_PROFILE_ENTITY_ID,
        target_entity_id=target_id,
        confidence=0.9,
        observed_at=NOW,
        extracted_at=NOW,
    )


async def test_summarizes_only_prefers_avoids_interested_in_within_window(
    store: GraphStore,
) -> None:
    profile = _entity(INVESTOR_PROFILE_ENTITY_ID, "나", EntityKind.INVESTOR_PROFILE)
    security = _entity("security:005930", "삼성전자", EntityKind.SECURITY)
    theme_out_of_window = _entity("theme:legacy", "옛 관심사", EntityKind.THEME)
    theme_wrong_kind = _entity("theme:unrelated", "무관 관계", EntityKind.THEME)
    for item in (profile, security, theme_out_of_window, theme_wrong_kind):
        await store.upsert_entity(item)
    await store.upsert_source(_source("chat:1"))
    await store.upsert_source(_source("chat:2"))
    await store.upsert_source(_source("chat:3"))

    # Two observations about `security`, both inside the 90-day window.
    await store.upsert_claim(
        _claim(
            "claim:1", security.id, "chat:1", confidence=0.6, observed_at=NOW - timedelta(days=40)
        )
    )
    await store.upsert_claim(
        _claim(
            "claim:2", security.id, "chat:2", confidence=0.8, observed_at=NOW - timedelta(days=5)
        )
    )
    # One observation about `theme_out_of_window`, outside the window -- must be excluded.
    await store.upsert_claim(
        _claim(
            "claim:3",
            theme_out_of_window.id,
            "chat:3",
            confidence=0.5,
            observed_at=NOW - timedelta(days=100),
        )
    )

    await store.upsert_relation(_relation("relation:prefers", RelationKind.PREFERS, security.id))
    await store.upsert_relation(
        _relation("relation:avoids-legacy", RelationKind.AVOIDS, theme_out_of_window.id)
    )
    # RELATES_TO is not a profile-signal relation kind -- must be excluded even though
    # a claim exists about the target.
    await store.upsert_relation(
        _relation("relation:relates", RelationKind.RELATES_TO, theme_wrong_kind.id)
    )

    entries = await store.investor_profile_summary(now=NOW, window_days=90, limit=50)

    assert [entry.entity_id for entry in entries] == [security.id]
    entry = entries[0]
    assert entry.relation_kind == RelationKind.PREFERS.value
    assert entry.claim_count == 2
    assert entry.average_confidence == pytest.approx(0.7)
    assert entry.latest_observed_at == (NOW - timedelta(days=5)).isoformat().replace("+00:00", "Z")


async def test_widening_the_window_surfaces_older_observations(store: GraphStore) -> None:
    profile = _entity(INVESTOR_PROFILE_ENTITY_ID, "나", EntityKind.INVESTOR_PROFILE)
    theme = _entity("theme:legacy", "옛 관심사", EntityKind.THEME)
    await store.upsert_entity(profile)
    await store.upsert_entity(theme)
    await store.upsert_source(_source("chat:1"))
    await store.upsert_claim(
        _claim("claim:1", theme.id, "chat:1", confidence=0.5, observed_at=NOW - timedelta(days=100))
    )
    await store.upsert_relation(_relation("relation:avoids", RelationKind.AVOIDS, theme.id))

    assert await store.investor_profile_summary(now=NOW, window_days=90, limit=50) == ()
    widened = await store.investor_profile_summary(now=NOW, window_days=200, limit=50)
    assert [entry.entity_id for entry in widened] == [theme.id]


async def test_ordering_is_deterministic_latest_desc_then_count_desc_then_id(
    store: GraphStore,
) -> None:
    profile = _entity(INVESTOR_PROFILE_ENTITY_ID, "나", EntityKind.INVESTOR_PROFILE)
    older_more_claims = _entity("theme:older-more", "A", EntityKind.THEME)
    newer_fewer_claims = _entity("theme:newer-fewer", "B", EntityKind.THEME)
    for item in (profile, older_more_claims, newer_fewer_claims):
        await store.upsert_entity(item)
    await store.upsert_source(_source("chat:1"))
    await store.upsert_source(_source("chat:2"))
    await store.upsert_source(_source("chat:3"))

    await store.upsert_claim(
        _claim(
            "claim:a1",
            older_more_claims.id,
            "chat:1",
            confidence=0.5,
            observed_at=NOW - timedelta(days=20),
        )
    )
    await store.upsert_claim(
        _claim(
            "claim:a2",
            older_more_claims.id,
            "chat:2",
            confidence=0.5,
            observed_at=NOW - timedelta(days=20),
        )
    )
    await store.upsert_claim(
        _claim(
            "claim:b1",
            newer_fewer_claims.id,
            "chat:3",
            confidence=0.5,
            observed_at=NOW - timedelta(days=1),
        )
    )
    await store.upsert_relation(
        _relation("relation:a", RelationKind.INTERESTED_IN, older_more_claims.id)
    )
    await store.upsert_relation(
        _relation("relation:b", RelationKind.INTERESTED_IN, newer_fewer_claims.id)
    )

    entries = await store.investor_profile_summary(now=NOW, window_days=90, limit=50)
    # `newer_fewer_claims` has the more recent observation, so it sorts first even
    # though it has fewer supporting claims -- latest_observed_at desc is the primary key.
    assert [entry.entity_id for entry in entries] == [newer_fewer_claims.id, older_more_claims.id]


async def test_limit_is_enforced(store: GraphStore) -> None:
    profile = _entity(INVESTOR_PROFILE_ENTITY_ID, "나", EntityKind.INVESTOR_PROFILE)
    await store.upsert_entity(profile)
    for index in range(3):
        target = _entity(f"theme:{index}", f"테마{index}", EntityKind.THEME)
        await store.upsert_entity(target)
        await store.upsert_source(_source(f"chat:{index}"))
        await store.upsert_claim(
            _claim(
                f"claim:{index}",
                target.id,
                f"chat:{index}",
                confidence=0.5,
                observed_at=NOW - timedelta(days=index),
            )
        )
        await store.upsert_relation(
            _relation(f"relation:{index}", RelationKind.PREFERS, target.id)
        )

    entries = await store.investor_profile_summary(now=NOW, window_days=90, limit=2)
    assert len(entries) == 2


async def test_rejects_naive_now_and_out_of_bounds_arguments(store: GraphStore) -> None:
    with pytest.raises(ValueError, match="UTC-aware"):
        await store.investor_profile_summary(now=datetime(2026, 8, 15))
    with pytest.raises(ValueError, match="window_days"):
        await store.investor_profile_summary(now=NOW, window_days=0)
    with pytest.raises(ValueError, match="limit"):
        await store.investor_profile_summary(now=NOW, limit=0)
