
from __future__ import annotations

import logging
import os
import shutil
import signal
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, Request
from pydantic import BaseModel, ConfigDict, Field

from athena_api.brain import (
    ChatHistoryRecord,
    ChatRole,
    GraphProjector,
    GraphStore,
    HistoryStore,
    god_nodes,
    graph_diff,
    suggest_questions,
    surprising_connections,
    utc_now,
)
from athena_api.brain.projection import cluster_cohesion
from athena_api.errors import BrainNotReadyError
from athena_api.lifespan import BrainRuntime, _teardown_brain
from athena_api.security import require_local_bearer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/brain", tags=["Investment brain"])

_NOT_LLM_EXPOSED = {"x-athena-llm-exposed": False}
_DEFAULT_PROFILE_WINDOW_DAYS = 90
_DEFAULT_PROFILE_LIMIT = 50
_DEFAULT_CHATS_LIMIT = 100
_DEFAULT_CONVERSATIONS_LIMIT = 50
# 분석 결과의 기본·최대 상한. 화면 하나에 들어갈 만큼만 낸다.
_DEFAULT_ANALYSIS_LIMIT = 10
_MAX_ANALYSIS_LIMIT = 100


def _bounded(limit: int) -> int:
    """상한을 범위 안으로 접는다.

    분석 함수들은 `limit <= 0`에 `ValueError`를 던진다. HTTP 경계에서 그걸 그대로
    500으로 흘리면 잘못된 질의가 서버 오류처럼 보인다 — 여기서 접는다.
    """
    return max(1, min(int(limit), _MAX_ANALYSIS_LIMIT))


def _require_history(request: Request) -> HistoryStore:
    history = getattr(request.app.state, "brain_history", None)
    if history is None:
        raise BrainNotReadyError("investment brain history store is not ready")
    return history


def _require_store(request: Request) -> GraphStore:
    store = getattr(request.app.state, "brain_store", None)
    if store is None:
        raise BrainNotReadyError("investment brain graph store is not ready")
    return store


def _require_projector(request: Request) -> GraphProjector:
    """앱 수명에 묶인 투영기.

    요청마다 새로 만들면 캐시가 매번 비어 분석 한 화면에 그래프를 네 번 읽는다 —
    캐시를 둔 이유가 사라진다. `brain_ready`일 때만 존재하므로 그 게이트를 함께 탄다.
    """
    projector = getattr(request.app.state, "brain_projector", None)
    if projector is None:
        raise BrainNotReadyError("investment brain projection is not ready")
    return projector


class ChatIngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str
    role: ChatRole
    text: str = Field(min_length=1, max_length=10_000)
    message_id: str
    occurred_at: datetime


class ChatIngestResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    revision: int


class BrainStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    ingestion_ready: bool
    extraction_enabled: bool


class ChatMessageOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str
    conversation_id: str
    role: ChatRole
    text: str
    occurred_at: datetime


class ChatHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessageOut]


class ConversationSummaryOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str
    message_count: int
    first_occurred_at: datetime
    last_occurred_at: datetime


class ConversationsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversations: list[ConversationSummaryOut]


class ProfileSummaryEntryOut(BaseModel):
    """프로필 요약 한 행.

    leaf 7에서 필드를 갈아엎었다. 이전 판은 `claim_count`/`average_confidence`를 냈는데
    그 이름들은 leaf 1이 `Claim`을 폐기하면서 저장층에서 **사라진 지 오래**였다.
    엔드포인트가 존재하지 않는 속성을 읽고 있었고, 결과가 빈 목록일 때만 테스트해서
    `AttributeError`가 한 번도 드러나지 않았다 — 성향이 하나라도 쌓이는 순간 500이었다.

    `tier`가 응답에 있는 것이 새 설계의 핵심이다. 말(대화)과 행동(체결·잔고)을 한 표에
    두되 어느 쪽에서 왔는지 읽는 쪽이 구분할 수 있어야 한다.
    """

    model_config = ConfigDict(extra="forbid")

    entity_id: str
    entity_kind: str
    entity_name: str
    relation_kind: str
    confidence: str
    tier: str
    rationale: str | None
    observed_at: str
    reinforcement: int


class ProfileSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entries: list[ProfileSummaryEntryOut]


class BrainResetResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    deleted_files: list[str]
    restarting: bool


