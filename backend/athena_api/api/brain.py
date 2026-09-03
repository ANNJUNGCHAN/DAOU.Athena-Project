
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from athena_api.brain import (
    ChatHistoryRecord,
    ChatRole,
    GraphProjector,
    GraphStore,
    HistoryStore,
    IngestionJob,
    JobStatus,
    JobTrigger,
    god_nodes,
    graph_diff,
    labeling,
    suggest_questions,
    surprising_connections,
    utc_now,
)
from athena_api.brain.ontology import MAX_RAW_CHAT_TEXT_CHARS, Confidence
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
    text: str = Field(min_length=1, max_length=MAX_RAW_CHAT_TEXT_CHARS)
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
    ingest_schedule_owner: Literal["backend", "external"]
    startup_ingestion_job_id: str | None
    startup_ingestion_status: JobStatus | None
    startup_ingestion_detail: str | None


class StartupIngestionRetryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created: bool
    job_id: str
    status: JobStatus


class IngestionJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    trigger: JobTrigger
    status: JobStatus
    attempts: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    next_retry_at: datetime | None
    error: str | None


def _public_ingestion_job(job: IngestionJob) -> IngestionJobResponse:
    error = None
    if job.error:
        error = (
            "ingestion_retry_wait"
            if job.status is JobStatus.RETRY_WAIT
            else "ingestion_failed"
        )
    return IngestionJobResponse(
        id=job.id,
        trigger=job.trigger,
        status=job.status,
        attempts=job.attempts,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        next_retry_at=job.next_retry_at,
        error=error,
    )


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
    # 자르기 전 전체 개수. `entries`는 `limit`으로 잘린 상위 N이라 이 값이 없으면
    # 화면이 "상위 5 / 전체 312개"를 정직하게 쓸 수 없다(그동안 "전체 M개 보기"를
    # 아예 안 그린 이유가 이 필드의 부재였다).
    total: int
    # 어느 창을 봤는지. 화면의 기간 칩이 자기가 요청한 값이 아니라 **응답이 실제로
    # 쓴 값**을 표시해야 둘이 어긋나지 않는다.
    window_days: int
    # 창 전체의 confidence 분포(EXTRACTED/INFERRED/AMBIGUOUS → 개수). 히어로의
    # "사실 %·추론 %·불확실 %"가 잘라 온 상위 N이 아니라 전체를 말하게 하는 값이다.
    confidence_counts: dict[str, int]


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
        ingest_schedule_owner=getattr(settings, "brain_ingest_schedule_owner", "backend"),
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


class RelationConfirmRequest(BaseModel):
    """되물을 것들 카드의 '맞다' — 사람이 확인한 관계."""

    model_config = ConfigDict(extra="forbid")

    relation_id: str = Field(min_length=1, max_length=128)


class RelationConfirmResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changed: bool
    revision: int
    confidence: str | None = None


