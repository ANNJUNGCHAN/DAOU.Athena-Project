
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from athena_api.config import Settings
from athena_api.main import create_app

BEARER = "local-test-bearer"
CHAT_PATH = "/api/v1/brain/chat"
STATUS_PATH = "/api/v1/brain/status"
CHATS_PATH = "/api/v1/brain/chats"
CONVERSATIONS_PATH = "/api/v1/brain/conversations"
PROFILE_SUMMARY_PATH = "/api/v1/brain/profile-summary"
RESET_PATH = "/api/v1/brain/reset-and-restart"
SECRET_MARKER = "지난주에 삼성전자 100주를 매수하고 싶다는 비밀스러운 계획"


def _disabled_client() -> TestClient:
    app = create_app(Settings(_env_file=None, local_bearer_token=BEARER))
    return TestClient(app)


def _brain_settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        _env_file=None,
        local_bearer_token=BEARER,
        brain_enabled=True,
        brain_db_path=tmp_path / "brain.sqlite3",
        **overrides,
    )


# --- auth: 401/422, independent of brain readiness ------------------------------------


def test_chat_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.post(
            CHAT_PATH,
            json={
                "conversation_id": "conv:1",
                "role": "user",
                "text": "hello",
                "message_id": "msg:1",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )
    assert response.status_code == 422


def test_chat_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.post(
            CHAT_PATH,
            headers={"Authorization": "Bearer nope"},
            json={
                "conversation_id": "conv:1",
                "role": "user",
                "text": "hello",
                "message_id": "msg:1",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )
    assert response.status_code == 401


def test_status_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.get(STATUS_PATH, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_chats_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.get(CHATS_PATH, params={"conversation_id": "conv:1"})
    assert response.status_code == 422


def test_conversations_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.get(CONVERSATIONS_PATH)
    assert response.status_code == 422


def test_conversations_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.get(CONVERSATIONS_PATH, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_profile_summary_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.get(PROFILE_SUMMARY_PATH)
    assert response.status_code == 422


def test_reset_requires_bearer_header() -> None:
    with _disabled_client() as client:
        response = client.post(RESET_PATH)
    assert response.status_code == 422


def test_reset_rejects_wrong_bearer() -> None:
    with _disabled_client() as client:
        response = client.post(RESET_PATH, headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


# --- fail-closed 503 while the brain is not ready --------------------------------------


def test_chat_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:1",
                "role": "user",
                "text": "hello",
                "message_id": "msg:1",
                "occurred_at": datetime.now(UTC).isoformat(),
            },
        )
    assert response.status_code == 503


def test_chats_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            CHATS_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            params={"conversation_id": "conv:1"},
        )
    assert response.status_code == 503


def test_conversations_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            CONVERSATIONS_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 503


def test_profile_summary_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.get(
            PROFILE_SUMMARY_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 503


def test_reset_503s_while_brain_disabled() -> None:
    with _disabled_client() as client:
        response = client.post(RESET_PATH, headers={"Authorization": f"Bearer {BEARER}"})
    assert response.status_code == 503


def test_status_always_answers_200_even_while_disabled() -> None:
    """Status reports readiness rather than requiring it -- mirrors /ready/accounts."""
    with _disabled_client() as client:
        response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "ready": False,
        "ingestion_ready": False,
        "extraction_enabled": False,
    }


# --- happy path -----------------------------------------------------------------------


def test_chat_round_trip_and_status_and_no_body_leak_in_logs(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app(_brain_settings(tmp_path))
    user_occurred_at = datetime.now(UTC)
    assistant_occurred_at = user_occurred_at + timedelta(seconds=1)
    with caplog.at_level(logging.INFO), TestClient(app) as client:
        status_response = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert status_response.status_code == 200
        assert status_response.json()["ingestion_ready"] is True

        user_response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:round-trip",
                "role": "user",
                "text": SECRET_MARKER,
                "message_id": "msg:user-1",
                "occurred_at": user_occurred_at.isoformat(),
            },
        )
        assert user_response.status_code == 200
        assert user_response.json()["source_id"] == "chat:msg:user-1"

        assistant_response = client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:round-trip",
                "role": "assistant",
                "text": "답변 본문",
                "message_id": "msg:assistant-1",
                "occurred_at": assistant_occurred_at.isoformat(),
            },
        )
        assert assistant_response.status_code == 200

        chats_response = client.get(
            CHATS_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            params={"conversation_id": "conv:round-trip"},
        )
        assert chats_response.status_code == 200
        messages = chats_response.json()["messages"]
        assert [message["role"] for message in messages] == ["user", "assistant"]
        assert messages[0]["text"] == SECRET_MARKER

    # Trap ⑫: the chat body must never reach any log record, success or otherwise.
    for record in caplog.records:
        assert SECRET_MARKER not in record.getMessage()


