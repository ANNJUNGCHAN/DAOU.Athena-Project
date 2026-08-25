"""검증 3층 중 **녹화응답층** — 녹화한 LLM 응답으로 추출 전 경로를 재생한다.

leaf 9(2026-08-25). 이 층이 있는 이유는 두 가지다.

1. **실패 분기는 실제 모델로 재현할 수 없다.** 잘 도는 모델에게 "이번엔 JSON을 깨서
   줘"라고 시킬 수 없다. 잘린 응답·산문이 섞인 응답·티어를 참칭하는 응답은 녹화로만
   CI에 들어온다.
2. **돈이 들지 않고 결정적이다.** 실제 모델을 태우는 것은 판정자 층
   (`scripts/evaluate_brain_extraction.py`)뿐이고, 그건 사람이 손으로 돌린다.

녹화는 `tests/fixtures/brain_extraction/recordings.json`에 있다. `request_id`와
`source_fingerprint`는 실행 시점에 채운다 — 둘 다 소스에서 유도되는 값이라 파일에
박아두면 소스를 한 글자만 고쳐도 전부 썩는다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from athena_api.brain import (
    Confidence,
    ExtractionError,
    ExtractionService,
    GraphStore,
    SourceKind,
    SourceRecord,
    extraction_request_id,
)

pytestmark = pytest.mark.replay

RECORDINGS_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "brain_extraction" / "recordings.json"
)
RECORDINGS: list[dict[str, Any]] = json.loads(RECORDINGS_PATH.read_text(encoding="utf-8"))


def _source(spec: dict[str, Any]) -> SourceRecord:
    return SourceRecord(
        id=spec["id"],
        kind=SourceKind(spec["kind"]),
        text=spec["text"],
        fingerprint=f"fp-{spec['id']}",
        occurred_at=datetime.fromisoformat(spec["occurred_at"]),
        ingested_at=datetime.fromisoformat(spec["occurred_at"]),
    )


class ReplayClient:
    """녹화된 바이트를 그대로 돌려준다. 바인딩만 실행 시점에 채운다."""

    def __init__(self, recording: dict[str, Any], record: SourceRecord) -> None:
        self._recording = recording
        self._record = record
        self.prompts: list[str] = []

    async def complete(self, prompt: str) -> bytes:
        self.prompts.append(prompt)
        if "raw_response" in self._recording:
            # 일부러 깨진 응답 — 손대지 않고 그대로 흘린다.
            return str(self._recording["raw_response"]).encode("utf-8")
        payload = dict(self._recording["response"])
        payload["request_id"] = extraction_request_id(self._record)
        payload["source_fingerprint"] = self._record.fingerprint
        return json.dumps(payload, ensure_ascii=False).encode("utf-8")


@pytest.fixture
async def store(tmp_path: Path):
    graph = GraphStore(tmp_path / "brain.sqlite3")
    await graph.open()
    try:
        yield graph
    finally:
        if graph.is_open:
            await graph.close()


def test_the_recording_set_is_not_empty_and_covers_both_outcomes() -> None:
    """녹화가 전부 성공 경로면 이 층은 아무 실패 분기도 지키지 않는다."""
    assert len(RECORDINGS) >= 5
    outcomes = {bool(item["expect"]["ok"]) for item in RECORDINGS}
    assert outcomes == {True, False}, "성공과 실패 녹화가 모두 있어야 한다"
    # 각 녹화가 무엇을 지키는지 적혀 있어야 한다 — 이유 없는 픽스처는 나중에
    # 아무도 못 지운다.
    for item in RECORDINGS:
        assert item.get("why", "").strip(), f"{item['name']}에 why가 없다"


@pytest.mark.parametrize(
    "recording", RECORDINGS, ids=[item["name"] for item in RECORDINGS]
)
async def test_replay_a_recorded_response(store: GraphStore, recording: dict) -> None:
    record = _source(recording["source"])
    await store.upsert_source(record)
    clock = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)
    service = ExtractionService(ReplayClient(recording, record), store, clock=lambda: clock)
    expect = recording["expect"]

    if not expect["ok"]:
        with pytest.raises(ExtractionError, match=expect["error_contains"]):
            await service.project_source(record)
        # 실패는 그래프를 건드리지 않는다.
        summary = await store.summary()
        assert (summary.entities, summary.relations) == (0, 0)
        return

    await service.project_source(record)
    summary = await store.summary()
    assert summary.entities == expect["entities"], recording["why"]
    assert summary.relations == expect["relations"], recording["why"]

    if "confidence" in expect:
        relations = await store.relations()
        assert [item.confidence for item in relations] == [
            Confidence(expect["confidence"]).value
        ]


async def test_the_replayed_prompt_is_the_real_one(store: GraphStore) -> None:
    """재생이 프롬프트 조립까지 실제로 밟는다 — 여기를 건너뛰면 봉투만 검사하는 셈이다."""
    recording = RECORDINGS[0]
    record = _source(recording["source"])
    await store.upsert_source(record)
    client = ReplayClient(recording, record)
    clock = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)
    await ExtractionService(client, store, clock=lambda: clock).project_source(record)

    assert len(client.prompts) == 1
    prompt = client.prompts[0]
    assert "<untrusted_source" in prompt
    assert record.text.strip() in prompt
    assert extraction_request_id(record) in prompt
