"""Conversation history to cluster-map integration contract.

The production FastAPI lifespan, SQLite stores, ingestion coordinator, extraction
service, de-duplication pass, NetworkX projection, and public HTTP routes all take
part in this test.  Only the external structured-LLM process is replaced with a
recording deterministic client so the test is isolated and never consumes user
credentials or a user-home database.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena_api.brain import (
    DedupService,
    ExtractionService,
    GraphEventOp,
    IngestionCoordinator,
)
from athena_api.brain.history import MAX_TRANSCRIPT_CHARS
from athena_api.config import Settings
from athena_api.main import create_app

BEARER = "isolated-conversation-graph-test"
CHAT_PATH = "/api/v1/brain/chat"
JOBS_PATH = "/api/v1/brain/ingestion/jobs"
CLUSTER_MAP_PATH = "/api/v1/brain/analysis/cluster-map"
NOW = datetime(2026, 8, 31, 4, 0, tzinfo=UTC)


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {BEARER}"}


class RecordedConversationExtractor:
    """Return a bound extraction envelope while retaining the compact transcript."""

    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def complete(self, prompt: str) -> bytes:
        self.prompts.append(prompt)
        request_id = re.search(r'^request_id: "([^"]+)"$', prompt, re.MULTILINE)
        fingerprint = re.search(r'^source_fingerprint: "([^"]+)"$', prompt, re.MULTILINE)
        assert request_id is not None
        assert fingerprint is not None
        return json.dumps(
            {
                "schema_version": 2,
                "request_id": request_id.group(1),
                "source_fingerprint": fingerprint.group(1),
                "entities": [
                    {
                        "ref": "battery-theme",
                        "kind": "theme",
                        "name": "이차전지",
                        "aliases": ["2차전지"],
                        "attributes": {},
                    },
                    {
                        "ref": "battery-theme-duplicate",
                        "kind": "theme",
                        "name": "2차전지",
                        "aliases": [],
                        "attributes": {},
                    },
                    {
                        "ref": "samsung-electronics",
                        "kind": "security",
                        "name": "삼성전자",
                        "aliases": ["005930"],
                        "attributes": {},
                    },
                ],
                "relations": [
                    {
                        "ref": "prefers-battery",
                        "kind": "prefers",
                        "source_ref": "me",
                        "target_ref": "battery-theme",
                        "confidence": "EXTRACTED",
                        "rationale": "배터리 산업에 대한 반복 관심",
                        "observed_at": NOW.isoformat(),
                        "attributes": {},
                    },
                    {
                        "ref": "interested-battery-duplicate",
                        "kind": "interested_in",
                        "source_ref": "me",
                        "target_ref": "battery-theme-duplicate",
                        "confidence": "EXTRACTED",
                        "rationale": "동일 테마의 다른 표기",
                        "observed_at": NOW.isoformat(),
                        "attributes": {},
                    },
                    {
                        "ref": "battery-to-samsung",
                        "kind": "relates_to",
                        "source_ref": "battery-theme",
                        "target_ref": "samsung-electronics",
                        "confidence": "INFERRED",
                        "rationale": None,
                        "observed_at": NOW.isoformat(),
                        "attributes": {},
                    },
                ],
            },
            ensure_ascii=False,
        ).encode()


async def _install_recorded_extraction(app: FastAPI) -> RecordedConversationExtractor:
    runtime = app.state.brain_runtime
    assert runtime is not None
    assert runtime.coordinator is not None
    await runtime.coordinator.stop()

    client = RecordedConversationExtractor()
    coordinator = IngestionCoordinator(
        runtime.history,
        runtime.store,
        source_projector=ExtractionService(client, runtime.store, clock=lambda: NOW),
        dedup=DedupService(runtime.store),
        poll_interval_seconds=0.01,
    )
    await coordinator.start()
    runtime.coordinator = coordinator
    runtime.extraction_enabled = True
    app.state.brain_extraction_enabled = True
    return client


async def _graph_evidence(app: FastAPI) -> dict[str, object]:
    runtime = app.state.brain_runtime
    summary = await runtime.store.summary()
    events = await runtime.store.events()
    return {
        "sources": summary.sources,
        "entities": summary.entities,
        "relations": summary.relations,
        "merged": sum(event.op is GraphEventOp.ENTITY_MERGED for event in events),
    }


def _wait_for_job(client: TestClient, job_id: str) -> dict[str, object]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        response = client.get(f"{JOBS_PATH}/{job_id}", headers=_headers())
        assert response.status_code == 200
        job = response.json()
        if job["status"] in {"succeeded", "failed"}:
            return job
        time.sleep(0.01)
    raise AssertionError(f"ingestion job {job_id} did not finish")


def test_conversation_history_builds_a_deduplicated_cluster_map_through_public_routes(
    tmp_path: Path,
) -> None:
    """A stored conversation becomes one de-duplicated graph visible via cluster-map."""

    db_path = tmp_path / "isolated-brain.sqlite3"
    app = create_app(
        Settings(
            _env_file=None,
            local_bearer_token=BEARER,
            brain_enabled=True,
            brain_db_path=db_path,
            brain_use_claude_cli_extraction=False,
            brain_ingest_interval_minutes=60,
        )
    )

    with TestClient(app) as client:
        assert client.portal is not None
        extractor = client.portal.call(_install_recorded_extraction, app)

        for message_id, role, text in (
            ("message-user", "user", "이차전지와 삼성전자 관계를 계속 보고 싶어."),
            ("message-assistant", "assistant", "배터리 산업과 삼성전자를 함께 추적할게요."),
        ):
            response = client.post(
                CHAT_PATH,
                headers=_headers(),
                json={
                    "message_id": message_id,
                    "conversation_id": "conversation-isolated",
                    "role": role,
                    "text": text,
                    "occurred_at": NOW.isoformat(),
                },
            )
            assert response.status_code == 200

        created = client.post(JOBS_PATH, headers=_headers())
        assert created.status_code == 200
        completed = _wait_for_job(client, created.json()["id"])
        assert completed["status"] == "succeeded"

        cluster_response = client.get(CLUSTER_MAP_PATH, headers=_headers())
        assert cluster_response.status_code == 200
        cluster = cluster_response.json()
        evidence = client.portal.call(_graph_evidence, app)

    assert db_path.exists()
    assert len(extractor.prompts) == 1
    assert "user: 이차전지와 삼성전자 관계를 계속 보고 싶어." in extractor.prompts[0]
    assert "assistant: 배터리 산업과 삼성전자를 함께 추적할게요." in extractor.prompts[0]
    assert evidence == {"sources": 3, "entities": 3, "relations": 3, "merged": 1}
    # 지도는 테마·종목만 그린다 — 투자자 프로필은 그래프의 원점이지 구성원이 아니라
    # 빠진다(projection.GraphProjector.analysis). 저장층에는 그대로 3개다.
    assert len(cluster["nodes"]) == 2
    assert [node["name"] for node in cluster["nodes"] if node["kind"] == "theme"] == [
        "이차전지"
    ]
    assert [node["name"] for node in cluster["nodes"] if node["kind"] == "security"] == [
        "삼성전자"
    ]
    assert sum(node["kind"] == "investor_profile" for node in cluster["nodes"]) == 0
    # 프로필에서 뻗은 엣지는 지도에서 빠지고(그 관계는 profile-summary가 낸다),
    # 종목↔테마 하나만 남는다 — 지도가 그리는 것이 바로 그 관계다.
    map_node_ids = sorted(node["entity_id"] for node in cluster["nodes"])
    assert cluster["edges"] == [map_node_ids]
    assert cluster["revision"] > 0
    assert cluster["cluster_cohesion"]
    assert cluster["cluster_representative_labels"]


def test_long_raw_messages_are_lossless_but_extraction_uses_the_bounded_tail(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "isolated-long-brain.sqlite3"
    user_prefix, user_suffix = "USER-BEGIN|", "|USER-END"
    assistant_prefix, assistant_suffix = "ASSISTANT-BEGIN|", "|ASSISTANT-END"
    user_text = user_prefix + ("가" * (12_345 - len(user_prefix) - len(user_suffix))) + user_suffix
    assistant_text = assistant_prefix + (
        "나" * (20_000 - len(assistant_prefix) - len(assistant_suffix))
    ) + assistant_suffix
    assert (len(user_text), len(assistant_text)) == (12_345, 20_000)
    app = create_app(
        Settings(
            _env_file=None,
            local_bearer_token=BEARER,
            brain_enabled=True,
            brain_db_path=db_path,
            brain_use_claude_cli_extraction=False,
            brain_ingest_interval_minutes=60,
        )
    )

    with TestClient(app) as client:
        assert client.portal is not None
        extractor = client.portal.call(_install_recorded_extraction, app)
        for message_id, role, text, occurred_at in (
            ("long-user", "user", user_text, NOW),
            ("long-assistant", "assistant", assistant_text, NOW + timedelta(seconds=1)),
        ):
            payload = {
                "message_id": message_id,
                "conversation_id": "conversation-long",
                "role": role,
                "text": text,
                "occurred_at": occurred_at.isoformat(),
            }
            first = client.post(CHAT_PATH, headers=_headers(), json=payload)
            replay = client.post(CHAT_PATH, headers=_headers(), json=payload)
            assert first.status_code == 200
            assert replay.json() == first.json()

        created = client.post(JOBS_PATH, headers=_headers())
        assert created.status_code == 200
        completed = _wait_for_job(client, created.json()["id"])
        assert completed["status"] == "succeeded"

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            "SELECT source_id, text FROM source_records "
            "WHERE source_id IN ('chat:long-user', 'chat:long-assistant') ORDER BY source_id"
        ).fetchall()
    assert rows == [
        ("chat:long-assistant", assistant_text),
        ("chat:long-user", user_text),
    ]
    assert len(extractor.prompts) == 1
    prompt = extractor.prompts[0]
    transcript = re.search(
        r'<untrusted_source[^>]*>\n(.*)\n</untrusted_source>', prompt, re.DOTALL
    )
    assert transcript is not None
    assert len(transcript.group(1)) <= MAX_TRANSCRIPT_CHARS
    assert "ASSISTANT-END" in transcript.group(1)
    assert "ASSISTANT-BEGIN" not in transcript.group(1)
    assert "USER-BEGIN" not in transcript.group(1)
