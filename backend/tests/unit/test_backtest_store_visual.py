"""시각 버전 저장 계약 — origin 허용목록 · bundle 원자 저장 · 활성 불변식 · hash.

`test_backtest_store.py`가 기존 저장층 계약을 고정한다. 이 파일은 시각 설계↔코드 왕복이
더한 것만 고정한다(docs/research/backtest-visual-code-roundtrip-implementation-evaluation.md
§사용자 적용 이후 서버 처리): `visual`·`code_only`는 절대 활성으로 저장되지 않고, graph·
spec·source map·hash는 소스와 한 트랜잭션으로 들어가거나 아무것도 들어가지 않는다.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from athena_api.backtest import store as store_mod
from athena_api.backtest.store import (
    BacktestStore,
    VersionBundle,
    canonical_graph_json,
    hash_bundle,
    sha256_text,
)
from athena_api.brain.db import SqliteOwner

# 결정층(leaf 9): LLM도 난수도 타지 않는다 — 저장층 계약만 검증한다.
pytestmark = pytest.mark.deterministic

NOW = datetime(2026, 9, 2, 3, 0, tzinfo=UTC)

GRAPH: dict[str, Any] = {
    "graph_version": 1,
    "nodes": [
        {"id": "sma-fast-01", "kind": "sma", "params": {"period": 5}, "ui": {"x": 10, "y": 20}},
        {"id": "entry-01", "kind": "cross_above", "params": {}, "ui": {"x": 200, "y": 20}},
    ],
    "edges": [
        {
            "id": "e1",
            "from": {"node_id": "sma-fast-01", "port": "value"},
            "to": {"node_id": "entry-01", "port": "fast"},
        }
    ],
    "scenario": {"symbols": ["005930"], "period": "day"},
}
SPEC_YAML = 'version: "1.0"\n'
SOURCE = "entry = fast > slow\n"
SOURCE_MAP: dict[str, Any] = {
    "compiler_version": "v1",
    "entries": [
        {
            "node_id": "sma-fast-01",
            "ast_path": "$.body[0]",
            "source_span": {"file": "s.py", "start": {"line": 1, "column": 0}},
            "role": "declaration",
        }
    ],
}


@pytest.fixture
async def owner(tmp_path: Path):
    instance = SqliteOwner(tmp_path / "athena-backtest.sqlite3")
    await instance.open()
    try:
        yield instance
    finally:
        if instance.is_open:
            await instance.close()


@pytest.fixture
async def store(owner: SqliteOwner) -> BacktestStore:
    instance = BacktestStore(owner)
    await instance.open()
    return instance


def bundle(*, receipt: dict[str, str] | None = None) -> VersionBundle:
    return VersionBundle(
        graph_json=json.dumps(GRAPH, ensure_ascii=False, sort_keys=True),
        spec_yaml=SPEC_YAML,
        source_map_json=json.dumps(SOURCE_MAP, ensure_ascii=False, sort_keys=True),
        hashes_json=json.dumps(hash_bundle(GRAPH, SPEC_YAML, SOURCE), sort_keys=True),
        compiler_version="btgraph-1",
        apply_receipt_json=None if receipt is None else json.dumps(receipt, sort_keys=True),
    )


async def seed(store: BacktestStore) -> str:
    """사람이 만든 활성 버전 하나가 이미 있는 전략."""
    await store.create_strategy("s1", "골든크로스", "python", created_at=NOW)
    await store.add_version("v1", "s1", 1, "a = 1\n", origin="human", created_at=NOW, active=True)
    return "s1"


# ── 스키마 마이그레이션 ──────────────────────────────────────────────────────


async def test_open_adds_bundle_columns_to_a_legacy_db(tmp_path: Path) -> None:
    """bundle 열이 없던 파일도 그대로 열려야 한다 — 캔들 캐시를 다시 받게 하지 않는다."""
    path = tmp_path / "athena-backtest.sqlite3"
    legacy = sqlite3.connect(path)
    legacy.executescript(
        "CREATE TABLE bt_strategy (id TEXT PRIMARY KEY, name TEXT NOT NULL,"
        " kind TEXT NOT NULL, created_at TEXT NOT NULL);"
        "CREATE TABLE bt_strategy_version (id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL"
        " REFERENCES bt_strategy(id) ON DELETE CASCADE, version INTEGER NOT NULL,"
        " source TEXT NOT NULL, note TEXT, origin TEXT NOT NULL, created_at TEXT NOT NULL,"
        " active INTEGER NOT NULL DEFAULT 0);"
        "INSERT INTO bt_strategy VALUES('s1','옛 전략','python','2026-01-01T00:00:00+00:00');"
        "INSERT INTO bt_strategy_version"
        " VALUES('v1','s1',1,'a = 1','메모','human','2026-01-01T00:00:00+00:00',1);"
    )
    legacy.commit()
    legacy.close()

    owner_instance = SqliteOwner(path)
    await owner_instance.open()
    try:
        instance = BacktestStore(owner_instance)
        await instance.open()
        kept = await instance.version("v1")
        assert kept is not None
        assert kept.source == "a = 1" and kept.note == "메모" and kept.active is True
        assert kept.bundle is None  # 예전 행은 bundle이 없다 — 있는 척하지 않는다
        # 그리고 같은 파일에 새 시각 버전을 저장할 수 있다
        await instance.add_version(
            "v2", "s1", 2, SOURCE, origin="visual", created_at=NOW, bundle=bundle()
        )
        saved = await instance.version("v2")
        assert saved is not None and saved.bundle is not None
    finally:
        await owner_instance.close()


async def test_open_is_idempotent(owner: SqliteOwner) -> None:
    """열 때마다 ALTER를 다시 돌려도 같은 모양이어야 한다(두 번째 open이 죽지 않는다)."""
    first = BacktestStore(owner)
    await first.open()
    await first.open()
    second = BacktestStore(owner)
    await second.open()

    def columns() -> list[str]:
        return [
            str(row["name"])
            for row in owner.require().execute("PRAGMA table_info(bt_strategy_version)")
        ]

    names = await owner.run(columns)
    assert names.count("graph_json") == 1
    for name, _type in store_mod._BUNDLE_COLUMNS:
        assert name in names


# ── origin 허용목록 ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("origin", ["human", "form", "llm_draft", "visual", "code_only"])
async def test_add_version_accepts_every_allowed_origin(
    store: BacktestStore, origin: str
) -> None:
    await seed(store)
    await store.add_version("v2", "s1", 2, "b = 2\n", origin=origin, created_at=NOW)
    saved = await store.version("v2")
    assert saved is not None and saved.origin == origin and saved.active is False


async def test_add_version_rejects_an_unknown_origin(store: BacktestStore) -> None:
    await seed(store)
    with pytest.raises(ValueError):
        await store.add_version("v2", "s1", 2, "b = 2\n", origin="mcp", created_at=NOW)


@pytest.mark.parametrize("origin", ["visual", "code_only"])
async def test_visual_origins_cannot_be_saved_active(store: BacktestStore, origin: str) -> None:
    """저장이 곧 활성화가 아니다 — 저장층도 fail-closed로 거부한다."""
    await seed(store)
    with pytest.raises(ValueError):
        await store.add_version(
            "v2", "s1", 2, SOURCE, origin=origin, created_at=NOW, active=True, bundle=bundle()
        )
    assert await store.version("v2") is None
    assert await store.active_version_id("s1") == "v1"


@pytest.mark.parametrize("origin", ["human", "form"])
async def test_existing_origins_still_activate_on_request(
    store: BacktestStore, origin: str
) -> None:
    """회귀: 사람/폼 버전은 예전 그대로 즉시 활성이 될 수 있다."""
    await seed(store)
    await store.add_version("v2", "s1", 2, "b = 2\n", origin=origin, created_at=NOW, active=True)
    assert await store.active_version_id("s1") == "v2"
    versions = await store.versions("s1")
    assert [(v.id, v.active) for v in versions] == [("v1", False), ("v2", True)]


async def test_active_version_id_is_none_without_an_active_version(
    store: BacktestStore,
) -> None:
    await store.create_strategy("s2", "초안만", "python", created_at=NOW)
    await store.add_version("d1", "s2", 1, "a = 1\n", origin="llm_draft", created_at=NOW)
    assert await store.active_version_id("s2") is None


# ── bundle 원자 저장 ────────────────────────────────────────────────────────


async def test_bundle_round_trips_with_the_version(store: BacktestStore) -> None:
    await seed(store)
    receipt = {"patch_id": "p1", "base_version_id": "v1"}
    await store.add_version(
        "v2", "s1", 2, SOURCE, origin="visual", created_at=NOW, bundle=bundle(receipt=receipt)
    )
    saved = await store.version("v2")
    assert saved is not None and saved.bundle is not None
    assert json.loads(saved.bundle.graph_json) == GRAPH
    assert saved.bundle.spec_yaml == SPEC_YAML
    assert json.loads(saved.bundle.source_map_json) == SOURCE_MAP
    assert json.loads(saved.bundle.hashes_json) == hash_bundle(GRAPH, SPEC_YAML, SOURCE)
    assert saved.bundle.compiler_version == "btgraph-1"
    assert saved.bundle.apply_receipt_json is not None
    assert json.loads(saved.bundle.apply_receipt_json) == receipt
    # 활성 버전은 그대로다 — 저장은 활성화가 아니다
    assert await store.active_version_id("s1") == "v1"


async def test_a_failed_step_leaves_no_partial_version(
    store: BacktestStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """쓰기 뒤 단계가 죽으면 행 자체가 남지 않아야 한다 — 그래프 없는 시각 버전은 거짓말이다."""
    await seed(store)
    real = store_mod._active_version_id
    calls = {"n": 0}

    def flaky(connection: sqlite3.Connection, strategy_id: str) -> str | None:
        calls["n"] += 1
        if calls["n"] >= 2:  # INSERT 다음의 확인 단계에서 죽인다
            raise RuntimeError("주입한 실패")
        return real(connection, strategy_id)

    monkeypatch.setattr(store_mod, "_active_version_id", flaky)
    with pytest.raises(RuntimeError):
        await store.add_version(
            "v2", "s1", 2, SOURCE, origin="visual", created_at=NOW, bundle=bundle()
        )

    monkeypatch.setattr(store_mod, "_active_version_id", real)
    assert await store.version("v2") is None
    assert [v.id for v in await store.versions("s1")] == ["v1"]
    assert await store.active_version_id("s1") == "v1"


async def test_a_half_written_bundle_is_read_as_no_bundle(
    owner: SqliteOwner, store: BacktestStore
) -> None:
    """열 하나가 비면 bundle 전체를 없는 것으로 읽는다 — 반쪽을 그럴듯하게 돌려주지 않는다."""
    await seed(store)
    await store.add_version(
        "v2", "s1", 2, SOURCE, origin="visual", created_at=NOW, bundle=bundle()
    )

    # 저장소 메서드로는 반쪽 bundle을 만들 수 없다 — 소유자 스레드에서 직접 비운다.
    def corrupt() -> None:
        owner.require().execute(
            "UPDATE bt_strategy_version SET source_map_json = NULL WHERE id = 'v2'"
        )

    await owner.run(corrupt)
    saved = await store.version("v2")
    assert saved is not None and saved.bundle is None


# ── hash ────────────────────────────────────────────────────────────────────


def test_graph_hash_ignores_ui_and_key_order() -> None:
    """노드를 화면에서 옮겼다고 base 충돌이 나면 안 된다."""
    moved = json.loads(json.dumps(GRAPH))
    moved["nodes"][0]["ui"] = {"x": 999, "y": 999}
    reordered = {key: moved[key] for key in reversed(list(moved))}
    assert canonical_graph_json(reordered) == canonical_graph_json(GRAPH)
    assert hash_bundle(reordered, SPEC_YAML, SOURCE) == hash_bundle(GRAPH, SPEC_YAML, SOURCE)


def test_graph_hash_changes_when_a_param_changes() -> None:
    changed = json.loads(json.dumps(GRAPH))
    changed["nodes"][0]["params"]["period"] = 20
    assert (
        hash_bundle(changed, SPEC_YAML, SOURCE)["graph_hash"]
        != hash_bundle(GRAPH, SPEC_YAML, SOURCE)["graph_hash"]
    )


def test_spec_and_artifact_hashes_are_plain_sha256_of_the_text() -> None:
    hashes = hash_bundle(GRAPH, SPEC_YAML, SOURCE)
    assert hashes["spec_hash"] == sha256_text(SPEC_YAML)
    assert hashes["artifact_hash"] == sha256_text(SOURCE)
