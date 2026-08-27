"""brainReady E2E용 임시 브레인 DB 시드 — 실 LLM 없이 store 쓰기 표면만 쓴다.

verify-brain-ready.mjs가 ATHENA_SEED_DB_PATH로 대상 경로를 넘긴다(미지정 시
.omc/tmp/brain-verify.sqlite3). 시드 내용은 결정론 — 엔티티 9·관계 10·군집 4.
"""
import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "backend"))

from athena_api.brain.ontology import (
    Confidence, Entity, EntityKind, Relation, RelationKind,
    SourceKind, SourceRecord, SourceTier, entity_id, relation_id,
)
from athena_api.brain.store import INVESTOR_PROFILE_ENTITY_ID, GraphStore

NOW = datetime(2026, 8, 27, 3, 0, tzinfo=UTC)
DB = Path(os.environ.get("ATHENA_SEED_DB_PATH", str(_ROOT / ".omc" / "tmp" / "brain-verify.sqlite3")))


def ent(kind, name):
    return Entity(id=entity_id(kind, name), kind=kind, name=name, created_at=NOW, updated_at=NOW)


def rel(kind, src, tgt, source_id, conf=Confidence.EXTRACTED, tier=SourceTier.CONVERSATIONAL):
    return Relation(
        id=relation_id(kind, src.id, tgt.id), kind=kind,
        source_entity_id=src.id, target_entity_id=tgt.id,
        confidence=conf, tier=tier, rationale=None,
        source_id=source_id, observed_at=NOW, extracted_at=NOW,
    )


async def main():
    if DB.exists():
        DB.unlink()
    store = GraphStore(DB)
    await store.open()

    profile = Entity(id=INVESTOR_PROFILE_ENTITY_ID, kind=EntityKind.INVESTOR_PROFILE,
                     name="default", created_at=NOW, updated_at=NOW)
    t_semi = ent(EntityKind.THEME, "반도체")
    t_batt = ent(EntityKind.THEME, "이차전지")
    t_ai = ent(EntityKind.THEME, "AI 인프라")
    c_ss = ent(EntityKind.COMPANY, "삼성전자")
    c_sk = ent(EntityKind.COMPANY, "SK하이닉스")
    c_eco = ent(EntityKind.COMPANY, "에코프로")
    p_div = ent(EntityKind.PREFERENCE, "배당 선호")
    g_ret = ent(EntityKind.GOAL, "은퇴 자금")

    for i in range(1, 4):
        await store.upsert_source(SourceRecord(
            id=f"seed-{i}", kind=SourceKind.CONVERSATION, text=f"시드 대화 {i}",
            fingerprint=f"fp-{i}", occurred_at=NOW, ingested_at=NOW,
        ))

    await store.apply_extraction("seed-1", "fp-1",
        (profile, t_semi, c_ss, c_sk),
        (
            rel(RelationKind.INTERESTED_IN, profile, t_semi, "seed-1"),
            rel(RelationKind.BELONGS_TO, c_ss, t_semi, "seed-1"),
            rel(RelationKind.BELONGS_TO, c_sk, t_semi, "seed-1"),
            rel(RelationKind.RESEARCHED, profile, c_ss, "seed-1"),
        ))
    await store.apply_extraction("seed-2", "fp-2",
        (profile, t_batt, c_eco, p_div),
        (
            rel(RelationKind.INTERESTED_IN, profile, t_batt, "seed-2"),
            rel(RelationKind.BELONGS_TO, c_eco, t_batt, "seed-2"),
            rel(RelationKind.PREFERS, profile, p_div, "seed-2"),
        ))
    await store.apply_extraction("seed-3", "fp-3",
        (profile, t_ai, g_ret, c_sk),
        (
            rel(RelationKind.INTERESTED_IN, profile, t_ai, "seed-3"),
            rel(RelationKind.TARGETS, profile, g_ret, "seed-3"),
            rel(RelationKind.RELATES_TO, t_ai, c_sk, "seed-3"),
        ))

    summary = await store.summary()
    print("seeded:", summary)
    await store.close()


asyncio.run(main())