def test_conversations_lists_ids_counts_and_timestamps_without_transcript_body(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    app = create_app(_brain_settings(tmp_path))
    occurred_at = datetime.now(UTC)
    with caplog.at_level(logging.INFO), TestClient(app) as client:
        client.post(
            CHAT_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            json={
                "conversation_id": "conv:list-me",
                "role": "user",
                "text": SECRET_MARKER,
                "message_id": "msg:list-1",
                "occurred_at": occurred_at.isoformat(),
            },
        )

        response = client.get(
            CONVERSATIONS_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 200
    body = response.json()
    assert body["conversations"] == [
        {
            "conversation_id": "conv:list-me",
            "message_count": 1,
            "first_occurred_at": body["conversations"][0]["first_occurred_at"],
            "last_occurred_at": body["conversations"][0]["last_occurred_at"],
        }
    ]
    # Trap 12: the list response and its logs must never carry the transcript body.
    assert SECRET_MARKER not in response.text
    for record in caplog.records:
        assert SECRET_MARKER not in record.getMessage()


def test_profile_summary_empty_result_is_not_treated_as_not_ready(
    tmp_path: Path
) -> None:
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        response = client.get(
            PROFILE_SUMMARY_PATH, headers={"Authorization": f"Bearer {BEARER}"}
        )
    assert response.status_code == 200
    assert response.json() == {"entries": []}


# --- reset-and-restart: teardown + on-disk delete + shutdown hook + post-reset 503 ------


def test_reset_and_restart_tears_down_deletes_files_and_signals_shutdown(
    tmp_path: Path
) -> None:
    brain_path = tmp_path / "brain.sqlite3"
    app = create_app(_brain_settings(tmp_path))
    shutdown_calls: list[None] = []
    with TestClient(app) as client:
        app.state.brain_shutdown_hook = lambda: shutdown_calls.append(None)

        status_before = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert status_before.json()["ready"] is True

        response = client.post(RESET_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert response.status_code == 200
        body = response.json()
        assert body["restarting"] is True
        # 파일이 하나로 합쳐졌으므로 지워진 목록도 그 하나(+WAL/SHM 사이드카)뿐이다.
        assert any(brain_path.name in name for name in body["deleted_files"])

        # Teardown happened: the brain runtime is gone, so subsequent brain routes 503.
        status_after = client.get(STATUS_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert status_after.json()["ready"] is False
        chats_after = client.get(
            CHATS_PATH,
            headers={"Authorization": f"Bearer {BEARER}"},
            params={"conversation_id": "conv:1"},
        )
        assert chats_after.status_code == 503

        # A second reset call also 503s -- brain_runtime was cleared, not left dangling.
        second_reset = client.post(RESET_PATH, headers={"Authorization": f"Bearer {BEARER}"})
        assert second_reset.status_code == 503

    assert not brain_path.exists()
    assert not (Path(str(brain_path) + "-wal")).exists()
    assert not (Path(str(brain_path) + "-shm")).exists()
    assert shutdown_calls == [None]


# --- 표면이 실제 데이터로 도는가 (leaf 7) ----------------------------------------------
#
# 이전 판 `/profile-summary`는 저장층에 **존재하지 않는 속성**(`claim_count`,
# `average_confidence`)을 읽고 있었다. leaf 1이 `Claim`을 폐기하면서 사라진 이름들이다.
# 그런데 테스트가 빈 결과만 봐서 `AttributeError`가 한 번도 드러나지 않았다 — 성향이
# 하나라도 쌓이는 순간 500이었다. 아래 테스트들은 전부 **비어 있지 않은 그래프**를 만든다.


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {BEARER}"}


async def _seed_graph(app) -> None:
    """대화 하나와 체결 하나를 실제 저장층에 넣는다."""
    from decimal import Decimal

    from athena_api.brain import (
        ChatHistoryRecord,
        ChatRole,
        CompletedTradeRecord,
        DeterministicTradeProjector,
        IngestionCoordinator,
        JobTrigger,
        TradeSide,
    )

    history = app.state.brain_history
    store = app.state.brain_store
    now = datetime(2026, 8, 25, 3, 0, tzinfo=UTC)
    await history.upsert_chat(
        ChatHistoryRecord(
            message_id="msg:1",
            conversation_id="conv:1",
            role=ChatRole.USER,
            text="삼성전자 계속 들고 갈 생각이야",
            occurred_at=now,
        ),
        changed_at=now,
    )
    await history.upsert_completed_trade(
        CompletedTradeRecord(
            trade_id="exec:1",
            security_id="005930",
            side=TradeSide.BUY,
            quantity=2,
            price=Decimal("72000"),
            occurred_at=now,
        ),
        changed_at=now,
    )
    coordinator = IngestionCoordinator(
        history,
        store,
        clock=lambda: now,
        deterministic_projector=DeterministicTradeProjector(store, clock=lambda: now),
    )
    await coordinator.enqueue(JobTrigger.MANUAL)
    await coordinator.run_next()


@pytest.fixture
def seeded_client(tmp_path: Path):
    app = create_app(_brain_settings(tmp_path))
    with TestClient(app) as client:
        client.portal.call(_seed_graph, app)  # type: ignore[attr-defined]
        yield client


def test_profile_summary_survives_a_non_empty_graph(seeded_client: TestClient) -> None:
    """비어 있지 않은 결과에서 500이 나지 않는다 — 이전 판은 여기서 죽었다."""
    response = seeded_client.get(PROFILE_SUMMARY_PATH, headers=_headers())
    assert response.status_code == 200
    entries = response.json()["entries"]
    assert entries, "체결이 성향으로 잡혀야 한다"
    entry = entries[0]
    # 새 온톨로지의 필드들. `tier`가 있어야 말과 행동을 구분해 읽을 수 있다.
    assert set(entry) == {
        "entity_id",
        "entity_kind",
        "entity_name",
        "relation_kind",
        "confidence",
        "tier",
        "rationale",
        "observed_at",
        "reinforcement",
    }
    assert entry["tier"] == "deterministic"


def test_no_claim_era_field_survives_on_the_surface(seeded_client: TestClient) -> None:
    """`Claim` 시절 이름이 응답 스키마의 **속성**으로 남아 있지 않다.

    원문 전체를 문자열로 훑으면 안 된다 — 무엇을 왜 걷어냈는지 설명하는 docstring이
    OpenAPI `description`에 실려서, 산문이 사실을 서술한다는 이유로 실패한다.
    (`no-ladybug` 게이트가 정확히 그 실수를 하고 있었고 leaf 6에서 고쳤다.)
    """
    schemas = seeded_client.get("/openapi.json").json()["components"]["schemas"]
    properties = {
        name
        for definition in schemas.values()
        for name in definition.get("properties", {})
    }
    for gone in ("claim_count", "average_confidence", "latest_observed_at"):
        assert gone not in properties, f"{gone}가 표면에 남아 있다"
    # 양성 대조: 스캐너가 실재하는 속성은 찾아낸다.
    assert "reinforcement" in properties
    assert "tier" in properties


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/brain/analysis/god-nodes",
        "/api/v1/brain/analysis/surprising-connections",
        "/api/v1/brain/analysis/suggested-questions",
        "/api/v1/brain/analysis/diff",
        "/api/v1/brain/analysis/cluster-map",
    ],
)
def test_analysis_endpoints_answer_on_a_real_graph(
    seeded_client: TestClient, path: str
) -> None:
    response = seeded_client.get(path, headers=_headers())
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), dict)


