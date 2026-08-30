
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from athena_api.brain import (
    ChatHistoryRecord,
    ChatRole,
    GraphProjector,
    GraphStore,
    HistoryStore,
    JobStatus,
    JobTrigger,
    god_nodes,
    graph_diff,
    labeling,
    suggest_questions,
    surprising_connections,
    utc_now,
)
from athena_api.brain.projection import cluster_cohesion, cluster_representative_labels
from athena_api.errors import BrainNotReadyError
from athena_api.lifespan import BrainRuntime, _teardown_brain
from athena_api.security import require_local_bearer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/brain", tags=["Investment brain"])

_NOT_LLM_EXPOSED = {"x-athena-llm-exposed": False}

# exposeToModel 게이트(WP-I) — `X-Athena-Caller: model` 자기신고 헤더(G-I1)가 붙은
# 호출만 검사한다. 자기신고 기반이라 실수 방지용이지 적대적 우회를 막지 않는다
# (expose-authz-design.md §2(a)) — 기존 X-Athena-Confirm류 신뢰 등급의 확장일 뿐
# 새 위협모델을 만들지 않는다. detail 문자열은 MCP dispatch()가 "토글 꺼짐"과
# "브레인 미기동"의 503을 구분하는 마커라 바꾸면 안 된다(brain_tools.py와 짝).
_MODEL_GATE_DETAIL = "expose-to-model-disabled"


def _require_model_exposure(request: Request, caller: str | None) -> None:
    if caller != "model":
        return  # Electron 등 로컬 호출자는 기존 그대로 — 게이트는 모델 경로 전용(G-I1).
    if not getattr(request.app.state, "expose_to_model", False):
        # 전용 503(G-I3) — 범용 >=400 분기와 달리 "사용자가 노출을 꺼 뒀다"를
        # 실제 오류와 구분해 말할 수 있게 한다.
        raise HTTPException(status_code=503, detail=_MODEL_GATE_DETAIL)
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
    startup_ingestion_job_id: str | None
    startup_ingestion_status: JobStatus | None
    startup_ingestion_detail: str | None


class StartupIngestionRetryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created: bool
    job_id: str
    status: JobStatus


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
    runtime: BrainRuntime | None = getattr(state, "brain_runtime", None)
    startup_job = None
    if runtime is not None and runtime.startup_ingestion_job_id is not None:
        startup_job = await runtime.history.get_job(runtime.startup_ingestion_job_id)

    settings = getattr(state, "settings", None)
    if not bool(getattr(settings, "brain_enabled", False)):
        startup_detail = "brain_disabled"
    elif runtime is None:
        startup_detail = "brain_unavailable"
    elif not runtime.ingestion_ready:
        startup_detail = "brain_ingestion_degraded"
    elif startup_job is None:
        startup_detail = "startup_ingestion_unavailable"
    elif startup_job.status is JobStatus.RETRY_WAIT:
        startup_detail = "startup_ingestion_retry_wait"
    elif startup_job.status is JobStatus.FAILED:
        startup_detail = "startup_ingestion_failed"
    else:
        startup_detail = None
    return BrainStatusResponse(
        ready=bool(getattr(state, "brain_ready", False)),
        ingestion_ready=bool(getattr(state, "brain_ingestion_ready", False)),
        extraction_enabled=bool(getattr(state, "brain_extraction_enabled", False)),
        startup_ingestion_job_id=(startup_job.id if startup_job is not None else None),
        startup_ingestion_status=(startup_job.status if startup_job is not None else None),
        startup_ingestion_detail=startup_detail,
    )

