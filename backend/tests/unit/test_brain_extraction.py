import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from athena_api.brain import (
    ChatHistoryRecord,
    ChatRole,
    ClaimKind,
    ExtractionError,
    ExtractionService,
    GraphStore,
    HistoryStore,
    IngestionCoordinator,
    JobTrigger,
    LocalCommandStructuredLlm,
    SourceKind,
    SourceRecord,
    extraction_request_id,
    parse_extraction_response,
)

NOW = datetime(2026, 8, 15, 6, 0, tzinfo=UTC)


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
async def graph(tmp_path: Path, ladybug_dll_dir: Path | None):
    store = GraphStore(tmp_path / "extraction.lbug", dll_dir=ladybug_dll_dir)
    await store.open()
    try:
        yield store
    finally:
        await store.close()


def source(
    *, fingerprint: str = "fingerprint-v1", text: str = "AI 반도체를 조사해줘"
) -> SourceRecord:
    return SourceRecord(
        id="chat:message-1",
        kind=SourceKind.CHAT_MESSAGE,
        text=text,
        fingerprint=fingerprint,
        occurred_at=NOW,
        ingested_at=NOW,
    )


def envelope_for(
    record: SourceRecord,
    *,
    entity_name: str = "AI 반도체",
    claim_kind: str = "observation",
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "request_id": extraction_request_id(record),
        "source_fingerprint": record.fingerprint,
        "entities": [
            {
                "ref": "theme",
                "kind": "theme",
                "name": entity_name,
                "aliases": ["AI칩"],
                "description": "사용자가 조사한 테마",
                "confidence": 0.9,
                "attributes": {"market": "KR"},
            },
            {
                "ref": "company",
                "kind": "company",
                "name": "테스트전자",
                "confidence": 0.8,
                "attributes": {},
            },
        ],
        "relations": [
            {
                "ref": "theme-company",
                "kind": "relates_to",
                "source_ref": "theme",
                "target_ref": "company",
                "confidence": 0.7,
                "observed_at": NOW.isoformat(),
                "attributes": {},
            }
        ],
        "claims": [
            {
                "ref": "claim-1",
                "kind": claim_kind,
                "statement": f"{entity_name}에 관심을 보였다",
                "confidence": 0.75,
                "observed_at": NOW.isoformat(),
                "about_refs": ["theme"],
                "attributes": {},
            }
        ],
    }


class DynamicClient:
    def __init__(self, *, fail_once: bool = False, malformed: bool = False) -> None:
        self.fail_once = fail_once
        self.malformed = malformed
        self.calls = 0

    async def complete(self, request_json: bytes) -> bytes:
        self.calls += 1
        if self.fail_once and self.calls == 1:
            raise RuntimeError("provider failed without content")
        request = json.loads(request_json)
        if self.malformed:
            return b"not-json"
        record = source(
            fingerprint=request["source_fingerprint"],
            text=request["text"],
        )
        payload = envelope_for(record, entity_name=request["text"][:40])
        payload["request_id"] = request["request_id"]
        return json.dumps(payload, ensure_ascii=False).encode()


class CaptureProjection:
    def __init__(self) -> None:
        self.entities = ()
        self.relations = ()
        self.claims = ()

    async def apply_extraction(self, _source_id, _fingerprint, entities, relations, claims):
        self.entities = entities
        self.relations = relations
        self.claims = claims


def test_strict_response_contract_and_cross_references() -> None:
    record = source()
    valid = envelope_for(record)
    parsed = parse_extraction_response(
        json.dumps(valid).encode(),
        expected_request_id=extraction_request_id(record),
        expected_source_fingerprint=record.fingerprint,
    )
    assert parsed.entities[0].kind.value == "theme"

    for mutation in (
        lambda value: value.update({"query": "MATCH (n) DELETE n"}),
        lambda value: value["entities"][0].update({"db_id": "model-owned"}),
        lambda value: value["relations"][0].update({"target_ref": "missing"}),
        lambda value: value["entities"].append(value["entities"][0]),
        lambda value: value["claims"][0].update({"about_refs": ["missing"]}),
    ):
        candidate = envelope_for(record)
        mutation(candidate)
        with pytest.raises((ValidationError, ValueError)):
            parse_extraction_response(
                json.dumps(candidate).encode(),
                expected_request_id=extraction_request_id(record),
                expected_source_fingerprint=record.fingerprint,
            )


