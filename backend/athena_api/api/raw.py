"""Allowlisted raw HTTP query passthrough operations."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

from athena_api.dependencies import KiwoomClientDep
from athena_api.generated.registry import QUERY_TR_IDS
from athena_api.generated.runtime import call_raw_tr

router = APIRouter(tags=["Raw allowlisted TR"])


@router.post("/api/v1/raw/tr/{tr_id}", operation_id="post_raw_query_tr")
async def post_raw_query_tr(
    tr_id: str,
    body: dict[str, Any],
    request: Request,
    response: Response,
    client: KiwoomClientDep,
) -> dict[str, Any]:
    if tr_id not in QUERY_TR_IDS:
        raise HTTPException(status_code=404, detail="Unknown query TR id")
    return await call_raw_tr(tr_id, body, request, response, client)
