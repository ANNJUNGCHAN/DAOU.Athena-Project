"""Bounded batch execution for allowlisted Kiwoom HTTP query operations."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from athena_api.dependencies import KiwoomClientDep
from athena_api.errors import KiwoomApiError
from athena_api.generated.registry import READ_TR_IDS, SPLIT_BASE_TR_IDS, TR_REGISTRY
from athena_api.kiwoom import RequestOptions

_BATCH_CONCURRENCY = 5


class BatchItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tr_id: str
    body: dict[str, Any] = Field(default_factory=dict)
    cont_yn: Literal["N", "Y"] = "N"
    next_key: str | None = None

    @field_validator("tr_id")
    @classmethod
    def http_query_only(cls, value: str) -> str:
        if value in SPLIT_BASE_TR_IDS:
            raise ValueError("tr_id is served through its detail projections")
        if value not in READ_TR_IDS:
            raise ValueError("tr_id is not an allowlisted HTTP query operation")
        return value


class BatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[BatchItem] = Field(min_length=1, max_length=100)


class BatchError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    detail: str = "Kiwoom upstream request failed"
    code: str | None = None


class BatchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tr_id: str
    ok: bool
    body: dict[str, Any] | None = None
    cont_yn: str = "N"
    next_key: str | None = None
    error: BatchError | None = None


class BatchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    results: list[BatchResult]


router = APIRouter(tags=["Batch"])


@router.post(
    "/api/v1/batch",
    response_model=BatchResponse,
    operation_id="post_tr_batch",
    summary="Batch allowlisted Kiwoom HTTP query operations",
    description="Order, OAuth, and WebSocket-path TR IDs are not accepted.",
)
async def post_batch(payload: BatchRequest, client: KiwoomClientDep) -> BatchResponse:
    semaphore = asyncio.Semaphore(_BATCH_CONCURRENCY)

    async def run(item: BatchItem) -> BatchResult:
        spec = TR_REGISTRY[item.tr_id]
        try:
            async with semaphore:
                envelope = await client.post_with_headers(
                    item.tr_id,
                    spec.upstream_path,
                    item.body,
                    RequestOptions(cont_yn=item.cont_yn, next_key=item.next_key),
                )
        except KiwoomApiError as exc:
            return BatchResult(
                tr_id=item.tr_id,
                ok=False,
                error=BatchError(code=exc.code),
            )
        return BatchResult(
            tr_id=item.tr_id,
            ok=True,
            body=envelope.body,
            cont_yn=envelope.cont_yn,
            next_key=envelope.next_key,
        )

    return BatchResponse(results=list(await asyncio.gather(*(run(item) for item in payload.items))))