def test_malformed_duplicate_binding_oversize_and_reserved_attributes_fail_closed() -> None:
    record = source()
    expected = extraction_request_id(record)
    with pytest.raises(ValueError):
        parse_extraction_response(
            b"answer: {}",
            expected_request_id=expected,
            expected_source_fingerprint=record.fingerprint,
        )
    with pytest.raises(ValueError, match="duplicate"):
        parse_extraction_response(
            b'{"schema_version":1,"schema_version":1}',
            expected_request_id=expected,
            expected_source_fingerprint=record.fingerprint,
        )
    wrong = envelope_for(record)
    wrong["request_id"] = "0" * 64
    with pytest.raises(ValueError, match="binding"):
        parse_extraction_response(
            json.dumps(wrong).encode(),
            expected_request_id=expected,
            expected_source_fingerprint=record.fingerprint,
        )
    reserved = envelope_for(record)
    reserved["entities"][0]["attributes"] = {"cypher": "MATCH (n)"}
    with pytest.raises(ValidationError):
        parse_extraction_response(
            json.dumps(reserved).encode(),
            expected_request_id=expected,
            expected_source_fingerprint=record.fingerprint,
        )
    with pytest.raises(ValueError, match="size"):
        parse_extraction_response(
            b"{" + b"x" * 262_144 + b"}",
            expected_request_id=expected,
            expected_source_fingerprint=record.fingerprint,
        )


async def test_deterministic_ids_and_observation_is_distinct_from_inference() -> None:
    capture = CaptureProjection()
    record = source()

    class FixedClient:
        def __init__(self, kind: str) -> None:
            self.kind = kind

        async def complete(self, request_json: bytes) -> bytes:
            request = json.loads(request_json)
            payload = envelope_for(record, claim_kind=self.kind)
            payload["request_id"] = request["request_id"]
            return json.dumps(payload).encode()

    service = ExtractionService(FixedClient("observation"), capture, clock=lambda: NOW)
    await service.project_source(record)
    first_entity_ids = tuple(entity.id for entity in capture.entities)
    first_relation_ids = tuple(relation.id for relation in capture.relations)
    observed = capture.claims[0]
    await service.project_source(record)
    assert tuple(entity.id for entity in capture.entities) == first_entity_ids
    assert tuple(relation.id for relation in capture.relations) == first_relation_ids
    assert capture.claims[0].id == observed.id
    assert observed.kind is ClaimKind.OBSERVATION

    inferred_capture = CaptureProjection()
    await ExtractionService(
        FixedClient("inferred_preference"), inferred_capture, clock=lambda: NOW
    ).project_source(record)
    inferred = inferred_capture.claims[0]
    assert inferred.kind is ClaimKind.INFERRED_PREFERENCE
    assert inferred.id != observed.id