@router.post(
    "/chat",
    summary="채팅 한 턴 원본 저장",
    operation_id="post_brain_chat",
    response_model=ChatIngestResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "write",
    },
)
async def post_brain_chat(
    payload: ChatIngestRequest,
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> ChatIngestResponse:
    require_local_bearer(request, authorization)
    history = _require_history(request)
    record = ChatHistoryRecord(
        message_id=payload.message_id,
        conversation_id=payload.conversation_id,
        role=payload.role,
        text=payload.text,
        occurred_at=payload.occurred_at,
    )
    result = await history.upsert_chat(record)
    logger.info(
        "brain chat upsert ok source_id=%s role=%s changed=%s",
        result.source_id,
        payload.role.value,
        result.changed,
    )
    return ChatIngestResponse(source_id=result.source_id, revision=result.revision)


@router.get(
    "/status",
    summary="브레인 준비 상태 조회",
    operation_id="get_brain_status",
    response_model=BrainStatusResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "none",
    },
)
async def get_brain_status(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> BrainStatusResponse:
    require_local_bearer(request, authorization)
    state = request.app.state
    return BrainStatusResponse(
        ready=bool(getattr(state, "brain_ready", False)),
        ingestion_ready=bool(getattr(state, "brain_ingestion_ready", False)),
        extraction_enabled=bool(getattr(state, "brain_extraction_enabled", False)),
    )


@router.get(
    "/chats",
    summary="대화별 채팅 이력 조회",
    operation_id="get_brain_chats",
    response_model=ChatHistoryResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "none",
    },
)
async def get_brain_chats(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    conversation_id: str,
    limit: int = _DEFAULT_CHATS_LIMIT,
) -> ChatHistoryResponse:
    require_local_bearer(request, authorization)
    history = _require_history(request)
    messages = await history.chats_for_conversation(conversation_id, limit=limit)
    return ChatHistoryResponse(
        messages=[
            ChatMessageOut(
                message_id=message.message_id,
                conversation_id=message.conversation_id,
                role=message.role,
                text=message.text,
                occurred_at=message.occurred_at,
            )
            for message in messages
        ]
    )


@router.get(
    "/conversations",
    summary="대화 목록 조회(건수·시각만, 본문 없음)",
    operation_id="get_brain_conversations",
    response_model=ConversationsResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "none",
    },
)
async def get_brain_conversations(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    limit: int = _DEFAULT_CONVERSATIONS_LIMIT,
) -> ConversationsResponse:
    """List conversations by id/count/timestamps only -- trap 12: never the transcript body."""
    require_local_bearer(request, authorization)
    history = _require_history(request)
    summaries = await history.conversations(limit=limit)
    return ConversationsResponse(
        conversations=[
            ConversationSummaryOut(
                conversation_id=summary.conversation_id,
                message_count=summary.message_count,
                first_occurred_at=summary.first_occurred_at,
                last_occurred_at=summary.last_occurred_at,
            )
            for summary in summaries
        ]
    )


@router.get(
    "/profile-summary",
    summary="투자 성향 요약(읽기 시점 시간윈도우 집계)",
    operation_id="get_brain_profile_summary",
    response_model=ProfileSummaryResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "none",
    },
)
async def get_brain_profile_summary(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    window_days: int = _DEFAULT_PROFILE_WINDOW_DAYS,
    limit: int = _DEFAULT_PROFILE_LIMIT,
) -> ProfileSummaryResponse:
    require_local_bearer(request, authorization)
    store = _require_store(request)
    entries = await store.investor_profile_summary(
        now=utc_now(), window_days=window_days, limit=limit
    )
    return ProfileSummaryResponse(
        entries=[
            ProfileSummaryEntryOut(
                entity_id=entry.entity_id,
                entity_kind=entry.entity_kind,
                entity_name=entry.entity_name,
                relation_kind=entry.relation_kind,
                confidence=entry.confidence,
                tier=entry.tier,
                rationale=entry.rationale,
                observed_at=entry.observed_at,
                reinforcement=entry.reinforcement,
            )
            for entry in entries
        ]
    )


def _default_shutdown_hook() -> None:
    """Production default: ask this process's own event loop to shut down via SIGTERM.

    Runs as a BackgroundTasks callback, i.e. strictly after the response body has already
    been flushed to the client (starlette's contract for BackgroundTasks) -- so the caller
    always sees the 200 before the process starts exiting.
    """
    os.kill(os.getpid(), signal.SIGTERM)


