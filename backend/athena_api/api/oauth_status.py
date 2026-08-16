"""Read-only OAuth token status.

``au10001`` issues a token and ``au10002`` revokes one; both mutate. A client
that wants to show remaining time therefore had no way to ask "how long is
left?" without minting a new token on every poll. This route answers that
question and changes nothing.

It never returns the token itself, and it stays reachable when credentials are
absent so the UI can distinguish "not configured" from "configured but not yet
authenticated".
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, ConfigDict, Field

from athena_api.dependencies import get_token_manager
from athena_api.security import require_local_bearer

router = APIRouter(prefix="/api/v1/internal/oauth", tags=["Internal OAuth lifecycle"])


class OAuthStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    configured: bool = Field(
        description="Whether server-side credentials are configured.",
    )
    ready: bool = Field(
        description="Whether the memory-only token is present and unexpired.",
    )
    expires_at: str | None = Field(
        default=None,
        description=(
            "Timezone-aware ISO-8601 expiry, or null when no token is held. "
            "The token itself is never returned."
        ),
    )


@router.get(
    "/status",
    summary="접근토큰 상태 조회",
    operation_id="get_internal_oauth_status",
    response_model=OAuthStatusResponse,
    openapi_extra={
        "x-athena-operation-kind": "internal-oauth",
        "x-athena-secrets-exposed": False,
        "x-athena-llm-exposed": False,
        "x-athena-side-effect": "none",
    },
)
async def get_oauth_status(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
) -> OAuthStatusResponse:
    require_local_bearer(request, authorization)
    manager = get_token_manager(request)
    if manager is None:
        return OAuthStatusResponse(configured=False, ready=False, expires_at=None)
    return OAuthStatusResponse.model_validate(manager.status())