def test_cluster_map_carries_a_revision_and_sorted_nodes(seeded_client: TestClient) -> None:
    """순서가 흔들리면 캔버스가 이유 없이 다시 그려진다."""
    body = seeded_client.get(
        "/api/v1/brain/analysis/cluster-map", headers=_headers()
    ).json()
    assert body["revision"] > 0
    ids = [node["entity_id"] for node in body["nodes"]]
    assert ids == sorted(ids)
    assert ids, "그래프가 비어 있으면 이 테스트가 아무것도 재지 않는다"


def test_god_nodes_limit_is_clamped_instead_of_erroring(seeded_client: TestClient) -> None:
    """잘못된 상한이 500으로 새지 않는다 — 분석 함수는 `limit<=0`에 ValueError를 던진다."""
    for limit in (0, -5, 10_000):
        response = seeded_client.get(
            "/api/v1/brain/analysis/god-nodes",
            headers=_headers(),
            params={"limit": limit},
        )
        assert response.status_code == 200, (limit, response.text)


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/brain/analysis/god-nodes",
        "/api/v1/brain/analysis/cluster-map",
    ],
)
def test_analysis_endpoints_503_while_brain_disabled(path: str) -> None:
    with _disabled_client() as client:
        assert client.get(path, headers=_headers()).status_code == 503


