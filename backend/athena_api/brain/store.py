"""Async-safe investment-brain graph on one SQLite file.

2026-08-25 재설계. LadybugDB 임베디드 그래프를 걷어내고 SQLite로 내려왔다.

**왜 그래프 DB를 버렸나.** 규모 때문이 아니다 — 엔티티 수천·관계 수만은 어떤 저장소에도
부담이 아니다. 이유는 셋이다. (1) 네이티브 휠과 Windows DLL 경로 우회는 Electron 앱을
일반 사용자에게 배포하는 우리에게 매 릴리스마다 갚는 세금이었다. (2) 우리가 그래프 DB에서
실제로 쓰던 것은 upsert와 1홉 조회뿐이었고, 정작 필요한 Louvain·중심성·diff는 Cypher로
표현조차 안 된다 — 그건 NetworkX 투영이 맡는다. (3) FTS5가 표준 내장이라 확장 로딩과
그 실패를 다루던 강등 플래그(`brain_fts_ready`)가 통째로 사라진다.

**왜 파일 하나인가.** 이전 판은 적재 1회가 두 커밋이었다 — 그래프는 `brain.lbug`,
잡 상태는 `brain-history.sqlite3`. 그 사이에서 죽으면 잡은 done인데 그래프엔 안 들어간
상태가 남는다. 한 파일이면 그 버그 종류가 구조적으로 사라진다.

**동시성.** 연속 적재(대화마다) + 동시 리더(API) + 임의 종료(`reset-and-restart`가 스스로
SIGTERM을 날린다)가 이 저장소의 실제 부하다. `history.py`가 이미 검증한 설정을 그대로
쓴다: 단일 소유자 스레드 + `isolation_level=None`(명시적 BEGIN) + WAL + busy_timeout.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final

from .db import SqliteOwner, atomic
from .ontology import (
    INVESTOR_PROFILE_NAME,
    Confidence,
    Entity,
    EntityKind,
    GraphEvent,
    GraphEventOp,
    Relation,
    SourceRecord,
    SourceTier,
    entity_id,
    normalize_identity,
    relation_id,
)

SCHEMA_VERSION: Final = 2
MAX_SEARCH_LIMIT: Final = 100
MAX_NEIGHBORHOOD_DEPTH: Final = 3
MAX_ENTITIES_PER_EXTRACTION: Final = 64
MAX_RELATIONS_PER_EXTRACTION: Final = 128

# 이 단일 사용자 로컬 앱에는 투자자가 한 명뿐이다. 발견도 없고 호출자별 id도 없다 —
# `investor_profile_summary()`가 읽는 유일한 id다.
INVESTOR_PROFILE_ENTITY_ID: Final = entity_id(EntityKind.INVESTOR_PROFILE, INVESTOR_PROFILE_NAME)

# `reset_projection()`이 남기는 이벤트의 주체. 엔티티 id가 아니라 표식이라 `events()`가
# 이 값을 걸러낸다 — 로그를 읽는 쪽이 존재하지 않는 노드를 만나지 않게 한다.
_PROJECTION_MARKER: Final = "projection"


def _graph_event_from_row(row: sqlite3.Row) -> GraphEvent:
    """`graph_events` 행 하나를 `GraphEvent`로 — `events()`·`entity_events()`가 공유한다."""
    return GraphEvent(
        seq=int(row["seq"]),
        at=datetime.fromisoformat(str(row["at"])),
        revision=int(row["revision"]),
        op=GraphEventOp(str(row["op"])),
        subject_id=str(row["subject_id"]),
        object_id=None if row["object_id"] is None else str(row["object_id"]),
        relation=None if row["relation"] is None else str(row["relation"]),
        confidence_before=(
            None if row["confidence_before"] is None else Confidence(str(row["confidence_before"]))
        ),
        confidence_after=(
            None if row["confidence_after"] is None else Confidence(str(row["confidence_after"]))
        ),
        source_id=None if row["source_id"] is None else str(row["source_id"]),
    )

# 그래프 쓰기 한 단위의 savepoint 이름. 그래프 쓰기끼리는 중첩하지 않으므로 하나면 된다.
_GRAPH_WRITE: Final = "graph_write"

_SCHEMA: Final = """
CREATE TABLE IF NOT EXISTS graph_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    name            TEXT NOT NULL,
    norm_name       TEXT NOT NULL,
    aliases_json    TEXT NOT NULL,
    attributes_json TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind);