@router.post(
    "/relations/confirmations",
    summary="관계 하나를 사람이 확인한다(불확실 → 사실)",
    operation_id="confirm_brain_relation",
    response_model=RelationConfirmResponse,
    openapi_extra={
        # 취소 입구와 같은 이유로 모델에게 노출하지 않는다 — 부르는 것은 사람이 누른
        # 카드뿐이다. athena_brain에는 여전히 쓰기 액션이 없다.
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "write",
    },
)
async def confirm_brain_relation(
    payload: RelationConfirmRequest,
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> RelationConfirmResponse:
    """되물을 것들 카드의 '맞다'가 부르는 입구(2026-09-03 사용자 확정).

    카드가 묻는 것은 AMBIGUOUS 관계다. 사람이 '맞다'를 누르면 그것은 더 이상
    불확실이 아니다 — 주인이 확인했다. 예전에는 답변 문장이 채팅으로 나가고 다음
    수집 배치가 반영했는데, 그래서 답해도 "확인이 필요한 것 N건"이 줄지 않아
    같은 카드가 무한히 되물었다(실측).
    """
    require_local_bearer(request, authorization)
    store = _require_store(request)
    updated = await store.set_relation_confidence(payload.relation_id, Confidence.EXTRACTED)
    revision = await store.graph_revision()
    if updated is None:
        logger.info("brain relation confirm miss relation_id=%s", payload.relation_id)
        return RelationConfirmResponse(changed=False, revision=revision)
    return RelationConfirmResponse(
        changed=True, revision=revision, confidence=updated.confidence
    )


class RelationRetractRequest(BaseModel):
    """사람이 화면에서 지운 관계 하나."""

    model_config = ConfigDict(extra="forbid")

    relation_id: str = Field(min_length=1, max_length=128)


class RelationRetractResponse(BaseModel):
    """무엇을 지웠는지 그대로 돌려준다 — 화면이 "무엇이 사라졌다"를 말할 수 있어야 한다."""

    model_config = ConfigDict(extra="forbid")

    removed: bool
    revision: int
    source_entity_id: str | None = None
    target_entity_id: str | None = None
    kind: str | None = None


@router.post(
    "/relations/retractions",
    summary="관계 하나를 사람이 직접 지운다",
    operation_id="retract_brain_relation",
    response_model=RelationRetractResponse,
    openapi_extra={
        # 모델에게 노출하지 않는다. 그래프 쓰기가 사람의 행동에서 시작한다는 규칙은
        # 그대로다 — 이 입구는 사람이 카드를 누른 결과로만 불린다. athena_brain에는
        # 여전히 쓰기 액션이 없다(test_no_write_action_exists).
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "write",
    },
)
async def retract_brain_relation(
    payload: RelationRetractRequest,
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> RelationRetractResponse:
    """확정 카드의 '적용'이 부르는 입구(2026-09-03 사용자 확정).

    예전에는 카드가 답변 문장을 채팅으로만 보냈고, 그래프 반영은 다음 수집 배치가
    했다. 그래서 누른 직후 아무 일도 안 일어나 사람이 같은 카드를 반복해 눌렀다.
    수집(대화를 캐는 일)과 편집(주인이 화면에서 고치는 일)은 다른 일이고, 편집은
    즉시 반영되어야 한다.
    """
    require_local_bearer(request, authorization)
    store = _require_store(request)
    removed = await store.retract_relation(payload.relation_id)
    revision = await store.graph_revision()
    if removed is None:
        # 이미 없는 관계를 지우라고 한 것 — 오류가 아니다(사람이 두 번 눌렀거나
        # 그사이 dedup이 합쳤을 수 있다). 아무것도 안 지웠다는 사실만 정직하게 말한다.
        logger.info("brain relation retract miss relation_id=%s", payload.relation_id)
        return RelationRetractResponse(removed=False, revision=revision)
    logger.info(
        "brain relation retract ok relation=%s tier=%s",
        removed.kind,
        removed.tier,
    )
    return RelationRetractResponse(
        removed=True,
        revision=revision,
        source_entity_id=removed.source_entity_id,
        target_entity_id=removed.target_entity_id,
        kind=removed.kind,
    )


@router.post(
    "/ingestion/jobs",
    summary="브레인 수집 수동 실행",
    operation_id="enqueue_brain_ingestion",
    response_model=IngestionJobResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "write",
    },
)
async def enqueue_brain_ingestion(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> IngestionJobResponse:
    require_local_bearer(request, authorization)
    runtime: BrainRuntime | None = getattr(request.app.state, "brain_runtime", None)
    if runtime is None or not runtime.ingestion_ready or runtime.coordinator is None:
        raise BrainNotReadyError("investment brain ingestion is not ready")
    return _public_ingestion_job(await runtime.coordinator.enqueue(JobTrigger.MANUAL))


@router.get(
    "/ingestion/jobs/{job_id}",
    summary="브레인 수집 작업 상태 조회",
    operation_id="get_brain_ingestion_job",
    response_model=IngestionJobResponse,
    openapi_extra={
        **_NOT_LLM_EXPOSED,
        "x-athena-side-effect": "none",
    },
)
async def get_brain_ingestion_job(
    job_id: str,
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> IngestionJobResponse:
    require_local_bearer(request, authorization)
    runtime: BrainRuntime | None = getattr(request.app.state, "brain_runtime", None)
    if runtime is None or not runtime.ingestion_ready:
        raise BrainNotReadyError("investment brain ingestion is not ready")
    job = await runtime.history.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="ingestion job not found")
    return _public_ingestion_job(job)


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
    now = utc_now()
    entries = await store.investor_profile_summary(
        now=now, window_days=window_days, limit=limit
    )
    total = await store.investor_profile_signal_count(now=now, window_days=window_days)
    confidence_counts = await store.investor_profile_confidence_counts(
        now=now, window_days=window_days
    )
    return ProfileSummaryResponse(
        total=total,
        window_days=window_days,
        confidence_counts=confidence_counts,
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
    # 이 연결이 마지막으로 관측된 시각(`projection.py`가 합쳐진 관계들의 최댓값을
    # 싣는다). 그래프 모드 지도의 기간 필터가 이 값으로 거른다 — 이 필드가 없던
    # 동안 화면은 "최근 90일"이라 써 놓고 전체 기간을 그리고 있었다.
    observed_at: str


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
    # 프로필을 뺀 분석용 투영 — 안 그러면 1위가 항상 투자자 자신이다
    # (projection.GraphProjector.analysis 참고).
    projected = await _require_projector(request).analysis()
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
    # 프로필과의 연결은 정의상 놀랍지 않다(그게 성향이다) — 분석용 투영을 쓴다.
    projected = await projector.analysis()
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
    # 지도는 테마·종목의 관계를 그린다 — 투자자 프로필 노드는 원점이지 구성원이
    # 아니라서 뺀다(projection.GraphProjector.analysis 참고). 프로필에서 뻗은 성향
    # 관계는 profile-summary가 계속 낸다.
    projected = await projector.analysis()
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
                observed_at=str(graph.get_edge_data(*pair).get("observed_at", "")),
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

    생성된 태스크 참조는 반드시 `app.state.cluster_labeling_tasks`의 요청 키에 보관한다 —
    핸들러 반환 후 로컬 참조가 사라지면 GC가 실행 중인 태스크를 중도 회수할 수
    있다는 asyncio 문서 경고 대응(lifespan.py의 hourly_task 저장 관례와 동일).
    """
    client = getattr(request.app.state, "brain_cluster_labeling_llm_client", None)
    tasks: dict[tuple[str, str], asyncio.Task[None]] = getattr(
        request.app.state, "cluster_labeling_tasks", {}
    )
    fingerprint = labeling.labeling_prompt_fingerprint()
    labels: dict[int, str] = {}
    for cluster_index, members in members_by_cluster.items():
        member_hash = labeling.member_set_hash(members)
        cached = await store.cluster_label(member_hash, fingerprint)
        if cached is not None:
            labels[cluster_index] = cached
            continue
        if client is None:
            continue  # 라벨링 휴면(G-F1) — 백그라운드 스폰도 없다.
        task_key = (fingerprint, member_hash)
        if task_key in tasks:
            continue  # 같은 프롬프트·멤버 집합은 이미 한 태스크가 채우고 있다.
        if len(tasks) >= _MAX_LABELING_TASKS:
            continue  # 동시 스폰 상한 — 이번 미스는 폴백만.
        task = asyncio.create_task(_labeling_task(store, client, list(members), graph))
        tasks[task_key] = task

        def discard_finished(done: asyncio.Task[None], *, key=task_key) -> None:
            if tasks.get(key) is done:
                tasks.pop(key, None)

        task.add_done_callback(discard_finished)
    return labels


# ── 노드 하나의 상세(2026-09-03) ────────────────────────────────────────────────
#
# 채팅의 "이 노드 설명해줘"가 자료로 답할 수 있게 하는 유일한 경로다. 화면의 공통
# 패널은 같은 질문에 세 왕복(profile-summary·cluster-map·entity-timeline)으로 답하는데
# 모델에는 그 셋 중 어느 것도 노드 단위로 열려 있지 않았다.
#
# `entity-timeline`과 달리 `_require_model_exposure`를 탄다 — 사용자가 모델 전달을
# 꺼 두면 노드 원문도 나가지 않아야 한다. 표시는 다른 분석과 같은 `_NOT_LLM_EXPOSED`다
# (모델은 OpenAPI가 아니라 `athena_brain` 프록시로만 온다).

_DEFAULT_ENTITY_DETAIL_LIMIT = 30


class SourceExcerptOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    kind: str
    text: str
    locator: str | None
    occurred_at: str
    # 잘린 발췌를 전문처럼 인용하면 "원문에 그렇게 적혀 있다"가 거짓이 된다.
    truncated: bool
    full_chars: int


class EntityRelationOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relation_id: str
    relation_kind: str
    direction: Literal["out", "in"]
    other_entity_id: str
    other_entity_kind: str
    other_entity_name: str
    confidence: str
    tier: str
    rationale: str | None
    observed_at: str
    reinforcement: int
    source: SourceExcerptOut | None


class EntityDetailEventOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seq: int
    at: str
    revision: int
    op: str
    subject_id: str
    object_id: str | None
    relation: str | None
    confidence_before: str | None
    confidence_after: str | None
    source: SourceExcerptOut | None


class EntityCandidateOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    kind: str
    name: str


class EntityDetailResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int
    # 질의를 그대로 돌려준다 — 모델이 "무엇을 찾아 준 것인가"를 스스로 확인할 수 있어야
    # 이름이 비슷한 다른 노드를 설명하고도 모르는 일이 없다.
    query: str
    resolved: bool
    entity_id: str | None = None
    kind: str | None = None
    name: str | None = None
    degree: int | None = None
    aliases: list[str] = []
    relations: list[EntityRelationOut] = []
    timeline: list[EntityDetailEventOut] = []
    # 이름이 여럿에 걸리면 하나를 골라 단정하지 않는다(§0) — 후보를 주고 되묻게 한다.
    candidates: list[EntityCandidateOut] = []


def _source_excerpt_out(excerpt: object) -> SourceExcerptOut | None:
    if excerpt is None:
        return None
    return SourceExcerptOut(
        source_id=excerpt.source_id,
        kind=excerpt.kind,
        text=excerpt.text,
        locator=excerpt.locator,
        occurred_at=excerpt.occurred_at,
        truncated=excerpt.truncated,
        full_chars=excerpt.full_chars,
    )


@router.get(
    "/analysis/entity-detail",
    summary="노드 하나의 관계·이력·출처 원문",
    operation_id="get_brain_entity_detail",
    response_model=EntityDetailResponse,
    openapi_extra={**_NOT_LLM_EXPOSED, "x-athena-side-effect": "none"},
)
async def get_brain_entity_detail(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    entity: str,
    x_athena_caller: Annotated[str | None, Header(alias="X-Athena-Caller")] = None,
    limit: int = _DEFAULT_ENTITY_DETAIL_LIMIT,
) -> EntityDetailResponse:
    require_local_bearer(request, authorization)
    _require_model_exposure(request, x_athena_caller)
    store = _require_store(request)
    revision = await store.graph_revision()
    query = entity.strip()
    if not query:
        return EntityDetailResponse(revision=revision, query=entity, resolved=False)

    bounded = _bounded(limit)
    # 먼저 id로 본다 — 화면이 고른 노드는 id를 그대로 넘긴다. 실패하면 이름 검색이다.
    detail = await store.entity_detail(query, relation_limit=bounded, event_limit=bounded)
    if detail is None:
        hits = await store.search_entities(query, limit=5)
        if not hits:
            return EntityDetailResponse(revision=revision, query=query, resolved=False)
        # 이름이 정확히 하나에만 걸릴 때만 단정한다. 여럿이면 후보만 준다 —
        # "삼성"이 삼성전자·삼성화재·삼성바이오로직스에 걸리는 일이 실제로 있다.
        exact = [hit for hit in hits if hit.name.strip() == query]
        chosen = exact[0] if len(exact) == 1 else (hits[0] if len(hits) == 1 else None)
        if chosen is None:
            return EntityDetailResponse(
                revision=revision,
                query=query,
                resolved=False,
                candidates=[
                    EntityCandidateOut(entity_id=hit.entity_id, kind=hit.kind, name=hit.name)
                    for hit in hits
                ],
            )
        detail = await store.entity_detail(
            chosen.entity_id, relation_limit=bounded, event_limit=bounded
        )
        if detail is None:
            # FTS에는 있는데 엔티티가 없다 — 색인이 앞서간 경우다. 지어내지 않는다.
            return EntityDetailResponse(revision=revision, query=query, resolved=False)

    return EntityDetailResponse(
        revision=revision,
        query=query,
        resolved=True,
        entity_id=detail.entity.id,
        kind=detail.entity.kind,
        name=detail.entity.name,
        degree=detail.entity.degree,
        aliases=list(detail.entity.aliases),
        relations=[
            EntityRelationOut(
                relation_id=edge.relation_id,
                relation_kind=edge.relation_kind,
                direction=edge.direction,
                other_entity_id=edge.other_entity_id,
                other_entity_kind=edge.other_entity_kind,
                other_entity_name=edge.other_entity_name,
                confidence=edge.confidence,
                tier=edge.tier,
                rationale=edge.rationale,
                observed_at=edge.observed_at,
                reinforcement=edge.reinforcement,
                source=_source_excerpt_out(edge.source),
            )
            for edge in detail.relations
        ],
        timeline=[
            EntityDetailEventOut(
                seq=event.seq,
                at=event.at,
                revision=event.revision,
                op=event.op,
                subject_id=event.subject_id,
                object_id=event.object_id,
                relation=event.relation,
                confidence_before=event.confidence_before,
                confidence_after=event.confidence_after,
                source=_source_excerpt_out(event.source),
            )
            for event in detail.events
        ],
    )