@router.post(
    "/startup-ingestion/retry",
    summary="실패한 부팅 수집 다시 실행",
    operation_id="retry_startup_brain_ingestion",
    response_model=StartupIngestionRetryResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "write",
    },
)
async def retry_startup_brain_ingestion(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> StartupIngestionRetryResponse:
    require_local_bearer(request, authorization)
    runtime: BrainRuntime | None = getattr(request.app.state, "brain_runtime", None)
    if runtime is None or not runtime.ingestion_ready or runtime.coordinator is None:
        raise BrainNotReadyError("investment brain ingestion is not ready")

    async with runtime.startup_ingestion_lock:
        job_id = runtime.startup_ingestion_job_id
        job = await runtime.history.get_job(job_id) if job_id is not None else None
        if job is None:
            raise BrainNotReadyError("startup ingestion job is not available")
        if job.status is not JobStatus.FAILED:
            return StartupIngestionRetryResponse(
                created=False,
                job_id=job.id,
                status=job.status,
            )

        retry_job = await runtime.coordinator.enqueue(JobTrigger.STARTUP)
        runtime.startup_ingestion_job_id = retry_job.id
        return StartupIngestionRetryResponse(
            created=True,
            job_id=retry_job.id,
            status=retry_job.status,
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
    x_athena_caller: Annotated[str | None, Header(alias="X-Athena-Caller")] = None,
    window_days: int = _DEFAULT_PROFILE_WINDOW_DAYS,
    limit: int = _DEFAULT_PROFILE_LIMIT,
) -> ProfileSummaryResponse:
    require_local_bearer(request, authorization)
    _require_model_exposure(request, x_athena_caller)
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
    surprise_score: float


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


class EntityEventOut(BaseModel):
    """`GraphEvent` 필드와 1:1 — 저장층 `entity_events()`가 낸 것을 그대로 노출한다."""

    model_config = ConfigDict(extra="forbid")

    seq: int
    at: datetime
    revision: int
    op: str
    subject_id: str
    object_id: str | None
    relation: str | None
    confidence_before: str | None
    confidence_after: str | None
    source_id: str | None


class EntityTimelineResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    events: list[EntityEventOut]


class ClusterMapNodeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    name: str
    kind: str
    cluster: int
    degree: int


class EdgeDetailOut(BaseModel):
    """엣지 하나의 원본 관계 메타데이터.

    `edges`(좌표 배치용 `[source, target]` 쌍)와 별개의 additive 필드다 — `projection.py`의
    `project()`가 이미 각 엣지에 싣는 `kinds`/`tier`/`confidence`(101~108행)를 그대로
    노출할 뿐, 새로 계산하지 않는다.
    """

    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    kinds: list[str]
    tier: str
    confidence: str


class ClusterMapResponse(BaseModel):
    """군집 지도 1단계 — Electron 그래프 모드가 처음 그리는 것."""

    model_config = ConfigDict(extra="forbid")

    revision: int
    nodes: list[ClusterMapNodeOut]
    edges: list[list[str]]
    cluster_cohesion: dict[int, float]
    cluster_representative_labels: dict[int, str]
    edge_details: list[EdgeDetailOut]
    # WP-F(F5) — LLM이 지은 **추정 이름**(additive, 기본 빈 dict). `name`(의미적
    # 이름, 항상 null)·`cluster_representative_labels`(규칙 기반)와 분리된 세 번째
    # 필드다 — 실패·휴면 시 비워 두면 프런트가 규칙 기반으로 정직하게 폴백한다.
    cluster_ai_labels: dict[int, str] = {}


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
    x_athena_caller: Annotated[str | None, Header(alias="X-Athena-Caller")] = None,
    limit: int = _DEFAULT_ANALYSIS_LIMIT,
) -> GodNodesResponse:
    require_local_bearer(request, authorization)
    _require_model_exposure(request, x_athena_caller)
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
    x_athena_caller: Annotated[str | None, Header(alias="X-Athena-Caller")] = None,
    limit: int = _DEFAULT_ANALYSIS_LIMIT,
) -> SurprisingConnectionsResponse:
    require_local_bearer(request, authorization)
    _require_model_exposure(request, x_athena_caller)
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
                surprise_score=item.surprise_score,
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
    x_athena_caller: Annotated[str | None, Header(alias="X-Athena-Caller")] = None,
    limit: int = _DEFAULT_ANALYSIS_LIMIT,
) -> SuggestedQuestionsResponse:
    require_local_bearer(request, authorization)
    _require_model_exposure(request, x_athena_caller)
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
    x_athena_caller: Annotated[str | None, Header(alias="X-Athena-Caller")] = None,
    from_revision: int = 0,
) -> GraphDiffResponse:
    require_local_bearer(request, authorization)
    _require_model_exposure(request, x_athena_caller)
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
    "/analysis/entity-timeline",
    summary="엔티티 하나의 변경 이력",
    operation_id="get_brain_entity_timeline",
    response_model=EntityTimelineResponse,
    openapi_extra={**_NOT_LLM_EXPOSED, "x-athena-side-effect": "none"},
)
async def get_brain_entity_timeline(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    entity_id: str,
    limit: int = _DEFAULT_ANALYSIS_LIMIT,
) -> EntityTimelineResponse:
    require_local_bearer(request, authorization)
    store = _require_store(request)
    events = await store.entity_events(entity_id, limit=_bounded(limit))
    return EntityTimelineResponse(
        entity_id=entity_id,
        events=[
            EntityEventOut(
                seq=event.seq,
                at=event.at,
                revision=event.revision,
                op=str(event.op),
                subject_id=event.subject_id,
                object_id=event.object_id,
                relation=event.relation,
                confidence_before=(
                    None if event.confidence_before is None else str(event.confidence_before)
                ),
                confidence_after=(
                    None if event.confidence_after is None else str(event.confidence_after)
                ),
                source_id=event.source_id,
            )
            for event in events
        ],
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
    representative_labels = cluster_representative_labels(projected, assignment)
    graph = projected.graph
    # WP-F(F4, G-F3) — LLM 추정 라벨은 캐시 히트만 이번 응답에 싣는다. 미스는
    # 응답을 지연시키지 않는다 — 필드를 비운 채 즉시 반환하고 백그라운드 태스크가
    # 캐시를 채워 다음 요청부터 히트가 된다.
    members_by_cluster: dict[int, list[str]] = {}
    for node, cluster_index in assignment.items():
        members_by_cluster.setdefault(cluster_index, []).append(node)
    cluster_ai_labels = await _collect_cluster_ai_labels(
        request, _require_store(request), graph, members_by_cluster
    )
    # 정렬해 내보낸다 — 순서가 흔들리면 캔버스가 이유 없이 다시 그려진다. edges와
    # edge_details가 같은 pair 목록에서 나오므로 둘의 순서가 항상 같이 간다.
    sorted_edge_pairs = sorted(tuple(sorted(edge)) for edge in graph.edges)
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
            for node in sorted(graph.nodes)
        ],
        edges=[list(pair) for pair in sorted_edge_pairs],
        cluster_cohesion=cohesion,
        cluster_representative_labels=representative_labels,
        edge_details=[
            EdgeDetailOut(
                source=pair[0],
                target=pair[1],
                kinds=list(graph.get_edge_data(*pair).get("kinds", ())),
                tier=str(graph.get_edge_data(*pair).get("tier", "")),
                confidence=str(graph.get_edge_data(*pair).get("confidence", "")),
            )
            for pair in sorted_edge_pairs
        ],
        cluster_ai_labels=cluster_ai_labels,
    )


