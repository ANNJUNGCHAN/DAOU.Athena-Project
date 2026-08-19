"""Investment-brain HTTP surface: chat ingestion, status, chat/profile reads.

Local-only, bearer-gated the same way as ``api/oauth_status.py``
(``security.require_local_bearer``). Every read/write route 503s while the piece of the
brain runtime it needs is not ready instead of returning a silently empty result
(CLAUDE.md §7 -- "조용한 빈 결과 금지"). ``GET /status`` is the one exception: its whole
purpose is reporting readiness, so it always answers 200 (mirrors ``/ready/accounts`` in
``main.py``).

**Trap ⑫**: never pass ``text``/chat content into ``logger.*`` here, in this module or
any handler added to it. Only ``source_id``, ``role``, and a success/failure boolean are
safe to log.
"""

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

from athena_api.brain import ChatHistoryRecord, ChatRole, GraphStore, HistoryStore, utc_now
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
    fts_ready: bool


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
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    entity_kind: str
    entity_name: str
    relation_kind: str
    claim_count: int
    latest_observed_at: str
    average_confidence: float


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
        fts_ready=bool(getattr(state, "brain_fts_ready", False)),
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
                claim_count=entry.claim_count,
                latest_observed_at=entry.latest_observed_at,
                average_confidence=entry.average_confidence,
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


def _delete_brain_files(history_db_path: Path, graph_db_path: Path) -> list[str]:
    """Delete the raw-history sqlite file (+ WAL/SHM sidecars) and the graph store.

    ``graph_db_path`` (lbug) is unlink'd or rmtree'd depending on what it actually is on
    disk right now -- ADR §6 left the on-disk shape unresolved, so this branches on a
    runtime is_dir() check rather than assuming either shape (plan §2(f)).
    """
    deleted: list[str] = []
    for path in (
        history_db_path,
        Path(str(history_db_path) + "-wal"),
        Path(str(history_db_path) + "-shm"),
    ):
        if path.exists():
            path.unlink(missing_ok=True)
            deleted.append(str(path))
    if graph_db_path.exists():
        if graph_db_path.is_dir():
            shutil.rmtree(graph_db_path, ignore_errors=True)
        else:
            graph_db_path.unlink(missing_ok=True)
        deleted.append(str(graph_db_path))
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
    deleted = _delete_brain_files(settings.brain_history_db_path, settings.brain_db_path)
    hook = getattr(state, "brain_shutdown_hook", None) or _default_shutdown_hook
    background_tasks.add_task(hook)
    logger.info("brain reset-and-restart ok deleted_count=%d", len(deleted))
    return BrainResetResponse(deleted_files=deleted, restarting=True)