def _delete_brain_files(graph_db_path: Path) -> list[str]:
    """브레인 파일과 WAL/SHM 사이드카를 지운다.

    leaf 2에서 그래프·원본이력·잡 상태가 한 파일로 합쳐지면서 지울 대상도 하나가 됐다.
    이전에는 둘을 지웠는데, 하나만 지워지고 죽으면 반쪽 상태가 남았다 — 리셋이
    되살리려던 바로 그 상황이다.

    디렉터리 분기를 남겨둔 이유: LadybugDB 시절 `brain.lbug`가 디렉터리였을 수 있고,
    그 자리에서 업그레이드한 설치가 있으면 파일이 아니라 디렉터리를 만난다.
    """
    deleted: list[str] = []
    if graph_db_path.exists() and graph_db_path.is_dir():
        shutil.rmtree(graph_db_path, ignore_errors=True)
        deleted.append(str(graph_db_path))
        return deleted
    for path in (
        graph_db_path,
        Path(str(graph_db_path) + "-wal"),
        Path(str(graph_db_path) + "-shm"),
    ):
        if path.exists():
            path.unlink(missing_ok=True)
            deleted.append(str(path))
    return deleted


@router.post(
    "/reset-and-restart",
    summary="투자 성향・이력 전체 삭제 후 프로세스 재기동",
    operation_id="post_brain_reset_and_restart",
    response_model=BrainResetResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "write",
    },
)
async def post_brain_reset_and_restart(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    background_tasks: BackgroundTasks,
) -> BrainResetResponse:
    """Teardown -> delete on disk -> 200 -> (background) shutdown signal.

    Never reopens the brain in this process (GraphStore/HistoryStore are one-shot --
    store.py/history.py both raise on open() after close()). The next open happens on the
    next process boot's ordinary _open_brain path, after Electron's reset IPC handler
    (app/lib/main/backend-launcher.js) restarts the backend.
    """
    require_local_bearer(request, authorization)
    state = request.app.state
    brain: BrainRuntime | None = getattr(state, "brain_runtime", None)
    if brain is None:
        raise BrainNotReadyError("investment brain runtime is not ready")
    settings = state.settings
    await _teardown_brain(request.app, brain)
    state.brain_runtime = None
    deleted = _delete_brain_files(settings.brain_db_path)
    hook = getattr(state, "brain_shutdown_hook", None) or _default_shutdown_hook
    background_tasks.add_task(hook)
    logger.info("brain reset-and-restart ok deleted_count=%d", len(deleted))
    return BrainResetResponse(deleted_files=deleted, restarting=True)


# --- 분석 4종 + 군집 지도 (leaf 7) -------------------------------------------------------
#
# 저장층이 답하지 못하는 질문들이다. 다섯이 한 화면을 채우므로 공유 투영기의 캐시가
# 실제로 값을 한다 — 요청마다 투영하면 그래프를 다섯 번 읽는다.


class GodNodeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    name: str
    kind: str
    degree: int


class GodNodesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int
    nodes: list[GodNodeOut]


class SurprisingConnectionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_entity_id: str
    source_name: str
    target_entity_id: str
    target_name: str
    kinds: list[str]
    source_cluster: int
    target_cluster: int


class SurprisingConnectionsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int
    connections: list[SurprisingConnectionOut]


class SuggestedQuestionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relation_id: str
    subject_name: str
    object_name: str
    relation_kind: str
    rationale: str | None
    question: str


class SuggestedQuestionsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int
    questions: list[SuggestedQuestionOut]


class GraphDiffResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    from_revision: int
    to_revision: int
    entities_added: list[str]
    entities_merged: list[str]
    edges_added: list[str]
    edges_removed: list[str]
    edges_changed: list[str]
    edges_rejected: list[str]


class ClusterMapNodeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    name: str
    kind: str
    cluster: int
    degree: int


class ClusterMapResponse(BaseModel):
    """군집 지도 1단계 — Electron 그래프 모드가 처음 그리는 것."""

    model_config = ConfigDict(extra="forbid")

    revision: int
    nodes: list[ClusterMapNodeOut]
    edges: list[list[str]]
    cluster_cohesion: dict[int, float]


@router.get(
    "/analysis/god-nodes",
    summary="투자의 중심 노드",
    operation_id="get_brain_god_nodes",
    response_model=GodNodesResponse,
    openapi_extra={**_NOT_LLM_EXPOSED, "x-athena-side-effect": "none"},
)
async def get_brain_god_nodes(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    limit: int = _DEFAULT_ANALYSIS_LIMIT,
) -> GodNodesResponse:
    require_local_bearer(request, authorization)
    projected = await _require_projector(request).project()
    return GodNodesResponse(
        revision=projected.revision,
        nodes=[
            GodNodeOut(
                entity_id=node.entity_id,
                name=node.name,
                kind=node.kind,
                degree=node.degree,
            )
            for node in god_nodes(projected, limit=_bounded(limit))
        ],
    )