# WP-F F4 — 백그라운드 라벨링 동시 스폰 상한. 첫 방문에 군집 여러 개가 한꺼번에
# 캐시 미스여도 군집 수만큼 무제한 스폰되지 않는다 — 넘치는 미스는 이번엔
# 규칙 기반 폴백만 반환하고, 다음 요청의 미스가 다시 기회를 얻는다.
_MAX_LABELING_TASKS = 4


async def _labeling_task(store: GraphStore, client, members: list[str], graph) -> None:
    try:
        await labeling.ensure_cluster_label(store, client, members, graph)
    except Exception:
        # 실패 무시(G-F3) — 캐시가 안 채워졌을 뿐이라 다음 요청이 같은 미스로
        # 흘러 자연히 재시도된다. 라벨은 있으면 좋은 것이지 없다고 틀리는 게 아니다.
        logger.debug("cluster labeling task failed", exc_info=True)


async def _collect_cluster_ai_labels(
    request: Request,
    store: GraphStore,
    graph,
    members_by_cluster: dict[int, list[str]],
) -> dict[int, str]:
    """캐시 히트는 즉시 싣고, 미스는 백그라운드 태스크로 채운다(fire-and-forget).

    생성된 태스크 참조는 반드시 `app.state.cluster_labeling_tasks`에 보관한다 —
    핸들러 반환 후 로컬 참조가 사라지면 GC가 실행 중인 태스크를 중도 회수할 수
    있다는 asyncio 문서 경고 대응(lifespan.py의 hourly_task 저장 관례와 동일).
    """
    client = getattr(request.app.state, "brain_cluster_labeling_llm_client", None)
    tasks: set[asyncio.Task] = getattr(request.app.state, "cluster_labeling_tasks", set())
    fingerprint = labeling.labeling_prompt_fingerprint()
    labels: dict[int, str] = {}
    for cluster_index, members in members_by_cluster.items():
        cached = await store.cluster_label(labeling.member_set_hash(members), fingerprint)
        if cached is not None:
            labels[cluster_index] = cached
            continue
        if client is None:
            continue  # 라벨링 휴면(G-F1) — 백그라운드 스폰도 없다.
        if len(tasks) >= _MAX_LABELING_TASKS:
            continue  # 동시 스폰 상한 — 이번 미스는 폴백만.
        task = asyncio.create_task(_labeling_task(store, client, list(members), graph))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    return labels