def test_analysis_endpoints_require_the_bearer(seeded_client: TestClient) -> None:
    assert seeded_client.get("/api/v1/brain/analysis/god-nodes").status_code == 422
    assert (
        seeded_client.get(
            "/api/v1/brain/analysis/god-nodes",
            headers={"Authorization": "Bearer wrong"},
        ).status_code
        == 401
    )


def test_the_projector_is_shared_across_requests(seeded_client: TestClient) -> None:
    """요청마다 새로 만들면 리비전 캐시가 매번 비어 캐시를 둔 이유가 사라진다.

    `builds`가 **정확히 1만 는다**를 재는 것이 요점이다. "많아야 1"로 재면 엔드포인트가
    app.state의 그 객체를 아예 안 쓰고 매번 새 투영기를 만들어도(그 객체의 builds는
    0에 머문다) 통과해버린다 — 처음에 그렇게 썼다가 음성 대조가 발화하지 않아 드러났다.
    """
    projector = seeded_client.app.state.brain_projector
    assert projector is not None
    before = projector.builds
    for _ in range(3):
        response = seeded_client.get(
            "/api/v1/brain/analysis/god-nodes", headers=_headers()
        )
        assert response.status_code == 200
    assert projector.builds == before + 1, (
        "공유 투영기가 정확히 한 번만 지어야 한다 "
        f"(before={before}, after={projector.builds})"
    )


def test_cluster_map_does_not_recompute_clusters_per_request(
    seeded_client: TestClient,
) -> None:
    """군집 계산이 요청마다 돌면 1000노드에서 요청당 0.5초를 버린다.

    이전 판은 엔드포인트가 `cluster(projected)`를 직접 불러 **매번** 다시 계산했다.
    투영은 캐시하면서 그 위의 군집은 안 하고 있었던 것이 이 테스트가 잡는 것이다.
    """
    projector = seeded_client.app.state.brain_projector
    before = projector.cluster_builds
    for _ in range(3):
        response = seeded_client.get(
            "/api/v1/brain/analysis/cluster-map", headers=_headers()
        )
        assert response.status_code == 200
    assert projector.cluster_builds == before + 1, (
        f"군집이 요청마다 다시 계산됐다 (before={before}, after={projector.cluster_builds})"
    )


def test_surprising_connections_reuses_the_cached_clusters(
    seeded_client: TestClient,
) -> None:
    """두 엔드포인트가 같은 배정을 공유한다 — 화면 하나에 둘 다 뜨기 때문이다."""
    projector = seeded_client.app.state.brain_projector
    before = projector.cluster_builds
    for path in (
        "/api/v1/brain/analysis/cluster-map",
        "/api/v1/brain/analysis/surprising-connections",
    ):
        assert seeded_client.get(path, headers=_headers()).status_code == 200
    assert projector.cluster_builds == before + 1