@router.get(
    "/analysis/surprising-connections",
    summary="군집 경계를 넘는 연결",
    operation_id="get_brain_surprising_connections",
    response_model=SurprisingConnectionsResponse,
    openapi_extra={**_NOT_LLM_EXPOSED, "x-athena-side-effect": "none"},
)
async def get_brain_surprising_connections(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    limit: int = _DEFAULT_ANALYSIS_LIMIT,
) -> SurprisingConnectionsResponse:
    require_local_bearer(request, authorization)
    projector = _require_projector(request)
    projected = await projector.project()
    assignment = await projector.clusters()
    return SurprisingConnectionsResponse(
        revision=projected.revision,
        connections=[
            SurprisingConnectionOut(
                source_entity_id=item.source_entity_id,
                source_name=item.source_name,
                target_entity_id=item.target_entity_id,
                target_name=item.target_name,
                kinds=list(item.kinds),
                source_cluster=item.source_cluster,
                target_cluster=item.target_cluster,
            )
            for item in surprising_connections(
                projected, limit=_bounded(limit), assignment=assignment
            )
        ],
    )


@router.get(
    "/analysis/suggested-questions",
    summary="되물을 것들 (불확실하다고 기록된 관계)",
    operation_id="get_brain_suggested_questions",
    response_model=SuggestedQuestionsResponse,
    openapi_extra={**_NOT_LLM_EXPOSED, "x-athena-side-effect": "none"},
)
async def get_brain_suggested_questions(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    limit: int = _DEFAULT_ANALYSIS_LIMIT,
) -> SuggestedQuestionsResponse:
    require_local_bearer(request, authorization)
    store = _require_store(request)
    projected = await _require_projector(request).project()
    return SuggestedQuestionsResponse(
        revision=projected.revision,
        questions=[
            SuggestedQuestionOut(
                relation_id=item.relation_id,
                subject_name=item.subject_name,
                object_name=item.object_name,
                relation_kind=item.relation_kind,
                rationale=item.rationale,
                question=item.question,
            )
            for item in suggest_questions(
                projected, await store.relations(), limit=_bounded(limit)
            )
        ],
    )


@router.get(
    "/analysis/diff",
    summary="두 리비전 사이의 변화",
    operation_id="get_brain_graph_diff",
    response_model=GraphDiffResponse,
    openapi_extra={**_NOT_LLM_EXPOSED, "x-athena-side-effect": "none"},
)
async def get_brain_graph_diff(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    from_revision: int = 0,
) -> GraphDiffResponse:
    require_local_bearer(request, authorization)
    store = _require_store(request)
    diff = graph_diff(await store.events(), from_revision=max(0, from_revision))
    return GraphDiffResponse(
        from_revision=diff.from_revision,
        to_revision=diff.to_revision,
        entities_added=list(diff.entities_added),
        entities_merged=list(diff.entities_merged),
        edges_added=list(diff.edges_added),
        edges_removed=list(diff.edges_removed),
        edges_changed=list(diff.edges_changed),
        edges_rejected=list(diff.edges_rejected),
    )


@router.get(
    "/analysis/cluster-map",
    summary="군집 지도 (그래프 모드 1단계)",
    operation_id="get_brain_cluster_map",
    response_model=ClusterMapResponse,
    openapi_extra={**_NOT_LLM_EXPOSED, "x-athena-side-effect": "none"},
)
async def get_brain_cluster_map(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> ClusterMapResponse:
    require_local_bearer(request, authorization)
    projector = _require_projector(request)
    projected = await projector.project()
    assignment = await projector.clusters()
    cohesion = cluster_cohesion(projected, assignment)
    graph = projected.graph
    return ClusterMapResponse(
        revision=projected.revision,
        nodes=[
            ClusterMapNodeOut(
                entity_id=node,
                name=str(graph.nodes[node].get("name", "")),
                kind=str(graph.nodes[node].get("kind", "")),
                cluster=assignment.get(node, -1),
                degree=graph.degree(node),
            )
            # 정렬해 내보낸다 — 순서가 흔들리면 캔버스가 이유 없이 다시 그려진다.
            for node in sorted(graph.nodes)
        ],
        edges=[list(pair) for pair in sorted(tuple(sorted(edge)) for edge in graph.edges)],
        cluster_cohesion=cohesion,
    )