async def test_local_command_adapter_uses_argv_and_sanitizes_failures(tmp_path: Path) -> None:
    marker = tmp_path / "must-not-exist"
    hostile = f"; touch {marker}"
    echo_argv = LocalCommandStructuredLlm(
        (
            sys.executable,
            "-c",
            "import json,sys; sys.stdout.write(json.dumps(sys.argv[1]))",
            hostile,
        )
    )
    assert json.loads(await echo_argv.complete(b"{}")) == hostile
    assert not marker.exists()

    timeout_client = LocalCommandStructuredLlm(
        (sys.executable, "-c", "import time; time.sleep(2)"), timeout_seconds=0.05
    )
    with pytest.raises(RuntimeError, match="timed out"):
        await timeout_client.complete(b'{"secret":"never echo"}')

    failure = LocalCommandStructuredLlm(
        (sys.executable, "-c", "import sys; sys.stderr.write('secret'); sys.exit(7)")
    )
    with pytest.raises(RuntimeError, match="command failed") as error:
        await failure.complete(b'{"secret":"never echo"}')
    assert "secret" not in str(error.value)

    missing = LocalCommandStructuredLlm((str(tmp_path / "secret-provider-command"),))
    with pytest.raises(RuntimeError, match="could not start") as spawn_error:
        await missing.complete(b'{"secret":"never echo"}')
    assert "secret-provider-command" not in str(spawn_error.value)

    oversized = LocalCommandStructuredLlm(
        (sys.executable, "-c", "import sys; sys.stdout.write('x'*20)"),
        max_response_bytes=10,
    )
    with pytest.raises(RuntimeError, match="size"):
        await oversized.complete(b"{}")


async def test_actual_graph_extraction_replaces_changed_source(graph: GraphStore) -> None:
    first = source()
    await graph.upsert_source(first)
    await ExtractionService(DynamicClient(), graph, clock=lambda: NOW).project_source(first)
    first_summary = await graph.summary()
    assert (first_summary.entities, first_summary.relations, first_summary.claims) == (2, 1, 1)

    changed = source(fingerprint="fingerprint-v2", text="로봇 산업을 조사해줘")
    await graph.upsert_source(changed)
    await ExtractionService(DynamicClient(), graph, clock=lambda: NOW).project_source(changed)
    summary = await graph.summary()
    assert summary.relations == 1
    assert summary.claims == 1


async def test_malformed_output_does_not_mutate_graph(graph: GraphStore) -> None:
    record = source()
    await graph.upsert_source(record)
    before = await graph.summary()
    with pytest.raises(ExtractionError, match="response was invalid"):
        await ExtractionService(DynamicClient(malformed=True), graph).project_source(record)
    assert await graph.summary() == before


async def test_apply_extraction_rolls_back_mid_transaction(
    graph: GraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    record = source()
    await graph.upsert_source(record)
    service = ExtractionService(DynamicClient(), graph, clock=lambda: NOW)
    await service.project_source(record)
    before = await graph.summary()

    changed = source(fingerprint="fingerprint-v2", text="변경된 원문")
    await graph.upsert_source(changed)

    def fail_mid_apply() -> None:
        raise RuntimeError("injected transaction failure")

    monkeypatch.setattr(graph, "_after_extraction_entities_sync", fail_mid_apply)
    with pytest.raises(RuntimeError, match="injected"):
        await service.project_source(changed)
    assert await graph.summary() == before


async def test_ingestion_extraction_failure_retries_without_advancing_cursor(
    tmp_path: Path, ladybug_dll_dir: Path | None
) -> None:
    history = HistoryStore(tmp_path / "history.sqlite3")
    graph = GraphStore(tmp_path / "ingestion.lbug", dll_dir=ladybug_dll_dir)
    await history.open()
    await graph.open()
    try:
        await history.upsert_chat(
            ChatHistoryRecord(
                message_id="message-1",
                conversation_id="conversation-1",
                role=ChatRole.USER,
                text="반도체를 조사해줘",
                occurred_at=NOW,
            )
        )
        client = DynamicClient(fail_once=True)
        coordinator = IngestionCoordinator(
            history,
            graph,
            source_projector=ExtractionService(client, graph, clock=lambda: NOW),
        )
        await history.create_job(JobTrigger.MANUAL, now=NOW)
        with pytest.raises(ExtractionError, match="request failed"):
            await coordinator.run_next()
        assert await history.cursor("chat_history") == 0

        await history.create_job(JobTrigger.RETRY, now=NOW)
        report = await coordinator.run_next()
        assert report is not None
        assert report.total_projected == 1
        assert await history.cursor("chat_history") == 1
        summary = await graph.summary()
        assert (summary.sources, summary.claims, summary.relations) == (1, 1, 1)
    finally:
        await graph.close()
        await history.close()
