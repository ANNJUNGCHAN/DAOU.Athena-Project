"""exposeToModel 게이트 상태 갱신 (WP-I).

렌더러 localStorage에 사는 exposeToModel 토글 값은 MCP 프로세스가 물리적으로
읽을 수 없다 — Electron main이 이 라우트로 현재 값을 밀어 넣고, MCP 브레인
게이트(athena_mcp/brain_tools.py)가 ``app.state.expose_to_model``을 읽는다.

``require_local_bearer``만 건다(G-I2) — MCP 툴 카탈로그에는 이 라우트가 아예
없어(라우트 자체를 모르게 유지) 모델이 스스로 게이트를 열 수 없다. 이 게이트는
자기신고 헤더 기반이라 실수 방지용이지 적대적 우회를 막지 않는다는 한계가
문서화돼 있다(expose-authz-design.md §2(a), 계획 §0).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel, ConfigDict, Field

from athena_api.security import require_local_bearer

router = APIRouter(prefix="/api/v1/settings", tags=["Runtime settings"])


class ExposeToModelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(description="모델(MCP)에게 브레인 라우트를 열지 여부.")


class ExposeToModelResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(description="갱신 후 게이트 상태.")


@router.post(
    "/expose-to-model",
    summary="exposeToModel 게이트 갱신",
    operation_id="set_expose_to_model",
    response_model=ExposeToModelResponse,
    openapi_extra={"x-athena-llm-exposed": False, "x-athena-side-effect": "write"},
)
async def set_expose_to_model(
    request: Request,
    authorization: Annotated[str, Header(alias="Authorization")],
    body: ExposeToModelRequest,
) -> ExposeToModelResponse:
    require_local_bearer(request, authorization)
    request.app.state.expose_to_model = bool(body.enabled)
    return ExposeToModelResponse(enabled=request.app.state.expose_to_model)