CREATE TABLE IF NOT EXISTS sources (
    id              TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    text            TEXT NOT NULL,
    locator         TEXT,
    fingerprint     TEXT NOT NULL,
    attributes_json TEXT NOT NULL,
    occurred_at     TEXT NOT NULL,
    ingested_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relations (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,
    source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    confidence       TEXT NOT NULL,
    tier             TEXT NOT NULL,
    rationale        TEXT,
    source_id        TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    attributes_json  TEXT NOT NULL,
    observed_at      TEXT NOT NULL,
    extracted_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relations_src ON relations(source_entity_id);
CREATE INDEX IF NOT EXISTS relations_tgt ON relations(target_entity_id);
CREATE INDEX IF NOT EXISTS relations_source ON relations(source_id);
CREATE TABLE IF NOT EXISTS graph_events (
    seq               INTEGER PRIMARY KEY AUTOINCREMENT,
    at                TEXT NOT NULL,
    revision          INTEGER NOT NULL,
    op                TEXT NOT NULL,
    subject_id        TEXT NOT NULL,
    object_id         TEXT,
    relation          TEXT,
    confidence_before TEXT,
    confidence_after  TEXT,
    source_id         TEXT
);
CREATE INDEX IF NOT EXISTS graph_events_subject ON graph_events(subject_id);
CREATE INDEX IF NOT EXISTS graph_events_at ON graph_events(at);
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
    entity_id UNINDEXED,
    name,
    aliases,
    tokenize = 'unicode61 remove_diacritics 2'
);
"""


@dataclass(frozen=True, slots=True)
class GraphSummary:
    entities: int
    sources: int
    relations: int
    events: int
    revision: int


@dataclass(frozen=True, slots=True)
class EntityRow:
    """dedup이 병합 후보를 고를 때 보는 한 행.

    `Entity`를 그대로 쓰지 않는 이유는 `degree` 때문이다. 차수는 엔티티의 속성이 아니라
    그래프의 성질이고, 승자 선택이 그것에 달려 있다.
    """

    id: str
    kind: str
    name: str
    normalized_name: str
    aliases: tuple[str, ...]
    degree: int
    created_at: str


@dataclass(frozen=True, slots=True)
class RelationRow:
    """관계 한 행. 투영과 분석이 보는 모양이다.

    `Relation`(온톨로지)을 그대로 쓰지 않는 이유는 타임스탬프 파싱 때문이다. 투영은
    수천 행을 한 번에 읽는데, 그중 대부분은 시각을 보지 않는다.
    """

    id: str
    kind: str
    source_entity_id: str
    target_entity_id: str
    confidence: str
    tier: str
    rationale: str | None
    source_id: str
    observed_at: str


@dataclass(frozen=True, slots=True)
class EntitySearchHit:
    entity_id: str
    kind: str
    name: str
    score: float


@dataclass(frozen=True, slots=True)
class NeighborhoodEdge:
    relation_id: str
    kind: str
    source_entity_id: str
    target_entity_id: str
    confidence: str
    tier: str
    depth: int


@dataclass(frozen=True, slots=True)
class InvestorProfileSummaryEntry:
    """`GET /api/v1/brain/profile-summary` 한 행.

    이전 판의 `claim_count`/`average_confidence`가 사라지고 `reinforcement`가 들어왔다.
    Claim을 폐기하면서 "몇 번 재확인됐는가"를 그래프에서 셀 수 없게 됐지만,
    `graph_events`가 그 이력을 갖고 있어 창 안에서 집계하면 같은 질문에 답할 수 있다.
    그래프는 현재 상태만, 횟수는 로그에서 — 두 역할이 갈린 결과다.
    """

    entity_id: str
    entity_kind: str
    entity_name: str
    relation_kind: str
    confidence: str
    tier: str
    rationale: str | None
    observed_at: str
    reinforcement: int


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _ts(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _fts_query(raw: str) -> str:
    """사용자 문자열을 FTS5 MATCH 식으로 바꾼다.

    각 토큰을 따옴표로 감싸 리터럴로 만든다 — 사용자가 친 `AND`/`*`/`NEAR`가 연산자로
    해석되면 검색이 조용히 다른 뜻이 되고, 최악에는 구문 오류로 터진다.
    """
    tokens = [t.replace('"', "") for t in re.split(r"\s+", raw.strip()) if t.strip()]
    return " OR ".join(f'"{token}"' for token in tokens) if tokens else '""'


class GraphStore:
    """단일 소유자 스레드 위의 SQLite 그래프.

    `open()`은 한 번만 유효하다. 닫은 뒤 다시 열지 않는 것은 `reset-and-restart`의
    계약이기도 하다 — 리셋은 이 객체를 되살리는 대신 프로세스를 재기동하고, 다음 부팅의
    평범한 열기 경로를 탄다. 재사용을 허용하면 "닫혔지만 살아 있는" 중간 상태가 생기고
    그건 정합성 사고의 자리다.
    """

    def __init__(
        self, path: Path | SqliteOwner, *, busy_timeout_ms: int = 5_000
    ) -> None:
        """경로를 주면 파일을 혼자 소유하고, `SqliteOwner`를 주면 나눠 쓴다.

        나눠 쓰는 쪽이 운영 경로다 — `HistoryStore`와 같은 연결을 쓰면 커서 전진과
        그래프 쓰기를 커밋 하나로 묶을 수 있다. 경로를 받는 쪽은 그래프만 단독으로
        여는 테스트와 도구를 위해 남긴다.
        """
        if isinstance(path, SqliteOwner):
            self._owner = path
            self._owns_connection = False
        else:
            self._owner = SqliteOwner(
                Path(path),
                busy_timeout_ms=busy_timeout_ms,
                thread_name_prefix="brain-graph-store",
            )
            self._owns_connection = True
        self.path = self._owner.path

    @property
    def is_open(self) -> bool:
        return self._owner.is_open

    @property
    def owner(self) -> SqliteOwner:
        return self._owner

    async def open(self) -> None:
        if self._owns_connection:
            await self._owner.open()
        elif not self._owner.is_open:
            raise RuntimeError("shared sqlite owner must be opened before the graph store")
        await self._owner.install_schema("graph", _SCHEMA, SCHEMA_VERSION)
        await self._owner.run(self._seed_revision)

    def _seed_revision(self) -> None:
        self._require().execute(
            "INSERT INTO graph_meta(key, value) VALUES('revision', '0') "
            "ON CONFLICT(key) DO NOTHING"
        )

    async def close(self) -> None:
        # 연결을 빌려 쓰는 경우 닫는 것은 소유자의 일이다. 빌린 쪽이 닫으면 아직 쓰고
        # 있는 다른 저장소의 발밑이 사라진다.
        if self._owns_connection:
            await self._owner.close()

    def _require(self) -> sqlite3.Connection:
        return self._owner.require()

    async def schema_version(self) -> int:
        return await self._owner.schema_version("graph")

    async def graph_revision(self) -> int:
        def read() -> int:
            return self._read_revision(self._require())

        return await self._owner.run(read)

    @staticmethod
    def _read_revision(connection: sqlite3.Connection) -> int:
        row = connection.execute("SELECT value FROM graph_meta WHERE key='revision'").fetchone()
        return int(row["value"]) if row else 0

    @staticmethod
    def _bump_revision(connection: sqlite3.Connection) -> int:
        revision = GraphStore._read_revision(connection) + 1
        connection.execute(
            "INSERT INTO graph_meta(key, value) VALUES('revision', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(revision),),
        )
        return revision

    @staticmethod
    def _record_event(
        connection: sqlite3.Connection,
        *,
        revision: int,
        op: GraphEventOp,
        subject_id: str,
        object_id: str | None = None,
        relation: str | None = None,
        confidence_before: str | None = None,
        confidence_after: str | None = None,
        source_id: str | None = None,
    ) -> None:
        connection.execute(
            "INSERT INTO graph_events(at, revision, op, subject_id, object_id, relation,"
            " confidence_before, confidence_after, source_id) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                _ts(utc_now()),
                revision,
                op.value,
                subject_id,
                object_id,
                relation,
                confidence_before,
                confidence_after,
                source_id,
            ),
        )

    # ── 쓰기 ────────────────────────────────────────────────────────────────

    async def upsert_source(self, source: SourceRecord) -> str:
        def write() -> str:
            connection = self._require()
            with atomic(connection, _GRAPH_WRITE):
                self._upsert_source_row(connection, source)
            return source.id

        return await self._owner.run(write)

    @staticmethod
    def _upsert_source_row(connection: sqlite3.Connection, source: SourceRecord) -> None:
        connection.execute(
            "INSERT INTO sources(id, kind, text, locator, fingerprint, attributes_json,"
            " occurred_at, ingested_at) VALUES(?,?,?,?,?,?,?,?)"
            " ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, text=excluded.text,"
            " locator=excluded.locator, fingerprint=excluded.fingerprint,"
            " attributes_json=excluded.attributes_json, occurred_at=excluded.occurred_at,"
            " ingested_at=excluded.ingested_at",
            (
                source.id,
                source.kind.value,
                source.text,
                source.locator,
                source.fingerprint,
                _json(source.attributes),
                _ts(source.occurred_at),
                _ts(source.ingested_at),
            ),
        )

    async def upsert_entity(self, entity: Entity) -> str:
        def write() -> str:
            connection = self._require()
            with atomic(connection, _GRAPH_WRITE):
                revision = self._bump_revision(connection)
                self._upsert_entity_row(connection, entity, revision=revision)
            return entity.id

        return await self._owner.run(write)

    @staticmethod
    def _upsert_entity_row(
        connection: sqlite3.Connection, entity: Entity, *, revision: int
    ) -> bool:
        """엔티티를 쓰고 신규였는지 돌려준다. `created_at`은 최초 값을 지킨다."""
        existed = (
            connection.execute("SELECT 1 FROM entities WHERE id = ?", (entity.id,)).fetchone()
            is not None
        )
        connection.execute(
            "INSERT INTO entities(id, kind, name, norm_name, aliases_json, attributes_json,"
            " created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)"
            " ON CONFLICT(id) DO UPDATE SET aliases_json=excluded.aliases_json,"
            " attributes_json=excluded.attributes_json, updated_at=excluded.updated_at",
            (
                entity.id,
                entity.kind.value,
                entity.name,
                normalize_identity(entity.name),
                _json(list(entity.aliases)),
                _json(entity.attributes),
                _ts(entity.created_at),
                _ts(entity.updated_at),
            ),
        )
        connection.execute("DELETE FROM entities_fts WHERE entity_id = ?", (entity.id,))
        connection.execute(
            "INSERT INTO entities_fts(entity_id, name, aliases) VALUES(?,?,?)",
            (entity.id, entity.name, " ".join(entity.aliases)),
        )
        if not existed:
            GraphStore._record_event(
                connection,
                revision=revision,
                op=GraphEventOp.ENTITY_ADDED,
                subject_id=entity.id,
            )
        return not existed

    async def entities(
        self, *, kind: EntityKind | None = None
    ) -> tuple[EntityRow, ...]:
        """엔티티 목록을 차수와 함께. dedup이 병합 후보를 고를 때 쓴다.

        차수를 여기서 함께 세는 이유는 승자 선택이 결정적이어야 하기 때문이다 —
        dedup이 엔티티마다 따로 물으면 그 사이에 그래프가 바뀔 수 있고, 그러면 같은
        입력에 다른 승자가 나온다.
        """

        def read() -> tuple[EntityRow, ...]:
            sql = (
                "SELECT e.id, e.kind, e.name, e.norm_name, e.aliases_json, e.created_at,"
                " (SELECT count(*) FROM relations r"
                "    WHERE r.source_entity_id = e.id OR r.target_entity_id = e.id) AS degree"
                " FROM entities e"
            )
            params: tuple[Any, ...] = ()
            if kind is not None:
                sql += " WHERE e.kind = ?"
                params = (kind.value,)
            sql += " ORDER BY e.id"
            return tuple(
                EntityRow(
                    id=str(row["id"]),
                    kind=str(row["kind"]),
                    name=str(row["name"]),
                    normalized_name=str(row["norm_name"]),
                    aliases=tuple(json.loads(str(row["aliases_json"]))),
                    degree=int(row["degree"]),
                    created_at=str(row["created_at"]),
                )
                for row in self._require().execute(sql, params)
            )

        return await self._owner.run(read)

    async def relations(self) -> tuple[RelationRow, ...]:
        """관계 전체. NetworkX 투영이 그래프를 한 번에 짓는 데 쓴다.

        `neighborhood()`를 노드마다 부르면 N번 왕복하고, 그 사이 그래프가 바뀌면 투영이
        일관되지 않은 시점의 조각들로 지어진다.
        """

        def read() -> tuple[RelationRow, ...]:
            return tuple(
                RelationRow(
                    id=str(row["id"]),
                    kind=str(row["kind"]),
                    source_entity_id=str(row["source_entity_id"]),
                    target_entity_id=str(row["target_entity_id"]),
                    confidence=str(row["confidence"]),
                    tier=str(row["tier"]),
                    rationale=row["rationale"],
                    source_id=str(row["source_id"]),
                    observed_at=str(row["observed_at"]),
                )
                for row in self._require().execute(
                    "SELECT id, kind, source_entity_id, target_entity_id, confidence, tier,"
                    " rationale, source_id, observed_at FROM relations ORDER BY id"
                )
            )

        return await self._owner.run(read)

    async def merge_entities(self, winner_id: str, loser_id: str) -> None:
        """진 엔티티를 승자에 접고, 그 관계를 승자로 옮긴다.

        `INVESTOR_PROFILE`은 거부한다. 그 id는 고정값이고 `investor_profile_summary()`가
        유일하게 그것만 읽는다 — 접히는 순간 프로필이 통째로 비는데 아무것도 터지지
        않는다. 정책(종목은 병합 금지)은 `dedup`이 정하지만, 이 하나는 저장층의 구조적
        불변식이라 여기서 막는다.
        """
        if winner_id == loser_id:
            raise ValueError("cannot merge an entity into itself")
        if INVESTOR_PROFILE_ENTITY_ID in (winner_id, loser_id):
            raise ValueError("the investor profile entity cannot take part in a merge")

        def write() -> None:
            connection = self._require()
            with atomic(connection, _GRAPH_WRITE):
                winner = connection.execute(
                    "SELECT * FROM entities WHERE id = ?", (winner_id,)
                ).fetchone()
                loser = connection.execute(
                    "SELECT * FROM entities WHERE id = ?", (loser_id,)
                ).fetchone()
                if winner is None or loser is None:
                    raise ValueError("both merge participants must exist")
                if str(winner["kind"]) != str(loser["kind"]):
                    raise ValueError("entities of different kinds cannot be merged")

                revision = self._bump_revision(connection)
                self._move_relations(connection, winner_id, loser_id, revision=revision)

                # 진 쪽의 이름과 별칭이 승자의 별칭으로 살아남는다. 병합됐다고 그 이름으로
                # 검색이 안 되면, 사용자가 아는 이름이 그래프에서 사라진 것처럼 보인다.
                aliases = list(json.loads(str(winner["aliases_json"])))
                aliases.extend(json.loads(str(loser["aliases_json"])))
                aliases.append(str(loser["name"]))
                merged: list[str] = []
                for alias in aliases:
                    if alias != str(winner["name"]) and alias not in merged:
                        merged.append(alias)

                connection.execute(
                    "UPDATE entities SET aliases_json = ? WHERE id = ?",
                    (_json(merged), winner_id),
                )
                connection.execute("DELETE FROM entities_fts WHERE entity_id = ?", (winner_id,))
                connection.execute(
                    "INSERT INTO entities_fts(entity_id, name, aliases) VALUES(?,?,?)",
                    (winner_id, str(winner["name"]), " ".join(merged)),
                )
                connection.execute("DELETE FROM entities_fts WHERE entity_id = ?", (loser_id,))
                connection.execute("DELETE FROM entities WHERE id = ?", (loser_id,))

                self._record_event(
                    connection,
                    revision=revision,
                    op=GraphEventOp.ENTITY_MERGED,
                    subject_id=loser_id,
                    object_id=winner_id,
                )

        await self._owner.run(write)

    @staticmethod
    def _move_relations(
        connection: sqlite3.Connection, winner_id: str, loser_id: str, *, revision: int
    ) -> None:
        """진 엔티티에 붙은 엣지를 승자 쪽으로 옮긴다.

        세 갈래를 모두 다뤄야 한다. (1) 옮기면 자기 자신으로 향하는 엣지가 되는 경우 —
        `A -> B`에서 A와 B가 접히면 그렇게 된다. 온톨로지가 자기 루프를 금지하므로 버린다.
        (2) 옮긴 자리에 이미 같은 `(출발, 도착, 종류)`가 있는 경우 — 티어 우선순위로
        승자를 정한다. 적재 경로와 같은 규칙을 쓰지 않으면 병합이 결정적 티어를 조용히
        덮어쓸 수 있다. (3) 나머지는 그대로 옮긴다.
        """
        rows = connection.execute(
            "SELECT * FROM relations WHERE source_entity_id = ? OR target_entity_id = ?",
            (loser_id, loser_id),
        ).fetchall()
        for row in rows:
            old_id = str(row["id"])
            kind = str(row["kind"])
            src = winner_id if str(row["source_entity_id"]) == loser_id else str(
                row["source_entity_id"]
            )
            tgt = winner_id if str(row["target_entity_id"]) == loser_id else str(
                row["target_entity_id"]
            )
            connection.execute("DELETE FROM relations WHERE id = ?", (old_id,))

            if src == tgt:
                GraphStore._record_event(
                    connection,
                    revision=revision,
                    op=GraphEventOp.EDGE_REMOVED,
                    subject_id=str(row["source_entity_id"]),
                    object_id=str(row["target_entity_id"]),
                    relation=kind,
                    confidence_before=str(row["confidence"]),
                    source_id=str(row["source_id"]),
                )
                continue

            new_id = relation_id(kind, src, tgt)
            incumbent = connection.execute(
                "SELECT * FROM relations WHERE id = ?", (new_id,)
            ).fetchone()
            if incumbent is not None:
                incumbent_wins = (
                    str(incumbent["tier"]) == SourceTier.DETERMINISTIC.value
                    and str(row["tier"]) == SourceTier.CONVERSATIONAL.value
                )
                if incumbent_wins:
                    GraphStore._record_event(
                        connection,
                        revision=revision,
                        op=GraphEventOp.EDGE_REJECTED,
                        subject_id=src,
                        object_id=tgt,
                        relation=kind,
                        confidence_before=str(incumbent["confidence"]),
                        confidence_after=str(row["confidence"]),
                        source_id=str(row["source_id"]),
                    )
                    continue
                connection.execute("DELETE FROM relations WHERE id = ?", (new_id,))

            connection.execute(
                "INSERT INTO relations(id, kind, source_entity_id, target_entity_id, confidence,"
                " tier, rationale, source_id, attributes_json, observed_at, extracted_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_id,
                    kind,
                    src,
                    tgt,
                    str(row["confidence"]),
                    str(row["tier"]),
                    row["rationale"],
                    str(row["source_id"]),
                    str(row["attributes_json"]),
                    str(row["observed_at"]),
                    str(row["extracted_at"]),
                ),
            )

    async def apply_extraction(
        self,
        source_id: str,
        source_fingerprint: str,
        entities: tuple[Entity, ...],
        relations: tuple[Relation, ...],
    ) -> None:
        """한 소스가 주장하는 관계 전체를 원자적으로 교체한다.

        핵심은 티어 우선순위다. 어떤 엣지를 결정적 티어(체결·잔고)가 이미 주장하고 있으면
        대화 티어의 같은 엣지는 **무시된다**. 이것이 없으면 적재 순서가 진실을 정하게 된다 —
        체결 적재가 나중이면 체결이 이기고 대화가 나중이면 대화가 이기는, 실행 순서에
        따라 그래프가 달라지는 상태. graphify가 AST 노드를 정본으로 삼고 LLM 노드를
        ghost로 제거하는 규칙과 같은 문제를 같은 방식으로 막는다.
        """
        if not 1 <= len(source_id) <= 128 or not 1 <= len(source_fingerprint) <= 128:
            raise ValueError("source binding is out of bounds")
        if len(entities) > MAX_ENTITIES_PER_EXTRACTION:
            raise ValueError("extraction exceeds entity count limit")
        if len(relations) > MAX_RELATIONS_PER_EXTRACTION:
            raise ValueError("extraction exceeds relation count limit")
        entity_ids = {entity.id for entity in entities}
        if len(entity_ids) != len(entities):
            raise ValueError("extraction entity ids must be unique")
        if len({relation.id for relation in relations}) != len(relations):
            raise ValueError("extraction relation ids must be unique")
        for relation in relations:
            if relation.source_id != source_id:
                raise ValueError("extraction relation provenance must match its source")
            if {relation.source_entity_id, relation.target_entity_id} - entity_ids:
                raise ValueError("extraction relation endpoints must be supplied entities")

        def write() -> None:
            connection = self._require()
            with atomic(connection, _GRAPH_WRITE):
                row = connection.execute(
                    "SELECT fingerprint FROM sources WHERE id = ?", (source_id,)
                ).fetchone()
                if row is None or str(row["fingerprint"]) != source_fingerprint:
                    raise ValueError("source does not exist or fingerprint does not match")

                revision = self._bump_revision(connection)
                for entity in entities:
                    self._upsert_entity_row(connection, entity, revision=revision)

                stale = {
                    str(r["id"])
                    for r in connection.execute(
                        "SELECT id FROM relations WHERE source_id = ?", (source_id,)
                    )
                }
                for relation in relations:
                    stale.discard(relation.id)
                    self._apply_one_relation(connection, relation, revision=revision)

                for relation_row_id in sorted(stale):
                    existing = connection.execute(
                        "SELECT * FROM relations WHERE id = ?", (relation_row_id,)
                    ).fetchone()
                    connection.execute("DELETE FROM relations WHERE id = ?", (relation_row_id,))
                    if existing is not None:
                        self._record_event(
                            connection,
                            revision=revision,
                            op=GraphEventOp.EDGE_REMOVED,
                            subject_id=str(existing["source_entity_id"]),
                            object_id=str(existing["target_entity_id"]),
                            relation=str(existing["kind"]),
                            confidence_before=str(existing["confidence"]),
                            source_id=source_id,
                        )

        await self._owner.run(write)

    @staticmethod
    def _apply_one_relation(
        connection: sqlite3.Connection, relation: Relation, *, revision: int
    ) -> None:
        existing = connection.execute(
            "SELECT * FROM relations WHERE id = ?", (relation.id,)
        ).fetchone()

        if existing is not None:
            owned_by_other = str(existing["source_id"]) != relation.source_id
            incumbent_is_fact = str(existing["tier"]) == SourceTier.DETERMINISTIC.value
            challenger_is_talk = relation.tier is SourceTier.CONVERSATIONAL
            if owned_by_other and incumbent_is_fact and challenger_is_talk:
                # 체결·잔고가 이미 주장한 엣지를 대화가 덮지 못한다. 다만 **밀렸다는 사실을
                # 기록한다** — 그러지 않으면 "말과 행동이 어긋났다"는 신호가 쓰기 순서에
                # 좌우된다. 대화가 먼저 쓰였을 때만 EDGE_ADDED로 남고 체결이 먼저면
                # 사라지는 비대칭이 실제로 있었다. 그 대조는 분석 계층이 읽는다.
                GraphStore._record_event(
                    connection,
                    revision=revision,
                    op=GraphEventOp.EDGE_REJECTED,
                    subject_id=relation.source_entity_id,
                    object_id=relation.target_entity_id,
                    relation=relation.kind,
                    confidence_before=str(existing["confidence"]),
                    confidence_after=relation.confidence.value,
                    source_id=relation.source_id,
                )
                return

        before = str(existing["confidence"]) if existing is not None else None
        connection.execute(
            "INSERT INTO relations(id, kind, source_entity_id, target_entity_id, confidence,"
            " tier, rationale, source_id, attributes_json, observed_at, extracted_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(id) DO UPDATE SET confidence=excluded.confidence,"
            " tier=excluded.tier, rationale=excluded.rationale, source_id=excluded.source_id,"
            " attributes_json=excluded.attributes_json, observed_at=excluded.observed_at,"
            " extracted_at=excluded.extracted_at",
            (
                relation.id,
                relation.kind,
                relation.source_entity_id,
                relation.target_entity_id,
                relation.confidence.value,
                relation.tier.value,
                relation.rationale,
                relation.source_id,
                _json(relation.attributes),
                _ts(relation.observed_at),
                _ts(relation.extracted_at),
            ),
        )

        if existing is None:
            op = GraphEventOp.EDGE_ADDED
        elif (
            before != relation.confidence.value
            or str(existing["tier"]) != relation.tier.value
            or str(existing["source_id"]) != relation.source_id
        ):
            op = GraphEventOp.EDGE_CHANGED
        else:
            # 값이 그대로면 이벤트를 남기지 않는다. 같은 대화를 두 번 적재해도 로그가
            # 부풀지 않아야 `reinforcement`가 "재확인 횟수"라는 의미를 지킨다.
            return

        GraphStore._record_event(
            connection,
            revision=revision,
            op=op,
            subject_id=relation.source_entity_id,
            object_id=relation.target_entity_id,
            relation=relation.kind,
            confidence_before=before,
            confidence_after=relation.confidence.value,
            source_id=relation.source_id,
        )

    async def reset_projection(self) -> None:
        """파생 그래프만 비운다. 원본(`sources`)과 이벤트 로그는 남는다."""

        def write() -> None:
            connection = self._require()
            with atomic(connection, _GRAPH_WRITE):
                revision = self._bump_revision(connection)
                connection.execute("DELETE FROM relations")
                connection.execute("DELETE FROM entities")
                connection.execute("DELETE FROM entities_fts")
                self._record_event(
                    connection,
                    revision=revision,
                    op=GraphEventOp.EDGE_REMOVED,
                    subject_id=_PROJECTION_MARKER,
                )

        await self._owner.run(write)

    # ── 읽기 ────────────────────────────────────────────────────────────────

    async def summary(self) -> GraphSummary:
        def read() -> GraphSummary:
            connection = self._require()

            def count(table: str) -> int:
                return int(
                    connection.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"]
                )

            return GraphSummary(
                entities=count("entities"),
                sources=count("sources"),
                relations=count("relations"),
                events=count("graph_events"),
                revision=self._read_revision(connection),
            )

        return await self._owner.run(read)

    async def search_entities(self, query: str, *, limit: int = 20) -> tuple[EntitySearchHit, ...]:
        """FTS5 BM25 검색. 확장 로딩도, 실패 시 강등 플래그도 필요 없다."""
        if not query.strip():
            return ()
        bounded = max(1, min(int(limit), MAX_SEARCH_LIMIT))

        def read() -> tuple[EntitySearchHit, ...]:
            rows = self._require().execute(
                "SELECT f.entity_id AS entity_id, e.kind AS kind, e.name AS name,"
                " bm25(entities_fts) AS score FROM entities_fts f"
                " JOIN entities e ON e.id = f.entity_id"
                " WHERE entities_fts MATCH ? ORDER BY score LIMIT ?",
                (_fts_query(query), bounded),
            ).fetchall()
            return tuple(
                EntitySearchHit(
                    entity_id=str(r["entity_id"]),
                    kind=str(r["kind"]),
                    name=str(r["name"]),
                    score=float(r["score"]),
                )
                for r in rows
            )

        return await self._owner.run(read)

    async def neighborhood(
        self, root_entity_id: str, *, depth: int = 1, limit: int = 100
    ) -> tuple[NeighborhoodEdge, ...]:
        bounded_depth = max(1, min(int(depth), MAX_NEIGHBORHOOD_DEPTH))
        bounded_limit = max(1, min(int(limit), MAX_SEARCH_LIMIT))

        def read() -> tuple[NeighborhoodEdge, ...]:
            connection = self._require()
            seen_entities = {root_entity_id}
            frontier = {root_entity_id}
            edges: list[NeighborhoodEdge] = []
            emitted: set[str] = set()
            for level in range(1, bounded_depth + 1):
                if not frontier:
                    break
                ordered = sorted(frontier)
                placeholders = ",".join("?" for _ in ordered)
                rows = connection.execute(
                    "SELECT * FROM relations WHERE source_entity_id IN"
                    f" ({placeholders}) OR target_entity_id IN ({placeholders})"
                    " ORDER BY id",
                    (*ordered, *ordered),
                ).fetchall()
                next_frontier: set[str] = set()
                for row in rows:
                    relation_row_id = str(row["id"])
                    if relation_row_id in emitted:
                        continue
                    emitted.add(relation_row_id)
                    edges.append(
                        NeighborhoodEdge(
                            relation_id=relation_row_id,
                            kind=str(row["kind"]),
                            source_entity_id=str(row["source_entity_id"]),
                            target_entity_id=str(row["target_entity_id"]),
                            confidence=str(row["confidence"]),
                            tier=str(row["tier"]),
                            depth=level,
                        )
                    )
                    for endpoint in (row["source_entity_id"], row["target_entity_id"]):
                        if str(endpoint) not in seen_entities:
                            seen_entities.add(str(endpoint))
                            next_frontier.add(str(endpoint))
                    if len(edges) >= bounded_limit:
                        return tuple(edges[:bounded_limit])
                frontier = next_frontier
            return tuple(edges[:bounded_limit])

        return await self._owner.run(read)

    async def events(self, *, after_seq: int = 0, limit: int = 100) -> tuple[GraphEvent, ...]:
        bounded = max(1, min(int(limit), MAX_SEARCH_LIMIT))

        def read() -> tuple[GraphEvent, ...]:
            rows = self._require().execute(
                "SELECT * FROM graph_events WHERE seq > ? AND subject_id <> ?"
                " ORDER BY seq LIMIT ?",
                (int(after_seq), _PROJECTION_MARKER, bounded),
            ).fetchall()
            return tuple(_graph_event_from_row(r) for r in rows)

        return await self._owner.run(read)

    async def entity_events(
        self, entity_id: str, *, limit: int = 50
    ) -> tuple[GraphEvent, ...]:
        """엔티티 하나가 얽힌 변경 이력 — 최신 먼저(엔티티 타임라인 패널의 재료).

        `subject_id`(주체) 또는 `object_id`(대상) 어느 쪽으로 등장해도 잡는다.
        `investor_profile_summary()`의 쿼리 구성 패턴(WHERE + ORDER BY + LIMIT, 기존
        인덱스만 사용)을 그대로 따른다 — 새 테이블·새 인덱스 없음. `events()`와 같은
        이유로 `_PROJECTION_MARKER`(재투영 표식) 이벤트는 제외한다.
        """
        bounded = max(1, min(int(limit), MAX_SEARCH_LIMIT))

        def read() -> tuple[GraphEvent, ...]:
            rows = self._require().execute(
                "SELECT * FROM graph_events WHERE (subject_id = ? OR object_id = ?)"
                " AND subject_id <> ? ORDER BY seq DESC LIMIT ?",
                (entity_id, entity_id, _PROJECTION_MARKER, bounded),
            ).fetchall()
            return tuple(_graph_event_from_row(r) for r in rows)

        return await self._owner.run(read)

    async def investor_profile_summary(
        self, *, now: datetime, window_days: int = 90, limit: int = 50
    ) -> tuple[InvestorProfileSummaryEntry, ...]:
        """투자자 프로필에서 뻗은 관계를 보강 횟수 순으로.

        `reinforcement`는 그래프가 아니라 `graph_events`를 창 안에서 센 값이다.
        엣지는 누적하지 않기로 했으므로(덮어쓰기) 그래프만 봐서는 한 번 말한 것과 열 번
        말한 것이 구별되지 않는다 — 그 구별을 로그가 복원한다.
        """
        if now.tzinfo is None or now.utcoffset() is None:
            # naive를 `astimezone(UTC)`에 넘기면 파이썬이 **로컬 시간대로 가정**해서
            # 조용히 다른 창을 연다. KST에서는 9시간이 밀리므로 경계의 관계가 이유 없이
            # 들어오거나 빠진다. 터지지 않는 실패라 더 나쁘다.
            raise ValueError("now must be UTC-aware")
        if window_days <= 0:
            raise ValueError("window_days must be positive")
        if limit <= 0:
            # 0이나 음수를 1로 조용히 접으면 호출자는 "한 건뿐"이라는 잘못된 답을 받는다.
            raise ValueError("limit must be positive")
        cutoff = _ts(now.astimezone(UTC) - timedelta(days=window_days))
        bounded = min(int(limit), MAX_SEARCH_LIMIT)

        def read() -> tuple[InvestorProfileSummaryEntry, ...]:
            rows = self._require().execute(
                "SELECT r.kind AS relation_kind, r.confidence AS confidence, r.tier AS tier,"
                " r.rationale AS rationale, r.observed_at AS observed_at,"
                " e.id AS entity_id, e.kind AS entity_kind, e.name AS entity_name,"
                " (SELECT count(*) FROM graph_events g"
                "    WHERE g.subject_id = r.source_entity_id"
                "      AND g.object_id = r.target_entity_id"
                "      AND g.relation = r.kind"
                "      AND g.at >= ?) AS reinforcement"
                " FROM relations r JOIN entities e ON e.id = r.target_entity_id"
                " WHERE r.source_entity_id = ? AND r.observed_at >= ?"
                " ORDER BY reinforcement DESC, r.observed_at DESC, e.name ASC LIMIT ?",
                (cutoff, INVESTOR_PROFILE_ENTITY_ID, cutoff, bounded),
            ).fetchall()
            return tuple(
                InvestorProfileSummaryEntry(
                    entity_id=str(r["entity_id"]),
                    entity_kind=str(r["entity_kind"]),
                    entity_name=str(r["entity_name"]),
                    relation_kind=str(r["relation_kind"]),
                    confidence=str(r["confidence"]),
                    tier=str(r["tier"]),
                    rationale=None if r["rationale"] is None else str(r["rationale"]),
                    observed_at=str(r["observed_at"]),
                    reinforcement=int(r["reinforcement"]),
                )
                for r in rows
            )

        return await self._owner.run(read)
